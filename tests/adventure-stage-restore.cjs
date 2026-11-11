'use strict';
/* Owner report 2026-11-11: "some players get back to stage 1 of adventurers map". The Adventure stage the game plays (S.map) was
 * only in this browser's save; a new device/browser or cleared site data started at stage 1 while the server kept the verified
 * stage. After sign-in the game adopts the owner's verified Chest stage when it is higher, never a lower one, and only for the
 * signed-in account. */
const { withGame } = require('./harness.cjs');
const login = async p => { await p.locator('#loginPhantom').click(); await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active); };
(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    // Fresh browser (local stage 1), server verified stage 7.
    f.holdAdventure = false; f.chestMap = 7;
    assert.equal(await p.evaluate(() => S.map), 1, 'a fresh browser starts at stage 1');
    await login(p); await p.evaluate(() => AdventureChest.refresh());
    await p.waitForFunction(() => S.map === 7, null, { timeout: 15000 });
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('shinobi-bombers-v1')).map), 7, 'the restored stage is saved');
    // Never lowered: a local stage above the server's (cleared just now, not yet reported) stays.
    await p.evaluate(() => { S.map = 9; save(); }); f.chestMap = 7; await p.evaluate(() => AdventureChest.refresh()); await p.waitForTimeout(500);
    assert.equal(await p.evaluate(() => S.map), 9, 'a higher local stage is never taken backwards');
    // Later progress on another device is adopted on the next sync.
    f.chestMap = 12; await p.evaluate(() => AdventureChest.refresh()); await p.waitForFunction(() => S.map === 12, null, { timeout: 15000 });
    // Garbage from the server is ignored.
    f.chestMap = 'x'; await p.evaluate(() => AdventureChest.refresh()); await p.waitForTimeout(400);
    assert.equal(await p.evaluate(() => S.map), 12, 'an invalid server stage is ignored');
    // Signed out: nothing is adopted.
    await p.evaluate(() => BetaWallet.disconnect()); await p.waitForFunction(() => !RyoPayments.state.authenticated);
    await p.evaluate(() => { S.map = 2; window.dispatchEvent(new Event('shinobi-chest')); }); await p.waitForTimeout(400);
    assert.equal(await p.evaluate(() => S.map), 2, 'no stage is adopted while signed out');
    assert.deepEqual(errors, []);
    console.log('PASS: Adventure stage restore — a fresh browser adopts the verified stage after sign-in (saved), never lowers a higher local stage, follows later progress, ignores invalid values and signed-out events.');
  });
})().catch(e => { console.error(e); process.exitCode = 1; });
