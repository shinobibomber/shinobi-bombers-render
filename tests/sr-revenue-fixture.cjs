/* Isolated test evidence for Store-only fixtures; financial-server and sr-revenue exercise real SDK wires. */
'use strict';
const { Keypair, PublicKey } = require('../app/node_modules/@solana/web3.js');
const spl = require('../app/node_modules/@solana/spl-token');
const owner = () => Keypair.generate().publicKey.toBase58();
const destinations = { lockedTreasury: owner(), activeRewards: owner(), communityRewards: owner(), economicReserve: owner() };
function stamp(q, transaction) {
 if (q.revenueDistribution) Object.assign(q.revenueDistribution, { destinations, configVersion: 1, lockProof: { verified: true, kind: 'isolated-store-fixture' } });
 return transaction;
}
function multisig() {
 const data = Buffer.alloc(spl.MULTISIG_SIZE), values = { m: 2, n: 2, isInitialized: true };
 for (let n = 1; n <= 11; n++) values['signer' + n] = n <= 2 ? Keypair.generate().publicKey : PublicKey.default;
 spl.MultisigLayout.encode(values, data); return { owner: spl.TOKEN_PROGRAM_ID, data };
}
async function configure(store, treasury, lockedTreasury) {
 const cfg = { enabled: true, version: 1, destinations: { lockedTreasury, activeRewards: treasury, communityRewards: owner(), economicReserve: owner() }, products: ['summon', 'fusion', 'dojo', 'training'], evidence: 'Isolated approved fixture policy' };
 await store.pool.query("INSERT INTO ryo_admin_control(scope,config,version,installed) VALUES($1,$2,1,$3) ON CONFLICT(scope) DO UPDATE SET config=$2", [store.scope, JSON.stringify({ revenueRouting: cfg }), store.now()]);
 return cfg;
}
// Model Mainnet economy selection inside an isolated process, without RPC or changing the actual build.
function liveEconomy() {
 const network=require('../app/server/network.cjs');network.built=()=>network.NETWORKS.mainnet;
 // Explicitly open only this in-memory test process, so financial/admin checks get past launch gates.
 for(const name of Object.values(require('../app/server/launch-gates.cjs').GATES))process.env[name]='on';
}
module.exports = { stamp, multisig, configure, liveEconomy };
