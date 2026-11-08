/* In-memory Boss Hunt for browser fixtures (tests/harness.cjs), using the real module's fee, prize
 * shares, guardian rotation and damage cap. Other players' damage today is seeded in
 * f.hunt.others ([{ name, damage }]); yesterday's winners in f.hunt.yesterday. */
const crypto = require('node:crypto');
const hunt = require('../app/server/boss-hunt.cjs'), economy = require('../app/server/economy.cjs'),R=require('../app/server/combat-rules.cjs'),H=require('../app/server/combat-hunt.cjs');
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };

function board(f, account, now) {
  const h = f.hunt, day = hunt.dayOf(now), mine = h.entries.filter(e => e.day === day);
  const players = [...(h.others || []).map(o => ({ name: o.name, wallet: 'OthR…' + o.name.slice(0, 4), damage: o.damage, entries: 1, me: false }))];
  if (mine.length) players.push({ name: mine[0].name || account.slice(0, 4) + '…' + account.slice(-4), wallet: account.slice(0, 4) + '…' + account.slice(-4), damage: mine.reduce((n, e) => n + e.damage, 0), entries: mine.length, me: true });
  const pool = (h.carry || 0) + (h.others || []).length * hunt.PRIZE + mine.length * hunt.PRIZE;
  const scoring = players.filter(p => p.damage > 0).sort((a, b) => b.damage - a.damage), amounts = hunt.prizes(pool, scoring.length || 10);
  const top = scoring.slice(0, 10).map((p, i) => ({ rank: i + 1, name: p.name, wallet: p.wallet, damage: p.damage, prize: amounts[i] || 0, me: p.me }));
  const me = players.find(p => p.me), rank = scoring.findIndex(p => p.me);
  const endsAt = Date.parse(day + 'T00:00:00Z') + 86400000, g = hunt.guardianOf(day);
  const open = mine.find(e => now - e.started < hunt.HUNT_SECONDS * 1000);
  // Weekly: seeded standings (f.hunt.week: [{ name, points }]) plus my provisional points from today.
  const week = hunt.weekOf(day), weekEnd = Date.parse(week + 'T00:00:00Z') + 7 * 86400000;
  const wrows = [...(h.week || []).map(w => ({ name: w.name, wallet: 'OthR…' + w.name.slice(0, 4), points: w.points, damage: w.damage || 0, me: false }))];
  if (rank >= 0 && rank < 10) wrows.push({ name: me.name, wallet: me.wallet, points: 10 - rank, damage: me.damage, me: true });
  wrows.sort((a, b) => b.points - a.points || b.damage - a.damage);
  const prizeName = i => i < 10 ? (hunt.WEEK_PRIZES[i] === 4 ? 'Legend hero' : 'Elite hero') : '', wme = wrows.findIndex(w => w.me);
  const weekly = { week, endsIn: weekEnd - now, top: wrows.slice(0, 10).map((w, i) => ({ rank: i + 1, ...w, prize: prizeName(i) })),
    me: { rank: wme >= 0 ? wme + 1 : null, points: wme >= 0 ? wrows[wme].points : 0, prize: wme >= 0 ? prizeName(wme) : '' }, last: h.lastWeek || null, waiting: 0 };
  return { day, endsIn: endsAt - now, fee: hunt.FEE, treasury: hunt.TREASURY, burn: hunt.BURN, prize: hunt.PRIZE, weekly, seconds: hunt.HUNT_SECONDS, shares: hunt.SHARES, guardian: g, guardianName: hunt.GUARDIANS[g],
    schedule: [0, 1, 2, 3, 4].map(i => { const d = hunt.dayOf(endsAt - 86400000 + i * 86400000); return { day: d, guardian: hunt.guardianOf(d), name: hunt.GUARDIANS[hunt.guardianOf(d)] }; }),
    pool, prizes: hunt.prizes(pool), players: players.length, top,
    me: { damage: me?.damage || 0, entries: me?.entries || 0, rank: rank >= 0 ? rank + 1 : null, prize: rank >= 0 && rank < 10 ? amounts[rank] : 0, bestDamage: me?.damage || 0, bestDay: me ? day : null },
    yesterday: h.yesterday || null, open: open ? { id: open.id, started: open.started, damage: open.damage } : null };
}
async function handle(f, req, account, snapshot) {
  const now = Date.now(); f.hunt = f.hunt || {}; f.hunt.entries = f.hunt.entries || [];
  if (req.action === 'hunt-board') return { hunt: board(f, account, now) };
  if (req.action === 'hunt-enter') {
    if (f.hunt.entries.some(e => now - e.started < hunt.HUNT_SECONDS * 1000)) fail('Finish your current hunt first.', 409);
    if (f.balance < hunt.FEE) fail('Not enough deposited Ryo, including the studio fee.');
    f.balance -= hunt.FEE; const day = hunt.dayOf(now);
    const e = { id: req.requestId || crypto.randomUUID(), name: String(req.name || '').slice(0, 14), day, guardian: hunt.guardianOf(day), started: now, damage: 0 }; e.combat={version:1,started:now,ends:now+60000,team:economy.normalizeProfile(f.profile).heroes.filter(h=>f.profile.battleReady.includes(h.tokenId)).sort((a,b)=>R.damage(b)-R.damage(a)).slice(0,5).map(h=>({id:h.tokenId,started:now,power:R.damage(h),cooldown:R.cooldown(h)*1000,energy:Math.floor(h.chakra?.value??R.maxChakra(h))}))};f.hunt.entries.push(e);
    f.purchases = [{ request_id: e.id, amount: String(hunt.FEE), status: 'confirmed', acknowledged: true, created: String(now), signature: 'H'.repeat(80), quote: hunt.quote(2), result: { product: 'hunt', outputs: [] } }, ...f.purchases];
    return { entry: { id: e.id, day, guardian: e.guardian, guardianName: hunt.GUARDIANS[e.guardian], started: now, seconds: hunt.HUNT_SECONDS,combat:e.combat,team:e.combat.team.map(u=>u.id),pending:false }, hunt: board(f, account, now), ...snapshot() };
  }
  if(req.action==='hunt-ready'){const e=f.hunt.entries.find(e=>e.id===req.entryId);return {entry:{...e,team:e.combat.team.map(u=>u.id),seconds:60,pending:false}}}
  if (req.action === 'hunt-report') {
    const e = f.hunt.entries.find(x => x.id === req.entryId); if (!e) fail('That hunt is not yours.');
    const cap = hunt.teamCap(economy.normalizeProfile(f.profile)), elapsed = Math.min(hunt.HUNT_SECONDS, (now - e.started) / 1000);
    if(req.finish)e.combat.ends=Math.min(e.combat.ends,now);e.damage=Math.max(e.damage,e.combat.team.reduce((n,u)=>n+H.attacks(u,now,e.combat.ends)*u.power,0));
    (f.hunt.reports = f.hunt.reports || []).push({ id: e.id, damage: req.damage, kept: e.damage });
    return { damage: e.damage };
  }
  fail('Unknown Boss Hunt action.');
}
module.exports = { handle };
