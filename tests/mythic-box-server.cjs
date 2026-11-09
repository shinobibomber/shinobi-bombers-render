/* Limited Mythic NFT Box on the real store (in-memory Postgres) with a fake Solana Devnet RPC: the
 * atomic transaction (exact SOL payment to revenue, Token-2022 NFT with metadata minted to the buyer,
 * mint authority removed, memo; treasury and mint signatures, player signs last, ≤1232 bytes);
 * 1 SOL then 1.5 SOL; 2 per wallet; supply; replayed request ids; confirmation only by the player's
 * signature over that exact transaction; expiry frees the serial; not enough SOL
 * reserves nothing; box holders get Tsukiyomi and 10% off summon/fusion/dojo/sensei/training only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../app/server');
const web3 = require(path.resolve(root, '../node_modules/@solana/web3.js')), bs58 = require(path.resolve(root, '../node_modules/bs58'));
const { Store } = require(path.join(root, 'store.cjs')), box = require(path.join(root, 'mythic-box.cjs')), mythic = require(path.join(root, 'mythic-hero.cjs')), economy = require(path.join(root, 'economy.cjs'));
const T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', SOL = 1e9;

(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  const store = new Store(pool, 'test-box', () => Date.now());
  const treasury = web3.Keypair.generate(), revenue = web3.Keypair.generate().publicKey.toBase58();
  const [alice, bob, carol] = [web3.Keypair.generate(), web3.Keypair.generate(), web3.Keypair.generate()];
  const balances = new Map(), statuses = new Map(), accounts = new Set(), held = new Map(), refs = new Map(); let height = 100;
  const connection = {
    async getGenesisHash() { return 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'; },
    async getMinimumBalanceForRentExemption(n) { return 890880 + n * 6960; },
    async getLatestBlockhash() { return { blockhash: web3.Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: height + 150 }; },
    async getFeeForMessage() { return { value: 15000 }; },
    async getBalance(k) { return balances.get(k.toBase58()) ?? 0; },
    async getAccountInfo(k) { return accounts.has(k.toBase58()) ? { owner: new web3.PublicKey(T22), lamports: 1, data: Buffer.alloc(0) } : null; },
    async getSignatureStatuses(sigs) { return { value: sigs.map(s => statuses.get(s) || null) }; },
    async getSignaturesForAddress(key, options, commitment) { assert.equal(commitment, 'finalized'); return (refs.get(key.toBase58()) || []).map(signature => ({ signature })); },
    async getBlockHeight() { return height; },
    async getParsedTokenAccountsByOwner(owner, { programId }) { return { value: programId.toBase58() !== T22 ? [] : (held.get(owner.toBase58()) || []).map(mint => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount: '1', decimals: 0 } } } } } })) }; },
    async getMultipleAccountsInfo(a) { return a.map(() => null); }
  };
  const ctx = { store, connection, treasury, revenueAddress: revenue, origin: 'https://example.invalid' };
  const W = k => k.publicKey.toBase58(), id = n => 'box-request-' + String(n).padStart(8, '0');
  for (const k of [alice, bob, carol]) balances.set(W(k), 5 * SOL);
  const sign = (k, wire) => { const tx = web3.Transaction.from(Buffer.from(wire, 'base64')); tx.partialSign(k); return { tx, signature: bs58.encode(tx.signature) }; };

  let info = (await box.info(store, W(alice))).box;
  assert.deepEqual([info.supply, info.remaining, info.price, info.secondPrice, info.perWallet, info.network], [20, 20, 1, 1.5, 2, 'solana-devnet']);
  assert(info.perks.some(p => /10% off/.test(p)) && info.perks.some(p => /Tsukiyomi/.test(p)));

  // Box #1: the transaction is exactly the payment + the NFT for the buyer.
  let r = await box.mint(ctx, W(alice), { requestId: id(1) });
  assert.deepEqual([r.mint.serial, r.mint.price, r.mint.status], [1, 1, 'pending']);
  const tx = web3.Transaction.from(Buffer.from(r.mint.wire, 'base64'));
  assert(tx.feePayer.equals(alice.publicKey), 'the buyer pays');
  const programs = tx.instructions.map(ix => ix.programId.toBase58());
  assert.deepEqual(programs, ['11111111111111111111111111111111', '11111111111111111111111111111111', T22, T22, T22, 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', T22, T22, 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr']);
  const pay = web3.SystemInstruction.decodeTransfer(tx.instructions[0]);
  assert.deepEqual([pay.fromPubkey.toBase58(), pay.toPubkey.toBase58(), Number(pay.lamports)], [W(alice), revenue, SOL], 'exactly 1 SOL to the revenue wallet');
  assert.equal(tx.instructions[1].keys[1].pubkey.toBase58(), r.mint.mint, 'the new NFT mint');
  assert.equal(Buffer.from(tx.instructions[8].data).toString(), 'shinobi-box-v1:' + id(1));
  assert.match(Buffer.from(tx.instructions[4].data).toString('latin1'), /Mythic NFT Box #1[\s\S]*SBBOX[\s\S]*example\.invalid\/play\/assets\/mythic-box\/metadata\/box-1\.json/);
  assert.equal(tx.instructions[7].data[0], 6, 'mint authority removed (SetAuthority) after minting 1');
  const sigs = Object.fromEntries(tx.signatures.map(s => [s.publicKey.toBase58(), !!s.signature]));
  assert.deepEqual([sigs[W(alice)], sigs[W(treasury)], sigs[r.mint.mint]], [false, true, true], 'treasury and mint signed; the buyer signs last');
  assert(Buffer.from(r.mint.wire, 'base64').length <= 1232);
  assert.equal(MythicReview(tx, W(alice), r.mint), true);
  // Replays return the same reservation; a second mint waits for the first.
  assert.equal((await box.mint(ctx, W(alice), { requestId: id(1) })).mint.mint, r.mint.mint);
  await assert.rejects(box.mint(ctx, W(alice), { requestId: id(2) }), /Finish or wait/);
  await assert.rejects(box.mint(ctx, W(bob), { requestId: id(1) }), /Invalid request ID/);
  // Confirmation needs the buyer's signature over this exact transaction, finalized without error.
  const forged = bs58.encode(require('node:crypto').randomBytes(64));
  await assert.rejects(box.confirm(ctx, W(alice), { requestId: id(1), signature: forged }), /not this box transaction/);
  const { signature } = sign(alice, r.mint.wire);
  assert.equal((await box.confirm(ctx, W(alice), { requestId: id(1), signature })).mint.status, 'pending', 'not finalized yet');
  statuses.set(signature, { confirmationStatus: 'finalized', err: null });
  r = await box.confirm(ctx, W(alice), { requestId: id(1), signature });
  assert.equal(r.mint.status, 'confirmed'); assert.deepEqual(await box.mints(store), [r.mint.mint]);
  const firstMint = r.mint.mint;

  // Box #2 for the same wallet costs 1.5 SOL; recover the paid signature without a client report.
  r = await box.mint(ctx, W(alice), { requestId: id(3) });
  assert.deepEqual([r.mint.serial, r.mint.price], [2, 1.5]);
  assert.equal(Number(web3.SystemInstruction.decodeTransfer(web3.Transaction.from(Buffer.from(r.mint.wire, 'base64')).instructions[0]).lamports), 1.5 * SOL);
  const secondSig = sign(alice, r.mint.wire).signature;
  refs.set(r.mint.mint, [secondSig]); statuses.set(secondSig, { confirmationStatus: 'finalized', err: null });
  await box.sweep(ctx, W(alice));
  assert.equal((await box.confirm(ctx, W(alice), { requestId: id(3) })).mint.signature, secondSig);
  info = (await box.info(store, W(alice))).box;
  assert.deepEqual([info.owned, info.limitReached, info.price, info.remaining, info.sold], [2, true, null, 18, 2]);
  await assert.rejects(box.mint(ctx, W(alice), { requestId: id(4) }), /up to 2 Mythic Boxes/);

  // Not enough SOL: nothing is reserved.
  balances.set(W(carol), 0.5 * SOL);
  await assert.rejects(box.mint(ctx, W(carol), { requestId: id(5) }), e => e.code === 'SOL_GAS_INSUFFICIENT' && e.paymentNotSubmitted === true);
  assert.equal((await box.info(store, W(carol))).box.reserved, 0);

  // Expiry: an unsent reservation frees its serial once its blockhash can no longer land.
  r = await box.mint(ctx, W(bob), { requestId: id(6) });
  assert.equal(r.mint.serial, 3);
  // Funding the reserved address with SOL does not prove payment or minting.
  const dust = new web3.Transaction({ feePayer: bob.publicKey, recentBlockhash: web3.Keypair.generate().publicKey.toBase58() }).add(web3.SystemProgram.transfer({ fromPubkey: bob.publicKey, toPubkey: new web3.PublicKey(r.mint.mint), lamports: 890880 }));
  dust.sign(bob); const dustSig = bs58.encode(dust.signature);
  refs.set(r.mint.mint, [dustSig]); statuses.set(dustSig, { confirmationStatus: 'finalized', err: null });
  const dustCtx = { ...ctx, connection: { ...connection, async getAccountInfo() { return { owner: web3.SystemProgram.programId, data: Buffer.alloc(0), lamports: 890880 }; } } };
  assert.equal((await box.confirm(dustCtx, W(bob), { requestId: id(6) })).mint.status, 'pending');
  height += 500; await box.sweep(dustCtx, W(bob));
  assert.equal((await box.info(store, W(bob))).box.owned, 0, 'expired');
  await assert.rejects(box.mint(ctx, W(bob), { requestId: id(6) }), /expired/);
  r = await box.mint(ctx, W(bob), { requestId: id(7) });
  assert.equal(r.mint.serial, 3, 'the freed serial is reused');
  // Supply: once every box is taken, nobody else can reserve one.
  await assert.rejects(box.mint(ctx, W(carol), { requestId: id(8) }, { MYTHIC_BOX_SUPPLY: '3' }), /All 3 Mythic Boxes are taken/);

  // Holders: Tsukiyomi arrives from the box NFT and purchases cost 10% less (not the Boss Hunt entry).
  held.set(W(alice), [firstMint]);
  const sync = await mythic.sync(store, W(alice), connection, { force: true, env: {} });
  assert.deepEqual(sync.mints, [firstMint]);
  const profile = await store.profile(W(alice));
  assert.equal(profile.mythicPerk, true); assert.equal(profile.heroes.filter(h => h.rank === 5).length, 1);
  assert.equal(economy.quote({ ...profile }, 'summon', { quantity: 1 }).total, 22500);
  assert.match(economy.quote({ ...profile }, 'summon', { quantity: 1 }).title, /Mythic −10%/);
  assert.equal(economy.quote({ ...profile, dojo: 0 }, 'dojo').total, Math.round(1800000 * .9));
  assert.equal(economy.quote({ ...profile }, 'hunt').total, 10000, 'Boss Hunt entry is not discounted');
  assert.equal(economy.quote({ ...profile, mythicPerk: false }, 'summon', { quantity: 1 }).total, 25000);
  // Selling the NFT ends the perk.
  held.set(W(alice), []); await mythic.sync(store, W(alice), connection, { force: true, env: {} });
  assert.equal((await store.profile(W(alice))).mythicPerk, false);
  const stats = await box.stats(store);
  assert.deepEqual([stats.minted, stats.pending, stats.sol], [2, 1, 2.5]);
  console.log('PASS: Mythic Box: atomic 1 SOL payment + Token-2022 NFT (metadata, authority removed, memo, ≤1232 bytes, buyer signs last), 1 → 1.5 SOL, 2 per wallet, supply, replays, signature-bound confirmation, expiry frees serials, no reservation without SOL, Tsukiyomi and 10% off for holders only while they hold.');
})().catch(e => { console.error(e); process.exit(1); });

// The browser's review (mythic-box/box.js) accepts this transaction.
function MythicReview(tx, owner, mint) {
  const vm = require('node:vm'), src = fs.readFileSync(path.resolve(__dirname, '../mythic-box/box.js'), 'utf8');
  const sandbox = { window: {}, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, TextDecoder, crypto: globalThis.crypto, atob, setTimeout };
  const t22 = new web3.PublicKey(T22), ataProgram = new web3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  sandbox.window.ShinobiSolana = { ...web3, getAssociatedTokenAddressSync: (m, o, off, program) => web3.PublicKey.findProgramAddressSync([o.toBuffer(), program.toBuffer(), m.toBuffer()], ataProgram)[0] };
  vm.runInNewContext(src, sandbox);
  sandbox.window.MythicBox.review(tx, { owner, price: mint.price, mint: mint.mint });
  assert.throws(() => sandbox.window.MythicBox.review(tx, { owner, price: 2, mint: mint.mint }), /price/);
  void t22; return true;
}
