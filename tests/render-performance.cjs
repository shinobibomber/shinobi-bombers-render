/* Presentation regression: a large real fixture collection must not create an
 * ever-growing portrait cache or redraw/read back unchanged menu canvases. */
const fs = require('node:fs');
const path = require('node:path');
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    // The fixture account also receives the game's four starter heroes.
    for (const quantity of [...Array(24).fill(15), 10, 1, 1]) f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity })).profile;
    // Pre-existing server roster: selecting Work All below still uses the real
    // deploy function. This fixture does not emulate a new hero-mode endpoint.
    f.profile.battleReady = f.profile.heroes.slice().sort((a, b) => b.rank - a.rank).slice(0, 10).map(h => h.tokenId);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    const initial = await p.evaluate(() => ({ ids: S.h.map(h => [h.id, h.tokenId, h.tokenOwner]), balance: RyoPayments.state.balance }));
    assert.equal(initial.ids.length, 376);
    const heroes = p.locator('.sbw-hdr [data-sbwid="nav-heroes"]');
    const adventure = p.locator('.sbw-hdr [data-sbwid="nav-adventure"]');
    await heroes.click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'heroes' && PlayerModels.hdReady && document.querySelectorAll('.sbw-hcard canvas').length === 10);
    assert.equal(await p.evaluate(() => BattleRoster.list().length), 10);
    await p.waitForTimeout(250);
    await p.evaluate(() => {
      window.renderCounters = { portraits: 0, readbacks: 0, mirrors: 0 };
      const draw = PlayerModels.drawPortrait;
      PlayerModels.drawPortrait = function (context, ...args) {
        if (context.canvas.closest('#sbwLayer')) renderCounters.portraits++;
        return draw.call(this, context, ...args);
      };
      const read = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (...args) {
        if (this.canvas.closest('#sbwLayer, article.map-hero')) renderCounters.readbacks++;
        return read.apply(this, args);
      };
      const image = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
        if (this.canvas.matches('.sbw-mirror')) renderCounters.mirrors++;
        return image.call(this, source, ...args);
      };
      window.portraitNodes = [...document.querySelectorAll('.sbw-hcard canvas')];
      renderCounters.portraits = renderCounters.readbacks = renderCounters.mirrors = 0;
    });
    await p.waitForTimeout(900);
    const idle = await p.evaluate(() => ({ ...renderCounters, retained: portraitNodes.every((node, i) => node === document.querySelectorAll('.sbw-hcard canvas')[i]) }));
    assert.equal(idle.portraits, 0, 'unchanged HD portraits require zero repeated draw calls');
    assert.equal(idle.readbacks, 0, 'portrait display never reads GPU pixels back');
    assert(idle.retained, 'polling retains the existing ten display canvases');

    // A DPR/viewport change must invalidate backing dimensions even if hero data
    // and HD artwork did not change. Logical model proportions remain fixed.
    await p.evaluate(() => { Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 }); dispatchEvent(new Event('resize')); });
    await p.waitForTimeout(160);
    const desktopSizes = await p.locator('.sbw-hcard canvas').evaluateAll(nodes => nodes.map(c => ({ width: c.width, height: c.height, rect: [c.getBoundingClientRect().width, c.getBoundingClientRect().height] })));
    const nameHeights = await p.locator('.sbw-hc-name').evaluateAll(nodes => nodes.map(c => ({ visible: c.clientHeight, needed: c.scrollHeight })));
    assert(nameHeights.every(c => c.visible >= c.needed - 1 && c.visible >= 16), 'portrait canvases never squeeze the hero name out of its row');
    for (const c of desktopSizes) {
      assert(Math.abs(c.width - Math.ceil(c.rect[0] * 2)) <= 1);
      assert(Math.abs(c.height - Math.ceil(c.rect[1] * 2)) <= 1);
    }
    const output = path.join(__dirname, 'out'); fs.mkdirSync(output, { recursive: true });
    await p.screenshot({ path: path.join(output, 'heroes-hd-desktop.png'), scale: 'css' });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(200);
    const mobileSizes = await p.locator('.sbw-hcard canvas').evaluateAll(nodes => nodes.map(c => ({ width: c.width, height: c.height, rect: [c.getBoundingClientRect().width, c.getBoundingClientRect().height] })));
    assert(mobileSizes[0].width < desktopSizes[0].width, 'mobile keeps only the backing pixels needed by its display');
    for (const c of mobileSizes) assert(Math.abs(c.width - Math.ceil(c.rect[0] * 2)) <= 1);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.screenshot({ path: path.join(output, 'heroes-hd-mobile.png'), scale: 'css' });
    await p.setViewportSize({ width: 1440, height: 1000 });
    await adventure.click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'adventure');
    await p.locator('.sbw-scr.on [data-a="work"]').click();
    await p.waitForFunction(() => S.h.filter(h => h.on).length === 10);
    await p.waitForFunction(() => document.querySelectorAll('.sbw-at-card:not(.empty) canvas').length > 0);
    await p.waitForTimeout(350);
    await p.evaluate(() => { renderCounters.portraits = renderCounters.readbacks = renderCounters.mirrors = 0; window.teamPortraitNodes = [...document.querySelectorAll('.sbw-at-card canvas')]; });
    await p.waitForTimeout(900);
    const active = await p.evaluate(() => ({ ...renderCounters, retained: teamPortraitNodes.every((node, i) => node === document.querySelectorAll('.sbw-at-card canvas')[i]) }));
    assert.equal(active.readbacks, 0, 'Adventure no longer probes native roster alpha on every frame');
    assert(active.portraits <= 10, 'active gameplay updates team portraits only when hero presentation changes');
    assert(active.retained, 'native status changes retain displayed team canvas nodes');
    assert(active.mirrors > 0, 'the actual live Adventure canvas still reaches the visible map');
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); renderCounters.portraits = renderCounters.mirrors = 0; });
    await p.waitForTimeout(250);
    assert.deepEqual(await p.evaluate(() => [renderCounters.portraits, renderCounters.mirrors]), [0, 0], 'hidden tabs skip overlay painting and map copies');
    await p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await p.locator('.sbw-scr.on [data-a="rest"]').click();
    await heroes.click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'heroes');
    await p.screenshot({ path: path.join(output, 'heroes-hd-performance.png'), scale: 'css' });

    const animation = await p.evaluate(() => {
      const ca = CharacterAnimations, h = { id: 900000, sp: 3 };
      const phaseZero = ca.poseFor(h, 12345, { moving: true, phase: 0 });
      const phaseOne = ca.poseFor(h, 12345, { moving: true, phase: 1 });
      const presentation = PlayerModels.presentationFrame;
      PlayerModels.presentationFrame = () => null;
      let back;
      try { back = [0, 1, 2].map(i => ca.heroFrame(h, 'clip:walk:' + i, false, 'back').playerModel.phase); }
      finally { PlayerModels.presentationFrame = presentation; }
      const attack = ca.heroFrame(h, 'clip:melee:1', false, 'front').characterAnimation.state;
      const now = performance.now();
      for (let i = 0; i < 129; i++) ca.play({ id: 900000 + i }, 'melee', now);
      const evicted = ca.poseFor(h, now, {}), newest = ca.poseFor({ id: 900128 }, now, {});
      // Expire all synthetic presentation-only events without touching heroes.
      ca.play({ id: 910000 }, 'idle', now + 2000);
      return { phaseZero, phaseOne, back, attack, evicted, newest };
    });
    assert.equal(animation.phaseZero, 'clip:walk:0', 'zero is a real movement phase, not missing input');
    assert.equal(animation.phaseOne, 'clip:walk:1');
    assert.deepEqual(animation.back, [0, 1, 2], 'back-facing clip tokens advance the supplied walk frames');
    assert.equal(animation.attack, 'melee', 'real attack clips remain independent of HD locomotion');
    assert(animation.evicted.startsWith('clip:idle:'), 'presentation event retention is bounded');
    assert.equal(animation.newest, 'clip:melee:0');
    await p.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await p.evaluate(() => CharacterAnimations.poseFor({ id: 920001, sp: 3 }, 12345, { moving: true, phase: 1 })), 'clip:walk:0', 'live reduced-motion preference freezes decorative cycling');
    await p.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal(await p.evaluate(() => CharacterAnimations.poseFor({ id: 920001, sp: 3 }, 12345, { moving: true, phase: 1 })), 'clip:walk:1', 'motion can be re-enabled without reloading');
    assert.deepEqual(await p.evaluate(() => ({ ids: S.h.map(h => [h.id, h.tokenId, h.tokenOwner]), balance: RyoPayments.state.balance })), initial, 'rendering/navigation preserves hero ownership and balances');
    assert.deepEqual(errors, []);
    console.log('Render counters (900ms each): ' + JSON.stringify({ heroes: idle, adventure: active }));
  });
  console.log('PASS: 376-hero display caches, DPR/mobile sizing, live Adventure team, hidden-tab cleanup, reduced motion and preserved action clips.');
})().catch(error => { console.error(error); process.exitCode = 1; });
