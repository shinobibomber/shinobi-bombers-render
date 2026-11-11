/* Feature switches controlled from the admin Control panel (owner decision 2026-11-09).
 * Copied to app/server/feature-switches.cjs by apply-feature-switches.cjs.
 *
 * Every switch keeps its hosting-environment default (the previous rule, unchanged). An admin may set a panel value
 * (ON/OFF) that overrides it; clearing returns to the default. Panel values live in ryo_feature_switches, every change
 * is appended to the hash-chained ryo_feature_switch_log. This process keeps an in-memory copy (refreshed every 5 s and
 * right after a write) so the synchronous gate checks never wait on the database.
 *
 *   FEATURE_PANEL_DISABLED=on (Render)  ignores every panel value: back to the environment rules immediately.
 *   Database unreadable                 keeps the last good copy; never loaded → environment rules only.
 *
 * A switch only opens a feature's own gate. It can never bypass the other locks: registry mint/activation, SR routing's
 * two-wallet configuration, custody/mint start-up checks, the Market's wallet requirement, FOUNDERS_REVENUE_WALLET. */
'use strict';
const crypto = require('node:crypto');

const on = v => /^(1|on|true|yes)$/i.test(String(v ?? '').trim());
const off = v => /^(0|off|false|no)$/i.test(String(v ?? '').trim());
const isLive = () => { try { return require('./network.cjs').built(__dirname).key === 'mainnet'; } catch { return false; } };

/* key → env variable, group, label, default when the env variable is unset.
 * 'money' defaults follow the launch gates: ON on the test server, OFF on the live build. 'off' = OFF everywhere unless
 * set (the Founder switches fail closed). 'on' = ON everywhere unless set (gameplay screens, nothing changes by default). */
const CATALOG = Object.freeze({
  summoning:          { env: 'SUMMONING_ENABLED', group: 'money', label: 'Hero summoning (SR)', default: 'money' },
  srDeposits:         { env: 'SOL_DEPOSITS_ENABLED', group: 'money', label: 'SR deposits', default: 'money' },
  bossHunt:           { env: 'BOSS_HUNT_ENABLED', group: 'money', label: 'Boss Hunt entry', default: 'money' },
  rewardClaims:       { env: 'REWARD_CLAIMS_ENABLED', group: 'money', label: 'Chest reward claims', default: 'money' },
  chestSpending:      { env: 'CHEST_SPENDING_ENABLED', group: 'money', label: 'Spend unclaimed Chest rewards in shops', default: 'money' },
  withdrawals:        { env: 'SOL_WITHDRAWALS_ENABLED', group: 'money', label: 'SR withdrawals', default: 'money' },
  market:             { env: 'MARKETPLACE_ENABLED', group: 'money', label: 'Market', default: 'money' },
  foundersPublicSale: { env: 'FOUNDERS_PUBLIC_SALE_ENABLED', group: 'founders', label: "Founder's box public sale", default: 'off' },
  foundersPrivateTesting: { env: 'FOUNDERS_PRIVATE_TESTING_ENABLED', group: 'founders', label: "Founder's box private testing", default: 'off' },
  foundersRedemption: { env: 'FOUNDERS_REWARD_REDEMPTION_ENABLED', group: 'founders', label: 'Founder reward redemption', default: 'off' },
  senseiSol:          { env: 'SENSEI_SOL_ENABLED', group: 'founders', label: 'Sensei for SOL', default: 'off' },
  chat:               { env: 'CHAT_ENABLED', group: 'gameplay', label: 'Global chat (sending)', default: 'on' },
  fusion:             { env: 'FUSION_ENABLED', group: 'gameplay', label: 'Fusion', default: 'on' },
  dojo:               { env: 'DOJO_ENABLED', group: 'gameplay', label: 'Dojo upgrades', default: 'on' },
  training:           { env: 'TRAINING_ENABLED', group: 'gameplay', label: 'Hero training', default: 'on' },
  // Promotional Standard Hero Passes (hero-passes/server.cjs, owner request 2026-11-11): OFF everywhere until opened here.
  heroPassAdmin:        { env: 'HERO_PASS_ADMIN_ENABLED', group: 'rewards', label: 'Hero Pass campaigns (admin section)', default: 'off' },
  heroPassDistribution: { env: 'HERO_PASS_DISTRIBUTION_ENABLED', group: 'rewards', label: 'Hero Pass bulk distribution (Send to all)', default: 'off' },
  heroPassClaimUi:      { env: 'HERO_PASS_CLAIM_UI_ENABLED', group: 'rewards', label: 'Main-menu CLAIM button and Reward Center', default: 'off' },
  heroPassClaims:       { env: 'HERO_PASS_CLAIMS_ENABLED', group: 'rewards', label: 'Claiming and using Hero Passes', default: 'off' },
  // Starter Activation (starter-activation/server.cjs, owner request 2026-11-11): ON by default, but nothing happens until an
  // approver schedules the launch; each part can be switched off here. Gameplay group: while switch values are still loading
  // they keep their default (ON) instead of failing closed, so a new account never silently misses its starter pack.
  starterPack:          { env: 'STARTER_PACK_ENABLED', group: 'gameplay', label: 'Starter Activation: 10 free Genin for new accounts', default: 'on' },
  starterRewardRate:    { env: 'STARTER_REWARD_RATE_ENABLED', group: 'gameplay', label: 'Starter Activation: 50% enemy rewards until 15 paid summons', default: 'on' },
  starterTracking:      { env: 'STARTER_TRACKING_ENABLED', group: 'gameplay', label: 'Starter Activation: paid-summon tracking', default: 'on' },
  starterUi:            { env: 'STARTER_UI_ENABLED', group: 'gameplay', label: 'Starter Activation: activation panel', default: 'on' },
  // Expedition Mode (expedition/server.cjs, owner spec 2026-11-11): OFF everywhere until opened here. Combat Duty accrues and
  // heroes leave on free Expeditions only while `expeditions` is on. Paid acceleration (50/30/10/10, no burn) also
  // needs EXPEDITION_ROUTING_ENABLED=on and approved prices; it is a money switch, so it is never opened by default.
  expeditions:            { env: 'EXPEDITIONS_ENABLED', group: 'gameplay', label: 'Expedition Mode: Combat Duty and free Expeditions', default: 'off' },
  expeditionAcceleration: { env: 'EXPEDITION_ACCELERATION_ENABLED', group: 'money', label: 'Expedition Mode: optional paid acceleration (50% Reward Pool / 30% Treasury / 10% / 10%)', default: 'off' },
});
const KEYS = Object.freeze(Object.keys(CATALOG));

/** The environment rule for a switch (exactly the pre-panel behaviour). */
function envValue(key, env = process.env) {
  const c = CATALOG[key]; if (!c) throw Error('Unknown feature switch: ' + key);
  const raw = env[c.env];
  if (on(raw)) return true;
  if (c.default === 'off') return false;            // fail closed: anything but an explicit on is off
  if (off(raw)) return false;
  return c.default === 'on' ? true : !isLive();     // money: on for the test server, off for the live build
}

/* ---------- In-memory copy of the panel values ---------- */
let cache = { scope: null, values: new Map(), loaded: false, at: 0 }, timer = null, started = false, loadSeq = 0, appliedSeq = 0;
const panelDisabled = env => on(env.FEATURE_PANEL_DISABLED);
/** Effective state: the panel value when one is set (and the panel is enabled), otherwise the environment rule. */
function effective(key, env = process.env) {
  if (!CATALOG[key]) throw Error('Unknown feature switch: ' + key);
  if (!panelDisabled(env) && cache.values.has(key)) return cache.values.get(key).enabled;
  // Panel mounted but its values not loaded yet (boot, database down): money and Founder switches stay closed so a
  // value closed in the panel can never reopen through the environment. Gameplay screens keep their default.
  if (started && !cache.loaded && !panelDisabled(env) && CATALOG[key].group !== 'gameplay') return false;
  return envValue(key, env);
}
function source(key, env = process.env) {
  if (!panelDisabled(env) && cache.values.has(key)) return 'panel';
  return env[CATALOG[key].env] !== undefined && String(env[CATALOG[key].env]).trim() !== '' ? 'environment' : 'default';
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_feature_switches(
 scope TEXT NOT NULL, key TEXT NOT NULL, enabled BOOLEAN NOT NULL, version BIGINT NOT NULL, updated_by TEXT NOT NULL,
 reason TEXT NOT NULL, updated BIGINT NOT NULL, PRIMARY KEY(scope,key));
CREATE TABLE IF NOT EXISTS ryo_feature_switch_versions(scope TEXT NOT NULL, key TEXT NOT NULL, version BIGINT NOT NULL, PRIMARY KEY(scope,key));
CREATE TABLE IF NOT EXISTS ryo_feature_switch_log(
 scope TEXT NOT NULL, seq BIGINT NOT NULL, key TEXT NOT NULL, enabled BOOLEAN, actor TEXT NOT NULL, reason TEXT NOT NULL,
 created BIGINT NOT NULL, version BIGINT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(scope,seq));
CREATE TABLE IF NOT EXISTS ryo_control_challenges(scope TEXT NOT NULL, nonce TEXT NOT NULL, wallet TEXT NOT NULL, message TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY(scope,nonce));
CREATE TABLE IF NOT EXISTS ryo_control_sessions(scope TEXT NOT NULL, token_hash TEXT NOT NULL, wallet TEXT NOT NULL, created BIGINT NOT NULL, expires BIGINT NOT NULL, PRIMARY KEY(scope,token_hash));`;

/** Loads the panel values of a scope into memory. Failure keeps the last good copy. */
async function load(pool, scope) {
  const seq = ++loadSeq;
  try {
    const rows = (await pool.query('SELECT key,enabled,version,updated_by,reason,updated FROM ryo_feature_switches WHERE scope=$1', [scope])).rows;
    if (seq < appliedSeq) return true;   // a newer load already applied (e.g. right after a change)
    const values = new Map(rows.filter(r => CATALOG[r.key]).map(r => [r.key, { enabled: r.enabled === true, version: Number(r.version), by: r.updated_by, reason: r.reason, updated: Number(r.updated) }]));
    appliedSeq = seq; cache = { scope, values, loaded: true, at: Date.now() };
    return true;
  } catch { return false; }
}
/** Starts the 5-second refresh for this process (idempotent). */
function start(pool, scope, ms = 5000) {
  if (timer) return; started = true; load(pool, scope);
  timer = setInterval(() => load(pool, scope), ms); if (timer.unref) timer.unref();
}
function stop() { if (timer) clearInterval(timer); timer = null; started = false; }

const chainHash = (prev, entry) => crypto.createHash('sha256').update(prev + '\n' + JSON.stringify(entry)).digest('hex');
/* One audited change: set (enabled true/false) or clear (enabled null → back to the environment rule).
 * expectedVersion guards against two admins overwriting each other (0 when the switch has never been set). */
async function change(pool, scope, { key, enabled, actor, reason, expectedVersion, now = Date.now() }) {
  if (!CATALOG[key]) throw Object.assign(Error('Unknown feature switch.'), { status: 400 });
  if (enabled !== true && enabled !== false && enabled !== null) throw Object.assign(Error('Choose ON, OFF or reset.'), { status: 400 });
  if (typeof reason !== 'string' || reason.trim().length < 8 || reason.length > 300) throw Object.assign(Error('Write a reason (8-300 characters).'), { status: 400 });
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw Object.assign(Error('Refresh the panel and try again.'), { status: 409 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['ryo_feature_switch_log:' + scope]);
    const cur = (await c.query('SELECT version FROM ryo_feature_switch_versions WHERE scope=$1 AND key=$2', [scope, key])).rows[0];
    const version = cur ? Number(cur.version) : 0;
    if (version !== expectedVersion) throw Object.assign(Error('Someone else changed this switch. Refresh and try again.'), { status: 409, code: 'STALE' });
    const next = version + 1;
    await c.query('INSERT INTO ryo_feature_switch_versions(scope,key,version) VALUES($1,$2,$3) ON CONFLICT(scope,key) DO UPDATE SET version=EXCLUDED.version', [scope, key, next]);
    if (enabled === null) await c.query('DELETE FROM ryo_feature_switches WHERE scope=$1 AND key=$2', [scope, key]);
    else await c.query(`INSERT INTO ryo_feature_switches(scope,key,enabled,version,updated_by,reason,updated) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(scope,key) DO UPDATE SET enabled=EXCLUDED.enabled,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,reason=EXCLUDED.reason,updated=EXCLUDED.updated`,
      [scope, key, enabled, next, actor, reason.trim(), now]);
    const last = (await c.query('SELECT seq,hash FROM ryo_feature_switch_log WHERE scope=$1 ORDER BY seq DESC LIMIT 1', [scope])).rows[0];
    const seq = last ? Number(last.seq) + 1 : 1, prev = last ? last.hash : 'genesis';
    const entry = { scope, seq, key, enabled, actor, reason: reason.trim(), created: now, version: next };
    await c.query('INSERT INTO ryo_feature_switch_log(scope,seq,key,enabled,actor,reason,created,version,prev_hash,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [scope, seq, key, enabled, actor, reason.trim(), now, next, prev, chainHash(prev, entry)]);
    await c.query('COMMIT');
    return { key, enabled, version: next, seq };
  } catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; }
  finally { c.release(); }
}
async function versions(pool, scope) {
  return new Map((await pool.query('SELECT key,version FROM ryo_feature_switch_versions WHERE scope=$1', [scope])).rows.map(r => [r.key, Number(r.version)]));
}
/** Recent changes, newest first, with the hash chain checked for the rows returned. */
async function log(pool, scope, limit = 50) {
  const rows = (await pool.query('SELECT seq,key,enabled,actor,reason,created,version,prev_hash,hash FROM ryo_feature_switch_log WHERE scope=$1 ORDER BY seq DESC LIMIT $2', [scope, Math.min(200, Math.max(1, limit))])).rows;
  return rows.map((r, i) => {
    // Each row's hash is recomputed from its stored fields and must link to the previous row (tamper-evident).
    const entry = { scope, seq: Number(r.seq), key: r.key, enabled: r.enabled, actor: r.actor, reason: r.reason, created: Number(r.created), version: Number(r.version) };
    const intact = chainHash(r.prev_hash, entry) === r.hash, linked = i + 1 < rows.length ? rows[i + 1].hash === r.prev_hash : true;
    return { seq: Number(r.seq), key: r.key, enabled: r.enabled, actor: r.actor, reason: r.reason, created: Number(r.created), hash: r.hash, linked: linked && intact, intact };
  });
}

/** Panel view of every switch for one scope. */
async function view(pool, scope, env = process.env) {
  const v = await versions(pool, scope);
  return KEYS.map(key => ({ key, label: CATALOG[key].label, group: CATALOG[key].group, envName: CATALOG[key].env,
    environment: envValue(key, env), panel: cache.values.has(key) ? cache.values.get(key).enabled : null, effective: effective(key, env), source: source(key, env),
    version: v.get(key) || 0, lastChange: cache.values.get(key) || null }));
}

const isLoaded = () => cache.loaded;
module.exports = { CATALOG, KEYS, SCHEMA, envValue, effective, source, load, start, stop, change, log, view, panelDisabled, isLoaded,
  _setForTest: values => { cache = { scope: 'test', values: new Map(Object.entries(values).map(([k, enabled]) => [k, { enabled, version: 1 }])), loaded: true, at: Date.now() }; } };
