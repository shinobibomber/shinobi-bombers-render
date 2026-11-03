/* Real-time rewards guard. Runs in every Render build (npm run build → check:rewards) and in npm test,
 * so an update that would delay or drop Adventure kill rewards fails the build and never deploys.
 * Plain Node only: it reads the generated app/ and drives the real server reward code.
 *
 * It locks three things:
 *  1. The battle formulas the server's kill budget mirrors (gameplay-options/server.cjs teamDps).
 *     If a balance update changes one, update teamDps to match, then update the string here.
 *  2. The client wiring: each defeat fires shinobi-enemy-defeated, the Chest sync carries the kill
 *     report, syncs run 0.3s after a defeat (at most every 1.5s), and closing/hiding flushes kills.
 *  3. The server pays every kill on the next sync, for every rank at level 1 and level 10, and
 *     catches up on the first sync after a sync gap (deploy restart, network drop) in the same session. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const app = path.resolve(__dirname, '../app');
const read = file => fs.readFileSync(path.join(app, file), 'utf8');
const once = (source, text, what) => assert.equal(source.split(text).length - 1, 1, 'real-time rewards: ' + what + ' changed or is missing: ' + text);

// 1. Battle formulas mirrored by the server budget.
const game = read('public/index.html');
once(game, 'const statBands=[[1,3],[3,6],[6,9],[9,12],[12,15]];', 'hero stat bands');
once(game, 't=clamp((h.lv-1)/9,0,1)', 'level scaling (level 1→10)');
once(game, 'damage(h){return Math.max(1,Math.round(h.pw*1000)/1000)}', 'hero damage');
once(game, 'cooldown(h){return Math.max(.6,1.6-h.sp*.05)*(has(h,6)?.85:1)}', 'hero cooldown');
once(game, 'h.bm=h.r+1', 'shots per volley');
once(game, 'count=Math.min(available,Math.floor(h.en))', 'volley size');
once(game, 'c.hp=GameBalance.money(c.hp-b.d-(h&&has(h,1)&&c.k>=4?1:0))', 'hit damage and perk bonus');
once(game, 'enemyHP(k){return [100,213,1000,1625,2500][k-2]}', 'enemy HP');
// 2. Client wiring.
once(game, "dispatchEvent(new CustomEvent('shinobi-enemy-defeated',{detail:{kind,reward,bonus:!!(h&&has(h,0))}}))", 'defeat event');
once(game, "{active,...(window.KillReport?.payload()||{})}", 'kill report in the Chest sync');
once(game, 'keepalive:!!window.KillReport?.closing', 'keepalive flush on close');
const options = read('public/assets/gameplay-options/options.js');
once(options, 'Math.max(300,tally.last+1500-performance.now())', 'sync timing (0.3s after a defeat, at most every 1.5s)');
once(options, "addEventListener('pagehide',()=>flush(true))", 'flush on close');
once(options, "if(document.hidden)flush(true)", 'flush when hidden');
const server = read('server/adventure.cjs');
once(server, 'budget+=seconds*dps', 'trained-stat kill budget');
once(server, 'creditKills(d,tally,budget,rate,now)', 'kill crediting');

// 3. The real server pays every kill on the next sync.
const economy = require(path.join(app, 'server/economy.cjs')), adventure = require(path.join(app, 'server/adventure.cjs'));
const BANDS = [[1, 3], [3, 6], [6, 9], [9, 12], [12, 15]], HP = [100, 213, 1000, 1625];
// The battle's own numbers for a hero (GameBalance.recalculateHero/damage/cooldown), with the best
// perks: +1 damage on Jonin+ enemies and a 15% shorter cooldown.
function clientDps(h, kind) {
  const [lo, hi] = BANDS[h.rank], t = Math.min(1, Math.max(0, (h.level - 1) / 9)), stat = k => h.baseStats[k] + (hi - h.baseStats[k]) * t;
  return (h.rank + 1) * (Math.max(1, stat('pw')) + (kind >= 2 ? 1 : 0)) / (Math.max(.6, 1.6 - stat('sp') * .05) * .85);
}
function team(rank, level, base) {
  const p = economy.normalizeProfile({ dojo: 0, sensei: false, heroes: Array.from({ length: 10 }, (_, i) => ({ tokenId: 'guard-' + i, rank, level, name: 'Guard ' + i, baseStats: { pw: base, sp: base, st: base } })), battleReady: [] });
  p.battleReady = p.heroes.map(h => h.tokenId); return p;
}
const t0 = 1_900_000_000_000;
let cases = 0;
for (let rank = 0; rank < 5; rank++) for (const level of [1, 10]) for (const base of [BANDS[rank][0], BANDS[rank][1]]) {
  // Each team fights the toughest enemy its rank meets (Genin → bronze ... Legend → diamond).
  const kind = Math.min(3, rank), p = team(rank, level, base), dps = p.heroes.reduce((n, h) => n + clientDps(h, kind), 0);
  const report = (k, id = 'guard-session') => { const totals = [0, 0, 0, 0, 0, 0, 0, 0]; totals[kind * 2] = k; return { killSession: id, killTotals: totals, killStage: 1 }; };
  const killsAt = ms => Math.floor(ms / 1000 * dps / HP[kind]);
  const label = `rank ${rank} level ${level} base ${base}`;
  let d = adventure.advance(undefined, p, t0, true, 60, report(0));
  // Continuous play, a sync every 1.5s for 4 minutes: nothing may wait for a later sync.
  for (let ms = 1500; ms <= 240000; ms += 1500) {
    d = adventure.advance(d, p, t0 + ms, true, 60, report(killsAt(ms)));
    assert.equal(d.reportedKills || 0, killsAt(ms), `${label}: every kill is credited on the next sync (at ${ms / 1000}s)`);
  }
  // Syncs fail for 90s and for 5 minutes (a deploy restart or network drop) while the same game keeps
  // playing: the first sync afterwards credits everything.
  for (const gap of [90000, 300000]) {
    const at = 240000 + (gap === 90000 ? 0 : 91500) + gap;
    d = adventure.advance(d, p, t0 + at, true, 60, report(killsAt(at)));
    assert.equal(d.reportedKills, killsAt(at), `${label}: kills during a ${gap / 1000}s sync gap are credited on reconnect`);
  }
  cases++;
}
// Replays never pay twice, and a fabricated flood stays capped by the team's damage.
{
  const p = team(4, 10, 15);
  let d = adventure.advance(undefined, p, t0, true, 60, { killSession: 'guard-cheat', killTotals: [0, 0, 0, 0, 0, 0, 0, 0], killStage: 1 });
  d = adventure.advance(d, p, t0 + 1500, true, 60, { killSession: 'guard-cheat', killTotals: [0, 0, 0, 0, 0, 0, 1e6, 0], killStage: 1 });
  assert(d.reportedKills < 100, 'a fabricated kill flood is limited to the damage the team could deal');
  const paid = d.pending;
  d = adventure.advance(d, p, t0 + 1500, true, 60, { killSession: 'guard-cheat', killTotals: [0, 0, 0, 0, 0, 0, d.reportedKills, 0], killStage: 1 });
  assert.equal(d.pending, paid, 'replayed totals pay nothing more');
}
console.log(`PASS: real-time rewards guard — battle formulas match the server budget, defeat → Chest sync wiring intact, and ${cases} trained/untrained teams of every rank have every kill credited on the next sync, including right after a sync gap.`);
