/* Work All (owner decision 2026-11-10): deploys only battle-ready heroes with at least 30% of their max chakra (strongest
 * first, up to 10); with none ready it says so. Manual placement is unchanged. Isolated fixtures only. */
const { withGame } = require('./harness.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.Experience?.workAll && S.h.length >= 2 && window.BattleRoster);
    assert.equal(await p.evaluate(() => CombatRules.WORK_ALL_MIN), 0.3);
    const run = shares => p.evaluate(shares => {
      const list = BattleRoster.list();
      list.forEach((h, i) => { h.on = false; h.x = -9; h.y = -9; h.nap = 0; h.en = CombatRules.maxChakra(h) * shares[i % shares.length]; });
      Experience.workAll();
      return list.map(h => ({ share: Math.round(h.en / CombatRules.maxChakra(h) * 1000) / 1000, on: !!h.on }));
    }, shares);
    // Mixed roster: only heroes at or above 30% go to work.
    const mixed = await run([0.5, 0.29, 0.3, 0.05, 1]);
    assert(mixed.length >= 2, 'fixture has battle-ready heroes');
    for (const h of mixed) assert.equal(h.on, h.share >= 0.3, 'Work All deploys a hero only at 30% chakra or more: ' + JSON.stringify(h));
    assert(mixed.filter(h => h.on).length <= 10, 'at most 10 deployed');
    // Nobody ready: nobody deployed, and the player is told why.
    const none = await run([0.29, 0.1, 0]);
    assert(none.every(h => !h.on), 'no hero below 30% is deployed');
    await p.waitForFunction(() => /No hero has 30% chakra yet/.test(document.body.innerText));
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Work All deploys only battle-ready heroes with at least 30% chakra (strongest first, up to 10) and says so when none are ready.');
})().catch(error => { console.error(error); process.exitCode = 1; });
