/* Isolated test evidence for Store-only fixtures; financial-server and sr-revenue exercise real SDK wires.
 * Destinations are the real public Chapter 04 registry addresses. The Squads Treasury is answered from the
 * captured public Mainnet account bytes (fixtures/squads-treasury-multisig.json): no RPC is ever contacted. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { Keypair, PublicKey } = require('../app/node_modules/@solana/web3.js');
const spl = require('../app/node_modules/@solana/spl-token');
const squadsFixture = require('./fixtures/squads-treasury-multisig.json');
const owner = () => Keypair.generate().publicKey.toBase58();
const registryModule = () => require('../app/server/treasury-registry.cjs');
const destinations = () => ({ ...registryModule().registry().addresses });
function stamp(q, transaction) {
 if (q.revenueDistribution) Object.assign(q.revenueDistribution, { destinations: destinations(), configVersion: 1, lockProof: { verified: true, kind: 'isolated-store-fixture' } });
 return transaction;
}
/** Legacy classic SPL Token multisig account (still used to prove such an account is now rejected). */
function multisig() {
 const data = Buffer.alloc(spl.MULTISIG_SIZE), values = { m: 2, n: 2, isInitialized: true };
 for (let n = 1; n <= 11; n++) values['signer' + n] = n <= 2 ? Keypair.generate().publicKey : PublicKey.default;
 spl.MultisigLayout.encode(values, data); return { owner: spl.TOKEN_PROGRAM_ID, data };
}
/** The captured Squads multisig account; `mutate(buffer)` lets a test corrupt a copy. */
function squadsAccount(mutate) {
 const data = Buffer.from(squadsFixture.dataBase64, 'base64'); if (mutate) mutate(data);
 return { owner: new PublicKey(squadsFixture.owner), data, lamports: squadsFixture.lamports, executable: false };
}
/**
 * Mocked finalized getAccountInfo for registry accounts. Returns undefined for anything else so a test's own
 * mock can answer (mint, custody…). Phantom wallets are unfunded (null); the Treasury vault is System-owned.
 */
function chainAccount(pubkey, mint, overrides = {}) {
 const key = pubkey.toBase58(), reg = registryModule().registry();
 if (key in overrides) return overrides[key];
 if (key === reg.squads.multisig) return squadsAccount();
 // Every Squads-governed vault (the RYO Burn Reserve; the Treasury too in the squadsTreasury shape) is a System-owned vault account.
 if (Object.values(reg.squads.vaultAddresses).includes(key)) return { owner: new PublicKey('11111111111111111111111111111111'), data: Buffer.alloc(0), lamports: squadsFixture.vault.lamports, executable: false };
 // Plain wallets (and the owner-approved single-key Treasury) are unfunded in fixtures.
 if ([reg.addresses.activeRewards, reg.addresses.communityRewards, reg.addresses.economicReserve, ...(reg.squads.vaults.lockedTreasury === undefined ? [reg.addresses.lockedTreasury] : [])].includes(key)) return null;
 const program = reg.srMintProgram === 'token-2022' ? spl.TOKEN_2022_PROGRAM_ID : spl.TOKEN_PROGRAM_ID;
 if (mint && [reg.addresses.lockedTreasury, ...Object.values(reg.reserveAddresses)].some(o => key === spl.getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(o), true, program).toBase58())) return null;
 return undefined;
}
async function configure(store) {
 const cfg = { enabled: true, version: 2, destinations: destinations(), lockedTreasuryMultisig: registryModule().registry().squads.vaults.lockedTreasury !== undefined ? registryModule().registry().squads.multisig : null, products: ['summon', 'fusion', 'dojo', 'training'], evidence: 'Isolated approved fixture policy' };
 await store.pool.query("INSERT INTO ryo_admin_control(scope,config,version,installed) VALUES($1,$2,1,$3) ON CONFLICT(scope) DO UPDATE SET config=ryo_admin_control.config||$2", [store.scope, JSON.stringify({ revenueRouting: cfg }), store.now()]);
 return cfg;
}
/** Approve a reward budget directly (fixture shortcut for the two-person proposal flow). */
// minClaimRyo: 1 keeps the pre-minimum fixture scenarios (small Chests); the 100,000 minimum itself: tests/min-claim.cjs.
async function budget(store, value = { dailyCapRyo: 1000000, perClaimMaxRyo: 1000000, minClaimRyo: 1, evidence: 'Isolated reward budget fixture' }) {
 await store.pool.query("INSERT INTO ryo_admin_control(scope,config,version,installed) VALUES($1,$2,1,$3) ON CONFLICT(scope) DO UPDATE SET config=ryo_admin_control.config||$2", [store.scope, JSON.stringify({ rewardBudget: value }), store.now()]);
}
/** Record a verified Active Reward Pool → custody top-up directly (fixture shortcut). */
async function topUp(store, ryo, signature = 'fixture-topup-' + Math.random().toString(36).slice(2)) {
 await store.pool.query('INSERT INTO ryo_revenue_replenishments(scope,signature,source,amount_raw,proposal_id,evidence,created) VALUES($1,$2,$3,$4,$5,$6,$7)', [store.scope, signature, 'activeRewards', String(BigInt(ryo) * 1000000n), 'fixture-' + signature, JSON.stringify({ fixture: true }), store.now()]);
}
/** Model an activated live registry (throw-away mint, committed approval) inside this test process only.
 * Isolated tests sign with throw-away custody keys, so the recorded game custody address is replaced (or removed). */
/** squadsTreasury: model the Treasury as Squads vault #1 of the registered multisig (the RYO Burn Reserve stays vault #0), the
 * protected shape the registry supports for a later move out of the owner-approved single-key Treasury. Default: committed shape. */
function squadsTreasuryShape(raw) {
 const v1 = require('../app/server/treasury-verify.cjs').vaultAddress(raw.squads.multisig, 1, raw.squads.programId);
 raw.destinations[0] = { ...raw.destinations[0], address: v1, custody: 'squads-v4-vault' }; delete raw.treasuryCustodyException; raw.squads.vaults = { ryoBurnReserve: 0, lockedTreasury: 1 };
 // A Treasury change is always a registered migration leg (here: temporary/single-key Treasury → vault #1).
 if (raw.treasuryMigration) { const m = raw.treasuryMigration; m.legs.push({ leg: m.legs.length + 1, from: m.legs[m.legs.length - 1].to, to: v1, path: 'direct' }); }
 return raw;
}
function activate(mint, { custody = null, program = null, squadsTreasury = false } = {}) {
 const raw = JSON.parse(fs.readFileSync(registryModule().FILE, 'utf8'));
 if (squadsTreasury) squadsTreasuryShape(raw);
 if (custody) raw.gameCustody = { address: custody, purpose: 'Isolated test custody' }; else delete raw.gameCustody;
 raw.srMintProgram = program || 'spl-token';   // throw-away test mints are classic unless a test asks for Token-2022
 raw.srMintAddress = typeof mint === 'string' ? mint : mint.toBase58(); raw.activation = { approved: true, reference: 'Isolated test activation fixture' };
 return registryModule().useForIsolatedTest(raw);
}
// Model Mainnet economy selection inside an isolated process, without RPC or changing the actual build.
function liveEconomy({ routing = true } = {}) {
 const network=require('../app/server/network.cjs');network.built=()=>network.NETWORKS.mainnet;
 // Explicitly open only this in-memory test process, so financial/admin checks get past launch gates.
 for(const name of Object.values(require('../app/server/launch-gates.cjs').GATES))process.env[name]='on';
 if (routing) process.env.SR_REVENUE_ROUTING_ENABLED = 'on';
 // Throw-away custody keys in isolated tests: drop the recorded live custody address in this process only.
 // The committed registry has the released mint and activation (2026-11-09); isolated tests start from the pre-activation
 // state and register their own throw-away mint with activate().
 const raw = JSON.parse(fs.readFileSync(registryModule().FILE, 'utf8')); delete raw.gameCustody;
 raw.srMintAddress = null; delete raw.srMintProgram; raw.activation = { approved: false, reference: null }; registryModule().useForIsolatedTest(raw);
}
/** Token-2022 account bytes in the real on-chain layout: the classic base (82-byte mint or 165-byte account), padding to
 * 165, the account-type byte (1 mint, 2 account) and TLV entries (u16 type, u16 length, value) for the named extensions. */
const EXTENSION_LENGTHS = { ImmutableOwner: 0, MetadataPointer: 64, TokenMetadata: 96, TransferFeeConfig: 108, TransferHook: 64, PermanentDelegate: 32, NonTransferable: 0, DefaultAccountState: 1 };
function token2022(base, kind, names) {
 const parts = [Buffer.alloc(spl.ACCOUNT_SIZE), Buffer.from([kind === 'mint' ? 1 : 2])];
 Buffer.from(base).copy(parts[0]);
 for (const name of names) {
  const len = EXTENSION_LENGTHS[name], head = Buffer.alloc(4);
  if (len == null || spl.ExtensionType[name] == null) throw Error('Unknown test extension ' + name);
  head.writeUInt16LE(spl.ExtensionType[name], 0); head.writeUInt16LE(len, 2); parts.push(head, Buffer.alloc(len, 3));
 }
 return Buffer.concat(parts);
}
module.exports = { squadsTreasuryShape, stamp, multisig, squadsAccount, chainAccount, configure, budget, topUp, activate, liveEconomy, destinations, squadsFixture, owner, token2022 };
