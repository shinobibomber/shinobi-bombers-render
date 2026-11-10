'use strict';
/* Dojo Chest Claim Limit Bonus (owner request 2026-11-11), assembled server modules on simulated Mainnet (PGlite, controllable
 * clock, no RPC): personal allowance = approved base + Dojo tier x 100,000 (tiers 0..6, existing owners automatically), always
 * within the per-claim maximum, the remaining daily budget, pool/custody and the Chest; unset base = claims exactly as before;
 * 24 h / Founder 12 h cooldowns unchanged; failed claims consume nothing; concurrent claims; Chest spending limit unaffected;
 * the claim details sent to the Chest UI. */
const fixture = require('./sr-revenue-fixture.cjs'); fixture.liveEconomy();
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const network = require('../app/server/network.cjs'), { Store } = require('../app/server/store.cjs');
const A = require('../app/server/adventure.cjs'), T = require('../app/server/treasury-rewards.cjs');
const H = 3600000, DAY = 24 * H;
(async () => {
  const builtBefore = network.built; network.built = () => network.NETWORKS.mainnet;
  const db = new PGlite(), schema = fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'); await db.exec(schema);
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  let now = Date.UTC(2027, 1, 1, 12); const store = new Store(pool, 'solana-mainnet:dojo-claims', () => now);
  const address = () => web3.Keypair.generate().publicKey.toBase58(), CUSTODY = 1e12;
  const player = async (dojo, chestRyo) => {
    const w = address(); await A.adventure(store, w, { active: false }, 0);
    const p = await store.profile(w); p.dojo = dojo; await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, JSON.stringify(p)]);
    const row = (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, w])).rows[0].data; row.pending = chestRyo * 1000; row.last = now;
    await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, JSON.stringify(row)]); return w;
  };
  const claim = (w, custody = CUSTODY) => A.adventure(store, w, { active: false, claim: true }, custody);
  const pending = async w => (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, w])).rows[0].data.pending / 1000;
  const setBudget = b => fixture.budget(store, { evidence: 'Isolated Dojo claim budget', ...b });
  await fixture.topUp(store, 50000000);

  /* Budget validation */
  assert.throws(() => T.validateBudget({ dailyCapRyo: 1e6, perClaimMaxRyo: 5e5, basePersonalAllowanceRyo: 500001, evidence: 'x' }), /Base personal claim allowance/, 'base above the per-claim maximum is refused');
  for (const bad of [0, -1, 1.5, '5']) assert.throws(() => T.validateBudget({ dailyCapRyo: 1e6, perClaimMaxRyo: 5e5, basePersonalAllowanceRyo: bad, evidence: 'x' }), /Base personal claim allowance/);
  assert.deepEqual(T.validateBudget({ dailyCapRyo: 1e6, perClaimMaxRyo: 5e5, evidence: 'x' }), { dailyCapRyo: 1e6, perClaimMaxRyo: 5e5, evidence: 'x' }, 'unset base: the budget is exactly as before');

  /* Unset base: claims exactly as before (per-claim maximum), whatever the Dojo tier */
  await setBudget({ dailyCapRyo: 50000000, perClaimMaxRyo: 300000 });
  const old6 = await player(6, 2000000);
  assert.equal((await claim(old6)).credited, 300000, 'no base: Legendary Dojo claims the per-claim maximum, as before');
  assert.equal((await T.claimInfo(store, store.pool, old6)).claimAllowance.active, false);

  /* Base 500,000 + tier x 100,000, ceiling 1,100,000: every tier, existing owners automatically */
  await setBudget({ dailyCapRyo: 50000000, perClaimMaxRyo: 1100000, basePersonalAllowanceRyo: 500000 });
  for (let tier = 0; tier <= 6; tier++) {
    const w = await player(tier, 2000000), info = (await T.claimInfo(store, store.pool, w)).claimAllowance;
    assert.deepEqual([info.active, info.dojoTier, info.dojoBonusRyo, info.baseAllowanceRyo, info.personalAllowanceRyo, info.hardCeilingRyo, info.effectiveRyo], [true, tier, tier * 100000, 500000, 500000 + tier * 100000, 1100000, 500000 + tier * 100000], 'claim details tier ' + tier);
    const r = await claim(w);
    assert.equal(r.credited, 500000 + tier * 100000, 'tier ' + tier + ' claims base + ' + tier * 100000);
    assert.equal(await pending(w), 2000000 - r.credited, 'the Chest is reduced by exactly the claim');
    assert.equal(await store.balance(w), r.credited, 'credited to the game balance');
  }
  // Never above the Chest.
  const small = await player(6, 250000); assert.equal((await claim(small)).credited, 250000, 'never more than the verified Chest');
  // The hard per-claim ceiling below the personal allowance wins, and is reported.
  await setBudget({ dailyCapRyo: 50000000, perClaimMaxRyo: 600000, basePersonalAllowanceRyo: 500000 });
  const capped = await player(6, 2000000);
  assert.equal((await T.claimInfo(store, store.pool, capped)).claimAllowance.limitedBy, 'ceiling');
  assert.equal((await claim(capped)).credited, 600000, 'Legendary Dojo capped by the per-claim maximum');
  // The remaining daily budget wins, and is reported.
  const used = await T.budgetUsed(store, store.pool, now);
  await setBudget({ dailyCapRyo: used + 350000, perClaimMaxRyo: used + 350000 > 1100000 ? 1100000 : used + 350000, basePersonalAllowanceRyo: 500000 });
  const late = await player(4, 2000000);
  assert.equal((await T.claimInfo(store, store.pool, late)).claimAllowance.limitedBy, 'budget');
  assert.equal((await claim(late)).credited, 350000, 'limited by what is left of the daily budget');
  await assert.rejects(claim(await player(6, 2000000)), /fully claimed/, 'daily budget used up: refused, earnings stay');

  /* Cooldowns unchanged: 24 h regular, 12 h Founder; failed claims consume nothing */
  now += 2 * DAY; await setBudget({ dailyCapRyo: 50000000, perClaimMaxRyo: 1100000, basePersonalAllowanceRyo: 500000 });
  const reg = await player(6, 3000000);
  await assert.rejects(claim(reg, 0), /No funded whole Ryo/, 'custody shortfall refuses the claim');
  assert.equal(await pending(reg), 3000000, 'a failed claim deducts nothing');
  assert.equal((await claim(reg)).credited, 1100000, 'and does not consume the cooldown');
  now += 23 * H; await assert.rejects(claim(reg), /once every 24 hours/, 'regular 24 h cooldown unchanged by Dojo');
  now += H; assert.equal((await claim(reg)).credited, 1100000);
  const founders = require('../app/server/founders.cjs'), original = founders.chestCooldownMs;
  founders.chestCooldownMs = async () => founders.FOUNDER_CHEST_COOLDOWN_MS;
  const fnd = await player(6, 3000000); assert.equal((await claim(fnd)).credited, 1100000);
  now += 11 * H; await assert.rejects(claim(fnd), /once every 12 hours/, 'Founder 12 h cooldown unchanged');
  now += H; assert.equal((await claim(fnd)).credited, 1100000, 'Founder: same Dojo allowance, no extra Founder amount');
  founders.chestCooldownMs = original;
  // Concurrent claims from two devices: one succeeds.
  now += DAY; const dup = await player(5, 3000000);
  const both = await Promise.allSettled([claim(dup), claim(dup)]);
  assert.equal(both.filter(x => x.status === 'fulfilled').length, 1, 'one claim per cooldown under concurrency');
  assert.equal(await pending(dup), 3000000 - 1000000);
  // Chest-funded purchases keep their own limit (no Dojo bonus).
  assert.equal(await T.chestLimit(store, store.pool), 1100000, 'Chest spending limit = per-claim maximum, unaffected by Dojo');

  network.built = builtBefore; await db.close();
  console.log('PASS: Dojo claim bonus — base + tier x 100,000 for tiers 0..6 (existing owners automatic), never above the Chest, the per-claim maximum or the remaining daily budget (reported), unset base = exactly as before, budget validation, 24 h / Founder 12 h cooldowns unchanged, failed claims consume nothing, one claim under concurrency, Chest spending limit unaffected.');
})().catch(e => { console.error(e); process.exitCode = 1; });
