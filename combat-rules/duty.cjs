/* Expedition Mode: Combat Duty accounting (owner spec 2026-11-11; apply-combat-rules.cjs copies this file to
 * app/server/combat-duty.cjs). Pure and server-authoritative: every value comes from server-accepted attacks and server time.
 *
 * Definition of Combat Duty (spec section 2, "formally define how an attack interval contributes"):
 *   every attack the server accepts in combat-chakra.cjs spend() (online Adventure and offline Sensei), and every Boss Hunt
 *   attack the server debits, adds exactly that hero's attack cooldown (0.6 to 1.6 seconds) of active combat.
 *   - Chakra recovery, the automatic rest until 10% chakra, the bench, Reserve, idle heroes and time on an Expedition
 *     accept no attacks, so they never count. An isolated attack counts one cooldown; an idle gap counts nothing.
 *   - Reports are cumulative per page session and only the newly accepted delta is ever spent (combat-adventure.cjs), so a
 *     replayed report, a refresh or a second device can never count the same attack twice.
 * At DUTY_CAP_MS the hero starts a free Expedition at the server time of the attack that completed its duty. The duration
 * (rarity, verified Founder benefit) is snapshotted then, so a later entitlement change cannot move the timer. At `ends` the
 * Expedition is complete: Combat Duty restarts at 0, chakra is left exactly as it is (no refill).
 * The state lives inside h.chakra (h.chakra.duty), so purchase settlement (which keeps the current chakra) and Market or
 * Mythic transfers carry it with the hero: moving a hero never resets or shortens its duty or Expedition.
 * Nothing here runs a timer: remaining time is always computed on demand from the stored timestamps. */
'use strict';
const HOUR = 3600000, VERSION = 1;
// The Combat Duty limit: 18 hours (owner spec). A server setting (EXPEDITION_DUTY_HOURS, 1 to 168) lets the owner tune it
// after the economy review without a code change; anything else keeps 18. Read once at start (a change needs a restart).
const DUTY_HOURS = (() => { const n = Number(process.env.EXPEDITION_DUTY_HOURS); return Number.isFinite(n) && n >= 1 && n <= 168 ? n : 18; })();
const DUTY_CAP_MS = Math.round(DUTY_HOURS * HOUR);
const HOURS = Object.freeze([2, 3, 4, 5, 6, 8]);            // Genin, Chunin, Jonin, Elite, Legend, Mythic (regular player)
const RANKS = Object.freeze(['Genin', 'Chunin', 'Jonin', 'Elite', 'Legend', 'Mythic']);
const FOUNDER_BPS = 5000;                                     // verified Founders: 50% of the regular duration
const rank = h => Math.max(0, Math.min(5, Math.floor(Number(h?.rank) || 0)));
const durationMs = (h, founder) => HOURS[rank(h)] * HOUR * (founder ? FOUNDER_BPS : 10000) / 10000;
const get = s => (s && s.duty && typeof s.duty === 'object' ? s.duty : null);
function ensure(s) {
  if (!get(s)) s.duty = { v: VERSION, ms: 0 };
  const d = s.duty; d.ms = Math.max(0, Math.min(DUTY_CAP_MS, Number(d.ms) || 0)); return d;
}
/** On an Expedition at server time `at` (no new combat). A finished, not yet released Expedition is not away. */
function away(s, at) { const e = get(s)?.exp; return !!e && at < Number(e.ends); }
/** Release a finished Expedition (deterministic: completion is `ends`, whenever it is observed). Returns true if released. */
function release(s, at) {
  const d = get(s), e = d?.exp; if (!e || !(at >= Number(e.ends))) return false;
  d.last = { start: e.start, ends: e.ends, ms: e.ms, rank: e.rank, founder: e.founder, completed: e.ends };
  d.n = (Number(d.n) || 0) + 1; d.ms = 0; delete d.exp; return true;
}
/** Paid acceleration (expedition/server.cjs, only at confirmed settlement): ends the exact Expedition `start` now. */
function accelerate(s, start, at, ref) {
  const d = get(s), e = d?.exp; if (!e || e.start !== start || !(at < Number(e.ends))) return false;
  d.last = { start: e.start, ends: e.ends, ms: e.ms, rank: e.rank, founder: e.founder, completed: at, accelerated: String(ref || '') };
  d.n = (Number(d.n) || 0) + 1; d.ms = 0; delete d.exp; return true;
}
/** Adds `ms` of accepted combat at server time `at`. `opt` is null while Expedition Mode is off (nothing accrues).
 * Returns true when the hero is (now) on an Expedition and must not attack again (always false while the mode is off). */
function add(h, s, ms, at, opt) {
  if (!opt) return false;   // Expedition Mode off: no accrual and no Expedition block (a running one is suspended)
  if (!(ms > 0)) return away(s, at);
  const d = ensure(s); if (d.exp) return true;
  d.ms = Math.min(DUTY_CAP_MS, d.ms + ms);
  if (d.ms < DUTY_CAP_MS) return false;
  const length = durationMs(h, opt.founder === true);
  d.exp = { start: at, ends: at + length, ms: length, rank: rank(h), founder: opt.founder === true };
  return true;
}
/** Player-facing status of one hero at server time `now` (no writes). */
// status: 'expedition' (away), 'returned' (an Expedition completed and no new duty since), 'duty' (accumulating).
function view(h, now) {
  const d = get(h?.chakra), e = d?.exp;
  if (e && now < e.ends) return { status: 'expedition', dutyMs: DUTY_CAP_MS, capMs: DUTY_CAP_MS, start: e.start, ends: e.ends,
    durationMs: e.ms, remainingMs: e.ends - now, founder: e.founder === true, last: d.last || null };
  // A finished Expedition that no server call has released yet reads exactly as released.
  const last = e ? { start: e.start, ends: e.ends, ms: e.ms, rank: e.rank, founder: e.founder, completed: e.ends } : d?.last || null;
  const dutyMs = e ? 0 : Math.min(DUTY_CAP_MS, Number(d?.ms) || 0);
  return { status: last && dutyMs === 0 ? 'returned' : 'duty', dutyMs, capMs: DUTY_CAP_MS, remainingDutyMs: DUTY_CAP_MS - dutyMs, last };
}
module.exports = { VERSION, HOUR, DUTY_CAP_MS, HOURS, RANKS, FOUNDER_BPS, rank, durationMs, get, ensure, away, release, accelerate, add, view };
