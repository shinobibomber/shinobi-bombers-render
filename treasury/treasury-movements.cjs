/* Treasury movement ledger (live only): a verified, append-only record of internal wallet movements that are NOT revenue.
 *
 * Kinds (2026-11-12, Treasury migration + RYO Burn Reserve):
 *   treasuryRelocation   ONLY a leg of the registered Treasury migration (registry treasuryMigration, owner decision
 *                        2026-11-12): former Squads Treasury vault #0 → temporary Treasury wallet → new Squads Treasury
 *                        vault. Refused for any other transfer and once the migration is "completed" (reconciled).
 *   burnReserveFunding   RYO moved from the registered Treasury into the RYO Burn Reserve. Never from game custody,
 *                        the reward pools or any player-funded wallet.
 *   burn                 a finalized Token-2022 burn of RYO from the Burn Reserve token account, executed through an
 *                        approved Squads vault transaction. The ONLY kind that counts as burned RYO.
 *
 * Rules:
 *   - Nothing here signs, builds or sends a transaction. Burns and transfers are executed by the Squads members (or the
 *     Treasury owner) in their own wallets; this module only verifies a finalized transaction afterwards.
 *   - A movement is recorded only through the two-person admin proposal flow (economic-dashboard, kind treasuryMovement),
 *     and the server re-reads the finalized transaction at approval time.
 *   - Movements are never read by SR income, claim funding, the reward pool or the reward budget: an internal transfer
 *     creates no revenue and no reward funding, and cannot be counted twice.
 *   - Reserved (held) RYO is never reported as burned.
 *
 * Copied to app/server/treasury-movements.cjs by apply-treasury.cjs.
 */
'use strict';
const crypto = require('node:crypto');
const { fail } = require('./store.cjs');

const KINDS = Object.freeze(['treasuryRelocation', 'burnReserveFunding', 'burn']);
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const SQUADS_VAULT_EXECUTE = crypto.createHash('sha256').update('global:vault_transaction_execute').digest().subarray(0, 8);
// Every token-program instruction that can move or destroy tokens. A recorded movement must contain exactly one of them.
const MOVING = Object.freeze(['transfer', 'transferChecked', 'transferCheckedWithFee', 'burn', 'burnChecked', 'closeAccount', 'withdrawExcessLamports', 'approve', 'approveChecked', 'setAuthority', 'mintTo', 'mintToChecked']);
const live = () => require('./network.cjs').built(__dirname).key === 'mainnet';
const registry = () => require('./treasury-registry.cjs').registry();

function validateMovement(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('Treasury movement must be an object.');
  if (!KINDS.includes(p.kind)) fail('Choose a movement kind: ' + KINDS.join(', ') + '.');
  if (typeof p.signature !== 'string' || !SIGNATURE.test(p.signature)) fail('Enter a valid finalized transaction signature.');
  if (typeof p.amountRaw !== 'string' || !/^[1-9][0-9]{0,23}$/.test(p.amountRaw)) fail('Enter the exact amount in RYO base units (6 decimals), as a whole number string.');
  if (typeof p.evidence !== 'string' || !p.evidence.trim() || p.evidence.length > 500) fail('Enter the owner approval / evidence reference.');
  return { kind: p.kind, signature: p.signature, amountRaw: p.amountRaw, evidence: p.evidence.trim() };
}

const big = v => { if (!/^[0-9]+$/.test(String(v))) fail('Unexpected token amount in transaction evidence.', 409); return BigInt(v); };

/** Re-read and verify a finalized transaction for one movement kind. Returns the evidence to persist. Throws on any mismatch. */
async function verifyMovement(ctx, payload, c = ctx.store.pool) {
  if (!live()) fail('Treasury movements are recorded only on the live server.', 403);
  const { PublicKey } = require('@solana/web3.js'), spl = require('@solana/spl-token');
  const reg = registry(), mint = reg.srMintAddress, reserve = reg.reserveAddresses.ryoBurnReserve, treasury = reg.addresses.lockedTreasury;
  if (!mint || ctx.mint !== mint) fail('The server mint does not match the registered RYO mint.', 503);
  if (!reserve) fail('The RYO Burn Reserve is not registered.', 503);
  const program = require('./live-economy.cjs').programId(), TOKEN = program.toBase58();
  if (TOKEN !== spl.TOKEN_2022_PROGRAM_ID.toBase58() && reg.srMintProgram === 'token-2022') fail('Token program mismatch.', 503);
  const ata = owner => spl.getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, program).toBase58();
  const reserveAta = ata(reserve), treasuryAta = ata(treasury), custody = reg.gameCustody?.address || ctx.treasuryAddress, custodyAta = custody ? ata(custody) : null;
  await ctx.checkNetwork();
  const tx = await ctx.connection.getParsedTransaction(payload.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  if (!tx?.meta || tx.meta.err || tx.transaction?.signatures?.[0] !== payload.signature) fail('The transaction has not finalized successfully. Nothing is recorded.', 409);
  const refuse = why => fail('Treasury movement refused: ' + why, 409);
  const keys = tx.transaction.message.accountKeys, top = tx.transaction.message.instructions || [];
  const all = [...top.map(i => ({ i, parent: null })), ...(tx.meta.innerInstructions || []).flatMap(g => (g.instructions || []).map(i => ({ i, parent: top[g.index] || {} })))];
  // Exactly one token-moving instruction (any mint, any token program): no hidden second transfer, approval or authority change.
  const tokenPrograms = [spl.TOKEN_PROGRAM_ID.toBase58(), spl.TOKEN_2022_PROGRAM_ID.toBase58()];
  const moving = all.filter(x => tokenPrograms.includes(x.i.programId?.toString()) && (MOVING.includes(x.i.parsed?.type) || !x.i.parsed));
  if (moving.length !== 1) refuse(moving.length ? 'the transaction contains ' + moving.length + ' token instructions that move tokens or change authority; exactly one is accepted.' : 'no RYO transfer or burn was found.');
  const [{ i: op, parent }] = moving, viaSquads = parent !== null;
  if (!op.parsed || typeof op.parsed !== 'object') refuse('the token instruction could not be decoded; only parsed RYO transfers and burns are accepted.');
  const info = op.parsed.info || {};
  if (op.programId.toString() !== TOKEN) refuse('the instruction does not use the registered RYO token program.');
  if (info.mint !== mint) refuse('the instruction is not for the registered RYO mint.');
  const amount = String(info.tokenAmount?.amount ?? info.amount ?? '');
  if (amount !== payload.amountRaw) refuse('the on-chain amount (' + amount + ') differs from the proposed amount (' + payload.amountRaw + ').');
  if (info.tokenAmount && info.tokenAmount.decimals !== 6) refuse('unexpected token decimals.');
  const signer = info.authority || info.multisigAuthority;
  const squadsProblem = p => {
    if (p?.programId?.toString() !== reg.squads.programId) return 'it was not executed by the registered Squads program.';
    if (p.accounts?.[0]?.toString() !== reg.squads.multisig) return 'the Squads transaction belongs to a different multisig.';
    let d; try { d = Buffer.from(require('bs58').decode(String(p.data || ''))).subarray(0, 8); } catch { d = Buffer.alloc(0); }
    return d.equals(SQUADS_VAULT_EXECUTE) ? null : 'only an approved Squads vault transaction (vault_transaction_execute) is accepted.';
  };
  const requireReserveSquads = () => { if (!viaSquads) refuse('the Burn Reserve can only act through an approved Squads vault transaction.'); const p = squadsProblem(parent); if (p) refuse(p); if (signer !== reserve) refuse('the transfer authority is not the Burn Reserve vault.'); };
  let source, destination, sourceAta, destinationAta, leg = null;
  if (payload.kind === 'burn') {
    if (!['burn', 'burnChecked'].includes(op.parsed.type)) refuse('a transfer is never a burn. Only a Token-2022 burn instruction counts as burned RYO.');
    if (info.account !== reserveAta) refuse('the burned tokens did not come from the RYO Burn Reserve token account.');
    requireReserveSquads();
    source = reserve; sourceAta = reserveAta; destination = null; destinationAta = null;
  } else {
    if (op.parsed.type !== 'transferChecked') refuse('only a transferChecked instruction is accepted for a wallet movement.');
    sourceAta = info.source; destinationAta = info.destination;
    if (payload.kind === 'treasuryRelocation') {
      // Only the registered migration legs, only while the migration is open.
      const mig = reg.treasuryMigration;
      if (!mig) refuse('no Treasury migration is registered: relocation records are not available.');
      if (mig.status !== 'open') refuse('the Treasury migration ' + mig.id + ' is completed and reconciled; relocation records are closed. Use Burn Reserve funding or a separate accounting category.');
      leg = mig.legs.find(l => l.to && ata(l.from) === sourceAta && ata(l.to) === destinationAta);
      if (!leg) refuse(mig.legs.some(l => !l.to && ata(l.from) === sourceAta) ? 'this migration leg has no verified destination yet; the owner must register the new Treasury vault first.' : 'this transfer is not a leg of the registered Treasury migration ' + mig.id + '.');
      if (leg.path === 'squads-vault-execute') {
        if (!viaSquads) refuse('migration leg ' + leg.leg + ' must be an approved Squads vault transaction.');
        const p = squadsProblem(parent); if (p) refuse(p);
        if (signer !== leg.from) refuse('the transfer authority is not the migration leg ' + leg.leg + ' source vault.');
      } else {
        if (viaSquads) refuse('migration leg ' + leg.leg + ' must be signed directly by its source wallet.');
        if (signer !== leg.from || !keys.some(k => k.pubkey.toString() === leg.from && k.signer === true)) refuse('the transfer was not signed by the migration leg ' + leg.leg + ' source wallet.');
      }
      source = leg.from; destination = leg.to;
    } else {
      if (destinationAta !== reserveAta) refuse('Burn Reserve funding must arrive in the RYO Burn Reserve token account.');
      if (sourceAta === custodyAta || signer === custody) refuse('game custody holds player funds and can never fund the Burn Reserve.');
      if (sourceAta !== treasuryAta || signer !== treasury) refuse('Burn Reserve funding must come from the registered Treasury (never from the reward pools or player funds).');
      if (reg.squads.vaults.lockedTreasury !== undefined) { if (!viaSquads) refuse('the Treasury vault can only send RYO through Squads.'); const p = squadsProblem(parent); if (p) refuse(p); }
      else { if (viaSquads) refuse('the single-key Treasury must sign the transfer itself as a top-level instruction.'); if (!keys.some(k => k.pubkey.toString() === treasury && k.signer === true)) refuse('the transfer was not signed by the registered Treasury wallet.'); }
      source = treasury; destination = reserve;
    }
  }
  // Exact finalized balance changes: the source loses exactly the amount, the destination gains exactly it, nothing else changes.
  const rows = (list, at) => (list || []).filter(b => b.accountIndex === at && b.mint === mint);
  const total = (list, at) => rows(list, at).reduce((n, b) => n + big(b.uiTokenAmount.amount), 0n);
  const indexOf = a => keys.findIndex(k => k.pubkey.toString() === a);
  const si = indexOf(sourceAta), di = destinationAta ? indexOf(destinationAta) : -1;
  if (si < 0 || (destinationAta && di < 0)) refuse('missing account evidence.');
  const n = big(payload.amountRaw);
  if (total(tx.meta.preTokenBalances, si) - total(tx.meta.postTokenBalances, si) !== n) refuse('the source balance change does not equal the amount.');
  if (destinationAta && total(tx.meta.postTokenBalances, di) - total(tx.meta.preTokenBalances, di) !== n) refuse('the destination balance change does not equal the amount.');
  const changed = new Set([...(tx.meta.preTokenBalances || []), ...(tx.meta.postTokenBalances || [])].filter(b => b.mint === mint).map(b => b.accountIndex));
  for (const at of changed) if (at !== si && at !== di && total(tx.meta.postTokenBalances, at) !== total(tx.meta.preTokenBalances, at)) refuse('other RYO balances changed in the same transaction.');
  // Never re-use a signature already accounted for anywhere in the ledger.
  const duplicate = (await c.query(`SELECT 1 FROM ryo_treasury_movements WHERE scope=$1 AND signature=$2 UNION ALL SELECT 1 FROM ryo_service_revenue WHERE scope=$1 AND signature=$2
    UNION ALL SELECT 1 FROM ryo_revenue_replenishments WHERE scope=$1 AND signature=$2 UNION ALL SELECT 1 FROM ryo_deposits WHERE scope=$1 AND signature=$2
    UNION ALL SELECT 1 FROM ryo_withdrawals WHERE scope=$1 AND signature=$2 UNION ALL SELECT 1 FROM ryo_purchases WHERE scope=$1 AND signature=$2
    UNION ALL SELECT 1 FROM ryo_withdrawal_treasury_fees WHERE scope=$1 AND signature=$2`, [ctx.store.scope, payload.signature])).rows;
  // Expedition revenue lives in a lazily created table: checked only when it exists.
  if (!duplicate.length && (await c.query("SELECT to_regclass('ryo_expedition_revenue') IS NOT NULL AS t")).rows[0].t) duplicate.push(...(await c.query('SELECT 1 FROM ryo_expedition_revenue WHERE scope=$1 AND signature=$2', [ctx.store.scope, payload.signature])).rows);
  if (duplicate.length) refuse('this transaction is already accounted for.');
  // Governance at record time: every registered Squads vault on either side must still match its registered governance; a direct
  // signer must still be a plain wallet.
  const V = require('./treasury-verify.cjs'), roleOf = a => Object.keys(reg.squads.vaultAddresses).find(r => reg.squads.vaultAddresses[r] === a);
  for (const a of [source, destination].filter(Boolean)) {
    const role = roleOf(a); if (!role) continue;
    const forbidden = [custody, ...Object.values(reg.addresses), ...Object.values(reg.reserveAddresses)].filter(x => x && x !== a);
    const sq = await V.verifySquads(ctx.connection, reg, { role, forbidden });
    if (sq.status !== 'verified') fail('The Squads multisig no longer matches its registered governance. ' + (sq.problems || []).join(' '), 503);
  }
  if (!viaSquads) {
    const w = await V.verifyWallet(ctx.connection, source);
    if (w.status !== 'verified') fail('The source wallet could not be verified as a plain wallet. ' + (w.problems || []).join(' '), 503);
  }
  return { kind: payload.kind, signature: payload.signature, amountRaw: payload.amountRaw, mint, tokenProgram: TOKEN, source, destination, sourceAta, destinationAta,
    instruction: op.parsed.type, path: viaSquads ? 'squads-vault-execute' : 'direct', slot: tx.slot, blockTime: tx.blockTime ?? null, commitment: 'finalized', confirmation: 'finalized',
    ...(leg ? { migrationId: reg.treasuryMigration.id, leg: leg.leg } : {}) };
}

/** Called inside the approving admin transaction: verify again, then append. */
async function record(ctx, c, payload, proposal) {
  const proof = await verifyMovement(ctx, payload, c);
  await c.query(`INSERT INTO ryo_treasury_movements(scope,signature,kind,source_address,destination_address,mint,amount_raw,slot,block_time,proposal_id,evidence,created,commitment,migration_id,leg)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [ctx.store.scope, payload.signature, payload.kind, proof.source, proof.destination, proof.mint, payload.amountRaw, proof.slot, proof.blockTime,
    proposal.id, JSON.stringify({ ...proof, proposer: proposal.proposer, evidence: payload.evidence }), ctx.store.now(), proof.commitment, proof.migrationId ?? null, proof.leg ?? null]);
  return proof;
}

/** Totals and history (admin and public). Read-only. Burned = verified burn records only; reserved RYO is never included. */
async function report(store, c = store.pool, { limit = 50 } = {}) {
  if (!live()) return { applicable: false };
  const totals = Object.fromEntries((await c.query('SELECT kind,COUNT(*) AS n,COALESCE(SUM(amount_raw),0) AS raw FROM ryo_treasury_movements WHERE scope=$1 GROUP BY kind', [store.scope])).rows.map(r => [r.kind, { count: Number(r.n), raw: String(r.raw) }]));
  const history = (await c.query('SELECT kind,signature,source_address,destination_address,amount_raw,slot,block_time,created,commitment,migration_id,leg FROM ryo_treasury_movements WHERE scope=$1 ORDER BY created DESC LIMIT $2', [store.scope, limit])).rows
    .map(r => ({ kind: r.kind, signature: r.signature, source: r.source_address, destination: r.destination_address, amountRaw: String(r.amount_raw), slot: Number(r.slot), blockTime: r.block_time == null ? null : Number(r.block_time), recorded: Number(r.created),
      confirmation: r.commitment || 'finalized', ...(r.migration_id ? { migrationId: r.migration_id, leg: Number(r.leg) } : {}) }));
  const of = k => totals[k] || { count: 0, raw: '0' };
  // Treasury migration reconciliation: relocated RYO per registered leg (history is permanent, also after completion).
  const mig = registry().treasuryMigration;
  const perLeg = mig ? Object.fromEntries((await c.query("SELECT leg,COUNT(*) AS n,COALESCE(SUM(amount_raw),0) AS raw FROM ryo_treasury_movements WHERE scope=$1 AND kind='treasuryRelocation' AND migration_id=$2 GROUP BY leg", [store.scope, mig.id])).rows.map(r => [Number(r.leg), { count: Number(r.n), raw: String(r.raw) }])) : {};
  const migration = mig ? { id: mig.id, status: mig.status, recordingOpen: mig.status === 'open', legs: mig.legs.map(l => ({ leg: l.leg, from: l.from, to: l.to, path: l.path, relocatedRaw: perLeg[l.leg]?.raw || '0', transfers: perLeg[l.leg]?.count || 0, awaitingDestination: !l.to })),
    note: 'Treasury relocations are internal transfers: never revenue, never burns. Recording closes when the migration is completed and reconciled; the history stays.' } : null;
  return { applicable: true, migration, burnedRaw: of('burn').raw, burns: of('burn').count, fundedRaw: of('burnReserveFunding').raw, fundings: of('burnReserveFunding').count, relocatedRaw: of('treasuryRelocation').raw, relocations: of('treasuryRelocation').count, history,
    note: 'Burned counts only finalized Token-2022 burns from the RYO Burn Reserve that passed two-person verification. RYO held in the reserve is reserved, not burned.' };
}

/** Public, read-only figures for /treasury (cached 30 s per scope; no wallet, key or write). */
const cache = new Map();
async function publicReport(store, { ttl = 30000 } = {}) {
  if (!live()) return { applicable: false };
  const hit = cache.get(store.scope), now = Date.now();
  if (hit && now - hit.at < ttl) return hit.value;
  const value = { ...(await report(store, store.pool, { limit: 25 })), observedAt: now };
  cache.set(store.scope, { at: now, value });
  return value;
}

module.exports = { KINDS, validateMovement, verifyMovement, record, report, publicReport, SQUADS_VAULT_EXECUTE };
