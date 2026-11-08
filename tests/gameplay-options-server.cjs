const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../app/server');
const economy=require(path.join(root,'economy.cjs')),{Store}=require(path.join(root,'store.cjs')),adventure=require(path.join(root,'adventure.cjs')),{saveSenseiSettings}=require(path.join(root,'gameplay-options.cjs'));
const make=(n,rank=0,level=1)=>economy.normalizeProfile({upgradeShards:100,dojo:0,sensei:true,heroes:Array.from({length:n},(_,i)=>({tokenId:'hero-'+i,rank,level,name:'Hero '+i,baseStats:{pw:2,sp:2,st:10}})),battleReady:[]});
const ids=p=>p.heroes.slice(0,3).map(h=>h.tokenId),originalRandom=crypto.randomInt;
function roll(value,fn){crypto.randomInt=(...args)=>args.length===1&&args[0]===100?value:originalRandom(...args);try{return fn()}finally{crypto.randomInt=originalRandom}}
(async()=>{
 for(const [rank,chance]of [90,80,70,60].entries()){
  const p=make(5,rank,rank===3?5:1),q=economy.quote(p,'fusion',{heroIds:ids(p)});
  assert.equal(q.fusion.successPercent,chance);assert.equal(q.total,25000);assert.equal(q.params.fusionRulesVersion,1);
  const success=roll(chance-1,()=>economy.fulfill(p,q));assert.equal(success.result.outputs.length,1);assert.equal(success.profile.heroes.length,3);assert.equal(success.result.outputs[0].rank,rank+1);
  const failure=roll(chance,()=>economy.fulfill(p,q));assert.equal(failure.result.outputs.length,0);assert.equal(failure.profile.heroes.length,2);assert.deepEqual(failure.result.consumed,ids(p));assert.equal(failure.result.fusion.failed,1);assert.equal(failure.result.fusion.totalCharged,25000);
  assert.equal(p.heroes.length,5,'quote/fulfillment do not mutate input');
 }
 assert.throws(()=>economy.quote(make(5,3,4),'fusion',{heroIds:ids(make(5))}),/level 5/);
 assert.throws(()=>economy.quote(make(4),'fusion',{heroIds:ids(make(4))}),/two heroes/);
 const ready=make(5);ready.battleReady=ids(ready);assert.throws(()=>economy.quote(ready,'fusion',{heroIds:ids(ready)}),/Reserve/);
 const batch=make(8),bq=economy.quote(batch,'fusion',{heroIds:batch.heroes.slice(0,6).map(h=>h.tokenId)});let rolls=[0,99];crypto.randomInt=(...args)=>args.length===1&&args[0]===100?rolls.shift():originalRandom(...args);const partial=economy.fulfill(batch,bq);crypto.randomInt=originalRandom;assert.equal(partial.result.fusion.succeeded,1);assert.equal(partial.result.fusion.failed,1);assert.equal(partial.profile.heroes.length,3);assert.equal(partial.result.fusion.totalCharged,50000);
 const legacy={...bq};delete legacy.fusion;assert.equal(roll(99,()=>economy.fulfill(batch,legacy)).result.outputs.length,2,'preexisting persisted quotes preserve guaranteed legacy outcomes');
 const now=Date.now(),online=make(12);online.battleReady=online.heroes.map(h=>h.tokenId);const data={map:1,target:0,hp:10000,kills:0,pending:0,claimed:0,last:now-1000,active:false,team:online.battleReady.slice(0,10),energy:Object.fromEntries(online.heroes.map((h,i)=>[h.tokenId,i<10?0:90]))};
 online.senseiReturnPercent=50;const lower=adventure.advance(structuredClone(data),structuredClone(online),now,false);assert(lower.team.includes('hero-10'),'50% setting returns 60%-rested hero');online.senseiReturnPercent=90;const upper=adventure.advance(structuredClone(data),online,now,true);assert(!upper.team.includes('hero-10'),'90% setting keeps same hero resting');
 online.senseiEnabled=false;const stopped=adventure.advance({...structuredClone(data),last:now-3600000,active:false},online,now,false);assert.equal(stopped.pending,0,'disabled Sensei earns no offline loot');
 const db=new PGlite();await db.exec(fs.readFileSync(path.join(root,'schema.sql'),'utf8'));const pool={query:(s,a)=>db.query(s,a),async connect(){return{query:(s,a)=>db.query(s,a),release(){}}}};let clock=now;const store=new Store(pool,'test-options',()=>clock),wallet='local-test';
 await store.transaction(async c=>{await store.locked(c,wallet);await c.query('UPDATE ryo_accounts SET balance=1000000');await store.profileLocked(c,wallet);await c.query('UPDATE ryo_profiles SET data=$1',[JSON.stringify(make(8))])});
 const oldProfile=await store.profile(wallet);const params={...economy.quote(oldProfile,'fusion',{heroIds:oldProfile.heroes.slice(0,6).map(h=>h.tokenId)}).params,fusionRulesAccepted:1};
 await assert.rejects(store.purchase(wallet,'stale-fusion-request','fusion',{heroIds:params.heroIds},50000,async q => require('./sr-revenue-fixture.cjs').stamp(q, {signature:'test',wire:'test',lastHeight:99})),/rules changed/);
 crypto.randomInt=(...args)=>args.length===1&&args[0]===100?99:originalRandom(...args);const purchase=await store.purchase(wallet,'new-fusion-request','fusion',params,50000,async q => require('./sr-revenue-fixture.cjs').stamp(q, {signature:'test-signature',wire:'test',lastHeight:99}));crypto.randomInt=originalRandom;
 assert.equal(purchase.result.fusion.failed,2);assert.equal((await store.profile(wallet)).heroes.length,8,'pending fusion has not yet consumed heroes');
 await assert.rejects(saveSenseiSettings(store,wallet,{returnPercent:50,enabled:true}),/pending purchase/);
 await store.settlePurchase(wallet,'new-fusion-request','confirmed');assert.equal((await store.profile(wallet)).heroes.length,2);assert.equal(await store.balance(wallet),950000);
 await store.settlePurchase(wallet,'new-fusion-request','confirmed');const retry=await store.purchase(wallet,'new-fusion-request','fusion',params,50000,()=>{throw Error('must not reroll')});assert.equal(retry.result.fusion.failed,2);assert.equal(await store.balance(wallet),950000,'retry does not charge or reroll');
 for(const percent of [49,91,NaN,50.5,'50'])await assert.rejects(saveSenseiSettings(store,wallet,{returnPercent:percent,enabled:true}),/50% to 90%/);
 await saveSenseiSettings(store,wallet,{returnPercent:50,enabled:false,active:false});assert.equal((await store.profile(wallet)).senseiEnabled,false);clock+=3600000;
 await saveSenseiSettings(store,wallet,{returnPercent:80,enabled:true,active:false});const saved=await store.profile(wallet);assert.equal(saved.senseiReturnPercent,80);assert.equal(saved.senseiEnabledSince,clock);assert(economy.senseiActive(saved,clock));
 // 500-hero collection limit: summons that would exceed it are refused; fusion frees room.
 const full=n=>make(n);
 assert.equal(economy.quote(full(499),'summon',{quantity:1}).params.quantity,1,'the 500th hero can be summoned');
 assert.throws(()=>economy.quote(full(500),'summon',{quantity:1}),/holds 500 of 500 heroes. Fuse heroes to free 1 slot/);
 assert.throws(()=>economy.quote(full(498),'summon',{quantity:5}),/holds 498 of 500 heroes. Fuse heroes to free 3 slot/);
 assert.equal(economy.quote(full(500),'fusion',{heroIds:ids(full(500))}).product,'fusion','a full collection can still fuse');
 // Combat protocol, finite chakra and immediate rewards are covered by combat-adventure.cjs and realtime-rewards-guard.cjs.
 // Training: max level 5. Genin/Chunin gain +1 Power per level-up, Jonin/Elite/Legend a random +1
 // (server-rolled), and Lv4→5 gives two +1s. Prices are per step × rank, plus the 2% studio fee.
 {
  const go=require(path.join(root,'gameplay-options.cjs')),stats=(values,fn)=>{crypto.randomInt=(...a)=>a.length===1&&a[0]===3?values.shift():originalRandom(...a);try{return fn()}finally{crypto.randomInt=originalRandom}};
  const hero=(p,id)=>p.heroes.find(h=>h.tokenId===id);
  for(const rank of [0,1,2,3,4])assert.deepEqual([1,2,3,4].map(l=>go.trainingPrice(rank,l)),[10000,20000,40000,80000].map(n=>n*[1,1.5,2,2.5,3][rank]),'price table for rank '+rank);
  for(const rank of [0,1]){
   let p=make(3,rank,1);
   for(let level=1;level<5;level++){
    const q=economy.quote(p,'training',{heroId:'hero-0'});
    assert.equal(q.base,go.trainingPrice(rank,level));assert.equal(q.total,q.base,'the full approved SR price is distributed');assert.deepEqual([q.treasury,q.operations,q.burn,q.studioFee].map(n=>n*100/q.base),[10,80,8,2],'beta retains its original economy');assert.equal(q.revenueDistribution,undefined);
    const r=economy.fulfill(p,q);p=r.profile;
    assert.deepEqual(r.result.training,{heroId:'hero-0',level:level+1,gains:{pw:level===4?2:1}},'Genin/Chunin gain Power ('+level+'→'+(level+1)+')');
   }
   assert.deepEqual(hero(p,'hero-0').bonus,{pw:5,sp:0,st:0});assert.equal(hero(p,'hero-0').level,5);
   assert.throws(()=>economy.quote(p,'training',{heroId:'hero-0'}),/below level 5/,'level 5 is the maximum');
  }
  let p=make(3,2,1);const gains=[];
  for(const rolls of [[1],[2],[0],[1,1]]){const r=stats(rolls,()=>economy.fulfill(p,economy.quote(p,'training',{heroId:'hero-0'})));p=r.profile;gains.push(r.result.training.gains)}
  assert.deepEqual(gains,[{sp:1},{st:1},{pw:1},{sp:2}],'Jonin+ gain a random stat; both Lv5 rolls may land on the same stat');
  assert.deepEqual(hero(p,'hero-0').bonus,{pw:1,sp:3,st:1});
  const elite=make(3,3,4),split=stats([0,2],()=>economy.fulfill(elite,economy.quote(elite,'training',{heroId:'hero-0'})));
  assert.deepEqual(split.result.training.gains,{pw:1,st:1},'the two Lv5 rolls may land on different stats');
  // An order quoted before the hero reached level 5 never trains past it.
  const late=make(3,0,4),order=economy.quote(late,'training',{heroId:'hero-0'});const done=economy.fulfill(late,order).profile;
  assert.throws(()=>economy.fulfill(done,order),/rules or hero level changed/,'stale training cannot consume another shard');
  // Heroes trained under the old 10-level system: kept up to Lv5 with the +1s those levels now give.
  const old=economy.normalizeProfile({dojo:0,heroes:[{tokenId:'old-jonin',rank:2,level:7,name:'J',baseStats:{pw:7,sp:7,st:7}},{tokenId:'old-genin',rank:0,level:3,name:'G',baseStats:{pw:2,sp:2,st:2}},{tokenId:'new-genin',rank:0,level:1,name:'N',baseStats:{pw:2,sp:2,st:2}},{tokenId:'old-elite',rank:3,level:10,name:'E',baseStats:{pw:10,sp:10,st:10}}]});
  const j=hero(old,'old-jonin');assert.equal(j.level,5);assert.equal(j.bonus.pw+j.bonus.sp+j.bonus.st,5,'a Lv7 Jonin becomes Lv5 with five +1s');
  assert.deepEqual(economy.normalizeProfile(structuredClone(old)).heroes,old.heroes,'converted rolls never change on a later read');
  assert.deepEqual(hero(old,'old-genin').bonus,{pw:2,sp:0,st:0});assert.deepEqual(hero(old,'new-genin').bonus,{pw:0,sp:0,st:0});assert.equal(hero(old,'old-elite').level,5,'a Lv10 Elite becomes a fusion-ready Lv5');
  assert.deepEqual(go.trainedStats(j),{pw:7+j.bonus.pw,sp:7+j.bonus.sp,st:7+j.bonus.st},'battle stats are base + training');
 }
 // Identity: perks (rank+1 distinct from the game's pool, Piercing only above Genin) and look (0-7) are
 // server-owned. Old heroes get a permanent roll from the token id; summons and fusions roll their own.
 {
  const go=require(path.join(root,'gameplay-options.cjs'));
  const old=economy.normalizeProfile({dojo:0,heroes:[0,1,2,3,4].map(r=>({tokenId:'ident-'+r,rank:r,level:1,name:'I'+r,baseStats:{pw:5,sp:5,st:5}}))});
  for(const h of old.heroes){assert.equal(h.perks.length,h.rank+1);assert.equal(new Set(h.perks).size,h.perks.length,'perks are distinct');assert(h.perks.every(k=>[0,1,2,3,4,5,6].includes(k)));assert(Number.isInteger(h.look)&&h.look>=0&&h.look<8);}
  assert.deepEqual(economy.normalizeProfile(structuredClone(old)).heroes,old.heroes,'old heroes keep the same perks and look on every read');
  const summoned=economy.fulfill(old,economy.quote(old,'summon',{quantity:5})).result.outputs;
  assert(summoned.every(h=>h.identityVersion===2&&h.perks.length===h.rank+1&&Number.isInteger(h.look)),'summons roll their own identity');
  const fuse=make(5,0,1);const fused=roll(0,()=>economy.fulfill(fuse,economy.quote(fuse,'fusion',{heroIds:ids(fuse)}))).result.outputs[0];
  assert.equal(fused.perks.length,2,'a fused Chunin gets two perks');assert(Number.isInteger(fused.look));
  assert.deepEqual(go.rollIdentity(4,()=>0),{perks:[0,1,2,3,4],look:0});
 }
 await db.close();console.log('PASS: fusion odds/boundaries, level 5 Elites, training (+1 Power / random +1, double at Lv5, prices, conversion), failure consumption+fees, partial batches, two-hero minimum, persisted idempotent settlement, validated Sensei settings, online/offline thresholds, the 500-hero limit and verified Adventure kill reports.');
})().catch(e=>{crypto.randomInt=originalRandom;console.error(e);process.exitCode=1});
