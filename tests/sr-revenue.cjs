'use strict';
/* SR Revenue Distribution v2 (live only): exact 50/30/10/10 split, registry-pinned destinations, Squads v4 Treasury
 * verification from captured public account bytes, four-leg atomic wires decoded with the real SDK, activation
 * locks, two-person approvals with typed confirmation, finalized top-up evidence and replay rejection, and
 * Adventure funding only from verified top-ups. PGlite + mocked RPC: nothing touches a network. */
const fixture = require('./sr-revenue-fixture.cjs'); fixture.liveEconomy();
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js'), spl = require('../app/node_modules/@solana/spl-token'), bs58 = require('../app/node_modules/bs58');
const { Store } = require('../app/server/store.cjs'), router = require('../app/server/sr-revenue.cjs'), admin = require('../app/server/economic-dashboard.cjs'), economy = require('../app/server/economy.cjs');
const registryModule = require('../app/server/treasury-registry.cjs');
(async () => {
 const db = new PGlite(), schema = fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'); await db.exec(schema); await db.exec(schema);
 let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
 const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
 const store = new Store(pool, 'sr-fixture', () => 1900000000000), other = new Store(pool, 'other-scope', () => 1900000000000), treasury = web3.Keypair.generate(), mint = web3.Keypair.generate().publicKey;
 const reg = fixture.activate(mint), D = reg.addresses;
 const address = () => web3.Keypair.generate().publicKey.toBase58(), operator = address(), reviewer = address(), wallet = address();
 const cfg = { enabled: true, destinations: { ...D }, products: [...router.APPROVED], evidence: 'Approved isolated full-service revenue policy' };
 const receipt = new Map(), overrides = {}; let network = true;
 const vaultAta = spl.getAssociatedTokenAddressSync(mint, new web3.PublicKey(D.lockedTreasury), true);
 const connection = { async getAccountInfo(key) { const known = fixture.chainAccount(key, mint, overrides); return known === undefined ? null : known; }, async getParsedTransaction(sig) { return receipt.get(sig) || null; } };
 const ctx = { store, wallet, connection, mint: mint.toBase58(), treasuryAddress: treasury.publicKey.toBase58(), studioAddress: address(), revenueAddress: address(), async checkNetwork() { if (!network) throw Error('Wrong network'); } };
 process.env.RYO_ADMIN_APPROVERS = operator + ',' + reviewer; process.env.RYO_ADMIN_OPERATORS = '';
 const call = (w, action, body = {}) => admin.handle(ctx, w, action, { confirmation: 'CONFIRM', ...body }), version = async () => Number((await pool.query('SELECT version FROM ryo_admin_control WHERE scope=$1', [store.scope])).rows[0]?.version || 0);
 const propose = async (kind, payload) => call(operator, 'admin-propose', { kind, payload, version: await version(), reason: 'Verified fixture policy' });
 const approve = p => call(reviewer, 'admin-review', { id: p.id, approve: true, reason: 'Independent verification' });
 const memo = text => new web3.TransactionInstruction({ programId: new web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.from(text) });
 const treasuryAta = spl.getAssociatedTokenAddressSync(mint, treasury.publicKey), transfer = (owner, amount) => { const key = new web3.PublicKey(owner), ata = spl.getAssociatedTokenAddressSync(mint, key, true); return [spl.createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, ata, key, mint), spl.createTransferCheckedInstruction(treasuryAta, mint, ata, treasury.publicKey, amount, 6)]; };
 const squads = mutate => fixture.squadsAccount(mutate);
 const MEMBERS_AT = 8 + 32 + 32 + 2 + 4 + 8 + 8 + 1 + 1 + 4; // member list offset (no rent collector)
 try {
  // 1. Exact conservation: whole-Ryo prices and raw base-unit totals from 1 unit to u64 scale.
  for (const price of [1, 11, 25000, 22500, 54000000]) { const s = router.split(price), d = s.revenueDistribution; assert.equal(d.version, 2); assert.equal(Object.values(d.allocations).reduce((n, v) => n + BigInt(v), 0n), BigInt(price) * router.UNIT); assert.deepEqual([s.treasury, s.operations, s.community, s.reserve, s.burn, s.studioFee], [price * .5, price * .3, price * .1, price * .1, 0, 0]); }
  const totals = [1n, 2n, 3n, 7n, 9n, 10n, 19n, 99n, 10001n, 123456789n, 2n ** 53n + 1n, 2n ** 64n - 1n, ...Array.from({ length: 200 }, () => BigInt('0x' + crypto.randomBytes(9).toString('hex')) + 1n)];
  for (const t of totals) {
   const a = router.splitRaw(t), parts = ['lockedTreasury', 'activeRewards', 'communityRewards', 'economicReserve'].map(k => BigInt(a[k]));
   assert.equal(parts.reduce((x, y) => x + y, 0n), t, 'every base unit is allocated: ' + t);
   assert.deepEqual(parts.slice(0, 3), [t * 5000n / 10000n, t * 3000n / 10000n, t * 1000n / 10000n], 'first three shares are floored');
   const remainder = parts[3] - t * 1000n / 10000n; assert(remainder >= 0n && remainder <= 3n, 'deterministic remainder (at most 3 base units) goes to Reserve: ' + t);
  }
  assert.throws(() => router.splitRaw(0n), /Invalid/); assert.throws(() => router.split(0), /Invalid/); assert.throws(() => router.split(1.5), /Invalid/);

  // 2. Nothing is ready before an approved configuration; failures are always pre-submission.
  const q = economy.quote(economy.initialProfile(), 'summon', { quantity: 1 }); assert.equal((await router.preview(store, wallet, q)).revenueDistribution.ready, false);
  await assert.rejects(router.instructions(ctx, q, crypto.randomUUID(), transfer, memo), e => e.paymentNotSubmitted && /approved vault/.test(e.message));

  // 3. Destinations are pinned to the reviewed registry.
  assert.throws(() => router.validateConfig({ ...cfg, destinations: { ...cfg.destinations, communityRewards: address() } }), /reviewed public registry/);
  assert.throws(() => router.validateConfig({ ...cfg, destinations: { ...cfg.destinations, communityRewards: D.economicReserve } }), /reviewed public registry/);
  assert.throws(() => router.validateConfig({ ...cfg, lockedTreasuryMultisig: address() }), /registered Squads multisig/);
  assert.throws(() => router.validateConfig({ ...cfg, products: ['market'] }), /excluded/);

  // 4. Two-person approval with typed confirmation; Squads governance drift is refused.
  const pending = await propose('revenueRouting', cfg);
  await assert.rejects(admin.handle(ctx, reviewer, 'admin-review', { id: pending.id, approve: true, reason: 'no phrase' }), /Type CONFIRM/);
  await assert.rejects(call(operator, 'admin-review', { id: pending.id, approve: true, reason: 'self' }), /different authorized/);
  const drift = [
   ['threshold lowered to 1', d => d.writeUInt16LE(1, 8 + 64)],
   ['member swapped', d => web3.Keypair.generate().publicKey.toBuffer().copy(d, MEMBERS_AT)],
   ['config authority set', d => web3.Keypair.generate().publicKey.toBuffer().copy(d, 8 + 32)],
   ['time lock changed', d => d.writeUInt32LE(3600, 8 + 64 + 2)],
   ['wrong discriminator', d => { d[0] ^= 1; }],
  ];
  for (const [label, mutate] of drift) { overrides[reg.squads.multisig] = squads(mutate); await assert.rejects(approve(pending), /Squads v4/, label); }
  overrides[reg.squads.multisig] = { ...squads(), owner: web3.SystemProgram.programId }; await assert.rejects(approve(pending), /Squads v4/, 'not owned by the Squads program');
  overrides[reg.squads.multisig] = fixture.multisig(); await assert.rejects(approve(pending), /Squads v4/, 'a classic SPL multisig is no longer accepted as the Treasury');
  overrides[reg.squads.multisig] = null; await assert.rejects(approve(pending), /Squads v4/, 'missing multisig');
  delete overrides[reg.squads.multisig];
  assert.equal(await router.config(store), null, 'unverified Treasury never becomes configuration');
  // A Phantom destination that is actually program-owned is refused.
  overrides[D.communityRewards] = { owner: spl.TOKEN_PROGRAM_ID, data: Buffer.alloc(0), lamports: 1 }; await assert.rejects(approve(pending), /plain wallet/); delete overrides[D.communityRewards];
  // Treasury token account with a delegate is refused.
  { const data = Buffer.alloc(spl.ACCOUNT_SIZE); spl.AccountLayout.encode({ mint, owner: new web3.PublicKey(D.lockedTreasury), amount: 0n, delegateOption: 1, delegate: treasury.publicKey, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 1n, closeAuthorityOption: 0, closeAuthority: web3.PublicKey.default }, data);
   overrides[vaultAta.toBase58()] = { owner: spl.TOKEN_PROGRAM_ID, data, lamports: 1 }; await assert.rejects(approve(pending), /delegate/); delete overrides[vaultAta.toBase58()]; }
  // The game custody signer can never be a destination or a Squads member.
  await assert.rejects(router.verifyVaults({ ...ctx, treasuryAddress: D.activeRewards }, router.validateConfig(cfg)), /separate from the game custody/);
  await assert.rejects(router.verifyVaults({ ...ctx, treasuryAddress: reg.squads.members[0] }, router.validateConfig(cfg)), /Squads v4/);
  await approve(pending); assert.equal((await router.preview(store, wallet, q)).revenueDistribution.ready, true);
  assert.equal((await router.config(store)).lockedTreasuryMultisig, reg.squads.multisig);

  // 5. Activation locks: each one alone blocks a payment before anything is signed.
  process.env.SR_REVENUE_ROUTING_ENABLED = 'off';
  assert.equal((await router.preview(store, wallet, q)).revenueDistribution.ready, false);
  await assert.rejects(router.instructions(ctx, q, crypto.randomUUID(), transfer, memo), e => e.paymentNotSubmitted && /SR_REVENUE_ROUTING_ENABLED is off/.test(e.message));
  process.env.SR_REVENUE_ROUTING_ENABLED = 'on';
  { const raw = JSON.parse(fs.readFileSync(registryModule.FILE, 'utf8')); raw.srMintAddress = mint.toBase58(); registryModule.useForIsolatedTest(raw); }
  await assert.rejects(router.instructions(ctx, q, crypto.randomUUID(), transfer, memo), e => e.paymentNotSubmitted && /activation approval/.test(e.message));
  fixture.activate(web3.Keypair.generate().publicKey);
  await assert.rejects(router.instructions(ctx, q, crypto.randomUUID(), transfer, memo), e => e.paymentNotSubmitted && /does not match the registered SR mint/.test(e.message));
  fixture.activate(mint);

  // 6. Four atomic legs to the registry ATAs: 50/30/10/10, zero burn, memo bound to scope+wallet+request.
  const instructions = await router.instructions(ctx, q, 'approved-quote-fixture', transfer, memo), token = instructions.filter(i => i.programId.equals(spl.TOKEN_PROGRAM_ID));
  assert.equal(token.length, 4); assert(token.every(i => i.data[0] === spl.TokenInstruction.TransferChecked));
  const decoded = token.map(i => spl.decodeTransferCheckedInstruction(i));
  assert.deepEqual(decoded.map(i => i.data.amount), [12500n, 7500n, 2500n, 2500n].map(n => n * router.UNIT));
  assert.deepEqual(decoded.map(i => i.keys.destination.pubkey.toBase58()), ['lockedTreasury', 'activeRewards', 'communityRewards', 'economicReserve'].map(r => spl.getAssociatedTokenAddressSync(mint, new web3.PublicKey(D[r]), true).toBase58()));
  assert(decoded.every(i => i.keys.source.pubkey.equals(treasuryAta) && i.keys.owner.pubkey.equals(treasury.publicKey)), 'only game custody is debited');
  assert(!instructions.some(i => i.programId.equals(spl.TOKEN_PROGRAM_ID) && i.data[0] === spl.TokenInstruction.BurnChecked));
  const otherWallet = await router.instructions({ ...ctx, wallet: address() }, economy.quote(economy.initialProfile(), 'summon', { quantity: 1 }), 'approved-quote-fixture', transfer, memo);
  assert(!instructions.at(-1).data.equals(otherWallet.at(-1).data), 'same request ID from distinct wallets must never share a payment signature');
  // Tampered quote amounts never reach the wire.
  const forged = economy.quote(economy.initialProfile(), 'summon', { quantity: 1 }); forged.revenueDistribution.allocations.lockedTreasury = '1';
  await assert.rejects(router.instructions(ctx, forged, crypto.randomUUID(), transfer, memo), e => e.paymentNotSubmitted && /do not match/.test(e.message));

  // 7. Finalized purchase books one immutable revenue record; the 30% does NOT fund custody claims (v2).
  await store.transaction(async c => { await store.locked(c, wallet); await c.query('UPDATE ryo_accounts SET balance=1000000 WHERE scope=$1 AND wallet=$2', [store.scope, wallet]); });
  const purchaseId = crypto.randomUUID(); let purchaseSignature;
  await store.purchase(wallet, purchaseId, 'summon', { quantity: 1 }, 25000, async (q, c) => {
   const list = await router.instructions({ ...ctx, client: c }, q, purchaseId, transfer, memo), tx = new web3.Transaction({ feePayer: treasury.publicKey, recentBlockhash: web3.Keypair.generate().publicKey.toBase58() }).add(...list); tx.sign(treasury); assert(tx.verifySignatures());
   purchaseSignature = bs58.encode(tx.signature); return { signature: purchaseSignature, wire: tx.serialize().toString('base64'), lastHeight: 100 };
  });
  assert.equal((await router.summary(ctx, pool)).transactions, 0, 'pending route is never booked'); await store.settlePurchase(wallet, purchaseId, 'confirmed'); await store.settlePurchase(wallet, purchaseId, 'confirmed');
  let sum = await router.summary(ctx, pool); assert.equal(sum.transactions, 1); assert.equal(sum.totalsRaw.activeRewards, '7500000000'); assert.equal(sum.history.length, 1); assert.equal(sum.ready, true);
  assert.equal(Number((await router.income(store, pool)).n), 0, 'routed Active Rewards left custody: no claim funding until a verified top-up');
  assert.equal((await router.summary({ ...ctx, store: other }, pool)).transactions, 0, 'separate scope');
  // A failed route credits nothing; the reservation is returned and no hero is delivered.
  const before = (await store.profile(wallet)).heroes.length, id = crypto.randomUUID(); await store.purchase(wallet, id, 'summon', { quantity: 1 }, 25000, async q => fixture.stamp(q, { signature: 'refund-fixture', wire: 'wire', lastHeight: 10 })); await store.settlePurchase(wallet, id, 'refunded'); assert.equal((await store.profile(wallet)).heroes.length, before); assert.equal((await router.summary(ctx, pool)).transactions, 1);
  // Store-generated bonus purchases never make cash allocations or fund Adventure.
  await pool.query('UPDATE ryo_accounts SET bonus=100000 WHERE scope=$1 AND wallet=$2', [store.scope, wallet]); const bonusId = crypto.randomUUID(); await store.purchase(wallet, bonusId, 'summon', { quantity: 1 }, 25000, () => { throw Error('bonus must never route tokens'); }); await store.settlePurchase(wallet, bonusId, 'confirmed'); assert.equal((await router.summary(ctx, pool)).transactions, 1);
  await pool.query('UPDATE ryo_accounts SET bonus=0 WHERE scope=$1 AND wallet=$2', [store.scope, wallet]);
  // A v1 quote signed before an upgrade still settles under its persisted evidence.
  const legacyId = crypto.randomUUID(); await store.purchase(wallet, legacyId, 'summon', { quantity: 1 }, 25000, async q => { fixture.stamp(q, null); q.revenueDistribution.version = 1; return { signature: 'legacy-v1-signature', wire: 'd2lyZQ==', lastHeight: 10 }; });
  await store.settlePurchase(wallet, legacyId, 'confirmed'); assert.equal((await router.summary(ctx, pool)).transactions, 2, 'v1 pending order recovers under its original quote');
  assert.equal(Number((await router.income(store, pool)).n), 7500, 'a v1 quote retains its original (custody-retained) interpretation');
  assert.equal(require('../app/server/market.cjs').split(100000).adventureEligible, false, 'new Market fee pool is explicitly separate');
  await assert.rejects(router.instructions(ctx, economy.quote(economy.initialProfile(), 'sensei'), crypto.randomUUID(), transfer, memo), /not approved/);
  assert.equal(economy.quote(economy.initialProfile(), 'hunt').revenueDistribution, undefined, 'Boss Hunt remains a separate prize budget');
  await pool.query(`INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created)
    VALUES($1,$2,'market-separate','market','{}',$3,'{}','{}',100000,'market-separate-signature','wire',1,'confirmed',$4)`, [store.scope, wallet, JSON.stringify({ operations: 10000, adventureEligible: false }), store.now()]);
  assert.equal(Number((await router.income(store, pool)).n), 7500, 'unapproved Market fees never fund Adventure');

  // 8. Top-ups: Active Reward Pool → custody, finalized, independently approved, never re-split, never replayed.
  const sig = bs58.encode(crypto.randomBytes(64)), topup = { source: 'activeRewards', signature: sig, amountRaw: '100000000', evidence: 'Batch top-up from the Active Reward Pool wallet' };
  assert.throws(() => router.validateReplenishment({ ...topup, source: 'communityRewards' }), /remain separate/);
  assert.throws(() => router.validateReplenishment({ ...topup, amountRaw: '100000001' }), /whole Ryo/);
  const p = await propose('revenueReplenishment', topup); await assert.rejects(approve(p), /not finalized/);
  const sourceOwner = D.activeRewards, sourceAta = spl.getAssociatedTokenAddressSync(mint, new web3.PublicKey(sourceOwner), true).toBase58();
  const balances = (a, b) => [{ accountIndex: 0, mint: ctx.mint, owner: sourceOwner, uiTokenAmount: { amount: String(a), decimals: 6 } }, { accountIndex: 1, mint: ctx.mint, owner: ctx.treasuryAddress, uiTokenAmount: { amount: String(b), decimals: 6 } }];
  const proofFor = (signature, src = sourceAta) => ({ slot: 123, meta: { err: null, preTokenBalances: balances(200000000n, 0n), postTokenBalances: balances(100000000n, 100000000n) }, transaction: { signatures: [signature], message: { accountKeys: [{ pubkey: new web3.PublicKey(src) }, { pubkey: treasuryAta }], instructions: [{ programId: spl.TOKEN_PROGRAM_ID, parsed: { type: 'transferChecked', info: { source: src, destination: treasuryAta.toBase58(), mint: ctx.mint, tokenAmount: { amount: '100000000', decimals: 6 } } } }] } } });
  receipt.set(sig, proofFor(sig)); assert.equal(Number((await router.income(store, pool)).n), 7500, 'observed but unapproved transfer is not active funding');
  await approve(p); assert.equal(Number((await router.income(store, pool)).n), 7600);
  assert.equal((await router.summary(ctx, pool)).transactions, 2, 'an internal top-up is never booked as new Chapter 04 revenue');
  const replay = await propose('revenueReplenishment', topup); await assert.rejects(approve(replay), /already accounted/); assert.equal(Number((await router.income(store, pool)).n), 7600);
  // A service payment / withdrawal signature can never be re-used as a funding receipt.
  receipt.set(purchaseSignature, proofFor(purchaseSignature)); await assert.rejects(router.verifyReplenishment(ctx, await router.config(store), { ...topup, signature: purchaseSignature }), /already accounted/);
  // Wrong source wallet, forged balances.
  const sig2 = bs58.encode(crypto.randomBytes(64)); receipt.set(sig2, proofFor(sig2, spl.getAssociatedTokenAddressSync(mint, new web3.PublicKey(address()), true).toBase58()));
  await assert.rejects(router.verifyReplenishment(ctx, await router.config(store), { ...topup, signature: sig2 }), /does not match/);
  const sig3 = bs58.encode(crypto.randomBytes(64)), corrupt = proofFor(sig3); corrupt.meta.postTokenBalances[1].uiTokenAmount.amount = '999999999'; receipt.set(sig3, corrupt);
  await assert.rejects(router.verifyReplenishment(ctx, await router.config(store), { ...topup, signature: sig3 }), /balance changes/);

  // 9. Registry change after approval: configuration is stale and routing fails closed.
  { const raw = JSON.parse(fs.readFileSync(registryModule.FILE, 'utf8')); raw.destinations.find(d => d.role === 'communityRewards').address = address(); raw.srMintAddress = mint.toBase58(); raw.activation = { approved: true, reference: 'Isolated changed registry' }; registryModule.useForIsolatedTest(raw); }
  const stale = await router.config(store); assert.equal(stale.enabled, false); assert.equal(stale.stale, true);
  assert.match((await router.preview(store, wallet, q)).revenueDistribution.note, /no longer matches/);
  await assert.rejects(router.instructions(ctx, q, crypto.randomUUID(), transfer, memo), e => e.paymentNotSubmitted);
  fixture.activate(mint);

  // 10. Wrong network and live-only kinds.
  network = false; await assert.rejects(router.instructions(ctx, economy.quote(economy.initialProfile(), 'summon', { quantity: 1 }), crypto.randomUUID(), transfer, memo), e => e.paymentNotSubmitted); network = true;
  const count = Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_admin_audit WHERE scope=$1', [store.scope])).rows[0].n); assert(count > 0);
  console.log('PASS: SR revenue v2 — exact 50/30/10/10 conservation to u64 scale, registry-pinned destinations, Squads v4 drift refusal (threshold, members, config authority, time lock, owner, discriminator), four atomic SDK legs, activation locks, typed two-person approval, finalized top-ups with cross-ledger replay rejection, stale-registry fail-closed, v1 recovery, pending/refund/bonus/Market exclusions.');
 } finally { await db.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
