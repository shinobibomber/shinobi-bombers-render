'use strict';
/* Minimum Chest claim (owner request 2026-11-11), assembled server modules on simulated Mainnet (PGlite, controllable clock, no
 * RPC): a claim must credit at least 100,000 Ryo (or the approved minClaimRyo), never above the per-claim maximum; below it the
 * claim is refused, nothing moves and the claim timer is not used; the budget/funding case says so; validation; the Chest UI
 * value; beta unchanged. */
const fixture = require('./sr-revenue-fixture.cjs'); fixture.liveEconomy();
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const network = require('../app/server/network.cjs'), { Store } = require('../app/server/store.cjs');
const A = require('../app/server/adventure.cjs'), T = require('../app/server/treasury-rewards.cjs');
const H = 3600000;
(async () => {
  const builtBefore = network.built; network.built = () => network.NETWORKS.mainnet;
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  let now = Date.UTC(2027, 2, 1, 12); const store = new Store(pool, 'solana-mainnet:min-claim', () => now);
  const address = () => web3.Keypair.generate().publicKey.toBase58();
  const chest = async (w, ryo) => { await A.adventure(store, w, { active: false }, 0); const r = (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, w])).rows[0].data; r.pending = ryo * 1000; await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, JSON.stringify(r)]); return w; };
  const pending = async w => (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, w])).rows[0].data.pending / 1000;
  const claim = w => A.adventure(store, w, { active: false, claim: true }, 1e12);
  const budget = b => fixture.budget(store, { evidence: 'Isolated minimum-claim budget', ...b });
  await fixture.topUp(store, 50000000);

  /* Validation */
  assert.throws(() => T.validateBudget({ dailyCapRyo: 1e6, perClaimMaxRyo: 5e5, minClaimRyo: 500001, evidence: 'x' }), /Minimum Chest claim/);
  assert.throws(() => T.validateBudget({ dailyCapRyo: 2e6, perClaimMaxRyo: 1e6, minClaimRyo: 500001, evidence: 'x' }), /Minimum Chest claim/, 'never above 500,000 (below the first Chest Overflow tier)');
  assert.equal(T.validateBudget({ dailyCapRyo: 1e6, perClaimMaxRyo: 5e5, basePersonalAllowanceRyo: 99999, evidence: 'x' }).basePersonalAllowanceRyo, 99999, 'an existing low base never invalidates the stored budget');
  assert.equal(T.minimumClaim({ perClaimMaxRyo: 5e5, basePersonalAllowanceRyo: 99999 }), 99999, 'the minimum never exceeds a base allowance');
  assert.equal(T.minimumClaim({ perClaimMaxRyo: 1100000 }), 100000, 'default 100,000');
  assert.equal(T.minimumClaim({ perClaimMaxRyo: 5000 }), 5000, 'never above the per-claim maximum (a low maximum never blocks every claim)');
  assert.equal(T.minimumClaim({ perClaimMaxRyo: 1100000, minClaimRyo: 200000 }), 200000, 'approved override');

  /* Default 100,000 */
  await budget({ dailyCapRyo: 10000000, perClaimMaxRyo: 1100000 });
  const low = await chest(address(), 99999);
  assert.equal((await T.claimInfo(store, store.pool, low)).minClaimRyo, 100000, 'the Chest UI gets the minimum');
  await assert.rejects(claim(low), e => e.status === 409 && /Chest claims start at 100,000 Ryo\. Your Chest holds 99,999 Ryo/.test(e.message), 'below the minimum: refused');
  assert.equal(await pending(low), 99999, 'nothing moved'); assert.equal(await store.balance(low), 0);
  const r1 = await chest(low, 100000); assert.equal((await claim(r1)).credited, 100000, 'exactly the minimum, and the refused attempt did not use the claim timer');
  const big = await chest(address(), 150000); assert.equal((await claim(big)).credited, 150000);
  // Budget/funding can't reach the minimum: refused with that reason; Chest Overflow sees claiming as unavailable.
  now += 2 * 24 * H; await budget({ dailyCapRyo: 250000, perClaimMaxRyo: 200000 });   // owner's live maximum is 200,000
  assert.equal((await claim(await chest(address(), 900000))).credited, 200000, 'another player claims 200,000 today');
  const rich = await chest(address(), 800000);
  await assert.rejects(claim(rich), /can't cover the minimum claim of 100,000 Ryo/, '50,000 left today: refused, never a partial claim below the minimum');
  assert.equal(await pending(rich), 800000, 'nothing moved');
  // Override 200,000.
  now += 2 * 24 * H; await budget({ dailyCapRyo: 10000000, perClaimMaxRyo: 1100000, minClaimRyo: 200000 });
  await assert.rejects(claim(await chest(address(), 150000)), /Chest claims start at 200,000 Ryo/);
  assert.equal((await claim(await chest(address(), 250000))).credited, 250000);
  // A low per-claim maximum keeps claims possible.
  now += 2 * 24 * H; await budget({ dailyCapRyo: 10000000, perClaimMaxRyo: 5000 });
  assert.equal((await claim(await chest(address(), 30000))).credited, 5000, 'per-claim maximum 5,000: claims still work');

  /* Beta (Devnet build): no live claim policy, unchanged */
  network.built = () => network.NETWORKS.devnet;
  const beta = new Store(pool, 'solana-devnet:min-claim', () => now); await fixture.topUp(beta, 1000000);
  const bw = address(); await A.adventure(beta, bw, { active: false }, 0);
  const br = (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [beta.scope, bw])).rows[0].data; br.pending = 50 * 1000;
  await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [beta.scope, bw, JSON.stringify(br)]);
  await pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,'beta-min-income-01','summon','{}',$3,'{}','{}',1,'beta-min-sig','w',1,'confirmed',$4)", [beta.scope, address(), JSON.stringify({ operations: 1e9 }), now]);
  assert.equal((await A.adventure(beta, bw, { active: false, claim: true }, 1e12)).credited, 50, 'beta: small claims unchanged');

  network.built = builtBefore; await db.close();
  console.log('PASS: Minimum Chest claim — 100,000 by default (approved override, never above the per-claim maximum), below it refused with nothing moved and the timer unused, budget/funding below the minimum refused (no partial claim), validation, Chest UI value, beta unchanged.');
})().catch(e => { console.error(e); process.exitCode = 1; });
