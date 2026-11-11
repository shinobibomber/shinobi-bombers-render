'use strict';
/* Read-only launch stats report (tools/launch-stats-report.cjs) against the real schema in an in-memory Postgres.
 * Checks: confirmed-only spending, summon rarity from the outputs, the --since cut-off, hourly buckets, scope isolation,
 * free-hero sources, SOL/SR unit conversion, skipped missing tables, no wallet/signature in the output, and that only
 * SELECT / BEGIN READ ONLY / ROLLBACK statements are ever issued. Isolated fixtures only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const report = require('../tools/launch-stats-report.cjs');
(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  const S = 'stats-test', OTHER = 'other-scope', H = 3600000, since = Date.UTC(2026, 10, 9, 14, 40), h0 = Math.floor(since / H) * H;
  const W = ['WalletAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'WalletBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'];
  const q = (s, a) => db.query(s, a);
  let n = 0; const id = () => 'req-' + String(++n).padStart(6, '0');
  const purchase = (scope, wallet, product, amount, status, created, { outputs = [], funding, quantity = 1 } = {}) => q(
    `INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created)
     VALUES($1,$2,$3,$4,$5,$6,$7,'{}',$8,$9,'w',1,$10,$11)`,
    [scope, wallet, id(), product, JSON.stringify({ quantity }), JSON.stringify({ base: amount, total: amount, treasury: amount / 2, burn: 0, ...(funding ? { funding } : {}) }),
      JSON.stringify({ outputs: outputs.map(rank => ({ rank, tokenId: 't' + n + rank })) }), amount, 'SigPurchase' + n, status, created]);

  // Players: one before launch (all-time only), two after (different hours), one in another scope.
  for (const [w, t, sc] of [[W[0], since - H, S], [W[1], since + 10 * 60000, S], ['WalletCccccccccccccccccccccccccccccccccccccc', since + 2 * H, S], [W[0], since + H, OTHER]])
    await q("INSERT INTO ryo_players(scope,wallet,player_id,username,username_key,created,last_login) VALUES($1,$2,gen_random_uuid(),$3,lower($3),$4,$4)", [sc, w, 'player' + (++n), t]);
  // Deposits.
  await q("INSERT INTO ryo_deposits(scope,signature,wallet,amount,request_id,created,gross,studio_fee) VALUES($1,'SigDep1',$2,99000,'d1',$3,100000,1000)", [S, W[0], since + 5 * 60000]);
  // Purchases: confirmed summons (5 + 1 heroes), a pending and a refunded one (not counted), one before launch, one in another scope, a chest-funded dojo.
  await purchase(S, W[0], 'summon', 125000, 'confirmed', since + 20 * 60000, { outputs: [0, 0, 1, 2, 4], quantity: 5 });
  await purchase(S, W[1], 'summon', 25000, 'confirmed', since + H + 1, { outputs: [3] });
  await purchase(S, W[1], 'summon', 25000, 'pending', since + H + 2, { outputs: [4] });
  await purchase(S, W[1], 'summon', 25000, 'refunded', since + H + 3, { outputs: [4] });
  await purchase(S, W[0], 'summon', 25000, 'confirmed', since - 1, { outputs: [5] });
  await purchase(OTHER, W[0], 'summon', 25000, 'confirmed', since + 1, { outputs: [5] });
  await purchase(S, W[0], 'dojo', 8000, 'confirmed', since + 2 * H, { funding: 'chest' });
  await purchase(S, W[1], 'summon', 25000, 'confirmed', since + 3 * H, { outputs: [undefined] });          // output without a rank
  await purchase(S, W[0], 'summon', 25000, 'confirmed', since + 3 * H, { outputs: [5], funding: 'bonus' }); // starter bonus Ryo: not paid
  await q("INSERT INTO ryo_spends(scope,wallet,request_id,amount,created) VALUES($1,$2,'ls1',3000,$3)", [S, W[0], since + H]);
  // Withdrawals (only confirmed are paid out), Chest spends (confirmed only), salvage, crafts, Expedition, Sensei SOL, Starter Pack.
  await q("INSERT INTO ryo_withdrawals(scope,wallet,request_id,amount,signature,wire,last_height,status,created) VALUES($1,$2,'w1',10000,'SigW1','w',1,'confirmed',$3),($1,$2,'w2',7000,'SigW2','w',1,'refunded',$3)", [S, W[0], since + 4 * H]);
  await q("INSERT INTO ryo_chest_spends(scope,wallet,request_id,product,amount,status,created) VALUES($1,$2,'c1','training',2000,'confirmed',$3),($1,$2,'c2','training',500,'refunded',$3)", [S, W[1], since + 4 * H]);
  await q("INSERT INTO ryo_hero_salvages(scope,wallet,request_id,hero_id,rank,shards,hero,created) VALUES($1,$2,'s1','hero-s1',1,2,'{}',$3)", [S, W[0], since + 4 * H]);
  await q("INSERT INTO ryo_fusion_shard_crafts(scope,wallet,request_id,quantity,upgrade_before,upgrade_after,fusion_before,fusion_after,created) VALUES($1,$2,'fc1',2,10,4,0,2,$3)", [S, W[0], since + 4 * H]);
  await q("INSERT INTO ryo_expedition_revenue(scope,wallet,request_id,signature,hero_id,expedition_start,total_raw,allocations,destinations,released,network,created) VALUES($1,$2,'e1','SigE1','hero-e1',1,3000000,'{}','{}',true,'mainnet',$3)", [S, W[0], since + 4 * H]);
  await q("INSERT INTO ryo_sensei_sol_purchases(scope,request_id,wallet,price_lamports,founder_discount,reference,status,message,wire,last_height,created) VALUES($1,'ss1',$2,200000000,false,'RefSS1','confirmed','m','w',1,$3),($1,'ss2',$4,400000000,false,'RefSS2','expired','m','w',1,$3)", [S, W[0], since + 4 * H, W[1]]);
  await q("INSERT INTO ryo_starter_grants(scope,wallet,heroes,bonus,granted) VALUES($1,$2,2,50000,$3)", [S, W[1], since + 4 * H]);
  // Free heroes, Founder sales (SOL), SR revenue (raw units), Chest claims.
  await q("INSERT INTO ryo_founder_summons(scope,wallet,request_id,kind,rank,roll,hero,created) VALUES($1,$2,'fs1','limited',2,100,'{}',$3)", [S, W[0], since + 30 * 60000]);
  await q("INSERT INTO ryo_prison_rescues(scope,id,wallet,rank,roll,hero,session,created) VALUES($1,'pr1',$2,1,5,'{}','s',$3)", [S, W[1], since + 40 * 60000]);
  await q("INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,created) VALUES($1,'f1',$2,'mythic',1,'MintF1',1000000000,'confirmed','m','w',1,$3),($1,'f2',$4,'legacy',1,'MintF2',500000000,'confirmed','m','w',1,$5)",
    [S, W[0], since - 2 * H, W[1], since + 50 * 60000]);
  const [firstReq] = (await q("SELECT request_id,wallet FROM ryo_purchases WHERE scope=$1 AND product='summon' AND status='confirmed' ORDER BY created LIMIT 1 OFFSET 1", [S])).rows;
  await q("INSERT INTO ryo_service_revenue(scope,wallet,request_id,signature,product,total_raw,allocations,destinations,config_version,created) VALUES($1,$2,$3,'SigRev1','summon',125000000000,$4,'{}',1,$5)",
    [S, firstReq.wallet, firstReq.request_id, JSON.stringify({ lockedTreasury: '62500000000', activeRewards: '37500000000', communityRewards: '12500000000', economicReserve: '12500000000' }), since + 21 * 60000]);
  await q('INSERT INTO ryo_reward_claims(scope,wallet,amount,created) VALUES($1,$2,4000,$3)', [S, W[1], since + 3 * H]);
  await q("INSERT INTO ryo_adventures(scope,wallet,data) VALUES($1,$2,'{\"kills\":120,\"pending\":5500,\"claimed\":4000}'),($1,$3,'{\"kills\":0}')", [S, W[1], W[0]]);
  await q("INSERT INTO ryo_feature_switch_log(scope,seq,key,enabled,actor,reason,created,version,prev_hash,hash) VALUES($1,1,'dojo',true,$2,'secret reason',$3,1,'genesis','h1')", [S, W[0], since + H]);

  // Every statement the report issues is logged; only reads are allowed.
  const issued = [], logged = { query: (s, a) => { issued.push(String(s).trim()); return db.query(s, a); } };
  const rep = await report.run(logged, S, { since, bucket: 'hour', now: since + 5 * H });
  assert.equal(issued[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); assert.equal(issued.at(-1), 'ROLLBACK');
  for (const s of issued.slice(1, -1)) assert.match(s, /^SELECT\b/, 'only SELECT statements: ' + s.slice(0, 60));

  const T = rep.totals;
  assert.equal(T.newPlayers, 2, 'players after --since, this scope only');
  assert.equal(rep.allTime.playersRegistered, 3);
  assert.deepEqual(rep.series.players.map(p => [p.t, p.n]), [[new Date(h0).toISOString(), 1], [new Date(h0 + 2 * H).toISOString(), 1]], 'hourly buckets (UTC)');
  assert.deepEqual(T.deposits, { n: 1, ryo: 99000, gross: 100000, studioFee: 1000 });
  assert.equal(T.summons.orders, 3, 'confirmed, paid summons only, after --since, this scope');
  assert.equal(T.summons.heroes, 7);
  assert.equal(T.summons.ryo, 175000);
  assert.deepEqual(rep.rarity.summon, { Genin: 2, Chunin: 1, Jonin: 1, Elite: 1, Legend: 1, Unknown: 1 }, 'rarity from the paid summon outputs; a missing rank is Unknown, not Genin');
  assert.equal(T.ryoSpent.ryo, 186000, 'paid purchases + legacy spends, bonus excluded'); assert.equal(T.ryoSpent.orders, 5);
  assert.deepEqual(T.ryoSpent.byProduct, { summon: 175000, dojo: 8000 }); assert.equal(T.ryoSpent.bonusRyo, 25000);
  assert.deepEqual(T.ryoSpent.byFunding, { balance: 175000, chest: 8000 }); assert.equal(T.ryoSpent.treasury, 91500);
  assert.ok(T.summons.ryo <= T.ryoSpent.byProduct.summon, 'summons are a subset of Ryo spent');
  assert.deepEqual(rep.purchaseStatus.map(s => [s.status, s.n]), [['confirmed', 5], ['pending', 1], ['refunded', 1]]);
  assert.deepEqual(T.freeHeroes, { total: 4, bySource: { 'founder-limited': 1, 'prison-rescue': 1, 'starter-pack': 2 } });
  assert.deepEqual(T.starterPacks, { n: 1, heroes: 2, bonusRyo: 50000 });
  assert.deepEqual(T.withdrawals, { n: 1, ryo: 10000, byStatus: { confirmed: 10000, refunded: 7000 } }, 'paid out = confirmed only');
  assert.deepEqual(T.chestSpends, { n: 1, ryo: 2000, byProduct: { training: 2000 } }, 'refunded Chest spends excluded');
  assert.deepEqual(T.salvages, { n: 1, shards: 2 }); assert.deepEqual(rep.rarity.salvaged, { Chunin: 1 });
  assert.deepEqual(T.shardCrafts, { n: 1, quantity: 2 }); assert.deepEqual(T.expeditionRevenue, { n: 1, sr: 3 });
  assert.deepEqual(T.senseiSol, { n: 1, sol: 0.2 }, 'expired Sensei sale excluded'); assert.equal(T.solSales, 0.7);
  assert.deepEqual(rep.rarity.founderSummons, { Jonin: 1 });
  assert.deepEqual(T.founders, { n: 1, sol: 0.5, byTier: { legacy: 1 } }, 'only the sale after --since');
  assert.deepEqual(rep.allTime.founders, [{ tier: 'legacy', n: 1, sol: 0.5 }, { tier: 'mythic', n: 1, sol: 1 }]);
  assert.deepEqual(T.srRevenue, { n: 1, sr: 125000, byProduct: { summon: 125000 } }, 'raw SR units converted');
  assert.deepEqual(rep.revenueAllocations, { activeRewards: 37500, communityRewards: 12500, economicReserve: 12500, lockedTreasury: 62500 });
  assert.deepEqual(T.chestClaims, { n: 1, ryo: 4000 });
  assert.deepEqual(rep.allTime.adventure, { hunters: 1, kills: 120, chestPending: 5.5, chestUsed: 4000 });
  assert.deepEqual(rep.switches, [{ t: new Date(since + H).toISOString(), key: 'dojo', enabled: true }]);
  assert.deepEqual(rep.skipped, []);

  // Aggregates only: no wallet, signature, mint, actor or reason ever appears in the output.
  const out = JSON.stringify(rep);
  for (const secret of [...W, 'Wallet', 'Sig', 'MintF', 'RefSS', 'secret reason', 'req-']) assert.ok(!out.includes(secret), 'output leaks ' + secret);

  // A database without some tables (older schema) is reported, not an error.
  const slim = { query: async (s, a) => { const r = await db.query(s, a); return /to_regclass/.test(s) ? { rows: r.rows.filter(x => !/^ryo_(hunt_awards|mythic_boxes)$/.test(x.t)) } : r; } };
  const partial = await report.collect(slim, S, { since });
  assert.deepEqual(partial.skipped, ['huntAwards', 'mythicBoxes']); assert.equal(partial.totals.mythicBoxes.n, 0);
  // Day buckets and the argument checks.
  assert.equal((await report.collect(db, S, { since, bucket: 'day' })).series.players.length, 1);
  await assert.rejects(report.collect(db, S, { since, bucket: 'week' }), /hour or day/);
  await assert.rejects(report.collect(db, S, { since: NaN }), /ISO/);
  assert.deepEqual(report.parseArgs([]), { since: Date.parse(report.LAUNCH), until: undefined, bucket: 'hour', json: false });
  assert.deepEqual(report.parseArgs(['--since=1970-01-01T00:00:00Z', '--bucket', 'day', '--json']), { since: 0, until: undefined, bucket: 'day', json: true }, '--name=value is honoured');
  assert.equal(report.parseArgs(['--until', '2026-11-10T00:00:00Z']).until, Date.UTC(2026, 10, 10));
  // --until is an exclusive cut-off: only the first two hours after launch.
  const early = await report.collect(db, S, { since, until: since + 2 * H, now: since + 5 * H });
  assert.equal(early.until, new Date(since + 2 * H).toISOString());
  assert.equal(early.totals.summons.orders, 2, 'summons in [since, since+2h) only'); assert.equal(early.totals.newPlayers, 1);
  assert.equal(early.totals.chestClaims.n, 0, 'the claim at +3h is after --until'); assert.equal(early.totals.starterPacks.n, 0, 'Starter Pack (granted column) cut too');
  assert.deepEqual(early.revenueAllocations.lockedTreasury, 62500);
  assert.equal(rep.until, new Date(since + 5 * H + 1).toISOString(), 'default --until is the report time');
  await assert.rejects(report.collect(db, S, { since, until: since }), /--until/);
  assert.throws(() => report.parseArgs(['--bucket']), /needs a value/); assert.throws(() => report.parseArgs(['--since', '--json']), /needs a value/);
  assert.throws(() => report.parseArgs(['--sinse', 'x']), /Unknown argument/);

  console.log('PASS: launch stats report — read-only (SELECT only, rolled back), confirmed spending, summon rarity, --since + scope cut-off, hourly/daily buckets, SOL/SR units, aggregates only.');
})().catch(e => { console.error(e); process.exitCode = 1; });
