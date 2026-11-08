'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), cp = require('../app/server/creators-portal.cjs'), player = require('../app/server/player-referrals.cjs');
const adventure = require('../app/server/adventure.cjs'), { createService, GENESIS } = require('../app/server/service.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
(async () => {
 const db = new PGlite(), schema = fs.readFileSync(path.join(__dirname,'../app/server/schema.sql'),'utf8'); await db.exec(schema); await db.exec(schema);
 let tail=Promise.resolve(), failed=false, now=Date.UTC(2026,10,7,12), serial=0;
 const lock=async()=>{let release;const before=tail;tail=new Promise(r=>release=r);await before;return release};
 const q=async(s,a)=>{if(failed&&s.startsWith('UPDATE ryo_profiles SET data')){failed=false;throw Error('fixture profile failure')}return db.query(s,a)};
 const pool={async query(s,a){const release=await lock();try{return await q(s,a)}finally{release()}},async connect(){const release=await lock();return{query:q,release}}};
 const store=new Store(pool,'player-fixture',()=>now), other=new Store(pool,'other-scope',()=>now), origin='https://shinobi.example';
 const call=(wallet,action,body={})=>cp.handle({store,origin},wallet,action,body), rows=async(s,a=[]) =>(await pool.query(s,[store.scope,...a])).rows;
 async function register(wallet) {await store.transaction(async c=>{await store.locked(c,wallet);await store.profileLocked(c,wallet);const heroes=Array.from({length:10},(_,i)=>({tokenId:wallet+'-'+i,rank:4,level:1,trainingVersion:2,identityVersion:1,perks:[],look:0,baseStats:{pw:14,sp:14,st:14},bonus:{pw:0,sp:0,st:0}}));await c.query('UPDATE ryo_accounts SET balance=100000000 WHERE scope=$1 AND wallet=$2',[store.scope,wallet]);await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[store.scope,wallet,JSON.stringify({heroes,battleReady:heroes.map(h=>h.tokenId),dojo:0,sensei:false})])})}
 async function summon(wallet,quantity=1,funding='balance',status='confirmed'){if(funding==='bonus')await pool.query('UPDATE ryo_accounts SET bonus=10000000 WHERE scope=$1 AND wallet=$2',[store.scope,wallet]);now++;const id=crypto.randomUUID();const order=await store.purchase(wallet,id,'summon',{quantity},quantity*25000,async q => require('./sr-revenue-fixture.cjs').stamp(q, {signature:'fixture-'+(++serial),wire:'fixture-wire',lastHeight:100}));await store.settlePurchase(wallet,id,status);return order}
 async function progress(wallet,target=100){const report=await require('./combat-report-fixture.cjs').driver(store,wallet,()=>now);let steps=0;await adventure.adventure(store,wallet,{active:true,report:report()},1e12);while(Number((await rows('SELECT proof FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2',[wallet]))[0].proof.kills)<target){now+=5000;await adventure.adventure(store,wallet,{active:true,report:report()},1e12);assert(++steps<120,'verifier progresses')}}
 try {
  const owner=address(), invitee=address(), admin=address();process.env.RYO_ADMIN_APPROVERS=admin;process.env.CREATORS_PORTAL_ENABLED='on';
  const service=createService({store,connection:{async getGenesisHash(){return GENESIS}},treasury:web3.Keypair.generate(),mint:address(),origin,studioAddress:address(),revenueAddress:address()});
  for(const action of ['creator-player-state','creator-player-claim'])await assert.rejects(service.handle(action,{},'forged'),/expired/);
  const state=await call(owner,'creator-player-state');assert.equal(state.marker,player.MARKER);assert.match(state.link,/\/?referral=RP/);assert.equal((await call(owner,'creator-player-state')).code,state.code);assert.equal((await call(owner,'creator-state')).creator,null,'no creator application or approval');
  const loginKey=web3.Keypair.generate(), loginWallet=loginKey.publicKey.toBase58(), challenge=await service.handle('challenge',{wallet:loginWallet});
  const privateKey=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(loginKey.secretKey.slice(0,32))]),format:'der',type:'pkcs8'});
  const loginBody={wallet:loginWallet,nonce:challenge.nonce,signature:crypto.sign(null,Buffer.from(challenge.message),privateKey).toString('base64'),creatorCode:state.code};
  const session=await service.handle('login',loginBody);assert.equal(session.referralAccepted,true,'first signed login accepts a player link before progress');await assert.rejects(service.handle('login',loginBody),/already used/);
  assert.equal((await service.handle('creator-player-state',{},session.token)).marker,player.MARKER);
  await assert.rejects(call(owner,'creator-attribute',{code:state.code}),/yourself/);
  await register(invitee);await call(invitee,'creator-attribute',{code:state.code});await call(invitee,'creator-attribute',{code:state.code});
  const secondOwner=address(), code2=(await call(secondOwner,'creator-player-state')).code;
  await assert.rejects(call(invitee,'creator-attribute',{code:code2}),/permanent/);
  await cp.adminAction(store,admin,{operation:'manual-add',wallet:admin,displayName:'Creator',reason:'fixture creator'});await call(admin,'creator-terms',{terms:true});const creatorCode=(await call(admin,'creator-state')).creator.code;
  await assert.rejects(call(invitee,'creator-attribute',{code:creatorCode}),/permanent/);
  const creatorInvitee=address();await call(creatorInvitee,'creator-attribute',{code:creatorCode});await assert.rejects(call(creatorInvitee,'creator-attribute',{code:state.code}),/permanent/);
  const childCode=(await call(invitee,'creator-player-state')).code;await assert.rejects(call(owner,'creator-attribute',{code:childCode}),/Circular/);
  const oldPlayer=address();await register(oldPlayer);await summon(oldPlayer);await assert.rejects(call(oldPlayer,'creator-attribute',{code:state.code}),/new players/);
  await adventure.adventure(store,invitee,{active:true,report:{killSession:'fake-stage-input',killStage:99999,killTotals:[0,0,0,0,0,0,99999,0]}},1e12);
  assert.equal((await rows('SELECT stage5 FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2',[invitee]))[0].stage5,null,'client claims do not verify Stage 5');
  await summon(invitee,10,'bonus');await pool.query('UPDATE ryo_accounts SET bonus=0 WHERE scope=$1 AND wallet=$2',[store.scope,invitee]);
  assert.equal((await rows('SELECT paid_mints FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2',[invitee]))[0].paid_mints,0);
  await summon(invitee,1,'balance','refunded');await summon(invitee,10);for(let i=0;i<4;i++)await summon(invitee);
  await progress(invitee,100);assert.equal((await call(owner,'creator-player-state')).passes.available,0);
  const final=await summon(invitee);assert.equal((await call(owner,'creator-player-state')).passes.available,2,'two passes immediately on qualification');
  await store.settlePurchase(invitee,final.request_id,'confirmed');await progress(invitee,100);assert.equal((await call(owner,'creator-player-state')).passes.earned,2,'qualification cannot replay');
  assert.equal((await rows('SELECT COUNT(*) AS n FROM ryo_creator_ledger WHERE scope=$1'))[0].n,0,'player referrals issue no CP');
  const creatorForm={displayName:'Referred Creator',platform:'YouTube',channelUrl:'https://youtube.com/@fixture',reason:'Honest gameplay streams with referral disclosure.',terms:true};
  const originalReferral=await rows('SELECT * FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2',[invitee]);
  await call(invitee,'creator-apply',creatorForm);
  const promoted=(await call(invitee,'creator-state')).creator;
  await cp.adminAction(store,admin,{operation:'status',creatorId:promoted.id,status:'APPROVED',reason:'Reviewed referred player channel'});
  assert.deepEqual(await rows('SELECT * FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2',[invitee]),originalReferral,'qualified progress and attribution survive promotion');
  assert.equal((await call(owner,'creator-player-state')).passes.earned,2,'promotion does not repeat qualification rewards');
  await summon(invitee,5);assert.equal((await call(owner,'creator-player-state')).passes.earned,2,'no ongoing player commission');
  const otherInvitee=address();await register(otherInvitee);await call(otherInvitee,'creator-attribute',{code:state.code});await summon(otherInvitee,15);await progress(otherInvitee,80);assert.equal((await call(owner,'creator-player-state')).passes.available,2,'entering Stage 5 is insufficient');
  await progress(otherInvitee,100);assert.equal((await call(owner,'creator-player-state')).passes.available,4,'either eligibility order works');
  const result=await call(owner,'creator-player-state');assert(result.referrals.every(r=>!r.wallet));assert(!JSON.stringify(result).includes(invitee));assert.equal((await player.summary(other,owner,origin)).passes.earned,0,'scope isolation');
  const balance=await store.balance(owner), initial=(await store.profile(owner)).heroes.length;
  const claim={requestId:crypto.randomUUID(),quantity:2};failed=true;await assert.rejects(call(owner,'creator-player-claim',claim),/profile failure/);assert.equal((await call(owner,'creator-player-state')).passes.available,4);assert.equal((await store.profile(owner)).heroes.length,initial);
  const claimed=await call(owner,'creator-player-claim',claim);assert.equal(claimed.claim.result.outputs.length,2);assert(claimed.claim.result.outputs.every(h=>h.creatorReward&&h.referralReward));
  await call(owner,'creator-player-claim',claim);assert.equal((await store.profile(owner)).heroes.length,initial+2);await assert.rejects(call(secondOwner,'creator-player-claim',claim),/another claim/);await assert.rejects(call(owner,'creator-player-claim',{...claim,quantity:1}),/another claim/);
  const race=await Promise.allSettled([0,1,2].map(()=>call(owner,'creator-player-claim',{requestId:crypto.randomUUID(),quantity:2})));assert.equal(race.filter(r=>r.status==='fulfilled').length,1,'last two passes cannot race');
  assert.equal((await store.profile(owner)).heroes.length,initial+4);assert.equal(await store.balance(owner),balance);assert.equal((await rows('SELECT COUNT(*) AS n FROM ryo_purchases WHERE scope=$1 AND wallet=$2',[owner]))[0].n,0,'claim creates no paid order or pool income');
  // Keep earned passes when collection capacity or an unsettled purchase blocks delivery.
  const extra=address();await call(extra,'creator-attribute',{code:state.code});
  await store.transaction(async c=>{await c.query('UPDATE ryo_player_referrals SET paid_mints=15,stage5=$3 WHERE scope=$1 AND wallet=$2',[store.scope,extra,now]);await player.qualify(store,c,(await c.query('SELECT * FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2',[store.scope,extra])).rows[0])});
  const saved=await store.profile(owner), full={...saved,heroes:Array.from({length:500},(_,i)=>({...saved.heroes[0],tokenId:'capacity-'+i}))};
  await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[store.scope,owner,JSON.stringify(full)]);
  await assert.rejects(call(owner,'creator-player-claim',{requestId:crypto.randomUUID(),quantity:2}),/collection is full/);assert.equal((await call(owner,'creator-player-state')).passes.available,2);
  await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[store.scope,owner,JSON.stringify(saved)]);await pool.query('UPDATE ryo_accounts SET balance=1000000 WHERE scope=$1 AND wallet=$2',[store.scope,owner]);
  const pendingId=crypto.randomUUID();await store.purchase(owner,pendingId,'summon',{quantity:1},25000,async q => require('./sr-revenue-fixture.cjs').stamp(q, {signature:'pending-fixture',wire:'fixture-wire',lastHeight:100}));
  await assert.rejects(call(owner,'creator-player-claim',{requestId:crypto.randomUUID(),quantity:1}),/pending game purchase/);assert.equal((await call(owner,'creator-player-state')).passes.available,2);await store.settlePurchase(owner,pendingId,'refunded');
  await call(owner,'creator-player-claim',{requestId:crypto.randomUUID(),quantity:1});assert.equal((await call(owner,'creator-player-state')).passes.available,1,'individual passes can be claimed');
  // A -> RP B (promoted creator) -> CP C. A must not join C's player link.
  const ancestor=address(), promotedWallet=address(), descendant=address();
  const ancestorCode=(await call(ancestor,'creator-player-state')).code;
  await call(promotedWallet,'creator-attribute',{code:ancestorCode});
  await call(promotedWallet,'creator-apply',creatorForm);
  const mixedCreator=(await call(promotedWallet,'creator-state')).creator;
  await cp.adminAction(store,admin,{operation:'status',creatorId:mixedCreator.id,status:'APPROVED',reason:'Mixed-program cycle fixture'});
  await call(descendant,'creator-attribute',{code:mixedCreator.code});
  const descendantCode=(await call(descendant,'creator-player-state')).code;
  await assert.rejects(call(ancestor,'creator-attribute',{code:descendantCode}),/Circular/);
  const migrated=address(), migration=await call(promotedWallet,'creator-migrate',{wallet:migrated});
  await call(migrated,'creator-migrate',{accept:true,id:migration.migrationId});
  await assert.rejects(call(ancestor,'creator-attribute',{code:descendantCode}),/Circular/,'reserved creator identity keeps ancestry after migration');
  assert.equal((await rows('SELECT COUNT(*) AS n FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2',[ancestor]))[0].n,0);
  await call(address(),'creator-attribute',{code:descendantCode}); // valid mixed chain remains allowed
  // Shared emergency purchases gate blocks a new pass claim.
  await store.pool.query("INSERT INTO ryo_admin_control(scope,version,config,pauses,installed) VALUES($1,1,'{}','{\"purchases\":true}',$2) ON CONFLICT(scope) DO UPDATE SET pauses='{\"purchases\":true}'",[store.scope,now]);
  await assert.rejects(require('../app/server/economic-dashboard.cjs').guard(store,'creator-player-claim',owner,{requestId:crypto.randomUUID(),quantity:1}),/paused/);
  let settings=await cp.adminSnapshot(store,admin,{});await cp.adminAction(store,admin,{operation:'config',version:settings.program.version,config:{...settings.program.config,enrollmentPaused:true},reason:'pause enrollment fixture'});
  await assert.rejects(call(address(),'creator-attribute',{code:state.code}),/paused/);assert.equal((await call(owner,'creator-player-state')).passes.claimed,5,'accepted entitlements survive enrollment pause');
  settings=await cp.adminSnapshot(store,admin,{});await cp.adminAction(store,admin,{operation:'config',version:settings.program.version,config:{...settings.program.config,enrollmentPaused:false,enrollmentLimit:0},reason:'shared capacity test'});
  await assert.rejects(call(address(),'creator-attribute',{code:state.code}),/limit/);await assert.rejects(call(address(),'creator-attribute',{code:creatorCode}),/limit/);
  assert((await cp.adminSnapshot(store,admin,{})).audits.some(a=>a.action==='player-referral.claimed'));
  console.log('PASS: player referrals — no application, shared signed auth and eligibility, first immutable cross-program attribution, self/cycle/old-player rejection, bonus/refund exclusions, server Stage 5, exactly two passes in either order, no CP commissions, atomic/idempotent concurrent hero claims, privacy/scope and emergency gate.');
 } finally {await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
