'use strict';
/* Chest Overflow (apply-chest-overflow.cjs copies this file to app/server/chest-overflow.cjs). Owner request 2026-11-11.
 *
 * Players who let verified, unclaimed Chest Ryo pile up earn less from NEW enemy defeats until they claim or spend it:
 * Chest < 500,000 Ryo 0%, < 750,000 -10%, < 1,000,000 -20%, from 1,000,000 -30% (combat-adventure.cjs overflowBps applies it
 * per defeat, at the Chest balance of that defeat). Already-earned Chest Ryo is never reduced.
 *
 * WHEN (this file): only once claiming is actually possible for this player, plus a 12-hour grace period:
 *   - never while the claim timer runs (24 h, Founders 12 h; treasury-rewards nextClaimAt),
 *   - never while claiming is unavailable through no fault of the player: reward claims switched off, claims paused by the
 *     operator, (live) no approved reward budget or none left today, or an unfunded reward pool,
 *   - `since` = the first time the server sees the claim available (server timestamps only, stored with the Chest data, never
 *     earlier than the release, LAUNCH_AT); the penalty starts at since + 12 h. On live a claim restarts the timer (since
 *     resets while the next claim is not ready; beta has no claim timer). A Chest purchase or its refund changes the balance
 *     (and so the tier) but never the timing.
 *   - Server-wide outages (claims closed / paused / no budget / budget used up / unfunded pool) are recorded once a minute in
 *     ryo_chest_overflow_outages when ANY request sees them; a player's `since` is never earlier than the latest outage, so a
 *     player who was offline during an outage gets a fresh 12 h grace afterwards too.
 * Runs inside the caller's locked Adventure transaction, in its own SAVEPOINT: if it fails, that tick has no penalty and the
 * defeats are still credited. CHEST_OVERFLOW_ENABLED=off disables it (rollback switch) and clears the stored timing.
 */
const GRACE_MS = 12 * 3600000;
const LAUNCH_AT = Date.UTC(2026, 10, 10, 16, 0, 0);   // release (owner 2026-11-11): nobody is penalised before 2026-11-11 04:00 UTC (+12 h grace)
const APPROACHING_MILLI = 450000000;

const enabled = (env = process.env) => !/^(0|off|false|no)$/i.test(String(env.CHEST_OVERFLOW_ENABLED ?? '').trim());
const rules = () => require('./combat-adventure.cjs');

/** Whether this wallet could claim right now apart from its own timer, and when its timer allows the next claim. */
async function claimWindow(store, c, wallet, pool) {
  const T = require('./treasury-rewards.cjs'), now = store.now();
  if (!require('./launch-gates.cjs').isOn('rewardClaims')) return { claimable: false, reason: 'closed' };
  if (!(Number(pool) >= 1)) return { claimable: false, reason: 'pool' };
  const pauses = (await c.query('SELECT pauses FROM ryo_admin_control WHERE scope=$1', [store.scope])).rows[0]?.pauses;
  if (pauses?.claims) return { claimable: false, reason: 'paused' };
  if (!T.live()) return { claimable: true, readyAt: 0 };
  const budget = await T.rewardBudget(store, c);
  if (!budget || budget.dailyCapRyo - await T.budgetUsed(store, c, now) < 1) return { claimable: false, reason: 'budget' };
  return { claimable: true, readyAt: await T.nextClaimAt(store, c, wallet) };
}

/**
 * Called before advance() with the stored Chest data (mutated: data.overflow = {since}). Returns the overflow argument for
 * advance(): { activeFrom } (Infinity = no penalty), plus readyAt/reason for the status.
 */
const SCHEMA = 'CREATE TABLE IF NOT EXISTS ryo_chest_overflow_outages (scope TEXT PRIMARY KEY,last_unavailable BIGINT NOT NULL);';
const OUTAGE_STEP_MS = 60000;
async function windowLocked(store, c, wallet, data, pool) {
  const now = store.now(), w = await claimWindow(store, c, wallet, pool);
  const old = data.overflow && typeof data.overflow === 'object' ? data.overflow : {};
  if (!w.claimable) {
    // Record a server-wide outage (at most one write a minute; rows that don't match are not locked).
    await c.query('INSERT INTO ryo_chest_overflow_outages(scope,last_unavailable) VALUES($1,$2) ON CONFLICT(scope) DO UPDATE SET last_unavailable=$2 WHERE ryo_chest_overflow_outages.last_unavailable<$3', [store.scope, now, now - OUTAGE_STEP_MS]);
    data.overflow = { since: null }; return { activeFrom: Infinity, readyAt: null, reason: w.reason };
  }
  if (w.readyAt > now) { data.overflow = { since: null }; return { activeFrom: Infinity, readyAt: w.readyAt, reason: 'timer' }; }
  const outage = Number((await c.query('SELECT last_unavailable FROM ryo_chest_overflow_outages WHERE scope=$1', [store.scope])).rows[0]?.last_unavailable) || 0;
  // First time the claim is seen available: no earlier than the claim time, the last time the server saw this Chest, the
  // release, or the latest server-wide outage.
  const first = Number.isFinite(old.since) ? old.since : Math.max(Number(w.readyAt) || 0, Math.min(now, Number(data.last) || now));
  const since = Math.max(first, LAUNCH_AT, Math.min(now, outage));
  data.overflow = { since };
  return { activeFrom: since + GRACE_MS, readyAt: w.readyAt, reason: null };
}
async function window(store, c, wallet, data, pool) {
  if (!data || typeof data !== 'object') return null;
  if (!enabled()) { if (data.overflow) data.overflow = { since: null }; return null; }
  let w;
  await c.query('SAVEPOINT chest_overflow');
  try { w = await windowLocked(store, c, wallet, data, pool); await c.query('RELEASE SAVEPOINT chest_overflow'); }
  catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT chest_overflow'); await c.query('RELEASE SAVEPOINT chest_overflow');
    console.error('Chest overflow window unavailable; no penalty this tick:', e.message);
    w = { activeFrom: Infinity, readyAt: null, reason: 'error' };
  }
  data.overflowWindow = { activeFrom: w.activeFrom };   // read and removed by advance() (combat-adventure.cjs)
  return w;
}

/** Status for the Chest response (client alerts and the reward estimate). `win` = window() result, or null after a claim. */
function status(d, win, now) {
  if (!enabled()) return null;
  const pending = Number(d?.pending) || 0, bps = rules().overflowBps(pending), tierPercent = (10000 - bps) / 100;
  const activeFrom = win && Number.isFinite(win.activeFrom) ? win.activeFrom : null;
  const active = tierPercent > 0 && activeFrom !== null && now >= activeFrom;
  const state = tierPercent === 0 ? (pending >= APPROACHING_MILLI ? 'approaching' : 'ok') : active ? 'active' : activeFrom !== null ? 'grace' : 'waiting';
  return {
    chestRyo: Math.floor(pending / 1000), tierPercent, state, ratePercent: active ? bps / 100 : 100, activeFrom,
    claimReadyAt: win && Number.isFinite(win.readyAt) ? win.readyAt : null, unavailable: win?.reason && win.reason !== 'timer' && win.reason !== 'claimed' ? win.reason : null,
    thresholds: [500000, 750000, 1000000], graceHours: GRACE_MS / 3600000,
  };
}

/** Window reported right after a successful claim in the same request: the claim timer has just restarted. */
const CLAIMED = Object.freeze({ activeFrom: Infinity, readyAt: null, reason: 'claimed' });
module.exports = { GRACE_MS, LAUNCH_AT, APPROACHING_MILLI, SCHEMA, CLAIMED, enabled, claimWindow, window, status };
