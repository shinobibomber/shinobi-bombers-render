const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../app/server');
const economy=require(path.join(root,'economy.cjs')),{Store}=require(path.join(root,'store.cjs')),adventure=require(path.join(root,'adventure.cjs')),{saveSenseiSettings}=require(path.join(root,'gameplay-options.cjs'));
const make=(n,rank=0,level=1)=>economy.normalizeProfile({dojo:0,sensei:true,heroes:Array.from({length:n},(_,i)=>({tokenId:'hero-'+i,rank,level,name:'Hero '+i,baseStats:{pw:2,sp:2,st:10}})),battleReady:[]});
const ids=p=>p.heroes.slice(0,3).map(h=>h.tokenId),originalRandom=crypto.randomInt;
function roll(value,fn){crypto.randomInt=(...args)=>args.length===1&&args[0]===100?value:originalRandom(...args);try{return fn()}finally{crypto.randomInt=originalRandom}}
(async()=>{
 for(const [rank,chance]of [90,80,70,60].entries()){
  const p=make(5,rank,rank===3?10:1),q=economy.quote(p,'fusion',{heroIds:ids(p)});
  assert.equal(q.fusion.successPercent,chance);assert.equal(q.total,25500);assert.equal(q.params.fusionRulesVersion,1);
  const success=roll(chance-1,()=>economy.fulfill(p,q));assert.equal(success.result.outputs.length,1);assert.equal(success.profile.heroes.length,3);assert.equal(success.result.outputs[0].rank,rank+1);
  const failure=roll(chance,()=>economy.fulfill(p,q));assert.equal(failure.result.outputs.length,0);assert.equal(failure.profile.heroes.length,2);assert.deepEqual(failure.result.consumed,ids(p));assert.equal(failure.result.fusion.failed,1);assert.equal(failure.result.fusion.totalCharged,25500);
  assert.equal(p.heroes.length,5,'quote/fulfillment do not mutate input');
 }
 assert.throws(()=>economy.quote(make(5,3,9),'fusion',{heroIds:ids(make(5))}),/level 10/);
 assert.throws(()=>economy.quote(make(4),'fusion',{heroIds:ids(make(4))}),/two heroes/);
 const ready=make(5);ready.battleReady=ids(ready);assert.throws(()=>economy.quote(ready,'fusion',{heroIds:ids(ready)}),/Reserve/);
 const batch=make(8),bq=economy.quote(batch,'fusion',{heroIds:batch.heroes.slice(0,6).map(h=>h.tokenId)});let rolls=[0,99];crypto.randomInt=(...args)=>args.length===1&&args[0]===100?rolls.shift():originalRandom(...args);const partial=economy.fulfill(batch,bq);crypto.randomInt=originalRandom;assert.equal(partial.result.fusion.succeeded,1);assert.equal(partial.result.fusion.failed,1);assert.equal(partial.profile.heroes.length,3);assert.equal(partial.result.fusion.totalCharged,51000);
 const legacy={...bq};delete legacy.fusion;assert.equal(roll(99,()=>economy.fulfill(batch,legacy)).result.outputs.length,2,'preexisting persisted quotes preserve guaranteed legacy outcomes');
 const now=Date.now(),online=make(12);online.battleReady=online.heroes.map(h=>h.tokenId);const data={map:1,target:0,hp:10000,kills:0,pending:0,claimed:0,last:now-1000,active:true,team:online.battleReady.slice(0,10),energy:Object.fromEntries(online.heroes.map((h,i)=>[h.tokenId,i<10?0:300]))};
 online.senseiReturnPercent=50;const lower=adventure.advance(structuredClone(data),online,now,true);assert(lower.team.includes('hero-10'),'50% setting returns 60%-rested hero');online.senseiReturnPercent=90;const upper=adventure.advance(structuredClone(data),online,now,true);assert(!upper.team.includes('hero-10'),'90% setting keeps same hero resting');
 online.senseiEnabled=false;const stopped=adventure.advance({...structuredClone(data),last:now-3600000,active:false},online,now,false);assert.equal(stopped.pending,0,'disabled Sensei earns no offline loot');
 const db=new PGlite();await db.exec(fs.readFileSync(path.join(root,'schema.sql'),'utf8'));const pool={query:(s,a)=>db.query(s,a),async connect(){return{query:(s,a)=>db.query(s,a),release(){}}}};let clock=now;const store=new Store(pool,'test-options',()=>clock),wallet='local-test';
 await store.transaction(async c=>{await store.locked(c,wallet);await c.query('UPDATE ryo_accounts SET balance=1000000');await store.profileLocked(c,wallet);await c.query('UPDATE ryo_profiles SET data=$1',[JSON.stringify(make(8))])});
 const oldProfile=await store.profile(wallet);const params={...economy.quote(oldProfile,'fusion',{heroIds:oldProfile.heroes.slice(0,6).map(h=>h.tokenId)}).params,fusionRulesAccepted:1};
 await assert.rejects(store.purchase(wallet,'stale-fusion-request','fusion',{heroIds:params.heroIds},51000,async()=>({signature:'test',wire:'test',lastHeight:99})),/rules changed/);
 crypto.randomInt=(...args)=>args.length===1&&args[0]===100?99:originalRandom(...args);const purchase=await store.purchase(wallet,'new-fusion-request','fusion',params,51000,async()=>({signature:'test-signature',wire:'test',lastHeight:99}));crypto.randomInt=originalRandom;
 assert.equal(purchase.result.fusion.failed,2);assert.equal((await store.profile(wallet)).heroes.length,8,'pending fusion has not yet consumed heroes');
 await assert.rejects(saveSenseiSettings(store,wallet,{returnPercent:50,enabled:true}),/pending purchase/);
 await store.settlePurchase(wallet,'new-fusion-request','confirmed');assert.equal((await store.profile(wallet)).heroes.length,2);assert.equal(await store.balance(wallet),949000);
 await store.settlePurchase(wallet,'new-fusion-request','confirmed');const retry=await store.purchase(wallet,'new-fusion-request','fusion',params,51000,()=>{throw Error('must not reroll')});assert.equal(retry.result.fusion.failed,2);assert.equal(await store.balance(wallet),949000,'retry does not charge or reroll');
 for(const percent of [49,91,NaN,50.5,'50'])await assert.rejects(saveSenseiSettings(store,wallet,{returnPercent:percent,enabled:true}),/50% to 90%/);
 await saveSenseiSettings(store,wallet,{returnPercent:50,enabled:false,active:false});assert.equal((await store.profile(wallet)).senseiEnabled,false);clock+=3600000;
 await saveSenseiSettings(store,wallet,{returnPercent:80,enabled:true,active:false});const saved=await store.profile(wallet);assert.equal(saved.senseiReturnPercent,80);assert.equal(saved.senseiEnabledSince,clock);assert(economy.senseiActive(saved,clock));
 // 500-hero collection limit: summons that would exceed it are refused; fusion frees room.
 const full=n=>make(n);
 assert.equal(economy.quote(full(499),'summon',{quantity:1}).params.quantity,1,'the 500th hero can be summoned');
 assert.throws(()=>economy.quote(full(500),'summon',{quantity:1}),/holds 500 of 500 heroes. Fuse heroes to free 1 slot/);
 assert.throws(()=>economy.quote(full(498),'summon',{quantity:5}),/holds 498 of 500 heroes. Fuse heroes to free 3 slot/);
 assert.equal(economy.quote(full(500),'fusion',{heroIds:ids(full(500))}).product,'fusion','a full collection can still fuse');
 await db.close();console.log('PASS: fusion odds/boundaries, level 10, failure consumption+fees, partial batches, two-hero minimum, persisted idempotent settlement, validated Sensei settings, online/offline thresholds and the 500-hero limit.');
})().catch(e=>{crypto.randomInt=originalRandom;console.error(e);process.exitCode=1});
