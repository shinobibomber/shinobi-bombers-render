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
async function verifyVaults(ctx, cfg) {
 const reg = registry(), v = require('./treasury-verify.cjs');
 for (const name of FIELDS) if (cfg.destinations[name] !== reg.addresses[name]) fail('SR destinations must equal the reviewed public registry.', 409);
 const own = [ctx.treasuryAddress, ctx.studioAddress, ctx.revenueAddress].filter(Boolean);
 for (const name of FIELDS) if (own.includes(cfg.destinations[name])) fail('SR revenue destinations must be separate from the game custody, studio and legacy revenue wallets. Active Rewards now leaves custody for the registered Active Reward Pool wallet.', 409);
 await ctx.checkNetwork();
 const squads = await v.verifySquads(ctx.connection, reg, { forbidden: [...own, cfg.destinations.activeRewards, cfg.destinations.communityRewards, cfg.destinations.economicReserve] });
 if (squads.status !== 'verified') fail('Locked Treasury must be the registered, finalized Squads v4 vault (' + reg.squads.threshold + '-of-' + reg.squads.members.length + ', no config authority). ' + (squads.problems || []).join(' '), 503);
 for (const name of ['activeRewards', 'communityRewards', 'economicReserve']) {
  const w = await v.verifyWallet(ctx.connection, cfg.destinations[name]);
  if (w.status !== 'verified') fail('The ' + name + ' destination could not be verified as a plain wallet. ' + (w.problems || []).join(' '), 503);
 }
 const ata = await v.verifyTokenAccount(ctx.connection, ctx.mint, cfg.destinations.lockedTreasury);
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
 if (!enabled()) return { n:Number((await c.query(INCOME_SQL, [store.scope])).rows[0].n) };
 const base = (await c.query(LIVE_INCOME_SQL, [store.scope])).rows[0];
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
async function verifyReplenishment(ctx, cfg, payload, c = ctx.store.pool) {
 const { PublicKey } = require('@solana/web3.js'), spl = require('@solana/spl-token');
 await ctx.checkNetwork();
 const tx = await ctx.connection.getParsedTransaction(payload.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
 if (!tx?.meta || tx.meta.err || tx.transaction?.signatures?.[0] !== payload.signature) fail('The replenishment transaction has not finalized successfully.', 409);
 const source = spl.getAssociatedTokenAddressSync(new PublicKey(ctx.mint), new PublicKey(cfg.destinations[payload.source]), true).toBase58();
 const target = spl.getAssociatedTokenAddressSync(new PublicKey(ctx.mint), new PublicKey(ctx.treasuryAddress), true).toBase58();
 const keys = tx.transaction.message.accountKeys;
 const transfer = tx.transaction.message.instructions.filter(i => i.programId.toString() === spl.TOKEN_PROGRAM_ID.toBase58() && i.parsed?.type === 'transferChecked');
 if (transfer.length !== 1) fail('Replenishment must contain one explicit approved SR transfer.', 409);
 const info = transfer[0].parsed.info;
 if (info.source !== source || info.destination !== target || info.mint !== ctx.mint || info.tokenAmount?.amount !== payload.amountRaw || info.tokenAmount?.decimals !== 6) fail('Replenishment source, destination, token or amount does not match the approved request.', 409);
 const delta = (ata, owner) => {
  const at = keys.findIndex(k => k.pubkey.toString() === ata); if (at < 0) fail('Missing replenishment account evidence.', 409);
  const amount = values => { const b = values?.find(b => b.accountIndex === at && b.mint === ctx.mint && b.owner === owner); if (!b || b.uiTokenAmount.decimals !== 6) fail('Missing finalized replenishment token balances.', 409); return raw(b.uiTokenAmount.amount); };
  return amount(tx.meta.postTokenBalances) - amount(tx.meta.preTokenBalances);
 };
 if (delta(source, cfg.destinations[payload.source]) !== -raw(payload.amountRaw) || delta(target, ctx.treasuryAddress) !== raw(payload.amountRaw)) fail('Finalized replenishment balance changes do not match.', 409);
 // No distribution/claim/withdrawal signature may be re-used as a funding deposit.
 const duplicate = (await c.query(`SELECT 1 FROM ryo_service_revenue WHERE scope=$1 AND signature=$2 UNION ALL
   SELECT 1 FROM ryo_deposits WHERE scope=$1 AND signature=$2 UNION ALL SELECT 1 FROM ryo_revenue_replenishments WHERE scope=$1 AND signature=$2
   UNION ALL SELECT 1 FROM ryo_withdrawals WHERE scope=$1 AND signature=$2 UNION ALL SELECT 1 FROM ryo_purchases WHERE scope=$1 AND signature=$2`, [ctx.store.scope, payload.signature])).rows;
 if (duplicate.length) fail('This transaction is already accounted for.', 409);
 return { sourceAta: source, destinationAta: target, mint: ctx.mint, amountRaw: payload.amountRaw, commitment: 'finalized', slot: tx.slot, internalTransfer: true };
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
