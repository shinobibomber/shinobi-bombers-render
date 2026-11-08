/* Live (Mainnet build) withdrawal and Chest-claim policy — whitepaper Chapters 05 and 06.
 *
 * Selected by the validated build stamp only (network-build.json), exactly like the SR revenue router:
 * a request body or runtime flag cannot switch it on for the beta/Devnet server, which keeps its original
 * 2% studio withdrawal fee, 24 h withdrawal cooldown and unlimited claim cadence.
 *
 * Withdrawals (live):  5% of the gross SR amount, computed in 6-decimal base units and rounded down, goes to
 *   the registered Squads Treasury vault; 95% goes to the player. No 24 h withdrawal cooldown (the 100,000
 *   minimum and one-pending-withdrawal rule stay). No SOL platform fee. The deduction is booked in its own
 *   ledger (ryo_withdrawal_treasury_fees) on finalized settlement — never in Chapter 04 service revenue.
 * Chest claims (live): once per rolling 24 h per wallet (failed claims roll back and do not consume it),
 *   bounded by an independently approved reward budget (global 24 h emission cap + per-claim maximum).
 *   No budget approved → claims are refused; earnings stay in the Chest. Accrual is unaffected.
 *
 * Copied to app/server/treasury-rewards.cjs by apply-treasury.cjs.
 */
'use strict';
const { fail } = require('./store.cjs');
const UNIT = 1000000n, DAY = 86400000, CLAIM_COOLDOWN_MS = DAY;
const live = () => require('./network.cjs').built(__dirname).key === 'mainnet';
const registry = () => require('./treasury-registry.cjs').registry();

/** Live split of a whole-Ryo gross withdrawal, or null on beta (original 2% studio fee applies). */
function withdrawalPlan(n) {
  if (!live()) return null;
  if (!Number.isSafeInteger(n) || n < 1) fail('Invalid withdrawal amount.');
  const reg = registry(), grossRaw = BigInt(n) * UNIT, bps = BigInt(reg.withdrawalTreasuryFeeBps);
  const feeRaw = grossRaw * bps / 10000n, netRaw = grossRaw - feeRaw;
  return { grossRaw, feeRaw, netRaw, netWhole: Number(netRaw / UNIT), bps: Number(bps), treasury: reg.addresses.lockedTreasury };
}
const withdrawalsAnytime = () => live();
/** Extra withdrawal columns returned to the player on live (exact base units). */
const withdrawalColumns = () => (live() ? 'treasury_fee_raw,net_raw,' : '');

/** Book the finalized 5% deduction in its own ledger. Idempotent; called inside Store.settle's transaction. */
async function withdrawalSettled(store, c, row) {
  if (!live() || !row || BigInt(row.treasury_fee_raw || 0) <= 0n) return;
  const gross = BigInt(row.amount) * UNIT, fee = BigInt(row.treasury_fee_raw), net = BigInt(row.net_raw);
  if (fee + net !== gross || !row.treasury_fee_destination) fail('Persisted withdrawal deduction is inconsistent.', 503);
  await c.query(`INSERT INTO ryo_withdrawal_treasury_fees(scope,wallet,request_id,signature,gross_raw,fee_raw,net_raw,destination,created)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(scope,wallet,request_id) DO NOTHING`,
    [store.scope, row.wallet, row.request_id, row.signature, String(gross), String(fee), String(net), row.treasury_fee_destination, store.now()]);
}

function validateBudget(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('Reward budget must be an object.');
  const whole = (v, min, max, label) => { if (!Number.isSafeInteger(v) || v < min || v > max) fail(label + ' must be a whole number between ' + min + ' and ' + max + '.'); return v; };
  const dailyCapRyo = whole(p.dailyCapRyo, 1, 1000000000, 'Daily emission cap');
  const perClaimMaxRyo = whole(p.perClaimMaxRyo, 1, dailyCapRyo, 'Per-claim maximum');
  if (typeof p.evidence !== 'string' || !p.evidence.trim() || p.evidence.length > 500) fail('Enter the approved reward-budget evidence reference.');
  return { dailyCapRyo, perClaimMaxRyo, evidence: p.evidence.trim() };
}
async function rewardBudget(store, c = store.pool) {
  const row = (await c.query('SELECT config FROM ryo_admin_control WHERE scope=$1', [store.scope])).rows[0];
  try { return row?.config?.rewardBudget ? validateBudget(row.config.rewardBudget) : null; } catch { return null; }
}
async function lastClaim(store, c, wallet) {
  const t = (await c.query('SELECT MAX(created) AS t FROM ryo_reward_claims WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0]?.t;
  return t == null ? null : Number(t);
}
/**
 * Called inside the claim transaction after the global reward-pool row lock, so budget use is serialized.
 * Returns the maximum whole Ryo this claim may credit (Infinity on beta). Throws to refuse the claim.
 */
async function claimLimit(store, c, wallet) {
  if (!live()) return Infinity;
  const now = store.now(), last = await lastClaim(store, c, wallet);
  if (last !== null && now < last + CLAIM_COOLDOWN_MS) fail('Chest rewards can be claimed once every 24 hours. Next claim: ' + new Date(last + CLAIM_COOLDOWN_MS).toISOString() + '. Your earnings stay in your Chest.', 429);
  const budget = await rewardBudget(store, c);
  if (!budget) fail('Chest claims await an approved reward budget. Your earnings stay in your Chest.', 503);
  const used = Number((await c.query('SELECT COALESCE(SUM(amount),0) AS n FROM ryo_reward_claims WHERE scope=$1 AND created>$2', [store.scope, now - DAY])).rows[0].n);
  const remaining = budget.dailyCapRyo - used;
  if (remaining < 1) fail("Today's approved Chest reward budget has been fully claimed. Your earnings stay in your Chest; try again later.", 409);
  return Math.min(budget.perClaimMaxRyo, remaining);
}
/** Live only: when this wallet may claim next (0 = now). null on beta (field omitted). */
async function nextClaimAt(store, c, wallet) {
  if (!live()) return null;
  const last = await lastClaim(store, c, wallet);
  return last === null ? 0 : last + CLAIM_COOLDOWN_MS;
}

/** Fields merged into the public `config` action on live (beta: none, so its payload is unchanged). */
function publicConfig() {
  if (!live()) return {};
  const reg = registry();
  return { withdrawalCooldownMs: 0, withdrawalFeeBps: reg.withdrawalTreasuryFeeBps, withdrawalFeeDestination: 'Locked Treasury', withdrawalFeeAddress: reg.addresses.lockedTreasury,
    claimCooldownMs: CLAIM_COOLDOWN_MS, treasuryRegistry: '/treasury' };
}

/** Live start-up check: the game custody signer is never a registry wallet or Squads member. */
function assertCustody(custody, studio) {
  if (!live()) return;
  const reserved = require('./treasury-registry.cjs').reservedAddresses();
  if (reserved.includes(custody)) fail('The game custody wallet must not be a Chapter 04 wallet, the Squads multisig, a Squads member or the SR mint.', 503);
  if (Object.values(registry().addresses).includes(studio)) fail('The studio fee wallet must not be a Chapter 04 destination.', 503);
}

/**
 * Live only: SR that is genuinely available for player Chest claims right now, kept separate from funds held in
 * the external Chapter 04 wallets. Available = min(approved claim funding not yet claimed [ledger],
 * finalized game claim-custody tokens beyond recorded player liabilities [chain]). Read-only; cached 30 s per
 * scope so public traffic cannot amplify DB or RPC load. Unreadable chain → 'unverified' with no number.
 */
const fundingCache = new Map();
const LIABILITIES_SQL = "SELECT (SELECT COALESCE(SUM(balance),0) FROM ryo_accounts WHERE scope=$1)+(SELECT COALESCE(SUM(amount),0) FROM ryo_withdrawals WHERE scope=$1 AND status='pending')+(SELECT COALESCE(SUM(amount),0) FROM ryo_purchases WHERE scope=$1 AND status='pending') AS n";
async function claimFunding({ store, connection, mint, treasuryAddress, checkNetwork }, { ttl = 30000 } = {}) {
  if (!live()) return { applicable: false };
  const hit = fundingCache.get(store.scope), now = Date.now();
  if (hit?.value && now - hit.at < ttl) return hit.value;
  if (hit?.inflight) return hit.inflight;
  const inflight = (async () => {
    const c = store.pool;
    const income = await require('./sr-revenue.cjs').income(store, c);
    const claimed = Number((await c.query("SELECT COALESCE(SUM((data->>'claimed')::numeric),0) AS n FROM ryo_adventures WHERE scope=$1", [store.scope])).rows[0].n);
    const ledger = Math.max(0, Math.floor(Number(income.n) - claimed)), liabilities = Number((await c.query(LIABILITIES_SQL, [store.scope])).rows[0].n);
    let custody = null;
    try {
      await checkNetwork();
      const { PublicKey } = require('@solana/web3.js'), spl = require('@solana/spl-token');
      const ata = spl.getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(treasuryAddress));
      custody = Number((await connection.getTokenAccountBalance(ata, 'finalized')).value.amount) / Number(UNIT);
    } catch { custody = null; }
    const budget = await rewardBudget(store, c), used = Number((await c.query('SELECT COALESCE(SUM(amount),0) AS n FROM ryo_reward_claims WHERE scope=$1 AND created>$2', [store.scope, store.now() - DAY])).rows[0].n);
    const paused = !!(await c.query('SELECT pauses FROM ryo_admin_control WHERE scope=$1', [store.scope])).rows[0]?.pauses?.claims;
    const gate = require('./launch-gates.cjs').isOn('rewardClaims'), custodyFree = custody === null ? null : Math.max(0, Math.floor(custody - liabilities));
    const value = { applicable: true, status: custody === null ? 'unverified' : 'verified', observedAt: store.now(), commitment: 'finalized',
      availableRyo: custodyFree === null ? null : Math.min(ledger, custodyFree), ledgerFundedRyo: ledger, custodyFreeRyo: custodyFree,
      claimsOpen: gate && !paused && !!budget, budget: { configured: !!budget, remainingLast24hRyo: budget ? Math.max(0, budget.dailyCapRyo - used) : 0 },
      note: custody === null ? 'Game claim custody could not be read at finalized commitment; nothing is shown as available.' : 'Only approved top-ups not yet claimed, and backed by game claim custody beyond player balances, can pay Chest claims.' };
    return value;
  })();
  fundingCache.set(store.scope, { ...(hit || {}), inflight });
  try { const value = await inflight; fundingCache.set(store.scope, { at: Date.now(), value }); return value; }
  catch (error) { fundingCache.delete(store.scope); throw error; }
}
/** Pre-launch (or game not installed): nothing is configured, so nothing is claimable — no placeholder number. */
const claimFundingNotConfigured = reason => ({ applicable: true, status: 'not-configured', availableRyo: null, claimsOpen: false,
  note: reason || 'Pre-launch: the game claim wallet is not configured and Chest claims are closed. No SR is available for player reward claims yet.' });

async function summary(store, c = store.pool) {
  if (!live()) return { applicable: false };
  const fees = (await c.query('SELECT COUNT(*) AS n,COALESCE(SUM(fee_raw),0) AS fee,COALESCE(SUM(gross_raw),0) AS gross FROM ryo_withdrawal_treasury_fees WHERE scope=$1', [store.scope])).rows[0];
  const recent = (await c.query('SELECT wallet,request_id,signature,gross_raw,fee_raw,net_raw,destination,created FROM ryo_withdrawal_treasury_fees WHERE scope=$1 ORDER BY created DESC LIMIT 50', [store.scope])).rows;
  const now = store.now(), budget = await rewardBudget(store, c);
  const used = Number((await c.query('SELECT COALESCE(SUM(amount),0) AS n FROM ryo_reward_claims WHERE scope=$1 AND created>$2', [store.scope, now - DAY])).rows[0].n);
  return { applicable: true, withdrawalDeduction: { bps: registry().withdrawalTreasuryFeeBps, destination: registry().addresses.lockedTreasury, count: Number(fees.n), feeRaw: String(fees.fee), grossRaw: String(fees.gross), recent: recent.map(r => ({ ...r, gross_raw: String(r.gross_raw), fee_raw: String(r.fee_raw), net_raw: String(r.net_raw), created: Number(r.created) })),
    note: 'Separate ledger. Not Chapter 04 service revenue and never split 50/30/10/10.' },
    rewardBudget: { configured: !!budget, ...(budget || {}), claimedLast24h: used, remainingLast24h: budget ? Math.max(0, budget.dailyCapRyo - used) : 0, claimCooldownHours: 24 } };
}

module.exports = { UNIT, DAY, CLAIM_COOLDOWN_MS, live, claimFunding, claimFundingNotConfigured, withdrawalPlan, withdrawalsAnytime, withdrawalColumns, withdrawalSettled, validateBudget, rewardBudget, claimLimit, nextClaimAt, publicConfig, assertCustody, summary };
