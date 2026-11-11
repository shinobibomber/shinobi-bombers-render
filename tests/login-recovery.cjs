/* Sign-in never hangs on "Recovering pending transactions…" (owner reports 2026-11-10 and 2026-11-11: players stayed on
 * that line, one unless on a VPN). Sign-in already loads the verified server state, so the game opens right away and the
 * recovery step (pending deposits, balance refresh) runs in the background; the browser's own Solana check inside it is
 * still limited to 8 s. Isolated fixtures only: the harness wallet
 * and server are in-process fakes; no real wallet, RPC or transaction is used. */
const { withGame } = require('./harness.cjs');
const assert = require('node:assert/strict');

const signIn = p => p.locator('#loginPhantom').click();
const entered = () => RyoPayments.state.authenticated && !LoginScreen.active;

(async () => {
  // 1. The browser check never answers: the game opens right away with the server state; recovery ends in the background.
  await withGame(async ({ p, f, errors }) => {
    await p.waitForFunction(() => window.BetaWallet && window.RyoPayments && window.LoginScreen);
    await p.evaluate(() => { BetaWallet.recoverPending = () => new Promise(() => {}); });
    const t0 = Date.now(); await signIn(p);
    await p.waitForFunction(entered, null, { timeout: 15000 });
    const took = Date.now() - t0;
    assert(took < 5000, 'entered the game without waiting for the recovery step: ' + took + ' ms');
    assert.equal(await p.evaluate(() => document.querySelector('#loginMessage')?.textContent || ''), 'Connect your wallet, then approve the sign-in signature…', 'the recovery line is never shown');
    assert(f.requests.some(r => r.action === 'state'), 'the server state was loaded');
    await p.waitForFunction(() => RyoPayments.state.busy === false, null, { timeout: 20000 });
    assert(Date.now() - t0 >= 7000, 'the background check was still given its 8 s');
    assert.equal(await p.evaluate(entered), true);
    assert.deepEqual(errors, []);
  });

  // 2. The check answers late with a deposit: it is still sent to the server, then the balance is refreshed.
  await withGame(async ({ p, f, errors }) => {
    await p.waitForFunction(() => window.BetaWallet && window.RyoPayments && window.LoginScreen);
    await p.evaluate(() => {
      const record = { economyVersion: 2, kind: 'deposit', hash: 'L'.repeat(88), amount: 5000, treasuryAddress: RyoPayments.state.configuration?.treasuryAddress, requestId: 'late-deposit-request-0001' };
      BetaWallet.recoverPending = () => new Promise(r => setTimeout(() => { record.treasuryAddress = RyoPayments.state.configuration.treasuryAddress; r([{ record }]); }, 10000));
    });
    const balanceBefore = f.balance;
    await signIn(p);
    await p.waitForFunction(entered, null, { timeout: 30000 });
    assert(!f.requests.some(r => r.action === 'deposit'), 'entered before the late deposit was found');
    const deadline = Date.now() + 15000; while (Date.now() < deadline && !f.requests.some(r => r.action === 'deposit')) await p.waitForTimeout(250);
    const iDeposit = f.requests.findIndex(r => r.action === 'deposit');
    assert(iDeposit >= 0, 'the late deposit was still sent to the server');
    assert.equal(f.requests[iDeposit].signature, 'L'.repeat(88));
    const until = Date.now() + 5000; while (Date.now() < until && !f.requests.slice(iDeposit + 1).some(r => r.action === 'state')) await p.waitForTimeout(250);
    assert(f.requests.slice(iDeposit + 1).some(r => r.action === 'state'), 'the balance was refreshed after the late deposit');
    assert(f.balance > balanceBefore, 'the server credited the late deposit');
    await p.waitForFunction(b => Number(RyoPayments.state.balance) === b, f.balance, { timeout: 5000 });
    await p.waitForFunction(() => RyoPayments.state.busy === false, null, { timeout: 10000 });
    assert.deepEqual(errors, []);
  });

  // 2b. The check fails after the limit: no page error, the game stays open and usable.
  await withGame(async ({ p, errors }) => {
    await p.waitForFunction(() => window.BetaWallet && window.RyoPayments && window.LoginScreen);
    await p.evaluate(() => { BetaWallet.recoverPending = () => new Promise((_, no) => setTimeout(() => no(Error('RPC request timed out')), 10000)); });
    await signIn(p);
    await p.waitForFunction(entered, null, { timeout: 30000 });
    await p.waitForTimeout(12000);   // past the late failure (10 s; the game opened right away)
    assert.equal(await p.evaluate(entered), true, 'still in the game after the late failure');
    assert.equal(await p.evaluate(() => RyoPayments.state.busy), false);
    assert.deepEqual(errors, [], 'a late failure raises no page error');
  });

  // 3. Normal sign-in: the game opens right away.
  await withGame(async ({ p, f, errors }) => {
    await p.waitForFunction(() => window.BetaWallet && window.RyoPayments && window.LoginScreen);
    const t0 = Date.now(); await signIn(p);
    await p.waitForFunction(entered, null, { timeout: 15000 });
    assert(Date.now() - t0 < 5000, 'fast sign-in still quick: ' + (Date.now() - t0) + ' ms');
    await p.waitForFunction(() => RyoPayments.state.busy === false, null, { timeout: 10000 });
    assert.deepEqual(errors, []);
  });

  // 4. A real error from the check is shown in game (and in the Ryo status); the player is not kept on the sign-in screen.
  await withGame(async ({ p, errors }) => {
    await p.waitForFunction(() => window.BetaWallet && window.RyoPayments && window.LoginScreen);
    await p.evaluate(() => { BetaWallet.recoverPending = async () => { throw Error('Pending deposit belongs to another treasury. Contact the organizer.'); }; });
    await signIn(p);
    await p.waitForFunction(() => /Pending transaction check: Pending deposit belongs to another treasury/.test(document.getElementById('toast')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await p.evaluate(entered), true, 'the player is in the game');
    assert.match(await p.evaluate(() => RyoPayments.state.message), /another treasury/, 'the error stays in the Ryo status');
    assert.deepEqual(errors, []);
  });
  console.log('PASS: sign-in recovery — the game opens right after sign-in with the server state; the recovery step runs in the background (browser Solana check still limited to 8 s); a late deposit is still sent and the balance refreshed; a recovery error is shown in game, never blocking sign-in.');
})().catch(e => { console.error(e); process.exitCode = 1; });
