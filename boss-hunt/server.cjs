/* Boss Hunt daily damage rankings (copied to app/server/boss-hunt.cjs by apply-boss-hunt.cjs).
 *
 * Each hunt costs a 10,000 Ryo entrance fee, paid through the token purchase flow: 1,000 (10%) is
 * burned on-chain and 9,000 (90%) goes to that UTC day's prize pool. A hunt is a 90-second damage run
 * with the player's 5 strongest battle-ready heroes (no chakra used). Reported damage is capped by
 * what those heroes can deal in the elapsed time, and only entries whose fee finalized count. When
 * the day ends, the top 10 players by total damage share the pool 30/20/12/9/7/6/5/4/4/3% (rescaled
 * if fewer played); the payouts are credited to their Ryo balances. A day with no damage carries its
 * pool to the next day.
 */
'use strict';
const fail = (...args) => require('./store.cjs').fail(...args);

const FEE = 10000, BURN = 1000, PRIZE = FEE - BURN, HUNT_SECONDS = 90, REPORT_GRACE_MS = 120000, SETTLE_DELAY_MS = 5 * 60000;
const SHARES = [30, 20, 12, 9, 7, 6, 5, 4, 4, 3];
const GUARDIANS = ['Akuma · Fallen Shinobi', 'Yuki Onna · Frozen Moon', 'Raijin · Thunder Lord', 'Daichi · Ancient Golem', 'Orochi · Serpent King'];
const DAY_MS = 86400000;
const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_hunt_entries (
 scope TEXT NOT NULL, id TEXT NOT NULL, wallet TEXT NOT NULL, name TEXT NOT NULL, day TEXT NOT NULL, guardian INTEGER NOT NULL,
 prize BIGINT NOT NULL, damage BIGINT NOT NULL DEFAULT 0, started BIGINT NOT NULL, reported BIGINT, PRIMARY KEY(scope,id)
);
CREATE INDEX IF NOT EXISTS ryo_hunt_entries_day ON ryo_hunt_entries(scope,day,wallet);
CREATE INDEX IF NOT EXISTS ryo_hunt_entries_wallet ON ryo_hunt_entries(scope,wallet,started);
CREATE TABLE IF NOT EXISTS ryo_hunt_days (scope TEXT NOT NULL, day TEXT NOT NULL, carry BIGINT NOT NULL DEFAULT 0, pool BIGINT, settled BOOLEAN NOT NULL DEFAULT FALSE, settled_at BIGINT, PRIMARY KEY(scope,day));
CREATE TABLE IF NOT EXISTS ryo_hunt_payouts (scope TEXT NOT NULL, day TEXT NOT NULL, rank INTEGER NOT NULL, wallet TEXT NOT NULL, name TEXT NOT NULL, damage BIGINT NOT NULL, amount BIGINT NOT NULL, PRIMARY KEY(scope,day,rank));`;

const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
const guardianOf = day => Math.floor(Date.parse(day + 'T00:00:00Z') / DAY_MS) % GUARDIANS.length;
const short = wallet => wallet.slice(0, 4) + '…' + wallet.slice(-4);
const cleanName = name => (typeof name === 'string' ? name : '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 14);
function prizes(pool, players = SHARES.length) {
  const weights = SHARES.slice(0, Math.max(1, Math.min(SHARES.length, players))), total = weights.reduce((a, b) => a + b, 0);
  const out = weights.map(w => Math.floor(pool * w / total)); out[0] += pool - out.reduce((a, b) => a + b, 0);
  return out;
}
// Highest damage per second the 5 strongest battle-ready heroes can deal in a hunt (every volley,
// no chakra): rank+1 projectiles of (trained power + Armor Breaker) per cooldown, Swift Hands applied.
function teamCap(profile) {
  const { trainedStats } = require('./gameplay-options.cjs'), ready = new Set(profile.battleReady || []);
  const rows = profile.heroes.filter(h => ready.has(h.tokenId)).map(h => { const s = trainedStats(h); return { dps: (h.rank + 1) * (Math.max(1, s.pw) + 1) / (Math.max(.6, 1.6 - s.sp * .05) * .85), volley: (h.rank + 1) * (Math.max(1, s.pw) + 1) }; })
    .sort((a, b) => b.dps - a.dps).slice(0, 5);
  return { dps: rows.reduce((n, r) => n + r.dps, 0), volley: rows.reduce((n, r) => n + r.volley, 0) };
}
function quote(version) {
  return { economyVersion: version, product: 'hunt', params: {}, title: 'Boss Hunt entry', base: FEE, total: FEE, studioFee: 0, treasury: 0, burn: BURN, operations: 0, prize: PRIZE };
}
// Run before the fee is taken: one open hunt at a time, and a battle-ready team.
async function beforeEnter(store, wallet) {
  const now = store.now(), open = (await store.pool.query(`SELECT e.id FROM ryo_hunt_entries e JOIN ryo_purchases p ON p.scope=e.scope AND p.wallet=e.wallet AND p.request_id=e.id
    WHERE e.scope=$1 AND e.wallet=$2 AND e.started>$3 AND p.status<>'refunded' LIMIT 1`, [store.scope, wallet, now - HUNT_SECONDS * 1000])).rows[0];
  if (open) fail('Finish your current hunt first.', 409);
  const profile = await store.profile(wallet);
  if (!teamCap(profile).dps) fail('Make at least one hero battle-ready to enter a Boss Hunt.');
}
// Record the hunt for a reserved fee (idempotent on the purchase request ID).
async function record(store, wallet, row, body) {
  const now = store.now(), started = Number(row.created) || now, day = dayOf(started);
  await store.pool.query('INSERT INTO ryo_hunt_days(scope,day) VALUES($1,$2) ON CONFLICT DO NOTHING', [store.scope, day]);
  await store.pool.query('INSERT INTO ryo_hunt_entries(scope,id,wallet,name,day,guardian,prize,started) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
    [store.scope, row.request_id, wallet, cleanName(body.name), day, guardianOf(day), Number(row.quote?.prize ?? PRIZE), started]);
  const e = (await store.pool.query('SELECT * FROM ryo_hunt_entries WHERE scope=$1 AND id=$2', [store.scope, row.request_id])).rows[0];
  return { id: e.id, day: e.day, guardian: e.guardian, guardianName: GUARDIANS[e.guardian], started: Number(e.started), seconds: HUNT_SECONDS };
}
async function report(store, wallet, body) {
  if (typeof body.entryId !== 'string') fail('Choose a hunt.');
  const damage = Math.floor(Number(body.damage));
  if (!Number.isFinite(damage) || damage < 0) fail('Invalid hunt damage.');
  return store.transaction(async c => {
    await store.locked(c, wallet);
    const e = (await c.query('SELECT * FROM ryo_hunt_entries WHERE scope=$1 AND id=$2 AND wallet=$3 FOR UPDATE', [store.scope, body.entryId, wallet])).rows[0];
    if (!e) fail('That hunt is not yours.');
    const now = store.now(), elapsed = Math.max(0, Math.min(HUNT_SECONDS, (now - Number(e.started)) / 1000));
    if (now > Number(e.started) + HUNT_SECONDS * 1000 + REPORT_GRACE_MS) return { damage: Number(e.damage), closed: true };
    const cap = teamCap(await store.profileLocked(c, wallet)), allowed = Math.floor(elapsed * cap.dps * 1.1 + cap.volley);
    const kept = Math.max(Number(e.damage), Math.min(damage, allowed));
    await c.query('UPDATE ryo_hunt_entries SET damage=$3,reported=$4 WHERE scope=$1 AND id=$2', [store.scope, e.id, kept, now]);
    return { damage: kept, capped: damage > allowed };
  });
}
// Pay out every finished day: top 10 by total damage of finalized entries.
async function settleDue(store) {
  const now = store.now(), today = dayOf(now);
  const days = (await store.pool.query('SELECT day FROM ryo_hunt_days WHERE scope=$1 AND settled=FALSE AND day<$2 ORDER BY day', [store.scope, today])).rows.map(r => r.day);
  for (const day of days) {
    if (now < Date.parse(day + 'T00:00:00Z') + DAY_MS + SETTLE_DELAY_MS) continue;
    await store.transaction(async c => {
      const row = (await c.query('SELECT * FROM ryo_hunt_days WHERE scope=$1 AND day=$2 FOR UPDATE', [store.scope, day])).rows[0];
      if (!row || row.settled) return;
      const join = 'FROM ryo_hunt_entries e JOIN ryo_purchases p ON p.scope=e.scope AND p.wallet=e.wallet AND p.request_id=e.id WHERE e.scope=$1 AND e.day=$2';
      if ((await c.query(`SELECT 1 ${join} AND p.status='pending' LIMIT 1`, [store.scope, day])).rows.length) return; // wait for fees to finalize
      const pool = Number(row.carry) + Number((await c.query(`SELECT COALESCE(SUM(e.prize),0) AS n ${join} AND p.status='confirmed'`, [store.scope, day])).rows[0].n);
      const top = (await c.query(`SELECT e.wallet, MAX(NULLIF(e.name,'')) AS name, SUM(e.damage) AS damage, MIN(e.started) AS first ${join} AND p.status='confirmed' GROUP BY e.wallet HAVING SUM(e.damage)>0 ORDER BY SUM(e.damage) DESC, MIN(e.started) ASC LIMIT 10`, [store.scope, day])).rows;
      if (!top.length) {
        if (pool > 0) { const next = dayOf(Date.parse(day + 'T00:00:00Z') + DAY_MS); await c.query('INSERT INTO ryo_hunt_days(scope,day,carry) VALUES($1,$2,$3) ON CONFLICT(scope,day) DO UPDATE SET carry=ryo_hunt_days.carry+EXCLUDED.carry', [store.scope, next, pool]); }
      } else {
        const amounts = prizes(pool, top.length);
        for (const [i, w] of top.entries()) {
          if (amounts[i] > 0) await c.query('INSERT INTO ryo_accounts(scope,wallet,balance) VALUES($1,$2,$3) ON CONFLICT(scope,wallet) DO UPDATE SET balance=ryo_accounts.balance+EXCLUDED.balance', [store.scope, w.wallet, amounts[i]]);
          await c.query('INSERT INTO ryo_hunt_payouts(scope,day,rank,wallet,name,damage,amount) VALUES($1,$2,$3,$4,$5,$6,$7)', [store.scope, day, i + 1, w.wallet, w.name || short(w.wallet), Number(w.damage), amounts[i]]);
        }
      }
      await c.query('UPDATE ryo_hunt_days SET settled=TRUE,pool=$3,settled_at=$4 WHERE scope=$1 AND day=$2', [store.scope, day, pool, now]);
    });
  }
}
async function board(store, wallet) {
  await settleDue(store);
  const now = store.now(), day = dayOf(now), q = (sql, args) => store.pool.query(sql, args).then(r => r.rows);
  const live = "FROM ryo_hunt_entries e JOIN ryo_purchases p ON p.scope=e.scope AND p.wallet=e.wallet AND p.request_id=e.id WHERE e.scope=$1 AND e.day=$2 AND p.status<>'refunded'";
  const carry = Number((await q('SELECT carry FROM ryo_hunt_days WHERE scope=$1 AND day=$2', [store.scope, day]))[0]?.carry || 0);
  const pool = carry + Number((await q(`SELECT COALESCE(SUM(e.prize),0) AS n ${live}`, [store.scope, day]))[0].n);
  const ranked = await q(`SELECT e.wallet, MAX(NULLIF(e.name,'')) AS name, SUM(e.damage) AS damage, COUNT(*) AS entries, MIN(e.started) AS first ${live} GROUP BY e.wallet ORDER BY SUM(e.damage) DESC, MIN(e.started) ASC`, [store.scope, day]);
  const scoring = ranked.filter(r => Number(r.damage) > 0), amounts = prizes(pool, scoring.length || SHARES.length);
  const top = scoring.slice(0, 10).map((r, i) => ({ rank: i + 1, name: r.name || short(r.wallet), wallet: short(r.wallet), damage: Number(r.damage), prize: amounts[i] || 0, me: r.wallet === wallet }));
  const meRow = ranked.find(r => r.wallet === wallet), meRank = scoring.findIndex(r => r.wallet === wallet);
  const best = (await q('SELECT day, SUM(damage) AS damage FROM ryo_hunt_entries WHERE scope=$1 AND wallet=$2 GROUP BY day ORDER BY SUM(damage) DESC LIMIT 1', [store.scope, wallet]))[0];
  const last = (await q('SELECT day, pool FROM ryo_hunt_days WHERE scope=$1 AND settled=TRUE ORDER BY day DESC LIMIT 1', [store.scope]))[0];
  const winners = last ? (await q('SELECT * FROM ryo_hunt_payouts WHERE scope=$1 AND day=$2 ORDER BY rank', [store.scope, last.day])).map(r => ({ rank: r.rank, name: r.name, wallet: short(r.wallet), damage: Number(r.damage), prize: Number(r.amount), me: r.wallet === wallet })) : [];
  const open = (await q(`SELECT e.* FROM ryo_hunt_entries e JOIN ryo_purchases p ON p.scope=e.scope AND p.wallet=e.wallet AND p.request_id=e.id WHERE e.scope=$1 AND e.wallet=$2 AND e.started>$3 AND p.status<>'refunded' ORDER BY e.started DESC LIMIT 1`, [store.scope, wallet, now - HUNT_SECONDS * 1000]))[0];
  const endsAt = Date.parse(day + 'T00:00:00Z') + DAY_MS, guardian = guardianOf(day);
  return { hunt: {
    day, endsIn: endsAt - now, fee: FEE, burn: BURN, prize: PRIZE, seconds: HUNT_SECONDS, shares: SHARES, guardian, guardianName: GUARDIANS[guardian],
    schedule: [0, 1, 2, 3, 4].map(i => { const d = dayOf(endsAt - DAY_MS + i * DAY_MS); return { day: d, guardian: guardianOf(d), name: GUARDIANS[guardianOf(d)] }; }),
    pool, prizes: prizes(pool), players: ranked.length, top,
    me: { damage: Number(meRow?.damage || 0), entries: Number(meRow?.entries || 0), rank: meRank >= 0 ? meRank + 1 : null, prize: meRank >= 0 && meRank < 10 ? amounts[meRank] : 0, bestDamage: Number(best?.damage || 0), bestDay: best?.day || null },
    yesterday: last ? { day: last.day, pool: Number(last.pool), winners } : null,
    open: open ? { id: open.id, started: Number(open.started), damage: Number(open.damage) } : null
  } };
}
module.exports = { SCHEMA, FEE, BURN, PRIZE, SHARES, GUARDIANS, HUNT_SECONDS, dayOf, guardianOf, prizes, teamCap, quote, beforeEnter, record, report, settleDue, board };
