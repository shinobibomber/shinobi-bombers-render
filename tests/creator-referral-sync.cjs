'use strict';
/* Creator referral sync (owner decision 2026-11-08): when a player is approved as a creator, their eligible
 * player-link (RP…) referrals join the Creator Program (CP rewards instead of hero passes), the RP link then enrolls
 * new players in the Creator Program, and every view shows one combined count. Real modules on PGlite. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), cp = require('../app/server/creators-portal.cjs'), player = require('../app/server/player-referrals.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
const form = { displayName: 'Sync Creator', platform: 'YouTube', channelUrl: 'https://www.youtube.com/@sync', links: [], reason: 'Honest gameplay streams and clear referral disclosure', terms: true };
(async () => {
  const db = new PGlite(), schema = fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'); await db.exec(schema);
  let tail = Promise.resolve(), now = Date.UTC(2026, 10, 8, 12);
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'sync-fixture', () => ++now), origin = 'https://shinobi.example';
  const call = (wallet, action, body = {}, s = store) => cp.handle({ store: s, origin }, wallet, action, body);
  const one = async (sql, args = [], s = store) => (await pool.query(sql, [s.scope, ...args])).rows;
  const admin = address(); process.env.RYO_ADMIN_APPROVERS = admin; process.env.CREATORS_PORTAL_ENABLED = 'on';
  const approve = (creatorId, status = 'APPROVED') => call(admin, 'creator-admin-action', { operation: 'status', creatorId, status, reason: 'Fixture review' });
  const creatorIdOf = async wallet => (await one('SELECT id FROM ryo_creators WHERE scope=$1 AND wallet=$2', [wallet]))[0].id;
  const totalReferrals = async () => Number((await one('SELECT (SELECT COUNT(*) FROM ryo_creator_referrals WHERE scope=$1)+(SELECT COUNT(*) FROM ryo_player_referrals WHERE scope=$1) AS n'))[0].n);
  try {
    // Player A with a player link (RP…) and four referrals: B, C in progress; D qualified and rewarded; E becomes a creator.
    const A = address(), [B, C, D, E] = [address(), address(), address(), address()];
    const codeA = (await call(A, 'creator-player-state')).code; assert.match(codeA, /^RP/);
    for (const w of [B, C, D, E]) assert.equal((await call(w, 'creator-attribute', { code: codeA })).ok, true);
    await pool.query("UPDATE ryo_player_referrals SET paid_mints=3,proof='{\"kills\":40}' WHERE scope=$1 AND wallet=$2", [store.scope, B]);
    await pool.query('UPDATE ryo_player_referrals SET paid_mints=15,stage5=$3 WHERE scope=$1 AND wallet=$2', [store.scope, D, now]);
    await store.transaction(async c => assert.equal(await player.qualify(store, c, await player.referral(store, c, D)), true, 'D earns its hero passes'));
    await call(E, 'creator-apply', { ...form, displayName: 'E Streamer' });
    const joinedB = Number((await one('SELECT attributed FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2', [B]))[0].attributed), before = await totalReferrals();

    // A applies and is approved: B and C convert (join time and progress kept); D (rewarded) and E (creator wallet) stay.
    await call(A, 'creator-apply', form); const idA = await creatorIdOf(A); await approve(idA);
    const conv = await one('SELECT wallet,creator_id,attributed,paid_mints,proof FROM ryo_creator_referrals WHERE scope=$1 ORDER BY wallet');
    assert.deepEqual(conv.map(r => r.wallet).sort(), [B, C].sort());
    assert(conv.every(r => r.creator_id === idA));
    const b = conv.find(r => r.wallet === B); assert.equal(Number(b.attributed), joinedB); assert.equal(Number(b.paid_mints), 3); assert.equal(b.proof.kills, 40, 'Adventure progress is kept');
    assert.deepEqual((await one('SELECT wallet FROM ryo_player_referrals WHERE scope=$1 ORDER BY wallet')).map(r => r.wallet), [D, E].sort());
    assert.equal(await totalReferrals(), before, 'the shared enrollment total is unchanged');
    const audit = await one("SELECT detail FROM ryo_creator_audit WHERE scope=$1 AND action='referrals.converted'"); assert.equal(audit.length, 1); assert.equal(audit[0].detail.count, 2);
    assert.equal(Number((await one("SELECT COUNT(*) AS n FROM ryo_creator_ledger WHERE scope=$1 AND event_id=$2", ['milestone:' + D]))[0].n), 0, 'the rewarded referral never earns a CP milestone too');

    // One combined count everywhere.
    const st = await call(A, 'creator-state');
    assert.deepEqual({ total: st.stats.total, qualified: st.stats.qualified, pending: st.stats.pending }, { total: 4, qualified: 1, pending: 3 });
    assert.deepEqual(st.stats.creatorLink, { total: 2, qualified: 0, pending: 2 }); assert.deepEqual(st.stats.playerLink, { total: 2, qualified: 1, pending: 1 });
    assert.deepEqual(st.referrals.map(r => r.via).sort(), ['creator', 'creator', 'player', 'player']); assert(!JSON.stringify(st).includes(B), 'no wallets exposed');
    const ps = await call(A, 'creator-player-state'); assert.equal(ps.stats.total, '4'); assert.equal(ps.stats.creatorProgram, true);

    // After approval, A's RP link enrolls new players in the Creator Program; every existing safeguard still applies.
    const F = address(); assert.equal((await call(F, 'creator-attribute', { code: codeA })).ok, true);
    assert.equal((await one('SELECT creator_id FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [F]))[0].creator_id, idA);
    assert.equal((await one('SELECT 1 FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2', [F])).length, 0);
    assert.equal((await call(F, 'creator-attribute', { code: codeA })).ok, true, 'revisiting the same link is harmless');
    await assert.rejects(call(A, 'creator-attribute', { code: codeA }), /creator identities|yourself/i);
    assert.equal((await call(E, 'creator-attribute', { code: codeA })).ok, true, 'E keeps its original player attribution');
    assert.equal((await one('SELECT referrer FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2', [E]))[0].referrer, A);
    const G = address(); await call(G, 'creator-apply', { ...form, displayName: 'G Streamer' });
    await assert.rejects(call(G, 'creator-attribute', { code: codeA }), /creator identities/i, 'a creator wallet cannot be enrolled');
    const H = address(); await pool.query('INSERT INTO ryo_spends(scope,wallet,request_id,amount,created) VALUES($1,$2,$3,1,$4)', [store.scope, H, 'used-player', now]);
    await assert.rejects(call(H, 'creator-attribute', { code: codeA }), /new players/);
    // D (still a player referral of A) revisiting A's link keeps its original attribution.
    assert.equal((await call(D, 'creator-attribute', { code: codeA })).ok, true);

    // Idempotent: repeating the conversion moves nothing.
    assert.equal(await store.transaction(async c => cp.convertPlayerReferrals(store, c, (await c.query('SELECT * FROM ryo_creators WHERE scope=$1 AND id=$2', [store.scope, idA])).rows[0])), 0);

    // Suspended: the RP link is a plain player link again. Re-approval converts what joined meanwhile.
    await approve(idA, 'SUSPENDED'); const I = address(); await call(I, 'creator-attribute', { code: codeA });
    assert.equal((await one('SELECT referrer FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2', [I]))[0].referrer, A);
    await approve(idA); assert.equal((await one('SELECT creator_id FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [I]))[0].creator_id, idA);

    // A converted referral that later qualifies earns the 50,000 CP milestone exactly once.
    await pool.query('UPDATE ryo_creator_referrals SET paid_mints=15,stage5=$3 WHERE scope=$1 AND wallet=$2', [store.scope, B, now]);
    for (let i = 0; i < 2; i++) await store.transaction(async c => cp.qualify(store, c, (await c.query('SELECT * FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2 FOR UPDATE', [store.scope, B])).rows[0]));
    assert.equal(Number((await one("SELECT COUNT(*) AS n FROM ryo_creator_ledger WHERE scope=$1 AND event_id=$2", ['milestone:' + B]))[0].n), 1);

    // Creators approved before this fix: the one-time sync converts their eligible player-link referrals on first load.
    const store2 = new Store(pool, 'sync-legacy', () => ++now), K = address(), L = address(), idK = 'legacy-creator';
    const codeK = (await call(K, 'creator-player-state', {}, store2)).code;
    await pool.query(`INSERT INTO ryo_creators(scope,id,wallet,display_name,status,code,application,created,reviewed) VALUES($1,$2,$3,'Legacy','APPROVED','SBLEGACY0000001',$4,$5,$5)`, [store2.scope, idK, K, JSON.stringify({ termsAt: now }), now]);
    await pool.query('INSERT INTO ryo_creator_wallets(scope,wallet,creator_id) VALUES($1,$2,$3)', [store2.scope, K, idK]);
    await pool.query('INSERT INTO ryo_player_referrals(scope,wallet,referrer,attributed) VALUES($1,$2,$3,$4)', [store2.scope, L, K, now]);
    assert.match(codeK, /^RP/);
    const legacy = await call(K, 'creator-state', {}, store2);
    assert.equal(legacy.stats.total, 1); assert.equal(legacy.stats.creatorLink.total, 1, 'converted by the one-time sync');
    assert.equal((await one('SELECT creator_id FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [L], store2))[0].creator_id, idK);
    console.log('PASS: creator referral sync — approval/re-approval/one-time sync convert unpaid player-link referrals (join time and progress kept), rewarded and creator-wallet referrals stay but count, one combined count in creator and player views, RP link routes to the Creator Program with all safeguards, idempotent, enrollment total unchanged, CP milestone once.');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
