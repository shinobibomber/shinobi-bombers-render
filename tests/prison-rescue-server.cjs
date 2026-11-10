'use strict';
/* Prison rescue grants (owner request 2026-11-10): a freed Adventure prisoner becomes a real, server-granted, account-bound hero.
 * Every prison cage counts (no daily limit); one hero per prison kill VERIFIED by the authoritative combat accounting; only while
 * actively playing; Shrine odds, never Mythic; salvageable; cheat guard: rescue heroes are 100,000 HP of verified enemy damage
 * apart (labelling kills differently does not help), and a prisoner freed sooner waits (at most 3) instead of being lost, across
 * page reloads too. Isolated PGlite fixtures only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), rescue = require('../app/server/prison-rescue.cjs');
const A = require('../app/server/combat-adventure.cjs'), R = require('../app/server/combat-rules.cjs'), economy = require('../app/server/economy.cjs');
const upgrades = require('../app/server/hero-upgrades.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
let seq = 0; const rid = () => 'rescue-request-' + String(++seq).padStart(6, '0');
(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(), now = Date.UTC(2026, 10, 10, 12);
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  // A connection holds the queue for its whole transaction, like a real row lock would serialize the same wallet.
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'prison-rescue-test', () => now);
  const rows = async (s, a = []) => (await pool.query(s, [store.scope, ...a])).rows;
  const owned = async w => (await store.profile(w)).heroes;
  const heroes = async w => (await owned(w)).filter(h => h.prisonRescue);   // a new test-build profile may start with practice heroes
  const setAdventure = (w, d) => pool.query('INSERT INTO ryo_adventures(scope,wallet,data) VALUES($1,$2,$3) ON CONFLICT(scope,wallet) DO UPDATE SET data=$3', [store.scope, w, JSON.stringify(d)]);
  const getAdventure = async w => (await rows('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [w]))[0]?.data;
  // The structure combat-adventure.cjs keeps: page sessions with verified per-hero kills [Genin..Legend enemies, prison].
  // `genin` = verified kind-0 kills (100 HP each); keep = older sessions still kept.
  const session = (genin, prison, at = now) => ({ at, heroes: { h1: { seen: 9999, accepted: 9999, kills: [genin, 0, 0, 0, prison] } } });
  const seed = (w, { id = 'session-aaaa-1', genin = 0, prison = 0, active = true, age = 1000, keep = {} } = {}) =>
    setAdventure(w, { active, lastReport: now - age, sessionId: id, combatVersion: 1, combatSessions: { ...keep, [id]: session(genin, prison, now - age) } });
  const claim = (w, id = rid(), roll = 0) => rescue.claim(store, w, { requestId: id }, { random: () => roll });

  /* ---------- Odds: Shrine table, never Mythic ---------- */
  for (const [roll, rank] of [[0, 0], [5999, 0], [6000, 1], [8499, 1], [8500, 2], [9499, 2], [9500, 3], [9899, 3], [9900, 4], [9999, 4]]) assert.equal(rescue.rankFor(roll), rank, 'roll ' + roll);
  assert.deepEqual([60, 25, 10, 4, 1], rescue.ODDS.map((v, i) => (v - (rescue.ODDS[i - 1] || 0)) / 100), 'Genin 60 / Chunin 25 / Jonin 10 / Elite 4 / Legend 1');
  assert.deepEqual(rescue.ENEMY_HP, A.HP.slice(0, 4), 'the damage table is the combat accounting\'s');
  assert.deepEqual(rescue.totals({ heroes: { a: { kills: [2, 1, 1, 1, 3] }, b: { kills: [1, 0, 0, 0, 1] } } }), { hp: 3 * 100 + 213 + 1000 + 1625, prison: 4 }, 'prison HP never counts as spacing damage');

  /* ---------- Only while actively playing, only verified kills ---------- */
  const w = address(); await store.profile(w);
  await assert.rejects(rescue.claim(store, w, { requestId: 'short' }), /Invalid request ID/);
  assert.equal((await claim(w)).status, 'inactive', 'no Adventure session at all');
  await seed(w, { prison: 1, age: rescue.FRESH_MS + 1 }); const stale = await claim(w);
  assert.equal(stale.status, 'inactive', 'stale report (> 2 minutes)'); assert.equal(stale.waiting, 1, 'the verified prisoner is remembered');
  await seed(w, { prison: 1, active: false }); assert.equal((await claim(w)).status, 'inactive', 'not playing');
  await seed(w, { prison: 1 }); assert.equal((await claim(w)).status, 'granted', 'the remembered prisoner arrives once playing');
  assert.equal((await claim(w)).status, 'unverified', 'and only once');
  const nothing = address(); await store.profile(nothing); await seed(nothing, { genin: 50 });
  assert.equal((await claim(nothing)).status, 'unverified', 'no verified prison kill, no hero');

  // End to end through the real combat accounting: a claimed prison kill without the damage behind it is NOT verified...
  const profile = economy.normalizeProfile({ dojo: 6, heroes: [{ tokenId: 'h1', rank: 5, trainingVersion: 2, baseStats: { pw: 20, sp: 20, st: 20 }, perks: [0, 1, 2, 3, 4, 5, 6] }], battleReady: ['h1'] });
  const report = (attacks, kills, id) => ({ combatVersion: 1, killSession: id, killStage: 25, deployed: ['h1'], combatHeroes: [{ id: 'h1', attacks, kills }] });
  const e2e = address(); await store.profile(e2e);
  let d = A.advance(null, profile, now, true, 60, report(0, [0, 0, 0, 0, 0], 'session-fake-01')); now += 1500;
  d = A.advance(d, profile, now, true, 60, report(2, [0, 0, 0, 0, 1], 'session-fake-01'));
  assert.equal(d.combatSessions['session-fake-01'].heroes.h1.kills[4], 0, 'combat accounting refuses an unpaid prison kill');
  await setAdventure(e2e, d); assert.equal((await claim(e2e)).status, 'unverified', 'a fake prison kill grants nothing');
  // ...and a real one (125 attacks x 20 Power >= 2,500 HP) is.
  d = A.advance(d, profile, now, true, 60, report(0, [0, 0, 0, 0, 0], 'session-real-01'));
  const need = Math.ceil(2500 / R.damage(profile.heroes[0]));
  for (let a = 5; a <= need + 5; a += 5) { now += 5 * R.cooldown(profile.heroes[0]) * 1000 + 50; d = A.advance(d, profile, now, true, 60, report(Math.min(a, need), [0, 0, 0, 0, a >= need ? 1 : 0], 'session-real-01')); }
  assert.equal(d.combatSessions['session-real-01'].heroes.h1.kills[4], 1, 'the real prison kill is verified');
  await setAdventure(e2e, d);
  const first = await claim(e2e, 'rescue-replay-0001', 9999);
  assert.equal(first.status, 'granted'); assert.equal(first.rank, 4, 'roll 9999 is Legend, never Mythic'); assert.equal(first.waiting, 0);
  const own = await heroes(e2e); assert.equal(own.length, 1, 'the hero is in the server profile (inventory)');
  assert.equal(own[0].tokenId, first.hero.tokenId); assert.equal(own[0].rank, 4);
  assert.equal(own[0].referralReward, true, 'account-bound: the Market refuses referralReward heroes; fusion keeps the binding');
  assert.equal(own[0].prisonRescue, true); assert(own[0].baseStats && own[0].name, 'a full Shrine-style hero');
  // Replays: same id returns the same grant (no second hero); another wallet cannot reuse it.
  const again = await claim(e2e, 'rescue-replay-0001'); assert.equal(again.replay, true); assert.equal(again.hero.tokenId, first.hero.tokenId);
  await assert.rejects(claim(address(), 'rescue-replay-0001'), /another rescue/);
  assert.equal((await heroes(e2e)).length, 1, 'a replay never adds a hero');
  assert.equal((await claim(e2e)).status, 'unverified', 'the same prison kill never grants twice');
  assert.equal((await rows('SELECT * FROM ryo_prison_rescues WHERE scope=$1 AND wallet=$2', [e2e])).length, 1);
  // Owner decision 2026-11-10: rescued heroes can be salvaged for Upgrade Shards like any other hero.
  const salvaged = economy.normalizeProfile(structuredClone(await store.profile(e2e))), shardsBefore = salvaged.upgradeShards;
  upgrades.salvageProfile(salvaged, first.hero.tokenId, now);
  assert(!salvaged.heroes.some(h => h.tokenId === first.hero.tokenId) && salvaged.upgradeShards > shardsBefore, 'a rescued hero salvages into Upgrade Shards');

  /* ---------- Every cage counts (no daily limit), 100,000 verified HP apart, waiting prisoners are kept ---------- */
  const p = address(); await store.profile(p);
  await seed(p, { genin: 100, prison: 1 }); assert.equal((await claim(p)).status, 'granted', 'first rescue needs no spacing');
  now += 60000; await seed(p, { genin: 110, prison: 2 });
  const early = await claim(p); assert.equal(early.status, 'early'); assert.equal(early.waiting, 1, 'the second prisoner waits'); assert.equal(early.progress, 1, '10 x 100 HP of 100,000');
  now += 60000; await seed(p, { genin: 1099, prison: 2 }); assert.equal((await claim(p)).progress, 99, 'counted from the grant at 100 kills');
  now += 60000; await seed(p, { genin: 1100, prison: 2 });
  const second = await claim(p); assert.equal(second.status, 'granted', 'minutes later, no 24 h limit: every verified cage counts'); assert.equal(second.waiting, 0);
  assert.equal((await heroes(p)).length, 2);
  // Page reloads: progress and prisoners of earlier page sessions still kept by the combat accounting are counted, including a
  // session that never asked (the client checks in once per page load, but a closed tab may not have).
  now += 60000; await seed(p, { genin: 1200, prison: 3 }); assert.equal((await claim(p)).status, 'early');   // +10,000 HP, 1 waiting
  const keep1 = (await getAdventure(p)).combatSessions;
  now += 60000; await seed(p, { id: 'session-bbbb-2', genin: 300, prison: 1, keep: keep1 });   // never asked in this one
  const keep2 = (await getAdventure(p)).combatSessions;
  now += 60000; await seed(p, { id: 'session-cccc-3', genin: 610, keep: keep2 });
  const reloaded = await claim(p); assert.equal(reloaded.status, 'granted', '10,000 + 30,000 + 61,000 HP over three page sessions'); assert.equal(reloaded.waiting, 1, 'the prisoner from the session that never asked still waits');
  now += 60000; await seed(p, { id: 'session-cccc-3', genin: 1609, keep: keep2 }); assert.equal((await claim(p)).status, 'early', 'still 100,000 HP apart');
  now += 60000; await seed(p, { id: 'session-cccc-3', genin: 1610, keep: keep2 }); assert.equal((await claim(p)).status, 'granted');
  assert.equal((await claim(p)).status, 'unverified'); assert.equal((await heroes(p)).length, 4);
  // Labelling cheap kills as prison kills does not help: at most 3 wait, and each still needs 100,000 verified HP.
  now += 60000; await seed(p, { id: 'session-cccc-3', genin: 1610, prison: 0, keep: { 'session-dddd-4': session(0, 10) } });
  const flood = await claim(p); assert.equal(flood.status, 'early'); assert.equal(flood.waiting, 3, 'at most 3 waiting');
  for (let i = 1; i <= 3; i++) { now += 60000; await seed(p, { id: 'session-cccc-3', genin: 1610 + 1000 * i, keep: { 'session-dddd-4': session(0, 10) } }); assert.equal((await claim(p)).status, 'granted', 'one per 100,000 HP: ' + i); }
  now += 60000; await seed(p, { id: 'session-cccc-3', genin: 6000, keep: { 'session-dddd-4': session(0, 10) } }); assert.equal((await claim(p)).status, 'unverified', '10 claimed prison kills gave 3 heroes, the rest were dropped');
  assert.equal((await heroes(p)).length, 7);

  /* ---------- Pending purchase and a full collection wait; nothing is used up ---------- */
  const q = address(); await store.profile(q); await seed(q, { prison: 1 });
  await pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,'pending-purchase-0001','summon','{}','{}','{}','{}',1,'sig-pending-1','wire',1,'pending',$3)", [store.scope, q, now]);
  assert.equal((await claim(q)).status, 'pending');
  await pool.query("UPDATE ryo_purchases SET status='confirmed' WHERE scope=$1 AND wallet=$2", [store.scope, q]);
  const full = economy.normalizeProfile({ heroes: Array.from({ length: 500 }, () => economy.hero(0)) });
  await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, q, JSON.stringify(full)]);
  const fullAnswer = await claim(q); assert.equal(fullAnswer.status, 'full'); assert.equal(fullAnswer.waiting, 1);
  full.heroes.pop(); await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, q, JSON.stringify(full)]);
  assert.equal((await claim(q)).status, 'granted', 'the prisoner joins once a slot is free'); assert.equal((await owned(q)).length, 500);

  /* ---------- Parallel requests for one verified kill grant exactly one hero ---------- */
  const r = address(); await store.profile(r); await seed(r, { prison: 1 });
  const both = await Promise.all([claim(r), claim(r), claim(r)]);
  assert.equal(both.filter(x => x.status === 'granted').length, 1, 'one hero for one prison kill: ' + both.map(x => x.status));
  assert.equal((await heroes(r)).length, 1);

  /* ---------- Gates: reward-claims launch gate and the operator "purchases" pause ---------- */
  assert.equal(require('../app/server/launch-gates.cjs').gateFor('prison-rescue'), 'rewardClaims');
  await pool.query("INSERT INTO ryo_admin_control(scope,pauses,installed) VALUES($1,$2,$3) ON CONFLICT(scope) DO UPDATE SET pauses=$2", [store.scope, JSON.stringify({ purchases: true }), now]);
  await assert.rejects(require('../app/server/economic-dashboard.cjs').guard(store, 'prison-rescue', r, {}), /paused/);
  const service = fs.readFileSync(path.join(__dirname, '../app/server/service.cjs'), 'utf8');
  assert.equal(service.split("if(action==='prison-rescue')").length - 1, 1, 'one service route');
  assert(service.includes("{prisonRescue:rescue,...await state(wallet).catch(()=>({}))}"), 'a failed state read never hides a committed grant');

  /* ---------- Client wiring (built index.html) ---------- */
  const html = fs.readFileSync(path.join(__dirname, '../app/public/index.html'), 'utf8');
  const boom = html.split(/\r?\n/).find(l => l.startsWith(' boom=function(b){'));
  assert(boom.includes("if(window.PrisonRescue?.online()){fl.push({x:b.tx,y:b.ty,t:1,s:'PRISONER FREED'});PrisonRescue.claim({x:b.tx,y:b.ty})}"), 'signed in: the server grants the hero');
  assert(boom.includes("else{const rank=GameBalance.rollRarity();const hero=mk(rank,false);S.h.push(hero)"), 'signed out practice keeps the original local hero');
  assert(boom.indexOf("dispatchEvent(new CustomEvent('shinobi-enemy-defeated'") < boom.indexOf('if(kind===6)'), 'the kill event (Chest + kill report) fires before the rescue');
  assert.equal(html.split("prisonRescue:(body={})=>api('prison-rescue',body)").length - 1, 1);
  assert.equal(html.split('<script defer src="assets/prison-rescue/prison-rescue.js"></script>').length - 1, 1);
  assert(fs.existsSync(path.join(__dirname, '../app/public/assets/prison-rescue/prison-rescue.js')));
  await db.close();
  console.log('PASS: prison rescue — every verified prison kill grants one server-side, account-bound hero (Shrine odds, never Mythic, salvageable), only while playing; fake kills, replays and parallel requests grant nothing extra; 100,000 verified HP apart with up to 3 waiting prisoners kept across page reloads; pending purchase / full collection wait; gates and client wiring.');
})().catch(e => { console.error(e); process.exitCode = 1; });
