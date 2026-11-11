/* Stage 1 "private live testing" (PRELAUNCH_MODE=on + RELEASE_STAGE=private) on the real site host, in-process,
 * with an in-memory Postgres. The pre-launch portal stays the public page byte for byte; every game path answers
 * exactly as in the portal-only stage unless the request carries a private pass for a live session of an
 * allowlisted wallet. Checked for anonymous visitors, signed-in non-allowlisted wallets (investors/players),
 * forged/revoked tokens, the portal cookie alone, encoded and doubled paths, and another Host header.
 * No real wallet, RPC or Render service is contacted. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http');
const { PGlite } = require('@electric-sql/pglite');
const ROOT = path.resolve(__dirname, '..'), APP_SERVER = path.join(ROOT, 'app/server');
const web3 = require(path.join(ROOT, 'app/node_modules/@solana/web3.js'));

function keyPair() {
  const kp = web3.Keypair.generate();
  const priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.slice(0, 32))]), format: 'der', type: 'pkcs8' });
  return { wallet: kp.publicKey.toBase58(), sign: msg => crypto.sign(null, Buffer.from(msg), priv).toString('base64') };
}

(async () => {
  // 0. The pass action does not exist without the hook (portal-only stage), and the cookie is strict when issued.
  {
    const { createPrelaunch } = require(path.join(ROOT, 'prelaunch/server.cjs'));
    const db = new PGlite(); await db.exec(fs.readFileSync(path.join(APP_SERVER, 'schema.sql'), 'utf8'));
    const pool = { query: (s, a) => db.query(s, a), connect: async () => ({ query: (s, a) => db.query(s, a), release() {} }) };
    const env = { SOLANA_NETWORK: 'devnet', RYO_SITE_ORIGIN: 'https://portal.example', RYO_SCOPE: 'solana-devnet:pt-unit' };
    const owner = keyPair();
    for (const [privateAccess, expect] of [[null, 404], [{ allowed: w => w === owner.wallet }, 200]]) {
      const portal = createPrelaunch({ gameDir: path.join(ROOT, 'app'), env, pool, privateAccess });
      const srv = http.createServer((q, s) => portal.handle(q, s)); await new Promise(r => srv.listen(0, '127.0.0.1', r));
      const call = (action, body = {}, cookie) => new Promise((resolve, reject) => {
        const data = JSON.stringify({ ...body, action }), headers = { 'content-type': 'application/json', origin: env.RYO_SITE_ORIGIN, 'x-sb-prelaunch': '1', 'content-length': Buffer.byteLength(data) };
        if (cookie) headers.cookie = cookie;
        const q = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/prelaunch', method: 'POST', headers }, s => { let t = ''; s.on('data', c => t += c); s.on('end', () => resolve({ status: s.statusCode, body: JSON.parse(t), cookie: s.headers['set-cookie']?.[0] || '' })); });
        q.on('error', reject); q.end(data);
      });
      try {
        const ch = await call('challenge', { wallet: owner.wallet }), login = await call('login', { wallet: owner.wallet, nonce: ch.body.nonce, signature: owner.sign(ch.body.message) });
        const r = await call('private-access', {}, login.cookie.split(';')[0]);
        assert.equal(r.status, expect, 'private-access with hook=' + !!privateAccess);
        if (!privateAccess) { assert.equal(r.body.code, 'UNKNOWN_ACTION'); assert.equal(r.cookie, ''); }
        else for (const flag of ['sb_pt=', 'Path=/;', 'HttpOnly', 'SameSite=Strict', 'Secure', 'Max-Age=3600']) assert.ok(r.cookie.includes(flag), 'pass cookie ' + flag);
        if (privateAccess) assert.equal((await call('private-access')).status, 401, 'no session, no pass');
      } finally { await new Promise(r => srv.close(r)); }
    }
  }

  // 1. The real site host in RELEASE_STAGE=private, PGlite standing in for the pg Pool (portal and game alike).
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(APP_SERVER, 'schema.sql'), 'utf8'));
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  class Pool { async query(s, a) { const r = await lock(); try { return await db.query(s, a); } finally { r(); } } async connect() { const r = await lock(); return { query: (s, a) => db.query(s, a), release: r }; } end() {} on() {} }
  require.cache[require.resolve('pg', { paths: [APP_SERVER] })] = { id: 'pg', loaded: true, exports: { Pool } };
  const owner = keyPair(), stranger = keyPair();
  const port = 20000 + Math.floor(Math.random() * 20000), ORIGIN = 'http://localhost:' + port;
  Object.assign(process.env, { SOLANA_NETWORK: 'devnet', PRELAUNCH_MODE: 'on', RELEASE_STAGE: 'private', RYO_PRIVATE_TEST_WALLETS: owner.wallet, RYO_SCOPE: 'solana-devnet:private-test', DATABASE_URL: 'postgres://pglite', RYO_SITE_ORIGIN: ORIGIN });
  for (const k of ['STARTER_PACK', 'GAME_RUNTIME_DIR', 'SHINOBI_VFX_LAB', 'SR_REVENUE_ROUTING_ENABLED']) delete process.env[k];
  // Owner-approved: private live testing may hold the complete money settings (throw-away keys here; no RPC is contacted).
  const treasury = web3.Keypair.generate();
  Object.assign(process.env, { RYO_TREASURY_SECRET: JSON.stringify([...treasury.secretKey]), RYO_TOKEN_MINT: web3.Keypair.generate().publicKey.toBase58(),
    RYO_STUDIO_WALLET: web3.Keypair.generate().publicKey.toBase58(), RYO_REVENUE_WALLET: web3.Keypair.generate().publicKey.toBase58() });
  const { server, prelaunch } = require(path.join(ROOT, 'server/site-server.cjs'));
  await new Promise(r => server.listen(port, '127.0.0.1', r));

  function request(p, { method = 'GET', cookie, host, body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const h = { ...headers }; if (cookie) h.cookie = cookie; if (host) h.host = host;
      if (body !== undefined) { h['content-type'] = h['content-type'] || 'application/json'; h['content-length'] = Buffer.byteLength(body); }
      const q = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, s => { const chunks = []; s.on('data', c => chunks.push(c)); s.on('end', () => resolve({ status: s.statusCode, headers: s.headers, text: Buffer.concat(chunks).toString('utf8') })); });
      q.on('error', reject); q.end(body);
    });
  }
  const portalApi = (action, body = {}, cookie) => request('/api/prelaunch', { method: 'POST', cookie, body: JSON.stringify({ ...body, action }), headers: { origin: ORIGIN, 'x-sb-prelaunch': '1' } })
    .then(r => ({ ...r, json: JSON.parse(r.text), setCookie: (r.headers['set-cookie'] || [])[0] || '' }));
  async function signIn(k) {
    const ch = await portalApi('challenge', { wallet: k.wallet }); assert.equal(ch.status, 200, ch.text);
    const login = await portalApi('login', { wallet: k.wallet, nonce: ch.json.nonce, signature: k.sign(ch.json.message) }); assert.equal(login.status, 200, login.text);
    return { portalCookie: login.setCookie.split(';')[0], token: decodeURIComponent(login.setCookie.split(';')[0].split('=')[1]) };
  }

  try {
    // Public pages: the portal, unchanged.
    const home = await request('/'); assert.equal(home.status, 200);
    assert.equal(home.text, fs.readFileSync(path.join(ROOT, 'prelaunch/index.html'), 'utf8'), 'anonymous visitors get the pre-landing page byte for byte');
    for (const p of ['/rules', '/privacy', '/terms', '/pl/wallet.js', '/play/assets/login-exact/login-reference.webp']) assert.equal((await request(p)).status, 200, p);
    assert.deepEqual(JSON.parse((await request('/healthz')).text), { status: 'ok', mode: 'prelaunch' });

    const S = await signIn(stranger), O = await signIn(owner);
    // The pass: no session → 401, a signed-in non-allowlisted wallet (player/investor) → 403 and no cookie.
    assert.equal((await portalApi('private-access')).status, 401);
    const denied = await portalApi('private-access', {}, S.portalCookie);
    assert.equal(denied.status, 403); assert.equal(denied.json.code, 'PRIVATE_TESTING'); assert.ok(!/sb_pt=/.test(denied.setCookie), 'no pass for a wallet outside the allowlist');
    const granted = await portalApi('private-access', {}, O.portalCookie);
    assert.equal(granted.status, 200); assert.match(granted.setCookie, /^sb_pt=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=3600/);
    const pass = granted.setCookie.split(';')[0];
    assert.equal((await request('/', { cookie: pass })).text, home.text, 'the owner sees the same portal at /');

    // A revoked session (logged out before first use) never opens the game.
    await new Promise(r => setTimeout(r, 3100));   // the store allows one login message per wallet every 3 s
    const O2 = await signIn(owner);
    await portalApi('logout', {}, O2.portalCookie);

    // Every game path is closed without a valid pass, with the portal's exact answers.
    const closed = [['/play/', 302, '/'], ['/play', 302, '/'], ['/play/index.html?referral=RPX', 302, '/?referral=RPX'], ['/%70lay/', 302, '/'], ['/play//', 302, '/'],
      ['/admin/', 404], ['/admin', 404], ['/admin/dashboard.js', 404], ['/admin/command-center/', 404], ['/admin/command-center/cc.js', 404], ['/admin/command-center/cc-report.js', 404], ['/beta-config.json', 404], ['/play/assets/beta-wallet.js', 404], ['/play/assets/creators-portal/portal.js', 404]];
    const visitors = { anonymous: undefined, 'non-allowlisted wallet': 'sb_pt=' + encodeURIComponent(S.token), 'portal cookie only': O.portalCookie,
      forged: 'sb_pt=' + 'A'.repeat(43), 'revoked session': 'sb_pt=' + encodeURIComponent(O2.token), 'garbage encoding': 'sb_pt=%E0%A4%A' };
    for (const [who, cookie] of Object.entries(visitors)) for (const host of [undefined, 'shinobibombers.onrender.com']) {
      for (const [p, status, location] of closed) {
        const r = await request(p, { cookie, host }); assert.equal(r.status, status, who + ' ' + p); if (location) assert.equal(r.headers.location, location, who + ' ' + p);
      }
      for (const p of ['/api/ryo', '/.netlify/functions/ryo']) for (const action of ['challenge', 'login', 'state', 'adventure', 'purchase', 'withdraw', 'admin-overview']) {
        const r = await request(p, { method: 'POST', cookie, host, body: JSON.stringify({ action, wallet: owner.wallet }), headers: { origin: ORIGIN } });
        assert.equal(r.status, 403, who + ' ' + p + ' ' + action); assert.equal(JSON.parse(r.text).code, 'PRELAUNCH', who + ' ' + p);
      }
    }

    // The allowlisted owner with a pass reaches the game page, the admin shell and the game API (on every host).
    for (const host of [undefined, 'shinobibombers.onrender.com']) {
      const page = await request('/play/', { cookie: pass, host }); assert.equal(page.status, 200, 'owner /play/'); assert.match(page.text, /<html/i);
      assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow');
      assert.equal((await request('/play', { cookie: pass, host })).status, 308);
      assert.equal((await request('/admin/', { cookie: pass, host })).status, 200);
      assert.equal((await request('/admin/command-center/', { cookie: pass, host })).status, 200, 'the Command Center shell follows the same private pass');
      assert.equal((await request('/%70lay/', { cookie: pass, host })).status, 404, 'an encoded mount path is never served from website/');
    }
    // The owner signs into the real game (its own wallet login, separate from the pass) through the gate.
    const gameApi = (body, cookie, host, extra = {}) => request('/api/ryo', { method: 'POST', cookie, host, body: JSON.stringify(body), headers: { origin: ORIGIN, ...extra } }).then(r => ({ status: r.status, json: JSON.parse(r.text) }));
    const gch = await gameApi({ action: 'challenge', wallet: owner.wallet }, pass);
    assert.equal(gch.status, 200, JSON.stringify(gch.json)); assert.match(gch.json.message, /requests a Shinobi Ryo beta login/);
    const glogin = await gameApi({ action: 'login', wallet: owner.wallet, nonce: gch.json.nonce, signature: owner.sign(gch.json.message) }, pass);
    assert.equal(glogin.status, 200, JSON.stringify(glogin.json)); assert.equal(typeof glogin.json.token, 'string', 'the owner gets a game session');
    const viaAlt = await gameApi({ action: 'login', wallet: owner.wallet, nonce: 'x', signature: 'A'.repeat(88) }, pass, 'shinobibombers.onrender.com');
    assert.equal(viaAlt.status, 401, 'the game itself answers on the other hostname too'); assert.notEqual(viaAlt.json.code, 'PRELAUNCH');
    // A signed-in, non-allowlisted wallet's session never passes the gate, whatever action it asks for.
    assert.equal((await gameApi({ action: 'challenge', wallet: stranger.wallet }, 'sb_pt=' + encodeURIComponent(S.token))).json.code, 'PRELAUNCH');

    // The owner's sign-in page exists only in this stage; it is noindex with a strict CSP.
    const pt = await request('/private-test'); assert.equal(pt.status, 200); assert.equal(pt.headers['x-robots-tag'], 'noindex, nofollow'); assert.match(pt.headers['content-security-policy'], /default-src 'none'/);
    assert.equal((await request('/private-test/private-access.js')).status, 200);
    assert.equal((await request('/private-test/../server/site-server.cjs')).status, 404, 'traversal is normalised away, never a file');
    assert.equal((await request('/private-test/missing.js')).status, 404);
    assert.equal((await request('/private-test', { method: 'POST', body: '{}' })).status, 405);
    console.log('PASS: private live testing — portal unchanged for everyone, game page/API/admin closed (same answers as pre-launch) for anonymous, non-allowlisted, forged, revoked and portal-only requests on every host and path form; allowlisted owner gets in; owner page only in this stage.');
  } finally { await new Promise(r => server.close(r)); await prelaunch.close(); }
})().catch(e => { console.error(e); process.exit(1); });
