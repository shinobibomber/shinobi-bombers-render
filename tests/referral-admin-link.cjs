'use strict';
/* Referral fixes by staff (owner request 2026-11-10):
 *  1. A Founder box buyer (pending or confirmed) is no longer a "new player": referral links cannot attach them afterwards (a box
 *     raises the creator to 10% discount and commission).
 *  2. Approver-only "Link a player to a referrer by hand" in the Creators Portal admin: by username or wallet, with a pasted (even
 *     mistyped) link or code and a reason; skips the new-player rule and the enrollment pause, keeps permanence, self, cycles,
 *     creator identities and the enrollment limit; recorded in the admin audit; recent sign-ups without a referrer are listed.
 * Isolated PGlite fixtures only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), cp = require('../app/server/creators-portal.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
(async () => {
  const prior = { a: process.env.RYO_ADMIN_APPROVERS, o: process.env.RYO_ADMIN_OPERATORS, v: process.env.RYO_ADMIN_VIEWERS, p: process.env.CREATORS_PORTAL_ENABLED };
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(), now = Date.UTC(2026, 10, 10, 12), serial = 0;
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'referral-admin-test', () => now);
  const approver = address(), operator = address(), viewer = address();
  Object.assign(process.env, { RYO_ADMIN_APPROVERS: approver, RYO_ADMIN_OPERATORS: operator, RYO_ADMIN_VIEWERS: viewer, CREATORS_PORTAL_ENABLED: 'on' });
  const call = (wallet, action, body = {}) => cp.handle({ store, origin: 'https://shinobi.example' }, wallet, action, body);
  const link = (actor, body) => cp.adminAction(store, actor, { operation: 'attribute-referral', reason: 'Player used the mistyped link', ...body });
  const rows = async (s, a = []) => (await pool.query(s, [store.scope, ...a])).rows;
  const referrerOf = async w => (await rows('SELECT referrer FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2', [w]))[0]?.referrer || null;
  const creatorOf = async w => (await rows('SELECT creator_id FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [w]))[0]?.creator_id || null;
  const player = async (name, wallet = address()) => { await pool.query("INSERT INTO ryo_players(scope,wallet,player_id,username,username_key,created,last_login) VALUES($1,$2,$3,$4,$5,$6,$6)", [store.scope, wallet, crypto.randomUUID(), name, name.toLowerCase(), now]); now += 1000; return wallet; };
  const box = (w, status) => pool.query(`INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,created,settled)
    VALUES($1,$2,$3,'legacy',$4,$5,500000000,$6,'fixture','wire',1,$7,$7)`, [store.scope, crypto.randomUUID(), w, ++serial, 'mint-' + serial, status, now]);
  const played = w => pool.query("INSERT INTO ryo_adventures(scope,wallet,data) VALUES($1,$2,$3)", [store.scope, w, JSON.stringify({ kills: 250, pending: 0 })]);

  const owner = await player('Owner'), code = (await call(owner, 'creator-player-state')).code, typo = 'https://shinobibombers.fun/?referral=' + code + 'Mythic';

  /* ---------- 1. Founder box buyers are not new players for referral links ---------- */
  const buyer = await player('BoxBuyer'); await box(buyer, 'confirmed');
  await assert.rejects(call(buyer, 'creator-attribute', { code }), /new players/, 'a confirmed Founder box buyer cannot be attached by a link');
  const reserving = await player('BoxReserving'); await box(reserving, 'pending');
  await assert.rejects(call(reserving, 'creator-attribute', { code }), /new players/, 'a pending Founder box blocks too');
  const expired = await player('BoxExpired'); await box(expired, 'expired');
  await call(expired, 'creator-attribute', { code }); assert.equal(await referrerOf(expired), owner, 'an expired (unpaid) reservation does not count');
  const fresh = await player('Fresh'); await call(fresh, 'creator-attribute', { code }); assert.equal(await referrerOf(fresh), owner, 'a brand-new player is unchanged');

  /* ---------- 2. Staff link by hand ---------- */
  assert.deepEqual((await cp.adminSnapshot(store, viewer, {})).unreferred, [], 'only approvers receive the list of sign-ups without a referrer');
  assert.deepEqual((await cp.adminSnapshot(store, operator, {})).unreferred, []);
  const listed = (await cp.adminSnapshot(store, approver, {})).unreferred.map(u => u.username);
  assert(listed.includes('BoxBuyer') && listed.includes('BoxReserving') && !listed.includes('Fresh') && !listed.includes('BoxExpired'), 'sign-ups without a referrer are listed for staff: ' + listed);
  assert.deepEqual((await cp.adminSnapshot(store, approver, { search: 'reserv' })).unreferred.map(u => u.username), ['BoxReserving'], 'the admin search filters the list');
  await assert.rejects(link(operator, { player: 'BoxBuyer', code: typo }), /approver/, 'operators cannot link by hand');
  await assert.rejects(link(viewer, { player: 'BoxBuyer', code: typo }), /administrator/, 'viewers cannot either');
  await assert.rejects(cp.adminAction(store, approver, { operation: 'attribute-referral', player: 'BoxBuyer', code: typo }), /between 1 and 500/, 'a reason is required');
  await assert.rejects(link(approver, { player: 'Nobody', code: typo }), /No registered player/);
  await assert.rejects(link(approver, { player: address(), code }), /No registered player or game account/, 'a wallet that never signed in cannot be pre-linked');
  await assert.rejects(link(approver, { player: 'BoxBuyer', code: 'not a link!' }), /referral link or code/);
  await assert.rejects(link(approver, { player: 'BoxBuyer', code: 'RP' + '0'.repeat(20) }), /unavailable/, 'an unknown code still fails');
  const veteran = await player('Veteran'); await played(veteran);
  const linked = await link(approver, { player: 'boxbuyer', code: typo });
  assert.deepEqual([linked.ok, linked.existing, linked.username], [true, false, 'BoxBuyer'], 'username is case-insensitive; the mistyped link resolves');
  assert.equal(await referrerOf(buyer), owner, 'a Founder buyer is linked by staff');
  await link(approver, { player: veteran, code }); assert.equal(await referrerOf(veteran), owner, 'by wallet, a player with Adventure progress');
  assert.equal((await link(approver, { player: 'BoxBuyer', code })).existing, true, 'linking again to the same referrer is a no-op');
  const other = address(), otherCode = (await call(other, 'creator-player-state')).code;
  await assert.rejects(link(approver, { player: 'BoxBuyer', code: otherCode }), /permanent/, 'staff cannot move an existing referral');
  const ownerName = await player('OwnerName', address()); const ownerCode = (await call(ownerName, 'creator-player-state')).code;
  await assert.rejects(link(approver, { player: 'OwnerName', code: ownerCode }), /yourself/, 'no self-referral');
  await assert.rejects(link(approver, { player: owner, code: (await call(fresh, 'creator-player-state')).code }), /Circular/, 'no cycles');
  // Enrollment pause is skipped for staff fixes, not for players.
  const settings = await cp.adminSnapshot(store, approver, {});
  await cp.adminAction(store, approver, { operation: 'config', version: settings.program.version, config: { ...settings.program.config, enrollmentPaused: true }, reason: 'pause for test' });
  const paused = await player('PausedJoiner'); await assert.rejects(call(paused, 'creator-attribute', { code }), /paused/);
  await link(approver, { player: 'PausedJoiner', code }); assert.equal(await referrerOf(paused), owner, 'staff can still fix a referral while enrollment is paused');
  // An approved creator's link (creator code or their player link) creates a creator referral; creator wallets cannot be referred.
  const creatorWallet = await player('CreatorName');
  await cp.adminAction(store, approver, { operation: 'manual-add', wallet: creatorWallet, displayName: 'Creator', reason: 'fixture creator' }); await call(creatorWallet, 'creator-terms', { terms: true });
  const creatorCode = (await rows('SELECT code FROM ryo_creators WHERE scope=$1 AND wallet=$2', [creatorWallet]))[0].code;
  const fan = await player('Fan'); await box(fan, 'confirmed');
  await link(approver, { player: 'Fan', code: 'https://shinobibombers.fun/?creator=' + creatorCode });
  assert.equal(await creatorOf(fan), (await rows('SELECT id FROM ryo_creators WHERE scope=$1 AND wallet=$2', [creatorWallet]))[0].id, 'a creator link makes a creator referral');
  await assert.rejects(link(approver, { player: creatorWallet, code }), /Creator identities/, 'creator wallets cannot be referred');
  // Audit trail.
  const audits = await rows("SELECT actor,action,reason,detail FROM ryo_creator_audit WHERE scope=$1 AND action='admin.attribute-referral' ORDER BY sequence");
  assert.equal(audits.length, 5, 'every successful staff link (including the no-op) is audited');
  assert(audits.every(a => a.actor === approver && a.reason && a.detail.staffOverride === true));
  assert.deepEqual(audits.map(a => [a.detail.username, a.detail.founderBuyer, a.detail.existing]), [['BoxBuyer', true, false], [null, false, false], ['BoxBuyer', true, true], ['PausedJoiner', false, false], ['Fan', true, false]].map(([u, f, e], i) => [i === 1 ? 'Veteran' : u, f, e]), 'the audit records who, whether a Founder buyer, and no-ops');
  assert.equal(audits[0].detail.code, (code + 'MYTHIC'), 'the code as entered is kept as evidence');
  assert(!(await cp.adminSnapshot(store, approver, {})).unreferred.map(u => u.username).includes('BoxBuyer'), 'a linked player leaves the list');

  await db.close();
  for (const [k, v] of [['RYO_ADMIN_APPROVERS', prior.a], ['RYO_ADMIN_OPERATORS', prior.o], ['RYO_ADMIN_VIEWERS', prior.v], ['CREATORS_PORTAL_ENABLED', prior.p]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  console.log('PASS: referral admin — Founder box buyers (pending/confirmed) are not new players for links; approver-only manual linking by username or wallet with a (mistyped) link or code, skipping the new-player rule and enrollment pause, keeping permanence, self, cycle and creator-identity rules; audited; unreferred sign-ups listed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
