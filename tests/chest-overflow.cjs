'use strict';
/* Chest Overflow (owner request 2026-11-11): from a 500,000 Ryo Chest, NEW enemy rewards pay 90/80/70% — only once the claim
 * is actually possible plus a 12-hour grace period. (1) the tier per defeat in combat-adventure advance() (exact boundaries,
 * the Chest balance at that defeat, timing, crossing a threshold, earned Ryo never reduced, byte-identical without the
 * argument), (2) the timing window and status through the real Adventure service on simulated Mainnet (assembled modules,
 * PGlite, controllable clock; no RPC): claim timer, grace, claims closed / paused / no budget / budget used up / unfunded pool,
 * a claim restarting the timer, Chest spending lowering the tier without a new grace, the release date, the off switch, and
 * offline Sensei defeats paying less. */
const fixture = require('./sr-revenue-fixture.cjs'); fixture.liveEconomy();
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const network = require('../app/server/network.cjs'), { Store } = require('../app/server/store.cjs'), economy = require('../app/server/economy.cjs');
const A = require('../app/server/adventure.cjs'), CA = require('../app/server/combat-adventure.cjs'), O = require('../app/server/chest-overflow.cjs');
const H = 3600000, LIVE = () => network.NETWORKS.mainnet, BETA = () => network.NETWORKS.devnet;
const clone = v => JSON.parse(JSON.stringify(v));
(async () => {
  const builtBefore = network.built, envBefore = { ...process.env };
  /* ---------- 1. Tiers and the per-defeat payout ---------- */
  for (const [p, b] of [[0, 10000], [499999999, 10000], [500000000, 9000], [749999999, 9000], [750000000, 8000], [999999999, 8000], [1000000000, 7000], [5e12, 7000]])
    assert.equal(CA.overflowBps(p), b, 'tier at ' + p + ' milli-Ryo');
  const t0 = Date.UTC(2027, 0, 5, 12);
  const profile = economy.normalizeProfile({ dojo: 0, heroes: Array.from({ length: 4 }, (_, i) => ({ tokenId: 'h' + i, rank: 3, baseStats: { pw: 12, sp: 12, st: 12 }, trainingVersion: 2 })), battleReady: [] });
  profile.battleReady = profile.heroes.map(h => h.tokenId);
  Object.assign(profile, { sensei: true, senseiEnabled: true, senseiReturnPercent: 50, dojo: 6 });
  const data = CA.advance(null, profile, t0, false, 100);   // seeds chakra state, as the combat suite does
  const run = (pending, overflow, minutes = 60) => { const kills = []; const d = CA.advance({ ...clone(data), pending }, clone(profile), t0 + minutes * 60000, false, 100, null, (e, at) => kills.push([e, at]), overflow === undefined ? null : overflow); return { d, kills }; };
  const base = run(600000000);
  assert(base.kills.length >= 4, 'the offline Sensei simulation defeats enemies (' + base.kills.length + ')');
  assert.deepEqual(run(600000000, { activeFrom: Infinity }).d, base.d, 'no active window = byte-identical');
  assert.deepEqual(run(100000000, { activeFrom: 0 }).kills, run(100000000).kills, 'below 500,000 Ryo nothing changes');
  for (const [pending, bps] of [[600000000, 9000], [800000000, 8000], [2000000000, 7000]]) {
    const pen = run(pending, { activeFrom: 0 });
    assert.equal(pen.kills.length, base.kills.length, 'same defeats');
    pen.kills.forEach(([e], i) => assert.equal(e, Math.floor(base.kills[i][0] * bps / 10000), 'defeat ' + i + ' pays ' + bps / 100 + '%'));
    assert.equal(pen.d.pending, pending + pen.kills.reduce((n, [e]) => n + e, 0), 'existing Chest Ryo is never reduced; only new defeats pay less');
  }
  // Timing: defeats before activeFrom pay in full, from activeFrom on they pay less.
  const mid = base.kills[Math.floor(base.kills.length / 2)][1], timed = run(600000000, { activeFrom: mid });
  timed.kills.forEach(([e, at], i) => assert.equal(e, at >= mid ? Math.floor(base.kills[i][0] * 0.9) : base.kills[i][0], 'defeat ' + i + ' timing'));
  // Crossing 500,000 Ryo: the tier uses the Chest balance before each defeat is added.
  const crossing = run(499999999, { activeFrom: 0 });
  assert.equal(crossing.kills[0][0], base.kills[0][0], 'the defeat that crosses 500,000 still pays 100%');
  crossing.kills.slice(1).forEach(([e], i) => assert.equal(e, Math.floor(base.kills[i + 1][0] * 0.9), 'every later defeat pays 90%'));

  /* ---------- 2. Window and status through the Adventure service (simulated Mainnet) ---------- */
  network.built = LIVE;
  const db = new PGlite(), schema = fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'); await db.exec(schema);
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  let now = O.LAUNCH_AT + 3 * 24 * H; const store = new Store(pool, 'solana-mainnet:overflow-test', () => now);
  const address = () => web3.Keypair.generate().publicKey.toBase58();
  const setChest = async (wallet, ryo) => { await A.adventure(store, wallet, { active: false }, 0); const row = (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0].data; row.pending = ryo * 1000; await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(row)]); };
  const status = async wallet => (await A.adventure(store, wallet, { active: false }, 0)).overflow;
  const chestOf = async wallet => (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0].data;
  await fixture.topUp(store, 5000000);
  await fixture.budget(store, { dailyCapRyo: 5000000, perClaimMaxRyo: 5000000, evidence: 'Isolated overflow budget' });

  // Never claimed: the claim is available now -> 12 h grace from the first time the server sees it.
  const a = address(); await setChest(a, 600000);
  let s = await status(a), since = now;
  assert.deepEqual([s.state, s.tierPercent, s.ratePercent, s.chestRyo], ['grace', 10, 100, 600000], 'threshold reached: grace, still 100%');
  assert(s.activeFrom >= since - 2000 && s.activeFrom <= since + 12 * H, 'penalty starts 12 h after the claim became available');
  const activeFrom = s.activeFrom;
  now += 11 * H; s = await status(a); assert.deepEqual([s.state, s.activeFrom], ['grace', activeFrom], 'refresh/reconnect cannot move the start');
  now = activeFrom; s = await status(a); assert.deepEqual([s.state, s.ratePercent], ['active', 90], 'after the grace period: -10%');
  // Chest spending lowers the tier immediately; a refund restores it without a new grace period.
  const raw = await chestOf(a); raw.pending = 400000 * 1000; await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, a, JSON.stringify(raw)]);
  s = await status(a); assert.deepEqual([s.state, s.tierPercent, s.ratePercent], ['ok', 0, 100], 'below 500,000: full rewards');
  const back = await chestOf(a); back.pending = 800000 * 1000; await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, a, JSON.stringify(back)]);
  s = await status(a); assert.deepEqual([s.state, s.tierPercent, s.ratePercent], ['active', 20, 80], 'back above: penalty again at once, no new grace');
  // Offline Sensei defeats pay less through the real service (same team and stats, Chest 800,000 vs 100,000).
  const p = clone(profile); for (const h of p.heroes) delete h.chakra; await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, a, JSON.stringify(p)]);
  const b = address(); await setChest(b, 100000); await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, b, JSON.stringify(p)]);
  for (const w of [a, b]) { const r = await chestOf(w); r.last = now; r.active = false; r.kills = 0; r.map = 1; r.target = 0; r.hp = 100; delete r.combatVersion; delete r.team; r.energy = {}; await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, JSON.stringify(r)]); }
  const [pa, pb] = [(await chestOf(a)).pending, (await chestOf(b)).pending];
  now += 15 * 60000; await status(a); await status(b);
  const [da, db2] = [(await chestOf(a)).pending - pa, (await chestOf(b)).pending - pb], kills = (await chestOf(b)).kills;
  assert(db2 > 0 && kills > 0, 'the control Chest earned from offline defeats');
  assert(da <= Math.floor(db2 * 0.8) && da >= db2 * 0.8 - kills, 'offline Sensei defeats pay 80% at an 800,000 Ryo Chest (' + da + ' vs ' + db2 + ')');
  // A claim restarts the timer: no penalty until the next claim is ready, then a fresh 12 h grace.
  const claimed = await A.adventure(store, a, { active: false, claim: true }, 1e12);
  assert(claimed.credited > 0 && claimed.overflow.activeFrom === null && claimed.overflow.unavailable === null, 'a claim answers "until your next claim", not "unavailable"');
  const claimAt = now; await setChest(a, 700000);
  s = await status(a); assert.deepEqual([s.state, s.activeFrom, s.claimReadyAt], ['waiting', null, claimAt + 24 * H], 'claim timer running: no penalty');
  now = claimAt + 24 * H; s = await status(a); assert.deepEqual([s.state, s.activeFrom], ['grace', claimAt + 36 * H], 'grace runs from the moment the claim is ready');
  // Unavailable through no fault of the player: no penalty, and a fresh grace once claiming is possible again.
  now = claimAt + 40 * H; assert.equal((await status(a)).state, 'active');
  await pool.query("UPDATE ryo_admin_control SET pauses=$2 WHERE scope=$1", [store.scope, JSON.stringify({ claims: true })]);
  s = await status(a); assert.deepEqual([s.state, s.unavailable, s.ratePercent], ['waiting', 'paused', 100], 'operator claims pause');
  await pool.query("UPDATE ryo_admin_control SET pauses='{}' WHERE scope=$1", [store.scope]);
  s = await status(a); assert.equal(s.state, 'grace'); assert(s.activeFrom >= now + 12 * H - 2000, 'a fresh 12 h grace after the pause');
  // An outage while a player is away: any request that sees it records it, and the absent player's grace restarts after it.
  const away = address(); await setChest(away, 650000); await status(away); now += 13 * H; assert.equal((await status(away)).state, 'active');
  const outageAt = now + H; now = outageAt;
  await pool.query("UPDATE ryo_admin_control SET pauses=$2 WHERE scope=$1", [store.scope, JSON.stringify({ claims: true })]);
  await status(a);   // another player's request sees the pause
  await pool.query("UPDATE ryo_admin_control SET pauses='{}' WHERE scope=$1", [store.scope]);
  now += 2 * H; s = await status(away);
  assert.deepEqual([s.state, s.activeFrom], ['grace', outageAt + 12 * H], 'a player who missed the outage still gets a fresh 12 h grace after it');
  assert.equal((await chestOf(away)).overflowWindow, undefined, 'the hand-over window is never stored');
  // A failing overflow lookup never blocks crediting: no penalty for that tick, the request still succeeds.
  await pool.query('ALTER TABLE ryo_chest_overflow_outages RENAME TO ryo_chest_overflow_outages_off');
  const errored = await A.adventure(store, a, { active: false }, 0);
  assert.deepEqual([errored.overflow.ratePercent, errored.overflow.unavailable], [100, 'error'], 'error: no penalty, request succeeds');
  await pool.query('ALTER TABLE ryo_chest_overflow_outages_off RENAME TO ryo_chest_overflow_outages');
  process.env.REWARD_CLAIMS_ENABLED = 'off'; s = await status(a); assert.deepEqual([s.state, s.unavailable], ['waiting', 'closed'], 'claims switched off'); process.env.REWARD_CLAIMS_ENABLED = 'on';
  await pool.query("UPDATE ryo_admin_control SET config=config-'rewardBudget' WHERE scope=$1", [store.scope]);
  s = await status(a); assert.deepEqual([s.state, s.unavailable], ['waiting', 'budget'], 'no approved reward budget');
  await fixture.budget(store, { dailyCapRyo: 1, perClaimMaxRyo: 1, evidence: 'Used-up budget' });
  await pool.query('INSERT INTO ryo_reward_claims(scope,wallet,amount,created) VALUES($1,$2,1,$3)', [store.scope, address(), now - H]);   // another player claimed today
  s = await status(a); assert.deepEqual([s.state, s.unavailable], ['waiting', 'budget'], "today's budget used up");
  await fixture.budget(store, { dailyCapRyo: 5000000, perClaimMaxRyo: 5000000, evidence: 'Isolated overflow budget' });
  const empty = new Store(pool, 'solana-mainnet:overflow-empty', () => now), e = address();
  await A.adventure(empty, e, { active: false }, 0);
  const er = (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [empty.scope, e])).rows[0].data; er.pending = 900000 * 1000;
  await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [empty.scope, e, JSON.stringify(er)]);
  s = (await A.adventure(empty, e, { active: false }, 0)).overflow; assert.deepEqual([s.state, s.unavailable], ['waiting', 'pool'], 'unfunded reward pool');
  // Approaching alert threshold, and the release date: nobody is penalised before LAUNCH_AT + 12 h.
  const n = address(); await setChest(n, 460000); assert.equal((await status(n)).state, 'approaching');
  now = O.LAUNCH_AT - 5 * H; const early = address(); await setChest(early, 900000);
  s = await status(early); assert.deepEqual([s.state, s.activeFrom], ['grace', O.LAUNCH_AT + 12 * H], 'release grace');
  // Off switch (rollback without a code change): no status and no penalty.
  process.env.CHEST_OVERFLOW_ENABLED = 'off'; now = O.LAUNCH_AT + 30 * 24 * H;
  assert.equal((await A.adventure(store, a, { active: false }, 0)).overflow, null, 'switched off');
  assert.equal((await chestOf(a)).overflow.since, null, 'switching off clears the stored timing (a fresh grace when switched back on)');
  delete process.env.CHEST_OVERFLOW_ENABLED;
  // Beta (Devnet build): no claim timer; the same grace and tiers.
  network.built = BETA; const betaStore = new Store(pool, 'solana-devnet:overflow-beta', () => now); await pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,'beta-income-000001','summon','{}',$3,'{}','{}',1,'beta-income-sig','w',1,'confirmed',$4)", [betaStore.scope, address(), JSON.stringify({ operations: 1e9 }), now]);
  const bw = address(); await A.adventure(betaStore, bw, { active: false }, 0);
  const br = (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [betaStore.scope, bw])).rows[0].data; br.pending = 1200000 * 1000;
  await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [betaStore.scope, bw, JSON.stringify(br)]);
  s = (await A.adventure(betaStore, bw, { active: false }, 0)).overflow; assert.deepEqual([s.state, s.tierPercent], ['grace', 30], 'beta: grace, then -30% ');

  network.built = builtBefore; await db.close();
  for (const k of Object.keys(process.env)) if (!(k in envBefore)) delete process.env[k]; Object.assign(process.env, envBefore);
  console.log('PASS: Chest Overflow — tiers at every boundary, the Chest balance at each defeat, timing and crossing, earned Ryo never reduced, identical without the window; service: grace from claim availability (12 h, fixed across refreshes), active -10/-20%, Chest spend/refund changing the tier without a new grace, offline Sensei defeats pay less, a claim restarting the timer, pause/closed/no budget/used-up budget/unfunded pool = no penalty and a fresh grace, approaching, release grace, off switch, beta.');
})().catch(e => { console.error(e); process.exitCode = 1; });
