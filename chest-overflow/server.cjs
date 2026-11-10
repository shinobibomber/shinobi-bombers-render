'use strict';
/* Chest Overflow (apply-chest-overflow.cjs copies this file to app/server/chest-overflow.cjs). Owner request 2026-11-11.
 *
 * Players who let verified, unclaimed Chest Ryo pile up earn less from NEW enemy defeats until they claim or spend it:
 * Chest < 500,000 Ryo 0%, < 750,000 -10%, < 1,000,000 -20%, from 1,000,000 -30% (combat-adventure.cjs overflowBps applies it
 * per defeat, at the Chest balance of that defeat). Already-earned Chest Ryo is never reduced; every verified defeat is still
 * credited to the Chest in real time, only its amount changes.
 *
 * WHEN (owner decision 2026-11-11, "Always, no exceptions" + "No grace"): whenever the Chest holds 500,000+ Ryo — while the
 * claim timer runs, right after a claim, and while claims are closed, paused, out of today's budget or the pool is empty. No
 * grace period. Claiming or spending Chest rewards lowers the balance, and with it the tier, from the very next defeat.
 * CHEST_OVERFLOW_ENABLED=off disables it (rollback switch, no code change).
 *
 * The earlier timing rules (claim timer, 12 h grace, outage tracking) are retired; ryo_chest_overflow_outages stays in the
 * schema unused (additive, no migration) and any stored data.overflow timing is cleared.
 */
const LAUNCH_AT = Date.UTC(2026, 10, 10, 16, 0, 0);   // first release; already past, kept so no defeat before it is ever reduced
const APPROACHING_MILLI = 450000000;
const SCHEMA = 'CREATE TABLE IF NOT EXISTS ryo_chest_overflow_outages (scope TEXT PRIMARY KEY,last_unavailable BIGINT NOT NULL);';

const enabled = (env = process.env) => !/^(0|off|false|no)$/i.test(String(env.CHEST_OVERFLOW_ENABLED ?? '').trim());
const rules = () => require('./combat-adventure.cjs');

/**
 * Called before advance() with the stored Chest data, inside the caller's locked transaction. Hands advance() its window on
 * the Chest data (data.overflowWindow, read and removed by advance() before anything is saved). No database reads.
 */
async function window(store, c, wallet, data) {
  if (!data || typeof data !== 'object') return null;
  if (data.overflow !== undefined) delete data.overflow;   // retired timing state
  if (!enabled()) return null;
  data.overflowWindow = { activeFrom: LAUNCH_AT };
  return { activeFrom: LAUNCH_AT };
}

/** Status for the Chest response (client alerts and the reward estimate). The window argument is no longer needed. */
function status(d, _win, now) {
  if (!enabled()) return null;
  const pending = Number(d?.pending) || 0, bps = rules().overflowBps(pending), tierPercent = (10000 - bps) / 100;
  const active = tierPercent > 0 && now >= LAUNCH_AT;
  const state = tierPercent === 0 ? (pending >= APPROACHING_MILLI ? 'approaching' : 'ok') : active ? 'active' : 'ok';
  return { chestRyo: Math.floor(pending / 1000), tierPercent, state, ratePercent: active ? bps / 100 : 100, activeFrom: LAUNCH_AT, thresholds: [500000, 750000, 1000000] };
}

/** Kept for the build hook (status after a claim in the same request); the status no longer depends on it. */
const CLAIMED = Object.freeze({ activeFrom: LAUNCH_AT });
module.exports = { LAUNCH_AT, APPROACHING_MILLI, SCHEMA, CLAIMED, enabled, window, status };
