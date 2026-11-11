'use strict';
/* Command Center Batch A through the real dispatcher, Store and schema on PGlite: Game configuration status (cc-config), Security
 * center (cc-security) with the incident register (cc-incidents / cc-incident-open / cc-incident-update), and the Creators summary
 * (cc-creators). Covers the role matrix, aggregates only (no wallet, secret or environment value in any answer), tamper detection
 * on the audit chain and the switch log, the incident rules (two writers only, stale version, closed is final, idempotency, caps),
 * and that the three views never write. Isolated fixtures only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..'), { Keypair } = require('../app/node_modules/@solana/web3.js');
const { Store, hash } = require('../app/server/store.cjs'), { createService, GENESIS } = require('../app/server/service.cjs');
(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'app/server/schema.sql'), 'utf8'));
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  let now = Date.UTC(2026, 10, 12, 12);
  const store = new Store(pool, 'cc-views-test', () => now);
  const treasury = Keypair.generate(), K = () => Keypair.generate().publicKey.toBase58();
  const names = ['studio', 'revenue', 'mint', 'owner', 'approver', 'operator', 'viewer', 'moderator', 'support', 'outsider', 'creatorA', 'creatorB', 'player'];
  const W = Object.fromEntries(names.map(n => [n, K()])); W.treasury = treasury.publicKey.toBase58();
  process.env.RYO_ADMIN_OWNERS = W.owner; process.env.RYO_ADMIN_APPROVERS = W.approver; process.env.RYO_ADMIN_OPERATORS = W.operator; process.env.RYO_ADMIN_VIEWERS = W.viewer;
  const SECRET = 'SECRET-SENTINEL-9f3a', HOLD = 'hold-text-sentinel-77';
  process.env.RYO_TREASURY_SECRET = SECRET; process.env.GAME_LAUNCH_HOLD = HOLD; process.env.DATABASE_URL = 'postgres://user:pw-sentinel@host/db'; delete process.env.ADMIN_SELF_APPROVAL;
  const connection = new Proxy({ async getGenesisHash() { return GENESIS; } }, { get: (o, k) => o[k] || (async () => { throw Error('unexpected RPC call: ' + String(k)); }) });
  const service = createService({ store, connection, treasury, mint: W.mint, origin: 'http://127.0.0.1', studioAddress: W.studio, revenueAddress: W.revenue });
  const tokens = {};
  for (const n of ['owner', 'approver', 'operator', 'viewer', 'moderator', 'support', 'outsider', 'treasury', 'studio']) {
    tokens[n] = 'ccv-session-' + n; await pool.query('INSERT INTO ryo_sessions(scope,token_hash,wallet,expires) VALUES($1,$2,$3,$4)', [store.scope, hash(tokens[n]), W[n], now + 365 * 86400000]);
  }
  await pool.query("INSERT INTO ryo_cc_roles(scope,wallet,role,granted_by,reason,created) VALUES($1,$2,'moderator',$3,'fixture',$4),($1,$5,'support',$3,'fixture',$4)", [store.scope, W.moderator, W.owner, now, W.support]);
  const call = (n, action, body = {}) => service.handle(action, body, tokens[n]);
  let seq = 0; const w = (n, action, body = {}) => call(n, action, { requestId: 'ccv-request-' + String(++seq).padStart(6, '0'), scope: store.scope, ...body });
  const status = code => e => e.status === code;
  const count = async t => Number((await pool.query(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n);

  /* 1. Role matrix. */
  for (const n of ['owner', 'approver', 'operator', 'viewer']) assert.equal((await call(n, 'cc-config')).status, 'ready', n + ' reads the configuration status');
  for (const n of ['owner', 'approver', 'operator']) for (const a of ['cc-security', 'cc-creators', 'cc-incidents']) assert.equal((await call(n, a)).status, 'ready', n + ' ' + a);
  for (const n of ['moderator', 'support', 'outsider', 'treasury', 'studio']) for (const a of ['cc-config', 'cc-security', 'cc-creators', 'cc-incidents']) await assert.rejects(call(n, a), status(403), n + ' is refused ' + a);
  for (const a of ['cc-security', 'cc-creators', 'cc-incidents']) await assert.rejects(call('viewer', a), status(403), 'viewers are refused ' + a);
  const sess = await call('viewer', 'cc-session'); assert.ok(sess.data.permissions.includes('config.read') && !sess.data.permissions.includes('security.read'));
  assert.ok((await call('operator', 'cc-session')).data.permissions.includes('security.manage')); assert.ok(!(await call('approver', 'cc-session')).data.permissions.includes('security.manage'));

  /* 2. Game configuration status: switches, release, gates; no secret, wallet or environment value. */
  const before = { audit: await count('ryo_admin_audit'), requests: await count('ryo_cc_requests'), switches: await count('ryo_feature_switches') };
  const cfg = (await call('viewer', 'cc-config')).data;
  assert.equal(cfg.switches.status, 'ready'); assert.ok(cfg.switches.list.length >= 20, 'every catalog switch is listed');
  const wd = cfg.switches.list.find(s => s.key === 'withdrawals'); assert.ok(wd && wd.money === true && typeof wd.effective === 'boolean' && wd.envName, 'money switch with its variable NAME');
  assert.equal(cfg.switches.list.find(s => s.group === 'gameplay').money, false);
  assert.ok('hold' in cfg.release && [true, false, null].includes(cfg.release.hold), 'the launch hold is a boolean (or null while the mint is not released), never the hold text'); assert.ok(cfg.gates && typeof cfg.gates.summoning === 'boolean');
  assert.equal(cfg.log.status, 'ready'); assert.equal(cfg.log.intact, true); assert.deepEqual(cfg.log.entries, []);
  const text = JSON.stringify(cfg);
  for (const secret of [SECRET, HOLD, 'pw-sentinel', ...Object.values(W)]) assert.ok(!text.includes(secret), 'configuration status leaks ' + secret.slice(0, 12));
  // A tampered switch-log row is shown as BROKEN and becomes a finding in the Security center.
  await pool.query("INSERT INTO ryo_feature_switch_log(scope,seq,key,enabled,actor,reason,created,version,prev_hash,hash) VALUES($1,1,'dojo',true,$2,'tampered row',$3,1,'genesis','not-a-real-hash')", [store.scope, W.owner, now - 1000]);
  const cfg2 = (await call('owner', 'cc-config')).data; assert.equal(cfg2.log.intact, false); assert.equal(cfg2.log.entries[0].intact, false);
  assert.match(cfg2.log.entries[0].actor, /…/, 'staff wallets are shortened'); assert.ok(!JSON.stringify(cfg2).includes(W.owner));
  assert.ok((await call('owner', 'cc-security')).data.findings.some(f => f.code === 'SWITCH_LOG_CHAIN' && f.severity === 'critical'));
  await pool.query('DELETE FROM ryo_feature_switch_log WHERE scope=$1', [store.scope]);

  /* 3. Incident register: writes by Owner/Operator only, audited, idempotent, versioned. */
  const open = (n, body = {}) => w(n, 'cc-incident-open', { title: 'Odd withdrawal pattern', severity: 'high', details: 'Three withdrawals in a minute.', reason: 'Seen on the Stats report', ...body });
  await assert.rejects(open('approver'), status(403), 'approvers cannot write incidents'); await assert.rejects(open('viewer'), status(403)); await assert.rejects(open('moderator'), status(403));
  for (const [body, re] of [[{ severity: 'urgent' }, /severity/], [{ title: 'ab' }, /title/], [{ title: 'x'.repeat(121) }, /title/], [{ reason: 'short' }, /reason/], [{ details: 'd'.repeat(2001) }, /details/]])
    await assert.rejects(open('owner', body), e => e.status === 400 && re.test(e.message), JSON.stringify(Object.keys(body)));
  await assert.rejects(call('owner', 'cc-incident-open', { title: 'No request id here', severity: 'low', reason: 'A reason long enough' }), status(400));
  now += 1000; const o1 = await open('owner'); assert.deepEqual([o1.ok, o1.id, o1.status, o1.version], [true, 1, 'open', 0]);
  const replay = await call('owner', 'cc-incident-open', { requestId: 'ccv-request-' + String(seq).padStart(6, '0'), scope: store.scope, title: 'Odd withdrawal pattern', severity: 'high', details: 'Three withdrawals in a minute.', reason: 'Seen on the Stats report' });
  assert.equal(replay.replayed, true, 'same request ID replays the stored result'); assert.equal(await count('ryo_cc_incidents'), 1, 'a replay writes nothing');
  now += 1000; const o2 = await open('operator', { title: 'Phishing report in chat', severity: 'critical', details: '' }); assert.equal(o2.id, 2);
  const audit = (await pool.query("SELECT action,actor FROM ryo_admin_audit WHERE scope=$1 AND action LIKE 'cc.incident.%' ORDER BY sequence", [store.scope])).rows;
  assert.deepEqual(audit.map(a => a.action), ['cc.incident.opened', 'cc.incident.opened'], 'every incident write is on the audit chain');
  let list = (await call('owner', 'cc-incidents')).data.incidents; assert.deepEqual(list.map(i => [i.id, i.status, i.severity]), [[2, 'open', 'critical'], [1, 'open', 'high']]);
  assert.ok(list.every(i => /…/.test(i.openedBy)) && !JSON.stringify(list).includes(W.owner), 'staff wallets are shortened');
  assert.deepEqual((await call('owner', 'cc-incidents', { status: 'resolved' })).data.incidents, []);
  const upd = (n, body) => w(n, 'cc-incident-update', { reason: 'Looked at the logs', ...body });
  await assert.rejects(upd('approver', { id: 1, status: 'investigating', expectedVersion: 0 }), status(403));
  await assert.rejects(upd('owner', { id: 1, status: 'open', expectedVersion: 0 }), status(400)); await assert.rejects(upd('owner', { id: 99, status: 'resolved', expectedVersion: 0 }), status(404));
  await assert.rejects(upd('owner', { id: 1, status: 'resolved' }), status(400), 'expectedVersion is required');
  now += 1000; const u1 = await upd('operator', { id: 1, status: 'investigating', expectedVersion: 0 }); assert.deepEqual([u1.status, u1.version], ['investigating', 1]);
  await assert.rejects(upd('owner', { id: 1, status: 'resolved', expectedVersion: 0 }), status(409), 'a stale page is refused');
  await assert.rejects(upd('owner', { id: 1, status: 'investigating', expectedVersion: 1 }), status(409), 'no change to the same status');
  now += 1000; const u2 = await upd('owner', { id: 1, status: 'resolved', expectedVersion: 1, reason: 'False alarm, rate limit working' }); assert.equal(u2.version, 2);
  await assert.rejects(upd('owner', { id: 1, status: 'investigating', expectedVersion: 2 }), status(409), 'a resolved incident is final');
  list = (await call('operator', 'cc-incidents')).data.incidents; assert.equal(list.find(i => i.id === 1).resolution, 'False alarm, rate limit working');
  assert.deepEqual((await call('owner', 'cc-incidents', { status: 'resolved' })).data.incidents.map(i => i.id), [1]);
  assert.deepEqual((await call('owner', 'cc-incidents')).data.incidents.map(i => i.id), [2, 1], 'unresolved incidents are listed before resolved ones');
  // Multi-line details keep their line breaks; control characters are stripped.
  now += 1000; await open('owner', { title: 'Multi-line notes', severity: 'low', details: 'Step 1: check logs\r\nStep 2:\u0000 ask the player\n\n\n\nStep 3: close' });
  assert.equal((await call('owner', 'cc-incidents')).data.incidents.find(i => i.title === 'Multi-line notes').details, 'Step 1: check logs\nStep 2: ask the player\n\nStep 3: close');
  await pool.query("DELETE FROM ryo_cc_incidents WHERE scope=$1 AND title='Multi-line notes'", [store.scope]);
  // Cap on open incidents.
  for (let i = 0; i < 49; i++) await pool.query("INSERT INTO ryo_cc_incidents(scope,title,severity,opener,reason,created,updated,updated_by) VALUES($1,$2,'low',$3,'fixture',$4,$4,$3)", [store.scope, 'filler ' + i, W.owner, now]);
  await assert.rejects(open('owner', { title: 'One too many' }), e => e.status === 429 && /Fifty/.test(e.message));
  await pool.query("DELETE FROM ryo_cc_incidents WHERE scope=$1 AND title LIKE 'filler %'", [store.scope]);

  /* 4. Security center: chains verified, counts only, findings; a tampered audit record is caught. */
  now += 1000;
  let sec = (await call('operator', 'cc-security')).data;
  assert.equal(sec.audit.status, 'ready'); assert.equal(sec.audit.intact, true); assert.equal(sec.audit.complete, true, 'the whole (short) chain was verified'); assert.ok(sec.audit.total >= 4 && sec.audit.checked === sec.audit.total && sec.audit.hashesValid === sec.audit.checked);
  assert.equal(sec.audit.linksIntact, sec.audit.links); assert.equal(sec.switchLog.intact, true);
  assert.deepEqual(sec.roles.environment, { owner: 1, approver: 1, operator: 1, viewer: 1 }); assert.deepEqual(sec.roles.backend, { moderator: { active: 1, revoked: 0 }, support: { active: 1, revoked: 0 } });
  assert.ok(sec.sessions.game >= 9 && sec.sessions.controlPanel === 0);
  await pool.query('DROP TABLE ryo_control_sessions'); const s2 = (await call('operator', 'cc-security')).data.sessions;
  assert.equal(s2.status, 'ready'); assert.ok(s2.game >= 9 && s2.controlPanel === null, 'a missing table only loses its own count'); await pool.query('CREATE TABLE ryo_control_sessions(scope TEXT NOT NULL, token_hash TEXT NOT NULL, wallet TEXT NOT NULL, created BIGINT NOT NULL, expires BIGINT NOT NULL, PRIMARY KEY(scope,token_hash))'); assert.ok(sec.staff.writesLast24h >= 4 && sec.staff.activeStaffLast24h === 2);
  assert.deepEqual([sec.incidents.open, sec.incidents.critical, sec.incidents.high], [1, 1, 0], 'one open (critical) incident remains');
  assert.ok(sec.findings.some(f => f.code === 'CRITICAL_INCIDENT') && !sec.findings.some(f => f.code === 'AUDIT_CHAIN'));
  assert.deepEqual(sec.notRecorded.map(x => x.status), ['not_implemented', 'not_implemented'], 'what the game does not record is said so');
  assert.equal(sec.selfApproval, false); process.env.ADMIN_SELF_APPROVAL = 'on';
  assert.ok((await call('owner', 'cc-security')).data.findings.some(f => f.code === 'SELF_APPROVAL' && f.severity === 'warn'), 'one-wallet approval is reported'); delete process.env.ADMIN_SELF_APPROVAL;
  const stext = JSON.stringify(sec);
  for (const secret of [SECRET, HOLD, 'pw-sentinel', ...Object.values(W)]) assert.ok(!stext.includes(secret), 'security view leaks ' + secret.slice(0, 12));
  assert.ok(sec.audit.recent.every(r => !r.actor || /…/.test(r.actor)), 'recent audit actors are shortened');
  await pool.query("UPDATE ryo_admin_audit SET action='cc.incident.tampered' WHERE scope=$1 AND sequence=(SELECT MIN(sequence) FROM ryo_admin_audit WHERE scope=$1)", [store.scope]);
  sec = (await call('owner', 'cc-security')).data; assert.equal(sec.audit.intact, false, 'a changed audit record fails verification'); assert.ok(sec.findings.some(f => f.code === 'AUDIT_CHAIN' && f.severity === 'critical'));

  /* 5. Creators summary: aggregates only, no name, wallet or application. */
  const empty = (await call('owner', 'cc-creators')).data;
  assert.equal(empty.portalPresent, true); assert.deepEqual(empty.applications.byStatus, {}); assert.equal(empty.creatorPoints.issued, 0);
  const NAME = 'Secret Creator Display Name', APP = 'secret-application-text';
  const creator = (id, wallet, st, balance) => pool.query("INSERT INTO ryo_creators(scope,id,wallet,display_name,status,code,application,created,balance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [store.scope, id, wallet, NAME + ' ' + id, st, 'CODE' + id, JSON.stringify({ about: APP }), now, balance]);
  await creator('c1', W.creatorA, 'APPROVED', 3500); await creator('c2', W.creatorB, 'PENDING', 0); await creator('c3', K(), 'SUSPENDED', 0);
  const ledger = (id, ev, kind, delta) => pool.query('INSERT INTO ryo_creator_ledger(scope,creator_id,event_id,kind,delta,created) VALUES($1,$2,$3,$4,$5,$6)', [store.scope, id, ev, kind, delta, now]);
  await ledger('c1', 'e1', 'milestone', 5000); await ledger('c1', 'e2', 'adventure-commission', 2500); await ledger('c1', 'e3', 'redemption', -3000); await ledger('c1', 'e4', 'adjustment', -1000);
  await pool.query("INSERT INTO ryo_creator_referrals(scope,wallet,creator_id,attributed,paid_mints,qualified) VALUES($1,$2,'c1',$4,2,$4),($1,$3,'c1',$4,0,NULL)", [store.scope, W.player, K(), now]);
  await pool.query("INSERT INTO ryo_creator_program(scope,version,config,created) VALUES($1,3,$2,$3)", [store.scope, JSON.stringify({ applicationsPaused: true, enrollmentLimit: 50, commissionDays: 30 }), now]);
  await pool.query("INSERT INTO ryo_prison_rescues(scope,id,wallet,rank,roll,hero,session,created) VALUES($1,'r1',$2,1,5,'{}','s',$3)", [store.scope, W.player, now]);
  await pool.query("INSERT INTO ryo_creator_audit(scope,actor,action,target,reason,detail,created) VALUES($1,$2,'admin.grant-rescue-hero','anon-1','fixture','{}',$3),($1,$2,'admin.status','anon-1','fixture','{}',$3)", [store.scope, W.owner, now]);
  const cr = (await call('approver', 'cc-creators')).data;
  assert.deepEqual(cr.applications.byStatus, { APPROVED: 1, PENDING: 1, SUSPENDED: 1 }); assert.equal(cr.applications.total, 3);
  assert.deepEqual([cr.creatorPoints.issued, cr.creatorPoints.spent, cr.creatorPoints.adjustmentsNet, cr.creatorPoints.held], [7.5, 3, -1, 3.5], 'milli-points shown as Creator Points');
  assert.deepEqual(cr.creatorPoints.byKind.map(k => [k.kind, k.entries, k.points]), [['adjustment', 1, -1], ['adventure-commission', 1, 2.5], ['milestone', 1, 5], ['redemption', 1, -3]]);
  // A reversed redemption (any kind starting with "redemption") is never counted as newly issued points.
  await pool.query("INSERT INTO ryo_creator_ledger(scope,creator_id,event_id,kind,delta,created) VALUES($1,'c1','e5','redemption-reversal',3000,$2)", [store.scope, now]);
  const afterReversal = (await call('approver', 'cc-creators')).data.creatorPoints; assert.deepEqual([afterReversal.issued, afterReversal.spent], [7.5, 0], 'a reversal is netted from spent, not added to issued');
  await pool.query("DELETE FROM ryo_creator_ledger WHERE scope=$1 AND event_id='e5'", [store.scope]);
  assert.deepEqual(cr.referrals.creator, { total: 2, qualified: 1, paidMints: 2 }); assert.equal(cr.referrals.player.total, 0);
  assert.deepEqual([cr.rescues.total, cr.rescues.staffGrants], [1, 1]); assert.deepEqual([cr.program.version, cr.program.applicationsPaused, cr.program.enrollmentLimit, cr.program.commissionDays], [3, true, 50, 30]);
  assert.equal(cr.notImplemented[0].status, 'not_implemented');
  const ctext = JSON.stringify(cr);
  for (const secret of [NAME, APP, 'CODEc1', ...Object.values(W)]) assert.ok(!ctext.includes(secret), 'creators summary leaks ' + secret.slice(0, 14));
  // Missing optional tables degrade per section, not the whole answer.
  await pool.query('DROP TABLE ryo_pass_balances, ryo_pass_entitlements, ryo_pass_campaigns CASCADE');
  const degraded = (await call('owner', 'cc-creators')).data; assert.equal(degraded.applications.status, 'ready'); assert.equal(degraded.heroPasses.balances, null); assert.equal(degraded.creatorPoints.issued, 7.5);

  /* 6. The views never write: only the incident actions changed state. */
  assert.equal(await count('ryo_feature_switches'), before.switches, 'no switch was changed');
  console.log('PASS: Command Center Batch A — config status, Security center + incident register, Creators summary: role matrix, aggregates only, no secrets or wallets, tamper detection, versioned audited incident writes, per-section degradation.');
})().catch(e => { console.error(e); process.exitCode = 1; });
