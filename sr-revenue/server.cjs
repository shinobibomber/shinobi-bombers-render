'use strict';
const { fail } = require('./store.cjs');
const crypto = require('node:crypto');
// v2: destinations are pinned to the reviewed public registry, the Treasury is a verified Squads v4 vault and the
// 30% Active Rewards share leaves custody for the registered Active Reward Pool wallet. v1 quotes (if any were
// signed before an upgrade) still settle under their original persisted wire and evidence.
const MARKER = 'sr-revenue-distribution-v2', VERSION = 2, SETTLE_VERSIONS = Object.freeze([1, 2]), UNIT = 1000000n;
const RATES = Object.freeze({ lockedTreasury: 5000, activeRewards: 3000, communityRewards: 1000, economicReserve: 1000 });
const APPROVED = Object.freeze(['summon', 'fusion', 'dojo', 'training']);
const OPTIONAL = Object.freeze(['sensei', 'sensei-rental']);
const FIELDS = Object.keys(RATES);
const REPLENISH_SOURCES = Object.freeze(['activeRewards', 'lockedTreasury', 'economicReserve']);
// Bound to the validated build stamp; a request or environment override cannot enable this on beta.
const enabled = () => require('./network.cjs').built(__dirname).key === 'mainnet';
const registry = () => require('./treasury-registry.cjs').registry();
function publicPolicy() {
 return enabled() ? { marker:'sr-economy-live-only-v1', mode:'live-sr', network:'mainnet', ratesBps:RATES, serviceBurnBps:0, serviceStudioBps:0, withdrawalTreasuryBps:500, treasuryRegistry:'/treasury-registry.json' }
  : { marker:'sr-economy-live-only-v1', mode:'beta-legacy', network:'devnet', ratesBps:{operations:8000,treasury:1000,burn:800,studio:200}, serviceBurnBps:800, serviceStudioBps:200 };
}
const raw = value => { try { if (!/^[0-9]+$/.test(String(value))) throw Error(); return BigInt(value); } catch { fail('Invalid SR base-unit amount.'); } };
/** Exact base-unit split: floor each of the first three shares, the remainder to Economic Reserve. */
function splitRaw(total) {
 if (typeof total !== 'bigint' || total < 1n) fail('Invalid SR base-unit amount.');
 const allocations = {}; let used = 0n;
 for (const name of FIELDS.slice(0, -1)) { const n = total * BigInt(RATES[name]) / 10000n; allocations[name] = String(n); used += n; }
 allocations.economicReserve = String(total - used);
 return allocations;
}
function split(base) {
 if (!Number.isSafeInteger(base) || base < 1) fail('Invalid service price.');
 const total = BigInt(base) * UNIT, allocations = splitRaw(total);
 const ryo = name => Number(allocations[name]) / Number(UNIT);
 return { studioFee: 0, treasury: ryo('lockedTreasury'), burn: 0, operations: ryo('activeRewards'), community: ryo('communityRewards'), reserve: ryo('economicReserve'),
   revenueDistribution: { marker: MARKER, version: VERSION, basis: 'full-service-payment', totalRaw: String(total), allocations, ratesBps: RATES } };
}
function validateConfig(payload) {
 if (!payload || typeof payload !== 'object' || typeof payload.enabled !== 'boolean') fail('Choose whether SR routing is enabled.');
 const reg = registry(), destinations = {};
 for (const name of FIELDS) {
  const value = payload.destinations?.[name];
  if (typeof value !== 'string' || value !== reg.addresses[name]) fail('The ' + name + ' destination must equal the reviewed public registry address (' + reg.addresses[name] + '). Registry changes need a reviewed commit.');
  destinations[name] = value;
 }
 if (payload.lockedTreasuryMultisig !== undefined && payload.lockedTreasuryMultisig !== reg.squads.multisig) fail('lockedTreasuryMultisig must equal the registered Squads multisig.');
 const products = payload.products || APPROVED;
 if (!Array.isArray(products) || !products.length || new Set(products).size !== products.length || products.some(p => ![...APPROVED, ...OPTIONAL].includes(p))) fail('Approve only supported SR game-service fees. Market proceeds, Boss Hunt and SOL payments are excluded.');
 if (typeof payload.evidence !== 'string' || !payload.evidence.trim() || payload.evidence.length > 500) fail('Enter the revenue policy / custody evidence reference.');
 return { enabled: payload.enabled, destinations, lockedTreasuryMultisig: reg.squads.multisig, products, evidence: payload.evidence.trim(), version: VERSION };
}
async function config(store, c = store.pool, lock = false) {
 if (!enabled()) return null;
 const row = (await c.query('SELECT config,version FROM ryo_admin_control WHERE scope=$1' + (lock ? ' FOR SHARE' : ''), [store.scope])).rows[0];
 const value = row?.config?.revenueRouting;
 if (!value) return null;
 // An approved configuration that no longer matches the committed registry is stale: routing stops (fail closed).
 try { return { ...validateConfig(value), configVersion: Number(row.version) }; }
 catch (e) { return { enabled: false, stale: true, problem: e.message, products: [], configVersion: Number(row.version) }; }
}
/** The independent activation locks besides the approved DB configuration. Empty = all satisfied. */
function activationProblems(ctx = {}) {
 const problems = [], reg = registry();
 if (!require('./launch-gates.cjs').srRoutingEnabled()) problems.push('SR_REVENUE_ROUTING_ENABLED is off.');
 if (!reg.activation.approved) problems.push('The registry activation approval has not been committed.');
 if (!reg.srMintAddress) problems.push('The SR mint is not registered.');
 else if (ctx.mint && ctx.mint !== reg.srMintAddress) problems.push('The server mint does not match the registered SR mint.');
 return problems;
}
async function preview(store, wallet, q) {
 if (!q.revenueDistribution) return q;
 const cfg = await config(store), account = (await store.pool.query('SELECT bonus FROM ryo_accounts WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0];
 const bonus = Number(account?.bonus || 0) >= q.total, locks = activationProblems();
 return { ...q, ...(bonus ? { funding: 'bonus' } : {}), revenueDistribution: { ...q.revenueDistribution,
  ready: bonus || (!!cfg?.enabled && cfg.products.includes(q.product) && !locks.length), configured: !!cfg?.enabled,
  note: bonus ? 'Starter Ryo payment: no tokens will be distributed.' : cfg?.stale ? 'SR routing configuration no longer matches the reviewed registry. No payment can be submitted.' : !cfg?.enabled ? 'Awaiting approved SR revenue vault configuration. No payment can be submitted.' : !cfg.products.includes(q.product) ? 'This SR service fee is not approved for revenue routing.' : locks.length ? 'SR revenue routing is not activated yet. No payment can be submitted.' : 'Squads Treasury and destinations are re-verified before submission.' } };
}
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Squads v4 governance at finalized commitment: registered multisig, threshold, members, no config authority, owner.
// Used by checkout routing approval and by Locked Treasury top-ups (a drifted multisig can fund neither).
async function verifySquadsGovernance(ctx, cfg) {
 const reg = registry(), own = [ctx.treasuryAddress, ctx.studioAddress, ctx.revenueAddress].filter(Boolean);
 const squads = await require('./treasury-verify.cjs').verifySquads(ctx.connection, reg, { forbidden: [...own, cfg.destinations.activeRewards, cfg.destinations.communityRewards, cfg.destinations.economicReserve] });
 if (squads.status !== 'verified') fail('Locked Treasury must be the registered, finalized Squads v4 vault (' + reg.squads.threshold + '-of-' + reg.squads.members.length + ', no config authority). ' + (squads.problems || []).join(' '), 503);
 return squads;
}
async function verifyVaults(ctx, cfg) {
 const reg = registry(), v = require('./treasury-verify.cjs');
 for (const name of FIELDS) if (cfg.destinations[name] !== reg.addresses[name]) fail('SR destinations must equal the reviewed public registry.', 409);
 const own = [ctx.treasuryAddress, ctx.studioAddress, ctx.revenueAddress].filter(Boolean);
 for (const name of FIELDS) if (own.includes(cfg.destinations[name])) fail('SR revenue destinations must be separate from the game custody, studio and legacy revenue wallets. Active Rewards now leaves custody for the registered Active Reward Pool wallet.', 409);
 await ctx.checkNetwork();
 const squads = await verifySquadsGovernance(ctx, cfg);
 for (const name of ['activeRewards', 'communityRewards', 'economicReserve']) {
  const w = await v.verifyWallet(ctx.connection, cfg.destinations[name]);
  if (w.status !== 'verified') fail('The ' + name + ' destination could not be verified as a plain wallet. ' + (w.problems || []).join(' '), 503);
 }
 const ata = await v.verifyTokenAccount(ctx.connection, ctx.mint, cfg.destinations.lockedTreasury, reg.srMintProgram);
 if (ata.status !== 'verified') fail('Locked Treasury token account has a delegate, invalid owner or unsupported authority.', 503);
 return { kind: 'squads-v4', multisig: reg.squads.multisig, required: squads.threshold, members: squads.members.length, timeLockSeconds: squads.timeLockSeconds, commitment: 'finalized', verified: true,
   note: 'Squads ' + squads.threshold + '-of-' + squads.members.length + ' approval verified; no timelock or vesting schedule is claimed.' };
}
async function instructions(ctx, q, requestId, transferTo, memo) {
 try {
 if (!enabled()) fail('SR revenue routing is available only on the live server.', 403);
 if (typeof ctx.wallet !== 'string' || !ctx.wallet) fail('Missing SR payment owner.', 503);
 if (!q.revenueDistribution || q.revenueDistribution.version !== VERSION || q.burn !== 0 || q.studioFee !== 0) fail('Refresh the approved SR service quote.', 409);
 const locks = activationProblems(ctx);
 if (locks.length) fail('SR revenue routing is not activated: ' + locks.join(' ') + ' No service payment was submitted.', 503);
 const cfg = await config(ctx.store, ctx.client || ctx.store.pool, !!ctx.client);
 if (!cfg?.enabled) fail('SR Revenue Distribution awaits independently approved vault configuration. No service payment was submitted.', 503);
 if (!cfg.products.includes(q.product)) fail('This SR service fee is not approved for revenue routing. No payment was submitted.', 403);
 const proof = await verifyVaults(ctx, cfg), expected = split(q.total).revenueDistribution;
 if (q.revenueDistribution.totalRaw !== expected.totalRaw || FIELDS.some(k => q.revenueDistribution.allocations[k] !== expected.allocations[k])) fail('SR distribution amounts do not match the fixed 50/30/10/10 model.', 409);
 q.revenueDistribution = { ...expected, destinations: cfg.destinations, configVersion: cfg.configVersion, lockProof: proof, configHash: hash(cfg) };
 // One atomic transaction: all four allocations succeed together or none do.
 return [...FIELDS.flatMap(name => transferTo(cfg.destinations[name], raw(expected.allocations[name]))),
   memo(MARKER + ':' + hash({ scope: ctx.store.scope, wallet: ctx.wallet, requestId }) + ':' + q.revenueDistribution.configHash.slice(0, 12))];
 } catch (error) { error.paymentNotSubmitted = true; throw error; }
}
async function settled(store, c, row) {
 const d = row.quote?.revenueDistribution;
 if (!d || row.quote?.funding === 'bonus' || String(row.signature).startsWith('bonus:')) return;
 if (!SETTLE_VERSIONS.includes(d.version) || !row.wire || !d.destinations || !d.lockProof?.verified) fail('Missing persisted SR routing evidence.', 503);
 const expected = splitRaw(BigInt(row.amount) * UNIT);
 if (FIELDS.some(k => d.allocations[k] !== expected[k]) || d.totalRaw !== String(BigInt(row.amount) * UNIT)) fail('Persisted SR allocation is inconsistent.', 503);
 await c.query(`INSERT INTO ryo_service_revenue(scope,wallet,request_id,signature,product,total_raw,allocations,destinations,config_version,created)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(scope,wallet,request_id) DO NOTHING`, [store.scope, row.wallet, row.request_id, row.signature, row.product, d.totalRaw, JSON.stringify(d.allocations), JSON.stringify(d.destinations), d.configVersion, store.now()]);
}
// Only explicit service allocations and legacy eligible retained income fund Adventure.
// New Market fee revenue is segregated; historical quotes retain their original interpretation.
const INCOME_SQL = "SELECT COALESCE(SUM((quote->>'operations')::numeric),0) AS n FROM ryo_purchases WHERE scope=$1 AND status='confirmed' AND COALESCE(quote->>'funding','')<>'bonus' AND COALESCE(quote->>'adventureEligible','true')<>'false'";
// Live v2: the 30% left custody for the Active Reward Pool wallet, so it funds claims only once topped up.
const LIVE_INCOME_SQL = INCOME_SQL + " AND COALESCE(quote->'revenueDistribution'->>'version','1')<>'2'";
async function income(store, c) {
 // Same totals as INCOME_SQL / LIVE_INCOME_SQL, read from the indexed generated column (reward-pool.cjs verifies them once per process).
 if (!enabled()) return { n: await require('./reward-pool.cjs').purchaseIncome(store, c, false) };
 const base = { n: await require('./reward-pool.cjs').purchaseIncome(store, c, true) };
 const topups = (await c.query('SELECT COALESCE(SUM(amount_raw),0) AS n FROM ryo_revenue_replenishments WHERE scope=$1', [store.scope])).rows[0];
 return { n: Number(base.n) + Number(topups.n) / Number(UNIT) };
}
function validateReplenishment(payload) {
 if (!payload || !REPLENISH_SOURCES.includes(payload.source)) fail('Only approved Active Reward Pool, Treasury or Reserve top-ups may fund Adventure claims. Community Rewards remain separate.');
 if (typeof payload.signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(payload.signature)) fail('Enter a valid finalized transfer signature.');
 if (typeof payload.amountRaw !== 'string' || !/^[1-9][0-9]{0,23}$/.test(payload.amountRaw) || raw(payload.amountRaw) % UNIT !== 0n) fail('Replenishment must specify whole Ryo in exact base units.');
 if (typeof payload.evidence !== 'string' || !payload.evidence.trim() || payload.evidence.length > 500) fail('Enter the replenishment approval/evidence reference.');
 return { source: payload.source, signature: payload.signature, amountRaw: payload.amountRaw, evidence: payload.evidence.trim() };
}
// Squads v4 Anchor discriminator of vault_transaction_execute: a vault transaction whose proposal reached the threshold.
const SQUADS_VAULT_EXECUTE = crypto.createHash('sha256').update('global:vault_transaction_execute').digest().subarray(0, 8);
async function verifyReplenishment(ctx, cfg, payload, c = ctx.store.pool) {
 const { PublicKey } = require('@solana/web3.js'), spl = require('@solana/spl-token');
 await ctx.checkNetwork();
 const tx = await ctx.connection.getParsedTransaction(payload.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
 if (!tx?.meta || tx.meta.err || tx.transaction?.signatures?.[0] !== payload.signature) fail('The replenishment transaction has not finalized successfully.', 409);
 const program = require('./live-economy.cjs').programId();
 const source = spl.getAssociatedTokenAddressSync(new PublicKey(ctx.mint), new PublicKey(cfg.destinations[payload.source]), true, program).toBase58();
 const target = spl.getAssociatedTokenAddressSync(new PublicKey(ctx.mint), new PublicKey(ctx.treasuryAddress), true, program).toBase58();
 const keys = tx.transaction.message.accountKeys;
 // SR transfer evidence (owner decision 2026-11-10). Exactly one SR transferChecked in the whole transaction, in one of
 // two shapes:
 //  - direct: a top-level transfer signed by the source wallet itself (Active Reward Pool / Economic Reserve);
 //  - Squads: Locked Treasury only. An inner transfer signed by the registered vault inside a vote-approved
 //    vault_transaction_execute of the registered Squads v4 multisig (never spending limits or other Squads calls).
 // Then: exact accounts, mint and amount; exact finalized balance changes; no other SR balance may change.
 const reg = registry(), TOKEN = program.toBase58(), owner = cfg.destinations[payload.source], amountRaw = raw(payload.amountRaw);
 const top = tx.transaction.message.instructions || [];
 const all = [...top.map(i => ({ i, parent: null })), ...(tx.meta.innerInstructions || []).flatMap(g => (g.instructions || []).map(i => ({ i, parent: top[g.index] || {} })))];
 const srTransfers = all.filter(x => x.i.programId?.toString() === TOKEN && x.i.parsed?.type === 'transferChecked' && x.i.parsed?.info?.mint === ctx.mint);
 const refuse = why => fail('Replenishment must contain one explicit approved SR transfer: ' + why, 409);
 const squadsProblem = p => {
  if (p?.programId?.toString() !== reg.squads.programId) return 'the transfer was made inside another program, not the registered Squads program.';
  if (p.accounts?.[0]?.toString() !== reg.squads.multisig) return 'the Squads transaction belongs to a different multisig than the registered one.';
  let discriminator; try { discriminator = Buffer.from(require('bs58').decode(String(p.data || ''))).subarray(0, 8); } catch { discriminator = Buffer.alloc(0); }
  return discriminator.equals(SQUADS_VAULT_EXECUTE) ? null : 'only an approved Squads vault transaction (vault_transaction_execute) is accepted; spending limits, batches and config changes are not.';
 };
 if (!srTransfers.length) refuse('no SR transfer was found in this transaction.');
 if (srTransfers.length > 1) refuse('the transaction moves SR ' + srTransfers.length + ' times; exactly one transfer is accepted.');
 const [{ i: transfer, parent }] = srTransfers, viaSquads = parent !== null, info = transfer.parsed.info;
 if (payload.source === 'lockedTreasury') {
  // Locked Treasury: only through Squads (an inner transfer of the vote-approved vault execution).
  if (!viaSquads) refuse('the Locked Treasury can only send SR through an approved Squads vault transaction.');
  const problem = squadsProblem(parent); if (problem) refuse(problem);
 } else if (viaSquads) refuse('the ' + payload.source + ' wallet must send SR itself, as a top-level transfer (this one was made inside another program).');
 // The signer. Squads path: the registered vault PDA as the transfer authority. Direct path: the registered wallet as the
 // transfer authority (Solana reports it as multisigAuthority when the wallet built the instruction with extra trailing
 // accounts, as on 2026-11-10) AND as a signer of the transaction itself; it is re-verified below as a plain wallet, so
 // the token program accepted the transfer on that wallet's own signature.
 const signedBy = viaSquads ? info.authority : (info.authority || info.multisigAuthority);
 if (signedBy !== owner || (!viaSquads && !keys.some(k => k.pubkey.toString() === owner && k.signer === true))) refuse('the transfer was not signed by the registered ' + payload.source + ' wallet.');
 // A game deposit (it carries the deposit memo) belongs to the player deposit ledger and is never a top-up.
 if (all.some(x => typeof x.i.parsed === 'string' && x.i.parsed.startsWith('shinobi-deposit'))) refuse('this is a game deposit (it carries a deposit memo), not a top-up.');
 // From here an inner (viaSquads) transfer is always the approved Squads path of the Locked Treasury.
 if (info.source !== source || info.destination !== target || info.mint !== ctx.mint || info.tokenAmount?.amount !== payload.amountRaw || info.tokenAmount?.decimals !== 6) fail('Replenishment source, destination, token or amount does not match the approved request.', 409);
 const indexOf = ata => keys.findIndex(k => k.pubkey.toString() === ata), si = indexOf(source), ti = indexOf(target);
 if (si < 0 || ti < 0) fail('Missing replenishment account evidence.', 409);
 const srRows = (list, at) => (list || []).filter(b => b.accountIndex === at && b.mint === ctx.mint);
 const balance = (list, at, who, missingIsZero = false) => { const rows = srRows(list, at); if (!rows.length && missingIsZero) return 0n; const b = rows.find(b => b.owner === who); if (!b || b.uiTokenAmount.decimals !== 6) fail('Missing finalized replenishment token balances.', 409); return raw(b.uiTokenAmount.amount); };
 // Squads path only: the custody SR account may be created by this same transaction (no 'before' record under any owner),
 // through an associated-token-account creation for the custody wallet and the SR mint.
 const ATA_PROGRAM = spl.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
 const newTarget = viaSquads && !srRows(tx.meta.preTokenBalances, ti).length && all.some(x => x.i.programId?.toString() === ATA_PROGRAM && ['create', 'createIdempotent'].includes(x.i.parsed?.type)
  && x.i.parsed?.info?.account === target && x.i.parsed?.info?.mint === ctx.mint && x.i.parsed?.info?.wallet === ctx.treasuryAddress);
 if (balance(tx.meta.postTokenBalances, si, owner) - balance(tx.meta.preTokenBalances, si, owner) !== -amountRaw
  || balance(tx.meta.postTokenBalances, ti, ctx.treasuryAddress) - balance(tx.meta.preTokenBalances, ti, ctx.treasuryAddress, newTarget) !== amountRaw) fail('Finalized replenishment balance changes do not match.', 409);
 const srIndexes = new Set([...(tx.meta.preTokenBalances || []), ...(tx.meta.postTokenBalances || [])].filter(b => b.mint === ctx.mint).map(b => b.accountIndex));
 const total = (list, at) => srRows(list, at).reduce((n, b) => n + raw(b.uiTokenAmount.amount), 0n);
 for (const at of srIndexes) if (at !== si && at !== ti && total(tx.meta.postTokenBalances, at) !== total(tx.meta.preTokenBalances, at)) fail('Other SR balances changed in the replenishment transaction.', 409);
 // No distribution/claim/withdrawal signature may be re-used as a funding deposit.
 const duplicate = (await c.query(`SELECT 1 FROM ryo_service_revenue WHERE scope=$1 AND signature=$2 UNION ALL
   SELECT 1 FROM ryo_deposits WHERE scope=$1 AND signature=$2 UNION ALL SELECT 1 FROM ryo_revenue_replenishments WHERE scope=$1 AND signature=$2
   UNION ALL SELECT 1 FROM ryo_withdrawals WHERE scope=$1 AND signature=$2 UNION ALL SELECT 1 FROM ryo_purchases WHERE scope=$1 AND signature=$2`, [ctx.store.scope, payload.signature])).rows;
 if (duplicate.length) fail('This transaction is already accounted for.', 409);
 // The Squads multisig must still have its registered governance (threshold, members, no config authority) when the
 // top-up is approved; a drifted multisig can no longer fund claims. This checks the current state: the state at the
 // transaction's slot is not readable, so the two-person top-up approval remains the review of past governance.
 if (viaSquads) await verifySquadsGovernance(ctx, cfg);
 else { const w = await require('./treasury-verify.cjs').verifyWallet(ctx.connection, owner); if (w.status !== 'verified') fail('The ' + payload.source + ' wallet could not be verified as a plain wallet. ' + (w.problems || []).join(' '), 503); }
 return { sourceAta: source, destinationAta: target, mint: ctx.mint, amountRaw: payload.amountRaw, commitment: 'finalized', slot: tx.slot, internalTransfer: true, path: viaSquads ? 'squads-vault-execute' : 'direct', signer: info.authority ? 'authority' : 'multisigAuthority' };
}
async function applyApproval(ctx, c, kind, value, proposal) {
 if (!enabled()) fail('SR revenue configuration is available only on the live server.', 403);
 if (kind === 'revenueRouting') {
  const cfg = validateConfig(value); await verifyVaults(ctx, cfg);
  return { revenueRouting: cfg };
 }
 const payload = validateReplenishment(value), cfg = await config(ctx.store, c);
 if (!cfg?.enabled) fail('Approve SR routing before replenishing rewards.', 409);
 const proof = await verifyReplenishment(ctx, cfg, payload, c);
 await c.query('INSERT INTO ryo_reward_pools(scope) VALUES($1) ON CONFLICT DO NOTHING', [ctx.store.scope]);
 await c.query('SELECT scope FROM ryo_reward_pools WHERE scope=$1 FOR UPDATE', [ctx.store.scope]);
 await c.query('INSERT INTO ryo_revenue_replenishments(scope,signature,source,amount_raw,proposal_id,evidence,created) VALUES($1,$2,$3,$4,$5,$6,$7)', [ctx.store.scope, payload.signature, payload.source, payload.amountRaw, proposal.id, JSON.stringify({ ...proof, proposer: proposal.proposer, evidence: payload.evidence }), ctx.store.now()]);
 return {};
}
async function summary(ctx, c) {
 if (!enabled()) return { ...publicPolicy(), applicable:false, ready:false, config:null };
 const cfg = await config(ctx.store, c), aggregate = (await c.query(`SELECT COUNT(*) AS count,${FIELDS.map(k => `COALESCE(SUM((allocations->>'${k}')::numeric),0) AS "${k}"`).join(',')} FROM ryo_service_revenue WHERE scope=$1`, [ctx.store.scope])).rows[0];
 const totals = Object.fromEntries(FIELDS.map(k => [k, String(aggregate[k])]));
 const replenished = (await c.query('SELECT source,COALESCE(SUM(amount_raw),0) AS raw FROM ryo_revenue_replenishments WHERE scope=$1 GROUP BY source', [ctx.store.scope])).rows;
 const history = (await c.query('SELECT wallet,request_id,signature,product,total_raw,allocations,config_version,created FROM ryo_service_revenue WHERE scope=$1 ORDER BY created DESC LIMIT 50', [ctx.store.scope])).rows.map(r => ({ ...r, total_raw: String(r.total_raw), created: Number(r.created) }));
 const replenishments = (await c.query('SELECT signature,source,amount_raw,proposal_id,created FROM ryo_revenue_replenishments WHERE scope=$1 ORDER BY created DESC LIMIT 50', [ctx.store.scope])).rows.map(r => ({ ...r, amount_raw: String(r.amount_raw), created: Number(r.created) }));
 const locks = activationProblems(ctx);
 return { marker: MARKER, applicable:true, ratesBps: RATES, basis: 'full-service-payment', config: cfg, ready: !!cfg?.enabled && !locks.length, activation: { problems: locks }, totalsRaw: totals, transactions: Number(aggregate.count), replenished, history, replenishments,
   custody: 'The 30% Active Rewards share is sent to the registered Active Reward Pool wallet. Adventure claims are funded only by verified, independently approved top-ups into game custody.',
   lockedTreasury: 'New checkouts require the registered Squads v4 vault to verify at finalized commitment. This is multisig approval, not a timelock or vesting guarantee.',
   exclusions: ['Sensei SOL', 'Market sale proceeds', 'Boss Hunt prizes', 'PvP', 'buybacks', 'bonus-funded purchases', 'withdrawal deductions (separate ledger)'] };
}
module.exports = { MARKER, VERSION, UNIT, RATES, APPROVED, REPLENISH_SOURCES, enabled, publicPolicy, splitRaw, split, validateConfig, config, activationProblems, preview, verifyVaults, instructions, settled, INCOME_SQL, LIVE_INCOME_SQL, income, validateReplenishment, verifyReplenishment, applyApproval, summary };
