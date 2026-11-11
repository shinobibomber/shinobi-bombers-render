/* A page reload keeps the player signed in (owner request 2026-11-11); a sign-out (expired session, wallet change or
 * disconnect) is never undone by a reload. Isolated fixtures only: in-process fake wallet and server. */
'use strict';
const { withGame } = require('./harness.cjs');
const assert = require('node:assert/strict');
const KEY = 'shinobi-ryo-session-v1';
const entered = () => RyoPayments.state.authenticated && !LoginScreen.active;
const saved = p => p.evaluate(k => JSON.parse(sessionStorage.getItem(k) || 'null'), KEY);
const count = (f, action) => f.requests.filter(r => r.action === action).length;
async function reload(p) {
  await p.evaluate(() => { walletConnects.length = 0; });
  await p.reload();
  await p.waitForFunction(() => window.GlobalChestUI?.ready && !window.GameLoading?.active, null, { timeout: 45000 });
}
async function atLogin(p) {
  await p.waitForFunction(() => LoginScreen.active && !document.querySelector('#loginPhantom').disabled && !RyoPayments.state.busy, null, { timeout: 20000 });
  await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => LoginScreen.active && !RyoPayments.state.authenticated), true, 'on the login screen');
  assert.equal(await p.evaluate(() => document.querySelector('#loginMessage').textContent), '', 'no error shown for a silent resume');
}
// Server answers 401 (session expired) while `expired.on`; the harness handles everything else.
async function expiry(p) {
  const expired = { on: false };
  await p.route('**/.netlify/functions/ryo', route => {
    const action = route.request().postDataJSON()?.action;
    if (expired.on && !['config', 'challenge', 'login'].includes(action)) return route.fulfill({ status: expired.code || 401, contentType: 'application/json', body: JSON.stringify({ error: expired.code && expired.code !== 401 ? 'Ryo server is temporarily unavailable.' : 'Wallet session expired. Sign in again.' }) });
    return route.fallback();
  });
  return expired;
}

(async () => {
  // Phantom: reload resumes silently; expiry, untrusted wallet, another account and disconnect.
  await withGame(async ({ p, f, errors, account, mint }) => {
    f.holdAdventure = false;
    await p.addInitScript(() => { window.walletUntrusted = sessionStorage.getItem('test-untrusted') === '1'; });
    const expired = await expiry(p);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(entered, null, { timeout: 15000 });
    const s = await saved(p);
    assert.deepEqual({ token: s.token, account: s.account, wallet: s.wallet, mint: s.mint }, { token: 'isolated-session-1', account, wallet: 'phantom', mint }, 'session kept for this tab');

    // 1. Reload: back in the game without a new signature, via a silent (trusted-only) reconnect.
    const mark = f.requests.length;
    await reload(p);
    await p.waitForFunction(entered, null, { timeout: 15000 });
    assert.equal(count(f, 'challenge'), 1, 'no new signature requested');
    assert.deepEqual(await p.evaluate(() => walletConnects), [{ kind: 'phantom', silent: true }], 'silent reconnect only');
    assert(f.requests.slice(mark).some(r => r.action === 'state'), 'the saved session was checked with the server');

    // 2. The session expires during play: back to the login screen, and a reload does not undo it.
    expired.on = true;
    await p.evaluate(() => AdventureChest.refresh());
    await p.waitForFunction(() => LoginScreen.active && !RyoPayments.state.authenticated, null, { timeout: 20000 });
    assert.equal(await saved(p), null, 'an expired session is forgotten');
    await reload(p); await atLogin(p);
    assert.deepEqual(await p.evaluate(() => walletConnects), [], 'no reconnect attempt without a saved session');
    expired.on = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(entered, null, { timeout: 15000 });
    assert.equal(count(f, 'challenge'), 2, 'a new signature after expiry');
    assert.equal((await saved(p)).token, 'isolated-session-2');

    // 3. Phantom does not trust the site yet: no popup, the login screen stays; the click resumes without a signature.
    await p.evaluate(() => sessionStorage.setItem('test-untrusted', '1'));
    await reload(p); await atLogin(p);
    assert.deepEqual(await p.evaluate(() => walletConnects), [{ kind: 'phantom', silent: true }]);
    assert.equal((await saved(p))?.token, 'isolated-session-2', 'kept for the next click');
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(entered, null, { timeout: 15000 });
    assert.equal(count(f, 'challenge'), 2, 'resumed on click without a new signature');
    await p.evaluate(() => sessionStorage.removeItem('test-untrusted'));

    // 4. A session saved for another account is never used; it is forgotten.
    await p.evaluate(k => { const v = JSON.parse(sessionStorage.getItem(k)); v.account = 'So11111111111111111111111111111111111111112'; sessionStorage.setItem(k, JSON.stringify(v)); }, KEY);
    await reload(p); await atLogin(p);
    assert.equal(await saved(p), null, 'another account’s session is forgotten');
    assert.equal(count(f, 'challenge'), 2, 'the resume path never asks for a signature');

    // 5. Older than 24 hours on this tab: not tried, forgotten.
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(entered, null, { timeout: 15000 });
    assert.equal(count(f, 'challenge'), 3);
    await p.evaluate(k => { const v = JSON.parse(sessionStorage.getItem(k)); v.at -= 86400000; sessionStorage.setItem(k, JSON.stringify(v)); }, KEY);
    const states = count(f, 'state');
    await reload(p); await atLogin(p);
    assert.equal(await saved(p), null); assert.equal(count(f, 'state'), states, 'a session past 24 hours is not even tried');

    // 6. Disconnecting the wallet signs out and forgets the session.
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(entered, null, { timeout: 15000 });
    assert.notEqual(await saved(p), null);
    await p.evaluate(() => BetaWallet.disconnect());
    await p.waitForFunction(() => !RyoPayments.state.authenticated, null, { timeout: 10000 });
    assert.equal(await saved(p), null, 'disconnect forgets the session');
    assert.deepEqual(errors, []);
  });

  // Solflare: no automatic reconnect on reload; one click resumes without a signature.
  await withGame(async ({ p, f, errors }) => {
    await p.locator('#loginSolflare').click();
    await p.waitForFunction(entered, null, { timeout: 15000 });
    assert.equal((await saved(p)).wallet, 'solflare');
    await reload(p); await atLogin(p);
    assert.deepEqual(await p.evaluate(() => walletConnects), [], 'Solflare is never reconnected without a click');
    // A stray signed-in call before the resume (no session in memory yet) is refused but keeps the saved session.
    assert.match(await p.evaluate(() => RyoPayments.refresh().then(() => 'ok', e => e.message)), /Sign in/);
    assert.equal((await saved(p))?.token, 'isolated-session-1', 'still saved after a stray call');
    await p.locator('#loginSolflare').click();
    await p.waitForFunction(entered, null, { timeout: 15000 });
    assert.equal(count(f, 'challenge'), 1, 'resumed without a new signature');
    assert.deepEqual(errors, []);
  });

  // A server error on reload keeps the saved session for the next try; an expired one (401) is forgotten.
  await withGame(async ({ p, f, errors }) => {
    const expired = await expiry(p);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(entered, null, { timeout: 15000 });
    expired.code = 503; expired.on = true;
    await reload(p); await atLogin(p);
    assert.equal((await saved(p))?.token, 'isolated-session-1', 'a temporary server error does not forget the session');
    expired.on = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(entered, null, { timeout: 15000 });
    assert.equal(count(f, 'challenge'), 1, 'resumed on the next try without a new signature');
    expired.code = 401; expired.on = true;
    await reload(p); await atLogin(p);
    assert.equal(await saved(p), null, 'expired session forgotten');
    assert.equal(count(f, 'challenge'), 1);
    expired.on = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(entered, null, { timeout: 15000 });
    assert.equal(count(f, 'challenge'), 2, 'signs in normally afterwards');
    assert.deepEqual(errors, []);
  });
  console.log('PASS: a reload keeps the player signed in (silent Phantom reconnect, Solflare on click, no new signature); expiry, another account, >24 h and disconnect are never undone by a reload.');
})().catch(e => { console.error(e); process.exit(1); });
