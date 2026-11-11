'use strict';
/* Admin Control panel (control/server.cjs + feature-switches.cjs) over real HTTP with an in-memory Postgres and real
 * wallet signatures: admin-only sign-in, same-origin/CSRF/JSON rules, one-wallet changes with versions, the hash-chained
 * log, reset to the environment, FEATURE_PANEL_DISABLED, and the game gates / Founder switches following the panel.
 * Environment defaults are unchanged when nothing is set in the panel. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const app = path.join(__dirname, '..', 'app');
const FS = require('../app/server/feature-switches.cjs'), gates = require('../app/server/launch-gates.cjs'), founders = require('../app/server/founders.cjs');
const { createControl } = require('../control/server.cjs');
const ORIGIN = 'https://control.example', SCOPE = 'solana-devnet:control-test';

const key = () => { const kp = web3.Keypair.generate(); const priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.slice(0, 32))]), format: 'der', type: 'pkcs8' });
  return { wallet: kp.publicKey.toBase58(), sign: m => crypto.sign(null, Buffer.from(m), priv).toString('base64') }; };

(async () => {
  const passed = [];
  // ---- Environment rules are exactly the previous gate rules (test-server build: money ON unless set off).
  for (const [gate, name] of Object.entries(gates.GATES)) {
    assert.equal(gates.isOn(gate, {}), true, gate + ' default on the test server');
    assert.equal(gates.isOn(gate, { [name]: 'off' }), false, gate + ' off'); assert.equal(gates.isOn(gate, { [name]: 'on' }), true, gate + ' on');
  }
  assert.equal(founders.switches({}).publicSale, false, 'Founder switches fail closed by default');
  assert.equal(founders.switches({ FOUNDERS_PUBLIC_SALE_ENABLED: 'on' }).publicSale, true);
  passed.push('environment rules unchanged when the panel sets nothing (money gates, gameplay gates, Founder switches fail closed)');

  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(app, 'server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } },
    async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const owner = key(), approver = key(), viewer = key(), stranger = key(), operator = key();
  const founderWallet = key().wallet;
  const env = { RYO_SITE_ORIGIN: ORIGIN, RYO_SCOPE: SCOPE, SOLANA_NETWORK: 'devnet', RYO_ADMIN_OWNERS: owner.wallet, RYO_ADMIN_APPROVERS: approver.wallet, RYO_ADMIN_OPERATORS: operator.wallet, RYO_ADMIN_VIEWERS: viewer.wallet, FOUNDERS_REVENUE_WALLET: founderWallet };
  let clock = Date.now();
  const control = createControl({ gameDir: app, env, pool, now: () => clock }); await control.init();
  const server = http.createServer((req, res) => { const name = new URL(req.url, 'http://x').pathname; if (name === '/api/control') return control.handle(req, res); if (!control.page(req, res, name)) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let ipN = 0;
  const call = (action, body = {}, cookie, headers = {}) => new Promise((resolve, reject) => {
    const data = JSON.stringify({ ...body, action }), h = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), origin: ORIGIN, 'x-sb-control': '1', 'x-forwarded-for': '10.9.' + (++ipN >> 8 & 255) + '.' + (ipN & 255), ...headers };
    if (cookie) h.cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/control', method: 'POST', headers: h }, res => { let t = ''; res.on('data', c => t += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(t || '{}'), cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] })); });
    req.on('error', reject); req.end(data);
  });
  const get = p => new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port: server.address().port, path: p }, res => { let t = ''; res.on('data', c => t += c); res.on('end', () => resolve({ status: res.statusCode, text: t, headers: res.headers })); }).on('error', reject); });
  // Fresh wallet confirmation for opening a money/Founder feature: 'confirm' → sign the returned message.
  const confirmFor = async (k, cookie, keyName, enabled, expectedVersion) => { const c = await call('confirm', { key: keyName, enabled, expectedVersion }, cookie); assert.equal(c.status, 200, JSON.stringify(c.body)); return { message: c.body.message, nonce: c.body.nonce, signature: k.sign(c.body.message) }; };
  const signIn = async k => { const ch = await call('challenge', { wallet: k.wallet }); assert.equal(ch.status, 200, JSON.stringify(ch.body)); const r = await call('login', { wallet: k.wallet, nonce: ch.body.nonce, signature: k.sign(ch.body.message) }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r; };
  try {
    // ---- Page and request rules.
    let p = await get('/admin/control/'); assert.equal(p.status, 200); assert.match(p.headers['content-security-policy'], /default-src 'none'/); assert.equal(p.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal((await get('/admin/control/wallet.js')).status, 200, 'the reviewed wallet connector is served');
    assert.equal((await get('/admin/control')).status, 308);
    assert.equal((await call('state', {}, null, { origin: 'https://evil.example' })).status, 403, 'other origins refused');
    assert.equal((await call('state', {}, null, { 'x-sb-control': '' })).status, 403, 'custom header required');
    assert.equal((await call('state')).status, 401, 'sign-in required');
    // No role leak: a stranger gets the same answer shape as an admin, but nothing is stored and the login fails.
    const sc = await call('challenge', { wallet: stranger.wallet }), ac = await call('challenge', { wallet: approver.wallet });
    assert.deepEqual([sc.status, Object.keys(sc.body).sort()], [ac.status, Object.keys(ac.body).sort()], 'same challenge answer for admins and non-admins');
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM ryo_control_challenges WHERE scope=$1 AND wallet=$2', [SCOPE, stranger.wallet])).rows[0].n, 1, 'every wallet gets the same work (stored like an admin challenge)');
    const sl = await call('login', { wallet: stranger.wallet, nonce: sc.body.nonce, signature: stranger.sign(sc.body.message) });
    assert.deepEqual([sl.status, sl.body.code], [401, 'SIGNATURE_INVALID'], 'a correctly signed non-admin login is refused with the generic answer');
    assert.equal(p.headers['strict-transport-security'], 'max-age=31536000', 'HSTS on the https origin');
    for (const chunked of [false, true]) {
      // With a Content-Length header, and streamed without one (the body is cut off as soon as it passes 4 KB).
      const big = await new Promise((resolve, reject) => { const data = JSON.stringify({ action: 'state', pad: 'x'.repeat(6000) });
        const h = { 'content-type': 'application/json', origin: ORIGIN, 'x-sb-control': '1' }; if (!chunked) h['content-length'] = Buffer.byteLength(data);
        const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/control', method: 'POST', headers: h }, res => { got = res.statusCode; res.resume(); res.on('end', () => resolve(got)); res.on('error', () => resolve(got)); });
        let got; req.on('error', e => got ? resolve(got) : reject(e));
        if (chunked) { req.write(data.slice(0, 3000)); setTimeout(() => req.end(data.slice(3000)), 50); } else req.end(data); });
      assert.equal(big, 413, 'oversized request refused at once' + (chunked ? ' (streamed)' : ''));
    }
    assert.equal((await call('state', {}, null, { 'content-type': 'text/plain' })).status, 403, 'JSON content type required');
    passed.push('page served with strict CSP/noindex/HSTS; same origin + X-SB-Control + JSON + 4 KB limit + sign-in required; every wallet gets the same challenge work but non-admins can never sign in');

    // ---- Sign-in: real signature, nonce single use, replay refused.
    const ch = await call('challenge', { wallet: approver.wallet }), sig = approver.sign(ch.body.message);
    assert.match(ch.body.message, /^control\.example wants you to sign in with your Solana account:\n/);
    const login = await call('login', { wallet: approver.wallet, nonce: ch.body.nonce, signature: sig }); assert.equal(login.status, 200);
    assert.notEqual((await call('login', { wallet: approver.wallet, nonce: ch.body.nonce, signature: sig })).status, 200, 'replayed signature refused');
    assert.notEqual((await call('login', { wallet: approver.wallet, nonce: (await call('challenge', { wallet: approver.wallet })).body.nonce, signature: stranger.sign('x') })).status, 200, 'wrong signature refused');
    const A = login.cookie; assert.match(A, /^sb_control=/);
    let st = (await call('state', {}, A)).body; assert.equal(st.role, 'approver'); assert.equal(st.canWrite, true);
    const sw = k => st.switches.find(s => s.key === k);
    assert.deepEqual([sw('summoning').effective, sw('summoning').source, sw('summoning').panel], [true, 'default', null]);
    passed.push('wallet sign-in with the site message: single-use nonce, replay and forged signatures refused, approver can write');

    // ---- The panel's sessions and challenges are its own (no sharing with the game or portal sign-in).
    { const { Store } = require('../app/server/store.cjs'), game = new Store(pool, SCOPE);
      const gNonce = crypto.randomBytes(16).toString('hex'); await game.challenge(approver.wallet, 'game login message', gNonce);
      await call('challenge', { wallet: approver.wallet });   // a panel challenge for the same wallet...
      const gs = await game.login(approver.wallet, gNonce, () => true);   // ...does not replace the pending game login
      assert.equal((await call('state', {}, 'sb_control=' + encodeURIComponent(gs.token))).status, 401, 'a game/portal session never opens the panel');
      const panelToken = decodeURIComponent(A.split('=')[1]);
      await assert.rejects(game.authenticate(panelToken), 'a panel session never opens the game');
      const row = (await db.query('SELECT created,expires FROM ryo_control_sessions WHERE scope=$1 AND wallet=$2 ORDER BY created DESC LIMIT 1', [SCOPE, approver.wallet])).rows[0];
      assert.equal(Number(row.expires) - Number(row.created), 8 * 3600000, 'panel sessions last 8 hours');
      assert.match(login.cookie, /^sb_control=/); }
    passed.push('own sessions and challenges: game/portal sessions never open the panel, panel sessions never open the game, a panel challenge never replaces a game login; 8-hour sessions');

    // ---- Rate limit keyed on the rightmost X-Forwarded-For entry (the one Render appends).
    { let last; for (let i = 0; i < 11; i++) last = await call('challenge', { wallet: viewer.wallet }, null, { 'x-forwarded-for': '198.51.100.' + i + ', 203.0.113.77' });
      assert.equal(last.status, 429, 'a forged leftmost address does not escape the per-address limit'); }
    passed.push('rate limits use the rightmost X-Forwarded-For address');
    // Requests for more challenges for an admin wallet (from many addresses) never push out its pending sign-in.
    { const first = await call('challenge', { wallet: owner.wallet });
      for (let i = 0; i < 15; i++) { clock += 1; await call('challenge', { wallet: owner.wallet }); }
      const r1 = await call('login', { wallet: owner.wallet, nonce: first.body.nonce, signature: owner.sign(first.body.message) });
      assert.equal(r1.status, 200, 'the first pending sign-in still works after 15 more challenges: ' + JSON.stringify(r1.body)); }
    passed.push('pending admin sign-ins are never evicted by challenge floods');

    // ---- One-wallet change, audited; the game gate follows.
    assert.equal((await call('set', { key: 'summoning', enabled: false, reason: 'short', expectedVersion: 0 }, A)).status, 400, 'reason required');
    let r = await call('set', { key: 'summoning', enabled: false, reason: 'Roadmap: summons open with phase 2', expectedVersion: 0 }, A);
    assert.equal(r.status, 200, JSON.stringify(r.body)); st = r.body;
    assert.deepEqual([sw('summoning').effective, sw('summoning').source, sw('summoning').version], [false, 'panel', 1]);
    assert.equal(gates.isOn('summoning', {}), false, 'the game gate follows the panel'); assert.equal(gates.publicGates({}).summoning, false);
    assert.throws(() => gates.check('purchase', { product: 'summon' }, {}), e => e.code === 'LAUNCH_GATE_CLOSED');
    assert.equal((await call('set', { key: 'summoning', enabled: true, reason: 'Second admin racing the first', expectedVersion: 0, ...(await confirmFor(approver, A, 'summoning', true, 0)) }, A)).status, 409, 'stale version refused');
    assert.deepEqual([(r = await call('set', { key: 'summoning', enabled: false, reason: 'Malformed version attempt', expectedVersion: 'x' }, A)).status, r.body.code], [400, 'BAD_VERSION'], 'malformed version is not reported as another admin');
    { const saved = env.FOUNDERS_REVENUE_WALLET; delete env.FOUNDERS_REVENUE_WALLET;
      r = await call('set', { key: 'foundersPublicSale', enabled: true, reason: 'Founder sale opens for the roadmap', expectedVersion: 0 }, A);
      assert.deepEqual([r.status, r.body.code], [409, 'FOUNDERS_WALLET'], 'no Founder sale without its SOL wallet');
      for (const k of ['senseiSol', 'foundersPrivateTesting']) {
        env.FOUNDERS_REVENUE_WALLET = 'not-a-wallet'; r = await call('confirm', { key: k, enabled: true, expectedVersion: 0 }, A);
        assert.deepEqual([r.status, r.body.code], [409, 'FOUNDERS_WALLET'], k + ': an invalid Founder SOL wallet is refused before any confirmation');
      }
      env.FOUNDERS_REVENUE_WALLET = saved; }
    // Opening a money/Founder feature needs a fresh signature over exactly that change.
    const open = { key: 'foundersPublicSale', enabled: true, reason: 'Founder sale opens for the roadmap', expectedVersion: 0 };
    assert.deepEqual([(r = await call('set', open, A)).status, r.body.code], [428, 'CONFIRM_SIGNATURE'], 'a session alone cannot open a money/Founder feature');
    { const lc = await call('challenge', { wallet: approver.wallet });
      r = await call('set', { ...open, nonce: lc.body.nonce, signature: approver.sign(lc.body.message) }, A);
      assert.deepEqual([r.status, r.body.code], [403, 'CONFIRM_SIGNATURE'], 'a sign-in signature never confirms a change');
      const other = await confirmFor(approver, A, 'withdrawals', true, 0);
      assert.match(other.message, /\nConfirm in the Shinobi Bombers Control panel: turn ON SR withdrawals\. This is free/);
      r = await call('set', { ...open, nonce: other.nonce, signature: other.signature }, A);
      assert.deepEqual([r.status, r.body.code], [403, 'CONFIRM_SIGNATURE'], 'a confirmation for another switch is refused');
      const wrong = await confirmFor(approver, A, 'foundersPublicSale', true, 0);
      r = await call('set', { ...open, nonce: wrong.nonce, signature: stranger.sign(wrong.message) }, A);
      assert.deepEqual([r.status, r.body.code], [403, 'CONFIRM_SIGNATURE'], 'a confirmation signed by another wallet is refused');
      const late = await confirmFor(approver, A, 'foundersPublicSale', true, 0); clock += 120001;
      r = await call('set', { ...open, nonce: late.nonce, signature: late.signature }, A); clock -= 120001;
      assert.deepEqual([r.status, r.body.code], [403, 'CONFIRM_SIGNATURE'], 'an expired confirmation is refused');
      assert.equal((await call('confirm', { key: 'chat', enabled: true, expectedVersion: 0 }, A)).status, 400, 'gameplay switches need no confirmation'); }
    const proof = await confirmFor(approver, A, 'foundersPublicSale', true, 0);
    assert.equal((await call('set', { ...open, reason: 'x'.repeat(301), ...proof }, A)).status, 400, 'too long a reason is refused...');
    assert.deepEqual([(r = await call('set', { ...open, expectedVersion: 5, ...proof }, A)).status, r.body.code], [409, 'STALE'], '...and so is a stale view...');
    r = await call('set', { ...open, ...proof }, A); assert.equal(r.status, 200, '...without using up the confirmation: ' + JSON.stringify(r.body));
    assert.deepEqual([(r = await call('set', { ...open, expectedVersion: 1, ...proof }, A)).status, r.body.code], [403, 'CONFIRM_SIGNATURE'], 'a confirmation is single use');
    assert.equal(founders.switches({}).publicSale, true, 'Founder sale follows the panel'); assert.equal(founders.saleMode({}), 'public');
    r = await call('set', { key: 'chat', enabled: false, reason: 'Pause chat during maintenance', expectedVersion: 0 }, A); assert.equal(r.status, 200);
    assert.throws(() => gates.check('chat-send', {}, {}), e => e.gate === 'chat');
    assert.equal((await call('set', { key: 'nonsense', enabled: true, reason: 'Unknown switch attempt', expectedVersion: 0 }, A)).status, 400);
    passed.push('one admin wallet opens/closes a switch with a reason; game gates and Founder sale follow; stale/malformed versions and unknown switches refused');
    passed.push('opening a money/Founder feature needs a fresh, single-use, 2-minute signature by the signed-in admin over exactly that change (sign-in, other-switch, other-wallet and expired signatures refused); closing stays one step');

    // ---- Viewer and operator are read-only.
    for (const k of [viewer, operator]) {
      const V = (await signIn(k)).cookie;
      assert.equal((await call('state', {}, V)).body.canWrite, false);
      assert.equal((await call('set', { key: 'summoning', enabled: false, reason: 'Read-only role should not write', expectedVersion: 1 }, V)).status, 403);
      assert.equal((await call('confirm', { key: 'summoning', enabled: true, expectedVersion: 1 }, V)).status, 403);
    }
    passed.push('viewer and operator wallets see the panel but cannot change it');

    // ---- Reset to the environment (ON here, so it is an opening and needs a confirmation); emergency kill switch.
    assert.equal((await call('clear', { key: 'summoning', reason: 'Back to the Render setting', expectedVersion: 1 }, A)).status, 428, 'reset to an ON Render value needs a confirmation');
    { const c = await confirmFor(approver, A, 'summoning', null, 1); assert.match(c.message, /reset to Render \(ON\) Hero summoning \(SR\)\./);
      r = await call('clear', { key: 'summoning', reason: 'Back to the Render setting', expectedVersion: 1, nonce: c.nonce, signature: c.signature }, A); assert.equal(r.status, 200, JSON.stringify(r.body)); }
    assert.equal(gates.isOn('summoning', {}), true, 'reset returns to the environment rule');
    assert.equal(founders.switches({ FEATURE_PANEL_DISABLED: 'on' }).publicSale, false, 'FEATURE_PANEL_DISABLED ignores the panel');
    assert.equal(gates.isOn('chat', { FEATURE_PANEL_DISABLED: 'on' }), true);
    env.FEATURE_PANEL_DISABLED = 'on';
    r = await call('set', { key: 'chat', enabled: true, reason: 'Change while the panel is off', expectedVersion: 1 }, A);
    assert.deepEqual([r.status, r.body.code], [409, 'PANEL_DISABLED'], 'no change is saved while FEATURE_PANEL_DISABLED=on');
    delete env.FEATURE_PANEL_DISABLED;
    passed.push('reset returns to the Render rule; FEATURE_PANEL_DISABLED=on ignores every panel value and refuses changes');

    // ---- Hash-chained log, newest first.
    const log = (await call('log', {}, A)).body.log;
    assert.deepEqual(log.map(x => [x.key, x.enabled]), [['summoning', null], ['chat', false], ['foundersPublicSale', true], ['summoning', false]]);
    assert(log.every(x => x.linked && /^[0-9a-f]{64}$/.test(x.hash) && x.actor === approver.wallet));
    const rows = (await db.query("SELECT seq,prev_hash,hash FROM ryo_feature_switch_log WHERE scope=$1 ORDER BY seq", [SCOPE])).rows;
    assert.equal(rows[0].prev_hash, 'genesis'); for (let i = 1; i < rows.length; i++) assert.equal(rows[i].prev_hash, rows[i - 1].hash);
    passed.push('every change is in an append-only hash-chained log with actor and reason');

    // ---- Database trouble keeps the last good values (no silent reopening).
    const before = gates.isOn('chat', {}), broken = { query: async () => { throw Error('db down'); } };
    assert.equal(await FS.load(broken, SCOPE), false); assert.equal(gates.isOn('chat', {}), before, 'last good values kept');
    passed.push('database errors keep the last good panel values');

    // ---- A wallet removed from the admin lists loses access at once; sessions expire after 8 hours.
    { const V2 = (await signIn(viewer)).cookie, saved = env.RYO_ADMIN_VIEWERS; env.RYO_ADMIN_VIEWERS = '';
      assert.equal((await call('state', {}, V2)).status, 403, 'role re-checked on every request'); env.RYO_ADMIN_VIEWERS = saved;
      clock += 8 * 3600000 + 1; assert.equal((await call('state', {}, V2)).status, 401, 'expired after 8 hours'); clock -= 8 * 3600000 + 1; }
    passed.push('removed admin wallets lose access immediately; sessions expire after 8 hours');

    // ---- Sign-out.
    assert.equal((await call('logout', {}, A)).status, 200); assert.equal((await call('state', {}, A)).status, 401);
  } finally { FS.stop(); server.close(); }

  // ---- Before the first successful load (fresh process, database never answers): money and Founder switches are
  // closed even when Render says ON; gameplay screens keep their default.
  { const { spawnSync } = require('node:child_process');
    const code = `const FS=require(${JSON.stringify(path.join(app, 'server/feature-switches.cjs'))});FS.start({query:()=>new Promise(()=>{})},'s');
      const env={SOL_WITHDRAWALS_ENABLED:'on',FOUNDERS_PUBLIC_SALE_ENABLED:'on',CHAT_ENABLED:'on'};
      console.log(JSON.stringify([FS.isLoaded(),FS.effective('withdrawals',env),FS.effective('foundersPublicSale',env),FS.effective('chat',env),FS.effective('withdrawals',{...env,FEATURE_PANEL_DISABLED:'on'})]));FS.stop();`;
    const out = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 20000 });
    assert.deepEqual(JSON.parse(out.stdout.trim()), [false, false, false, true, true], out.stderr); }
  passed.push('before the first load money and Founder switches stay closed (gameplay keeps its default; FEATURE_PANEL_DISABLED returns to Render)');
  console.log('PASS: admin Control panel —\n  - ' + passed.join('\n  - '));
})().catch(e => { console.error(e); process.exit(1); });
