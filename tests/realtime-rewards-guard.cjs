/* Deploy-blocking real-time guard: finite chakra, all six ranks, trained stats, first-sync credit. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../app'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const once=(s,text,label)=>assert.equal(s.split(text).length-1,1,'realtime rewards: '+label);
const game=read('public/index.html'),options=read('public/assets/gameplay-options/options.js');
for(const [text,label]of [
 ['damage(h){return CombatRules.damage(h)}','native Power damage'],
 ['cooldown(h){return CombatRules.cooldown(h)}','native cooldown'],
 ['if(!CombatRules.consume(h))return;const kind=','one debit per Adventure action'],
 ['visualVolley:CombatRules.volley(h)','cosmetic volley'],
 ['c.hp=GameBalance.money(c.hp-b.d)','one damage event'],
 ["detail:{kind,reward,bonus:!!(h&&has(h,0)),heroId:h?.tokenId}",'attributed kill event'],
 ["{active,...(window.KillReport?.payload()||{})}",'authenticated report'],
 ['keepalive:!!window.KillReport?.closing','close flush']])once(game,text,label);
once(game,"const statBands=[[1,3],[3,6],[6,9],[9,12],[12,15]];statBands.push([17,20])/* Mythic */;","all six native stat bands");
once(game,"h[key]=Math.round((base+(Number(h.bonus?.[key])||0))*1000)/1000","native trained stat composition");
once(game,"h.bonus={...descriptor.bonus};","server training descriptor");
once(game,"enemyHP(k){return [100,213,1000,1625,2500][k-2]}","native target HP table");
once(options,'Math.max(300,tally.last+1500-performance.now())','unchanged sync timing');
once(options,"addEventListener('pagehide',()=>flush(true))",'page close flush');
once(options,'if(document.hidden)flush(true)','hidden flush');
once(read('server/adventure.cjs'),"const advance=require('./combat-adventure.cjs').advance;",'authoritative combat path');
once(read('server/service.cjs'),'combatHeroes:body.combatHeroes,deployed:body.deployed','HTTP forwards action protocol');
const R=require(path.join(root,'server/combat-rules.cjs')),economy=require(path.join(root,'server/economy.cjs')),A=require(path.join(root,'server/adventure.cjs'));
assert.deepEqual(R.COUNTS,[1,2,3,4,5,7]);assert.deepEqual(R.BANDS,[[1,3],[3,6],[6,9],[9,12],[12,15],[17,20]]);
// Execute the actual generated native combat functions in a bounded DOM-free fixture.
const vm=require('node:vm'),thinkSource=game.split(/\r?\n/).find(l=>l.startsWith(' think=function(h){')),boomSource=game.split(/\r?\n/).find(l=>l.startsWith(' boom=function(b){'));
assert(thinkSource&&boomSource,'native combat entry points must remain inspectable');
for(let rank=0;rank<6;rank++){
 const h={id:1,r:rank,pw:R.BANDS[rank][1]+5,sp:R.BANDS[rank][1],st:R.BANDS[rank][1],pk:R.normalizePerks(rank,[],()=>0),x:4,y:4,en:2,cd:0,p:[]},cell={k:2,hp:10000,maxHp:10000};
 const combat={canAttack:()=>true,attack(){}},box={Math,think:null,boom:null,CombatRules:R,CombatClient:combat,window:{CombatClient:combat},bombs:[],G:Array.from({length:5},()=>[]),S:{h:[h]},fx:[],has:R.has,target:()=>({x:4,y:4}),bfs:()=>[],GameBalance:{damage:R.damage,cooldown:R.cooldown,money:n=>Math.round(n*1000)/1000}};
 box.G[4][4]=cell;vm.createContext(box);vm.runInContext(thinkSource+'\n'+boomSource,box);box.think(h);
 assert.equal(h.en,1,'native attack costs exactly one chakra');assert.equal(box.bombs.length,1,'decorative volleys cannot create combat projectiles');assert.equal(box.bombs[0].d,h.pw,'native attack uses trained Power');
 const shot=box.bombs[0];box.boom(shot);box.boom(shot);assert.equal(cell.hp,10000-h.pw,'duplicate hit callbacks cannot multiply damage');h.en=0;h.cd=0;box.think(h);assert.equal(box.bombs.length,0,'zero-chakra native heroes cannot attack');
}
const HP=[100,213,1000,1625],PAY=[35625,81250,406250,812500],t0=1_900_000_000_000;
let cases=0;
for(let rank=0;rank<6;rank++)for(const stat of [null,'pw','sp','st'])for(const base of R.BANDS[rank]){
 const p=economy.normalizeProfile({dojo:0,heroes:Array.from({length:10},(_,i)=>({tokenId:'guard-'+i,rank,level:stat?5:1,trainingVersion:2,combatVersion:1,perks:R.normalizePerks(rank,[6,0],()=>0),baseStats:{pw:base,sp:base,st:base},bonus:{pw:0,sp:0,st:0,...(stat?{[stat]:5}:{})}})),battleReady:[]});
 p.battleReady=p.heroes.map(h=>h.tokenId);const kind=Math.min(3,rank),counts=new Map(),label=`rank ${rank}, base ${base}, trained ${stat}`;
 const report=()=>({combatVersion:1,killSession:'guard-session',killStage:1,deployed:p.battleReady,combatHeroes:p.heroes.map(h=>{const attacks=counts.get(h.tokenId)||0,kills=[0,0,0,0,0];kills[kind]=Math.floor(attacks/Math.ceil(HP[kind]/R.damage(h)));return {id:h.tokenId,attacks,kills}})});
 assert(Math.abs(require(path.join(root,'server/gameplay-options.cjs')).teamDps(p.heroes)-p.heroes.reduce((n,h)=>n+R.damage(h)/R.cooldown(h),0))<1e-8,'trained team budget matches the native contract');
 let d=A.advance(undefined,p,t0,true,60,report());
 const energy=p.heroes.map(h=>Math.floor(R.maxChakra(h)));
 const check=ms=>{
  p.heroes.forEach((h,i)=>counts.set(h.tokenId,Math.min(energy[i],Math.floor(ms/(R.cooldown(h)*1000))+1)));
  const tally=report();d=A.advance(d,p,t0+ms,true,60,tally);
  const kills=tally.combatHeroes.reduce((n,h)=>n+h.kills[kind],0);
  assert.equal(d.reportedKills||0,kills,`${label}: all kills credited at first sync ${ms}ms`);
  const expected=tally.combatHeroes.reduce((n,h,i)=>n+h.kills[kind]*Math.floor(PAY[kind]*.6*R.rewardMultiplier(p.heroes[i])),0);
  assert.equal(d.pending,expected,`${label}: verified +3% only for Bounty owners`);
 };
 for(let ms=1500;ms<=240000;ms+=1500)check(ms);
 check(330000);check(331500);check(631500);
 const paid=d.pending;d=A.advance(d,p,t0+631500,true,60,report());assert.equal(d.pending,paid,'replay never pays twice');cases++;
}
{
 const p=economy.normalizeProfile({heroes:[{tokenId:'bounded',rank:5,baseStats:{pw:20,sp:20,st:20},trainingVersion:2}],battleReady:['bounded']});
 const report=(attacks,kills)=>({combatVersion:1,killSession:'guard-cheat',deployed:['bounded'],combatHeroes:[{id:'bounded',attacks,kills:[0,0,0,kills,0]}]});
 let d=A.advance(null,p,t0,true,60,report(0,0));d=A.advance(d,p,t0+1500,true,60,report(1e6,1e6));
 assert((d.reportedKills||0)*1625<=3*R.damage(p.heroes[0]),'flood cannot exceed actual cooldown and Power');
 assert(p.heroes[0].chakra.value>=R.maxChakra(p.heroes[0])-3,'flood cannot debit nonexistent actions');
}
// Exhausted deployed heroes keep fighting at the Dojo rate (owner decision 2026-11-10; it replaced the nap-until-full
// rule that stopped rewards for hours). Training Grounds is exactly the rule before that day, so its case is restored as
// it was: the first reconnect sync after mid-gap exhaustion credits the genuine kills.
{
 const p=economy.normalizeProfile({heroes:[{tokenId:'recovered',rank:5,trainingVersion:2,baseStats:{pw:20,sp:20,st:20},perks:[0,1,2,3,4,5,6],chakra:{version:1,value:1.5,at:t0,nextAt:t0,resting:false}}],battleReady:['recovered']});
 const report=(attacks,kills)=>({combatVersion:1,killSession:'guard-recovered',killStage:1,deployed:['recovered'],combatHeroes:[{id:'recovered',attacks,kills:[kills,0,0,0,0]}]});
 let d=A.advance(null,p,t0,true,60,report(0,0));d=A.advance(d,p,t0+550000,true,60,report(12,2));
 assert.equal(d.reportedKills,2,'first reconnect sync credits kills after mid-gap exhaustion and genuine recovery');
 assert.equal(d.pending,2*Math.floor(35625*.6*1.03),'recovered attacks retain only verified Bounty rewards');
 assert.equal(d.combatSessions['guard-recovered'].heroes.recovered.accepted,12,'all twelve actions are verified');
 // +0.5/min Fast Charge lets this hero finish earlier and refill its one-chakra active-idle cap.
 assert.equal(p.heroes[0].chakra.value,1,'active idle recovery banks at most one chakra');
 d=A.advance(d,p,t0+550000,true,60,report(13,2));assert.equal(d.combatSessions['guard-recovered'].heroes.recovered.accepted,13);assert.equal(p.heroes[0].chakra.value,0,'the recovered next attack spends exactly one chakra');d=A.advance(d,p,t0+550000,true,60,report(14,2));assert.equal(d.combatSessions['guard-recovered'].heroes.recovered.accepted,13,'no second attack is free at zero chakra');
}
// A better Dojo: the same gap allows more genuine attacks (17.5 chakra/min with Fast Charge), never more than recovered.
{
 const p=economy.normalizeProfile({dojo:6,heroes:[{tokenId:'dojo6',rank:5,trainingVersion:2,baseStats:{pw:20,sp:20,st:20},perks:[0,1,2,3,4,5,6],chakra:{version:1,value:1.5,at:t0,nextAt:t0,resting:false}}],battleReady:['dojo6']});
 const report=(attacks,kills)=>({combatVersion:1,killSession:'guard-dojo6',killStage:1,deployed:['dojo6'],combatHeroes:[{id:'dojo6',attacks,kills:[kills,0,0,0,0]}]});
 let d=A.advance(null,p,t0,true,60,report(0,0));d=A.advance(d,p,t0+60000,true,60,report(18,2));
 const rate=R.recovery(p.heroes[0],6,true)*60, allowed=1+Math.floor(0.5+rate*(60-R.cooldown(p.heroes[0]))/60+1e-9);
 const got=d.combatSessions['guard-dojo6'].heroes.dojo6.accepted;
 assert(got>=16&&got<=allowed,'Dojo 6: about 17 attacks a minute after exhaustion, never more than recovered ('+got+' of max '+allowed+')');
 assert.equal(d.reportedKills,2,'Dojo 6: the first sync credits the real kills');assert(p.heroes[0].chakra.value<=1,'no banked chakra beyond 1');
 const before=got;d=A.advance(d,p,t0+60000,true,60,report(18,2));assert.equal(d.combatSessions['guard-dojo6'].heroes.dojo6.accepted,before,'a replayed report credits nothing');
 d=A.advance(d,p,t0+60000,true,60,report(100000,50));assert.equal(d.combatSessions['guard-dojo6'].heroes.dojo6.accepted,before,'a flood at the same moment credits nothing new');
}
// SUSTAINED EARNING (owner rule 2026-11-10: every enemy kill is added to the Chest in real time, and no update may stop
// that). A deployed hero at Training Grounds (the slowest Dojo), synced every minute for 3 hours by a page that reports
// generously, must keep attacking (no gap over 2 minutes after it runs out of chakra), every kill its verified damage
// supports must be credited at once, and a hero strong enough to kill with each attack must add to the Chest at least
// every 5 minutes. A rule that silences attacks for long (like the retired nap-until-full, which stopped rewards for up
// to 11 hours) fails here and blocks the deploy.
for(const rank of [0,2,5]){
 const p=economy.normalizeProfile({dojo:0,heroes:[{tokenId:'steady',rank,trainingVersion:2,baseStats:{pw:R.BANDS[rank][1],sp:R.BANDS[rank][1],st:R.BANDS[rank][1]},perks:R.normalizePerks(rank,[],()=>0)}],battleReady:['steady']});
 const id='guard-steady-'+rank,rep=(a,k)=>({combatVersion:1,killSession:id,killStage:1,deployed:['steady'],combatHeroes:[{id:'steady',attacks:a,kills:[k,0,0,0,0]}]});
 const dmg=R.damage(p.heroes[0]),end=t0+3*3600000;
 let d=A.advance(null,p,t0,true,60,rep(0,0)),attacks=0,kills=0,lastPending=0,lastGain=t0,longestPay=0,lastAcc=0,lastHit=t0,longestHit=0;
 for(let t=t0+60000;t<=end;t+=60000){
  attacks+=200;kills+=200;d=A.advance(d,p,t,true,60,rep(attacks,kills));
  const acc=d.combatSessions[id].heroes.steady.accepted,pending=Number(d.pending)||0;
  if(acc>lastAcc){longestHit=Math.max(longestHit,t-lastHit);lastHit=t;lastAcc=acc;}
  if(pending>lastPending){longestPay=Math.max(longestPay,t-lastGain);lastGain=t;lastPending=pending;}
  // Never more attacks than chakra allows: the starting bar plus what Training Grounds recovers in the elapsed time.
  assert(acc<=R.maxChakra(p.heroes[0])+(t-t0)/1000*R.recovery(p.heroes[0],0,true)+1,'rank '+rank+': accepted attacks never exceed the chakra recovered');
  // Every kill the verified damage supports is credited in the same sync (at most one per accepted attack).
  assert.equal(d.reportedKills||0,Math.min(acc,Math.floor(acc*dmg/HP[0]+1e-7)),'rank '+rank+': every supported kill is credited in real time');
 }
 longestHit=Math.max(longestHit,end-lastHit);longestPay=Math.max(longestPay,end-lastGain);
 assert(longestHit<=2*60000,'rank '+rank+': a deployed hero keeps attacking at Training Grounds (longest gap '+Math.round(longestHit/60000)+' min over 3 h)');
 if(dmg>=HP[0])assert(longestPay<=5*60000,'rank '+rank+': a hero that kills with each attack adds to the Chest every few minutes (longest gap '+Math.round(longestPay/60000)+' min)');
}
// Dojo 6 over a long reconnect gap (550 s): the first sync credits the genuine attacks and kills, nothing more.
{
 const p=economy.normalizeProfile({dojo:6,heroes:[{tokenId:'gap6',rank:5,trainingVersion:2,baseStats:{pw:20,sp:20,st:20},perks:[0,1,2,3,4,5,6],chakra:{version:1,value:1.5,at:t0,nextAt:t0,resting:false}}],battleReady:['gap6']});
 const report=(attacks,kills)=>({combatVersion:1,killSession:'guard-gap6',killStage:1,deployed:['gap6'],combatHeroes:[{id:'gap6',attacks,kills:[kills,0,0,0,0]}]});
 let d=A.advance(null,p,t0,true,60,report(0,0));d=A.advance(d,p,t0+550000,true,60,report(12,2));
 assert.deepEqual([d.combatSessions['guard-gap6'].heroes.gap6.accepted,d.reportedKills],[12,2],'Dojo 6, 550 s gap: all twelve genuine attacks and both kills credited on the first sync');
 assert(p.heroes[0].chakra.value<=1,'Dojo 6: nothing banked beyond one chakra');
 d=A.advance(d,p,t0+550000,true,60,report(12,2));assert.equal(d.combatSessions['guard-gap6'].heroes.gap6.accepted,12,'replay credits nothing');
}
// A hero deployed while already below 1 chakra (benched at 0.5, back from a hunt, or an older save, including one saved
// mid-nap under the retired rule) recovers to 1 at the Dojo rate and fights: its genuine kills are credited on first sync.
for(const [label,chakra] of [['deployed from the bench below 1',{version:1,value:0.5,at:t0,nextAt:t0,resting:true}],['older save below 1',{version:1,value:0,at:t0,nextAt:t0,resting:false}],['saved mid-nap (retired rule)',{version:1,value:0.25,at:t0,nextAt:t0,resting:false,napping:true}]]){
 const p=economy.normalizeProfile({dojo:6,heroes:[{tokenId:'low',rank:5,trainingVersion:2,baseStats:{pw:20,sp:20,st:20},perks:[0,1,2,3,4,5,6],chakra}],battleReady:['low']});
 const id='guard-low-'+label.replace(/[^a-z]/g,''),report=(attacks,kills)=>({combatVersion:1,killSession:id,killStage:1,deployed:['low'],combatHeroes:[{id:'low',attacks,kills:[kills,0,0,0,0]}]});
 let d=A.advance(null,p,t0,true,60,report(0,0));
 d=A.advance(d,p,t0+120000,true,60,report(12,2));
 assert.equal(d.combatSessions[id].heroes.low.accepted,12,label+': twelve genuine attacks within two minutes at Dojo 6');
 assert.equal(d.reportedKills,2,label+': the first sync credits the real kills');
 assert(p.heroes[0].chakra.value<=1&&p.heroes[0].chakra.napping===undefined,label+': no banked chakra, no nap state');
}
console.log(`PASS: real-time rewards guard: ${cases} teams across six ranks, finite chakra, trained stats, 300ms/1500ms sync, first-sync kills, reconnects, replay and flood limits.`);
