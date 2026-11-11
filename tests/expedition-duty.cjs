'use strict';
/* Expedition Mode: Combat Duty, automatic Expeditions, Founder durations, Sensei and Boss Hunt integration (owner spec
 * 2026-11-11). Pure server modules from the built app; no database, wallet or network.
 * The equivalence block runs the frozen pre-Expedition combat modules (tests/fixtures/expedition-baseline, commit da98070)
 * side by side with the new ones: with Expedition Mode off nothing changes, and with it on (no hero at the 18-hour limit)
 * every reward, kill, map and chakra value is identical; only the new h.chakra.duty field is added. */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const app = path.join(__dirname, '../app/server');
const E = require(app + '/economy.cjs'), R = require(app + '/combat-rules.cjs'), C = require(app + '/combat-chakra.cjs'), A = require(app + '/combat-adventure.cjs'), D = require(app + '/combat-duty.cjs');
const H = D.HOUR, CAP = D.DUTY_CAP_MS, t0 = 1900000000000;

const hero = (id, rank = 0, extra = {}) => ({ tokenId: id, rank, level: 1, baseStats: { pw: 3, sp: 1, st: 3 }, bonus: { pw: 0, sp: 0, st: 0 }, trainingVersion: 2, ...extra });
function profile(heroes, ready = heroes.map(h => h.tokenId), extra = {}) { const p = E.normalizeProfile({ dojo: 0, heroes, battleReady: [], ...extra }); p.battleReady = ready.slice(); return p; }
const report = (ids, counts, session = 'exp-session', seq = 1, deployed = ids) => ({ combatVersion: 1, killSession: session, combatSeq: seq, killStage: 1, deployed,
  combatHeroes: ids.map(id => ({ id, attacks: counts[id] || 0, kills: [0, 0, 0, 0, 0] })) });
const cd = h => R.cooldown(h) * 1000;
const duty = h => D.get(h.chakra)?.ms || 0;
const ON = { founder: false };
const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (k === 'duty' ? undefined : x)));

(async () => {
  // 1. Expedition durations: all six rarities, regular and verified Founder (50%).
  assert.deepEqual(D.HOURS, [2, 3, 4, 5, 6, 8]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(r => D.durationMs({ rank: r }, false)), [2, 3, 4, 5, 6, 8].map(h => h * H), 'regular durations');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(r => D.durationMs({ rank: r }, true)), [1, 1.5, 2, 2.5, 3, 4].map(h => h * H), 'Founder durations: 50% less time');
  assert.equal(CAP, 18 * H);

  // 2. The duty definition: each accepted attack adds exactly its cooldown; nothing else does.
  {
    const h = hero('a', 0, { baseStats: { pw: 3, sp: 1, st: 3 }, bonus: { pw: 0, sp: 0, st: 40 } }), p = profile([h]);
    C.setResting(h, false, t0, 0);
    let n = C.spend(h, 20, t0 + 30000, { activeSince: t0, duty: ON });
    assert(n > 0); assert.equal(duty(h), n * cd(h), 'duty = accepted attacks x cooldown');
    const before = duty(h); assert.equal(C.spend(h, 20, t0 + 30000, { activeSince: t0, duty: ON }), 0, 'no new attack allowance at the same time'); assert.equal(duty(h), before);
    // Without the Expedition window nothing accrues at all (Expedition Mode off).
    const off = hero('off', 0, { bonus: { pw: 0, sp: 0, st: 40 } }); profile([off]); C.setResting(off, false, t0, 0);
    assert(C.spend(off, 20, t0 + 30000, { activeSince: t0 }) > 0); assert.equal(off.chakra.duty, undefined, 'Expedition Mode off: no duty field, nothing accrues');
    // Rest and Chakra recovery never count: exhaust, then a long rest (recovering to 10%) adds no duty.
    const tired = hero('tired', 0); profile([tired]); tired.chakra = { version: 1, value: 2, at: t0, nextAt: t0, resting: false };
    const got = C.spend(tired, 100, t0 + 600000, { activeSince: t0, duty: ON });
    assert.equal(duty(tired), got * cd(tired)); assert(tired.chakra.napping || tired.chakra.value < R.restTarget(tired) + 1e-9);
    const afterRest = duty(tired); C.recover(tired, t0 + 3 * H, 0); assert.equal(duty(tired), afterRest, 'recovery time never counts');
    // An isolated attack after a long idle gap counts one cooldown, not the gap.
    const idle = hero('idle', 0, { bonus: { pw: 0, sp: 0, st: 40 } }); profile([idle]); C.setResting(idle, false, t0, 0); C.spend(idle, 1, t0 + 1000, { activeSince: t0, duty: ON });
    const one = duty(idle); C.recover(idle, t0 + 6 * H, 0); assert.equal(C.spend(idle, 1, t0 + 6 * H, { activeSince: t0 + 6 * H - 1000, duty: ON }), 1);
    assert.equal(duty(idle), one + cd(idle), 'an idle gap adds nothing; the next attack adds one cooldown');
  }

  // 3. Exactly 18 hours of verified cumulative combat across many sessions with rests in between.
  {
    const h = hero('long', 2, { baseStats: { pw: 6, sp: 6, st: 9 }, bonus: { pw: 0, sp: 0, st: 60 } }); profile([h]);
    C.setResting(h, false, t0, 6);
    let t = t0, total = 0, last = 0, guard = 0;
    while (!D.get(h.chakra)?.exp && guard++ < 100000) {
      const prev = h.chakra.nextAt; t += 600000; const n = C.spend(h, 1e6, t, { dojo: 6, activeSince: t - 600000, duty: ON }); total += n; if (n) last = h.chakra.nextAt - cd(h);
      if (guard % 7 === 0) { C.setResting(h, true, t, 6); t += 2 * H; C.setResting(h, false, t, 6); }   // a benched session break
      void prev;
    }
    const e = D.get(h.chakra).exp;
    assert(e, 'the Expedition starts at 18 hours'); assert.equal(duty(h), CAP, 'duty is capped at exactly 18 hours');
    assert(total * cd(h) >= CAP && total * cd(h) < CAP + cd(h), 'the attack that completes 18 hours starts it, no earlier, no later');
    assert.equal(e.start, last, 'the Expedition starts at the server time of that attack');
    assert.equal(e.ends - e.start, D.durationMs(h, false), 'Jonin: 4 hours'); assert.equal(e.founder, false);
    assert(t - t0 > CAP + 6 * H, 'wall time (rests, bench) was far longer than the duty: only combat counted');
    // On the Expedition: no attack, chakra kept and recovering on the bench, never refilled at completion.
    assert.equal(C.spend(h, 100, e.start + 60000, { dojo: 6, activeSince: e.start, duty: ON }), 0, 'no attack on an Expedition');
    C.setReserve(h, true, e.start + 60000, 6); const frozen = h.chakra.value;   // in Reserve nothing recovers: isolates the release
    C.recover(h, e.ends + 1, 6);
    assert.equal(D.get(h.chakra).exp, undefined, 'Expedition complete'); assert.equal(duty(h), 0, 'Combat Duty reset to 0/18');
    assert.equal(h.chakra.value, frozen, 'completion never refills chakra'); assert.equal(D.get(h.chakra).last.completed, e.ends); assert.equal(D.get(h.chakra).n, 1);
    C.setReserve(h, false, e.ends + 1, 6); C.setResting(h, false, e.ends + 1, 6);
    assert(C.spend(h, 5, e.ends + 20000, { dojo: 6, activeSince: e.ends + 1, duty: ON }) > 0, 'battle-ready again after the Expedition');
  }

  // 4. Founder snapshot: the duration is fixed when the Expedition starts.
  for (let rank = 0; rank < 6; rank++) for (const founder of [false, true]) {
    const h = hero('r' + rank, rank, rank === 5 ? { baseStats: { pw: 17, sp: 17, st: 17 } } : {}); profile([h]); C.setResting(h, false, t0, 0);
    C.state(h, t0).duty = { v: 1, ms: CAP - 1 };
    assert.equal(C.spend(h, 5, t0 + 5000, { activeSince: t0, duty: { founder } }), 1, 'the attack that completes duty is accepted, then it leaves');
    const e = D.get(h.chakra).exp; assert.equal(e.ends - e.start, D.HOURS[rank] * H * (founder ? .5 : 1), D.RANKS[rank] + (founder ? ' Founder' : ''));
    assert.equal(e.founder, founder); assert.equal(e.rank, rank);
  }

  // 5. Online Adventure: only deployed, attacking heroes count; replays never count twice; the away hero leaves the team.
  {
    const a = hero('on1', 0, { bonus: { pw: 0, sp: 0, st: 40 } }), b = hero('on2', 0, { bonus: { pw: 0, sp: 0, st: 40 } }), bench = hero('bench', 0, { bonus: { pw: 0, sp: 0, st: 40 } }), reserve = hero('res', 0, { bonus: { pw: 0, sp: 0, st: 40 } });
    const p = profile([a, b, bench, reserve], ['on1', 'on2', 'bench']);
    // expedition.cjs window() attaches to existing Chest data only (a brand-new player has no duty to count yet).
    const win = d => Object.assign(d, { expeditionWindow: { founder: false } });
    let d = A.advance(null, p, t0, true, 60, report(['on1', 'on2'], {}, 'session-one', 1));
    d = A.advance(win(d), p, t0 + 20000, true, 60, report(['on1', 'on2', 'bench', 'res'], { on1: 8, on2: 8, bench: 8, res: 8 }, 'session-one', 2, ['on1', 'on2']));
    assert.equal(duty(a), 8 * cd(a)); assert.equal(duty(b), 8 * cd(b));
    assert.equal(duty(bench), 0, 'benched heroes never count'); assert.equal(duty(reserve), 0, 'Reserve heroes never count');
    const replay = [duty(a), duty(b)]; d = A.advance(win(d), p, t0 + 20000, true, 60, report(['on1', 'on2'], { on1: 8, on2: 8 }, 'session-one', 2));
    d = A.advance(win(d), p, t0 + 21000, true, 60, report(['on1', 'on2'], { on1: 8, on2: 8 }, 'session-one', 3));
    assert.deepEqual([duty(a), duty(b)], replay, 'a replayed or repeated cumulative report never counts twice');
    // Another tab / device with a stale session is ignored (no duty either).
    d = A.advance(win(d), p, t0 + 22000, true, 60, report(['on1', 'on2'], { on1: 50, on2: 50 }, 'other-device', 5));
    assert.deepEqual([duty(a), duty(b)], replay, 'a second device cannot add attacks');
    // Simultaneous Expeditions: both reach 18 hours in the same report.
    C.state(a, t0).duty.ms = CAP - cd(a); C.state(b, t0).duty.ms = CAP - cd(b);
    d = A.advance(win(d), p, t0 + 40000, true, 60, report(['on1', 'on2'], { on1: 20, on2: 20 }, 'session-one', 4));
    assert(D.away(a.chakra, t0 + 40000) && D.away(b.chakra, t0 + 40000), 'both heroes left on Expeditions');
    assert.deepEqual(d.team, [], 'heroes on an Expedition are removed from combat eligibility');
    assert(a.chakra.resting && b.chakra.resting, 'they rest on the bench');
    d = A.advance(win(d), p, t0 + 60000, true, 60, report(['on1', 'on2'], { on1: 40, on2: 40 }, 'session-one', 5));
    assert.deepEqual(d.team, [], 'redeploying a hero on an Expedition is refused by the server');
    assert.equal(duty(a), CAP); const pending = d.pending;
    d = A.advance(win(d), p, t0 + 90000, true, 60, report(['on1', 'on2'], { on1: 90, on2: 90 }, 'session-one', 6));
    assert.equal(d.pending, pending, 'no reward from a hero on an Expedition');
    // After the Expedition (Jonin? no: Genin 2 hours) the heroes deploy again and duty restarts at zero.
    const back = D.get(a.chakra).exp.ends + 1;
    d = A.advance(win(d), p, back, true, 60, report(['on1', 'on2'], { on1: 90, on2: 90 }, 'session-one', 7));
    assert.deepEqual(d.team, ['on1', 'on2'], 'battle eligibility restored after the Expedition'); assert.equal(duty(a), 0);
  }

  // 6. Offline Sensei: combat counts, an exhausted or departing hero is swapped for an eligible one, the window continues.
  {
    const team = Array.from({ length: 10 }, (_, i) => hero('t' + i, 1, { bonus: { pw: 0, sp: 0, st: 10 } })), spare = hero('spare', 1, { bonus: { pw: 0, sp: 0, st: 10 } });
    const p = profile([...team, spare], [...team.map(h => h.tokenId), 'spare'], { sensei: true, senseiEnabled: true, senseiReturnPercent: 50, dojo: 6 });
    C.state(team[0], t0).duty = { v: 1, ms: CAP - 30000 };   // 30 seconds of combat left
    let d = A.advance(null, p, t0, false, 60);
    d.expeditionWindow = { founder: true };
    d = A.advance(d, p, t0 + 4 * H, false, 60);
    // The 1.5-hour Expedition both starts and completes inside this 4-hour window: its record is `last`.
    const e = D.get(team[0].chakra).exp || D.get(team[0].chakra).last;
    assert(e && e.founder === true, 'offline Sensei combat starts the Expedition (Founder snapshot)');
    assert.equal(e.ends - e.start, 1.5 * H, 'Chunin Founder Expedition: 1 hour 30 minutes');
    assert(e.start > t0 && e.start < t0 + 120000, 'it left after its last 30 seconds of combat');
    for (const h of team.slice(1)) assert(duty(h) > 0 && duty(h) % cd(h) === 0, 'offline Sensei combat counts for every fighter');
    assert(duty(spare) > 0, 'Sensei swapped in another eligible hero');
    assert(d.pending > 0, 'earned verified rewards are kept');
    assert(d.offlineSeconds <= 12 * 3600, 'the 12-hour offline maximum is unchanged');
    // The hero came back inside the same offline window (1.5 hours) and fought again with duty restarting at 0.
    assert.equal(D.get(team[0].chakra).exp, undefined); assert.equal(D.get(team[0].chakra).last.completed, e.ends);
    assert(duty(team[0]) > 0 && duty(team[0]) < CAP, 'after returning it fought again: duty restarted from 0');
  }

  // 7. Boss Hunt attacks count with the option snapshotted at entry.
  {
    const h = hero('hunt', 3, { baseStats: { pw: 12, sp: 12, st: 12 } }); profile([h]); C.recover(h, t0, 0);
    h.chakra.hunt = { id: 'hunt', started: t0, power: 12, cooldown: cd(h), energy: 30, entryId: 'e1', ends: t0 + 60000, spent: 0, duty: { founder: false } }; h.chakra.lockUntil = t0 + 60000;
    C.recover(h, t0 + 10000, 0); const mid = duty(h); assert(mid > 0 && mid % cd(h) === 0, 'hunt attacks count as they are debited');
    C.recover(h, t0 + 70000, 0); const n = Math.min(30, Math.floor((t0 + 59999 - t0) / cd(h)) + 1); assert.equal(duty(h), n * cd(h), 'every debited hunt attack, exactly once');
    const plain = hero('hunt2', 3, { baseStats: { pw: 12, sp: 12, st: 12 } }); profile([plain]); C.recover(plain, t0, 0);
    plain.chakra.hunt = { id: 'hunt2', started: t0, power: 12, cooldown: cd(plain), energy: 30, entryId: 'e2', ends: t0 + 60000, spent: 0 }; plain.chakra.lockUntil = t0 + 60000;
    C.recover(plain, t0 + 70000, 0); assert.equal(plain.chakra.duty, undefined, 'no duty when Expedition Mode was off at entry');
  }

  // 8. Transfers and purchases keep duty with the hero (it lives inside h.chakra).
  {
    const delta = require(app + '/purchase-delta.cjs'), h = hero('moved', 0); const p = profile([h]); C.state(h, t0).duty = { v: 1, ms: 5 * H, exp: { start: t0, ends: t0 + 2 * H, ms: 2 * H, rank: 0, founder: false } };
    const after = structuredClone(p); after.heroes[0].level = 2; const change = delta.delta(p, after);
    const settled = delta.apply(p, change); assert.deepEqual(settled.heroes[0].chakra.duty, h.chakra.duty, 'purchase settlement keeps the current duty and Expedition');
    const listed = JSON.parse(JSON.stringify(h)); assert.deepEqual(listed.chakra.duty, h.chakra.duty, 'a Market snapshot carries the Expedition to the buyer (no reset)');
    assert.equal(D.away(listed.chakra, t0 + H), true, 'the buyer receives it still on its Expedition');
  }

  // 9. Equivalence with the frozen pre-Expedition modules.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expedition-baseline-'));
    for (const f of fs.readdirSync(app)) if (f.endsWith('.cjs') || f.endsWith('.json')) fs.copyFileSync(path.join(app, f), path.join(dir, f));
    for (const f of ['combat-chakra.cjs', 'combat-adventure.cjs']) fs.copyFileSync(path.join(__dirname, 'fixtures/expedition-baseline', f), path.join(dir, f));
    const OA = require(path.join(dir, 'combat-adventure.cjs'));
    let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const make = () => { const heroes = Array.from({ length: 3 + rnd(12) }, (_, i) => hero('q' + i, rnd(6), { baseStats: { pw: 1 + rnd(20), sp: 1 + rnd(20), st: 1 + rnd(20) }, perks: [rnd(7)] }));
      return profile(heroes, heroes.filter(() => rnd(5)).map(h => h.tokenId), { sensei: rnd(2) === 1, senseiEnabled: true, senseiReturnPercent: 50 + 10 * rnd(5), dojo: rnd(7) }); };
    for (let s = 0; s < 60; s++) {
      const base = make(), pOld = structuredClone(base), pOff = structuredClone(base), pOn = structuredClone(base);
      let dOld = null, dOff = null, dOn = null, t = t0, seq = 0;
      const steps = 6 + rnd(10);
      for (let i = 0; i < steps; i++) {
        const online = rnd(3) > 0, ids = base.battleReady.slice(0, 10), counts = Object.fromEntries(ids.map(id => [id, 0]));
        let r = null;
        if (online) { seq++; for (const id of ids) counts[id] = rnd(3) ? 5 * seq + rnd(4) : 0; r = seq === 1 ? report(ids, {}, 'equivalence', seq) : report(ids, counts, 'equivalence', seq); }
        t += online ? 1000 + rnd(60000) : 60000 + rnd(6 * H);
        dOld = OA.advance(dOld && structuredClone(dOld), pOld, t, online, 60, r && structuredClone(r));
        dOff = A.advance(dOff && structuredClone(dOff), pOff, t, online, 60, r && structuredClone(r));
        dOn = A.advance(dOn ? Object.assign(structuredClone(dOn), { expeditionWindow: { founder: false } }) : null, pOn, t, online, 60, r && structuredClone(r));
        assert.deepEqual(dOff, dOld, 'Expedition Mode off: identical Chest data (scenario ' + s + ')');
        assert.deepEqual(pOff, pOld, 'Expedition Mode off: identical heroes and chakra (scenario ' + s + ')');
      }
      // With Expedition Mode on and no hero at 18 hours, every reward and chakra value is identical; duty is only added.
      assert(pOn.heroes.every(h => duty(h) < CAP));
      assert.deepEqual(strip(pOn), strip(pOld), 'Expedition Mode on below 18 hours: identical chakra (scenario ' + s + ')');
      assert.equal(dOn.pending, dOld.pending, 'identical Chest rewards (scenario ' + s + ')'); assert.equal(dOn.kills, dOld.kills); assert.equal(dOn.map, dOld.map);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 11. Review fixes: switching Expedition Mode off suspends Expeditions (no block, no accrual); offline Sensei keeps an away
  // hero's team slot (it rests, then fights again when back) instead of shrinking the team.
  {
    const a = hero('sw1', 0, { bonus: { pw: 0, sp: 0, st: 40 } }), b = hero('sw2', 0, { bonus: { pw: 0, sp: 0, st: 40 } }), p = profile([a, b]);
    C.state(a, t0).duty = { v: 1, ms: CAP, exp: { start: t0, ends: t0 + 2 * H, ms: 2 * H, rank: 0, founder: false } };
    let d = A.advance(null, p, t0, true, 60, report(['sw1', 'sw2'], {}, 'switch-off', 1));
    d = A.advance(d, p, t0 + 20000, true, 60, report(['sw1', 'sw2'], { sw1: 5, sw2: 5 }, 'switch-off', 2));   // no window: switch off
    assert(d.team.includes('sw1'), 'switch off: a hero with a running Expedition is not blocked');
    assert.equal(d.combatSessions['switch-off'].heroes.sw1.accepted, 5, 'switch off: its attacks are accepted');
    assert.equal(duty(a), CAP, 'switch off: nothing accrues');
    d.expeditionWindow = { founder: false }; d = A.advance(d, p, t0 + 40000, true, 60, report(['sw1', 'sw2'], { sw1: 10, sw2: 10 }, 'switch-off', 3));
    assert(!d.team.includes('sw1'), 'switch back on: the Expedition resumes on its original timestamps');
  }
  {
    const team = [hero('slot0', 1, { bonus: { pw: 0, sp: 0, st: 10 } }), hero('slot1', 1, { bonus: { pw: 0, sp: 0, st: 10 } }), hero('slot2', 1, { bonus: { pw: 0, sp: 0, st: 10 } })];
    const p = profile(team, team.map(h => h.tokenId), { sensei: true, senseiEnabled: true, senseiReturnPercent: 90, dojo: 6 });
    C.state(team[0], t0).duty = { v: 1, ms: CAP - 5000 };
    let d = A.advance(null, p, t0, false, 60); d.expeditionWindow = { founder: false };
    d = A.advance(d, p, t0 + 600000, false, 60);
    assert(D.away(team[0].chakra, t0 + 600000), 'it left during the offline window (nobody on the bench to swap in)');
    assert.deepEqual(d.team.slice().sort(), ['slot0', 'slot1', 'slot2'], 'offline: the away hero keeps its Sensei team slot');
    assert(team[0].chakra.resting, 'it rests while away');
    d.expeditionWindow = { founder: false }; d = A.advance(d, p, t0 + 4 * H, false, 60);
    assert(duty(team[0]) > 0 && duty(team[0]) < CAP, 'back after 3 hours: it fights again in its slot');
  }

  // 10. Performance: 1,000 players returning together (offline Sensei, 10 fighters each), Expedition Mode off vs on, plus a
  // 12-hour sample. Remaining times are computed on demand (no timers); the only extra work is a comparison per attack.
  {
    const players = (n, nearCap) => Array.from({ length: n }, (_, k) => { const heroes = Array.from({ length: 12 }, (_, i) => hero('p' + k + 'h' + i, i % 6, { baseStats: { pw: 3 + i, sp: 1 + (i % 9), st: 3 + i } }));
      const p = profile(heroes, heroes.map(h => h.tokenId), { sensei: true, senseiEnabled: true, senseiReturnPercent: 50, dojo: 6 });
      if (k % 3 === 0) C.state(heroes[0], t0).duty = { v: 1, ms: CAP - nearCap };   // a third of the players see an Expedition start
      return { p, d: A.advance(null, p, t0, false, 60) }; });
    const run = (n, hours, on) => { const list = players(n, 60000), start = performance.now(); for (const x of list) { if (on) x.d.expeditionWindow = { founder: false }; A.advance(x.d, x.p, t0 + hours * H, false, 60); } return { ms: performance.now() - start, list }; };
    const off = run(1000, .5, false), on = run(1000, .5, true);
    const started = on.list.filter(x => x.p.heroes.some(h => D.get(h.chakra)?.exp || D.get(h.chakra)?.last)).length;
    assert(started >= 333, 'Expeditions started during the offline settlement for every near-limit player');
    const offLong = run(25, 12, false), onLong = run(25, 12, true);
    console.log('Performance: 1,000 players returning after 30 min offline Sensei: off ' + Math.round(off.ms) + ' ms, on ' + Math.round(on.ms) + ' ms (x' + (on.ms / off.ms).toFixed(2) + ', ' + started + ' Expedition transitions); ' +
      '12 h offline sample: off ' + (offLong.ms / 25).toFixed(0) + ' ms/player, on ' + (onLong.ms / 25).toFixed(0) + ' ms/player.');
    assert(on.ms / off.ms < 1.6 && onLong.ms / offLong.ms < 1.6, 'Expedition Mode adds little to the offline settlement CPU time');
  }
  console.log('PASS: Expedition Combat Duty: cooldown-per-accepted-attack accounting, exact 18 h trigger, six rarity durations, Founder 50% snapshot, rest/bench/Reserve/idle excluded, replay and device safety, Sensei swap and in-window return, Boss Hunt, transfers, frozen-module equivalence, 1,000-player load.');
})().catch(e => { console.error(e); process.exit(1); });
