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
  console.log('PASS: each defeat fetches the verified Chest within seconds (throttled), the Chest and Session gained count up live, and the banner reads SESSION GAINED.');
})().catch(error => { console.error(error); process.exitCode = 1; });
