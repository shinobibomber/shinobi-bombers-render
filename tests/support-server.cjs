'use strict';
/* In-game Support tickets through the real service dispatcher, Store and schema on PGlite (isolated fixtures only).
   Player side: switch, validation, limits (3 tickets/24h, 5 open, 20 replies/24h, 60 messages), order-reference ownership,
   idempotency, reply reopens a resolved ticket, closed is final, internal notes and staff wallets never reach the player.
   Staff side (Command Center): role matrix, version checks, audit holds a hash and a length but never the text, 30-day retention,
   and no economic mutation anywhere. */
const assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..'), { Keypair } = require('../app/node_modules/@solana/web3.js');
const { Store, hash } = require('../app/server/store.cjs'), { createService, GENESIS } = require('../app/server/service.cjs');
const S = require('../app/server/support.cjs');
const DAY = 86400000;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
// The files that were pinned before Support tickets: reversing the support additions must give them back byte for byte.
const PREVIOUS = { service: '917d760be29471a6857da42e1f01abb705929b570cf7c08de14a92254954db19', schema: '8ad4694ca37104e9df9560bd8edd022e4425cc0c30fbd7fb5a5b3bd7f6e5dc78' };
(function buildIntegrity() {
  const { serviceHooks, SCHEMA_MARKER } = require('../apply-support.cjs');
  let service = fs.readFileSync(path.join(root, 'app/server/service.cjs'), 'utf8');
  for (const [before, after] of serviceHooks.slice().reverse()) { assert.equal(service.split(after).length - 1, 1, 'one exact support hook in service.cjs'); service = service.replace(after, () => before); }
  assert.equal(sha(Buffer.from(service, 'utf8')), PREVIOUS.service, 'service.cjs: only the support actions were added');
  const schemaSql = fs.readFileSync(path.join(root, 'app/server/schema.sql'), 'utf8'), at = schemaSql.indexOf('\n' + SCHEMA_MARKER);
  assert.equal(schemaSql.split('\n' + SCHEMA_MARKER).length - 1, 1, 'one support schema block'); assert(schemaSql.slice(at).includes(require('../support/server.cjs').SCHEMA), 'the block is the support schema');
  assert.equal(sha(Buffer.from(schemaSql.slice(0, at), 'utf8')), PREVIOUS.schema, 'schema.sql: only the additive support block was added at the end');
  assert.equal(fs.readFileSync(path.join(root, 'app/server/support.cjs'), 'utf8'), fs.readFileSync(path.join(root, 'support/server.cjs'), 'utf8'), 'the built server module is the source module');
})();
(async () => {
  const envBefore = process.env.SUPPORT_TICKETS_ENABLED;
  const db = new PGlite(), schema = fs.readFileSync(path.join(root, 'app/server/schema.sql'), 'utf8');
  await db.exec(schema); await db.exec(schema);   // the additive schema (support tables included) is idempotent
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  let now = Date.UTC(2026, 10, 12);
  const store = new Store(pool, 'support-test', () => now);
  const names = ['treasury', 'studio', 'revenue', 'mint', 'owner', 'approver', 'operator', 'viewer', 'moderator', 'support', 'alice', 'bob', 'carol', 'dave'];
  const K = Object.fromEntries(names.map(n => [n, Keypair.generate()])), W = Object.fromEntries(names.map(n => [n, K[n].publicKey.toBase58()]));
  process.env.RYO_ADMIN_OWNERS = W.owner; process.env.RYO_ADMIN_APPROVERS = W.approver; process.env.RYO_ADMIN_OPERATORS = W.operator; process.env.RYO_ADMIN_VIEWERS = W.viewer;
  delete process.env.SUPPORT_TICKETS_ENABLED;   // default: ON
  const connection = { async getGenesisHash() { return GENESIS; } };
  const service = createService({ store, connection, treasury: K.treasury, mint: W.mint, origin: 'http://127.0.0.1', studioAddress: W.studio, revenueAddress: W.revenue });
  const tokens = {};
  for (const n of names) { tokens[n] = 'support-session-' + n; await pool.query('INSERT INTO ryo_sessions(scope,token_hash,wallet,expires) VALUES($1,$2,$3,$4)', [store.scope, hash(tokens[n]), W[n], now + 400 * DAY]); }
  const call = (n, action, body = {}) => service.handle(action, body, tokens[n]);
  let seq = 0; const rid = () => 'support-request-' + String(++seq).padStart(8, '0');
  const status = code => e => e.status === code, because = (code, re) => e => e.status === code && re.test(e.message);
  const staff = (n, action, body) => (now += 50, call(n, action, { requestId: rid(), scope: store.scope, ...body }));
  const open = (n, over = {}) => call(n, 'support-submit', { requestId: rid(), category: 'bug', subject: 'Shrine stuck', message: 'The shrine animation never ends for me.', ...over });
  const sayTo = (n, id, text = 'More details about this.') => (now += 50, call(n, 'support-reply', { requestId: rid(), id, message: text }));
  const ticketRow = async id => (await pool.query('SELECT * FROM ryo_support_tickets WHERE id=$1', [id])).rows[0];
  const ledger = async () => (await pool.query("SELECT (SELECT COALESCE(SUM(balance),0) FROM ryo_accounts WHERE scope=$1) AS b,(SELECT COUNT(*) FROM ryo_purchases WHERE scope=$1) AS p,(SELECT COUNT(*) FROM ryo_withdrawals WHERE scope=$1) AS wd,(SELECT COUNT(*) FROM ryo_deposits WHERE scope=$1) AS d,(SELECT COUNT(*) FROM ryo_reward_claims WHERE scope=$1) AS rc", [store.scope])).rows[0];
  const b58 = n => { const a = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; return Array.from(crypto.randomBytes(n), x => a[x % a.length]).join(''); };

  // Staff roles: the Owner grants Support through the Command Center, as in production.
  await staff('owner', 'cc-role-grant', { wallet: W.support, role: 'support', reason: 'Support desk for tickets', expectedVersion: 0 });
  await staff('owner', 'cc-role-grant', { wallet: W.moderator, role: 'moderator', reason: 'Moderator without support access', expectedVersion: 1 });

  // The player's own records an order reference may point to (nothing else may be linked).
  const SIG_A = b58(88), SIG_D = b58(88), SIG_W = b58(88), SIG_BOB = b58(88);
  await pool.query('INSERT INTO ryo_accounts(scope,wallet,balance) VALUES($1,$2,500000)', [store.scope, W.alice]);
  await pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,'alice-purchase-0001','summon','{}','{}','{}','{}',250000,$3,'w',1,'confirmed',$4)", [store.scope, W.alice, SIG_A, now]);
  await pool.query('INSERT INTO ryo_deposits(scope,signature,wallet,amount,request_id,created) VALUES($1,$2,$3,100000,\'alice-deposit-0001\',$4)', [store.scope, SIG_D, W.alice, now]);
  await pool.query("INSERT INTO ryo_withdrawals(scope,wallet,request_id,amount,signature,wire,last_height,status,created) VALUES($1,$2,'alice-withdrawal-0001',100000,$3,'w',1,'pending',$4)", [store.scope, W.alice, SIG_W, now]);
  await pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,'bob-purchase-000001','summon','{}','{}','{}','{}',90000,$3,'w',1,'confirmed',$4)", [store.scope, W.bob, SIG_BOB, now]);
  const before = await ledger();

  // ---- The switch: OFF refuses every player action; the default is ON ----
  assert.equal((await call('alice', 'support-state')).support.enabled, true, 'default ON');
  process.env.SUPPORT_TICKETS_ENABLED = 'off';
  assert.deepEqual((await call('alice', 'support-state')).support, { enabled: false, limits: S.LIMITS, tickets: [] });
  await assert.rejects(open('alice'), because(403, /not open/));
  await assert.rejects(call('alice', 'support-view', { id: 1 }), status(403));
  await assert.rejects(sayTo('alice', 1), status(403));
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_support_tickets')).rows[0].n), 0, 'nothing stored while OFF');
  process.env.SUPPORT_TICKETS_ENABLED = 'on';
  await assert.rejects(service.handle('support-state', {}, 'not-a-session'), status(401), 'sign-in is required');

  // ---- Validation: category, text limits, control characters, request ID ----
  await assert.rejects(open('alice', { category: 'refund-me' }), /Choose a category/);
  await assert.rejects(open('alice', { subject: 'ab' }), /subject must be 3 to 80/);
  await assert.rejects(open('alice', { subject: 'x'.repeat(81) }), /subject must be 3 to 80/);
  await assert.rejects(open('alice', { message: 'four' }), /message must be 5 to 1000/);
  await assert.rejects(open('alice', { message: 'x'.repeat(1001) }), /message must be 5 to 1000/);
  await assert.rejects(open('alice', { requestId: 'short' }), /Invalid request ID/);
  await assert.rejects(open('alice', { subject: '\u0000\u202E   ' }), /subject must be/);
  assert.equal((await call('alice', 'support-state')).support.tickets.length, 0, 'invalid input stores nothing');
  const dirty = await open('alice', { subject: '  Wallet\u202E\u2067   shows\u0007\u2028 odd\u2069  ', message: 'Line one\u0000\r\n\r\n\r\n\r\nLine two   with   spaces' });
  assert.equal(dirty.ticket.subject, 'Wallet shows odd', 'control and bidi characters are removed, spaces collapsed');
  const dirtyView = await call('alice', 'support-view', { id: dirty.ticket.id });
  assert.equal(dirtyView.messages[0].text, 'Line one\n\nLine two with spaces', 'line breaks kept, never more than one blank line');
  assert.equal(dirty.ticket.status, 'submitted'); assert.equal(dirty.ticket.version, 0);

  // ---- Idempotency: the same request ID returns the stored ticket ----
  const rSame = rid(), t1 = await open('bob', { requestId: rSame, subject: 'Hero missing', category: 'hero' });
  const t1again = await open('bob', { requestId: rSame, subject: 'Hero missing', category: 'hero' });
  assert.equal(t1again.replayed, true); assert.equal(t1again.ticket.id, t1.ticket.id);
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_support_messages WHERE ticket_id=$1', [t1.ticket.id])).rows[0].n), 1, 'a replay never adds a second message');
  const rReply = rid(), r1 = await call('bob', 'support-reply', { requestId: rReply, id: t1.ticket.id, message: 'Still missing, please check.' });
  const r1again = await call('bob', 'support-reply', { requestId: rReply, id: t1.ticket.id, message: 'Still missing, please check.' });
  assert.equal(r1again.replayed, true); assert.equal(r1again.ticket.version, r1.ticket.version);
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_support_messages WHERE ticket_id=$1', [t1.ticket.id])).rows[0].n), 2);

  // ---- Order reference: only this wallet's own purchase, deposit or withdrawal ----
  const byRequest = await open('alice', { reference: 'alice-purchase-0001', subject: 'Purchase problem', category: 'payment' });
  assert.equal(byRequest.ticket.reference, 'purchase:alice-purchase-0001');
  now += DAY; const bySig = await open('alice', { reference: SIG_D, subject: 'Deposit problem', category: 'payment' });
  assert.equal(bySig.ticket.reference, 'deposit:alice-deposit-0001', 'a signature resolves to its request');
  now += DAY; const byW = await open('alice', { reference: SIG_W, subject: 'Withdrawal problem', category: 'withdrawal' });
  assert.equal(byW.ticket.reference, 'withdrawal:alice-withdrawal-0001');
  const foreign = e => because(404, /could not find that order on your account/)(e), nope = [SIG_BOB, 'bob-purchase-000001', b58(88), 'nothing-like-this-1'];
  now += DAY;
  for (const ref of nope) await assert.rejects(open('alice', { reference: ref }), foreign, 'another player\'s or an unknown order is the same 404');
  await assert.rejects(open('alice', { reference: 'has spaces and !!' }), /does not look right/);
  await assert.rejects(open('carol', { reference: 'alice-purchase-0001' }), foreign, 'Alice\'s order cannot be attached by Carol');
  assert.equal((await call('carol', 'support-state')).support.tickets.length, 0);

  // ---- Player view: own tickets only, never notes or staff wallets ----
  await assert.rejects(call('carol', 'support-view', { id: byRequest.ticket.id }), status(404), 'another player\'s ticket is a 404');
  await assert.rejects(sayTo('carol', byRequest.ticket.id), status(404));
  await assert.rejects(call('alice', 'support-view', { id: 999999 }), status(404));
  await assert.rejects(call('alice', 'support-view', { id: 'abc' }), /Choose a ticket/);
  // A reply request ID belongs to one ticket: reusing it on another is refused and stores nothing.
  const shared = rid(); await call('alice', 'support-reply', { requestId: shared, id: byRequest.ticket.id, message: 'First message on this ticket' });
  await assert.rejects(call('alice', 'support-reply', { requestId: shared, id: bySig.ticket.id, message: 'Same ID, other ticket' }), because(409, /already used for another message/));
  assert.equal((await call('alice', 'support-view', { id: bySig.ticket.id })).messages.length, 1, 'nothing was stored on the other ticket');

  // ---- Staff role matrix ----
  for (const n of ['owner', 'approver', 'operator', 'support']) assert.equal((await call(n, 'cc-support-list')).data.tickets.length > 0, true, n + ' can read the queue');
  for (const n of ['moderator', 'viewer', 'alice']) { await assert.rejects(call(n, 'cc-support-list'), status(403), n + ' cannot read the queue'); await assert.rejects(call(n, 'cc-support-ticket', { id: t1.ticket.id }), status(403)); }
  await assert.rejects(staff('approver', 'cc-support-reply', { id: t1.ticket.id, message: 'Approvers read only', expectedVersion: 1 }), status(403), 'Approver reads, never writes tickets');
  for (const n of ['moderator', 'viewer', 'alice']) await assert.rejects(staff(n, 'cc-support-note', { id: t1.ticket.id, message: 'No access here' }), status(403));
  const list = (await call('support', 'cc-support-list')).data;
  assert.equal(list.retentionDays, 30); assert(list.tickets.every(t => t.wallet && t.waitingOnTeam === true), 'new tickets wait on the team');
  assert.equal(list.counts.submitted, list.tickets.length);
  assert.equal((await call('support', 'cc-support-list', { wallet: W.bob })).data.tickets.length, 1, 'filter by wallet');
  assert.equal((await call('support', 'cc-support-list', { category: 'hero' })).data.tickets.length, 1, 'filter by category');
  await assert.rejects(call('support', 'cc-support-list', { status: 'weird' }), /Choose a status/);
  await assert.rejects(call('support', 'cc-support-list', { wallet: 'not-a-wallet' }), /does not look like a wallet/);
  const detail = (await call('support', 'cc-support-ticket', { id: byRequest.ticket.id })).data;
  assert.equal(detail.ticket.wallet, W.alice); assert.deepEqual(detail.reference, { kind: 'purchase', id: 'alice-purchase-0001', detail: 'summon', amount: 250000, status: 'confirmed', created: detail.reference.created }, 'staff see what the order is');
  assert.equal(detail.messages[0].author, 'player', 'a player message names no wallet');

  // ---- Staff reply, internal note, status and assignment ----
  let v = (await call('support', 'cc-support-ticket', { id: t1.ticket.id })).data.ticket.version;
  assert.equal(v, 1);
  await assert.rejects(staff('support', 'cc-support-reply', { id: t1.ticket.id, message: 'Stale page', expectedVersion: 0 }), status(409), 'a stale page is refused');
  await assert.rejects(staff('support', 'cc-support-reply', { id: t1.ticket.id, message: 'x', status: 'closed', expectedVersion: v }), /investigating, awaiting the player, or resolved/, 'closing is a deliberate update, not a reply');
  await assert.rejects(staff('support', 'cc-support-reply', { id: t1.ticket.id, message: '   ', expectedVersion: v }), /message must be/);
  const SECRET_NOTE = 'Internal: suspect an alt account', STAFF_TEXT = 'We found your hero and restored it.';
  const note = await staff('support', 'cc-support-note', { id: t1.ticket.id, message: SECRET_NOTE });
  assert.equal(note.version, v, 'a note never changes the ticket version');
  const rep = await staff('support', 'cc-support-reply', { id: t1.ticket.id, message: STAFF_TEXT, expectedVersion: v });
  assert.equal(rep.status, 'awaiting_player'); assert.equal(rep.version, v + 1); v += 1;
  const playerSees = await call('bob', 'support-view', { id: t1.ticket.id }), playerJson = JSON.stringify(playerSees) + JSON.stringify(await call('bob', 'support-state'));
  assert.deepEqual(playerSees.messages.map(m => m.from), ['you', 'you', 'team']); assert.equal(playerSees.messages[2].text, STAFF_TEXT);
  assert(!playerJson.includes(SECRET_NOTE), 'internal notes never reach the player');
  for (const n of ['support', 'owner', 'operator']) assert(!playerJson.includes(W[n]), 'no staff wallet reaches the player (' + n + ')');
  const staffThread = (await call('owner', 'cc-support-ticket', { id: t1.ticket.id })).data.messages;
  assert.deepEqual(staffThread.map(m => m.kind), ['player', 'player', 'note', 'staff']); assert.equal(staffThread[3].author, W.support, 'staff see who answered');
  assert.equal((await call('support', 'cc-support-list')).data.tickets.find(t => t.id === t1.ticket.id).waitingOnTeam, false, 'answered: no longer waiting on the team');
  // The player answers; a reply on an awaiting ticket puts it back in the queue.
  const back = await sayTo('bob', t1.ticket.id, 'Thank you, it is back!');
  assert.equal(back.ticket.status, 'submitted'); v = back.ticket.version;
  assert.equal((await call('support', 'cc-support-list')).data.tickets.find(t => t.id === t1.ticket.id).waitingOnTeam, true);
  // Update: assignment and status, with a reason and a version.
  await assert.rejects(staff('support', 'cc-support-update', { id: t1.ticket.id, status: 'triaged', expectedVersion: v }), /reason is required/);
  await assert.rejects(staff('support', 'cc-support-update', { id: t1.ticket.id, reason: 'Nothing chosen here', expectedVersion: v }), /status or an assignment/);
  await assert.rejects(staff('support', 'cc-support-update', { id: t1.ticket.id, assign: 'someone', reason: 'Bad assignee value', expectedVersion: v }), /me or none/);
  const upd = await staff('support', 'cc-support-update', { id: t1.ticket.id, status: 'investigating', assign: 'me', reason: 'Taking this ticket now', expectedVersion: v });
  assert.equal(upd.status, 'investigating'); v = upd.version;
  assert.equal((await call('owner', 'cc-support-ticket', { id: t1.ticket.id })).data.ticket.assignee, W.support);
  await assert.rejects(staff('support', 'cc-support-update', { id: t1.ticket.id, status: 'investigating', reason: 'Same status again', expectedVersion: v }), because(409, /already investigating/));
  const un = await staff('operator', 'cc-support-update', { id: t1.ticket.id, assign: 'none', reason: 'Releasing the ticket', expectedVersion: v }); v = un.version;
  assert.equal((await call('owner', 'cc-support-ticket', { id: t1.ticket.id })).data.ticket.assignee, null);
  const rid1 = rid(), a1 = await call('support', 'cc-support-update', { requestId: rid1, scope: store.scope, id: t1.ticket.id, status: 'resolved', reason: 'Hero restored and confirmed', expectedVersion: v });
  const a2 = await call('support', 'cc-support-update', { requestId: rid1, scope: store.scope, id: t1.ticket.id, status: 'resolved', reason: 'Hero restored and confirmed', expectedVersion: v });
  assert.equal(a2.replayed, true); assert.equal(a2.version, a1.version, 'a retried staff write applies once'); v = a1.version;
  await assert.rejects(call('support', 'cc-support-update', { requestId: rid(), id: t1.ticket.id, status: 'closed', reason: 'Missing scope field', expectedVersion: v }), status(409), 'a page for another scope or none cannot write');

  // ---- A reply reopens a resolved ticket; closed is final for everybody ----
  const reopened = await sayTo('bob', t1.ticket.id, 'It happened again today.');
  assert.equal(reopened.ticket.status, 'submitted'); assert.equal((await ticketRow(t1.ticket.id)).settled, null, 'a reopened ticket is no longer settled');
  v = reopened.ticket.version;
  await staff('support', 'cc-support-update', { id: t1.ticket.id, status: 'closed', reason: 'Closing after confirmation', expectedVersion: v });
  await assert.rejects(sayTo('bob', t1.ticket.id), because(409, /closed/), 'the player cannot answer a closed ticket');
  await assert.rejects(staff('support', 'cc-support-reply', { id: t1.ticket.id, message: 'Too late', expectedVersion: v + 1 }), because(409, /closed ticket is final/));
  await assert.rejects(staff('operator', 'cc-support-note', { id: t1.ticket.id, message: 'Not even a note' }), because(409, /closed ticket is final/));
  await assert.rejects(staff('owner', 'cc-support-update', { id: t1.ticket.id, status: 'submitted', reason: 'Owner cannot reopen either', expectedVersion: v + 1 }), status(409));

  // ---- Limits: 3 tickets per 24 hours, 5 open at once ----
  const eve = 'dave';
  now += 2 * DAY;
  await open(eve, { subject: 'First ticket' }); await open(eve, { subject: 'Second ticket' }); await open(eve, { subject: 'Third ticket' });
  await assert.rejects(open(eve, { subject: 'Fourth ticket' }), because(429, /already sent 3 tickets in the last 24 hours/));
  const daveRid = rid(); await assert.rejects(open(eve, { requestId: daveRid, subject: 'Fourth ticket' }), status(429));
  now += DAY + 1000; await open(eve, { subject: 'Fourth ticket, a day later' }); await open(eve, { subject: 'Fifth ticket' });
  now += DAY + 1000; await assert.rejects(open(eve, { subject: 'Sixth ticket' }), because(429, /already have 5 open tickets/), 'five open tickets at once is the cap');
  const daveTickets = (await call(eve, 'support-state')).support.tickets, dOldest = daveTickets.at(-1);
  await staff('support', 'cc-support-update', { id: dOldest.id, status: 'resolved', reason: 'Resolved by support', expectedVersion: dOldest.version });
  await open(eve, { subject: 'Sixth ticket, one resolved' });   // settled tickets do not count as open
  assert.equal((await call(eve, 'support-state')).support.tickets.length, 6);

  // ---- Limits: 20 replies per day, 60 messages per ticket (internal notes do not count) ----
  now += 2 * DAY;
  const long = (await open('carol', { subject: 'A long conversation' })).ticket;
  for (let i = 0; i < 30; i++) await staff('support', 'cc-support-note', { id: long.id, message: 'Internal note number ' + i });   // 30 notes: must not eat the player's 60
  let sent = 1;
  for (let day = 0; day < 3; day++) {
    const day0 = now;
    for (let i = 0; i < 20 && sent < 60; i++) { now = day0 + i * 1000; await sayTo('carol', long.id, 'Reply number ' + (sent + 1)); sent += 1; }
    if (sent < 60) { now = day0 + 20 * 1000; await assert.rejects(sayTo('carol', long.id, 'Too many today'), because(429, /many messages today/), 'the 21st reply in a day is refused'); now = day0 + DAY + 60000; }
  }
  assert.equal(sent, 60); now += 1000;
  await assert.rejects(sayTo('carol', long.id, 'Message sixty-one'), because(429, /message limit/), 'a ticket holds at most 60 messages');
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM ryo_support_messages WHERE ticket_id=$1 AND kind<>'note'", [long.id])).rows[0].n), 60);

  // ---- Audit: the chain records who did what, never the text ----
  const audit = (await call('owner', 'cc-audit', { limit: 100, prefix: 'cc.support' })).data.entries;
  assert(audit.length >= 8); assert(audit.every(e => e.hashValid));
  const repAudit = audit.find(e => e.action === 'cc.support.reply');
  assert.equal(repAudit.data.length, [...STAFF_TEXT].length); assert.equal(repAudit.data.sha256, undefined, 'no hash of the reply text is kept'); assert.equal(repAudit.data.role, 'support');
  const noteAudit = audit.find(e => e.action === 'cc.support.note'); assert.equal(noteAudit.data.sha256, undefined); assert(audit.filter(e => e.action === 'cc.support.note').some(e => e.data.length === [...SECRET_NOTE].length), 'a note records its length');
  assert(audit.every(e => e.data.sha256 === undefined), 'no support audit record keeps a hash of the text');
  const auditJson = JSON.stringify((await call('owner', 'cc-audit', { limit: 100 })).data.entries);
  for (const text of [STAFF_TEXT, SECRET_NOTE, 'It happened again today.', 'Reply number 5']) assert(!auditJson.includes(text), 'no ticket text in the audit chain: ' + text);
  assert(audit.some(e => e.action === 'cc.support.update' && e.data.reason && e.data.to), 'status changes keep their reason');
  assert.deepEqual((await call('support', 'cc-audit')).data.entries.map(e => e.action).filter(a => !a.startsWith('cc.')), [], 'Support sees only its own cc.* records');

  // ---- Retention: 30 days after resolved or closed; open tickets are kept ----
  now += 5 * DAY;
  const keep = (await open('bob', { subject: 'Keep me open', message: 'This one stays open for a long time.' })).ticket;
  const gone = (await open('bob', { subject: 'Resolved soon', message: 'Plain text that will expire later.', reference: 'bob-purchase-000001' })).ticket;
  await staff('support', 'cc-support-reply', { id: gone.id, message: 'Staff text that will expire later.', status: 'resolved', expectedVersion: gone.version });
  const gone2 = (await open('bob', { subject: 'Also resolved', message: 'Second plain text that expires.' })).ticket;
  await staff('support', 'cc-support-update', { id: gone2.id, status: 'resolved', reason: 'Resolved without a reply', expectedVersion: gone2.version });
  const settledAt = Number((await ticketRow(gone.id)).settled);
  now = settledAt + 29 * DAY; assert.equal((await call('support', 'cc-support-list', { status: 'all' })).data.tickets.find(t => t.id === gone.id).expired, false, 'still readable on day 29');
  assert.equal((await call('bob', 'support-view', { id: gone.id })).messages[0].text, 'Plain text that will expire later.');
  now = settledAt + 31 * DAY + 5;
  // Nothing has redacted gone2 yet: a staff write is refused outright, and the player's read never shows the old text.
  assert.equal((await ticketRow(gone2.id)).redacted, null);
  await assert.rejects(staff('support', 'cc-support-note', { id: gone2.id, message: 'Late note' }), because(409, /expired/), 'a due ticket cannot be changed even before the retention run');
  assert.equal((await call('bob', 'support-view', { id: gone2.id })).messages[0].text, '[expired]', 'a read applies retention first');
  // The reply races the retention run: nothing may be added to a ticket that expires right now.
  await assert.rejects(sayTo('bob', gone.id, 'I only saw this today.'), because(409, /expired/), 'a reply at expiry is refused, not stored');
  const expired = (await call('bob', 'support-view', { id: gone.id }));
  assert.equal(expired.ticket.subject, '[expired]'); assert.equal(expired.ticket.expired, true); assert.equal(expired.ticket.reference, null);
  assert.deepEqual(expired.messages.map(m => m.text), ['[expired]', '[expired]'], 'every message text is replaced');
  assert.equal((await pool.query('SELECT body FROM ryo_support_messages WHERE ticket_id=$1', [gone.id])).rows.every(r => r.body === '[expired]'), true, 'including internal notes and the stored rows');
  await assert.rejects(staff('support', 'cc-support-reply', { id: gone.id, message: 'Too late now', expectedVersion: gone.version + 1 }), because(409, /expired/));
  await assert.rejects(staff('support', 'cc-support-note', { id: gone.id, message: 'Too late now' }), because(409, /expired/));
  const stillOpen = await call('bob', 'support-view', { id: keep.id });
  assert.equal(stillOpen.ticket.subject, 'Keep me open'); assert.equal(stillOpen.messages[0].text, 'This one stays open for a long time.', 'open tickets are kept');
  const kept = (await call('support', 'cc-support-list', { status: 'all' })).data.tickets.find(t => t.id === keep.id); assert.equal(kept.expired, false);
  assert.equal((await call('support', 'cc-support-list', { status: 'all' })).data.tickets.find(t => t.id === gone.id).subject, '[expired]');
  await call('support', 'cc-support-list');   // idempotent
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_support_tickets WHERE redacted IS NOT NULL')).rows[0].n > 0), 1);

  // ---- No economic mutation from any support action ----
  const after = await ledger();
  assert.deepEqual({ ...after, b: Number(after.b) }, { ...before, b: Number(before.b) }, 'balances, purchases, deposits, withdrawals and reward claims are untouched');
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_accounts WHERE scope=$1 AND wallet = ANY($2)', [store.scope, [W.bob, W.carol, W.dave]])).rows[0].n), 0, 'sending tickets never creates or locks a money account');
  if (envBefore === undefined) delete process.env.SUPPORT_TICKETS_ENABLED; else process.env.SUPPORT_TICKETS_ENABLED = envBefore;
  await db.close();
  console.log('PASS: Support tickets: switch, validation, limits, order-reference ownership, idempotency, reopen/closed rules, notes and staff wallets hidden from players, staff role matrix, audit without text, 30-day retention and no economic mutation.');
})().catch(e => { console.error(e); process.exitCode = 1; });
