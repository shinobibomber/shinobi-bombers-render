/* Creator Program on the pre-launch portal (in-memory Postgres, real HTTP, real ed25519 signatures):
 * apply (registered players only, referred wallets refused, validation, one application per wallet),
 * admin review (admins only, approve/reject/suspend only, reason required, audited), approved creator link,
 * new players registering through ?creator= are permanently attributed and shown to the creator by username,
 * rejected/suspended creators' links stop enrolling, and the flag closes applications. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const app = path.resolve(__dirname, '../app'), { createPrelaunch } = require('../prelaunch/server.cjs');
const ORIGIN = 'https://portal.example', SCOPE = 'solana-devnet:creators-test';

function keyPair() {
  const kp = web3.Keypair.generate(), priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.slice(0, 32))]), format: 'der', type: 'pkcs8' });
  return { wallet: kp.publicKey.toBase58(), sign: msg => crypto.sign(null, Buffer.from(msg), priv).toString('base64') };
}

(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(app, 'server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const r = await lock(); try { return await db.query(s, a); } finally { r(); } }, async connect() { const r = await lock(); return { query: (s, a) => db.query(s, a), release: r }; } };
  let clock = Date.UTC(2026, 10, 8, 12);
  const admin = keyPair(), viewer = keyPair();
  process.env.RYO_ADMIN_APPROVERS = admin.wallet; process.env.RYO_ADMIN_VIEWERS = viewer.wallet; process.env.CREATORS_PORTAL_ENABLED = 'on';
  const env = { SOLANA_NETWORK: 'devnet', RYO_SITE_ORIGIN: ORIGIN, RYO_SCOPE: SCOPE };
  let portal = createPrelaunch({ gameDir: app, env, pool, now: () => clock });
  const server = http.createServer((q, r) => portal.handle(q, r)); await new Promise(r => server.listen(0, '127.0.0.1', r));
  let ip = 0;
  const call = (action, body = {}, cookie) => new Promise((resolve, reject) => {
    const data = JSON.stringify({ ...body, action }), headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), origin: ORIGIN, 'x-sb-prelaunch': '1', 'x-forwarded-for': '10.1.0.' + (++ip % 250 + 1) };
    if (cookie) headers.cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/prelaunch', method: 'POST', headers }, res => { let t = ''; res.on('data', c => t += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(t || 'null'), setCookie: res.headers['set-cookie']?.[0] })); });
    req.on('error', reject); req.end(data);
  });
  async function signIn(k) { clock += 3001; const ch = await call('challenge', { wallet: k.wallet }); const l = await call('login', { wallet: k.wallet, nonce: ch.body.nonce, signature: k.sign(ch.body.message) }); assert.equal(l.status, 200); return l.setCookie.split(';')[0]; }
  async function player(name, code) { const k = keyPair(), c = await signIn(k); const r = await call('register', { username: name, referralCode: code }, c); assert.equal(r.status, 200, JSON.stringify(r.body)); return { k, c, r: r.body }; }
  const application = { displayName: 'Akira Plays', platform: 'YouTube', channelUrl: 'https://youtube.com/@akiraplays', links: ['https://twitch.tv/akira', ''], audience: 12000, reason: 'I stream ninja games to a Brazilian audience every week.', terms: true };

  try {
    // Apply: registered players only.
    const anon = keyPair(), anonCookie = await signIn(anon);
    assert.equal((await call('creator-apply', application, anonCookie)).body.code, 'NOT_REGISTERED');
    assert.equal((await call('creator-apply', application)).status, 401);
    const creator = await player('Akira');
    let st = await call('creator', {}, creator.c);
    assert.equal(st.body.creator, null); assert.equal(st.body.applicationsOpen, true); assert.equal(st.body.adminRole, null);
    assert.deepEqual(st.body.rules, { milestone: 50000, adventurePercent: 5, purchasePercent: 5, commissionDays: 90, paidHeroes: 15, clearedStage: 5, cpWithdrawable: false });
    // Validation comes from the game's own rules.
    assert.equal((await call('creator-apply', { ...application, platform: 'MySpace' }, creator.c)).body.code, 'CREATOR_PLATFORM');
    assert.equal((await call('creator-apply', { ...application, channelUrl: 'http://youtube.com/@x' }, creator.c)).body.code, 'CREATOR_URL');
    assert.equal((await call('creator-apply', { ...application, terms: false }, creator.c)).status, 400);
    assert.equal((await call('creator-apply', { ...application, reason: '' }, creator.c)).body.code, 'TEXT_INVALID');
    const applied = await call('creator-apply', application, creator.c);
    assert.equal(applied.status, 200, JSON.stringify(applied.body)); assert.equal(applied.body.creator.status, 'PENDING'); assert.match(applied.body.creator.code, /^SB[0-9A-F]{14}$/);
    assert.equal(applied.body.link, undefined, 'no link until approved');
    assert.equal((await call('creator-apply', application, creator.c)).body.code, 'CREATOR_EXISTS');
    // A pending creator's link does not enroll anyone yet.
    const early = await player('Early', applied.body.creator.code);
    assert.equal(early.r.referral.accepted, false); assert.equal(early.r.referral.code, 'CREATOR_UNKNOWN');
    // A wallet that joined through a referral link cannot apply.
    const referred = await player('Ref', st.body.creator?.code || (await call('me', {}, creator.c)).body.player.referralCode);
    assert.equal(referred.r.referral.accepted, true);
    assert.equal((await call('creator-apply', application, referred.c)).body.code, 'CREATOR_REFERRED');

    // Admin review: admins only; only status changes; reason required; audited.
    assert.equal((await call('creator-admin', {}, creator.c)).body.code, 'ADMIN_ONLY');
    const adminCookie = await signIn(admin), viewerCookie = await signIn(viewer);
    assert.equal((await call('creator', {}, adminCookie)).body.adminRole, 'approver');
    let list = await call('creator-admin', {}, adminCookie);
    assert.equal(list.status, 200); const entry = list.body.creators.find(c => c.displayName === 'Akira Plays');
    assert.equal(entry.status, 'PENDING'); assert.equal(entry.application.platform, 'YouTube'); assert.equal(entry.application.audience, 12000); assert.deepEqual(entry.application.links, ['https://twitch.tv/akira']);
    assert.equal((await call('creator-admin', {}, viewerCookie)).status, 200, 'viewers can look');
    assert.equal((await call('creator-admin-action', { operation: 'status', creatorId: entry.id, status: 'APPROVED', reason: 'ok' }, viewerCookie)).body.code, 'ADMIN_ONLY', 'viewers cannot decide');
    assert.equal((await call('creator-admin-action', { operation: 'adjust', creatorId: entry.id, deltaMilli: 5, reason: 'x' }, adminCookie)).body.code, 'ADMIN_ONLY', 'CP changes are not offered here');
    assert.equal((await call('creator-admin-action', { operation: 'status', creatorId: entry.id, status: 'APPROVED', reason: '' }, adminCookie)).body.code, 'TEXT_INVALID', 'a reason is required');
    assert.equal((await call('creator-admin-action', { operation: 'status', creatorId: entry.id, status: 'SUSPENDED', reason: 'skip' }, adminCookie)).body.code, 'CREATOR_TRANSITION');
    const ok = await call('creator-admin-action', { operation: 'status', creatorId: entry.id, status: 'APPROVED', reason: 'Verified channel', publicNote: 'Welcome aboard!' }, adminCookie);
    assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.creators.find(c => c.id === entry.id).status, 'APPROVED');
    const audit = (await pool.query("SELECT action, reason FROM ryo_creator_audit WHERE scope=$1 AND action='admin.status'", [SCOPE])).rows;
    assert.deepEqual(audit, [{ action: 'admin.status', reason: 'Verified channel' }]);

    // The approved creator's link enrolls new players permanently; the creator sees them by username.
    st = await call('creator', {}, creator.c);
    assert.equal(st.body.creator.status, 'APPROVED'); assert.equal(st.body.creator.publicNote, 'Welcome aboard!');
    assert.equal(st.body.link, ORIGIN + '/?creator=' + st.body.creator.code); assert.deepEqual(st.body.stats, { total: 0, qualified: 0, pending: 0 }); assert.equal(st.body.balanceMilli, '0');
    const fan = await player('Fan1', st.body.creator.code.toLowerCase());
    assert.deepEqual(fan.r.referral, { accepted: true, existing: false }); assert.equal(fan.r.referredBy, 'Akira Plays');
    st = await call('creator', {}, creator.c);
    assert.deepEqual(st.body.stats, { total: 1, qualified: 0, pending: 1 }); assert.equal(st.body.referrals.length, 1);
    assert.deepEqual({ ...st.body.referrals[0], joined: 0 }, { player: 'Fan1', joined: 0, status: 'IN_PROGRESS' });
    assert.ok(!JSON.stringify(st.body).includes(fan.k.wallet), 'no wallets in the creator view');
    assert.equal((await pool.query('SELECT COUNT(*) AS n FROM ryo_creator_referrals WHERE scope=$1', [SCOPE])).rows[0].n, 1);

    // Suspended creators' links stop enrolling; re-approval restores them.
    await call('creator-admin-action', { operation: 'status', creatorId: entry.id, status: 'SUSPENDED', reason: 'Review' }, adminCookie);
    assert.equal((await player('Fan2', st.body.creator.code)).r.referral.code, 'CREATOR_UNKNOWN');
    await call('creator-admin-action', { operation: 'status', creatorId: entry.id, status: 'APPROVED', reason: 'Cleared' }, adminCookie);
    assert.equal((await player('Fan3', st.body.creator.code)).r.referral.accepted, true);
    // Rejected applications never enroll.
    const other = await player('Bunta'); const app2 = await call('creator-apply', { ...application, displayName: 'Bunta TV', platform: 'TikTok', channelUrl: 'https://tiktok.com/@bunta' }, other.c);
    const id2 = (await call('creator-admin', { search: 'Bunta' }, adminCookie)).body.creators[0].id;
    await call('creator-admin-action', { operation: 'status', creatorId: id2, status: 'REJECTED', reason: 'Not a fit', publicNote: 'Thanks for applying.' }, adminCookie);
    assert.equal((await call('creator', {}, other.c)).body.creator.status, 'REJECTED');
    assert.equal((await player('Fan4', app2.body.creator.code)).r.referral.code, 'CREATOR_UNKNOWN');

    // The flag closes new applications.
    portal = createPrelaunch({ gameDir: app, env: { ...env, CREATOR_APPLICATIONS_ENABLED: 'off' }, pool, now: () => clock });
    const late = await player('Late');
    assert.equal((await call('creator', {}, late.c)).body.applicationsOpen, false);
    assert.equal((await call('creator-apply', application, late.c)).body.code, 'CREATOR_PAUSED');
    console.log('PASS: Creator Program on the pre-launch portal — apply (registered, not referred, validated, once), admin-only review (approve/reject/suspend, reason, audit), creator link enrolls by username, suspended/rejected links closed, applications flag.');
  } finally { server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
