'use strict';
const fs=require('node:fs'),path=require('node:path');
function one(s,a,b){const n=s.split(a).length-1;if(n!==1)throw Error('Hero upgrades anchor '+a.slice(0,80)+' ('+n+')');return s.replace(a,()=>b);}
const clientPatches=[
 ["acknowledgePurchase,acknowledgeSpend,reset,","acknowledgePurchase,acknowledgeSpend,salvage:body=>run(async()=>{const data=await api('hero-salvage',body);accept(data);return data}),reset,",1],
 ["dialog.querySelector('h2').textContent=q.title;","dialog.querySelector('h2').textContent=q.title;if(q.training){const note=document.createElement('p');note.className='training-shard-cost';note.textContent='Training also consumes '+q.training.shards+' Upgrade Shard(s) after successful settlement. Skill gains and shard costs are permanent.';dialog.querySelector('.checkout-actions').before(note)}",1]
];
function refreshAssets(app=path.join(__dirname,'app')){
 const dest=path.join(app,'public/assets/hero-upgrades');fs.mkdirSync(dest,{recursive:true});
 for(const f of ['rules.js','client.js'])fs.copyFileSync(path.join(__dirname,'hero-upgrades',f),path.join(dest,f));
}
function applyHeroUpgrades(app=path.join(__dirname,'app')){
 refreshAssets(app);
 for(const [src,name]of [['rules.js','hero-upgrade-rules.cjs'],['server.cjs','hero-upgrades.cjs']])fs.copyFileSync(path.join(__dirname,'hero-upgrades',src),path.join(app,'server',name));
 const patch=(file,fn)=>{const f=path.join(app,file);fs.writeFileSync(f,fn(fs.readFileSync(f,'utf8')));};
 patch('public/index.html',s=>{for(const[a,b]of clientPatches)s=one(s,a,b);return one(s,'</head>','<script src="assets/hero-upgrades/rules.js"></script>\n<script defer src="assets/hero-upgrades/client.js"></script>\n</head>');});
 patch('server/economy.cjs',s=>{
  s=one(s,'function normalizeProfile(profile){','function normalizeProfile(profile){require(\'./hero-upgrade-rules.cjs\').normalize(profile);');
  // Keep the native quote/fulfillment implementation; decorate training with its shard contract.
  s=one(s,'function quote(profile,product,params={}){','function nativeQuote(profile,product,params={}){');
  s=one(s,'function fulfill(profile,q,now=Date.now()){const next=normalizeProfile(structuredClone(profile)),outputs=[];','function fulfill(profile,q,now=Date.now()){const next=normalizeProfile(structuredClone(profile)),outputs=[];require(\'./hero-upgrades.cjs\').consume(next,q);');
  return one(s,'module.exports={','function quote(profile,product,params={}){return require(\'./hero-upgrades.cjs\').trainingQuote(profile,nativeQuote(profile,product,params));}\nmodule.exports={');
 });
 patch('server/store.cjs',s=>{
  s=one(s,"if(product==='fusion'&&(params.fusionRulesVersion", "if(product==='training'&&(params.upgradeRulesVersion!==1||params.upgradeRulesAccepted!==1))fail('Training now requires Upgrade Shards. Refresh and review a new quote.',409);if(product==='fusion'&&(params.fusionRulesVersion");
  return one(s,'const current=await this.profileLocked(c,wallet),latest=',"const current=await this.profileLocked(c,wallet);row.profile_after.upgradeShards=require('./hero-upgrades.cjs').settlementShards(current,row);const latest=");
 });
 patch('server/service.cjs',s=>one(s,"if(action==='hero-mode')", "if(action==='hero-salvage'){const salvage=await require('./hero-upgrades.cjs').salvage(store,wallet,body);return {salvage,...await state(wallet)}}\n  if(action==='hero-mode')"));
 patch('server/schema.sql',s=>s+`\n-- Account-bound Upgrade Shards: immutable salvage receipts; hero profile owns the balance.\nCREATE TABLE IF NOT EXISTS ryo_hero_salvages (scope TEXT NOT NULL,wallet TEXT NOT NULL,request_id TEXT NOT NULL,hero_id TEXT NOT NULL,rank INTEGER NOT NULL CHECK(rank BETWEEN 0 AND 5),shards INTEGER NOT NULL CHECK(shards IN (1,2,3,4,5,7)),hero JSONB NOT NULL,created BIGINT NOT NULL,PRIMARY KEY(scope,hero_id),UNIQUE(scope,wallet,request_id));\n`);
 console.log('Hero upgrades v1: additive recovery, account-bound shards, confirmed training costs and idempotent salvage.');
}
module.exports={applyHeroUpgrades,refreshAssets,clientPatches};if(require.main===module){if(process.argv.includes('--refresh-assets'))refreshAssets();else applyHeroUpgrades();}
