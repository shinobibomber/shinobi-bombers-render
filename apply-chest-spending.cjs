/* Direct Chest Reward Spending build step (after apply-prison-rescue, before apply-live-economy; see unpack.cjs).
 * Owner request 2026-11-11: pay Summon / Fusion / Dojo / Training with verified, unclaimed Chest SR before the claim timer.
 * Copies chest-spending/server.cjs to app/server/chest-spending.cjs, appends its additive schema, the checkout client, and
 * exact-string hooks (each must match exactly once, or the build stops):
 *   store.cjs    purchaseWith(options, ...) passes the funding choice; Store.purchase lets chest-spending reserve() pay (no balance
 *                debit then); a replay cannot switch funding; Store.settlePurchase restores the chest on refund (never credits the
 *                balance for a chest-funded order) and confirms the spend after settlement.
 *   service.cjs  the purchase route passes {funding, custody}; the quote route adds the read-only `chest` offer.
 *   index.html   the checkout dialog gets the "Pay using" choice; RyoPayments.purchase sends funding:'chest' with its request.
 * tests/preservation.cjs reverses the client hooks; store.cjs / service.cjs / schema.sql are covered by their pinned hashes.
 * adventure.cjs and combat-adventure.cjs (the real-time kill -> Chest path) are not touched. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const marker = '<!-- chest-spending -->', script = '<script defer src="assets/chest-spending/chest-spending.js"></script>';
const C = "require('./chest-spending.cjs')";

const storeHooks = [
  ['async purchase(wallet,id,product,params,expectedTotal,prepare){return this.transaction(async c=>{',
   // The funding choice arrives explicitly (purchaseWith) or as the intent the purchase route registered for this request id right
   // before calling purchase (chest-spending.cjs intend/takeIntent), so the route keeps SR revenue's own text.
   'async purchaseWith(options,...args){return this.purchase(...args,options)}\n async purchase(wallet,id,product,params,expectedTotal,prepare,options=' + C + '.takeIntent(this,wallet,id)){return this.transaction(async c=>{'],
  ["if(old.product!==product||!require('node:util').isDeepStrictEqual(old.params,params))fail('Purchase request ID belongs to another order.');return old}",
   "if(old.product!==product||!require('node:util').isDeepStrictEqual(old.params,params)||(options.funding==='chest')!==(old.quote?.funding==='chest'))fail('Purchase request ID belongs to another order.');return old}"],
  ["const bonusPaid=Number(account.bonus||0)>=q.total;if(bonusPaid)q.funding='bonus';else if(",
   // Step 1 (no pool lock, the one custody RPC): validate and pre-check; nothing is debited yet.
   "const chestPaid=await " + C + ".prepareSpend(this,c,wallet,id,product,q,profile,options),bonusPaid=!chestPaid&&Number(account.bonus||0)>=q.total;if(chestPaid)q.funding='chest';else if(bonusPaid)q.funding='bonus';else if("],
  // Step 2, after prepare() (all RPC done): pool lock, re-check, debit the chest instead of the balance.
  ["await c.query(bonusPaid?'UPDATE ryo_accounts SET bonus=bonus-$3 WHERE scope=$1 AND wallet=$2':'UPDATE ryo_accounts SET balance=balance-$3 WHERE scope=$1 AND wallet=$2',[this.scope,wallet,q.total]);",
   "if(chestPaid)await " + C + ".commitSpend(this,c,wallet,id,product,q,chestPaid);else await c.query(bonusPaid?'UPDATE ryo_accounts SET bonus=bonus-$3 WHERE scope=$1 AND wallet=$2':'UPDATE ryo_accounts SET balance=balance-$3 WHERE scope=$1 AND wallet=$2',[this.scope,wallet,q.total]);"],
  ["if(status==='refunded')await c.query('UPDATE ryo_accounts SET balance=balance+$3 WHERE scope=$1 AND wallet=$2',[this.scope,wallet,row.amount]);else {",
   "if(status==='refunded'){if(row.quote?.funding==='chest')await " + C + ".refund(this,c,row);else await c.query('UPDATE ryo_accounts SET balance=balance+$3 WHERE scope=$1 AND wallet=$2',[this.scope,wallet,row.amount]);}else {"],
  ["if(row.product==='market')await require('./market.cjs').settled(this,c,row,status);return {...row,status}})}",
   "if(row.product==='market')await require('./market.cjs').settled(this,c,row,status);await " + C + ".settled(this,c,row,status);return {...row,status}})}"],
];
const CUSTODY = "async()=>Number((await connection.getTokenAccountBalance(treasuryAta,'finalized')).value.amount)/Number(UNIT)";
const serviceHooks = [
  // Both hooks keep apply-sr-revenue's own text intact (it re-checks it when re-applied, e.g. in tests/creators-server.cjs).
  ["const id=requestId(body.requestId);const row=await store.purchase(wallet,id,body.product,body.params||{},body.expectedTotal,async (q,c)=>{",
   "const id=requestId(body.requestId);" + C + ".intend(store,wallet,id,{funding:body.funding==='chest'?'chest':null,custody:" + CUSTODY + "});const row=await store.purchase(wallet,id,body.product,body.params||{},body.expectedTotal,async (q,c)=>{"],
  ["if(action==='quote')return require('./sr-revenue.cjs').preview(store,wallet,economy.quote(await store.profile(wallet),body.product,body.params||{}));",
   "if(action==='quote'){const preview=await require('./sr-revenue.cjs').preview(store,wallet,economy.quote(await store.profile(wallet),body.product,body.params||{}));return {...preview,chest:await " + C + ".offer(store,wallet,preview," + CUSTODY + ")}}\n  if(action==='quote')return require('./sr-revenue.cjs').preview(store,wallet,economy.quote(await store.profile(wallet),body.product,body.params||{}));"],
];
const clientHooks = [
  ["   const yes=await new Promise(resolve=>{dialog.querySelector('#checkoutCancel').onclick=",
   "   window.ChestSpending?.decorate(dialog,q);const yes=await new Promise(resolve=>{dialog.querySelector('#checkoutCancel').onclick="],
  ['pending={account:address,mint:configuration.mint,product:q.product,params:q.params,expectedTotal:q.total,requestId:crypto.randomUUID()};',
   "pending={account:address,mint:configuration.mint,product:q.product,params:q.params,expectedTotal:q.total,requestId:crypto.randomUUID(),...(q.payWith==='chest'?{funding:'chest'}:{})};"],
];

function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1 && !text.split(after).join('').includes(before)) return text; // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Chest spending patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}
const patch = (file, hooks, label) => fs.writeFileSync(file, hooks.reduce((t, h, i) => replaceOnce(t, h, label + ' ' + i), fs.readFileSync(file, 'utf8')));

function applyChestSpending(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'chest-spending'), server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(server, 'chest-spending.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Chest Spending v1')) fs.appendFileSync(schema, '\n-- Chest Spending v1 (apply-chest-spending.cjs). Additive; existing data untouched.\n' + require('./chest-spending/server.cjs').SCHEMA + '\n');
  patch(path.join(server, 'store.cjs'), storeHooks, 'store');
  patch(path.join(server, 'service.cjs'), serviceHooks, 'service');
  const assets = path.join(appDir, 'public/assets/chest-spending');
  fs.rmSync(assets, { recursive: true, force: true }); fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(path.join(src, 'chest-spending.js'), path.join(assets, 'chest-spending.js'));
  const index = path.join(appDir, 'public/index.html');
  let html = clientHooks.reduce((t, h, i) => replaceOnce(t, h, 'client ' + i), fs.readFileSync(index, 'utf8'));
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Chest spending: expected one </head>.');
    html = html.replace('</head>', marker + '\n' + script + '\n</head>');
  }
  fs.writeFileSync(index, html);
  console.log('Chest spending applied: Summon / Fusion / Dojo / Training can be paid with verified unclaimed Chest SR (switch chestSpending; shares the daily reward budget; never the claim timer).');
}
module.exports = { applyChestSpending, storeHooks, serviceHooks, clientHooks };
if (require.main === module) applyChestSpending();
