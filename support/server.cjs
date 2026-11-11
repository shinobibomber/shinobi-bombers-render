'use strict';
/* In-game Support tickets (apply-support.cjs copies this file to app/server/support.cjs). Owner decisions 2026-11-12: players send
 * tickets from the game (Reward Center, Help & Support), a two-way thread with the team, shipped ON behind the Control-panel switch
 * `supportTickets` (feature-switches catalog), ticket text kept 30 days after the ticket is resolved or closed.
 *
 * Player side (service.cjs: support-state / support-submit / support-view / support-reply). The wallet always comes from the
 * signed-in session, never from the request. Every call checks the switch. A ticket and its replies are the player's own text:
 * the client shows them with textContent, and the server never returns a staff wallet or an internal note to a player.
 *   limits        3 new tickets per 24 hours, 5 open at once, 20 replies per 24 hours, 60 messages per ticket, 1000 characters.
 *   order link    an optional request ID or signature, accepted only if it is one of THIS wallet's purchases, deposits or
 *                 withdrawals (anything else is the same 404, so nothing about other players can be learned).
 *   idempotency   the client's requestId makes a repeated submit or reply return the stored result.
 * Staff side (Command Center, command-center/server.cjs, permissions support.read / support.write): list, view, reply, internal
 * notes, status and assignment. Staff can change only a ticket's status, assignee and messages: nothing here touches balances,
 * rewards, withdrawals, wallets or NFTs. Every staff write is audited there (message text never enters the audit chain).
 * Retention: ticket text (subject, order link and every message) is replaced with "[expired]" 30 days after the ticket was
 * resolved or closed. It runs lazily inside the ticket actions (there is no scheduler); open tickets are kept. */
const crypto = require('node:crypto');

const CATEGORIES = ['payment', 'withdrawal', 'hero', 'reward', 'bug', 'account', 'other'];
const STATUSES = ['submitted', 'triaged', 'investigating', 'awaiting_player', 'resolved', 'closed'];
const SETTLED = ['resolved', 'closed'];
const LIMITS = Object.freeze({ subjectMin: 3, subjectMax: 80, bodyMin: 5, bodyMax: 1000, ticketsPerDay: 3, openMax: 5, repliesPerDay: 20, messagesPerTicket: 60 });
const DAY_MS = 86400000, RETENTION_MS = 30 * DAY_MS, EXPIRED = '[expired]';

const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_support_tickets (
 id BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL, wallet TEXT NOT NULL, request_id TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('payment','withdrawal','hero','reward','bug','account','other')),
 subject TEXT NOT NULL, reference TEXT,
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','triaged','investigating','awaiting_player','resolved','closed')),
 version INTEGER NOT NULL DEFAULT 0, assignee TEXT, created BIGINT NOT NULL, updated BIGINT NOT NULL,
 last_player BIGINT NOT NULL, last_staff BIGINT, settled BIGINT, redacted BIGINT,
 UNIQUE(scope,wallet,request_id)
);
CREATE INDEX IF NOT EXISTS ryo_support_tickets_wallet ON ryo_support_tickets(scope,wallet,id);
CREATE INDEX IF NOT EXISTS ryo_support_tickets_queue ON ryo_support_tickets(scope,status,updated);
CREATE INDEX IF NOT EXISTS ryo_support_tickets_due ON ryo_support_tickets(scope,settled) WHERE settled IS NOT NULL AND redacted IS NULL;
CREATE TABLE IF NOT EXISTS ryo_support_messages (
 id BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL, ticket_id BIGINT NOT NULL REFERENCES ryo_support_tickets(id),
 kind TEXT NOT NULL CHECK(kind IN ('player','staff','note')), author TEXT NOT NULL, body TEXT NOT NULL, created BIGINT NOT NULL, request_id TEXT
);
CREATE INDEX IF NOT EXISTS ryo_support_messages_ticket ON ryo_support_messages(ticket_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS ryo_support_messages_request ON ryo_support_messages(scope,author,request_id) WHERE request_id IS NOT NULL;`;

function fail(message, status = 400) { throw Object.assign(Error(message), { status }); }
const switchOn = () => { try { return !!require('./feature-switches.cjs').effective('supportTickets'); } catch { return false; } };
const need = () => { if (!switchOn()) fail('Support tickets are not open right now.', 403); };
const requestId = v => (typeof v === 'string' && /^[-a-zA-Z0-9_]{16,80}$/.test(v) ? v : fail('Invalid request ID.'));
const num = v => (v === null || v === undefined ? null : Number(v));
const whole = v => (Number.isSafeInteger(v) && v > 0 ? v : fail('Choose a ticket.'));
const category = v => (CATEGORIES.includes(v) ? v : fail('Choose a category: ' + CATEGORIES.join(', ') + '.'));
const status = v => (STATUSES.includes(v) ? v : fail('Choose a status: ' + STATUSES.join(', ') + '.'));
/** Serializes one wallet's ticket writes. An advisory lock, so a ticket never creates or locks the wallet's money account row. */
const lockWallet = (c, scope, wallet) => c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['ryo_support:' + scope + ':' + wallet]);
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');

/** Control and bidi-override characters become spaces. Multi-line text keeps its line breaks (never more than one blank line). */
function clean(value, label, min, max, multiline = false) {
  const bad = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, text = String(value ?? '').replace(/\r\n?/g, '\n').replace(bad, ' ');
  const v = multiline ? text.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim() : text.replace(/\s+/g, ' ').trim();
  if ([...v].length < min || [...v].length > max) fail(label + ' must be ' + min + ' to ' + max + ' characters.');
  return v;
}

/* ---------- Order reference (only this wallet's own records) ---------- */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{43,90}$/, REQUEST = /^[-a-zA-Z0-9_]{8,80}$/;
const REFERENCE_SQL = {
  purchase: "SELECT 'purchase' AS kind, request_id AS id, product AS detail, amount, status, created FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND (request_id=$3 OR signature=$3) LIMIT 1",
  deposit: "SELECT 'deposit' AS kind, request_id AS id, NULL::text AS detail, amount, 'confirmed' AS status, created FROM ryo_deposits WHERE scope=$1 AND wallet=$2 AND (request_id=$3 OR signature=$3) LIMIT 1",
  withdrawal: "SELECT 'withdrawal' AS kind, request_id AS id, NULL::text AS detail, amount, status, created FROM ryo_withdrawals WHERE scope=$1 AND wallet=$2 AND (request_id=$3 OR signature=$3) LIMIT 1",
};
async function findReference(db, scope, wallet, ref) {
  if (!BASE58.test(ref) && !REQUEST.test(ref)) fail('That order reference does not look right. Paste the request ID or the transaction signature.');
  for (const sql of Object.values(REFERENCE_SQL)) { const row = (await db.query(sql, [scope, wallet, ref])).rows[0]; if (row) return row; }
  fail('We could not find that order on your account.', 404);
}
async function referenceInfo(db, scope, wallet, stored) {
  const [kind, ...rest] = String(stored || '').split(':'), id = rest.join(':');
  if (!REFERENCE_SQL[kind] || !id) return null;
  const row = (await db.query(REFERENCE_SQL[kind], [scope, wallet, id])).rows[0];
  return row ? { kind: row.kind, id: row.id, detail: row.detail, amount: num(row.amount), status: row.status, created: num(row.created) } : { kind, id, missing: true };
}

/* ---------- Retention ---------- */
/** Replaces the text of tickets settled more than 30 days ago. Idempotent; runs inside the ticket actions. */
async function expire(c, scope, now) {
  // Rows are locked in id order, so two callers redacting at once wait for each other instead of deadlocking.
  const hit = (await c.query('UPDATE ryo_support_tickets SET subject=$3, reference=NULL, redacted=$2 WHERE id IN (SELECT id FROM ryo_support_tickets WHERE scope=$1 AND settled IS NOT NULL AND settled<$4 AND redacted IS NULL ORDER BY id FOR UPDATE) RETURNING id', [scope, now, EXPIRED, now - RETENTION_MS])).rows;
  if (hit.length) await c.query('UPDATE ryo_support_messages SET body=$2 WHERE scope=$1 AND ticket_id = ANY($3::bigint[])', [scope, EXPIRED, hit.map(r => String(r.id))]);
  return hit.length;
}

const ticketOut = r => ({ id: Number(r.id), category: r.category, subject: r.subject, status: r.status, version: Number(r.version), reference: r.reference || null, created: num(r.created), updated: num(r.updated), expired: !!r.redacted });
const TICKET_COLUMNS = 'id,category,subject,status,version,reference,created,updated,redacted,settled';
/** True when a ticket's text is past retention but has not been replaced yet (a refused write rolls its own retention run back). */
const due = (r, now) => !r.redacted && r.settled !== null && r.settled !== undefined && Number(r.settled) < now - RETENTION_MS;
/** Runs a player-side read; if any row is past retention, redacts first and reads again, so a read never shows expired text. */
async function readFresh(store, sql, args) {
  let rows = (await store.pool.query(sql, args)).rows;
  if (rows.some(r => due(r, store.now()))) { await store.transaction(c => expire(c, store.scope, store.now())); rows = (await store.pool.query(sql, args)).rows; }
  return rows;
}

/* ---------- Player actions ---------- */
async function playerState(store, wallet) {
  if (!switchOn()) return { enabled: false, limits: LIMITS, tickets: [] };
  const rows = await readFresh(store, 'SELECT ' + TICKET_COLUMNS + ' FROM ryo_support_tickets WHERE scope=$1 AND wallet=$2 ORDER BY id DESC LIMIT 30', [store.scope, wallet]);
  return { enabled: true, limits: LIMITS, categories: CATEGORIES, tickets: rows.map(ticketOut) };
}
async function submit(store, wallet, body = {}) {
  need();
  const rid = requestId(body.requestId), cat = category(body.category), subject = clean(body.subject, 'The subject', LIMITS.subjectMin, LIMITS.subjectMax);
  const message = clean(body.message, 'The message', LIMITS.bodyMin, LIMITS.bodyMax, true), ref = body.reference ? String(body.reference).trim() : '';
  return store.transaction(async c => {
    await lockWallet(c, store.scope, wallet);   // serializes this wallet's limits
    const now = store.now(), prior = (await c.query('SELECT ' + TICKET_COLUMNS + ' FROM ryo_support_tickets WHERE scope=$1 AND wallet=$2 AND request_id=$3', [store.scope, wallet, rid])).rows[0];
    if (prior) return { ticket: ticketOut(prior), replayed: true };
    await expire(c, store.scope, now);
    const n = (await c.query("SELECT COUNT(*) FILTER (WHERE created>$3) AS day, COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed')) AS open FROM ryo_support_tickets WHERE scope=$1 AND wallet=$2", [store.scope, wallet, now - DAY_MS])).rows[0];
    if (Number(n.day) >= LIMITS.ticketsPerDay) fail('You have already sent ' + LIMITS.ticketsPerDay + ' tickets in the last 24 hours. Please wait before sending another.', 429);
    if (Number(n.open) >= LIMITS.openMax) fail('You already have ' + LIMITS.openMax + ' open tickets. Wait for a reply, or add your details to one of them.', 429);
    let reference = null; if (ref) { const f = await findReference(c, store.scope, wallet, ref); reference = f.kind + ':' + f.id; }
    const t = (await c.query('INSERT INTO ryo_support_tickets(scope,wallet,request_id,category,subject,reference,created,updated,last_player) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$7) RETURNING ' + TICKET_COLUMNS, [store.scope, wallet, rid, cat, subject, reference, now])).rows[0];
    await c.query("INSERT INTO ryo_support_messages(scope,ticket_id,kind,author,body,created) VALUES($1,$2,'player',$3,$4,$5)", [store.scope, t.id, wallet, message, now]);
    return { ticket: ticketOut(t) };
  });
}
/** One of the caller's own tickets with the thread the player may see (player and staff messages; never internal notes or staff wallets). */
async function view(store, wallet, body = {}) {
  need(); const id = whole(body.id);
  const t = (await readFresh(store, 'SELECT ' + TICKET_COLUMNS + ' FROM ryo_support_tickets WHERE scope=$1 AND id=$2 AND wallet=$3', [store.scope, id, wallet]))[0];
  if (!t) fail('That ticket does not exist.', 404);
  const rows = (await store.pool.query("SELECT kind, body, created FROM ryo_support_messages WHERE scope=$1 AND ticket_id=$2 AND kind IN ('player','staff') ORDER BY id LIMIT 200", [store.scope, id])).rows;
  return { ticket: ticketOut(t), messages: rows.map(m => ({ from: m.kind === 'staff' ? 'team' : 'you', text: m.body, created: num(m.created) })) };
}
async function reply(store, wallet, body = {}) {
  need(); const rid = requestId(body.requestId), id = whole(body.id), message = clean(body.message, 'The message', 1, LIMITS.bodyMax, true);
  return store.transaction(async c => {
    await lockWallet(c, store.scope, wallet);
    const now = store.now();
    const dup = (await c.query('SELECT id, ticket_id FROM ryo_support_messages WHERE scope=$1 AND author=$2 AND request_id=$3', [store.scope, wallet, rid])).rows[0];
    if (dup && Number(dup.ticket_id) !== id) fail('This request ID was already used for another message.', 409);
    if (!dup) await expire(c, store.scope, now);   // before the ticket is read, so a ticket that expires right now is refused below
    const t = (await c.query('SELECT ' + TICKET_COLUMNS + ' FROM ryo_support_tickets WHERE scope=$1 AND id=$2 AND wallet=$3 FOR UPDATE', [store.scope, id, wallet])).rows[0];
    if (!t) fail('That ticket does not exist.', 404);
    if (dup) return { ticket: ticketOut(t), replayed: true };
    if (t.status === 'closed') fail('This ticket is closed. Please send a new ticket.', 409);
    if (t.redacted) fail('This ticket has expired. Please send a new ticket.', 409);
    const n = (await c.query("SELECT COUNT(*) FILTER (WHERE ticket_id=$3 AND kind<>'note') AS here, COUNT(*) FILTER (WHERE kind='player' AND request_id IS NOT NULL AND created>$4) AS day FROM ryo_support_messages WHERE scope=$1 AND ticket_id IN (SELECT id FROM ryo_support_tickets WHERE scope=$1 AND wallet=$2)", [store.scope, wallet, id, now - DAY_MS])).rows[0];
    if (Number(n.here) >= LIMITS.messagesPerTicket) fail('This ticket has reached its message limit. Please send a new ticket.', 429);
    if (Number(n.day) >= LIMITS.repliesPerDay) fail('You have sent many messages today. Please wait before sending more.', 429);
    await c.query("INSERT INTO ryo_support_messages(scope,ticket_id,kind,author,body,created,request_id) VALUES($1,$2,'player',$3,$4,$5,$6)", [store.scope, id, wallet, message, now, rid]);
    const next = t.status === 'awaiting_player' || t.status === 'resolved' ? 'submitted' : t.status;   // a reply reopens a resolved ticket
    const u = (await c.query('UPDATE ryo_support_tickets SET status=$3, updated=$4, last_player=$4, version=version+1, settled=CASE WHEN $3 IN (\'resolved\',\'closed\') THEN settled ELSE NULL END WHERE scope=$1 AND id=$2 RETURNING ' + TICKET_COLUMNS, [store.scope, id, next, now])).rows[0];
    return { ticket: ticketOut(u) };
  });
}

/* ---------- Staff operations (called by command-center/server.cjs) ---------- */
function optionalWallet(v) { if (v === undefined || v === null || v === '') return null; return typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? v : fail('That does not look like a wallet address.'); }
async function staffList(store, body = {}) {
  const st = body.status === undefined || body.status === 'open' ? 'open' : body.status === 'all' ? 'all' : status(body.status), cat = body.category === undefined ? null : category(body.category), w = optionalWallet(body.wallet);
  await store.transaction(c => expire(c, store.scope, store.now()));
  const args = [store.scope], where = ['t.scope=$1'];
  if (st === 'open') where.push("t.status NOT IN ('resolved','closed')"); else if (st !== 'all') { args.push(st); where.push('t.status=$' + args.length); }
  if (cat) { args.push(cat); where.push('t.category=$' + args.length); }
  if (w) { args.push(w); where.push('t.wallet=$' + args.length); }
  const rows = (await store.pool.query('SELECT t.id,t.wallet,t.category,t.subject,t.status,t.version,t.assignee,t.created,t.updated,t.last_player,t.last_staff,t.redacted,'
    + "(SELECT COUNT(*) FROM ryo_support_messages m WHERE m.ticket_id=t.id AND m.kind<>'note') AS messages FROM ryo_support_tickets t WHERE " + where.join(' AND ') + ' ORDER BY t.updated DESC, t.id DESC LIMIT 51', args)).rows;
  const counts = (await store.pool.query('SELECT status, COUNT(*) AS n FROM ryo_support_tickets WHERE scope=$1 GROUP BY status', [store.scope])).rows;
  return { tickets: rows.slice(0, 50).map(r => ({ id: Number(r.id), wallet: r.wallet, category: r.category, subject: r.subject, status: r.status, version: Number(r.version), assignee: r.assignee, created: num(r.created), updated: num(r.updated),
      waitingOnTeam: num(r.last_player) > (num(r.last_staff) || 0) && !SETTLED.includes(r.status), messages: Number(r.messages), expired: !!r.redacted })),
    more: rows.length > 50, counts: Object.fromEntries(counts.map(c => [c.status, Number(c.n)])), retentionDays: RETENTION_MS / DAY_MS };
}
async function staffView(store, body = {}) {
  const id = whole(body.id);
  await store.transaction(c => expire(c, store.scope, store.now()));
  const t = (await store.pool.query('SELECT * FROM ryo_support_tickets WHERE scope=$1 AND id=$2', [store.scope, id])).rows[0];
  if (!t) fail('That ticket does not exist.', 404);
  const msgs = (await store.pool.query('SELECT kind, author, body, created FROM ryo_support_messages WHERE scope=$1 AND ticket_id=$2 ORDER BY id LIMIT 300', [store.scope, id])).rows;
  return { ticket: { ...ticketOut(t), wallet: t.wallet, assignee: t.assignee, lastPlayer: num(t.last_player), lastStaff: num(t.last_staff), settled: num(t.settled) },
    reference: await referenceInfo(store.pool, store.scope, t.wallet, t.reference),
    messages: msgs.map(m => ({ kind: m.kind, author: m.kind === 'player' ? 'player' : m.author, text: m.body, created: num(m.created) })), retentionDays: RETENTION_MS / DAY_MS };
}
/** One staff change inside the caller's write() transaction. kind: reply | note | update. Returns { id, from, status, version }.
 *  reply and update check the version the staff member saw (a stale page gets 409); a note never changes the version. */
async function staffChange(c, { scope, wallet, now, id, expected, kind, message, status: nextStatus, assign }) {
  const t = (await c.query('SELECT status,version,redacted,settled,assignee FROM ryo_support_tickets WHERE scope=$1 AND id=$2 FOR UPDATE', [scope, id])).rows[0];
  if (!t) fail('That ticket does not exist.', 404);
  if (t.status === 'closed') fail('A closed ticket is final.', 409);
  if (t.redacted || due(t, now)) fail('This ticket has expired and can no longer be changed.', 409);
  if (kind !== 'note' && Number(t.version) !== expected) fail('This ticket changed since you opened it. Refresh and try again.', 409);
  if (kind === 'note') { await c.query("INSERT INTO ryo_support_messages(scope,ticket_id,kind,author,body,created) VALUES($1,$2,'note',$3,$4,$5)", [scope, id, wallet, message, now]); return { id, from: t.status, status: t.status, version: Number(t.version) }; }
  const next = kind === 'reply' ? (nextStatus || 'awaiting_player') : (nextStatus || t.status);
  if (kind === 'update' && next === t.status && assign === undefined) fail('The ticket is already ' + t.status + '.', 409);
  if (kind === 'reply') await c.query("INSERT INTO ryo_support_messages(scope,ticket_id,kind,author,body,created) VALUES($1,$2,'staff',$3,$4,$5)", [scope, id, wallet, message, now]);
  const settled = SETTLED.includes(next) ? (t.settled ? Number(t.settled) : now) : null, assignee = assign === 'me' ? wallet : assign === 'none' ? null : t.assignee;
  await c.query('UPDATE ryo_support_tickets SET status=$3, version=version+1, updated=$4, last_staff=CASE WHEN $5 THEN $4 ELSE last_staff END, settled=$6, assignee=$7 WHERE scope=$1 AND id=$2', [scope, id, next, now, kind === 'reply', settled, assignee]);
  return { id, from: t.status, status: next, version: expected + 1 };
}

module.exports = { SCHEMA, CATEGORIES, STATUSES, LIMITS, RETENTION_MS, EXPIRED, clean, status, sha, expire, playerState, submit, view, reply, staffList, staffView, staffChange };
