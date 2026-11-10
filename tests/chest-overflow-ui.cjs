/* Chest Overflow alerts in the real game page (owner request 2026-11-11), driven by the server's `overflow` status: approaching,
 * threshold reached (grace countdown, rate still 100%), penalty active (rate shown, "your earned Ryo is safe", Open Chest /
 * Continue), penalty reduced, full rewards restored; dismissals remembered per account; the "+X Ryo → Chest" estimate
 * (AdventureChest.rewardRate) follows the active penalty; the banner fits a phone. Isolated fixture. */
const assert = require('node:assert/strict'), path = require('node:path'), { withGame } = require('./harness.cjs');
const root = path.resolve(__dirname, '..');
const status = (chestRyo, tierPercent, state, extra = {}) => ({ chestRyo, tierPercent, state, ratePercent: 100, activeFrom: null, claimReadyAt: null, unavailable: null, thresholds: [500000, 750000, 1000000], graceHours: 12, ...extra });
const alertText = p => p.evaluate(() => { const e = document.querySelector('.chest-overflow'); return e && !e.hidden ? e.innerText.replace(/\s+/g, ' ') : ''; });
(async () => {
  await withGame(async ({ p, f, errors }) => {
    f.holdAdventure = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.ChestOverflow && window.AdventureChest);
    const show = async (o, re) => { f.chestOverflow = o; f.pendingChest = o.chestRyo; await p.evaluate(() => AdventureChest.refresh()); await p.waitForFunction(r => new RegExp(r).test(document.querySelector('.chest-overflow:not([hidden])')?.innerText || ''), re.source); return alertText(p); };
    const baseRate = await p.evaluate(() => AdventureChest.rewardRate);
    // 1. Approaching.
    assert.match(await show(status(460000, 0, 'approaching'), /CHEST ALMOST FULL/), /460,000 Ryo.*From 500,000 Ryo, new enemy rewards drop by 10%.*12-hour grace/);
    await p.locator('.chest-overflow .co-close').click();
    await p.evaluate(() => AdventureChest.refresh()); await p.waitForTimeout(400);
    assert.equal(await alertText(p), '', 'a dismissed alert stays dismissed for the same state');
    // 2. Threshold reached, grace running: rate still 100%.
    assert.match(await show(status(620000, 10, 'grace', { activeFrom: Date.now() + 5 * 3600000 - 60000 }), /CHEST OVERFLOW WARNING/), /620,000 Ryo unclaimed\. Current enemy reward rate: 100%\. A −10% penalty on new enemy rewards starts in 4h 5[89]m/);
    assert.equal(await p.evaluate(() => AdventureChest.rewardRate), baseRate, 'no penalty during the grace period');
    // Waiting for the claim timer.
    assert.match(await show(status(620000, 10, 'waiting', { claimReadyAt: Date.now() + 3 * 3600000 }), /CHEST OVERFLOW WARNING/), /Your next claim is ready .*A −10% penalty can start 12 hours after that/);
    // 3. Penalty active (-20%): the estimate follows.
    assert.match(await show(status(800000, 20, 'active', { activeFrom: Date.now() - 1000, ratePercent: 80 }), /−20% ENEMY REWARDS/), /800,000 Ryo, so new enemy rewards pay 80%\. Your earned Ryo is safe\..*Open Chest Continue/);
    assert.equal(await p.locator('.chest-overflow.bad').count(), 1);
    assert.equal(Math.round(await p.evaluate(() => AdventureChest.rewardRate) * 1000), Math.round(baseRate * 0.8 * 1000), '"+X Ryo → Chest" estimate pays 80%');
    await p.screenshot({ path: path.join(root, 'tests/out/chest-overflow-active.png') });
    // 4. Penalty reduced after a claim or a Chest purchase.
    assert.match(await show(status(600000, 10, 'active', { activeFrom: Date.now() - 1000, ratePercent: 90 }), /PENALTY REDUCED/), /−20% → −10%\. New enemy rewards now pay 90%/);
    // 5. Full rewards restored.
    await p.locator('.chest-overflow .co-close').click();
    assert.match(await show(status(300000, 0, 'ok'), /FULL REWARDS RESTORED/), /below 500,000 Ryo\. New enemy rewards pay 100% again/);
    assert.equal(await p.evaluate(() => AdventureChest.rewardRate), baseRate, 'estimate back to 100%');
    await p.locator('.chest-overflow .co-open').click();
    assert.equal(await alertText(p), '', 'Open Chest closes the alert');
    assert.deepEqual(errors, []);
  });
  /* Phone: the banner fits and its buttons are usable. */
  await withGame(async ({ p, f, errors }) => {
    f.holdAdventure = false; f.pendingChest = 1100000; f.chestOverflow = status(1100000, 30, 'active', { activeFrom: Date.now() - 1000, ratePercent: 70 });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !LoginScreen.active && window.ChestOverflow);
    await p.evaluate(() => AdventureChest.refresh());
    await p.waitForFunction(() => /−30% ENEMY REWARDS/.test(document.querySelector('.chest-overflow:not([hidden])')?.innerText || ''));
    const fit = await p.locator('.chest-overflow').evaluate(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && [...e.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 24); });
    assert.equal(fit, true, 'phone: the alert fits with usable buttons');
    await p.screenshot({ path: path.join(root, 'tests/out/chest-overflow-phone.png') });
    assert.deepEqual(errors, []);
  }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  console.log('PASS: Chest Overflow alerts — approaching, threshold reached (grace countdown / claim timer, 100%), penalty active (rate, earned Ryo safe, Open Chest / Continue), penalty reduced, full rewards restored, dismissals remembered, "+X Ryo → Chest" estimate follows the penalty, phone fit.');
})().catch(e => { console.error(e); process.exitCode = 1; });
