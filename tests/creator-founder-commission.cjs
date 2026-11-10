'use strict';
/* Creator Points at 10% for Founder-box referrals (owner decision 2026-11-10), with the automatic top-up of commissions already
 * earned at 5%. A referral with a CONFIRMED Founder box purchase earns the creator 10% on Adventure and game-service commissions;
 * other referrals stay at 5%. Every earlier 5% commission of that referral is raised exactly once (one ledger row per commission,
 * event topup:<source>), when the creator's dashboard loads, before a redemption spends the balance, when staff open the admin
 * view, and after a new commission for that referral. Original commission rows are never edited; CP never touches Ryo or the
 * reward pool. The read-only report predicts the same amount. Isolated PGlite fixtures only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), cp = require('../app/server/creators-portal.cjs');
const report = require('../tools/creator-founder-topup-report.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(), now = Date.UTC(2026, 10, 10, 12), serial = 0;
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'founder-commission-test', () => now), origin = 'https://shinobi.example';
  process.env.CREATORS_PORTAL_ENABLED = 'on';
  const admin = address(); process.env.RYO_ADMIN_APPROVERS = admin;
  const call = (wallet, action, body = {}) => cp.handle({ store, origin }, wallet, action, body);
  const rows = async (s, a = []) => (await pool.query(s, [store.scope, ...a])).rows;
  await cp.initialize(store);

  const creator = async name => {
    const wallet = address();
    await cp.adminAction(store, admin, { operation: 'manual-add', wallet, displayName: name, reason: 'fixture creator' });
    await call(wallet, 'creator-terms', { terms: true });
    const id = (await rows('SELECT id FROM ryo_creators WHERE scope=$1 AND wallet=$2', [wallet]))[0].id;
    return { wallet, id, balance: async () => BigInt((await rows('SELECT balance FROM ryo_creators WHERE scope=$1 AND id=$2', [id]))[0].balance) };
  };
  // A qualified referral inside its 90-day commission window (qualification itself is covered by creators-server.cjs).
  const referral = async (c, wallet = address()) => {
    await pool.query(`INSERT INTO ryo_creator_referrals(scope,wallet,creator_id,attributed,paid_mints,stage5,qualified,expires,rules,pending_initialized)
      VALUES($1,$2,$3,$4,15,$4,$4,$5,$6,TRUE)`, [store.scope, wallet, c.id, now - 1000, now + 90 * 86400000, JSON.stringify({ version: 1, days: 90, purchaseProducts: ['summon', 'fusion', 'dojo', 'sensei', 'sensei-rental', 'training'], percent: 5 })]);
    return wallet;
  };
  const buyFounderBox = (wallet, status = 'confirmed') => pool.query(`INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,created,settled)
    VALUES($1,$2,$3,'legacy',$4,$5,500000000,$6,'fixture','wire',1,$7,$7)`, [store.scope, crypto.randomUUID(), wallet, ++serial, 'mint-' + serial, status, now]);
  const purchase = (wallet, amount) => { now += 1000; return store.transaction(c => cp.settledPurchase(store, c, { wallet, request_id: crypto.randomUUID(), product: 'training', signature: 'sig-' + crypto.randomUUID(), wire: 'wire', amount, created: now, quote: {}, result: {} })); };
  const adventureClaim = (wallet, milli) => { now += 1000; return store.transaction(async c => {
    const r = (await c.query('SELECT * FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2 FOR UPDATE', [store.scope, wallet])).rows[0];
    await cp.endAdventure(store, c, wallet, { r, parts: [{ eligible: true, amount: milli, at: now }] }, 0, null);
    await cp.endAdventure(store, c, wallet, { r, parts: [] }, milli / 1000, 'claim-' + crypto.randomUUID());
  }); };
  const commissionsOf = async wallet => rows('SELECT source_id,kind,sr_milli,cp_milli FROM ryo_creator_commissions WHERE scope=$1 AND wallet=$2 ORDER BY created,source_id', [wallet]);
  const topups = async creatorId => rows("SELECT event_id,delta,source_sr,detail FROM ryo_creator_ledger WHERE scope=$1 AND creator_id=$2 AND kind='founder-commission-topup' ORDER BY sequence", [creatorId]);
  const ledgerSum = async creatorId => BigInt((await rows('SELECT COALESCE(SUM(delta),0) AS n FROM ryo_creator_ledger WHERE scope=$1 AND creator_id=$2', [creatorId]))[0].n);

  assert.equal((await cp.publicInfo(store, origin)).rules.founderBoxPercent, 10, 'the public rules show the Founder-box rate');
  const A = await creator('Creator A');

  /* ---------- Rates: 5% normally, 10% for a referral who bought a Founder box ---------- */
  const plain = await referral(A);
  await purchase(plain, 25000); assert.equal(await A.balance(), 1250000n, '25,000 SR at 5% = 1,250 CP');
  const founder = await referral(A); await buyFounderBox(founder);
  await purchase(founder, 25000); assert.equal(await A.balance(), 1250000n + 2500000n, 'a Founder-box referral earns 10%: 2,500 CP');
  await adventureClaim(founder, 10000000); assert.equal(await A.balance(), 3750000n + 1000000n, '10,000 claimed Adventure SR at 10% = 1,000 CP');
  assert.deepEqual((await rows("SELECT detail->>'percent' AS p FROM ryo_creator_ledger WHERE scope=$1 AND creator_id=$2 AND kind LIKE '%-commission' ORDER BY sequence", [A.id])).map(r => r.p), ['5', '10', '10'], 'each ledger row records the rate used');
  assert.equal((await topups(A.id)).length, 0, 'commissions earned at 10% are never topped up');
  const pendingBuyer = await referral(A); await buyFounderBox(pendingBuyer, 'pending'); await purchase(pendingBuyer, 25000);
  assert.equal(await A.balance(), 4750000n + 1250000n, 'a pending (unconfirmed) Founder purchase still earns 5%');

  /* ---------- Retroactive top-up: all past 5% commissions of a referral who bought a box later ---------- */
  const later = await referral(A);
  await purchase(later, 25000); await adventureClaim(later, 10000000);
  // An odd SR base: 33,333 milli-SR at 5% = 1,666 milli-CP; at 10% = 3,333; the top-up is exactly 1,667 (no rounding drift).
  await store.transaction(async c => {
    await c.query("INSERT INTO ryo_creator_commissions(scope,source_id,creator_id,wallet,kind,sr_milli,cp_milli,created) VALUES($1,'odd-source-1',$2,$3,'adventure',33333,1666,$4)", [store.scope, A.id, later, now]);
    await cp.ledger(store, c, A.id, 'commission:odd-source-1', 'adventure-commission', 1666n, 33333n, { referral: cp.privateId(later), percent: 5 });
  });
  const beforeBox = await A.balance(), originals = await commissionsOf(later);
  assert.deepEqual(originals.map(r => [r.sr_milli, r.cp_milli].map(String)), [['25000000', '1250000'], ['10000000', '500000'], ['33333', '1666']]);
  await buyFounderBox(later);
  assert.equal(await A.balance(), beforeBox, 'nothing changes until the top-up runs');
  // The read-only report predicts exactly what the first run will credit.
  const predicted = await report.collect({ query: (s, a) => pool.query(s, a) }, store.scope);
  assert.equal(predicted.creators.length, 1); assert.equal(predicted.totalMilli, String(1250000n + 500000n + 1667n)); assert.equal(predicted.commissions, 3);
  assert.deepEqual(predicted.creators[0].referrals, [cp.privateId(later)], 'the report shows private ids, never wallets');
  assert(!JSON.stringify(predicted).includes(later));
  // Opening the dashboard tops up and shows the new balance.
  const state = await call(A.wallet, 'creator-state');
  const owed = 1250000n + 500000n + 1667n;
  assert.equal(BigInt(state.points.balanceMilli), beforeBox + owed, 'the dashboard balance includes the top-up');
  assert.equal(await A.balance(), beforeBox + owed);
  const credited = await topups(A.id);
  assert.deepEqual(credited.map(r => r.event_id).sort(), originals.map(r => 'topup:' + r.source_id).sort(), 'one top-up per earlier commission');
  assert.deepEqual(credited.map(r => [String(r.delta), String(r.source_sr)]).sort(), [['1250000', '25000000'], ['500000', '10000000'], ['1667', '33333']].sort());
  assert(credited.every(r => r.detail.percent === 10 && r.detail.previousPercent === 5 && r.detail.referral === cp.privateId(later)));
  assert.deepEqual((await commissionsOf(later)).map(r => [r.sr_milli, r.cp_milli].map(String)), originals.map(r => [r.sr_milli, r.cp_milli].map(String)), 'original commission rows are never edited');
  assert.equal(await ledgerSum(A.id), await A.balance(), 'balance and ledger agree');
  assert(state.ledger.some(r => r.kind === 'founder-commission-topup' && r.detail.percent === 10), 'the top-up appears in Point history');
  assert(BigInt(state.points.commissionMilli) >= owed, 'commission earnings include the top-up');
  assert(!JSON.stringify(state).includes(later) && !JSON.stringify(state).includes(founder), 'no referral wallet is exposed');
  // Exactly once: more dashboard loads and parallel runs add nothing.
  await call(A.wallet, 'creator-state');
  const parallel = await Promise.all([0, 1, 2].map(() => store.transaction(c => cp.topUpFounderCommissions(store, c, { creatorId: A.id }))));
  assert.deepEqual(parallel.map(String), ['0', '0', '0']); assert.equal((await topups(A.id)).length, 3); assert.equal(await A.balance(), beforeBox + owed);
  assert.equal((await report.collect({ query: (s, a) => pool.query(s, a) }, store.scope)).totalMilli, '0', 'nothing left to top up');
  // After the box, new commissions are 10% directly (never topped up again).
  await purchase(later, 25000); assert.equal(await A.balance(), beforeBox + owed + 2500000n); assert.equal((await topups(A.id)).length, 3);
  // A plain referral is untouched.
  assert.deepEqual((await commissionsOf(plain)).map(r => String(r.cp_milli)), ['1250000']);
  assert.equal((await rows("SELECT COUNT(*) AS n FROM ryo_creator_ledger WHERE scope=$1 AND event_id=$2", ['topup:' + (await commissionsOf(plain))[0].source_id]))[0].n, 0);

  /* ---------- Parallel first runs for a fresh owed top-up credit once ---------- */
  const B = await creator('Creator B'), race = await referral(B);
  await purchase(race, 50000); await buyFounderBox(race);
  const raced = await Promise.all([0, 1, 2, 3].map(() => store.transaction(c => cp.topUpFounderCommissions(store, c, { creatorId: B.id }))));
  assert.equal(raced.reduce((n, x) => n + x, 0n), 2500000n, 'four parallel runs credit the 2,500 CP top-up once');
  assert.equal(await B.balance(), 5000000n); assert.equal(await ledgerSum(B.id), 5000000n);

  /* ---------- A new commission for a Founder-box referral tops up that referral's older ones in the same transaction ---------- */
  const C = await creator('Creator C'), mixed = await referral(C);
  await purchase(mixed, 20000); assert.equal(await C.balance(), 1000000n);
  await buyFounderBox(mixed); await purchase(mixed, 20000);
  assert.equal(await C.balance(), 1000000n + 2000000n + 1000000n, 'new 10% commission plus the 5% top-up of the older one');

  /* ---------- A redemption spends a balance that includes the top-up ---------- */
  const D = await creator('Creator D'), spender = await referral(D);
  await purchase(spender, 300000); assert.equal(await D.balance(), 15000000n, '15,000 CP at 5%: not enough for a 25,000 CP hero pass');
  await buyFounderBox(spender);
  const item = (await rows("SELECT * FROM ryo_creator_shop WHERE scope=$1 AND id='hero-pass'"))[0];
  const redeemed = await call(D.wallet, 'creator-redeem', { requestId: crypto.randomUUID(), itemId: 'hero-pass', version: item.version, expectedPriceMilli: String(item.price) });
  assert.equal(redeemed.redemption.status, 'fulfilled', 'the top-up is credited before the balance check');
  assert.equal(await D.balance(), 30000000n - 25000000n); assert.equal(await ledgerSum(D.id), await D.balance());

  /* ---------- Staff admin view credits every owed top-up ---------- */
  const E = await creator('Creator E'), quiet = await referral(E);
  await purchase(quiet, 10000); await buyFounderBox(quiet);
  await cp.adminSnapshot(store, admin, {});
  assert.equal(await E.balance(), 500000n + 500000n, 'the admin view shows balances with the top-up included');

  /* ---------- Pending (unclaimed) Adventure commission estimate uses each referral's rate ---------- */
  const F = await creator('Creator F'), fPlain = await referral(F), fBox = await referral(F); await buyFounderBox(fBox);
  for (const w of [fPlain, fBox]) await pool.query("INSERT INTO ryo_creator_adventure_lots(scope,wallet,event_id,remaining,eligible,created) VALUES($1,$2,$3,1000000,TRUE,$4)", [store.scope, w, 'lot-' + w, now]);
  assert.equal((await call(F.wallet, 'creator-state')).points.pendingMilli, String(50000n + 100000n), '5% + 10% of 1,000 SR each');

  /* ---------- CP never touches Ryo or the reward pool ---------- */
  assert.equal((await rows('SELECT COUNT(*) AS n FROM ryo_reward_claims WHERE scope=$1'))[0].n, 0);
  assert.equal(Number((await rows('SELECT COALESCE(SUM(balance),0) AS n FROM ryo_accounts WHERE scope=$1'))[0].n), 0, 'no Ryo balance was created by commissions or top-ups');
  await db.close();
  console.log('PASS: Creator Points — 5% normally, 10% for referrals with a CONFIRMED Founder box (pending boxes do not count); earlier 5% commissions are topped up exactly once (exact floor(SR x 10%), original rows untouched, parallel-safe) on dashboard load, before a redemption, in the admin view and with the next commission; pending estimate, privacy and the read-only report agree.');
})().catch(e => { console.error(e); process.exitCode = 1; });
