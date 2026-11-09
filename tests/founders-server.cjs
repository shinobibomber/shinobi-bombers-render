'use strict';
/* Founder's NFT Boxes on the assembled server modules (in-memory Postgres, fake Solana RPC, real SDK wires and
 * signatures, controllable clock). Concurrency is modelled by a pool that serializes connections like row locks;
 * true multi-connection races on a real Postgres are not exercised here.
 * Covers: atomic payment+NFT transaction, exact prices, 30 per tier / 60 total, one Founder NFT per wallet across
 * tiers (server + database constraints), replays, forged/tampered signatures, server-side broadcast, expiry, pause,
 * fail-closed switches, buyer-bound entitlements (transfer gives the new holder nothing), activation grants,
 * Limited (no Genin/no Mythic) and Premium (70/30) summons with exact pools, pass accounting under parallel use,
 * qualifying weeks, discounts, the live 12 h / 24 h Chest cooldown, live Ryo-Sensei removal and SOL Sensei. */
const fixture = require('./sr-revenue-fixture.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../app/server');
const web3 = require(path.resolve(root, '../node_modules/@solana/web3.js')), bs58 = require(path.resolve(root, '../node_modules/bs58'));
const network = require(path.join(root, 'network.cjs')), { Store } = require(path.join(root, 'store.cjs'));
const F = require(path.join(root, 'founders.cjs')), economy = require(path.join(root, 'economy.cjs')), mythic = require(path.join(root, 'mythic-hero.cjs'));
const A = require(path.join(root, 'adventure.cjs')), T = require(path.join(root, 'treasury-rewards.cjs')), upgrades = require(path.join(root, 'hero-upgrades.cjs'));
const T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', SYS = '11111111111111111111111111111111', MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SOL = 1e9, HOUR = 3600000, DAY = 86400000, WEEK = 7 * DAY;
const devnet = () => { network.built = () => network.NETWORKS.devnet; }, mainnet = () => { network.built = () => network.NETWORKS.mainnet; };
const pass = [];
const ok = label => pass.push(label);

(async () => {
  devnet();
  const db = new PGlite(), schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'); await db.exec(schema); await db.exec(schema);
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  let now = Date.UTC(2027, 0, 6, 12); // a Wednesday
  const store = new Store(pool, 'solana-devnet:founders-test', () => now);

  const authority = web3.Keypair.generate(), revenue = web3.Keypair.generate().publicKey.toBase58();
  const balances = new Map(), statuses = new Map(), accounts = new Map(), refs = new Map(), sent = []; let height = 100, sendFails = false;
  const connection = {
    async getGenesisHash() { return 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'; },
    async getMinimumBalanceForRentExemption(n) { return 890880 + n * 6960; },
    async getLatestBlockhash() { return { blockhash: web3.Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: height + 150 }; },
    async getFeeForMessage() { return { value: 15000 }; },
    async getBalance(k) { return balances.get(k.toBase58()) ?? 0; },
    async getAccountInfo(k) { return accounts.get(k.toBase58()) || null; },
    async getSignatureStatuses(sigs) { return { value: sigs.map(s => statuses.get(s) || null) }; },
    async getSignaturesForAddress(k) { return (refs.get(k.toBase58()) || []).map(signature => ({ signature })); },
    async getBlockHeight() { return height; },
    async sendRawTransaction(raw) { if (sendFails) throw Error('Blockhash not found'); sent.push(Buffer.from(raw)); return 'sent'; },
    async getParsedTokenAccountsByOwner() { return { value: [] }; },
    async getMultipleAccountsInfo(a) { return a.map(() => null); },
  };
  const env = (extra = {}) => ({ FOUNDERS_MINT_AUTHORITY_SECRET: JSON.stringify([...authority.secretKey]), RYO_REVENUE_WALLET: revenue, ...extra });
  const PUBLIC = env({ FOUNDERS_PUBLIC_SALE_ENABLED: 'on' });
  const ctx = { store, connection, revenueAddress: revenue, origin: 'https://example.invalid' };
  const wallets = Array.from({ length: 80 }, () => web3.Keypair.generate()), W = k => k.publicKey.toBase58();
  for (const k of wallets) balances.set(W(k), 5 * SOL);
  const [alice, bob, carol, dave, eve] = wallets;
  const id = n => 'founder-request-' + String(n).padStart(8, '0');
  const signWire = (k, wire) => { const tx = web3.Transaction.from(Buffer.from(wire, 'base64')); tx.partialSign(k); return tx; };
  const signed = (k, wire) => signWire(k, wire).serialize().toString('base64');

  /* ---------- Switches fail closed ---------- */
  assert.equal(F.saleMode({}), 'off'); assert.equal(F.saleMode({ FOUNDERS_PUBLIC_SALE_ENABLED: 'maybe' }), 'off'); assert.equal(F.saleMode({ FOUNDERS_PUBLIC_SALE_ENABLED: 'false' }), 'off');
  assert.equal(F.switches({ FOUNDERS_REWARD_REDEMPTION_ENABLED: '' }).redemption, false);
  await assert.rejects(F.mint(ctx, W(alice), { tier: 'mythic', requestId: id(1) }, env()), e => e.code === 'FOUNDERS_CLOSED');
  const PRIVATE = env({ FOUNDERS_PRIVATE_TESTING_ENABLED: 'on', RYO_PRIVATE_TEST_WALLETS: W(dave) });
  await assert.rejects(F.mint(ctx, W(alice), { tier: 'mythic', requestId: id(1) }, PRIVATE), e => e.code === 'FOUNDERS_PRIVATE');
  assert.equal((await F.info(store, W(dave), PRIVATE)).founders.eligible, true); assert.equal((await F.info(store, W(alice), PRIVATE)).founders.eligible, false);
  await assert.rejects(F.mint(ctx, W(alice), { tier: 'mythic', requestId: id(1) }, { FOUNDERS_PUBLIC_SALE_ENABLED: 'on' }), e => e.code === 'FOUNDERS_NOT_CONFIGURED');
  await assert.rejects(F.mint(ctx, W(alice), { tier: 'gold', requestId: id(1) }, PUBLIC), /Mythic or Legacy/);
  assert.equal(F.TIERS.mythic.lamports, SOL); assert.equal(F.TIERS.legacy.lamports, SOL / 2); assert.equal(F.TOTAL_SUPPLY, 60);
  ok('switches fail closed (off/invalid/missing key); private testing is allowlist-only; prices and supply are code constants');

  /* ---------- Mythic purchase: one atomic transaction ---------- */
  let r = await F.mint(ctx, W(alice), { tier: 'mythic', requestId: id(1), price: 0.0001 }, PUBLIC);
  assert.deepEqual([r.purchase.tier, r.purchase.serial, r.purchase.price, r.purchase.status], ['mythic', 1, 1, 'pending'], 'a client price is ignored');
  let tx = web3.Transaction.from(Buffer.from(r.purchase.wire, 'base64'));
  assert(tx.feePayer.equals(alice.publicKey));
  assert.deepEqual(tx.instructions.map(ix => ix.programId.toBase58()), [SYS, SYS, T22, T22, T22, ATA, T22, T22, MEMO]);
  const pay = web3.SystemInstruction.decodeTransfer(tx.instructions[0]);
  assert.deepEqual([pay.fromPubkey.toBase58(), pay.toPubkey.toBase58(), Number(pay.lamports)], [W(alice), revenue, SOL], 'exactly 1 SOL to the revenue wallet');
  assert.equal(Buffer.from(tx.instructions[8].data).toString(), 'shinobi-founder-v1:mythic:' + id(1));
  assert.match(Buffer.from(tx.instructions[4].data).toString('latin1'), /Shinobi Bombers Founder Mythic #1[\s\S]*SBFNDR[\s\S]*example\.invalid\/founders\/metadata\/mythic-1\.json/);
  assert.equal(tx.instructions[7].data[0], 6, 'mint authority removed after minting exactly 1');
  const sigs = Object.fromEntries(tx.signatures.map(s => [s.publicKey.toBase58(), !!s.signature]));
  assert.deepEqual([sigs[W(alice)], sigs[W(authority)], sigs[r.purchase.mint]], [false, true, true], 'authority and mint signed; the buyer signs last');
  assert(Buffer.from(r.purchase.wire, 'base64').length <= 1232);
  // Replays, other wallets, and a second purchase while pending.
  assert.equal((await F.mint(ctx, W(alice), { tier: 'mythic', requestId: id(1) }, PUBLIC)).purchase.mint, r.purchase.mint);
  await assert.rejects(F.mint(ctx, W(bob), { tier: 'mythic', requestId: id(1) }, PUBLIC), /Invalid request ID/);
  await assert.rejects(F.mint(ctx, W(alice), { tier: 'mythic', requestId: id(1).replace('founder', 'founder-x') }, PUBLIC), e => e.code === 'FOUNDERS_PENDING');
  await assert.rejects(F.mint(ctx, W(alice), { tier: 'legacy', requestId: id(2) }, PUBLIC), e => e.code === 'FOUNDERS_PENDING');
  ok('Mythic box: exact 1 SOL to revenue + Token-2022 NFT (metadata, authority removed, memo) in one ≤1232-byte transaction; replays idempotent');

  // Confirmation: tampered and forged transactions are refused; the server broadcasts the buyer-signed bytes.
  const tampered = web3.Transaction.from(Buffer.from(r.purchase.wire, 'base64')); tampered.instructions[0] = web3.SystemProgram.transfer({ fromPubkey: alice.publicKey, toPubkey: alice.publicKey, lamports: 1 });
  tampered.partialSign(alice);
  await assert.rejects(F.confirm(ctx, W(alice), { requestId: id(1), signed: tampered.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') }), /changed the transaction/);
  await assert.rejects(F.confirm(ctx, W(alice), { requestId: id(1), signature: bs58.encode(crypto.randomBytes(64)) }), /not this Founder box transaction/);
  await assert.rejects(F.confirm(ctx, W(bob), { requestId: id(1), signed: signed(alice, r.purchase.wire) }), /not found/);
  const aliceTx = signWire(alice, r.purchase.wire), aliceSig = bs58.encode(aliceTx.signatures.find(s => s.publicKey.equals(alice.publicKey)).signature);
  r = await F.confirm(ctx, W(alice), { requestId: id(1), signed: aliceTx.serialize().toString('base64') });
  assert.equal(r.purchase.status, 'pending', 'not finalized yet'); assert.equal(sent.length, 1, 'broadcast by the server'); assert.equal(r.purchase.signature, aliceSig);
  statuses.set(aliceSig, { confirmationStatus: 'finalized', err: null });
  r = await F.confirm(ctx, W(alice), { requestId: id(1) });
  assert.equal(r.purchase.status, 'confirmed');
  assert.equal((await F.entitlement(pool, store.scope, W(alice))).tier, 'mythic');
  assert.equal((await F.confirm(ctx, W(alice), { requestId: id(1) })).purchase.status, 'confirmed', 'confirming again is harmless');
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_founder_entitlements WHERE scope=$1', [store.scope])).rows[0].n), 1, 'one entitlement per purchase');
  ok('confirmation only for the buyer-signed exact message (tampered/forged refused); server-side broadcast; entitlement created once');

  // One Founder NFT per wallet across both tiers.
  await assert.rejects(F.mint(ctx, W(alice), { tier: 'mythic', requestId: id(3) }, PUBLIC), e => e.code === 'FOUNDERS_WALLET_LIMIT');
  await assert.rejects(F.mint(ctx, W(alice), { tier: 'legacy', requestId: id(4) }, PUBLIC), e => e.code === 'FOUNDERS_WALLET_LIMIT');
  r = await F.mint(ctx, W(bob), { tier: 'legacy', requestId: id(5) }, PUBLIC);
  tx = web3.Transaction.from(Buffer.from(r.purchase.wire, 'base64'));
  assert.equal(Number(web3.SystemInstruction.decodeTransfer(tx.instructions[0]).lamports), SOL / 2, 'Legacy pays exactly 0.5 SOL');
  const bobMintSig = bs58.encode(signWire(bob, r.purchase.wire).signatures[0].signature);
  accounts.set(r.purchase.mint, { owner: new web3.PublicKey(T22), lamports: 1, data: Buffer.alloc(0) });
  refs.set(r.purchase.mint, [bobMintSig]); statuses.set(bobMintSig, { confirmationStatus: 'finalized', err: null });
  await F.sweep(ctx, W(bob)); // recover the exact paid transaction without a client report
  assert.equal((await F.info(store, W(bob), PUBLIC)).founders.mine.status, 'confirmed');
  assert.equal((await F.info(store, W(bob), PUBLIC)).founders.mine.signature, bobMintSig, 'persist the verified recovered signature');
  await assert.rejects(F.mint(ctx, W(bob), { tier: 'mythic', requestId: id(6) }, PUBLIC), e => e.code === 'FOUNDERS_WALLET_LIMIT');
  await assert.rejects(F.mint(ctx, W(bob), { tier: 'legacy', requestId: id(7) }, PUBLIC), e => e.code === 'FOUNDERS_WALLET_LIMIT');
  // The database refuses a second live purchase for a wallet even if the server check were bypassed.
  await assert.rejects(pool.query("INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,created) VALUES($1,'x-direct-0000000001',$2,'mythic',29,'m-direct-1',1000000000,'pending','m','w',1,1)", [store.scope, W(bob)]), /duplicate key|unique/i);
  await assert.rejects(pool.query("INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,created) VALUES($1,'x-direct-0000000002',$2,'mythic',31,'m-direct-2',1000000000,'pending','m','w',1,1)", [store.scope, W(eve)]), /check/i);
  await assert.rejects(pool.query("INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,created) VALUES($1,'x-direct-0000000003',$2,'mythic',28,'m-direct-3',500000000,'pending','m','w',1,1)", [store.scope, W(eve)]), /check/i);
  ok('one Founder NFT per wallet across Mythic and Legacy (server and database); Legacy exactly 0.5 SOL; DB rejects serial 31 and wrong price');

  // Not enough SOL reserves nothing; an unsent reservation expires and frees its serial; pause blocks new sales.
  balances.set(W(carol), 0.4 * SOL);
  await assert.rejects(F.mint(ctx, W(carol), { tier: 'legacy', requestId: id(8) }, PUBLIC), e => e.code === 'SOL_GAS_INSUFFICIENT');
  assert.equal((await F.info(store, W(carol), PUBLIC)).founders.tiers.legacy.reserved, 0);
  balances.set(W(carol), 5 * SOL);
  r = await F.mint(ctx, W(carol), { tier: 'legacy', requestId: id(9) }, PUBLIC); assert.equal(r.purchase.serial, 2);
  // A finalized SOL transfer to the reserved mint is not the signed purchase transaction.
  const dustTx = new web3.Transaction({ feePayer: carol.publicKey, recentBlockhash: web3.Keypair.generate().publicKey.toBase58() }).add(
    web3.SystemProgram.transfer({ fromPubkey: carol.publicKey, toPubkey: new web3.PublicKey(r.purchase.mint), lamports: 890880 }));
  dustTx.sign(carol); const dustSig = bs58.encode(dustTx.signature);
  accounts.set(r.purchase.mint, { owner: new web3.PublicKey(SYS), lamports: 890880, data: Buffer.alloc(0), executable: false });
  refs.set(r.purchase.mint, [dustSig]); statuses.set(dustSig, { confirmationStatus: 'finalized', err: null });
  assert.equal((await F.confirm(ctx, W(carol), { requestId: id(9) })).purchase.status, 'pending', 'a SOL-funded system account cannot confirm a Founder purchase');
  assert.equal(await F.entitlement(pool, store.scope, W(carol)), null, 'dust funding grants no entitlement');
  height += 500; await F.sweep(ctx, W(carol));
  assert.equal(await F.entitlement(pool, store.scope, W(carol)), null, 'dust funding still grants no entitlement after expiry');
  await assert.rejects(F.mint(ctx, W(carol), { tier: 'legacy', requestId: id(9) }, PUBLIC), /expired/);
  await assert.rejects(F.activate(store, W(carol), { FOUNDERS_REWARD_REDEMPTION_ENABLED: 'on' }), e => e.code === 'FOUNDERS_NONE');
  ok('a finalized SOL transfer to the mint grants no entitlement: request stays pending, expires, and cannot activate rewards');

  // Independent scopes keep payment-evidence cases separate from the supply and reward fixtures below.
  const evidenceCases = [
    { name: 'reported finalized payment', reported: true, status: { confirmationStatus: 'finalized', err: null }, expected: 'confirmed' },
    { name: 'unreported finalized payment after expiry', history: true, expired: true, status: { confirmationStatus: 'finalized', err: null }, expected: 'confirmed' },
    { name: 'processed payment after expiry', reported: true, expired: true, status: { confirmationStatus: 'processed', err: null }, expected: 'pending' },
    { name: 'confirmed but not finalized payment', reported: true, status: { confirmationStatus: 'confirmed', err: null }, expected: 'pending' },
    { name: 'non-final transaction error', reported: true, status: { confirmationStatus: 'confirmed', err: { InstructionError: [0, 'error'] } }, expected: 'pending' },
    { name: 'failed finalized payment', history: true, status: { confirmationStatus: 'finalized', err: { InstructionError: [0, 'error'] } }, expected: 'expired' },
    { name: 'finalized status missing err', reported: true, expired: true, status: { confirmationStatus: 'finalized' }, expected: 'pending' },
    { name: 'unlanded buyer signature', reported: true, expired: true, status: null, expected: 'expired' },
    { name: 'history RPC unavailable', expired: true, historyError: true, expected: 'pending' },
    { name: 'history and status disagree', expired: true, history: true, status: null, expected: 'pending' },
    { name: 'payment behind unrelated mint transactions', history: true, paginated: true, status: { confirmationStatus: 'finalized', err: null }, expected: 'confirmed' },
    { name: 'history search limit reached', expired: true, saturated: true, expected: 'pending' },
  ];
  for (const [index, test] of evidenceCases.entries()) {
    const isolated = new Store(pool, store.scope + ':evidence-' + index, () => now);
    const isolatedCtx = { ...ctx, store: isolated };
    const purchase = (await F.mint(isolatedCtx, W(carol), { tier: 'mythic', requestId: id(9000 + index) }, PUBLIC)).purchase;
    const row = (await pool.query('SELECT * FROM ryo_founder_purchases WHERE scope=$1 AND request_id=$2', [isolated.scope, purchase.requestId])).rows[0];
    const signature = bs58.encode(signWire(carol, purchase.wire).signatures[0].signature);
    const noise = Array.from({ length: 100 }, () => ({ signature: bs58.encode(crypto.randomBytes(64)) }));
    let searches = 0;
    isolatedCtx.connection = { ...connection,
      async getAccountInfo() { assert.fail('mint account existence must never be consulted for settlement'); },
      async getBlockHeight(commitment) { assert.equal(commitment, 'finalized'); return Number(row.last_height) + (test.expired ? 1 : -1); },
      async getSignatureStatuses(sigs, options) {
        assert.deepEqual(sigs, [signature]); assert.equal(options.searchTransactionHistory, true);
        return { value: [test.status || null] };
      },
      async getSignaturesForAddress(key, options, commitment) {
        searches++; assert.equal(key.toBase58(), row.mint); assert.equal(commitment, 'finalized'); assert.equal(options.limit, 100);
        if (test.historyError) throw Error('RPC unavailable');
        if (test.saturated) return noise.map((entry, n) => ({ signature: searches + '-' + n + '-' + entry.signature }));
        if (test.paginated && searches === 1) return noise;
        if (test.paginated) assert.equal(options.before, noise[99].signature);
        return test.history ? [{ signature: dustSig }, { signature }] : [{ signature: dustSig }];
      },
    };
    assert.equal(await F.settle(isolatedCtx, row, test.reported ? signature : null), test.expected, test.name);
    const fresh = (await pool.query('SELECT * FROM ryo_founder_purchases WHERE scope=$1 AND request_id=$2', [isolated.scope, row.request_id])).rows[0];
    assert.equal(fresh.status, test.expected, test.name + ': database status');
    assert.equal(!!await F.entitlement(pool, isolated.scope, W(carol)), test.expected === 'confirmed', test.name + ': entitlement');
    if (test.expected === 'confirmed') {
      assert.equal(fresh.signature, signature, test.name + ': verified signature persisted');
      await F.confirm(isolatedCtx, W(carol), { requestId: row.request_id });
      assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_founder_entitlements WHERE scope=$1', [isolated.scope])).rows[0].n), 1);
    }
    if (test.paginated) assert.equal(searches, 2);
    if (test.saturated) assert.equal(searches, 10);
  }
  ok('settlement evidence: exact successful finalized signatures only; recover and persist unreported payments; reject failed/malformed/non-final evidence; RPC uncertainty stays pending; paginated history and bounded search');
  await fixture.budget(store); // creates the admin control row
  await pool.query("UPDATE ryo_admin_control SET pauses=COALESCE(pauses,'{}'::jsonb)||'{\"founders\":true}'::jsonb WHERE scope=$1", [store.scope]);
  await assert.rejects(F.mint(ctx, W(carol), { tier: 'legacy', requestId: id(10) }, PUBLIC), e => e.code === 'FOUNDERS_PAUSED');
  await pool.query("UPDATE ryo_admin_control SET pauses=pauses-'founders' WHERE scope=$1", [store.scope]);
  // An abandoned reservation by one wallet is reclaimed by the next buyer once its blockhash can no longer land.
  const [w76, w77] = [wallets[76], wallets[77]];
  r = await F.mint(ctx, W(w76), { tier: 'legacy', requestId: id(11) }, PUBLIC); const abandoned = r.purchase.serial;
  height += 500;
  r = await F.mint(ctx, W(w77), { tier: 'legacy', requestId: id(12) }, PUBLIC);
  assert.equal(r.purchase.serial, abandoned, 'another buyer reclaims an abandoned reservation');
  assert.equal((await pool.query('SELECT status FROM ryo_founder_purchases WHERE scope=$1 AND request_id=$2', [store.scope, id(11)])).rows[0].status, 'expired');
  ok('no reservation without enough SOL; expired reservations free the serial (also when another buyer arrives); admin pause blocks sales');

  // Supply under parallel demand: 30 per tier, 60 in total, serials 1..30 unique.
  const rush = async (tier, list, base) => Promise.allSettled(list.map((k, i) => F.mint(ctx, W(k), { tier, requestId: id(base + i) }, PUBLIC)));
  const legacyRush = await rush('legacy', wallets.slice(2, 37), 1000);
  const mythicRush = await rush('mythic', wallets.slice(37, 72), 2000);
  const won = list => list.filter(x => x.status === 'fulfilled').length, soldOut = list => list.filter(x => x.status === 'rejected' && x.reason.code === 'FOUNDERS_SOLD_OUT').length;
  assert.equal(won(legacyRush), 28, 'Bob holds Legacy #1 and another buyer one reservation: 28 more'); assert.equal(soldOut(legacyRush), 7);
  assert.equal(won(mythicRush), 29, 'Alice holds Mythic #1: 29 more'); assert.equal(soldOut(mythicRush), 6);
  const live = (await pool.query("SELECT tier,COUNT(*) AS n,COUNT(DISTINCT serial) AS s,MAX(serial) AS m FROM ryo_founder_purchases WHERE scope=$1 AND status IN ('pending','confirmed') GROUP BY tier ORDER BY tier", [store.scope])).rows;
  assert.deepEqual(live.map(x => [x.tier, Number(x.n), Number(x.s), Number(x.m)]), [['legacy', 30, 30, 30], ['mythic', 30, 30, 30]]);
  const all = (await F.info(store, null, PUBLIC)).founders.tiers;
  assert.deepEqual([all.mythic.remaining, all.legacy.remaining, all.mythic.soldOut, all.legacy.soldOut], [0, 0, true, true]);
  await assert.rejects(F.mint(ctx, W(wallets[75]), { tier: 'mythic', requestId: id(3000) }, PUBLIC), e => e.code === 'FOUNDERS_SOLD_OUT');
  ok('parallel demand never oversells: exactly 30 Mythic + 30 Legacy (60 total), unique serials 1..30');

  // Metadata and the mint authority.
  const md = F.metadata('https://example.invalid', 'legacy', 7), text = JSON.stringify(md);
  assert.equal(md.name, 'Shinobi Bombers Founder Legacy #7'); assert(!wallets.some(k => text.includes(W(k))) && !text.includes(revenue), 'no wallet data in public metadata');
  assert.match(md.description, /not transferred with this NFT/); assert.match(md.description, /Not an investment/);
  assert.throws(() => F.mintAuthority({ FOUNDERS_MINT_AUTHORITY_SECRET: JSON.stringify([...authority.secretKey]), RYO_TREASURY_SECRET: JSON.stringify([...authority.secretKey]) }), /dedicated key/);
  assert.throws(() => F.mintAuthority({ FOUNDERS_MINT_AUTHORITY_SECRET: 'not json' }), e => e.code === 'FOUNDERS_NOT_CONFIGURED');
  ok('public metadata carries no account data and states buyer-bound, non-investment terms; the mint authority must be a dedicated key');

  /* ---------- Entitlements: activation, buyer-bound ---------- */
  const OFF = {}, ON = { FOUNDERS_REWARD_REDEMPTION_ENABLED: 'on' };
  await assert.rejects(F.activate(store, W(alice), OFF), e => e.code === 'FOUNDERS_REDEMPTION_CLOSED');
  await assert.rejects(F.activate(store, W(eve), ON), e => e.code === 'FOUNDERS_NONE');
  const before = (await store.profile(W(alice))).heroes.length;
  const act = await F.activate(store, W(alice), ON);
  assert.deepEqual(act.heroes.map(h => h.rank), [5, 4, 3], 'Mythic: Tsukiyomi + Legend + Elite');
  let p = await store.profile(W(alice));
  const tsuki = p.heroes.find(h => h.founderBound);
  assert.deepEqual([tsuki.name, tsuki.rank, tsuki.mythic, tsuki.nft], ['Tsukiyomi', 5, 'tsukiyomi', undefined]);
  assert.equal(p.heroes.length, before + 3); assert.equal(p.sensei, true); assert.equal(p.senseiSource, 'founder-mythic'); assert.equal(p.founderTier, 'mythic');
  assert.equal((await F.entitlement(pool, store.scope, W(alice))).limited_passes, 10);
  await assert.rejects(F.activate(store, W(alice), ON), e => e.code === 'FOUNDERS_ACTIVE');
  assert.equal((await store.profile(W(alice))).heroes.length, before + 3, 'one-time grants are never repeated');
  const bobSensei = (await store.profile(W(bob))).sensei;
  assert.deepEqual((await F.activate(store, W(bob), ON)).heroes.map(h => h.rank), [4, 3], 'Legacy: Legend + Elite, no Tsukiyomi');
  assert.equal((await store.profile(W(bob))).sensei, bobSensei, 'Legacy gets no free permanent Sensei');
  // Buyer-bound: the mythic-hero NFT sync never removes the Founder Tsukiyomi; a new NFT holder gets nothing.
  await mythic.apply(store, W(alice), []);
  assert((await store.profile(W(alice))).heroes.some(h => h.founderBound), 'Founder Tsukiyomi stays with the buyer');
  assert.equal((await F.status(store, W(eve), ON)).founder, null, 'a later NFT holder has no Founder entitlement');
  const salvageCopy = structuredClone(await store.profile(W(alice)));
  assert.throws(() => upgrades.salvageProfile(salvageCopy, tsuki.tokenId, now), /cannot be salvaged/);
  ok('activation grants once (Mythic: Tsukiyomi+Legend+Elite+permanent Sensei+10 passes; Legacy: Legend+Elite+10 passes); benefits stay with the buyer; Founder Tsukiyomi cannot be salvaged');

  /* ---------- Summon pools ---------- */
  const tally = pool_ => { const n = {}; for (let roll = 0; roll < 10000; roll++) { const k = F.rankFor(pool_, roll); n[k] = (n[k] || 0) + 1; } return n; };
  assert.deepEqual(tally(F.LIMITED_POOL), { 1: 6250, 2: 2500, 3: 1000, 4: 250 }, 'Limited: Chunin 62.5 / Jonin 25 / Elite 10 / Legend 2.5');
  assert.deepEqual(tally(F.PREMIUM_POOL), { 3: 7000, 4: 3000 }, 'Premium: Elite 70 / Legend 30');
  assert(!F.LIMITED_POOL.some(([rank]) => rank === 0 || rank === 5), 'Genin and Mythic are not in the Limited pool');
  assert.throws(() => F.rankFor(F.LIMITED_POOL, 10000)); assert.throws(() => F.rankFor(F.LIMITED_POOL, -1));
  await assert.rejects(pool.query("INSERT INTO ryo_founder_summons(scope,wallet,request_id,kind,rank,roll,hero,created) VALUES($1,'w','r-genin','limited',0,0,'{}',1)", [store.scope]), /check/i);
  await assert.rejects(pool.query("INSERT INTO ryo_founder_summons(scope,wallet,request_id,kind,rank,roll,hero,created) VALUES($1,'w','r-mythic','limited',5,0,'{}',1)", [store.scope]), /check/i);
  await assert.rejects(pool.query("INSERT INTO ryo_founder_summons(scope,wallet,request_id,kind,period,rank,roll,hero,created) VALUES($1,'w','r-premium-chunin','premium',1,1,0,'{}',1)", [store.scope]), /check/i);
  ok('exact pools over every roll: Limited 6250/2500/1000/250 with zero Genin and zero Mythic; Premium 7000/3000; the database refuses rank 0/5');

  // Ten passes, twelve parallel attempts: exactly ten heroes, balance never negative; replays return the same hero.
  const heroesBefore = (await store.profile(W(alice))).heroes.length;
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => F.summon(store, W(alice), { kind: 'limited', requestId: 'limited-req-' + String(i).padStart(6, '0') }, ON)));
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 10); assert(attempts.filter(x => x.status === 'rejected').every(x => x.reason.code === 'NO_PASSES'));
  assert.equal((await F.entitlement(pool, store.scope, W(alice))).limited_passes, 0);
  p = await store.profile(W(alice)); assert.equal(p.heroes.length, heroesBefore + 10);
  assert(p.heroes.filter(h => h.founderSummon === 'limited').every(h => h.rank >= 1 && h.rank <= 4));
  const first = attempts.find(x => x.status === 'fulfilled').value.summon;
  const again = await F.summon(store, W(alice), { kind: 'limited', requestId: 'limited-req-000000' }, ON);
  assert.equal(again.summon.replay, true); assert.equal((await store.profile(W(alice))).heroes.length, heroesBefore + 10, 'replay grants nothing more');
  void first;
  // A full collection uses no pass.
  const bp = await store.profile(W(bob)); bp.heroes = [...bp.heroes, ...Array.from({ length: 500 - bp.heroes.length }, () => economy.hero(0))];
  await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, W(bob), JSON.stringify(bp)]);
  await assert.rejects(F.summon(store, W(bob), { kind: 'limited', requestId: 'limited-full-000001' }, ON), e => e.code === 'HERO_LIMIT');
  assert.equal((await F.entitlement(pool, store.scope, W(bob))).limited_passes, 10, 'no pass deducted when fulfilment fails');
  bp.heroes = bp.heroes.slice(0, 10); await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, W(bob), JSON.stringify(bp)]);
  // Injected roll: the hero rank follows the filtered pool.
  assert.equal((await F.summon(store, W(bob), { kind: 'limited', requestId: 'limited-roll-000001' }, ON, () => 9999)).summon.rank, 4);
  assert.equal((await F.summon(store, W(bob), { kind: 'limited', requestId: 'limited-roll-000002' }, ON, () => 0)).summon.rank, 1);
  ok('exactly 10 Limited passes under parallel use (never negative), idempotent retries, full collection deducts nothing');

  /* ---------- Premium Hero Summon: completed qualifying weeks ---------- */
  const actAt = Number((await F.entitlement(pool, store.scope, W(alice))).activated);
  const firstWeek = F.weekStart(actAt) === actAt ? actAt : F.weekStart(actAt) + WEEK; // activation week is partial: not counted
  const play = async t => { now = t; await F.recordActivity(store, W(alice)); };
  process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED = 'on';
  await play(actAt + HOUR); // partial activation week
  await assert.rejects(F.summon(store, W(alice), { kind: 'premium', requestId: 'premium-req-000001' }, ON), e => e.code === 'PREMIUM_LOCKED');
  await play(firstWeek + DAY); await play(firstWeek + WEEK + DAY);
  now = firstWeek + 2 * WEEK - 1; await assert.rejects(F.summon(store, W(alice), { kind: 'premium', requestId: 'premium-req-000001' }, ON), e => e.code === 'PREMIUM_LOCKED', 'week 2 not completed yet');
  now = firstWeek + 2 * WEEK;
  const prem = await F.summon(store, W(alice), { kind: 'premium', requestId: 'premium-req-000001' }, ON);
  assert(prem.summon.rank === 3 || prem.summon.rank === 4); assert.equal(prem.summon.period, 1);
  await assert.rejects(F.summon(store, W(alice), { kind: 'premium', requestId: 'premium-req-000002' }, ON), e => e.code === 'PREMIUM_LOCKED', 'one per period');
  await play(firstWeek + 3 * WEEK + DAY); // week 3 missed (no play in week 3 index 2), week 4 played
  now = firstWeek + 4 * WEEK; await assert.rejects(F.summon(store, W(alice), { kind: 'premium', requestId: 'premium-req-000002' }, ON), e => e.code === 'PREMIUM_LOCKED', 'missed weeks are not made up');
  await play(firstWeek + 4 * WEEK + DAY); now = firstWeek + 5 * WEEK;
  assert.equal((await F.summon(store, W(alice), { kind: 'premium', requestId: 'premium-req-000002' }, ON)).summon.period, 2);
  assert.equal((await F.status(store, W(alice), ON)).founder.premium.claimed, 2);
  // Legacy needs 4 completed qualifying weeks.
  const bobAct = Number((await F.entitlement(pool, store.scope, W(bob))).activated), bobWeek = F.weekStart(bobAct) === bobAct ? bobAct : F.weekStart(bobAct) + WEEK;
  for (let w = 0; w < 3; w++) { now = bobWeek + w * WEEK + DAY; await F.recordActivity(store, W(bob)); }
  now = bobWeek + 4 * WEEK; await assert.rejects(F.summon(store, W(bob), { kind: 'premium', requestId: 'premium-bob-000001' }, ON), e => e.code === 'PREMIUM_LOCKED');
  now = bobWeek + 3 * WEEK + DAY; await F.recordActivity(store, W(bob)); now = bobWeek + 4 * WEEK;
  assert.equal((await F.summon(store, W(bob), { kind: 'premium', requestId: 'premium-bob-000001' }, ON, () => 6999)).summon.rank, 3);
  await assert.rejects(pool.query("INSERT INTO ryo_founder_summons(scope,wallet,request_id,kind,period,rank,roll,hero,created) VALUES($1,$2,'premium-dup-000001','premium',1,4,0,'{}',1)", [store.scope, W(bob)]), /duplicate key|unique/i);
  ok('Premium summon: 1 per 2 (Mythic) / 4 (Legacy) completed qualifying weeks; partial, incomplete and missed weeks never count; one per period (DB unique)');

  /* ---------- Discounts ---------- */
  p = await store.profile(W(alice));
  const q = (prof, product, params = { quantity: 1 }) => economy.quote({ ...prof }, product, params);
  assert.equal(q({ ...p, mythicPerk: false }, 'summon').total, 22500); assert.match(q({ ...p, mythicPerk: false }, 'summon').title, /Founder Mythic −10%/);
  const legacyP = { ...(await store.profile(W(bob))), mythicPerk: false };
  assert.equal(q(legacyP, 'summon').total, 23750); assert.match(q(legacyP, 'summon').title, /Founder Legacy −5%/);
  assert.equal(q({ ...legacyP, mythicPerk: true }, 'summon').total, 22500, 'discounts never stack; the larger applies');
  assert.equal(q({ ...legacyP, founderTier: undefined }, 'summon').total, 25000);
  assert.equal(q(legacyP, 'hunt').total, 10000, 'Boss Hunt entry is not discounted');
  delete process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED; assert.equal(q(legacyP, 'summon').total, 25000, 'redemption closed: no discount');
  process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED = 'on';
  ok('discounts: Mythic 10% / Legacy 5% on approved services only, never stacked, closed with redemption');

  /* ---------- SOL Sensei (devnet) ---------- */
  const SOLS = { ...ON, SENSEI_SOL_ENABLED: 'on' };
  await assert.rejects(F.senseiBuy(ctx, W(dave), { requestId: 'sensei-req-000001' }, ON), e => e.code === 'SENSEI_SOL_CLOSED');
  let s = await F.senseiBuy(ctx, W(dave), { requestId: 'sensei-req-000001' }, SOLS);
  assert.deepEqual([s.senseiPurchase.price, s.senseiPurchase.founderDiscount], [0.4, false]);
  tx = web3.Transaction.from(Buffer.from(s.senseiPurchase.wire, 'base64'));
  assert.deepEqual(tx.instructions.map(ix => ix.programId.toBase58()), [SYS, MEMO]);
  assert.deepEqual([web3.SystemInstruction.decodeTransfer(tx.instructions[0]).toPubkey.toBase58(), Number(web3.SystemInstruction.decodeTransfer(tx.instructions[0]).lamports)], [revenue, 0.4 * SOL]);
  // The game panel's review accepts exactly this payment and nothing else.
  const panel = loadPanel(); panel.review(tx, W(dave), 0.4); assert.throws(() => panel.review(tx, W(dave), 0.2), /price/); assert.throws(() => panel.review(tx, W(eve), 0.4), /not paid by your wallet/);
  // Paid but never reported: found through the reference key, then granted once.
  const daveTx = signWire(dave, s.senseiPurchase.wire), daveSig = bs58.encode(daveTx.signatures[0].signature);
  const ref = tx.instructions[0].keys[2].pubkey.toBase58(); refs.set(ref, [daveSig]); statuses.set(daveSig, { confirmationStatus: 'finalized', err: null });
  await F.sweep(ctx, W(dave));
  assert.equal((await store.profile(W(dave))).sensei, true); assert.equal((await store.profile(W(dave))).senseiSource, 'sol');
  await assert.rejects(F.senseiBuy(ctx, W(dave), { requestId: 'sensei-req-000002' }, SOLS), /already owned/);
  await assert.rejects(F.senseiBuy(ctx, W(alice), { requestId: 'sensei-req-000003' }, SOLS), /already owned/, 'Mythic Founders already have permanent Sensei');
  // Legacy: trial (once) → 0.2 SOL during the trial; 0.4 SOL after it.
  assert.equal((await F.senseiInfo(store, W(bob), SOLS)).senseiSol.price, 0.4, 'no discount before the trial starts');
  now += HOUR; const trial = await F.senseiTrial(store, W(bob), ON);
  assert.equal(trial.trial.ends, now + 7 * DAY); assert(economy.senseiActive(await store.profile(W(bob)), now + 7 * DAY - 1));
  await assert.rejects(F.senseiTrial(store, W(bob), ON), e => e.code === 'TRIAL_USED');
  await assert.rejects(F.senseiTrial(store, W(alice), ON), /Legacy/);
  s = await F.senseiBuy(ctx, W(bob), { requestId: 'sensei-req-000004' }, SOLS);
  assert.deepEqual([s.senseiPurchase.price, s.senseiPurchase.founderDiscount], [0.2, true]);
  const bobTx = signWire(bob, s.senseiPurchase.wire), bobSig = bs58.encode(bobTx.signatures[0].signature); statuses.set(bobSig, { confirmationStatus: 'finalized', err: null });
  assert.equal((await F.senseiConfirm(ctx, W(bob), { requestId: 'sensei-req-000004', signed: bobTx.serialize().toString('base64') }, SOLS)).senseiPurchase.status, 'confirmed');
  assert.equal((await store.profile(W(bob))).sensei, true);
  // Any Legacy buyer from the rush: confirm the purchase, activate, start the trial, then let it lapse.
  const cRow = (await pool.query("SELECT * FROM ryo_founder_purchases WHERE scope=$1 AND tier='legacy' AND status='pending' AND wallet<>$2 ORDER BY serial LIMIT 1", [store.scope, W(dave)])).rows[0];
  const carolLegacy = wallets.find(k => W(k) === cRow.wallet), carolMintSig = bs58.encode(signWire(carolLegacy, cRow.wire).signatures[0].signature);
  refs.set(cRow.mint, [carolMintSig]); statuses.set(carolMintSig, { confirmationStatus: 'finalized', err: null });
  await F.sweep(ctx, W(carolLegacy));
  await F.activate(store, W(carolLegacy), ON); await F.senseiTrial(store, W(carolLegacy), ON); now += 7 * DAY;
  assert.equal((await F.senseiInfo(store, W(carolLegacy), SOLS)).senseiSol.price, 0.4, 'the 50% price ends with the trial');
  // An unpaid payment expires once its blockhash can no longer land and the reference shows nothing.
  s = await F.senseiBuy(ctx, W(carolLegacy), { requestId: 'sensei-req-000005' }, SOLS); height += 500; await F.sweep(ctx, W(carolLegacy));
  assert.equal((await pool.query('SELECT status FROM ryo_sensei_sol_purchases WHERE scope=$1 AND request_id=$2', [store.scope, 'sensei-req-000005'])).rows[0].status, 'expired');
  assert.equal((await store.profile(W(carolLegacy))).sensei === true, false);
  ok('SOL Sensei: 0.4 SOL; Legacy 0.2 SOL only during the one-time 7-day trial; a paid-but-unreported payment is found by reference; unpaid ones expire; one per wallet');

  /* ---------- Revocation (admin, audited) ---------- */
  await F.adminRevoke(store, 'admin-wallet', W(bob), true, 'Chargeback investigation');
  assert.equal((await store.profile(W(bob))).founderTier, undefined); assert.equal((await F.status(store, W(bob), ON)).founder.valid, false);
  await assert.rejects(F.summon(store, W(bob), { kind: 'limited', requestId: 'limited-revoked-0001' }, ON), e => e.code === 'FOUNDERS_INACTIVE');
  await F.adminRevoke(store, 'admin-wallet', W(bob), false);
  assert.equal((await store.profile(W(bob))).founderTier, 'legacy');
  assert.equal((await pool.query("SELECT COUNT(*) AS n FROM ryo_founder_audit WHERE scope=$1 AND action IN ('revoke','restore')", [store.scope])).rows[0].n, 2);
  const overview = (await F.adminOverview(store)).founders;
  assert.equal(overview.tiers.mythic.sold + overview.tiers.mythic.reserved, 30); assert(overview.entitlements.length >= 3);
  ok('admin revoke/restore is audited and immediately removes/restores Founder benefits; overview reports supply, purchases, summons, Sensei');

  /* ---------- Live build: 12 h Founder Chest cooldown, 24 h for everyone else; Ryo Sensei removed ---------- */
  fixture.liveEconomy(); mainnet();
  const eveProfile = { ...(await store.profile(W(eve))), sensei: false, mythicPerk: false };
  assert.throws(() => economy.quote({ ...eveProfile }, 'sensei'), e => e.status === 410 && /SOL/.test(e.message));
  assert.throws(() => economy.quote({ ...eveProfile }, 'sensei-rental'), e => e.status === 410);
  devnet(); assert.equal(economy.quote({ ...eveProfile }, 'sensei').total, 1512500, 'beta keeps Ryo Sensei'); mainnet();
  const chest = async (wallet, ryo) => { await A.adventure(store, wallet, { active: false }, 0); const row = (await pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0].data; row.pending = ryo * 1000; row.last = now; await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(row)]); };
  const claim = wallet => A.adventure(store, wallet, { active: false, claim: true }, 1e9);
  await fixture.topUp(store, 100000); await fixture.budget(store, { dailyCapRyo: 100000, perClaimMaxRyo: 5, evidence: 'Isolated Founder cooldown test' });
  const regular = eve, mythicF = alice, legacyF = bob;
  for (const w of [regular, mythicF, legacyF]) await chest(W(w), 100);
  const t0 = now;
  for (const w of [regular, mythicF, legacyF]) assert.equal((await claim(W(w))).credited, 5, 'same per-claim maximum for everyone');
  assert.deepEqual(await T.claimInfo(store, pool, W(regular)), { nextClaimAt: t0 + DAY, claimCooldownMs: DAY, founderCooldown: false });
  assert.deepEqual(await T.claimInfo(store, pool, W(mythicF)), { nextClaimAt: t0 + 12 * HOUR, claimCooldownMs: 12 * HOUR, founderCooldown: true });
  assert.deepEqual(await T.claimInfo(store, pool, W(legacyF)), { nextClaimAt: t0 + 12 * HOUR, claimCooldownMs: 12 * HOUR, founderCooldown: true });
  now = t0 + 12 * HOUR - 1;
  for (const w of [regular, mythicF, legacyF]) await assert.rejects(claim(W(w)), e => e.status === 429);
  await assert.rejects(claim(W(mythicF)), /once every 12 hours/);
  now = t0 + 12 * HOUR;
  // Parallel claims: the Founder is credited once; the second request is refused by the cooldown.
  const both = await Promise.allSettled([claim(W(mythicF)), claim(W(mythicF))]);
  assert.equal(both.filter(x => x.status === 'fulfilled').length, 1); assert.equal(both.find(x => x.status === 'rejected').reason.status, 429);
  assert.equal((await claim(W(legacyF))).credited, 5, 'Legacy Founder: 12 h');
  // Restart: a fresh Store on the same database enforces the same persisted cooldown.
  const restarted = new Store(pool, store.scope, () => now);
  await assert.rejects(A.adventure(restarted, W(mythicF), { active: false, claim: true }, 1e9), e => e.status === 429);
  await assert.rejects(claim(W(regular)), /once every 24 hours/, 'regular player still waits 24 h');
  now = t0 + DAY; assert.equal((await claim(W(regular))).credited, 5);
  // Losing eligibility: back to 24 h measured from the SAME last claim (the timestamp is never reset).
  const lastMythic = Number((await pool.query('SELECT MAX(created) AS t FROM ryo_reward_claims WHERE scope=$1 AND wallet=$2', [store.scope, W(mythicF)])).rows[0].t);
  await F.adminRevoke(store, 'admin-wallet', W(mythicF), true, 'Test revocation');
  assert.deepEqual(await T.claimInfo(store, pool, W(mythicF)), { nextClaimAt: lastMythic + DAY, claimCooldownMs: DAY, founderCooldown: false });
  await F.adminRevoke(store, 'admin-wallet', W(mythicF), false);
  // Redemption switch closed → everyone 24 h; forged client data cannot change it (only the entitlement row counts).
  delete process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED;
  assert.equal((await T.claimInfo(store, pool, W(mythicF))).claimCooldownMs, DAY);
  process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED = 'on';
  const forged = await store.profile(W(regular)); forged.founderTier = 'mythic'; await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, W(regular), JSON.stringify(forged)]);
  assert.equal((await T.claimInfo(store, pool, W(regular))).claimCooldownMs, DAY, 'a profile flag alone never grants the Founder cooldown');
  // Chest rewards are unchanged: same per-claim maximum and the same global daily budget.
  const credited = (await pool.query('SELECT wallet,amount FROM ryo_reward_claims WHERE scope=$1', [store.scope])).rows;
  assert(credited.every(x => Number(x.amount) === 5));
  ok('live Chest: regular 24 h, Mythic 12 h, Legacy 12 h; early claims refused; parallel claims credited once; persists across restart; revocation/closed redemption → 24 h from the same last claim; rewards unchanged');
  ok('live build refuses Ryo Sensei (permanent and rental); beta unchanged');

  devnet();
  console.log('PASS: Founder\'s NFT Boxes —\n  - ' + pass.join('\n  - '));
})().catch(e => { console.error(e); process.exit(1); });

function loadPanel() {
  const web3 = require(path.resolve(__dirname, '../app/node_modules/@solana/web3.js'));
  const src = fs.readFileSync(path.resolve(__dirname, '../founders/founders-game.js'), 'utf8');
  const doc = { readyState: 'complete', body: { append() {} }, createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), addEventListener() {} };
  const box = { window: {}, document: doc, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, TextDecoder, crypto: globalThis.crypto, atob, btoa, setInterval() {}, setTimeout, addEventListener() {} };
  box.window.ShinobiSolana = web3; vm.createContext(box); vm.runInContext(src.replace(/window\./g, 'window.'), box);
  return box.window.FounderPanel;
}
