/* Limited Mythic NFT Box — the initial investor offer (Solana Devnet while testing).
 * One atomic transaction per box, built here and signed by the player: the player pays 1 SOL (1.5 SOL
 * for a second box) to the revenue wallet, and a 1-of-1 Token-2022 NFT ("Mythic NFT Box #N", on-chain
 * name/symbol/uri metadata) is minted into the player's wallet with its mint authority then removed.
 * Payment and NFT land together or not at all. Supply 20, at most 2 per wallet. Holding a box NFT
 * grants Tsukiyomi (mythic-hero.cjs) and the 10% purchase discount (economy quote, profile.mythicPerk).
 * Serials are reserved while a transaction can still land and freed when its blockhash expires.
 * RETIRED (owner decision 2026-11-09): replaced by the Founder's NFT Boxes (founders/server.cjs). box-mint is refused;
 * box-info and box-confirm stay for recovery of reservations already sent, and confirmed box NFTs keep granting
 * Tsukiyomi and the 10% discount exactly as before. */
'use strict';
const crypto = require('node:crypto');
const LAMPORTS = 1000000000, MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_mythic_boxes(
 scope TEXT NOT NULL, request_id TEXT NOT NULL, wallet TEXT NOT NULL, serial INTEGER NOT NULL, mint TEXT NOT NULL,
 price_lamports BIGINT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','confirmed','expired')),
 message TEXT NOT NULL, wire TEXT NOT NULL, last_height BIGINT NOT NULL, signature TEXT, created BIGINT NOT NULL, settled BIGINT,
 PRIMARY KEY(scope,request_id));
CREATE UNIQUE INDEX IF NOT EXISTS ryo_mythic_box_serial ON ryo_mythic_boxes(scope,serial) WHERE status IN ('pending','confirmed');
CREATE INDEX IF NOT EXISTS ryo_mythic_box_wallet ON ryo_mythic_boxes(scope,wallet,status);
CREATE TABLE IF NOT EXISTS ryo_mythic_box_lock(scope TEXT PRIMARY KEY);`;
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const web3 = () => require('@solana/web3.js'), spl = () => require('@solana/spl-token'), meta = () => require('@solana/spl-token-metadata');
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
function config(env = process.env) {
  return { supply: Math.floor(num(env.MYTHIC_BOX_SUPPLY, 20)), first: Math.round(num(env.MYTHIC_BOX_PRICE_SOL, 1) * LAMPORTS),
    second: Math.round(num(env.MYTHIC_BOX_SECOND_SOL, 1.5) * LAMPORTS), perWallet: Math.floor(num(env.MYTHIC_BOX_MAX_PER_WALLET, 2)) };
}
const PERKS = ['Mythic hero: Tsukiyomi', 'Mythic Aura', '10% off Summon, Fusion, Dojo, Sensei and Training (not Market trades or the Boss Hunt entry)', 'Exclusive NFT holder tier'];
const sol = lamports => Number(lamports) / LAMPORTS;
const priceFor = (cfg, owned) => owned === 0 ? cfg.first : cfg.second;
const metadataUri = (origin, serial) => String(origin || '').replace(/\/$/, '') + '/play/assets/mythic-box/metadata/box-' + serial + '.json';

// The full box transaction (player = fee payer). Returns the partly signed transaction.
async function build({ connection, treasury, revenueAddress, origin }, wallet, serial, price, requestId, mintKeypair) {
  const { PublicKey, SystemProgram, Transaction, TransactionInstruction } = web3(), T = spl(), M = meta();
  const player = new PublicKey(wallet), mint = mintKeypair.publicKey, program = T.TOKEN_2022_PROGRAM_ID;
  const fields = { mint, name: 'Mythic NFT Box #' + serial, symbol: 'SBBOX', uri: metadataUri(origin, serial), additionalMetadata: [], updateAuthority: treasury.publicKey };
  const mintLen = T.getMintLen([T.ExtensionType.MetadataPointer]), metaLen = T.TYPE_SIZE + T.LENGTH_SIZE + M.pack(fields).length;
  const rent = await connection.getMinimumBalanceForRentExemption(mintLen + metaLen, 'finalized');
  const ata = T.getAssociatedTokenAddressSync(mint, player, false, program);
  const block = await connection.getLatestBlockhash('finalized');
  const tx = new Transaction({ feePayer: player, blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: player, toPubkey: new PublicKey(revenueAddress), lamports: price }),
    SystemProgram.createAccount({ fromPubkey: player, newAccountPubkey: mint, space: mintLen, lamports: rent, programId: program }),
    T.createInitializeMetadataPointerInstruction(mint, treasury.publicKey, mint, program),
    T.createInitializeMintInstruction(mint, 0, treasury.publicKey, null, program),
    M.createInitializeInstruction({ programId: program, metadata: mint, updateAuthority: treasury.publicKey, mint, mintAuthority: treasury.publicKey, name: fields.name, symbol: fields.symbol, uri: fields.uri }),
    T.createAssociatedTokenAccountIdempotentInstruction(player, ata, player, mint, program),
    T.createMintToInstruction(mint, ata, treasury.publicKey, 1, [], program),
    T.createSetAuthorityInstruction(mint, treasury.publicKey, T.AuthorityType.MintTokens, null, [], program),
    new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [], data: Buffer.from('shinobi-box-v1:' + requestId) }));
  // The player's wallet must hold the price, the NFT rent and the fee (checked before anything is reserved).
  await require('./gas-safety.cjs').assertGas(connection, web3(), tx, { label: 'Your wallet', commitment: 'finalized' });
  tx.partialSign(treasury, mintKeypair);
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: true });
  if (wire.length > 1232) fail('The box transaction is too large.', 503);
  return { tx, wire: wire.toString('base64'), message: tx.serializeMessage().toString('base64'), lastHeight: block.lastValidBlockHeight, ata: ata.toBase58() };
}

const pub = row => row && { requestId: row.request_id, serial: row.serial, mint: row.mint, status: row.status, price: sol(row.price_lamports), signature: row.signature || null };
async function counts(db, scope, wallet) {
  const rows = (await db.query("SELECT wallet,status,COUNT(*) AS n FROM ryo_mythic_boxes WHERE scope=$1 AND status IN ('pending','confirmed') GROUP BY wallet,status", [scope])).rows;
  const sum = f => rows.filter(f).reduce((n, r) => n + Number(r.n), 0);
  return { sold: sum(r => r.status === 'confirmed'), pending: sum(r => r.status === 'pending'), mine: sum(r => r.wallet === wallet) };
}
async function info(store, wallet, env = process.env) {
  const cfg = config(env), c = await counts(store.pool, store.scope, wallet);
  const mine = (await store.pool.query("SELECT * FROM ryo_mythic_boxes WHERE scope=$1 AND wallet=$2 AND status IN ('pending','confirmed') ORDER BY serial", [store.scope, wallet])).rows.map(pub);
  const remaining = Math.max(0, cfg.supply - c.sold - c.pending);
  return { box: { network: 'solana-devnet', supply: cfg.supply, sold: c.sold, reserved: c.pending, remaining, perWallet: cfg.perWallet, owned: c.mine,
    price: c.mine < cfg.perWallet ? sol(priceFor(cfg, c.mine)) : null, firstPrice: sol(cfg.first), secondPrice: sol(cfg.second), perks: PERKS, mine,
    soldOut: true, retired: true, replacedBy: 'founders', limitReached: c.mine >= cfg.perWallet } };
}

// Reserve a serial and return the transaction for the player's wallet to sign.
async function mint(ctx, wallet, body, env = process.env) {
  const { store } = ctx, cfg = config(env), requestId = body?.requestId;
  if (typeof requestId !== 'string' || !/^[-a-zA-Z0-9_]{16,80}$/.test(requestId)) fail('Invalid request ID.');
  await sweep(ctx, wallet);
  const existing = (await store.pool.query('SELECT * FROM ryo_mythic_boxes WHERE scope=$1 AND request_id=$2', [store.scope, requestId])).rows[0];
  if (existing) { if (existing.wallet !== wallet) fail('Invalid request ID.'); if (existing.status === 'expired') fail('That box reservation expired. Try again.', 409); return { mint: { ...pub(existing), wire: existing.status === 'pending' ? existing.wire : null }, ...await info(store, wallet, env) }; }
  const row = await store.transaction(async c => {
    await c.query('INSERT INTO ryo_mythic_box_lock(scope) VALUES($1) ON CONFLICT DO NOTHING', [store.scope]);
    await c.query('SELECT scope FROM ryo_mythic_box_lock WHERE scope=$1 FOR UPDATE', [store.scope]);
    const n = await counts(c, store.scope, wallet);
    if (n.mine >= cfg.perWallet) fail(`Each wallet can mint up to ${cfg.perWallet} Mythic Boxes.`, 409);
    if (n.sold + n.pending >= cfg.supply) fail(`All ${cfg.supply} Mythic Boxes are taken.`, 409);
    if ((await c.query("SELECT 1 FROM ryo_mythic_boxes WHERE scope=$1 AND wallet=$2 AND status='pending'", [store.scope, wallet])).rows.length) fail('Finish or wait for your pending box mint first.', 409);
    const used = new Set((await c.query("SELECT serial FROM ryo_mythic_boxes WHERE scope=$1 AND status IN ('pending','confirmed')", [store.scope])).rows.map(r => r.serial));
    let serial = 1; while (used.has(serial)) serial++;
    const price = priceFor(cfg, n.mine), mintKeypair = web3().Keypair.generate();
    const built = await build(ctx, wallet, serial, price, requestId, mintKeypair);
    return (await c.query(`INSERT INTO ryo_mythic_boxes(scope,request_id,wallet,serial,mint,price_lamports,status,message,wire,last_height,created)
      VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10) RETURNING *`, [store.scope, requestId, wallet, serial, mintKeypair.publicKey.toBase58(), price, built.message, built.wire, built.lastHeight, store.now ? store.now() : Date.now()])).rows[0];
  });
  return { mint: { ...pub(row), wire: row.wire }, ...await info(store, wallet, env) };
}

function signedBy(wallet, message, signature) {
  try {
    const bytes = Buffer.from(require('bs58').decode(signature)); if (bytes.length !== 64) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), new (web3().PublicKey)(wallet).toBuffer()]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(message, 'base64'), key, bytes);
  } catch { return false; }
}
async function findMintSignature(connection, row) {
  let before;
  for (let page = 0; page < 10; page++) {
    const list = await connection.getSignaturesForAddress(new (web3().PublicKey)(row.mint), { limit: 100, ...(before ? { before } : {}) }, 'finalized');
    const match = list.find(s => signedBy(row.wallet, row.message, s.signature));
    if (match) return match.signature;
    if (list.length < 100) return null;
    const next = list[list.length - 1].signature;
    if (!next || next === before) break;
    before = next;
  }
  throw Error('Mythic Box transaction history is incomplete. Retry settlement.');
}
// Recovery remains available for retired sales, but only the exact paid transaction proves a purchase.
async function settle({ store, connection }, row, reported) {
  const height = await connection.getBlockHeight('finalized');
  let signature = [reported, row.signature].find(s => s && signedBy(row.wallet, row.message, s)) || null;
  let status = signature ? (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0] : null;
  if (!status) {
    let recovered;
    try { recovered = await findMintSignature(connection, row); } catch { return 'pending'; }
    if (recovered) {
      signature = recovered;
      status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (!status) return 'pending';
    }
  }
  if (status?.confirmationStatus === 'finalized' && status.err === null) {
    await store.pool.query("UPDATE ryo_mythic_boxes SET status='confirmed',signature=$3,settled=$4 WHERE scope=$1 AND request_id=$2 AND status='pending'", [store.scope, row.request_id, signature, Date.now()]);
    return 'confirmed';
  }
  if (status?.confirmationStatus === 'finalized' && status.err != null) return expire(store, row);
  if (status) return 'pending';
  if (height > Number(row.last_height)) return expire(store, row);
  return 'pending';
}
async function expire(store, row) { await store.pool.query("UPDATE ryo_mythic_boxes SET status='expired',settled=$3 WHERE scope=$1 AND request_id=$2 AND status='pending'", [store.scope, row.request_id, Date.now()]); return 'expired'; }
async function sweep(ctx, wallet) {
  const rows = (await ctx.store.pool.query("SELECT * FROM ryo_mythic_boxes WHERE scope=$1 AND wallet=$2 AND status='pending'", [ctx.store.scope, wallet])).rows;
  for (const row of rows) { try { await settle(ctx, row, row.signature); } catch {} }
}
async function confirm(ctx, wallet, body, env = process.env) {
  const { store } = ctx, row = (await store.pool.query('SELECT * FROM ryo_mythic_boxes WHERE scope=$1 AND request_id=$2 AND wallet=$3', [store.scope, body?.requestId, wallet])).rows[0];
  if (!row) fail('That box mint was not found.', 404);
  const sig = typeof body.signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(body.signature) ? body.signature : null;
  if (sig && !signedBy(wallet, row.message, sig)) fail('That signature is not this box transaction.');
  if (row.status === 'pending' && sig) await store.pool.query('UPDATE ryo_mythic_boxes SET signature=$3 WHERE scope=$1 AND request_id=$2', [store.scope, row.request_id, sig]);
  const status = row.status === 'pending' ? await settle(ctx, row, sig) : row.status;
  const fresh = (await store.pool.query('SELECT * FROM ryo_mythic_boxes WHERE scope=$1 AND request_id=$2', [store.scope, row.request_id])).rows[0];
  return { mint: { ...pub(fresh), status }, ...await info(store, wallet, env) };
}
// Box NFT mints sold here count as Tsukiyomi box NFTs (alongside any configured in the env).
async function mints(store) {
  try { return (await store.pool.query("SELECT mint FROM ryo_mythic_boxes WHERE scope=$1 AND status='confirmed'", [store.scope])).rows.map(r => r.mint); } catch { return []; }
}
async function stats(store) {
  try {
    const r = (await store.pool.query("SELECT status,COUNT(*) AS n,COALESCE(SUM(price_lamports),0) AS l FROM ryo_mythic_boxes WHERE scope=$1 GROUP BY status", [store.scope])).rows;
    const of = s => r.find(x => x.status === s) || { n: 0, l: 0 }, cfg = config();
    return { minted: Number(of('confirmed').n), pending: Number(of('pending').n), supply: cfg.supply, remaining: Math.max(0, cfg.supply - Number(of('confirmed').n) - Number(of('pending').n)), sol: sol(of('confirmed').l) };
  } catch { return { minted: null, reason: 'Mythic Box table unavailable.' }; }
}
async function handle(ctx, wallet, action, body = {}) {
  if (action === 'box-info') { await sweep(ctx, wallet); return info(ctx.store, wallet); }
  if (action === 'box-mint') fail("The Limited Mythic NFT Box has been replaced by the Founder's NFT Boxes.", 410);
  if (action === 'box-confirm') return confirm(ctx, wallet, body);
  fail('Unknown Mythic Box action.', 404);
}
module.exports = { SCHEMA, PERKS, LAMPORTS, config, build, info, mint, confirm, settle, sweep, mints, stats, handle, signedBy, metadataUri };
