'use strict';
/* Deposit / withdrawal result popup (owner request 2026-11-11, "put success pop out on screen if its successful or not").
 * The Chest shows a popup with the real outcome of every transfer (successful / failed / processing), from the payment client
 * and server (credited receipt, withdrawal status, refusal), and a withdrawal that finalizes later shows one notice. Display
 * only. Deposit success and unsent-deposit failure are also covered in browser.cjs and gas-preflight.cjs. */
const { withGame } = require('./harness.cjs');
const login = async p => { await p.locator('#loginPhantom').click(); await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active); await p.waitForSelector('[data-gc-chest]'); };
const open = async p => { await p.locator('[data-gc-chest]').click(); await p.waitForSelector('.gc-dialog[open]'); };
const withdraw = async (p, amount = '100000') => {
  await p.getByRole('button', { name: 'Withdraw Ryo', exact: true }).click(); await p.locator('#gc-transfer-amount').fill(amount);
  await p.getByRole('button', { name: 'Review withdrawal', exact: true }).click(); await p.getByRole('button', { name: 'Confirm withdrawal', exact: true }).click();
};
const result = async (p, state) => { await p.waitForSelector('[data-gc-result="' + state + '"]'); return (await p.locator('.gc-result').innerText()).replace(/\s+/g, ' '); };
const ok = async p => { await p.locator('.gc-result-ok').click(); await p.waitForSelector('.gc-result-layer', { state: 'detached' }); };
const back = async p => p.getByRole('button', { name: 'Back to Chest', exact: true }).click();
(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; await login(p); await open(p);
    // Confirmed at once -> successful; Esc closes only the popup, the Chest stays open.
    await withdraw(p);
    assert.match(await result(p, 'withdrawal-success'), /Withdrawal successful Your withdrawal of 100,000 Ryo was sent to your connected wallet\. OK/i);
    assert(await p.locator('.gc-result-ok').evaluate(e => document.activeElement === e), 'OK is focused');
    await p.keyboard.press('Escape'); await p.waitForSelector('.gc-result-layer', { state: 'detached' });
    assert.equal(await p.locator('.gc-dialog[open]').count(), 1, 'Escape closes the popup, not the Chest');
    // Refused by the server (nothing reserved) -> failed with the reason.
    await back(p); f.nextWithdrawalAt = 0; await p.evaluate(() => RyoPayments.refresh());
    await p.evaluate(() => { window.realWithdraw = RyoPayments.withdraw; RyoPayments.withdraw = () => Promise.reject(Object.assign(Error('Recover your pending withdrawal first.'), { status: 409 })); });
    await withdraw(p);
    assert.match(await result(p, 'withdrawal-failed'), /Withdrawal failed[\s\S]*did not go through[\s\S]*Recover your pending withdrawal first\. Your balance was not changed\./i);
    await ok(p); await p.evaluate(() => { RyoPayments.withdraw = window.realWithdraw; });
    // Outcome unknown (timeout) -> processing, never "failed".
    await back(p); await p.evaluate(() => { RyoPayments.withdraw = () => Promise.reject(Error('Ryo server request timed out. A submitted operation may still be pending.')); });
    await withdraw(p); assert.match(await result(p, 'withdrawal-processing'), /Withdrawal processing[\s\S]*reserved and settling/i);
    await ok(p); await p.evaluate(() => { RyoPayments.withdraw = window.realWithdraw; });
    // Pending -> processing popup, then a refund later -> one "WITHDRAWAL FAILED" notice.
    await back(p); f.pendingWithdrawal = true; await withdraw(p);
    assert.match(await result(p, 'withdrawal-processing'), /Withdrawal processing[\s\S]*100,000 Ryo/i); await ok(p);
    f.withdrawals[0].status = 'refunded'; f.balance += 100000; await p.evaluate(() => RyoPayments.refresh());
    await p.waitForSelector('.sbw-dialog[open]');
    assert.match(await p.locator('.sbw-dialog[open]').textContent(), /WITHDRAWAL FAILED[\s\S]*100,000 Ryo did not go through[\s\S]*returned to your Game Balance/);
    await p.locator('.sbw-dialog[open] .sbw-btn').click(); await p.evaluate(() => RyoPayments.refresh()); await p.waitForTimeout(300);
    assert.equal(await p.locator('.sbw-dialog[open]').count(), 0, 'a settled withdrawal is announced once');
    // Phone: the popup fits the screen.
    await p.setViewportSize({ width: 390, height: 844 }); await back(p); f.pendingWithdrawal = false; f.nextWithdrawalAt = 0; await p.evaluate(() => RyoPayments.refresh());
    await withdraw(p); await result(p, 'withdrawal-success');
    const box = await p.locator('.gc-result').boundingBox(); assert(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844, 'popup fits a phone');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await ok(p);
    assert.deepEqual(errors, []);
    console.log('PASS: withdrawal popups: successful (confirmed), failed (refused, with reason), processing (pending or unknown), Esc/OK close only the popup, a later refund shows one WITHDRAWAL FAILED notice, phone fit.');
  });
  await withGame(async ({ p, f, errors, assert }) => {
    // A deposit not finalized yet -> processing, then the automatic recovery credits it -> the same popup turns successful.
    f.holdAdventure = false; f.depositNotFinalized = true; await login(p); await open(p);
    await p.getByRole('button', { name: 'Deposit Ryo', exact: true }).click(); await p.locator('#gc-transfer-amount').fill('100000');
    await p.getByRole('button', { name: 'Review deposit', exact: true }).click(); await p.getByRole('button', { name: 'Confirm deposit', exact: true }).click();
    assert.match(await result(p, 'deposit-processing'), /Deposit processing[\s\S]*100,000 Ryo is being confirmed on-chain/i);
    assert.equal(f.balance, 500000, 'nothing credited while processing');
    f.depositNotFinalized = false;
    await p.waitForSelector('[data-gc-result="deposit-success"]', { timeout: 20000 });
    assert.match(await result(p, 'deposit-success'), /Deposit successful 100,000 Ryo was added to your Game Balance/i);
    assert.equal(f.deposits.length, 1, 'credited once'); await ok(p);
    // Review fix: the deposit is credited but the refresh afterwards times out. Never "failed" (that would be false); it shows
    // processing and turns successful once the verified history lists the new deposit.
    await p.evaluate(() => { const real = RyoPayments.deposit; RyoPayments.deposit = async n => { await real(n); throw Error('Ryo server request timed out. A submitted operation may still be pending.'); }; });
    await p.locator('#gc-transfer-amount').fill('100000'); await p.getByRole('button', { name: 'Review deposit', exact: true }).click(); await p.getByRole('button', { name: 'Confirm deposit', exact: true }).click();
    assert.match(await result(p, 'deposit-processing'), /Deposit processing/i, 'an error after the credit is never shown as failed');
    await p.waitForSelector('[data-gc-result="deposit-success"]', { timeout: 20000 });
    assert.equal(f.deposits.length, 2, 'the second deposit was credited once'); await ok(p);
    // A deposit rejected in the wallet (never sent) is failed.
    await p.evaluate(() => { RyoPayments.deposit = () => Promise.reject(Object.assign(Error('User rejected the request.'), { code: 4001 })); });
    await p.locator('#gc-transfer-amount').fill('100000'); await p.getByRole('button', { name: 'Review deposit', exact: true }).click(); await p.getByRole('button', { name: 'Confirm deposit', exact: true }).click();
    assert.match(await result(p, 'deposit-failed'), /Deposit failed[\s\S]*User rejected the request\. Nothing was charged\./i); await ok(p);
    assert.deepEqual(errors, []);
    console.log('PASS: deposit popup: processing while the receipt finalizes, then successful once it is credited; a credited deposit whose refresh timed out is never shown as failed; a wallet rejection is failed.');
  });
  await withGame(async ({ p, f, errors, assert }) => {
    // Owner report 2026-11-11 (a phone could not deposit): a deposit that never reached Solana is cleared by the wallet once it
    // can no longer be processed. The popup then says FAILED (no tokens left the wallet), never credited.
    f.holdAdventure = false; f.depositNotFinalized = true; await login(p); await open(p);
    await p.getByRole('button', { name: 'Deposit Ryo', exact: true }).click(); await p.locator('#gc-transfer-amount').fill('100000');
    await p.getByRole('button', { name: 'Review deposit', exact: true }).click(); await p.getByRole('button', { name: 'Confirm deposit', exact: true }).click();
    assert.match(await result(p, 'deposit-processing'), /Deposit processing/i);
    await p.evaluate(() => BetaWallet.expireAll());
    assert.match(await result(p, 'deposit-failed'), /Deposit failed[\s\S]*never reached Solana and can no longer be processed[\s\S]*No tokens left your wallet\. You can deposit again\./i);
    assert.equal(f.deposits.length, 0, 'nothing credited'); assert.equal(f.balance, 500000);
    assert.equal(await p.locator('[data-gc-result="deposit-success"]').count(), 0, 'never shown as credited');
    await ok(p); assert.deepEqual(errors, []);
    console.log('PASS: a deposit cleared because it never reached Solana is shown as failed (no tokens left the wallet), never as credited.');
  });
})().catch(e => { console.error(e); process.exitCode = 1; });
