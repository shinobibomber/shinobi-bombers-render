'use strict';
const fs = require('node:fs'), path = require('node:path');
const clientPatches = [
 ['Deposited token Ryo · purchases: 80% reward pool · 10% treasury · 8% burn · 2% studio', 'Deposited token Ryo · approved SR services: 50% Treasury · 30% Adventure · 10% Community · 10% Reserve · no burn', 1],
 [' · every purchase: 80% reward pool · 10% treasury · 8% burn · 2% studio.', ' · approved SR services: 50% Treasury · 30% Adventure · 10% Community · 10% Reserve · no burn.', 1],
 ['.checkout-actions button{padding:14px;', '#checkoutConfirm:disabled{opacity:.5;cursor:not-allowed}.checkout-actions button{padding:14px;', 1],
 ['250,000 Ryo (2% studio share included).', '250,000 Ryo; the full payment follows the approved SR allocation.', 1],
 ['Token training: price includes the 2% studio share.', 'Token training follows the approved SR revenue allocation.', 1],
 ['charges 25,000 Ryo (2% studio share included), including failed attempts.', 'charges 25,000 Ryo under the approved SR allocation, including failed attempts.', 1],
 ["<dt>Operations / reward pool · 80%</dt><dd>'+fmt(q.operations)+' Ryo</dd><dt>Treasury · 10%</dt><dd>'+fmt(q.treasury)+' tokens</dd><dt>Burned · 8%</dt><dd>'+fmt(q.burn)+' tokens</dd><dt>Studio · 2%</dt><dd>'+fmt(q.studioFee)+' tokens</dd>",
  "'+(q.revenueDistribution?'<dt>Locked Treasury · 50%</dt><dd>'+fmt(q.treasury)+' Ryo</dd><dt>Active Adventure Rewards · 30%</dt><dd>'+fmt(q.operations)+' Ryo</dd><dt>Community Rewards · 10%</dt><dd>'+fmt(q.community)+' Ryo</dd><dt>Economic Reserve · 10%</dt><dd>'+fmt(q.reserve)+' Ryo</dd><dt>Automatic service burn</dt><dd>None</dd>':'<dt>Separate marketplace / event allocation</dt><dd>See its approved service rules</dd>')+'", 1],
 ['Each price allocates 80% to operations and the reward pool, 10% to treasury, 8% to an on-chain burn and 2% to the studio. The studio share is included in the price.',
  'Approved SR service prices allocate 50% to Locked Treasury, 30% to Active Adventure Rewards, 10% to Community Rewards and 10% to Economic Reserve. No automatic service burn. Deposits, withdrawals, SOL payments and marketplace proceeds have separate rules.', 1],
 ['Burning permanently reduces token supply. The purchase unlocks after the signed treasury settlement finalizes. This recruits game heroes, not NFTs.',
  'Approved SR service revenue is split 50/30/10/10 with no automatic burn. Marketplace and event payments use separate rules. The purchase unlocks only after finalized settlement. This recruits game heroes, not NFTs.', 1],
 ['Purchase finalized, including treasury transfer, burn and studio fee.', 'Purchase finalized with its recorded revenue allocations.', 1],
 ["dialog.querySelector('#checkoutConfirm').onclick=()=>{dialog.close();resolve(true)};", "if(q.revenueDistribution){const message=document.createElement('p');message.textContent=q.revenueDistribution.note||'50/30/10/10 SR service allocation. No automatic burn.';dialog.querySelector('.checkout-actions').before(message);if(q.revenueDistribution.ready===false)dialog.querySelector('#checkoutConfirm').disabled=true;}dialog.querySelector('#checkoutConfirm').onclick=()=>{dialog.close();resolve(true)};", 1]
];
function replace(s, before, after, label) {
 if (s.includes(after)) return s;
 if (s.split(before).length !== 2) throw Error('SR Revenue patch mismatch: ' + label);
 return s.replace(before, () => after);
}
function applySrRevenue(appDir = path.join(__dirname, 'app')) {
 const patch = (file, before, after) => { const p = path.join(appDir, file), s = fs.readFileSync(p, 'utf8'); fs.writeFileSync(p, replace(s, before, after, file + ':' + before.slice(0, 50))); };
 fs.copyFileSync(path.join(__dirname, 'sr-revenue/server.cjs'), path.join(appDir, 'server/sr-revenue.cjs'));
 const schema = path.join(appDir, 'server/schema.sql'); if (!fs.readFileSync(schema, 'utf8').includes('-- SR Revenue Distribution v1:')) fs.appendFileSync(schema, '\n' + fs.readFileSync(path.join(__dirname, 'sr-revenue/schema.sql'), 'utf8').replace(/\r\n?/g, '\n') + '\n');
 patch('server/economy.cjs', "const split=require('./gameplay-options.cjs').purchaseSplit(base),studioFee=split.studioFee;", "const split=require('./sr-revenue.cjs').split(base),studioFee=split.studioFee;");
 patch('server/economy.cjs', "operations:split.operations,...(product==='fusion'", "operations:split.operations,community:split.community,reserve:split.reserve,revenueDistribution:split.revenueDistribution,...(product==='fusion'");
 patch('server/service.cjs', "spl.getAssociatedTokenAddressSync(key(mint),owner);return [", "spl.getAssociatedTokenAddressSync(key(mint),owner,true);return [");
 const wire = "return signedTransaction([...(q.studioFee>0?transferTo(studioAddress,BigInt(q.studioFee)*UNIT):[]),...(q.treasury>0?transferTo(revenueAddress,BigInt(q.treasury)*UNIT):[]),...(q.burn>0?[spl.createBurnCheckedInstruction(treasuryAta,key(mint),treasury.publicKey,BigInt(q.burn)*UNIT,6)]:[]),memo('shinobi-purchase-v2:'+id)]);";
 if (!fs.readFileSync(path.join(appDir,'server/service.cjs'),'utf8').includes("await require('./sr-revenue.cjs').instructions(")) patch('server/service.cjs', wire, "return signedTransaction(q.revenueDistribution?await require('./sr-revenue.cjs').instructions({store,connection,mint,treasuryAddress,studioAddress,checkNetwork},q,id,transferTo,memo):[...(q.studioFee>0?transferTo(studioAddress,BigInt(q.studioFee)*UNIT):[]),...(q.treasury>0?transferTo(revenueAddress,BigInt(q.treasury)*UNIT):[]),...(q.burn>0?[spl.createBurnCheckedInstruction(treasuryAta,key(mint),treasury.publicKey,BigInt(q.burn)*UNIT,6)]:[]),memo('shinobi-purchase-v2:'+id)]);");
 patch('server/service.cjs', 'purchaseTreasuryBps:1000,purchaseBurnBps:800,purchaseStudioBps:200,purchaseOperationsBps:8000,', 'purchaseTreasuryBps:5000,purchaseBurnBps:0,purchaseStudioBps:0,purchaseOperationsBps:3000,purchaseCommunityBps:1000,purchaseReserveBps:1000,revenueDistribution:{marker:\'sr-revenue-distribution-v1\',basis:\'full-service-payment\',ratesBps:require(\'./sr-revenue.cjs\').RATES,configured:!!(await require(\'./sr-revenue.cjs\').config(store))?.enabled},');
 patch('server/service.cjs', "if(action==='quote')return economy.quote(await store.profile(wallet),body.product,body.params||{});", "if(action==='quote')return require('./sr-revenue.cjs').preview(store,wallet,economy.quote(await store.profile(wallet),body.product,body.params||{}));");
 const storeFile=path.join(appDir,'server/store.cjs');let storeText=fs.readFileSync(storeFile,'utf8');
 storeText=storeText.replace("if(status==='confirmed'){await require('./sr-revenue.cjs').settled(this,c,row);await require('./chat.cjs')", "if(status==='confirmed'){await require('./chat.cjs')");fs.writeFileSync(storeFile,storeText);
 patch('server/store.cjs', "if(row.product==='market')await require('./market.cjs').settled", "if(status==='confirmed')await require('./sr-revenue.cjs').settled(this,c,row);if(row.product==='market')await require('./market.cjs').settled");
 patch('server/store.cjs', ':await prepare(q);', ':await prepare(q,c);');
 patch('server/store.cjs', "await require('./adventure.cjs').settleLocked(this,c,wallet,profile,false);", "if(q.revenueDistribution&&!bonusPaid)await require('./sr-revenue.cjs').config(this,c,true);await require('./adventure.cjs').settleLocked(this,c,wallet,profile,false);");
 patch('server/store.cjs', 'Not enough deposited Ryo, including the studio fee.', 'Not enough deposited Ryo for this service.');
 patch('server/service.cjs', 'store.purchase(wallet,id,body.product,body.params||{},body.expectedTotal,async q=>{', 'store.purchase(wallet,id,body.product,body.params||{},body.expectedTotal,async (q,c)=>{');
 const routedContext='{store,client:c,wallet,connection,mint,treasuryAddress,studioAddress,checkNetwork},q,id,transferTo,memo)';
 const serviceText=fs.readFileSync(path.join(appDir,'server/service.cjs'),'utf8');
 if(!serviceText.includes(routedContext))patch('server/service.cjs',serviceText.includes('{store,client:c,connection,mint,treasuryAddress,studioAddress,checkNetwork},q,id,transferTo,memo)')?'{store,client:c,connection,mint,treasuryAddress,studioAddress,checkNetwork},q,id,transferTo,memo)':'{store,connection,mint,treasuryAddress,studioAddress,checkNetwork},q,id,transferTo,memo)',routedContext);
 patch('server/netlify-handler.cjs', "['SOL_GAS_INSUFFICIENT','SOL_GAS_UNAVAILABLE'].includes(e.code)", "(['SOL_GAS_INSUFFICIENT','SOL_GAS_UNAVAILABLE'].includes(e.code)||e.paymentNotSubmitted===true)");
 const income = "const income=(await c.query(\"SELECT COALESCE(SUM((quote->>'operations')::numeric),0) AS n FROM ryo_purchases WHERE scope=$1 AND status='confirmed' AND COALESCE(quote->>'funding','')<>'bonus'\",[store.scope])).rows[0];";
 const adventure = path.join(appDir, 'server/adventure.cjs'), s = fs.readFileSync(adventure, 'utf8');
 if (!s.includes("const income=await require('./sr-revenue.cjs').income(store,c);")) {
  if (s.split(income).length !== 3) throw Error('SR Revenue adventure income anchor count changed');
  fs.writeFileSync(adventure, s.split(income).join("const income=await require('./sr-revenue.cjs').income(store,c);"));
 }
 patch('server/market.cjs', 'return { studioFee, treasury, operations, seller:', 'return { adventureEligible: false, studioFee, treasury, operations, seller:');
 // Market quote builders spread split fields in some versions and select fields in others.
 const marketFile=path.join(appDir,'server/market.cjs');let market=fs.readFileSync(marketFile,'utf8');
 market=market.replaceAll(/operations: s.operations,(?! adventureEligible: false,)/g,'operations: s.operations, adventureEligible: false,');
 fs.writeFileSync(marketFile,market);
 const html = path.join(appDir, 'public/index.html'); let text = fs.readFileSync(html, 'utf8');
 for (const [before, after] of clientPatches) text = replace(text, before, after, 'checkout'); fs.writeFileSync(html, text);
 console.log('SR Revenue Distribution: 50/30/10/10, no automatic service burn, protected-vault approval and separate market revenue.');
}
module.exports = { applySrRevenue, clientPatches };
if (require.main === module) applySrRevenue();
