'use strict';
/* Founder's NFT Boxes on the pre-landing API over real HTTP (in-memory Postgres, fake Devnet RPC, real wallet
 * signatures): public sale state without sign-in, sign-in required to buy, sales closed by default (fail closed),
 * missing/incorrect server settings refused, the full buy → sign → server broadcast → confirm flow within the
 * portal's 4 KB request limit, the one-per-wallet rule, and the page's own transaction review (prelaunch/founders.js).
 * Then the site host: public NFT metadata/art routes in pre-launch mode, with no traversal and no private data. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http'), vm = require('node:vm');
const { spawn } = require('node:child_process');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js'), bs58 = require('../app/node_modules/bs58');
const root = path.resolve(__dirname, '..'), app = path.join(root, 'app');
const { createPrelaunch } = require('../prelaunch/server.cjs');
const ORIGIN = 'https://portal.example', SCOPE = 'solana-devnet:founders-portal-test', DEVNET = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

(async () => {
  const db = new PGlite(), schema = fs.readFileSync(path.join(app, 'server/schema.sql'), 'utf8'); await db.exec(schema);
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const authority = web3.Keypair.generate(), revenue = web3.Keypair.generate().publicKey.toBase58();
  const statuses = new Map(), sent = []; let genesis = DEVNET, balance = 5e9;
  const connection = {
    async getGenesisHash() { return genesis; },
    async getMinimumBalanceForRentExemption(n) { return 890880 + n * 6960; },
    async getLatestBlockhash() { return { blockhash: web3.Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 250 }; },
    async getFeeForMessage() { return { value: 15000 }; }, async getBalance() { return balance; },
    async getAccountInfo() { return null; }, async getBlockHeight() { return 100; },
    async getSignatureStatuses(sigs) { return { value: sigs.map(s => statuses.get(s) || null) }; },
    async sendRawTransaction(raw) { sent.push(Buffer.from(raw)); return 'ok'; },
  };
  const baseEnv = { SOLANA_NETWORK: 'devnet', RYO_SITE_ORIGIN: ORIGIN, RYO_SCOPE: SCOPE, FOUNDERS_REVENUE_WALLET: revenue, FOUNDERS_MINT_AUTHORITY_SECRET: JSON.stringify([...authority.secretKey]) };
  let env = { ...baseEnv }, portal = null;
  const server = http.createServer((req, res) => portal.handle(req, res)); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const restart = (extra, opts = {}) => { env = { ...baseEnv, ...extra }; portal = createPrelaunch({ gameDir: app, env, pool, foundersConnection: connection, ...opts }); };
  let ip = 0;
  const call = (action, body = {}, cookie) => new Promise((resolve, reject) => {
    const data = JSON.stringify({ ...body, action }), headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), origin: ORIGIN, 'x-sb-prelaunch': '1', 'x-forwarded-for': '10.1.0.' + (++ip % 250 + 1) };
    if (cookie) headers.cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/prelaunch', method: 'POST', headers }, res => { let t = ''; res.on('data', c => t += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(t || '{}') })); });
    req.on('error', reject); req.end(data);
  });
  const key = () => { const kp = web3.Keypair.generate(); const priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.slice(0, 32))]), format: 'der', type: 'pkcs8' }); return { kp, wallet: kp.publicKey.toBase58(), sign: m => crypto.sign(null, Buffer.from(m), priv).toString('base64') }; };
  const signIn = async k => { const ch = await call('challenge', { wallet: k.wallet }); const r = await call('login', { wallet: k.wallet, nonce: ch.body.nonce, signature: k.sign(ch.body.message) }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r; };
  const cookieOf = async k => { const ch = await call('challenge', { wallet: k.wallet }); return new Promise((resolve, reject) => {
    const data = JSON.stringify({ action: 'login', wallet: k.wallet, nonce: ch.body.nonce, signature: k.sign(ch.body.message) });
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/prelaunch', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), origin: ORIGIN, 'x-sb-prelaunch': '1' } }, res => { res.resume(); res.on('end', () => resolve(res.headers['set-cookie'][0].split(';')[0])); });
    req.on('error', reject); req.end(data); }); };
  void signIn;
  const passed = [];
  try {
    restart({});
    // Public state without a session; closed by default.
    let r = await call('founders-info'); assert.equal(r.status, 200);
    assert.deepEqual([r.body.founders.mode, r.body.founders.eligible, r.body.founders.tiers.mythic.price, r.body.founders.tiers.legacy.price, r.body.founders.tiers.mythic.remaining], ['off', false, 0.5, 0.5, 33]);
    assert.deepEqual([r.body.founders.tiers.mythic.regularPrice, r.body.founders.tiers.mythic.earlyBird, r.body.founders.tiers.legacy.earlyBird, r.body.founders.tiers.legacy.supply, r.body.founders.totalSupply], [1, { price: 0.5, total: 3, left: 3 }, undefined, 30, 63], 'Mythic early bird #1-#3 at 0.5 SOL, then 1 SOL');
    assert.equal((await call('founders-mint', { tier: 'mythic', requestId: 'fb-0000000000000001' })).status, 401, 'buying needs sign-in');
    assert.equal(r.body.founders.wallet, null, 'signed out: no wallet');
    const alice = key(), aliceCookie = await cookieOf(alice);
    assert.equal((await call('founders-info', {}, aliceCookie)).body.founders.wallet, alice.wallet, 'signed in: the session wallet (recognised after a page reload)');
    r = await call('founders-mint', { tier: 'mythic', requestId: 'fb-0000000000000001' }, aliceCookie);
    assert.deepEqual([r.status, r.body.code], [403, 'FOUNDERS_CLOSED']);
    passed.push('public sale state without sign-in; buying needs sign-in; sales closed by default');

    // Display-only USD rate: Jupiter and CoinGecko must agree within 2%; failures or disagreement show no USD; cached.
    let priceCalls = 0;
    const quotes = q => async url => { priceCalls++; const jup = url.startsWith('https://lite-api.jup.ag/'), v = jup ? q.jup : q.gecko; if (v instanceof Error) throw v;
      return { ok: true, json: async () => jup ? { So11111111111111111111111111111111111111112: { usdPrice: v } } : { solana: { usd: v, last_updated_at: Math.floor(Date.now() / 1000) } } }; };
    restart({}, { usdPrices: true, priceFetch: quotes({ jup: 86.72, gecko: 86.75 }) });
    r = await call('founders-info'); assert.equal(r.body.founders.usdPerSol, 86.74, 'average of two agreeing sources');
    priceCalls = 0; await call('founders-info'); assert.equal(priceCalls, 0, 'rate cached for 60 s');
    restart({}, { usdPrices: true, priceFetch: quotes({ jup: 86, gecko: 95 }) });
    r = await call('founders-info'); assert.deepEqual([r.status, r.body.founders.usdPerSol], [200, undefined], 'sources disagree: no USD');
    restart({}, { usdPrices: true, priceFetch: quotes({ jup: Error('down'), gecko: 86 }) });
    r = await call('founders-info'); assert.deepEqual([r.status, r.body.founders.usdPerSol, r.body.founders.mode], [200, undefined, 'off'], 'a source failure hides USD only');
    priceCalls = 0; restart({}, { priceFetch: quotes({ jup: 86.72, gecko: 86.75 }) });
    r = await call('founders-info'); assert.deepEqual([r.body.founders.usdPerSol, priceCalls], [undefined, 0], 'Devnet portal never shows or fetches USD');
    restart({});
    passed.push('display-only USD: two agreeing sources, cached; disagreement, failure or Devnet show none');

    // Server settings are required and checked (fail closed).
    restart({ FOUNDERS_PUBLIC_SALE_ENABLED: 'on', FOUNDERS_REVENUE_WALLET: '', RYO_REVENUE_WALLET: revenue });   // the game wallet never stands in
    r = await call('founders-mint', { tier: 'mythic', requestId: 'fb-0000000000000001' }, aliceCookie); assert.deepEqual([r.status, r.body.code], [503, 'SERVER_ERROR'], 'configuration problems are 503 without details');
    restart({ FOUNDERS_PUBLIC_SALE_ENABLED: 'on' }); genesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
    r = await call('founders-mint', { tier: 'mythic', requestId: 'fb-0000000000000001' }, aliceCookie); assert.deepEqual([r.status, r.body.code], [503, 'SERVER_ERROR'], 'a Mainnet RPC on a Devnet portal is refused');
    genesis = DEVNET; restart({ FOUNDERS_PUBLIC_SALE_ENABLED: 'on' });
    passed.push('missing revenue wallet or an RPC on the wrong network refuses the sale');

    // A buyer without enough SOL sees the real reason (not a generic outage), and nothing is reserved or sent.
    balance = 1e8;
    r = await call('founders-mint', { tier: 'mythic', requestId: 'fb-0000000000000009' }, aliceCookie);
    assert.deepEqual([r.status, r.body.code], [503, 'SOL_GAS_INSUFFICIENT'], JSON.stringify(r.body));
    assert.match(r.body.error, /does not have enough (Devnet )?SOL/); assert.match(r.body.error, /No new payment was submitted/);
    r = await call('founders-info', {}, aliceCookie);
    assert.deepEqual([r.body.founders.tiers.mythic.reserved, r.body.founders.tiers.mythic.sold, r.body.founders.mine ?? null, sent.length], [0, 0, null, 0]);
    balance = 5e9;
    passed.push('insufficient buyer SOL shows the real reason; no reservation or broadcast');

    // Buy → the page reviews → wallet signs → server checks bytes and broadcasts → confirmed.
    r = await call('founders-mint', { tier: 'mythic', requestId: 'fb-0000000000000001' }, aliceCookie); assert.equal(r.status, 200, JSON.stringify(r.body));
    const wire = Buffer.from(r.body.purchase.wire, 'base64'), page = loadPage();
    assert.equal(r.body.purchase.price, 0.5, 'Mythic #1 is an early-bird box');
    assert.equal(page.review(new Uint8Array(wire), alice.wallet, 0.5, 'mythic'), true, 'the page accepts the exact server transaction');
    assert.throws(() => page.review(new Uint8Array(wire), alice.wallet, 1, 'mythic'), /price/);
    assert.throws(() => page.review(new Uint8Array(wire), key().wallet, 0.5, 'mythic'), /payer|paid/);
    assert.throws(() => page.review(new Uint8Array(wire), alice.wallet, 0.5, 'legacy'), /instruction/i);
    const tx = web3.Transaction.from(wire); tx.partialSign(alice.kp);
    const signed = tx.serialize().toString('base64'), sig = bs58.encode(tx.signatures.find(s => s.publicKey.equals(alice.kp.publicKey)).signature);
    assert(JSON.stringify({ action: 'founders-confirm', requestId: 'fb-0000000000000001', signed }).length < 4096, 'fits the portal request limit');
    r = await call('founders-confirm', { requestId: 'fb-0000000000000001', signed }, aliceCookie);
    assert.deepEqual([r.status, r.body.purchase.status, sent.length], [200, 'pending', 1]);
    statuses.set(sig, { confirmationStatus: 'finalized', err: null });
    r = await call('founders-confirm', { requestId: 'fb-0000000000000001' }, aliceCookie); assert.equal(r.body.purchase.status, 'confirmed');
    r = await call('founders-info', {}, aliceCookie); assert.equal(r.body.founders.mine.tier, 'mythic'); assert.equal(r.body.founders.tiers.mythic.sold, 1);
    r = await call('founders-mint', { tier: 'legacy', requestId: 'fb-0000000000000002' }, aliceCookie); assert.deepEqual([r.status, r.body.code], [409, 'FOUNDERS_WALLET_LIMIT']);
    passed.push('buy → page review (payer, exact price, tier memo) → wallet signature → server broadcast → confirmed; under 4 KB; one per wallet across tiers');

    // Private testing: only allowlisted wallets.
    const bob = key(), bobCookie = await cookieOf(bob);
    restart({ FOUNDERS_PRIVATE_TESTING_ENABLED: 'on', RYO_PRIVATE_TEST_WALLETS: alice.wallet });
    r = await call('founders-mint', { tier: 'legacy', requestId: 'fb-0000000000000003' }, bobCookie); assert.deepEqual([r.status, r.body.code], [403, 'FOUNDERS_PRIVATE']);
    assert.equal((await call('founders-info', {}, bobCookie)).body.founders.mode, 'private');
    passed.push('private testing sells only to RYO_PRIVATE_TEST_WALLETS');
  } finally { server.close(); }

  // Site host (pre-launch): public metadata and art; no traversal; no wallet data.
  const sitePort = 20000 + Math.floor(Math.random() * 20000), siteOrigin = 'http://localhost:' + sitePort;
  const child = spawn(process.execPath, ['server/site-server.cjs'], { cwd: root, env: { ...process.env, SOLANA_NETWORK: 'devnet', PRELAUNCH_MODE: 'on', RYO_SCOPE: SCOPE, DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none', HOST: '127.0.0.1', RYO_SITE_ORIGIN: siteOrigin, PORT: String(sitePort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  try {
    for (let i = 0; i < 100 && !log.includes('Website on'); i++) await new Promise(r => setTimeout(r, 100));
    const get = p => fetch('http://127.0.0.1:' + sitePort + p, { redirect: 'manual' });
    let r = await get('/founders/metadata/mythic-1.json'); assert.equal(r.status, 200);
    const md = await r.json(); assert.equal(md.name, 'Shinobi Bombers Founder Mythic #1'); assert.equal(md.image, siteOrigin + '/founders/art/mythic.png');
    assert.equal((await get('/founders/metadata/legacy-30.json')).status, 200);
    r = await get('/founders/metadata/mythic-33.json'); assert.equal(r.status, 200); assert.equal((await r.json()).name, 'Shinobi Bombers Founder Mythic #33');
    for (const p of ['/founders/metadata/mythic-34.json', '/founders/metadata/mythic-39.json', '/founders/metadata/legacy-31.json', '/founders/metadata/legacy-33.json', '/founders/metadata/mythic-0.json', '/founders/metadata/gold-1.json', '/founders/art/../server.cjs', '/founders/art/%2e%2e/server.cjs', '/founders/build-assets.cjs', '/founders/server.cjs', '/founders/assets/source/mythic.png'])
      assert.equal((await get(p)).status, 404, p);
    // Both approved images must be present in a clean release and match their public metadata URLs.
    for (const tier of ['mythic', 'legacy']) {
      r = await get('/founders/art/' + tier + '.png');
      assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png');
      const png = Buffer.from(await r.arrayBuffer());
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(png.readUInt32BE(16), 800); assert.equal(png.readUInt32BE(20), 800);
      assert.deepEqual(png, fs.readFileSync(path.join(root, 'founders/public/art/' + tier + '.png')));
    }
    assert.equal((await get('/founders/art/not-approved.png')).status, 404);
    r = await get('/founders/terms'); assert.deepEqual([r.status, r.headers.get('location')], [302, '/#founders']);
    const home = await (await get('/')).text(); assert.match(home, /id="founders"/); assert.match(home, /src="\/pl\/founders\.js"/);
    assert.equal((await get('/pl/founders.js')).status, 200); assert.equal((await get('/pl/assets/founders-comparison.webp')).status, 200);
    assert.equal((await get('/api/ryo')).status, 403, 'the game API stays closed in pre-launch');
    passed.push('site host: public metadata/art in pre-launch mode; no traversal or source files; game API still closed');
  } finally { child.kill(); }
  console.log('PASS: Founder boxes on the pre-landing page —\n  - ' + passed.join('\n  - '));
})().catch(e => { console.error(e); process.exit(1); });

function loadPage() {
  const src = fs.readFileSync(path.join(root, 'prelaunch/founders.js'), 'utf8');
  const labels = { 'err.payer': 'This transaction is not paid by your wallet.', 'err.program': 'Unexpected instruction in the transaction.', 'err.price': 'The price in the transaction does not match.' };
  const document = { readyState: 'complete', querySelector: s => { const k = /data-fd-text="([^"]+)"/.exec(s)?.[1]; return k && labels[k] ? { textContent: labels[k] } : null; }, querySelectorAll: () => [], addEventListener() {} };
  const box = { window: {}, document, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, TextDecoder, atob, btoa, crypto: globalThis.crypto, setTimeout, setInterval() {}, addEventListener() {}, dispatchEvent() {}, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, DataView, Uint8Array, BigInt };
  vm.createContext(box); vm.runInContext(src, box);
  return box.window.FoundersBox;
}
