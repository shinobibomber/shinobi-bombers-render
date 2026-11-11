'use strict';
/* Sign-in on every browser (apply-signin.cjs + wallet-signin/, owner request 2026-11-12).
 * Part 1 — the REAL built wallet code (BetaWallet, from app/public/index.html) in a VM with simulated wallets and RPC:
 *   - a wallet that never answers the connect prompt ends after the time limit with a clear message; the next try works;
 *   - a wallet that never answers the sign-in signature ends after the time limit and releases the busy flag (no reload);
 *   - the sign-in signature makes NO Solana network (genesis) call, while connecting/transactions still check the network;
 *   - an account switch during signing is still refused; the silent reconnect still passes {onlyIfTrusted:true} untimed.
 * Part 2 — the game page in Chromium with phone and desktop emulation (isolated fixtures, no real wallet):
 *   - iPhone / Android browser without a wallet: Phantom / Solflare open this page in the wallet app (official browse links),
 *     the game's own sign-in is not started, and a hint is shown;
 *   - desktop without the extension: an install link, no navigation;
 *   - with a wallet in the browser (extension or wallet app): no hint, the game's normal sign-in runs;
 *   - landscape phone: both wallet buttons are at least 44 px tall and do not overlap;
 *   - a cancelled signature shows the friendly message. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const web3 = require('../app/node_modules/@solana/web3.js'), spl = require('../app/node_modules/@solana/spl-token');
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const html = fs.readFileSync(path.join(__dirname, '../app/public/index.html'), 'utf8');

async function part1() {
  const calls = { genesis: 0 };
  class Connection {
    async getGenesisHash() { calls.genesis++; return GENESIS; }
    async getBalance() { return 1e9; }
    async getAccountInfo() { return null; }
    async getTokenAccountBalance() { return { value: { amount: '0' } }; }
  }
  const owner = web3.Keypair.generate(), other = web3.Keypair.generate();
  const makeWallet = signer => ({ publicKey: signer.publicKey, connectMode: 'ok', signMode: 'ok', seen: [], on() {}, removeListener() {},
    connect(a) { this.seen.push(a === undefined ? null : a); return this.connectMode === 'hang' ? new Promise(() => {}) : Promise.resolve(); },
    async signTransaction(tx) { return tx; },
    signMessage(bytes) { if (this.signMode === 'hang') return new Promise(() => {}); if (this.signMode === 'switch') this.publicKey = other.publicKey;
      return Promise.resolve({ signature: Uint8Array.from(require('node:crypto').createHash('sha512').update(Buffer.from(bytes)).digest()) }); } });
  const phantom = makeWallet(owner), solflare = makeWallet(other);
  const storage = new Map();
  const context = { Buffer, console, URL, BigInt, AbortController, Response, TextEncoder, Uint8Array, btoa, clearTimeout, Promise, Object, Error, Date, JSON,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 60000 ? 60 : ms === 100000 ? 80 : ms),   // the new wallet time limits, shortened for the test
    fetch: async () => new Response('{}'), crypto: crypto.webcrypto, location: { protocol: 'file:' },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    dispatchEvent: () => {}, CustomEvent: class {}, Event: class {},
    ShinobiSolana: { ...web3, ...spl, ...require('../app/server/transaction-review.cjs'), Connection },
    ShinobiBetaConfig: { network: 'solana-devnet', tokenAddress: null, studioAddress: null }, phantom: { solana: phantom }, solflare };
  context.window = context; context.ShinobiGasSafety = require('../transaction-safety/gas-safety.js');
  const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).find(code => code.includes('// SOURCE: beta-wallet.js'));
  assert(source, 'built wallet source found'); vm.createContext(context); vm.runInContext(source, context);
  const W = context.BetaWallet; await W.ready;

  // connect: a wallet that never answers ends with a clear message; then a normal connect works
  phantom.connectMode = 'hang';
  await assert.rejects(W.connect('phantom'), e => e.code === 'WALLET_TIMEOUT' && /did not respond\. Open or unlock Phantom/.test(e.message), 'connect is limited in time');
  phantom.connectMode = 'ok';
  const g0 = calls.genesis; await W.connect('phantom'); assert.equal(W.state.account, owner.publicKey.toBase58());
  assert(calls.genesis > g0, 'connecting still checks the Solana network');

  // silent reconnect (session renewal) is unchanged: {onlyIfTrusted:true}, no wallet time limit added
  phantom.seen.length = 0; await W.connect('phantom', { onlyIfTrusted: true }); assert.deepEqual(JSON.parse(JSON.stringify(phantom.seen)), [{ onlyIfTrusted: true }]);
  phantom.seen.length = 0; await W.connect('phantom'); assert.deepEqual(phantom.seen, [null], 'a normal connect passes no options, as before');

  // sign-in signature: no network call, valid 64-byte signature
  const g1 = calls.genesis; const sig = await W.signLogin('login message'); assert.equal(Buffer.from(sig, 'base64').length, 64);
  assert.equal(calls.genesis, g1, 'the login signature makes no Solana network call');

  // a signature prompt that is never answered ends after the limit and releases the busy flag
  phantom.signMode = 'hang';
  await assert.rejects(W.signLogin('login message'), e => e.code === 'WALLET_TIMEOUT' && /did not answer the sign-in request/.test(e.message));
  assert.equal(W.state.busy, false, 'the wallet is not left busy');
  phantom.signMode = 'ok'; assert.equal(Buffer.from(await W.signLogin('again'), 'base64').length, 64, 'the next sign-in works without a reload');

  // switching accounts while the signature is open is still refused
  phantom.signMode = 'switch'; await assert.rejects(W.signLogin('switch'), /Wallet account changed/); phantom.publicKey = owner.publicKey; phantom.signMode = 'ok';

  // a cancel keeps the wallet's own error (the login screen turns it into the friendly text)
  phantom.signMessage = () => Promise.reject(Object.assign(Error('User rejected the request.'), { code: 4001 }));
  await assert.rejects(W.signLogin('x'), e => e.code === 4001); assert.equal(W.state.busy, false);
  console.log('part 1: wallet time limits, network-free login signature, account check, silent reconnect unchanged');
}

async function part2() {
  const { withGame } = require('./harness.cjs');
  const { devices } = require('playwright');
  const opened = async (p, kind) => {
    const target = kind === 'phantom' ? 'https://phantom.app/**' : 'https://solflare.com/**';
    let url = null; await p.route(target, r => { url = r.request().url(); r.fulfill({ status: 200, contentType: 'text/html', body: '<p>wallet app</p>' }); });
    await p.locator(kind === 'phantom' ? '#loginPhantom' : '#loginSolflare').click();
    for (let i = 0; i < 40 && !url; i++) await p.waitForTimeout(100);
    return url;
  };
  const atLogin = p => p.waitForFunction(() => window.WalletSignin && window.LoginScreen?.active && !document.querySelector('#loginPhantom').disabled, null, { timeout: 30000 });

  // iPhone Safari without a wallet: opens this page inside Phantom; the game's own sign-in is not started
  await withGame(async ({ p, f, url }) => {
    await atLogin(p);
    await p.waitForFunction(() => /^On a phone\? Tap Phantom or Solflare/.test(document.querySelector('#loginMessage').textContent), null, { timeout: 8000 });
    const hintBox = await p.evaluate(() => { const r = document.querySelector('#loginMessage').getBoundingClientRect(), b = document.querySelector('#loginPhantom').getBoundingClientRect(), links = [...document.querySelectorAll('#loginScreen .community-link')].map(e => e.getBoundingClientRect()); return { bottom: r.bottom, phantomTop: b.top, overlapsLinks: links.some(l => r.bottom > l.top && r.top < l.bottom && r.right > l.left && r.left < l.right) }; });
    assert(hintBox.bottom <= hintBox.phantomTop + 1 && !hintBox.overlapsLinks, 'the hint covers neither the wallet buttons nor the community links ' + JSON.stringify(hintBox));
    const before = f.requests.length;
    const link = await opened(p, 'phantom');
    assert(link && link.startsWith('https://phantom.app/ul/browse/'), 'Phantom browse link: ' + link);
    const target = decodeURIComponent(link.split('/ul/browse/')[1].split('?')[0]);
    assert(/^http:\/\/127\.0\.0\.1:\d+\/(index\.html)?$/.test(target), 'the link opens this same page: ' + target);
    assert(/[?&]ref=http%3A%2F%2F127\.0\.0\.1/.test(link), 'the link names this site as ref');
    assert(!f.requests.slice(before).some(r => r.action === 'challenge'), 'no sign-in challenge was requested in the browser');
  }, { ...devices['iPhone 13'] }, { noWalletProviders: true }).catch(e => { throw Object.assign(e, { message: 'iPhone: ' + e.message }); });

  // Android Chrome without a wallet: Solflare browse link
  await withGame(async ({ p }) => {
    await atLogin(p);
    const link = await opened(p, 'solflare');
    assert(link && link.startsWith('https://solflare.com/ul/v1/browse/') && link.includes('ref='), 'Solflare browse link: ' + link);
  }, { ...devices['Pixel 7'] }, { noWalletProviders: true }).catch(e => { throw Object.assign(e, { message: 'Android: ' + e.message }); });

  // Desktop without the extension: an install link, no navigation
  await withGame(async ({ p }) => {
    await atLogin(p);
    await p.waitForTimeout(1700);
    assert.equal(await p.evaluate(() => document.querySelector('#loginMessage').textContent), '', 'no phone hint on a computer');
    await p.locator('#loginSolflare').click();
    await p.waitForFunction(() => /Solflare is not installed in this browser/.test(document.querySelector('#loginMessage').textContent));
    assert.equal(await p.locator('#loginMessage a').getAttribute('href'), 'https://solflare.com/download');
    assert.equal(await p.locator('#loginSolflare').isDisabled(), false, 'the buttons stay usable');
  }, { viewport: { width: 1366, height: 800 } }, { noWalletProviders: true }).catch(e => { throw Object.assign(e, { message: 'desktop: ' + e.message }); });

  // With a wallet in the browser (phone inside the wallet app): no hint, normal sign-in; and a landscape phone gets 44 px buttons
  await withGame(async ({ p, f }) => {
    await atLogin(p); await p.waitForTimeout(1700);
    assert.equal(await p.evaluate(() => document.querySelector('#loginMessage').textContent), '', 'inside the wallet app the hint is hidden');
    const boxes = await p.evaluate(() => ['#loginPhantom', '#loginSolflare'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; }));
    assert(boxes.every(b => b.h >= 44), 'landscape phone: 44 px wallet buttons ' + JSON.stringify(boxes));
    assert(boxes[0].bottom <= boxes[1].top + 0.5, 'the two wallet buttons do not overlap');
    const vh = await p.evaluate(() => innerHeight); assert(boxes.every(b => b.top >= 0 && b.bottom <= vh), 'both wallet buttons are fully on screen without scrolling ' + vh);
    await p.evaluate(() => { const sign = BetaWallet.signLogin; BetaWallet.signLogin = async () => { throw Object.assign(Error('User rejected the request.'), { code: 4001 }); }; window.__restoreSign = () => { BetaWallet.signLogin = sign; }; });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => document.querySelector('#loginMessage').textContent.startsWith('Sign-in cancelled in your wallet.') && !document.querySelector('#loginPhantom').disabled);
    await p.evaluate(() => window.__restoreSign());
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !LoginScreen.active, null, { timeout: 20000 });
    assert(f.requests.some(r => r.action === 'challenge'), 'the normal sign-in ran');
  }, { ...devices['iPhone 13 landscape'] }, {}).catch(e => { throw Object.assign(e, { message: 'wallet app / landscape: ' + e.message }); });

  // The smallest common landscape phone (iPhone SE, 568 × 320): both 44 px buttons fully visible without scrolling
  await withGame(async ({ p }) => {
    await atLogin(p);
    const r = await p.evaluate(() => ({ vh: innerHeight, b: ['#loginPhantom', '#loginSolflare'].map(s => { const x = document.querySelector(s).getBoundingClientRect(); return [x.top, x.bottom, x.height]; }) }));
    assert(r.b.every(([t, b, h]) => h >= 44 && t >= 0 && b <= r.vh) && r.b[0][1] <= r.b[1][0] + 0.5, 'iPhone SE landscape buttons ' + JSON.stringify(r));
  }, { ...devices['iPhone SE landscape'] }, { noWalletProviders: true }).catch(e => { throw Object.assign(e, { message: 'iPhone SE landscape: ' + e.message }); });
  console.log('part 2: phone wallet-app links (iPhone, Android), desktop install link, hint only without a wallet, landscape 44 px, friendly cancel');
}

(async () => {
  await part1();
  await part2();
  console.log('PASS: sign-in on every browser — wallet time limits release the buttons, login signature needs no network call, phones open the wallet app, desktop gets an install link, landscape buttons 44 px, friendly cancel.');
})().catch(e => { console.error(e); process.exit(1); });
