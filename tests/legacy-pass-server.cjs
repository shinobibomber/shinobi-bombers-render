'use strict';
process.env.SHINOBI_LEGACY_PASS='on';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),{fixture,E,L,R,Store,web3}=require('./legacy-fixture.cjs');
const C=require('../app/server/combat-chakra.cjs'),B=require('../app/server/combat-rules.cjs'),A=require('../app/server/combat-adventure.cjs');
const near=(a,b)=>assert(Math.abs(a-b)<1e-6,`${a} != ${b}`);
(async()=>{
 const f=await fixture(),{store,wallet,other,pool}=f;
 try{
  assert.equal(R.week(Date.parse('2026-11-08T23:59:59.999Z')).id,'2026-11-02');assert.equal(R.week(Date.parse('2026-11-09T00:00:00Z')).id,'2026-11-09');
  assert.deepEqual(R.ODDS,{Elite:70,Legend:30});assert.deepEqual([R.premiumRank(0),R.premiumRank(6999),R.premiumRank(7000),R.premiumRank(9999)],[3,3,4,4]);
  const all={kills:30,stages:10,recovery:60,attacks:50,heroes:['one','two','three'],hunts:1};assert(R.missions(all).every(m=>m.done));assert.equal(R.xp(all),100,'six completed missions still cap at 100 XP');
  assert.throws(()=>R.premiumRank(10000));assert.throws(()=>R.premiumRank(-1));
  const counts={3:0,4:0};for(let i=0;i<100000;i++)counts[R.premiumRank(crypto.randomInt(10000))]++;assert(Math.abs(counts[3]-70000)<1000,'100,000 independent CSPRNG outcomes fit 70/30 within a conservative statistical bound');
  for(const [roll,rank,perks]of [[0,3,4],[9999,4,5]]){const h=L.rollHero(()=>roll);assert.equal(h.rank,rank);assert.equal(new Set(h.perks).size,perks);assert(h.accountBound&&h.legacyPassReward&&h.referralReward);assert.equal(h.level,1);}
  await assert.rejects(L.select(store,other,1),/Hold the registered/);await assert.rejects(L.claim(store,other,{serial:1,milestone:20}),/Hold the registered/);
  f.network=false;await assert.rejects(L.select(store,wallet,1),/network/);f.network=true;f.rpc=false;await assert.rejects(L.select(store,wallet,1),/RPC/);f.rpc=true;
  await L.select(store,wallet,1);assert.equal((await L.status(store,wallet)).xp,0);assert(f.calls.every(c=>c==='finalized'));
  await assert.rejects(L.claim(store,wallet,{serial:1,milestone:100,xp:100,progress:{kills:999}}),/Complete more/);
  // Trusted callback sees accepted actions and kills only; client stage/kill floods are not proof.
  let p=await store.profile(wallet);p.battleReady=p.heroes.map(h=>h.tokenId);const id=p.heroes[0].tokenId,events=[];
  const report=(n,k=0)=>({combatVersion:1,combatSeq:n+1,killSession:'legacy-session',killStage:999999,deployed:[id],combatHeroes:[{id,attacks:n,kills:[k,0,0,0,0]}]});
  let d=A.advance(null,p,f.now,true,60,report(0),null,e=>events.push(e));f.now+=10000;d=A.advance(d,p,f.now,true,60,report(100000,10000),null,e=>events.push(e));assert(events.filter(e=>e.kind==='attacks').reduce((n,e)=>n+e.quantity,0)<50);assert(!events.some(e=>e.kind==='stages'));
  const n=events.length;A.advance(d,p,f.now,true,60,report(100000,10000),null,e=>events.push(e));assert.equal(events.length,n,'replayed attacks produce no mission events');
  const offline=f.profile(10);offline.battleReady=offline.heroes.map(h=>h.tokenId);offline.sensei=true;offline.dojo=6;const stages=[];let od=A.advance(null,offline,f.now,false);od=A.advance(od,offline,f.now+3600000,false,60,null,null,e=>{if(e.kind==='stages')stages.push(e);});assert(stages.length>0,'server-simulated stage clears emit proof');assert.equal(stages.length,Math.floor(od.kills/20));
  // Natural recovery tracks actual capped gain, and cannot repeat the same minute.
  const h=E.hero(3);h.chakra={version:1,value:0,at:f.now,nextAt:f.now,resting:true};const rate=B.recovery(h,0,true)*60;C.recover(h,f.now+60000,0);near(h.chakra.legacyRecovered,rate);C.recover(h,f.now+60000,0);near(h.chakra.legacyRecovered,rate);h.chakra.value=B.maxChakra(h);C.recover(h,f.now+120000,0);near(h.chakra.legacyRecovered,rate);
  await f.complete(1);let state=await L.status(store,wallet);assert.equal(state.xp,100);assert.equal(state.missions.filter(m=>m.done).length,5);assert.equal(state.missions.find(m=>m.id==='stages').value,0);
  const beforeShards=(await store.profile(wallet)).upgradeShards;
  const receipts=await Promise.all([L.claim(store,wallet,{serial:1,milestone:20}),L.claim(store,wallet,{serial:1,milestone:20})]);assert(receipts[1].alreadyClaimed);assert.equal((await store.profile(wallet)).upgradeShards,beforeShards+1);
  for(const milestone of [40,60,80,100])await L.claim(store,wallet,{serial:1,milestone});state=await L.status(store,wallet);assert.equal(state.fragments,1);assert.equal((await store.profile(wallet)).upgradeShards,beforeShards+3);assert.equal(state.items.length,2);assert(state.items.every(i=>Number(i.expires)===f.now+R.EXPIRY));
  await assert.rejects(L.redeem(store,wallet,{requestId:'insufficient-fragments-01'}),/Two Premium/);
  // One event cannot progress two NFT passes after switching.
  await f.events([{id:'shared-activity',kind:'kills',quantity:1}]);await L.select(store,wallet,2);await f.events([{id:'shared-activity',kind:'kills',quantity:30}]);assert.equal((await L.status(store,wallet)).missions.find(m=>m.id==='kills').value,0);
  await f.events([{id:'old-week-proof',kind:'kills',quantity:30,at:R.week(f.now).start-1}]);assert.equal((await L.status(store,wallet)).xp,0);
  // Transferring an NFT cannot duplicate its weekly claims; its earned fragment stays with Alice.
  f.held.set(wallet,[f.mints[1]]);f.held.set(other,[f.mints[0]]);await assert.rejects(L.claim(store,wallet,{serial:1,milestone:100}),/Hold/);await L.select(store,other,1);assert((await L.claim(store,other,{serial:1,milestone:100})).alreadyClaimed);assert.equal((await L.status(store,other)).fragments,0);assert.equal((await L.status(store,wallet)).fragments,1);
  f.now=R.week(f.now).reset;await L.select(store,other,1);assert.equal((await L.status(store,other)).xp,0);assert.equal((await L.status(store,wallet)).fragments,1,'fragments persist through reset and new sessions');
  const nextHeroes=(await store.profile(other)).heroes.slice(0,3);await f.events([{id:'next-week-kills',kind:'kills',quantity:30},{id:'next-week-recovery',kind:'recovery',quantity:60},{id:'next-week-hunt',kind:'hunts',quantity:1},...nextHeroes.map((h,i)=>({id:'next-week-actions-'+i,kind:'attacks',quantity:20,heroId:h.tokenId}))],other);await L.claim(store,other,{serial:1,milestone:100});assert.equal((await L.status(store,other)).fragments,1,'the new owner may earn a new fragment in a future week');assert.equal((await L.status(store,wallet)).fragments,1,'the prior owner retains the already claimed fragment');
  // Different network scopes have entirely separate records even for the same public key.
  const main=new Store(pool,'mainnet-legacy-fixture',()=>f.now);L.setContext(main,f.context);assert.equal((await L.status(main,wallet)).fragments,0);assert.equal((await L.status(main,wallet)).nfts.length,0);
  // Permanent idempotent outcome, exact two-fragment debit, no payment or pool mutation.
  await f.fragments(1);const accountBefore=await store.balance(wallet),purchaseBefore=Number((await pool.query('SELECT COUNT(*) n FROM ryo_purchases')).rows[0].n),profilesBefore=(await store.profile(wallet)).heroes.length;
  const request={requestId:'premium-race-request-01',rank:5,random:0},[a,b]=await Promise.all([L.redeem(store,wallet,request),L.redeem(store,wallet,request)]);assert.equal(a.hero.tokenId,b.hero.tokenId);assert.equal(a.status,'delivered');assert([3,4].includes(a.hero.rank));assert.equal((await L.status(store,wallet)).fragments,0);assert.equal((await store.profile(wallet)).heroes.length,profilesBefore+1);assert.equal(await store.balance(wallet),accountBefore);assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM ryo_purchases')).rows[0].n),purchaseBefore);
  await assert.rejects(L.redeem(store,wallet,{requestId:'premium-race-request-02'}),/Two Premium/);
  const bound=(await store.profile(wallet)).heroes.find(h=>h.tokenId===a.hero.tokenId);
  const hp=await store.profile(wallet);assert.throws(()=>require('../app/server/hero-upgrades.cjs').salvageProfile(hp,bound.tokenId,f.now),/account-bound/);
  await assert.rejects(require('../app/server/market.cjs').handle(store,wallet,'market-post',{heroId:bound.tokenId,price:1000000}),/bound/);
  const fusion=f.profile(5);fusion.heroes.slice(0,3).forEach(h=>{h.rank=2;});Object.assign(fusion.heroes[0],{accountBound:true,legacyPassReward:true,referralReward:true});const fq=E.quote(fusion,'fusion',{heroIds:fusion.heroes.slice(0,3).map(h=>h.tokenId)});fq.fusion.successPercent=100;const fused=E.fulfill(fusion,fq).result.outputs[0];assert(fused.accountBound&&fused.legacyPassReward&&fused.referralReward);
  assert.throws(()=>require('../app/server/creators-portal.cjs').paidSummonQuantity({product:'summon',params:{quantity:1},signature:'fixture',wire:'wire',result:{outputs:[bound]}}),/inconsistent/);
  // Queue remains a fixed roll when full, and survives retries until collection space is free.
  await f.save(f.profile(500));await f.fragments(2);const queued=await L.redeem(store,wallet,{requestId:'full-collection-request'});assert.equal(queued.status,'queued');assert.equal((await L.status(store,wallet)).fragments,0);assert.equal((await L.deliver(store,wallet,{requestId:queued.request_id})).hero.tokenId,queued.hero.tokenId);
  const full=await store.profile(wallet);full.heroes.pop();await f.save(full);const delivered=await L.deliver(store,wallet,{requestId:queued.request_id});assert.equal(delivered.status,'delivered');assert.equal(delivered.hero.tokenId,queued.hero.tokenId);assert.equal((await store.profile(wallet)).heroes.length,500);await assert.rejects(L.deliver(store,other,{requestId:queued.request_id}),/owned/);
  // Exercise the actual Adventure transaction hook, not just the optional pure callback.
  const real=f.profile();real.battleReady=real.heroes.map(h=>h.tokenId);await f.save(real);await L.select(store,wallet,2);
  const adv=require('../app/server/adventure.cjs'),realReport=(seq,n)=>({combatVersion:1,combatSeq:seq,killSession:'legacy-real-session',killStage:99999,deployed:real.battleReady,combatHeroes:real.heroes.map(h=>({id:h.tokenId,attacks:n,kills:[Math.floor(n/10),0,0,0,0]}))});
  await adv.adventure(store,wallet,{active:true,report:realReport(1,0)},0);f.now+=30000;await adv.adventure(store,wallet,{active:true,report:realReport(2,20)},0);
  const progress=await L.status(store,wallet);assert(progress.missions.find(m=>m.id==='attacks').value>0);assert.equal(progress.missions.find(m=>m.id==='command').value,3);assert.equal(progress.missions.find(m=>m.id==='stages').value,0);
  const ledgerCount=Number((await pool.query('SELECT COUNT(*) n FROM ryo_legacy_events')).rows[0].n);await adv.adventure(store,wallet,{active:true,report:realReport(2,20)},0);assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM ryo_legacy_events')).rows[0].n),ledgerCount,'HTTP-style Adventure replays cannot issue extra XP evidence');
  // Feature and existing launch emergency controls remain server enforced.
  process.env.REWARD_CLAIMS_ENABLED='off';await assert.rejects(L.handle(store,wallet,'legacy-redeem',{requestId:'blocked-by-launch-gate'}),/official launch/);delete process.env.REWARD_CLAIMS_ENABLED;
  process.env.PRELAUNCH_MODE='on';assert(!L.enabled());await assert.rejects(L.handle(store,wallet,'legacy-status'),/not enabled/);delete process.env.PRELAUNCH_MODE;
  // New actions remain behind the real signed-wallet session gate; no event-upload API exists.
  const {createService,GENESIS}=require('../app/server/service.cjs'),authKey=web3.Keypair.generate(),authWallet=authKey.publicKey.toBase58();
  const service=createService({store,connection:{...f.connection,async getGenesisHash(){return GENESIS;}},treasury:web3.Keypair.generate(),mint:web3.Keypair.generate().publicKey.toBase58(),studioAddress:web3.Keypair.generate().publicKey.toBase58(),revenueAddress:web3.Keypair.generate().publicKey.toBase58(),origin:'https://legacy.example.invalid'});
  await assert.rejects(service.handle('legacy-claim',{serial:1,milestone:100},'forged-session'),e=>e.status===401);
  const challenge=await service.handle('challenge',{wallet:authWallet}),privateKey=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(authKey.secretKey.slice(0,32))]),format:'der',type:'pkcs8'}),signature=crypto.sign(null,Buffer.from(challenge.message),privateKey).toString('base64');
  const session=await service.handle('login',{wallet:authWallet,nonce:challenge.nonce,signature});await assert.rejects(service.handle('legacy-claim',{serial:1,milestone:100,xp:100},session.token),/Hold the registered/);await assert.rejects(service.handle('legacy-record',{events:[{kind:'kills',quantity:99999}]},session.token),/Unknown Legacy/);
  assert(f.calls.every(c=>c==='finalized'));
  console.log('PASS: Legacy Pass ownership/network checks, six missions and XP cap, real combat callbacks/replay, capped recovery, weekly serial claims/transfers, event deduplication, persistent scoped fragments, 100,000 CSPRNG 70/30 draws, atomic premium replay/queue, permanent Market/salvage/fusion binding, zero payment revenue and launch gates.');
 }finally{await f.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
