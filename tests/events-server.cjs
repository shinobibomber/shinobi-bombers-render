'use strict';
/* Command Center Events through the real service dispatcher, Store and schema on PGlite (isolated fixtures only).
   Staff: role matrix, propose then a DIFFERENT wallet reviews (or the same one only while ADMIN_SELF_APPROVAL is on, as on live), version and content-hash binding,
   idempotency, text rules (EN required, PT pair, no links, no reward words in either language), schedule rules (10-minute lead,
   180 days ahead, 5 minutes to 30 days long), 7-day proposal expiry, caps, unpublish, audit (title and hash, never the text).
   Player: the read action shows only approved events that are live or upcoming, in the requested language, with no wallet, reason or
   hash; it obeys the switch; and nothing economic changes anywhere (no rewards exist in the data model). */
const assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..'), { Keypair } = require('../app/node_modules/@solana/web3.js');
const { Store, hash } = require('../app/server/store.cjs'), { createService, GENESIS } = require('../app/server/service.cjs');
const E = require('../app/server/events.cjs');
const DAY = 86400000, HOUR = 3600000, MINUTE = 60000;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const RLO = String.fromCharCode(0x202e), BEL = String.fromCharCode(7);
// The files as they were pinned before Events: reversing the Events additions must give them back byte for byte, and service.cjs is untouched.
const PREVIOUS = { service: '94995dca6f7b7e827a8091a4fd07a927d27e5d3b6d285976030b2845468e6658', schema: '0d152797522ff9348ea3ff9bb3b7d99b579299787c66ea07774442ddb2e538f9' };
(function buildIntegrity() {
  const { SCHEMA_MARKER } = require('../apply-events.cjs');
  assert.equal(sha(fs.readFileSync(path.join(root, 'app/server/service.cjs'))), PREVIOUS.service, 'service.cjs is byte for byte as before: no Events hook');
  const schemaSql = fs.readFileSync(path.join(root, 'app/server/schema.sql'), 'utf8'), at = schemaSql.indexOf('\n' + SCHEMA_MARKER);
  assert.equal(schemaSql.split('\n' + SCHEMA_MARKER).length - 1, 1, 'one Events schema block'); assert(schemaSql.slice(at).includes(require('../events/server.cjs').SCHEMA.replace(/\r\n/g, '\n')), 'the block is the Events schema');
  assert.equal(sha(Buffer.from(schemaSql.slice(0, at), 'utf8')), PREVIOUS.schema, 'schema.sql: only the additive Events block was added at the end');
  assert.equal(fs.readFileSync(path.join(root, 'app/server/events.cjs'), 'utf8'), fs.readFileSync(path.join(root, 'events/server.cjs'), 'utf8'), 'the built server module is the source module');
  assert.equal(fs.readFileSync(path.join(root, 'app/server/command-center.cjs'), 'utf8'), fs.readFileSync(path.join(root, 'command-center/server.cjs'), 'utf8'), 'the built Command Center is the source');
})();
(async () => {
  const envBefore = { sw: process.env.EVENTS_BOARD_ENABLED, self: process.env.ADMIN_SELF_APPROVAL };
  const db = new PGlite(), schema = fs.readFileSync(path.join(root, 'app/server/schema.sql'), 'utf8');
  await db.exec(schema); await db.exec(schema);   // the additive schema (Events table included) is idempotent
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  let now = Date.UTC(2026, 10, 12, 12, 0, 0);
  const store = new Store(pool, 'events-test', () => now);
  const names = ['treasury', 'studio', 'revenue', 'mint', 'owner', 'approver', 'operator', 'viewer', 'moderator', 'support', 'alice', 'bob', 'stranger'];
  const K = Object.fromEntries(names.map(n => [n, Keypair.generate()])), W = Object.fromEntries(names.map(n => [n, K[n].publicKey.toBase58()]));
  process.env.RYO_ADMIN_OWNERS = W.owner; process.env.RYO_ADMIN_APPROVERS = W.approver; process.env.RYO_ADMIN_OPERATORS = W.operator; process.env.RYO_ADMIN_VIEWERS = W.viewer;
  delete process.env.EVENTS_BOARD_ENABLED;   // default: ON
  const connection = { async getGenesisHash() { return GENESIS; } };
  const service = createService({ store, connection, treasury: K.treasury, mint: W.mint, origin: 'http://127.0.0.1', studioAddress: W.studio, revenueAddress: W.revenue });
  const tokens = {};
  for (const n of names) { tokens[n] = 'events-session-' + n; await pool.query('INSERT INTO ryo_sessions(scope,token_hash,wallet,expires) VALUES($1,$2,$3,$4)', [store.scope, hash(tokens[n]), W[n], now + 400 * DAY]); }
  const call = (n, action, body = {}) => service.handle(action, body, tokens[n]);
  let seq = 0; const rid = () => 'events-request-' + String(++seq).padStart(8, '0');
  const status = code => e => e.status === code, because = (code, re) => e => e.status === code && re.test(e.message);
  const staff = (n, action, body) => (now += 50, call(n, action, { requestId: rid(), scope: store.scope, ...body }));
  const content = () => ({ kind: 'event', titleEn: 'Ninja Night', bodyEn: 'Meet at the Dojo for a community evening. Bring your friends.', titlePt: 'Noite Ninja', bodyPt: 'Encontre-nos no Dojo para uma noite da comunidade. Traga seus amigos.', startsAt: now + 2 * HOUR, endsAt: now + 4 * HOUR });
  const propose = (n, over = {}) => staff(n, 'cc-event-propose', { ...content(), noRewards: true, reason: 'Community evening, text checked', ...over });
  const find = async id => (await call('owner', 'cc-events')).data.events.find(e => e.id === id);
  const decide = async (n, id, approve, over = {}) => { const ev = await find(id); return staff(n, 'cc-event-review', { id, approve, expectedVersion: ev.version, contentSha256: ev.contentSha256, ...(approve ? { noRewards: true } : {}), reason: 'Read the text twice, it is fine', ...over }); };
  const approved = async (over = {}) => { const p = await propose('moderator', over); await decide('owner', p.id, true); return p.id; };
  const upcoming = (n, lang) => call(n, 'cc-events-upcoming', lang ? { lang } : {});
  const quiet = () => { now += 2 * MINUTE; };   // staff writes are limited to 30 a minute per wallet
  const ledger = async () => (await pool.query('SELECT (SELECT COALESCE(SUM(balance),0) FROM ryo_accounts WHERE scope=$1) AS b,(SELECT COUNT(*) FROM ryo_purchases WHERE scope=$1) AS p,(SELECT COUNT(*) FROM ryo_withdrawals WHERE scope=$1) AS w,(SELECT COUNT(*) FROM ryo_adventures WHERE scope=$1) AS a,(SELECT COUNT(*) FROM ryo_profiles WHERE scope=$1) AS pr', [store.scope])).rows[0];

  // Roles: the Owner grants Moderator and Support through the Command Center, as in production.
  await staff('owner', 'cc-role-grant', { wallet: W.moderator, role: 'moderator', reason: 'Moderator who proposes events', expectedVersion: 0 });
  await staff('owner', 'cc-role-grant', { wallet: W.support, role: 'support', reason: 'Support without event access', expectedVersion: 1 });
  await pool.query('INSERT INTO ryo_accounts(scope,wallet,balance) VALUES($1,$2,500000)', [store.scope, W.alice]);
  const before = await ledger();

  // ---- Role matrix ----
  for (const n of ['owner', 'operator', 'moderator', 'viewer']) assert.deepEqual((await call(n, 'cc-events')).data.events, [], n + ' can read events');
  for (const n of ['approver', 'support', 'alice', 'stranger']) await assert.rejects(call(n, 'cc-events'), status(403), n + ' cannot read events');
  for (const n of ['approver', 'viewer', 'support', 'alice']) await assert.rejects(propose(n), status(403), n + ' cannot propose');
  const first = await propose('moderator');
  assert.equal(first.status, 'pending'); assert.equal(first.version, 0); assert.match(first.contentSha256, /^[0-9a-f]{64}$/);
  for (const n of ['moderator', 'viewer', 'support', 'approver', 'alice']) await assert.rejects(decide(n, first.id, true), status(403), n + ' cannot review');
  for (const n of ['moderator', 'viewer', 'support', 'approver', 'alice']) await assert.rejects(staff(n, 'cc-event-unpublish', { id: first.id, expectedVersion: 0, reason: 'Not allowed to do this' }), status(403));
  assert.equal((await find(first.id)).status, 'pending', 'refused reviews changed nothing');
  const viewerSees = (await call('viewer', 'cc-events')).data.events[0];
  assert.equal(viewerSees.proposer.includes('…'), true, 'staff wallets are shortened'); assert.equal(viewerSees.mine, false);
  assert.equal((await call('moderator', 'cc-events')).data.events[0].mine, true, 'the proposer sees which events are theirs');
  assert.equal(JSON.stringify(viewerSees).includes(W.moderator), false, 'no full wallet in the staff list');

  // ---- Validation: text, schedule, attestation ----
  quiet();
  const bad = (over, re, code = 400) => assert.rejects(propose('moderator', over), because(code, re));
  await bad({ kind: 'prize-day' }, /Choose a kind/);
  await bad({ titleEn: 'ab' }, /English title must be 3 to 80/);
  await bad({ titleEn: 'x'.repeat(81) }, /English title must be 3 to 80/);
  await bad({ bodyEn: 'too short' }, /English text must be 10 to 1000/);
  await bad({ bodyEn: 'x'.repeat(1001) }, /English text must be 10 to 1000/);
  await bad({ titleEn: undefined }, /English title is required/);
  await bad({ bodyPt: null }, /Portuguese title and text together/);
  await bad({ titlePt: '' }, /Portuguese title and text together/);
  await bad({ bodyEn: 'Join us at https://scam.example now please' }, /links are not allowed/);
  await bad({ bodyEn: 'Visit www.scam-site.com for details' }, /links are not allowed/);
  await bad({ titleEn: 'Free stuff at scam.xyz' }, /links are not allowed/);
  await bad({ bodyPt: 'Acesse https://golpe.example para saber mais' }, /links are not allowed/);
  for (const text of ['Win a big prize tonight', 'The top ten win rewards', 'A giveaway for everyone', 'Free Ryo for all players', 'Airdrop day at the Dojo', 'Weekly raffle night', 'Huge payout for winners']) await bad({ bodyEn: text + ' at the Dojo' }, /cannot mention rewards/);
  for (const text of ['Ganhe uma recompensa especial', 'Concorra a um prêmio incrível', 'Participe do sorteio de hoje', 'Receba um brinde exclusivo']) await bad({ bodyPt: text + ' no Dojo' }, /cannot mention rewards/);
  await bad({ titleEn: 'Reward Night' }, /cannot mention rewards/);
  // Hardening after the independent review: markup, invisible characters, look-alikes, leetspeak, compounds, synonyms, short and spelled-out domains.
  const SHY = String.fromCharCode(0xad), VS16 = String.fromCharCode(0xfe0f), CYR = String.fromCharCode(0x435), IDEO = String.fromCharCode(0x3002);
  for (const t of ['Tonight <b>bold</b> event at the Dojo', 'An <img src=x> event at the Dojo', 'Dojo > everything else tonight']) await bad({ bodyEn: t }, /plain text only/);
  for (const t of ['rew' + SHY + 'ard day', 'rew' + VS16 + 'ard day', 'r' + CYR + 'ward day', String.fromCharCode(0xff52, 0xff45, 0xff57, 0xff41, 0xff52, 0xff44) + ' day', 'r3ward day', 're-ward day', 'r e w a r d day', 'Prizepool night', '100Ryo each', 'Free hero for everyone', 'Double bonus night', 'A gift for all', 'NFT holders only', 'Open the Chest together', 'Fusion Shards night', 'Win a hero', 'Hero Pass night', 'Earn more tonight', 'Double drop night']) await bad({ bodyEn: t + ' at the Dojo' }, /cannot mention rewards/);
  for (const t of ['Pr' + String.fromCharCode(0xe9) + 'mio especial hoje', 'Evento gr' + String.fromCharCode(0xe1) + 'tis para todos', 'Ganhe um her' + String.fromCharCode(0xf3) + 'i', 'Ba' + String.fromCharCode(0xfa) + ' aberto hoje']) await bad({ bodyPt: t + ' no Dojo' }, /cannot mention rewards/);
  for (const t of ['Join t.me/dojo tonight', 'Follow x.com/dojo tonight', 'Watch youtu.be/abc tonight', 'See dojo.club tonight', 'Visit scam dot com now', 'Go to 192.168.1.1 tonight', 'Run javascript:alert(1) now', 'Visit scam' + IDEO + 'com tonight']) await bad({ bodyEn: t + ' at the Dojo' }, /links are not allowed/);
  // ...and ordinary event text with colons, times and abbreviations is still accepted.
  assert.equal((await propose('moderator', { titleEn: 'Dojo evening', bodyEn: 'Meet at 18:00 in the Dojo. Where: the main hall. Everyone is welcome, e.g. new players, until 9 p.m.' })).status, 'pending');
  await bad({ noRewards: undefined }, /promises no reward/); await bad({ noRewards: 'yes' }, /promises no reward/); await bad({ noRewards: false }, /promises no reward/);
  await bad({ reason: 'short' }, /reason of 8 to 500/);
  await bad({ startsAt: now + 5 * MINUTE, endsAt: now + HOUR }, /at least 10 minutes/);
  await bad({ startsAt: now - HOUR, endsAt: now + HOUR }, /at least 10 minutes/);
  await bad({ startsAt: now + 181 * DAY, endsAt: now + 181 * DAY + HOUR }, /more than 180 days/);
  await bad({ startsAt: now + 2 * HOUR, endsAt: now + 2 * HOUR }, /end time must be after/);
  await bad({ startsAt: now + 2 * HOUR, endsAt: now + HOUR }, /end time must be after/);
  await bad({ startsAt: now + 2 * HOUR, endsAt: now + 2 * HOUR + 4 * MINUTE }, /5 minutes to 30 days/);
  await bad({ startsAt: now + 2 * HOUR, endsAt: now + 2 * HOUR + 31 * DAY }, /5 minutes to 30 days/);
  await bad({ startsAt: 'tomorrow', endsAt: now + HOUR }, /start and an end time/);
  await bad({ startsAt: 1.5e12 + 0.5 }, /start and an end time/);
  assert.equal((await call('owner', 'cc-events')).data.events.length, 2, 'invalid input stored nothing (only the first proposal and the ordinary-text one exist)');
  await assert.rejects(staff('moderator', 'cc-event-propose', { ...content(), noRewards: true, reason: 'Community evening, text checked', requestId: 'short' }), /request ID/);
  await assert.rejects(call('moderator', 'cc-event-propose', { ...content(), noRewards: true, reason: 'Community evening, text checked', requestId: rid(), scope: 'another-scope' }), because(409, /different game network or scope/));
  // Edge values that ARE allowed: the 10-minute lead, 180 days ahead, 5 minutes and 30 days long.
  quiet();
  await propose('moderator', { titleEn: 'Edge short', startsAt: now + 10 * MINUTE + 100, endsAt: now + 15 * MINUTE + 100 });
  await propose('moderator', { titleEn: 'Edge long', startsAt: now + 180 * DAY - 1000, endsAt: now + 210 * DAY - 1000 });
  // Cleaning: control and bidi characters become spaces, line breaks stay (one blank line at most), markup is kept as plain text.
  const dirty = await propose('moderator', { titleEn: '  Dojo' + RLO + '   night' + BEL + ' ', bodyEn: 'Line one' + BEL + '\r\n\r\n\r\n\r\nLine two   with   spaces', titlePt: null, bodyPt: null });
  const dirtyRow = await find(dirty.id);
  assert.equal(dirtyRow.titleEn, 'Dojo night'); assert.equal(dirtyRow.bodyEn, 'Line one\n\nLine two with spaces'); assert.equal(dirtyRow.titlePt, null);

  // ---- Two-person review ----
  quiet();
  const owned = await propose('owner', { titleEn: 'Owner proposal' }), opProp = await propose('operator', { titleEn: 'Operator proposal' });
  // One-wallet approval OFF (unset, or any falsy value): the proposer can never review their own event.
  for (const off of [undefined, 'off', '0', 'false', '']) {
    if (off === undefined) delete process.env.ADMIN_SELF_APPROVAL; else process.env.ADMIN_SELF_APPROVAL = off;
    await assert.rejects(decide('owner', owned.id, true), because(403, /different authorized wallet/), 'the Owner cannot approve their own event (' + off + ')');
    await assert.rejects(decide('owner', owned.id, false), because(403, /different authorized wallet/), 'nor reject it');
    await assert.rejects(decide('operator', opProp.id, true), because(403, /different authorized wallet/), 'the Operator cannot approve their own event');
  }
  assert.equal((await call('owner', 'cc-events')).data.selfApproval, false, 'the staff list says one-wallet approval is off');
  delete process.env.ADMIN_SELF_APPROVAL;
  // One-wallet approval ON (owner decision 2026-11-12, how live runs): the proposer may review their own event. Every other rule still applies.
  process.env.ADMIN_SELF_APPROVAL = 'on';
  assert.equal((await call('owner', 'cc-events')).data.selfApproval, true, 'the staff list says one-wallet approval is on');
  quiet(); const solo = await propose('owner', { titleEn: 'Solo owner event' }), soloRej = await propose('operator', { titleEn: 'Solo reject event' });
  const soloEv = await find(solo.id);
  await assert.rejects(staff('owner', 'cc-event-review', { id: solo.id, approve: true, expectedVersion: soloEv.version, contentSha256: soloEv.contentSha256, reason: 'No attestation on purpose' }), /promises no reward/, 'the no-reward confirmation is still required');
  await assert.rejects(staff('owner', 'cc-event-review', { id: solo.id, approve: true, expectedVersion: soloEv.version, contentSha256: '0'.repeat(64), noRewards: true, reason: 'Wrong hash on purpose' }), because(409, /not what you reviewed/), 'the content hash is still bound');
  await assert.rejects(staff('owner', 'cc-event-review', { id: solo.id, approve: true, expectedVersion: 9, contentSha256: soloEv.contentSha256, noRewards: true, reason: 'Wrong version on purpose' }), because(409, /changed/), 'and so is the version');
  assert.equal((await decide('owner', solo.id, true)).status, 'approved', 'the Owner approves their own event');
  assert.equal((await decide('operator', soloRej.id, false)).status, 'rejected', 'the Operator rejects their own event');
  await assert.rejects(decide('operator', soloRej.id, true), because(409, /already reviewed/), 'a rejected event still cannot be approved');
  assert.equal((await upcoming('alice')).events.some(e => e.title === 'Solo owner event'), true, 'a self-approved event is shown to players');
  await staff('operator', 'cc-event-unpublish', { id: solo.id, expectedVersion: 1, reason: 'Solo test event, withdrawn' });
  delete process.env.ADMIN_SELF_APPROVAL;
  await assert.rejects(decide('owner', owned.id, true), because(403, /different authorized wallet/), 'switching it off restores the two-wallet rule');
  const ev = await find(first.id);
  await assert.rejects(staff('owner', 'cc-event-review', { id: first.id, approve: true, expectedVersion: 7, contentSha256: ev.contentSha256, noRewards: true, reason: 'Wrong version on purpose' }), because(409, /changed/));
  await assert.rejects(staff('owner', 'cc-event-review', { id: first.id, approve: true, expectedVersion: 0, contentSha256: '0'.repeat(64), noRewards: true, reason: 'Wrong hash on purpose' }), because(409, /not what you reviewed/));
  await assert.rejects(staff('owner', 'cc-event-review', { id: first.id, approve: true, expectedVersion: 0, noRewards: true, reason: 'No hash on purpose' }), /contentSha256 is required/);
  await assert.rejects(staff('owner', 'cc-event-review', { id: first.id, approve: true, expectedVersion: 0, contentSha256: ev.contentSha256, reason: 'No attestation here' }), /promises no reward/);
  await assert.rejects(staff('owner', 'cc-event-review', { id: first.id, approve: true, expectedVersion: 0, contentSha256: ev.contentSha256, noRewards: true, reason: 'short' }), /reason of 8 to 500/);
  await assert.rejects(staff('owner', 'cc-event-review', { id: first.id, approve: 'yes', expectedVersion: 0, contentSha256: ev.contentSha256, noRewards: true, reason: 'Not a boolean' }), /approve or reject/);
  await assert.rejects(staff('owner', 'cc-event-review', { id: 9999, approve: true, expectedVersion: 0, contentSha256: ev.contentSha256, noRewards: true, reason: 'No such event here' }), status(409));
  assert.deepEqual(await upcoming('alice'), { enabled: true, serverTime: now, events: [] }, 'nothing is shown to players while pending or after refused reviews');
  const ok = await decide('owner', first.id, true);
  assert.equal(ok.status, 'approved'); assert.equal(ok.version, 1);
  const reqId = rid(), sameBody = { id: opProp.id, approve: true, expectedVersion: 0, contentSha256: (await find(opProp.id)).contentSha256, noRewards: true, reason: 'Approved by the Owner', requestId: reqId, scope: store.scope };
  const a1 = await call('owner', 'cc-event-review', sameBody), a2 = await call('owner', 'cc-event-review', sameBody);
  assert.equal(a1.status, 'approved'); assert.equal(a2.replayed, true, 'a repeated request ID returns the stored result'); assert.equal((await find(opProp.id)).version, 1, 'a replay never reviews twice');
  await assert.rejects(call('owner', 'cc-event-unpublish', { ...sameBody, id: opProp.id, expectedVersion: 1, reason: 'Different action same ID' }), because(409, /already used for a different action/));
  await assert.rejects(decide('operator', first.id, false), because(409, /unavailable or already reviewed/), 'an event is reviewed once');
  const rejected = await decide('operator', owned.id, false); assert.equal(rejected.status, 'rejected');
  await assert.rejects(decide('operator', owned.id, true), because(409, /already reviewed/), 'a rejected event cannot be approved later');
  assert.equal((await find(owned.id)).reviewReason, 'Read the text twice, it is fine');

  // ---- Player read ----
  const rows = (await upcoming('alice')).events.map(e => e.id).sort((a, b) => a - b);
  assert.deepEqual(rows, [first.id, opProp.id].sort((a, b) => a - b), 'only approved events are shown');
  const en = (await upcoming('alice')).events.find(e => e.id === first.id);
  assert.deepEqual(Object.keys(en).sort(), ['body', 'endsAt', 'id', 'kind', 'lang', 'live', 'startsAt', 'title'].sort(), 'only public fields');
  assert.equal(en.lang, 'en'); assert.equal(en.title, 'Ninja Night'); assert.equal(en.live, false, 'upcoming events are not live');
  const pt = (await upcoming('alice', 'pt')).events.find(e => e.id === first.id);
  assert.equal(pt.lang, 'pt'); assert.equal(pt.title, 'Noite Ninja'); assert.match(pt.body, /Encontre-nos/);
  const noPt = (await upcoming('alice', 'pt')).events.find(e => e.id === opProp.id);   // the Operator's proposal has the default PT text; make one without
  assert.equal(noPt.lang, 'pt');
  quiet(); const enOnly = await approved({ titleEn: 'English only', titlePt: null, bodyPt: null });
  const fallback = (await upcoming('alice', 'pt')).events.find(e => e.id === enOnly);
  assert.equal(fallback.lang, 'en', 'Portuguese falls back to English when there is no PT text'); assert.equal(fallback.title, 'English only');
  assert.equal((await upcoming('alice', 'fr')).events.find(e => e.id === first.id).lang, 'en', 'an unknown language is English');
  for (const tag of ['pt-BR', 'pt-br', 'pt_BR', 'PT']) assert.equal((await upcoming('alice', tag)).events.find(e => e.id === first.id).lang, 'pt', tag + ' is Portuguese');
  for (const tag of ['ptx', 'portuguese', 5, null, {}]) assert.equal((await upcoming('alice', tag)).events.find(e => e.id === first.id).lang, 'en', JSON.stringify(tag) + ' is English');
  const dump = JSON.stringify(await upcoming('alice', 'pt'));
  for (const secret of [...Object.values(W), 'Community evening, text checked', 'Read the text twice', ok.contentSha256 || 'none']) assert.equal(dump.includes(secret), false, 'no wallet, reason or hash reaches a player: ' + String(secret).slice(0, 12));
  for (const n of ['stranger', 'bob', 'viewer', 'owner']) assert.equal((await upcoming(n)).events.length, 3, n + ' reads the same list');
  await assert.rejects(service.handle('cc-events-upcoming', {}, 'not-a-session'), status(401), 'sign-in is required');
  await assert.rejects(upcoming('treasury'), because(403, /Custody/), 'custody wallets stay out of the Command Center namespace');
  // Schedule: live from the start time, gone after the end, and shown only inside the 60-day horizon.
  now = en.startsAt; assert.equal((await upcoming('alice')).events.find(e => e.id === first.id).live, true, 'live from its start time');
  now = en.endsAt - 1; assert.equal((await upcoming('alice')).events.some(e => e.id === first.id), true, 'still shown until its end');
  now = en.endsAt; assert.equal((await upcoming('alice')).events.some(e => e.id === first.id), false, 'gone once it ends');
  assert.equal((await find(first.id)).phase, 'ended');
  quiet(); const far = await approved({ titleEn: 'Far away', startsAt: now + 100 * DAY, endsAt: now + 100 * DAY + HOUR });
  assert.equal((await upcoming('alice')).events.some(e => e.id === far), false, 'beyond 60 days is not shown yet');
  now += 41 * DAY; assert.equal((await upcoming('alice')).events.some(e => e.id === far), true, 'it appears inside the 60-day horizon');
  // A foreign scope never leaks in.
  await pool.query("INSERT INTO ryo_cc_events(scope,kind,title_en,body_en,starts_at,ends_at,content_sha256,status,proposer,reason,created) VALUES('other-scope','event','Other scope','Text from another scope here',$1,$2,$3,'approved','x','y',$4)", [now + HOUR, now + 2 * HOUR, '0'.repeat(64), now]);
  assert.equal((await upcoming('alice')).events.some(e => e.title === 'Other scope'), false, 'events are scoped');
  // The switch: OFF shows nothing to players, staff still manage events.
  process.env.EVENTS_BOARD_ENABLED = 'off';
  assert.deepEqual(await upcoming('alice'), { enabled: false, events: [] }); assert((await call('owner', 'cc-events')).data.events.length > 0, 'staff are not affected by the player switch');
  process.env.EVENTS_BOARD_ENABLED = 'on'; assert.equal((await upcoming('alice')).enabled, true);

  // ---- Stale proposals: a started or expired proposal cannot be approved, but can be rejected ----
  quiet();
  const soon = await propose('moderator', { titleEn: 'Starts soon', startsAt: now + 15 * MINUTE, endsAt: now + 2 * HOUR });
  now += 16 * MINUTE; assert.equal((await find(soon.id)).phase, 'stale');
  await assert.rejects(decide('owner', soon.id, true), because(409, /start time has already passed/));
  assert.equal((await decide('owner', soon.id, false)).status, 'rejected', 'a stale proposal can be rejected to clear the queue');
  quiet(); const old = await propose('moderator', { titleEn: 'Old proposal', startsAt: now + 30 * DAY, endsAt: now + 30 * DAY + HOUR });
  now += 7 * DAY + MINUTE; assert.equal((await find(old.id)).phase, 'stale');
  await assert.rejects(decide('owner', old.id, true), because(409, /expired/));
  assert.equal((await decide('operator', old.id, false)).status, 'rejected');

  // ---- Unpublish ----
  quiet();
  const live = await approved({ titleEn: 'To unpublish', startsAt: now + HOUR, endsAt: now + 3 * HOUR });
  const pending = await propose('moderator', { titleEn: 'Still pending' });
  await assert.rejects(staff('operator', 'cc-event-unpublish', { id: pending.id, expectedVersion: 0, reason: 'It is only pending' }), because(409, /Only an approved event/));
  await assert.rejects(staff('operator', 'cc-event-unpublish', { id: live, expectedVersion: 5, reason: 'Stale page on purpose' }), because(409, /changed/));
  await assert.rejects(staff('operator', 'cc-event-unpublish', { id: live, expectedVersion: 1, reason: 'short' }), /reason of 8 to 500/);
  assert.equal((await upcoming('alice')).events.some(e => e.id === live), true);
  const un = await staff('operator', 'cc-event-unpublish', { id: live, expectedVersion: 1, reason: 'Wrong time announced' });
  assert.equal(un.status, 'unpublished'); assert.equal((await upcoming('alice')).events.some(e => e.id === live), false, 'players stop seeing it');
  assert.equal((await find(live)).unpublishReason, 'Wrong time announced', 'the record stays');
  await assert.rejects(staff('operator', 'cc-event-unpublish', { id: live, expectedVersion: 2, reason: 'Already unpublished' }), because(409, /Only an approved event/));
  const done = await approved({ titleEn: 'Will end', startsAt: now + 11 * MINUTE, endsAt: now + 30 * MINUTE }); now += HOUR;
  await assert.rejects(staff('owner', 'cc-event-unpublish', { id: done, expectedVersion: 1, reason: 'Too late for this one' }), because(409, /already ended/));

  // ---- Caps ----
  quiet();
  // Stale pending rows (expired, or already started) hold no slot and never push approved events out of the staff list.
  for (let k = 0; k < 110; k++) await pool.query("INSERT INTO ryo_cc_events(scope,kind,title_en,body_en,starts_at,ends_at,content_sha256,status,proposer,reason,created) VALUES($1,'event',$2,'Abandoned proposal text',$3,$4,$5,'pending','x','y',$6)", [store.scope, 'Abandoned ' + k, now + 50 * DAY, now + 51 * DAY, '2'.repeat(64), now - 8 * DAY]);
  assert((await find(far)) !== undefined, 'an approved event stays in the staff list behind 110 abandoned proposals');
  assert.equal((await call('owner', 'cc-events')).data.events.filter(e => e.phase === 'stale').length > 0, true, 'and stale proposals are still listed');
  const rowsBefore = Number((await pool.query("SELECT COUNT(*) AS n FROM ryo_cc_events WHERE scope=$1 AND status='pending' AND created>$2 AND starts_at>$3", [store.scope, now - 7 * DAY, now])).rows[0].n);
  for (let i = rowsBefore; i < 20; i++) { if (i % 10 === 0) quiet(); await propose('moderator', { titleEn: 'Queue filler ' + i }); }
  await assert.rejects(propose('moderator', { titleEn: 'One too many' }), because(429, /Twenty events are already waiting/));
  await pool.query("UPDATE ryo_cc_events SET status='rejected' WHERE scope=$1 AND status='pending'", [store.scope]);
  const target = await (async () => { quiet(); return propose('moderator', { titleEn: 'Cap target', startsAt: now + 10 * DAY, endsAt: now + 10 * DAY + HOUR }); })();
  for (let i = 0; i < 50; i++) await pool.query("INSERT INTO ryo_cc_events(scope,kind,title_en,body_en,starts_at,ends_at,content_sha256,status,proposer,reason,created) VALUES($1,'event',$2,'Filler text for the cap',$3,$4,$5,'approved','x','y',$6)", [store.scope, 'Filler ' + i, now + 20 * DAY, now + 21 * DAY, '1'.repeat(64), now]);
  await assert.rejects(decide('owner', target.id, true), because(429, /Fifty approved events/));
  assert.equal((await upcoming('alice')).events.length <= 20, true, 'the player list is capped at 20');
  assert.equal((await find(target.id)).status, 'pending', 'a refused approval changed nothing');

  // ---- Audit: every write is on the chain with the title and a hash, never the body text ----
  const audit = (await call('owner', 'cc-audit', { prefix: 'cc.event', limit: 100 })).data.entries;
  const kinds = new Set(audit.map(e => e.action)); for (const k of ['cc.event.proposed', 'cc.event.approved', 'cc.event.rejected', 'cc.event.unpublished']) assert(kinds.has(k), k + ' is audited');
  assert(audit.every(e => e.hashValid), 'every record verifies');
  const approvedRec = audit.find(e => e.action === 'cc.event.approved' && e.data.titleEn === 'Ninja Night');
  assert.equal(approvedRec.data.contentSha256, ev.contentSha256); assert.equal(approvedRec.data.proposer, W.moderator); assert.equal(approvedRec.actor, W.owner);
  const selfRecs = audit.filter(e => e.data.selfReviewed === true); assert.equal(selfRecs.length, 2, 'self-reviews are marked in the audit chain'); assert(selfRecs.every(e => e.actor === e.data.proposer), 'and the reviewer is the proposer');
  assert.equal(audit.filter(e => e.action !== 'cc.event.proposed' && e.data.selfReviewed === undefined && e.data.proposer === e.actor).length, 0, 'no other review by the proposer exists');
  const auditText = JSON.stringify(audit); for (const body of ['community evening', 'Encontre-nos', 'Line one']) assert.equal(auditText.includes(body), false, 'the body text never enters the audit chain: ' + body);
  assert.deepEqual(Object.keys((await call('owner', 'cc-session')).data).includes('permissions'), true);
  const perms = (await call('moderator', 'cc-session')).data.permissions; assert(perms.includes('event.propose') && perms.includes('event.read') && !perms.includes('event.review'));
  assert.equal((await call('approver', 'cc-session')).data.permissions.some(p => p.startsWith('event.')), false, 'the Approver has no event permission');

  // ---- No economic mutation: an event has no reward, and nothing here touched money ----
  assert.deepEqual(await ledger(), before, 'balances, purchases, withdrawals, Chest and profiles are unchanged');
  const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='ryo_cc_events'")).rows.map(r => r.column_name);
  assert.equal(cols.some(c => /reward|prize|ryo|amount|balance|sol|audience|nft/i.test(c)), false, 'the Events table has no reward, amount or audience column: ' + cols.join(','));

  if (envBefore.sw === undefined) delete process.env.EVENTS_BOARD_ENABLED; else process.env.EVENTS_BOARD_ENABLED = envBefore.sw;
  if (envBefore.self === undefined) delete process.env.ADMIN_SELF_APPROVAL; else process.env.ADMIN_SELF_APPROVAL = envBefore.self;
  console.log('PASS events-server: roles, two-person review, text and schedule rules, player read, caps, audit, no economic change.');
})().catch(e => { console.error(e); process.exitCode = 1; });
