'use strict';
/* Fusion Shards (owner request 2026-11-11), real Store / PGlite: crafting 2 Upgrade Shards -> 1 Fusion Shard (idempotent, refused
 * while a purchase is pending, all or nothing) and the fusion success boost (+5% per Fusion Shard per attempt, up to 100%),
 * checked at quote, purchase and confirmed settlement; consumed on success and failure, never on refund. The fusion roll
 * (crypto.randomInt(100)) is controlled in-process. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), economy = require('../app/server/economy.cjs'), FS = require('../app/server/fusion-shards.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
let rolls = []; const original = crypto.randomInt;
crypto.randomInt = function (a, b, ...rest) { return a === 100 && b === undefined && rolls.length ? rolls.shift() : original.call(this, a, b, ...rest); };
const rejects = async (p, re, msg) => { await assert.rejects(p, e => re.test(e.message), msg); };
(async () => {
  const env = { ...process.env }; Object.assign(process.env, { CHEST_SPENDING_ENABLED: 'on', REWARD_CLAIMS_ENABLED: 'on' });
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(), now = Date.UTC(2026, 10, 11, 12), rid = 0;
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'fusion-shards-test', () => now);
  const tx = async () => ({ signature: 'fs-sig-' + crypto.randomUUID(), wire: 'wire', lastHeight: 1 });
  const id = () => 'fs-request-' + String(++rid).padStart(8, '0');
  const save = async (w, p) => pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, JSON.stringify(p)]);
  const shards = async w => { const p = await store.profile(w); return [p.upgradeShards, p.fusionShards ?? 0]; };
  const balanceOf = async w => Number((await pool.query('SELECT balance FROM ryo_accounts WHERE scope=$1 AND wallet=$2', [store.scope, w])).rows[0].balance);
  const player = async ({ upgrade = 0, fusion, balance = 1e7 } = {}) => {
    const w = address(), p = await store.profile(w); p.upgradeShards = upgrade; if (fusion !== undefined) p.fusionShards = fusion; await save(w, p);
    await pool.query('UPDATE ryo_accounts SET balance=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, balance]); return w;
  };
  const craft = (w, body) => FS.craft(store, w, { requestId: id(), craftRulesVersion: 1, ...body });
  // Adds n groups of three Reserve heroes of `rank` (level 5) and returns their ids.
  const group = async (w, rank, n = 1) => {
    const p = await store.profile(w), list = Array.from({ length: 3 * n }, () => ({ ...economy.hero(rank), tokenId: crypto.randomUUID(), level: 5 }));
    p.heroes.push(...list); p.battleReady = p.battleReady.filter(t => !list.some(h => h.tokenId === t)); await save(w, p); return list.map(h => h.tokenId);
  };
  const params = (heroIds, fusionShards) => ({ heroIds, fusionRulesVersion: 1, fusionRulesAccepted: 1, ...(fusionShards === undefined ? {} : { fusionShards }) });
  const quote = async (w, ids, n) => economy.quote(await store.profile(w), 'fusion', params(ids, n));
  const fuse = async (w, ids, n, { roll = [], settle = 'confirmed', via = null } = {}) => {
    const q = await quote(w, ids, n); rolls = [...roll];
    const row = via ? await store.purchaseWith(via, w, id(), 'fusion', params(ids, n), q.total, tx) : await store.purchase(w, id(), 'fusion', params(ids, n), q.total, tx);
    assert.equal(rolls.length, 0, 'every planned roll was used'); rolls = [];
    if (settle) await store.settlePurchase(w, row.request_id, settle);
    return row;
  };

  /* ---------- Crafting ---------- */
  const a = await player({ upgrade: 9 });
  const before = await balanceOf(a);
  assert.deepEqual(await craft(a, { quantity: 1 }), { quantity: 1, upgradeShards: 7, fusionShards: 1 }, 'craft 1');
  assert.deepEqual(await shards(a), [7, 1]);
  assert.deepEqual(await craft(a, { quantity: 2 }), { quantity: 2, upgradeShards: 3, fusionShards: 3 }, 'craft several');
  assert.deepEqual(await craft(a, { max: true }), { quantity: 1, upgradeShards: 1, fusionShards: 4 }, 'Craft Max with an odd balance leaves the odd shard');
  await rejects(craft(a, { max: true }), /needs 2 Upgrade Shards\. You have 1/, 'Max with 1 Upgrade Shard is refused');
  await rejects(craft(a, { quantity: 1 }), /needs 2 Upgrade Shards\. You have 1/, 'insufficient Upgrade Shards');
  assert.deepEqual(await shards(a), [1, 4], 'a refused craft changes nothing');
  assert.equal(await balanceOf(a), before, 'crafting never touches Ryo');
  const e = await player({ upgrade: 8 });
  assert.deepEqual(await craft(e, { max: true }), { quantity: 4, upgradeShards: 0, fusionShards: 4 }, 'Craft Max with an even balance');
  for (const bad of [{ quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: '2' }, {}, { quantity: 1, craftRulesVersion: 2 }, { quantity: 1, requestId: 'short' }])
    await rejects(craft(e, bad), /Choose how many|Review the Fusion Shard crafting/, 'invalid craft request ' + JSON.stringify(bad));
  // Idempotent request id.
  const r = await player({ upgrade: 6 }), same = { quantity: 2, requestId: 'fs-replay-0000000001', craftRulesVersion: 1 };
  const both = await Promise.all([FS.craft(store, r, same), FS.craft(store, r, same)]);
  assert.deepEqual(both.map(x => x.fusionShards), [2, 2]); assert.deepEqual(await shards(r), [2, 2], 'a repeated request crafts once');
  await rejects(FS.craft(store, r, { ...same, quantity: 1 }), /different amount/, 'a reused request id with another amount is refused');
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_fusion_shard_crafts WHERE wallet=$1', [r])).rows[0].n), 1, 'one receipt');
  // Concurrent crafts cannot overspend.
  const k = await player({ upgrade: 3 });
  const race = await Promise.allSettled([craft(k, { quantity: 1 }), craft(k, { quantity: 1 })]);
  assert.equal(race.filter(x => x.status === 'fulfilled').length, 1, 'two crafts against 3 Upgrade Shards: only one succeeds');
  assert.deepEqual(await shards(k), [1, 1]);
  // Refused while a purchase is pending; a pending Training settlement keeps its Upgrade Shards.
  const t = await player({ upgrade: 4 }), tp = await store.profile(t), trainee = tp.heroes[0];
  const tq = economy.quote(tp, 'training', { heroId: trainee.tokenId });
  const tr = await store.purchase(t, id(), 'training', { ...tq.params, upgradeRulesAccepted: 1 }, tq.total, tx);
  await rejects(craft(t, { max: true }), /pending purchase/, 'crafting waits for a pending purchase');
  await store.settlePurchase(t, tr.request_id, 'confirmed');
  assert.deepEqual(await shards(t), [4 - tq.training.shards, 0], 'Training kept its Upgrade Shards');
  assert.equal((await craft(t, { max: true })).quantity, Math.floor((4 - tq.training.shards) / 2), 'crafting works after settlement');

  /* ---------- Quote: +5% per Fusion Shard, up to 100% ---------- */
  const q = await player({ fusion: 50 });
  for (const [rank, base, need] of [[0, 90, 2], [1, 80, 4], [2, 70, 6], [3, 60, 8]]) {
    const ids = await group(q, rank);
    const plain = await quote(q, ids);
    assert.equal(plain.fusion.successPercent, base, 'base success rank ' + rank); assert.equal(plain.fusion.shards, undefined);
    assert.equal(FS.neededFor(base), need);
    for (let n = 1; n <= need; n++) {
      const b = await quote(q, ids, n);
      assert.deepEqual([b.fusion.baseSuccessPercent, b.fusion.successPercent, b.fusion.shardsPerAttempt, b.fusion.shards], [base, base + 5 * n, n, n], 'rank ' + rank + ' with ' + n);
      assert.deepEqual([b.total, b.base, b.treasury, b.burn, b.operations, b.studioFee], [plain.total, plain.base, plain.treasury, plain.burn, plain.operations, plain.studioFee], 'price and split unchanged');
    }
    assert.equal((await quote(q, ids, need)).fusion.successPercent, 100, 'rank ' + rank + ' reaches exactly 100%');
    await rejects(quote(q, ids, need + 1), /needed for 100%/, 'more than needed for 100% is refused');
    assert.equal((await quote(q, ids, 0)).fusion.successPercent, base, '0 shards = base');
    const p = await store.profile(q); p.heroes = p.heroes.filter(h => !ids.includes(h.tokenId)); await save(q, p);
  }
  for (const bad of [-1, 1.5, '2', null]) await rejects(quote(q, await group(q, 0), bad), /whole number/, 'invalid shard count ' + JSON.stringify(bad));
  const poor = await player({ fusion: 1 }), pids = await group(poor, 0);
  await rejects(quote(poor, pids, 2), /needs 2 Fusion Shard\(s\)\. You have 1/, 'not enough Fusion Shards at quote');
  const batch = await player({ fusion: 5 }), bids = await group(batch, 0, 3);
  assert.equal((await quote(batch, bids, 1)).fusion.shards, 3, 'a batch uses shards x attempts');
  await rejects(quote(batch, bids, 2), /needs 6 Fusion Shard\(s\)\. You have 5/, 'a batch needs shards for every attempt');

  /* ---------- Purchase and settlement ---------- */
  const s = await player({ fusion: 10 });
  let ids = await group(s, 0);
  const pend = await fuse(s, ids, 2, { roll: [], settle: null });   // 100%: no roll needed
  assert.equal((await shards(s))[1], 10, 'pending: nothing consumed yet');
  assert.equal(pend.result.outputs.length, 1, '100% succeeds');
  await rejects(craft(s, { quantity: 1 }), /pending purchase/);
  await store.settlePurchase(s, pend.request_id, 'confirmed');
  assert.equal((await shards(s))[1], 8, 'consumed at confirmed settlement');
  await store.settlePurchase(s, pend.request_id, 'confirmed').catch(() => {});
  assert.equal((await shards(s))[1], 8, 'a repeated settlement never consumes twice');
  // At 100% even the worst roll succeeds; below 100% a failed roll consumes heroes and shards.
  ids = await group(s, 1); const top = await fuse(s, ids, 4, { roll: [99] });
  assert.equal(top.result.outputs.length, 1, 'at 100% even the worst roll (99 of 0..99) succeeds');
  ids = await group(s, 2);
  const lost = await fuse(s, ids, 1, { roll: [99] });
  assert.equal(lost.result.outputs.length, 0, 'a failed attempt produces no hero');
  assert.equal((await shards(s))[1], 8 - 4 - 1, 'shards are consumed on failure too');
  assert(!(await store.profile(s)).heroes.some(h => ids.includes(h.tokenId)), 'failed attempt consumed its heroes');
  // Refund: nothing consumed.
  const rf = await player({ fusion: 3 }); ids = await group(rf, 0);
  await fuse(rf, ids, 2, { settle: 'refunded' });
  assert.equal((await shards(rf))[1], 3, 'a refund consumes no Fusion Shards');
  assert.equal((await store.profile(rf)).heroes.filter(h => ids.includes(h.tokenId)).length, 3, 'and keeps the heroes');
  // Batch at 100%: shards x attempts.
  const bb = await player({ fusion: 6 }); ids = await group(bb, 0, 3);
  const br = await fuse(bb, ids, 2);
  assert.equal(br.result.outputs.length, 3, 'every attempt at 100% succeeds'); assert.equal((await shards(bb))[1], 0, '2 x 3 attempts consumed');
  // Chest-funded fusion uses the same rules.
  const c = await player({ fusion: 2, balance: 0 }); ids = await group(c, 0);
  await pool.query('INSERT INTO ryo_adventures(scope,wallet,data) VALUES($1,$2,$3)', [store.scope, c, JSON.stringify({ map: 1, pending: 200000 * 1000, claimed: 0, last: now, active: false, energy: {} })]);
  await pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,$3,'summon','{}',$4,'{}','{}',1,$5,'w',1,'confirmed',$6)", [store.scope, address(), id(), JSON.stringify({ operations: 1e9 }), 'income-' + crypto.randomUUID(), now]);
  const cr = await fuse(c, ids, 2, { via: { funding: 'chest', custody: async () => 1e9 } });
  assert.equal(cr.quote.funding, 'chest'); assert.equal(cr.result.outputs.length, 1); assert.equal((await shards(c))[1], 0, 'Chest-funded fusion consumes the shards');
  // Settlement re-checks the current balance (fails safe if the reserved shards are gone).
  const g = await player({ fusion: 2 }); ids = await group(g, 0);
  const gr = await fuse(g, ids, 2, { settle: null });
  const gp = await store.profile(g); gp.fusionShards = 1; await save(g, gp);
  await rejects(store.settlePurchase(g, gr.request_id, 'confirmed'), /Reserved Fusion Shards are unavailable/, 'settlement re-checks the balance');
  assert.equal((await shards(g))[1], 1, 'nothing written when the reserved shards are missing');

  /* ---------- Everything else is untouched ---------- */
  const o = await player({ upgrade: 5 }); const op = await store.profile(o);
  assert.equal(op.fusionShards, undefined, 'a profile without Fusion Shards stays without the field');
  const sq = economy.quote(op, 'summon', { quantity: 1 });
  const sr = await store.purchase(o, id(), 'summon', { quantity: 1 }, sq.total, tx); await store.settlePurchase(o, sr.request_id, 'confirmed');
  assert.equal((await store.profile(o)).fusionShards, undefined, 'other purchases never add the field');
  assert.equal((await store.profile(o)).shrineLegendPity, sr.result.pity.after, 'Shrine pity still counts');
  const plainF = await player({ fusion: 4 }); ids = await group(plainF, 0);
  await fuse(plainF, ids, undefined, { roll: [0] }); assert.equal((await shards(plainF))[1], 4, 'a fusion without Fusion Shards uses none');
  assert.equal((await store.profile(plainF)).shrineLegendPity ?? 0, 0, 'fusion never changes Shrine pity');

  crypto.randomInt = original; await db.close();
  for (const k2 of Object.keys(process.env)) if (!(k2 in env)) delete process.env[k2]; Object.assign(process.env, env);
  console.log('PASS: Fusion Shards — craft 1/several/Max (odd and even), refused when short, invalid or while a purchase is pending, idempotent request id, no overspend under concurrency, no Ryo effect; +5% per Fusion Shard per attempt to exactly 100% on every rank, over-use and short balance refused, price/split unchanged; consumed only at confirmed settlement (success and failure), never on refund or twice, batch x attempts, Chest-funded, settlement re-check; other purchases, Shrine pity and plain fusion untouched.');
})().catch(e => { console.error(e); process.exitCode = 1; });
