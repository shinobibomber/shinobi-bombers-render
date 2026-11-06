/* Boss Hunt server rules on the real store (in-memory Postgres): the 10,000 Ryo entry through the
 * purchase flow (1,000 burned, 9,000 to the day's pool), one open hunt, damage capped by elapsed time
 * and the team's top damage, refunded entries never counting, daily settlement paying the top 10
 * 30/20/12/9/7/6/5/4/4/3% (rescaled when fewer played), pending fees delaying it, carry-over, and
 * the purchases pause. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../app/server');
const economy = require(path.join(root, 'economy.cjs')), { Store } = require(path.join(root, 'store.cjs')), hunt = require(path.join(root, 'boss-hunt.cjs'));
const { guard } = require(path.join(root, 'economic-dashboard.cjs'));
const DAY = 86400000, START = Date.parse('2030-01-10T08:00:00Z');
const hero = (id, rank, pw) => ({ tokenId: id, rank, level: 1, name: 'Hero ' + id, baseStats: { pw, sp: pw, st: pw } });
const rejects = async (promise, pattern, message) => { await assert.rejects(promise, e => pattern.test(e.message), message); };

(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  let clock = START; const store = new Store(pool, 'test-hunt', () => clock);
  const setup = (wallet, heroes, balance = 1_000_000) => store.transaction(async c => { await store.locked(c, wallet); await c.query('UPDATE ryo_accounts SET balance=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, balance]); await store.profileLocked(c, wallet);
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(economy.normalizeProfile({ dojo: 0, heroes, battleReady: heroes.map(h => h.tokenId) }))]); });
  const balance = async w => Number((await store.pool.query('SELECT balance FROM ryo_accounts WHERE scope=$1 AND wallet=$2', [store.scope, w])).rows[0].balance);
  const tx = []; let serial = 0;
  // The service's hunt-enter flow: checks, the purchase (fee reserve + signed burn), then the entry.
  const enter = async (wallet, name = '') => { await hunt.beforeEnter(store, wallet); const id = 'hunt-' + (++serial);
    const row = await store.purchase(wallet, id, 'hunt', {}, hunt.FEE, async q => { tx.push(q); return { signature: 'H' + serial + 'x'.repeat(80), wire: 'd2lyZQ==', lastHeight: 1 }; });
    return { row, entry: await hunt.record(store, wallet, row, { name }) }; };
  const confirm = (wallet, entry) => store.settlePurchase(wallet, entry.id, 'confirmed');
  const report = (wallet, entry, damage) => hunt.report(store, wallet, { entryId: entry.id, damage });

  // Entry: the fee is 10,000 total: 8,000 to the prize pool, 1,000 treasury, 1,000 burned.
  const strong = [hero('s1', 4, 15), hero('s2', 4, 15), hero('s3', 3, 12), hero('s4', 3, 12), hero('s5', 2, 9), hero('s6', 0, 1)];
  await setup('alice', strong);
  const a1 = await enter('alice', 'Alice<script>');
  assert.deepEqual([tx[0].total, tx[0].burn, tx[0].prize, tx[0].studioFee, tx[0].treasury, tx[0].operations], [10000, 1000, 8000, 0, 1000, 0]);
  assert.equal(await balance('alice'), 990000, 'the entrance fee is taken');
  assert.equal(a1.entry.guardian, hunt.guardianOf('2030-01-10'), "today's guardian");
  await rejects(enter('alice'), /Finish your current hunt/, 'one open hunt at a time');
  // Damage is capped by elapsed time and the team's top damage; the highest report is kept.
  const cap = hunt.teamCap(economy.normalizeProfile({ heroes: strong, battleReady: strong.map(h => h.tokenId) }));
  clock += 30000; let r = await report('alice', a1.entry, 1e9);
  assert(r.capped && r.damage <= 30 * cap.dps * 1.1 + cap.volley && r.damage > 0 && hunt.HUNT_SECONDS === 60, 'reported damage is capped by 30 seconds of the team');
  r = await report('alice', a1.entry, 10); assert.equal(r.damage > 10, true, 'a lower report never reduces kept damage');
  clock += 60000; r = await report('alice', a1.entry, 20000); assert.equal(r.damage, 20000, 'real damage within the cap is kept');
  clock += 10 * 60000; assert.equal((await report('alice', a1.entry, 30000)).closed, true, 'late reports are ignored');
  await confirm('alice', a1.entry);
  // Board: the pool, ranking and my stats; the name is cleaned.
  let b = (await hunt.board(store, 'alice')).hunt;
  assert.equal(b.pool, 8000); assert.equal(b.top[0].damage, 20000); assert.equal(b.top[0].name, 'Alicescript'); assert.equal(b.me.rank, 1); assert.equal(b.me.entries, 1);
  // A second entry adds up; a refunded one never counts.
  const a2 = await enter('alice'); clock += 90000; await report('alice', a2.entry, 5000); await confirm('alice', a2.entry);
  const a3 = await enter('alice'); clock += 90000; await report('alice', a3.entry, 7000); await store.settlePurchase('alice', a3.entry.id, 'refunded');
  b = (await hunt.board(store, 'alice')).hunt;
  assert.equal(b.me.damage, 25000, 'damage adds up across finalized entries only'); assert.equal(b.pool, 16000, 'a refunded entry adds nothing to the pool');
  assert.equal(await balance('alice'), 980000, 'the refunded fee came back');

  // Eleven more players on the same day; one fee is still pending at midnight.
  for (let i = 0; i < 11; i++) { const w = 'p' + i; await setup(w, strong); const { entry } = await enter(w); clock += 90000; await report(w, entry, 1000 * (i + 1)); if (i !== 10) await confirm(w, entry); }
  clock = Date.parse('2030-01-11T00:06:00Z'); await hunt.settleDue(store);
  assert.equal((await store.pool.query("SELECT settled FROM ryo_hunt_days WHERE scope=$1 AND day='2030-01-10'", [store.scope])).rows[0].settled, false, 'a pending fee delays settlement');
  await confirm('p10', { id: 'hunt-' + serial });
  const before = await Promise.all(['alice', 'p9', 'p8', 'p0'].map(balance));
  await hunt.settleDue(store); await hunt.settleDue(store);
  const pot = 13 * 8000, shares = hunt.prizes(pot);
  assert.deepEqual(shares, [31200, 20800, 12480, 9360, 7280, 6240, 5200, 4160, 4160, 3120], '30/20/12/9/7/6/5/4/4/3 of the pool');
  const after = await Promise.all(['alice', 'p9', 'p8', 'p0'].map(balance));
  assert.deepEqual(after.map((v, i) => v - before[i]), [shares[0], shares[2], shares[3], 0], 'the top 10 are paid once; 11th place gets nothing');
  const paid = (await store.pool.query("SELECT SUM(amount) AS n, COUNT(*) AS c FROM ryo_hunt_payouts WHERE scope=$1 AND day='2030-01-10'", [store.scope])).rows[0];
  assert.deepEqual([Number(paid.n), Number(paid.c)], [pot, 10], 'the whole pool is paid to exactly 10 players');
  b = (await hunt.board(store, 'p0')).hunt;
  assert.equal(b.yesterday.winners.length, 10); assert.equal(b.yesterday.winners[0].name, 'Alicescript', 'yesterday winners are listed');

  // Fewer than 10 players: the shares are rescaled so the whole pool is paid.
  const b1 = await enter('p1'); clock += 90000; await report('p1', b1.entry, 500); await confirm('p1', b1.entry);
  const b2 = await enter('p2'); clock += 90000; await report('p2', b2.entry, 900); await confirm('p2', b2.entry);
  const p1Before = await balance('p1'), p2Before = await balance('p2');
  clock = Date.parse('2030-01-12T00:06:00Z'); await hunt.settleDue(store);
  assert.deepEqual([await balance('p2') - p2Before, await balance('p1') - p1Before], [Math.floor(16000 * 30 / 50) + (16000 - Math.floor(16000 * 30 / 50) - Math.floor(16000 * 20 / 50)), Math.floor(16000 * 20 / 50)], '2 players share 30:20 of the pool');
  // A day with entries but no damage carries its pool to the next day.
  const c1 = await enter('p3'); clock += 1000; await confirm('p3', c1.entry);
  clock = Date.parse('2030-01-13T00:06:00Z'); await hunt.settleDue(store);
  assert.equal((await hunt.board(store, 'p3')).hunt.pool, 8000, "the unwon pool carries into today's pool");
  // Weekly (Mon 2030-01-07 – Sun 01-13): daily places give points 10…1. Day 10: alice 1st, p10 2nd … p2 10th;
  // day 11: p2 1st, p1 2nd. Weekly: p2 11, alice 10, p10 9 = p1 9 (p10 has more damage), p9 8 … p4 3.
  assert.equal(hunt.weekOf('2030-01-13'), '2030-01-07'); assert.equal(hunt.weekOf('2030-01-07'), '2030-01-07');
  let wk = (await hunt.board(store, 'p2')).hunt.weekly;
  assert.deepEqual(wk.top.slice(0, 4).map(w => [w.name, w.points]), [['p2…p2', 11], ['Alicescript', 10], ['p10…p10', 9], ['p1…p1', 9]], 'weekly standings by points, ties by damage');
  assert.deepEqual([wk.me.rank, wk.me.points, wk.me.prize], [1, 11, 'Legend hero']);
  await setup('p4', Array.from({ length: 500 }, (_, i) => hero('full-' + i, 0, 1)), 0); // a full collection
  const heroesBefore = {}; for (const w of ['p2', 'alice', 'p10', 'p1', 'p9', 'p3']) heroesBefore[w] = (await store.profile(w)).heroes.length;
  clock = Date.parse('2030-01-14T00:06:00Z'); await hunt.settleDue(store); await hunt.settleDue(store);
  const awards = (await store.pool.query("SELECT * FROM ryo_hunt_awards WHERE scope=$1 AND week='2030-01-07' ORDER BY rank", [store.scope])).rows;
  assert.deepEqual(awards.map(a => [a.wallet, a.points, a.hero_rank]), [['p2', 11, 4], ['alice', 10, 4], ['p10', 9, 4], ['p1', 9, 3], ['p9', 8, 3], ['p8', 7, 3], ['p7', 6, 3], ['p6', 5, 3], ['p5', 4, 3], ['p4', 3, 3]], 'top 3 win Legends, 4th–10th Elites, once');
  for (const w of ['p2', 'alice', 'p10']) { const p = await store.profile(w); assert.equal(p.heroes.length, heroesBefore[w] + 1); assert.equal(p.heroes.at(-1).rank, 4, w + ' received a Legend'); assert.equal(p.heroes.at(-1).perks.length, 5); }
  assert.equal((await store.profile('p1')).heroes.at(-1).rank, 3, '4th received an Elite');
  assert.equal((await store.profile('p3')).heroes.length, heroesBefore.p3, '11th receives nothing');
  assert.equal(awards[9].granted, false, 'a full collection keeps the weekly hero waiting');
  await setup('p4', Array.from({ length: 10 }, (_, i) => hero('room-' + i, 0, 1)), 0);
  assert.equal((await hunt.board(store, 'p4')).hunt.weekly.waiting, 0, 'the waiting hero is added once there is room');
  assert.equal((await store.profile('p4')).heroes.filter(h => h.rank === 3).length, 1);
  wk = (await hunt.board(store, 'p2')).hunt.weekly;
  assert.deepEqual([wk.last.week, wk.last.winners[0].prize, wk.last.winners[3].prize], ['2030-01-07', 'Legend hero', 'Elite hero'], "last week's winners are listed");
  // Pausing purchases pauses new entries; the board stays available.
  await store.pool.query("INSERT INTO ryo_admin_control(scope,version,config,pauses,installed) VALUES($1,1,'{}',$2,$3)", [store.scope, JSON.stringify({ purchases: true }), clock]);
  await rejects(guard(store, 'hunt-enter', 'p4', { requestId: 'new' }), /paused/); await guard(store, 'hunt-board', 'p4', {});
  await db.close();
  console.log('PASS: Boss Hunt entry (10,000 Ryo: 8,000 pool, 1,000 treasury, 1,000 burned), one open hunt, elapsed/team damage caps, refunded entries excluded, top-10 daily settlement with exact shares (80% pool, 10% treasury, 10% burn), pending delay, rescaling, carry-over, weekly points with Legend/Elite awards (ties, waiting for room, once) and the purchases pause.');
})().catch(error => { console.error(error); process.exitCode = 1; });
