/* Presentation regressions: real map coordinates, bounded effects and native controls. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    // Exercise the full native ten-actor limit, using real fixture-generated
    // heroes and the server profile's existing battle-ready field.
    f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity: 15 })).profile;
    f.profile.battleReady = f.profile.heroes.slice(0, 10).map(hero => hero.tokenId);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.MapDesign?.loaded);
    await p.locator('.sbw-hdr [data-sbwid="nav-adventure"]').click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'adventure');
    await p.locator('.sbw-scr.on .sbw-patch').evaluate(image => image.decode());
    assert.equal(await p.locator('.sbw-scr.on .sbw-patch').evaluate(image => image.naturalWidth > 0), true, 'Adventure scenery patch is included in the assembled assets');
    await p.locator('.sbw-scr.on [data-a="work"]').click();
    await p.waitForFunction(() => S.h.filter(hero => hero.on).length === 10);
    await p.waitForTimeout(800);

    const geometry = await p.evaluate(() => {
      const originalMap = S.map;
      let maxError = 0, points = 0;
      // Compare every map against the original projection, including fractional
      // actor positions and airborne projectiles. No simulation tick runs here.
      try {
        for (let map = 1; map <= 8; map++) {
          S.map = map;
          const [left, top, width, height] = MapDesign.activeLayout().bounds;
          for (const [x, y, z] of [[0, 0, 0], [W, H, 0], [W / 2 + .23, H / 2 + .68, 7.25]]) {
            const expected = [(left + x * width / W) * 1240 / 1536, (top + y * height / H - 225) * 465 / 575 - z * .9];
            const actual = MapDesign.project(x, y, z);
            maxError = Math.max(maxError, ...actual.map((value, i) => Math.abs(value - expected[i])));
            points++;
          }
        }
      } finally { S.map = originalMap; MapDesign.project(0, 0); }
      return { maxError, points };
    });
    assert.equal(geometry.points, 24);
    assert(geometry.maxError < 1e-9, 'cached projection keeps the original actor/collision coordinate alignment on all eight maps');

    const render = await p.evaluate(() => {
      const snapshot = () => JSON.stringify({ heroes: S.h.map(h => [h.id, h.tokenId, h.tokenOwner, h.on, h.x, h.y, h.lv, h.pw, h.sp, h.st, h.en]), grid: G, balance: RyoPayments.state.balance });
      const before = snapshot(), originalWall = AdventureDesign.drawWall;
      let walls = 0;
      try {
        AdventureDesign.drawWall = () => { walls++; };
        draw(performance.now());
      } finally { AdventureDesign.drawWall = originalWall; }
      const strip = document.getElementById('strip'), cards = [...strip.children];
      const observer = new MutationObserver(() => {});
      observer.observe(strip, { childList: true });
      AdventureDesign.refresh();
      const changes = observer.takeRecords().length;
      observer.disconnect();
      return { walls, terrainWalls: G.flat().filter(cell => cell.k === 1).length, unchanged: snapshot() === before,
        changes, sameCards: cards.every((card, i) => strip.children[i] === card), cardCount: strip.children.length, broken: Arena3D.broken };
    });
    assert(render.terrainWalls > 0, 'the native collision walls still exist');
    assert.equal(render.walls, 0, 'baked terrain does not allocate/sort invisible wall render entries');
    assert.equal(render.unchanged, true, 'rendering and presentation refresh leave heroes, inventory, map cells and balance untouched');
    assert.equal(render.broken, false, 'Adventure stays on its full renderer');
    assert.equal(render.cardCount, 10);
    assert.equal(render.changes, 0, 'refresh does not create throwaway legacy roster children');
    assert.equal(render.sameCards, true, 'native roster controls retain their DOM identity and focus');

    const effects = await p.evaluate(() => {
      const oldQuality = Arena3D.cfg.fx, counts = [];
      let particles = 0;
      const context = { save() {}, restore() {}, beginPath() {}, fill() {}, ellipse() { particles++; } };
      try {
        for (const quality of [0, 1, 2]) {
          Arena3D.setFx(quality); particles = 0;
          MapDesign.drawAtmosphere(context, performance.now()); counts.push(particles);
        }
      } finally { Arena3D.setFx(oldQuality); }
      return counts;
    });
    assert.deepEqual(effects, [0, 9, 18], 'existing effects quality controls bound map decoration work');
    await p.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await p.evaluate(() => {
      let particles = 0;
      MapDesign.drawAtmosphere({ save() {}, restore() {}, beginPath() {}, fill() {}, ellipse() { particles++; } }, performance.now());
      return particles;
    }), 0, 'reduced motion suppresses map particles');
    await p.emulateMedia({ reducedMotion: 'no-preference' });

    // Timings are diagnostic, not a hardware-dependent FPS assertion. The stable
    // regression gate is zero discarded wall work while actual combat runs.
    await p.evaluate(() => {
      const originalDraw = draw, originalWall = AdventureDesign.drawWall;
      window.adventureRenderSample = { frames: 0, totalMs: 0, maxMs: 0, wallCalls: 0 };
      AdventureDesign.drawWall = function (...args) { adventureRenderSample.wallCalls++; return originalWall.apply(this, args); };
      draw = function (...args) {
        const started = performance.now(), result = originalDraw.apply(this, args), duration = performance.now() - started;
        adventureRenderSample.frames++; adventureRenderSample.totalMs += duration;
        adventureRenderSample.maxMs = Math.max(adventureRenderSample.maxMs, duration); return result;
      };
      window.finishAdventureRenderSample = () => {
        draw = originalDraw; AdventureDesign.drawWall = originalWall;
        const result = { ...adventureRenderSample, meanMs: adventureRenderSample.totalMs / adventureRenderSample.frames,
          walls: G.flat().filter(cell => cell.k === 1).length, heroes: S.h.filter(hero => hero.on).length, broken: Arena3D.broken };
        delete window.adventureRenderSample; delete window.finishAdventureRenderSample; return result;
      };
    });
    await p.waitForTimeout(1600);
    const sample = await p.evaluate(() => finishAdventureRenderSample());
    assert(sample.frames > 0 && sample.heroes > 0, 'measure actual deployed gameplay');
    assert.equal(sample.wallCalls, 0);
    assert.equal(sample.broken, false);
    console.log('Adventure renderer sample:', JSON.stringify(sample));

    await p.locator('.sbw-hdr [data-sbwid="nav-heroes"]').click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'heroes');
    await p.locator('.sbw-hdr [data-sbwid="nav-adventure"]').click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'adventure');
    assert.equal(await p.evaluate(() => Arena3D.broken), false, 'returning to Adventure keeps the renderer healthy');
    assert.deepEqual(errors, [], 'combat and navigation produce no browser errors');
    assert.equal(f.purchases.length, 0, 'rendering never submits a purchase');
  });
  console.log('PASS: Adventure rendering preserves map alignment and gameplay state, bounds decoration, and avoids discarded wall/roster work.');
})().catch(error => { console.error(error); process.exitCode = 1; });
