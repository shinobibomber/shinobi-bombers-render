/* Server-authoritative Power/chakra/rate accounting over the native Adventure report stream.
 * Spatial map/path simulation remains client-rendered; no client damage or bonus values are trusted. */
'use strict';
const R=require('./combat-rules.cjs'),C=require('./combat-chakra.cjs');
const HP=[100,213,1000,1625,2500],PAY=[35625,81250,406250,812500,0],CAP=12*3600000;
function parse(r){
 if(!r||r.combatVersion!==1||typeof r.killSession!=='string'||!/^[-a-zA-Z0-9_]{8,64}$/.test(r.killSession)||!Array.isArray(r.combatHeroes)||r.combatHeroes.length>50||!Array.isArray(r.deployed)||r.deployed.length>10)return null;
 const ids=new Set();for(const h of r.combatHeroes){if(!h||typeof h.id!=='string'||ids.has(h.id)||!Number.isSafeInteger(h.attacks)||h.attacks<0||h.attacks>1e7||!Array.isArray(h.kills)||h.kills.length!==5||!h.kills.every(n=>Number.isSafeInteger(n)&&n>=0)||h.kills.reduce((a,b)=>a+b,0)>h.attacks)return null;ids.add(h.id)}
 if(r.deployed.some(id=>typeof id!=='string')||new Set(r.deployed).size!==r.deployed.length)return null;
 return {id:r.killSession,seq:Number.isSafeInteger(r.combatSeq)&&r.combatSeq>0&&r.combatSeq<=1e9?r.combatSeq:0,heroes:r.combatHeroes,deployed:r.deployed,stage:Number.isSafeInteger(r.killStage)&&r.killStage>=1&&r.killStage<=1e6?r.killStage:1};
}
function advance(data,profile,now,active,ratePercent=50,report=null,onReward=null,onActivity=null){
 require('./economy.cjs').normalizeProfile(profile);
 const d=data||{map:1,target:0,hp:100,kills:0,pending:0,claimed:0,last:now,active:false,energy:{}};
 const last=Number.isFinite(d.last)?Math.min(d.last,now):now,gap=Math.max(0,now-last),rate=Math.max(50,Math.min(100,Number(ratePercent)||50))/100;
 const ready=new Set(profile.battleReady),roster=profile.heroes.filter(h=>ready.has(h.tokenId)),byId=new Map(roster.map(h=>[h.tokenId,h])),tally=parse(report);
 if(d.combatVersion!==1){d.combatVersion=1;d.combatSessions={};d.combatDamage=0;for(const h of profile.heroes)C.state(h,last,d.energy?.[h.tokenId]);}
 d.combatSessions||={};d.energy||={};d.teamSince||={};
 const previousReport=tally&&d.combatSessions[tally.id];if(previousReport?.seq>0&&(!tally.seq||tally.seq<=previousReport.seq))return d;
 const existing=tally&&d.combatSessions[tally.id];
 // Only a zero-count handshake starts a new page session. Old report replays cannot reset totals.
 const handshake=tally&&!existing&&tally.heroes.every(h=>h.attacks===0);
 if(handshake){d.sessionId=tally.id;d.combatSessions[tally.id]={heroes:{},at:now};}
 const authorized=!!tally&&d.sessionId===tally.id,online=authorized&&d.active&&gap<=(existing?600000:120000);
 if(tally&&!authorized)return d;
 let team=(Array.isArray(d.team)?d.team:roster.slice().sort((a,b)=>R.damage(b)/R.cooldown(b)-R.damage(a)/R.cooldown(a)).slice(0,10).map(h=>h.tokenId)).map(id=>byId.get(id)).filter(Boolean).slice(0,10);
 const teamRate=team.reduce((n,h)=>n+1/R.cooldown(h),0);
 d.actionBudget=d.active?Math.min(10+600*teamRate,(Number(d.actionBudget)||0)+Math.min(gap,600000)/1000*teamRate):10;
 const pay=(kind,h,at)=>{const earned=Math.floor(PAY[kind]*Math.max(.35,1-.1*Math.floor(d.map/100))*rate*R.rewardMultiplier(h));d.pending+=earned;d.kills++;if(onReward&&earned)onReward(earned,at);if(onActivity)onActivity({kind:'kills',quantity:1,heroId:h.tokenId,at})};
 d.offlineSeconds=0;
 if(online){
  const record=d.combatSessions[tally.id],previous=new Set(team.map(h=>h.tokenId));
  for(const row of tally.heroes){const h=byId.get(row.id);if(!h)continue;const v=record.heroes[row.id]||(record.heroes[row.id]={seen:0,accepted:0,kills:[0,0,0,0,0]});const delta=Math.max(0,row.attacks-v.seen);v.seen=Math.max(v.seen,row.attacks);
   const n=previous.has(row.id)?C.spend(h,Math.min(delta,Math.floor(d.actionBudget+1e-7)),now,{dojo:profile.dojo,activeSince:d.teamSince[row.id]??last}):0;d.actionBudget-=n;v.accepted+=n;d.combatDamage=(d.combatDamage||0)+n*R.damage(h);if(n&&onActivity)onActivity({kind:'attacks',quantity:n,heroId:h.tokenId,at:now});
  }
  d.map=Math.max(Number(d.map)||1,tally.stage,Math.floor((d.reportedKills||0)/100)+1);
  for(const row of tally.heroes){const h=byId.get(row.id),v=record.heroes[row.id];if(!h||!v)continue;let total=v.kills.reduce((a,b)=>a+b,0);
   for(let kind=0;kind<5;kind++)while(v.kills[kind]<row.kills[kind]&&total<v.accepted&&d.combatDamage+1e-7>=HP[kind]){d.combatDamage-=HP[kind];v.kills[kind]++;total++;pay(kind,h,now);d.reportedKills=(d.reportedKills||0)+1;}
  }
  d.combatDamage=Math.min(25000,d.combatDamage);record.at=now;d.lastReport=now;
  for(const id of Object.keys(d.combatSessions).sort((a,b)=>d.combatSessions[b].at-d.combatSessions[a].at).slice(4))delete d.combatSessions[id];
 }else if(!d.active&&gap>0){
  const until=profile.sensei?now:Math.min(now,Number(profile.senseiRentalUntil)||last),since=Math.max(last,Number(profile.senseiEnabledSince)||0,Number(profile.sensei?profile.senseiSince:profile.senseiRentalSince)||0),end=Math.min(until,last+CAP);
  if(profile.senseiEnabled!==false&&(profile.sensei||until>since)&&end>since){
   if(!team.length)team=roster.slice().sort((a,b)=>R.damage(b)/R.cooldown(b)-R.damage(a)/R.cooldown(a)).slice(0,10);
   d.offlineSeconds=(end-since)/1000;
   for(const h of team){C.setResting(h,false,since,profile.dojo);d.teamSince[h.tokenId]=since;}
   for(let at=since;at<end;at+=5000){const to=Math.min(end,at+5000),fighters=new Set(team.map(h=>h.tokenId));
    for(const h of roster)if(!fighters.has(h.tokenId))C.setResting(h,true,at,profile.dojo);
    for(let i=0;i<team.length;i++){
     let h=team[i];const s=C.recover(h,at,profile.dojo);
     if(s.value<1){const replacement=roster.find(x=>!team.includes(x)&&!(x.chakra?.lockUntil>at)&&C.recover(x,at,profile.dojo).value>=R.maxChakra(x)*profile.senseiReturnPercent/100);if(replacement){C.setResting(h,true,at,profile.dojo);h=team[i]=replacement;C.setResting(h,false,at,profile.dojo);d.teamSince[h.tokenId]=at;}}
     const n=C.spend(h,Math.ceil((to-at)/1000/R.cooldown(h))+1,to,{dojo:profile.dojo,activeSince:at});
     if(n&&onActivity)onActivity({kind:'attacks',quantity:n,heroId:h.tokenId,at:to});
     for(let a=0;a<n;a++){d.hp-=R.damage(h);if(d.hp<=0){pay(d.target,h,to);d.target=d.kills%4;d.hp=HP[d.target];if(d.kills%20===0){d.map++;if(onActivity)onActivity({kind:'stages',quantity:1,at:to});}}}
    }
   }
  }
 }
 if(authorized){d.combatSessions[tally.id].seq=tally.seq;const next=tally.deployed.map(id=>byId.get(id)).filter(h=>h&&!(h.chakra?.lockUntil>now));const old=new Set(team.map(h=>h.tokenId));for(const h of next)if(!old.has(h.tokenId)||!d.active){C.setResting(h,false,now,profile.dojo);d.teamSince[h.tokenId]=now}team=next;}
 const fighters=new Set(team.map(h=>h.tokenId));
 for(const h of profile.heroes){const s=C.recover(h,now,profile.dojo);if(!(s.lockUntil>now))C.setResting(h,!active||!fighters.has(h.tokenId),now,profile.dojo);d.energy[h.tokenId]=s.value;}
 d.team=team.map(h=>h.tokenId);d.last=now;d.active=!!active;return d;
}
module.exports={advance,parse,HP,PAY};
