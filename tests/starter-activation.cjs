'use strict';
/* Starter Activation System (owner request 2026-11-11), real Store / PGlite on simulated Mainnet, controllable clock: launch
 * scheduling at the next 12:00 PM PHT (04:00 UTC) and explicit dates, persisted once; the creation-time boundary; existing
 * accounts untouched; exactly one starter pack of 10 Genin 1/1/1 lv1 bonus 0, bound (Market flag, fusion keeps it), not
 * salvageable, trainable; 50% enemy rewards online/offline until 15 settled paid summons (balance; starter Ryo, refunds and
 * pending never count), then 100% permanently; the larger of Starter and Chest Overflow penalties; switches; daily cap. */
const fixture = require('./sr-revenue-fixture.cjs'); fixture.liveEconomy();
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const network = require('../app/server/network.cjs'), { Store } = require('../app/server/store.cjs'), economy = require('../app/server/economy.cjs');
const A = require('../app/server/adventure.cjs'), CA = require('../app/server/combat-adventure.cjs'), SA = require('../app/server/starter-activation.cjs');
const H = 3600000, clone = v => JSON.parse(JSON.stringify(v));
const rejects = async (p, re, m) => assert.rejects(p, e => re.test(e.message), m);
(async () => {
  const builtBefore = network.built, envBefore = { ...process.env }; network.built = () => network.NETWORKS.mainnet;
  /* ---------- Schedule math (Asia/Manila, UTC+8, no DST) ---------- */
  const at = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h, mi);   // UTC
  assert.equal(SA.nextNoonPht(at(2026, 11, 12, 2)), at(2026, 11, 12, 4), '10:00 PHT -> 12:00 PHT the same day (04:00 UTC)');
  assert.equal(SA.nextNoonPht(at(2026, 11, 12, 6)), at(2026, 11, 13, 4), '14:00 PHT -> 12:00 PHT the next day');
  assert.equal(SA.nextNoonPht(at(2026, 11, 12, 4)), at(2026, 11, 13, 4), 'exactly noon -> the next noon');
  assert.equal(SA.nextNoonPht(at(2026, 11, 12, 17)), at(2026, 11, 13, 4), '01:00 PHT -> 12:00 PHT that day');

  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  let now = at(2026, 11, 12, 2); const store = new Store(pool, 'solana-mainnet:starter-test', () => now);
  const address = () => web3.Keypair.generate().publicKey.toBase58();
  const audits = []; const admin = (operation, extra = {}) => SA.admin(store, 'approver-wallet', { operation, ...extra }, async (c, act, t, d) => { audits.push(act); });
  const tx = async () => ({ signature: 'st-sig-' + crypto.randomUUID(), wire: 'w', lastHeight: 1 });
  let n = 0; const rid = () => 'st-request-' + String(++n).padStart(8, '0');
  const setBalance = (w, b, bonus = 0) => pool.query('UPDATE ryo_accounts SET balance=$3,bonus=$4 WHERE scope=$1 AND wallet=$2', [store.scope, w, b, bonus]);
  const summon = async (w, quantity, settle = 'confirmed') => { const q = economy.quote(await store.profile(w), 'summon', { quantity }); const row = await store.purchase(w, rid(), 'summon', { quantity }, q.total, tx); if (settle) await store.settlePurchase(w, row.request_id, settle); return row; };

  /* ---------- Dormant until scheduled ---------- */
  const existing = address(); const ep = await store.profile(existing);
  assert(Number.isSafeInteger(ep.createdAt), 'new profiles get a server creation time'); assert.equal(ep.starterActivation, undefined, 'no schedule: nothing granted');
  const legacy = address(); await store.profile(legacy); const lp = await store.profile(legacy); delete lp.createdAt; delete lp.starterActivation;
  await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, legacy, JSON.stringify(lp)]);   // a pre-feature account
  /* ---------- Schedule: next noon PHT, persisted ---------- */
  await rejects(admin('starter-schedule', { mode: 'date', at: now - 1 }), /future/);
  const sch = (await admin('starter-schedule', { mode: 'next-noon', dailyGrantCap: 1000 })).schedule;
  assert.equal(sch.scheduledActivationAt, at(2026, 11, 12, 4), 'deployed 10:00 PHT -> noon the same day');
  const restarted = new Store(pool, 'solana-mainnet:starter-test', () => now);
  assert.equal((await SA.config(restarted)).scheduledActivationAt, sch.scheduledActivationAt, 'a restart / second instance reads the same launch');
  assert.equal((await admin('starter-status')).launched, false);
  // Just before the launch: existing-account behaviour.
  now = sch.scheduledActivationAt - 1; const early = address();
  assert.equal((await store.profile(early)).starterActivation, undefined, 'created 1 ms before the launch: not eligible');
  /* ---------- At the launch ---------- */
  now = sch.scheduledActivationAt; const a = address();
  const pa = await store.profile(a), starters = pa.heroes.filter(h => h.starterGrant);
  assert.equal(starters.length, 10, 'exactly 10 starter Genin');
  assert(starters.every(h => h.rank === 0 && h.level === 1 && h.baseStats.pw === 1 && h.baseStats.sp === 1 && h.baseStats.st === 1 && h.bonus.pw === 0 && h.bonus.sp === 0 && h.bonus.st === 0), 'all 1/1/1, level 1, no bonus');
  assert(starters.every(h => h.referralReward === true && h.name && Array.isArray(h.perks)), 'bound, with normal Genin identity and perks');
  assert.deepEqual(pa.starterActivation, { state: 'active', paidSummons: 0, grantedAt: now, rulesVersion: 1 });
  await rejects(admin('starter-schedule', { mode: 'next-noon' }), /already happened/, 'the launch cannot be moved once it happened');
  assert.equal((await store.profile(a)).heroes.filter(h => h.starterGrant).length, 10, 'reloading never grants again');
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_starter_activation_grants WHERE scope=$1', [store.scope])).rows[0].n), 1, 'one grant record');
  assert.equal((await store.profile(existing)).starterActivation, undefined, 'existing accounts never change');
  assert.equal((await store.profile(legacy)).starterActivation, undefined, 'pre-feature accounts never change');
  // Bound, not salvageable, trainable; fusion output stays bound.
  const H_ = require('../app/server/hero-upgrades.cjs');
  assert.throws(() => H_.salvageProfile(clone(pa), starters[0].tokenId, now), /cannot be salvaged/, 'salvage refused');
  { const tp = { ...clone(pa), upgradeShards: 5 }; assert.equal(economy.quote(tp, 'training', { heroId: starters[0].tokenId }).training.level, 1, 'training works'); }
  const fp = clone(pa); fp.battleReady = fp.battleReady.filter(t => !starters.slice(0, 3).some(h => h.tokenId === t));
  const fq = economy.quote(fp, 'fusion', { heroIds: starters.slice(0, 3).map(h => h.tokenId), fusionRulesVersion: 1, fusionRulesAccepted: 1 });
  assert.equal(economy.fulfill(fp, { ...fq, fusion: { ...fq.fusion, successPercent: 100 } }, now).result.outputs[0].referralReward, true, 'fusion keeps the binding');
  { const out = economy.fulfill(fp, { ...fq, fusion: { ...fq.fusion, successPercent: 100 } }, now).result.outputs[0]; assert.equal(out.starterGrant, true, 'a hero fused from starter Genin stays not salvageable'); const sp = clone(fp); sp.heroes.push(out); assert.throws(() => H_.salvageProfile(sp, out.tokenId, now), /cannot be salvaged/); }

  /* ---------- 50% enemy rewards (pure advance: online/offline payout) ---------- */
  const team = economy.normalizeProfile({ dojo: 6, heroes: Array.from({ length: 4 }, (_, i) => ({ tokenId: 'h' + i, rank: 3, baseStats: { pw: 12, sp: 12, st: 12 }, trainingVersion: 2 })), battleReady: [] });
  team.battleReady = team.heroes.map(h => h.tokenId); Object.assign(team, { sensei: true, senseiEnabled: true, senseiReturnPercent: 50 });
  const t0 = at(2027, 1, 5, 12), seed = CA.advance(null, team, t0, false, 100);
  const run = (extra = {}) => { const kills = []; CA.advance({ ...clone(seed), ...extra }, clone(team), t0 + 3600000, false, 100, null, (e) => kills.push(e)); return kills; };
  const full = run(), half = run({ starterWindow: { bps: 5000 } });
  assert(full.length >= 4 && half.length === full.length);
  half.forEach((e, i) => assert.equal(e, Math.floor(full[i] * 0.5), 'defeat ' + i + ' pays 50%'));
  const both = run({ pending: 1500000000, starterWindow: { bps: 5000 }, overflowWindow: { activeFrom: 0 } });
  both.forEach((e, i) => assert.equal(e, Math.floor(full[i] * 0.5), 'Starter 50% vs Overflow 30%: the larger penalty, never stacked'));
  const ovOnly = run({ pending: 1500000000, overflowWindow: { activeFrom: 0 } });
  ovOnly.forEach((e, i) => assert.equal(e, Math.floor(full[i] * 0.7), 'without the starter rate Overflow is unchanged'));
  // Through the service: window() hands the rate over only for an active starter account, and only while switched on.
  const data = {}; await SA.window(store, null, a, data, pa); assert.deepEqual(data.starterWindow, { bps: 5000 });
  const none = {}; await SA.window(store, null, existing, none, await store.profile(existing)); assert.equal(none.starterWindow, undefined, 'existing accounts: full rate');
  process.env.STARTER_TRACKING_ENABLED = 'off'; const noTrack = {}; await SA.window(store, null, a, noTrack, pa); assert.equal(noTrack.starterWindow, undefined, 'tracking off: never held at 50%'); delete process.env.STARTER_TRACKING_ENABLED;
  process.env.STARTER_REWARD_RATE_ENABLED = 'off'; const off = {}; await SA.window(store, null, a, off, pa); assert.equal(off.starterWindow, undefined, 'rate switch off'); delete process.env.STARTER_REWARD_RATE_ENABLED;
  const chest = await A.adventure(store, a, { active: false }, 0);
  assert.deepEqual([chest.starter.state, chest.starter.paidSummons, chest.starter.remaining, chest.starter.ratePercent], ['active', 0, 15, 50], 'the Chest response carries the activation view');
  assert.equal((await A.adventure(store, a, { active: false }, 0)).overflowWindow, undefined);

  /* ---------- 15 paid summons (purchases on the Devnet build: no live SR routing needed; the starter logic is network-agnostic) ---------- */
  network.built = () => network.NETWORKS.devnet;
  await setBalance(a, 1e7);
  await summon(a, 5);
  assert.equal((await store.profile(a)).starterActivation.paidSummons, 5, 'counted at confirmed settlement');
  await summon(a, 5, null); assert.equal((await store.profile(a)).starterActivation.paidSummons, 5, 'pending does not count');
  const pendingRow = (await pool.query("SELECT request_id FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending'", [store.scope, a])).rows[0].request_id;
  await store.settlePurchase(a, pendingRow, 'refunded'); assert.equal((await store.profile(a)).starterActivation.paidSummons, 5, 'refunds never count');
  const bonusOnly = address(); now += 1; await store.profile(bonusOnly); await setBalance(bonusOnly, 0, 1e6);
  await summon(bonusOnly, 5); assert.equal((await store.profile(bonusOnly)).starterActivation.paidSummons, 0, 'free starter Ryo never counts');
  await summon(a, 10);
  const done = (await store.profile(a)).starterActivation;
  assert.deepEqual([done.state, done.paidSummons, typeof done.completedAt], ['complete', 15, 'number'], '15 paid summons: activated');
  const after = {}; await SA.window(store, null, a, after, await store.profile(a)); assert.equal(after.starterWindow, undefined, '100% from now on');
  await summon(a, 1); assert.equal((await store.profile(a)).starterActivation.state, 'complete', 'permanent');
  assert.equal((await A.adventure(store, a, { active: false }, 0)).starter.state, 'complete');

  network.built = () => network.NETWORKS.mainnet;
  /* ---------- Switches and the daily cap ---------- */
  process.env.STARTER_PACK_ENABLED = 'off'; const noPack = address(); now += 1;
  assert.equal((await store.profile(noPack)).starterActivation, undefined, 'pack switch off: a normal account'); delete process.env.STARTER_PACK_ENABLED;
  const capStore = new Store(pool, 'solana-mainnet:starter-cap', () => now);
  await SA.admin(capStore, 'approver-wallet', { operation: 'starter-schedule', mode: 'date', at: now + 1000, dailyGrantCap: 1 }, async () => {});
  now += 2000; const c1 = address(), c2 = address();
  assert.equal((await capStore.profile(c1)).starterActivation.state, 'active');
  const p2 = await capStore.profile(c2);
  assert.deepEqual([p2.starterActivation.state, p2.heroes.some(h => h.starterGrant)], ['capped', false], 'over the daily cap: no free heroes and no penalty, recorded for review');
  const cw = {}; await SA.window(capStore, null, c2, cw, p2); assert.equal(cw.starterWindow, undefined);
  assert.deepEqual((await SA.admin(capStore, 'approver-wallet', { operation: 'starter-status' }, async () => {})).grants, { granted: 1, capped: 1 });
  // Unschedule before launch only.
  const later = new Store(pool, 'solana-mainnet:starter-later', () => now);
  await SA.admin(later, 'x', { operation: 'starter-schedule', mode: 'next-noon' }, async () => {});
  assert.equal((await SA.admin(later, 'x', { operation: 'starter-unschedule' }, async () => {})).schedule, null);
  assert(audits.includes('admin.starter-scheduled'), 'audited');

  network.built = builtBefore; await db.close();
  for (const k of Object.keys(process.env)) if (!(k in envBefore)) delete process.env[k]; Object.assign(process.env, envBefore);
  console.log('PASS: Starter Activation — next 12:00 PM PHT (same day / next day / exactly noon), persisted across instances, cannot move after launch; creation-time boundary; existing and pre-feature accounts untouched; exactly one pack of 10 Genin 1/1/1 lv1 bonus 0 (bound, not salvageable, trainable, fusion keeps the binding); 50% per defeat, larger-of with Overflow (never stacked), Chest view; 15 settled paid summons (pending/refund/starter Ryo excluded) unlock 100% permanently; switches; daily cap; unschedule before launch.');
})().catch(e => { console.error(e); process.exitCode = 1; });
