/* Pre-launch Treasury panel API (POST /api/prelaunch action "treasury-admin") over real HTTP with real wallet
 * sign-in: admin allowlist only, read-only, finalized verification from captured public Squads bytes (mocked RPC),
 * Devnet portals never contact Mainnet. Then the beta (Devnet) site host does not serve /treasury at all. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http');
const { spawnSync } = require('node:child_process');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const root = path.resolve(__dirname, '..'), app = path.join(root, 'app');
const { createPrelaunch } = require('../prelaunch/server.cjs'), fixture = require('./fixtures/squads-treasury-multisig.json');
const V = require('../app/server/treasury-verify.cjs'), reg = require('../app/server/treasury-registry.cjs').registry();
const ORIGIN = 'https://portal.example';
function keyPair() {
  const kp = web3.Keypair.generate(), priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.slice(0, 32))]), format: 'der', type: 'pkcs8' });
  return { wallet: kp.publicKey.toBase58(), sign: msg => crypto.sign(null, Buffer.from(msg), priv).toString('base64') };
}
async function portalServer(env, options) {
  const db = new PGlite(), schema = fs.readFileSync(path.join(app, 'server/schema.sql'), 'utf8'); await db.exec(schema);
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const portal = createPrelaunch({ gameDir: app, env: { RYO_SITE_ORIGIN: ORIGIN, ...env }, pool, ...options });
  const server = http.createServer((req, res) => portal.handle(req, res)); await new Promise(r => server.listen(0, '127.0.0.1', r));
  let ip = 0;
  const call = (action, body = {}, cookie) => new Promise((resolve, reject) => {
    const data = JSON.stringify({ ...body, action }), headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), origin: ORIGIN, 'x-sb-prelaunch': '1', 'x-forwarded-for': '10.1.0.' + (++ip % 250 + 1) };
    if (cookie) headers.cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/prelaunch', method: 'POST', headers }, res => { let t = ''; res.on('data', c => t += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(t || 'null'), setCookie: res.headers['set-cookie']?.[0] || null })); });
    req.on('error', reject); req.end(data);
  });
  const signIn = async k => { const ch = await call('challenge', { wallet: k.wallet }); const login = await call('login', { wallet: k.wallet, nonce: ch.body.nonce, signature: k.sign(ch.body.message) }); assert.equal(login.status, 200, JSON.stringify(login.body)); return login.setCookie.split(';')[0]; };
  return { call, signIn, pool, close: async () => { await new Promise(r => server.close(r)); await db.close(); } };
}
(async () => {
  const admin = keyPair(), player = keyPair(); let rpc = 0;
  process.env.RYO_ADMIN_VIEWERS = admin.wallet; process.env.RYO_ADMIN_OPERATORS = ''; process.env.RYO_ADMIN_APPROVERS = '';
  const accounts = new Map([[reg.squads.multisig, { owner: new web3.PublicKey(fixture.owner), data: Buffer.from(fixture.dataBase64, 'base64'), lamports: fixture.lamports }], [reg.addresses.lockedTreasury, { owner: web3.SystemProgram.programId, data: Buffer.alloc(0), lamports: fixture.vault.lamports }]]);
  const connection = { async getGenesisHash() { rpc++; return V.MAINNET_GENESIS; }, async getAccountInfo(k) { return accounts.get(k.toBase58()) || null; } };

  // 1. Live (Mainnet) pre-launch portal.
  const live = await portalServer({ SOLANA_NETWORK: 'mainnet', RYO_SCOPE: 'solana-mainnet:treasury-test' }, { treasuryConnection: connection });
  try {
    assert.equal((await live.call('treasury-admin')).status, 401, 'sign-in required');
    const playerCookie = await live.signIn(player), denied = await live.call('treasury-admin', {}, playerCookie);
    assert.equal(denied.status, 403); assert.equal(denied.body.code, 'ADMIN_ONLY');
    const cookie = await live.signIn(admin), ok = await live.call('treasury-admin', {}, cookie), d = ok.body;
    assert.equal(ok.status, 200, JSON.stringify(d)); assert.equal(d.role, 'viewer'); assert.equal(d.readOnly, true); assert.equal(d.applicable, true);
    assert.equal(d.verification.status, 'verified'); assert.equal(d.verification.squads.threshold, 2); assert.deepEqual(d.squads.members, reg.squads.members);
    assert.deepEqual(d.registry.destinations.map(x => x.address), Object.values(reg.addresses));
    assert.equal(d.paymentsEnabled, false); assert.equal(d.claimFunding.status, 'not-configured'); assert.equal(d.claimFunding.availableRyo, null); assert.equal(d.verification.externalHeld.status, 'pending');
    assert.equal(d.flags.srRouting, false); assert.equal(d.flags.activationApproved, false); assert.equal(d.flags.mintRegistered, false); assert(Object.values(d.flags.gates).every(g => g === false), 'every money gate closed in pre-launch');
    assert.deepEqual(d.ledgers.serviceRevenue, { count: 0, raw: '0' }); assert.deepEqual(d.ledgers.withdrawalDeductions, { count: 0, raw: '0' }); assert.deepEqual(d.ledgers.proposals, { pending: 0, total: 0 });
    // Bounded RPC: repeat views reuse the cached finalized snapshot.
    const before = rpc; await live.call('treasury-admin', {}, cookie); await live.call('treasury-admin', {}, cookie); assert.equal(rpc, before, 'cached for 60 s');
    // No write path exists on the portal for treasury data.
    for (const action of ['treasury-transfer', 'treasury-propose', 'treasury-admin-action']) assert.equal((await live.call(action, {}, cookie)).status, 404, action);
  } finally { await live.close(); }

  // 2. Devnet (test server) portal: the Mainnet registry is described but never verified from there.
  const beta = await portalServer({ SOLANA_NETWORK: 'devnet', RYO_SCOPE: 'solana-devnet:treasury-test' }, { treasuryConnection: { getGenesisHash() { throw Error('a Devnet portal must not read Mainnet treasury data'); } } });
  try { const cookie = await beta.signIn(admin), d = (await beta.call('treasury-admin', {}, cookie)).body; assert.equal(d.applicable, false); assert.equal(d.verification, undefined); assert.match(d.note, /live Mainnet server/); }
  finally { await beta.close(); }

  // 3. The beta site host does not serve the transparency page or JSON.
  const probe = `(async()=>{const assert=require('node:assert/strict'),{server}=require('./server/site-server.cjs');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;try{for(const p of ['/treasury','/treasury/treasury.js','/treasury-registry.json'])assert.equal((await fetch(base+p)).status,404,p);}finally{await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1});`;
  const run = spawnSync(process.execPath, ['-e', probe], { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, SOLANA_NETWORK: 'devnet', PRELAUNCH_MODE: '', GAME_RUNTIME_DIR: app } });
  assert.equal(run.status, 0, run.stderr);
  console.log('PASS: pre-launch Treasury panel — sign-in + admin allowlist, read-only finalized Squads verification, closed money gates, ledger counts, cached RPC, no write actions, Devnet never reads Mainnet; beta host serves no /treasury.');
})().catch(e => { console.error(e); process.exitCode = 1; });
