/* Founder's NFT Boxes — Mythic (33: #1-#3 early bird 0.5 SOL, then 1 SOL) and Legacy (30 at 0.5 SOL), one Founder NFT
 * per wallet across both tiers. The price is fixed by the serial reserved under the sale lock and bound into the signed
 * transaction, so the price a buyer approves is the price recorded and paid.
 *
 * Minting reuses the proven Limited Mythic Box design (mythic-box.cjs): ONE transaction, built here and signed last by
 * the buyer, pays the exact tier price to the revenue wallet AND mints a 1-of-1 Token-2022 NFT (on-chain metadata,
 * mint authority removed, memo). Payment and NFT land together or not at all. There is no public mint program: an
 * NFT can only exist if this server co-signs with the dedicated Founder mint authority, and it only co-signs inside
 * the serialized reservation below. Supply and the cross-tier wallet limit are therefore enforced at the only minting
 * point, and again by database constraints (one pending/confirmed purchase per wallet; serial unique per tier within
 * its supply; price allowed only by the serial/price rule below).
 * One NFT per wallet is not one NFT per person: a person can control several wallets.
 *
 * Benefits are bound to the ORIGINAL BUYER wallet (owner decision 2026-11-09). Selling or moving the NFT moves no
 * benefit; the new holder receives nothing. Rewards are granted only by explicit, server-authoritative actions:
 *   founder-activate      Legend + Elite hero, 10 Limited Summon Passes; Mythic also Tsukiyomi (buyer-bound) + permanent Sensei
 *   founder-summon        kind 'limited' (Chunin 62.5 / Jonin 25 / Elite 10 / Legend 2.5 — never Genin, never Mythic)
 *                         kind 'premium' (Elite 70 / Legend 30) once per 2 (Mythic) / 4 (Legacy) completed qualifying weeks
 *   founder-sensei-trial  Legacy: 7-day Sensei trial, once, started explicitly by the buyer
 *   sensei-sol-*          permanent Sensei for SOL: 0.4 SOL, or 0.2 SOL for a Legacy buyer while the trial runs
 * Chest: Founders claim once per rolling 12 h instead of 24 h (live build; treasury-rewards.cjs asks chestCooldownMs).
 *
 * Every switch fails closed (missing or unrecognised value = off):
 *   FOUNDERS_PUBLIC_SALE_ENABLED, FOUNDERS_PRIVATE_TESTING_ENABLED (RYO_PRIVATE_TEST_WALLETS only),
 *   FOUNDERS_REWARD_REDEMPTION_ENABLED, SENSEI_SOL_ENABLED; plus the admin pause ryo_admin_control.pauses.founders.
 * A Founder NFT never opens the game: game access stays with RELEASE_STAGE / PRELAUNCH_MODE.
 *
 * Copied to app/server/founders.cjs by apply-founders.cjs. */
'use strict';
const crypto = require('node:crypto');
const LAMPORTS = 1000000000, HOUR = 3600000, DAY = 86400000, WEEK = 7 * DAY;
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

// Fixed by the approved offer. Never read from the environment or a request.
const TIERS = Object.freeze({
  // Early bird (owner decision 2026-11-09): Mythic serials #1-#3 cost 0.5 SOL, #4-#33 the regular 1 SOL. A rejected or
  // expired early reservation frees its serial, which is re-offered at the early price (lowest free serial first).
  mythic: Object.freeze({ key: 'mythic', name: 'Mythic', lamports: 1000000000, supply: 33, discountBps: 1000, premiumEveryWeeks: 2,
    earlyBird: Object.freeze({ count: 3, lamports: 500000000 }),
    council: 'full', missionPass: 'full', privileges: 'full', tsukiyomi: true, sensei: 'permanent' }),
  legacy: Object.freeze({ key: 'legacy', name: 'Legacy', lamports: 500000000, supply: 30, discountBps: 500, premiumEveryWeeks: 4,
    council: 'community', missionPass: 'basic', privileges: 'selected', tsukiyomi: false, sensei: 'trial' }),
});
const TOTAL_SUPPLY = 63, LIMITED_PASSES = 10, MAX_HEROES = 500;
/** Price of one serial of a tier, in lamports. The only place the early-bird rule is decided. */
const priceFor = (t, serial) => t.earlyBird && serial >= 1 && serial <= t.earlyBird.count ? t.earlyBird.lamports : t.lamports;
const RANKS = Object.freeze(['Genin', 'Chunin', 'Jonin', 'Elite', 'Legend', 'Mythic']);
// Weighted pools out of 10,000. Excluded ranks are simply absent, so the draw happens on the filtered pool:
// nothing is ever rolled as Genin/Mythic and then replaced.
const LIMITED_POOL = Object.freeze([[1, 6250], [2, 2500], [3, 1000], [4, 250]]);
const PREMIUM_POOL = Object.freeze([[3, 7000], [4, 3000]]);
const FOUNDER_CHEST_COOLDOWN_MS = 12 * HOUR, REGULAR_CHEST_COOLDOWN_MS = 24 * HOUR;
const SENSEI_LAMPORTS = 400000000, SENSEI_LEGACY_LAMPORTS = 200000000, SENSEI_TRIAL_MS = 7 * DAY;
const DISCOUNTED = Object.freeze(['summon', 'training', 'dojo', 'sensei', 'sensei-rental', 'fusion']);

/* v2 (Mythic early bird, 33 supply). Replaces exactly the three v1 serial/price CHECKs — PostgreSQL's deterministic names
 * for the unnamed v1 constraints, verified on the live database before release — with two named rules. Any other
 * constraint is never touched. Idempotent: re-running finds nothing to drop and adds only missing constraints. Existing
 * v1 rows (Mythic 1 SOL #1-#30, Legacy 0.5 SOL #1-#30) satisfy both rules, and v1 code also stays within them. */
const MIGRATION_V2 = `DO $$ BEGIN
 -- Only touch the table when a v1 constraint is still there: a no-op re-run takes no table lock.
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ryo_founder_purchases'::regclass
   AND conname IN ('ryo_founder_purchases_serial_check', 'ryo_founder_purchases_price_lamports_check', 'ryo_founder_purchases_check')) THEN
  ALTER TABLE ryo_founder_purchases DROP CONSTRAINT IF EXISTS ryo_founder_purchases_serial_check,
   DROP CONSTRAINT IF EXISTS ryo_founder_purchases_price_lamports_check, DROP CONSTRAINT IF EXISTS ryo_founder_purchases_check;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ryo_founder_purchases'::regclass AND conname = 'ryo_founder_serial_range') THEN
  ALTER TABLE ryo_founder_purchases ADD CONSTRAINT ryo_founder_serial_range
   CHECK ((tier = 'mythic' AND serial BETWEEN 1 AND 33) OR (tier = 'legacy' AND serial BETWEEN 1 AND 30));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ryo_founder_purchases'::regclass AND conname = 'ryo_founder_price_rule') THEN
  ALTER TABLE ryo_founder_purchases ADD CONSTRAINT ryo_founder_price_rule
   CHECK ((tier = 'mythic' AND (price_lamports = 1000000000 OR (price_lamports = 500000000 AND serial BETWEEN 1 AND 3)))
     OR (tier = 'legacy' AND price_lamports = 500000000));
 END IF;
 -- Fail the build (db:init) instead of shipping code the database would contradict: if the live table carries any other
 -- CHECK (e.g. a v1 constraint under an unexpected name), stop here and the running release stays unchanged.
 -- A later version that adds a CHECK must add its name to this list.
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ryo_founder_purchases'::regclass AND contype = 'c'
   AND conname NOT IN ('ryo_founder_purchases_tier_check', 'ryo_founder_purchases_status_check', 'ryo_founder_serial_range', 'ryo_founder_price_rule')) THEN
  RAISE EXCEPTION 'Founders v2 migration: unexpected CHECK constraint on ryo_founder_purchases; review before release';
 END IF;
END $$;`;
const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_founder_purchases(
 scope TEXT NOT NULL, request_id TEXT NOT NULL, wallet TEXT NOT NULL, tier TEXT NOT NULL CHECK(tier IN ('mythic','legacy')),
 serial INTEGER NOT NULL CHECK(serial BETWEEN 1 AND 30), mint TEXT NOT NULL, price_lamports BIGINT NOT NULL CHECK(price_lamports IN (1000000000,500000000)),
 status TEXT NOT NULL CHECK(status IN ('pending','confirmed','expired')), message TEXT NOT NULL, wire TEXT NOT NULL, last_height BIGINT NOT NULL,
 signature TEXT, created BIGINT NOT NULL, settled BIGINT, PRIMARY KEY(scope,request_id),
 CHECK((tier='mythic' AND price_lamports=1000000000) OR (tier='legacy' AND price_lamports=500000000)));
CREATE UNIQUE INDEX IF NOT EXISTS ryo_founder_one_per_wallet ON ryo_founder_purchases(scope,wallet) WHERE status IN ('pending','confirmed');
CREATE UNIQUE INDEX IF NOT EXISTS ryo_founder_serial ON ryo_founder_purchases(scope,tier,serial) WHERE status IN ('pending','confirmed');
CREATE UNIQUE INDEX IF NOT EXISTS ryo_founder_mint ON ryo_founder_purchases(scope,mint);
CREATE UNIQUE INDEX IF NOT EXISTS ryo_founder_signature ON ryo_founder_purchases(scope,signature) WHERE signature IS NOT NULL;
CREATE TABLE IF NOT EXISTS ryo_founder_lock(scope TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS ryo_founder_entitlements(
 scope TEXT NOT NULL, wallet TEXT NOT NULL, tier TEXT NOT NULL CHECK(tier IN ('mythic','legacy')), request_id TEXT NOT NULL, mint TEXT NOT NULL,
 granted BIGINT NOT NULL, activated BIGINT, revoked BIGINT, revoked_reason TEXT,
 limited_passes INTEGER NOT NULL DEFAULT 0 CHECK(limited_passes BETWEEN 0 AND 10), trial_started BIGINT, trial_ends BIGINT,
 PRIMARY KEY(scope,wallet), UNIQUE(scope,request_id), UNIQUE(scope,mint));
CREATE TABLE IF NOT EXISTS ryo_founder_summons(
 scope TEXT NOT NULL, wallet TEXT NOT NULL, request_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('limited','premium')), period INTEGER,
 rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 4), roll INTEGER NOT NULL CHECK(roll BETWEEN 0 AND 9999), hero JSONB NOT NULL, created BIGINT NOT NULL,
 PRIMARY KEY(scope,wallet,request_id),
 CHECK((kind='limited' AND period IS NULL) OR (kind='premium' AND period>=1 AND rank IN (3,4))));
CREATE UNIQUE INDEX IF NOT EXISTS ryo_founder_premium_period ON ryo_founder_summons(scope,wallet,period) WHERE kind='premium';
CREATE TABLE IF NOT EXISTS ryo_founder_weeks(scope TEXT NOT NULL, wallet TEXT NOT NULL, week BIGINT NOT NULL, first_seen BIGINT NOT NULL, PRIMARY KEY(scope,wallet,week));
CREATE TABLE IF NOT EXISTS ryo_sensei_sol_purchases(
 scope TEXT NOT NULL, request_id TEXT NOT NULL, wallet TEXT NOT NULL, price_lamports BIGINT NOT NULL CHECK(price_lamports IN (400000000,200000000)),
 founder_discount BOOLEAN NOT NULL, reference TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','confirmed','expired')), message TEXT NOT NULL, wire TEXT NOT NULL,
 last_height BIGINT NOT NULL, signature TEXT, created BIGINT NOT NULL, settled BIGINT, PRIMARY KEY(scope,request_id));
CREATE UNIQUE INDEX IF NOT EXISTS ryo_sensei_sol_one_per_wallet ON ryo_sensei_sol_purchases(scope,wallet) WHERE status IN ('pending','confirmed');
CREATE UNIQUE INDEX IF NOT EXISTS ryo_sensei_sol_signature ON ryo_sensei_sol_purchases(scope,signature) WHERE signature IS NOT NULL;
CREATE TABLE IF NOT EXISTS ryo_founder_control(scope TEXT PRIMARY KEY, paused BOOLEAN NOT NULL DEFAULT FALSE, updated BIGINT NOT NULL, actor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ryo_founder_audit(id BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, detail JSONB NOT NULL DEFAULT '{}'::jsonb, created BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS ryo_founder_audit_recent ON ryo_founder_audit(scope,id);`;

const fail = (message, status = 400, code) => { throw Object.assign(Error(message), { status, ...(code ? { code } : {}) }); };
const web3 = () => require('@solana/web3.js'), spl = () => require('@solana/spl-token'), meta = () => require('@solana/spl-token-metadata');
const sol = lamports => Number(lamports) / LAMPORTS;
const nowOf = store => (store.now ? store.now() : Date.now());
const on = v => /^(1|on|true|yes)$/i.test(String(v ?? '').trim());
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const live = () => { try { return require('./network.cjs').built(__dirname).key === 'mainnet'; } catch { return false; } };

/** Fail-closed switches. Anything but an explicit on/true/yes/1 is off. */
function switches(env = process.env) {
  const testers = String(env.RYO_PRIVATE_TEST_WALLETS || '').split(/[\s,]+/).filter(Boolean);
  return { publicSale: on(env.FOUNDERS_PUBLIC_SALE_ENABLED), privateTesting: on(env.FOUNDERS_PRIVATE_TESTING_ENABLED),
    redemption: on(env.FOUNDERS_REWARD_REDEMPTION_ENABLED), senseiSol: on(env.SENSEI_SOL_ENABLED),
    testers: testers.length && testers.every(w => WALLET_RE.test(w)) ? new Set(testers) : new Set() };
}
function saleMode(env = process.env) { const s = switches(env); return s.publicSale ? 'public' : s.privateTesting ? 'private' : 'off'; }
// Paused by the Founder sales switch (Command Center owner) or by an emergency pause key "founders".
async function paused(db, scope) {
  try {
    const own = (await db.query('SELECT paused FROM ryo_founder_control WHERE scope=$1', [scope])).rows[0]?.paused === true;
    const emergency = !!(await db.query('SELECT pauses FROM ryo_admin_control WHERE scope=$1', [scope])).rows[0]?.pauses?.founders;
    return own || emergency;
  } catch { return true; } // unreadable control rows: treat as paused (fail closed)
}
function requestIdOf(v) { if (typeof v !== 'string' || !/^[-a-zA-Z0-9_]{16,80}$/.test(v)) fail('Invalid request ID.'); return v; }
function tierOf(v) { if (typeof v !== 'string' || !Object.hasOwn(TIERS, v)) fail('Choose the Mythic or Legacy Founder box.'); return TIERS[v]; }

/** Weighted rank from a uniform roll 0..9999 over an already-filtered pool. */
function rankFor(pool, roll) {
  if (!Number.isInteger(roll) || roll < 0 || roll >= 10000) fail('Invalid summon roll.', 500);
  let edge = 0;
  for (const [rank, weight] of pool) { edge += weight; if (roll < edge) return rank; }
  fail('Summon pool weights do not total 10,000.', 500);
}
/** ISO week start (Monday 00:00 UTC) of a timestamp. */
function weekStart(t) { const d = new Date(t), day = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY; }

/* ---------------- Mint authority (dedicated key; never the custody, registry or Squads wallets) ---------------- */
function mintAuthority(env = process.env) {
  const raw = env.FOUNDERS_MINT_AUTHORITY_SECRET;
  if (!raw) fail('Founder minting is not configured.', 503, 'FOUNDERS_NOT_CONFIGURED');
  let key; try { key = web3().Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))); } catch { fail('Founder minting is not configured.', 503, 'FOUNDERS_NOT_CONFIGURED'); }
  const address = key.publicKey.toBase58();
  let reserved = [];
  try { reserved = require('./treasury-registry.cjs').reservedAddresses(); } catch { if (live()) fail('Founder minting is not configured.', 503, 'FOUNDERS_NOT_CONFIGURED'); }
  try { const custody = env.RYO_TREASURY_SECRET && web3().Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.RYO_TREASURY_SECRET))).publicKey.toBase58(); if (custody) reserved.push(custody); } catch {}
  if (env.RYO_REVENUE_WALLET) reserved.push(String(env.RYO_REVENUE_WALLET));
  if (reserved.includes(address)) fail('FOUNDERS_MINT_AUTHORITY_SECRET must be a dedicated key, separate from custody, revenue and Treasury registry wallets.', 503, 'FOUNDERS_NOT_CONFIGURED');
  return key;
}
const metadataUri = (origin, tier, serial) => String(origin || '').replace(/\/$/, '') + '/founders/metadata/' + tier + '-' + serial + '.json';

/** Public NFT metadata (no account or private data). Served from /founders/metadata/. */
function metadata(origin, tier, serial) {
  const t = TIERS[tier], base = String(origin || '').replace(/\/$/, '') + '/founders/';
  return { name: 'Shinobi Bombers Founder ' + t.name + ' #' + serial, symbol: 'SBFNDR',
    description: `Shinobi Bombers Founder's ${t.name} NFT Box (${serial} of ${t.supply}). Represents the Founder's ${t.name} package under the published Founder terms (${base}terms). In-game benefits are bound to the original purchasing wallet and are not transferred with this NFT. Not an investment; no financial return is promised.`,
    image: base + 'art/' + tier + '.png', external_url: base,
    attributes: [{ trait_type: 'Collection', value: "Shinobi Bombers Founders" }, { trait_type: 'Tier', value: t.name }, { trait_type: 'Serial', value: serial + ' of ' + t.supply },
      { trait_type: 'Benefits', value: 'Bound to original buyer' }, { trait_type: 'Terms', value: base + 'terms' }],
    properties: { category: 'image', files: [{ uri: base + 'art/' + tier + '.png', type: 'image/png' }] } };
}

async function buildMint({ connection, revenueAddress, origin, authority }, wallet, tier, serial, requestId, mintKeypair, lamports) {
  const { PublicKey, SystemProgram, Transaction, TransactionInstruction } = web3(), T = spl(), M = meta(), t = TIERS[tier];
  if (lamports !== priceFor(t, serial)) fail('Founder box price mismatch.', 500);
  const player = new PublicKey(wallet), mint = mintKeypair.publicKey, program = T.TOKEN_2022_PROGRAM_ID;
  const fields = { mint, name: 'Shinobi Bombers Founder ' + t.name + ' #' + serial, symbol: 'SBFNDR', uri: metadataUri(origin, tier, serial), additionalMetadata: [], updateAuthority: authority.publicKey };
  const mintLen = T.getMintLen([T.ExtensionType.MetadataPointer]), metaLen = T.TYPE_SIZE + T.LENGTH_SIZE + M.pack(fields).length;
  const rent = await connection.getMinimumBalanceForRentExemption(mintLen + metaLen, 'finalized');
  const ata = T.getAssociatedTokenAddressSync(mint, player, false, program);
  const block = await connection.getLatestBlockhash('finalized');
  const tx = new Transaction({ feePayer: player, blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: player, toPubkey: new PublicKey(revenueAddress), lamports }),
    SystemProgram.createAccount({ fromPubkey: player, newAccountPubkey: mint, space: mintLen, lamports: rent, programId: program }),
    T.createInitializeMetadataPointerInstruction(mint, authority.publicKey, mint, program),
    T.createInitializeMintInstruction(mint, 0, authority.publicKey, null, program),
    M.createInitializeInstruction({ programId: program, metadata: mint, updateAuthority: authority.publicKey, mint, mintAuthority: authority.publicKey, name: fields.name, symbol: fields.symbol, uri: fields.uri }),
    T.createAssociatedTokenAccountIdempotentInstruction(player, ata, player, mint, program),
    T.createMintToInstruction(mint, ata, authority.publicKey, 1, [], program),
    T.createSetAuthorityInstruction(mint, authority.publicKey, T.AuthorityType.MintTokens, null, [], program),
    new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [], data: Buffer.from('shinobi-founder-v1:' + tier + ':' + requestId) }));
  await require('./gas-safety.cjs').assertGas(connection, web3(), tx, { label: 'Your wallet', commitment: 'finalized' });
  tx.partialSign(authority, mintKeypair);
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: true });
  if (wire.length > 1232) fail('The Founder box transaction is too large.', 503);
  return { wire: wire.toString('base64'), message: tx.serializeMessage().toString('base64'), lastHeight: block.lastValidBlockHeight };
}
// A plain SOL payment. A one-time read-only reference key (Solana Pay pattern) lets the server find the payment on
// chain even if the browser never reports the signature, so a paid Sensei can never silently expire.
async function buildPayment({ connection, revenueAddress }, wallet, lamports, memo, reference) {
  const { PublicKey, SystemProgram, Transaction, TransactionInstruction } = web3(), player = new PublicKey(wallet);
  const block = await connection.getLatestBlockhash('finalized');
  const pay = SystemProgram.transfer({ fromPubkey: player, toPubkey: new PublicKey(revenueAddress), lamports });
  pay.keys.push({ pubkey: new PublicKey(reference), isSigner: false, isWritable: false });
  const tx = new Transaction({ feePayer: player, blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight }).add(
    pay, new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [], data: Buffer.from(memo) }));
  await require('./gas-safety.cjs').assertGas(connection, web3(), tx, { label: 'Your wallet', commitment: 'finalized' });
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { wire: wire.toString('base64'), message: tx.serializeMessage().toString('base64'), lastHeight: block.lastValidBlockHeight };
}

/** The buyer's ed25519 signature over our exact serialized message (base58 transaction signature). */
function signedBy(wallet, message, signature) {
  try {
    const bytes = Buffer.from(require('bs58').decode(signature)); if (bytes.length !== 64) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), new (web3().PublicKey)(wallet).toBuffer()]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(message, 'base64'), key, bytes);
  } catch { return false; }
}
const sigOf = v => (typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(v) ? v : null);
/* The buyer's wallet only SIGNS; this server checks the signed message is byte-for-byte the one it built, records the
 * buyer's signature, and broadcasts through the private server-side RPC (no RPC key ever reaches the browser). */
function signedWire(row, signed) {
  if (typeof signed !== 'string' || signed.length > 2400 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signed)) fail('Invalid signed transaction.');
  let tx; try { tx = web3().Transaction.from(Buffer.from(signed, 'base64')); } catch { fail('Invalid signed transaction.'); }
  if (!tx.serializeMessage().equals(Buffer.from(row.message, 'base64'))) fail('The wallet changed the transaction. Nothing was sent.', 409);
  const mine = tx.signatures.find(s => s.publicKey.toBase58() === row.wallet)?.signature;
  if (!mine) fail('The wallet did not sign the transaction.');
  const signature = require('bs58').encode(mine);
  if (!signedBy(row.wallet, row.message, signature) || !tx.verifySignatures(true)) fail('Invalid wallet signature.');
  return { signature, raw: tx.serialize() };
}
async function broadcast(connection, raw) {
  try { await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }); return null; }
  catch (e) { return String(e?.message || 'Solana did not accept the transaction yet.').slice(0, 200); }
}

/* ---------------- Sale ---------------- */
const pubPurchase = row => row && { requestId: row.request_id, tier: row.tier, serial: row.serial, mint: row.mint, status: row.status, price: sol(row.price_lamports), signature: row.signature || null };
async function counts(db, scope) {
  const rows = (await db.query("SELECT tier,status,serial FROM ryo_founder_purchases WHERE scope=$1 AND status IN ('pending','confirmed')", [scope])).rows;
  const out = {};
  for (const t of Object.values(TIERS)) {
    const mine = rows.filter(r => r.tier === t.key), used = new Set(mine.map(r => Number(r.serial)));
    const sold = mine.filter(r => r.status === 'confirmed').length, reserved = mine.filter(r => r.status === 'pending').length;
    let next = 1; while (used.has(next)) next++;   // the serial the next buyer gets (same rule as mint())
    const remaining = Math.max(0, t.supply - sold - reserved);
    out[t.key] = { sold, reserved, remaining, priceLamports: priceFor(t, next),
      ...(t.earlyBird ? { earlyBird: { price: sol(t.earlyBird.lamports), total: t.earlyBird.count,
        left: Array.from({ length: t.supply }, (_, i) => i + 1).filter(n => !used.has(n) && priceFor(t, n) < t.lamports).length } } : {}) };
  }
  return out;
}
/** Public sale state for the pre-landing page, plus the signed-in wallet's own purchase. */
async function info(store, wallet = null, env = process.env) {
  const c = await counts(store.pool, store.scope), s = switches(env), mode = saleMode(env), isPaused = await paused(store.pool, store.scope);
  const mine = wallet ? (await store.pool.query("SELECT * FROM ryo_founder_purchases WHERE scope=$1 AND wallet=$2 AND status IN ('pending','confirmed')", [store.scope, wallet])).rows[0] : null;
  const eligible = !!wallet && !mine && !isPaused && (mode === 'public' || (mode === 'private' && s.testers.has(wallet)));
  // price: what the next buyer of this tier pays now (early bird while a #1-#3 serial is free); regularPrice: list price.
  const tiers = Object.fromEntries(Object.values(TIERS).map(t => { const { priceLamports, ...rest } = c[t.key];
    return [t.key, { key: t.key, name: t.name, price: sol(priceLamports), regularPrice: sol(t.lamports), supply: t.supply, ...rest, soldOut: rest.remaining === 0 }]; }));
  return { founders: { network: live() ? 'solana-mainnet' : 'solana-devnet', mode, paused: isPaused, perWallet: 1, totalSupply: TOTAL_SUPPLY, tiers,
    mine: pubPurchase(mine), eligible, tester: !!wallet && s.testers.has(wallet) } };
}
function assertCanMint(env, wallet) {
  const mode = saleMode(env), s = switches(env);
  if (mode === 'off') fail('Founder box sales are not open.', 403, 'FOUNDERS_CLOSED');
  if (mode === 'private' && !s.testers.has(wallet)) fail('Founder box sales are in private testing.', 403, 'FOUNDERS_PRIVATE');
}

/** Reserve a serial and return the transaction for the buyer's wallet to sign (pending until the chain says otherwise). */
async function mint(ctx, wallet, body, env = process.env) {
  const { store } = ctx, requestId = requestIdOf(body?.requestId), t = tierOf(body?.tier);
  const existing = (await store.pool.query('SELECT * FROM ryo_founder_purchases WHERE scope=$1 AND request_id=$2', [store.scope, requestId])).rows[0];
  if (existing) {
    if (existing.wallet !== wallet || existing.tier !== t.key) fail('Invalid request ID.');
    if (existing.status === 'expired') fail('That Founder box reservation expired. Try again.', 409);
    return { purchase: { ...pubPurchase(existing), wire: existing.status === 'pending' ? existing.wire : null }, ...await info(store, wallet, env) };
  }
  assertCanMint(env, wallet);
  if (await paused(store.pool, store.scope)) fail('Founder box sales are paused.', 503, 'FOUNDERS_PAUSED');
  const authority = mintAuthority(env);
  await sweep(ctx, wallet); await sweepExpired(ctx);
  const row = await store.transaction(async c => {
    await c.query('INSERT INTO ryo_founder_lock(scope) VALUES($1) ON CONFLICT DO NOTHING', [store.scope]);
    await c.query('SELECT scope FROM ryo_founder_lock WHERE scope=$1 FOR UPDATE', [store.scope]);
    const mine = (await c.query("SELECT tier,status FROM ryo_founder_purchases WHERE scope=$1 AND wallet=$2 AND status IN ('pending','confirmed')", [store.scope, wallet])).rows[0];
    if (mine?.status === 'pending') fail('Finish or wait for your pending Founder box first.', 409, 'FOUNDERS_PENDING');
    if (mine) fail('Each wallet can own one Founder box across both tiers. This wallet already bought the ' + TIERS[mine.tier].name + ' box.', 409, 'FOUNDERS_WALLET_LIMIT');
    const used = new Set((await c.query("SELECT serial FROM ryo_founder_purchases WHERE scope=$1 AND tier=$2 AND status IN ('pending','confirmed')", [store.scope, t.key])).rows.map(r => Number(r.serial)));
    let serial = 1; while (used.has(serial)) serial++;
    if (serial > t.supply) fail('All ' + t.supply + ' ' + t.name + ' Founder boxes are taken.', 409, 'FOUNDERS_SOLD_OUT');
    const mintKeypair = web3().Keypair.generate(), lamports = priceFor(t, serial);
    const built = await buildMint({ ...ctx, authority }, wallet, t.key, serial, requestId, mintKeypair, lamports);
    return (await c.query(`INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,created)
      VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10,$11) RETURNING *`, [store.scope, requestId, wallet, t.key, serial, mintKeypair.publicKey.toBase58(), lamports, built.message, built.wire, built.lastHeight, nowOf(store)])).rows[0];
  });
  return { purchase: { ...pubPurchase(row), wire: row.wire }, ...await info(store, wallet, env) };
}

// Recover an unreported buyer signature, never an account-existence proof. Other transactions can mention or fund
// the mint, so only a signature over the stored payment-and-mint message is relevant. Bound RPC work, but fail
// closed if history cannot be fully searched: an incomplete search must not expire a potentially paid purchase.
async function findMintSignature(connection, row, address = row.mint) {
  let before;
  for (let page = 0; page < 10; page++) {
    const list = await connection.getSignaturesForAddress(new (web3().PublicKey)(address), { limit: 100, ...(before ? { before } : {}) }, 'finalized');
    const match = list.find(s => signedBy(row.wallet, row.message, s.signature));
    if (match) return match.signature;
    if (list.length < 100) return null;
    const next = list[list.length - 1].signature;
    if (!next || next === before) break;
    before = next;
  }
  throw Error('Founder transaction history is incomplete. Retry settlement.');
}

/* Settle one pending purchase from finalized chain state. Confirmation is a conditional pending→confirmed update and
 * creates the buyer's entitlement in the same database transaction, so a purchase is recorded exactly once. */
async function settle({ store, connection }, row, reported) {
  // Read the expiry height before transaction evidence so crossing the expiry boundary cannot skip recovery.
  const height = await connection.getBlockHeight('finalized');
  let signature = [reported, row.signature].find(s => s && signedBy(row.wallet, row.message, s)) || null;
  let status = signature ? (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0] : null;
  if (!status) {
    let recovered;
    try { recovered = await findMintSignature(connection, row); } catch { return 'pending'; }
    if (recovered) {
      signature = recovered;
      status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (!status) return 'pending'; // RPC history/status disagreement is not evidence of non-payment.
    }
  }
  if (status?.confirmationStatus === 'finalized' && status.err === null) {
    await store.transaction(async c => {
      const done = (await c.query("UPDATE ryo_founder_purchases SET status='confirmed',signature=$3,settled=$4 WHERE scope=$1 AND request_id=$2 AND status='pending' RETURNING *", [store.scope, row.request_id, signature, nowOf(store)])).rows[0];
      if (done) await c.query('INSERT INTO ryo_founder_entitlements(scope,wallet,tier,request_id,mint,granted) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [store.scope, done.wallet, done.tier, done.request_id, done.mint, nowOf(store)]);
    });
    return 'confirmed';
  }
  if (status?.confirmationStatus === 'finalized' && status.err != null) return expire(store, 'ryo_founder_purchases', row);
  if (status) return 'pending'; // A non-final or malformed status cannot grant benefits or prove expiry.
  if (height > Number(row.last_height)) return expire(store, 'ryo_founder_purchases', row);
  return 'pending';
}
async function expire(store, table, row) {
  if (!['ryo_founder_purchases', 'ryo_sensei_sol_purchases'].includes(table)) fail('Invalid table.', 500);
  await store.pool.query(`UPDATE ${table} SET status='expired',settled=$3 WHERE scope=$1 AND request_id=$2 AND status='pending'`, [store.scope, row.request_id, nowOf(store)]);
  return 'expired';
}
async function sweep(ctx, wallet) {
  const rows = (await ctx.store.pool.query("SELECT * FROM ryo_founder_purchases WHERE scope=$1 AND wallet=$2 AND status='pending'", [ctx.store.scope, wallet])).rows;
  for (const row of rows) { try { await settle(ctx, row, row.signature); } catch {} }
  const sensei = (await ctx.store.pool.query("SELECT * FROM ryo_sensei_sol_purchases WHERE scope=$1 AND wallet=$2 AND status='pending'", [ctx.store.scope, wallet])).rows;
  for (const row of sensei) { try { await settleSensei(ctx, row, row.signature); } catch {} }
}
/* Any buyer's reservation whose blockhash can no longer land is settled (or expired) on the next purchase attempt,
 * so an abandoned reservation can hold a serial for about a minute at most, never until its wallet returns. */
async function sweepExpired(ctx, max = 60) {
  const height = await ctx.connection.getBlockHeight('finalized');
  const rows = (await ctx.store.pool.query("SELECT * FROM ryo_founder_purchases WHERE scope=$1 AND status='pending' AND last_height<$2 ORDER BY created LIMIT $3", [ctx.store.scope, height, max])).rows;
  for (const row of rows) { try { await settle(ctx, row, row.signature); } catch {} }
}
async function confirm(ctx, wallet, body, env = process.env) {
  const { store } = ctx, row = (await store.pool.query('SELECT * FROM ryo_founder_purchases WHERE scope=$1 AND request_id=$2 AND wallet=$3', [store.scope, body?.requestId, wallet])).rows[0];
  if (!row) fail('That Founder box purchase was not found.', 404);
  let sig = sigOf(body?.signature), sent = null, broadcastError = null;
  if (body?.signed !== undefined && row.status === 'pending') { sent = signedWire(row, body.signed); sig = sent.signature; }
  if (sig && !signedBy(wallet, row.message, sig)) fail('That signature is not this Founder box transaction.');
  if (row.status === 'pending' && sig) await store.pool.query("UPDATE ryo_founder_purchases SET signature=$3 WHERE scope=$1 AND request_id=$2 AND status='pending'", [store.scope, row.request_id, sig]);
  if (sent) broadcastError = await broadcast(ctx.connection, sent.raw);
  const status = row.status === 'pending' ? await settle(ctx, row, sig || row.signature) : row.status;
  const fresh = (await store.pool.query('SELECT * FROM ryo_founder_purchases WHERE scope=$1 AND request_id=$2', [store.scope, row.request_id])).rows[0];
  return { purchase: { ...pubPurchase(fresh), status, ...(broadcastError && status === 'pending' ? { broadcastError } : {}) }, ...await info(store, wallet, env) };
}

/* ---------------- Entitlements (buyer-bound) ---------------- */
async function entitlement(db, scope, wallet, { lock = false } = {}) {
  return (await db.query('SELECT * FROM ryo_founder_entitlements WHERE scope=$1 AND wallet=$2' + (lock ? ' FOR UPDATE' : ''), [scope, wallet])).rows[0] || null;
}
const valid = e => !!e && e.revoked == null;
function requireRedemption(env) { if (!switches(env).redemption) fail('Founder rewards are not open for redemption yet.', 403, 'FOUNDERS_REDEMPTION_CLOSED'); }

/** Chest claim interval for this wallet (called inside the pool-locked claim transaction on the live build). */
async function chestCooldownMs(store, c, wallet, env = process.env) {
  if (!switches(env).redemption) return REGULAR_CHEST_COOLDOWN_MS;
  return valid(await entitlement(c, store.scope, wallet)) ? FOUNDER_CHEST_COOLDOWN_MS : REGULAR_CHEST_COOLDOWN_MS;
}
/** Discount for a quote: the profile tier is written only by the server (activation/revocation). */
function discount(profile, product, env = process.env) {
  const t = TIERS[profile?.founderTier];
  if (!t || !DISCOUNTED.includes(product) || !switches(env).redemption) return { bps: 0, label: '' };
  return { bps: t.discountBps, label: 'Founder ' + t.name + ' −' + t.discountBps / 100 + '%' };
}
/** Live build: Sensei is bought with SOL only (owner decision); the Ryo products are refused. */
function assertRyoProduct(product) {
  if (live() && (product === 'sensei' || product === 'sensei-rental')) fail('Sensei is now purchased with SOL (permanent Sensei 0.4 SOL). Existing Sensei memberships are unchanged.', 410, 'SENSEI_SOL_ONLY');
}

function hero(rank) { return require('./economy.cjs').hero(rank); }
function tsukiyomi(mint) {
  return { ...hero(5), tokenId: 'founder-tsukiyomi-' + mint, name: 'Tsukiyomi', mythic: 'tsukiyomi', founderBound: true, founder: { tier: 'mythic' } };
}
const saveProfile = (c, store, wallet, profile) => c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
async function audit(c, store, actor, action, target, detail = {}) {
  await c.query('INSERT INTO ryo_founder_audit(scope,actor,action,target,detail,created) VALUES($1,$2,$3,$4,$5,$6)', [store.scope, actor, action, target, JSON.stringify(detail), nowOf(store)]);
}

/** Keeps the server-written profile.founderTier in step with the buyer's entitlement when the game loads its state
 * (non-buyers: one primary-key lookup). Never creates a profile. The game panel shows itself from this flag, so a
 * non-Founder's game makes no Founder request at all. */
async function syncProfile(store, wallet) {
  const e = await entitlement(store.pool, store.scope, wallet), want = valid(e) ? e.tier : null;
  if (!e) return;
  await store.transaction(async c => {
    const row = (await c.query('SELECT data FROM ryo_profiles WHERE scope=$1 AND wallet=$2 FOR UPDATE', [store.scope, wallet])).rows[0];
    if (!row || (row.data.founderTier ?? null) === want) return;
    const profile = row.data; if (want) profile.founderTier = want; else delete profile.founderTier;
    await saveProfile(c, store, wallet, profile);
  });
}
/** One-time grants, once per purchase, to the buyer's own signed-in account. */
async function activate(store, wallet, env = process.env) {
  requireRedemption(env);
  return store.transaction(async c => {
    await store.locked(c, wallet);
    const e = await entitlement(c, store.scope, wallet, { lock: true });
    if (!e) fail('This wallet did not buy a Founder box.', 404, 'FOUNDERS_NONE');
    if (!valid(e)) fail('This Founder entitlement is suspended. Contact support.', 403, 'FOUNDERS_REVOKED');
    if (e.activated != null) fail('Founder benefits are already activated for this wallet.', 409, 'FOUNDERS_ACTIVE');
    const t = TIERS[e.tier], profile = await store.profileLocked(c, wallet), now = nowOf(store);
    const granted = [hero(4), hero(3)];
    if (t.tsukiyomi) granted.unshift(tsukiyomi(e.mint));
    for (const h of granted) h.founderGrant = e.tier;
    if (profile.heroes.length + granted.length > MAX_HEROES) fail('Free ' + (profile.heroes.length + granted.length - MAX_HEROES) + ' hero slot(s) (500 max) before activating Founder benefits.', 409, 'HERO_LIMIT');
    profile.heroes.push(...granted);
    profile.founderTier = e.tier;
    if (t.sensei === 'permanent' && profile.sensei !== true) { profile.sensei = true; profile.senseiSince = now; profile.senseiSource = 'founder-mythic'; }
    require('./economy.cjs').normalizeProfile(profile);
    await saveProfile(c, store, wallet, profile);
    await c.query('UPDATE ryo_founder_entitlements SET activated=$3,limited_passes=$4 WHERE scope=$1 AND wallet=$2 AND activated IS NULL', [store.scope, wallet, now, LIMITED_PASSES]);
    await audit(c, store, wallet, 'activate', wallet, { tier: e.tier, heroes: granted.map(h => ({ id: h.tokenId, rank: h.rank })), passes: LIMITED_PASSES });
    return { activated: now, heroes: granted };
  });
}

async function qualifyingWeeks(db, scope, wallet, activated, now) {
  const r = (await db.query('SELECT COUNT(*) AS n FROM ryo_founder_weeks WHERE scope=$1 AND wallet=$2 AND week>=$3 AND week+$4<=$5', [scope, wallet, weekStart(activated) === activated ? activated : weekStart(activated) + WEEK, WEEK, now])).rows[0];
  return Number(r.n);
}
/** Adventure activity marks the current ISO week (counted only once that week has fully ended). Never throws.
 * Called on active Adventure polls, so a small per-wallet cache keeps it to about one query per wallet per minute. */
const activitySeen = new Map();
async function recordActivity(store, wallet) {
  try {
    if (!switches().redemption) return;
    const now = nowOf(store), week = weekStart(now), key = store.scope + ':' + wallet, seen = activitySeen.get(key);
    if (seen && (seen.week === week || (seen.none && now - seen.at < 60000))) return;
    const e = await entitlement(store.pool, store.scope, wallet);
    if (!valid(e) || e.activated == null) { activitySeen.set(key, { none: true, at: now }); return; }
    await store.pool.query('INSERT INTO ryo_founder_weeks(scope,wallet,week,first_seen) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [store.scope, wallet, week, now]);
    activitySeen.delete(key); activitySeen.set(key, { week, at: now });
    if (activitySeen.size > 5000) activitySeen.delete(activitySeen.keys().next().value);
  } catch {}
}

async function summon(store, wallet, body, env = process.env, rand = n => crypto.randomInt(n)) {
  requireRedemption(env);
  const requestId = requestIdOf(body?.requestId), kind = body?.kind;
  if (kind !== 'limited' && kind !== 'premium') fail('Choose a Limited or Premium Founder summon.');
  return store.transaction(async c => {
    await store.locked(c, wallet);
    const e = await entitlement(c, store.scope, wallet, { lock: true });
    if (!valid(e) || e.activated == null) fail('Activate your Founder benefits first.', 403, 'FOUNDERS_INACTIVE');
    const done = (await c.query('SELECT * FROM ryo_founder_summons WHERE scope=$1 AND wallet=$2 AND request_id=$3', [store.scope, wallet, requestId])).rows[0];
    if (done) { if (done.kind !== kind) fail('Invalid request ID.'); return { summon: { kind, period: done.period, rank: done.rank, rankName: RANKS[done.rank], hero: done.hero, replay: true } }; }
    let period = null, pool = LIMITED_POOL;
    if (kind === 'limited') { if (Number(e.limited_passes) < 1) fail('No Limited Hero Summon Passes left.', 409, 'NO_PASSES'); }
    else {
      pool = PREMIUM_POOL;
      const every = TIERS[e.tier].premiumEveryWeeks, weeks = await qualifyingWeeks(c, store.scope, wallet, Number(e.activated), nowOf(store));
      const claimed = Number((await c.query("SELECT COUNT(*) AS n FROM ryo_founder_summons WHERE scope=$1 AND wallet=$2 AND kind='premium'", [store.scope, wallet])).rows[0].n);
      if (Math.floor(weeks / every) <= claimed) fail('Your next Premium Hero Summon unlocks after ' + ((claimed + 1) * every - weeks) + ' more completed qualifying week(s).', 409, 'PREMIUM_LOCKED');
      period = claimed + 1;
    }
    const profile = await store.profileLocked(c, wallet);
    if (profile.heroes.length >= MAX_HEROES) fail('Your collection is full (500 heroes). Free a slot first; no pass was used.', 409, 'HERO_LIMIT');
    const roll = rand(10000), rank = rankFor(pool, roll);
    if (rank < 1 || rank > 4 || (kind === 'premium' && rank < 3)) fail('Summon pool violation.', 500);
    const h = { ...hero(rank), founderSummon: kind };
    profile.heroes.push(h); require('./economy.cjs').normalizeProfile(profile);
    await c.query('INSERT INTO ryo_founder_summons(scope,wallet,request_id,kind,period,rank,roll,hero,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [store.scope, wallet, requestId, kind, period, rank, roll, JSON.stringify(h), nowOf(store)]);
    if (kind === 'limited') {
      const left = (await c.query('UPDATE ryo_founder_entitlements SET limited_passes=limited_passes-1 WHERE scope=$1 AND wallet=$2 AND limited_passes>0 RETURNING limited_passes', [store.scope, wallet])).rows[0];
      if (!left) fail('No Limited Hero Summon Passes left.', 409, 'NO_PASSES');
    }
    await saveProfile(c, store, wallet, profile);
    return { summon: { kind, period, rank, rankName: RANKS[rank], hero: h } };
  });
}

async function senseiTrial(store, wallet, env = process.env) {
  requireRedemption(env);
  return store.transaction(async c => {
    await store.locked(c, wallet);
    const e = await entitlement(c, store.scope, wallet, { lock: true });
    if (!valid(e) || e.activated == null) fail('Activate your Founder benefits first.', 403, 'FOUNDERS_INACTIVE');
    if (e.tier !== 'legacy') fail('The Sensei trial belongs to the Legacy Founder box (Mythic includes permanent Sensei).', 409);
    if (e.trial_started != null) fail('The 7-day Sensei trial was already used.', 409, 'TRIAL_USED');
    const profile = await store.profileLocked(c, wallet), now = nowOf(store), ends = now + SENSEI_TRIAL_MS;
    if (profile.sensei !== true) { profile.senseiRentalSince = Number(profile.senseiRentalUntil || 0) > now ? profile.senseiRentalSince : now; profile.senseiRentalUntil = Math.max(now, Number(profile.senseiRentalUntil || 0)) + SENSEI_TRIAL_MS; }
    await saveProfile(c, store, wallet, profile);
    await c.query('UPDATE ryo_founder_entitlements SET trial_started=$3,trial_ends=$4 WHERE scope=$1 AND wallet=$2 AND trial_started IS NULL', [store.scope, wallet, now, ends]);
    await audit(c, store, wallet, 'sensei-trial', wallet, { ends });
    return { trial: { started: now, ends } };
  });
}

/* ---------------- Permanent Sensei for SOL ---------------- */
async function senseiPrice(db, store, wallet, env = process.env) {
  const e = switches(env).redemption ? await entitlement(db, store.scope, wallet) : null, now = nowOf(store);
  const founder = valid(e) && e.tier === 'legacy' && e.trial_ends != null && now < Number(e.trial_ends);
  return { lamports: founder ? SENSEI_LEGACY_LAMPORTS : SENSEI_LAMPORTS, founderDiscount: founder, trialEnds: founder ? Number(e.trial_ends) : null };
}
const pubSensei = row => row && { requestId: row.request_id, status: row.status, price: sol(row.price_lamports), founderDiscount: row.founder_discount, signature: row.signature || null };
async function senseiInfo(store, wallet, env = process.env) {
  const price = await senseiPrice(store.pool, store, wallet, env), profile = await store.profile(wallet);
  const mine = (await store.pool.query("SELECT * FROM ryo_sensei_sol_purchases WHERE scope=$1 AND wallet=$2 AND status IN ('pending','confirmed')", [store.scope, wallet])).rows[0];
  return { senseiSol: { enabled: switches(env).senseiSol, owned: profile?.sensei === true, regularPrice: sol(SENSEI_LAMPORTS), price: sol(price.lamports), founderDiscount: price.founderDiscount, trialEnds: price.trialEnds, purchase: pubSensei(mine) } };
}
async function senseiBuy(ctx, wallet, body, env = process.env) {
  const { store } = ctx, requestId = requestIdOf(body?.requestId);
  const existing = (await store.pool.query('SELECT * FROM ryo_sensei_sol_purchases WHERE scope=$1 AND request_id=$2', [store.scope, requestId])).rows[0];
  if (existing) {
    if (existing.wallet !== wallet) fail('Invalid request ID.');
    if (existing.status === 'expired') fail('That Sensei payment expired. Try again.', 409);
    return { senseiPurchase: { ...pubSensei(existing), wire: existing.status === 'pending' ? existing.wire : null }, ...await senseiInfo(store, wallet, env) };
  }
  if (!switches(env).senseiSol) fail('Sensei purchases with SOL are not open yet.', 403, 'SENSEI_SOL_CLOSED');
  await sweep(ctx, wallet);
  const row = await store.transaction(async c => {
    await store.locked(c, wallet);
    const profile = await store.profileLocked(c, wallet);
    if (profile.sensei === true) fail('Permanent Sensei is already owned.', 409);
    const mine = (await c.query("SELECT status FROM ryo_sensei_sol_purchases WHERE scope=$1 AND wallet=$2 AND status IN ('pending','confirmed')", [store.scope, wallet])).rows[0];
    if (mine) fail(mine.status === 'pending' ? 'Finish or wait for your pending Sensei payment first.' : 'Permanent Sensei is already owned.', 409);
    const price = await senseiPrice(c, store, wallet, env), reference = web3().Keypair.generate().publicKey.toBase58();
    const built = await buildPayment(ctx, wallet, price.lamports, 'shinobi-sensei-v1:' + requestId, reference);
    return (await c.query(`INSERT INTO ryo_sensei_sol_purchases(scope,request_id,wallet,price_lamports,founder_discount,reference,status,message,wire,last_height,created)
      VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10) RETURNING *`, [store.scope, requestId, wallet, price.lamports, price.founderDiscount, reference, built.message, built.wire, built.lastHeight, nowOf(store)])).rows[0];
  });
  return { senseiPurchase: { ...pubSensei(row), wire: row.wire }, ...await senseiInfo(store, wallet, env) };
}
// Our exact message, signed by the buyer, found through the payment's reference key (finalized only).
async function findByReference(connection, row) {
  return findMintSignature(connection, row, row.reference);
}
async function settleSensei({ store, connection }, row, reported) {
  const height = await connection.getBlockHeight('finalized');
  let signature = [reported, row.signature].find(s => s && signedBy(row.wallet, row.message, s)) || null;
  let status = signature ? (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0] : null;
  if (!status) {
    let recovered;
    try { recovered = await findByReference(connection, row); } catch { return 'pending'; }
    if (recovered) {
      signature = recovered;
      status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (!status) return 'pending';
    }
  }
  if (status?.confirmationStatus === 'finalized' && status.err === null) {
    await store.transaction(async c => {
      await store.locked(c, row.wallet);
      const done = (await c.query("UPDATE ryo_sensei_sol_purchases SET status='confirmed',signature=$3,settled=$4 WHERE scope=$1 AND request_id=$2 AND status='pending' RETURNING *", [store.scope, row.request_id, signature, nowOf(store)])).rows[0];
      if (!done) return;
      const profile = await store.profileLocked(c, row.wallet);
      if (profile.sensei !== true) { profile.sensei = true; profile.senseiSince = nowOf(store); profile.senseiSource = 'sol'; }
      await saveProfile(c, store, row.wallet, profile);
    });
    return 'confirmed';
  }
  if (status?.confirmationStatus === 'finalized' && status.err != null) return expire(store, 'ryo_sensei_sol_purchases', row);
  if (status) return 'pending';
  if (height > Number(row.last_height)) return expire(store, 'ryo_sensei_sol_purchases', row);
  return 'pending';
}
async function senseiConfirm(ctx, wallet, body, env = process.env) {
  const { store } = ctx, row = (await store.pool.query('SELECT * FROM ryo_sensei_sol_purchases WHERE scope=$1 AND request_id=$2 AND wallet=$3', [store.scope, body?.requestId, wallet])).rows[0];
  if (!row) fail('That Sensei payment was not found.', 404);
  let sig = sigOf(body?.signature), sent = null;
  if (body?.signed !== undefined && row.status === 'pending') { sent = signedWire(row, body.signed); sig = sent.signature; }
  if (sig && !signedBy(wallet, row.message, sig)) fail('That signature is not this Sensei payment.');
  if (row.status === 'pending' && sig) await store.pool.query("UPDATE ryo_sensei_sol_purchases SET signature=$3 WHERE scope=$1 AND request_id=$2 AND status='pending'", [store.scope, row.request_id, sig]);
  if (sent) await broadcast(ctx.connection, sent.raw);
  const status = row.status === 'pending' ? await settleSensei(ctx, row, sig || row.signature) : row.status;
  const fresh = (await store.pool.query('SELECT * FROM ryo_sensei_sol_purchases WHERE scope=$1 AND request_id=$2', [store.scope, row.request_id])).rows[0];
  return { senseiPurchase: { ...pubSensei(fresh), status }, ...await senseiInfo(store, wallet, env) };
}

/* ---------------- Player view ---------------- */
async function status(store, wallet, env = process.env) {
  const e = await entitlement(store.pool, store.scope, wallet), s = switches(env), now = nowOf(store);
  if (!e) return { founder: null };
  const t = TIERS[e.tier], activated = e.activated != null ? Number(e.activated) : null;
  const weeks = activated ? await qualifyingWeeks(store.pool, store.scope, wallet, activated, now) : 0;
  const claimed = Number((await store.pool.query("SELECT COUNT(*) AS n FROM ryo_founder_summons WHERE scope=$1 AND wallet=$2 AND kind='premium'", [store.scope, wallet])).rows[0].n);
  return { founder: { tier: e.tier, name: t.name, mint: e.mint, valid: valid(e), redemptionOpen: s.redemption, activated,
    limitedPasses: Number(e.limited_passes), limitedPool: LIMITED_POOL.map(([r, w]) => ({ rank: RANKS[r], percent: w / 100 })),
    premium: { everyWeeks: t.premiumEveryWeeks, qualifyingWeeks: weeks, claimed, available: Math.max(0, Math.floor(weeks / t.premiumEveryWeeks) - claimed), pool: PREMIUM_POOL.map(([r, w]) => ({ rank: RANKS[r], percent: w / 100 })) },
    chestCooldownHours: valid(e) && s.redemption ? 12 : 24, discountPercent: t.discountBps / 100, sensei: t.sensei,
    trial: e.trial_started != null ? { started: Number(e.trial_started), ends: Number(e.trial_ends) } : null,
    missionPass: { level: t.missionPass, status: 'coming with the Missions update' }, council: t.council, privileges: t.privileges,
    earlyAccess: 'eligible for future approved early access; it does not open the game today' } };
}

/** Game API actions (signed-in game session). */
async function handleGame(ctx, wallet, action, body = {}, env = process.env) {
  const { store } = ctx;
  if (action === 'founder-status') { await sweep(ctx, wallet); return { ...await status(store, wallet, env), ...await senseiInfo(store, wallet, env) }; }
  if (action === 'founder-activate') { const r = await activate(store, wallet, env); return { activation: r, ...await status(store, wallet, env) }; }
  if (action === 'founder-summon') { const r = await summon(store, wallet, body, env); return { ...r, ...await status(store, wallet, env) }; }
  if (action === 'founder-sensei-trial') { const r = await senseiTrial(store, wallet, env); return { ...r, ...await status(store, wallet, env) }; }
  if (action === 'sensei-sol-info') return senseiInfo(store, wallet, env);
  if (action === 'sensei-sol-buy') return senseiBuy(ctx, wallet, body, env);
  if (action === 'sensei-sol-confirm') return senseiConfirm(ctx, wallet, body, env);
  fail('Unknown Founder action.', 404);
}
const GAME_ACTIONS = Object.freeze(['founder-status', 'founder-activate', 'founder-summon', 'founder-sensei-trial', 'sensei-sol-info', 'sensei-sol-buy', 'sensei-sol-confirm']);

/* ---------------- Administration (read-only overview + audited pause/revoke) ---------------- */
async function adminOverview(store) {
  const q = (sql, a = []) => store.pool.query(sql, [store.scope, ...a]).then(r => r.rows);
  const [c, purchases, entitlements, summons, sensei, auditRows, repeats] = await Promise.all([
    counts(store.pool, store.scope),
    q('SELECT request_id,wallet,tier,serial,mint,price_lamports,status,signature,created,settled FROM ryo_founder_purchases WHERE scope=$1 ORDER BY created DESC LIMIT 200'),
    q('SELECT wallet,tier,mint,granted,activated,revoked,revoked_reason,limited_passes,trial_started,trial_ends FROM ryo_founder_entitlements WHERE scope=$1 ORDER BY granted DESC LIMIT 200'),
    q('SELECT wallet,kind,period,rank,created FROM ryo_founder_summons WHERE scope=$1 ORDER BY created DESC LIMIT 200'),
    q('SELECT wallet,price_lamports,founder_discount,status,created FROM ryo_sensei_sol_purchases WHERE scope=$1 ORDER BY created DESC LIMIT 200'),
    q('SELECT actor,action,target,detail,created FROM ryo_founder_audit WHERE scope=$1 ORDER BY id DESC LIMIT 100'),
    q("SELECT wallet,COUNT(*) AS n FROM ryo_founder_purchases WHERE scope=$1 AND status='expired' GROUP BY wallet HAVING COUNT(*)>=3 ORDER BY n DESC LIMIT 50")]);
  return { founders: { tiers: c, totalSupply: TOTAL_SUPPLY, mode: saleMode(), paused: await paused(store.pool, store.scope), redemption: switches().redemption, senseiSol: switches().senseiSol,
    purchases: purchases.map(r => ({ ...r, price: sol(r.price_lamports), price_lamports: undefined })), failures: purchases.filter(r => r.status === 'expired').length,
    entitlements, summons, sensei: sensei.map(r => ({ ...r, price: sol(r.price_lamports), price_lamports: undefined })), audit: auditRows, repeatedExpiries: repeats } };
}
/** Pause or resume Founder sales (owner, with a reason). Audited; reservations already sent can still settle. */
async function adminPause(store, actor, pause, reason) {
  if (typeof reason !== 'string' || reason.trim().length < 8 || reason.length > 500) fail('Enter a reason (8 to 500 characters).');
  return store.transaction(async c => {
    await c.query('INSERT INTO ryo_founder_control(scope,paused,updated,actor) VALUES($1,$2,$3,$4) ON CONFLICT(scope) DO UPDATE SET paused=EXCLUDED.paused,updated=EXCLUDED.updated,actor=EXCLUDED.actor', [store.scope, !!pause, nowOf(store), actor]);
    await audit(c, store, actor, pause ? 'pause' : 'resume', 'sales', { reason: reason.trim() });
    return { paused: !!pause };
  });
}
async function adminRevoke(store, actor, wallet, revoke, reason) {
  if (!WALLET_RE.test(String(wallet || ''))) fail('Invalid wallet.');
  if (revoke && (typeof reason !== 'string' || !reason.trim() || reason.length > 300)) fail('Enter a reason (up to 300 characters).');
  return store.transaction(async c => {
    await store.locked(c, wallet);
    const e = await entitlement(c, store.scope, wallet, { lock: true });
    if (!e) fail('No Founder entitlement for that wallet.', 404);
    await c.query('UPDATE ryo_founder_entitlements SET revoked=$3,revoked_reason=$4 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, revoke ? nowOf(store) : null, revoke ? reason.trim() : null]);
    // The discount follows the profile flag; heroes already granted stay with the player.
    const profile = await store.profileLocked(c, wallet);
    if (revoke) delete profile.founderTier; else profile.founderTier = e.tier;
    await saveProfile(c, store, wallet, profile);
    await audit(c, store, actor, revoke ? 'revoke' : 'restore', wallet, { reason: revoke ? reason.trim() : null });
    return { ok: true };
  });
}

module.exports = { SCHEMA, MIGRATION_V2, priceFor, TIERS, TOTAL_SUPPLY, LIMITED_PASSES, LIMITED_POOL, PREMIUM_POOL, RANKS, FOUNDER_CHEST_COOLDOWN_MS, REGULAR_CHEST_COOLDOWN_MS,
  SENSEI_LAMPORTS, SENSEI_LEGACY_LAMPORTS, SENSEI_TRIAL_MS, DISCOUNTED, GAME_ACTIONS,
  switches, saleMode, rankFor, weekStart, metadata, metadataUri, mintAuthority, buildMint, signedBy,
  info, mint, confirm, settle, sweep, sweepExpired, entitlement, chestCooldownMs, discount, assertRyoProduct,
  activate, summon, recordActivity, qualifyingWeeks, senseiTrial, senseiInfo, senseiBuy, senseiConfirm, settleSensei,
  status, syncProfile, handleGame, adminOverview, adminPause, adminRevoke };
