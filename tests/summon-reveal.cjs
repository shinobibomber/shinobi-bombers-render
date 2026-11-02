/* Real checkout/delivery/reveal handlers against an isolated server fixture.
 * No external wallet, transaction, credentials or production state is used. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { withGame } = require('./harness.cjs');
const output = path.join(__dirname, 'out');
fs.mkdirSync(output, { recursive: true });

// Run the actual server fulfillment code with a deterministic rarity RNG only.
// Names, stats, IDs and all probability thresholds still use the real module.
function fulfillWithRolls(rolls) {
  const file = path.resolve(__dirname, '../app/server/economy.cjs');
  const requireEconomy = createRequire(file), record = { exports: {} };
  const randomInt = (...args) => args.length === 1 && args[0] === 10000 && rolls.length
    ? rolls.shift() : crypto.randomInt(...args);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module: record, exports: record.exports, structuredClone,
    require: name => name === 'node:crypto' ? { ...crypto, randomInt } : requireEconomy(name)
  }, { filename: file });
  return (profile, quote) => JSON.parse(JSON.stringify(record.exports.fulfill(profile, quote)));
}

const count = (f, action) => f.requests.filter(request => request.action === action).length;
const login = async p => {
  if (!await p.evaluate(() => RyoPayments.state.authenticated)) await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active);
};
const ready = async p => {
  await p.evaluate(() => GameLoading.ready);
  await p.waitForFunction(() => RevealDesign.loaded && !GameLoading.active);
};
const waitForFixture = async check => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Timed out waiting for isolated fixture request.');
};
const snapshot = p => p.evaluate(() => ({
  ids: S.h.filter(hero => hero.tokenOwner === RyoPayments.state.account).map(hero => hero.tokenId).sort(),
  batch: (S.v2.revealBatch || []).map(item => ({ id: item.hero.tokenId, revealed: item.revealed })),
  balance: RyoPayments.state.balance
}));
const revealedCount = p => p.evaluate(() => S.v2.revealBatch.filter(item => item.revealed).length);

(async () => {
  await withGame(async ({ p, f, errors, account, assert }) => {
    f.holdAdventure = false;
    f.balance = 1000000;
    const economy = require('../app/server/economy.cjs');
    f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity: 1 })).profile;
    f.fulfillPurchase = fulfillWithRolls([9999, 9700, 9200, 8200, 100, 200, 300, 400, 500, 600]);
    await ready(p);
    await login(p);
    const originalIds = (await snapshot(p)).ids;
    const priorModels = await p.evaluate(() => S.h.filter(h => h.tokenOwner === RyoPayments.state.account).map(h => PlayerModels.modelFor(h).key));
    await p.evaluate(() => { go(2); Combat.quantity(10); });
    f.holdQuote = true;
    await p.evaluate(() => { Combat.summonBatch(); Combat.summonBatch(); });
    await waitForFixture(() => count(f, 'quote') === 1);
    assert.equal(count(f, 'purchase'), 0, 'opening the shrine never purchases');
    f.holdQuote = false; f.release('quote');
    await p.waitForSelector('#tokenCheckoutDialog[open]');
    assert.match(await p.locator('#tokenCheckoutTitle').textContent(), /10 heroes/);
    assert.match(await p.locator('#checkoutConfirm').textContent(), /255,000/);
    f.holdPurchase = true;
    await p.evaluate(() => { const pay = document.querySelector('#checkoutConfirm'); pay.click(); pay.click(); });
    await waitForFixture(() => count(f, 'purchase') === 1);
    await p.evaluate(() => { Combat.summonBatch(); Combat.summonBatch(); });
    assert.equal(count(f, 'purchase'), 1, 'rapid confirmations/submissions share the native purchase');
    f.holdPurchase = false; f.release('purchase');
    await p.waitForSelector('#summonReveal.cinematic-reveal[open]');
    await p.waitForFunction(() => S.v2.revealBatch.length === 10 && !RyoPayments.state.busy);
    const expected = f.purchases[0].result.outputs;
    const afterPurchase = await snapshot(p);
    assert.equal(f.balance, 745000, 'native quote charges base plus the unchanged studio fee once');
    assert.equal(afterPurchase.ids.length, originalIds.length + 10);
    assert.equal(new Set(afterPurchase.ids).size, afterPurchase.ids.length);
    assert.deepEqual(afterPurchase.batch.map(item => item.id).sort(), expected.map(hero => hero.tokenId).sort(), 'cards display exactly the confirmed server outputs');
    const actualHeroes = await p.evaluate(() => S.v2.revealBatch.map(({ hero }) => ({
      tokenId: hero.tokenId, rank: hero.r, name: hero.name, level: hero.lv, baseStats: hero.baseStats
    })).sort((a, b) => a.tokenId.localeCompare(b.tokenId)));
    assert.deepEqual(actualHeroes, expected.map(({ tokenId, rank, name, level, baseStats }) => ({ tokenId, rank, name, level, baseStats })).sort((a, b) => a.tokenId.localeCompare(b.tokenId)), 'names, ranks and attributes come unchanged from the server result');
    assert.equal(afterPurchase.batch.filter(item => item.revealed).length, 0);
    assert.equal(await p.locator('#summonReveal [data-reveal]').count(), 10);
    await p.screenshot({ path: path.join(output, 'summon-sealed-desktop.png'), scale: 'css' });

    const legendIndex = await p.evaluate(() => S.v2.revealBatch.findIndex(item => item.hero.r === 4));
    const legend = p.locator('[data-reveal="' + legendIndex + '"]');
    await legend.focus();
    await p.keyboard.press('Enter');
    await p.waitForSelector('#summonReveal.legend-opening');
    assert.match(await p.locator('.cinematic-announcement').textContent(), /LEGEND AWAKENED/);
    await p.screenshot({ path: path.join(output, 'summon-opening-desktop.png'), scale: 'css' });
    // A server refresh rebuilds the native modal during its presentation wait.
    await p.evaluate(() => Experience.refreshReveal());
    await p.waitForFunction(index => S.v2.revealBatch[index].revealed, legendIndex);
    assert.equal(await revealedCount(p), 1, 'a Legend can be individually revealed before lower ranks');
    assert.equal(await legend.getAttribute('aria-pressed'), 'true');
    assert.equal(await legend.evaluate(element => document.activeElement === element), true, 'focus survives the native delivery/modal refresh');
    await legend.dispatchEvent('click'); await legend.dispatchEvent('click');
    assert.equal(await revealedCount(p), 1, 'repeated revealed-card interaction is idempotent');
    assert.equal(count(f, 'purchase'), 1, 'revealing never purchases again');

    const saved = await snapshot(p);
    await p.reload(); await ready(p);
    assert.equal(await p.evaluate(() => RevealDesign.canReveal()), false, 'saved token results remain private before wallet authentication');
    assert.equal(await p.locator('#summonReveal[open]').count(), 0);
    await login(p);
    await p.waitForSelector('#summonReveal[open]');
    assert.deepEqual(await snapshot(p), saved, 'same-browser refresh restores exact result IDs and revealed flags');
    assert.equal(count(f, 'purchase'), 1, 'recovery does not request a new summon');

    const eliteIndex = await p.evaluate(() => S.v2.revealBatch.findIndex(item => item.hero.r === 3));
    await p.locator('[data-reveal="' + eliteIndex + '"]').click();
    await p.waitForSelector('.cinematic-elite.is-opening');
    await p.evaluate(() => BetaWallet.disconnect());
    await p.waitForFunction(() => !RyoPayments.state.authenticated);
    await p.waitForSelector('#summonReveal', { state: 'hidden' });
    assert.equal(await p.evaluate(() => RevealDesign.canReveal()), false);
    assert.equal(await p.evaluate(index => S.v2.revealBatch[index].revealed, eliteIndex), false, 'disconnect during animation does not mutate another session’s reveal');
    await login(p);
    await p.waitForSelector('#summonReveal[open]');
    assert.deepEqual((await snapshot(p)).ids, saved.ids, 'disconnect leaves collection ownership intact');

    // Reveal One opens just the next saved result, even with rapid duplicate clicks.
    await p.evaluate(() => { const one = document.querySelector('#revealOne'); one.click(); one.click(); });
    await p.waitForFunction(() => S.v2.revealBatch.filter(item => item.revealed).length === 2 && !document.querySelector('#revealOne').disabled);
    assert.equal(await revealedCount(p), 2);
    assert.equal(count(f, 'purchase'), 1, 'Reveal One is presentation only');

    // Reveal All and Skip may arrive in the same frame or during an opening.
    await p.locator('#revealAll').click();
    await p.waitForSelector('.reveal-card.is-opening');
    await p.locator('#revealSkip').click();
    await p.evaluate(() => { Experience.revealAll(); RevealDesign.skip(); });
    await p.waitForFunction(() => S.v2.revealBatch.every(item => item.revealed) && !document.querySelector('#revealContinue').disabled);
    const completed = await snapshot(p);
    assert.equal(completed.batch.length, 10);
    assert.equal(await p.locator('#revealProgress').textContent(), '10 / 10 revealed');
    assert.deepEqual(completed.ids, saved.ids);
    assert.equal(completed.balance, saved.balance);
    assert.equal(count(f, 'purchase'), 1);
    assert.equal(f.purchases.length, 1);
    const newModels = await p.locator('.reveal-card:has(.cinematic-new:not([hidden]))').evaluateAll(cards => cards.map(card => card.dataset.element));
    const batchModels = await p.locator('.reveal-card').evaluateAll(cards => cards.map(card => card.dataset.element));
    assert.deepEqual(newModels.slice().sort(), [...new Set(batchModels)].filter(model => !priorModels.includes(model)).sort(), 'NEW marks only the first copy of a model absent from the previous collection');
    assert.equal(new Set(newModels).size, newModels.length, 'duplicate models within one batch are not all NEW');
    const starRanks = await p.locator('.reveal-card').evaluateAll(cards => cards.map(card => ({ rank: +card.dataset.rank, stars: card.querySelector('.cinematic-stars').textContent, label: card.querySelector('.cinematic-stars').getAttribute('aria-label') })));
    for (const card of starRanks) { assert.equal(card.stars, '★'.repeat(card.rank + 1)); assert.match(card.label, new RegExp('rank ' + (card.rank + 1) + ' of 5')); }
    await p.waitForFunction(() => document.querySelector('.cinematic-cost')?.textContent === '255,000 Ryo' && !RyoPayments.state.busy);
    assert.equal(count(f, 'quote'), 2, 'the results cost is one read-only native quote');
    assert.equal(count(f, 'purchase'), 1, 'displaying the price cannot purchase');
    await p.evaluate(() => Experience.refreshReveal());
    assert.deepEqual(await p.locator('.reveal-card:has(.cinematic-new:not([hidden]))').evaluateAll(cards => cards.map(card => card.dataset.element)), newModels, 'NEW classification survives presentation rebuilds');
    assert.equal(count(f, 'quote'), 2, 'rebuilding the results reuses its cached quote');
    const expectedCounts = [0, 1, 2, 3, 4].map(rank => expected.filter(hero => hero.rank === rank).length);
    assert.deepEqual(await p.locator('.cinematic-summary b').allTextContents(), expectedCounts.map(String));
    const cards = await p.locator('[data-reveal]').evaluateAll(elements => elements.map(element => ({
      rank: element.dataset.rank, model: element.dataset.element,
      rarity: element.style.getPropertyValue('--rank-color'), aura: element.style.getPropertyValue('--element-color')
    })));
    const sameModel = cards.flatMap((a, index) => cards.slice(index + 1).filter(b => a.model === b.model && a.rank !== b.rank).map(b => [a, b]));
    assert(sameModel.length, 'ten sequential model IDs exercise the same model at independent ranks');
    for (const [a, b] of sameModel) { assert.equal(a.aura, b.aura); assert.notEqual(a.rarity, b.rarity); }

    // Observe actual drawing, not presentation labels: result canvases must use
    // native transparent actor frames and stop spending work when out of view.
    await p.evaluate(() => {
      window.revealModelDraws = [];
      const drawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
        if (this.canvas.closest?.('.cinematic-model')) {
          revealModelDraws.push({ model: source.characterAnimation?.model, state: source.characterAnimation?.state, phase: source.characterAnimation?.phase });
        }
        return drawImage.call(this, source, ...args);
      };
    });
    await p.waitForTimeout(650);
    const modelDraws = await p.evaluate(() => revealModelDraws);
    assert(modelDraws.length >= 10 && modelDraws.length <= 90, 'shared actor loop draws changed frames within its capped budget');
    assert(modelDraws.every(frame => frame.state === 'idle' && Number.isInteger(frame.model)), 'results draw the existing character idle models, never portrait images');
    assert(new Set(modelDraws.map(frame => frame.phase)).size > 1, 'native idle poses animate');
    await p.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      revealModelDraws.length = 0;
    });
    await p.waitForTimeout(250);
    assert.equal(await p.evaluate(() => revealModelDraws.length), 0, 'hidden reveal stops model drawing');
    await p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });

    for (const [label, width, height, minColumns, maxColumns] of [
      ['desktop', 1440, 1000, 5, 5], ['tablet', 900, 1100, 3, 4], ['mobile', 390, 844, 2, 2], ['small-mobile', 320, 640, 2, 2]
    ]) {
      await p.setViewportSize({ width, height });
      await p.waitForTimeout(100);
      const geometry = await p.locator('#summonReveal').evaluate(dialog => {
        const grid = dialog.querySelector('.reveal-grid');
        const cells = [...grid.querySelectorAll('[data-reveal]')].map(card => card.getBoundingClientRect());
        return {
          horizontalOverflow: dialog.scrollWidth > dialog.clientWidth + 1 || grid.scrollWidth > grid.clientWidth + 1,
          columns: cells.filter(rect => Math.abs(rect.top - cells[0].top) < 2).length,
          rows: new Set(cells.map(rect => Math.round(rect.top))).size,
          cards: cells.filter(rect => rect.width > 0 && rect.height > 0).length,
          portraits: [...grid.querySelectorAll('canvas')].filter(canvas => canvas.closest('.cinematic-portrait')).map(canvas => ({ width: canvas.width, height: canvas.height })),
          buttonHeight: dialog.querySelector('#revealContinue').getBoundingClientRect().height
        };
      });
      assert.equal(geometry.horizontalOverflow, false, label + ' has no horizontal overflow');
      assert(geometry.columns >= minColumns && geometry.columns <= maxColumns, label + ' uses the requested column count');
      if (label === 'desktop') assert.equal(geometry.rows, 2, 'ten results use a 5×2 desktop grid');
      assert.equal(geometry.cards, 10, label + ' keeps every real result available');
      assert(geometry.portraits.every(canvas => canvas.width > 0 && canvas.height > 0));
      assert(geometry.buttonHeight >= 44, label + ' has a usable touch target');
      await p.screenshot({ path: path.join(output, 'summon-results-' + label + '.png'), scale: 'css' });
    }
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.waitForTimeout(50);
    assert.equal(await p.locator('#summonReveal').evaluate(dialog => dialog.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0, 'reduced motion stops all reveal/ambient effects');
    await p.evaluate(() => { revealModelDraws.length = 0; });
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => revealModelDraws.length), 0, 'reduced motion keeps a static model without a drawing loop');
    await p.locator('#revealAgain').click();
    await p.waitForSelector('#tokenCheckoutDialog[open]');
    assert.equal(count(f, 'quote'), 3, 'Summon Again obtains a fresh native checkout quote');
    assert.equal(count(f, 'purchase'), 1, 'Summon Again still requires explicit payment confirmation');
    assert.equal(f.balance, 745000);
    await p.locator('#checkoutCancel').click();
    await p.waitForSelector('#tokenCheckoutDialog', { state: 'hidden' });
    assert.equal(await p.evaluate(() => S.v2.revealBatch.length), 0, 'Continue in Summon Again uses native reveal cleanup');
    // Existing single-summon quantity is still supported, including reduced motion.
    await p.evaluate(() => { Combat.quantity(1); Combat.summonBatch(); });
    await p.waitForSelector('#tokenCheckoutDialog[open]');
    await p.locator('#checkoutConfirm').click();
    await p.waitForSelector('#summonReveal[open]');
    await p.waitForFunction(() => S.v2.revealBatch.length === 1 && !RyoPayments.state.busy);
    f.quoteError = true;
    const motionResult = await p.evaluate(async () => {
      const started = performance.now();
      await Experience.reveal(0);
      return { elapsed: performance.now() - started, revealed: S.v2.revealBatch[0].revealed,
        animations: document.querySelector('#summonReveal').getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length };
    });
    assert(motionResult.revealed);
    assert(motionResult.elapsed < 200, 'reduced-motion opening does not wait for cinematic timers');
    assert.equal(motionResult.animations, 0);
    await p.waitForFunction(() => document.querySelector('.cinematic-cost')?.textContent === 'Cost shown at checkout');
    assert.equal(count(f, 'purchase'), 2, 'a failed price lookup has no purchase side effects');
    await p.locator('#revealContinue').click();
    await p.waitForSelector('#summonReveal', { state: 'hidden' });
    assert.equal(await p.evaluate(() => S.v2.revealBatch.length), 0);
    assert.equal(await p.locator('#summonReveal').evaluate(dialog => dialog.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0, 'closed reveal has no running presentation animations');
    await p.emulateMedia({ reducedMotion: 'no-preference' });
    await p.evaluate(() => { revealModelDraws.length = 0; });
    await p.waitForTimeout(250);
    assert.equal(await p.evaluate(() => revealModelDraws.length), 0, 'closed reveal cannot restart the model loop');
    assert.equal(await p.evaluate(() => tab), 2, 'Continue returns to the original shrine');
    assert.equal(count(f, 'purchase'), 2, 'Continue never triggers another purchase');
    assert.equal(f.balance, 719500, 'single summon retains its existing price and fee');
    assert.deepEqual(errors, []);
    console.log('PASS: actual checkout, duplicate guards, Reveal One/All/Skip, refresh/disconnect recovery, first-model NEW badges, rank stars, quoted cost, native animated result models, stopped hidden/closed/reduced-motion loops, responsive layout and independent element/rank styling.');
  });

  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.purchaseError = true;
    await ready(p); await login(p);
    const before = await snapshot(p);
    await p.evaluate(() => { go(2); Combat.quantity(10); Combat.summonBatch(); });
    await p.waitForSelector('#tokenCheckoutDialog[open]');
    await p.locator('#checkoutConfirm').click();
    await p.waitForFunction(() => !RyoPayments.state.busy && document.querySelector('#toast').textContent.includes('No Ryo was charged'));
    assert.deepEqual(await snapshot(p), before, 'failed summon preserves balance, inventory and pending results');
    assert.equal(f.purchases.length, 0);
    assert.equal(await p.locator('#summonReveal[open]').count(), 0, 'failed request never fabricates a reveal');
    assert.equal(count(f, 'purchase'), 1);
    assert.deepEqual(errors, []);
    console.log('PASS: failed summon surfaces the native error without fabricated results, inventory changes or deductions.');
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
