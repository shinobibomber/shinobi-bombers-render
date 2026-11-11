'use strict';
/* Staff rescue-hero grant (owner request 2026-11-11): an approver gives a player one account-bound rescue hero of a chosen rarity
 * (Genin .. Legend, never Mythic) from the Creators Portal admin, e.g. for a prisoner freed before rescue heroes were saved on the
 * server. Approver only, reason required, exactly once per request id, refused during a settling purchase or with a full
 * collection, recorded in ryo_prison_rescues and the admin audit. Isolated PGlite fixtures only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), cp = require('../app/server/creators-portal.cjs'), economy = require('../app/server/economy.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
(async () => {
  const prior = { a: process.env.RYO_ADMIN_APPROVERS, o: process.env.RYO_ADMIN_OPERATORS, p: process.env.CREATORS_PORTAL_ENABLED };
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(), now = Date.UTC(2026, 10, 11, 12);
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'rescue-staff-test', () => now);
  const approver = address(), operator = address();
  Object.assign(process.env, { RYO_ADMIN_APPROVERS: approver, RYO_ADMIN_OPERATORS: operator, CREATORS_PORTAL_ENABLED: 'on', STAFF_GRANT_DAILY_CAP: '100' });   // the cap itself: last section
  const rows = async (s, a = []) => (await pool.query(s, [store.scope, ...a])).rows;
  const player = async name => { const w = address(); await pool.query("INSERT INTO ryo_players(scope,wallet,player_id,username,username_key,created,last_login) VALUES($1,$2,$3,$4,$5,$6,$6)", [store.scope, w, crypto.randomUUID(), name, name.toLowerCase(), now]); await store.profile(w); return w; };
  const grant = (actor, body) => cp.adminAction(store, actor, { operation: 'grant-rescue-hero', reason: 'Prisoner freed before server rescue heroes', requestId: crypto.randomUUID(), ...body });
  const rescues = async w => (await store.profile(w)).heroes.filter(h => h.prisonRescue);

  const w = await player('LostHero');
  await assert.rejects(grant(operator, { player: 'LostHero', rank: 3 }), /approver/, 'operators cannot grant heroes');
  await assert.rejects(cp.adminAction(store, approver, { operation: 'grant-rescue-hero', player: 'LostHero', rank: 3, requestId: crypto.randomUUID() }), /between 1 and 500/, 'a reason is required');
  for (const bad of [5, -1, 2.5, 'Mythic']) await assert.rejects(grant(approver, { player: 'LostHero', rank: bad }), /Genin, Chunin, Jonin, Elite or Legend/, 'never Mythic or an invalid rank: ' + bad);
  await assert.rejects(grant(approver, { player: 'Nobody', rank: 1 }), /No registered player/);
  await assert.rejects(grant(approver, { player: 'LostHero', rank: 1, requestId: 'x' }), /Invalid request ID/);

  // Each rarity, chosen by staff.
  for (const rank of [0, 1, 2, 3, 4]) {
    const r = await grant(approver, { player: 'losthero', rank });
    assert.deepEqual([r.ok, r.rank, r.username, r.replay], [true, rank, 'LostHero', false]);
  }
  const heroes = await rescues(w);
  assert.deepEqual(heroes.map(h => h.rank).sort(), [0, 1, 2, 3, 4], 'one hero of each chosen rarity');
  assert(heroes.every(h => h.referralReward === true && h.staffGrant === true && h.baseStats && h.name), 'account-bound rescue heroes with full stats');
  assert.equal((await rows("SELECT COUNT(*) AS n FROM ryo_prison_rescues WHERE scope=$1 AND wallet=$2 AND session='staff' AND roll=-1", [w]))[0].n * 1, 5, 'recorded as staff rescue grants');
  // Exactly once per request id (a retry after a lost answer).
  const requestId = crypto.randomUUID(), first = await grant(approver, { player: w, rank: 4, requestId }), again = await grant(approver, { player: w, rank: 4, requestId });
  assert.equal(again.replay, true); assert.equal((await rescues(w)).length, 6, 'a retried request grants nothing more');
  await assert.rejects(grant(approver, { player: w, rank: 2, requestId }), /another grant/, 'a request id cannot be reused for another grant');
  assert(first.hero.name);
  // Audit trail.
  const audits = await rows("SELECT actor,reason,detail FROM ryo_creator_audit WHERE scope=$1 AND action='admin.grant-rescue-hero' ORDER BY sequence");
  assert.equal(audits.length, 6, 'every grant audited once (not the replay)');
  assert(audits.every(a => a.actor === approver && a.reason && a.detail.wallet === w && Number.isInteger(a.detail.rank) && a.detail.hero));
  // Refused while a purchase settles (its settlement would overwrite the profile) and with a full collection.
  const busy = await player('Busy');
  await pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,'pending-req-000001','summon','{}','{}','{}','{}',1,'sig-busy','w',1,'pending',$3)", [store.scope, busy, now]);
  await assert.rejects(grant(approver, { player: 'Busy', rank: 1 }), /purchase settling/);
  const full = await player('Full'), fp = economy.normalizeProfile({ heroes: Array.from({ length: 500 }, () => economy.hero(0)) });
  await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, full, JSON.stringify(fp)]);
  await assert.rejects(grant(approver, { player: 'Full', rank: 1 }), /collection is full/);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM ryo_creator_audit WHERE scope=$1 AND action='admin.grant-rescue-hero'"))[0].n * 1, 6, 'refused grants leave no audit record');

  // Review hardening: no self-grants, a strict numeric rarity, and the staff id prefix is reserved.
  await pool.query("INSERT INTO ryo_players(scope,wallet,player_id,username,username_key,created,last_login) VALUES($1,$2,$3,'Boss','boss',$4,$4)", [store.scope, approver, crypto.randomUUID(), now]);
  await assert.rejects(grant(approver, { player: 'Boss', rank: 4 }), /own wallet/, 'an approver cannot grant to their own wallet');
  for (const loose of [true, '', null, '3', [1]]) await assert.rejects(grant(approver, { player: 'LostHero', rank: loose }), /Genin, Chunin, Jonin, Elite or Legend/, 'rank must be a number: ' + JSON.stringify(loose));
  await assert.rejects(require('../app/server/prison-rescue.cjs').claim(store, w, { requestId: 'staff-' + crypto.randomUUID() }), /Invalid request ID/, 'player rescue ids cannot use the staff prefix');

  // Owner decision 2026-11-11: at most STAFF_GRANT_DAILY_CAP grants per approver per rolling 24 h (default 5).
  delete process.env.STAFF_GRANT_DAILY_CAP;
  now += 2 * 86400000; const capPlayer = await player('CapFan'), sameId = crypto.randomUUID();
  for (let i = 0; i < 5; i++) await grant(approver, { player: 'CapFan', rank: 0, ...(i === 0 ? { requestId: sameId } : {}) });
  await assert.rejects(grant(approver, { player: 'CapFan', rank: 0 }), /Daily staff grant limit reached \(5 heroes per approver per 24 hours\)/, 'the 6th grant in 24 h is refused');
  assert.equal((await rescues(capPlayer)).length, 5, 'the refused grant created no hero');
  assert.equal((await grant(approver, { player: 'CapFan', rank: 0, requestId: sameId })).replay, true, 'a replay of an earlier grant still answers and never counts');
  const second = address(); process.env.RYO_ADMIN_APPROVERS = approver + ',' + second;
  assert.equal((await grant(second, { player: 'CapFan', rank: 1 })).rank, 1, 'another approver has their own limit');
  now += 86400000 + 1; assert.equal((await grant(approver, { player: 'CapFan', rank: 0 })).rank, 0, 'the limit rolls after 24 hours');
  process.env.STAFF_GRANT_DAILY_CAP = '0'; await assert.rejects(grant(second, { player: 'CapFan', rank: 0 }), /limit reached \(0 heroes/, 'STAFF_GRANT_DAILY_CAP=0 stops staff grants');
  await db.close();
  for (const [k, v] of [['RYO_ADMIN_APPROVERS', prior.a], ['RYO_ADMIN_OPERATORS', prior.o], ['CREATORS_PORTAL_ENABLED', prior.p]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  delete process.env.STAFF_GRANT_DAILY_CAP;
  console.log('PASS: staff rescue grant — approver only with a reason, chosen rarity Genin..Legend (never Mythic), account-bound rescue hero, exactly once per request, refused during a settling purchase or with a full collection, audited in the same transaction, at most 5 per approver per 24 h (STAFF_GRANT_DAILY_CAP; replays never count).');
})().catch(e => { console.error(e); process.exitCode = 1; });
