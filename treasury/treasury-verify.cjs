/* Read-only, finalized on-chain verification of the Chapter 04 registry.
 *
 * Nothing here signs, sends or builds a transaction. Every check reads finalized state and reports an explicit
 * status — 'verified', 'mismatch' or 'unverified' (RPC failure / timeout) — never a silent zero.
 *
 *   Squads v4  pinned program ID + account discriminator, vault PDA re-derived from the multisig, threshold,
 *              exact member set, no config authority (autonomous), time lock reported, member permissions,
 *              and no member/vault overlap with the game custody signer or other destinations.
 *   Wallets    Phantom destinations must be System-owned (or not yet created — "unfunded").
 *   SR mint    classic SPL Token program and 6 decimals (Token-2022 or other decimals = blocking), with
 *              mint/freeze authority reported.
 *   Balances   SOL lamports and, once the mint is registered, SR base units.
 *
 * Copied to app/server/treasury-verify.cjs by apply-treasury.cjs.
 */
'use strict';
const crypto = require('node:crypto');
const registryModule = require('./treasury-registry.cjs');

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const MULTISIG_DISCRIMINATOR = crypto.createHash('sha256').update('account:Multisig').digest().subarray(0, 8); // e07479ba44a14fec
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const PERMISSIONS = { initiate: 1, vote: 2, execute: 4 };
const TIMEOUT_MS = 8000, CACHE_MS = 60000;
const web3 = () => require('@solana/web3.js'), spl = () => require('@solana/spl-token');

/** Decode a Squads v4 `Multisig` account. Throws on a malformed buffer. */
function decodeMultisig(data) {
  const d = Buffer.from(data);
  if (d.length < 8 + 32 + 32 + 2 + 4 + 8 + 8 + 1 + 1 + 4) throw Error('Squads multisig account is too small.');
  if (!d.subarray(0, 8).equals(MULTISIG_DISCRIMINATOR)) throw Error('Account is not a Squads v4 Multisig (discriminator mismatch).');
  const { PublicKey } = web3();
  let o = 8; const pk = () => { const p = new PublicKey(d.subarray(o, o + 32)).toBase58(); o += 32; return p; };
  const createKey = pk(), configAuthority = pk(), threshold = d.readUInt16LE(o); o += 2;
  const timeLockSeconds = d.readUInt32LE(o); o += 4;
  const transactionIndex = d.readBigUInt64LE(o); o += 8; const staleTransactionIndex = d.readBigUInt64LE(o); o += 8;
  const hasRent = d[o]; o += 1; if (hasRent > 1) throw Error('Malformed Squads rent collector.');
  const rentCollector = hasRent ? pk() : null; const bump = d[o]; o += 1;
  const count = d.readUInt32LE(o); o += 4;
  if (count > 65535 || o + count * 33 > d.length) throw Error('Malformed Squads member list.');
  const members = []; for (let i = 0; i < count; i++) { const key = pk(), mask = d[o]; o += 1; members.push({ key, mask, initiate: !!(mask & 1), vote: !!(mask & 2), execute: !!(mask & 4) }); }
  return { createKey, configAuthority: configAuthority === SYSTEM_PROGRAM ? null : configAuthority, threshold, timeLockSeconds, transactionIndex: String(transactionIndex), staleTransactionIndex: String(staleTransactionIndex), rentCollector, bump, members };
}
function vaultAddress(multisig, index, programId) {
  const { PublicKey } = web3();
  return PublicKey.findProgramAddressSync([Buffer.from('multisig'), new PublicKey(multisig).toBuffer(), Buffer.from('vault'), Buffer.from([index])], new PublicKey(programId))[0].toBase58();
}

function withTimeout(promise, ms = TIMEOUT_MS) {
  let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error('RPC timed out'), { rpcTimeout: true })), ms); })]).finally(() => clearTimeout(timer));
}
const unverified = (kind, error) => ({ kind, status: 'unverified', problems: ['Chain data unavailable: ' + (error?.rpcTimeout ? 'RPC timed out' : 'RPC error') + '. Shown as unverified, never as zero.'] });

/** Verify the Squads Treasury against the registry. `forbidden` = addresses no member/vault may equal (custody, studio…). */
async function verifySquads(connection, reg = registryModule.registry(), { forbidden = [] } = {}) {
  const { PublicKey } = web3(), s = reg.squads, problems = [], vault = reg.addresses.lockedTreasury;
  let info, vaultInfo;
  try { [info, vaultInfo] = await withTimeout(Promise.all([connection.getAccountInfo(new PublicKey(s.multisig), 'finalized'), connection.getAccountInfo(new PublicKey(vault), 'finalized')])); }
  catch (e) { return { ...unverified('squads-v4', e), multisig: s.multisig, vault }; }
  if (!info) return { kind: 'squads-v4', status: 'mismatch', multisig: s.multisig, vault, problems: ['The Squads multisig account does not exist on chain.'] };
  if (info.owner.toBase58() !== s.programId) problems.push('Multisig account is not owned by the pinned Squads v4 program.');
  let ms; try { ms = decodeMultisig(info.data); } catch (e) { return { kind: 'squads-v4', status: 'mismatch', multisig: s.multisig, vault, problems: [...problems, e.message] }; }
  const derived = vaultAddress(s.multisig, s.vaultIndex, s.programId);
  if (derived !== vault) problems.push('Squads vault #' + s.vaultIndex + ' derives ' + derived + ', not the registered Treasury address.');
  if (vaultInfo && vaultInfo.owner.toBase58() !== SYSTEM_PROGRAM) problems.push('The Treasury vault address is not a System-owned vault account.');
  if (vaultInfo && vaultInfo.data?.length) problems.push('The Treasury vault account unexpectedly holds data.');
  const keys = ms.members.map(m => m.key);
  if (ms.threshold !== s.threshold || ms.threshold < 2) problems.push('Threshold is ' + ms.threshold + '; the registry requires ' + s.threshold + ' (minimum 2).');
  if (keys.length !== s.members.length || keys.some(k => !s.members.includes(k)) || new Set(keys).size !== keys.length) problems.push('The Squads member set differs from the registered members.');
  if (ms.configAuthority) problems.push('A config authority (' + ms.configAuthority + ') can change members/threshold without a vote.');
  if (ms.timeLockSeconds !== s.timeLockSeconds) problems.push('Time lock is ' + ms.timeLockSeconds + ' s; the registry records ' + s.timeLockSeconds + ' s.');
  const voters = ms.members.filter(m => m.vote).length;
  if (voters < ms.threshold) problems.push('Fewer voting members (' + voters + ') than the threshold: proposals could never pass.');
  if (!ms.members.some(m => m.initiate) || !ms.members.some(m => m.execute)) problems.push('No member can initiate or execute proposals.');
  for (const f of forbidden.filter(Boolean)) {
    if (keys.includes(f)) problems.push('Game-controlled or destination address ' + f + ' must not be a Squads member.');
    if (f === vault || f === s.multisig) problems.push('Address ' + f + ' collides with the Treasury multisig/vault.');
  }
  return { kind: 'squads-v4', status: problems.length ? 'mismatch' : 'verified', commitment: 'finalized', programId: s.programId, multisig: s.multisig, vault, vaultIndex: s.vaultIndex,
    threshold: ms.threshold, members: ms.members.map(m => ({ key: m.key, initiate: m.initiate, vote: m.vote, execute: m.execute })), configAuthority: ms.configAuthority,
    timeLockSeconds: ms.timeLockSeconds, transactionIndex: ms.transactionIndex, staleTransactionIndex: ms.staleTransactionIndex, vaultLamports: vaultInfo ? vaultInfo.lamports : 0, problems,
    note: 'Verifies Squads 2-of-' + keys.length + ' approval. It is not a timelock and does not restrict what approved proposals may do.' };
}

/** A Phantom-style destination: System-owned or not yet created. */
async function verifyWallet(connection, address) {
  const { PublicKey } = web3();
  let info; try { info = await withTimeout(connection.getAccountInfo(new PublicKey(address), 'finalized')); } catch (e) { return { ...unverified('wallet', e), address }; }
  if (!info) return { kind: 'wallet', status: 'verified', address, state: 'unfunded', lamports: 0, problems: [], note: 'No on-chain account yet (never funded). Valid as a destination.' };
  if (info.owner.toBase58() !== SYSTEM_PROGRAM) return { kind: 'wallet', status: 'mismatch', address, state: 'program-owned', lamports: info.lamports, problems: ['Owned by ' + info.owner.toBase58() + ', not the System program: not a plain wallet.'] };
  return { kind: 'wallet', status: 'verified', address, state: 'system-account', lamports: info.lamports, problems: [], note: 'Single-key wallet: no on-chain spending restriction.' };
}

/** SR mint compatibility with the game (classic SPL Token, 6 decimals). */
async function verifyMint(connection, mint) {
  if (!mint) return { kind: 'mint', status: 'pending', address: null, blocking: ['The SR mint is not registered yet (token not launched).'], problems: [] };
  const { PublicKey } = web3(), t = spl();
  let info; try { info = await withTimeout(connection.getAccountInfo(new PublicKey(mint), 'finalized')); } catch (e) { return { ...unverified('mint', e), address: mint, blocking: ['Mint could not be verified.'] }; }
  if (!info) return { kind: 'mint', status: 'mismatch', address: mint, blocking: ['The registered mint does not exist on chain.'], problems: ['Mint account not found.'] };
  const owner = info.owner.toBase58(), program = owner === t.TOKEN_PROGRAM_ID.toBase58() ? 'spl-token' : owner === t.TOKEN_2022_PROGRAM_ID.toBase58() ? 'token-2022' : 'unknown';
  const blocking = [], problems = [];
  if (program === 'unknown' || info.data.length < t.MINT_SIZE) { blocking.push('Mint is owned by an unknown program.'); return { kind: 'mint', status: 'mismatch', address: mint, program, owner, blocking, problems: blocking }; }
  const m = t.MintLayout.decode(info.data.subarray(0, t.MINT_SIZE));
  if (program === 'token-2022') blocking.push('Token-2022 mint: the game transfers, ATAs and checks support only the classic SPL Token program. Rework + review required.');
  if (m.decimals !== 6) blocking.push('Mint has ' + m.decimals + ' decimals; the game requires 6.');
  if (!m.isInitialized) blocking.push('Mint is not initialized.');
  if (m.mintAuthorityOption) problems.push('Mint authority is still set (' + m.mintAuthority.toBase58() + '): supply can grow. The game refuses such a mint.');
  if (m.freezeAuthorityOption) problems.push('Freeze authority is set (' + m.freezeAuthority.toBase58() + '): accounts can be frozen. The game refuses such a mint.');
  return { kind: 'mint', status: blocking.length || problems.length ? 'mismatch' : 'verified', address: mint, program, owner, decimals: m.decimals, supplyRaw: String(m.supply),
    mintAuthority: m.mintAuthorityOption ? m.mintAuthority.toBase58() : null, freezeAuthority: m.freezeAuthorityOption ? m.freezeAuthority.toBase58() : null, blocking, problems };
}

/** The token account (ATA) the Treasury vault would receive SR in: no delegate, no foreign close authority. */
async function verifyTokenAccount(connection, mint, owner) {
  const { PublicKey } = web3(), t = spl(), ata = t.getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true);
  let info; try { info = await withTimeout(connection.getAccountInfo(ata, 'finalized')); } catch (e) { return { ...unverified('token-account', e), address: ata.toBase58() }; }
  if (!info) return { kind: 'token-account', status: 'verified', address: ata.toBase58(), state: 'absent', problems: [], note: 'Created on first transfer.' };
  const problems = [];
  if (!info.owner.equals(t.TOKEN_PROGRAM_ID) || info.data.length !== t.ACCOUNT_SIZE) problems.push('Token account is not a classic SPL token account.');
  else {
    const a = t.AccountLayout.decode(info.data);
    if (!a.mint.equals(new PublicKey(mint)) || !a.owner.equals(new PublicKey(owner))) problems.push('Token account mint/owner mismatch.');
    if (a.delegateOption) problems.push('Token account has a delegate that could move funds.');
    if (a.state !== 1) problems.push('Token account is frozen or uninitialized.');
    if (a.closeAuthorityOption && !a.closeAuthority.equals(new PublicKey(owner))) problems.push('Token account has a foreign close authority.');
  }
  return { kind: 'token-account', status: problems.length ? 'mismatch' : 'verified', address: ata.toBase58(), state: 'initialized', problems };
}

async function srBalance(connection, owner, mint) {
  const { PublicKey } = web3(), t = spl();
  const reply = await withTimeout(connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }, 'finalized'));
  let raw = 0n;
  for (const item of reply.value) {
    const info = item.account.data?.parsed?.info;
    if (item.account.owner.toString() !== t.TOKEN_PROGRAM_ID.toBase58() || info?.mint !== mint || info.owner !== owner) throw Error('Unexpected token account response');
    raw += BigInt(info.tokenAmount.amount);
  }
  return String(raw);
}

/**
 * Full read-only snapshot. `custody`/`studio` (optional) are game-controlled public keys that must not be
 * Squads members or destinations. `mint` defaults to the registry's SR mint.
 */
async function snapshot(connection, { reg = registryModule.registry(), custody = reg.gameCustody?.address || null, studio = null, mint = reg.srMintAddress, genesis = MAINNET_GENESIS, now = Date.now() } = {}) {
  const out = { marker: 'shinobi-treasury-verification-v1', observedAt: now, commitment: 'finalized', network: reg.network, registry: registryModule.publicView(reg), alerts: [] };
  try { const g = await withTimeout(connection.getGenesisHash()); if (g !== genesis) throw Object.assign(Error('wrong network'), { wrongNetwork: true }); }
  catch (e) {
    out.status = 'unverified'; out.problems = [e.wrongNetwork ? 'The RPC endpoint is not Solana Mainnet. Nothing was verified.' : 'Chain data unavailable. Nothing is shown as verified.'];
    out.alerts.push({ severity: 'review', signal: 'Verification unavailable', detail: out.problems[0] }); return out;
  }
  const forbidden = [custody, studio].filter(Boolean);
  const [squads, mintStatus, ...wallets] = await Promise.all([
    verifySquads(connection, reg, { forbidden: [...forbidden, reg.addresses.activeRewards, reg.addresses.communityRewards, reg.addresses.economicReserve] }),
    verifyMint(connection, mint),
    ...['activeRewards', 'communityRewards', 'economicReserve'].map(r => verifyWallet(connection, reg.addresses[r])),
  ]);
  const destinations = {};
  destinations.lockedTreasury = { ...reg.destinations.lockedTreasury, verification: squads };
  ['activeRewards', 'communityRewards', 'economicReserve'].forEach((r, i) => { destinations[r] = { ...reg.destinations[r], verification: wallets[i] }; });
  for (const r of Object.keys(destinations)) {
    const d = destinations[r];
    if (forbidden.includes(d.address)) { d.verification = { ...d.verification, status: 'mismatch', problems: [...(d.verification.problems || []), 'Destination equals a game-controlled wallet.'] }; }
    d.solLamports = r === 'lockedTreasury' ? (squads.status === 'unverified' ? null : squads.vaultLamports ?? null) : (d.verification.status === 'unverified' ? null : d.verification.lamports ?? null);
    if (mintStatus.address && mintStatus.program === 'spl-token') {
      try { d.srRaw = await srBalance(connection, d.address, mintStatus.address); } catch { d.srRaw = null; }
      if (r === 'lockedTreasury') d.tokenAccount = await verifyTokenAccount(connection, mintStatus.address, d.address);
    } else d.srRaw = null;
  }
  out.destinations = destinations; out.squads = squads; out.mint = mintStatus;
  // The game claim/custody wallet (public address from the registry). Its balance includes player deposits, so it is
  // never presented as claimable; "available for claims" is computed separately from the game ledger.
  if (reg.gameCustody) {
    const w = await verifyWallet(connection, reg.gameCustody.address), gc = { address: reg.gameCustody.address, purpose: reg.gameCustody.purpose, verification: w, solLamports: w.status === 'unverified' ? null : w.lamports ?? null, srRaw: null };
    if (mintStatus.address && mintStatus.program === 'spl-token') { try { gc.srRaw = await srBalance(connection, gc.address, mintStatus.address); } catch { gc.srRaw = null; } }
    if (w.status === 'mismatch') out.alerts.push({ severity: 'critical', signal: 'Game custody wallet mismatch', detail: w.problems.join(' ') });
    out.gameCustody = gc;
  }
  // Funds in the four owner-controlled Chapter 04 wallets: external to the game, never directly claimable by players.
  const held = Object.values(destinations).map(d => d.srRaw);
  out.externalHeld = !mintStatus.address ? { status: 'pending', srRaw: null, note: 'The SR mint is not registered yet, so no SR balances exist.' }
    : held.some(v => v == null) ? { status: 'unverified', srRaw: null, note: 'One or more wallet balances could not be read; no partial total is shown.' }
    : { status: 'verified', srRaw: String(held.reduce((n, v) => n + BigInt(v), 0n)), note: 'Owner-controlled wallets. Not directly available for player reward claims.' };
  const failing = [squads, ...wallets, ...(destinations.lockedTreasury.tokenAccount ? [destinations.lockedTreasury.tokenAccount] : [])];
  out.status = failing.some(v => v.status === 'mismatch') ? 'mismatch' : failing.some(v => v.status === 'unverified') ? 'unverified' : 'verified';
  if (squads.status === 'mismatch') out.alerts.push({ severity: 'critical', signal: 'Treasury governance drift', detail: squads.problems.join(' ') + ' SR routing refuses new payments until resolved.' });
  if (squads.status === 'verified' && Number(squads.transactionIndex) > 0) out.alerts.push({ severity: 'review', signal: 'Squads proposals exist', detail: squads.transactionIndex + ' Treasury proposal(s) have been created. Confirm each was intended and approved by you.' });
  for (const w of wallets) if (w.status === 'mismatch') out.alerts.push({ severity: 'critical', signal: 'Destination wallet mismatch', detail: w.address + ': ' + w.problems.join(' ') });
  if (mintStatus.blocking?.length && mintStatus.status !== 'pending') out.alerts.push({ severity: 'critical', signal: 'SR mint incompatible', detail: mintStatus.blocking.join(' ') });
  if (mintStatus.problems?.length) out.alerts.push({ severity: 'review', signal: 'SR mint authorities', detail: mintStatus.problems.join(' ') });
  return out;
}

/** Strip member keys and other operator detail for the public transparency page. */
function publicSummary(snap) {
  const strip = v => v && { kind: v.kind, status: v.status, state: v.state, problems: v.problems, note: v.note };
  return { marker: snap.marker, observedAt: snap.observedAt, status: snap.status, commitment: snap.commitment, registry: snap.registry, problems: snap.problems,
    destinations: snap.destinations && Object.fromEntries(Object.entries(snap.destinations).map(([r, d]) => [r, { role: r, label: d.label, percent: d.bps / 100, address: d.address, custody: d.custody, purpose: d.purpose, solLamports: d.solLamports ?? null, srRaw: d.srRaw ?? null, verification: strip(d.verification) }])),
    squads: snap.squads && { status: snap.squads.status, threshold: snap.squads.threshold, members: snap.squads.members?.length, configAuthority: snap.squads.configAuthority ? 'set' : 'none', timeLockSeconds: snap.squads.timeLockSeconds, proposals: snap.squads.transactionIndex, multisig: snap.squads.multisig, note: snap.squads.note },
    mint: snap.mint && { status: snap.mint.status, address: snap.mint.address, program: snap.mint.program, decimals: snap.mint.decimals, blocking: snap.mint.blocking },
    externalHeld: snap.externalHeld,
    gameCustody: snap.gameCustody && { address: snap.gameCustody.address, purpose: snap.gameCustody.purpose, solLamports: snap.gameCustody.solLamports, srRaw: snap.gameCustody.srRaw, verification: strip(snap.gameCustody.verification) } };
}

/** Process-wide 60 s cache with in-flight de-duplication: public traffic cannot amplify RPC load. */
function cachedSnapshot(createConnection, { ttl = CACHE_MS, clock = Date.now } = {}) {
  let value = null, at = 0, inflight = null, connection = null;
  return async (opts = {}) => {
    if (value && clock() - at < ttl) return value;
    if (!inflight) inflight = (async () => { connection = connection || createConnection(); try { value = await snapshot(connection, { ...opts, now: clock() }); at = clock(); return value; } finally { inflight = null; } })();
    return inflight;
  };
}
function mainnetConnection(env = process.env) {
  const url = /^https:\/\//.test(String(env.SOLANA_RPC_URL || '')) ? env.SOLANA_RPC_URL : 'https://api.mainnet-beta.solana.com';
  return new (web3().Connection)(url, { commitment: 'finalized', disableRetryOnRateLimit: true });
}

module.exports = { MAINNET_GENESIS, MULTISIG_DISCRIMINATOR, decodeMultisig, vaultAddress, verifySquads, verifyWallet, verifyMint, verifyTokenAccount, snapshot, publicSummary, cachedSnapshot, mainnetConnection, PERMISSIONS };
