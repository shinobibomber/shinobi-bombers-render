'use strict';
/* READ-ONLY report: Founder box buyers who were charged the full price for a Ryo service (owner report 2026-11-10).
 *
 * Before the fix, the Founder discount (Mythic 10%, Legacy 5%) was read from profile.founderTier, which was only copied in
 * from the entitlement when the game reloaded state after the profile existed. This lists CONFIRMED purchases on a
 * discounted product, made by a Founder buyer while
 *   - Founder rewards (redemption) were open: from --since (when FOUNDERS_REWARD_REDEMPTION_ENABLED went on; the hosting
 *     environment keeps no history, so you must give it), minus any --off windows you name, minus every period the
 *     Control panel had the "foundersRedemption" switch OFF (read from its hash-chained log);
 *   - the buyer's entitlement existed and was not suspended (current state plus the revoke/restore history);
 * whose saved quote carries no Founder (or Mythic Box) discount, with the amount that should have been charged.
 * Without the discount being open, the full price was the correct price, so those purchases are never listed.
 *
 * It changes nothing: one READ ONLY transaction, SELECT only. It prints wallets and amounts, never settings or secrets.
 * Run it where the game's database settings already exist (for example the Render Shell of the live service):
 *     node tools/founder-discount-report.cjs --since 2026-11-09T00:00:00Z [--off <from>..<to>] [--json]
 * Refunds are a separate, owner-approved step; this script never credits anything. */
const path = require('node:path');
const BPS = { mythic: 1000, legacy: 500 };
const DISCOUNTED = ['summon', 'training', 'dojo', 'sensei', 'sensei-rental', 'fusion'];   // founders.cjs DISCOUNTED

const shouldHave = (amount, tier) => Math.round(amount * (10000 - BPS[tier]) / 10000);
const inAny = (t, windows) => windows.some(([a, b]) => t >= a && t < b);
/** Closed periods from ordered [time, isOn] changes (true = on, false = off); `initial` is the state before the first change. */
function offWindows(changes, initial = true, end = Infinity) {
  const out = []; let on = initial, from = -Infinity;
  for (const [t, next] of changes) { if (on && !next) from = t; if (!on && next) out.push([from, t]); on = next; }
  if (!on) out.push([from, end]);
  return out;
}
/** Pure: the full-price Founder purchases among confirmed purchase rows joined with the buyer's entitlement. */
function overcharges(rows, { since, off = [], suspended = new Map() } = {}) {
  if (!Number.isFinite(since)) throw Error('A --since time (when Founder rewards opened) is required.');
  return rows.filter(r => {
    const t = Number(r.created);
    return r.status === 'confirmed' && DISCOUNTED.includes(r.product) && BPS[r.tier] && t >= since && t >= Number(r.granted)
      && !inAny(t, off) && !inAny(t, suspended.get(r.wallet) || []) && (r.revoked == null || Number(r.revoked) > t)
      && !/Founder (Mythic|Legacy) −/.test(String(r.title || '')) && !/Mythic −10%/.test(String(r.title || ''));
  }).map(r => { const charged = Number(r.amount), due = shouldHave(charged, r.tier);
    return { wallet: r.wallet, tier: r.tier, requestId: r.request_id, product: r.product, funding: r.funding || 'balance', title: r.title || '', created: new Date(Number(r.created)).toISOString(), charged, shouldHaveBeen: due, overcharged: charged - due }; });
}
const SQL = `SELECT p.wallet,p.request_id,p.product,p.status,p.amount,p.created,p.quote->>'title' AS title,p.quote->>'funding' AS funding,e.tier,e.granted,e.revoked
  FROM ryo_purchases p JOIN ryo_founder_entitlements e ON e.scope=p.scope AND e.wallet=p.wallet
  WHERE p.scope=$1 AND p.status='confirmed' ORDER BY p.created`;
const SUSPENSIONS_SQL = "SELECT target,action,created FROM ryo_founder_audit WHERE scope=$1 AND action IN ('revoke','restore') ORDER BY id";
const SWITCH_SQL = "SELECT enabled,created FROM ryo_feature_switch_log WHERE scope=$1 AND key='foundersRedemption' ORDER BY seq";

/** Reads everything in one read-only transaction (works with a pg client or a pool-like test shim). */
async function collect(db, scope, opts) {
  const has = async t => !!(await db.query('SELECT to_regclass($1) IS NOT NULL AS t', [t])).rows[0].t;
  const rows = (await db.query(SQL, [scope])).rows;
  const suspended = new Map();
  if (await has('ryo_founder_audit')) {
    const byWallet = new Map();
    for (const a of (await db.query(SUSPENSIONS_SQL, [scope])).rows) { if (!byWallet.has(a.target)) byWallet.set(a.target, []); byWallet.get(a.target).push([Number(a.created), a.action === 'restore']); }
    for (const [w, changes] of byWallet) suspended.set(w, offWindows(changes));
  }
  // Panel value OFF = closed; ON or cleared (back to the environment, open from --since) = open.
  const panel = await has('ryo_feature_switch_log') ? offWindows((await db.query(SWITCH_SQL, [scope])).rows.map(r => [Number(r.created), r.enabled !== false])) : [];
  return overcharges(rows, { since: opts.since, off: [...(opts.off || []), ...panel], suspended });
}

function parseArgs(argv) {
  const at = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const since = Date.parse(at('--since') || '');
  const off = []; argv.forEach((a, i) => { if (a === '--off') { const [x, y] = String(argv[i + 1] || '').split('..').map(Date.parse); if (!Number.isFinite(x) || !Number.isFinite(y) || y <= x) throw Error('--off needs <from>..<to> (ISO times).'); off.push([x, y]); } });
  return { since, off, json: argv.includes('--json') };
}
async function main() {
  const opts = parseArgs(process.argv.slice(2)), scope = process.env.RYO_SCOPE;
  if (!Number.isFinite(opts.since)) { console.error('Give --since <ISO time> = when Founder rewards (FOUNDERS_REWARD_REDEMPTION_ENABLED) were switched on.'); process.exitCode = 2; return; }
  if (!process.env.DATABASE_URL || !scope) { console.error('Run this where the game database settings are configured (DATABASE_URL and RYO_SCOPE).'); process.exitCode = 2; return; }
  const { Client } = require(require.resolve('pg', { paths: [path.join(__dirname, '../app/server'), __dirname] }));
  const client = new Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 15000 });
  await client.connect();
  let list;
  try { await client.query('BEGIN READ ONLY'); list = await collect(client, scope, opts); await client.query('ROLLBACK'); }
  finally { await client.end(); }
  const total = list.reduce((s, r) => s + r.overcharged, 0), wallets = new Set(list.map(r => r.wallet));
  if (opts.json) { console.log(JSON.stringify({ purchases: list, wallets: wallets.size, totalOvercharged: total }, null, 2)); return; }
  console.log('Confirmed Founder purchases charged at full price while Founder rewards were open: ' + list.length + ' purchase(s), ' + wallets.size + ' wallet(s), ' + total.toLocaleString('en-US') + ' Ryo overcharged in total.');
  for (const r of list) console.log([r.created.slice(0, 16).replace('T', ' '), r.wallet, r.tier, r.product, r.funding, 'charged ' + r.charged, 'due ' + r.shouldHaveBeen, 'over ' + r.overcharged, r.requestId].join('  '));
  const byWallet = {}; for (const r of list) byWallet[r.wallet] = (byWallet[r.wallet] || 0) + r.overcharged;
  if (list.length) { console.log('\nPer wallet:'); for (const [w, n] of Object.entries(byWallet)) console.log('  ' + w + '  ' + n.toLocaleString('en-US') + ' Ryo'); }
}
module.exports = { overcharges, offWindows, collect, shouldHave, SQL };
if (require.main === module) main().catch(e => { console.error('Report failed: ' + e.message); process.exitCode = 1; });
