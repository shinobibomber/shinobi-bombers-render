'use strict';
/* Treasury movement ledger (live only, Treasury migration 2026-11-12): treasuryRelocation / burnReserveFunding / burn, recorded
 * only through the two-person admin proposal flow after re-reading the finalized transaction. Uses the REAL captured Mainnet
 * relocation 35T3… (fixtures/treasury-relocation-35T3.json) plus synthetic burns/fundings. PGlite + mocked RPC: no network. */
const fixture = require('./sr-revenue-fixture.cjs'); fixture.liveEconomy();
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js'), spl = require('../app/node_modules/@solana/spl-token'), bs58 = require('../app/node_modules/bs58');
const { Store } = require('../app/server/store.cjs'), admin = require('../app/server/economic-dashboard.cjs'), router = require('../app/server/sr-revenue.cjs'), M = require('../app/server/treasury-movements.cjs');
const relocation = require('./fixtures/treasury-relocation-35T3.json').transaction;
const MINT = '8Azsv23uZnZdmeyA6Vg6BagkT1SHEdiK4QqV3vycpump', TREASURY = 'GPbgpbtxEiZtsWnjxq3MKbk9gaoqFNEbpTRqn8t7htjE', RESERVE = '5wVBdFkQFLtu8qhZ1pg6RoD1LjWGUYL1erBVGBu11aGn';
const RELOCATION_SIG = '35T3CwTrZLMsmMvkNKRTvk5SYU53H6ucnxsQsEoBPSpUGDcyWCJiiUBHqqEbEjZkW3B8GU1aL5LgEGvDT8QF4CqV', RELOCATED = '288061292324334';
(async () => {
 const db = new PGlite(), schema = fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'); await db.exec(schema); await db.exec(schema);
 let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
 const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
 const store = new Store(pool, 'movements-fixture', () => 1900000000000), custody = web3.Keypair.generate().publicKey.toBase58();
 // The committed migration is closed (2026-11-12). Sections 1-9 replay the open-migration recording that ran on live, on an isolated reopened copy;
 // section 9b checks the committed (closed) registry.
 const reg = fixture.activate(MINT, { program: 'token-2022', custody, migrationOpen: true });
 const T22 = spl.TOKEN_2022_PROGRAM_ID.toBase58(), ata = o => spl.getAssociatedTokenAddressSync(new web3.PublicKey(MINT), new web3.PublicKey(o), true, spl.TOKEN_2022_PROGRAM_ID).toBase58();
 const rAta = ata(RESERVE), tAta = ata(TREASURY), cAta = ata(custody), aAta = ata(reg.addresses.activeRewards);
 const address = () => web3.Keypair.generate().publicKey.toBase58(), operator = address(), reviewer = address();
 const receipt = new Map([[RELOCATION_SIG, relocation]]), overrides = {};
 const connection = { async getAccountInfo(key) { const known = fixture.chainAccount(key, MINT, overrides); return known === undefined ? null : known; }, async getParsedTransaction(sig) { return receipt.get(sig) || null; } };
 const ctx = { store, wallet: operator, connection, mint: MINT, treasuryAddress: custody, studioAddress: address(), revenueAddress: address(), async checkNetwork() {} };
 process.env.RYO_ADMIN_APPROVERS = operator + ',' + reviewer; process.env.RYO_ADMIN_OPERATORS = ''; delete process.env.ADMIN_SELF_APPROVAL;
 const call = (w, action, body = {}) => admin.handle(ctx, w, action, { confirmation: 'CONFIRM', ...body });
 const version = async () => Number((await pool.query('SELECT version FROM ryo_admin_control WHERE scope=$1', [store.scope])).rows[0]?.version || 0);
 const propose = async payload => call(operator, 'admin-propose', { kind: 'treasuryMovement', payload, version: await version(), reason: 'Record verified movement' });
 const approve = p => call(reviewer, 'admin-review', { id: p.id, approve: true, reason: 'Independent verification of the finalized transaction' });
 const record = async payload => approve(await propose(payload));
 const rows = async () => (await pool.query('SELECT kind,signature,source_address,destination_address,amount_raw FROM ryo_treasury_movements WHERE scope=$1 ORDER BY created,signature', [store.scope])).rows;
 const sig = () => bs58.encode(crypto.randomBytes(64));
 const EXEC = bs58.encode(crypto.createHash('sha256').update('global:vault_transaction_execute').digest().subarray(0, 8));
 const KEYS = [{ pubkey: reg.squads.members[1], signer: true }, { pubkey: rAta }, { pubkey: tAta }, { pubkey: cAta }, { pubkey: aAta }, { pubkey: RESERVE }, { pubkey: TREASURY, signer: false }];
 const at = a => KEYS.findIndex(k => k.pubkey === a), bal = (account, owner, amount) => ({ accountIndex: at(account), mint: MINT, owner, uiTokenAmount: { amount: String(amount), decimals: 6 } });
 // A synthetic finalized transaction. squads=true: one Squads vault_transaction_execute whose inner instructions are `ixs`.
 const tx = (s, ixs, pre, post, { squads = true, parent = reg.squads.programId, multisig = reg.squads.multisig, data = EXEC, err = null, keys = KEYS } = {}) => ({ slot: 500, blockTime: 1794450000,
   meta: { err, preTokenBalances: pre, postTokenBalances: post, innerInstructions: squads ? [{ index: 0, instructions: ixs }] : [] },
   transaction: { signatures: [s], message: { accountKeys: keys, instructions: squads ? [{ programId: parent, accounts: [multisig], data }] : ixs } } });
 const burnIx = (amount = '2500000', { account = rAta, authority = RESERVE, type = 'burnChecked', mint = MINT, program = T22 } = {}) => ({ programId: program, program: 'spl-token', parsed: { type, info: { account, mint, authority, ...(type === 'burnChecked' ? { tokenAmount: { amount, decimals: 6 } } : { amount }) } } });
 const transferIx = (source, destination, authority, amount) => ({ programId: T22, program: 'spl-token', parsed: { type: 'transferChecked', info: { source, destination, mint: MINT, authority, tokenAmount: { amount, decimals: 6 } } } });
 const income0 = Number((await router.income(store, pool)).n);
 try {
  // 1. Validation of proposals.
  assert.deepEqual(M.KINDS, ['treasuryRelocation', 'burnReserveFunding', 'burn']);
  for (const [p, re] of [[{ kind: 'mint', signature: RELOCATION_SIG, amountRaw: '1', evidence: 'x' }, /movement kind/], [{ kind: 'burn', signature: 'nope', amountRaw: '1', evidence: 'x' }, /signature/],
    [{ kind: 'burn', signature: RELOCATION_SIG, amountRaw: '1.5', evidence: 'x' }, /base units/], [{ kind: 'burn', signature: RELOCATION_SIG, amountRaw: '0', evidence: 'x' }, /base units/], [{ kind: 'burn', signature: RELOCATION_SIG, amountRaw: '1', evidence: ' ' }, /evidence/]])
   await assert.rejects(propose(p), re);

  // 2. The REAL Mainnet relocation (35T3…): verified against the fixture, recorded once, never revenue.
  const reloc = { kind: 'treasuryRelocation', signature: RELOCATION_SIG, amountRaw: RELOCATED, evidence: 'Owner Squads transfer 2026-11-12, Treasury migration' };
  { const p = await propose(reloc); await assert.rejects(call(operator, 'admin-review', { id: p.id, approve: true, reason: 'self' }), /different authorized wallet/, 'two-person approval');
    await assert.rejects(record({ ...reloc, amountRaw: '288061292324333' }), /differs from the proposed amount/);
    await assert.rejects(record({ ...reloc, kind: 'burn' }), /a transfer is never a burn/, 'an ordinary transfer is never counted as a burn');
    await assert.rejects(record({ ...reloc, kind: 'burnReserveFunding' }), /must arrive in the RYO Burn Reserve/);
    // Governance is re-checked when the record is approved.
    overrides[reg.squads.multisig] = fixture.squadsAccount(d => d.writeUInt16LE(1, 8 + 64)); await assert.rejects(approve(p), /no longer matches its registered governance/); delete overrides[reg.squads.multisig];
    await approve(await propose(reloc)); }
  assert.deepEqual((await rows()).map(r => [r.kind, r.source_address, r.destination_address, String(r.amount_raw)]), [['treasuryRelocation', RESERVE, TREASURY, RELOCATED]]);
  await assert.rejects(record(reloc), /already accounted/, 'the same transaction can never be recorded twice');
  { const row = (await pool.query('SELECT evidence,commitment,migration_id,leg,block_time FROM ryo_treasury_movements WHERE signature=$1', [RELOCATION_SIG])).rows[0], ev = row.evidence;
    assert.equal(ev.path, 'squads-vault-execute'); assert.equal(ev.slot, 468336333); assert.equal(ev.instruction, 'transferChecked');
    assert.deepEqual([row.commitment, row.migration_id, Number(row.leg), Number(row.block_time)], ['finalized', 'treasury-migration-2026-11', 1, relocation.blockTime], 'source, destination, amount, signature, time and confirmation are recorded for leg 1'); }
  // Relocation records are limited to the registered migration legs.
  { const s1 = sig(); receipt.set(s1, tx(s1, [transferIx(rAta, aAta, RESERVE, '7')], [bal(rAta, RESERVE, 10n), bal(aAta, reg.addresses.activeRewards, 0n)], [bal(rAta, RESERVE, 3n), bal(aAta, reg.addresses.activeRewards, 7n)]));
    await assert.rejects(record({ kind: 'treasuryRelocation', signature: s1, amountRaw: '7', evidence: 'not a leg' }), /not a leg of the registered Treasury migration/); }
  { const s2 = sig(), vault = address(), vAta = ata(vault), keys = [...KEYS, { pubkey: vAta }].map(k => k.pubkey === TREASURY ? { ...k, signer: true } : k);
    const b = (x, y) => [{ accountIndex: keys.findIndex(k => k.pubkey === tAta), mint: MINT, owner: TREASURY, uiTokenAmount: { amount: String(x), decimals: 6 } }, { accountIndex: keys.length - 1, mint: MINT, owner: vault, uiTokenAmount: { amount: String(y), decimals: 6 } }];
    receipt.set(s2, tx(s2, [transferIx(tAta, vAta, TREASURY, '9')], b(9n, 0n), b(0n, 9n), { squads: false, keys }));
    await assert.rejects(record({ kind: 'treasuryRelocation', signature: s2, amountRaw: '9', evidence: 'not registered' }), /not a leg of the registered Treasury migration/, 'GPbg… is the Treasury: moving out of it is not a relocation unless a new leg is registered'); }
  { const s3 = sig(); receipt.set(s3, tx(s3, [transferIx(rAta, tAta, RESERVE, '5')], [bal(rAta, RESERVE, 10n), bal(tAta, TREASURY, 0n)], [bal(rAta, RESERVE, 5n), bal(tAta, TREASURY, 5n)], { squads: false }));
    await assert.rejects(record({ kind: 'treasuryRelocation', signature: s3, amountRaw: '5', evidence: 'leg 1 outside Squads' }), /must be an approved Squads vault transaction/); }
  // An undecodable token instruction is refused cleanly (409), never a crash.
  { const s4 = sig(); receipt.set(s4, tx(s4, [{ programId: T22, accounts: [rAta], data: 'abc' }], [bal(rAta, RESERVE, 1n)], [bal(rAta, RESERVE, 0n)]));
    await assert.rejects(record({ kind: 'burn', signature: s4, amountRaw: '1', evidence: 'unparsed' }), e => /could not be decoded/.test(e.message) && e.status === 409); }

  // 3. Burns: only a finalized Token-2022 burn of the RYO mint from the Burn Reserve account, via Squads execute of the registered multisig.
  const burnBal = (before, after) => [[bal(rAta, RESERVE, before)], [bal(rAta, RESERVE, after)]];
  const good = sig(); receipt.set(good, tx(good, [burnIx()], ...burnBal(1417500000000n, 1417497500000n)));
  const refusedBurn = async (label, ixs, balances, opts, re) => { const s = sig(); receipt.set(s, tx(s, ixs, ...balances, opts)); await assert.rejects(record({ kind: 'burn', signature: s, amountRaw: '2500000', evidence: 'burn' }), re, label); };
  await refusedBurn('wrong source account', [burnIx('2500000', { account: tAta })], [[bal(tAta, TREASURY, 5000000n)], [bal(tAta, TREASURY, 2500000n)]], {}, /did not come from the RYO Burn Reserve/);
  await refusedBurn('wrong authority', [burnIx('2500000', { authority: TREASURY })], burnBal(5000000n, 2500000n), {}, /authority is not the Burn Reserve vault/);
  await refusedBurn('not through Squads', [burnIx()], burnBal(5000000n, 2500000n), { squads: false }, /approved Squads vault transaction/);
  await refusedBurn('another multisig', [burnIx()], burnBal(5000000n, 2500000n), { multisig: address() }, /different multisig/);
  await refusedBurn('Squads spending limit', [burnIx()], burnBal(5000000n, 2500000n), { data: bs58.encode(crypto.createHash('sha256').update('global:spending_limit_use').digest().subarray(0, 8)) }, /vault_transaction_execute/);
  await refusedBurn('another program', [burnIx()], burnBal(5000000n, 2500000n), { parent: address() }, /registered Squads program/);
  await refusedBurn('another mint', [burnIx('2500000', { mint: address() })], burnBal(5000000n, 2500000n), {}, /registered RYO mint/);
  await refusedBurn('classic token program', [burnIx('2500000', { program: spl.TOKEN_PROGRAM_ID.toBase58() })], burnBal(5000000n, 2500000n), {}, /registered RYO token program/);
  await refusedBurn('a hidden second movement', [burnIx(), transferIx(rAta, aAta, RESERVE, '1')], burnBal(5000000n, 2500000n), {}, /exactly one is accepted/);
  await refusedBurn('balance mismatch', [burnIx()], burnBal(5000000n, 4000000n), {}, /source balance change/);
  await refusedBurn('failed transaction', [burnIx()], burnBal(5000000n, 2500000n), { err: { InstructionError: [0, 'Custom'] } }, /not finalized successfully/);
  await assert.rejects(record({ kind: 'burn', signature: sig(), amountRaw: '2500000', evidence: 'missing' }), /not finalized successfully/, 'an unknown/unconfirmed signature is never recorded');
  await record({ kind: 'burn', signature: good, amountRaw: '2500000', evidence: 'Multisig-approved burn #1' });
  { const plain = sig(); receipt.set(plain, tx(plain, [burnIx('1000000', { type: 'burn' })], ...burnBal(1417497500000n, 1417496500000n))); await record({ kind: 'burn', signature: plain, amountRaw: '1000000', evidence: 'Multisig-approved burn #2 (plain burn)' }); }

  // 4. Burn Reserve funding: only from the registered Treasury (single-key: signed directly), never custody or reward pools.
  const fundBal = (src, owner) => [[bal(src, owner, 9000000n), bal(rAta, RESERVE, 1000n)], [bal(src, owner, 4000000n), bal(rAta, RESERVE, 5001000n)]];
  const fund = async (label, src, owner, signer, opts, re) => { const s = sig(), keys = KEYS.map(k => k.pubkey === signer ? { ...k, signer: true } : k); receipt.set(s, tx(s, [transferIx(src, rAta, signer, '5000000')], ...fundBal(src, owner), { squads: false, keys, ...opts }));
   const run = record({ kind: 'burnReserveFunding', signature: s, amountRaw: '5000000', evidence: label }); return re ? assert.rejects(run, re, label) : run; };
  await fund('player funds (game custody)', cAta, custody, custody, {}, /game custody holds player funds/);
  await fund('reward pool', aAta, reg.addresses.activeRewards, reg.addresses.activeRewards, {}, /must come from the registered Treasury/);
  await fund('Treasury via Squads (single-key Treasury)', tAta, TREASURY, TREASURY, { squads: true }, /single-key Treasury must sign the transfer itself/);
  { const s = sig(); receipt.set(s, tx(s, [transferIx(tAta, rAta, TREASURY, '5000000')], ...fundBal(tAta, TREASURY), { squads: false })); await assert.rejects(record({ kind: 'burnReserveFunding', signature: s, amountRaw: '5000000', evidence: 'unsigned' }), /not signed by the registered Treasury/); }
  await fund('Treasury → Burn Reserve', tAta, TREASURY, TREASURY, {});

  // 5. Totals: burned counts only verified burns; funding and relocation are separate; nothing is revenue or reward funding.
  const r = await M.report(store);
  assert.deepEqual([r.burnedRaw, r.burns, r.fundedRaw, r.fundings, r.relocatedRaw, r.relocations], ['3500000', 2, '5000000', 1, RELOCATED, 1]);
  assert.equal(Number((await router.income(store, pool)).n), income0, 'movements never become revenue or Chest funding');
  assert.equal((await router.summary(ctx, pool)).transactions, 0, 'no Chapter 04 service revenue is booked');
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM ryo_revenue_replenishments WHERE scope=$1', [store.scope])).rows[0].n, 0);
  { const pub = await M.publicReport(store); assert.equal(pub.burnedRaw, '3500000'); assert(!JSON.stringify(pub).includes('evidence')); assert(!JSON.stringify(pub).includes(operator), 'no admin wallets in the public report'); }
  { const audit = (await pool.query("SELECT action,data FROM ryo_admin_audit WHERE scope=$1 AND action='configuration.approved'", [store.scope])).rows; assert.equal(audit.filter(a => a.data.kind === 'treasuryMovement').length, 4, 'every recorded movement is in the audit chain'); }
  assert.equal((await pool.query('SELECT config FROM ryo_admin_control WHERE scope=$1', [store.scope])).rows[0].config.treasuryMovement, undefined, 'a movement never becomes configuration');
  // The Observatory shows the Treasury Management view with reserved/burned kept apart.
  { const snap = await call(reviewer, 'admin-snapshot'); const m = snap.treasuryManagement; assert.equal(m.treasury.address, TREASURY); assert.equal(m.treasury.custodyModel, 'single-key');
    assert.deepEqual(m.reserves.map(x => [x.role, x.address, x.vaultIndex]), [['ryoBurnReserve', RESERVE, 0]]); assert.equal(m.movements.burnedRaw, '3500000'); assert.equal(m.movements.history.length, 4); }

  // 6. Owner decision 2026-11-12: recording follows ADMIN_SELF_APPROVAL (live runs one wallet). On: one approver may record, and the
  // audit chain marks it selfApproved. Off: a second wallet is required (checked in section 2).
  { const s5 = sig(); receipt.set(s5, tx(s5, [burnIx('500000')], ...burnBal(1417496500000n, 1417496000000n))); process.env.ADMIN_SELF_APPROVAL = 'on';
    try { const p = await propose({ kind: 'burn', signature: s5, amountRaw: '500000', evidence: 'one-wallet live setting' }); await call(operator, 'admin-review', { id: p.id, approve: true, reason: 'self-approved under ADMIN_SELF_APPROVAL=on' });
      const a = (await pool.query("SELECT data FROM ryo_admin_audit WHERE scope=$1 AND action='configuration.approved' ORDER BY sequence DESC LIMIT 1", [store.scope])).rows[0].data; assert.equal(a.selfApproved, true); assert.equal(a.kind, 'treasuryMovement'); }
    finally { delete process.env.ADMIN_SELF_APPROVAL; } }
  // 7. Migration reconciliation: per-leg totals; leg 2 awaits the new vault.
  { const mg = (await M.report(store)).migration; assert.equal(mg.id, 'treasury-migration-2026-11'); assert.equal(mg.recordingOpen, true);
    assert.deepEqual(mg.legs.map(l => [l.leg, l.relocatedRaw, l.transfers, l.awaitingDestination]), [[1, RELOCATED, 1, false]]); }
  // 8. Only if the owner later registers a new leg (hypothetical example: GPbg… → Squads vault #1): a direct transfer signed by GPbg….
  const regWith = mutate => { const raw = JSON.parse(fs.readFileSync(require('../app/server/treasury-registry.cjs').FILE, 'utf8')); raw.gameCustody = { address: custody, purpose: 'Isolated test custody' }; raw.srMintProgram = 'token-2022'; raw.srMintAddress = MINT; raw.activation = { approved: true, reference: 'Isolated test activation fixture' }; raw.treasuryMigration.status = 'open'; delete raw.treasuryMigration.completedReference; mutate(raw); return require('../app/server/treasury-registry.cjs').useForIsolatedTest(raw); };
  { const V = require('../app/server/treasury-verify.cjs'), v1 = V.vaultAddress(reg.squads.multisig, 1, reg.squads.programId), v1Ata = ata(v1);
    regWith(raw => { raw.destinations[0] = { ...raw.destinations[0], address: v1, custody: 'squads-v4-vault' }; delete raw.treasuryCustodyException; raw.squads.vaults = { ryoBurnReserve: 0, lockedTreasury: 1 }; raw.treasuryMigration.legs.push({ leg: 2, from: TREASURY, to: v1, path: 'direct' }); });
    const keys = [...KEYS, { pubkey: v1Ata }].map(k => k.pubkey === TREASURY ? { ...k, signer: true } : k), b = (x, y) => [{ accountIndex: keys.findIndex(k => k.pubkey === tAta), mint: MINT, owner: TREASURY, uiTokenAmount: { amount: String(x), decimals: 6 } }, { accountIndex: keys.length - 1, mint: MINT, owner: v1, uiTokenAmount: { amount: String(y), decimals: 6 } }];
    const s6 = sig(); receipt.set(s6, tx(s6, [transferIx(tAta, v1Ata, TREASURY, RELOCATED)], b(BigInt(RELOCATED), 0n), b(0n, BigInt(RELOCATED)), { squads: false, keys }));
    await record({ kind: 'treasuryRelocation', signature: s6, amountRaw: RELOCATED, evidence: 'Leg 2: temporary wallet → new Squads Treasury vault' });
    const mg = (await M.report(store)).migration; assert.deepEqual(mg.legs.map(l => [l.leg, l.relocatedRaw]), [[1, RELOCATED], [2, RELOCATED]], 'leg 1 and leg 2 reconcile');
    assert.equal(Number((await router.income(store, pool)).n), income0, 'relocations are never Treasury revenue');
    // 9. Completed and reconciled: recording closes; the history is kept.
    regWith(raw => { raw.destinations[0] = { ...raw.destinations[0], address: v1, custody: 'squads-v4-vault' }; delete raw.treasuryCustodyException; raw.squads.vaults = { ryoBurnReserve: 0, lockedTreasury: 1 }; raw.treasuryMigration.legs.push({ leg: 2, from: TREASURY, to: v1, path: 'direct' }); raw.treasuryMigration.status = 'completed'; raw.treasuryMigration.completedReference = 'Reconciled: leg 1 = leg 2 = 288,061,292.324334 RYO'; });
    const s7 = sig(); receipt.set(s7, tx(s7, [transferIx(tAta, v1Ata, TREASURY, '1')], b(1n, 0n), b(0n, 1n), { squads: false, keys }));
    await assert.rejects(record({ kind: 'treasuryRelocation', signature: s7, amountRaw: '1', evidence: 'after completion' }), /completed and reconciled; relocation records are closed/);
    const done = (await M.report(store)).migration; assert.equal(done.recordingOpen, false); assert.equal(done.legs[1].relocatedRaw, RELOCATED, 'audit history is preserved after completion');
    assert.equal((await rows()).filter(r => r.kind === 'treasuryRelocation').length, 2);
    fixture.activate(MINT, { program: 'token-2022', custody }); }
  // 9b. The committed registry: migration closed 2026-11-12 after leg 1 (35T3…) was recorded; no new relocation can be recorded, the history stays.
  { const R = require('../app/server/treasury-registry.cjs').registry(); assert.equal(R.treasuryMigration.status, 'completed'); assert.match(R.treasuryMigration.completedReference, /35T3/);
    assert.equal(R.addresses.lockedTreasury, TREASURY, 'GPbg… stays the Treasury');
    const s8 = sig(); receipt.set(s8, tx(s8, [transferIx(rAta, tAta, RESERVE, '1')], [bal(rAta, RESERVE, 1n), bal(tAta, TREASURY, 0n)], [bal(rAta, RESERVE, 0n), bal(tAta, TREASURY, 1n)]));
    await assert.rejects(record({ kind: 'treasuryRelocation', signature: s8, amountRaw: '1', evidence: 'leg 1 after closing' }), /completed and reconciled; relocation records are closed/);
    const closed = (await M.report(store)).migration; assert.equal(closed.status, 'completed'); assert.equal(closed.recordingOpen, false); assert.equal(closed.legs[0].relocatedRaw, RELOCATED, 'leg 1 history is preserved'); }

  // 10. Beta (Devnet build): never recorded.
  { const network = require('../app/server/network.cjs'), built = network.built; network.built = () => network.NETWORKS.devnet;
    try { await assert.rejects(M.verifyMovement(ctx, { kind: 'burn', signature: good, amountRaw: '2500000', evidence: 'x' }), /only on the live server/); await assert.rejects(propose({ kind: 'burn', signature: good, amountRaw: '1', evidence: 'x' }), /only on the live server/);
      assert.deepEqual(await M.report(store), { applicable: false }); } finally { network.built = built; } }
  console.log('PASS: Treasury movements — real Mainnet relocation 35T3… recorded once via two-person approval; burns only as finalized Token-2022 burns from the Burn Reserve via Squads (transfers, other accounts/authorities/multisigs/programs/mints, hidden legs, failed or unknown transactions refused); Burn Reserve funding only from the Treasury (never custody or reward pools); no revenue, no reward funding, no double counting; live only.');
 } finally { await db.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
