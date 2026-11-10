'use strict';
/* tools/restore-salvaged-hero.cjs on the real schema and the real salvage code (in-memory Postgres; isolated fixtures).
 * A Legend salvaged by mistake comes back exactly as it was, the shards from that salvage are taken back, the change is
 * in the hash-chained audit log, and every unsafe case is refused without changing anything. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..'), { Keypair } = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), economy = require('../app/server/economy.cjs');
const upgrades = require('../app/server/hero-upgrades.cjs'), R = require('../app/server/hero-upgrade-rules.cjs'), dashboard = require('../app/server/economic-dashboard.cjs');
const tool = require('../tools/restore-salvaged-hero.cjs');
(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'app/server/schema.sql'), 'utf8'));
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  let now = Date.UTC(2026, 10, 10, 9);
  const store = new Store(pool, 'salvage-restore-test', () => now);
  const W = Array.from({ length: 3 }, () => Keypair.generate().publicKey.toBase58()), [player, other, busy] = W;
  const profileOf = async w => (await pool.query('SELECT data FROM ryo_profiles WHERE scope=$1 AND wallet=$2', [store.scope, w])).rows[0].data;
  const setProfile = (w, p) => pool.query('INSERT INTO ryo_profiles(scope,wallet,data) VALUES($1,$2,$3) ON CONFLICT(scope,wallet) DO UPDATE SET data=EXCLUDED.data', [store.scope, w, JSON.stringify(p)]);
  const legend = () => { const h = economy.hero(4); h.level = 3; return h; };
  let n = 0; const rid = () => 'salvage-request-' + String(++n).padStart(8, '0');
  const salvage = (w, heroId, requestId = rid()) => upgrades.salvage(store, w, { heroId, requestId, salvageRulesVersion: R.VERSION }).then(r => ({ ...r, requestId }));
  const why = 'Player salvaged this Legend by mistake (support ticket).';

  // A player with a Legend and two other heroes salvages the Legend.
  const p0 = economy.initialProfile(); p0.heroes = [legend(), economy.hero(1), economy.hero(2)]; p0.upgradeShards = 0;
  await setProfile(player, p0);
  const lg = structuredClone((await profileOf(player)).heroes.find(h => h.rank === 4));
  const s = await salvage(player, lg.tokenId);
  const afterSalvage = await profileOf(player);
  assert(!afterSalvage.heroes.some(h => h.tokenId === lg.tokenId), 'fixture: the Legend was salvaged');
  assert.equal(afterSalvage.upgradeShards, s.shards); assert(s.shards > 0);

  // Dry run lists the receipt and changes nothing.
  const list = await tool.receipts(store, player);
  assert.equal(list.length, 1); assert.equal(list[0].rank, 4); assert.equal(list[0].requestId, s.requestId); assert.equal(list[0].restored, false);
  assert.deepEqual(await profileOf(player), afterSalvage, 'dry run writes nothing');

  // Refusals: bad input, another wallet's receipt, pending purchase, spent shards, full collection.
  await assert.rejects(tool.restore(store, player, s.requestId, 'short'), e => e.code === 'BAD_REASON');
  await assert.rejects(tool.restore(store, other, s.requestId, why), e => e.code === 'NOT_FOUND', "another wallet cannot use this receipt");
  await pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,'pending-purchase-000001','summon','{}','{}','{}','{}',25000,'sig-pending-1','',0,'pending',$3)", [store.scope, player, now]);
  await assert.rejects(tool.restore(store, player, s.requestId, why), e => e.code === 'PENDING_PURCHASE');
  await pool.query("UPDATE ryo_purchases SET status='confirmed' WHERE scope=$1 AND wallet=$2", [store.scope, player]);
  const spent = await profileOf(player); spent.upgradeShards = s.shards - 1; await setProfile(player, spent);
  await assert.rejects(tool.restore(store, player, s.requestId, why), e => e.code === 'SHARDS_SPENT');
  spent.upgradeShards = s.shards; await setProfile(player, spent);
  assert.deepEqual((await profileOf(player)).heroes, afterSalvage.heroes, 'refusals changed nothing');
  const auditBefore = Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_admin_audit WHERE scope=$1', [store.scope])).rows[0].n);
  assert.equal(auditBefore, 0, 'refusals wrote no audit entry');

  // Restore: the exact hero is back (Reserve), the salvage shards are taken back, one audit entry.
  const out = await tool.restore(store, player, s.requestId, why);
  const restored = await profileOf(player), back = restored.heroes.find(h => h.restoredFrom === lg.tokenId);
  assert(back, 'the Legend is back');
  for (const k of ['name', 'rank', 'level', 'perks', 'baseStats', 'look', 'bonus']) assert.deepEqual(back[k], lg[k], 'same ' + k);
  assert.notEqual(back.tokenId, lg.tokenId, 'fresh id (each id can be salvaged only once)'); assert.equal(out.newHeroId, back.tokenId);
  assert.equal(restored.upgradeShards, 0, 'the shards from the salvage were taken back');
  assert(!(restored.battleReady || []).includes(lg.tokenId) || restored.battleReady.length <= 50, 'battle-ready list stays valid');
  assert.equal(out.shardsTaken, s.shards); assert.equal(out.rank, 4);
  const audit = (await pool.query('SELECT sequence,actor,action,data,created,previous,hash FROM ryo_admin_audit WHERE scope=$1 ORDER BY sequence', [store.scope])).rows;
  assert.equal(audit.length, 1); assert.equal(audit[0].action, tool.ACTION); assert.equal(audit[0].data.requestId, s.requestId); assert.equal(audit[0].data.reason, why);
  assert.equal(dashboard.digest({ sequence: Number(audit[0].sequence), actor: audit[0].actor, action: audit[0].action, data: audit[0].data, created: Number(audit[0].created), previous: audit[0].previous }), audit[0].hash, 'audit hash is valid');
  assert.equal((await tool.receipts(store, player))[0].restored, true, 'the dry run now shows it as restored');

  // Running it again is refused (no second hero, no second shard deduction).
  await assert.rejects(tool.restore(store, player, s.requestId, why), e => e.code === 'ALREADY_RESTORED');
  assert.equal((await profileOf(player)).heroes.filter(h => h.restoredFrom === lg.tokenId).length, 1);

  // The restored hero is a normal hero again: it can be salvaged (new receipt) and that receipt restored too.
  now += 60000; const s2 = await salvage(player, back.tokenId);
  assert.equal(s2.shards, s.shards, 'salvaging the restored hero works normally');
  await tool.restore(store, player, s2.requestId, why);
  assert.equal((await profileOf(player)).heroes.filter(h => h.restoredFrom === back.tokenId && h.rank === 4).length, 1);

  // Full collection refused.
  const pb = economy.initialProfile(); pb.heroes = [legend(), ...Array.from({ length: 2 }, () => economy.hero(0))]; pb.upgradeShards = 0; await setProfile(busy, pb);
  const lb = (await profileOf(busy)).heroes.find(h => h.rank === 4), sb = await salvage(busy, lb.tokenId);
  const full = await profileOf(busy); full.heroes.push(...Array.from({ length: 500 - full.heroes.length }, () => economy.hero(0))); await setProfile(busy, full);
  await assert.rejects(tool.restore(store, busy, sb.requestId, why), e => e.code === 'HERO_LIMIT');
  console.log('PASS: salvage restore — the exact Legend comes back with its shards taken back and one hash-chained audit entry; dry run, other wallets, pending purchase, spent shards, full collection and repeats are refused without changes.');
})().catch(e => { console.error(e); process.exitCode = 1; });
