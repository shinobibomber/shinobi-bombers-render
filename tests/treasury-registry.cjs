'use strict';
/* Chapter 04 public registry validation and the read-only on-chain verifier. Squads data is the captured public
 * Mainnet account (fixtures/squads-treasury-multisig.json); RPC is a local mock. No network is contacted. */
const assert = require('node:assert/strict'), fs = require('node:fs');
const web3 = require('../app/node_modules/@solana/web3.js'), spl = require('../app/node_modules/@solana/spl-token'), bs58 = require('../app/node_modules/bs58');
const R = require('../app/server/treasury-registry.cjs'), V = require('../app/server/treasury-verify.cjs');
const fixture = require('./fixtures/squads-treasury-multisig.json');
const raw = () => JSON.parse(fs.readFileSync(R.FILE, 'utf8'));
const reject = (mutate, pattern, label) => { const r = raw(); mutate(r); assert.throws(() => R.validate(r), pattern, label); };
(async () => {
 // 1. The committed registry: four public destinations, exact Chapter 04 rates, Squads 2-of-3, mint pending, not activated.
 const reg = R.registry();
 assert.deepEqual(reg.addresses, { lockedTreasury: '5wVBdFkQFLtu8qhZ1pg6RoD1LjWGUYL1erBVGBu11aGn', activeRewards: '3Rzz25x1BhGAawL8DkBKmJpmKw7CMcJ9TfgxCvenTi56', communityRewards: 'FZnW5DvUHer724sJzVr2Z8REEjK4EJeEnK9uDCekvDyL', economicReserve: 'B2aGUT7xVA8ZRzoa2XaTKUinNbyoV4VvgAvWBn1dSN8M' });
 assert.deepEqual(Object.values(reg.destinations).map(d => d.bps), [5000, 3000, 1000, 1000]);
 assert.equal(reg.squads.multisig, '38chAaSbcA4Stdg7EhCzzyVAbhz2BuKtHDfD6thsZSjX'); assert.equal(reg.squads.threshold, 2); assert.equal(reg.squads.members.length, 3);
 assert.equal(reg.srMintAddress, null, 'the SR token has not launched'); assert.equal(reg.activation.approved, false, 'financial routing is not activated');
 assert(Object.isFrozen(reg) && Object.isFrozen(reg.addresses) && Object.isFrozen(reg.squads.members));
 for (const a of [...Object.values(reg.addresses), reg.squads.multisig, ...reg.squads.members]) assert.equal(new web3.PublicKey(a).toBase58(), a, 'SDK agrees: ' + a);
 const view = R.publicView(); assert.equal(view.srMint.address, null); assert.equal(view.destinations.reduce((n, d) => n + d.percent, 0), 100); assert.equal(view.withdrawalDeduction.percent, 5);
 // The registry file holds public keys only.
 assert.doesNotMatch(fs.readFileSync(R.FILE, 'utf8'), /"[^"]*(secret|private|seed|keypair|mnemonic)[^"]*"\s*:/i, 'no key-like field names');

 // 2. Rejections.
 for (let i = 0; i < 500; i++) { const k = web3.Keypair.generate().publicKey.toBase58(); assert.equal(R.isPublicKey(k), true); }
 assert.equal(R.isPublicKey('0OIl' + 'x'.repeat(40)), false); assert.equal(R.isPublicKey(bs58.encode(Buffer.alloc(31, 7))), false); assert.equal(R.isPublicKey(bs58.encode(Buffer.alloc(33, 7))), false);
 reject(r => { r.destinations[1].address = 'not-base58!'; }, /valid 32-byte/);
 reject(r => { r.destinations[1].address = bs58.encode(Buffer.alloc(31, 9)); }, /valid 32-byte/);
 reject(r => { r.destinations[2].address = r.destinations[3].address; }, /distinct/);
 reject(r => { r.destinations[0].bps = 4000; }, /5000 bps/);
 reject(r => { r.destinations.pop(); }, /exactly four/);
 reject(r => { r.destinations[0].custody = 'phantom-single-key'; }, /Squads v4 vault or a reviewed program vault/);
 reject(r => { r.network = 'devnet'; }, /mainnet/);
 reject(r => { r.publicKeysOnly = false; }, /publicKeysOnly/);
 reject(r => { r.treasurySecret = 'x'; }, /not allowed/);
 reject(r => { r.squads.privateKey = 'x'; }, /not allowed/);
 reject(r => { r.notes = bs58.encode(web3.Keypair.generate().secretKey); }, /64-byte secret key/);
 reject(r => { r.notes = Array.from(web3.Keypair.generate().secretKey); }, /secret key bytes/);
 reject(r => { r.notes = 'abandon ability able about above absent absorb abstract absurd abuse access accident'; }, /seed phrase/);
 reject(r => { r.squads.programId = web3.Keypair.generate().publicKey.toBase58(); }, /Squads v4 program/);
 reject(r => { r.squads.threshold = 1; }, /threshold/);
 reject(r => { r.squads.threshold = 4; }, /threshold/);
 reject(r => { r.squads.members[2] = r.squads.members[0]; }, /distinct/);
 reject(r => { r.squads.members[2] = r.destinations[1].address; }, /must not also be a Chapter 04 destination/);
 reject(r => { r.srMintAddress = r.destinations[0].address; }, /must not equal a wallet/);
 reject(r => { r.withdrawalTreasuryFeeBps = 200; }, /500/);
 reject(r => { r.activation = { approved: true, reference: 'Approved by owner on 2027-01-01' }; }, /before srMintAddress/);
 reject(r => { r.srMintAddress = web3.Keypair.generate().publicKey.toBase58(); r.activation = { approved: true, reference: '' }; }, /approval reference/);
 { const r = raw(); r.srMintAddress = web3.Keypair.generate().publicKey.toBase58(); r.activation = { approved: true, reference: 'Owner approval reference #1' }; assert.equal(R.validate(r).activation.approved, true); }
 assert.deepEqual(R.reservedAddresses().length, 4 + 1 + 3);

 // 3. Squads v4 decoding of the real captured account.
 const data = Buffer.from(fixture.dataBase64, 'base64'), ms = V.decodeMultisig(data);
 assert.equal(data.subarray(0, 8).toString('hex'), 'e07479ba44a14fec'); assert.equal(V.MULTISIG_DISCRIMINATOR.toString('hex'), 'e07479ba44a14fec');
 assert.equal(ms.threshold, 2); assert.equal(ms.timeLockSeconds, 0); assert.equal(ms.configAuthority, null); assert.equal(ms.transactionIndex, '0'); assert.equal(ms.rentCollector, null);
 assert.deepEqual(ms.members.map(m => m.key).sort(), [...reg.squads.members].sort()); assert(ms.members.every(m => m.initiate && m.vote && m.execute));
 assert.equal(V.vaultAddress(reg.squads.multisig, 0, reg.squads.programId), reg.addresses.lockedTreasury, 'Squads vault #0 is the registered Treasury');
 assert.notEqual(V.vaultAddress(reg.squads.multisig, 1, reg.squads.programId), reg.addresses.lockedTreasury);
 assert.throws(() => V.decodeMultisig(Buffer.alloc(40)), /too small/); { const bad = Buffer.from(data); bad[3] ^= 0xff; assert.throws(() => V.decodeMultisig(bad), /discriminator/); }

 // 4. Full snapshot against a mocked finalized RPC.
 const mint = web3.Keypair.generate().publicKey; let genesis = V.MAINNET_GENESIS, fail = false, calls = 0; const accounts = new Map(), owned = new Map();
 const mintData = (decimals = 6, mintAuthority = null, program = spl.TOKEN_PROGRAM_ID) => { const d = Buffer.alloc(spl.MINT_SIZE); spl.MintLayout.encode({ mintAuthorityOption: mintAuthority ? 1 : 0, mintAuthority: mintAuthority || web3.PublicKey.default, supply: 10n ** 15n, decimals, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: web3.PublicKey.default }, d); return { owner: program, data: d, lamports: 1 }; };
 accounts.set(reg.squads.multisig, { owner: new web3.PublicKey(fixture.owner), data, lamports: fixture.lamports });
 accounts.set(reg.addresses.lockedTreasury, { owner: web3.SystemProgram.programId, data: Buffer.alloc(0), lamports: fixture.vault.lamports });
 accounts.set(reg.addresses.communityRewards, { owner: web3.SystemProgram.programId, data: Buffer.alloc(0), lamports: 5e8 });
 accounts.set(mint.toBase58(), mintData());
 const connection = {
  async getGenesisHash() { calls++; if (fail) throw Error('down'); return genesis; },
  async getAccountInfo(k) { if (fail) throw Error('down'); return accounts.has(k.toBase58()) ? accounts.get(k.toBase58()) : null; },
  async getParsedTokenAccountsByOwner(o) { return { value: (owned.get(o.toBase58()) || []).map(amount => ({ account: { owner: spl.TOKEN_PROGRAM_ID, data: { parsed: { info: { mint: mint.toBase58(), owner: o.toBase58(), tokenAmount: { amount: String(amount), decimals: 6 } } } } } })) }; },
 };
 let snap = await V.snapshot(connection);
 assert.equal(snap.status, 'verified'); assert.equal(snap.squads.status, 'verified'); assert.equal(snap.mint.status, 'pending', 'no registered mint yet');
 assert.deepEqual(Object.fromEntries(Object.entries(snap.destinations).map(([r, d]) => [r, [d.verification.status, d.solLamports]])), { lockedTreasury: ['verified', 1000000], activeRewards: ['verified', 0], communityRewards: ['verified', 5e8], economicReserve: ['verified', 0] });
 assert.equal(snap.destinations.activeRewards.verification.state, 'unfunded'); assert.deepEqual(snap.alerts, []);
 assert.equal(snap.externalHeld.status, 'pending'); assert.equal(snap.externalHeld.srRaw, null, 'no placeholder balance before the mint exists');
 // With the mint: balances in base units, Treasury token account checked.
 owned.set(reg.addresses.lockedTreasury, [5000000000n]); owned.set(reg.addresses.activeRewards, [1n, 2n]);
 snap = await V.snapshot(connection, { mint: mint.toBase58() });
 assert.equal(snap.mint.status, 'verified'); assert.equal(snap.mint.program, 'spl-token'); assert.equal(snap.destinations.lockedTreasury.srRaw, '5000000000'); assert.equal(snap.destinations.activeRewards.srRaw, '3'); assert.equal(snap.destinations.lockedTreasury.tokenAccount.state, 'absent');
 assert.deepEqual([snap.externalHeld.status, snap.externalHeld.srRaw], ['verified', '5000000003'], 'external total = sum of the four wallets');
 { const partial = { ...connection, getParsedTokenAccountsByOwner: async o => { if (o.toBase58() === reg.addresses.economicReserve) throw Error('rpc'); return connection.getParsedTokenAccountsByOwner(o); } }; const s2 = await V.snapshot(partial, { mint: mint.toBase58() }); assert.equal(s2.externalHeld.status, 'unverified'); assert.equal(s2.externalHeld.srRaw, null, 'no partial total'); }
 // Mint incompatibilities are blocking, never silently accepted.
 accounts.set(mint.toBase58(), mintData(6, null, spl.TOKEN_2022_PROGRAM_ID)); snap = await V.snapshot(connection, { mint: mint.toBase58() }); assert.match(snap.mint.blocking.join(' '), /Token-2022/); assert(snap.alerts.some(a => a.severity === 'critical' && /mint/.test(a.signal)));
 accounts.set(mint.toBase58(), mintData(9)); assert.match((await V.verifyMint(connection, mint.toBase58())).blocking.join(' '), /9 decimals/);
 accounts.set(mint.toBase58(), mintData(6, web3.Keypair.generate().publicKey)); const withAuthority = await V.verifyMint(connection, mint.toBase58()); assert.equal(withAuthority.status, 'mismatch'); assert.match(withAuthority.problems.join(' '), /Mint authority/);
 accounts.delete(mint.toBase58()); assert.equal((await V.verifyMint(connection, mint.toBase58())).status, 'mismatch');
 // Governance drift is critical: threshold, members, config authority; and a custody signer that is a member.
 const drift = async mutate => { const d = Buffer.from(data); mutate(d); accounts.set(reg.squads.multisig, { owner: new web3.PublicKey(fixture.owner), data: d, lamports: 1 }); const s = await V.snapshot(connection); accounts.set(reg.squads.multisig, { owner: new web3.PublicKey(fixture.owner), data, lamports: 1 }); return s; };
 for (const [label, mutate, pattern] of [['threshold', d => d.writeUInt16LE(1, 72), /Threshold is 1/], ['config authority', d => web3.Keypair.generate().publicKey.toBuffer().copy(d, 40), /config authority/], ['member', d => web3.Keypair.generate().publicKey.toBuffer().copy(d, 100), /member set differs/], ['time lock', d => d.writeUInt32LE(60, 74), /Time lock is 60/], ['vote permission', d => { d[132] = 1; d[165] = 1; }, /Fewer voting members/]]) {
  const s = await drift(mutate); assert.equal(s.status, 'mismatch', label); assert.match(s.squads.problems.join(' '), pattern, label); assert(s.alerts.some(a => a.severity === 'critical' && /governance drift/.test(a.signal)), label);
 }
 snap = await V.snapshot(connection, { custody: reg.squads.members[2] }); assert.equal(snap.status, 'mismatch'); assert.match(snap.squads.problems.join(' '), /must not be a Squads member/);
 snap = await V.snapshot(connection, { custody: reg.addresses.economicReserve }); assert.equal(snap.destinations.economicReserve.verification.status, 'mismatch');
 accounts.set(reg.addresses.activeRewards, { owner: spl.TOKEN_PROGRAM_ID, data: Buffer.alloc(0), lamports: 1 }); assert.equal((await V.snapshot(connection)).destinations.activeRewards.verification.status, 'mismatch'); accounts.delete(reg.addresses.activeRewards);
 // Wrong network or RPC failure: unverified, never zero balances.
 genesis = web3.Keypair.generate().publicKey.toBase58(); snap = await V.snapshot(connection); assert.equal(snap.status, 'unverified'); assert.equal(snap.destinations, undefined); assert.match(snap.problems[0], /not Solana Mainnet/); genesis = V.MAINNET_GENESIS;
 fail = true; snap = await V.snapshot(connection); assert.equal(snap.status, 'unverified'); fail = false;
 { const flaky = { ...connection, getAccountInfo: async () => { throw Error('rate limited'); } }; const s = await V.snapshot(flaky); assert.equal(s.status, 'unverified'); assert.equal(s.destinations.communityRewards.solLamports, null, 'unavailable is null, never 0'); }

 // 5. Public summary hides member keys; the cache bounds RPC load.
 const pub = JSON.stringify(V.publicSummary(await V.snapshot(connection)));
 for (const m of reg.squads.members) assert(!pub.includes(m), 'member keys are not published on the transparency page');
 assert(pub.includes(reg.addresses.lockedTreasury) && pub.includes('"threshold":2'));
 let clock = 0; const cached = V.cachedSnapshot(() => connection, { ttl: 60000, clock: () => clock }); calls = 0;
 await Promise.all([cached(), cached(), cached()]); await cached(); assert.equal(calls, 1, 'concurrent and repeat requests share one RPC snapshot');
 clock = 60001; await cached(); assert.equal(calls, 2, 'refreshes after 60 s');
 console.log('PASS: treasury registry — public-only validation (base58/32-byte, distinct, exact bps, no secrets/seed phrases, Squads settings, activation rules); verifier — real Squads v4 bytes, vault PDA, drift/custody/mint/network failures as explicit states, hidden member keys, bounded RPC cache.');
})().catch(e => { console.error(e); process.exitCode = 1; });
