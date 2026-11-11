'use strict';
/* Command Center, Batch A: three READ-ONLY views. Copied to app/server/command-center-views.cjs by apply-command-center.cjs.
 *
 *   configStatus   Game configuration status: every feature switch (value, where it comes from, last change), the release stage
 *                  and the public launch gates. It only reads. Changing a switch stays in /admin/control, which asks for a fresh
 *                  wallet signature before it opens anything that touches money.
 *   securityView   Security center: audit-chain and switch-log integrity, staff role counts, active session counts, staff write
 *                  activity, and findings. Counts only: no wallet lists, no token hashes.
 *   creatorsView   Creators summary: applications, Creator Points, referrals, shop redemptions, Hero Passes and rescue heroes as
 *                  aggregates only (no names, wallets or applications).
 *
 * Nothing here writes, signs or moves anything, and no environment value is returned: only booleans, the stage name and the
 * environment VARIABLE NAMES of the switches. Anything the game does not record is returned as { status: 'not_implemented' }
 * and shown that way, never invented. Each section fails on its own ({ status: 'unavailable' }) instead of failing the page. */
const UNIT = 1000;   // Creator Points are stored as milli-points (creators-portal/server.cjs)
const num = v => (v === null || v === undefined ? 0 : Number(v));
const short = w => (typeof w === 'string' && w.length > 12 ? w.slice(0, 4) + '…' + w.slice(-4) : w || null);

/** Runs one section; a failure is reported for that section only (never the message, which could name a table or host). */
async function section(fn) { try { return { status: 'ready', ...(await fn()) }; } catch { return { status: 'unavailable' }; } }
async function presentTables(pool, names) {
  return new Set((await pool.query('SELECT t FROM unnest($1::text[]) AS t WHERE to_regclass(t) IS NOT NULL', [names])).rows.map(r => r.t));
}

/* ---------- Game configuration status ---------- */
function releaseStatus(env = process.env) {
  const out = { prelaunch: null, stage: null, mintReleased: null, launched: null, hold: null };
  try {
    const n = require('./network.cjs'); out.prelaunch = n.prelaunch(); out.stage = n.releaseStage(); out.mintReleased = n.mintReleased(env); out.launched = n.launched(env);
    // network.cjs: launched = no hold AND mint released. So with the mint released, "not launched" means the hold is on; before that the hold is moot (null).
    out.hold = out.mintReleased ? !out.launched : null;
  } catch {}
  return out;
}
async function configStatus(ctx) {
  const { store } = ctx, env = process.env, FS = require('./feature-switches.cjs');
  const switches = await section(async () => ({
    loaded: FS.isLoaded(), panelDisabled: !!FS.panelDisabled(env),
    list: (await FS.view(store.pool, store.scope, env)).map(s => ({
      key: s.key, label: s.label, group: s.group, money: s.group !== 'gameplay', envName: s.envName, environment: s.environment, panel: s.panel, effective: s.effective, source: s.source, version: num(s.version),
      lastChange: s.lastChange ? { enabled: s.lastChange.enabled, version: num(s.lastChange.version), by: short(s.lastChange.by || s.lastChange.updated_by), updated: num(s.lastChange.updated) || null } : null })),
  }));
  const log = await section(async () => {
    const rows = await FS.log(store.pool, store.scope, 25);
    return { intact: rows.every(r => r.intact && r.linked), entries: rows.map(r => ({ seq: r.seq, key: r.key, enabled: r.enabled, actor: short(r.actor), reason: r.reason, created: r.created, intact: r.intact, linked: r.linked })) };
  });
  let gates = null, routing = null;
  try { const lg = require('./launch-gates.cjs'); gates = lg.publicGates(); routing = typeof lg.srRoutingEnabled === 'function' ? !!lg.srRoutingEnabled(env) : null; } catch {}
  return { release: releaseStatus(env), gates, srRevenueRouting: routing, switches, log };
}

/* ---------- Security center ---------- */
const ENV_ROLE_LISTS = { owner: 'RYO_ADMIN_OWNERS', approver: 'RYO_ADMIN_APPROVERS', operator: 'RYO_ADMIN_OPERATORS', viewer: 'RYO_ADMIN_VIEWERS' };
async function securityView(ctx) {
  const { store } = ctx, pool = store.pool, scope = store.scope, now = store.now(), env = process.env;
  const dashboard = require('./economic-dashboard.cjs'), FS = require('./feature-switches.cjs');
  const audit = await section(async () => {
    const total = (await pool.query('SELECT COUNT(*) AS n, MAX(sequence) AS latest, MAX(created) AS at FROM ryo_admin_audit WHERE scope=$1', [scope])).rows[0];
    const rows = (await pool.query('SELECT sequence,actor,action,data,created,previous,hash FROM ryo_admin_audit WHERE scope=$1 ORDER BY sequence DESC LIMIT 2000', [scope])).rows;
    let valid = 0, linked = 0, links = 0;
    rows.forEach((r, i) => {
      const record = { sequence: num(r.sequence), actor: r.actor, action: r.action, data: r.data, created: num(r.created), previous: r.previous };
      if (dashboard.digest(record) === r.hash) valid++;
      const next = rows[i + 1]; if (next && num(next.sequence) === record.sequence - 1) { links++; if (next.hash === r.previous) linked++; }
    });
    return { total: num(total.n), latestSequence: num(total.latest) || null, latestAt: num(total.at) || null, checked: rows.length, complete: rows.length === num(total.n), hashesValid: valid, links, linksIntact: linked,
      intact: valid === rows.length && linked === links,
      recent: rows.slice(0, 15).map(r => ({ sequence: num(r.sequence), action: r.action, actor: short(r.actor), created: num(r.created) })) };
  });
  const switchLog = await section(async () => { const rows = await FS.log(pool, scope, 200); return { checked: rows.length, intact: rows.every(r => r.intact && r.linked), latestAt: rows[0]?.created ?? null }; });
  const roles = await section(async () => {
    const grants = (await pool.query("SELECT role, COUNT(*) FILTER (WHERE revoked IS NULL) AS active, COUNT(*) FILTER (WHERE revoked IS NOT NULL) AS revoked FROM ryo_cc_roles WHERE scope=$1 GROUP BY role", [scope])).rows;
    return { environment: Object.fromEntries(Object.entries(ENV_ROLE_LISTS).map(([role, name]) => [role, String(env[name] || '').split(',').map(s => s.trim()).filter(Boolean).length])),
      backend: Object.fromEntries(grants.map(g => [g.role, { active: num(g.active), revoked: num(g.revoked) }])) };
  });
  const sessions = await section(async () => {
    const count = async t => { try { return (await presentTables(pool, [t])).has(t) ? num((await pool.query(`SELECT COUNT(*) AS n FROM ${t} WHERE scope=$1 AND expires>$2`, [scope, now])).rows[0].n) : null; } catch { return null; } };
    return { game: await count('ryo_sessions'), controlPanel: await count('ryo_control_sessions') };
  });
  const staff = await section(async () => {
    const r = (await pool.query('SELECT COUNT(*) FILTER (WHERE created>$2) AS hour, COUNT(*) AS day, COUNT(DISTINCT actor) AS actors FROM ryo_cc_requests WHERE scope=$1 AND created>$3', [scope, now - 3600000, now - 86400000])).rows[0];
    return { writesLastHour: num(r.hour), writesLast24h: num(r.day), activeStaffLast24h: num(r.actors) };
  });
  const incidents = await section(async () => {
    const rows = (await pool.query("SELECT status, severity, COUNT(*) AS n FROM ryo_cc_incidents WHERE scope=$1 AND status<>'resolved' GROUP BY status, severity", [scope])).rows;
    return { open: rows.reduce((s, r) => s + num(r.n), 0), critical: rows.filter(r => r.severity === 'critical').reduce((s, r) => s + num(r.n), 0), high: rows.filter(r => r.severity === 'high').reduce((s, r) => s + num(r.n), 0) };
  });
  let selfApproval = null; try { selfApproval = !!dashboard.selfApproval(); } catch {}
  // Findings are derived only from the values above, so a missing section never reads as "all clear".
  const findings = [];
  if (audit.status === 'ready' && !audit.intact) findings.push({ code: 'AUDIT_CHAIN', severity: 'critical', text: 'The admin audit chain failed verification (a hash or a link does not match). Do not rely on it until the owner has investigated.' });
  if (switchLog.status === 'ready' && !switchLog.intact) findings.push({ code: 'SWITCH_LOG_CHAIN', severity: 'critical', text: 'The feature-switch log failed verification.' });
  if (selfApproval) findings.push({ code: 'SELF_APPROVAL', severity: 'warn', text: 'One-wallet approval is on (ADMIN_SELF_APPROVAL): an approver can approve its own proposal. The Command Center specification asks for two different wallets.' });
  if (incidents.status === 'ready' && incidents.critical) findings.push({ code: 'CRITICAL_INCIDENT', severity: 'critical', text: incidents.critical + ' critical incident(s) are still open.' });
  else if (incidents.status === 'ready' && incidents.high) findings.push({ code: 'HIGH_INCIDENT', severity: 'warn', text: incidents.high + ' high-severity incident(s) are still open.' });
  for (const [name, s] of Object.entries({ audit, switchLog, roles, sessions, staff, incidents })) if (s.status !== 'ready') findings.push({ code: 'UNAVAILABLE_' + name.toUpperCase(), severity: 'warn', text: 'The ' + name + ' section could not be read, so it is not shown as healthy.' });
  return { findings, selfApproval, audit, switchLog, roles, sessions, staff, incidents,
    notRecorded: [{ key: 'failedLogins', status: 'not_implemented', text: 'Failed sign-ins are not stored anywhere, so there is nothing to show. Challenge requests are only throttled in memory.' },
      { key: 'requestFloods', status: 'not_implemented', text: 'Rate-limit hits are counted in memory per server and are not kept.' }] };
}

/* ---------- Creators summary ---------- */
const CREATOR_TABLES = ['ryo_creators', 'ryo_creator_ledger', 'ryo_creator_referrals', 'ryo_creator_redemptions', 'ryo_creator_program', 'ryo_creator_audit', 'ryo_player_referrals', 'ryo_pass_campaigns', 'ryo_pass_entitlements', 'ryo_pass_balances', 'ryo_prison_rescues'];
async function creatorsView(ctx) {
  const { store } = ctx, pool = store.pool, scope = store.scope, have = await presentTables(pool, CREATOR_TABLES);
  const rows = async (table, sql, args = []) => (have.has(table) ? (await pool.query(sql, [scope, ...args])).rows : null);
  const grouped = rs => Object.fromEntries((rs || []).map(r => [r.status, num(r.n)]));
  const applications = await section(async () => {
    const rs = await rows('ryo_creators', 'SELECT status, COUNT(*) AS n FROM ryo_creators WHERE scope=$1 GROUP BY status');
    if (!rs) return { status: 'unavailable' };
    const by = grouped(rs); return { byStatus: by, total: Object.values(by).reduce((a, b) => a + b, 0) };
  });
  const creatorPoints = await section(async () => {
    const l = await rows('ryo_creator_ledger', "SELECT COALESCE(SUM(delta) FILTER (WHERE delta>0 AND kind NOT LIKE 'redemption%' AND kind<>'adjustment'),0) AS issued, COALESCE(-SUM(delta) FILTER (WHERE kind LIKE 'redemption%'),0) AS spent, COALESCE(SUM(delta) FILTER (WHERE kind='adjustment'),0) AS adjustments, COUNT(*) AS entries FROM ryo_creator_ledger WHERE scope=$1");
    const kinds = await rows('ryo_creator_ledger', 'SELECT kind, COUNT(*) AS n, COALESCE(SUM(delta),0) AS total FROM ryo_creator_ledger WHERE scope=$1 GROUP BY kind ORDER BY kind');
    const b = await rows('ryo_creators', 'SELECT COALESCE(SUM(balance),0) AS held FROM ryo_creators WHERE scope=$1');
    if (!l || !b) return { status: 'unavailable' };
    return { issued: num(l[0].issued) / UNIT, spent: num(l[0].spent) / UNIT, adjustmentsNet: num(l[0].adjustments) / UNIT, held: num(b[0].held) / UNIT, ledgerEntries: num(l[0].entries),
      byKind: kinds.map(k => ({ kind: k.kind, entries: num(k.n), points: num(k.total) / UNIT })) };
  });
  const referrals = await section(async () => {
    const c = await rows('ryo_creator_referrals', 'SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE qualified IS NOT NULL) AS qualified, COALESCE(SUM(paid_mints),0) AS mints FROM ryo_creator_referrals WHERE scope=$1');
    const p = await rows('ryo_player_referrals', 'SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE qualified IS NOT NULL) AS qualified FROM ryo_player_referrals WHERE scope=$1');
    return { creator: c ? { total: num(c[0].total), qualified: num(c[0].qualified), paidMints: num(c[0].mints) } : null, player: p ? { total: num(p[0].total), qualified: num(p[0].qualified) } : null };
  });
  const redemptions = await section(async () => {
    const rs = await rows('ryo_creator_redemptions', 'SELECT status, COUNT(*) AS n FROM ryo_creator_redemptions WHERE scope=$1 GROUP BY status');
    return rs ? { byStatus: grouped(rs) } : { status: 'unavailable' };
  });
  const heroPasses = await section(async () => {
    const camp = await rows('ryo_pass_campaigns', 'SELECT status, COUNT(*) AS n FROM ryo_pass_campaigns WHERE scope=$1 GROUP BY status');
    const ent = await rows('ryo_pass_entitlements', 'SELECT status, COUNT(*) AS n, COALESCE(SUM(passes),0) AS passes FROM ryo_pass_entitlements WHERE scope=$1 GROUP BY status');
    const bal = await rows('ryo_pass_balances', 'SELECT COALESCE(SUM(passes),0) AS passes, COALESCE(SUM(used),0) AS used FROM ryo_pass_balances WHERE scope=$1');
    return { campaigns: grouped(camp), entitlements: Object.fromEntries((ent || []).map(r => [r.status, { entitlements: num(r.n), passes: num(r.passes) }])), balances: bal ? { passes: num(bal[0].passes), used: num(bal[0].used) } : null };
  });
  const rescues = await section(async () => {
    const all = await rows('ryo_prison_rescues', 'SELECT COUNT(*) AS n FROM ryo_prison_rescues WHERE scope=$1');
    const staff = await rows('ryo_creator_audit', "SELECT COUNT(*) AS n FROM ryo_creator_audit WHERE scope=$1 AND action='admin.grant-rescue-hero'");
    return { total: all ? num(all[0].n) : null, staffGrants: staff ? num(staff[0].n) : null };
  });
  const program = await section(async () => {
    const r = await rows('ryo_creator_program', 'SELECT version, config FROM ryo_creator_program WHERE scope=$1 ORDER BY version DESC LIMIT 1');
    const c = r?.[0]?.config || {};
    return { version: r?.[0] ? num(r[0].version) : null, applicationsPaused: !!c.applicationsPaused, enrollmentPaused: !!c.enrollmentPaused, enrollmentLimit: c.enrollmentLimit ?? null, commissionDays: c.commissionDays ?? null };
  });
  return { portalPresent: have.has('ryo_creators'), applications, creatorPoints, referrals, redemptions, heroPasses, rescues, program,
    notImplemented: [{ key: 'campaigns', status: 'not_implemented', text: 'Paid marketing campaigns (sponsors, agreements, budgets, payout evidence) have no backend. Creator Points and referral rewards are the only payout paths and are managed in the Creators Portal.' }] };
}

module.exports = { configStatus, securityView, creatorsView, releaseStatus, short };
