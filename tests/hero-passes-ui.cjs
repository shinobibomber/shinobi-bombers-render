/* Main-menu CLAIM + Reward Center in the real game page (owner request 2026-11-11): while the CLAIM switch is off the Support
 * button is unchanged; when on, CLAIM takes Support's exact place (badge = pending rewards), the Reward Center shows the reward
 * from the server (tier name, quantity — not hardcoded, READY TO CLAIM, ACCOUNT-BOUND), claiming shows the confirmation and
 * clears the badge, OPEN HERO PASSES shows the account-bound balance, using a pass reveals the hero, the empty state, Help &
 * Support. Desktop + phone. Isolated fixture (server logic: tests/hero-passes.cjs). */
const assert = require('node:assert/strict'), path = require('node:path'), { withGame } = require('./harness.cjs');
const root = path.resolve(__dirname, '..');
const reward = (id, tierName, passes) => ({ campaignId: id, campaign: 'Loyalty Rewards', tier: tierName.startsWith('Investor') ? 1 : 2, tierName, passes, status: 'pending', assigned: Date.now(), claimedAt: null });
const centerText = p => p.locator('dialog.hp-center[open]').innerText().then(t => t.replace(/\s+/g, ' '));
(async () => {
  await withGame(async ({ p, f, errors }) => {
    f.holdAdventure = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.HeroPasses);
    await p.evaluate(() => go(5)); await p.waitForFunction(() => WebsiteDesign.current() === 'home');
    // Switch off: Support unchanged.
    await p.evaluate(() => HeroPasses.refresh());
    assert.equal(await p.locator('.sbw-scr.on [data-sbwid="sup"] .sbw-claim').isHidden(), true, 'no CLAIM while the switch is off');
    await p.locator('.sbw-scr.on [data-sbwid="sup"]').click();
    await p.waitForFunction(() => /Support/.test(document.querySelector('dialog.sbw-dialog[open]')?.textContent || ''));
    await p.locator('dialog.sbw-dialog[open] button').click();
    // Switch on: CLAIM in Support's place with a badge.
    f.heroPasses = { ui: true, claims: true, pending: [reward('cmp-1', 'Investor Appreciation Reward', 5)], history: [], passes: 0, uses: [] };
    await p.evaluate(() => HeroPasses.refresh());
    await p.waitForFunction(() => !document.querySelector('.sbw-scr.on [data-sbwid="sup"] .sbw-claim')?.hidden);
    const spot = await p.evaluate(() => { const s = document.querySelector('.sbw-scr.on [data-sbwid="sup"]'), c = s.querySelector('.sbw-claim'), a = s.getBoundingClientRect(), b = c.getBoundingClientRect(); return { same: Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1, text: c.innerText.replace(/\s+/g, ' ').trim(), label: s.getAttribute('aria-label') }; });
    assert.deepEqual(spot, { same: true, text: '🎁 CLAIM 1', label: 'Claim rewards, 1 ready' }, 'CLAIM exactly over Support, badge 1');
    await p.screenshot({ path: path.join(root, 'tests/out/hero-pass-claim-button.png') });
    // Reward Center: server quantity and names.
    await p.locator('.sbw-scr.on [data-sbwid="sup"]').click();
    await p.waitForSelector('dialog.hp-center[open]');
    await p.waitForFunction(() => /CLAIM 5 HERO PASSES/.test(document.querySelector('dialog.hp-center[open]')?.textContent || ''));
    assert.match(await centerText(p), /SHINOBI REWARD CENTER.*Loyalty Rewards INVESTOR APPRECIATION REWARD Congratulations, Shinobi! You have received: 5 STANDARD HERO PASSES Status: READY TO CLAIM · Restriction: ACCOUNT-BOUND CLAIM 5 HERO PASSES/);
    await p.screenshot({ path: path.join(root, 'tests/out/hero-pass-center.png') });
    await p.locator('dialog.hp-center button', { hasText: 'CLAIM 5 HERO PASSES' }).click();
    await p.waitForFunction(() => /REWARD CLAIMED SUCCESSFULLY!/.test(document.querySelector('dialog.hp-center[open]')?.textContent || ''));
    assert.match(await centerText(p), /REWARD CLAIMED SUCCESSFULLY! 5 STANDARD HERO PASSES ADDED! Your account-bound passes are now available\. OPEN HERO PASSES/);
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on .sbw-claim-badge')?.hidden === true);
    // Hero Passes: balance, use one, reveal.
    await p.locator('dialog.hp-center').getByRole('button', { name: 'OPEN HERO PASSES', exact: true }).click();
    assert.match(await centerText(p), /ACCOUNT-BOUND STANDARD HERO PASSES 5 Each pass recruits one in-game hero at normal Shrine odds\./);
    assert.equal(await p.locator('dialog.hp-center').getByRole('button', { name: 'Use 10', exact: true }).isDisabled(), true, 'cannot use more than the balance');
    await p.locator('dialog.hp-center').getByRole('button', { name: 'Use 1', exact: true }).click();
    await p.waitForFunction(() => S.v2.revealBatch?.length === 1 && S.v2.revealBatch[0].hero.referralBound === true, null, { timeout: 15000 });
    await p.evaluate(() => { Experience.revealAll(); RevealDesign.skip(); });
    await p.waitForFunction(() => !document.querySelector('#revealContinue')?.disabled); await p.locator('#revealContinue').click();
    assert.equal(f.heroPasses.passes, 4);
    // Any quantity comes from the server (10), and the empty state.
    f.heroPasses.pending.push(reward('cmp-2', 'Community Appreciation Reward', 10)); await p.evaluate(() => HeroPasses.open('rewards'));
    await p.waitForFunction(() => /CLAIM 10 HERO PASSES/.test(document.querySelector('dialog.hp-center[open]')?.textContent || ''));
    await p.locator('dialog.hp-center button', { hasText: 'CLAIM 10 HERO PASSES' }).click();
    await p.waitForFunction(() => /10 STANDARD HERO PASSES ADDED!/.test(document.querySelector('dialog.hp-center[open]')?.textContent || ''));
    await p.locator('dialog.hp-center').getByRole('button', { name: 'Rewards', exact: true }).click();
    assert.match(await centerText(p), /NO REWARDS AVAILABLE You currently have no pending promotional rewards\. Check back for future Shinobi events!/);
    await p.locator('dialog.hp-center').getByRole('button', { name: 'History', exact: true }).click();
    assert.match(await centerText(p), /Loyalty Rewards Community Appreciation Reward · 10 passes Claimed/);
    await p.locator('dialog.hp-center').getByRole('button', { name: 'Help & Support', exact: true }).click();
    assert.match(await centerText(p), /HELP & SUPPORT Open ⚙ Tools in the game header/);
    await p.locator('dialog.hp-center .hp-foot button', { hasText: 'Close' }).click();
    assert.deepEqual(errors, []);
  });
  /* Phone: CLAIM is visible in the bottom row and the Reward Center fits. */
  await withGame(async ({ p, f, errors }) => {
    f.holdAdventure = false; f.heroPasses = { ui: true, claims: true, pending: [reward('cmp-1', 'Investor Appreciation Reward', 5)], history: [], passes: 0, uses: [] };
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !LoginScreen.active && window.WebsiteDesign?.ready && window.HeroPasses);
    await p.evaluate(() => HeroPasses.refresh());
    await p.waitForFunction(() => { const c = document.querySelector('.sbw-scr.on [data-sbwid="sup"] .sbw-claim'); return c && !c.hidden && c.getBoundingClientRect().width > 40; });
    await p.locator('.sbw-scr.on [data-sbwid="sup"]').scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(root, 'tests/out/hero-pass-claim-phone.png') });
    await p.locator('.sbw-scr.on [data-sbwid="sup"]').click();
    await p.waitForSelector('dialog.hp-center[open]');
    assert.equal(await p.locator('dialog.hp-center[open]').evaluate(d => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }), true, 'Reward Center fits the phone');
    assert.deepEqual(errors, []);
  }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  console.log('PASS: Hero Pass UI — Support unchanged while off; CLAIM exactly in Support\'s place with a pending badge; Reward Center (tier name, server quantity, READY TO CLAIM, ACCOUNT-BOUND); claim confirmation; badge clears; Hero Passes balance and use with reveal; quantity 10; empty state; history; Help & Support; phone.');
})().catch(e => { console.error(e); process.exitCode = 1; });
