'use strict';
/* Command Center Events (apply-events.cjs copies this file to app/server/events.cjs). Owner request 2026-11-12: schedule in-game
 * events with a two-person review, English and Portuguese (PT-BR) text, and NO rewards.
 *
 * What an event is: a dated notice (title, text, kind, UTC start and end). It is information only. It has no reward, prize, audience
 * or eligibility fields, nothing in the game reads it except the player list below, and no code path here touches balances, Chest,
 * Hero Passes, purchases, withdrawals, wallets or NFTs. Anything that gives players something needs its own reviewed design.
 *
 * Flow (staff side is in command-center/server.cjs, always through its write(): row lock, re-checked role, idempotent request ID,
 * 30 writes a minute, hash-chained audit record cc.event.*):
 *   propose  one wallet (Owner, Game Operator or Moderator) submits the event. It waits as `pending`; its text can no longer change.
 *   review   a DIFFERENT wallet (Owner or Game Operator) approves or rejects it. Approving needs the exact version and content hash
 *            the reviewer looked at, and the start time must still be in the future. A proposal expires after 7 days.
 *   publish  an approved event is visible to players from approval until it ends. Its schedule decides upcoming, live or ended.
 *   unpublish  Owner or Game Operator withdraw an approved event that has not ended; the record stays.
 * The proposer can never review their own event, whatever ADMIN_SELF_APPROVAL says (that setting belongs to the economic dashboard).
 *
 * Player read (`cc-events-upcoming`, any signed-in wallet): live and upcoming approved events only, in the requested language
 * (Portuguese falls back to English when the event has no PT text). It never returns a wallet, a reason or a hash.
 * Behind the Control-panel switch `eventsBoard` (default on). Players see text with textContent only; links are refused here. */
const crypto = require('node:crypto');

const KINDS = ['event', 'maintenance', 'boss', 'tournament', 'community'];
const DAY_MS = 86400000, MIN_MS = 60000;
const LIMITS = Object.freeze({
  titleMin: 3, titleMax: 80, bodyMin: 10, bodyMax: 1000,
  minLeadMs: 10 * MIN_MS,            // an event must start at least 10 minutes after it is proposed
  maxAheadMs: 180 * DAY_MS,          // ...and no more than 180 days ahead
  minDurationMs: 5 * MIN_MS, maxDurationMs: 30 * DAY_MS,
  proposalTtlMs: 7 * DAY_MS,         // a proposal nobody reviewed in 7 days can no longer be approved
  pendingMax: 20, approvedMax: 50,   // waiting proposals, and approved events that have not ended
  playerHorizonMs: 60 * DAY_MS, playerMax: 20,
});

const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_cc_events (
 id BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('event','maintenance','boss','tournament','community')),
 title_en TEXT NOT NULL, body_en TEXT NOT NULL, title_pt TEXT, body_pt TEXT,
 starts_at BIGINT NOT NULL, ends_at BIGINT NOT NULL, content_sha256 TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','unpublished')),
 version INTEGER NOT NULL DEFAULT 0, proposer TEXT NOT NULL, reason TEXT NOT NULL, created BIGINT NOT NULL,
 reviewer TEXT, review_reason TEXT, reviewed BIGINT, unpublished_by TEXT, unpublish_reason TEXT, unpublished BIGINT,
 CHECK(ends_at>starts_at), CHECK((title_pt IS NULL) = (body_pt IS NULL))
);
CREATE INDEX IF NOT EXISTS ryo_cc_events_status ON ryo_cc_events(scope,status,starts_at);`;

function fail(message, status = 400) { throw Object.assign(Error(message), { status }); }
const num = v => (v === null || v === undefined ? null : Number(v));
const short = w => (w ? w.slice(0, 4) + '…' + w.slice(-4) : w);
const switchOn = () => { try { return !!require('./feature-switches.cjs').effective('eventsBoard'); } catch { return false; } };

/* ---------- Text rules ---------- */
// Control, bidi-override, zero-width and line/paragraph-separator characters (built from code points so this file holds no invisible characters).
const BAD = new RegExp('[' + [[0, 9], [0x0b, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]].map(([a, b]) => hex(a) + (b > a ? '-' + hex(b) : '')).join('') + ']', 'g');
function hex(c) { return String.fromCharCode(92) + 'u' + c.toString(16).padStart(4, '0'); }
/** Control and bidi-override characters become spaces. Multi-line text keeps its line breaks (never more than one blank line). */
function clean(value, label, min, max, multiline = false) {
  if (typeof value !== 'string') fail(label + ' is required.');
  const text = value.replace(/\r\n?/g, '\n').replace(BAD, ' ');
  const v = multiline ? text.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim() : text.replace(/\s+/g, ' ').trim();
  if ([...v].length < min || [...v].length > max) fail(label + ' must be ' + min + ' to ' + max + ' characters.');
  return v;
}
// Players read events as plain text, so a link could never be clicked; it is refused anyway, because a pasted scam address is still a scam.
const LINK = /(?:\b(?:javascript|data|vbscript|file|ftp|https?|mailto):|:\/\/|\bwww\b|\bdot\s*(?:com|net|org|io|gg|xyz|me|co)\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|[a-z0-9-]+\.(?:com|net|org|io|gg|xyz|fun|app|me|co|link|ly|to|tv|gl|bio|info|site|online|club|dev|sh|cc|ai|ws|top|vip|live|page|store|shop|win|click|gift|be|cn|ru|br|pt|us|uk|eu)\b)/;
// Events carry no rewards. This is a first guard, NOT the control: the reviewer reads the text and confirms it promises nothing.
// The text is folded first (NFKC, accents, invisible marks and Cyrillic look-alikes removed), then checked as words and again with
// every non-letter removed (so "r3ward", "re-ward" and "Prizepool" are caught). A denylist can always be talked around by a human.
const CONFUSABLES = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ѕ': 's', 'ј': 'j', 'ԁ': 'd', 'һ': 'h', 'ո': 'n' };
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
function fold(v) {
  const dots = v.normalize('NFKC').replace(/[。｡․﹒]/g, '.');
  return dots.normalize('NFD').replace(/[\p{Mn}\p{Cf}]/gu, '').toLowerCase().replace(/[а-ѕјԁһո]/g, c => CONFUSABLES[c] || c);
}
const REWARD_WORDS = /\b(?:rewards?|prizes?|airdrops?|giveaways?|raffles?|jackpot|payouts?|ryos?|recompensas?|premios?|sorteios?|brindes?|bonus|free|gratis|gifts?|win|wins|winners?|winning|ganhe|ganhar|earn|earns|loot|drops?|tokens?|coins?|nfts?|chests?|baus?|shards?|hero ?pass(?:es)?)\b|\d(?:ryos?)\b/;
const REWARD_SQUASHED = /(?:reward|prize|airdrop|giveaway|raffle|jackpot|payout|recompensa|premio|sorteio|brinde|bonus)/;
function text(value, label, min, max, multiline) {
  const v = clean(value, label, min, max, multiline);
  if (/[<>]/.test(v)) fail(label + ': plain text only. The characters < and > are not allowed.');
  const f = fold(v), squashed = f.replace(/[0-9@$]/g, c => LEET[c]).replace(/[^a-z]/g, '');
  if (LINK.test(f)) fail(label + ': links are not allowed.');
  if (REWARD_WORDS.test(f) || REWARD_SQUASHED.test(squashed)) fail(label + ': events cannot mention rewards, prizes, giveaways or Ryo. Reword the text. An event that gives players something needs its own reviewed design.');
  return v;
}
const emptyish = v => v === undefined || v === null || v === '';

/** Shape and text validation (no clock). Returns the content that is stored and hashed. English is required; Portuguese is optional
 *  but needs both its title and its text. */
function parse(body = {}) {
  const kind = KINDS.includes(body.kind) ? body.kind : fail('Choose a kind: ' + KINDS.join(', ') + '.');
  const titleEn = text(body.titleEn, 'The English title', LIMITS.titleMin, LIMITS.titleMax), bodyEn = text(body.bodyEn, 'The English text', LIMITS.bodyMin, LIMITS.bodyMax, true);
  if (emptyish(body.titlePt) !== emptyish(body.bodyPt)) fail('Give the Portuguese title and text together, or leave both empty.');
  const titlePt = emptyish(body.titlePt) ? null : text(body.titlePt, 'The Portuguese title', LIMITS.titleMin, LIMITS.titleMax);
  const bodyPt = emptyish(body.bodyPt) ? null : text(body.bodyPt, 'The Portuguese text', LIMITS.bodyMin, LIMITS.bodyMax, true);
  const startsAt = body.startsAt, endsAt = body.endsAt;
  if (!Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt)) fail('Choose a start and an end time (UTC).');
  if (endsAt <= startsAt) fail('The end time must be after the start time.');
  if (endsAt - startsAt < LIMITS.minDurationMs || endsAt - startsAt > LIMITS.maxDurationMs) fail('An event lasts from 5 minutes to 30 days.');
  return { kind, titleEn, bodyEn, titlePt, bodyPt, startsAt, endsAt, sha: contentHash({ kind, titleEn, bodyEn, titlePt, bodyPt, startsAt, endsAt }) };
}
/** Hash of exactly what a reviewer approves. The text cannot change while pending, so it also binds the audit record to the content. */
const contentHash = p => crypto.createHash('sha256').update(JSON.stringify([p.kind, p.titleEn, p.bodyEn, p.titlePt, p.bodyPt, p.startsAt, p.endsAt])).digest('hex');

/* ---------- Staff operations (called by command-center/server.cjs inside its write() transaction) ---------- */
async function propose(c, { scope, wallet, now, p, why }) {
  if (p.startsAt < now + LIMITS.minLeadMs) fail('The event must start at least 10 minutes from now.');
  if (p.startsAt > now + LIMITS.maxAheadMs) fail('The event cannot start more than 180 days from now.');
  // Only proposals that can still be approved hold a slot: an expired one, or one whose start time has passed, does not.
  const waiting = Number((await c.query("SELECT COUNT(*) AS n FROM ryo_cc_events WHERE scope=$1 AND status='pending' AND created>$2 AND starts_at>$3", [scope, now - LIMITS.proposalTtlMs, now])).rows[0].n);
  if (waiting >= LIMITS.pendingMax) fail('Twenty events are already waiting for review.', 429);
  const row = (await c.query('INSERT INTO ryo_cc_events(scope,kind,title_en,body_en,title_pt,body_pt,starts_at,ends_at,content_sha256,proposer,reason,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
    [scope, p.kind, p.titleEn, p.bodyEn, p.titlePt, p.bodyPt, p.startsAt, p.endsAt, p.sha, wallet, why, now])).rows[0];
  return { id: Number(row.id) };
}
/** Approve or reject. The caller has already authorized event.review. Returns { id, status, proposer, title, sha, from }. */
async function review(c, { scope, wallet, now, id, approve, expected, sha, why }) {
  const e = (await c.query('SELECT * FROM ryo_cc_events WHERE scope=$1 AND id=$2 FOR UPDATE', [scope, id])).rows[0];
  if (!e || e.status !== 'pending') fail('That event is unavailable or already reviewed.', 409);
  if (e.proposer === wallet) fail('A different authorized wallet must review this event.', 403);
  if (Number(e.version) !== expected) fail('This event changed. Refresh before reviewing.', 409);
  // Recomputed from the stored row, so the binding stays true even if an edit path is ever added; then compared with what the reviewer saw.
  const stored = contentHash({ kind: e.kind, titleEn: e.title_en, bodyEn: e.body_en, titlePt: e.title_pt, bodyPt: e.body_pt, startsAt: Number(e.starts_at), endsAt: Number(e.ends_at) });
  if (stored !== e.content_sha256 || e.content_sha256 !== sha) fail('The event content is not what you reviewed. Refresh and read it again.', 409);
  if (approve) {
    if (now - Number(e.created) > LIMITS.proposalTtlMs) fail('This proposal expired. Propose it again.', 409);
    if (Number(e.starts_at) <= now) fail('This event\'s start time has already passed. Propose it again with a new schedule.', 409);
    const live = Number((await c.query("SELECT COUNT(*) AS n FROM ryo_cc_events WHERE scope=$1 AND status='approved' AND ends_at>$2", [scope, now])).rows[0].n);
    if (live >= LIMITS.approvedMax) fail('Fifty approved events have not ended yet. Unpublish one first.', 429);
  }
  const status = approve ? 'approved' : 'rejected';
  await c.query('UPDATE ryo_cc_events SET status=$3,version=version+1,reviewer=$4,review_reason=$5,reviewed=$6 WHERE scope=$1 AND id=$2', [scope, id, status, wallet, why, now]);
  return { id, status, proposer: e.proposer, title: e.title_en, kind: e.kind, startsAt: Number(e.starts_at), endsAt: Number(e.ends_at), sha: e.content_sha256, version: expected + 1 };
}
async function unpublish(c, { scope, wallet, now, id, expected, why }) {
  const e = (await c.query('SELECT * FROM ryo_cc_events WHERE scope=$1 AND id=$2 FOR UPDATE', [scope, id])).rows[0];
  if (!e || e.status !== 'approved') fail('Only an approved event can be unpublished.', 409);
  if (Number(e.version) !== expected) fail('This event changed. Refresh before unpublishing.', 409);
  if (Number(e.ends_at) <= now) fail('This event has already ended; there is nothing to unpublish.', 409);
  await c.query("UPDATE ryo_cc_events SET status='unpublished',version=version+1,unpublished_by=$3,unpublish_reason=$4,unpublished=$5 WHERE scope=$1 AND id=$2", [scope, id, wallet, why, now]);
  return { id, status: 'unpublished', title: e.title_en, sha: e.content_sha256, version: expected + 1 };
}

const phase = (r, now) => (r.status === 'approved' ? (now < Number(r.starts_at) ? 'upcoming' : now < Number(r.ends_at) ? 'live' : 'ended')
  : r.status === 'pending' ? (now - Number(r.created) > LIMITS.proposalTtlMs || Number(r.starts_at) <= now ? 'stale' : 'waiting') : r.status);
async function staffList(store, wallet) {
  const now = store.now();
  const rows = (await store.pool.query("SELECT * FROM ryo_cc_events WHERE scope=$1 ORDER BY (status='pending' AND created>$3 AND starts_at>$2) DESC, (status='approved' AND ends_at>$2) DESC, starts_at DESC, id DESC LIMIT 100", [store.scope, now, now - LIMITS.proposalTtlMs])).rows;
  return { limits: LIMITS, kinds: KINDS, events: rows.map(r => ({
    id: Number(r.id), kind: r.kind, status: r.status, phase: phase(r, now), version: Number(r.version), contentSha256: r.content_sha256,
    titleEn: r.title_en, bodyEn: r.body_en, titlePt: r.title_pt, bodyPt: r.body_pt, startsAt: Number(r.starts_at), endsAt: Number(r.ends_at),
    proposer: short(r.proposer), mine: r.proposer === wallet, reason: r.reason, created: Number(r.created),
    expires: r.status === 'pending' ? Number(r.created) + LIMITS.proposalTtlMs : null,
    reviewer: short(r.reviewer), reviewReason: r.review_reason, reviewed: num(r.reviewed),
    unpublishedBy: short(r.unpublished_by), unpublishReason: r.unpublish_reason, unpublished: num(r.unpublished),
  })) };
}

/* ---------- Player read ---------- */
async function playerList(store, body = {}) {
  if (!switchOn()) return { enabled: false, events: [] };
  const lang = typeof body.lang === 'string' && /^pt(?:[-_]|$)/i.test(body.lang) ? 'pt' : 'en', now = store.now();
  // starts_at is bounded below by the longest possible event, so the scan never walks back over long-finished events.
  const rows = (await store.pool.query("SELECT id,kind,title_en,body_en,title_pt,body_pt,starts_at,ends_at FROM ryo_cc_events WHERE scope=$1 AND status='approved' AND ends_at>$2 AND starts_at<$3 AND starts_at>$5 ORDER BY starts_at, id LIMIT $4",
    [store.scope, now, now + LIMITS.playerHorizonMs, LIMITS.playerMax, now - LIMITS.maxDurationMs])).rows;
  return { enabled: true, serverTime: now, events: rows.map(r => {
    const pt = lang === 'pt' && r.title_pt && r.body_pt;
    return { id: Number(r.id), kind: r.kind, lang: pt ? 'pt' : 'en', title: pt ? r.title_pt : r.title_en, body: pt ? r.body_pt : r.body_en, startsAt: Number(r.starts_at), endsAt: Number(r.ends_at), live: Number(r.starts_at) <= now };
  }) };
}

module.exports = { SCHEMA, KINDS, LIMITS, parse, contentHash, propose, review, unpublish, staffList, playerList, phase };
