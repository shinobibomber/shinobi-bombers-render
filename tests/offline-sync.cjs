/* Go offline keeps the last in-flight defeats (bug 2026-11-11, found by diagnosing the intermittent live-rewards failure).
 * While the game waits for bombs still in flight, a background Chest sync used to be sent as "offline" first; the server then
 * stopped crediting kills, so a defeat landing a moment later was lost. Now, while leaving, background syncs keep the player's
 * state until the go-offline report itself (active:false) is sent; every report after that stays offline (so nothing can mark the
 * player online again and stop offline Sensei time). Cancelling or a new go-offline resets it. Isolated fixture, no wallet. */
const { withGame } = require('./harness.cjs');
(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active);
    const sent = async call => { const before = f.requests.filter(r => r.action === 'adventure').length; await p.evaluate(call); await p.waitForFunction(n => true, before); const rows = f.requests.filter(r => r.action === 'adventure'); assert(rows.length > before, 'a report was sent'); return rows.at(-1).active; };
    // Leaving: a background sync still reports the player as active (kills in flight are credited).
    await p.evaluate(() => { window.__leave = CombatClient.beginOffline(); });
    assert.equal(await p.evaluate(() => CombatClient.leaving), true);
    assert.equal(await sent(() => RyoPayments.adventure(true, false)), true, 'a background sync while leaving keeps the player active');
    // The go-offline report itself marks the player offline...
    assert.equal(await sent(() => RyoPayments.adventure(false, false)), false, 'the go-offline report is offline');
    // ...and every later report stays offline, even a background sync asking for active.
    assert.equal(await sent(() => RyoPayments.adventure(true, false)), false, 'after the go-offline report nothing marks the player online again');
    // Cancelling (e.g. the save failed and the player stays) returns to normal.
    await p.evaluate(() => CombatClient.cancelOffline());
    assert.equal(await sent(() => RyoPayments.adventure(true, false)), true, 'after cancelling, normal active reports again');
    // A new go-offline starts fresh.
    await p.evaluate(() => { window.__leave = CombatClient.beginOffline(); });
    assert.equal(await sent(() => RyoPayments.adventure(true, false)), true, 'a new go-offline starts fresh');
    await p.evaluate(() => CombatClient.cancelOffline());
    assert.deepEqual(errors, []);
  });
  console.log('PASS: go offline — background syncs keep the player active until the go-offline report, then stay offline; cancel and a new go-offline reset it (no in-flight defeat lost, no accidental re-activation).');
})().catch(e => { console.error(e); process.exitCode = 1; });
