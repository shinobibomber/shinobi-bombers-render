/* Treasury integration build step (after apply-sr-revenue, before apply-network).
 *
 * Copies the public Chapter 04 registry, its read-only on-chain verifier and the live withdrawal/claim
 * policy into app/server/, appends the additive schema, and adds exact-string hooks. Every hook selects its
 * behaviour from the validated build stamp at runtime (treasury-rewards.cjs `live()`), so a beta/Devnet build
 * keeps its original 2% studio withdrawal fee, 24 h withdrawal cooldown and unlimited claim cadence.
 * The live wording of the game page is applied by apply-network.cjs for Mainnet builds only (liveClientPatches).
 * Only source files are edited; app/ is generated.
 */
'use strict';
const fs = require('node:fs'), path = require('node:path');

const FILES = ['treasury-registry.json', 'treasury-registry.cjs', 'treasury-verify.cjs', 'treasury-rewards.cjs'];
const TR = "require('./treasury-rewards.cjs')";

// [file (relative to app/server), before, after]
const serverHooks = [
  // Live: no 24 h withdrawal cooldown (minimum and one-pending rule unchanged).
  ['store.cjs', 'if(latest&&this.now()<Number(latest)+86400000)fail(', 'if(latest&&!' + TR + '.withdrawalsAnytime()&&this.now()<Number(latest)+86400000)fail('],
  ['store.cjs', 'return row?.latest?Number(row.latest)+86400000:0', 'return row?.latest&&!' + TR + '.withdrawalsAnytime()?Number(row.latest)+86400000:0'],
  // Persist the exact live 5% deduction and destination with the reservation.
  ['store.cjs', "'INSERT INTO ryo_withdrawals(scope,wallet,request_id,amount,signature,wire,last_height,created,studio_fee,net) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[this.scope,wallet,requestId,amount,record.signature,record.wire,record.lastHeight,this.now(),record.studioFee||0,record.net||amount]",
   "'INSERT INTO ryo_withdrawals(scope,wallet,request_id,amount,signature,wire,last_height,created,studio_fee,net,treasury_fee_raw,net_raw,treasury_fee_destination) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[this.scope,wallet,requestId,amount,record.signature,record.wire,record.lastHeight,this.now(),record.studioFee||0,record.net||amount,record.treasuryFeeRaw||'0',record.netRaw||null,record.treasuryDestination||null]"],
  // Book the deduction in its own ledger when the withdrawal finalizes (same DB transaction, idempotent).
  ['store.cjs', "await c.query('UPDATE ryo_withdrawals SET status=$4,settled_at=$5 WHERE scope=$1 AND wallet=$2 AND request_id=$3',[this.scope,wallet,requestId,status,this.now()]);return {...row,status}",
   "await c.query('UPDATE ryo_withdrawals SET status=$4,settled_at=$5 WHERE scope=$1 AND wallet=$2 AND request_id=$3',[this.scope,wallet,requestId,status,this.now()]);if(status==='confirmed')await " + TR + ".withdrawalSettled(this,c,row);return {...row,status}"],
  ['store.cjs', "'SELECT request_id,amount,studio_fee,net,signature,status,settled_at,created FROM ryo_withdrawals", "'SELECT request_id,amount,studio_fee,net,'+" + TR + ".withdrawalColumns()+'signature,status,settled_at,created FROM ryo_withdrawals"],
  // Live withdrawal wire: 95% to the player, 5% to the registered Squads Treasury vault, v3 memo.
  ['service.cjs', "const studioFee=economy.fee(n),net=n-studioFee,tx=await signedTransaction([...transferTo(wallet,BigInt(net)*UNIT),...transferTo(studioAddress,BigInt(studioFee)*UNIT),memo('shinobi-withdraw-v2:'+id)]);return {...tx,studioFee,net}",
   "const plan=" + TR + ".withdrawalPlan(n);if(plan){const tx=await signedTransaction([...transferTo(wallet,plan.netRaw),...transferTo(plan.treasury,plan.feeRaw),memo('shinobi-withdraw-v3:'+id)]);return {...tx,studioFee:0,net:plan.netWhole,treasuryFeeRaw:String(plan.feeRaw),netRaw:String(plan.netRaw),treasuryDestination:plan.treasury}}const studioFee=economy.fee(n),net=n-studioFee,tx=await signedTransaction([...transferTo(wallet,BigInt(net)*UNIT),...transferTo(studioAddress,BigInt(studioFee)*UNIT),memo('shinobi-withdraw-v2:'+id)]);return {...tx,studioFee,net}"],
  ['service.cjs', '{studio_fee:Number(row.studio_fee||0),net:Number(row.net||row.amount)}', "{studio_fee:Number(row.studio_fee||0),net:Number(row.net||row.amount),...(row.treasury_fee_raw&&String(row.treasury_fee_raw)!=='0'?{treasury_fee_raw:String(row.treasury_fee_raw),net_raw:String(row.net_raw)}:{})}"],
  ['service.cjs', 'withdrawalMinimum:100000,withdrawalCooldownMs:86400000,studioFeeBps:200,', 'withdrawalMinimum:100000,withdrawalCooldownMs:86400000,studioFeeBps:200,...' + TR + '.publicConfig(),'],
  ['service.cjs', "if([studioAddress,revenueAddress].includes(treasuryAddress))fail('Studio and revenue destinations must be separate from the custody treasury.',503);",
   "if([studioAddress,revenueAddress].includes(treasuryAddress))fail('Studio and revenue destinations must be separate from the custody treasury.',503);" + TR + '.assertCustody(treasuryAddress,studioAddress);'],
  // Live: once-per-24 h Chest claim bounded by the approved reward budget (inside the pool-locked claim transaction).
  ['adventure.cjs', 'credited=Math.min(Math.floor(d.pending/1000),pool,Math.max(0,Math.floor(custodyTokens-Number(liabilities.n))));',
   'credited=Math.min(Math.floor(d.pending/1000),pool,Math.max(0,Math.floor(custodyTokens-Number(liabilities.n))),await ' + TR + '.claimLimit(store,c,wallet));'],
  // Public, read-only: SR available for player Chest claims (figures only; cached; no addresses, keys or writes).
  ['service.cjs', "if(action==='creator-public')return require('./creators-portal.cjs').handle({store,origin},null,action,body);",
   "if(action==='treasury-claim-funding')return " + TR + ".claimFunding({store,connection,mint,treasuryAddress,checkNetwork});if(action==='creator-public')return require('./creators-portal.cjs').handle({store,origin},null,action,body);"],
  // Live: report when the next claim opens (beta: field omitted, payload unchanged).
  ['service.cjs', 'return {chest,...(claim?await state(wallet):{})}', 'const nextClaimAt=await ' + TR + '.nextClaimAt(store,store.pool,wallet);if(nextClaimAt!==null)Object.assign(chest,{nextClaimAt,claimCooldownMs:' + TR + '.CLAIM_COOLDOWN_MS});return {chest,...(claim?await state(wallet):{})}'],
];

// Live (Mainnet build) game-page wording, applied by apply-network.cjs before its Mainnet text rules.
const liveClientPatches = [
  ["'Withdrawal finalized: net tokens returned after the 2% studio fee.'", "'Withdrawal finalized: 95% paid to your wallet; 5% returned to the Locked Treasury.'", 1],
  ['Deposits and withdrawals deduct a 2% studio fee. Withdraw at least 100,000 Ryo, once per rolling 24 hours.', 'Deposits deduct a 2% studio fee. Withdrawals return 5% to the Locked Treasury; withdraw at least 100,000 Ryo at any time.', 1],
  ["'Withdrawal available: minimum 100,000 Ryo; one success every 24 hours.'", "'Withdrawal available any time: minimum 100,000 Ryo; 5% returns to the Locked Treasury.'", 1],
  ["' One successful withdrawal every 24 hours.'", "' Withdraw any time; 5% returns to the Locked Treasury.'", 1],
  ["'Studio fee: '+Math.ceil(n/50).toLocaleString()+' Ryo · You receive: '+(n-Math.ceil(n/50)).toLocaleString()+(withdraw?' tokens.':' Ryo.')",
   "(withdraw?'Locked Treasury 5%: '+(n/20).toLocaleString(undefined,{maximumFractionDigits:6})+' Ryo · You receive: '+(n-n/20).toLocaleString(undefined,{maximumFractionDigits:6})+' tokens.':'Studio fee: '+Math.ceil(n/50).toLocaleString()+' Ryo · You receive: '+(n-Math.ceil(n/50)).toLocaleString()+' Ryo.')", 1],
  ["result.withdrawal.status==='confirmed'?(n-Math.ceil(n/50)).toLocaleString()+' tokens withdrawn after the 2% studio fee.'", "result.withdrawal.status==='confirmed'?(n-n/20).toLocaleString(undefined,{maximumFractionDigits:6})+' tokens withdrawn; 5% returned to the Locked Treasury.'", 1],
  ['Withdrawals: minimum 100,000 Ryo, once every 24 hours, with a 2% studio fee.', 'Withdrawals: minimum 100,000 Ryo, any time; 5% returns to the Locked Treasury. Chest rewards can be claimed once every 24 hours.', 1],
  ["'Studio fee '+fmt(row.studio_fee)+' Ryo'", "(row.treasury_fee_raw?'Locked Treasury 5% '+(Number(row.treasury_fee_raw)/1e6).toLocaleString(undefined,{maximumFractionDigits:6})+' Ryo':'Studio fee '+fmt(row.studio_fee)+' Ryo')", 1],
];

function replaceCount(text, [before, after, count = 1], label) {
  if (text.split(after).length - 1 === count && (!text.includes(before) || after.includes(before))) return text;
  const n = text.split(before).length - 1;
  if (n !== count) throw Error('Treasury patch mismatch: ' + label + ' "' + before.slice(0, 70) + '" (' + n + ')');
  return text.split(before).join(after);
}
function liveClientText(text) { return liveClientPatches.reduce((t, p, i) => replaceCount(t, p, 'live client ' + i), text); }

function applyTreasury(appDir = path.join(__dirname, 'app')) {
  const server = path.join(appDir, 'server');
  for (const f of FILES) fs.copyFileSync(path.join(__dirname, 'treasury', f), path.join(server, f));
  require(path.join(server, 'treasury-registry.cjs')).registry(); // a broken registry fails the build
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Treasury integration v1:')) fs.appendFileSync(schema, '\n' + fs.readFileSync(path.join(__dirname, 'treasury/schema.sql'), 'utf8').replace(/\r\n?/g, '\n') + '\n');
  for (const [i, [file, before, after]] of serverHooks.entries()) {
    const p = path.join(server, file);
    fs.writeFileSync(p, replaceCount(fs.readFileSync(p, 'utf8'), [before, after, 1], file + ' hook ' + i));
  }
  console.log('Treasury: public Chapter 04 registry + read-only verifier installed; live 5% withdrawal deduction and 24 h Chest claim selected by the build stamp.');
}
module.exports = { applyTreasury, serverHooks, liveClientPatches, liveClientText, FILES };
if (require.main === module) applyTreasury();
