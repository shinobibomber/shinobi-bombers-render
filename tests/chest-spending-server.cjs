'use strict';
/* Direct Chest Reward Spending (owner request 2026-11-11), server side, real Store / PGlite transactions.
 * A chest spend = claim that SR + pay it from the balance, atomically, without the claim timer: verified chest, funded pool,
 * custody minus liabilities and (live) the shared daily budget; no ryo_reward_claims row; the purchase settles like any other
 * (grant only at confirmed settlement); refunds restore the chest exactly; Adventure commission once, no purchase commission. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), economy = require('../app/server/economy.cjs');
const chest = require('../app/server/chest-spending.cjs'), adventure = require('../app/server/adventure.cjs'), cp = require('../app/server/creators-portal.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
(async () => {
  const env = { ...process.env };
  Object.assign(process.env, { CHEST_SPENDING_ENABLED: 'on', REWARD_CLAIMS_ENABLED: 'on', CREATORS_PORTAL_ENABLED: 'on' });
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(), now = Date.UTC(2026, 10, 11, 12), rid = 0;
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'chest-spending-test', () => now);
  const rows = async (s, a = []) => (await pool.query(s, [store.scope, ...a])).rows;
  let custodyRyo = 1e9; const custody = async () => custodyRyo;
  const id = () => 'chest-spend-req-' + String(++rid).padStart(6, '0');
  const tx = async () => ({ signature: 'chest-sig-' + crypto.randomUUID(), wire: 'wire', lastHeight: 1 });
  const chestOf = async w => (await rows('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [w]))[0]?.data || {};
  const balanceOf = async w => Number((await rows('SELECT balance FROM ryo_accounts WHERE scope=$1 AND wallet=$2', [w]))[0]?.balance || 0);
  const player = async (chestRyo, balance = 0) => {
    const w = address(); await store.profile(w);
    await pool.query('UPDATE ryo_accounts SET balance=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, balance]);
    await pool.query('INSERT INTO ryo_adventures(scope,wallet,data) VALUES($1,$2,$3)', [store.scope, w, JSON.stringify({ map: 1, target: 0, hp: 100, kills: 0, pending: chestRyo * 1000, claimed: 0, last: now, active: false, energy: {} })]);
    return w;
  };
  // Funded reward pool: income = confirmed, non-bonus purchase operations (test build).
  const fund = async ryo => pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,$3,'summon','{}',$4,'{}','{}',1,$5,'w',1,'confirmed',$6)", [store.scope, address(), id(), JSON.stringify({ operations: ryo }), 'income-' + crypto.randomUUID(), now]);
  const buy = (w, opts = {}, product = 'summon', params = { quantity: 1 }, request = id()) => store.purchaseWith({ funding: 'chest', custody, ...opts }, w, request, product, params, economy.quote(opts.profile || { heroes: [] }, product, params).total ?? 25000, tx);
  const summonPrice = 25000;
  await fund(10000000);

  /* ---------- Spend before the claim timer; nothing is granted until settlement ---------- */
  const a = await player(30000, 5000), heroesBefore = (await store.profile(a)).heroes.length;
  const r1 = await buy(a);
  assert.equal(r1.quote.funding, 'chest'); assert.equal(r1.status, 'pending');
  assert.equal(await balanceOf(a), 5000, 'the game balance is not touched');
  let d = await chestOf(a); assert.equal(d.pending, (30000 - summonPrice) * 1000, 'the chest is debited'); assert.equal(d.claimed, summonPrice, 'and counts as used from the reward pool');
  assert.equal((await rows('SELECT COUNT(*) AS n FROM ryo_reward_claims WHERE scope=$1 AND wallet=$2', [a]))[0].n * 1, 0, 'a purchase is never a claim: the claim timer is untouched');
  assert.equal((await rows('SELECT status FROM ryo_chest_spends WHERE scope=$1 AND wallet=$2', [a]))[0].status, 'pending');
  assert.equal((await store.profile(a)).heroes.length, heroesBefore, 'no hero before settlement');
  await store.settlePurchase(a, r1.request_id, 'confirmed');
  assert.equal((await store.profile(a)).heroes.length, heroesBefore + 1, 'the hero arrives at confirmed settlement');
  assert.equal((await rows('SELECT status FROM ryo_chest_spends WHERE scope=$1 AND wallet=$2', [a]))[0].status, 'confirmed');
  // Replays: the same request id returns the same order (no second debit); a replay cannot switch funding.
  const again = await store.purchaseWith({ funding: 'chest', custody }, a, r1.request_id, 'summon', { quantity: 1 }, summonPrice, tx);
  assert.equal(again.request_id, r1.request_id); assert.equal((await chestOf(a)).pending, 5000 * 1000, 'a replay never charges twice');
  await assert.rejects(store.purchase(a, r1.request_id, 'summon', { quantity: 1 }, summonPrice, tx), /another order/, 'a replay cannot switch to balance funding');
  // The remaining chest is claimed normally (only the rest).
  const claim = await adventure.adventure(store, a, { claim: true }, 1e9);
  assert.equal(claim.credited, 5000, 'only the remaining 5,000 SR can be claimed'); assert.equal(await balanceOf(a), 10000);
  assert.equal((await chestOf(a)).pending, 0);

  /* ---------- Not enough chest / limits / refusals (nothing changes) ---------- */
  const b = await player(20000, 1e6);
  await assert.rejects(buy(b), /Not enough verified Chest rewards: 20,000 SR available, 25,000 SR needed/);
  assert.equal((await chestOf(b)).pending, 20000 * 1000, 'a refused spend changes nothing'); assert.equal(await balanceOf(b), 1e6);
  const full = await player(25000); await buy(full).then(r => store.settlePurchase(full, r.request_id, 'confirmed'));
  assert.equal((await chestOf(full)).pending, 0, 'the whole chest can be spent');
  await assert.rejects(store.purchaseWith({ funding: 'chest', custody }, b, id(), 'sensei', {}, 1512500, tx), /Summon, Fusion, Dojo upgrades and Training only/, 'Sensei is never chest-funded');
  const c1 = await player(100000); custodyRyo = 1000;
  await assert.rejects(buy(c1), /Custody tokens are temporarily unavailable/, 'custody minus liabilities must cover it'); custodyRyo = 1e9;
  process.env.CHEST_SPENDING_ENABLED = 'off'; await assert.rejects(buy(c1), /not open/, 'switch off'); process.env.CHEST_SPENDING_ENABLED = 'on';
  process.env.REWARD_CLAIMS_ENABLED = 'off'; await assert.rejects(buy(c1), /not open/, 'reward-claims gate closed'); process.env.REWARD_CLAIMS_ENABLED = 'on';
  await pool.query("INSERT INTO ryo_admin_control(scope,pauses,installed) VALUES($1,$2,$3) ON CONFLICT(scope) DO UPDATE SET pauses=$2", [store.scope, JSON.stringify({ claims: true }), now]);
  await assert.rejects(buy(c1), /temporarily paused/, 'operator claims pause'); await pool.query("UPDATE ryo_admin_control SET pauses='{}' WHERE scope=$1", [store.scope]);
  assert.equal((await chestOf(c1)).pending, 100000 * 1000);
  // Pool limit: a pool smaller than the price refuses.
  const poolNow = async () => { const inc = await require('../app/server/sr-revenue.cjs').income(store, store.pool), used = (await rows("SELECT COALESCE(SUM((data->>'claimed')::numeric),0) AS n FROM ryo_adventures WHERE scope=$1"))[0].n; return Math.floor(Number(inc.n) - Number(used)); };
  {
    const small = new Store(pool, 'chest-pool-test', () => now), sw = address(); await small.profile(sw);
    await pool.query('INSERT INTO ryo_adventures(scope,wallet,data) VALUES($1,$2,$3)', [small.scope, sw, JSON.stringify({ map: 1, pending: 30000 * 1000, claimed: 0, last: now, active: false, energy: {} })]);
    await pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,$3,'summon','{}',$4,'{}','{}',1,$5,'w',1,'confirmed',$6)", [small.scope, address(), id(), JSON.stringify({ operations: 10000 }), 'income-' + crypto.randomUUID(), now]);
    await assert.rejects(small.purchaseWith({ funding: 'chest', custody }, sw, id(), 'summon', { quantity: 1 }, summonPrice, tx), /funded reward pool cannot cover/, 'the funded reward pool limits chest spending');
  }

  /* ---------- Refund restores the chest exactly; nothing granted ---------- */
  const r = await player(40000), heroesR = (await store.profile(r)).heroes.length, poolBefore = await poolNow();
  const pr = await buy(r); assert.equal(await poolNow(), poolBefore - summonPrice);
  await store.settlePurchase(r, pr.request_id, 'refunded');
  assert.deepEqual([(await chestOf(r)).pending, (await chestOf(r)).claimed], [40000 * 1000, 0], 'chest and lifetime claimed restored');
  assert.equal(await balanceOf(r), 0, 'a refunded chest order never credits the game balance');
  assert.equal(await poolNow(), poolBefore, 'the pool is released'); assert.equal((await store.profile(r)).heroes.length, heroesR, 'nothing granted');
  assert.equal((await rows('SELECT status FROM ryo_chest_spends WHERE scope=$1 AND wallet=$2', [r]))[0].status, 'refunded');
  await store.settlePurchase(r, pr.request_id, 'refunded'); assert.equal((await chestOf(r)).pending, 40000 * 1000, 'a second refund changes nothing');

  /* ---------- Parallel: spend + spend, spend + claim, spend + withdraw ---------- */
  const p = await player(60000, 200000);
  const both = await Promise.allSettled([buy(p), buy(p)]);
  assert.equal(both.filter(x => x.status === 'fulfilled').length, 1, 'two parallel spends: one order (the other waits for the pending one)');
  const pp = both.find(x => x.status === 'fulfilled').value; await store.settlePurchase(p, pp.request_id, 'confirmed');
  const race = await Promise.allSettled([buy(p), adventure.adventure(store, p, { claim: true }, 1e9)]);
  const spent = race[0].status === 'fulfilled' ? summonPrice : 0, credited = race[1].status === 'fulfilled' ? race[1].value.credited : 0;
  const after = await chestOf(p);
  assert.equal(after.pending / 1000 + spent + credited + summonPrice, 60000, 'spend + claim in parallel: every SR is used once (' + spent + ' spent, ' + credited + ' claimed)');
  if (race[0].status === 'fulfilled') await store.settlePurchase(p, race[0].value.request_id, 'confirmed');
  const w = await player(30000, 200000), wid = id();
  const wr = await Promise.allSettled([buy(w), store.reserve(w, wid, 100000, async () => ({ signature: 'wsig-' + crypto.randomUUID(), wire: 'w', lastHeight: 1 }))]);
  assert(wr.every(x => x.status === 'fulfilled'), 'a withdrawal of the claimed balance and a chest spend are independent: ' + wr.map(x => x.reason?.message));
  assert.equal(await balanceOf(w), 100000, 'the withdrawal used only the balance'); assert.equal((await chestOf(w)).pending, 5000 * 1000, 'the spend used only the chest');

  /* ---------- Same price and discounts for both sources ---------- */
  const m = await player(30000, 30000), mp = await store.profile(m); mp.mythicPerk = true; await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, m, JSON.stringify(mp)]);
  const mq = economy.quote(await store.profile(m), 'summon', { quantity: 1 }); assert.equal(mq.total, 22500);
  await store.purchaseWith({ funding: 'chest', custody }, m, id(), 'summon', { quantity: 1 }, 22500, tx);
  assert.equal((await chestOf(m)).pending, 7500 * 1000, 'the Mythic Box 10% applies to chest funding too');
  await assert.rejects(store.purchaseWith({ funding: 'chest', custody }, m, id(), 'summon', { quantity: 1 }, 25000, tx), /pending|price changed/i, 'never a special price');

  /* ---------- Creator Points: Adventure commission once, no purchase commission, paid mints count ---------- */
  const admin = address(); process.env.RYO_ADMIN_APPROVERS = admin; await cp.initialize(store);
  const creatorWallet = address(); await cp.adminAction(store, admin, { operation: 'manual-add', wallet: creatorWallet, displayName: 'Creator', reason: 'fixture creator' });
  const creatorId = (await rows('SELECT id FROM ryo_creators WHERE scope=$1 AND wallet=$2', [creatorWallet]))[0].id;
  const ref = await player(40000);
  await pool.query("INSERT INTO ryo_creator_referrals(scope,wallet,creator_id,attributed,paid_mints,stage5,qualified,expires,rules,pending_initialized) VALUES($1,$2,$3,$4,15,$4,$4,$5,$6,TRUE)", [store.scope, ref, creatorId, now - 1000, now + 90 * 86400000, JSON.stringify({ purchaseProducts: ['summon', 'fusion', 'dojo', 'training'], percent: 5 })]);
  await pool.query("INSERT INTO ryo_creator_adventure_lots(scope,wallet,event_id,remaining,eligible,created) VALUES($1,$2,'lot-a',10000000,FALSE,$3),($1,$2,'lot-b',30000000,TRUE,$3)", [store.scope, ref, now]);
  now += 1000; const cr = await buy(ref);
  assert.equal((await rows('SELECT eligible_milli FROM ryo_chest_spends WHERE scope=$1 AND wallet=$2', [ref]))[0].eligible_milli * 1, 15000000, 'lots drained FIFO: 10,000 not eligible, then 15,000 eligible');
  await store.settlePurchase(ref, cr.request_id, 'confirmed');
  const kinds = (await rows('SELECT kind,delta FROM ryo_creator_ledger WHERE scope=$1 AND creator_id=$2', [creatorId])).map(x => [x.kind, Number(x.delta)]);
  assert.deepEqual(kinds, [['adventure-commission', 750000]], '5% Adventure commission on the 15,000 eligible SR, and no purchase commission: ' + JSON.stringify(kinds));
  assert.equal((await rows('SELECT paid_mints FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [ref]))[0].paid_mints, 16, 'a chest-funded summon is a paid mint');
  await store.settlePurchase(ref, cr.request_id, 'confirmed'); assert.equal((await rows('SELECT COUNT(*) AS n FROM ryo_creator_ledger WHERE scope=$1 AND creator_id=$2', [creatorId]))[0].n * 1, 1, 'commission exactly once');
  // Refund restores the drained lots exactly.
  const ref2 = await player(40000);
  await pool.query("INSERT INTO ryo_creator_referrals(scope,wallet,creator_id,attributed,paid_mints,stage5,qualified,expires,rules,pending_initialized) VALUES($1,$2,$3,$4,15,$4,$4,$5,$6,TRUE)", [store.scope, ref2, creatorId, now - 1000, now + 90 * 86400000, JSON.stringify({ purchaseProducts: ['summon'], percent: 5 })]);
  await pool.query("INSERT INTO ryo_creator_adventure_lots(scope,wallet,event_id,remaining,eligible,created) VALUES($1,$2,'lot-c',40000000,TRUE,$3)", [store.scope, ref2, now]);
  const cr2 = await buy(ref2); await store.settlePurchase(ref2, cr2.request_id, 'refunded');
  assert.equal((await rows("SELECT remaining FROM ryo_creator_adventure_lots WHERE scope=$1 AND wallet=$2", [ref2]))[0].remaining * 1, 40000000, 'lots restored on refund');

  /* ---------- The purchase route's path: intent registered for the request id, taken by Store.purchase ---------- */
  { const iw = await player(30000, 100000), iid = id();
    chest.intend(store, iw, iid, { funding: 'chest', custody });
    const ir = await store.purchase(iw, iid, 'summon', { quantity: 1 }, summonPrice, tx);
    assert.equal(ir.quote.funding, 'chest', 'the route intent makes Store.purchase chest-funded'); assert.equal(await balanceOf(iw), 100000);
    await store.settlePurchase(iw, iid, 'confirmed');
    const plain = await store.purchase(iw, id(), 'summon', { quantity: 1 }, summonPrice, tx);
    assert.notEqual(plain.quote.funding, 'chest', 'without an intent the purchase is a balance purchase'); assert.equal(await balanceOf(iw), 100000 - summonPrice);
    assert.deepEqual(chest.takeIntent(store, iw, iid), {}, 'an intent is used once'); }
  /* ---------- Order: the on-chain settlement is prepared (all RPC) BEFORE the pool lock and the chest debit ---------- */
  { const ow = await player(30000), seen = [];
    await store.purchaseWith({ funding: 'chest', custody: async () => { seen.push('custody'); return custodyRyo; } }, ow, id(), 'summon', { quantity: 1 }, summonPrice,
      async (q, c) => { seen.push('prepare:' + (await c.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, ow])).rows[0].data.pending); return tx(); });
    assert.deepEqual(seen, ['custody', 'prepare:' + 30000 * 1000], 'custody is read first, prepare runs while the chest is still undebited');
    assert.equal((await chestOf(ow)).pending, 5000 * 1000, 'then the chest is debited'); }
  /* ---------- Checkout offer (read-only) ---------- */
  const o = await player(30000);
  const offer = await chest.offer(store, o, economy.quote({ heroes: [] }, 'summon', { quantity: 1 }), custody);
  assert.deepEqual([offer.enabled, offer.chestRyo, offer.spendableRyo >= summonPrice, offer.limitedBy], [true, 30000, true, null]);
  assert.equal((await chest.offer(store, o, { product: 'sensei', total: 1 }, custody)).enabled, false, 'no offer for excluded services');
  process.env.CHEST_SPENDING_ENABLED = 'off'; assert.equal((await chest.offer(store, o, economy.quote({ heroes: [] }, 'summon', { quantity: 1 }), custody)).enabled, false); process.env.CHEST_SPENDING_ENABLED = 'on';

  /* ---------- Live: the daily budget is shared with claims; the claim timer is not ---------- */
  const fixture = require('./sr-revenue-fixture.cjs'); fixture.liveEconomy(); const T = require('../app/server/treasury-rewards.cjs');
  const used = await T.budgetUsed(store, store.pool, now), cap = used + 40000;   // everything spent or claimed above counts
  assert(used >= 4 * summonPrice, 'chest spends and claims of the last 24 h are both counted: ' + used);
  await fixture.budget(store, { dailyCapRyo: cap, perClaimMaxRyo: 50000, evidence: 'fixture' });
  await store.transaction(async c => assert.equal(await T.chestLimit(store, c), cap - used, 'chest spends use the daily budget'));
  // Owner decision 2026-11-11: no per-purchase cap on Chest-funded purchases (the per-claim maximum no longer applies to them);
  // only the remaining daily budget, the player's Chest, the funded pool and custody.
  await fixture.budget(store, { dailyCapRyo: used + 400000, perClaimMaxRyo: 50000, evidence: 'fixture' });
  await store.transaction(async c => assert.equal(await T.chestLimit(store, c), 400000, 'a Chest-funded purchase may use more than the per-claim maximum'));
  await fixture.budget(store, { dailyCapRyo: cap, perClaimMaxRyo: 50000, evidence: 'fixture' });
  await pool.query("INSERT INTO ryo_chest_spends(scope,wallet,request_id,product,amount,status,created) VALUES($1,$2,'budget-refunded','summon',1000000,'refunded',$3)", [store.scope, address(), now]);
  assert.equal(await T.budgetUsed(store, store.pool, now), used, 'refunded spends release the budget');
  const fresh = await player(10);
  await assert.rejects(store.transaction(c => T.claimLimit(store, c, a)), /once every 24 hours/, 'claims still follow the per-player 24 h timer');
  await store.transaction(async c => assert.equal(await T.claimLimit(store, c, m), Math.min(50000, cap - used), 'a wallet that only spent from its chest can still claim (no timer started) and shares the budget'));
  assert(fresh);
  // 50/30/10/10 from the discounted total, identical whatever pays (funding is chosen after the quote).
  const live = economy.quote({ heroes: [], mythicPerk: true }, 'summon', { quantity: 1 });
  assert.equal(live.total, 22500); assert.deepEqual([live.treasury, live.operations, live.community, live.reserve], [11250, 6750, 2250, 2250]);
  await db.close();
  for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env);
  console.log('PASS: chest spending — spend verified unclaimed SR before the claim timer (no claim row), partial/full spend then claim the rest, grant only at settlement, exact refund (chest, pool, lots), replay-safe, parallel spend/claim/withdraw exact, pool/custody/budget/switch/gate/pause/product limits, same discounted price, Adventure commission once and no purchase commission, live budget shared with claims and 50/30/10/10 from the discounted total.');
})().catch(e => { console.error(e); process.exitCode = 1; });
