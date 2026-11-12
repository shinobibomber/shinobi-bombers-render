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
 // 1. The committed registry (v2, Treasury migration 2026-11-12): four public destinations, exact Chapter 04 rates, the owner-approved
 // single-key Treasury, the former Squads Treasury vault re-designated as the RYO Burn Reserve (0 bps), Squads 2-of-3, mint registered.
 const reg = R.registry();
 const TREASURY = 'GPbgpbtxEiZtsWnjxq3MKbk9gaoqFNEbpTRqn8t7htjE', RESERVE = '5wVBdFkQFLtu8qhZ1pg6RoD1LjWGUYL1erBVGBu11aGn';
 assert.equal(reg.schema, 'shinobi-treasury-registry-v2');
 assert.deepEqual(reg.reserveAddresses, { ryoBurnReserve: RESERVE }, 'the old Squads vault address is preserved as the RYO Burn Reserve');
 assert.equal(reg.reserves.ryoBurnReserve.label, 'RYO Burn Reserve'); assert.equal(reg.reserves.ryoBurnReserve.custody, 'squads-v4-vault'); assert.equal('bps' in reg.reserves.ryoBurnReserve, false, 'no revenue allocation');
 assert.deepEqual({ ...reg.squads.vaults }, { ryoBurnReserve: 0 }); assert.equal(reg.squads.vaultAddresses.ryoBurnReserve, RESERVE);
 assert.equal(reg.treasuryCustody, 'single-key'); assert.equal(reg.treasuryCustodyException.address, TREASURY); assert.match(reg.treasuryCustodyException.reference, /Owner explicitly approved a single-key Treasury/);
 assert.equal(reg.destinations.lockedTreasury.label, 'Shinobi Bombers Treasury'); assert.equal(reg.destinations.lockedTreasury.custody, 'phantom-single-key');
 assert.notEqual(reg.addresses.lockedTreasury, reg.gameCustody.address, 'the Treasury is never the game custody wallet');
 assert.deepEqual(reg.addresses, { lockedTreasury: TREASURY, activeRewards: '3Rzz25x1BhGAawL8DkBKmJpmKw7CMcJ9TfgxCvenTi56', communityRewards: 'FZnW5DvUHer724sJzVr2Z8REEjK4EJeEnK9uDCekvDyL', economicReserve: 'B2aGUT7xVA8ZRzoa2XaTKUinNbyoV4VvgAvWBn1dSN8M' });
 assert.deepEqual(Object.values(reg.destinations).map(d => d.bps), [5000, 3000, 1000, 1000]);
 assert.equal(reg.squads.multisig, '38chAaSbcA4Stdg7EhCzzyVAbhz2BuKtHDfD6thsZSjX'); assert.equal(reg.squads.threshold, 2); assert.equal(reg.squads.members.length, 3);
 assert.equal(reg.srMintAddress, '8Azsv23uZnZdmeyA6Vg6BagkT1SHEdiK4QqV3vycpump', 'the released SR mint is registered (owner approval 2026-11-09)'); assert.equal(reg.srMintProgram, 'token-2022');
 assert.equal(reg.gameCustody.address, 'CqJCKKq9Q9haCtdVuHLZfCkfoDnRievuTaJ9doHatwBT', 'the created game custody wallet is recorded (public address only)');
 assert(!R.reservedAddresses().includes(reg.gameCustody.address), 'custody is checked separately from reserved addresses'); assert.equal(reg.activation.approved, true, 'activation approved by the owner'); assert.match(reg.activation.reference, /Owner approved SR activation of mint 8Azsv23uZnZdmeyA6Vg6BagkT1SHEdiK4QqV3vycpump/);
 assert(Object.isFrozen(reg) && Object.isFrozen(reg.addresses) && Object.isFrozen(reg.squads.members));
 for (const a of [...Object.values(reg.addresses), reg.squads.multisig, ...reg.squads.members]) assert.equal(new web3.PublicKey(a).toBase58(), a, 'SDK agrees: ' + a);
 const view = R.publicView(); assert.deepEqual(view.reserves.map(r => [r.role, r.address, r.percent, r.vaultIndex]), [['ryoBurnReserve', RESERVE, 0, 0]]); assert.equal(view.treasuryCustody, 'single-key');
 assert(view.rules.includes('No automatic burn.') && view.rules.some(r => /reserved, not burned/.test(r)));
 assert.equal(view.srMint.address, '8Azsv23uZnZdmeyA6Vg6BagkT1SHEdiK4QqV3vycpump'); assert.equal(view.destinations.reduce((n, d) => n + d.percent, 0), 100); assert.equal(view.withdrawalDeduction.percent, 5);
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
 // Treasury custody: a single-key Treasury only with an exact, referenced owner exception; never silently.
 reject(r => { delete r.treasuryCustodyException; }, /explicit owner-approved treasuryCustodyException/);
 reject(r => { r.treasuryCustodyException.address = r.destinations[1].address; }, /name the registered Treasury address exactly/);
 reject(r => { r.treasuryCustodyException.reference = 'ok'; }, /owner approval reference/);
 reject(r => { r.treasuryCustodyException.approved = false; }, /must be an approved object/);
 reject(r => { r.destinations[0].custody = 'squads-v4-vault'; }, /only valid for a single-key Treasury/);
 reject(r => { r.destinations[0].address = r.gameCustody.address; r.treasuryCustodyException.address = r.gameCustody.address; }, /game custody wallet must be separate/);
 // Reserves: 0 bps, Squads vault, distinct, governed by squads.vaults.
 reject(r => { r.reserves[0].bps = 500; }, /no revenue allocation/);
 reject(r => { r.reserves[0].bps = 0; }, /no revenue allocation/);
 reject(r => { r.reserves[0].custody = 'phantom-single-key'; }, /must be a Squads v4 vault/);
 reject(r => { r.reserves[0].address = r.destinations[0].address; }, /reserve addresses must be distinct/);
 reject(r => { r.reserves[0].role = 'lockedTreasury'; }, /reserve role/);
 reject(r => { r.reserves.push({ ...r.reserves[0] }); }, /listed once/);
 reject(r => { r.reserves = {}; }, /reserves must be a list/);
 reject(r => { r.squads.vaults = {}; }, /squads.vaults must list exactly/);
 reject(r => { r.squads.vaults.lockedTreasury = 1; }, /squads.vaults must list exactly/);
 reject(r => { r.squads.vaults.ryoBurnReserve = 256; }, /0–255/);
 reject(r => { delete r.squads.vaults; }, /squads.vaults must map/);
 reject(r => { r.squads.members[1] = r.reserves[0].address; }, /must not also be a Chapter 04 destination/);
 reject(r => { r.squads.multisig = r.reserves[0].address; }, /must not be a destination|must not also be/);
 reject(r => { r.gameCustody.address = r.reserves[0].address; }, /game custody wallet must be separate/);
 reject(r => { r.srMintAddress = r.reserves[0].address; }, /must not equal a wallet/);
 reject(r => { r.schema = 'shinobi-treasury-registry-v1'; }, /unknown schema/);
 // Treasury migration (owner decision 2026-11-12): relocations only along the registered legs, closed once completed.
 assert.deepEqual(reg.treasuryMigration.legs.map(l => [l.leg, l.from, l.to, l.path]), [[1, RESERVE, TREASURY, 'squads-vault-execute']], 'one leg: GPbg… is the Treasury until the owner asks for a change');
 const leg2 = r => (r.treasuryMigration.legs.push({ leg: 2, from: r.treasuryMigration.legs[0].to, to: null, path: 'direct' }), r.treasuryMigration.legs[1]);   // a later, hypothetical move assert.equal(reg.treasuryMigration.status, 'open');
 reject(r => { r.treasuryMigration.status = 'paused'; }, /status must be/);
 reject(r => { r.treasuryMigration.status = 'completed'; }, /reconciliation reference/);
 { const r = raw(); r.treasuryMigration.status = 'completed'; r.treasuryMigration.completedReference = 'Reconciled 2026-12-01 by the owner'; assert.equal(R.validate(r).treasuryMigration.status, 'completed'); }
 reject(r => { r.treasuryMigration.legs[0].leg = 2; }, /numbered 1, 2/);
 reject(r => { r.treasuryMigration.legs[0].path = 'direct'; }, /can only move funds through Squads/);
 reject(r => { leg2(r).path = 'squads-vault-execute'; }, /must start at a registered Squads vault/);
 reject(r => { leg2(r).from = r.destinations[1].address; }, /must start where leg 1 ended|never touch/);
 reject(r => { leg2(r).to = r.gameCustody.address; }, /never touch game custody/);
 reject(r => { leg2(r).to = r.destinations[1].address; }, /never touch game custody, the reward pools/);
 reject(r => { leg2(r).to = r.squads.members[0]; }, /never touch/);
 reject(r => { leg2(r).to = r.reserves[0].address; }, /Burn Reserve funding, not a Treasury relocation/);
 reject(r => { leg2(r).to = web3.Keypair.generate().publicKey.toBase58(); }, /must end at the registered Treasury/);
 reject(r => { leg2(r); r.treasuryMigration.legs[0].to = null; }, /only the last treasuryMigration leg/);
 reject(r => { r.treasuryMigration.legs.push({ leg: 3, from: r.treasuryMigration.legs[0].from, to: null, path: 'squads-vault-execute' }); }, /numbered 1, 2/);
 // Leg 2 completes into the new Squads Treasury vault once it is registered (example: vault #1 of the same multisig).
 { const r = raw(), v1 = V.vaultAddress(r.squads.multisig, 1, r.squads.programId); r.destinations[0] = { ...r.destinations[0], address: v1, custody: 'squads-v4-vault' }; delete r.treasuryCustodyException; r.squads.vaults = { ryoBurnReserve: 0, lockedTreasury: 1 };
   leg2(r).to = v1; const g = R.validate(r); assert.equal(g.treasuryMigration.legs[1].to, v1); assert.equal(g.addresses.lockedTreasury, v1); }
 { const r = raw(); delete r.treasuryMigration; assert.equal(R.validate(r).treasuryMigration, null, 'the migration block is optional'); }
 assert.deepEqual(R.publicView().treasuryMigration.legs.map(l => l.leg), [1]);
 // Future-compatible: the Treasury moved into Squads vault #1 of the same multisig validates without a schema change.
 { const r = raw(); const v1 = V.vaultAddress(r.squads.multisig, 1, r.squads.programId); r.destinations[0] = { ...r.destinations[0], address: v1, custody: 'squads-v4-vault' }; delete r.treasuryCustodyException; r.squads.vaults = { ryoBurnReserve: 0, lockedTreasury: 1 }; r.treasuryMigration.legs.push({ leg: 2, from: r.treasuryMigration.legs[0].to, to: v1, path: 'direct' });
   const g = R.validate(r); assert.equal(g.treasuryCustody, 'squads'); assert.equal(g.squads.vaultAddresses.lockedTreasury, v1); assert.equal(g.treasuryCustodyException, null);
   r.squads.vaults = { ryoBurnReserve: 0, lockedTreasury: 0 }; assert.throws(() => R.validate(r), /own vault index/); }
 // While the migration is open a Treasury change WITHOUT a registered leg is refused; after completion it is a normal reviewed change.
 { const r = raw(), v1 = V.vaultAddress(r.squads.multisig, 1, r.squads.programId); r.destinations[0] = { ...r.destinations[0], address: v1, custody: 'squads-v4-vault' }; delete r.treasuryCustodyException; r.squads.vaults = { ryoBurnReserve: 0, lockedTreasury: 1 };
   assert.throws(() => R.validate(r), /needs its own registered migration leg/); r.treasuryMigration.status = 'completed'; r.treasuryMigration.completedReference = 'Reconciled by the owner'; assert.equal(R.validate(r).addresses.lockedTreasury, v1); }
 // Without any reserve the Treasury must be the Squads vault (old shape), never single-key by default.
 { const r = raw(); delete r.reserves; assert.throws(() => R.validate(r), /squads.vaults must list exactly/); }
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
 reject(r => { r.gameCustody.address = r.destinations[1].address; }, /game custody wallet must be separate/);
 reject(r => { r.gameCustody.address = r.squads.members[0]; }, /game custody wallet must be separate/);
 reject(r => { r.gameCustody.address = r.squads.multisig; }, /game custody wallet must be separate/);
 reject(r => { r.gameCustody.address = 'not-a-key'; }, /gameCustody.address/);
 reject(r => { r.gameCustody.secretKey = [1, 2]; }, /not allowed/);
 { const r = raw(); delete r.gameCustody; assert.equal(R.validate(r).gameCustody, null, 'gameCustody is optional'); }
 reject(r => { r.withdrawalTreasuryFeeBps = 200; }, /500/);
 reject(r => { r.srMintAddress = null; r.activation = { approved: true, reference: 'Approved by owner on 2027-01-01' }; }, /before srMintAddress/);
 reject(r => { r.srMintAddress = web3.Keypair.generate().publicKey.toBase58(); r.activation = { approved: true, reference: '' }; }, /approval reference/);
 { const r = raw(); r.srMintAddress = web3.Keypair.generate().publicKey.toBase58(); r.activation = { approved: true, reference: 'Owner approval reference #1' }; assert.equal(R.validate(r).activation.approved, true); }
 assert.deepEqual(R.reservedAddresses().length, 4 + 1 + 1 + 3 + 1);   // 4 wallets, the Burn Reserve, multisig, 3 members, the registered SR mint
 assert(R.reservedAddresses().includes(RESERVE) && R.reservedAddresses().includes(TREASURY), 'custody can never be the Treasury or the Burn Reserve');
 assert(R.reservedAddresses().includes('8Azsv23uZnZdmeyA6Vg6BagkT1SHEdiK4QqV3vycpump'), 'custody can never be the SR mint');

 // 3. Squads v4 decoding of the real captured account.
 const data = Buffer.from(fixture.dataBase64, 'base64'), ms = V.decodeMultisig(data);
 assert.equal(data.subarray(0, 8).toString('hex'), 'e07479ba44a14fec'); assert.equal(V.MULTISIG_DISCRIMINATOR.toString('hex'), 'e07479ba44a14fec');
 assert.equal(ms.threshold, 2); assert.equal(ms.timeLockSeconds, 0); assert.equal(ms.configAuthority, null); assert.equal(ms.transactionIndex, '0'); assert.equal(ms.rentCollector, null);
 assert.deepEqual(ms.members.map(m => m.key).sort(), [...reg.squads.members].sort()); assert(ms.members.every(m => m.initiate && m.vote && m.execute));
 assert.equal(V.vaultAddress(reg.squads.multisig, 0, reg.squads.programId), reg.reserveAddresses.ryoBurnReserve, 'Squads vault #0 (the former Treasury) is the RYO Burn Reserve');
 assert.notEqual(V.vaultAddress(reg.squads.multisig, 1, reg.squads.programId), reg.addresses.lockedTreasury, 'the new Treasury is not a vault of this multisig');
 assert.equal(V.vaultAddress(reg.squads.multisig, 1, reg.squads.programId), 'AAj289ZjKgP6NY7YPNxN15feJm2MWuv1Kkb4x94y4KHU');
 assert.equal(web3.PublicKey.isOnCurve(new web3.PublicKey(TREASURY).toBytes()), true, 'the new Treasury is an ordinary keypair wallet (owner-approved exception)');
 assert.throws(() => V.decodeMultisig(Buffer.alloc(40)), /too small/); { const bad = Buffer.from(data); bad[3] ^= 0xff; assert.throws(() => V.decodeMultisig(bad), /discriminator/); }

 // 4. Full snapshot against a mocked finalized RPC.
 const mint = web3.Keypair.generate().publicKey; let genesis = V.MAINNET_GENESIS, fail = false, calls = 0; const accounts = new Map(), owned = new Map();
 const mintData = (decimals = 6, mintAuthority = null, program = spl.TOKEN_PROGRAM_ID) => { const d = Buffer.alloc(spl.MINT_SIZE); spl.MintLayout.encode({ mintAuthorityOption: mintAuthority ? 1 : 0, mintAuthority: mintAuthority || web3.PublicKey.default, supply: 10n ** 15n, decimals, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: web3.PublicKey.default }, d); return { owner: program, data: d, lamports: 1 }; };
 accounts.set(reg.squads.multisig, { owner: new web3.PublicKey(fixture.owner), data, lamports: fixture.lamports });
 accounts.set(reg.reserveAddresses.ryoBurnReserve, { owner: web3.SystemProgram.programId, data: Buffer.alloc(0), lamports: fixture.vault.lamports });
 accounts.set(reg.addresses.communityRewards, { owner: web3.SystemProgram.programId, data: Buffer.alloc(0), lamports: 5e8 });
 accounts.set(mint.toBase58(), mintData());
 const connection = {
  async getGenesisHash() { calls++; if (fail) throw Error('down'); return genesis; },
  async getAccountInfo(k) { if (fail) throw Error('down'); return accounts.has(k.toBase58()) ? accounts.get(k.toBase58()) : null; },
  async getParsedTokenAccountsByOwner(o) { return { value: (owned.get(o.toBase58()) || []).map(amount => ({ account: { owner: spl.TOKEN_PROGRAM_ID, data: { parsed: { info: { mint: mint.toBase58(), owner: o.toBase58(), tokenAmount: { amount: String(amount), decimals: 6 } } } } } })) }; },
 };
 // Verifier checks run on an isolated pre-activation copy with a classic throw-away mint (the committed registry now has the released Token-2022 mint).
 R.useForIsolatedTest({ ...JSON.parse(fs.readFileSync(R.FILE, 'utf8')), srMintAddress: null, srMintProgram: 'spl-token', activation: { approved: false, reference: null } });
 let snap = await V.snapshot(connection);
 assert.equal(snap.status, 'verified'); assert.equal(snap.squads.status, 'verified'); assert.equal(snap.squads.role, 'ryoBurnReserve'); assert.equal(snap.mint.status, 'pending', 'no registered mint yet');
 assert.deepEqual(Object.fromEntries(Object.entries(snap.destinations).map(([r, d]) => [r, [d.verification.kind, d.verification.status, d.solLamports]])), { lockedTreasury: ['wallet', 'verified', 0], activeRewards: ['wallet', 'verified', 0], communityRewards: ['wallet', 'verified', 5e8], economicReserve: ['wallet', 'verified', 0] });
 assert.deepEqual([snap.reserves.ryoBurnReserve.verification.kind, snap.reserves.ryoBurnReserve.verification.status, snap.reserves.ryoBurnReserve.solLamports], ['squads-v4', 'verified', 1000000], 'the Burn Reserve keeps full Squads verification');
 assert.equal(snap.destinations.activeRewards.verification.state, 'unfunded'); assert.deepEqual(snap.alerts.map(a => a.signal), ['Single-key Treasury'], 'the single-key Treasury is always flagged for review');
 assert.equal(snap.gameCustody.address, reg.gameCustody.address); assert.equal(snap.gameCustody.verification.state, 'unfunded'); assert.equal(snap.gameCustody.verification.status, 'verified');
 assert.equal(snap.externalHeld.status, 'pending'); assert.equal(snap.externalHeld.srRaw, null, 'no placeholder balance before the mint exists');
 // With the mint: balances in base units, Treasury token account checked.
 owned.set(reg.addresses.lockedTreasury, [5000000000n]); owned.set(reg.addresses.activeRewards, [1n, 2n]); owned.set(reg.reserveAddresses.ryoBurnReserve, [700n]);
 snap = await V.snapshot(connection, { mint: mint.toBase58() });
 assert.equal(snap.mint.status, 'verified'); assert.equal(snap.mint.program, 'spl-token'); assert.equal(snap.destinations.lockedTreasury.srRaw, '5000000000'); assert.equal(snap.destinations.activeRewards.srRaw, '3'); assert.equal(snap.destinations.lockedTreasury.tokenAccount.state, 'absent');
 assert.equal(snap.reserves.ryoBurnReserve.tokenAccount.state, 'absent', 'the Burn Reserve token account is checked too');
 assert.deepEqual([snap.externalHeld.status, snap.externalHeld.srRaw], ['verified', '5000000003'], 'external total = sum of the four wallets (the Burn Reserve is not mixed in)');
 assert.deepEqual([snap.reservedForBurn.status, snap.reservedForBurn.srRaw], ['verified', '700'], 'Burn Reserve holdings are reported separately as reserved');
 assert.match(snap.reservedForBurn.note, /not burned/);
 { const p = V.publicSummary(snap); assert.equal(p.reserves.ryoBurnReserve.srRaw, '700'); assert.equal(p.reservedForBurn.srRaw, '700'); assert.equal(p.mint.supplyRaw, String(10n ** 15n), 'supply is published from the mint, separately'); }
 owned.delete(reg.reserveAddresses.ryoBurnReserve);
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
 assert(pub.includes(reg.gameCustody.address), 'the public game custody address is published');
 assert(pub.includes(reg.addresses.lockedTreasury) && pub.includes(reg.reserveAddresses.ryoBurnReserve) && pub.includes('"threshold":2'));
 // A Squads-vault Treasury (future: vault #1) gets full governance verification next to the Burn Reserve.
 { const r = JSON.parse(fs.readFileSync(R.FILE, 'utf8')), v1 = V.vaultAddress(r.squads.multisig, 1, r.squads.programId);
   r.destinations[0] = { ...r.destinations[0], address: v1, custody: 'squads-v4-vault' }; delete r.treasuryCustodyException; r.squads.vaults = { ryoBurnReserve: 0, lockedTreasury: 1 }; r.treasuryMigration.legs.push({ leg: 2, from: r.treasuryMigration.legs[0].to, to: v1, path: 'direct' });
   const g = R.useForIsolatedTest({ ...r, srMintAddress: null, srMintProgram: 'spl-token', activation: { approved: false, reference: null } });
   const s = await V.snapshot(connection, { reg: g }); assert.equal(s.status, 'verified'); assert.deepEqual(Object.keys(s.squadsByRole).sort(), ['lockedTreasury', 'ryoBurnReserve']);
   assert.equal(s.destinations.lockedTreasury.verification.kind, 'squads-v4'); assert.equal(s.squads.role, 'lockedTreasury'); assert(!s.alerts.some(a => a.signal === 'Single-key Treasury'));
   R.useForIsolatedTest({ ...JSON.parse(fs.readFileSync(R.FILE, 'utf8')), srMintAddress: null, srMintProgram: 'spl-token', activation: { approved: false, reference: null } }); }
 let clock = 0; const cached = V.cachedSnapshot(() => connection, { ttl: 60000, clock: () => clock }); calls = 0;
 await Promise.all([cached(), cached(), cached()]); await cached(); assert.equal(calls, 1, 'concurrent and repeat requests share one RPC snapshot');
 clock = 60001; await cached(); assert.equal(calls, 2, 'refreshes after 60 s');
 console.log('PASS: treasury registry v2 — new Treasury GPbg… (owner-approved single-key exception, fail closed without it), old vault 5wVB… preserved as the 0-bps RYO Burn Reserve (Squads-verified, reserved ≠ burned), public-only validation (base58/32-byte, distinct, exact bps, no secrets/seed phrases, Squads settings, activation rules); verifier — real Squads v4 bytes, vault PDA, drift/custody/mint/network failures as explicit states, hidden member keys, bounded RPC cache.');
})().catch(e => { console.error(e); process.exitCode = 1; });
