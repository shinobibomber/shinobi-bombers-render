/* Starter Activation in the real game page (owner request 2026-11-11), driven by the server's `starter` view: the welcome notice
 * (10 Genin, 1/1/1, 50%), the SHINOBI ACTIVATION card on the main menu (paid summons N / 15, bar, 50% → 100%, "N MORE PAID
 * SUMMONS TO ACTIVATE!", Open Summoning Shrine) and the Shrine, never over the CLAIM/Support button, progress / almost /
 * complete notices once each, the Chest section, nothing for normal accounts, phone fit. Isolated fixture. */
const assert = require('node:assert/strict'), path = require('node:path'), { withGame } = require('./harness.cjs');
const root = path.resolve(__dirname, '..');
const view = (paid, state = 'active') => ({ state, paidSummons: paid, target: 15, remaining: 15 - paid, ratePercent: state === 'active' ? 50 : 100, completedAt: state === 'complete' ? Date.now() : null });
const dialogText = p => p.evaluate(() => document.querySelector('dialog.sa-dialog[open]')?.innerText.replace(/\s+/g, ' ') || '');
(async () => {
  await withGame(async ({ p, f, errors }) => {
    f.holdAdventure = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.StarterActivation);
    await p.evaluate(() => go(5)); await p.waitForFunction(() => WebsiteDesign.current() === 'home');
    // A normal account: nothing.
    await p.evaluate(() => AdventureChest.refresh()); await p.waitForTimeout(600);
    assert.equal(await p.locator('.sa-card:not([hidden])').count(), 0, 'no card for normal accounts');
    // New starter account: welcome notice.
    f.starter = view(0); await p.evaluate(() => AdventureChest.refresh());
    await p.waitForFunction(() => /WELCOME TO SHINOBI BOMBERS!/.test(document.querySelector('dialog.sa-dialog[open]')?.textContent || ''));
    assert.match(await dialogText(p), /10 FREE GENIN HEROES!.*Power 1, Speed 1 and Stamina 1.*initial enemy reward rate is 50%.*15 paid Summoning Shrine summons/);
    await p.locator('dialog.sa-dialog button').click();
    // Progress card on the main menu.
    f.starter = view(8); await p.evaluate(() => AdventureChest.refresh());
    await p.waitForFunction(() => /8 \/ 15 paid summons/.test(document.querySelector('dialog.sa-dialog[open]')?.textContent || ''));
    await p.locator('dialog.sa-dialog button').click();
    await p.waitForFunction(() => !document.querySelector('.sa-card')?.hidden);
    const card = (await p.locator('.sa-card').innerText()).replace(/\s+/g, ' ');
    assert.match(card, /SHINOBI ACTIVATION Paid Summons 8 \/ 15 Enemy Reward Rate 50% → 100% 7 MORE PAID SUMMONS TO ACTIVATE! Open Summoning Shrine/);
    const overlap = await p.evaluate(() => { const a = document.querySelector('.sa-card').getBoundingClientRect(), b = document.querySelector('.sbw-scr.on [data-sbwid="sup"]').getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; });
    assert.equal(overlap, false, 'never over the CLAIM/Support button');
    await p.screenshot({ path: path.join(root, 'tests/out/starter-activation.png') });
    await p.locator('.sa-card button').click(); await p.waitForFunction(() => WebsiteDesign.current() === 'summon');
    await p.waitForFunction(() => !document.querySelector('.sa-card')?.hidden && !document.querySelector('.sa-card button'));
    // Chest section.
    await p.evaluate(() => GlobalChestUI.open()); await p.waitForFunction(() => document.querySelector('[data-gc-starter]'));
    assert.match((await p.locator('[data-gc-starter]').innerText()).replace(/\s+/g, ' '), /Shinobi Activation Paid summons 8 \/ 15 Enemy reward rate 50% → 100% To activate 7 more paid summons/i);
    await p.evaluate(() => GlobalChestUI.close());
    // Almost, then complete.
    f.starter = view(14); await p.evaluate(() => AdventureChest.refresh());
    await p.waitForFunction(() => /ALMOST ACTIVATED!/.test(document.querySelector('dialog.sa-dialog[open]')?.textContent || ''));
    await p.locator('dialog.sa-dialog button').click();
    f.starter = view(15, 'complete'); await p.evaluate(() => AdventureChest.refresh());
    await p.waitForFunction(() => /SHINOBI ACTIVATION COMPLETE!/.test(document.querySelector('dialog.sa-dialog[open]')?.textContent || ''));
    assert.match(await dialogText(p), /100% NORMAL ENEMY REWARDS UNLOCKED!/);
    await p.locator('dialog.sa-dialog button').click();
    await p.waitForTimeout(400); assert.equal(await p.locator('.sa-card:not([hidden])').count(), 0, 'no card once activated');
    await p.evaluate(() => AdventureChest.refresh()); await p.waitForTimeout(600);
    assert.equal(await p.locator('dialog.sa-dialog[open]').count(), 0, 'notices never repeat');
    assert.deepEqual(errors, []);
  });
  await withGame(async ({ p, f, errors }) => {
    f.holdAdventure = false; f.starter = view(3);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !LoginScreen.active && window.WebsiteDesign?.ready && window.StarterActivation);
    await p.evaluate(() => AdventureChest.refresh());
    await p.waitForFunction(() => document.querySelector('dialog.sa-dialog[open]')); await p.locator('dialog.sa-dialog button').click();
    await p.waitForFunction(() => document.querySelector('dialog.sa-dialog[open]') || !document.querySelector('.sa-card')?.hidden);
    if (await p.locator('dialog.sa-dialog[open]').count()) await p.locator('dialog.sa-dialog button').click();
    await p.waitForFunction(() => !document.querySelector('.sa-card')?.hidden);
    const fit = await p.locator('.sa-card').evaluate(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight; });
    assert.equal(fit, true, 'phone: the card fits');
    await p.screenshot({ path: path.join(root, 'tests/out/starter-activation-phone.png') });
    assert.deepEqual(errors, []);
  }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  console.log('PASS: Starter Activation UI — welcome / progress / almost / complete notices once each, SHINOBI ACTIVATION card on the main menu and the Shrine (not over CLAIM/Support), Chest section, nothing for normal accounts, phone fit.');
})().catch(e => { console.error(e); process.exitCode = 1; });
