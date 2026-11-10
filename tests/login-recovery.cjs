/* Sign-in never hangs on "Recovering pending transactions…" (owner report 2026-11-10: a player's phone stayed on that
 * line). The browser's own Solana check (pending deposits / wallet balance) is limited to 8 s; after that the game loads
 * the server state and enters, while the check continues in the background. Isolated fixtures only: the harness wallet
 * and server are in-process fakes; no real wallet, RPC or transaction is used. */
const { withGame } = require('./harness.cjs');
const assert = require('node:assert/strict');

const signIn = p => p.locator('#loginPhantom').click();
const entered = () => RyoPayments.state.authenticated && !LoginScreen.active;

(async () => {
  // 1. The browser check never answers: the game still opens after about 8 s, with the server state loaded.
  await withGame(async ({ p, f, errors }) => {
    await p.waitForFunction(() => window.BetaWallet && window.RyoPayments && window.LoginScreen);
    await p.evaluate(() => { BetaWallet.recoverPending = () => new Promise(() => {}); });
    const t0 = Date.now(); await signIn(p);
    await p.waitForTimeout(5000);
    assert.equal(await p.evaluate(entered), false, 'still recovering after 5 s (the check is given its time)');
    await p.waitForFunction(entered, null, { timeout: 30000 });
    const took = Date.now() - t0;
    assert(took >= 7000 && took < 16000, 'entered the game after the 8 s limit: ' + took + ' ms');
    assert(f.requests.some(r => r.action === 'state'), 'the server state was loaded');
    assert.equal(await p.evaluate(() => RyoPayments.state.busy), false, 'payments are not left busy');
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
    assert.equal(await p.evaluate(() => RyoPayments.state.busy), false);
    assert.deepEqual(errors, []);
  });

  // 2b. The check fails after the limit: no page error, the game stays open and usable.
  await withGame(async ({ p, errors }) => {
    await p.waitForFunction(() => window.BetaWallet && window.RyoPayments && window.LoginScreen);
    await p.evaluate(() => { BetaWallet.recoverPending = () => new Promise((_, no) => setTimeout(() => no(Error('RPC request timed out')), 10000)); });
    await signIn(p);
    await p.waitForFunction(entered, null, { timeout: 30000 });
    await p.waitForTimeout(4000);   // past the late failure
    assert.equal(await p.evaluate(entered), true, 'still in the game after the late failure');
    assert.equal(await p.evaluate(() => RyoPayments.state.busy), false);
    assert.deepEqual(errors, [], 'a late failure raises no page error');
  });

  // 3. Normal sign-in is unchanged: a fast check runs first and the game opens right away.
  await withGame(async ({ p, f, errors }) => {
    await p.waitForFunction(() => window.BetaWallet && window.RyoPayments && window.LoginScreen);
    const t0 = Date.now(); await signIn(p);
    await p.waitForFunction(entered, null, { timeout: 15000 });
    assert(Date.now() - t0 < 8000, 'fast sign-in still quick: ' + (Date.now() - t0) + ' ms');
    assert.deepEqual(errors, []);
  });

  // 4. A real error from the check within the limit is still shown on the sign-in screen (unchanged behaviour).
  await withGame(async ({ p, errors }) => {
    await p.waitForFunction(() => window.BetaWallet && window.RyoPayments && window.LoginScreen);
    await p.evaluate(() => { BetaWallet.recoverPending = async () => { throw Error('Pending deposit belongs to another treasury. Contact the organizer.'); }; });
    await signIn(p);
    await p.waitForFunction(() => /another treasury/.test(document.querySelector('#loginMessage')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await p.evaluate(() => LoginScreen.active), true, 'the error keeps the player on the sign-in screen');
    assert.deepEqual(errors, []);
  });
  console.log('PASS: sign-in recovery — a hanging browser Solana check is limited to 8 s and the game opens with the server state; a late deposit is still sent and the balance refreshed; fast sign-in and early errors unchanged.');
})().catch(e => { console.error(e); process.exitCode = 1; });
