'use strict';
/* Live Chest-claim cadence + reward budget, and the live 5% withdrawal deduction arithmetic (whitepaper Ch. 05/06).
 * The assembled server modules on PGlite with a controllable clock. Beta behaviour is asserted unchanged by
 * switching the in-process build stamp back to Devnet. No RPC, wallet or network is used. */
const fixture = require('./sr-revenue-fixture.cjs'); fixture.liveEconomy();
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const network = require('../app/server/network.cjs'), { Store } = require('../app/server/store.cjs');
const A = require('../app/server/adventure.cjs'), T = require('../app/server/treasury-rewards.cjs'), registry = require('../app/server/treasury-registry.cjs').registry();
const DAY = 86400000, UNIT = 1000000n, LIVE = () => network.NETWORKS.mainnet, BETA = () => network.NETWORKS.devnet;
(async () => {
 const db = new PGlite(), schema = fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'); await db.exec(schema); await db.exec(schema);
 let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
 const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
 let now = Date.UTC(2027, 0, 10, 12); const store = new Store(pool, 'solana-mainnet:claims-test', () => now);
 const address = () => web3.Keypair.generate().publicKey.toBase58(), CUSTODY = 1e9;
 const chest = async (wallet, ryo) => { await A.adventure(store, wallet, { active: false }, 0); const row = (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0].data; row.pending = ryo * 1000; row.last = now; await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(row)]); };
 const pending = async wallet => (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0].data.pending / 1000;
 const claims = async () => Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_reward_claims WHERE scope=$1', [store.scope])).rows[0].n);
 const claim = (wallet, custody = CUSTODY) => A.adventure(store, wallet, { active: false, claim: true }, custody);
 try {
  // 1. Without an approved reward budget, live claims are refused and nothing moves.
  const a = address(); await fixture.topUp(store, 1000); await chest(a, 20);
  await assert.rejects(claim(a), e => e.status === 503 && /approved reward budget/.test(e.message));
  assert.equal(await pending(a), 20, 'earnings stay in the Chest'); assert.equal(await claims(), 0); assert.equal(await store.balance(a), 0);
  assert.throws(() => T.validateBudget({ dailyCapRyo: 10, perClaimMaxRyo: 11, evidence: 'x' }), /Per-claim maximum/);
  assert.throws(() => T.validateBudget({ dailyCapRyo: 0, perClaimMaxRyo: 1, evidence: 'x' }), /Daily emission cap/);
  assert.throws(() => T.validateBudget({ dailyCapRyo: 10, perClaimMaxRyo: 1 }), /evidence/);

  // 2. Per-claim maximum and the rolling 24 h cadence (authoritative server clock, exact boundary).
  await fixture.budget(store, { dailyCapRyo: 10, perClaimMaxRyo: 4, evidence: 'Isolated reward budget' });
  assert.equal(await T.nextClaimAt(store, pool, a), 0, 'first claim available now');
  const first = await claim(a); assert.equal(first.credited, 4, 'per-claim maximum'); assert.equal(await store.balance(a), 4); assert.equal(await pending(a), 16);
  const claimedAt = now; assert.equal(await T.nextClaimAt(store, pool, a), claimedAt + DAY);
  await assert.rejects(claim(a), e => e.status === 429 && /once every 24 hours/.test(e.message)); assert.equal(await pending(a), 16, 'a refused claim changes nothing');
  now = claimedAt + DAY - 1; await assert.rejects(claim(a), e => e.status === 429, '23:59:59.999 is still inside the cooldown');
  now = claimedAt + DAY; assert.equal((await claim(a)).credited, 4, 'exactly 24 h later the next claim opens'); assert.equal(await store.balance(a), 8);

  // 3. A failed claim (unfunded custody) rolls back and does not consume the cooldown.
  const b = address(); await chest(b, 3);
  await assert.rejects(claim(b, 0), /No funded whole/); assert.equal(await T.nextClaimAt(store, pool, b), 0, 'failure does not start the cooldown');
  assert.equal((await claim(b)).credited, 3);

  // 4. Concurrent claims from one wallet credit once.
  const c = address(); await chest(c, 2);
  const both = await Promise.allSettled([claim(c), claim(c)]);
  assert.equal(both.filter(r => r.status === 'fulfilled').length, 1); assert.equal(await store.balance(c), 2);

  // 5. Global 24 h emission cap across wallets: used = 4 (a, today) + 3 (b) + 2 (c) = 9 of 10.
  const d = address(), e = address(); await chest(d, 50); await chest(e, 50);
  assert.equal((await claim(d)).credited, 1, 'only the remaining daily budget is credited');
  await assert.rejects(claim(e), x => x.status === 409 && /fully claimed/.test(x.message)); assert.equal(await pending(e), 50);
  now += DAY + 1; assert.equal((await claim(e)).credited, 4, 'the budget window rolls forward');

  // 6. Pending Chest accrual is never blocked by the claim cadence (sync without claim still works).
  const sync = await A.adventure(store, a, { active: false }, CUSTODY); assert.equal(sync.pending, await pending(a));

  // 7. Live withdrawal arithmetic: 5% to the registered Treasury, rounded down in base units, exact conservation.
  for (const n of [100000, 100001, 100019, 123457, 999999, 1000000]) {
   const p = T.withdrawalPlan(n), gross = BigInt(n) * UNIT;
   assert.equal(p.grossRaw, gross); assert.equal(p.feeRaw, gross * 500n / 10000n); assert.equal(p.feeRaw + p.netRaw, gross); assert.equal(p.treasury, registry.addresses.lockedTreasury); assert.equal(p.bps, 500);
  }
  assert.equal(T.withdrawalPlan(100001).feeRaw, 5000050000n); assert.throws(() => T.withdrawalPlan(0), /Invalid/);
  assert.equal(T.withdrawalsAnytime(), true); assert.equal(T.withdrawalColumns(), 'treasury_fee_raw,net_raw,');
  assert.deepEqual(T.publicConfig(), { withdrawalCooldownMs: 0, withdrawalFeeBps: 500, withdrawalFeeDestination: 'Locked Treasury', withdrawalFeeAddress: registry.addresses.lockedTreasury, claimCooldownMs: DAY, treasuryRegistry: '/treasury' });
  await assert.rejects(T.withdrawalSettled(store, pool, { amount: 100000, treasury_fee_raw: '5000000000', net_raw: '95000000001', treasury_fee_destination: registry.addresses.lockedTreasury }), /inconsistent/);
  // The custody signer can never be a registry wallet or Squads member; the studio wallet never a destination.
  assert.throws(() => T.assertCustody(registry.squads.members[1], address()), /custody wallet must not/);
  assert.throws(() => T.assertCustody(registry.addresses.economicReserve, address()), /custody wallet must not/);
  assert.throws(() => T.assertCustody(address(), registry.addresses.communityRewards), /studio fee wallet/);
  T.assertCustody(address(), address());
  // Launch binding: RYO_TREASURY_SECRET must belong to the recorded public game custody wallet.
  { const Reg = require('../app/server/treasury-registry.cjs'), rawReg = JSON.parse(fs.readFileSync(Reg.FILE, 'utf8')), stripped = Reg.registry();
    Reg.useForIsolatedTest(rawReg); assert.equal(Reg.registry().gameCustody.address, 'CqJCKKq9Q9haCtdVuHLZfCkfoDnRievuTaJ9doHatwBT');
    assert.throws(() => T.assertCustody(address(), address()), /does not belong to the game custody wallet/);
    T.assertCustody('CqJCKKq9Q9haCtdVuHLZfCkfoDnRievuTaJ9doHatwBT', address());
    assert.match(T.claimFundingNotConfigured().note, /created but not active/);
    const back = JSON.parse(fs.readFileSync(Reg.FILE, 'utf8')); delete back.gameCustody; Reg.useForIsolatedTest(back); assert.equal(Reg.registry().gameCustody, null); void stripped; }
  const summary = await T.summary(store); assert.equal(summary.rewardBudget.configured, true); assert.equal(summary.rewardBudget.claimCooldownHours, 24); assert.equal(summary.withdrawalDeduction.count, 0);

  // 7b. Funds available for player claims are separate from externally held funds: min(approved unclaimed, custody beyond liabilities).
  { let custodyRaw = '0', down = false, reads = 0; const mint = web3.Keypair.generate().publicKey.toBase58(), custodyKey = web3.Keypair.generate().publicKey.toBase58();
    const fctx = s => ({ store: s, mint, treasuryAddress: custodyKey, checkNetwork: async () => {}, connection: { async getTokenAccountBalance() { reads++; if (down) throw Error('rpc'); return { value: { amount: custodyRaw } }; } } });
    const fresh = new Store(pool, 'solana-mainnet:funding-test', () => now), liab = Number((await pool.query("SELECT COALESCE(SUM(balance),0) AS n FROM ryo_accounts WHERE scope=$1", [fresh.scope])).rows[0].n);
    let f = await T.claimFunding(fctx(fresh), { ttl: 0 }); assert.equal(f.status, 'verified'); assert.equal(f.availableRyo, 0); assert.equal(f.ledgerFundedRyo, 0); assert.equal(f.claimsOpen, false, 'no budget → closed');
    await fixture.topUp(fresh, 500); custodyRaw = String(300n * UNIT);
    f = await T.claimFunding(fctx(fresh), { ttl: 0 }); assert.equal(f.ledgerFundedRyo, 500); assert.equal(f.custodyFreeRyo, 300 - liab); assert.equal(f.availableRyo, 300, 'custody is the binding limit');
    custodyRaw = String(5000n * UNIT); f = await T.claimFunding(fctx(fresh), { ttl: 0 }); assert.equal(f.availableRyo, 500, 'approved funding is the binding limit');
    await fixture.budget(fresh); f = await T.claimFunding(fctx(fresh), { ttl: 0 }); assert.equal(f.claimsOpen, true); assert.equal(f.budget.configured, true);
    down = true; f = await T.claimFunding(fctx(fresh), { ttl: 0 }); assert.equal(f.status, 'unverified'); assert.equal(f.availableRyo, null, 'unreadable custody shows no number'); down = false;
    reads = 0; await Promise.all([T.claimFunding(fctx(fresh), { ttl: 60000 }), T.claimFunding(fctx(fresh), { ttl: 60000 })]); await T.claimFunding(fctx(fresh), { ttl: 60000 }); assert(reads <= 1, 'cached and de-duplicated');
    const nc = T.claimFundingNotConfigured(); assert.equal(nc.status, 'not-configured'); assert.equal(nc.availableRyo, null); assert.equal(nc.claimsOpen, false); }

  // 8. Beta build: original behaviour (no claim cadence, no budget, 2% studio withdrawal path, no new config fields).
  network.built = BETA;
  assert.equal(await T.claimLimit(store, pool, a), Infinity); assert.equal(await T.nextClaimAt(store, pool, a), null);
  assert.deepEqual(await T.claimFunding({ store }), { applicable: false });
  assert.equal(T.withdrawalPlan(100000), null); assert.equal(T.withdrawalsAnytime(), false); assert.equal(T.withdrawalColumns(), ''); assert.deepEqual(T.publicConfig(), {});
  T.assertCustody(registry.squads.members[0], registry.addresses.communityRewards); // no live restriction on the test server
  const beta = new Store(pool, 'solana-devnet:beta-claims', () => now), f = address();
  await A.adventure(beta, f, { active: false }, 0); { const row = (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [beta.scope, f])).rows[0].data; row.pending = 5000; row.last = now; await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [beta.scope, f, JSON.stringify(row)]); }
  await pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,'beta-income','summon','{}',$3,'{}','{}',25000,'beta-income-sig','wire',1,'confirmed',$4)", [beta.scope, f, JSON.stringify({ operations: 20000 }), now]);
  assert.equal((await A.adventure(beta, f, { active: false, claim: true }, CUSTODY)).credited, 5); { const row = (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [beta.scope, f])).rows[0].data; row.pending = 2000; await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [beta.scope, f, JSON.stringify(row)]); }
  assert.equal((await A.adventure(beta, f, { active: false, claim: true }, CUSTODY)).credited, 2, 'beta keeps unlimited claim cadence without a budget');
  network.built = LIVE;
  console.log('PASS: live Chest claims — approved budget required, per-claim max, rolling 24 h cadence with exact boundary, failed claims never consume it, concurrent claims credit once, global emission cap; live withdrawals — 5% to the Squads Treasury in exact base units; custody separation; beta unchanged.');
 } finally { await db.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
