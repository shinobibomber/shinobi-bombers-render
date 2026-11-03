/* Defeating an enemy fetches the server-verified Chest right away; the header Chest and the
 * Adventure "Session gained" banner follow it live. Isolated fixtures only. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    const heroes = Array.from({ length: 4 }, (_, i) => ({ tokenId: 'live-' + i, rank: 4, level: 10, name: 'Live ' + i, baseStats: { pw: 15, sp: 15, st: 15 } }));
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId) });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    await p.evaluate(() => { go(0); Experience.workAll(); });
    await p.waitForFunction(() => WebsiteDesign.current() === 'adventure' && AdventureChest.snapshot.chest?.pending === 12345);
    const label = () => p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on .sbw-cover')].some(e => e.textContent === 'SESSION GAINED'));
    assert.equal(await label(), true, 'the banner reads SESSION GAINED, not POTENTIAL REWARD');

    // The server credits the Chest; a defeated enemy must bring it in without the 15s poll.
    const before = f.requests.filter(r => r.action === 'adventure').length;
    f.pendingChest = 12345 + 812;
    await p.evaluate(() => dispatchEvent(new CustomEvent('shinobi-enemy-defeated', { detail: { kind: 5, reward: 812.5 } })));
    await p.waitForFunction(() => AdventureChest.snapshot.chest?.pending === 13157, null, { timeout: 4000 });
    assert.equal(f.requests.filter(r => r.action === 'adventure').length, before + 1, 'one sync per defeat burst');
    await p.waitForFunction(() => document.querySelector('.sbw-hdr .sbw-chest')?.textContent === 'Chest : 13,157', null, { timeout: 3000 });
    await p.waitForFunction(() => [...document.querySelectorAll('.sbw-scr.on .lv')].some(e => e.textContent === '+812 Ryo'), null, { timeout: 3000 });

    // A burst of defeats is throttled to one more sync, not one per enemy.
    f.pendingChest = 13157 + 400;
    const mid = f.requests.filter(r => r.action === 'adventure').length;
    await p.evaluate(() => { for (let i = 0; i < 10; i++) dispatchEvent(new CustomEvent('shinobi-enemy-defeated', { detail: { kind: 2, reward: 35.6 } })); });
    await p.waitForFunction(() => AdventureChest.snapshot.chest?.pending === 13557, null, { timeout: 5000 });
    assert.equal(f.requests.filter(r => r.action === 'adventure').length, mid + 1, 'ten defeats cause one throttled sync');
    await p.waitForFunction(() => [...document.querySelectorAll('.sbw-scr.on .lv')].some(e => e.textContent === '+1,212 Ryo'), null, { timeout: 3000 });

    // The real battle dispatches the event when an enemy falls.
    await p.evaluate(() => { window.__defeats = 0; addEventListener('shinobi-enemy-defeated', () => window.__defeats++); });
    await p.waitForFunction(() => window.__defeats > 0, null, { timeout: 30000 });
    assert.deepEqual(errors, []);
  });
  // End to end with the real server Adventure code: every kill the battle makes is credited, and
  // the Chest equals the sum of the "+X Ryo" rewards shown over the defeated enemies.
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.realAdventure = { rate: 60 };
    const heroes = [0, 1, 2, 3, 4].map(i => ({ tokenId: 'e2e-' + i, rank: i, level: 1, name: 'E ' + i, baseStats: { pw: [2, 4.5, 7.5, 10.5, 13.5][i], sp: [2, 4.5, 7.5, 10.5, 13.5][i], st: [2, 4.5, 7.5, 10.5, 13.5][i] } }));
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId) });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    await p.evaluate(() => { go(0); Experience.workAll(); window.__k = []; addEventListener('shinobi-enemy-defeated', e => { if (e.detail.kind <= 5) __k.push(e.detail); }); });
    await p.waitForFunction(() => __k.length >= 12, null, { timeout: 90000 });
    // Stop the battle so no kill lands after the comparison, then let the final sync settle.
    await p.evaluate(() => Experience.restAll());
    await p.waitForTimeout(1500);
    await p.waitForFunction(() => KillReport.pending === 0 && !AdventureChest.snapshot.busy, null, { timeout: 10000 });
    await p.waitForTimeout(1000);
    const r = await p.evaluate(() => ({ kills: __k.length, shown: __k.reduce((n, e) => n + e.reward, 0), chest: AdventureChest.snapshot.chest.pending }));
    assert.equal(f.advData.reportedKills, r.kills, `every defeated enemy is credited by the server (bank ${Math.round(f.advData.reportBudget || 0)} HP)`);
    assert(Math.abs(r.chest - r.shown) < 1, `the Chest (${r.chest}) equals the rewards shown over the enemies (${r.shown})`);
    assert.deepEqual(errors, []);
  });
  console.log('PASS: each defeat fetches the verified Chest within seconds (throttled), the Chest and Session gained count up live, the banner reads SESSION GAINED, and the server credits every battle kill (Chest = rewards shown).');
})().catch(error => { console.error(error); process.exitCode = 1; });
