'use strict';
/* Summoning Shrine Legend hard pity (owner request 2026-11-11), real Store / PGlite. Only paid Shrine summons (game balance or
 * Chest rewards) count; a Legend is guaranteed by the 150th in a row without one; any Shrine Legend resets; the counter moves only
 * at confirmed settlement; every other hero source leaves it alone. The Shrine rarity roll (crypto.randomInt(10000)) is
 * controlled in-process; hero stats still use real randomness. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), economy = require('../app/server/economy.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
const ROLL = { genin: 0, chunin: 6000, jonin: 8500, elite: 9500, legend: 9900 };
let queue = []; const original = crypto.randomInt;
crypto.randomInt = function (a, b, ...rest) { return a === 10000 && b === undefined && queue.length ? queue.shift() : original.call(this, a, b, ...rest); };
(async () => {
  const env = { ...process.env }; Object.assign(process.env, { CHEST_SPENDING_ENABLED: 'on', REWARD_CLAIMS_ENABLED: 'on' });
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(), now = Date.UTC(2026, 10, 11, 12), rid = 0;
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'shrine-pity-test', () => now);
  const tx = async () => ({ signature: 'pity-sig-' + crypto.randomUUID(), wire: 'wire', lastHeight: 1 });
  const id = () => 'pity-request-' + String(++rid).padStart(6, '0');
  const pityOf = async w => (await store.profile(w)).shrineLegendPity ?? 0;
  const setPity = async (w, n) => { const p = await store.profile(w); p.shrineLegendPity = n; await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, JSON.stringify(p)]); };
  const player = async (balance = 1e7) => { const w = address(); await store.profile(w); await pool.query('UPDATE ryo_accounts SET balance=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, balance]); return w; };
  const summon = async (w, quantity, rolls, { settle = 'confirmed', request = id(), via = null } = {}) => {
    queue = rolls.map(r => ROLL[r]);
    const row = via ? await store.purchaseWith(via, w, request, 'summon', { quantity }, economy.quote(await store.profile(w), 'summon', { quantity }).total, tx)
      : await store.purchase(w, request, 'summon', { quantity }, economy.quote(await store.profile(w), 'summon', { quantity }).total, tx);
    assert.equal(queue.length, 0, 'every planned roll was used'); queue = [];
    if (settle) await store.settlePurchase(w, row.request_id, settle);
    return row;
  };
  const ranks = row => row.result.outputs.map(h => h.rank);

  /* ---------- Counting ---------- */
  const a = await player();
  assert.equal(await pityOf(a), 0, 'a new account starts at 0');
  for (const [r, n] of [['genin', 1], ['chunin', 2], ['jonin', 3], ['elite', 4]]) { await summon(a, 1, [r]); assert.equal(await pityOf(a), n, r + ' adds 1'); }
  const nat = await summon(a, 1, ['legend']);
  assert.equal(await pityOf(a), 0, 'a natural Legend resets'); assert.deepEqual(nat.result.pity, { before: 4, after: 0, guaranteed: [], legends: [0], threshold: 150 });
  assert.equal(nat.result.outputs[0].shrinePity, undefined, 'a natural Legend is not marked as a pity guarantee');
  // Pending does not count until settlement; a refund never counts.
  const pend = await summon(a, 1, ['genin'], { settle: null });
  assert.equal(await pityOf(a), 0, 'a pending purchase does not move pity');
  await store.settlePurchase(a, pend.request_id, 'refunded'); assert.equal(await pityOf(a), 0, 'a refunded purchase never counts');
  await summon(a, 1, ['genin'], { settle: 'refunded' }); assert.equal(await pityOf(a), 0);
  // Replays: the same request and a second settlement count once.
  const once = await summon(a, 1, ['genin'], { request: 'pity-replay-000001' }); assert.equal(await pityOf(a), 1);
  await store.settlePurchase(a, once.request_id, 'confirmed');
  assert.equal((await store.purchase(a, 'pity-replay-000001', 'summon', { quantity: 1 }, 25000, tx)).request_id, once.request_id);
  assert.equal(await pityOf(a), 1, 'a replayed request or settlement never counts twice');

  /* ---------- The 150th summon and batches ---------- */
  await setPity(a, 149);
  const g1 = await summon(a, 1, []);
  assert.deepEqual([ranks(g1)[0], g1.result.outputs[0].shrinePity, await pityOf(a)], [4, 'guaranteed', 0], 'the 150th summon is a guaranteed Legend, then 0');
  await setPity(a, 147);
  const b5 = await summon(a, 5, ['genin', 'genin', 'jonin', 'chunin']);   // 148, 149, then the guarantee, then 2 normal
  assert.deepEqual(ranks(b5), [0, 0, 4, 2, 1]); assert.deepEqual(b5.result.pity, { before: 147, after: 2, guaranteed: [2], legends: [2], threshold: 150 });
  assert.equal(await pityOf(a), 2, 'a batch crossing the threshold continues counting after the guarantee');
  await setPity(a, 149);
  const b10 = await summon(a, 10, Array(9).fill('genin'));
  assert.deepEqual(ranks(b10), [4, 0, 0, 0, 0, 0, 0, 0, 0, 0]); assert.equal(await pityOf(a), 9, '149 + ×10: the first is guaranteed');
  await setPity(a, 90);
  const b15 = await summon(a, 15, ['genin', 'chunin', 'jonin', 'legend', ...Array(11).fill('elite')]);
  assert.deepEqual(b15.result.pity, { before: 90, after: 11, guaranteed: [], legends: [3], threshold: 150 }, 'a natural Legend early in a batch resets mid-batch');
  assert(ranks(b15).every(r => r >= 0 && r <= 4), 'never Mythic');
  await setPity(a, 140);
  await summon(a, 5, Array(5).fill('genin')); assert.equal(await pityOf(a), 145, '×5 without reaching the threshold adds 5');

  /* ---------- Funding: balance and Chest share one counter; free starter Ryo does not count ---------- */
  const c = await player(0);
  await pool.query('INSERT INTO ryo_adventures(scope,wallet,data) VALUES($1,$2,$3)', [store.scope, c, JSON.stringify({ map: 1, pending: 200000 * 1000, claimed: 0, last: now, active: false, energy: {} })]);
  await pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,$3,'summon','{}',$4,'{}','{}',1,$5,'w',1,'confirmed',$6)", [store.scope, address(), id(), JSON.stringify({ operations: 1e9 }), 'income-' + crypto.randomUUID(), now]);
  await summon(c, 1, ['genin'], { via: { funding: 'chest', custody: async () => 1e9 } });
  assert.equal(await pityOf(c), 1, 'a Chest-funded summon counts');
  await pool.query('UPDATE ryo_accounts SET balance=1000000 WHERE scope=$1 AND wallet=$2', [store.scope, c]);
  await summon(c, 1, ['genin']); assert.equal(await pityOf(c), 2, 'the same counter for game balance');
  const bonus = await player(0); await pool.query('UPDATE ryo_accounts SET bonus=1000000 WHERE scope=$1 AND wallet=$2', [store.scope, bonus]);
  const bz = await summon(bonus, 1, ['genin']);
  assert.equal(bz.quote.funding, 'bonus'); assert.equal(bz.result.pity, undefined); assert.equal(await pityOf(bonus), 0, 'free starter Ryo never counts');

  /* ---------- Concurrent purchases are sequential ---------- */
  const k = await player(); await setPity(k, 10); queue = [ROLL.genin, ROLL.genin];
  const both = await Promise.allSettled([0, 1].map(() => store.purchase(k, id(), 'summon', { quantity: 1 }, 25000, tx)));
  queue = [];
  assert.equal(both.filter(x => x.status === 'fulfilled').length, 1, 'one pending purchase at a time');
  await store.settlePurchase(k, both.find(x => x.status === 'fulfilled').value.request_id, 'confirmed');
  assert.equal(await pityOf(k), 11);

  /* ---------- Every other hero source leaves pity alone ---------- */
  const o = await player(); await setPity(o, 149);
  const before = await store.profile(o), viaShared = economy.fulfill(before, economy.quote(before, 'summon', { quantity: 1 }), now);   // referral claim / Creator Shop path
  assert.equal(viaShared.result.pity, undefined); assert.equal(viaShared.profile.shrineLegendPity, 149, 'fulfill without the Shrine option never touches pity');
  assert.notEqual(viaShared.result.outputs[0].shrinePity, 'guaranteed', 'and never guarantees');
  await require('../app/server/prison-rescue.cjs').staffGrant(store, o, { rank: 4, requestId: 'staff-grant-' + crypto.randomUUID().slice(0, 12) });
  assert.equal(await pityOf(o), 149, 'a staff/rescue Legend does not reset pity');
  const fz = await store.profile(o), group = Array.from({ length: 3 }, () => ({ ...economy.hero(0), tokenId: crypto.randomUUID() }));
  fz.heroes.push(...group); fz.battleReady = fz.battleReady.filter(t => !group.some(g => g.tokenId === t)); await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, o, JSON.stringify(fz)]);
  const fq = economy.quote(await store.profile(o), 'fusion', { heroIds: group.map(h => h.tokenId), fusionRulesVersion: 1, fusionRulesAccepted: 1 });
  const fr = await store.purchase(o, id(), 'fusion', { heroIds: group.map(h => h.tokenId), fusionRulesVersion: 1, fusionRulesAccepted: 1 }, fq.total, tx);
  await store.settlePurchase(o, fr.request_id, 'confirmed'); assert.equal(await pityOf(o), 149, 'fusion never changes pity');

  /* ---------- Prices unchanged ---------- */
  for (const q of [1, 5, 10, 15]) assert.equal(economy.quote({ heroes: [] }, 'summon', { quantity: q }).total, 25000 * q, 'price ×' + q + ' unchanged');

  crypto.randomInt = original; await db.close();
  for (const k2 of Object.keys(process.env)) if (!(k2 in env)) delete process.env[k2]; Object.assign(process.env, env);
  console.log('PASS: Shrine Legend pity — each non-Legend paid summon +1, any Shrine Legend resets, the 150th is guaranteed (×1/×5/×10/×15, mid-batch thresholds and natural Legends), counted only at confirmed settlement (pending/refund/replay never), balance and Chest share it, starter Ryo, referral/Creator Shop fulfil, rescue/staff grants and fusion never touch it, prices unchanged, never Mythic.');
})().catch(e => { console.error(e); process.exitCode = 1; });
