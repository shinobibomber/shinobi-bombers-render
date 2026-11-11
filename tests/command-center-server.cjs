'use strict';
/* Shinobi Command Center (Phase 1) through the real service dispatcher, Store and schema on PGlite.
   Covers the role matrix, server-enforced chat moderation, reports, two-person announcements,
   idempotency, stale versions, scope binding, the shared audit hash chain, health and "no economic
   mutation". Isolated fixtures only: no wallet, RPC or database outside this process is touched. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..'), { Keypair } = require('../app/node_modules/@solana/web3.js');
const { Store, hash } = require('../app/server/store.cjs'), { createService, GENESIS } = require('../app/server/service.cjs');
(async () => {
  const db = new PGlite(), schema = fs.readFileSync(path.join(root, 'app/server/schema.sql'), 'utf8');
  await db.exec(schema); await db.exec(schema);   // the additive schema is idempotent
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  let now = Date.UTC(2026, 10, 9), rpcDown = false;
  const store = new Store(pool, 'cc-test', () => now);
  const names = ['treasury', 'studio', 'revenue', 'mint', 'owner', 'approver', 'operator', 'viewer', 'moderator', 'support', 'player', 'reporter', 'outsider'];
  const K = Object.fromEntries(names.map(n => [n, Keypair.generate()])), W = Object.fromEntries(names.map(n => [n, K[n].publicKey.toBase58()]));
  process.env.RYO_ADMIN_OWNERS = W.owner; process.env.RYO_ADMIN_APPROVERS = W.approver; process.env.RYO_ADMIN_OPERATORS = W.operator; process.env.RYO_ADMIN_VIEWERS = W.viewer;
  const connection = { async getGenesisHash() { if (rpcDown) throw Error('RPC unavailable'); return GENESIS; } };
  const service = createService({ store, connection, treasury: K.treasury, mint: W.mint, origin: 'http://127.0.0.1', studioAddress: W.studio, revenueAddress: W.revenue });
  const tokens = {};
  for (const n of names) { tokens[n] = 'cc-session-' + n; await pool.query('INSERT INTO ryo_sessions(scope,token_hash,wallet,expires) VALUES($1,$2,$3,$4)', [store.scope, hash(tokens[n]), W[n], now + 30 * 86400000]); }
  const call = (n, action, body = {}) => service.handle(action, body, tokens[n]);
  let seq = 0; const rid = () => 'cc-request-' + String(++seq).padStart(8, '0');
  const w = (n, action, body) => call(n, action, { requestId: rid(), scope: store.scope, ...body });
  const status = code => e => e.status === code;
  const ledger = async () => (await pool.query("SELECT (SELECT COALESCE(SUM(balance),0) FROM ryo_accounts WHERE scope=$1) AS b,(SELECT COUNT(*) FROM ryo_purchases WHERE scope=$1) AS p,(SELECT COUNT(*) FROM ryo_withdrawals WHERE scope=$1) AS wd,(SELECT COUNT(*) FROM ryo_reward_claims WHERE scope=$1) AS rc", [store.scope])).rows[0];
  await pool.query('INSERT INTO ryo_accounts(scope,wallet,balance) VALUES($1,$2,777000)', [store.scope, W.player]);
  const before = await ledger();

  // ---- Foundations: authentication, role matrix, custody wallets ----
  await assert.rejects(service.handle('cc-session', {}, 'not-a-session'), status(401), 'no session, no access');
  await assert.rejects(call('outsider', 'cc-session'), status(403), 'a wallet without a role is refused, even for reads');
  await assert.rejects(call('player', 'cc-overview'), status(403));
  await assert.rejects(call('treasury', 'cc-session'), status(403), 'custody wallets never act as staff');
  const owner = (await call('owner', 'cc-session')).data;
  assert.deepEqual(owner.roles, ['owner']); assert(owner.permissions.includes('roles.manage')); assert.equal(owner.network.key, 'devnet');
  assert.equal(owner.sessionExpires, now + 30 * 86400000);
  assert.equal((await call('viewer', 'cc-session')).data.permissions.includes('moderation.write'), false);

  // ---- Staff roles: Owner grants Moderator/Support only, versioned and audited ----
  await assert.rejects(w('operator', 'cc-role-grant', { wallet: W.moderator, role: 'moderator', reason: 'Trusted community moderator', expectedVersion: 0 }), status(403), 'only the Owner manages roles');
  await assert.rejects(w('owner', 'cc-role-grant', { wallet: W.moderator, role: 'approver', reason: 'Try a financial role', expectedVersion: 0 }), /Only the Moderator or Support/);
  await assert.rejects(w('owner', 'cc-role-grant', { wallet: W.treasury, role: 'moderator', reason: 'Custody must never be staff', expectedVersion: 0 }), status(403));
  await assert.rejects(call('moderator', 'cc-session'), status(403));
  await w('owner', 'cc-role-grant', { wallet: W.moderator, role: 'moderator', reason: 'Trusted community moderator', expectedVersion: 0 });
  await assert.rejects(w('owner', 'cc-role-grant', { wallet: W.support, role: 'support', reason: 'Support desk lead', expectedVersion: 0 }), status(409), 'stale roles version');
  await w('owner', 'cc-role-grant', { wallet: W.support, role: 'support', reason: 'Support desk lead', expectedVersion: 1 });
  assert.deepEqual((await call('moderator', 'cc-session')).data.roles, ['moderator'], 'a grant applies on the next request');
  // Backend roles never reach the economic dashboard's financial authority.
  await assert.rejects(call('moderator', 'admin-snapshot'), status(403), 'Moderator cannot read treasury details');
  await assert.rejects(call('support', 'admin-propose', { kind: 'monitor', payload: {}, reason: 'x', version: 0 }), status(403), 'Support cannot propose financial changes');
  await assert.rejects(call('support', 'cc-credit-ryo', {}), status(404), 'there is no credit action at all');

  // ---- Player chat, reports ----
  const say = async (n, text) => { now += 2500; return call(n, 'chat-send', { channel: 'global', text, name: n }); };
  const m1 = (await say('player', 'buy cheap ryo from me now')).messages.at(-1);
  const m2 = (await say('player', 'second message')).messages.at(-1);
  const r1 = await call('reporter', 'chat-report', { messageId: m1.id, category: 'spam', details: 'Selling Ryo off-platform' });
  assert.deepEqual(r1, { reported: true, status: 'received' });
  assert.equal((await call('reporter', 'chat-report', { messageId: m1.id, category: 'spam' })).status, 'duplicate', 'duplicate reports are absorbed');
  await call('reporter', 'chat-report', { messageId: m1.id, category: 'scam' });
  await assert.rejects(call('player', 'chat-report', { messageId: m1.id, category: 'spam' }), /your own message/);
  await assert.rejects(call('reporter', 'chat-report', { messageId: m1.id, category: 'rude' }), /report reason/);
  await assert.rejects(call('reporter', 'chat-report', { messageId: 999999, category: 'spam' }), status(404));

  // ---- Who may read moderation context ----
  await assert.rejects(call('viewer', 'cc-chat-reports'), status(403), 'viewers do not see chat evidence');
  await assert.rejects(call('approver', 'cc-chat-feed'), status(403));
  const queue = (await call('moderator', 'cc-chat-reports')).data.reports;
  assert.equal(queue.length, 2); assert.equal(queue[0].snapshot.text, 'buy cheap ryo from me now'); assert.equal(queue[0].reportsForMessage, 2);
  const spamReport = queue.find(r => r.category === 'spam'), scamReport = queue.find(r => r.category === 'scam');

  // ---- Player lookup redaction by role ----
  const mod = (await call('moderator', 'cc-player-lookup', { query: W.player })).data;
  assert.equal(mod.wallet, W.player); assert.equal(mod.economy, undefined); assert.equal(mod.transactions, undefined); assert.equal(mod.heroes, undefined); assert(Array.isArray(mod.moderation));
  const fin = (await call('approver', 'cc-player-lookup', { query: W.player })).data;
  assert.equal(fin.economy.ryoBalance, 777000); assert(Array.isArray(fin.transactions)); assert.equal(fin.moderation, undefined);
  const view = (await call('viewer', 'cc-player-lookup', { query: W.player })).data;
  assert.notEqual(view.wallet, W.player, 'viewers see a shortened wallet'); assert.equal(view.transactions, undefined);
  const byName = (await call('support', 'cc-player-lookup', { query: 'repor' })).data;
  assert.equal(byName.kind, 'matches');
  assert.deepEqual((await call('support', 'cc-player-lookup', { query: 'pla' })).data.matches.map(m => m.wallet), [W.player]);
  await assert.rejects(call('support', 'cc-player-lookup', { query: 'x' }), /2-14 characters/);

  // ---- Moderation is enforced in chat-send ----
  await assert.rejects(w('support', 'cc-chat-moderate', { decision: 'mute', targetWallet: W.player, durationMinutes: 30, reasonCode: 'spam', reason: 'Support may not mute', expectedVersion: 0 }), status(403));
  await assert.rejects(w('viewer', 'cc-chat-moderate', { decision: 'warn', targetWallet: W.player, reasonCode: 'spam', reason: 'Viewers are read only', expectedVersion: 0 }), status(403));
  await assert.rejects(w('moderator', 'cc-chat-moderate', { decision: 'mute', targetWallet: W.player, durationMinutes: 45, reasonCode: 'spam', reason: 'Odd duration test', expectedVersion: 0 }), /mute duration/);
  await assert.rejects(w('moderator', 'cc-chat-moderate', { decision: 'mute', targetWallet: W.player, durationMinutes: 30, reasonCode: 'spam', reason: 'short', expectedVersion: 0 }), /8 to 500/);
  await assert.rejects(w('moderator', 'cc-chat-moderate', { decision: 'mute', targetWallet: W.player, durationMinutes: 30, reasonCode: 'spam', reason: 'Spam after report review', expectedVersion: 0, scope: 'solana-mainnet:other' }), status(409), 'a page for another scope cannot act');
  await assert.rejects(w('moderator', 'cc-chat-moderate', { decision: 'mute', targetWallet: W.moderator, durationMinutes: 30, reasonCode: 'spam', reason: 'Muting myself is refused', expectedVersion: 0 }), status(403));
  await assert.rejects(w('moderator', 'cc-chat-moderate', { decision: 'ban', targetWallet: W.operator, reasonCode: 'other', reason: 'Staff cannot be sanctioned here', expectedVersion: 0 }), status(403));
  const muteBody = { requestId: rid(), scope: store.scope, decision: 'mute', messageId: m1.id, reportId: spamReport.id, durationMinutes: 30, reasonCode: 'spam', reason: 'Verified spam after report review', expectedVersion: 0 };
  const muted = await call('moderator', 'cc-chat-moderate', muteBody);
  assert.equal(muted.standing.version, 1); assert.equal(muted.standing.mutedUntil, now + 30 * 60000);
  const replay = await call('moderator', 'cc-chat-moderate', muteBody);
  assert.equal(replay.replayed, true); assert.equal(replay.actionId, muted.actionId, 'a retried request returns the original result');
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM ryo_cc_chat_actions WHERE scope=$1 AND decision='mute'", [store.scope])).rows[0].n), 1, 'and never applies twice');
  await assert.rejects(call('moderator', 'cc-chat-report', { ...muteBody }), status(404), 'unknown cc action');
  await assert.rejects(call('moderator', 'cc-report-resolve', { ...muteBody, reportId: scamReport.id, resolution: 'dismiss' }), status(409), 'a request ID cannot be reused for another action');
  await assert.rejects(w('moderator', 'cc-chat-moderate', { decision: 'ban', targetWallet: W.player, reasonCode: 'spam', reason: 'Stale page should be refused', expectedVersion: 0 }), status(409), 'stale standing version');
  await assert.rejects(say('player', 'am I muted?'), e => e.status === 403 && /muted in Global chat until/.test(e.message), 'chat-send refuses a muted wallet');
  const mutedFeed = await call('player', 'chat-list', { channel: 'global' });
  assert.equal(mutedFeed.standing.mutedUntil, now + 30 * 60000 - 2500, 'a muted player can still read and sees the mute');
  assert.equal((await call('moderator', 'cc-chat-reports', { status: 'actioned' })).data.reports[0].resolution, 'mute');
  now += 31 * 60000; await say('player', 'back after the mute');

  // Hide: removed from every player's feed, kept as restricted evidence, open reports resolved.
  await w('moderator', 'cc-chat-moderate', { decision: 'hide', messageId: m1.id, reasonCode: 'scam', reason: 'Off-platform selling attempt' });
  await assert.rejects(w('moderator', 'cc-chat-moderate', { decision: 'hide', messageId: m1.id, reasonCode: 'scam', reason: 'Hiding twice is refused' }), status(409));
  const feed = await call('reporter', 'chat-list', { channel: 'global' });
  assert(!feed.messages.some(m => m.id === m1.id), 'hidden messages are not served'); assert(feed.removed.includes(m1.id), 'clients learn which shown message to drop');
  assert(feed.messages.some(m => m.id === m2.id));
  const staffFeed = (await call('moderator', 'cc-chat-feed')).data.messages.find(m => m.id === m1.id);
  assert.equal(staffFeed.text, 'buy cheap ryo from me now'); assert(staffFeed.hidden);
  assert.equal((await call('moderator', 'cc-chat-reports')).data.reports.length, 0, 'open reports on a hidden message are resolved');
  assert.equal((await call('reporter', 'chat-report', { messageId: m1.id, category: 'offensive' })).status, 'removed');

  // Ban / unban, warn.
  let v = (await call('moderator', 'cc-player-lookup', { query: W.player })).data.chat.version;
  await w('moderator', 'cc-chat-moderate', { decision: 'ban', targetWallet: W.player, reasonCode: 'scam', reason: 'Repeated scam attempts', expectedVersion: v });
  await assert.rejects(say('player', 'banned?'), e => e.status === 403 && /no longer send/.test(e.message));
  assert.equal((await call('player', 'chat-list', { channel: 'global' })).standing.banned, true);
  assert.equal((await call('operator', 'cc-chat-sanctions')).data.sanctions[0].banned, true);
  await w('operator', 'cc-chat-moderate', { decision: 'unban', targetWallet: W.player, reasonCode: 'other', reason: 'Appeal accepted by operator', expectedVersion: v + 1 });
  await say('player', 'thanks for the second chance');
  await w('moderator', 'cc-chat-moderate', { decision: 'warn', targetWallet: W.player, reasonCode: 'offensive', reason: 'Rude language in Global', expectedVersion: v + 2 });
  assert.match((await call('player', 'chat-list', { channel: 'global' })).standing.warning.text, /warned you about offensive language/);

  // Support dismisses a report; the snapshot survives the message being pruned.
  const m3 = (await say('player', 'a borderline message')).messages.at(-1);
  await call('reporter', 'chat-report', { messageId: m3.id, category: 'harassment' });
  await pool.query('DELETE FROM ryo_chat WHERE scope=$1 AND id=$2', [store.scope, m3.id]);   // as retention pruning would
  const pruned = (await call('support', 'cc-chat-reports')).data.reports[0];
  assert.equal(pruned.snapshot.text, 'a borderline message'); assert.equal(pruned.message.stored, false);
  await w('support', 'cc-report-resolve', { reportId: pruned.id, resolution: 'dismiss', reason: 'Not harassment after review' });
  await assert.rejects(w('support', 'cc-report-resolve', { reportId: pruned.id, resolution: 'dismiss', reason: 'Second dismissal attempt' }), status(409));
  await assert.rejects(w('moderator', 'cc-chat-moderate', { decision: 'hide', messageId: m3.id, reasonCode: 'other', reason: 'Pruned messages cannot be hidden' }), status(404));

  // ---- Official announcements: proposer and reviewer must differ ----
  await assert.rejects(w('player', 'cc-announce-propose', { textEn: 'Fake official news', reason: 'Players cannot announce' }), status(403));
  await assert.rejects(w('moderator', 'cc-announce-propose', { textEn: 'Claim at https://evil.example', reason: 'Links are refused' }), /Links are not allowed/);
  const p1 = await w('moderator', 'cc-announce-propose', { textEn: 'Maintenance at 03:00 UTC tonight.', textPt: 'Manutenção às 03:00 UTC hoje.', reason: 'Scheduled hosting maintenance' });
  await assert.rejects(w('moderator', 'cc-announce-review', { id: p1.id, approve: true, expectedVersion: 0, reason: 'Moderators cannot review' }), status(403));
  const p2 = await w('owner', 'cc-announce-propose', { textEn: 'Owner self-review test.', reason: 'Testing self review refusal' });
  await assert.rejects(w('owner', 'cc-announce-review', { id: p2.id, approve: true, expectedVersion: 0, reason: 'Self review must fail' }), e => e.status === 403 && /different authorized wallet/.test(e.message));
  await assert.rejects(w('operator', 'cc-announce-review', { id: p1.id, approve: true, expectedVersion: 3, reason: 'Wrong version' }), status(409));
  const pub = await w('operator', 'cc-announce-review', { id: p1.id, approve: true, expectedVersion: 0, reason: 'Checked wording and time' });
  assert.equal(pub.status, 'published'); assert.equal(pub.messageIds.length, 2);
  const sys = (await call('player', 'chat-list', { channel: 'global', systemAfter: 0 })).system;
  assert.deepEqual(sys.map(m => m.text), ['📢 Maintenance at 03:00 UTC tonight.', '📢 Manutenção às 03:00 UTC hoje.']);
  assert.deepEqual({ name: sys[0].name, from: sys[0].from, mine: sys[0].mine }, { name: 'System', from: '', mine: false });
  await assert.rejects(call('player', 'chat-send', { channel: 'system', text: 'fake official' }), /Unknown chat channel/, 'players still cannot post to System');
  await w('operator', 'cc-announce-unpublish', { id: p1.id, expectedVersion: 1, reason: 'Maintenance was cancelled' });
  const afterUnpublish = await call('player', 'chat-list', { channel: 'global', systemAfter: 0 });
  assert.equal(afterUnpublish.system.length, 0); assert(pub.messageIds.every(id => afterUnpublish.removed.includes(id)));
  await assert.rejects(w('moderator', 'cc-chat-moderate', { decision: 'unhide', messageId: pub.messageIds[0], reasonCode: 'other', reason: 'Restore an unpublished announcement' }), status(409), 'chat moderation cannot bypass announcement review');
  now += 8 * 86400000;
  await assert.rejects(w('operator', 'cc-announce-review', { id: p2.id, approve: true, expectedVersion: 0, reason: 'Too late to approve' }), /expired/);
  assert.equal((await call('viewer', 'cc-announcements')).data.announcements.length, 2);

  // ---- Rate limit on staff writes ----
  v = (await call('moderator', 'cc-player-lookup', { query: W.reporter })).data.chat.version;
  let limited = false;
  for (let i = 0; i < 31 && !limited; i++) {
    try { await w('moderator', 'cc-chat-moderate', { decision: 'warn', targetWallet: W.reporter, reasonCode: 'other', reason: 'Rate limit exercise ' + i, expectedVersion: v + i }); }
    catch (e) { assert.equal(e.status, 429); limited = true; }
  }
  assert(limited, 'staff writes are rate-limited'); now += 61000;

  // ---- Audit: one hash chain shared with the economic dashboard ----
  await call('operator', 'admin-pause', { control: 'claims', reason: 'Investigating claim anomaly', confirmation: 'CONFIRM' });   // live requires the typed CONFIRM
  const audit = (await call('owner', 'cc-audit', { limit: 100 })).data.entries;
  assert(audit.length > 10); assert(audit.every(e => e.hashValid), 'every record matches its hash');
  assert(audit.every((e, i) => i === audit.length - 1 || e.linked === true), 'records link to their predecessor');
  assert(audit.some(e => e.action === 'emergency.pause') && audit.some(e => e.action === 'cc.chat.mute') && audit.some(e => e.action === 'cc.role.granted'));
  const muteAudit = audit.find(e => e.action === 'cc.chat.mute');
  assert.equal(muteAudit.data.role, 'moderator'); assert.equal(muteAudit.data.requestId, muteBody.requestId); assert.equal(muteAudit.data.versionBefore, 0); assert.equal(muteAudit.data.outcome, 'success');
  assert(!JSON.stringify(audit).includes('buy cheap ryo'), 'message text stays out of the audit chain'); assert.match(muteAudit.data.evidenceSha256, /^[0-9a-f]{64}$/);
  const own = (await call('moderator', 'cc-audit')).data;
  assert(own.entries.length && own.entries.every(e => e.actor === W.moderator && e.action.startsWith('cc.')), 'moderators see only their own records');
  assert.deepEqual((await call('owner', 'cc-audit', { prefix: 'cc.announcement' })).data.entries.map(e => e.action).sort(), ['cc.announcement.proposed', 'cc.announcement.proposed', 'cc.announcement.published', 'cc.announcement.unpublished']);
  await assert.rejects(call('support', 'cc-audit', { actor: 'not-a-wallet' }), /Invalid Solana wallet/);
  // The economic dashboard's own verification still holds over the shared chain.
  const snap = await call('operator', 'admin-snapshot'), { digest } = require('../app/server/economic-dashboard.cjs');
  let previous = 'genesis'; for (const a of snap.audits.slice().reverse()) { assert.equal(a.previous, previous); const { hash: h, ...payload } = a; assert.equal(h, digest({ ...payload, sequence: Number(a.sequence), created: Number(a.created) })); previous = a.hash; }

  // ---- Overview and health: real values or explicit "unavailable" ----
  const ov = (await call('support', 'cc-overview')).data.metrics, m = k => ov.find(x => x.key === k);
  assert.equal(m('openReports').value, 0); assert.equal(m('newSignups24h').status, 'unavailable'); assert.equal(m('newSignups24h').value, null); assert.equal(m('revenue').status, 'not_implemented');
  assert.deepEqual((await call('support', 'cc-overview')).data.pauses, ['claims']);
  const hOk = (await call('viewer', 'cc-health')).data; assert.equal(hOk.database.status, 'ok'); assert.equal(hOk.rpc.status, 'ok'); assert.equal(hOk.database.schema.commandCenter, true);
  rpcDown = true; const hDown = (await call('viewer', 'cc-health')).data; rpcDown = false;
  assert.equal(hDown.rpc.status, 'unavailable', 'a failing RPC is never reported healthy');

  // ---- No economic mutation from any Command Center action ----
  const after = await ledger();
  assert.deepEqual({ ...after, b: Number(after.b) }, { ...before, b: Number(before.b) }, 'balances, purchases, withdrawals and reward claims are untouched');
  // Expired sessions fail closed.
  now += 31 * 86400000; await assert.rejects(call('owner', 'cc-session'), status(401));
  await db.close();
  console.log('PASS: Command Center roles, redaction, server-enforced mute/ban/hide, reports with retained snapshots, two-person announcements, idempotent/stale/scope-bound writes, rate limits, shared audit chain, health and no economic mutation.');
})().catch(e => { console.error(e); process.exitCode = 1; });
