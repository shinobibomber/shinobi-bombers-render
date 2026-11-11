'use strict';
/* READ-ONLY report: what happened on the server since the public opening (owner request 2026-11-11).
 *
 * Totals and per-hour (or per-day) series for new players, SR deposits, Ryo spent (by product and by how it was paid),
 * heroes summoned with their rarity mix, free heroes by source, Founder and Mythic Box sales (SOL), SR revenue routed with
 * its allocations, Adventure Chest claims and Chest spends, salvages, Fusion Shard crafts, Expedition speed-ups,
 * withdrawals and feature-switch changes.
 *
 * It changes nothing: one READ ONLY transaction, SELECT only. The output holds aggregates only: no wallets, signatures,
 * usernames, actors or settings, so it can be pasted into a chat or a report page.
 * Run it where the game's database settings already exist (for example the Render Shell of the live service):
 *     node tools/launch-stats-report.cjs [--since 2026-11-09T14:40:00Z] [--bucket hour|day] [--json]
 * The default --since is the public opening (2026-11-09 22:40 UTC+8). Use --since 1970-01-01T00:00:00Z for all time. */
const path = require('node:path');
const LAUNCH = '2026-11-09T14:40:00Z';
const BUCKETS = { hour: 3600000, day: 86400000 };
const RANKS = ['Genin', 'Chunin', 'Jonin', 'Elite', 'Legend', 'Mythic'];
const RAW = 1000000;   // SR base units per SR (= per Ryo), sr-revenue.cjs UNIT
const LAMPORTS = 1e9;

const B = '(created/$3::bigint)*$3::bigint';                       // bucket start, epoch ms, UTC
const SINCE = 'scope=$1 AND created>=$2::bigint';
const arr = c => `CASE WHEN jsonb_typeof(${c})='array' THEN ${c} ELSE '[]'::jsonb END`;
const len = c => `jsonb_array_length(${arr(c)})`;

/* Every query: [key, table it needs, SQL]. Parameters: $1 scope, $2 since (ms), $3 bucket (ms). Aggregates only. */
const QUERIES = [
  ['players', 'ryo_players', `SELECT ${B} AS t,COUNT(*) AS n FROM ryo_players WHERE ${SINCE} GROUP BY 1 ORDER BY 1`],
  ['deposits', 'ryo_deposits', `SELECT ${B} AS t,COUNT(*) AS n,SUM(amount) AS ryo,SUM(COALESCE(gross,amount)) AS gross,SUM(studio_fee) AS fee FROM ryo_deposits WHERE ${SINCE} GROUP BY 1 ORDER BY 1`],
  ['spending', 'ryo_purchases', `SELECT ${B} AS t,product,COALESCE(quote->>'funding','balance') AS funding,COUNT(*) AS n,SUM(amount) AS ryo,SUM(${len("result->'outputs'")}) AS heroes,
     SUM(COALESCE((quote->>'treasury')::numeric,0)) AS treasury,SUM(COALESCE((quote->>'burn')::numeric,0)) AS burn
     FROM ryo_purchases WHERE ${SINCE} AND status='confirmed' GROUP BY 1,2,3 ORDER BY 1,2,3`],
  ['purchaseStatus', 'ryo_purchases', `SELECT status,COUNT(*) AS n,SUM(amount) AS ryo FROM ryo_purchases WHERE ${SINCE} AND $3::bigint>0 GROUP BY 1 ORDER BY 1`],
  ['summonRarity', 'ryo_purchases', `SELECT o->>'rank' AS rank,COUNT(*) AS n FROM ryo_purchases p,jsonb_array_elements(${arr("p.result->'outputs'")}) o
     WHERE p.scope=$1 AND p.created>=$2::bigint AND $3::bigint>0 AND p.status='confirmed' AND p.product='summon' AND COALESCE(p.quote->>'funding','')<>'bonus' GROUP BY 1 ORDER BY 1`],
  ['legacySpends', 'ryo_spends', `SELECT ${B} AS t,COUNT(*) AS n,SUM(amount) AS ryo FROM ryo_spends WHERE ${SINCE} GROUP BY 1 ORDER BY 1`],
  ['founderSummons', 'ryo_founder_summons', `SELECT ${B} AS t,kind AS source,rank,COUNT(*) AS n FROM ryo_founder_summons WHERE ${SINCE} GROUP BY 1,2,3 ORDER BY 1`],
  ['prisonRescues', 'ryo_prison_rescues', `SELECT ${B} AS t,rank,COUNT(*) AS n FROM ryo_prison_rescues WHERE ${SINCE} GROUP BY 1,2 ORDER BY 1`],
  ['huntAwards', 'ryo_hunt_awards', `SELECT ${B} AS t,hero_rank AS rank,COUNT(*) AS n FROM ryo_hunt_awards WHERE ${SINCE} AND granted GROUP BY 1,2 ORDER BY 1`],
  ['passRedemptions', 'ryo_pass_redemptions', `SELECT ${B} AS t,SUM(quantity) AS n FROM ryo_pass_redemptions WHERE ${SINCE} GROUP BY 1 ORDER BY 1`],
  ['referralClaims', 'ryo_player_referral_claims', `SELECT ${B} AS t,SUM(quantity) AS n FROM ryo_player_referral_claims WHERE ${SINCE} GROUP BY 1 ORDER BY 1`],
  ['starterGrants', 'ryo_starter_activation_grants', `SELECT ${B} AS t,SUM(${len('heroes')}) AS n FROM ryo_starter_activation_grants WHERE ${SINCE} AND status='granted' GROUP BY 1 ORDER BY 1`],
  // Starter Pack (starter-pack.cjs, test server): its time column is `granted`, and it also gives spend-only bonus Ryo.
  ['starterPacks', 'ryo_starter_grants', `SELECT (granted/$3::bigint)*$3::bigint AS t,COUNT(*) AS packs,SUM(heroes) AS n,SUM(bonus) AS bonus FROM ryo_starter_grants WHERE scope=$1 AND granted>=$2::bigint GROUP BY 1 ORDER BY 1`],
  ['senseiSol', 'ryo_sensei_sol_purchases', `SELECT ${B} AS t,COUNT(*) AS n,SUM(price_lamports) AS lamports FROM ryo_sensei_sol_purchases WHERE ${SINCE} AND status='confirmed' GROUP BY 1 ORDER BY 1`],
  ['founders', 'ryo_founder_purchases', `SELECT ${B} AS t,tier,COUNT(*) AS n,SUM(price_lamports) AS lamports FROM ryo_founder_purchases WHERE ${SINCE} AND status='confirmed' GROUP BY 1,2 ORDER BY 1`],
  ['mythicBoxes', 'ryo_mythic_boxes', `SELECT ${B} AS t,COUNT(*) AS n,SUM(price_lamports) AS lamports FROM ryo_mythic_boxes WHERE ${SINCE} AND status='confirmed' GROUP BY 1 ORDER BY 1`],
  ['revenue', 'ryo_service_revenue', `SELECT ${B} AS t,product,COUNT(*) AS n,SUM(total_raw) AS raw FROM ryo_service_revenue WHERE ${SINCE} GROUP BY 1,2 ORDER BY 1`],
  ['revenueAllocations', 'ryo_service_revenue', `SELECT e.key AS pot,SUM(e.value::numeric) AS raw FROM ryo_service_revenue r,jsonb_each_text(CASE WHEN jsonb_typeof(r.allocations)='object' THEN r.allocations ELSE '{}'::jsonb END) e
     WHERE r.scope=$1 AND r.created>=$2::bigint AND $3::bigint>0 AND e.value ~ '^[0-9]+$' GROUP BY 1 ORDER BY 1`],
  ['expedition', 'ryo_expedition_revenue', `SELECT ${B} AS t,COUNT(*) AS n,SUM(total_raw) AS raw FROM ryo_expedition_revenue WHERE ${SINCE} GROUP BY 1 ORDER BY 1`],
  ['claims', 'ryo_reward_claims', `SELECT ${B} AS t,COUNT(*) AS n,SUM(amount) AS ryo FROM ryo_reward_claims WHERE ${SINCE} GROUP BY 1 ORDER BY 1`],
  ['chestSpends', 'ryo_chest_spends', `SELECT ${B} AS t,product,COUNT(*) AS n,SUM(amount) AS ryo FROM ryo_chest_spends WHERE ${SINCE} AND status='confirmed' GROUP BY 1,2 ORDER BY 1`],
  ['salvages', 'ryo_hero_salvages', `SELECT ${B} AS t,rank,COUNT(*) AS n,SUM(shards) AS shards FROM ryo_hero_salvages WHERE ${SINCE} GROUP BY 1,2 ORDER BY 1`],
  ['shardCrafts', 'ryo_fusion_shard_crafts', `SELECT ${B} AS t,COUNT(*) AS n,SUM(quantity) AS quantity FROM ryo_fusion_shard_crafts WHERE ${SINCE} GROUP BY 1 ORDER BY 1`],
  ['withdrawals', 'ryo_withdrawals', `SELECT ${B} AS t,status,COUNT(*) AS n,SUM(amount) AS ryo FROM ryo_withdrawals WHERE ${SINCE} GROUP BY 1,2 ORDER BY 1`],
  ['switches', 'ryo_feature_switch_log', `SELECT created AS t,key,enabled FROM ryo_feature_switch_log WHERE ${SINCE} AND $3::bigint>0 ORDER BY seq`],
];
/* Point-in-time / all-time figures (no time series exists for these). $1 scope only. */
const SNAPSHOTS = [
  ['playersAllTime', 'ryo_players', 'SELECT COUNT(*) AS n FROM ryo_players WHERE scope=$1'],
  ['profilesAllTime', 'ryo_profiles', 'SELECT COUNT(*) AS n FROM ryo_profiles WHERE scope=$1'],
  ['adventure', 'ryo_adventures', `SELECT COUNT(*) FILTER(WHERE COALESCE((data->>'kills')::numeric,0)>0) AS hunters,COALESCE(SUM((data->>'kills')::numeric),0) AS kills,
     COALESCE(SUM((data->>'pending')::numeric),0)/1000 AS chest_pending,COALESCE(SUM((data->>'claimed')::numeric),0) AS chest_used FROM ryo_adventures WHERE scope=$1`],
  ['foundersAllTime', 'ryo_founder_purchases', "SELECT tier,COUNT(*) AS n,SUM(price_lamports) AS lamports FROM ryo_founder_purchases WHERE scope=$1 AND status='confirmed' GROUP BY 1 ORDER BY 1"],
];

const num = v => v == null ? 0 : Number(v);
const iso = ms => new Date(num(ms)).toISOString();
const rankName = r => r == null || r === '' ? 'Unknown' : RANKS[Number(r)] ?? 'Unknown';
const sum = (rows, k) => rows.reduce((s, r) => s + num(r[k]), 0);
const groupSum = (rows, by, k) => rows.reduce((o, r) => (o[r[by]] = (o[r[by]] || 0) + num(r[k]), o), {});
const round = (n, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

/** Pure: turns the raw query rows into the report object (aggregates only). */
function shape(raw, { scope, since, bucket, generated }) {
  const r = k => raw[k] || [];
  const t = row => iso(row.t);
  const freeHeroes = [
    ...r('founderSummons').map(x => ({ t: t(x), source: 'founder-' + x.source, n: num(x.n) })),
    ...r('prisonRescues').map(x => ({ t: t(x), source: 'prison-rescue', n: num(x.n) })),
    ...r('huntAwards').map(x => ({ t: t(x), source: 'boss-hunt', n: num(x.n) })),
    ...r('passRedemptions').map(x => ({ t: t(x), source: 'hero-pass', n: num(x.n) })),
    ...r('referralClaims').map(x => ({ t: t(x), source: 'referral', n: num(x.n) })),
    ...r('starterGrants').map(x => ({ t: t(x), source: 'starter-activation', n: num(x.n) })),
    ...r('starterPacks').map(x => ({ t: t(x), source: 'starter-pack', n: num(x.n) })),
  ].sort((a, b) => a.t.localeCompare(b.t));
  const rarity = rows => rows.reduce((o, x) => (o[rankName(x.rank)] = (o[rankName(x.rank)] || 0) + num(x.n), o), {});
  const spending = r('spending').map(x => ({ t: t(x), product: x.product, funding: x.funding, n: num(x.n), ryo: num(x.ryo), heroes: num(x.heroes), treasury: num(x.treasury), burn: num(x.burn) }));
  const paid = spending.filter(x => x.funding !== 'bonus'), summons = paid.filter(x => x.product === 'summon');
  const founders = r('founders').map(x => ({ t: t(x), tier: x.tier, n: num(x.n), sol: num(x.lamports) / LAMPORTS }));
  const mythicBoxes = r('mythicBoxes').map(x => ({ t: t(x), n: num(x.n), sol: num(x.lamports) / LAMPORTS }));
  const revenue = r('revenue').map(x => ({ t: t(x), product: x.product, n: num(x.n), sr: num(x.raw) / RAW }));
  const expedition = r('expedition').map(x => ({ t: t(x), n: num(x.n), sr: num(x.raw) / RAW }));
  const deposits = r('deposits').map(x => ({ t: t(x), n: num(x.n), ryo: num(x.ryo), gross: num(x.gross), fee: num(x.fee) }));
  const claims = r('claims').map(x => ({ t: t(x), n: num(x.n), ryo: num(x.ryo) }));
  const chestSpends = r('chestSpends').map(x => ({ t: t(x), product: x.product, n: num(x.n), ryo: num(x.ryo) }));
  const salvages = r('salvages').map(x => ({ t: t(x), rank: rankName(x.rank), n: num(x.n), shards: num(x.shards) }));
  const shardCrafts = r('shardCrafts').map(x => ({ t: t(x), n: num(x.n), quantity: num(x.quantity) }));
  const withdrawals = r('withdrawals').map(x => ({ t: t(x), status: x.status, n: num(x.n), ryo: num(x.ryo) }));
  const legacySpends = r('legacySpends').map(x => ({ t: t(x), n: num(x.n), ryo: num(x.ryo) }));
  const players = r('players').map(x => ({ t: t(x), n: num(x.n) }));
  const senseiSol = r('senseiSol').map(x => ({ t: t(x), n: num(x.n), sol: num(x.lamports) / LAMPORTS }));
  const starterPacks = r('starterPacks').map(x => ({ t: t(x), packs: num(x.packs), heroes: num(x.n), bonus: num(x.bonus) }));
  const confirmedWithdrawals = withdrawals.filter(x => x.status === 'confirmed');
  const adv = (raw.adventure || [])[0] || {};
  return {
    report: 'launch-stats', version: 1, scope, generated: iso(generated), since: iso(since), bucket,
    totals: {
      newPlayers: sum(players, 'n'),
      deposits: { n: sum(deposits, 'n'), ryo: sum(deposits, 'ryo'), gross: sum(deposits, 'gross'), studioFee: sum(deposits, 'fee') },
      ryoSpent: { orders: sum(paid, 'n') + sum(legacySpends, 'n'), ryo: sum(paid, 'ryo') + sum(legacySpends, 'ryo'), purchases: sum(paid, 'ryo'), legacySpends: sum(legacySpends, 'ryo'),
        treasury: sum(paid, 'treasury'), burn: sum(paid, 'burn'), byProduct: groupSum(paid, 'product', 'ryo'), ordersByProduct: groupSum(paid, 'product', 'n'),
        byFunding: groupSum(paid, 'funding', 'ryo'), bonusRyo: sum(spending.filter(x => x.funding === 'bonus'), 'ryo') },
      summons: { orders: sum(summons, 'n'), heroes: sum(summons, 'heroes'), ryo: sum(summons, 'ryo') },
      freeHeroes: { total: sum(freeHeroes, 'n'), bySource: groupSum(freeHeroes, 'source', 'n') },
      founders: { n: sum(founders, 'n'), sol: round(sum(founders, 'sol')), byTier: groupSum(founders, 'tier', 'n') },
      mythicBoxes: { n: sum(mythicBoxes, 'n'), sol: round(sum(mythicBoxes, 'sol')) },
      senseiSol: { n: sum(senseiSol, 'n'), sol: round(sum(senseiSol, 'sol')) },
      solSales: round(sum(founders, 'sol') + sum(mythicBoxes, 'sol') + sum(senseiSol, 'sol')),
      starterPacks: { n: sum(starterPacks, 'packs'), heroes: sum(starterPacks, 'heroes'), bonusRyo: sum(starterPacks, 'bonus') },
      srRevenue: { n: sum(revenue, 'n'), sr: round(sum(revenue, 'sr')), byProduct: groupSum(revenue, 'product', 'sr') },
      expeditionRevenue: { n: sum(expedition, 'n'), sr: round(sum(expedition, 'sr')) },
      chestClaims: { n: sum(claims, 'n'), ryo: sum(claims, 'ryo') },
      chestSpends: { n: sum(chestSpends, 'n'), ryo: sum(chestSpends, 'ryo'), byProduct: groupSum(chestSpends, 'product', 'ryo') },
      salvages: { n: sum(salvages, 'n'), shards: sum(salvages, 'shards') },
      shardCrafts: { n: sum(shardCrafts, 'n'), quantity: sum(shardCrafts, 'quantity') },
      // Paid out = confirmed only; pending/refunded stay visible per status.
      withdrawals: { n: sum(confirmedWithdrawals, 'n'), ryo: sum(confirmedWithdrawals, 'ryo'), byStatus: groupSum(withdrawals, 'status', 'ryo') },
    },
    rarity: { summon: rarity(r('summonRarity')), founderSummons: rarity(r('founderSummons')), prisonRescues: rarity(r('prisonRescues')), huntAwards: rarity(r('huntAwards')), salvaged: rarity(r('salvages')) },
    revenueAllocations: Object.fromEntries(r('revenueAllocations').map(x => [x.pot, round(num(x.raw) / RAW)])),
    purchaseStatus: r('purchaseStatus').map(x => ({ status: x.status, n: num(x.n), ryo: num(x.ryo) })),
    allTime: {
      playersRegistered: num(((raw.playersAllTime || [])[0] || {}).n), profiles: num(((raw.profilesAllTime || [])[0] || {}).n),
      founders: (raw.foundersAllTime || []).map(x => ({ tier: x.tier, n: num(x.n), sol: round(num(x.lamports) / LAMPORTS) })),
      adventure: { hunters: num(adv.hunters), kills: num(adv.kills), chestPending: round(num(adv.chest_pending), 3), chestUsed: num(adv.chest_used) },   // claimed + spent from Chests (lifetime); not comparable with chestClaims
    },
    series: { players, deposits, spending, freeHeroes, founders, mythicBoxes, senseiSol, starterPacks, revenue, expedition, claims, chestSpends, salvages, shardCrafts, withdrawals, legacySpends },
    switches: r('switches').map(x => ({ t: t(x), key: x.key, enabled: x.enabled })),
    skipped: raw.skipped || [],
  };
}

/** Runs every query (SELECT only) on a connection that is already inside a read-only transaction. */
async function collect(db, scope, { since = Date.parse(LAUNCH), bucket = 'hour', now = Date.now() } = {}) {
  if (!BUCKETS[bucket]) throw Error('--bucket must be hour or day.');
  if (!Number.isFinite(since)) throw Error('--since must be an ISO time.');
  const exists = new Map(), has = async t => { if (!exists.has(t)) exists.set(t, !!(await db.query('SELECT to_regclass($1) IS NOT NULL AS t', [t])).rows[0].t); return exists.get(t); };
  const raw = { skipped: [] };
  for (const [key, table, sql] of QUERIES) { if (await has(table)) raw[key] = (await db.query(sql, [scope, since, BUCKETS[bucket]])).rows; else raw.skipped.push(key); }
  for (const [key, table, sql] of SNAPSHOTS) { if (await has(table)) raw[key] = (await db.query(sql, [scope])).rows; else raw.skipped.push(key); }
  return shape(raw, { scope, since, bucket, generated: now });
}
/** One READ ONLY transaction around collect(), one snapshot for every query (REPEATABLE READ); always rolled back. */
async function run(db, scope, opts) {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try { return await collect(db, scope, opts); } finally { await db.query('ROLLBACK'); }
}

/** Accepts --name value and --name=value; anything unknown or a missing value is an error (never a silent default). */
function parseArgs(argv) {
  const out = { since: LAUNCH, bucket: 'hour', json: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (flag === '--json' && inline === undefined) { out.json = true; continue; }
    if (flag !== '--since' && flag !== '--bucket') throw Error('Unknown argument: ' + argv[i]);
    const value = inline !== undefined ? inline : argv[++i];
    if (!value || value.startsWith('--')) throw Error(flag + ' needs a value.');
    out[flag.slice(2)] = value;
  }
  return { ...out, since: Date.parse(out.since) };
}
const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
function print(rep) {
  const T = rep.totals, kv = o => Object.entries(o).map(([k, v]) => k + ' ' + fmt(v)).join(', ') || '-';
  console.log('Shinobi Bombers stats since ' + rep.since + ' (scope ' + rep.scope + ', generated ' + rep.generated + ')');
  console.log('New players: ' + fmt(T.newPlayers) + '   (registered all time: ' + fmt(rep.allTime.playersRegistered) + ', game profiles: ' + fmt(rep.allTime.profiles) + ')');
  console.log('SR deposited: ' + fmt(T.deposits.n) + ' deposits, ' + fmt(T.deposits.ryo) + ' Ryo credited (gross ' + fmt(T.deposits.gross) + ', studio fee ' + fmt(T.deposits.studioFee) + ')');
  console.log('Ryo spent: ' + fmt(T.ryoSpent.ryo) + ' over ' + fmt(T.ryoSpent.orders) + ' orders (treasury ' + fmt(T.ryoSpent.treasury) + ', burned ' + fmt(T.ryoSpent.burn) + ')');
  console.log('  by product: ' + kv(T.ryoSpent.byProduct));
  console.log('  by funding: ' + kv(T.ryoSpent.byFunding));
  console.log('Summons: ' + fmt(T.summons.heroes) + ' heroes in ' + fmt(T.summons.orders) + ' orders; rarity: ' + kv(rep.rarity.summon));
  console.log('Free heroes: ' + fmt(T.freeHeroes.total) + ' (' + kv(T.freeHeroes.bySource) + ')');
  console.log('SOL sales: ' + fmt(T.solSales) + ' SOL. Founder boxes ' + fmt(T.founders.n) + ' (' + fmt(T.founders.sol) + ' SOL; ' + kv(T.founders.byTier) + '), Mythic Boxes ' + fmt(T.mythicBoxes.n) + ' (' + fmt(T.mythicBoxes.sol) + ' SOL), Sensei ' + fmt(T.senseiSol.n) + ' (' + fmt(T.senseiSol.sol) + ' SOL)');
  console.log('SR revenue routed: ' + fmt(T.srRevenue.sr) + ' SR over ' + fmt(T.srRevenue.n) + ' payments; allocations: ' + kv(rep.revenueAllocations));
  console.log('Chest claims: ' + fmt(T.chestClaims.ryo) + ' Ryo (' + fmt(T.chestClaims.n) + '); Chest spends: ' + fmt(T.chestSpends.ryo) + ' Ryo (' + fmt(T.chestSpends.n) + ')');
  console.log('Adventure (all time): ' + fmt(rep.allTime.adventure.kills) + ' kills by ' + fmt(rep.allTime.adventure.hunters) + ' players, ' + fmt(rep.allTime.adventure.chestPending) + ' Ryo waiting in Chests, ' + fmt(rep.allTime.adventure.chestUsed) + ' Ryo claimed or spent from Chests');
  console.log('Salvages: ' + fmt(T.salvages.n) + ' (' + fmt(T.salvages.shards) + ' shards); Fusion Shard crafts: ' + fmt(T.shardCrafts.n) + '; Expedition speed-ups: ' + fmt(T.expeditionRevenue.n) + ' (' + fmt(T.expeditionRevenue.sr) + ' SR)');
  console.log('Withdrawals paid out: ' + fmt(T.withdrawals.n) + ', ' + fmt(T.withdrawals.ryo) + ' Ryo (by status: ' + kv(T.withdrawals.byStatus) + ')');
  if (rep.skipped.length) console.log('Not present in this database (skipped): ' + rep.skipped.join(', '));
  console.log('\nAdd --json for the full per-' + rep.bucket + ' series.');
}
async function main() {
  let opts; try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 2; return; }
  const scope = process.env.RYO_SCOPE;
  if (!Number.isFinite(opts.since)) { console.error('--since must be an ISO time, for example 2026-11-09T14:40:00Z.'); process.exitCode = 2; return; }
  if (!BUCKETS[opts.bucket]) { console.error('--bucket must be hour or day.'); process.exitCode = 2; return; }
  if (!process.env.DATABASE_URL || !scope) { console.error('Run this where the game database settings are configured (DATABASE_URL and RYO_SCOPE).'); process.exitCode = 2; return; }
  const { Client } = require(require.resolve('pg', { paths: [path.join(__dirname, '../app/server'), __dirname] }));
  const client = new Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 30000 });
  await client.connect();
  let rep;
  try { rep = await run(client, scope, opts); } finally { await client.end(); }
  if (opts.json) console.log(JSON.stringify(rep)); else print(rep);
}
module.exports = { collect, run, shape, print, parseArgs, QUERIES, SNAPSHOTS, LAUNCH };
if (require.main === module) main().catch(e => { console.error('Report failed: ' + e.message); process.exitCode = 1; });
