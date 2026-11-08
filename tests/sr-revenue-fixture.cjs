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
 if (key === reg.addresses.lockedTreasury) return { owner: new PublicKey('11111111111111111111111111111111'), data: Buffer.alloc(0), lamports: squadsFixture.vault.lamports, executable: false };
 if ([reg.addresses.activeRewards, reg.addresses.communityRewards, reg.addresses.economicReserve].includes(key)) return null;
 if (mint && key === spl.getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(reg.addresses.lockedTreasury), true).toBase58()) return null;
 return undefined;
}
async function configure(store) {
 const cfg = { enabled: true, version: 2, destinations: destinations(), lockedTreasuryMultisig: registryModule().registry().squads.multisig, products: ['summon', 'fusion', 'dojo', 'training'], evidence: 'Isolated approved fixture policy' };
 await store.pool.query("INSERT INTO ryo_admin_control(scope,config,version,installed) VALUES($1,$2,1,$3) ON CONFLICT(scope) DO UPDATE SET config=ryo_admin_control.config||$2", [store.scope, JSON.stringify({ revenueRouting: cfg }), store.now()]);
 return cfg;
}
/** Approve a reward budget directly (fixture shortcut for the two-person proposal flow). */
async function budget(store, value = { dailyCapRyo: 1000000, perClaimMaxRyo: 1000000, evidence: 'Isolated reward budget fixture' }) {
 await store.pool.query("INSERT INTO ryo_admin_control(scope,config,version,installed) VALUES($1,$2,1,$3) ON CONFLICT(scope) DO UPDATE SET config=ryo_admin_control.config||$2", [store.scope, JSON.stringify({ rewardBudget: value }), store.now()]);
}
/** Record a verified Active Reward Pool → custody top-up directly (fixture shortcut). */
async function topUp(store, ryo, signature = 'fixture-topup-' + Math.random().toString(36).slice(2)) {
 await store.pool.query('INSERT INTO ryo_revenue_replenishments(scope,signature,source,amount_raw,proposal_id,evidence,created) VALUES($1,$2,$3,$4,$5,$6,$7)', [store.scope, signature, 'activeRewards', String(BigInt(ryo) * 1000000n), 'fixture-' + signature, JSON.stringify({ fixture: true }), store.now()]);
}
/** Model an activated live registry (throw-away mint, committed approval) inside this test process only.
 * Isolated tests sign with throw-away custody keys, so the recorded game custody address is replaced (or removed). */
function activate(mint, { custody = null } = {}) {
 const raw = JSON.parse(fs.readFileSync(registryModule().FILE, 'utf8'));
 if (custody) raw.gameCustody = { address: custody, purpose: 'Isolated test custody' }; else delete raw.gameCustody;
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
 const raw = JSON.parse(fs.readFileSync(registryModule().FILE, 'utf8')); delete raw.gameCustody; registryModule().useForIsolatedTest(raw);
}
module.exports = { stamp, multisig, squadsAccount, chainAccount, configure, budget, topUp, activate, liveEconomy, destinations, squadsFixture, owner };
