/* Typed, public-only Chapter 04 wallet registry.
 *
 * The registry (treasury-registry.json) is committed and code-reviewed: changing a destination, the Squads
 * member set or the SR mint requires a reviewed commit and a redeploy, not a runtime setting. This module has
 * no dependencies, so the site host, the start-up guard and the game server can all load it.
 *
 * Validation refuses: invalid base58 / non-32-byte keys, duplicate addresses, rates that do not total
 * 10,000 bps, any key-like field (secret/private/seed/keypair/mnemonic) and any array of numbers or 64-byte
 * value (the shape of a Solana secret key).
 *
 * v2 (2026-11-12, Treasury migration): the Treasury (role lockedTreasury, 50%) may be a single-key wallet ONLY with an
 * explicit, owner-referenced treasuryCustodyException naming that exact address; otherwise it must stay a Squads v4 or
 * reviewed program vault. Non-revenue "reserves" (ryoBurnReserve) carry no allocation and are never a revenue or top-up
 * destination. The squads block maps each Squads-governed role to its vault index (squads.vaults).
 *
 * Copied to app/server/treasury-registry.cjs (+ .json) by apply-treasury.cjs.
 */
'use strict';
const fs = require('node:fs'), path = require('node:path');

const ROLES = Object.freeze(['lockedTreasury', 'activeRewards', 'communityRewards', 'economicReserve']);
const RATES = Object.freeze({ lockedTreasury: 5000, activeRewards: 3000, communityRewards: 1000, economicReserve: 1000 });
const CUSTODY = Object.freeze(['squads-v4-vault', 'phantom-single-key', 'program-vault']);
// Non-revenue reserve roles: 0 bps, never a Chapter 04 revenue destination, never a reward top-up source.
const RESERVE_ROLES = Object.freeze(['ryoBurnReserve']);
const SCHEMA = 'shinobi-treasury-registry-v2';
const SQUADS_V4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const FORBIDDEN_KEY = /secret|private|seed|keypair|mnemonic|passphrase/i;

class RegistryError extends Error {}
const bad = message => { throw new RegistryError('Treasury registry: ' + message); };

/** Base58 decode; returns null for anything that is not canonical base58. */
function base58(value) {
  if (typeof value !== 'string' || !value || value.length > 100) return null;
  const bytes = [];
  for (const ch of value) {
    let carry = ALPHABET.indexOf(ch); if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of value) { if (ch !== '1') break; bytes.push(0); }
  return Buffer.from(bytes.reverse());
}
/** A canonical 32-byte Solana public key in base58 (re-encoding check rejects alternate spellings). */
function isPublicKey(value) {
  const bytes = base58(value); if (!bytes || bytes.length !== 32) return false;
  let n = BigInt('0x' + (bytes.toString('hex') || '0')), out = '';
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out === value;
}
const key = (value, label) => (isPublicKey(value) ? value : bad(label + ' must be a valid 32-byte base58 public key.'));

function scanForSecrets(node, at = 'registry') {
  if (Array.isArray(node)) {
    if (node.length >= 32 && node.every(n => Number.isInteger(n))) bad(at + ' looks like secret key bytes. Public keys only.');
    node.forEach((v, i) => scanForSecrets(v, at + '[' + i + ']'));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (FORBIDDEN_KEY.test(k)) bad('field "' + k + '" is not allowed. Never store keys or seed phrases here.');
      scanForSecrets(v, at + '.' + k);
    }
  } else if (typeof node === 'string') {
    const decoded = base58(node);
    if (decoded && decoded.length === 64) bad(at + ' looks like a 64-byte secret key. Public keys only.');
    if (/^(\w+\s+){11,23}\w+$/.test(node.trim()) && node.trim().split(/\s+/).every(w => /^[a-z]{3,8}$/.test(w))) bad(at + ' looks like a seed phrase.');
  }
}

/** Validate a parsed registry object. Returns a deeply frozen, normalized copy. */
/** Token programs a registered SR mint may use (program IDs in live-economy.cjs / treasury-verify.cjs). */
const MINT_PROGRAMS = Object.freeze(['spl-token', 'token-2022']);

function validate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('must be a JSON object.');
  scanForSecrets(raw);
  if (raw.schema !== SCHEMA) bad('unknown schema (expected ' + SCHEMA + ').');
  if (raw.network !== 'mainnet') bad('network must be "mainnet" (the live server).');
  if (raw.publicKeysOnly !== true) bad('publicKeysOnly must be true.');
  if (!Array.isArray(raw.destinations) || raw.destinations.length !== ROLES.length) bad('exactly four Chapter 04 destinations are required.');
  const destinations = {}, seen = new Set();
  let total = 0;
  for (const d of raw.destinations) {
    if (!d || !ROLES.includes(d.role) || destinations[d.role]) bad('each destination role must be one of ' + ROLES.join(', ') + ', listed once.');
    if (!Number.isSafeInteger(d.bps) || d.bps !== RATES[d.role]) bad(d.role + ' must be ' + RATES[d.role] + ' bps (Chapter 04).');
    if (!CUSTODY.includes(d.custody)) bad(d.role + ' custody must be one of ' + CUSTODY.join(', ') + '.');
    const address = key(d.address, d.role);
    if (seen.has(address)) bad('destination addresses must be distinct.'); seen.add(address);
    total += d.bps;
    destinations[d.role] = { role: d.role, label: String(d.label || d.role).slice(0, 80), bps: d.bps, address, custody: d.custody, purpose: String(d.purpose || '').slice(0, 300) };
  }
  if (total !== 10000) bad('allocation rates must total exactly 10,000 bps.');
  // The Treasury keeps multisig/program custody unless the owner explicitly approved this exact single-key address.
  const treasury = destinations.lockedTreasury, ex = raw.treasuryCustodyException;
  let custodyException = null;
  if (ex != null) {
    if (typeof ex !== 'object' || Array.isArray(ex) || ex.approved !== true) bad('treasuryCustodyException must be an approved object (or be removed).');
    if (key(ex.address, 'treasuryCustodyException.address') !== treasury.address) bad('treasuryCustodyException must name the registered Treasury address exactly.');
    if (typeof ex.reference !== 'string' || ex.reference.trim().length < 8) bad('treasuryCustodyException needs a written owner approval reference.');
    if (treasury.custody !== 'phantom-single-key') bad('treasuryCustodyException is only valid for a single-key Treasury; remove it for a vault Treasury.');
    custodyException = { address: ex.address, reference: ex.reference.trim().slice(0, 300) };
  }
  if (treasury.custody === 'phantom-single-key' && !custodyException) bad('The Treasury must be a Squads v4 vault or a reviewed program vault; a single-key Treasury needs an explicit owner-approved treasuryCustodyException.');

  // Non-revenue reserves: no bps, distinct addresses, Squads-governed.
  const reserves = {};
  if (raw.reserves != null && !Array.isArray(raw.reserves)) bad('reserves must be a list.');
  for (const r of raw.reserves || []) {
    if (!r || !RESERVE_ROLES.includes(r.role) || reserves[r.role]) bad('each reserve role must be one of ' + RESERVE_ROLES.join(', ') + ', listed once.');
    if ('bps' in r) bad(r.role + ' is a reserve: it has no revenue allocation (remove bps). An automatic allocation is a separate, owner-approved policy change.');
    if (r.custody !== 'squads-v4-vault') bad(r.role + ' must be a Squads v4 vault.');
    const address = key(r.address, r.role);
    if (seen.has(address)) bad('reserve addresses must be distinct from every destination and other reserve.'); seen.add(address);
    reserves[r.role] = { role: r.role, label: String(r.label || r.role).slice(0, 80), address, custody: r.custody, purpose: String(r.purpose || '').slice(0, 300) };
  }

  const s = raw.squads;
  if (!s || typeof s !== 'object') bad('squads settings are required.');
  if (s.programId !== SQUADS_V4) bad('squads.programId must be the Squads v4 program ' + SQUADS_V4 + '.');
  const multisig = key(s.multisig, 'squads.multisig');
  // Every Squads-custody role (Treasury or reserve) maps to exactly one vault index of this multisig, and back.
  if (!s.vaults || typeof s.vaults !== 'object' || Array.isArray(s.vaults)) bad('squads.vaults must map each Squads-governed role to its vault index.');
  const governed = [...Object.values(destinations), ...Object.values(reserves)].filter(d => d.custody === 'squads-v4-vault').map(d => d.role);
  const vaultRoles = Object.keys(s.vaults);
  if (!vaultRoles.length || vaultRoles.length !== governed.length || governed.some(r => !vaultRoles.includes(r))) bad('squads.vaults must list exactly the Squads-custody roles (' + (governed.join(', ') || 'none') + ').');
  const vaults = {};
  for (const r of vaultRoles) { const i = s.vaults[r]; if (!Number.isSafeInteger(i) || i < 0 || i > 255) bad('squads.vaults.' + r + ' must be 0–255.'); vaults[r] = i; }
  if (new Set(Object.values(vaults)).size !== vaultRoles.length) bad('Each Squads-governed role needs its own vault index.');
  if (!Array.isArray(s.members) || s.members.length < 2 || s.members.length > 10) bad('squads.members must list 2–10 member keys.');
  const members = s.members.map((m, i) => key(m, 'squads.members[' + i + ']'));
  if (new Set(members).size !== members.length) bad('squads members must be distinct.');
  if (!Number.isSafeInteger(s.threshold) || s.threshold < 2 || s.threshold > members.length) bad('squads.threshold must be at least 2 and at most the member count.');
  if (!Number.isSafeInteger(s.timeLockSeconds) || s.timeLockSeconds < 0) bad('squads.timeLockSeconds must be a whole number of seconds.');
  for (const m of members) if (seen.has(m) || m === multisig) bad('a Squads member key must not also be a Chapter 04 destination or the multisig itself.');
  if (seen.has(multisig)) bad('the multisig account must not be a destination (use its vault address).');

  const mint = raw.srMintAddress == null ? null : key(raw.srMintAddress, 'srMintAddress');
  let gameCustody = null;
  if (raw.gameCustody != null) {
    if (typeof raw.gameCustody !== 'object') bad('gameCustody must be an object with a public address.');
    const custody = key(raw.gameCustody.address, 'gameCustody.address');
    if (seen.has(custody) || custody === multisig || members.includes(custody) || custody === mint) bad('the game custody wallet must be separate from every Chapter 04 destination, reserve, the Squads multisig, its members and the mint.');
    gameCustody = { address: custody, purpose: String(raw.gameCustody.purpose || '').slice(0, 300), created: String(raw.gameCustody.created || '').slice(0, 20) };
  }
  if (mint && (seen.has(mint) || members.includes(mint))) bad('srMintAddress must not equal a wallet.');
  // Token program of the SR mint (owner decision 2026-11-09: the released Pump.fun mint is Token-2022). Default classic.
  const mintProgram = raw.srMintProgram == null ? 'spl-token' : raw.srMintProgram;
  if (!MINT_PROGRAMS.includes(mintProgram)) bad('srMintProgram must be one of ' + MINT_PROGRAMS.join(', ') + '.');
  if (!Number.isSafeInteger(raw.withdrawalTreasuryFeeBps) || raw.withdrawalTreasuryFeeBps !== 500) bad('withdrawalTreasuryFeeBps must be 500 (5%, approved policy).');
  const a = raw.activation || {};
  if (typeof a.approved !== 'boolean') bad('activation.approved must be true or false.');
  if (a.approved && (typeof a.reference !== 'string' || a.reference.trim().length < 8)) bad('an approved activation needs a written approval reference.');
  if (a.approved && !mint) bad('activation cannot be approved before srMintAddress is set.');

  // Treasury migration (owner decision 2026-11-12): the ONLY transfers that may be recorded as Treasury relocations are the
  // registered legs (former Squads Treasury vault → temporary wallet → new Squads Treasury vault). Recording closes when the
  // migration is completed and reconciled (status "completed", reviewed commit); recorded history is kept permanently.
  let treasuryMigration = null;
  const m = raw.treasuryMigration;
  if (m != null) {
    if (typeof m !== 'object' || Array.isArray(m)) bad('treasuryMigration must be an object.');
    if (typeof m.id !== 'string' || !/^[a-z0-9-]{3,80}$/.test(m.id)) bad('treasuryMigration.id must be a short lowercase identifier.');
    if (!['open', 'completed'].includes(m.status)) bad('treasuryMigration.status must be "open" or "completed".');
    if (m.status === 'completed' && (typeof m.completedReference !== 'string' || m.completedReference.trim().length < 8)) bad('a completed treasuryMigration needs a written reconciliation reference.');
    if (!Array.isArray(m.legs) || m.legs.length < 1 || m.legs.length > 4) bad('treasuryMigration.legs must list 1–4 legs.');
    const squadsVaults = Object.values(vaultRoles.map(r => (destinations[r] || reserves[r]).address));
    const rewardPools = ['activeRewards', 'communityRewards', 'economicReserve'].map(r => destinations[r].address), reserveSet = Object.values(reserves).map(r => r.address);
    const forbiddenLeg = [...rewardPools, multisig, ...members, ...(mint ? [mint] : []), ...(gameCustody ? [gameCustody.address] : [])];
    const legs = m.legs.map((l, i) => {
      if (!l || l.leg !== i + 1) bad('treasuryMigration legs must be numbered 1, 2, … in order.');
      if (!['squads-vault-execute', 'direct'].includes(l.path)) bad('treasuryMigration leg ' + l.leg + ' path must be "squads-vault-execute" or "direct".');
      const from = key(l.from, 'treasuryMigration leg ' + l.leg + ' from'), to = l.to == null ? null : key(l.to, 'treasuryMigration leg ' + l.leg + ' to');
      if (l.path === 'squads-vault-execute' && !squadsVaults.includes(from)) bad('treasuryMigration leg ' + l.leg + ': a Squads leg must start at a registered Squads vault.');
      if (l.path === 'direct' && squadsVaults.includes(from)) bad('treasuryMigration leg ' + l.leg + ': a Squads vault can only move funds through Squads.');
      if (to === from) bad('treasuryMigration leg ' + l.leg + ' must move funds between two different wallets.');
      for (const a of [from, to].filter(Boolean)) if (forbiddenLeg.includes(a)) bad('treasuryMigration leg ' + l.leg + ' must never touch game custody, the reward pools, the Squads multisig/members or the mint.');
      if (to && reserveSet.includes(to)) bad('treasuryMigration leg ' + l.leg + ': moving RYO into the Burn Reserve is Burn Reserve funding, not a Treasury relocation.');
      if (i > 0 && m.legs[i - 1].to !== l.from) bad('treasuryMigration leg ' + l.leg + ' must start where leg ' + i + ' ended.');
      if (to == null && i !== m.legs.length - 1) bad('only the last treasuryMigration leg may still await its destination.');
      return { leg: l.leg, from, to, path: l.path, note: String(l.note || '').slice(0, 300) };
    });
    // The final destination, once supplied, must be the registered Treasury (so it is verified like every Treasury).
    const last = legs[legs.length - 1];
    // While the migration is open, any Treasury change must be a registered leg ending at the new registered Treasury.
    if (m.status === 'open' && last.to && last.to !== treasury.address && !squadsVaults.includes(last.to)) bad('the last treasuryMigration leg must end at the registered Treasury (a Treasury change needs its own registered migration leg).');
    treasuryMigration = { id: m.id, status: m.status, purpose: String(m.purpose || '').slice(0, 400), legs, completedReference: m.status === 'completed' ? m.completedReference.trim().slice(0, 300) : null };
  }

  const roleAddress = r => (destinations[r] || reserves[r]).address;
  return deepFreeze({
    schema: raw.schema, policy: String(raw.policy || ''), network: 'mainnet', destinations,
    addresses: Object.fromEntries(ROLES.map(r => [r, destinations[r].address])),
    reserves, reserveAddresses: Object.fromEntries(Object.values(reserves).map(r => [r.role, r.address])),
    treasuryCustody: treasury.custody === 'squads-v4-vault' ? 'squads' : treasury.custody === 'program-vault' ? 'program-vault' : 'single-key', treasuryCustodyException: custodyException,
    squads: { programId: SQUADS_V4, multisig, vaults, vaultAddresses: Object.fromEntries(vaultRoles.map(r => [r, roleAddress(r)])), threshold: s.threshold, timeLockSeconds: s.timeLockSeconds, members, observed: String(s.observed || '').slice(0, 400) },
    srMintAddress: mint, srMintProgram: mintProgram, gameCustody, withdrawalTreasuryFeeBps: raw.withdrawalTreasuryFeeBps,
    activation: { approved: a.approved, reference: a.approved ? a.reference.trim() : null }, treasuryMigration,
  });
}
function deepFreeze(o) { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; }

const FILE = path.join(__dirname, 'treasury-registry.json');
let cached = null;
/** The committed registry (validated once per process). Throws RegistryError if it is invalid. */
function registry() { return cached || (cached = validate(JSON.parse(fs.readFileSync(FILE, 'utf8')))); }
/** Isolated tests only: replace this process's registry with another fully validated one (e.g. an activated
 * fixture with a throw-away mint). Not reachable from the environment or any request. */
function useForIsolatedTest(raw) { cached = validate(raw); return cached; }

/** Every public address the game custody signer must never equal. */
function reservedAddresses(reg = registry()) {
  return [...Object.values(reg.addresses), ...Object.values(reg.reserveAddresses), reg.squads.multisig, ...reg.squads.members, ...(reg.srMintAddress ? [reg.srMintAddress] : [])];
}

/** Public, read-only description (no RPC). */
function publicView(reg = registry()) {
  return {
    schema: reg.schema, policy: reg.policy, network: reg.network,
    destinations: ROLES.map(r => ({ ...reg.destinations[r], percent: reg.destinations[r].bps / 100 })),
    reserves: Object.values(reg.reserves).map(r => ({ ...r, percent: 0, vaultIndex: reg.squads.vaults[r.role] ?? null })),
    treasuryCustody: reg.treasuryCustody,
    treasuryMigration: reg.treasuryMigration ? { id: reg.treasuryMigration.id, status: reg.treasuryMigration.status, purpose: reg.treasuryMigration.purpose, legs: reg.treasuryMigration.legs.map(l => ({ ...l })) } : null,
    treasuryCustodyException: reg.treasuryCustodyException ? { address: reg.treasuryCustodyException.address, note: 'Owner-approved single-key Treasury: no on-chain spending restriction.' } : null,
    squads: { programId: reg.squads.programId, multisig: reg.squads.multisig, vaults: { ...reg.squads.vaults }, governs: Object.keys(reg.squads.vaults), threshold: reg.squads.threshold, members: reg.squads.members.length, timeLockSeconds: reg.squads.timeLockSeconds },
    gameCustody: reg.gameCustody ? { address: reg.gameCustody.address, purpose: reg.gameCustody.purpose, status: 'created — not active until launch' } : null,
    srMint: reg.srMintAddress ? { address: reg.srMintAddress, status: 'registered' } : { address: null, status: 'pending — the SR token has not launched' },
    withdrawalDeduction: { bps: reg.withdrawalTreasuryFeeBps, percent: reg.withdrawalTreasuryFeeBps / 100, destination: 'lockedTreasury', note: 'Separate ledger; never split again under 50/30/10/10.' },
    activation: { approved: reg.activation.approved },
    rules: ['Eligible net SR revenue from approved game services only.', 'Treasury → reward pool replenishment is an internal transfer and is not split again.',
      'No automatic burn.', 'RYO held in the Burn Reserve is reserved, not burned: only a finalized Token-2022 burn counts as burned.', 'Sensei SOL and marketplace sale proceeds are outside Chapter 04.'],
  };
}

module.exports = { MINT_PROGRAMS, ROLES, RATES, RESERVE_ROLES, SCHEMA, SQUADS_V4, RegistryError, base58, isPublicKey, validate, registry, useForIsolatedTest, reservedAddresses, publicView, FILE };
