'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{PGlite}=require('@electric-sql/pglite');
const R=require('../app/server/hero-upgrade-rules.cjs'),H=require('../app/server/hero-upgrades.cjs'),E=require('../app/server/economy.cjs'),C=require('../app/server/combat-chakra.cjs'),B=require('../app/server/combat-rules.cjs'),{Store}=require('../app/server/store.cjs');
const hero=(id,rank=0)=>({tokenId:id,rank,level:1,name:'Hero '+id,trainingVersion:2,baseStats:{pw:rank===5?18:2,sp:rank===5?18:2,st:rank===5?18:2},bonus:{pw:0,sp:0,st:0},perks:[3],look:1});
const profile=(shards=100)=>E.normalizeProfile({upgradeShards:shards,dojo:0,heroes:Array.from({length:6},(_,r)=>hero('rank-'+r,r)),battleReady:[]});
const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
(async()=>{
 assert.deepEqual(R.SHARDS,[1,2,3,4,5,7]);
 for(let tier=0;tier<7;tier++)for(const fast of [false,true]){const h=hero('recover');h.perks=fast?[3]:[];h.chakra={version:1,value:0,at:1000,nextAt:1000,resting:true};close(B.recovery(h,tier)*60,B.DOJO[tier]+(fast?.5:0));close(C.recover(h,61000,tier).value,B.DOJO[tier]+(fast?.5:0));close(C.recover(h,61000,tier).value,B.DOJO[tier]+(fast?.5:0));}
 assert.equal(E.normalizeProfile({dojo:0,heroes:[],upgradeShards:-1}).upgradeShards,0);
 for(let rank=0;rank<6;rank++){
  const p=profile(0),q=structuredClone(p);assert.throws(()=>E.quote(p,'training',{heroId:'rank-'+rank}),/Upgrade Shard/);
  const result=H.salvageProfile(q,'rank-'+rank,1000);assert.equal(result.shards,R.SHARDS[rank]);assert.equal(q.upgradeShards,R.SHARDS[rank]);assert(!q.heroes.some(h=>h.tokenId===result.heroId));assert.equal(p.heroes.length,6);
  p.upgradeShards=100;const quote=E.quote(p,'training',{heroId:'rank-'+rank}),before=structuredClone(p.heroes[rank]),done=E.fulfill(p,quote);
  assert.equal(quote.training.shards,R.SHARDS[rank]);assert.equal(quote.params.upgradeRulesVersion,1);assert.equal(done.profile.upgradeShards,100-R.SHARDS[rank]);assert.equal(done.profile.heroes[rank].level,2);assert.deepEqual(done.profile.heroes[rank].perks,before.perks);assert.equal(p.upgradeShards,100);
  assert.equal(quote.total,R.trainingPrice(rank,1));assert.throws(()=>E.fulfill(done.profile,quote),/rules or hero level changed/);
 }
 assert.deepEqual([1,2,3,4].map(l=>R.trainingPrice(5,l)),[60000,120000,240000,480000]);
 const db=new PGlite();await db.exec(fs.readFileSync(path.join(__dirname,'../app/server/schema.sql'),'utf8'));
 let tail=Promise.resolve();const pool={query:(q,a)=>db.query(q,a),async connect(){let release;const prior=tail;tail=new Promise(r=>release=r);await prior;return {query:(q,a)=>db.query(q,a),release};}};
 let now=1700000000000;const store=new Store(pool,'shards-test',()=>now),wallet='owner',save=async p=>{await pool.query('INSERT INTO ryo_profiles(scope,wallet,data) VALUES($1,$2,$3) ON CONFLICT(scope,wallet) DO UPDATE SET data=$3',[store.scope,wallet,JSON.stringify(p)]);};
 await store.transaction(async c=>{await store.locked(c,wallet);await c.query('UPDATE ryo_accounts SET balance=2000000 WHERE scope=$1 AND wallet=$2',[store.scope,wallet]);});
 await save(profile(0));const req={heroId:'rank-4',requestId:'salvage-legend-0001',salvageRulesVersion:1};
 const receipts=await Promise.all([H.salvage(store,wallet,req),H.salvage(store,wallet,req)]);assert.deepEqual(receipts[0],receipts[1]);assert.equal((await store.profile(wallet)).upgradeShards,5);assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_hero_salvages')).rows[0].n),1);
 await assert.rejects(()=>H.salvage(store,wallet,{...req,heroId:'rank-0'}),/another hero/);
 await assert.rejects(()=>H.salvage(store,wallet,{...req,requestId:'same-hero-new-request'}),/owned/);assert.equal((await store.profile(wallet)).upgradeShards,5,'a fresh request ID cannot salvage an already removed hero');
 await assert.rejects(()=>H.salvage(store,'other-wallet',{...req,requestId:'foreign-hero-0001',heroId:'rank-5'}),/owned/);
 const p=await store.profile(wallet);p.heroes.find(h=>h.rank===5).nft={mint:'verified-nft'};await save(p);await assert.rejects(()=>H.salvage(store,wallet,{...req,heroId:'rank-5',requestId:'salvage-nft-0001'}),/NFT-bound/);
 const locked=p.heroes[0];locked.chakra={version:1,value:50,at:now,nextAt:now,resting:false,lockUntil:now+60000};await save(p);await assert.rejects(()=>H.salvage(store,wallet,{...req,heroId:locked.tokenId,requestId:'salvage-hunt-0001'}),/Boss Hunt/);
 await assert.rejects(()=>H.salvage({pool:{query:async()=>({rows:[{pauses:{purchases:true}}]})}},wallet,{...req,requestId:'paused-salvage-0001'}),/paused/);
 // Actual pending payment path: shards stay reserved in the snapshot until confirmation.
 await save(profile(30));const q=E.quote(await store.profile(wallet),'training',{heroId:'rank-5'}),prepare=async()=>({signature:'fixture-signature-'+(serial++),wire:'fixture-wire',lastHeight:50});
 await assert.rejects(()=>store.purchase(wallet,'old-client-0001','training',{heroId:'rank-5'},q.total,prepare),/Refresh and review/);
 await assert.rejects(()=>store.purchase(wallet,'unaccepted-0001','training',q.params,q.total,prepare),/Refresh and review/,'a cached client cannot pass through quote metadata as consent');
 let serial=0;const balance=await store.balance(wallet);await store.purchase(wallet,'train-mythic-0001','training',{...q.params,upgradeRulesAccepted:1},q.total,prepare);assert.equal((await store.profile(wallet)).upgradeShards,30);await assert.rejects(()=>store.purchase(wallet,'second-training-0001','training',{...q.params,upgradeRulesAccepted:1},q.total,prepare),/pending token purchase/);
 await assert.rejects(()=>H.salvage(store,wallet,{...req,requestId:'pending-salvage-0001',heroId:'rank-0'}),/pending purchase/);
 const current=await store.profile(wallet);current.heroes[5].chakra={version:1,value:123,at:now,nextAt:now,resting:true};await save(current);
 await store.settlePurchase(wallet,'train-mythic-0001','confirmed');const trained=await store.profile(wallet);assert.equal(trained.upgradeShards,23);assert.equal(trained.heroes[5].level,2);assert.equal(trained.heroes[5].chakra.value,123);assert.equal(await store.balance(wallet),balance-60000);
 await store.settlePurchase(wallet,'train-mythic-0001','confirmed');assert.equal((await store.profile(wallet)).upgradeShards,23);
 const next=E.quote(trained,'training',{heroId:'rank-5'});await store.purchase(wallet,'train-refund-0001','training',{...next.params,upgradeRulesAccepted:1},next.total,prepare);await store.settlePurchase(wallet,'train-refund-0001','refunded');assert.equal((await store.profile(wallet)).upgradeShards,23);assert.equal((await store.profile(wallet)).heroes[5].level,2);assert.equal(await store.balance(wallet),balance-60000);
 await assert.rejects(()=>store.purchase(wallet,'prepare-failed-0001','training',{...next.params,upgradeRulesAccepted:1},next.total,async()=>{throw Error('fee unavailable')}),/fee unavailable/);assert.equal((await store.profile(wallet)).upgradeShards,23);assert.equal(await store.balance(wallet),balance-60000);
 // A pre-release pending order retains its agreed Ryo-only terms and cannot reset shard inventory.
 await store.purchase(wallet,'legacy-order-0001','training',{...next.params,upgradeRulesAccepted:1},next.total,prepare);await pool.query("UPDATE ryo_purchases SET quote=quote-'training',profile_after=profile_after-'upgradeShards' WHERE scope=$1 AND request_id=$2",[store.scope,'legacy-order-0001']);await store.settlePurchase(wallet,'legacy-order-0001','confirmed');assert.equal((await store.profile(wallet)).upgradeShards,23);
 await db.close();console.log('PASS: additive 1/min recovery plus Fast Charge 0.5 and Dojo; six-rank 1/2/3/4/5/7 shards, Mythic double prices, atomic salvage/replay/ownership/NFT/hunt/pause protection, confirmed-only shard use, refund/fee rollback and legacy pending compatibility.');
})().catch(e=>{console.error(e);process.exitCode=1});
