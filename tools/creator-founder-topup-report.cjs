'use strict';
/* READ-ONLY report: the Creator Points top-up owed for Founder-box referrals (owner decision 2026-11-10).
 *
 * From this release a creator earns 10% (not 5%) on the Adventure and game-service commissions of a referral who bought a Founder
 * box (a CONFIRMED purchase). Commissions already recorded at 5% for such a referral are raised to 10% automatically by the game
 * (creators-portal/server.cjs topUpFounderCommissions) the next time the creator opens the Creators Portal or redeems, when staff
 * open the admin view, or when that referral earns a new commission. This script shows, BEFORE or after the deploy, what that
 * top-up is: per creator, how many commissions and referrals, and the CP it adds (floor(SR x 10%) - CP already credited).
 *
 * It changes nothing: one READ ONLY transaction, SELECT only. Referrals are shown by their private id (never wallets).
 * Run it where the game's database settings already exist (for example the Render Shell of the live service):
 *     node tools/creator-founder-topup-report.cjs [--json] */
const path = require('node:path'), crypto = require('node:crypto');
const privateId = wallet => 'Player ' + crypto.createHash('sha256').update(wallet).digest('hex').slice(0, 10).toUpperCase();   // creators-portal privateId
const SQL = `SELECT m.creator_id,c.display_name,m.wallet,m.kind,m.source_id,m.sr_milli,m.cp_milli,m.created
  FROM ryo_creator_commissions m JOIN ryo_creators c ON c.scope=m.scope AND c.id=m.creator_id
  WHERE m.scope=$1 AND m.cp_milli < m.sr_milli*10/100
    AND EXISTS(SELECT 1 FROM ryo_founder_purchases f WHERE f.scope=m.scope AND f.wallet=m.wallet AND f.status='confirmed')
    AND NOT EXISTS(SELECT 1 FROM ryo_creator_ledger l WHERE l.scope=m.scope AND l.event_id='topup:'||m.source_id)
  ORDER BY c.display_name,m.created,m.source_id`;

/** Pure: groups the owed top-ups by creator. Amounts are milli-CP as BigInt strings. */
function plan(rows) {
  const byCreator = new Map();
  for (const m of rows) {
    const delta = BigInt(m.sr_milli) * 10n / 100n - BigInt(m.cp_milli);
    if (delta <= 0n) continue;
    if (!byCreator.has(m.creator_id)) byCreator.set(m.creator_id, { creatorId: m.creator_id, displayName: m.display_name, commissions: 0, referrals: new Set(), topUpMilli: 0n, adventure: 0, purchase: 0 });
    const g = byCreator.get(m.creator_id);
    g.commissions++; g.referrals.add(privateId(m.wallet)); g.topUpMilli += delta; g[m.kind === 'adventure' ? 'adventure' : 'purchase']++;
  }
  const creators = [...byCreator.values()].map(g => ({ ...g, referrals: [...g.referrals], topUpMilli: String(g.topUpMilli) }));
  return { creators, totalMilli: String(creators.reduce((n, g) => n + BigInt(g.topUpMilli), 0n)), commissions: creators.reduce((n, g) => n + g.commissions, 0) };
}
const cp = milli => (Number(BigInt(milli)) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });

async function collect(db, scope) {
  const has = async t => !!(await db.query('SELECT to_regclass($1) IS NOT NULL AS t', [t])).rows[0].t;
  if (!await has('ryo_founder_purchases') || !await has('ryo_creator_commissions')) return plan([]);
  return plan((await db.query(SQL, [scope])).rows);
}
async function main() {
  const json = process.argv.includes('--json'), scope = process.env.RYO_SCOPE;
  if (!process.env.DATABASE_URL || !scope) { console.error('Run this where the game database settings are configured (DATABASE_URL and RYO_SCOPE).'); process.exitCode = 2; return; }
  const { Client } = require(require.resolve('pg', { paths: [path.join(__dirname, '../app/server'), __dirname] }));
  const client = new Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 15000 });
  await client.connect();
  let report;
  try { await client.query('BEGIN READ ONLY'); report = await collect(client, scope); await client.query('ROLLBACK'); }
  finally { await client.end(); }
  if (json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log('Founder-box commission top-up still owed: ' + cp(report.totalMilli) + ' CP across ' + report.commissions + ' commission(s), ' + report.creators.length + ' creator(s).');
  for (const g of report.creators) console.log('  ' + g.displayName + ' (' + g.creatorId + '): +' + cp(g.topUpMilli) + ' CP · ' + g.commissions + ' commission(s) [' + g.adventure + ' Adventure, ' + g.purchase + ' purchase] · referrals: ' + g.referrals.join(', '));
  if (!report.creators.length) console.log('  Nothing to top up.');
}
module.exports = { plan, collect, SQL, privateId };
if (require.main === module) main().catch(e => { console.error('Report failed: ' + e.message); process.exitCode = 1; });
