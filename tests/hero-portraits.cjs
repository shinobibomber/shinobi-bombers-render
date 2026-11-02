/* Shared HD artwork: direct source rendering, hidden work, optional-art failure. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');

const login = async p => {
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy &&
    !LoginScreen.active && window.WebsiteDesign?.ready);
};
const collection = async p => {
  await p.locator('.sbw-hdr [data-sbwid="nav-heroes"]').click();
  await p.waitForFunction(() => WebsiteDesign.current() === 'heroes' && document.querySelector('.sbw-hcard canvas'));
};

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity: 15 })).profile;
    await login(p);
    await collection(p);
    await p.waitForFunction(() => PlayerModels.hdReady);
    const artwork = await p.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 400;
      const context = canvas.getContext('2d'), calls = [], sources = new Set();
      const originalDraw = context.drawImage.bind(context);
      context.drawImage = (source, ...args) => {
        if (source instanceof HTMLImageElement && source.naturalWidth === 1254) {
          sources.add(source); calls.push(args);
        }
        originalDraw(source, ...args);
      };
      for (let id = 0; id < 8; id++) PlayerModels.drawPortrait(context, { id, r: id % 5, z: false }, 160, 352, 8, 0);
      return { calls, sources: sources.size, revision: PlayerModels.portraitRevision,
        requestCount: performance.getEntriesByType('resource').filter(r => r.name.endsWith('/reveal-models-hd.png')).length };
    });
    assert.equal(artwork.calls.length, 8, 'all eight identities draw directly from the HD image');
    assert.equal(artwork.sources, 1, 'menus reuse the reveal atlas instance');
    assert.equal(artwork.requestCount, 1, 'shared atlas is fetched once across menus');
    assert.equal(artwork.revision, 1, 'readiness invalidates portrait caches exactly once');
    for (const args of artwork.calls) {
      assert.equal(args.length, 8, 'render samples a source crop into the final destination');
      assert.equal(args[3], 550, 'each portrait retains the full high-resolution source height');
      assert.equal(args[7], 352, 'legacy logical height and foot anchor remain consistent');
    }
    assert.equal(new Set(artwork.calls.map(args => args.slice(0, 4).join(':'))).size, 8, 'model identity selects eight independent crops');

    await p.waitForTimeout(250);
    await p.evaluate(() => {
      window.__hiddenPortraitPaints = 0;
      const original = PlayerModels.drawPortrait;
      PlayerModels.drawPortrait = function(context, ...args) {
        if (context.canvas.matches('#p1 canvas[data-hero], #strip canvas[data-map-portrait]')) window.__hiddenPortraitPaints++;
        return original.call(this, context, ...args);
      };
    });
    await p.waitForTimeout(600);
    assert.equal(await p.evaluate(() => window.__hiddenPortraitPaints), 0, 'covered native Heroes portraits do not repaint');
    await p.locator('.sbw-hdr [data-sbwid="nav-adventure"]').click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'adventure');
    await p.waitForTimeout(250);
    await p.evaluate(() => { window.__hiddenPortraitPaints = 0; });
    await p.waitForTimeout(600);
    assert.equal(await p.evaluate(() => window.__hiddenPortraitPaints), 0, 'covered native Adventure portraits do not repaint');
    assert.deepEqual(errors, [], 'portrait rendering and navigation remain error-free');
  });

  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity: 5 })).profile;
    await p.route('**/reveal-models-hd.png', route => route.abort());
    await p.reload();
    await p.evaluate(() => GameLoading.ready);
    await p.waitForFunction(() => !GameLoading.active);
    await login(p);
    const initial = await p.evaluate(() => ({ balance: RyoPayments.state.balance, ids: S.h.map(h => h.tokenId) }));
    await collection(p);
    await p.waitForFunction(() => RevealModels.status === 'error');
    const fallback = await p.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 400;
      const context = canvas.getContext('2d');
      PlayerModels.drawPortrait(context, S.h[0], 160, 352, 8);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) visible++;
      return { visible, hd: PlayerModels.hdReady, revision: PlayerModels.portraitRevision,
        balance: RyoPayments.state.balance, ids: S.h.map(h => h.tokenId) };
    });
    assert(fallback.visible > 1000, 'optional image failure retains a visible original-model portrait');
    assert.equal(fallback.hd, false);
    assert.equal(fallback.revision, 0);
    assert.deepEqual({ balance: fallback.balance, ids: fallback.ids }, initial, 'art failure does not alter balance or collection');
    assert.deepEqual(errors, [], 'optional image failure does not crash Heroes');
  });
  console.log('PASS: eight shared HD portraits, one image request, direct source drawing, hidden-paint suppression and original-art fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
