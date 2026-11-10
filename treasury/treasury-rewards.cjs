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
  // Optional (owner request 2026-11-11, Dojo Chest Claim Limit Bonus): a base personal allowance, at most the per-claim maximum.
  // Unset = no personal allowance: every claim is capped exactly as before (per-claim maximum and the daily budget).
  const base = p.basePersonalAllowanceRyo === undefined || p.basePersonalAllowanceRyo === null ? null : whole(p.basePersonalAllowanceRyo, 1, perClaimMaxRyo, 'Base personal claim allowance');
  if (typeof p.evidence !== 'string' || !p.evidence.trim() || p.evidence.length > 500) fail('Enter the approved reward-budget evidence reference.');
  return { dailyCapRyo, perClaimMaxRyo, ...(base === null ? {} : { basePersonalAllowanceRyo: base }), evidence: p.evidence.trim() };
}
/* Dojo Chest Claim Limit Bonus: every Dojo tier adds 100,000 Ryo to the personal claim allowance (Legendary, tier 6: +600,000),
 * derived from the saved profile in the claim transaction (never stored, never from the browser). Only when the approved
 * budget sets basePersonalAllowanceRyo; the per-claim maximum, the daily budget, pool funding and custody always still apply. */
const DOJO_CLAIM_BONUS_RYO = 100000, DOJO_MAX_TIER = 6;
async function dojoTier(store, c, wallet) {
  const t = Number((await c.query("SELECT data->'dojo' AS dojo FROM ryo_profiles WHERE scope=$1 AND wallet=$2", [store.scope, wallet])).rows[0]?.dojo);
  return Number.isInteger(t) && t > 0 ? Math.min(DOJO_MAX_TIER, t) : 0;
}
const personalAllowance = (budget, tier) => budget && Number.isSafeInteger(budget.basePersonalAllowanceRyo) ? budget.basePersonalAllowanceRyo + tier * DOJO_CLAIM_BONUS_RYO : null;
async function rewardBudget(store, c = store.pool) {
  const row = (await c.query('SELECT config FROM ryo_admin_control WHERE scope=$1', [store.scope])).rows[0];
  try { return row?.config?.rewardBudget ? validateBudget(row.config.rewardBudget) : null; } catch { return null; }
}
async function lastClaim(store, c, wallet) {
  const t = (await c.query('SELECT MAX(created) AS t FROM ryo_reward_claims WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0]?.t;
  return t == null ? null : Number(t);
}
/**
 * Chest claim interval for one wallet: 24 h for every player, 12 h for a verified Founder (Mythic or Legacy) while
 * Founder redemption is enabled (founders.cjs, buyer-bound entitlement). Read inside the same transaction as the
 * claim. Only the interval changes: the reward pool, per-claim maximum and global daily budget stay the same.
 * A lookup failure refuses the claim (fail closed) instead of falling back to a shorter interval.
 */
async function claimCooldownFor(store, c, wallet) {
  let founders; try { founders = require('./founders.cjs'); } catch (e) { if (e.code === 'MODULE_NOT_FOUND') return CLAIM_COOLDOWN_MS; throw e; }
  const ms = await founders.chestCooldownMs(store, c, wallet);
  return ms === founders.FOUNDER_CHEST_COOLDOWN_MS ? ms : CLAIM_COOLDOWN_MS;
}
/**
 * Called inside the claim transaction after the global reward-pool row lock, so budget use is serialized.
 * Returns the maximum whole Ryo this claim may credit (Infinity on beta). Throws to refuse the claim.
 */
async function claimLimit(store, c, wallet) {
  if (!live()) return Infinity;
  const now = store.now(), last = await lastClaim(store, c, wallet), cooldown = await claimCooldownFor(store, c, wallet);
  if (last !== null && now < last + cooldown) fail('Chest rewards can be claimed once every ' + cooldown / 3600000 + ' hours. Next claim: ' + new Date(last + cooldown).toISOString() + '. Your earnings stay in your Chest.', 429);
  const budget = await rewardBudget(store, c);
  if (!budget) fail('Chest claims await an approved reward budget. Your earnings stay in your Chest.', 503);
  const remaining = budget.dailyCapRyo - await budgetUsed(store, c, now);
  if (remaining < 1) fail("Today's approved Chest reward budget has been fully claimed. Your earnings stay in your Chest; try again later.", 409);
  const personal = personalAllowance(budget, await dojoTier(store, c, wallet));
  return Math.min(budget.perClaimMaxRyo, remaining, personal ?? Infinity);
}
/** Global rolling-24 h use of the approved reward budget: chest claims plus SR spent directly from chests on game services
 * (owner decision 2026-11-11: chest spending shares the daily budget, never the per-player claim timer). */
async function budgetUsed(store, c, now) {
  let used = Number((await c.query('SELECT COALESCE(SUM(amount),0) AS n FROM ryo_reward_claims WHERE scope=$1 AND created>$2', [store.scope, now - DAY])).rows[0].n);
  if ((await c.query("SELECT to_regclass('ryo_chest_spends') IS NOT NULL AS t")).rows[0].t)
    used += Number((await c.query("SELECT COALESCE(SUM(amount),0) AS n FROM ryo_chest_spends WHERE scope=$1 AND status IN ('pending','confirmed') AND created>$2", [store.scope, now - DAY])).rows[0].n);
  return used;
}
/** Maximum whole SR one chest-funded purchase may use (Infinity on beta): the approved daily budget and per-claim maximum,
 * without the per-player claim timer. Throws when no budget is approved or today's budget is used up. */
async function chestLimit(store, c) {
  if (!live()) return Infinity;
  const budget = await rewardBudget(store, c);
  if (!budget) fail('Chest rewards await an approved reward budget. Your earnings stay in your Chest.', 503);
  const remaining = budget.dailyCapRyo - await budgetUsed(store, c, store.now());
  if (remaining < 1) fail("Today's approved Chest reward budget is used up. Your earnings stay in your Chest; try again later.", 409);
  return Math.min(budget.perClaimMaxRyo, remaining);
}
/** Live only: when this wallet may claim next (0 = now). null on beta (field omitted). */
async function nextClaimAt(store, c, wallet) {
  if (!live()) return null;
  const last = await lastClaim(store, c, wallet);
  return last === null ? 0 : last + await claimCooldownFor(store, c, wallet);
}
/** Live only: this wallet's next claim time and interval for the Chest UI (beta: null, fields omitted). */
async function claimInfo(store, c, wallet) {
  if (!live()) return null;
  const last = await lastClaim(store, c, wallet), cooldown = await claimCooldownFor(store, c, wallet);
  // Display details only: never let them turn a committed claim (or a Chest refresh) into an error.
  const allowance = await claimAllowance(store, c, wallet).catch(() => ({ active: false }));
  return { nextClaimAt: last === null ? 0 : last + cooldown, claimCooldownMs: cooldown, founderCooldown: cooldown < CLAIM_COOLDOWN_MS, claimAllowance: allowance };
}
/** Chest claim details for the UI (live, server values). `active` only when the approved budget sets a base allowance; without
 * one (the normal state) a single budget read answers, so the Chest poll stays cheap. */
async function claimAllowance(store, c, wallet) {
  const budget = await rewardBudget(store, c);
  if (!budget || !Number.isSafeInteger(budget.basePersonalAllowanceRyo)) return { active: false };
  const tier = await dojoTier(store, c, wallet), bonus = tier * DOJO_CLAIM_BONUS_RYO;
  const remaining = Math.max(0, budget.dailyCapRyo - await budgetUsed(store, c, store.now())), personal = personalAllowance(budget, tier);
  const effective = Math.min(budget.perClaimMaxRyo, remaining, personal ?? Infinity);
  // What sets today's maximum: the remaining daily budget (below the other caps), the hard per-claim ceiling (below the
  // personal allowance), or the personal allowance itself.
  const ownCap = Math.min(budget.perClaimMaxRyo, personal ?? Infinity);
  const limitedBy = remaining < ownCap ? 'budget' : personal !== null && personal > budget.perClaimMaxRyo ? 'ceiling' : personal !== null ? 'personal' : 'ceiling';
  return { active: personal !== null, dojoTier: tier, dojoBonusRyo: bonus, bonusPerTierRyo: DOJO_CLAIM_BONUS_RYO, baseAllowanceRyo: budget.basePersonalAllowanceRyo ?? null,
    personalAllowanceRyo: personal, hardCeilingRyo: budget.perClaimMaxRyo, dailyRemainingRyo: remaining, effectiveRyo: effective, limitedBy };
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
  // The launch key must belong to the public game wallet recorded in the reviewed registry (no silent key swap).
  const expected = registry().gameCustody?.address;
  if (expected && custody !== expected) fail('RYO_TREASURY_SECRET does not belong to the game custody wallet recorded in the reviewed treasury registry (' + expected + '). Refusing to start.', 503);
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
      const ata = spl.getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(treasuryAddress), false, require('./live-economy.cjs').programId());
      custody = Number((await connection.getTokenAccountBalance(ata, 'finalized')).value.amount) / Number(UNIT);
    } catch { custody = null; }
    const budget = await rewardBudget(store, c), used = await budgetUsed(store, c, store.now());   // claims + chest spends
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
  note: reason || (registry().gameCustody ? 'Pre-launch: the game claim wallet is created but not active, and Chest claims are closed. No SR is available for player reward claims yet.' : 'Pre-launch: the game claim wallet is not configured and Chest claims are closed. No SR is available for player reward claims yet.') });

async function summary(store, c = store.pool) {
  if (!live()) return { applicable: false };
  const fees = (await c.query('SELECT COUNT(*) AS n,COALESCE(SUM(fee_raw),0) AS fee,COALESCE(SUM(gross_raw),0) AS gross FROM ryo_withdrawal_treasury_fees WHERE scope=$1', [store.scope])).rows[0];
  const recent = (await c.query('SELECT wallet,request_id,signature,gross_raw,fee_raw,net_raw,destination,created FROM ryo_withdrawal_treasury_fees WHERE scope=$1 ORDER BY created DESC LIMIT 50', [store.scope])).rows;
  const now = store.now(), budget = await rewardBudget(store, c);
  const used = await budgetUsed(store, c, now);   // claims + chest spends (shared daily budget)
  return { applicable: true, withdrawalDeduction: { bps: registry().withdrawalTreasuryFeeBps, destination: registry().addresses.lockedTreasury, count: Number(fees.n), feeRaw: String(fees.fee), grossRaw: String(fees.gross), recent: recent.map(r => ({ ...r, gross_raw: String(r.gross_raw), fee_raw: String(r.fee_raw), net_raw: String(r.net_raw), created: Number(r.created) })),
    note: 'Separate ledger. Not Chapter 04 service revenue and never split 50/30/10/10.' },
    rewardBudget: { configured: !!budget, ...(budget || {}), claimedLast24h: used, remainingLast24h: budget ? Math.max(0, budget.dailyCapRyo - used) : 0, claimCooldownHours: 24 } };
}

module.exports = { UNIT, DAY, CLAIM_COOLDOWN_MS, DOJO_CLAIM_BONUS_RYO, dojoTier, personalAllowance, claimAllowance, live, claimFunding, claimFundingNotConfigured, withdrawalPlan, withdrawalsAnytime, withdrawalColumns, withdrawalSettled, validateBudget, rewardBudget, claimLimit, chestLimit, budgetUsed, claimCooldownFor, nextClaimAt, claimInfo, publicConfig, assertCustody, summary };
