'use strict';
/* Founder discount on the real quote preview and the real charged purchase (owner report 2026-11-10: Founder box buyers
 * paid the full price). Root cause: the discount read profile.founderTier, which was only copied in from the entitlement
 * when the game reloaded state after the profile row existed, so a buyer who bought the box before playing paid full price
 * for the first purchases. Now both the preview (service 'quote') and the charge (store.purchase, inside the purchase
 * transaction) read the tier from the entitlement itself.
 * Isolated fixtures only (in-memory Postgres, stub RPC, no transaction is signed or sent). */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..'), { Keypair } = require('../app/node_modules/@solana/web3.js');
const { Store, hash } = require('../app/server/store.cjs'), { createService, GENESIS } = require('../app/server/service.cjs');
(async () => {
  const prior = process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED;
  process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED = 'on';
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'app/server/schema.sql'), 'utf8'));
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  let now = Date.UTC(2026, 10, 10, 12);
  const store = new Store(pool, 'founder-discount-test', () => now);
  const names = ['treasury', 'studio', 'revenue', 'mint', 'mythic', 'legacy', 'revoked', 'player', 'stale'];
  const K = Object.fromEntries(names.map(n => [n, Keypair.generate()])), W = Object.fromEntries(names.map(n => [n, K[n].publicKey.toBase58()]));
  const connection = new Proxy({ async getGenesisHash() { return GENESIS; }, async getParsedTokenAccountsByOwner() { return { value: [] }; }, async getBlockHeight() { return 1; }, async getMultipleAccountsInfo(a) { return a.map(() => null); } },
    { get: (o, k) => o[k] || (async () => { throw Error('unexpected RPC call: ' + String(k)); }) });
  const service = createService({ store, connection, treasury: K.treasury, mint: W.mint, origin: 'http://127.0.0.1', studioAddress: W.studio, revenueAddress: W.revenue });
  for (const n of ['mythic', 'legacy', 'revoked', 'player', 'stale']) {
    await pool.query('INSERT INTO ryo_sessions(scope,token_hash,wallet,expires) VALUES($1,$2,$3,$4)', [store.scope, hash('tok-' + n), W[n], now + 86400000]);
    await pool.query('INSERT INTO ryo_accounts(scope,wallet,balance) VALUES($1,$2,1000000)', [store.scope, W[n]]);
  }
  // Founder purchases recorded by the sale page; these wallets have never opened the game (no ryo_profiles row).
  let req = 0; const ent = (n, tier, revoked = null) => pool.query('INSERT INTO ryo_founder_entitlements(scope,wallet,tier,request_id,mint,granted,revoked,revoked_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [store.scope, W[n], tier, 'founder-req-' + String(++req).padStart(8, '0'), Keypair.generate().publicKey.toBase58(), now - 3600000, revoked, revoked ? 'test' : null]);
  await ent('mythic', 'mythic'); await ent('legacy', 'legacy'); await ent('revoked', 'mythic', now - 60000);
  const quote = (n, quantity = 1) => service.handle('quote', { product: 'summon', params: { quantity } }, 'tok-' + n);
  const balance = async n => Number((await pool.query('SELECT balance FROM ryo_accounts WHERE scope=$1 AND wallet=$2', [store.scope, W[n]])).rows[0].balance);
  const tierOf = async n => (await pool.query("SELECT data->>'founderTier' AS t FROM ryo_profiles WHERE scope=$1 AND wallet=$2", [store.scope, W[n]])).rows[0]?.t ?? null;
  let rid = 0; const buy = (n, quantity, expectedTotal) => store.purchase(W[n], 'discount-req-' + String(++rid).padStart(8, '0'), 'summon', { quantity }, expectedTotal, async () => ({ signature: 'test-sig-' + rid, wire: '', lastHeight: 0 }));

  // 1. Mythic buyer, very first purchase, before any game state load: 10% off in the preview AND the charge.
  assert.equal(await tierOf('mythic'), null, 'fixture: no profile tier yet');
  const qm = await quote('mythic');
  assert.equal(qm.total, 22500, 'Mythic preview is 10% off on the first quote: ' + qm.total); assert.match(qm.title, /Founder Mythic −10%/);
  const b0 = await balance('mythic'), row = await buy('mythic', 1, qm.total);
  assert.equal(Number(row.amount), 22500, 'the charged amount is 22,500'); assert.equal(b0 - await balance('mythic'), 22500, 'exactly 22,500 Ryo left the balance');
  assert.match(row.quote.title, /Founder Mythic −10%/); assert.equal(row.profile_after.founderTier, 'mythic', 'the saved purchase snapshot keeps the tier');
  // Settling the purchase writes that snapshot; the tier must survive it.
  await store.settlePurchase(W.mythic, row.request_id, 'confirmed');
  assert.equal(await tierOf('mythic'), 'mythic', 'tier kept after settlement');

  // 2. Legacy: 5% off, also for a 10-pack.
  const ql = await quote('legacy', 10);
  assert.equal(ql.total, 237500, 'Legacy 10 summons = 237,500'); assert.match(ql.title, /Founder Legacy −5%/);
  const b1 = await balance('legacy'), lrow = await buy('legacy', 10, ql.total); assert.equal(b1 - await balance('legacy'), 237500);
  await store.settlePurchase(W.legacy, lrow.request_id, 'confirmed');

  // 3. A full-price expectedTotal from an old screen is refused without charging (preview and charge must agree).
  const b2 = await balance('legacy');
  await assert.rejects(buy('legacy', 1, 25000), e => e.status === 409 && /price changed/i.test(e.message), 'stale full-price total is refused');
  assert.equal(await balance('legacy'), b2, 'nothing charged on a refused purchase');

  // 4. Suspended entitlement and non-Founders pay the regular price; a stale tier on a suspended buyer is removed.
  await pool.query("INSERT INTO ryo_profiles(scope,wallet,data) VALUES($1,$2,$3)", [store.scope, W.revoked, JSON.stringify({ ...(await store.profile(W.player)), founderTier: 'mythic' })]);
  assert.equal((await quote('revoked')).total, 25000, 'suspended: no discount');
  const rrow = await buy('revoked', 1, 25000); assert.equal(rrow.profile_after.founderTier, undefined, 'the purchase snapshot of a suspended buyer carries no tier');
  assert.equal(await tierOf('revoked'), null, 'and the stored profile no longer has it');
  await store.settlePurchase(W.revoked, rrow.request_id, 'confirmed');
  assert.equal((await quote('player')).total, 25000, 'non-Founder: regular price');
  // A profile tier without any Founder purchase (only possible by a direct database write) is removed: fail closed.
  await pool.query("INSERT INTO ryo_profiles(scope,wallet,data) VALUES($1,$2,$3)", [store.scope, W.stale, JSON.stringify({ ...(await store.profile(W.player)), founderTier: 'legacy' })]);
  assert.equal((await quote('stale')).total, 25000, 'no entitlement: no discount even with a forged profile tier');
  assert.equal(await tierOf('stale'), null, 'and the forged tier is removed from the stored profile');

  // 4b. Suspended between the quote and the purchase: the discounted total is refused (409) and nothing is charged.
  const ql2 = await quote('legacy'); assert.equal(ql2.total, 23750);
  await pool.query('UPDATE ryo_founder_entitlements SET revoked=$3,revoked_reason=$4 WHERE scope=$1 AND wallet=$2', [store.scope, W.legacy, now, 'test']);
  const b4 = await balance('legacy');
  await assert.rejects(buy('legacy', 1, ql2.total), e => e.status === 409, 'suspension after the quote: purchase refused');
  assert.equal(await balance('legacy'), b4, 'nothing charged');
  await pool.query('UPDATE ryo_founder_entitlements SET revoked=NULL,revoked_reason=NULL WHERE scope=$1 AND wallet=$2', [store.scope, W.legacy]);

  // 5. Redemption closed: no Founder discount in the preview or the charge (fail closed, unchanged).
  delete process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED;
  const qc = await quote('mythic'); assert.equal(qc.total, 25000, 'redemption closed: regular price');
  const b3 = await balance('mythic'), crow = await buy('mythic', 1, 25000); assert.equal(b3 - await balance('mythic'), 25000);
  await store.settlePurchase(W.mythic, crow.request_id, 'confirmed');
  process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED = 'on';

  // 6. Discounts still never stack with the Mythic Box perk (the larger one applies).
  const p = await store.profile(W.legacy); p.mythicPerk = true;
  await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, W.legacy, JSON.stringify(p)]);
  assert.equal((await quote('legacy')).total, 22500, 'Legacy + Mythic Box perk: 10%, not 15%');

  // 7. The read-only overcharge report (tools/founder-discount-report.cjs). Only confirmed full-price Founder purchases made
  // while Founder rewards were open are listed; the hosting-environment history is not stored, so the owner names --since
  // and any --off windows; Control-panel OFF periods and suspensions are read from their logs.
  const report = require('../tools/founder-discount-report.cjs'), DAYMS = 86400000, since = now - DAYMS;
  const fmt = list => list.map(r => [r.wallet, r.charged, r.shouldHaveBeen, r.overcharged]);
  // Treated as open (no --off given): the Mythic buy made while redemption was closed shows as full price.
  assert.deepEqual(fmt(await report.collect(pool, store.scope, { since })), [[W.mythic, 25000, 22500, 2500]], 'report lists the full-price purchase');
  assert.throws(() => report.overcharges([], {}), /--since/, 'the opening time is required');
  // Naming that closed window removes it: full price was correct while the discount was closed.
  assert.deepEqual(await report.collect(pool, store.scope, { since, off: [[now - 1, now + 1]] }), [], '--off window excluded');
  assert.deepEqual(await report.collect(pool, store.scope, { since: now + 1 }), [], 'before --since excluded');
  // A Control-panel OFF period is read from the switch log (OFF, then cleared back to the environment).
  await pool.query("INSERT INTO ryo_feature_switch_log(scope,seq,key,enabled,actor,reason,created,version,prev_hash,hash) VALUES($1,1,'foundersRedemption',false,'t','test: closed',$2,1,'genesis','h1'),($1,2,'foundersRedemption',NULL,'t','test: back to env',$3,2,'h1','h2')", [store.scope, now - 1, now + 1]);
  assert.deepEqual(await report.collect(pool, store.scope, { since }), [], 'panel OFF period excluded');
  // Suspension history (revoke then restore) excludes purchases made while suspended, even after the restore.
  const row7 = { wallet: W.legacy, request_id: 'r7', product: 'summon', status: 'confirmed', amount: 25000, created: now, title: 'Summon 1 hero', tier: 'legacy', granted: since, revoked: null };
  assert.equal(report.overcharges([row7], { since }).length, 1);
  assert.equal(report.overcharges([row7], { since, suspended: new Map([[W.legacy, report.offWindows([[now - 5, false], [now + 5, true]])]]) }).length, 0, 'suspended period excluded');
  assert.equal(report.overcharges([{ ...row7, status: 'pending' }], { since }).length, 0, 'pending purchases are never listed');
  assert.equal(report.overcharges([{ ...row7, title: 'Summon 1 hero · Mythic −10%' }], { since }).length, 0, 'Mythic Box perk counts as discounted');
  assert.equal(report.shouldHave(250000, 'legacy'), 237500);

  if (prior === undefined) delete process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED; else process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED = prior;
  console.log('PASS: Founder discount — Mythic 10% / Legacy 5% from the very first quote and charge (before any state load), preview equals charge, snapshot keeps the tier, suspended/non-Founder/redemption-closed pay the regular price, never stacked.');
})().catch(e => { console.error(e); process.exitCode = 1; });
