'use strict';
const fs=require('node:fs'),path=require('node:path');
function one(s,a,b){const n=s.split(a).length-1;if(n!==1)throw Error('Legacy Pass anchor '+a.slice(0,90)+' ('+n+')');return s.replace(a,()=>b);}
const clientPatches=[
 ["acknowledgePurchase,acknowledgeSpend,salvage:","acknowledgePurchase,acknowledgeSpend,legacy:(action,body={})=>run(async()=>{const data=await api(action,body);accept(data);return data}),salvage:",1],
 ["h.referralBound=descriptor.referralReward===true;","h.referralBound=descriptor.referralReward===true||descriptor.accountBound===true;h.legacyPassReward=descriptor.legacyPassReward===true;",1],
 ["window.TokenCheckout={request,deliver,syncProfile};","function revealReward(tokenId){syncProfile();const p=RyoPayments.state,hero=S.h.find(h=>h.tokenId===tokenId&&h.tokenOwner===p.account);if(!p.authenticated||!hero)return false;if(S.v2.revealBatch?.length)return false;lastS=hero;S.v2.revealSource='legacy';S.v2.revealBatch=[{hero:JSON.parse(JSON.stringify(hero)),revealed:false}];save();Experience.refreshReveal();return true}window.TokenCheckout={request,deliver,syncProfile,revealReward};",1]
];
const adventurePatches=[
 ["const d=advance(row?.data,profile,store.now(),active,","const legacyEvents=require('./legacy-pass.cjs').activityCollector(store.now());const d=advance(row?.data,profile,store.now(),active,"],
 ["null,cp?.onReward);","null,cp?.onReward,legacyEvents.push);await require('./legacy-pass.cjs').flushLocked(store,c,wallet,profile,legacyEvents.events);"],
 ["const d=advance(old,profile,store.now(),active,","const legacyEvents=require('./legacy-pass.cjs').activityCollector(store.now());const d=advance(old,profile,store.now(),active,"],
 ["report,cp?.onReward);let creatorClaimId=null;","report,cp?.onReward,legacyEvents.push);await require('./legacy-pass.cjs').flushLocked(store,c,wallet,profile,legacyEvents.events);let creatorClaimId=null;"]
];
const servicePatches=[
 ["tokenPurchases:true,launchGates:","tokenPurchases:true,...(require('./legacy-pass.cjs').enabled()?{legacyPass:true}:{}),launchGates:"],
 [" async function checkMint(){"," require('./legacy-pass.cjs').setContext(store,{connection,checkNetwork});\n async function checkMint(){"],
 ["if(action==='state')return state(wallet);","if(typeof action==='string'&&action.startsWith('legacy-'))return {...await require('./legacy-pass.cjs').handle(store,wallet,action,body),...await state(wallet)};if(action==='state')return state(wallet);"],
 ["economy.quote(await store.profile(wallet),body.product,body.params||{})","await require('./legacy-pass.cjs').quote(store,wallet,body.product,body.params||{})"]
];
function applyLegacyPass(app=path.join(__dirname,'app')){
 const assets=path.join(app,'public/assets/legacy-pass');fs.mkdirSync(assets,{recursive:true});
 for(const f of ['rules.js','client.js','client.css'])fs.copyFileSync(path.join(__dirname,'legacy-pass',f),path.join(assets,f));
 for(const [src,dest]of [['rules.js','legacy-pass-rules.cjs'],['server.cjs','legacy-pass.cjs']])fs.copyFileSync(path.join(__dirname,'legacy-pass',src),path.join(app,'server',dest));
 const patch=(file,fn)=>{const f=path.join(app,file);fs.writeFileSync(f,fn(fs.readFileSync(f,'utf8')));};
 patch('server/schema.sql',s=>s+'\n'+fs.readFileSync(path.join(__dirname,'legacy-pass/schema.sql'),'utf8').replace(/\r\n?/g,'\n'));
 patch('public/index.html',s=>{for(const[a,b]of clientPatches)s=one(s,a,b);return one(s,'</head>','<link rel="stylesheet" href="assets/legacy-pass/client.css">\n<script defer src="assets/legacy-pass/client.js"></script>\n</head>');});
 patch('server/service.cjs',s=>servicePatches.reduce((s,[a,b])=>one(s,a,b),s));
 patch('server/store.cjs',s=>{
  s=one(s,"q=economy.quote(profile,product,params);","q=await require('./legacy-pass.cjs').trainingQuoteLocked(this,c,wallet,profile,economy.quote(profile,product,params));");
  s=one(s,"const fulfillment=economy.fulfill(profile,q,this.now())","await require('./legacy-pass.cjs').reserveVoucherLocked(this,c,wallet,id,q);const fulfillment=economy.fulfill(profile,q,this.now())");
  const start=s.indexOf(' async settlePurchase(');return s.slice(0,start)+one(s.slice(start),"if(!row||row.status!=='pending')return row;","if(!row||row.status!=='pending')return row;await require('./legacy-pass.cjs').settleVoucherLocked(this,c,wallet,row,status);");
 });
 patch('server/adventure.cjs',s=>adventurePatches.reduce((s,[a,b])=>one(s,a,b),s));
 patch('server/economy.cjs',s=>one(s,"fused.referralReward=true;outputs.push(fused)","fused.referralReward=true;if(q.params.heroIds.slice(i*3,i*3+3).some(id=>{const h=next.heroes.find(h=>h.tokenId===id);return h?.legacyPassReward===true||h?.accountBound===true}))Object.assign(fused,{accountBound:true,legacyPassReward:true,referralReward:true,rewardSource:'shinobi-legacy-pass-fusion'});outputs.push(fused)"));
 patch('server/market.cjs',s=>one(s,"hero.referralReward === true","(hero.referralReward === true || hero.accountBound === true || hero.legacyPassReward === true)"));
 console.log('Shinobi Legacy Pass installed (default disabled; account-bound items only).');
}
module.exports={applyLegacyPass,clientPatches,adventurePatches,servicePatches};if(require.main===module)applyLegacyPass();
