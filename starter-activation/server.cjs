'use strict';
/* Starter Activation System (apply-starter-activation.cjs copies this file to app/server/starter-activation.cjs). Owner
 * request 2026-11-11. Ships dormant: nothing happens until an approver schedules the launch (Creators Portal admin,
 * "Schedule for the next 12:00 PM PHT" or an explicit date), stored once in ryo_admin_control.config.starterActivation and
 * never recomputed on restart; every instance reads the same row. Development/test databases are separate scopes, so they
 * can never schedule production.
 *
 * Accounts: a profile created by the server at or after the scheduled time (profile.createdAt >= scheduledActivationAt, server
 * clock; one comparison) is eligible. Profiles without createdAt existed before this feature and are never affected.
 * Starter pack: 10 Genin, level 1, base stats 1/1/1, no bonus, normal Genin identity/perks/art; account-bound (referralReward:
 * the Market refuses them, Fusion output stays bound) and not salvageable (starterGrant). One grant per account
 * (ryo_starter_activation_grants, created in the same transaction as the profile row). A daily grant cap (anti-abuse) turns extra new
 * accounts into normal accounts (no free heroes, no penalty) recorded as 'capped' for staff review.
 * Reward rate: eligible accounts earn 50% of normal enemy rewards (online and offline Sensei) until 15 paid Shrine summons
 * settle (balance or Chest rewards; free starter Ryo, refunds and every other hero source never count), then 100% for good.
 * With Chest Overflow the larger penalty applies (never stacked). Earned Chest Ryo is never reduced.
 * Switches (Control panel, "Player rewards"): starterPack, starterRewardRate, starterTracking, starterUi (default ON, but
 * nothing happens before a schedule exists).
 */
const RULES = 1, TARGET = 15, STARTER_BPS = 5000, HEROES = 10, PHT_OFFSET_MS = 8 * 3600000, DEFAULT_DAILY_CAP = 1000;
const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_starter_activation_grants (scope TEXT NOT NULL,wallet TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('granted','capped')),
  heroes JSONB NOT NULL DEFAULT '[]'::jsonb,created BIGINT NOT NULL,PRIMARY KEY(scope,wallet));`;

function fail(message, status = 400) { throw Object.assign(Error(message), { status }); }
const on = key => { try { return require('./feature-switches.cjs').effective(key); } catch { return false; } };

/** First 12:00 PM Philippine Time (UTC+8, no DST) strictly after `now` (ms UTC). */
function nextNoonPht(now) {
  const local = now + PHT_OFFSET_MS, d = new Date(local);
  let noon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0) - PHT_OFFSET_MS;
  if (noon <= now) noon += 86400000;
  return noon;
}
async function config(store, c = store.pool) {
  const row = (await c.query('SELECT config FROM ryo_admin_control WHERE scope=$1', [store.scope])).rows[0];
  const s = row?.config?.starterActivation;
  return s && Number.isSafeInteger(s.scheduledActivationAt) ? s : null;
}
const launched = (cfg, now) => !!cfg && now >= cfg.scheduledActivationAt;

/** store.profileLocked hook: stamps createdAt on a brand-new profile and, when eligible, adds the starter pack (same tx). */
async function newProfile(store, c, wallet, data) {
  const now = store.now(); data.createdAt = now;
  const cfg = await config(store, c).catch(() => null);
  if (!launched(cfg, now) || !on('starterPack')) return data;
  const day = now - 86400000, cap = Number.isSafeInteger(cfg.dailyGrantCap) ? cfg.dailyGrantCap : DEFAULT_DAILY_CAP;
  // Serialise starter grants (exact daily cap under simultaneous sign-ups): row lock on this scope's admin control row.
  await c.query('SELECT 1 FROM ryo_admin_control WHERE scope=$1 FOR UPDATE', [store.scope]);
  const recent = Number((await c.query("SELECT COUNT(*) AS n FROM ryo_starter_activation_grants WHERE scope=$1 AND status='granted' AND created>$2", [store.scope, day])).rows[0].n);
  if (recent >= cap) {
    await c.query("INSERT INTO ryo_starter_activation_grants(scope,wallet,status,created) VALUES($1,$2,'capped',$3) ON CONFLICT DO NOTHING", [store.scope, wallet, now]);
    data.starterActivation = { state: 'capped', rulesVersion: RULES, at: now };
    return data;
  }
  const economy = require('./economy.cjs'), heroes = [];
  for (let i = 0; i < HEROES; i++) {
    const h = economy.hero(0);
    h.level = 1; h.baseStats = { pw: 1, sp: 1, st: 1 }; h.bonus = { pw: 0, sp: 0, st: 0 };
    h.referralReward = true; h.starterGrant = true;
    heroes.push(h);
  }
  const inserted = (await c.query("INSERT INTO ryo_starter_activation_grants(scope,wallet,status,heroes,created) VALUES($1,$2,'granted',$3,$4) ON CONFLICT DO NOTHING RETURNING wallet",
    [store.scope, wallet, JSON.stringify(heroes.map(h => h.tokenId || h.id || null)), now])).rows.length;
  if (!inserted) return data;   // never twice
  data.heroes = [...(Array.isArray(data.heroes) ? data.heroes : []), ...heroes];
  data.starterActivation = { state: 'active', paidSummons: 0, grantedAt: now, rulesVersion: RULES };
  return data;
}

/** economy.fulfill hook (paid Shrine summons only — the same purchases Shrine pity counts; written at confirmed settlement). */
function countPaid(profile, quantity, now) {
  const s = profile.starterActivation;
  if (!s || s.state !== 'active' || !on('starterTracking')) return;
  s.paidSummons = Math.min(TARGET, (Number(s.paidSummons) || 0) + Math.max(0, Number(quantity) || 0));
  if (s.paidSummons >= TARGET) { s.state = 'complete'; s.completedAt = now; }
}

/** adventure.cjs hook (before advance): hands advance() the starter rate on the Chest data (read and removed by advance()). */
async function window(store, c, wallet, data, profile) {
  if (!data || typeof data !== 'object') return;
  // The 50% rate needs paid-summon tracking on too, so nobody can be held at 50% while their summons are not counted.
  if (profile?.starterActivation?.state === 'active' && on('starterRewardRate') && on('starterTracking')) data.starterWindow = { bps: STARTER_BPS };
}

/** Player view (UI): server values only. */
function view(profile) {
  const s = profile?.starterActivation;
  if (!s || !on('starterUi') || !['active', 'complete'].includes(s.state)) return null;
  const n = Math.min(TARGET, Number(s.paidSummons) || 0);
  return { state: s.state, paidSummons: n, target: TARGET, remaining: Math.max(0, TARGET - n), ratePercent: s.state === 'active' && on('starterRewardRate') && on('starterTracking') ? STARTER_BPS / 100 : 100, completedAt: s.completedAt ?? null };
}

/* ---------- Admin (approver only; called from creators-portal adminAction with an audit callback) ---------- */
async function admin(store, actor, body, audit) {
  const op = body.operation, now = store.now();
  if (op === 'starter-status') {
    const cfg = await config(store);
    const counts = (await store.pool.query('SELECT status,COUNT(*) AS n FROM ryo_starter_activation_grants WHERE scope=$1 GROUP BY status', [store.scope])).rows;
    return { schedule: cfg, launched: launched(cfg, now), now, nextNoonPht: nextNoonPht(now), grants: Object.fromEntries(counts.map(r => [r.status, Number(r.n)])),
      switches: { pack: on('starterPack'), rate: on('starterRewardRate'), tracking: on('starterTracking'), ui: on('starterUi') } };
  }
  if (op === 'starter-schedule') {
    const at = body.mode === 'next-noon' ? nextNoonPht(now) : Number(body.at);
    if (!Number.isSafeInteger(at) || at <= now) fail('Choose a launch time in the future.');
    const cap = body.dailyGrantCap === undefined ? DEFAULT_DAILY_CAP : body.dailyGrantCap;
    if (!Number.isSafeInteger(cap) || cap < 0 || cap > 100000) fail('Daily starter grant cap must be a whole number between 0 and 100000.');
    return store.transaction(async c => {
      const old = await config(store, c);
      if (launched(old, now)) fail('The Starter Activation launch already happened; it cannot be moved.', 409);
      const next = { scheduledActivationAt: at, timezone: 'Asia/Manila', dailyGrantCap: cap, setBy: actor, setAt: now, rulesVersion: RULES };
      await c.query("INSERT INTO ryo_admin_control(scope,config,version,installed) VALUES($1,$2,1,$3) ON CONFLICT(scope) DO UPDATE SET config=COALESCE(ryo_admin_control.config,'{}'::jsonb)||$2", [store.scope, JSON.stringify({ starterActivation: next }), now]);
      await audit(c, 'admin.starter-scheduled', 'starter-activation', { previous: old, next });
      return { schedule: next };
    });
  }
  if (op === 'starter-unschedule') {
    return store.transaction(async c => {
      const old = await config(store, c);
      if (!old) return { schedule: null };
      if (launched(old, now)) fail('The Starter Activation launch already happened; switch its parts off in the Control panel instead.', 409);
      await c.query("UPDATE ryo_admin_control SET config=config-'starterActivation' WHERE scope=$1", [store.scope]);
      await audit(c, 'admin.starter-unscheduled', 'starter-activation', { previous: old });
      return { schedule: null };
    });
  }
  fail('Unknown Starter Activation operation.', 404);
}

module.exports = { RULES, TARGET, STARTER_BPS, HEROES, SCHEMA, nextNoonPht, config, launched, newProfile, countPaid, window, view, admin };
