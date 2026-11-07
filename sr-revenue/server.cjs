'use strict';
const { fail } = require('./store.cjs');
const crypto = require('node:crypto');
const MARKER = 'sr-revenue-distribution-v1', VERSION = 1, UNIT = 1000000n;
const RATES = Object.freeze({ lockedTreasury: 5000, activeRewards: 3000, communityRewards: 1000, economicReserve: 1000 });
const APPROVED = Object.freeze(['summon', 'fusion', 'dojo', 'training']);
const OPTIONAL = Object.freeze(['sensei', 'sensei-rental']);
const FIELDS = Object.keys(RATES);
// Bound to the validated build stamp; a request or environment override cannot enable this on beta.
const enabled = () => require('./network.cjs').built(__dirname).key === 'mainnet';
function publicPolicy() {
 return enabled() ? { marker:'sr-economy-live-only-v1', mode:'live-sr', network:'mainnet', ratesBps:RATES, serviceBurnBps:0, serviceStudioBps:0 }
  : { marker:'sr-economy-live-only-v1', mode:'beta-legacy', network:'devnet', ratesBps:{operations:8000,treasury:1000,burn:800,studio:200}, serviceBurnBps:800, serviceStudioBps:200 };
}
const raw = value => { try { if (!/^[0-9]+$/.test(String(value))) throw Error(); return BigInt(value); } catch { fail('Invalid SR base-unit amount.'); } };
function split(base) {
 if (!Number.isSafeInteger(base) || base < 1) fail('Invalid service price.');
 const total = BigInt(base) * UNIT, allocations = {}; let used = 0n;
 for (const name of FIELDS.slice(0, -1)) { const n = total * BigInt(RATES[name]) / 10000n; allocations[name] = String(n); used += n; }
 allocations.economicReserve = String(total - used);
 const ryo = name => Number(allocations[name]) / Number(UNIT);
 return { studioFee: 0, treasury: ryo('lockedTreasury'), burn: 0, operations: ryo('activeRewards'), community: ryo('communityRewards'), reserve: ryo('economicReserve'),
   revenueDistribution: { marker: MARKER, version: VERSION, basis: 'full-service-payment', totalRaw: String(total), allocations, ratesBps: RATES } };
}
function validateConfig(payload) {
 if (!payload || typeof payload !== 'object' || typeof payload.enabled !== 'boolean') fail('Choose whether SR routing is enabled.');
 const { PublicKey } = require('@solana/web3.js'), destinations = {}, seen = new Set();
 for (const name of FIELDS) {
  const value = payload.destinations?.[name];
  try { if (typeof value !== 'string' || new PublicKey(value).toBase58() !== value) throw Error(); } catch { fail('Enter a valid public wallet for ' + name + '.'); }
  if (seen.has(value)) fail('The four SR vault owner addresses must be distinct.'); seen.add(value); destinations[name] = value;
 }
 const products = payload.products || APPROVED;
 if (!Array.isArray(products) || !products.length || new Set(products).size !== products.length || products.some(p => ![...APPROVED, ...OPTIONAL].includes(p))) fail('Approve only supported SR game-service fees. Market proceeds, Boss Hunt and SOL payments are excluded.');
 if (typeof payload.evidence !== 'string' || !payload.evidence.trim() || payload.evidence.length > 500) fail('Enter the revenue policy / custody evidence reference.');
 return { enabled: payload.enabled, destinations, products, evidence: payload.evidence.trim(), version: VERSION };
}
async function config(store, c = store.pool, lock = false) {
 if (!enabled()) return null;
 const row = (await c.query('SELECT config,version FROM ryo_admin_control WHERE scope=$1' + (lock ? ' FOR SHARE' : ''), [store.scope])).rows[0];
 const value = row?.config?.revenueRouting;
 return value ? { ...validateConfig(value), configVersion: Number(row.version) } : null;
}
async function preview(store, wallet, q) {
 if (!q.revenueDistribution) return q;
 const cfg = await config(store), account = (await store.pool.query('SELECT bonus FROM ryo_accounts WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0];
 const bonus = Number(account?.bonus || 0) >= q.total;
 return { ...q, ...(bonus ? { funding: 'bonus' } : {}), revenueDistribution: { ...q.revenueDistribution,
  ready: bonus || (!!cfg?.enabled && cfg.products.includes(q.product)), configured: !!cfg?.enabled,
  note: bonus ? 'Starter Ryo payment: no tokens will be distributed.' : !cfg?.enabled ? 'Awaiting approved SR revenue vault configuration. No payment can be submitted.' : !cfg.products.includes(q.product) ? 'This SR service fee is not approved for revenue routing.' : 'Vault restrictions are re-verified before submission.' } };
}
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function verifyVaults(ctx, cfg) {
 const { PublicKey } = require('@solana/web3.js'), spl = require('@solana/spl-token');
 if (cfg.destinations.activeRewards !== ctx.treasuryAddress) fail('Active Rewards must use the existing player-custody wallet. Its 30% is separately accounted and claim-capped; external reward custody requires a separate settlement adapter.', 409);
 for (const name of ['lockedTreasury', 'communityRewards', 'economicReserve']) if (cfg.destinations[name] === ctx.studioAddress) fail('SR revenue vaults must remain separate from the studio fee wallet.', 409);
 await ctx.checkNetwork();
 const info = await ctx.connection.getAccountInfo(new PublicKey(cfg.destinations.lockedTreasury), 'finalized');
 if (!info || !info.owner.equals(spl.TOKEN_PROGRAM_ID) || info.data.length !== spl.MULTISIG_SIZE) fail('Locked Treasury must be a finalized SPL multisig authority with at least two required signers. A plain wallet address does not prove a lock.', 503);
 const lock = spl.MultisigLayout.decode(info.data);
 const members = Array.from({ length: lock.n }, (_, i) => lock['signer' + (i + 1)].toBase58());
 if (!lock.isInitialized || lock.m < 2 || lock.m > lock.n || lock.n > 11 || new Set(members).size !== lock.n || members.includes(ctx.treasuryAddress) || members.includes(PublicKey.default.toBase58())) fail('Locked Treasury multisig must require two or more distinct external signers and exclude the game custody signer.', 503);
 const ata = spl.getAssociatedTokenAddressSync(new PublicKey(ctx.mint), new PublicKey(cfg.destinations.lockedTreasury), true), account = await ctx.connection.getAccountInfo(ata, 'finalized');
 if (account) {
  if (!account.owner.equals(spl.TOKEN_PROGRAM_ID) || account.data.length !== spl.ACCOUNT_SIZE) fail('Locked Treasury token account is invalid.', 503);
  const token = spl.AccountLayout.decode(account.data);
  if (!token.mint.equals(new PublicKey(ctx.mint)) || !token.owner.equals(new PublicKey(cfg.destinations.lockedTreasury)) || token.delegateOption || token.state !== 1 || (token.closeAuthorityOption && !token.closeAuthority.equals(new PublicKey(cfg.destinations.lockedTreasury)))) fail('Locked Treasury token account has a delegate, invalid owner or unsupported authority.', 503);
 }
 return { kind: 'spl-multisig', required: lock.m, members: lock.n, commitment: 'finalized', verified: true,
   note: 'Multisig restriction verified; no timelock or vesting schedule is claimed.' };
}
async function instructions(ctx, q, requestId, transferTo, memo) {
 try {
 if (!enabled()) fail('SR revenue routing is available only on the live server.', 403);
 if (typeof ctx.wallet !== 'string' || !ctx.wallet) fail('Missing SR payment owner.', 503);
 if (!q.revenueDistribution || q.revenueDistribution.version !== VERSION || q.burn !== 0 || q.studioFee !== 0) fail('Refresh the approved SR service quote.', 409);
 const cfg = await config(ctx.store, ctx.client || ctx.store.pool, !!ctx.client);
 if (!cfg?.enabled) fail('SR Revenue Distribution awaits independently approved vault configuration. No service payment was submitted.', 503);
 if (!cfg.products.includes(q.product)) fail('This SR service fee is not approved for revenue routing. No payment was submitted.', 403);
 const proof = await verifyVaults(ctx, cfg), expected = split(q.total).revenueDistribution;
 if (q.revenueDistribution.totalRaw !== expected.totalRaw || FIELDS.some(k => q.revenueDistribution.allocations[k] !== expected.allocations[k])) fail('SR distribution amounts do not match the fixed 50/30/10/10 model.', 409);
 q.revenueDistribution = { ...expected, destinations: cfg.destinations, configVersion: cfg.configVersion, lockProof: proof, configHash: hash(cfg) };
 return [...transferTo(cfg.destinations.lockedTreasury, raw(expected.allocations.lockedTreasury)),
   ...transferTo(cfg.destinations.communityRewards, raw(expected.allocations.communityRewards)),
   ...transferTo(cfg.destinations.economicReserve, raw(expected.allocations.economicReserve)),
   memo(MARKER + ':' + hash({ scope: ctx.store.scope, wallet: ctx.wallet, requestId }) + ':' + q.revenueDistribution.configHash.slice(0, 12))];
 } catch (error) { error.paymentNotSubmitted = true; throw error; }
}
async function settled(store, c, row) {
 const d = row.quote?.revenueDistribution;
 if (!d || row.quote?.funding === 'bonus' || String(row.signature).startsWith('bonus:')) return;
 if (d.version !== VERSION || !row.wire || !d.destinations || !d.lockProof?.verified) fail('Missing persisted SR routing evidence.', 503);
 const expected = split(Number(row.amount)).revenueDistribution;
 if (FIELDS.some(k => d.allocations[k] !== expected.allocations[k]) || d.totalRaw !== expected.totalRaw) fail('Persisted SR allocation is inconsistent.', 503);
 await c.query(`INSERT INTO ryo_service_revenue(scope,wallet,request_id,signature,product,total_raw,allocations,destinations,config_version,created)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(scope,wallet,request_id) DO NOTHING`, [store.scope, row.wallet, row.request_id, row.signature, row.product, d.totalRaw, JSON.stringify(d.allocations), JSON.stringify(d.destinations), d.configVersion, store.now()]);
}
// Only explicit service allocations and legacy eligible retained income fund Adventure.
// New Market fee revenue is segregated; historical quotes retain their original interpretation.
const INCOME_SQL = "SELECT COALESCE(SUM((quote->>'operations')::numeric),0) AS n FROM ryo_purchases WHERE scope=$1 AND status='confirmed' AND COALESCE(quote->>'funding','')<>'bonus' AND COALESCE(quote->>'adventureEligible','true')<>'false'";
async function income(store, c) {
 const base = (await c.query(INCOME_SQL, [store.scope])).rows[0];
 if (!enabled()) return { n:Number(base.n) };
 const topups = (await c.query('SELECT COALESCE(SUM(amount_raw),0) AS n FROM ryo_revenue_replenishments WHERE scope=$1', [store.scope])).rows[0];
 return { n: Number(base.n) + Number(topups.n) / Number(UNIT) };
}
function validateReplenishment(payload) {
 if (!payload || !['lockedTreasury', 'economicReserve'].includes(payload.source)) fail('Only approved treasury or reserve replenishment may fund Active Rewards. Community Rewards remain separate.');
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
   SELECT 1 FROM ryo_deposits WHERE scope=$1 AND signature=$2 UNION ALL SELECT 1 FROM ryo_revenue_replenishments WHERE scope=$1 AND signature=$2`, [ctx.store.scope, payload.signature])).rows;
 if (duplicate.length) fail('This transaction is already accounted for.', 409);
 return { sourceAta: source, destinationAta: target, mint: ctx.mint, amountRaw: payload.amountRaw, commitment: 'finalized', slot: tx.slot };
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
 return { marker: MARKER, applicable:true, ratesBps: RATES, basis: 'full-service-payment', config: cfg, ready: !!cfg?.enabled, totalsRaw: totals, transactions: Number(aggregate.count), replenished,
   custody: 'Active Rewards is a segregated ledger allocation backed by the game custody wallet; it is not a separate on-chain wallet balance.',
   lockedTreasury: 'New checkouts require finalized external SPL multisig verification. This is not a timelock or vesting guarantee.',
   exclusions: ['Sensei SOL', 'Market sale proceeds', 'Boss Hunt prizes', 'PvP', 'buybacks', 'bonus-funded purchases'] };
}
module.exports = { MARKER, VERSION, UNIT, RATES, APPROVED, enabled, publicPolicy, split, validateConfig, config, preview, verifyVaults, instructions, settled, INCOME_SQL, income, validateReplenishment, verifyReplenishment, applyApproval, summary };
