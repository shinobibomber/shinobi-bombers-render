/* Server-owned hero identity: a token hero's perks and look come from the server, so two devices
 * (fresh browsers, separate saves) show the same perks and the same character model. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');

const heroes = [0, 2, 4].map((rank, i) => ({ tokenId: 'id-' + i, rank, level: 1, name: 'Ident' + i + ' Test', baseStats: { pw: 2 + rank * 3, sp: 2 + rank * 3, st: 2 + rank * 3 } }));
const profile = economy.normalizeProfile({ ...economy.initialProfile(), heroes: structuredClone(heroes), battleReady: heroes.map(h => h.tokenId) });
const seen = [];

(async () => {
  for (let device = 0; device < 2; device++) await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.profile = structuredClone(profile);
    // A different local id sequence per device: identity must not depend on it.
    if (device) await p.evaluate(() => { S.nid += 37; for (let i = 0; i < 5; i++) S.h.push(mk(0, false)); save(); });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    seen.push(await p.evaluate(ids => ids.map(id => { const h = S.h.find(h => h.tokenId === id); return { pk: h.pk, look: h.look, model: PlayerModels.modelFor(h).index }; }), heroes.map(h => h.tokenId)));
    assert.deepEqual(errors, []);
  });
  const assert = require('node:assert/strict');
  const expected = profile.heroes.map(h => ({ pk: h.perks, look: h.look, model: h.look }));
  assert.deepEqual(seen[0], expected, 'the game uses the server perks and look');
  assert.deepEqual(seen[1], seen[0], 'a second device shows the same perks and character');
  profile.heroes.forEach(h => assert.equal(h.perks.length, h.rank + 1, 'perk count follows rank'));
  console.log('PASS: token heroes show server-owned perks and look, identical on every device.');
})().catch(error => { console.error(error); process.exitCode = 1; });
