'use strict';
const assert=require('node:assert/strict'),E=require('../app/server/economy.cjs'),R=require('../app/server/combat-rules.cjs'),A=require('../app/server/combat-adventure.cjs'),C=require('../app/server/combat-chakra.cjs');
const t0=1900000000000;
const profile=(n=1)=>{const p=E.normalizeProfile({dojo:0,heroes:Array.from({length:n},(_,i)=>({tokenId:'h'+i,rank:5,baseStats:{pw:20,sp:20,st:20},trainingVersion:2})),battleReady:[]});p.battleReady=p.heroes.map(h=>h.tokenId);return p};
const report=(p,n=0,k=0,ids=p.battleReady.slice(0,10),session='combat-session')=>({combatVersion:1,killSession:session,killStage:1,deployed:ids,combatHeroes:p.heroes.map(h=>({id:h.tokenId,attacks:n,kills:[k,0,0,0,0]}))});
{
 const p=profile(),h=p.heroes[0];let d=A.advance(null,p,t0,true,60,report(p));d=A.advance(d,p,t0+3000,true,60,report(p,5,1));assert.equal(h.chakra.value,1095);assert.equal(d.pending,Math.floor(35625*.6*1.03));
 const energy=h.chakra.value,paid=d.pending;d=A.advance(d,p,t0+3000,true,60,report(p,5,1));assert.equal(h.chakra.value,energy);assert.equal(d.pending,paid);
 const forgery={...report(p,50,10),damage:1e9,bonus:100,perks:[0,1,2,3,4,5,6]};d=A.advance(d,p,t0+3000,true,60,forgery);assert.equal(d.pending,paid,'same-time flood has no attack allowance');
 d=A.advance(d,p,t0+3000,true,60,report(p,0,0,[],'new-handshake'));d=A.advance(d,p,t0+60000,true,60,report(p,100,20,[],'new-handshake'));assert.equal(d.pending,paid,'empty deployment does not silently restart heroes');
 const rest=h.chakra.value;d=A.advance(d,p,t0+60000,true,60,report(p,100,20,['h0'],'new-handshake'));assert.equal(d.pending,paid,'new deployment cannot use time spent resting');assert.equal(h.chakra.value,rest);
}
{
 const p=profile(50);let d=A.advance(null,p,t0,true,60,report(p));for(let block=1;block<5;block++){d=A.advance(d,p,t0,true,60,report(p,0,0,p.battleReady.slice(block*10,block*10+10)));d=A.advance(d,p,t0,true,60,report(p,1000,200,p.battleReady.slice(block*10,block*10+10)));}assert(p.heroes.reduce((n,h)=>n+R.maxChakra(h)-h.chakra.value,0)<=10,'same-time rotation cannot bank attacks for 50 heroes');
}
{
 const p=profile(),h=p.heroes[0];h.chakra={version:1,value:0,at:t0,nextAt:t0,resting:false};let d=A.advance(null,p,t0,true,60,report(p));d=A.advance(d,p,t0+1000,true,60,report(p,5,1));assert.equal(d.pending,0);assert(h.chakra.value<1);
 const guarded=profile();guarded.heroes[0].chakra={version:1,value:100,at:t0,nextAt:t0,resting:false,lockUntil:t0+60000};d=A.advance(null,guarded,t0,true,60,report(guarded));d=A.advance(d,guarded,t0+5000,true,60,report(guarded,10,2));assert.equal(d.pending,0,'Boss-reserved hero cannot earn Adventure attacks');
}
{
 const p=profile(12);p.sensei=true;p.senseiEnabled=true;p.senseiReturnPercent=50;p.dojo=6;const seed=A.advance(null,p,t0,false,60);const start=performance.now(),d=A.advance(seed,p,t0+12*3600000,false,60);assert(d.pending>0);assert(d.offlineSeconds<=43200);assert(p.heroes.every(h=>h.chakra.value>=0&&h.chakra.value<=R.maxChakra(h)));assert(performance.now()-start<5000,'12h settlement stays bounded');const paid=d.pending;A.advance(d,p,t0+12*3600000,false,60);assert.equal(d.pending,paid,'offline interval cannot be paid twice');
 const resumed=profile();resumed.sensei=true;let old=A.advance(null,resumed,t0,true,60,report(resumed));old=A.advance(old,resumed,t0,false,60,report(resumed));old=A.advance(old,resumed,t0+600000,true,60,report(resumed));assert(old.offlineSeconds===600&&old.pending>0,'same-page existing report session still settles offline Sensei time');
}
assert.equal(A.parse({combatVersion:1,killSession:'bad',combatHeroes:[]}),null);
{const h=profile().heroes[0];h.chakra={version:1,value:.9999999995,at:t0,nextAt:t0,resting:false};assert.equal(C.spend(h,1,t0),0,'less than one chakra never grants an attack, even near a floating-point boundary');assert(h.chakra.value>=0);}
{
 const make=perk=>{const p=E.normalizeProfile({dojo:0,heroes:[{tokenId:'speed',rank:0,trainingVersion:2,baseStats:{pw:3,sp:3,st:3},perks:[perk]}],battleReady:['speed']});let d=A.advance(null,p,t0,true,60,report(p));for(let ms=1500;ms<=60000;ms+=1500)d=A.advance(d,p,t0+ms,true,60,report(p,Math.floor(ms/(R.cooldown(p.heroes[0])*1000))+1));return {actions:d.combatSessions['combat-session'].heroes.speed.accepted,energy:p.heroes[0].chakra.value,cap:R.maxChakra(p.heroes[0])};};
 const plain=make(1),swift=make(6);assert(swift.actions>plain.actions,'Swift Hands increases actual attack frequency');assert.equal(swift.cap-swift.energy,swift.actions,'each additional Swift Hands action consumes chakra');assert.equal(plain.cap-plain.energy,plain.actions);
}


{const h=profile().heroes[0];h.chakra={version:1,value:1.5,at:t0,nextAt:t0,resting:false};assert.equal(C.spend(h,12,t0+550000,{activeSince:t0}),12,'exhaustion midway through a sync gap retains genuine recharge and attacks');assert(h.chakra.value>=0&&h.chakra.value<1);const idle=profile().heroes[0];idle.chakra={version:1,value:0,at:t0,nextAt:t0,resting:false};assert.equal(C.recover(idle,t0+550000).value,1,'active idle recovery cannot bank a full chakra reserve');}
{const p=profile(),r=(seq,n,k)=>({...report(p,n,k),combatSeq:seq});let d=A.advance(null,p,t0,true,60,r(1,0,0));d=A.advance(d,p,t0+10000,false,60,r(3,5,1));const paid=d.pending,at=d.last;d=A.advance(d,p,t0+11000,true,60,r(2,4,0));assert.equal(d.active,false,'older in-flight read cannot undo offline handoff');assert.equal(d.pending,paid);assert.equal(d.last,at);d=A.advance(d,p,t0+12000,true,60,r(0,4,0));assert.equal(d.active,false,'sequenced sessions cannot downgrade to unordered reports');}
{const p=profile(),old=(seq,n,k)=>({...report(p,n,k),combatSeq:seq});let d=A.advance(null,p,t0,true,60,old(1,0,0));d=A.advance(d,p,t0+1000,false,60,{...report(p,0,0,[],'replacement-session'),combatSeq:1});d=A.advance(d,p,t0+2000,true,60,old(2,1,0));assert.equal(d.active,false,'superseded page sessions cannot overwrite a newer offline handoff');}
console.log('PASS: authoritative action accounting, +3% Bounty, replay/flood limits, no resting attack bank, empty deployment, ten-hero bound, zero chakra, cross-mode lock, offline/Sensei cap and replay.');
