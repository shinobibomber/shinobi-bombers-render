/* Live (Mainnet) economy decisions, owner decision 2026-11-09. Copied to app/server/live-economy.cjs by apply-live-economy.cjs.
 *
 *   1. SR deposits are fee-free on the live build: the whole deposit is credited (no 2% studio fee, one transfer).
 *   2. Boss Hunt's 10% treasury share goes to the registered Locked Treasury (Squads vault) on the live build.
 *   3. RYO_STUDIO_WALLET / RYO_REVENUE_WALLET are optional on the live build. Nothing at launch pays them; features that
 *      would (the Market) are refused until both are configured (launch-gates.cjs).
 * The test-server build keeps the original behaviour exactly: 2% deposit fee, studio and revenue wallets required. */
'use strict';
// Self-contained (no store/database import): launch-gates.cjs loads this module, also in isolated copies.
function fail(message, status = 400) { throw Object.assign(Error(message), { status }); }

/** Bound to the validated build stamp, like sr-revenue: an env or request can never switch it. */
const live = () => { try { return require('./network.cjs').built(__dirname).key === 'mainnet'; } catch { return false; } };
const present = v => typeof v === 'string' && v.trim() !== '';

/* ---------- SR token program (classic SPL Token or Token-2022), decided by the reviewed registry ---------- */
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
/** The SR mint's token program: the registry's srMintProgram on the live build, the classic program on the test server. */
function programId() {
  const spl = require('@solana/spl-token');
  if (!live()) return spl.TOKEN_PROGRAM_ID;
  return require('./treasury-registry.cjs').registry().srMintProgram === 'token-2022' ? spl.TOKEN_2022_PROGRAM_ID : spl.TOKEN_PROGRAM_ID;
}
/** The associated SR token account of `owner` (off-curve allowed, e.g. a Squads vault) under the registered program. */
function ata(mint, owner) { return require('@solana/spl-token').getAssociatedTokenAddressSync(mint, owner, true, programId()); }
/* Token-2022 mint extensions the game accepts: name/metadata only. Anything that changes transfers or balances (transfer
 * fee, transfer hook, permanent delegate, default frozen state, non-transferable, confidential, interest) is refused. */
const ALLOWED_EXTENSIONS = ['MetadataPointer', 'TokenMetadata'];
/** Reads the SR mint with the registered program; fails closed on an unexpected owner program or extension. */
async function getMint(connection, mint) {
  const spl = require('@solana/spl-token'), { PublicKey } = require('@solana/web3.js'), program = programId(), key = new PublicKey(mint);
  const info = await connection.getAccountInfo(key, 'finalized');
  if (!info || !info.owner.equals(program)) fail('Server token mint does not match the registered SR token program.', 503);
  const value = spl.unpackMint(key, info, program);
  if (program.equals(spl.TOKEN_2022_PROGRAM_ID)) {
    const names = spl.getExtensionTypes(value.tlvData).map(t => spl.ExtensionType[t]);
    const bad = names.filter(n => !ALLOWED_EXTENSIONS.includes(n));
    if (bad.length) fail('The SR token uses unsupported Token-2022 extensions (' + bad.join(', ') + ').', 503);
  }
  return value;
}

/** Validates the studio/revenue wallets: required on the test server; on live validated only when configured. */
function wallets(address, studioAddress, revenueAddress) {
  for (const value of [studioAddress, revenueAddress]) if (!live() || present(value)) address(value);
}
/** Server settings the game service needs before it starts (netlify-handler). */
function required(all) {
  if (!live()) return all;
  const { RYO_STUDIO_WALLET, RYO_REVENUE_WALLET, ...rest } = all;
  return rest;
}
const feeFree = () => live();
/** Public `config` fields for the client: on live the deposit carries no studio fee and no studio destination. */
function depositConfig(studioAddress) {
  return feeFree() ? { studioAddress: null, studioFeeBps: 0, depositFeeBps: 0 } : { studioAddress, studioFeeBps: 200 };
}
/** Boss Hunt treasury share: the registered Locked Treasury on live, the legacy revenue wallet on the test server. */
function huntTreasury(revenueAddress) {
  if (!live()) return revenueAddress;
  const reg = require('./treasury-registry.cjs').registry(), vault = reg.addresses?.lockedTreasury;
  if (!present(vault)) fail('The Locked Treasury is not registered. Boss Hunt entry is unavailable.', 503);
  return vault;
}

/* Fee-free deposit verification (live): exactly one transferChecked of the full amount from the player's token account to
 * the custody token account, the deposit memo, and optional idempotent ATA creation / compute-budget instructions. The same
 * finalized-balance proof as the original: the player loses exactly the amount, custody gains exactly the amount. */
function verifyFeeFreeDeposit(receipt, { wallet, mint, treasury, signature: hash, amount: ryo, requestId: id }, { spl, key, MEMO, UNIT, stripComputeBudgetInstructions }) {
  if (!receipt?.meta || receipt.meta.err || receipt.transaction?.signatures?.[0] !== hash) fail('Deposit is failed or does not match the signature.');
  const message = receipt.transaction.message, keys = message.accountKeys, feePayer = keys?.[0];
  if (!feePayer?.signer || feePayer.pubkey.toString() !== wallet) fail('Deposit must be signed by your connected wallet.');
  const P = programId(), source = spl.getAssociatedTokenAddressSync(key(mint), key(wallet), false, P).toBase58(), vault = spl.getAssociatedTokenAddressSync(key(mint), key(treasury), false, P).toBase58();
  let instructions; try { instructions = stripComputeBudgetInstructions(message.instructions, { enforcePriorityCap: false }); } catch { fail('Invalid wallet network-fee instructions.'); }
  if (!Array.isArray(instructions) || instructions.length < 2 || instructions.length > 3) fail('Unexpected deposit instructions.');
  const TOKEN = P.toBase58(), ATA = spl.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), MEMO_ID = MEMO.toBase58();
  if (instructions.some(i => ![TOKEN, MEMO_ID, ATA].includes(i.programId.toString()))) fail('Unexpected program in deposit.');
  const transfers = instructions.filter(i => i.programId.toString() === TOKEN), memos = instructions.filter(i => i.programId.toString() === MEMO_ID);
  if (transfers.length !== 1 || memos.length !== 1 || memos[0].parsed !== 'shinobi-deposit-v2:' + id) fail('Missing deposit transfer or memo.');
  const atas = instructions.filter(i => i.programId.toString() === ATA);
  if (atas.length > 1 || atas.some(i => i.parsed?.info?.account !== vault)) fail('Unexpected token account creation in deposit.');
  const t = transfers[0], i = t.parsed?.info, raw = (BigInt(ryo) * UNIT).toString();
  if (!(t.parsed?.type === 'transferChecked' && i?.authority === wallet && i.source === source && i.destination === vault && i.mint === mint && i.tokenAmount?.amount === raw && i.tokenAmount?.decimals === 6))
    fail('Deposit recipient/mint/amount does not match.');
  const delta = (account, owner) => {
    const index = keys.findIndex(k => k.pubkey.toString() === account); if (index < 0) fail('Missing deposit account.');
    const find = list => list?.find(b => b.accountIndex === index && b.mint === mint && b.owner === owner);
    return BigInt(find(receipt.meta.postTokenBalances)?.uiTokenAmount.amount || 0) - BigInt(find(receipt.meta.preTokenBalances)?.uiTokenAmount.amount || 0);
  };
  if (delta(source, wallet) !== -BigInt(ryo) * UNIT || delta(vault, treasury) !== BigInt(ryo) * UNIT) fail('Finalized token balances do not confirm the deposit.');
  return { gross: ryo, studioFee: 0, net: ryo };
}
/** Picks the deposit verifier: fee-free on live, the original (with 2% studio fee) on the test server. */
function verifier(original, deps) {
  return feeFree() ? (receipt, args) => verifyFeeFreeDeposit(receipt, args, deps) : original;
}
/** The Market pays the studio and revenue wallets: on live it needs both configured. */
function marketConfigured(env = process.env) {
  return !live() || (present(env.RYO_STUDIO_WALLET) && present(env.RYO_REVENUE_WALLET));
}
/** Public token config (/beta-config.json): ready with the mint alone on live (the studio wallet is optional there). */
function tokenConfigReady(env = process.env) { return present(env.RYO_TOKEN_MINT) && (live() || present(env.RYO_STUDIO_WALLET)); }
/** Studio address published to the wallet: null on live (fee-free deposits), the configured wallet on the test server. */
function publicStudio(env = process.env) { return live() ? null : env.RYO_STUDIO_WALLET; }
/* On live every regular product carries the 50/30/10/10 revenue distribution; only a Boss Hunt quote does not. Boss Hunt is
 * entered through hunt-enter (its share goes to the Locked Treasury), never through the generic purchase action. */
function assertPurchase(action, body) {
  if (live() && action === 'purchase' && body && body.product === 'hunt') throw Object.assign(Error('Enter Boss Hunt from the Boss Hunt screen.'), { status: 403, code: 'LAUNCH_GATE_CLOSED', gate: 'bossHunt' });
}

/* No free starter heroes on live (owner decision 2026-11-09): heroes come from summons only. New live profiles start
 * empty and carry liveStart. A profile made before this rule that is still untouched (exactly the two default level-1
 * Genin, no Dojo, no Sensei) loses those two once; any other profile is only marked, never changed. The test server
 * keeps its two default Genin. */
function initialProfile(profile) { return live() ? { ...profile, heroes: [], liveStart: 1 } : profile; }
function cleanStarterProfile(profile) {
  if (!live() || !profile || typeof profile !== 'object' || profile.liveStart === 1) return profile;
  const heroes = Array.isArray(profile.heroes) ? profile.heroes : [];
  if (heroes.length === 2 && heroes.every(h => h && h.rank === 0 && h.level === 1 && !h.nft && !h.mythic && !h.starter && !h.referralReward) && !profile.dojo && !profile.sensei) profile.heroes = [];
  profile.liveStart = 1;
  return profile;
}

module.exports = { initialProfile, cleanStarterProfile, TOKEN_2022, ALLOWED_EXTENSIONS, programId, ata, getMint, live, wallets, required, feeFree, depositConfig, huntTreasury, verifyFeeFreeDeposit, verifier, marketConfigured, tokenConfigReady, publicStudio, assertPurchase };
