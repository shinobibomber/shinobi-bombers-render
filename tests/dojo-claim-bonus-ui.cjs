/* Dojo Chest Claim Limit Bonus in the real game page (owner request 2026-11-11), driven by the server's claim details: the Dojo
 * upgrades screen (CHEST CLAIM column +0..+600,000, current bonus, next-tier preview with the allowance; since 2026-11-11 the
 * bonus sits on top of the per-claim maximum, so there is no ceiling note), nothing changes while no base allowance is approved, the Chest "Claim details" section (Dojo tier,
 * base, bonus, personal allowance, available, budget note, View Dojo upgrades), and the notice after a confirmed Dojo
 * upgrade. Isolated fixture. */
const assert = require('node:assert/strict'), path = require('node:path'), { withGame } = require('./harness.cjs');
const root = path.resolve(__dirname, '..');
const allowance = (tier, extra = {}) => ({ active: true, dojoTier: tier, dojoBonusRyo: tier * 100000, bonusPerTierRyo: 100000, baseAllowanceRyo: 500000, personalAllowanceRyo: 500000 + tier * 100000, hardCeilingRyo: 1100000, dailyRemainingRyo: 5000000, effectiveRyo: 500000 + tier * 100000, limitedBy: 'personal', ...extra });
(async () => {
  await withGame(async ({ p, f, errors }) => {
    f.holdAdventure = false; f.profile.dojo = 3; f.pendingChest = 750000; f.pool = 5000000; f.claimAllowance = allowance(3);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    await p.evaluate(() => AdventureChest.refresh());
    await p.waitForFunction(() => AdventureChest.snapshot.chest?.claimAllowance?.active);
    // Dojo upgrades screen.
    await p.evaluate(() => WebsiteDesign.open('dojo-upg')); await p.waitForFunction(() => WebsiteDesign.current() === 'dojo-upg');
    await p.waitForFunction(() => /CHEST CLAIM/.test(document.querySelector('.sbw-scr.on .sbw-dclaimh:not([hidden])')?.textContent || ''));
    const view = await p.evaluate(() => ({ col: [...document.querySelectorAll('.sbw-scr.on .sbw-dclaim')].map(e => e.textContent), mid: document.querySelector('.sbw-scr.on .sbw-dmid').textContent, lbl: document.querySelector('.sbw-scr.on .sbw-dmidl').textContent, prev: document.querySelector('.sbw-scr.on .sbw-dprev').textContent }));
    assert.deepEqual(view.col, ['+0', '+100,000', '+200,000', '+300,000', '+400,000', '+500,000', '+600,000'], 'CHEST CLAIM column per tier');
    assert.deepEqual([view.mid, view.lbl], ['+300,000', 'Chest Claim Bonus'], 'current bonus in the left card');
    assert.match(view.prev, /Chest Claim Bonus: \+300,000 → \+400,000 Ryo at Tier IV \(\+100,000\)\. Claim allowance after the upgrade: 900,000 Ryo per claim\. Chakra recovery unchanged\./);
    const fits = await p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on .sbw-dprev, .sbw-scr.on .sbw-dclaim, .sbw-scr.on .sbw-dclaimh, .sbw-scr.on .sbw-dmid, .sbw-scr.on .sbw-dmid b')].every(e => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1));
    assert.equal(fits, true, 'texts fit their covers');
    await p.screenshot({ path: path.join(root, 'tests/out/dojo-claim-bonus.png') });
    // No base allowance approved: the screen is exactly the artwork again.
    f.claimAllowance = { active: false, dojoTier: 3, dojoBonusRyo: 300000, bonusPerTierRyo: 100000, reason: 'budget' }; await p.evaluate(() => AdventureChest.refresh());
    await p.waitForFunction(() => [...document.querySelectorAll('.sbw-scr.on .sbw-dclaimh, .sbw-scr.on .sbw-dclaim, .sbw-scr.on .sbw-dprev')].every(e => e.hidden));
    // Chest claim details.
    f.claimAllowance = allowance(3); await p.evaluate(() => AdventureChest.refresh());
    await p.evaluate(() => GlobalChestUI.open());
    await p.waitForFunction(() => document.querySelector('[data-gc-claim-details]'));
    const details = (await p.locator('[data-gc-claim-details]').innerText()).replace(/\s+/g, ' ');
    assert.match(details, /Chest Claim Details Dojo Bonus Dojo Veteran Dojo — Tier III Base allowance 500,000 Ryo Dojo bonus \+300,000 Ryo Personal allowance 800,000 Ryo Unclaimed Chest 750,000 Ryo Available to claim 750,000 Ryo Next claim Ready/i);
    await p.screenshot({ path: path.join(root, 'tests/out/dojo-claim-details.png') });
    f.claimAllowance = allowance(3, { dailyRemainingRyo: 200000, effectiveRyo: 200000, limitedBy: 'budget' }); await p.evaluate(() => AdventureChest.refresh());
    await p.waitForFunction(() => /approved reward budget limits this claim to 200,000 Ryo\. Your remaining rewards stay safely recorded in your Chest\./.test(document.querySelector('[data-gc-claim-details]')?.textContent || ''));
    assert.match(await p.locator('[data-gc-claim-details]').innerText(), /Available to claim\s*200,000 Ryo/);
    await p.locator('[data-gc-claim-details] .gc-claim-dojo').click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'dojo-upg' && !document.querySelector('[data-gc-claim-details]'));
    // Notice after a confirmed Dojo upgrade (the server profile shows the new tier).
    f.claimAllowance = allowance(4); f.profile.dojo = 4; await p.evaluate(() => AdventureChest.refresh()); await p.evaluate(() => RyoPayments.refresh());
    await p.waitForFunction(() => /DOJO UPGRADE COMPLETE!/.test(document.querySelector('dialog.sbw-dialog[open]')?.textContent || ''));
    assert.match((await p.locator('dialog.sbw-dialog[open]').innerText()).replace(/\s+/g, ' '), /Your Dojo is now Tier IV\. Chest Claim Bonus: \+400,000 Ryo\. Your personal Chest claim allowance has increased, subject to reward-pool funding and today's approved budget\./);
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Dojo claim bonus UI — CHEST CLAIM column +0..+600,000, current bonus, next-tier preview with allowance (no ceiling note), unchanged when no base is approved, Chest claim details (tier, base, bonus, personal, available, budget note, View Dojo upgrades), notice after a confirmed upgrade.');
})().catch(e => { console.error(e); process.exitCode = 1; });
