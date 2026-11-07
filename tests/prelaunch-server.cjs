/* Pre-launch portal API on the real store (in-memory Postgres) over real HTTP: Sign-In With Solana login
 * (bad/replayed/expired signatures), HttpOnly cookie sessions, CSRF/origin checks, registration (idempotent,
 * unique usernames), referral attribution and its refusals, the dashboard, preferences, leaderboard privacy,
 * logout, rate limits, restart persistence and concurrency. Then the site host in PRELAUNCH_MODE: every
 * game/money endpoint is closed and the start-up guard refuses unsafe settings. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const root = path.resolve(__dirname, '..'), app = path.join(root, 'app');
const { createPrelaunch, COOKIE } = require('../prelaunch/server.cjs');
const ORIGIN = 'https://portal.example', SCOPE = 'solana-devnet:prelaunch-test';

function keyPair() {
  const kp = web3.Keypair.generate();
  const priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.slice(0, 32))]), format: 'der', type: 'pkcs8' });
  return { wallet: kp.publicKey.toBase58(), sign: msg => crypto.sign(null, Buffer.from(msg), priv).toString('base64') };
}

(async () => {
  const db = new PGlite(), schema = fs.readFileSync(path.join(app, 'server/schema.sql'), 'utf8'); await db.exec(schema); await db.exec(schema);
  let tail = Promise.resolve();
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  let clock = Date.UTC(2026, 10, 7, 12);
  const env = { SOLANA_NETWORK: 'devnet', RYO_SITE_ORIGIN: ORIGIN, RYO_SCOPE: SCOPE, DISCORD_URL: 'https://discord.gg/example', X_URL: 'javascript:alert(1)', SUPPORT_URL: 'mailto:support@example.com', DEMO_URL: 'https://shinobi-bombers-beta.onrender.com/', LAUNCH_AT: 'not a date' };
  let portal = createPrelaunch({ gameDir: app, env, pool, now: () => clock });
  const server = http.createServer((req, res) => portal.handle(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  let ipSerial = 0;
  function call(action, body = {}, { cookie, origin = ORIGIN, header = '1', method = 'POST', ip = '10.0.0.' + (++ipSerial % 250 + 1), raw } = {}) {
    return new Promise((resolve, reject) => {
      const data = raw ?? JSON.stringify({ ...body, action });
      const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-forwarded-for': '203.0.113.9, ' + ip };
      if (origin) headers.origin = origin; if (header) headers['x-sb-prelaunch'] = header; if (cookie) headers.cookie = cookie;
      const req = http.request({ host: '127.0.0.1', port, path: '/api/prelaunch', method, headers }, res => {
        let text = ''; res.on('data', c => text += c); res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, body: json, setCookie: res.headers['set-cookie']?.[0] || null }); });
      });
      req.on('error', reject); req.end(data);
    });
  }
  async function signIn(k) {
    const ch = await call('challenge', { wallet: k.wallet }); assert.equal(ch.status, 200, JSON.stringify(ch.body));
    const login = await call('login', { wallet: k.wallet, nonce: ch.body.nonce, signature: k.sign(ch.body.message) });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    return { cookie: login.setCookie.split(';')[0], me: login.body, raw: login.setCookie, message: ch.body.message };
  }

  try {
    // Public status: links are https-only (javascript: rejected), mailto allowed for support, no invented launch date.
    const st = await call('status'); assert.equal(st.status, 200);
    assert.equal(st.body.prelaunch, true); assert.equal(st.body.launchAt, null);
    assert.equal(st.body.links.discord, 'https://discord.gg/example'); assert.equal(st.body.links.x, null); assert.equal(st.body.links.support, 'mailto:support@example.com');
    assert.equal(st.body.links.demo, 'https://shinobi-bombers-beta.onrender.com/', 'the demo (test server) link is published');
    assert.ok(st.body.announcements.length >= 1); assert.deepEqual(st.body.referralProgram, { paidHeroes: 15, clearedStage: 5, heroesPerReferral: 2, bound: true });

    // CSRF / request shape.
    assert.equal((await call('status', {}, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await call('status', {}, { origin: null })).status, 403);
    assert.equal((await call('status', {}, { header: null })).status, 403);
    assert.equal((await call('status', {}, { method: 'PUT' })).status, 405);
    assert.equal((await call('status', {}, { raw: '{bad json' })).status, 400);
    assert.equal((await call('status', {}, { raw: JSON.stringify({ action: 'status', pad: 'x'.repeat(5000) }) })).status, 413);
    assert.equal((await call('me')).status, 401);
    assert.equal((await call('challenge', { wallet: 'not-a-wallet' })).body.code, 'WALLET_INVALID');

    // Sign-in: the server-built message is a SIWS-style message bound to the origin, free, no transaction.
    const A = keyPair();
    const chA = await call('challenge', { wallet: A.wallet });
    assert.match(chA.body.message, /^portal\.example wants you to sign in with your Solana account:\n/);
    for (const line of ['\n' + A.wallet + '\n', 'URI: ' + ORIGIN, 'Version: 1', 'Chain ID: devnet', 'Nonce: ' + chA.body.nonce, 'Issued At: ', 'Expiration Time: ', 'does not send a transaction']) assert.ok(chA.body.message.includes(line), line);
    const forged = keyPair();
    assert.equal((await call('login', { wallet: A.wallet, nonce: chA.body.nonce, signature: forged.sign(chA.body.message) })).body.code, 'SIGNATURE_INVALID', 'a different key cannot sign in as A');
    assert.equal((await call('login', { wallet: A.wallet, nonce: 'wrong', signature: A.sign(chA.body.message) })).status, 401, 'nonce must match');
    clock += 3000;
    const goodA = await call('login', { wallet: A.wallet, nonce: chA.body.nonce, signature: A.sign(chA.body.message) });
    assert.equal(goodA.status, 200); assert.equal(goodA.body.registered, false);
    for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/api/prelaunch', 'Max-Age=3600']) assert.ok(goodA.setCookie.includes(flag), 'cookie ' + flag);
    assert.equal((await call('login', { wallet: A.wallet, nonce: chA.body.nonce, signature: A.sign(chA.body.message) })).status, 401, 'a used nonce cannot be replayed');
    clock += 3000; const chExp = await call('challenge', { wallet: A.wallet }); clock += 121000;
    assert.equal((await call('login', { wallet: A.wallet, nonce: chExp.body.nonce, signature: A.sign(chExp.body.message) })).status, 401, 'expired challenges are refused');
    const cookieA = goodA.setCookie.split(';')[0];
    assert.equal((await call('me', {}, { cookie: COOKIE + '=forged-token' })).status, 401);

    // Registration.
    assert.equal((await call('referrals', {}, { cookie: cookieA })).body.code, 'NOT_REGISTERED');
    assert.equal((await call('register', { username: 'ab' }, { cookie: cookieA })).body.code, 'USERNAME_INVALID');
    assert.equal((await call('register', { username: 'bad name!' }, { cookie: cookieA })).body.code, 'USERNAME_INVALID');
    assert.equal((await call('register', { username: 'Admin' }, { cookie: cookieA })).body.code, 'USERNAME_TAKEN', 'reserved names');
    assert.equal((await call('register', { username: 'Akira', region: 'mars' }, { cookie: cookieA })).body.code, 'REGION_INVALID');
    const regA = await call('register', { username: 'Akira', language: 'pt-BR', region: 'south-america' }, { cookie: cookieA });
    assert.equal(regA.status, 200, JSON.stringify(regA.body)); assert.equal(regA.body.created, true);
    const pA = regA.body.player; assert.equal(pA.username, 'Akira'); assert.match(pA.playerId, /^[0-9a-f-]{36}$/); assert.match(pA.referralCode, /^RP[0-9A-F]{20}$/);
    assert.equal(pA.referralLink, ORIGIN + '/?referral=' + pA.referralCode); assert.notEqual(pA.playerId, A.wallet, 'internal id is not the wallet');
    const againA = await call('register', { username: 'Other' }, { cookie: cookieA });
    assert.equal(againA.body.created, false); assert.equal(againA.body.player.username, 'Akira', 'registering again changes nothing');
    assert.equal((await pool.query('SELECT COUNT(*) AS n FROM ryo_players WHERE scope=$1 AND wallet=$2', [SCOPE, A.wallet])).rows[0].n, 1);

    // Referral attribution happens at registration; usernames are unique case-insensitively.
    const B = keyPair(), sB = await signIn(B);
    assert.equal((await call('register', { username: 'akira', referralCode: pA.referralCode }, { cookie: sB.cookie })).body.code, 'USERNAME_TAKEN');
    const regB = await call('register', { username: 'Bunta', referralCode: pA.referralCode.toLowerCase() }, { cookie: sB.cookie });
    assert.equal(regB.body.created, true); assert.deepEqual(regB.body.referral, { accepted: true, existing: false }); assert.equal(regB.body.referredBy, 'Akira');
    const C = keyPair(), sC = await signIn(C); const codeC = (await call('register', { username: 'Chiyo' }, { cookie: sC.cookie })).body.player.referralCode;
    const reB = await call('register', { username: 'Bunta', referralCode: codeC }, { cookie: sB.cookie });
    assert.equal(reB.body.created, false); assert.equal(reB.body.referral, null); assert.equal(reB.body.referredBy, 'Akira', 'the referrer can never change');
    const E = keyPair(), sE = await signIn(E);
    const regE = await call('register', { username: 'Eiji', referralCode: 'RP00000000000000000000' }, { cookie: sE.cookie });
    assert.equal(regE.body.created, true); assert.equal(regE.body.referral.accepted, false); assert.equal(regE.body.referral.code, 'REFERRAL_UNKNOWN'); assert.equal(regE.body.referredBy, null);
    // A wallet that already played (made a purchase) is not a new player.
    const F = keyPair(), sF = await signIn(F);
    await pool.query("INSERT INTO ryo_spends(scope,wallet,request_id,amount,created) VALUES($1,$2,'old-spend',1,1)", [SCOPE, F.wallet]);
    const regF = await call('register', { username: 'Fumi', referralCode: pA.referralCode }, { cookie: sF.cookie });
    assert.equal(regF.body.created, true); assert.equal(regF.body.referral.code, 'REFERRAL_NOT_NEW');

    // Dashboard: only real data; pre-launch progress is not invented.
    const dash = await call('referrals', {}, { cookie: cookieA });
    assert.deepEqual(dash.body.stats, { invited: 1, inProgress: 1, qualified: 0, rewardsAvailable: 0, heroesEarned: 0 });
    assert.equal(dash.body.prelaunch, true); assert.equal(dash.body.referrals.length, 1);
    assert.deepEqual({ ...dash.body.referrals[0], joined: 0 }, { player: 'Bunta', joined: 0, status: 'IN_PROGRESS', paidHeroes: 0, stage5: false, rewardLocked: true });
    assert.ok(!JSON.stringify(dash.body).includes(B.wallet), 'invitee wallets are never exposed');
    assert.equal((await call('referrals', { page: -1 }, { cookie: cookieA })).status, 400);

    // Leaderboard: registered referrals only, by username, hidden on request.
    let lb = await call('leaderboard'); assert.deepEqual(lb.body.rows, [{ rank: 1, player: 'Akira', registrations: 1 }]); assert.equal(lb.body.basis, 'registered-referrals');
    assert.ok(!JSON.stringify(lb.body).includes(A.wallet));
    const pref = await call('preferences', { language: 'en', region: 'asia', leaderboardVisible: false }, { cookie: cookieA });
    assert.equal(pref.body.player.language, 'en'); assert.equal(pref.body.player.region, 'asia'); assert.equal(pref.body.player.leaderboardVisible, false);
    assert.equal((await call('preferences', { language: 'fr' }, { cookie: cookieA })).body.code, 'LANGUAGE_INVALID');
    lb = await call('leaderboard'); assert.deepEqual(lb.body.rows, []);
    await call('preferences', { leaderboardVisible: true }, { cookie: cookieA });

    // Logout ends the server session, not just the cookie.
    const out = await call('logout', {}, { cookie: cookieA }); assert.equal(out.status, 200); assert.match(out.setCookie, /Max-Age=0/);
    assert.equal((await call('me', {}, { cookie: cookieA })).status, 401);
    // Sessions expire after one hour.
    const sA2 = await signIn(A); clock += 3600001; assert.equal((await call('me', {}, { cookie: sA2.cookie })).status, 401);

    // Rate limits per client address (the proxy-appended rightmost X-Forwarded-For entry).
    const R = keyPair(); let limited = 0;
    for (let i = 0; i < 22; i++) { clock += 1000; if ((await call('challenge', { wallet: keyPair().wallet }, { ip: '198.51.100.7' })).status === 429) limited++; }   // a new wallet each time: only the per-address limit applies
    assert.equal(limited, 2, 'the 21st and 22nd challenge in a minute are refused');
    clock += 60001; assert.equal((await call('challenge', { wallet: R.wallet }, { ip: '198.51.100.7' })).status, 200, 'the window resets');

    // Concurrency: the same wallet registering twice at once creates one account; one username, one owner.
    const G = keyPair(), sG = await signIn(G), H = keyPair(), sH = await signIn(H);
    const twin = await Promise.all([call('register', { username: 'Gin' }, { cookie: sG.cookie }), call('register', { username: 'Gin2' }, { cookie: sG.cookie })]);
    assert.deepEqual(twin.map(r => r.body.created).sort(), [false, true]);
    assert.equal((await pool.query('SELECT COUNT(*) AS n FROM ryo_players WHERE scope=$1 AND wallet=$2', [SCOPE, G.wallet])).rows[0].n, 1);
    const race = await Promise.all([call('register', { username: 'Hikari' }, { cookie: sH.cookie }), (async () => { const I = keyPair(), sI = await signIn(I); return call('register', { username: 'HIKARI' }, { cookie: sI.cookie }); })()]);
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);

    // Restart: a new portal instance on the same database and scope sees every registration and referral.
    portal = createPrelaunch({ gameDir: app, env, pool, now: () => clock });
    const sA3 = await signIn(A); assert.equal(sA3.me.registered, true); assert.equal(sA3.me.player.referralCode, pA.referralCode);
    assert.equal((await call('referrals', {}, { cookie: sA3.cookie })).body.stats.invited, 1);
    // A different scope is a different world (the test server never sees live accounts).
    const other = createPrelaunch({ gameDir: app, env: { ...env, RYO_SCOPE: 'solana-devnet:other' }, pool, now: () => clock });
    assert.equal((await other.store.pool.query('SELECT COUNT(*) AS n FROM ryo_players WHERE scope=$1', ['solana-devnet:other'])).rows[0].n, 0);
    // The registered account is the one the game uses at launch: same (scope, wallet) referral rows.
    const gameRef = (await pool.query('SELECT referrer FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2', [SCOPE, B.wallet])).rows[0];
    assert.equal(gameRef.referrer, A.wallet);
    console.log('PASS: pre-launch API — SIWS sign-in (forged/replayed/expired refused), HttpOnly session + logout + expiry, CSRF/origin, idempotent registration, unique usernames, permanent referral attribution, honest dashboard, private leaderboard, rate limits, restart persistence, concurrency.');
  } finally { await new Promise(r => server.close(r)); }

  // ---- The site host in PRELAUNCH_MODE ----
  const base = { ...process.env, SOLANA_NETWORK: 'devnet', PRELAUNCH_MODE: 'on', RYO_SCOPE: SCOPE, DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none', HOST: '127.0.0.1' };
  for (const k of ['RYO_TREASURY_SECRET', 'RYO_TOKEN_MINT', 'RYO_STUDIO_WALLET', 'RYO_REVENUE_WALLET', 'STARTER_PACK', 'GAME_RUNTIME_DIR']) delete base[k];
  const refuse = (extra, pattern) => { const r = spawnSync(process.execPath, ['-e', "require('./server/site-server.cjs')"], { cwd: root, encoding: 'utf8', env: { ...base, RYO_SITE_ORIGIN: 'http://localhost:1', PORT: '0', ...extra }, timeout: 20000 }); assert.notEqual(r.status, 0, 'refused: ' + pattern); assert.match(r.stderr, pattern); };
  refuse({ RYO_TREASURY_SECRET: '[1,2,3]' }, /must not hold money settings \(RYO_TREASURY_SECRET\)/);
  refuse({ RYO_TOKEN_MINT: '11111111111111111111111111111111' }, /RYO_TOKEN_MINT/);
  refuse({ RYO_SCOPE: '' }, /RYO_SCOPE must be set/);
  refuse({ RYO_SCOPE: 'solana-mainnet:live' }, /RYO_SCOPE must be set/);
  refuse({ STARTER_PACK: 'on' }, /STARTER_PACK must be off/);
  refuse({ DATABASE_URL: '' }, /DATABASE_URL is required/);
  refuse({ RYO_SITE_ORIGIN: 'http://evil.example' }, /RYO_SITE_ORIGIN/);

  const sitePort = 20000 + Math.floor(Math.random() * 20000), siteOrigin = 'http://localhost:' + sitePort;
  const child = spawn(process.execPath, ['server/site-server.cjs'], { cwd: root, env: { ...base, RYO_SITE_ORIGIN: siteOrigin, PORT: String(sitePort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  try {
    for (let i = 0; i < 100 && !log.includes('Website on'); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(log, /PRE-LAUNCH portal \(game closed until launch\)/);
    const get = (p, init = {}) => fetch('http://127.0.0.1:' + sitePort + p, { redirect: 'manual', ...init });
    const home = await get('/?referral=RPABC'); assert.equal(home.status, 200); assert.match(await home.text(), /THE SHINOBI ERA BEGINS SOON/);
    for (const [p, status, location] of [['/play/', 302, '/'], ['/play', 302, '/'], ['/play/index.html?referral=RPX', 302, '/?referral=RPX'], ['/rules.html', 308, '/rules'], ['/privacy/', 308, '/privacy'],
      ['/beta-config.json', 404], ['/admin/', 404], ['/admin', 404], ['/pl/server.cjs', 404], ['/pl/schema.sql', 404], ['/pl/../server/site-server.cjs', 404], ['/play/assets/beta-wallet.js', 404], ['/play/assets/creators-portal/portal.js', 404]]) {
      const r = await get(p); assert.equal(r.status, status, p); if (location) assert.equal(r.headers.get('location'), location, p);
    }
    for (const p of ['/rules', '/privacy', '/terms', '/whitepaper', '/pl/prelaunch.js', '/pl/wallet.js', '/pl/i18n/pt-BR.json', '/pl/announcements.json', '/pl/assets/logo.webp', '/play/assets/login-exact/login-reference.webp']) assert.equal((await get(p)).status, 200, p);
    assert.deepEqual(await (await get('/healthz')).json(), { status: 'ok', mode: 'prelaunch' });
    const policy=await (await get('/economy-policy.json')).json();
    assert.equal(policy.marker,'sr-economy-live-only-v1');assert.equal(policy.prelaunch,true);assert.equal(policy.monetaryEndpointsMounted,false);
    assert.equal((await get('/economy-policy.json',{method:'POST'})).status,405,'policy endpoint cannot submit payments');
    // Every game and money action is unreachable: the game API is not mounted at all.
    for (const action of ['purchase', 'deposit', 'withdraw', 'market-post', 'market-buy', 'creator-player-claim', 'claim-adventure', 'box-mint', 'hunt-enter', 'adventure', 'state', 'login', 'challenge']) for (const p of ['/api/ryo', '/.netlify/functions/ryo']) {
      const r = await get(p, { method: 'POST', headers: { 'content-type': 'application/json', origin: siteOrigin }, body: JSON.stringify({ action, product: 'summon' }) });
      assert.equal(r.status, 403, action + ' ' + p); assert.equal((await r.json()).code, 'PRELAUNCH');
    }
    // The portal API answers status without a database round-trip.
    const s = await get('/api/prelaunch', { method: 'POST', headers: { 'content-type': 'application/json', origin: siteOrigin, 'x-sb-prelaunch': '1' }, body: JSON.stringify({ action: 'status' }) });
    assert.equal(s.status, 200); assert.equal((await s.json()).prelaunch, true);
    console.log('PASS: PRELAUNCH_MODE host — portal pages, clean URLs, artwork only from the game, game API/admin/config closed (403/404), unsafe settings refused at start-up.');
  } finally { child.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
