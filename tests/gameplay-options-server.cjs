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
 // Adventure kill reports: the server pays the battle's reported kills within the heroes' damage.
 {
  const team=make(5,4,10);team.heroes.forEach(h=>h.baseStats={pw:15,sp:15,st:15});team.battleReady=team.heroes.map(h=>h.tokenId);const t0=1_900_000_000_000,report=(totals,stage=1,id='session-aaaa-1111')=>({killSession:id,killTotals:totals,killStage:stage});
  let d=adventure.advance(undefined,team,t0,true,60,report([0,0,0,0,0,0,0,0]));
  d=adventure.advance(d,team,t0+5000,true,60,report([3,0,1,0,0,0,1,0]));
  assert.equal(d.reportedKills,5,'every reported kill within budget is credited');
  assert.equal(d.pending,3*Math.floor(35625*.6)+Math.floor(81250*.6)+Math.floor(812500*.6),'paid at the server tier table and loot rate');
  const paid=d.pending;d=adventure.advance(d,team,t0+10000,true,60,report([3,0,1,0,0,0,1,0]));
  assert.equal(d.reportedKills,5,'replaying the same totals pays nothing more');
  d=adventure.advance(d,team,t0+15000,true,60,report([3,1,1,0,0,0,1,0]));
  assert.equal(d.pending-paid>=Math.floor(35625*.6*1.15),true,'the Fortune bonus pays 15% more');
  // Fabricated totals are capped by the damage the team could deal, then wait for more budget.
  const before=d.reportedKills;d=adventure.advance(d,team,t0+20000,true,60,report([3,1,1,0,0,0,100000,0]));
  const capacity=team.heroes.reduce((n,h)=>n+5/(Math.max(.6,1.6-h.baseStats.sp*.05)*.85)*(h.rank+1)*(h.baseStats.pw+1),0)*1.5+4000;
  assert(((d.reportedKills-before)*1625)<=capacity,'a fake diamond flood is limited to the team damage');
  assert(d.reportedKills-before<100000,'most of the fake kills are not paid');
  // Malformed reports fall back to the server's own battle; under-reported stages are floored.
  assert.equal(require(path.join(root,'gameplay-options.cjs')).killReport({killSession:'x',killTotals:[1]}),null);
  const floor=adventure.advance({...structuredClone(d),reportedKills:25000},team,t0+25000,true,60,report([3,1,1,0,0,0,100000,0],1));
  assert(floor.map>=251,'a client cannot report stage 1 to dodge the payout taper');
 }
 // Trained heroes: level 10 lifts each stat from its base to the rank's top, so the battle kills far
 // faster than base stats suggest, and fights on after base stamina would be spent. Each sync must
 // credit every kill made so far, not queue them for later.
 {
  const team=make(10,0,10);team.heroes.forEach(h=>h.baseStats={pw:1,sp:1,st:1});team.battleReady=team.heroes.map(h=>h.tokenId);
  const t0=1_900_000_000_000,clientDps=10*3/(1.6-3*.05),report=k=>({killSession:'trained-genin-1',killTotals:[k,0,0,0,0,0,0,0],killStage:1});
  let d=adventure.advance(undefined,team,t0,true,60,report(0)),behind=0;
  for(let t=1500;t<=210000;t+=1500){const kills=Math.floor(t/1000*clientDps/100);d=adventure.advance(d,team,t0+t,true,60,report(kills));behind=Math.max(behind,kills-(d.reportedKills||0))}
  assert.equal(behind,0,'trained heroes have every kill credited on the sync right after it');
  assert(require(path.join(root,'gameplay-options.cjs')).teamDps(team.heroes)>=clientDps,"the budget covers the battle's trained damage");
 }
 await db.close();console.log('PASS: fusion odds/boundaries, level 10, failure consumption+fees, partial batches, two-hero minimum, persisted idempotent settlement, validated Sensei settings, online/offline thresholds, the 500-hero limit and verified Adventure kill reports.');
})().catch(e=>{crypto.randomInt=originalRandom;console.error(e);process.exitCode=1});
