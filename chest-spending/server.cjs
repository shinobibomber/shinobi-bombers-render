/* Direct Chest Reward Spending (owner request 2026-11-11). apply-chest-spending.cjs copies this file to
 * app/server/chest-spending.cjs and hooks Store.purchase / Store.settlePurchase and the service quote / purchase routes.
 *
 * A player may pay an eligible game service (Summon, Fusion, Dojo upgrade, Training) with verified, UNCLAIMED Adventure Chest SR
 * before the 24 h claim timer allows a claim. A chest spend is exactly equivalent to "claim that amount, then pay it from the game
 * balance" done atomically, minus the claim timer:
 *   - ryo_adventures.data.pending -= total x 1000 (milli), data.claimed += total (the funded reward pool shrinks exactly as for a
 *     claim: pool = income - SUM(claimed)); no new SR and no second balance;
 *   - NO ryo_reward_claims row, so the per-player claim timer is untouched (a purchase is never a claim);
 *   - the purchase then follows the normal path unchanged: the same server quote (Mythic / Founder / creator discounts), the
 *     custody-signed transaction paying the 50/30/10/10 destinations on-chain, the ryo_purchases row, settlement on finalization
 *     (the hero / upgrade is written only then), ryo_service_revenue booking. No 5% withdrawal deduction (that applies only to
 *     withdrawals of claimed SR).
 * Limits (all checked inside the purchase transaction, after the wallet lock and the global reward-pool lock, in the same order
 * as claims, so claims, spends and withdrawals of a wallet serialize):
 *   verified chest (freshly settled), funded reward pool, custody tokens minus liabilities, and on live the approved daily reward
 *   budget shared with claims (owner decision; never the per-player timer). One funding source per purchase.
 * Creator Points (owner decision): the creator earns the Adventure commission on the eligible chest SR spent (the creator
 * adventure lots are drained FIFO exactly as a claim would), paid once at confirmed settlement; a chest-funded order earns no
 * purchase commission (creators-portal settledPurchase).
 * Refund (failed / expired settlement): the chest, lifetime-claimed total and the drained lots are restored exactly; nothing was
 * granted. Every spend is recorded in ryo_chest_spends (append-only status changes) for the budget, refunds and audit.
 * Gates: feature switch chestSpending (Control panel; live default OFF), the rewardClaims launch gate, and the operator pauses
 * "claims" (here) and "purchases" (the purchase route guard). */
'use strict';
const fail = (message, status) => require('./store.cjs').fail(message, status);
const PRODUCTS = Object.freeze(['summon', 'fusion', 'dojo', 'training']);
const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_chest_spends(scope TEXT NOT NULL,wallet TEXT NOT NULL,request_id TEXT NOT NULL,product TEXT NOT NULL,
 amount BIGINT NOT NULL CHECK(amount>0),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','refunded')),
 eligible_milli BIGINT NOT NULL DEFAULT 0 CHECK(eligible_milli>=0),lots JSONB NOT NULL DEFAULT '[]',created BIGINT NOT NULL,settled BIGINT,
 PRIMARY KEY(scope,wallet,request_id));
CREATE INDEX IF NOT EXISTS ryo_chest_spends_budget ON ryo_chest_spends(scope,created) WHERE status IN ('pending','confirmed');`;

const rows = async (c, sql, args) => (await c.query(sql, args)).rows;
function switchOn(env = process.env) { try { return require('./feature-switches.cjs').effective('chestSpending', env) === true; } catch { return false; } }
function claimsGateOn(env = process.env) { try { return require('./launch-gates.cjs').isOn('rewardClaims', env) === true; } catch { return false; } }
async function claimsPaused(store, c) { return !!(await rows(c, 'SELECT pauses FROM ryo_admin_control WHERE scope=$1', [store.scope]))[0]?.pauses?.claims; }

/** Everything that limits a chest spend right now (whole SR), from a custody reading taken BEFORE any lock (no RPC in here).
 *  budget: Infinity on beta; budgetError when there is no approved budget or it is used up (live). */
async function figures(store, c, wallet, custodyRyo) {
  const d = (await rows(c, 'SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, wallet]))[0]?.data || {};
  const chestRyo = Math.floor(Math.max(0, Number(d.pending) || 0) / 1000);
  const income = await require('./sr-revenue.cjs').income(store, c);
  const used = (await rows(c, "SELECT COALESCE(SUM((data->>'claimed')::numeric),0) AS n FROM ryo_adventures WHERE scope=$1", [store.scope]))[0];
  const pool = Math.max(0, Math.floor(Number(income.n) - Number(used.n)));
  // The same liabilities as a claim (adventure.cjs): balances + pending withdrawals + pending purchases.
  const liabilities = Number((await rows(c, "SELECT (SELECT COALESCE(SUM(balance),0) FROM ryo_accounts WHERE scope=$1)+(SELECT COALESCE(SUM(amount),0) FROM ryo_withdrawals WHERE scope=$1 AND status='pending')+(SELECT COALESCE(SUM(amount),0) FROM ryo_purchases WHERE scope=$1 AND status='pending') AS n", [store.scope]))[0].n);
  const custodyFree = Math.max(0, Math.floor(Number(custodyRyo) - liabilities));
  let budget = null, budgetError = null;
  try { budget = await require('./treasury-rewards.cjs').chestLimit(store, c); } catch (e) { budgetError = e; budget = 0; }
  return { chestRyo, pool, custodyFree, budget, budgetError, spendable: Math.max(0, Math.min(chestRyo, pool, custodyFree, budget)) };
}
function assertCovers(f, total) {
  if (f.chestRyo < total) fail('Not enough verified Chest rewards: ' + f.chestRyo.toLocaleString('en-US') + ' SR available, ' + total.toLocaleString('en-US') + ' SR needed.', 409);
  if (f.budgetError) throw f.budgetError;
  if (f.budget < total) fail("Today's approved Chest reward budget can't cover this purchase. Pay from your game balance or try again later; your rewards stay in your Chest.", 409);
  if (f.pool < total) fail('The funded reward pool cannot cover this purchase right now. Pay from your game balance; your rewards stay in your Chest.', 409);
  if (f.custodyFree < total) fail('Custody tokens are temporarily unavailable. No SR was used.', 503);
}

/** Step 1, called by Store.purchase right after the server quote (wallet already locked; NO pool lock): validates the request,
 *  reads custody once (the only RPC), settles the chest and pre-checks every limit. Returns a ticket when the chest will pay,
 *  false for the normal balance / starter-bonus funding. Nothing is debited here. */
async function prepareSpend(store, c, wallet, requestId, product, q, profile, options = {}) {
  if (!options || options.funding !== 'chest') return false;
  if (!PRODUCTS.includes(product)) fail('Chest rewards pay for Summon, Fusion, Dojo upgrades and Training only.', 409);
  if (!switchOn() || !claimsGateOn()) fail('Paying with Chest rewards is not open. Pay from your game balance instead; your rewards stay in your Chest.', 403);
  if (await claimsPaused(store, c)) fail('Paying with Chest rewards is temporarily paused. Your rewards stay in your Chest.', 503);
  if (typeof options.custody !== 'function') fail('Custody check unavailable. No SR was used.', 503);
  const total = q.total;
  if (!Number.isSafeInteger(total) || total < 1) fail('Invalid purchase price.', 409);
  const custodyRyo = Number(await options.custody());
  if (!Number.isFinite(custodyRyo)) fail('Custody check unavailable. No SR was used.', 503);
  // Bring the chest up to date (the same verified settlement every purchase already runs), then pre-check without the pool lock.
  await require('./adventure.cjs').settleLocked(store, c, wallet, profile, false);
  assertCovers(await figures(store, c, wallet, custodyRyo), total);
  return { custodyRyo, total };
}

/** Step 2, called by Store.purchase after prepare() built the signed settlement and just before the row is written: takes the
 *  global reward-pool lock (only database work while it is held), re-checks every limit, debits the chest and drains the creator
 *  lots. Lock order: wallet -> admin control (shared, by SR revenue config) -> pool, the same as replenishment approvals. If this
 *  fails the whole purchase rolls back and the signed settlement is never sent. */
async function commitSpend(store, c, wallet, requestId, product, q, ticket) {
  const total = q.total;
  if (!ticket || ticket.total !== total) fail('Purchase changed. No SR was used.', 409);
  await c.query('INSERT INTO ryo_reward_pools(scope) VALUES($1) ON CONFLICT DO NOTHING', [store.scope]);
  await c.query('SELECT scope FROM ryo_reward_pools WHERE scope=$1 FOR UPDATE', [store.scope]);
  assertCovers(await figures(store, c, wallet, ticket.custodyRyo), total);
  const row = (await rows(c, 'SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2 FOR UPDATE', [store.scope, wallet]))[0];
  const d = row.data;
  d.pending = Number(d.pending) - total * 1000;
  d.claimed = (Number(d.claimed) || 0) + total;
  if (!(d.pending >= 0)) fail('Chest balance changed. No SR was used.', 409);
  await c.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(d)]);
  // Creator adventure lots: drained FIFO exactly as a claim of this amount would (creators-portal endAdventure).
  let left = BigInt(total) * 1000n, eligible = 0n; const taken = [];
  for (const lot of await rows(c, 'SELECT id,remaining,eligible FROM ryo_creator_adventure_lots WHERE scope=$1 AND wallet=$2 AND remaining>0 ORDER BY id FOR UPDATE', [store.scope, wallet])) {
    if (!left) break;
    const take = BigInt(lot.remaining) < left ? BigInt(lot.remaining) : left;
    left -= take; if (lot.eligible) eligible += take;
    await c.query('UPDATE ryo_creator_adventure_lots SET remaining=remaining-$2 WHERE id=$1', [lot.id, String(take)]);
    taken.push({ id: String(lot.id), take: String(take) });
  }
  await c.query('INSERT INTO ryo_chest_spends(scope,wallet,request_id,product,amount,eligible_milli,lots,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [store.scope, wallet, requestId, product, total, String(eligible), JSON.stringify(taken), store.now()]);
}

/** Store.settlePurchase, refunded chest-funded order: restore the chest, lifetime claimed and the drained lots exactly. */
async function refund(store, c, row) {
  const spend = (await rows(c, 'SELECT * FROM ryo_chest_spends WHERE scope=$1 AND wallet=$2 AND request_id=$3 FOR UPDATE', [store.scope, row.wallet, row.request_id]))[0];
  if (spend && spend.status !== 'pending') return;
  const amount = Number(row.amount), a = (await rows(c, 'SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2 FOR UPDATE', [store.scope, row.wallet]))[0];
  if (a) { const d = a.data; d.pending = (Number(d.pending) || 0) + amount * 1000; d.claimed = Math.max(0, (Number(d.claimed) || 0) - amount);
    await c.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, row.wallet, JSON.stringify(d)]); }
  for (const lot of spend?.lots || []) await c.query('UPDATE ryo_creator_adventure_lots SET remaining=remaining+$2 WHERE id=$1 AND scope=$3 AND wallet=$4', [lot.id, lot.take, store.scope, row.wallet]);
  if (spend) await c.query("UPDATE ryo_chest_spends SET status='refunded',settled=$4 WHERE scope=$1 AND wallet=$2 AND request_id=$3", [store.scope, row.wallet, row.request_id, store.now()]);
}

/** Store.settlePurchase, after the purchase row is settled: confirm the spend and pay the creator's Adventure commission once. */
async function settled(store, c, row, status) {
  if (row.quote?.funding !== 'chest' || status !== 'confirmed') return;
  const spend = (await rows(c, "UPDATE ryo_chest_spends SET status='confirmed',settled=$4 WHERE scope=$1 AND wallet=$2 AND request_id=$3 AND status='pending' RETURNING *", [store.scope, row.wallet, row.request_id, store.now()]))[0];
  if (spend && BigInt(spend.eligible_milli) > 0n) await require('./creators-portal.cjs').chestCommission(store, c, row.wallet, 'chest:' + row.wallet + ':' + row.request_id, BigInt(spend.eligible_milli));
}

/** Read-only offer for the checkout (the server re-checks everything when the player pays). An empty chest needs no custody
 *  reading; otherwise the custody reading is cached for 15 s, so quotes cannot drive RPC load. */
let custodyCache = { at: 0, value: 0 };
async function offer(store, wallet, preview, custody) {
  if (!preview || !PRODUCTS.includes(preview.product) || !switchOn() || !claimsGateOn()) return { enabled: false };
  try {
    if (await claimsPaused(store, store.pool)) return { enabled: false };
    const pending = Number((await rows(store.pool, 'SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, wallet]))[0]?.data?.pending) || 0;
    if (pending < 1000) return { enabled: true, chestRyo: 0, spendableRyo: 0, nextClaimAt: null, limitedBy: 'chest' };
    if (Date.now() - custodyCache.at > 15000) custodyCache = { at: Date.now(), value: Number(await custody()) };
    const f = await figures(store, store.pool, wallet, custodyCache.value);
    const info = await require('./treasury-rewards.cjs').claimInfo(store, store.pool, wallet);
    return { enabled: true, chestRyo: f.chestRyo, spendableRyo: f.spendable, nextClaimAt: info?.nextClaimAt ?? null,
      limitedBy: f.chestRyo < preview.total ? 'chest' : f.budget < preview.total ? 'budget' : f.pool < preview.total ? 'pool' : f.custodyFree < preview.total ? 'custody' : null };
  } catch { return { enabled: false }; }
}

/* The purchase route registers the player's funding choice for one request id immediately before it calls Store.purchase, which
 * takes (and removes) it as its default options argument in the same synchronous step, so nothing can interleave. */
const intents = new Map();
const intentKey = (store, wallet, requestId) => store.scope + '|' + wallet + '|' + requestId;
function intend(store, wallet, requestId, options) { intents.set(intentKey(store, wallet, requestId), options); }
function takeIntent(store, wallet, requestId) { const k = intentKey(store, wallet, requestId), o = intents.get(k); intents.delete(k); return o || {}; }

module.exports = { SCHEMA, PRODUCTS, switchOn, figures, prepareSpend, commitSpend, refund, settled, offer, intend, takeIntent };
