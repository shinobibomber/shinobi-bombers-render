/* Sensei auto-deploy: an active (hired or rented) Sensei fills empty battle slots with rested
 * battle-ready heroes, swaps every hero that ran out of chakra, leaves heroes the player rested by
 * hand on the bench, and does nothing while switched off. Isolated fixtures only. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');

const hero = (i, rank) => ({ tokenId: 'sr-' + i, rank, level: 1, name: 'Ninja' + i + ' Test', baseStats: { pw: 2 + rank * 3, sp: 2 + rank * 3, st: 2 + rank * 3 } });
const login = async p => {
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
};
const state = p => p.evaluate(() => ({ on: S.h.filter(h => h.on).length, ids: S.h.filter(h => h.on).map(h => h.tokenId).sort() }));
const setup = (f, mode, enabled = true) => {
  f.holdAdventure = false;
  const heroes = Array.from({ length: 12 }, (_, i) => hero(i, i < 4 ? 2 : 0));
  f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId), sensei: mode === 'hired', senseiRentalUntil: mode === 'rented' ? Date.now() + 3 * 864e5 : 0, senseiEnabled: enabled });
};

(async () => {
  for (const mode of ['rented', 'hired']) await withGame(async ({ p, f, errors, assert }) => {
    setup(f, mode);
    await login(p);
    // Nothing is deployed after sign-in; the Sensei fills all 10 slots, strongest first.
    await p.waitForFunction(() => S.h.filter(h => h.on).length === 10, null, { timeout: 8000 });
    const first = await state(p);
    assert(['sr-0', 'sr-1', 'sr-2', 'sr-3'].every(id => first.ids.includes(id)), mode + ': the Jonin are deployed first');
    assert.match(await p.evaluate(() => document.getElementById('toast').textContent), /Sensei deployed \d+ heroes/);
    // Two deployed heroes run out of chakra: both are swapped for the two rested heroes in one pass.
    const tired = await p.evaluate(() => { const out = S.h.filter(h => h.on && h.x >= 0).slice(-2); out.forEach(h => { h.en = 0; }); return out.map(h => h.tokenId); });
    await p.waitForFunction(ids => ids.every(id => !S.h.find(h => h.tokenId === id).on) && S.h.filter(h => h.on).length === 10, tired, { timeout: 6000 });
    // A hero the player rests by hand stays on the bench while it has full chakra.
    const benched = await p.evaluate(() => { const i = S.h.findIndex(h => h.on && h.en >= h.st * 50 * .9); const id = S.h[i].tokenId; tog(i); return id; });
    await p.evaluate(() => { const rest = S.h.filter(h => !h.on); rest.forEach(h => { h.en = h.st * 50; }); });
    await p.waitForTimeout(4500);
    assert.equal(await p.evaluate(id => S.h.find(h => h.tokenId === id).on, benched), false, mode + ': a hero rested by hand is not redeployed');
    assert.deepEqual(errors, []);
  });
  // Sensei switched off: nothing is deployed automatically.
  await withGame(async ({ p, f, errors, assert }) => {
    setup(f, 'rented', false);
    await login(p);
    await p.waitForTimeout(5000);
    assert.equal((await state(p)).on, 0, 'a Sensei that is OFF deploys nobody');
    assert.deepEqual(errors, []);
  });
  console.log('PASS: an active hired or rented Sensei fills empty slots strongest-first, swaps every exhausted hero, keeps heroes rested by hand on the bench, and stays idle when switched off.');
})().catch(error => { console.error(error); process.exitCode = 1; });
