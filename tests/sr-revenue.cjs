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
 // Sections 1-10 exercise the protected Squads-vault Treasury shape (Treasury = vault #1, RYO Burn Reserve = vault #0), which the
 // registry supports for a later move out of the owner-approved single-key Treasury. Section 11 runs the committed live shape.
 const reg = fixture.activate(mint, { squadsTreasury: true }), D = reg.addresses;
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
  { const raw = fixture.squadsTreasuryShape(JSON.parse(fs.readFileSync(registryModule.FILE, 'utf8'))); raw.srMintAddress = mint.toBase58(); raw.srMintProgram = 'spl-token'; raw.activation = { approved: false, reference: null }; registryModule.useForIsolatedTest(raw); }
  await assert.rejects(router.instructions(ctx, q, crypto.randomUUID(), transfer, memo), e => e.paymentNotSubmitted && /activation approval/.test(e.message));
  fixture.activate(web3.Keypair.generate().publicKey, { squadsTreasury: true });
  await assert.rejects(router.instructions(ctx, q, crypto.randomUUID(), transfer, memo), e => e.paymentNotSubmitted && /does not match the registered SR mint/.test(e.message));
  fixture.activate(mint, { squadsTreasury: true });

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
  { const m = require('../app/server/market.cjs').split(100000); // owner decision 2026-11-12: 80% seller, 20% back to the Adventure reward pool, no Ryo leaves custody
    assert.deepEqual([m.seller, m.operations, m.studioFee, m.treasury, m.adventureEligible, m.settlement], [80000, 20000, 0, 0, undefined, 'internal'], 'new Market sales return 20% to the Adventure reward pool'); }
  { // Sensei is not an approved SR route. Live now refuses Ryo Sensei before quoting (founders.cjs); bypass only that
    // guard for this one quote so the router's own refusal is still proven.
    const founders = require('../app/server/founders.cjs'), guard = founders.assertRyoProduct; founders.assertRyoProduct = () => {};
    let senseiQuote; try { senseiQuote = economy.quote(economy.initialProfile(), 'sensei'); } finally { founders.assertRyoProduct = guard; }
    await assert.rejects(router.instructions(ctx, senseiQuote, crypto.randomUUID(), transfer, memo), /not approved/); }
  assert.throws(() => economy.quote(economy.initialProfile(), 'sensei'), e => e.status === 410, 'live: Sensei is bought with SOL, not Ryo (Founder decision 2026-11-09)');
  assert.equal(economy.quote(economy.initialProfile(), 'hunt').revenueDistribution, undefined, 'Boss Hunt remains a separate prize budget');
  await pool.query(`INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created)
    VALUES($1,$2,'market-separate','market','{}',$3,'{}','{}',100000,'market-separate-signature','wire',1,'confirmed',$4)`, [store.scope, wallet, JSON.stringify({ operations: 10000, adventureEligible: false }), store.now()]);
  assert.equal(Number((await router.income(store, pool)).n), 7500, 'historical Market fees recorded as separate keep that interpretation');

  // 8. Top-ups: Active Reward Pool → custody, finalized, independently approved, never re-split, never replayed.
  const sig = bs58.encode(crypto.randomBytes(64)), topup = { source: 'activeRewards', signature: sig, amountRaw: '100000000', evidence: 'Batch top-up from the Active Reward Pool wallet' };
  assert.throws(() => router.validateReplenishment({ ...topup, source: 'communityRewards' }), /remain separate/);
  assert.throws(() => router.validateReplenishment({ ...topup, amountRaw: '100000001' }), /whole Ryo/);
  const p = await propose('revenueReplenishment', topup); await assert.rejects(approve(p), /not finalized/);
  const sourceOwner = D.activeRewards, sourceAta = spl.getAssociatedTokenAddressSync(mint, new web3.PublicKey(sourceOwner), true).toBase58();
  const balances = (a, b) => [{ accountIndex: 0, mint: ctx.mint, owner: sourceOwner, uiTokenAmount: { amount: String(a), decimals: 6 } }, { accountIndex: 1, mint: ctx.mint, owner: ctx.treasuryAddress, uiTokenAmount: { amount: String(b), decimals: 6 } }];
  const proofFor = (signature, src = sourceAta) => ({ slot: 123, meta: { err: null, preTokenBalances: balances(200000000n, 0n), postTokenBalances: balances(100000000n, 100000000n) }, transaction: { signatures: [signature], message: { accountKeys: [{ pubkey: new web3.PublicKey(src) }, { pubkey: treasuryAta }, { pubkey: new web3.PublicKey(sourceOwner), signer: true }], instructions: [{ programId: spl.TOKEN_PROGRAM_ID, parsed: { type: 'transferChecked', info: { source: src, destination: treasuryAta.toBase58(), mint: ctx.mint, authority: sourceOwner, tokenAmount: { amount: '100000000', decimals: 6 } } } }] } } });
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
  // Direct top-ups (hardening 2026-11-10): the transfer must be signed by the source wallet itself; any other SR movement in
  // the same transaction is refused; transfers of other tokens are irrelevant; account creation is never accepted here.
  { const cfgNow = await router.config(store), check = (label, mutate, expect) => { const s = bs58.encode(crypto.randomBytes(64)), proof = proofFor(s); mutate(proof); receipt.set(s, proof);
      const run = router.verifyReplenishment(ctx, cfgNow, { ...topup, signature: s }); return expect ? assert.rejects(run, expect, 'refused: ' + label) : run.then(r => assert.equal(r.amountRaw, topup.amountRaw, label)); };
    const otherMint = { programId: spl.TOKEN_PROGRAM_ID, parsed: { type: 'transferChecked', info: { source: address(), destination: address(), mint: address(), authority: address(), tokenAmount: { amount: '5', decimals: 6 } } } };
    await check('signed by a wallet other than the source', p => { p.transaction.message.instructions[0].parsed.info.authority = address(); }, /explicit approved SR transfer/);
    // Real Mainnet shape (2026-11-10, 6,000,000 SR from the Active Reward Pool): the wallet listed itself again as an extra
    // signer, so Solana reports multisigAuthority + signers instead of authority.
    const selfListed = (p, signers) => { const info = p.transaction.message.instructions[0].parsed.info; delete info.authority; info.multisigAuthority = sourceOwner; info.signers = signers; };
    await check('signed by the source wallet listed again as its own only signer', p => selfListed(p, [sourceOwner]), null);
    await check('extra trailing accounts after the source wallet are ignored', p => selfListed(p, [sourceOwner, address()]), null);
    await check('the source wallet did not sign the transaction', p => { selfListed(p, [address()]); p.transaction.message.accountKeys[2].signer = false; }, /not signed by the registered activeRewards wallet/);
    await check('the source wallet is missing from the transaction', p => { p.transaction.message.accountKeys.pop(); }, /not signed by the registered activeRewards wallet/);
    await check('a multisig authority other than the source wallet', p => { const info = p.transaction.message.instructions[0].parsed.info; delete info.authority; info.multisigAuthority = address(); info.signers = [sourceOwner]; }, /not signed by the registered activeRewards wallet/);
    await check('a game deposit (deposit memo) is never a top-up', p => { p.transaction.message.instructions.push({ programId: new web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), parsed: 'shinobi-deposit-v2:' + crypto.randomUUID() }); }, /game deposit/);
    { overrides[sourceOwner] = { owner: spl.TOKEN_PROGRAM_ID, data: Buffer.alloc(0), lamports: 1 }; try { await check('a source that is no longer a plain wallet', () => {}, /plain wallet/); } finally { delete overrides[sourceOwner]; } }
    { const s = bs58.encode(crypto.randomBytes(64)), proof = proofFor(s); receipt.set(s, proof); const r = await router.verifyReplenishment(ctx, cfgNow, { ...topup, signature: s }); assert.deepEqual([r.path, r.signer], ['direct', 'authority'], 'the evidence records the path and signer shape'); }
    await check('a transfer of another token alongside is accepted', p => { p.transaction.message.instructions.push(otherMint); }, null);
    await check('another SR account changes balance (unchecked transfer, burn)', p => { const extra = (a) => ({ accountIndex: 2, mint: ctx.mint, owner: address(), uiTokenAmount: { amount: a, decimals: 6 } }); p.meta.preTokenBalances.push(extra('50')); p.meta.postTokenBalances.push(extra('40')); }, /Other SR balances changed/);
    await check('an SR account created with a balance in the same transaction', p => { p.meta.postTokenBalances.push({ accountIndex: 2, mint: ctx.mint, owner: address(), uiTokenAmount: { amount: '7', decimals: 6 } }); }, /Other SR balances changed/);
    await check('a correctly signed transfer made inside another program', p => { const t = p.transaction.message.instructions[0]; p.transaction.message.instructions = [{ programId: new web3.PublicKey(address()), accounts: [], data: '' }]; p.meta.innerInstructions = [{ index: 0, instructions: [t] }]; }, /must send SR itself, as a top-level transfer/);
    await check('an orphaned inner transfer (parent index out of range) is never treated as top-level', p => { p.meta.innerInstructions = [{ index: 99, instructions: [p.transaction.message.instructions[0]] }]; p.transaction.message.instructions = []; }, /must send SR itself, as a top-level transfer/);
    await check('a second SR transfer at any depth', p => { p.meta.innerInstructions = [{ index: 0, instructions: [p.transaction.message.instructions[0]] }]; }, /explicit approved SR transfer/);
    await check('custody account creation is only accepted on the Squads path', p => { p.meta.preTokenBalances = p.meta.preTokenBalances.slice(0, 1); p.transaction.message.instructions.unshift({ programId: spl.ASSOCIATED_TOKEN_PROGRAM_ID, parsed: { type: 'createIdempotent', info: { account: treasuryAta.toBase58(), mint: ctx.mint, wallet: ctx.treasuryAddress } } }); }, /Missing finalized replenishment token balances/); }
  // Locked Treasury top-up executed through Squads (owner decision 2026-11-10): the SR transfer is an inner instruction of a
  // vote-approved vault_transaction_execute of the registered Squads multisig, signed by the registered vault. Only for
  // source lockedTreasury; the Locked Treasury can never use the direct path.
  { const reg = registryModule.registry(), SQUADS = reg.squads.programId, vault = D.lockedTreasury;
    const anchorIx = name => bs58.encode(crypto.createHash('sha256').update('global:' + name).digest().subarray(0, 8));
    const vaultAta = spl.getAssociatedTokenAddressSync(mint, new web3.PublicKey(vault), true).toBase58();
    const vbal = (a, b) => [{ accountIndex: 0, mint: ctx.mint, owner: vault, uiTokenAmount: { amount: String(a), decimals: 6 } }, { accountIndex: 1, mint: ctx.mint, owner: ctx.treasuryAddress, uiTokenAmount: { amount: String(b), decimals: 6 } }];
    // Shaped like the real Mainnet execution: compute-budget instructions first, so the Squads execute is not at index 0
    // and its inner instructions are found through the inner-instruction group's own index.
    const computeBudget = { programId: new web3.PublicKey('ComputeBudget111111111111111111111111111111'), accounts: [], data: '3DTZbgwsozUF' };
    const squadsProof = (signature, { parent = SQUADS, multisig = reg.squads.multisig, ix = 'vault_transaction_execute', authority = vault, extraDirect = false, newCustody = false, createCustody = newCustody, createWallet = ctx.treasuryAddress, createMint = ctx.mint, amount = '100000000', posts = [400000000n, 100000000n] } = {}) => {
      const t = { programId: spl.TOKEN_PROGRAM_ID, parsed: { type: 'transferChecked', info: { source: vaultAta, destination: treasuryAta.toBase58(), mint: ctx.mint, authority, tokenAmount: { amount, decimals: 6 } } } };
      const create = { programId: spl.ASSOCIATED_TOKEN_PROGRAM_ID, parsed: { type: 'createIdempotent', info: { account: treasuryAta.toBase58(), mint: createMint, wallet: createWallet } } };
      return { slot: 124, meta: { err: null, preTokenBalances: newCustody ? vbal(500000000n, 0n).slice(0, 1) : vbal(500000000n, 0n), postTokenBalances: vbal(...posts), innerInstructions: [{ index: 1, instructions: [...(createCustody ? [create] : []), t] }] },
        transaction: { signatures: [signature], message: { accountKeys: [{ pubkey: new web3.PublicKey(vaultAta) }, { pubkey: treasuryAta }], instructions: [computeBudget, { programId: new web3.PublicKey(parent), accounts: [new web3.PublicKey(multisig)], data: anchorIx(ix) }, ...(extraDirect ? [t] : [])] } } };
    };
    const cfgNow = await router.config(store), ok = bs58.encode(crypto.randomBytes(64)); receipt.set(ok, squadsProof(ok));
    const lt = { source: 'lockedTreasury', signature: ok, amountRaw: '100000000', evidence: 'Locked Treasury top-up via Squads' };
    const verified = await router.verifyReplenishment(ctx, cfgNow, lt);
    assert.deepEqual([verified.sourceAta, verified.amountRaw], [vaultAta, '100000000'], 'a Squads-executed Locked Treasury transfer is verified');
    await assert.rejects(router.verifyReplenishment(ctx, cfgNow, { ...lt, source: 'activeRewards' }), /explicit approved SR transfer/, 'only the Locked Treasury may use the Squads path');
    for (const [label, opts] of [['another program as parent', { parent: web3.Keypair.generate().publicKey.toBase58() }], ['another signing authority', { authority: web3.Keypair.generate().publicKey.toBase58() }], ['a second, direct transfer', { extraDirect: true }],
      ['a Squads spending-limit transfer (no vote)', { ix: 'spending_limit_use' }], ['a Squads config change', { ix: 'config_transaction_execute' }], ['a different Squads multisig', { multisig: web3.Keypair.generate().publicKey.toBase58() }]]) {
      const s = bs58.encode(crypto.randomBytes(64)); receipt.set(s, squadsProof(s, opts));
      await assert.rejects(router.verifyReplenishment(ctx, cfgNow, { ...lt, signature: s }), /explicit approved SR transfer/, 'refused: ' + label);
    }
    { const s = bs58.encode(crypto.randomBytes(64)), direct = squadsProof(s); direct.transaction.message.instructions = [direct.meta.innerInstructions[0].instructions.at(-1)]; direct.meta.innerInstructions = []; direct.transaction.message.accountKeys.push({ pubkey: new web3.PublicKey(vault), signer: true }); receipt.set(s, direct);
      await assert.rejects(router.verifyReplenishment(ctx, cfgNow, { ...lt, signature: s }), /can only send SR through an approved Squads vault transaction/, 'the Locked Treasury can never use the direct path'); }
    // On the Squads path only the vault itself as 'authority' is accepted (a vault PDA is never a token multisig).
    { const s = bs58.encode(crypto.randomBytes(64)), p = squadsProof(s), info = p.meta.innerInstructions[0].instructions.at(-1).parsed.info; delete info.authority; info.multisigAuthority = vault; info.signers = [vault]; receipt.set(s, p);
      await assert.rejects(router.verifyReplenishment(ctx, cfgNow, { ...lt, signature: s }), /not signed by the registered lockedTreasury wallet/, 'Squads path: the multisigAuthority shape is refused'); }
    { const s = bs58.encode(crypto.randomBytes(64)); receipt.set(s, squadsProof(s)); assert.deepEqual(((r) => [r.path, r.signer])(await router.verifyReplenishment(ctx, cfgNow, { ...lt, signature: s })), ['squads-vault-execute', 'authority'], 'Squads evidence records its path'); }
    // The inner transfer is attributed to its own parent: the same transfer under the compute-budget instruction is refused.
    { const s = bs58.encode(crypto.randomBytes(64)), p = squadsProof(s); p.meta.innerInstructions[0].index = 0; receipt.set(s, p);
      await assert.rejects(router.verifyReplenishment(ctx, cfgNow, { ...lt, signature: s }), /explicit approved SR transfer/, 'inner transfers are matched to their actual parent instruction'); }
    // On the Squads path the same exact-amount and whole-transaction balance rules apply.
    for (const [label, opts, expect, mutate] of [
      ['a transfer amount that differs from the request', { amount: '200000000', posts: [300000000n, 200000000n] }, /does not match the approved request/],
      ['finalized balances that differ from the transfer', { posts: [400000000n, 90000000n] }, /balance changes do not match/],
      ['finalized balances that differ from the transfer (new custody account)', { newCustody: true, posts: [400000000n, 90000000n] }, /balance changes do not match/],
      ['another SR account changes balance', {}, /Other SR balances changed/, p => { const extra = a => ({ accountIndex: 2, mint: ctx.mint, owner: address(), uiTokenAmount: { amount: a, decimals: 6 } }); p.meta.preTokenBalances.push(extra('50')); p.meta.postTokenBalances.push(extra('0')); }]]) {
      const s = bs58.encode(crypto.randomBytes(64)), p = squadsProof(s, opts); if (mutate) mutate(p); receipt.set(s, p);
      await assert.rejects(router.verifyReplenishment(ctx, cfgNow, { ...lt, signature: s }), expect, 'refused on the Squads path: ' + label);
    }
    // Governance is re-checked at approval time: a multisig that drifted (threshold lowered) can no longer fund claims.
    { const s = bs58.encode(crypto.randomBytes(64)); receipt.set(s, squadsProof(s)); overrides[reg.squads.multisig] = squads(d => d.writeUInt16LE(1, 8 + 64));
      try { await assert.rejects(router.verifyReplenishment(ctx, cfgNow, { ...lt, signature: s }), /Squads v4/, 'a drifted Squads multisig cannot fund claims'); } finally { delete overrides[reg.squads.multisig]; }
      await router.verifyReplenishment(ctx, cfgNow, { ...lt, signature: s }); }
    // The real Mainnet top-up also created the custody SR account: no 'before' balance, accepted only with that creation
    // for the custody wallet and the SR mint.
    { const s = bs58.encode(crypto.randomBytes(64)); receipt.set(s, squadsProof(s, { newCustody: true })); await router.verifyReplenishment(ctx, cfgNow, { ...lt, signature: s });
      for (const [label, opts] of [['no account creation', { createCustody: false }], ['creation for another wallet', { createWallet: address() }], ['creation for another mint', { createMint: address() }]]) {
        const s2 = bs58.encode(crypto.randomBytes(64)); receipt.set(s2, squadsProof(s2, { newCustody: true, ...opts }));
        await assert.rejects(router.verifyReplenishment(ctx, cfgNow, { ...lt, signature: s2 }), /Missing finalized replenishment token balances/, 'a missing before-balance fails closed: ' + label); } }
    const before = Number((await router.income(store, pool)).n), lp = await propose('revenueReplenishment', lt); await approve(lp);
    assert.equal(Number((await router.income(store, pool)).n), before + 100, 'approved Squads top-up funds claims once');
    await assert.rejects(approve(await propose('revenueReplenishment', lt)), /already accounted/, 'the same Squads transfer can never be credited twice'); }

  // 9. Registry change after approval: configuration is stale and routing fails closed.
  { const raw = fixture.squadsTreasuryShape(JSON.parse(fs.readFileSync(registryModule.FILE, 'utf8'))); raw.destinations.find(d => d.role === 'communityRewards').address = address(); raw.srMintAddress = mint.toBase58(); raw.srMintProgram = 'spl-token'; raw.activation = { approved: true, reference: 'Isolated changed registry' }; registryModule.useForIsolatedTest(raw); }
  const stale = await router.config(store); assert.equal(stale.enabled, false); assert.equal(stale.stale, true);
  assert.match((await router.preview(store, wallet, q)).revenueDistribution.note, /no longer matches/);
  await assert.rejects(router.instructions(ctx, q, crypto.randomUUID(), transfer, memo), e => e.paymentNotSubmitted);
  fixture.activate(mint, { squadsTreasury: true });

  // 10. Wrong network and live-only kinds.
  network = false; await assert.rejects(router.instructions(ctx, economy.quote(economy.initialProfile(), 'summon', { quantity: 1 }), crypto.randomUUID(), transfer, memo), e => e.paymentNotSubmitted); network = true;
  const count = Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_admin_audit WHERE scope=$1', [store.scope])).rows[0].n); assert(count > 0);
  // 11. Committed live registry (Treasury migration 2026-11-12): owner-approved single-key Treasury GPbg…, the former Squads
  // Treasury vault 5wVB… as the RYO Burn Reserve. Same 50/30/10/10, same atomic four legs; only the Treasury custody changes.
  { const live = fixture.activate(mint), L = live.addresses, TREASURY = 'GPbgpbtxEiZtsWnjxq3MKbk9gaoqFNEbpTRqn8t7htjE', RESERVE = '5wVBdFkQFLtu8qhZ1pg6RoD1LjWGUYL1erBVGBu11aGn';
    assert.equal(L.lockedTreasury, TREASURY); assert.equal(live.reserveAddresses.ryoBurnReserve, RESERVE); assert.equal(router.treasuryIsSquads(live), false); assert.equal(router.treasuryMultisig(live), null);
    // Cutover: the routing approved for the previous Treasury is stale and routing fails closed until re-approved.
    const before = await router.config(store); assert.equal(before.stale, true, 'routing pinned to the old Treasury goes stale'); assert.equal(before.enabled, false);
    await assert.rejects(router.instructions(ctx, economy.quote(economy.initialProfile(), 'summon', { quantity: 1 }), crypto.randomUUID(), transfer, memo), e => e.paymentNotSubmitted);
    // The admin snapshot survives a stale routing configuration (the re-approval at cutover needs this page).
    { const snap = await call(reviewer, 'admin-snapshot'); assert.equal(snap.revenueDistribution.config.stale, true); assert(Array.isArray(snap.chain.vaults)); }
    const cfg2 = { enabled: true, destinations: { ...L }, products: [...router.APPROVED], evidence: 'Re-approval after the Treasury migration' };
    assert.throws(() => router.validateConfig({ ...cfg2, lockedTreasuryMultisig: live.squads.multisig }), /single-key wallet: lockedTreasuryMultisig must be null/, 'a single-key Treasury never claims the Burn Reserve multisig');
    assert.throws(() => router.validateConfig({ ...cfg2, destinations: { ...L, lockedTreasury: RESERVE } }), /reviewed public registry/, 'revenue can never be pointed at the Burn Reserve');
    assert.equal(router.validateConfig({ ...cfg2, lockedTreasuryMultisig: null }).lockedTreasuryMultisig, null);
    assert.deepEqual(router.RATES, { lockedTreasury: 5000, activeRewards: 3000, communityRewards: 1000, economicReserve: 1000 }, 'percentages unchanged');
    assert.equal(router.publicPolicy().serviceBurnBps, 0, 'no automatic burn'); assert.equal(router.publicPolicy().withdrawalTreasuryBps, 500);
    await approve(await propose('revenueRouting', cfg2));
    const now = await router.config(store); assert.equal(now.enabled, true); assert.equal(now.destinations.lockedTreasury, TREASURY); assert.equal(now.lockedTreasuryMultisig, null);
    // Checkout: the four atomic legs pay the new Treasury; the proof records the single-key custody honestly.
    const q2 = economy.quote(economy.initialProfile(), 'summon', { quantity: 1 }), legs = await router.instructions(ctx, q2, crypto.randomUUID(), transfer, memo);
    assert.equal(q2.revenueDistribution.lockProof.kind, 'single-key-wallet'); assert.equal(q2.revenueDistribution.lockProof.verified, true); assert.equal(q2.revenueDistribution.destinations.lockedTreasury, TREASURY);
    const checked = legs.filter(i => i.programId.equals(spl.TOKEN_PROGRAM_ID) && i.data[0] === 12).map(i => spl.decodeTransferCheckedInstruction(i, spl.TOKEN_PROGRAM_ID));
    assert.deepEqual(checked.map(i => i.keys.destination.pubkey.toBase58()), ['lockedTreasury', 'activeRewards', 'communityRewards', 'economicReserve'].map(r => spl.getAssociatedTokenAddressSync(mint, new web3.PublicKey(L[r]), true).toBase58()), 'Treasury leg → GPbg…');
    assert.deepEqual(checked.map(i => String(i.data.amount)), ['lockedTreasury', 'activeRewards', 'communityRewards', 'economicReserve'].map(k => q2.revenueDistribution.allocations[k]), 'exact 50/30/10/10 allocation');
    assert(!checked.some(i => i.keys.destination.pubkey.toBase58() === spl.getAssociatedTokenAddressSync(mint, new web3.PublicKey(RESERVE), true).toBase58()), 'nothing is routed to the Burn Reserve');
    // The single-key Treasury is still verified: a delegate on its token account or a program-owned address refuses checkout.
    const tAta = spl.getAssociatedTokenAddressSync(mint, new web3.PublicKey(TREASURY), true).toBase58();
    { const data = Buffer.alloc(spl.ACCOUNT_SIZE); spl.AccountLayout.encode({ mint, owner: new web3.PublicKey(TREASURY), amount: 0n, delegateOption: 1, delegate: treasury.publicKey, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 1n, closeAuthorityOption: 0, closeAuthority: web3.PublicKey.default }, data);
      overrides[tAta] = { owner: spl.TOKEN_PROGRAM_ID, data, lamports: 1 }; await assert.rejects(router.verifyVaults(ctx, now), /Treasury token account/); delete overrides[tAta]; }
    overrides[TREASURY] = { owner: spl.TOKEN_PROGRAM_ID, data: Buffer.alloc(0), lamports: 1 }; await assert.rejects(router.verifyVaults(ctx, now), /could not be verified/); delete overrides[TREASURY];
    await assert.rejects(router.verifyVaults({ ...ctx, treasuryAddress: TREASURY }, now), /separate from the game custody/, 'the Treasury can never be the game custody signer');
    // Top-ups from the single-key Treasury: direct, signed by the Treasury itself. The Squads path and the Burn Reserve are refused.
    const ts = bs58.encode(crypto.randomBytes(64)), tProof = (sig, { src = tAta, signer = TREASURY, inner = false } = {}) => {
      const bal = (a, b) => [{ accountIndex: 0, mint: ctx.mint, owner: TREASURY, uiTokenAmount: { amount: String(a), decimals: 6 } }, { accountIndex: 1, mint: ctx.mint, owner: ctx.treasuryAddress, uiTokenAmount: { amount: String(b), decimals: 6 } }];
      const t = { programId: spl.TOKEN_PROGRAM_ID, parsed: { type: 'transferChecked', info: { source: src, destination: treasuryAta.toBase58(), mint: ctx.mint, authority: signer, tokenAmount: { amount: '100000000', decimals: 6 } } } };
      const squadsIx = { programId: new web3.PublicKey(live.squads.programId), accounts: [new web3.PublicKey(live.squads.multisig)], data: bs58.encode(crypto.createHash('sha256').update('global:vault_transaction_execute').digest().subarray(0, 8)) };
      return { slot: 9, meta: { err: null, preTokenBalances: bal(500000000n, 0n), postTokenBalances: bal(400000000n, 100000000n), innerInstructions: inner ? [{ index: 0, instructions: [t] }] : [] },
        transaction: { signatures: [sig], message: { accountKeys: [{ pubkey: new web3.PublicKey(src) }, { pubkey: treasuryAta }, { pubkey: new web3.PublicKey(signer), signer: true }], instructions: inner ? [squadsIx] : [t] } } };
    };
    const ltop = { source: 'lockedTreasury', signature: ts, amountRaw: '100000000', evidence: 'Single-key Treasury top-up' };
    receipt.set(ts, tProof(ts)); assert.equal((await router.verifyReplenishment(ctx, now, ltop)).path, 'direct', 'the single-key Treasury tops up directly');
    { const s2 = bs58.encode(crypto.randomBytes(64)); receipt.set(s2, tProof(s2, { inner: true })); await assert.rejects(router.verifyReplenishment(ctx, now, { ...ltop, signature: s2 }), /must send SR itself/, 'no Squads path for a single-key Treasury'); }
    { const s3 = bs58.encode(crypto.randomBytes(64)), rAta = spl.getAssociatedTokenAddressSync(mint, new web3.PublicKey(RESERVE), true).toBase58(); receipt.set(s3, tProof(s3, { src: rAta, signer: RESERVE, inner: true }));
      await assert.rejects(router.verifyReplenishment(ctx, now, { ...ltop, signature: s3 }), /explicit approved SR transfer|does not match/, 'Burn Reserve funds are never a reward top-up'); }
    assert(!router.REPLENISH_SOURCES.includes('ryoBurnReserve'));
    await assert.rejects(router.verifyReplenishment(ctx, { ...now, destinations: { ...now.destinations, lockedTreasury: RESERVE } }, ltop), /Burn Reserve funds can never be recorded as a reward top-up/);
    fixture.activate(mint, { squadsTreasury: true }); }

  console.log('PASS: SR revenue v2 — single-key Treasury (owner exception) routing, cutover staleness and re-approval, Burn Reserve excluded from revenue and top-ups; exact 50/30/10/10 conservation to u64 scale, registry-pinned destinations, Squads v4 drift refusal (threshold, members, config authority, time lock, owner, discriminator), four atomic SDK legs, activation locks, typed two-person approval, finalized top-ups with cross-ledger replay rejection, stale-registry fail-closed, v1 recovery, pending/refund/bonus/Market exclusions.');
 } finally { await db.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
