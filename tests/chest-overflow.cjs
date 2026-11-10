'use strict';
/* Chest Overflow (owner request 2026-11-11; rule updated the same day: always, no exceptions, no grace): from a 500,000 Ryo
 * Chest, NEW enemy rewards pay 90/80/70%. (1) the tier per defeat in combat-adventure advance() (exact boundaries, the Chest
 * balance at that defeat, timing, crossing a threshold, earned Ryo never reduced, byte-identical without the window), (2) the
 * Adventure service on simulated Mainnet (assembled modules, PGlite, controllable clock; no RPC). */
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

  /* ---------- 2. Through the Adventure service (simulated Mainnet): always, no exceptions, no grace ---------- */
  network.built = LIVE;
  const db = new PGlite(), schema = fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'); await db.exec(schema);
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  let now = O.LAUNCH_AT + 3 * 24 * H; const store = new Store(pool, 'solana-mainnet:overflow-test', () => now);
  const address = () => web3.Keypair.generate().publicKey.toBase58();
  const chestOf = async (wallet, s = store) => (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [s.scope, wallet])).rows[0].data;
  const setChest = async (wallet, ryo, s = store) => { await A.adventure(s, wallet, { active: false }, 0); const row = await chestOf(wallet, s); row.pending = ryo * 1000; await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [s.scope, wallet, JSON.stringify(row)]); };
  const status = async (wallet, s = store) => (await A.adventure(s, wallet, { active: false }, 0)).overflow;
  await fixture.topUp(store, 5000000);
  await fixture.budget(store, { dailyCapRyo: 5000000, perClaimMaxRyo: 200000, evidence: 'Isolated overflow budget' });   // owner's live maximum

  // Active immediately from 500,000 (no grace, never claimed), tiers by Chest size.
  const a = address();
  for (const [ryo, tier, rate] of [[460000, 0, 100], [500000, 10, 90], [750000, 20, 80], [1000000, 30, 70]]) {
    await setChest(a, ryo); const s = await status(a);
    assert.deepEqual([s.tierPercent, s.ratePercent, s.state], [tier, rate, tier ? 'active' : 'approaching'], ryo + ' Ryo');
  }
  // Right after a claim and while the claim timer runs: still active (a claim lowers the Chest by at most 200,000).
  await setChest(a, 900000);
  const claimed = await A.adventure(store, a, { active: false, claim: true }, 1e12);
  assert.deepEqual([claimed.credited, claimed.overflow.state, claimed.overflow.tierPercent], [200000, 'active', 10], 'after a claim: 700,000 left, -10% at once');
  now += 6 * H; const running = await status(a);
  assert.deepEqual([running.state, running.ratePercent], ['active', 90], 'claim timer running: still -10%');
  // Spending lowers it at once.
  const raw = await chestOf(a); raw.pending = 400000 * 1000; await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, a, JSON.stringify(raw)]);
  assert.equal((await status(a)).state, 'ok', 'below 500,000: full rewards');
  // No exceptions: paused, switched off, no budget, unfunded pool.
  await setChest(a, 800000);
  await pool.query("UPDATE ryo_admin_control SET pauses=$2 WHERE scope=$1", [store.scope, JSON.stringify({ claims: true })]);
  assert.equal((await status(a)).ratePercent, 80, 'claims paused: still -20%');
  await pool.query("UPDATE ryo_admin_control SET pauses='{}' WHERE scope=$1", [store.scope]);
  process.env.REWARD_CLAIMS_ENABLED = 'off'; assert.equal((await status(a)).ratePercent, 80, 'claims switched off: still -20%'); process.env.REWARD_CLAIMS_ENABLED = 'on';
  await pool.query("UPDATE ryo_admin_control SET config=config-'rewardBudget' WHERE scope=$1", [store.scope]);
  assert.equal((await status(a)).ratePercent, 80, 'no approved budget: still -20%');
  const empty = new Store(pool, 'solana-mainnet:overflow-empty', () => now), e = address();
  await setChest(e, 900000, empty); assert.equal((await status(e, empty)).ratePercent, 80, 'empty reward pool: still -20%');
  // Offline Sensei defeats pay less through the real service (same team, Chest 800,000 vs 100,000).
  const p = clone(profile); for (const h of p.heroes) delete h.chakra;
  const b = address(); await setChest(b, 100000);
  for (const w of [a, b]) {
    await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, JSON.stringify(p)]);
    const r = await chestOf(w); Object.assign(r, { last: now, active: false, kills: 0, map: 1, target: 0, hp: 100, energy: {} }); delete r.combatVersion; delete r.team;
    await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, JSON.stringify(r)]);
  }
  const [pa, pb] = [(await chestOf(a)).pending, (await chestOf(b)).pending];
  now += 15 * 60000; await status(a); await status(b);
  const [da, db2] = [(await chestOf(a)).pending - pa, (await chestOf(b)).pending - pb], kills = (await chestOf(b)).kills;
  assert(db2 > 0 && kills > 0, 'the control Chest earned from offline defeats');
  assert(da <= Math.floor(db2 * 0.8) && da >= db2 * 0.8 - kills, 'offline Sensei defeats pay 80% at an 800,000 Ryo Chest (' + da + ' vs ' + db2 + ')');
  assert.equal((await chestOf(a)).overflowWindow, undefined, 'the hand-over window is never stored');
  // Retired timing state is cleared.
  const old = await chestOf(a); old.overflow = { since: 123 }; await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, a, JSON.stringify(old)]);
  await status(a); assert.equal((await chestOf(a)).overflow, undefined, 'old grace timing removed');
  // Off switch (rollback without a code change).
  process.env.CHEST_OVERFLOW_ENABLED = 'off';
  assert.equal((await A.adventure(store, a, { active: false }, 0)).overflow, null, 'switched off');
  delete process.env.CHEST_OVERFLOW_ENABLED;
  // Beta (Devnet build): same rule.
  network.built = BETA; const beta = new Store(pool, 'solana-devnet:overflow-beta', () => now), bw = address();
  await setChest(bw, 1200000, beta); const bs = await status(bw, beta);
  assert.deepEqual([bs.state, bs.tierPercent], ['active', 30], 'beta: -30%');

  network.built = builtBefore; await db.close();
  for (const k of Object.keys(process.env)) if (!(k in envBefore)) delete process.env[k]; Object.assign(process.env, envBefore);
  console.log('PASS: Chest Overflow — tiers at every boundary, the Chest balance at each defeat, timing and crossing, earned Ryo never reduced, identical without the window; service: active at once from 500,000 (no grace), right after a claim and while the timer runs, while paused / switched off / without budget / with an empty pool, spending lowers it at once, offline Sensei defeats pay less, retired timing cleared, off switch, beta.');
})().catch(e => { console.error(e); process.exitCode = 1; });
