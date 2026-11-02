/* HD world presentation: direction isolation, native actions, cache and failure recovery. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
const output = path.join(__dirname, 'out');
fs.mkdirSync(output, { recursive: true });
const login = async p => {
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy &&
    !LoginScreen.active && window.WebsiteDesign?.ready && window.CharacterAnimations?.loaded);
};

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity: 15 })).profile;
    f.profile.battleReady = f.profile.heroes.slice(0, 10).map(hero => hero.tokenId);
    await login(p);
    await p.evaluate(() => {
      window.motionIdleSamples = [];
      const original = window.requestIdleCallback;
      if (original) window.requestIdleCallback = function (callback, options) {
        return original.call(this, deadline => {
          const start = performance.now(); callback(deadline);
          motionIdleSamples.push(performance.now() - start);
        }, options);
      };
    });
    await p.evaluate(() => HeroMotion.load());
    await p.waitForFunction(() => HeroMotion.status === 'ready' && RevealModels.status === 'ready');
    // One asynchronous cleanup per silhouette; the foreground call remains cheap.
    await p.waitForFunction(() => {
      for (let id = 0; id < 8; id++) for (const direction of ['front', 'side', 'back'])
        HeroMotion.frame({ id }, 'clip:idle:0', direction);
      return HeroMotion.textureCount === 24;
    });
    const result = await p.evaluate(() => {
      const rows = [], sheet = document.createElement('canvas');
      sheet.width = 8 * 160; sheet.height = 3 * 220;
      const painter = sheet.getContext('2d');
      painter.fillStyle = '#182236'; painter.fillRect(0, 0, sheet.width, sheet.height);
      const fingerprint = canvas => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261, opaque = 0, edge = 0;
        for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i], 16777619);
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          if (!pixels[(y * canvas.width + x) * 4 + 3]) continue;
          opaque++;
          if (x === 0 || y === 0 || x === canvas.width - 1 || y === canvas.height - 1) edge++;
        }
        return { hash, opaque, edge };
      };
      for (let id = 0; id < 8; id++) for (const [row, direction] of ['front', 'side', 'back'].entries()) {
        const hero = { id, r: id % 5, sp: 10 };
        const rest = CharacterAnimations.heroFrame(hero, 'clip:idle:0', false, direction);
        const movement = []; let movingEdge = 0;
        const count = CharacterAnimations.source.models[id].rows.walk.actors.length;
        for (let phase = 0; phase < count; phase++) {
          const stats = fingerprint(CharacterAnimations.heroFrame(hero, 'clip:walk:' + phase, false, direction));
          movement.push(stats.hash); movingEdge = Math.max(movingEdge, stats.edge);
        }
        rows.push({ id, direction, model: rest.playerModel.model, actualDirection: rest.playerModel.direction,
          hd: rest.characterAnimation?.hd, width: rest.width, height: rest.height, ...fingerprint(rest), steps: new Set(movement).size, movingEdge });
        painter.drawImage(rest, id * 160, row * 220);
        painter.fillStyle = '#fff'; painter.font = '12px sans-serif';
        painter.fillText(PlayerModels.catalog[id].label + ' / ' + direction, id * 160 + 4, row * 220 + 215);
      }
      return { rows, image: sheet.toDataURL('image/png') };
    });
    fs.writeFileSync(path.join(output, 'hero-directions-contact.png'), Buffer.from(result.image.split(',')[1], 'base64'));
    assert.equal(result.rows.length, 24);
    for (const row of result.rows) {
      assert.equal(row.model, row.id);
      assert.equal(row.actualDirection, row.direction);
      assert.equal(row.hd, true);
      assert.deepEqual([row.width, row.height], [160, 200], 'world frames use bounded 2x surfaces');
      assert(row.opaque > 1500, 'every model is visible');
      assert.equal(row.edge, 0, row.id + ' / ' + row.direction + ': silhouette remains inside the output canvas');
      assert.equal(row.movingEdge, 0, 'moving poses remain inside the output canvas');
      assert(row.steps >= 3, 'walk changes actual leg pixels across phases');
    }
    assert.equal(new Set(result.rows.map(row => row.hash)).size, 24, 'all identities and facing directions use distinct artwork');
    const actions = await p.evaluate(() => {
      const results = [];
      for (let id = 0; id < 8; id++) for (const state of ['melee', 'ranged', 'skill', 'hurt', 'die', 'victory']) {
        if (!CharacterAnimations.source.models[id].rows[state]?.actors.length) continue;
        const hero = { id: id + 800, r: 0 }, pose = 'clip:' + state + ':0';
        const frame = CharacterAnimations.heroFrame(hero, pose, false, 'front');
        results.push({ state, actual: frame.characterAnimation?.state, hd: !!frame.characterAnimation?.hd,
          optional: HeroMotion.frame(hero, pose, 'front') === null });
      }
      const hero = { id: 8000, r: 0 };
      CharacterAnimations.play(hero, 'melee', performance.now());
      const event = CharacterAnimations.heroFrame(hero, 'i0', false, 'front');
      return { results, event: event.characterAnimation?.state, zero: CharacterAnimations.poseFor({ id: 8001, sp: 1 }, 77777, { moving: true, phase: 0 }) };
    });
    assert(actions.results.length > 20);
    for (const row of actions.results) {
      assert.equal(row.actual, row.state, 'native explicit combat state retains its original clip');
      assert.equal(row.hd, false);
      assert.equal(row.optional, true, 'HD locomotion declines combat clips');
    }
    assert.equal(actions.event, 'melee', 'an active combat event wins over an idle token');
    assert.equal(actions.zero, 'clip:walk:0', 'movement phase zero remains zero');
    const cache = await p.evaluate(() => {
      const collect = (directions = ['front', 'side', 'back']) => {
        const found = [];
        for (let id = 0; id < 8; id++) for (const direction of directions)
          for (const state of ['idle', 'walk', 'run']) for (let phase = 0; phase < 24; phase++)
            found.push(HeroMotion.frame({ id }, 'clip:' + state + ':' + phase, direction));
        return found;
      };
      collect(); // Stress beyond the memory bound before warming a realistic working set.
      collect(['front']); // Flush cold FIFO entries from the preceding stress pass.
      const warmed = collect(['front']), originalRead = CanvasRenderingContext2D.prototype.getImageData;
      let reads = 0, reused = false;
      CanvasRenderingContext2D.prototype.getImageData = function (...args) { reads++; return originalRead.apply(this, args); };
      try { const again = collect(['front']); reused = again.every((frame, index) => frame === warmed[index]); }
      finally { CanvasRenderingContext2D.prototype.getImageData = originalRead; }
      const samples = motionIdleSamples.slice().sort((a, b) => a - b);
      return { reads, reused, frames: HeroMotion.cacheSize, maximum: HeroMotion.maxFrames, textures: HeroMotion.textureCount,
        cuts: { count: samples.length, meanMs: samples.reduce((a, b) => a + b, 0) / samples.length, maxMs: samples.at(-1) } };
    });
    assert.equal(cache.reads, 0, 'warm gameplay never reads canvas pixels');
    assert.equal(cache.reused, true, 'every warmed animation frame is reused');
    assert(cache.frames <= cache.maximum && cache.maximum === 216, 'frame surfaces stay under the fixed memory bound');
    assert.equal(cache.textures, 24);
    console.log('HD source cleanup idle tasks:', JSON.stringify(cache.cuts));
    await p.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await p.evaluate(() => HeroMotion.frame({ id: 0 }, 'clip:walk:0', 'back') === HeroMotion.frame({ id: 0 }, 'clip:walk:3', 'back')), true, 'reduced motion shares a still frame');
    await p.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal(await p.evaluate(() => HeroMotion.frame({ id: 0 }, 'clip:walk:0', 'back') === HeroMotion.frame({ id: 0 }, 'clip:walk:3', 'back')), false, 'motion preference changes apply live');
    await p.locator('.sbw-hdr [data-sbwid="nav-adventure"]').click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'adventure');
    await p.locator('.sbw-scr.on [data-a="work"]').click();
    await p.waitForFunction(() => S.h.filter(h => h.on).length === 10);
    await p.waitForTimeout(800);
    await p.screenshot({ path: path.join(output, 'adventure-hd-desktop.png') });
    assert.equal(await p.evaluate(() => Arena3D.broken), false);
    assert.deepEqual(errors, []);
    assert.equal(f.purchases.length, 0);
  });

  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    await p.route('**/hero-directions-hd.png', route => route.abort());
    await p.route('**/reveal-models-hd.png', route => route.abort());
    await p.reload(); await p.evaluate(() => GameLoading.ready);
    await login(p);
    const before = await p.evaluate(() => ({ balance: RyoPayments.state.balance, tokens: S.h.map(h => h.tokenId) }));
    await p.evaluate(() => HeroMotion.load());
    await p.waitForFunction(() => HeroMotion.status === 'error' && RevealModels.status === 'error');
    const fallback = await p.evaluate(() => {
      const rows = [];
      for (let id = 0; id < 8; id++) for (const direction of ['front', 'side', 'back']) {
        const frame = CharacterAnimations.heroFrame({ id, r: 0 }, 'clip:walk:1', false, direction);
        const pixels = frame.getContext('2d').getImageData(0, 0, frame.width, frame.height).data;
        let visible = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) visible++;
        rows.push({ model: frame.playerModel.model, expected: id, visible, hd: !!frame.characterAnimation?.hd });
      }
      return rows;
    });
    for (const row of fallback) { assert.equal(row.model, row.expected); assert(row.visible > 1000); assert.equal(row.hd, false); }
    await p.locator('.sbw-hdr [data-sbwid="nav-adventure"]').click();
    await p.locator('.sbw-scr.on [data-a="work"]').click();
    await p.waitForTimeout(500);
    assert.equal(await p.evaluate(() => Arena3D.broken), false, 'optional image failure keeps real Adventure running');
    assert.deepEqual(await p.evaluate(() => ({ balance: RyoPayments.state.balance, tokens: S.h.map(h => h.tokenId) })), before);
    assert.equal(f.purchases.length, 0);
    assert.deepEqual(errors, []);
  });
  console.log('PASS: 24 HD directions, visible gait, native actions, bounded cached frames, zero warm readbacks and failure fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
