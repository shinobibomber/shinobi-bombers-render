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


// Chakra rules (owner decisions 2026-11-10): an exhausted deployed hero rests until 10% of its max chakra is back (Dojo
// rate), then fights at full speed until it runs out again; Reserve heroes never recover; bench heroes recover at the
// Dojo rate up to full.
for(const dojo of [0,6]){const h=profile().heroes[0],target=R.restTarget(h),rate=R.recovery(h,dojo,true)/1000;h.chakra={version:1,value:1.5,at:t0,nextAt:t0,resting:false};
 assert.equal(R.REST_RESUME,0.1,'the owner rule: rest until 10% is back');assert(target>=1&&Math.abs(target-R.maxChakra(h)*R.REST_RESUME)<0.001,'rest target is 10% of max chakra');
 assert.equal(C.spend(h,12,t0+1000,{activeSince:t0,dojo}),1,'exhaustion: one attack, then the hero rests');assert.equal(h.chakra.napping,true,'resting below 1 chakra');
 const restEnd=t0+Math.ceil((target-0.5)/rate);
 assert.equal(C.spend(h,12,restEnd-1000,{activeSince:restEnd-1000,dojo}),0,'no attack before the rest ends');assert(h.chakra.value<target);
 assert(C.recover(h,restEnd+3600000,dojo).value<=target+1e-9,'a resting deployed hero never recovers past the 10% target');
 const h2=profile().heroes[0];h2.chakra={version:1,value:0.5,at:t0,nextAt:t0,resting:false,napping:true};
 const got=C.spend(h2,5,restEnd+1,{activeSince:t0,dojo});assert(got>=1,'attacks resume right after the rest ends');assert.equal(h2.chakra.napping,undefined,'rest over at the target');
 assert(Math.abs(h2.chakra.value-(target-got))<1e-6,'fights from exactly the 10% target, one chakra per attack');}
{const edge=profile().heroes[0],tg=R.restTarget(edge);edge.chakra={version:1,value:tg-5e-10,at:t0,nextAt:t0,resting:false,napping:true};C.recover(edge,t0,0);
 assert.deepEqual([edge.chakra.value,edge.chakra.napping],[tg,undefined],'a rest ends on exactly the 10% target (as on the page), so later attacks never fall one short');
 const idle=profile().heroes[0];idle.chakra={version:1,value:0,at:t0,nextAt:t0,resting:false};C.recover(idle,t0+1000,0);assert.equal(idle.chakra.napping,true,'a deployed hero at 0 starts resting at once');
 const old=profile().heroes[0],oldMax=R.maxChakra(old);old.chakra={version:1,value:oldMax,at:t0,nextAt:t0,resting:false,napping:true};assert.equal(C.spend(old,5,t0+10000,{activeSince:t0,dojo:0}),5,'a saved rest already past 10% fights at once');assert.equal(old.chakra.napping,undefined);
 assert.equal(old.chakra.value,oldMax-5,'a saved rest holding more than 10% is never lowered to the target');
 const benched=profile().heroes[0];benched.chakra={version:1,value:0.2,at:t0,nextAt:t0,resting:false,napping:true};C.setResting(benched,true,t0,0);
 assert.equal(C.recover(benched,t0+600000,0).value,Math.min(R.maxChakra(benched),0.2+R.recovery(benched,0,true)*600),'a resting hero moved to the bench recovers at the bench rate');
 assert.equal(benched.chakra.napping,true,'its rest continues on the bench until 10% is back');
 C.setResting(benched,false,t0+600000,0);assert.equal(C.spend(benched,5,t0+601000,{activeSince:t0+600000,dojo:0}),0,'benching and redeploying never skips the rest (no attack before 10%)');
 const back=t0+Math.ceil((R.restTarget(benched)-0.2)/(R.recovery(benched,0,true)/1000))+1000;assert(C.spend(benched,5,back,{activeSince:t0+600000,dojo:0})>=1,'it fights again once 10% is back');
 assert(R.restTarget({rank:0,pk:[]})>=1&&R.restTarget({rank:0,pk:[]})<=R.maxChakra({rank:0,pk:[]}),'even the weakest hero rests to at least 1 chakra (a rest always ends in an attack)');}
// Offline Sensei keeps a slot earning while its deployed hero rests: it swaps in a rested bench hero (going offline benches
// the team, and a hero that runs out is swapped in the next 5 s window; resting heroes with some chakra are swapped too).
{const p=profile(2);p.sensei=true;p.senseiEnabled=true;p.senseiReturnPercent=50;
 let d=A.advance(null,p,t0,true,60,report(p,0,0,['h0']));
 p.heroes[0].chakra={version:1,value:5,at:t0,nextAt:t0,resting:false,napping:true};p.heroes[1].chakra={version:1,value:R.maxChakra(p.heroes[1]),at:t0,nextAt:t0,resting:true};
 d=A.advance(d,p,t0+1000,false,60);d=A.advance(d,p,t0+600000,false,60);
 assert(d.team.includes('h1'),'offline Sensei swaps in the rested bench hero for the resting one');assert(d.pending>0,'and the slot keeps earning while the other hero rests');}
{const reserve=profile().heroes[0];reserve.chakra={version:1,value:10,at:t0,nextAt:t0,resting:true};C.setReserve(reserve,true,t0,6);
 assert.equal(C.recover(reserve,t0+3600000,6).value,10,'Reserve: no recovery over an hour');C.setReserve(reserve,false,t0+3600000,6);
 assert.equal(C.recover(reserve,t0+3600000,6).value,10,'moving back to battle-ready credits no Reserve time');
 const r=R.recovery(reserve,6,true);assert.equal(C.recover(reserve,t0+3600000+60000,6).value,10+r*60,'bench recovers at the Dojo rate from the move');
 const bench=profile().heroes[0];bench.chakra={version:1,value:0,at:t0,nextAt:t0,resting:true};assert.equal(C.recover(bench,t0+600000,0).value,Math.min(R.maxChakra(bench),R.recovery(bench,0,true)*600),'bench: rate x time');}
{const p=profile(),r=(seq,n,k)=>({...report(p,n,k),combatSeq:seq});let d=A.advance(null,p,t0,true,60,r(1,0,0));d=A.advance(d,p,t0+10000,false,60,r(3,5,1));const paid=d.pending,at=d.last;d=A.advance(d,p,t0+11000,true,60,r(2,4,0));assert.equal(d.active,false,'older in-flight read cannot undo offline handoff');assert.equal(d.pending,paid);assert.equal(d.last,at);d=A.advance(d,p,t0+12000,true,60,r(0,4,0));assert.equal(d.active,false,'sequenced sessions cannot downgrade to unordered reports');}
{const p=profile(),old=(seq,n,k)=>({...report(p,n,k),combatSeq:seq});let d=A.advance(null,p,t0,true,60,old(1,0,0));d=A.advance(d,p,t0+1000,false,60,{...report(p,0,0,[],'replacement-session'),combatSeq:1});d=A.advance(d,p,t0+2000,true,60,old(2,1,0));assert.equal(d.active,false,'superseded page sessions cannot overwrite a newer offline handoff');}
console.log('PASS: authoritative action accounting, +3% Bounty, replay/flood limits, no resting attack bank, empty deployment, ten-hero bound, zero chakra, cross-mode lock, offline/Sensei cap and replay.');
