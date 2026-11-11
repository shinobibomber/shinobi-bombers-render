'use strict';
/* Command Center "Stats report" tab (cc-stats-report), through the real service dispatcher, Store and schema on PGlite.
 * Covers the role matrix (Owner/Approver/Operator/Viewer yes; Moderator/Support/no role/custody no), input checks, the
 * report figures, the 60-second cache, one report at a time (a second identical request shares it, a different one gets
 * 429), the pool client always released, aggregates only (no wallet in the answer) and read-only SQL. Isolated fixtures only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..'), { Keypair } = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), { createService, GENESIS } = require('../app/server/service.cjs'), { hash } = require('../app/server/store.cjs');
(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'app/server/schema.sql'), 'utf8'));
  // Pool shim. Each client logs its statements; `gate` (when set) holds report queries until released.
  const clients = []; let gate = null, released = 0, releasedWithError = 0;
  const pool = { query: (s, a) => db.query(s, a), async connect() {
    const log = []; clients.push(log);
    return { async query(s, a) { log.push(String(s).trim()); if (gate && /^SELECT/.test(String(s).trim()) && log[0]?.startsWith('BEGIN ISOLATION')) await gate.wait; return db.query(s, a); }, release(err) { released++; if (err) releasedWithError++; } };
  } };
  const H = 3600000, LAUNCH = Date.UTC(2026, 10, 9, 14, 40);
  let now = LAUNCH + 30 * H;
  const store = new Store(pool, 'cc-stats-test', () => now);
  const treasury = Keypair.generate(), K = () => Keypair.generate().publicKey.toBase58();
  const names = ['studio', 'revenue', 'mint', 'owner', 'approver', 'operator', 'viewer', 'moderator', 'support', 'outsider', 'player'];
  const W = Object.fromEntries(names.map(n => [n, K()])); W.treasury = treasury.publicKey.toBase58();
  process.env.RYO_ADMIN_OWNERS = W.owner; process.env.RYO_ADMIN_APPROVERS = W.approver; process.env.RYO_ADMIN_OPERATORS = W.operator; process.env.RYO_ADMIN_VIEWERS = W.viewer;
  const connection = new Proxy({ async getGenesisHash() { return GENESIS; } }, { get: (o, k) => o[k] || (async () => { throw Error('unexpected RPC call: ' + String(k)); }) });
  const service = createService({ store, connection, treasury, mint: W.mint, origin: 'http://127.0.0.1', studioAddress: W.studio, revenueAddress: W.revenue });
  const tokens = {};
  for (const n of ['owner', 'approver', 'operator', 'viewer', 'moderator', 'support', 'outsider', 'treasury', 'studio']) {
    tokens[n] = 'ccs-session-' + n; await pool.query('INSERT INTO ryo_sessions(scope,token_hash,wallet,expires) VALUES($1,$2,$3,$4)', [store.scope, hash(tokens[n]), W[n], now + 365 * 86400000]);
  }
  await pool.query("INSERT INTO ryo_cc_roles(scope,wallet,role,granted_by,reason,created) VALUES($1,$2,'moderator',$3,'fixture',$4),($1,$5,'support',$3,'fixture',$4)", [store.scope, W.moderator, W.owner, now, W.support]);
  const call = (n, body = {}) => service.handle('cc-stats-report', body, tokens[n]);
  const status = code => e => e.status === code;

  // Fixture: a deposit and two confirmed summons after launch, one before launch.
  await pool.query("INSERT INTO ryo_deposits(scope,signature,wallet,amount,request_id,created,gross,studio_fee) VALUES($1,'SigDep',$2,500000,'dep1',$3,500000,0)", [store.scope, W.player, LAUNCH + H]);
  const buy = (id, created, outputs) => pool.query(`INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created)
    VALUES($1,$2,$3,'summon','{"quantity":${outputs.length}}','{"treasury":12500,"burn":0}',$4,'{}',$5,$6,'w',1,'confirmed',$7)`,
    [store.scope, W.player, id, JSON.stringify({ outputs: outputs.map(rank => ({ rank })) }), 25000 * outputs.length, 'Sig' + id, created]);
  await buy('b1', LAUNCH + 2 * H, [0, 0, 1, 4, 2]); await buy('b2', LAUNCH + 20 * H, [3]); await buy('b0', LAUNCH - H, [4]);
  const since = LAUNCH;

  // 1. Role matrix.
  for (const n of ['owner', 'approver', 'operator', 'viewer']) { now += 61000; const r = await call(n, { since }); assert.equal(r.status, 'ready', n); assert.equal(r.data.totals.summons.heroes, 6, n); }
  for (const n of ['moderator', 'support', 'outsider']) await assert.rejects(call(n, { since }), status(403), n + ' is refused');
  await assert.rejects(call('treasury', { since }), status(403), 'custody wallet is refused');
  await assert.rejects(call('studio', { since }), status(403), 'studio wallet is refused');
  const session = await service.handle('cc-session', {}, tokens.viewer);
  assert.ok(session.data.permissions.includes('stats.read'), 'the viewer session lists stats.read');
  assert.ok(!(await service.handle('cc-session', {}, tokens.moderator)).data.permissions.includes('stats.read'), 'moderators do not get stats.read');

  // 2. Input checks (400, plain messages).
  for (const [body, re] of [
    [{}, /start time/], [{ since: 'yesterday' }, /start time/], [{ since: Date.UTC(2025, 11, 31) }, /1 Jan 2026/], [{ since: now + H }, /in the past/],
    [{ since, until: since }, /end time/], [{ since, until: now + 2 * 60000 }, /end time/], [{ since, bucket: 'week' }, /hour or day/],
    [{ since: now - 40 * 86400000, bucket: 'hour' }, /31 days/],
  ]) await assert.rejects(call('owner', body), e => e.status === 400 && re.test(e.message), JSON.stringify(body));
  now += 61000; assert.equal((await call('owner', { since: now - 40 * 86400000, bucket: 'day' })).data.bucket, 'day', 'Day grouping allows long ranges');

  // 3. Figures, the until cut-off, aggregates only.
  now += 61000;
  const full = (await call('viewer', { since })).data;
  assert.deepEqual([full.totals.summons.orders, full.totals.summons.heroes, full.totals.ryoSpent.ryo, full.totals.deposits.ryo], [2, 6, 150000, 500000]);
  assert.deepEqual(full.rarity.summon, { Genin: 2, Chunin: 1, Jonin: 1, Elite: 1, Legend: 1 });
  assert.equal(full.since, new Date(since).toISOString()); assert.equal(full.until, new Date(now + 1).toISOString());
  const early = (await call('viewer', { since, until: LAUNCH + 10 * H })).data;
  assert.deepEqual([early.totals.summons.orders, early.totals.summons.heroes], [1, 5], 'until is an exclusive cut-off');
  const text = JSON.stringify(full);
  for (const w of Object.values(W)) assert.ok(!text.includes(w), 'no wallet in the report');
  assert.ok(!/Sig|dep1|"b1"/.test(text), 'no signature or request id in the report');

  // 4. Cache: the same request within 60 s is reused; after 60 s it runs again.
  const runs = () => clients.filter(l => l[0]?.startsWith('BEGIN ISOLATION')).length;
  const before = runs();
  const again = await call('owner', { since });
  assert.equal(again.data.cached, true, 'second request within 60 s is served from the cache'); assert.equal(runs(), before, 'no new database run');
  now += 60001;
  const fresh = await call('owner', { since });
  assert.equal(fresh.data.cached, undefined); assert.equal(runs(), before + 1, 'expired cache runs again');

  // 5. One report at a time: the same request shares the run; a different one gets 429.
  now += 61000;
  let open; gate = { wait: new Promise(r => { open = r; }) };
  const startedBefore = runs(), a = call('owner', { since }), b = call('viewer', { since });
  for (let i = 0; runs() === startedBefore; i++) { if (i > 500) throw Error('the report never started'); await new Promise(r => setTimeout(r, 5)); }
  await assert.rejects(call('operator', { since, bucket: 'day' }), e => e.status === 429 && /already being generated/.test(e.message), 'a different report waits its turn');
  open(); gate = null;
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual(ra.data.totals, rb.data.totals, 'identical requests get the same report');
  assert.equal(runs(), before + 2, 'only one database run for the two identical requests');
  now += 61000; assert.equal((await call('operator', { since, bucket: 'day' })).status, 'ready', 'next report runs once the first is done');

  // 6. A failing run releases its client and frees the slot.
  now += 61000; const failing = pool.connect; let broke = false;
  pool.connect = async () => { const c = await failing(); return { ...c, query: async (s, a) => { if (!broke && /^SELECT COUNT\(\*\) AS n FROM ryo_players/.test(String(s).trim())) { broke = true; throw Error('boom'); } return c.query(s, a); } }; };
  await assert.rejects(call('owner', { since }), /boom/);
  pool.connect = failing;
  now += 61000; assert.equal((await call('owner', { since })).status, 'ready', 'the slot is free again after a failure');

  // 7. Read-only: every report client issued only BEGIN … READ ONLY, SELECTs and ROLLBACK, and was released.
  const reportClients = clients.filter(l => l[0]?.startsWith('BEGIN ISOLATION'));
  for (const log of reportClients) {
    assert.equal(log[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); assert.equal(log.at(-1), 'ROLLBACK');
    for (const s of log.slice(1, -1)) assert.match(s, /^SELECT\b/, 'only SELECT: ' + s.slice(0, 60));
  }
  assert.equal(released, clients.length, 'every pool client was released');
  assert.equal(releasedWithError, 1, 'the client of the failed run was released with its error (dropped from the pool)');
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM ryo_purchases WHERE scope=$1', [store.scope])).rows[0].n, 3, 'nothing written');

  console.log('PASS: Command Center Stats report — Owner/Approver/Operator/Viewer only, custody refused, input checks, until cut-off, 60 s cache, one run at a time (shared / 429), client released on failure, aggregates only, read-only SQL.');
})().catch(e => { console.error(e); process.exitCode = 1; });
