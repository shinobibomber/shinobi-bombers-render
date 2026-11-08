/* Boss Hunt daily damage rankings (copied to app/server/boss-hunt.cjs by apply-boss-hunt.cjs).
 *
 * Each hunt costs a 10,000 Ryo entrance fee, paid through the token purchase flow: 8,000 (80%) goes to
 * that UTC day's prize pool, 1,000 (10%) to the treasury and 1,000 (10%) is burned. A hunt is a 60-second damage run
 * with up to 5 battle-ready heroes. The server snapshots trained Power, cooldown and available
 * chakra at activation; each timed attack costs one chakra and deals exactly Power damage. Client
 * damage totals do not determine the score, and only entries whose fee finalized count. When
 * the day ends, the top 10 players by total damage share the pool 30/20/12/9/7/6/5/4/4/3% (rescaled
 * if fewer played); the payouts are credited to their Ryo balances. A day with no damage carries its
 * pool to the next day.
 *
 * Weekly ranking (Monday–Sunday, UTC): each day's top 10 earn points (1st 10 … 10th 1). When the week
 * ends, 1st–3rd each receive a new Legend hero and 4th–10th a new Elite hero, ranked by points, then
 * the week's damage. A full collection (500 heroes) keeps the award waiting until there is room.
 */
'use strict';
const fail = (...args) => require('./store.cjs').fail(...args);

const FEE = 10000, TREASURY = 1000, BURN = 1000, PRIZE = FEE - TREASURY - BURN, HUNT_SECONDS = 60, MAX_HEROES = 500, REPORT_GRACE_MS = 120000, SETTLE_DELAY_MS = 5 * 60000;
const SHARES = [30, 20, 12, 9, 7, 6, 5, 4, 4, 3];
const GUARDIANS = ['Akuma · Fallen Shinobi', 'Yuki Onna · Frozen Moon', 'Raijin · Thunder Lord', 'Daichi · Ancient Golem', 'Orochi · Serpent King'];
const DAY_MS = 86400000, WEEK_PRIZES = [4, 4, 4, 3, 3, 3, 3, 3, 3, 3]; // hero rank by weekly place: Legend ×3, Elite ×7
const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_hunt_entries (
 scope TEXT NOT NULL, id TEXT NOT NULL, wallet TEXT NOT NULL, name TEXT NOT NULL, day TEXT NOT NULL, guardian INTEGER NOT NULL,
 prize BIGINT NOT NULL, damage BIGINT NOT NULL DEFAULT 0, started BIGINT NOT NULL, reported BIGINT, PRIMARY KEY(scope,id)
);
CREATE INDEX IF NOT EXISTS ryo_hunt_entries_day ON ryo_hunt_entries(scope,day,wallet);
CREATE INDEX IF NOT EXISTS ryo_hunt_entries_wallet ON ryo_hunt_entries(scope,wallet,started);
CREATE TABLE IF NOT EXISTS ryo_hunt_days (scope TEXT NOT NULL, day TEXT NOT NULL, carry BIGINT NOT NULL DEFAULT 0, pool BIGINT, settled BOOLEAN NOT NULL DEFAULT FALSE, settled_at BIGINT, PRIMARY KEY(scope,day));
CREATE TABLE IF NOT EXISTS ryo_hunt_payouts (scope TEXT NOT NULL, day TEXT NOT NULL, rank INTEGER NOT NULL, wallet TEXT NOT NULL, name TEXT NOT NULL, damage BIGINT NOT NULL, amount BIGINT NOT NULL, PRIMARY KEY(scope,day,rank));`;
const WEEKLY_SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_hunt_weeks (scope TEXT NOT NULL, week TEXT NOT NULL, settled BOOLEAN NOT NULL DEFAULT FALSE, settled_at BIGINT, PRIMARY KEY(scope,week));
CREATE TABLE IF NOT EXISTS ryo_hunt_awards (scope TEXT NOT NULL, week TEXT NOT NULL, rank INTEGER NOT NULL, wallet TEXT NOT NULL, name TEXT NOT NULL, points INTEGER NOT NULL, damage BIGINT NOT NULL,
 hero_rank INTEGER NOT NULL, hero JSONB NOT NULL, granted BOOLEAN NOT NULL DEFAULT FALSE, created BIGINT NOT NULL, PRIMARY KEY(scope,week,rank));
CREATE INDEX IF NOT EXISTS ryo_hunt_awards_wallet ON ryo_hunt_awards(scope,wallet,granted);`;

const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
const weekOf = day => { const t = Date.parse(day + 'T00:00:00Z'); return dayOf(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS); };
const guardianOf = day => Math.floor(Date.parse(day + 'T00:00:00Z') / DAY_MS) % GUARDIANS.length;
const short = wallet => wallet.slice(0, 4) + '…' + wallet.slice(-4);
const cleanName = name => (typeof name === 'string' ? name : '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 14);
function prizes(pool, players = SHARES.length) {
  const weights = SHARES.slice(0, Math.max(1, Math.min(SHARES.length, players))), total = weights.reduce((a, b) => a + b, 0);
  const out = weights.map(w => Math.floor(pool * w / total)); out[0] += pool - out.reduce((a, b) => a + b, 0);
  return out;
}
// Display/preflight cap only. Scoring uses combat-hunt's persistent per-entry attack schedule.
// Decorative volley count and Armor Breaker never multiply Power or grant damage.
function teamCap(profile) {
  const rules = require('./combat-rules.cjs'), ready = new Set(profile.battleReady || []);
  const rows = profile.heroes.filter(h => ready.has(h.tokenId)).sort((a,b)=>rules.damage(b)-rules.damage(a)).slice(0,5)
    .map(h => ({ dps: rules.damage(h) / rules.cooldown(h), volley: rules.damage(h) }));
  return { dps: rows.reduce((n, r) => n + r.dps, 0), volley: rows.reduce((n, r) => n + r.volley, 0) };
}
function quote(version) {
  return { economyVersion: version, product: 'hunt', params: {}, title: 'Boss Hunt entry', base: FEE, total: FEE, studioFee: 0, treasury: TREASURY, burn: BURN, operations: 0, prize: PRIZE };
}
// Run before the fee is taken: one open hunt at a time, and a battle-ready team.
async function beforeEnter(store, wallet) {
  const now = store.now(), open = (await store.pool.query(`SELECT e.id FROM ryo_hunt_entries e JOIN ryo_purchases p ON p.scope=e.scope AND p.wallet=e.wallet AND p.request_id=e.id
    WHERE e.scope=$1 AND e.wallet=$2 AND (e.started>$3 OR e.combat->>'waiting'='true') AND p.status<>'refunded' LIMIT 1`, [store.scope, wallet, now - HUNT_SECONDS * 1000])).rows[0];
  if (open) fail('Finish your current hunt first.', 409);
  const profile = await store.profile(wallet);
  const chakra = require('./combat-chakra.cjs'), ready = new Set(profile.battleReady || []);
  if (!profile.heroes.some(h => ready.has(h.tokenId) && chakra.recover(h,now,profile.dojo).value >= 1 && !(h.chakra.lockUntil > now))) fail('Rest at least one battle-ready hero before entering a Boss Hunt.');
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
  return require('./combat-hunt.cjs').report(store,wallet,body);
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
      // A confirmed timed auto-battle completes even if its last browser report was lost.
      for (const e of (await c.query(`SELECT e.id,e.combat,e.damage ${join} AND p.status='confirmed' AND e.combat IS NOT NULL`,[store.scope,day])).rows) {
        if (!Array.isArray(e.combat.team)) continue;
        const score=e.combat.team.reduce((n,u)=>n+require('./combat-hunt.cjs').attacks(u,now,e.combat.ends)*u.power,0);
        await c.query('UPDATE ryo_hunt_entries SET damage=$3 WHERE scope=$1 AND id=$2',[store.scope,e.id,Math.max(Number(e.damage),score)]);
      }
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
  await settleWeeks(store);
}
// Weekly standings from settled daily places (points) and the week's finalized damage.
async function weekStandings(c, store, start, end, dayLimit = end) {
  const pts = (await c.query("SELECT wallet, MAX(name) AS name, SUM(11-rank) AS points FROM ryo_hunt_payouts WHERE scope=$1 AND day>=$2 AND day<$3 GROUP BY wallet", [store.scope, start, dayLimit])).rows;
  const dmg = (await c.query(`SELECT e.wallet, SUM(e.damage) AS damage, MIN(e.started) AS first FROM ryo_hunt_entries e JOIN ryo_purchases p ON p.scope=e.scope AND p.wallet=e.wallet AND p.request_id=e.id
    WHERE e.scope=$1 AND e.day>=$2 AND e.day<$3 AND p.status='confirmed' GROUP BY e.wallet`, [store.scope, start, end])).rows;
  const by = new Map(dmg.map(r => [r.wallet, r]));
  return pts.map(r => ({ wallet: r.wallet, name: r.name, points: Number(r.points), damage: Number(by.get(r.wallet)?.damage || 0), first: Number(by.get(r.wallet)?.first || 0) }));
}
const sortWeek = (a, b) => b.points - a.points || b.damage - a.damage || a.first - b.first;
// Award each finished week once all of its days are settled: Legend for 1st–3rd, Elite for 4th–10th.
async function settleWeeks(store) {
  const now = store.now(), economy = require('./economy.cjs');
  const days = (await store.pool.query('SELECT day FROM ryo_hunt_days WHERE scope=$1 ORDER BY day', [store.scope])).rows.map(r => r.day);
  const weeks = [...new Set(days.map(weekOf))].filter(w => now >= Date.parse(w + 'T00:00:00Z') + 7 * DAY_MS + SETTLE_DELAY_MS);
  for (const week of weeks) {
    const end = dayOf(Date.parse(week + 'T00:00:00Z') + 7 * DAY_MS);
    if ((await store.pool.query('SELECT 1 FROM ryo_hunt_weeks WHERE scope=$1 AND week=$2 AND settled', [store.scope, week])).rows.length) continue;
    if ((await store.pool.query('SELECT 1 FROM ryo_hunt_days WHERE scope=$1 AND day>=$2 AND day<$3 AND NOT settled LIMIT 1', [store.scope, week, end])).rows.length) continue;
    await store.transaction(async c => {
      await c.query('INSERT INTO ryo_hunt_weeks(scope,week) VALUES($1,$2) ON CONFLICT DO NOTHING', [store.scope, week]);
      const row = (await c.query('SELECT * FROM ryo_hunt_weeks WHERE scope=$1 AND week=$2 FOR UPDATE', [store.scope, week])).rows[0];
      if (row.settled) return;
      const top = (await weekStandings(c, store, week, end)).sort(sortWeek).slice(0, 10);
      for (const [i, w] of top.entries()) {
        const hero = economy.hero(WEEK_PRIZES[i]);
        await store.locked(c, w.wallet);
        const profile = await store.profileLocked(c, w.wallet), room = profile.heroes.length < MAX_HEROES;
        if (room) { profile.heroes.push(hero); await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w.wallet, JSON.stringify(profile)]); }
        await c.query('INSERT INTO ryo_hunt_awards(scope,week,rank,wallet,name,points,damage,hero_rank,hero,granted,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [store.scope, week, i + 1, w.wallet, w.name, w.points, w.damage, WEEK_PRIZES[i], JSON.stringify(hero), room, now]);
      }
      await c.query('UPDATE ryo_hunt_weeks SET settled=TRUE,settled_at=$3 WHERE scope=$1 AND week=$2', [store.scope, week, now]);
    });
  }
}
// Weekly heroes that waited for room join the collection once there is space.
async function grantWaiting(store, wallet) {
  if (!(await store.pool.query('SELECT 1 FROM ryo_hunt_awards WHERE scope=$1 AND wallet=$2 AND NOT granted LIMIT 1', [store.scope, wallet])).rows.length) return 0;
  return store.transaction(async c => {
    await store.locked(c, wallet);
    const waiting = (await c.query('SELECT * FROM ryo_hunt_awards WHERE scope=$1 AND wallet=$2 AND NOT granted ORDER BY week,rank FOR UPDATE', [store.scope, wallet])).rows;
    const profile = await store.profileLocked(c, wallet); let n = 0;
    for (const a of waiting) {
      if (profile.heroes.length >= MAX_HEROES) break;
      profile.heroes.push(a.hero); n++;
      await c.query('UPDATE ryo_hunt_awards SET granted=TRUE WHERE scope=$1 AND week=$2 AND rank=$3', [store.scope, a.week, a.rank]);
    }
    if (n) await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
    return n;
  });
}
async function board(store, wallet) {
  await settleDue(store); await grantWaiting(store, wallet);
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
  const open = (await q(`SELECT e.* FROM ryo_hunt_entries e JOIN ryo_purchases p ON p.scope=e.scope AND p.wallet=e.wallet AND p.request_id=e.id WHERE e.scope=$1 AND e.wallet=$2 AND (e.started>$3 OR e.combat->>'waiting'='true') AND p.status<>'refunded' ORDER BY e.started DESC LIMIT 1`, [store.scope, wallet, now - HUNT_SECONDS * 1000]))[0];
  const endsAt = Date.parse(day + 'T00:00:00Z') + DAY_MS, guardian = guardianOf(day);
  // This week: settled daily places plus today's live top 10 (provisional points).
  const week = weekOf(day), weekEnd = dayOf(Date.parse(week + 'T00:00:00Z') + 7 * DAY_MS);
  const standing = new Map((await weekStandings(store.pool, store, week, day, day)).map(r => [r.wallet, r]));
  for (const r of ranked) if (!standing.has(r.wallet)) standing.set(r.wallet, { wallet: r.wallet, name: r.name, points: 0, damage: 0, first: Number(r.first) });
  scoring.slice(0, 10).forEach((r, i) => { standing.get(r.wallet).points += 10 - i; });
  const liveDamage = new Map(ranked.map(r => [r.wallet, Number(r.damage)]));
  const weekRows = [...standing.values()].map(w => ({ ...w, damage: w.damage + (liveDamage.get(w.wallet) || 0) })).filter(w => w.points > 0).sort(sortWeek);
  const weekMe = weekRows.findIndex(w => w.wallet === wallet), lastWeek = (await q('SELECT week FROM ryo_hunt_weeks WHERE scope=$1 AND settled ORDER BY week DESC LIMIT 1', [store.scope]))[0];
  const prizeName = i => i < 10 ? (WEEK_PRIZES[i] === 4 ? 'Legend hero' : 'Elite hero') : '';
  const weekly = { week, endsIn: Date.parse(weekEnd + 'T00:00:00Z') - now,
    top: weekRows.slice(0, 10).map((w, i) => ({ rank: i + 1, name: w.name || short(w.wallet), wallet: short(w.wallet), points: w.points, damage: w.damage, prize: prizeName(i), me: w.wallet === wallet })),
    me: { rank: weekMe >= 0 ? weekMe + 1 : null, points: weekMe >= 0 ? weekRows[weekMe].points : 0, prize: weekMe >= 0 ? prizeName(weekMe) : '' },
    last: lastWeek ? { week: lastWeek.week, winners: (await q('SELECT * FROM ryo_hunt_awards WHERE scope=$1 AND week=$2 ORDER BY rank', [store.scope, lastWeek.week])).map(a => ({ rank: a.rank, name: a.name, wallet: short(a.wallet), points: a.points, prize: a.hero_rank === 4 ? 'Legend hero' : 'Elite hero', me: a.wallet === wallet })) } : null,
    waiting: Number((await q('SELECT COUNT(*) AS n FROM ryo_hunt_awards WHERE scope=$1 AND wallet=$2 AND NOT granted', [store.scope, wallet]))[0].n) };
  return { hunt: {
    day, endsIn: endsAt - now, fee: FEE, treasury: TREASURY, burn: BURN, prize: PRIZE, weekly, seconds: HUNT_SECONDS, shares: SHARES, guardian, guardianName: GUARDIANS[guardian],
    schedule: [0, 1, 2, 3, 4].map(i => { const d = dayOf(endsAt - DAY_MS + i * DAY_MS); return { day: d, guardian: guardianOf(d), name: GUARDIANS[guardianOf(d)] }; }),
    pool, prizes: prizes(pool), players: ranked.length, top,
    me: { damage: Number(meRow?.damage || 0), entries: Number(meRow?.entries || 0), rank: meRank >= 0 ? meRank + 1 : null, prize: meRank >= 0 && meRank < 10 ? amounts[meRank] : 0, bestDamage: Number(best?.damage || 0), bestDay: best?.day || null },
    yesterday: last ? { day: last.day, pool: Number(last.pool), winners } : null,
    open: open ? { id: open.id, started: Number(open.started), damage: Number(open.damage) } : null
  } };
}
module.exports = { SCHEMA, WEEKLY_SCHEMA, FEE, TREASURY, BURN, PRIZE, WEEK_PRIZES, weekOf, settleWeeks, grantWaiting, SHARES, GUARDIANS, HUNT_SECONDS, dayOf, guardianOf, prizes, teamCap, quote, beforeEnter, record, report, settleDue, board };
