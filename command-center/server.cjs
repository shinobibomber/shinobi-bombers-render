'use strict';
/* Shinobi Command Center, Phase 1: staff operations API.
 *
 * Copied to app/server/command-center.cjs by apply-command-center.cjs. Every action arrives through the
 * existing /api/ryo endpoint (POST only, exact Origin, JSON, 8 KB limit in netlify-handler.cjs) after the
 * wallet session is authenticated, so identity, roles and scope are always derived on the server.
 *
 * What it can do: read operational data, moderate Global chat (warn, hide, mute, ban), publish reviewed
 * System announcements, show health and the audit chain, and let the Owner grant Moderator/Support roles.
 * What it can never do: move SOL or Ryo, change balances, rewards, purchases, withdrawals, heroes or NFTs,
 * or change financial roles. Financial configuration stays in the economic dashboard's two-wallet flow.
 */
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { fail, hash } = require('./store.cjs');
const MARKER = 'shinobi-command-center-v1';

/* ---------- Roles and permissions ---------- */
// Ordered from most to least privileged; the first role is the one displayed.
const ROLES = ['owner', 'approver', 'operator', 'moderator', 'support', 'viewer'];
// Hosting-environment roles. Approver/Operator/Viewer are the existing economic-dashboard lists, unchanged.
const ENV_ROLES = { owner: 'RYO_ADMIN_OWNERS', approver: 'RYO_ADMIN_APPROVERS', operator: 'RYO_ADMIN_OPERATORS', viewer: 'RYO_ADMIN_VIEWERS' };
// Only these can be granted in the backend, and only by an Owner.
const GRANTABLE = ['moderator', 'support'];
const ALL = ROLES;
const PERMISSIONS = Object.freeze({
  'overview.read': ALL,
  'ops.read': ALL,
  'player.read': ALL,
  'player.wallet': ['owner', 'approver', 'operator', 'moderator', 'support'],   // viewers see shortened wallets
  'player.heroes': ['owner', 'approver', 'operator', 'support', 'viewer'],
  'player.economy': ['owner', 'approver', 'operator', 'viewer'],
  'player.transactions': ['owner', 'approver', 'operator'],
  'moderation.read': ['owner', 'operator', 'moderator', 'support'],
  'moderation.write': ['owner', 'operator', 'moderator'],
  'reports.resolve': ['owner', 'operator', 'moderator', 'support'],
  'announcement.read': ['owner', 'approver', 'operator', 'moderator', 'viewer'],
  'announcement.propose': ['owner', 'operator', 'moderator'],
  'announcement.review': ['owner', 'operator'],
  'audit.read': ['owner', 'approver', 'operator', 'viewer'],
  'audit.own': ['moderator', 'support'],
  'roles.manage': ['owner'],
  'founders.read': ['owner', 'approver', 'operator'],   // Founder NFT management (founders.cjs); full wallets, so not viewers
  'founders.manage': ['owner'],
  'stats.read': ['owner', 'approver', 'operator', 'viewer'],   // Stats report: totals only (stats-report.cjs), never wallets
  // Batch A (ops-views.cjs): read-only views. None of them lists a wallet or an environment value.
  'config.read': ['owner', 'approver', 'operator', 'viewer'],   // Game configuration status (switches, release stage, gates)
  'security.read': ['owner', 'approver', 'operator'],           // Security center and the incident register
  'security.manage': ['owner', 'operator'],                     // open / update incidents (notes only, no effect on the game)
  'creators.read': ['owner', 'approver', 'operator'],           // Creators summary (aggregates only)
  // Support tickets (support/server.cjs). Staff change only a ticket's status, assignee and messages, never balances or rewards.
  'support.read': ['owner', 'approver', 'operator', 'support'],
  'support.write': ['owner', 'operator', 'support'],
  // Events (events/server.cjs): dated notices with no rewards. Propose, then a DIFFERENT wallet reviews. Approvers are not part of event operations.
  'event.read': ['owner', 'operator', 'moderator', 'viewer'],
  'event.propose': ['owner', 'operator', 'moderator'],
  'event.review': ['owner', 'operator'],
});
const envList = name => String(process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
async function rolesOf(store, db, wallet) {
  const set = new Set();
  for (const [role, name] of Object.entries(ENV_ROLES)) if (envList(name).includes(wallet)) set.add(role);
  for (const row of (await db.query('SELECT role FROM ryo_cc_roles WHERE scope=$1 AND wallet=$2 AND revoked IS NULL', [store.scope, wallet])).rows) set.add(row.role);
  return ROLES.filter(r => set.has(r));
}
const can = (roles, perm) => roles.some(r => PERMISSIONS[perm].includes(r));
const actingRole = (roles, perm) => roles.find(r => PERMISSIONS[perm].includes(r));
function need(roles, ...perms) {
  if (!perms.some(p => can(roles, p))) fail('Your Command Center role does not include this permission (' + perms.join(' or ') + ').', 403);
}
const permissionsOf = roles => Object.keys(PERMISSIONS).filter(p => can(roles, p));

/* ---------- Input validation ---------- */
function address(value) {
  try { const { PublicKey } = require('@solana/web3.js'); if (typeof value === 'string' && new PublicKey(value).toBase58() === value) return value; } catch {}
  fail('Invalid Solana wallet address.');
}
const isAddress = value => { try { return address(value) === value; } catch { return false; } };
function requestId(value) { if (typeof value !== 'string' || !/^[-a-zA-Z0-9_]{16,80}$/.test(value)) fail('A request ID (16-80 letters, digits, - or _) is required.'); return value; }
function reason(value) {
  if (typeof value !== 'string') fail('A reason is required.');
  const v = value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, ' ').replace(/\s+/g, ' ').trim();
  if ([...v].length < 8 || [...v].length > 500) fail('Give a reason of 8 to 500 characters.');
  return v;
}
function version(value) { if (!Number.isSafeInteger(value) || value < 0) fail('expectedVersion is required. Refresh and try again.'); return value; }
function limit(value, def = 50, max = 100) { if (value === undefined) return def; if (!Number.isSafeInteger(value) || value < 1 || value > max) fail('limit must be a whole number from 1 to ' + max + '.'); return value; }
const cursorOut = id => (id ? Buffer.from(JSON.stringify({ id: Number(id) })).toString('base64url') : null);
function cursorIn(value) {
  if (value === undefined || value === null || value === '') return Number.MAX_SAFE_INTEGER;
  try { const x = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')); if (Number.isSafeInteger(x.id) && x.id > 0) return x.id; } catch {}
  fail('Invalid page cursor.');
}
const short = w => (w ? w.slice(0, 4) + '…' + w.slice(-4) : w);
const num = v => (v === null || v === undefined ? null : Number(v));
const sha = text => crypto.createHash('sha256').update(String(text)).digest('hex');
// Writes carry the scope the page was loaded for; a page from another network or scope can never act here.
function sameScope(store, body) { if (body.scope !== store.scope) fail('This page was loaded for a different game network or scope. Refresh before acting.', 409); }
const envelope = (store, data, extra = {}) => ({ marker: MARKER, scope: store.scope, observedAt: store.now(), status: 'ready', data, ...extra });

/* ---------- Writes: one transaction, re-authorized, idempotent, audited ---------- */
const WRITE_LIMIT = 30, WRITE_WINDOW_MS = 60000;
async function write(ctx, wallet, action, body, perm, fn) {
  const { store } = ctx, id = requestId(body.requestId);
  sameScope(store, body);
  const dashboard = require('./economic-dashboard.cjs');
  return store.transaction(async c => {
    // The admin control row lock serializes every staff write per scope, which also keeps the
    // shared audit hash chain linear.
    await dashboard.control(store, c, true);
    const roles = await rolesOf(store, c, wallet);   // checked again inside the transaction, before commit
    need(roles, perm);
    const prior = (await c.query('SELECT action,result FROM ryo_cc_requests WHERE scope=$1 AND actor=$2 AND request_id=$3', [store.scope, wallet, id])).rows[0];
    if (prior) { if (prior.action !== action) fail('This request ID was already used for a different action.', 409); return { ...prior.result, replayed: true }; }
    const now = store.now();
    const recent = Number((await c.query('SELECT COUNT(*) AS n FROM ryo_cc_requests WHERE scope=$1 AND actor=$2 AND created>$3', [store.scope, wallet, now - WRITE_WINDOW_MS])).rows[0].n);
    if (recent >= WRITE_LIMIT) fail('Too many staff actions in a minute. Wait before trying again.', 429);
    const role = actingRole(roles, perm), out = await fn(c, { roles, role, now, requestId: id });
    const result = { ok: true, ...out.result };
    await dashboard.audit(store, c, wallet, 'cc.' + out.audit, { role, requestId: id, outcome: 'success', ...out.data });
    await c.query('INSERT INTO ryo_cc_requests(scope,actor,request_id,action,result,created) VALUES($1,$2,$3,$4,$5,$6)', [store.scope, wallet, id, action, JSON.stringify(result), now]);
    return result;
  });
}

/* ---------- Session ---------- */
function networkInfo() {
  try { const n = require('./network.cjs').built(__dirname); return { key: n.key, label: n.label }; } catch { return { key: 'unknown', label: 'Unknown' }; }
}
async function session(ctx, wallet, roles) {
  const { store } = ctx;
  const row = ctx.token ? (await store.pool.query('SELECT expires FROM ryo_sessions WHERE scope=$1 AND token_hash=$2', [store.scope, hash(ctx.token)])).rows[0] : null;
  return envelope(store, { wallet, roles, role: roles[0], permissions: permissionsOf(roles), network: networkInfo(), sessionExpires: num(row?.expires) });
}

/* ---------- Overview ---------- */
const metric = (key, value, source, status = 'ready', note) => ({ key, value, source, status, ...(note ? { note } : {}) });
async function overview(ctx) {
  const { store } = ctx, now = store.now();
  const q = async (sql, args = []) => (await store.pool.query(sql, [store.scope, ...args])).rows[0];
  const players = await q('SELECT COUNT(*) AS n FROM ryo_profiles WHERE scope=$1');
  const online = await q('SELECT COUNT(DISTINCT wallet) AS n FROM ryo_presence WHERE scope=$1 AND last_seen>$2', [now - 90000]);
  const reports = await q("SELECT COUNT(*) AS n FROM ryo_cc_chat_reports WHERE scope=$1 AND status='open'");
  const muted = await q('SELECT COUNT(*) FILTER(WHERE banned) AS banned,COUNT(*) FILTER(WHERE NOT banned AND muted_until>$2) AS muted FROM ryo_cc_chat_status WHERE scope=$1', [now]);
  const ann = await q("SELECT COUNT(*) AS n FROM ryo_cc_announcements WHERE scope=$1 AND status='pending'");
  const proposals = await q("SELECT COUNT(*) AS n FROM ryo_admin_proposals WHERE scope=$1 AND status='pending'");
  const pending = await q("SELECT (SELECT COUNT(*) FROM ryo_purchases WHERE scope=$1 AND status='pending') AS purchases,(SELECT COUNT(*) FROM ryo_withdrawals WHERE scope=$1 AND status='pending') AS withdrawals,(SELECT COUNT(*) FROM ryo_purchases WHERE scope=$1 AND status='pending' AND created<$2)+(SELECT COUNT(*) FROM ryo_withdrawals WHERE scope=$1 AND status='pending' AND created<$2) AS stale", [now - 30 * 60000]);
  const ctl = await q('SELECT pauses FROM ryo_admin_control WHERE scope=$1');
  const metrics = [
    metric('players', num(players.n), 'ryo_profiles: wallets with a saved game profile'),
    metric('activeSessions', num(online.n), 'ryo_presence: signed-in wallets with a heartbeat in the last 90 seconds'),
    metric('newSignups24h', null, 'No account creation time is recorded', 'unavailable'),
    metric('dailyActive', null, 'Presence is not retained after 90 seconds, so daily/weekly actives cannot be counted', 'unavailable'),
    metric('openReports', num(reports.n), 'ryo_cc_chat_reports'),
    metric('activeMutes', num(muted.muted), 'ryo_cc_chat_status'),
    metric('activeBans', num(muted.banned), 'ryo_cc_chat_status'),
    metric('pendingAnnouncements', num(ann.n), 'ryo_cc_announcements'),
    metric('pendingProposals', num(proposals.n), 'ryo_admin_proposals (economic dashboard)'),
    metric('pendingPurchases', num(pending.purchases), 'ryo_purchases'),
    metric('pendingWithdrawals', num(pending.withdrawals), 'ryo_withdrawals'),
    metric('stalePending', num(pending.stale), 'Pending purchases/withdrawals older than 30 minutes'),
    metric('revenue', null, 'Verified Ryo/SOL revenue is reported in the Ryo Observatory (/admin/) for finance roles', 'not_implemented'),
    metric('nftSales', null, 'Founder NFT management is planned for Phase 2', 'not_implemented'),
  ];
  return envelope(store, { metrics, pauses: Object.keys(ctl?.pauses || {}) });
}

/* ---------- Health ---------- */
const timed = async (fn, ms) => { let t; const start = Date.now(); try { return { value: await Promise.race([fn(), new Promise((_, reject) => { t = setTimeout(() => reject(Object.assign(Error('timeout'), { timeout: true })), ms); })]), ms: Date.now() - start }; } finally { clearTimeout(t); } };
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
async function health(ctx) {
  const { store } = ctx, now = store.now(), checks = {};
  try {
    const r = await timed(() => store.pool.query("SELECT to_regclass('ryo_cc_chat_status') IS NOT NULL AS cc,to_regclass('ryo_admin_audit') IS NOT NULL AS audit"), 5000);
    checks.database = { status: r.value.rows[0].cc && r.value.rows[0].audit ? 'ok' : 'degraded', latencyMs: r.ms, schema: { commandCenter: !!r.value.rows[0].cc, auditChain: !!r.value.rows[0].audit } };
  } catch { checks.database = { status: 'unavailable', note: 'Database did not answer within 5 seconds.' }; }
  if (typeof ctx.checkNetwork === 'function') {
    try { const r = await timed(() => ctx.checkNetwork(), 5000); checks.rpc = { status: 'ok', latencyMs: r.ms, note: 'Genesis hash matches this build\'s network.' }; }
    catch (e) { checks.rpc = e.status ? { status: 'mismatch', note: 'RPC genesis does not match this build\'s network.' } : { status: 'unavailable', note: e.timeout ? 'RPC did not answer within 5 seconds.' : 'RPC request failed.' }; }
  } else checks.rpc = { status: 'unavailable', note: 'No RPC check is available on this server.' };
  let release = { prelaunch: null, stage: null };
  try { const n = require('./network.cjs'); release = { prelaunch: n.prelaunch(), stage: n.releaseStage(), mintReleased: n.mintReleased ? n.mintReleased() : false, launched: n.launched ? n.launched() : false, hold: !!String(process.env.GAME_LAUNCH_HOLD || '').trim() }; } catch {}
  let gates = null; try { gates = require('./launch-gates.cjs').publicGates(); } catch {}
  const integrity = readJson(path.join(__dirname, '../public/build-integrity.json'));
  const commit = String(process.env.RENDER_GIT_COMMIT || '').slice(0, 12) || null;
  let queue = null;
  if (checks.database.status !== 'unavailable') {
    try {
      const r = (await store.pool.query("SELECT (SELECT MIN(created) FROM ryo_purchases WHERE scope=$1 AND status='pending') AS p,(SELECT MIN(created) FROM ryo_withdrawals WHERE scope=$1 AND status='pending') AS w", [store.scope])).rows[0];
      const oldest = [num(r.p), num(r.w)].filter(x => x !== null);
      queue = { oldestPendingMinutes: oldest.length ? Math.floor((now - Math.min(...oldest)) / 60000) : null };
    } catch {}
  }
  return envelope(store, {
    api: { status: 'ok', serverTime: now },
    ...checks,
    build: { network: networkInfo(), commit, archiveSha256: integrity?.archiveSha256 ? String(integrity.archiveSha256).slice(0, 16) : null },
    release, launchGates: gates, queue,
    notes: ['Launch gates and release stage are set in the hosting environment and cannot be changed here.'],
  });
}

/* ---------- Player lookup (read-only) ---------- */
async function playerLookup(ctx, roles, body) {
  const { store } = ctx, now = store.now(), query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) fail('Enter a wallet address or chat name.');
  const shown = w => (can(roles, 'player.wallet') ? w : short(w));
  if (!isAddress(query)) {
    if ([...query].length < 2 || [...query].length > 14) fail('Search by a full wallet address, or 2-14 characters of a chat name.');
    const like = '%' + query.replace(/[\\%_]/g, m => '\\' + m) + '%';
    const rows = (await store.pool.query("SELECT DISTINCT ON (wallet) wallet,name,created FROM ryo_chat WHERE scope=$1 AND channel='global' AND lower(name) LIKE lower($2) ESCAPE '\\' ORDER BY wallet,id DESC LIMIT 20", [store.scope, like])).rows;
    return envelope(store, { kind: 'matches', matches: rows.map(r => ({ wallet: shown(r.wallet), name: r.name, lastMessage: num(r.created) })), source: 'Recent Global chat names only (chat keeps the newest messages). Referral code and NFT serial search are not implemented.' });
  }
  const w = query, one = async (sql, args = []) => (await store.pool.query(sql, [store.scope, w, ...args])).rows[0];
  const profile = await one('SELECT data FROM ryo_profiles WHERE scope=$1 AND wallet=$2');
  const account = await one('SELECT balance FROM ryo_accounts WHERE scope=$1 AND wallet=$2');
  const name = await one("SELECT name,created FROM ryo_chat WHERE scope=$1 AND wallet=$2 AND channel='global' ORDER BY id DESC LIMIT 1");
  const seen = await one('SELECT MAX(last_seen) AS t FROM ryo_presence WHERE scope=$1 AND wallet=$2');
  const status = await one('SELECT version,muted_until,banned,warnings,updated FROM ryo_cc_chat_status WHERE scope=$1 AND wallet=$2');
  const reports = await one("SELECT COUNT(*) FILTER(WHERE target_wallet=$2) AS against,COUNT(*) FILTER(WHERE target_wallet=$2 AND status='open') AS open,COUNT(*) FILTER(WHERE reporter=$2) AS filed FROM ryo_cc_chat_reports WHERE scope=$1 AND (target_wallet=$2 OR reporter=$2)");
  const staff = await rolesOf(store, store.pool, w);
  const data = {
    kind: 'player', wallet: shown(w), found: !!(profile || account || name),
    identity: { chatName: name?.name || null, hasProfile: !!profile, onlineNow: num(seen?.t) !== null && num(seen.t) > now - 90000, staffRoles: staff },
    chat: { version: status ? Number(status.version) : 0, mutedUntil: status && Number(status.muted_until) > now ? Number(status.muted_until) : null, banned: !!status?.banned, warnings: status ? Number(status.warnings) : 0, reportsAgainst: num(reports.against), openReportsAgainst: num(reports.open), reportsFiled: num(reports.filed) },
  };
  if (can(roles, 'moderation.read')) data.moderation = (await store.pool.query('SELECT id,actor,role,decision,message_id,duration_ms,reason_code,reason,created FROM ryo_cc_chat_actions WHERE scope=$1 AND target_wallet=$2 ORDER BY id DESC LIMIT 20', [store.scope, w])).rows.map(r => ({ id: Number(r.id), actor: r.actor, role: r.role, decision: r.decision, messageId: num(r.message_id), durationMs: num(r.duration_ms), reasonCode: r.reason_code, reason: r.reason, created: Number(r.created) }));
  if (can(roles, 'player.heroes')) {
    const heroes = Array.isArray(profile?.data?.heroes) ? profile.data.heroes : [];
    const byRank = {}; for (const h of heroes) { const k = String(h?.rank ?? 'unknown'); byRank[k] = (byRank[k] || 0) + 1; }
    data.heroes = { total: heroes.length, byRank, source: 'ryo_profiles (game entitlements, not NFTs)' };
  }
  if (can(roles, 'player.economy')) {
    const adv = await one('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2');
    const pend = await one("SELECT (SELECT COUNT(*) FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending') AS purchases,(SELECT COUNT(*) FROM ryo_withdrawals WHERE scope=$1 AND wallet=$2 AND status='pending') AS withdrawals");
    data.economy = { ryoBalance: num(account?.balance), chestPending: adv ? Math.floor(Number(adv.data?.pending || 0) / 1000) : null, chestClaimed: adv ? Number(adv.data?.claimed || 0) : null, pendingPurchases: num(pend.purchases), pendingWithdrawals: num(pend.withdrawals), source: 'Game ledger (read-only). Balances cannot be changed from the Command Center.' };
  }
  if (can(roles, 'player.transactions')) {
    const purchases = (await store.pool.query('SELECT request_id,product,status,amount,signature,created,settled_at FROM ryo_purchases WHERE scope=$1 AND wallet=$2 ORDER BY created DESC LIMIT 10', [store.scope, w])).rows;
    const withdrawals = (await store.pool.query('SELECT request_id,status,amount,signature,created,settled_at FROM ryo_withdrawals WHERE scope=$1 AND wallet=$2 ORDER BY created DESC LIMIT 10', [store.scope, w])).rows;
    const tx = (r, kind) => ({ kind, requestId: r.request_id, product: r.product || null, status: r.status, amount: Number(r.amount), signature: r.signature, created: Number(r.created), settled: num(r.settled_at) });
    data.transactions = [...purchases.map(r => tx(r, 'purchase')), ...withdrawals.map(r => tx(r, 'withdrawal'))].sort((a, b) => b.created - a.created);
  }
  return envelope(store, data);
}

/* ---------- Chat moderation ---------- */
const CATEGORIES = ['spam', 'scam', 'harassment', 'impersonation', 'offensive', 'other'];
const WARN_TEXT = { spam: 'spam', scam: 'scam or phishing messages', harassment: 'harassment', impersonation: 'impersonation', offensive: 'offensive language', other: 'breaking the chat rules' };
const MUTE_MINUTES = [5, 30, 60, 1440, 10080];
const DECISIONS = ['warn', 'hide', 'unhide', 'mute', 'unmute', 'ban', 'unban'];
const EVIDENCE_RETENTION_MS = 90 * 86400000;   // owner decision pending; see the Phase 1 review
async function chatFeed(ctx, body) {
  const { store } = ctx, ch = body.channel === 'system' ? 'system' : 'global', before = cursorIn(body.cursor), n = limit(body.limit);
  const rows = (await store.pool.query("SELECT c.id,c.channel,c.wallet,c.name,c.text,c.created,c.hidden,(SELECT COUNT(*) FROM ryo_cc_chat_reports r WHERE r.scope=c.scope AND r.message_id=c.id AND r.status='open') AS open_reports FROM ryo_chat c WHERE c.scope=$1 AND c.channel=$2 AND c.id<$3 ORDER BY c.id DESC LIMIT $4", [store.scope, ch, before, n])).rows;
  return envelope(store, { channel: ch, messages: rows.map(r => ({ id: Number(r.id), wallet: r.wallet, name: r.name, text: r.text, created: Number(r.created), hidden: num(r.hidden), openReports: Number(r.open_reports) })) }, { nextCursor: rows.length === n ? cursorOut(rows.at(-1).id) : null });
}
async function reportQueue(ctx, body) {
  const { store } = ctx, status = ['open', 'actioned', 'dismissed'].includes(body.status) ? body.status : 'open', before = cursorIn(body.cursor), n = limit(body.limit);
  const rows = (await store.pool.query('SELECT r.*,c.hidden AS message_hidden,(c.id IS NOT NULL) AS message_stored,(SELECT COUNT(*) FROM ryo_cc_chat_reports d WHERE d.scope=r.scope AND d.message_id=r.message_id) AS total_for_message FROM ryo_cc_chat_reports r LEFT JOIN ryo_chat c ON c.scope=r.scope AND c.id=r.message_id WHERE r.scope=$1 AND r.status=$2 AND r.id<$3 ORDER BY r.id DESC LIMIT $4', [store.scope, status, before, n])).rows;
  return envelope(store, {
    status, reports: rows.map(r => ({ id: Number(r.id), messageId: Number(r.message_id), reporter: r.reporter, category: r.category, details: r.details, targetWallet: r.target_wallet, snapshot: { name: r.snapshot_name, text: r.snapshot_text, created: Number(r.message_created) }, message: { stored: r.message_stored, hidden: num(r.message_hidden) }, reportsForMessage: Number(r.total_for_message), status: r.status, created: Number(r.created), resolved: num(r.resolved), resolvedBy: r.resolved_by, resolution: r.resolution })),
    retentionDays: EVIDENCE_RETENTION_MS / 86400000,
  }, { nextCursor: rows.length === n ? cursorOut(rows.at(-1).id) : null });
}
async function sanctions(ctx) {
  const { store } = ctx, now = store.now();
  const rows = (await store.pool.query('SELECT wallet,version,muted_until,banned,warnings,actor,updated FROM ryo_cc_chat_status WHERE scope=$1 AND (banned OR muted_until>$2) ORDER BY updated DESC LIMIT 100', [store.scope, now])).rows;
  return envelope(store, { sanctions: rows.map(r => ({ wallet: r.wallet, version: Number(r.version), mutedUntil: Number(r.muted_until) > now ? Number(r.muted_until) : null, banned: r.banned, warnings: Number(r.warnings), actor: r.actor, updated: Number(r.updated) })) });
}
// Evidence older than the retention period is redacted (the decision record itself stays).
async function expireEvidence(store, c, now) {
  const cutoff = now - EVIDENCE_RETENTION_MS;
  await c.query("UPDATE ryo_cc_chat_reports SET snapshot_text='[evidence expired]',details=NULL WHERE scope=$1 AND status<>'open' AND created<$2 AND snapshot_text<>'[evidence expired]'", [store.scope, cutoff]);
  await c.query("UPDATE ryo_cc_chat_actions SET evidence_text='[evidence expired]' WHERE scope=$1 AND created<$2 AND evidence_text IS NOT NULL AND evidence_text<>'[evidence expired]'", [store.scope, cutoff]);
}
async function moderate(ctx, wallet, body) {
  const decision = DECISIONS.includes(body.decision) ? body.decision : fail('Choose a moderation decision.');
  const code = CATEGORIES.includes(body.reasonCode) ? body.reasonCode : fail('Choose a reason category.');
  const why = reason(body.reason);
  const messageId = body.messageId === undefined || body.messageId === null ? null : (Number.isSafeInteger(body.messageId) && body.messageId > 0 ? body.messageId : fail('Invalid message ID.'));
  const reportId = body.reportId === undefined || body.reportId === null ? null : (Number.isSafeInteger(body.reportId) && body.reportId > 0 ? body.reportId : fail('Invalid report ID.'));
  if (['hide', 'unhide'].includes(decision) && !messageId) fail('Choose the message to ' + decision + '.');
  const minutes = decision === 'mute' ? (MUTE_MINUTES.includes(body.durationMinutes) ? body.durationMinutes : fail('Choose a mute duration: 5m, 30m, 1h, 24h or 7d.')) : null;
  const expected = ['hide', 'unhide'].includes(decision) ? null : version(body.expectedVersion);
  return write(ctx, wallet, 'cc-chat-moderate', body, 'moderation.write', async (c, { role, now }) => {
    const { store } = ctx;
    let message = null;
    if (messageId) {
      message = (await c.query('SELECT id,channel,wallet,name,text,hidden,ref FROM ryo_chat WHERE scope=$1 AND id=$2', [store.scope, messageId])).rows[0];
      if (!message) fail('That message is no longer stored (chat keeps only the newest messages). Use the report snapshot and act on the wallet instead.', 404);
      // Official announcements are shown or withdrawn only through the two-person Announcements review.
      if (String(message.ref || '').startsWith('announcement:')) fail('Official announcements are published and unpublished from Announcements.', 409);
    }
    const target = message ? message.wallet : address(body.targetWallet);
    if (body.targetWallet !== undefined && message && body.targetWallet !== message.wallet) fail('The message was not sent by that wallet.', 409);
    if (target === wallet) fail('You cannot moderate your own wallet or messages.', 403);
    const isSystem = message?.channel === 'system';
    if (!isSystem) {
      if ((await rolesOf(store, c, target)).length) fail('Staff wallets cannot be moderated here. Remove the staff role first.', 403);
      // Same row lock as chat-send: an in-flight send either commits before this decision or sees it.
      await c.query('SELECT 1 FROM ryo_accounts WHERE scope=$1 AND wallet=$2 FOR UPDATE', [store.scope, target]);
    } else if (!['hide', 'unhide'].includes(decision)) fail('System announcements can only be hidden or restored.', 409);
    let report = null;
    if (reportId) {
      report = (await c.query('SELECT id,message_id,target_wallet,status FROM ryo_cc_chat_reports WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, reportId])).rows[0];
      if (!report || report.status !== 'open') fail('That report is unavailable or already resolved.', 409);
      if (report.target_wallet !== target || (messageId && Number(report.message_id) !== messageId)) fail('That report is about a different message or wallet.', 409);
    }
    // System announcements have no player standing; their hide/restore only changes visibility.
    if (!isSystem) await c.query('INSERT INTO ryo_cc_chat_status(scope,wallet,updated) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [store.scope, target, now]);
    const st = isSystem ? { version: 0, muted_until: 0, banned: false, warnings: 0, last_warning: null, last_warning_at: null }
      : (await c.query('SELECT * FROM ryo_cc_chat_status WHERE scope=$1 AND wallet=$2 FOR UPDATE', [store.scope, target])).rows[0];
    if (expected !== null && expected !== Number(st.version)) fail('This player\'s chat standing changed. Refresh and review it again.', 409);
    const next = { muted_until: Number(st.muted_until), banned: st.banned, warnings: Number(st.warnings), last_warning: st.last_warning, last_warning_at: num(st.last_warning_at) };
    if (decision === 'hide') {
      if (message.hidden !== null) fail('That message is already hidden.', 409);
      await c.query('UPDATE ryo_chat SET hidden=$3 WHERE scope=$1 AND id=$2', [store.scope, messageId, now]);
      await c.query("UPDATE ryo_cc_chat_reports SET status='actioned',resolved=$3,resolved_by=$4,resolution='hidden' WHERE scope=$1 AND message_id=$2 AND status='open'", [store.scope, messageId, now, wallet]);
    } else if (decision === 'unhide') {
      if (message.hidden === null) fail('That message is not hidden.', 409);
      await c.query('UPDATE ryo_chat SET hidden=NULL WHERE scope=$1 AND id=$2', [store.scope, messageId]);
    } else if (decision === 'warn') { next.warnings += 1; next.last_warning = 'A moderator warned you about ' + WARN_TEXT[code] + '. Repeated problems can lead to a mute or ban.'; next.last_warning_at = now; }
    else if (decision === 'mute') next.muted_until = now + minutes * 60000;
    else if (decision === 'unmute') { if (next.muted_until <= now) fail('This player is not muted.', 409); next.muted_until = 0; }
    else if (decision === 'ban') { if (next.banned) fail('This player is already banned from chat.', 409); next.banned = true; }
    else if (decision === 'unban') { if (!next.banned) fail('This player is not banned from chat.', 409); next.banned = false; }
    const changesStanding = !['hide', 'unhide'].includes(decision);
    let newVersion = Number(st.version);
    if (changesStanding) {
      newVersion += 1;
      await c.query('UPDATE ryo_cc_chat_status SET version=$3,muted_until=$4,banned=$5,warnings=$6,last_warning=$7,last_warning_at=$8,actor=$9,updated=$10 WHERE scope=$1 AND wallet=$2', [store.scope, target, newVersion, next.muted_until, next.banned, next.warnings, next.last_warning, next.last_warning_at, wallet, now]);
    }
    if (report && report.status === 'open') await c.query("UPDATE ryo_cc_chat_reports SET status='actioned',resolved=$3,resolved_by=$4,resolution=$5 WHERE scope=$1 AND id=$2 AND status='open'", [store.scope, reportId, now, wallet, decision]);
    const actionRow = (await c.query('INSERT INTO ryo_cc_chat_actions(scope,actor,role,decision,target_wallet,message_id,report_id,duration_ms,reason_code,reason,evidence_name,evidence_text,request_id,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id', [store.scope, wallet, role, decision, target, messageId, reportId, minutes ? minutes * 60000 : null, code, why, message?.name || null, message?.text || null, body.requestId, now])).rows[0];
    await expireEvidence(store, c, now);
    return {
      result: { actionId: Number(actionRow.id), decision, targetWallet: target, messageId, standing: { version: newVersion, mutedUntil: next.muted_until > now ? next.muted_until : null, banned: next.banned, warnings: next.warnings } },
      audit: 'chat.' + decision,
      // Message text is kept out of the audit chain; its hash links the record to the restricted evidence.
      data: { target, messageId, reportId, reasonCode: code, reason: why, durationMinutes: minutes, evidenceSha256: message ? sha(message.text) : null, versionBefore: Number(st.version), versionAfter: newVersion },
    };
  });
}
async function resolveReport(ctx, wallet, body) {
  const id = Number.isSafeInteger(body.reportId) && body.reportId > 0 ? body.reportId : fail('Choose a report.'), why = reason(body.reason);
  if (body.resolution !== 'dismiss') fail('Reports are dismissed here; use a moderation decision to act on them.');
  return write(ctx, wallet, 'cc-report-resolve', body, 'reports.resolve', async (c, { now }) => {
    const { store } = ctx;
    const r = (await c.query('SELECT id,status,target_wallet,message_id FROM ryo_cc_chat_reports WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, id])).rows[0];
    if (!r || r.status !== 'open') fail('That report is unavailable or already resolved.', 409);
    await c.query("UPDATE ryo_cc_chat_reports SET status='dismissed',resolved=$3,resolved_by=$4,resolution=$5 WHERE scope=$1 AND id=$2", [store.scope, id, now, wallet, 'dismissed: ' + why]);
    await expireEvidence(store, c, now);
    return { result: { reportId: id, status: 'dismissed' }, audit: 'report.dismissed', data: { reportId: id, target: r.target_wallet, messageId: Number(r.message_id), reason: why } };
  });
}

/* ---------- Official System announcements (two-person: propose, then review by another wallet) ---------- */
const ANNOUNCEMENT_TTL_MS = 7 * 86400000, OFFICIAL = 'command-center';
function announcementText(value, label, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  try { return require('./chat.cjs').clean(value); } catch (e) { fail(label + ': ' + e.message); }
}
const publicAnnouncement = r => ({ id: Number(r.id), textEn: r.text_en, textPt: r.text_pt, status: r.status, version: Number(r.version), proposer: r.proposer, reason: r.reason, created: Number(r.created), reviewer: r.reviewer, reviewReason: r.review_reason, reviewed: num(r.reviewed), unpublishedBy: r.unpublished_by, unpublished: num(r.unpublished), expires: r.status === 'pending' ? Number(r.created) + ANNOUNCEMENT_TTL_MS : null });
async function announcements(ctx) {
  const { store } = ctx;
  const rows = (await store.pool.query('SELECT * FROM ryo_cc_announcements WHERE scope=$1 ORDER BY id DESC LIMIT 50', [store.scope])).rows;
  return envelope(store, { announcements: rows.map(publicAnnouncement), ttlDays: ANNOUNCEMENT_TTL_MS / 86400000 });
}
async function proposeAnnouncement(ctx, wallet, body) {
  const en = announcementText(body.textEn, 'English text'), pt = announcementText(body.textPt, 'Portuguese text', true), why = reason(body.reason);
  return write(ctx, wallet, 'cc-announce-propose', body, 'announcement.propose', async (c, { now }) => {
    const { store } = ctx;
    const pendingCount = Number((await c.query("SELECT COUNT(*) AS n FROM ryo_cc_announcements WHERE scope=$1 AND status='pending'", [store.scope])).rows[0].n);
    if (pendingCount >= 20) fail('Twenty announcements are already waiting for review.', 429);
    const row = (await c.query('INSERT INTO ryo_cc_announcements(scope,text_en,text_pt,proposer,reason,created) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [store.scope, en, pt, wallet, why, now])).rows[0];
    return { result: { id: Number(row.id), status: 'pending' }, audit: 'announcement.proposed', data: { id: Number(row.id), textEn: en, textPt: pt, reason: why } };
  });
}
async function reviewAnnouncement(ctx, wallet, body) {
  const id = Number.isSafeInteger(body.id) && body.id > 0 ? body.id : fail('Choose an announcement.');
  if (typeof body.approve !== 'boolean') fail('Choose approve or reject.');
  const expected = version(body.expectedVersion), why = reason(body.reason);
  return write(ctx, wallet, 'cc-announce-review', body, 'announcement.review', async (c, { now }) => {
    const { store } = ctx;
    const a = (await c.query('SELECT * FROM ryo_cc_announcements WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, id])).rows[0];
    if (!a || a.status !== 'pending') fail('That announcement is unavailable or already reviewed.', 409);
    if (a.proposer === wallet) fail('A different authorized wallet must review this announcement.', 403);
    if (Number(a.version) !== expected) fail('This announcement changed. Refresh before reviewing.', 409);
    if (now - Number(a.created) > ANNOUNCEMENT_TTL_MS) fail('This announcement expired. Propose it again.', 409);
    const status = body.approve ? 'published' : 'rejected', published = [];
    if (body.approve) {
      for (const [lang, text] of [['en', a.text_en], ['pt', a.text_pt]]) {
        if (!text) continue;
        const r = (await c.query("INSERT INTO ryo_chat(scope,channel,wallet,name,text,created,ref) VALUES($1,'system',$2,'System',$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id", [store.scope, OFFICIAL, '📢 ' + text, now, 'announcement:' + id + ':' + lang])).rows[0];
        if (r) published.push(Number(r.id));
      }
      await require('./chat.cjs').prune(store, c, 'system');
    }
    await c.query('UPDATE ryo_cc_announcements SET status=$3,version=version+1,reviewer=$4,review_reason=$5,reviewed=$6 WHERE scope=$1 AND id=$2', [store.scope, id, status, wallet, why, now]);
    return { result: { id, status, messageIds: published }, audit: 'announcement.' + status, data: { id, proposer: a.proposer, reason: why, messageIds: published, versionBefore: expected, versionAfter: expected + 1 } };
  });
}
async function unpublishAnnouncement(ctx, wallet, body) {
  const id = Number.isSafeInteger(body.id) && body.id > 0 ? body.id : fail('Choose an announcement.');
  const expected = version(body.expectedVersion), why = reason(body.reason);
  return write(ctx, wallet, 'cc-announce-unpublish', body, 'announcement.review', async (c, { now }) => {
    const { store } = ctx;
    const a = (await c.query('SELECT * FROM ryo_cc_announcements WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, id])).rows[0];
    if (!a || a.status !== 'published') fail('Only a published announcement can be unpublished.', 409);
    if (Number(a.version) !== expected) fail('This announcement changed. Refresh before unpublishing.', 409);
    const hidden = (await c.query("UPDATE ryo_chat SET hidden=$3 WHERE scope=$1 AND channel='system' AND ref=ANY($2) AND hidden IS NULL RETURNING id", [store.scope, ['announcement:' + id + ':en', 'announcement:' + id + ':pt'], now])).rows.map(r => Number(r.id));
    await c.query("UPDATE ryo_cc_announcements SET status='unpublished',version=version+1,unpublished_by=$3,unpublished=$4 WHERE scope=$1 AND id=$2", [store.scope, id, wallet, now]);
    return { result: { id, status: 'unpublished', hiddenMessageIds: hidden }, audit: 'announcement.unpublished', data: { id, reason: why, hiddenMessageIds: hidden, versionBefore: expected, versionAfter: expected + 1 } };
  });
}

/* ---------- Audit log (the existing economic-dashboard hash chain) ---------- */
async function auditLog(ctx, wallet, roles, body) {
  const { store } = ctx, { digest } = require('./economic-dashboard.cjs'), before = cursorIn(body.cursor), n = limit(body.limit);
  const own = !can(roles, 'audit.read');
  // `prefix`, not `action`: the request's own `action` field names the API call.
  const prefix = typeof body.prefix === 'string' && /^[a-z.]{1,40}$/.test(body.prefix) ? body.prefix : null;
  const actor = body.actor ? address(body.actor) : null;
  const args = [store.scope, before, n], where = ['scope=$1', 'sequence<$2'];
  if (own) { args.push(wallet); where.push('actor=$' + args.length, "action LIKE 'cc.%'"); }
  if (prefix) { args.push(prefix.replace(/[\\%_]/g, m => '\\' + m) + '%'); where.push('action LIKE $' + args.length + " ESCAPE '\\'"); }
  if (actor) { args.push(actor); where.push('actor=$' + args.length); }
  const rows = (await store.pool.query('SELECT sequence,actor,action,data,created,previous,hash FROM ryo_admin_audit WHERE ' + where.join(' AND ') + ' ORDER BY sequence DESC LIMIT $3', args)).rows;
  const entries = rows.map((r, i) => {
    const record = { sequence: Number(r.sequence), actor: r.actor, action: r.action, data: r.data, created: Number(r.created), previous: r.previous };
    const next = rows[i + 1], linked = next && Number(next.sequence) === record.sequence - 1 ? next.hash === r.previous : null;
    return { ...record, hash: r.hash, hashValid: digest(record) === r.hash, linked };
  });
  return envelope(store, { entries, scopeLimited: own ? 'Your own Command Center actions only.' : null }, { nextCursor: rows.length === n ? cursorOut(rows.at(-1).sequence) : null });
}

/* ---------- Staff roles (Owner grants Moderator / Support only) ---------- */
async function ccControl(store, c, lock = false) {
  await c.query('INSERT INTO ryo_cc_control(scope,installed) VALUES($1,$2) ON CONFLICT DO NOTHING', [store.scope, store.now()]);
  return (await c.query('SELECT roles_version FROM ryo_cc_control WHERE scope=$1' + (lock ? ' FOR UPDATE' : ''), [store.scope])).rows[0];
}
async function roleList(ctx) {
  const { store } = ctx, ctl = await ccControl(store, store.pool);
  const grants = (await store.pool.query('SELECT wallet,role,granted_by,reason,created,revoked,revoked_by FROM ryo_cc_roles WHERE scope=$1 ORDER BY created DESC LIMIT 200', [store.scope])).rows;
  const env = Object.fromEntries(Object.entries(ENV_ROLES).map(([role, name]) => [role, envList(name)]));
  return envelope(store, { rolesVersion: Number(ctl.roles_version), environment: env, grants: grants.map(g => ({ wallet: g.wallet, role: g.role, grantedBy: g.granted_by, reason: g.reason, created: Number(g.created), revoked: num(g.revoked), revokedBy: g.revoked_by })), note: 'Owner, Financial Approver, Game Operator and Viewer are set in the hosting environment and need a redeploy to change.' });
}
async function changeRole(ctx, wallet, body, grant) {
  const target = address(body.wallet), role = GRANTABLE.includes(body.role) ? body.role : fail('Only the Moderator or Support role can be granted here.'), expected = version(body.expectedVersion), why = reason(body.reason);
  if ([ctx.treasuryAddress, ctx.studioAddress, ctx.revenueAddress].filter(Boolean).includes(target)) fail('Custody, studio and revenue wallets cannot hold staff roles.', 403);
  return write(ctx, wallet, grant ? 'cc-role-grant' : 'cc-role-revoke', body, 'roles.manage', async (c, { now }) => {
    const { store } = ctx, ctl = await ccControl(store, c, true);
    if (Number(ctl.roles_version) !== expected) fail('Staff roles changed. Refresh before changing them.', 409);
    const row = (await c.query('SELECT revoked FROM ryo_cc_roles WHERE scope=$1 AND wallet=$2 AND role=$3 FOR UPDATE', [store.scope, target, role])).rows[0];
    if (grant) {
      if (row && row.revoked === null) fail('This wallet already has that role.', 409);
      await c.query('INSERT INTO ryo_cc_roles(scope,wallet,role,granted_by,reason,created) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(scope,wallet,role) DO UPDATE SET granted_by=$4,reason=$5,created=$6,revoked=NULL,revoked_by=NULL', [store.scope, target, role, wallet, why, now]);
    } else {
      if (!row || row.revoked !== null) fail('This wallet does not have that role.', 409);
      await c.query('UPDATE ryo_cc_roles SET revoked=$4,revoked_by=$5 WHERE scope=$1 AND wallet=$2 AND role=$3', [store.scope, target, role, now, wallet]);
    }
    await c.query('UPDATE ryo_cc_control SET roles_version=roles_version+1 WHERE scope=$1', [store.scope]);
    return { result: { wallet: target, role, active: grant, rolesVersion: expected + 1 }, audit: 'role.' + (grant ? 'granted' : 'revoked'), data: { target, role, reason: why, versionBefore: expected, versionAfter: expected + 1 } };
  });
}

/* ---------- Incident register (Security center) ----------
 * A staff notebook: title, severity, status and notes. It changes nothing in the game and moves nothing. Every change is an
 * audited staff write (write(): row lock, idempotency, 30 per minute, hash-chained cc.incident.* record). */
const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'], INCIDENT_OPEN_CAP = 50;
function staffText(value, label, min, max, multiline = false) {
  // Control and bidi-override characters become spaces. Multi-line text keeps its line breaks (at most one blank line in a row).
  const bad = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, text = String(value ?? '').replace(/\r\n?/g, '\n').replace(bad, ' ');
  const v = multiline ? text.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim() : text.replace(/\s+/g, ' ').trim();
  if ([...v].length < min || [...v].length > max) fail(label + ' must be ' + min + ' to ' + max + ' characters.');
  return v;
}
async function incidents(ctx, body) {
  const { store } = ctx, status = ['open', 'investigating', 'resolved'].includes(body.status) ? body.status : null;
  const rows = (await store.pool.query('SELECT id,title,details,severity,status,version,opener,reason,created,updated,updated_by,resolution FROM ryo_cc_incidents WHERE scope=$1' + (status ? ' AND status=$2' : '') + " ORDER BY (status='resolved'), id DESC LIMIT 100", status ? [store.scope, status] : [store.scope])).rows;
  return envelope(store, { incidents: rows.map(r => ({ id: Number(r.id), title: r.title, details: r.details, severity: r.severity, status: r.status, version: Number(r.version), openedBy: short(r.opener), reason: r.reason, created: num(r.created), updated: num(r.updated), updatedBy: short(r.updated_by), resolution: r.resolution })) });
}
async function openIncident(ctx, wallet, body) {
  const title = staffText(body.title, 'The title', 3, 120), details = body.details ? staffText(body.details, 'The details', 1, 2000, true) : '', why = reason(body.reason);
  if (!INCIDENT_SEVERITIES.includes(body.severity)) fail('Choose a severity: ' + INCIDENT_SEVERITIES.join(', ') + '.');
  return write(ctx, wallet, 'cc-incident-open', body, 'security.manage', async (c, { now }) => {
    const { store } = ctx;
    if (Number((await c.query("SELECT COUNT(*) AS n FROM ryo_cc_incidents WHERE scope=$1 AND status<>'resolved'", [store.scope])).rows[0].n) >= INCIDENT_OPEN_CAP) fail('Fifty incidents are already open. Resolve some first.', 429);
    const row = (await c.query('INSERT INTO ryo_cc_incidents(scope,title,details,severity,opener,reason,created,updated,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$5) RETURNING id', [store.scope, title, details, body.severity, wallet, why, now])).rows[0];
    return { result: { id: Number(row.id), status: 'open', version: 0 }, audit: 'incident.opened', data: { id: Number(row.id), title, severity: body.severity, reason: why } };
  });
}
async function updateIncident(ctx, wallet, body) {
  const id = Number.isSafeInteger(body.id) && body.id > 0 ? body.id : fail('Choose an incident.'), expected = version(body.expectedVersion), why = reason(body.reason);
  if (!['investigating', 'resolved'].includes(body.status)) fail('Choose investigating or resolved.');
  return write(ctx, wallet, 'cc-incident-update', body, 'security.manage', async (c, { now }) => {
    const { store } = ctx, row = (await c.query('SELECT status,version FROM ryo_cc_incidents WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, id])).rows[0];
    if (!row) fail('That incident does not exist.', 404);
    if (row.status === 'resolved') fail('A resolved incident is closed. Open a new one instead.', 409);
    if (row.status === body.status) fail('The incident is already ' + row.status + '.', 409);
    if (Number(row.version) !== expected) fail('This incident changed since you opened it. Refresh and try again.', 409);
    await c.query('UPDATE ryo_cc_incidents SET status=$3,version=version+1,updated=$4,updated_by=$5,resolution=$6 WHERE scope=$1 AND id=$2', [store.scope, id, body.status, now, wallet, body.status === 'resolved' ? why : null]);
    return { result: { id, status: body.status, version: expected + 1 }, audit: 'incident.' + body.status, data: { id, from: row.status, to: body.status, reason: why } };
  });
}

/* ---------- Support tickets: staff writes (support/server.cjs holds the rules) ----------
 * reply: a message the player sees (status becomes awaiting_player unless one is chosen); note: internal, never shown to the
 * player; update: status and/or assignment, with a reason. All three run through write() and land on the audit chain as
 * cc.support.*; message text never enters the chain, and neither does a hash of it (a short reply could be confirmed by guessing): only its length. */
async function supportWrite(ctx, wallet, action, body, kind) {
  const S = require('./support.cjs'), id = Number.isSafeInteger(body.id) && body.id > 0 ? body.id : fail('Choose a ticket.');
  const message = kind === 'update' ? null : S.clean(body.message, 'The message', 1, S.LIMITS.bodyMax, true), expected = kind === 'note' ? null : version(body.expectedVersion);
  let status, assign, why = null;
  if (kind === 'update') {
    why = reason(body.reason); status = body.status === undefined ? undefined : S.status(body.status);
    assign = body.assign === undefined ? undefined : ['me', 'none'].includes(body.assign) ? body.assign : fail('Choose me or none.');
    if (status === undefined && assign === undefined) fail('Choose a status or an assignment.');
  } else if (kind === 'reply' && body.status !== undefined) {
    status = S.status(body.status); if (!['investigating', 'awaiting_player', 'resolved'].includes(status)) fail('A reply can leave the ticket investigating, awaiting the player, or resolved.');
  }
  return write(ctx, wallet, action, body, 'support.write', async (c, { now }) => {
    const r = await S.staffChange(c, { scope: ctx.store.scope, wallet, now, id, expected, kind, message, status, assign });
    return { result: r, audit: 'support.' + kind, data: { id, from: r.from, to: r.status, ...(message ? { length: [...message].length } : {}), ...(why ? { reason: why } : {}), ...(assign ? { assign } : {}) } };
  });
}

/* ---------- Events: staff writes (events/server.cjs holds the rules) ----------
 * propose -> a DIFFERENT wallet approves or rejects (never the proposer, whatever ADMIN_SELF_APPROVAL says) -> unpublish. An event is
 * a dated notice with EN (and optional PT-BR) text: it has no reward, audience or eligibility, and nothing here touches balances, Chest,
 * Hero Passes, purchases, withdrawals, wallets or NFTs. Each write runs through write() and lands on the audit chain as cc.event.*,
 * with the title and a SHA-256 of the exact content (the body text itself stays out of the chain). */
const eventId = v => (Number.isSafeInteger(v) && v > 0 ? v : fail('Choose an event.'));
const noRewardsAttested = v => { if (v !== true) fail('Confirm that this event promises no reward.'); };
async function proposeEvent(ctx, wallet, body) {
  const E = require('./events.cjs'), p = E.parse(body), why = reason(body.reason); noRewardsAttested(body.noRewards);
  return write(ctx, wallet, 'cc-event-propose', body, 'event.propose', async (c, { now }) => {
    const r = await E.propose(c, { scope: ctx.store.scope, wallet, now, p, why });
    return { result: { id: r.id, status: 'pending', version: 0, contentSha256: p.sha }, audit: 'event.proposed', data: { id: r.id, kind: p.kind, titleEn: p.titleEn, titlePt: p.titlePt, startsAt: p.startsAt, endsAt: p.endsAt, contentSha256: p.sha, reason: why, noRewardsConfirmed: true } };
  });
}
async function reviewEvent(ctx, wallet, body) {
  const E = require('./events.cjs'), id = eventId(body.id);
  if (typeof body.approve !== 'boolean') fail('Choose approve or reject.');
  const expected = version(body.expectedVersion), why = reason(body.reason);
  if (typeof body.contentSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.contentSha256)) fail('contentSha256 is required. Refresh and try again.');
  if (body.approve) noRewardsAttested(body.noRewards);
  return write(ctx, wallet, 'cc-event-review', body, 'event.review', async (c, { now }) => {
    const r = await E.review(c, { scope: ctx.store.scope, wallet, now, id, approve: body.approve, expected, sha: body.contentSha256, why });
    return { result: { id, status: r.status, version: r.version }, audit: 'event.' + r.status, data: { id, proposer: r.proposer, kind: r.kind, titleEn: r.title, startsAt: r.startsAt, endsAt: r.endsAt, contentSha256: r.sha, reason: why, ...(body.approve ? { noRewardsConfirmed: true } : {}), versionBefore: expected, versionAfter: r.version } };
  });
}
async function unpublishEvent(ctx, wallet, body) {
  const E = require('./events.cjs'), id = eventId(body.id), expected = version(body.expectedVersion), why = reason(body.reason);
  return write(ctx, wallet, 'cc-event-unpublish', body, 'event.review', async (c, { now }) => {
    const r = await E.unpublish(c, { scope: ctx.store.scope, wallet, now, id, expected, why });
    return { result: { id, status: 'unpublished', version: r.version }, audit: 'event.unpublished', data: { id, titleEn: r.title, contentSha256: r.sha, reason: why, versionBefore: expected, versionAfter: r.version } };
  });
}

/* ---------- Stats report (read-only) ----------
 * The same code as tools/launch-stats-report.cjs (copied to stats-report.cjs): one REPEATABLE READ READ ONLY transaction,
 * SELECT only, always rolled back, totals and per-hour/day series without wallets. The game shares a small connection
 * pool, so one report runs at a time per server (a second identical request shares it) and a result is reused for 60 s. */
const STATS_TTL_MS = 60000, STATS_MIN_SINCE = Date.UTC(2026, 0, 1), STATS_HOUR_MAX_MS = 31 * 86400000;
const statsCache = new Map();   // key -> { at, data }
/* Its own short-lived connection where the database URL is configured (the hosted server), so a report never occupies one
 * of the game pool's three connections; elsewhere (tests) a pool client, released with the error so a broken one is dropped. */
async function statsConnection(store) {
  if (process.env.DATABASE_URL) {
    const { Client } = require('pg'), client = new Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 30000, connectionTimeoutMillis: 8000 });
    await client.connect();
    return { client, done: () => client.end().catch(() => {}) };
  }
  const client = await store.pool.connect();
  return { client, done: err => client.release(err) };
}
let statsRunning = null;        // { key, promise }
function statsArgs(store, body) {
  const now = store.now(), since = body.since, until = body.until ?? null, bucket = body.bucket ?? 'hour';
  if (!Number.isSafeInteger(since) || since < STATS_MIN_SINCE) fail('Choose a start time on or after 1 Jan 2026.');
  if (until !== null && (!Number.isSafeInteger(until) || until <= since || until > now + 60000)) fail('The end time must be after the start time and not in the future.');
  if (since >= (until ?? now)) fail('The start time must be in the past.');
  if (bucket !== 'hour' && bucket !== 'day') fail('Group by must be hour or day.');
  if (bucket === 'hour' && (until ?? now) - since > STATS_HOUR_MAX_MS) fail('Hourly grouping covers at most 31 days. Choose Day for a longer range.');
  return { now, since, until, bucket, key: [store.scope, since, until ?? 'now', bucket].join('|') };
}
async function statsReport(ctx, body) {
  const { store } = ctx, a = statsArgs(store, body);
  const hit = statsCache.get(a.key);
  if (hit && a.now - hit.at < STATS_TTL_MS) return { ...hit.data, cached: true };
  if (statsRunning) {
    if (statsRunning.key === a.key) return statsRunning.promise;
    fail('A report is already being generated. Try again in a few seconds.', 429);
  }
  const promise = (async () => {
    const { client, done } = await statsConnection(store);
    let err;
    try { return await require('./stats-report.cjs').run(client, store.scope, { since: a.since, until: a.until ?? a.now + 1, bucket: a.bucket, now: a.now }); }
    catch (e) { err = e; throw e; }
    finally { done(err); }
  })();
  statsRunning = { key: a.key, promise };
  try {
    const data = await promise;
    for (const [k, v] of statsCache) if (a.now - v.at >= STATS_TTL_MS) statsCache.delete(k);
    statsCache.set(a.key, { at: a.now, data });
    return data;
  } finally { statsRunning = null; }
}

/* ---------- Dispatcher ---------- */
async function handle(ctx, wallet, action, body = {}) {
  const { store } = ctx;
  if ([ctx.treasuryAddress, ctx.studioAddress, ctx.revenueAddress].filter(Boolean).includes(wallet)) fail('Custody, studio and revenue wallets cannot use the Command Center.', 403);
  // The one player-facing action in this namespace: any signed-in wallet may read the approved, live or upcoming events (events/server.cjs).
  // It runs before the staff check on purpose and returns only public event text, never a wallet, reason or hash.
  if (action === 'cc-events-upcoming') return require('./events.cjs').playerList(store, body);
  const roles = await rolesOf(store, store.pool, wallet);
  if (!roles.length) fail('This wallet has no Command Center access. Ask the service owner to assign a staff role.', 403);
  switch (action) {
    case 'cc-session': return session(ctx, wallet, roles);
    case 'cc-overview': need(roles, 'overview.read'); return overview(ctx);
    case 'cc-health': need(roles, 'ops.read'); return health(ctx);
    case 'cc-player-lookup': need(roles, 'player.read'); return playerLookup(ctx, roles, body);
    case 'cc-chat-feed': need(roles, 'moderation.read'); return chatFeed(ctx, body);
    case 'cc-chat-reports': need(roles, 'moderation.read'); return reportQueue(ctx, body);
    case 'cc-chat-sanctions': need(roles, 'moderation.read'); return sanctions(ctx);
    case 'cc-chat-moderate': need(roles, 'moderation.write'); return moderate(ctx, wallet, body);
    case 'cc-report-resolve': need(roles, 'reports.resolve'); return resolveReport(ctx, wallet, body);
    case 'cc-announcements': need(roles, 'announcement.read', 'announcement.propose', 'announcement.review'); return announcements(ctx);
    case 'cc-announce-propose': need(roles, 'announcement.propose'); return proposeAnnouncement(ctx, wallet, body);
    case 'cc-announce-review': need(roles, 'announcement.review'); return reviewAnnouncement(ctx, wallet, body);
    case 'cc-announce-unpublish': need(roles, 'announcement.review'); return unpublishAnnouncement(ctx, wallet, body);
    case 'cc-audit': need(roles, 'audit.read', 'audit.own'); return auditLog(ctx, wallet, roles, body);
    case 'cc-roles': need(roles, 'roles.manage'); return roleList(ctx);
    case 'cc-role-grant': need(roles, 'roles.manage'); return changeRole(ctx, wallet, body, true);
    case 'cc-role-revoke': need(roles, 'roles.manage'); return changeRole(ctx, wallet, body, false);
    case 'cc-founders': need(roles, 'founders.read'); return envelope(store, (await require('./founders.cjs').adminOverview(store)).founders);
    // Phase 2, Founder operations: read-only (command-center-founders.cjs never writes, signs or grants anything).
    case 'cc-founder-collections': need(roles, 'founders.read'); return envelope(store, await require('./command-center-founders.cjs').collections(ctx, body));
    case 'cc-founder-lookup': need(roles, 'founders.read'); return envelope(store, await require('./command-center-founders.cjs').lookup(ctx, body));
    case 'cc-founder-integrity': need(roles, 'founders.read'); return envelope(store, await require('./command-center-founders.cjs').integrity(ctx));
    case 'cc-founder-access': need(roles, 'founders.read'); return envelope(store, await require('./command-center-founders.cjs').access(ctx));
    case 'cc-founder-weeks': need(roles, 'founders.read'); return envelope(store, await require('./command-center-founders.cjs').weeks(ctx));
    case 'cc-founders-pause': need(roles, 'founders.manage'); return envelope(store, await require('./founders.cjs').adminPause(store, wallet, body.paused === true, body.reason));
    case 'cc-founders-revoke': need(roles, 'founders.manage'); return envelope(store, await require('./founders.cjs').adminRevoke(store, wallet, body.wallet, body.revoke === true, body.reason));
    case 'cc-stats-report': need(roles, 'stats.read'); return envelope(store, await statsReport(ctx, body));
    // Batch A: read-only views (command-center-views.cjs), and the incident register (the only write).
    case 'cc-config': need(roles, 'config.read'); return envelope(store, await require('./command-center-views.cjs').configStatus(ctx));
    case 'cc-security': need(roles, 'security.read'); return envelope(store, await require('./command-center-views.cjs').securityView(ctx));
    case 'cc-creators': need(roles, 'creators.read'); return envelope(store, await require('./command-center-views.cjs').creatorsView(ctx));
    case 'cc-incidents': need(roles, 'security.read'); return incidents(ctx, body);
    case 'cc-support-list': need(roles, 'support.read'); return envelope(store, await require('./support.cjs').staffList(store, body));
    case 'cc-support-ticket': need(roles, 'support.read'); return envelope(store, await require('./support.cjs').staffView(store, body));
    case 'cc-support-reply': need(roles, 'support.write'); return supportWrite(ctx, wallet, 'cc-support-reply', body, 'reply');
    case 'cc-support-note': need(roles, 'support.write'); return supportWrite(ctx, wallet, 'cc-support-note', body, 'note');
    case 'cc-support-update': need(roles, 'support.write'); return supportWrite(ctx, wallet, 'cc-support-update', body, 'update');
    case 'cc-events': need(roles, 'event.read', 'event.propose', 'event.review'); return envelope(store, await require('./events.cjs').staffList(store, wallet));
    case 'cc-event-propose': need(roles, 'event.propose'); return proposeEvent(ctx, wallet, body);
    case 'cc-event-review': need(roles, 'event.review'); return reviewEvent(ctx, wallet, body);
    case 'cc-event-unpublish': need(roles, 'event.review'); return unpublishEvent(ctx, wallet, body);
    case 'cc-incident-open': need(roles, 'security.manage'); return openIncident(ctx, wallet, body);
    case 'cc-incident-update': need(roles, 'security.manage'); return updateIncident(ctx, wallet, body);
    default: fail('Unknown Command Center action.', 404);
  }
}
module.exports = { handle, rolesOf, permissionsOf, PERMISSIONS, ROLES, MARKER, MUTE_MINUTES, CATEGORIES };
