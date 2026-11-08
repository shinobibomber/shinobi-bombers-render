'use strict';
const R=require('./combat-rules.cjs');
const CAP_MS=12*3600000;
function state(h,now,legacy){
 const cap=R.maxChakra(h);
 if(!h.chakra||h.chakra.version!==1)h.chakra={version:1,value:Number.isFinite(legacy)?Math.max(0,Math.min(cap,legacy)):cap,at:now,nextAt:now,resting:true};
 const s=h.chakra;s.value=Math.max(0,Math.min(cap,Number(s.value)||0));return s;
}
function recover(h,now,dojo=0){
 const s=state(h,now);
 if(s.hunt){const v=s.hunt,end=Math.min(now,v.ends-1),n=Math.min(v.energy,Math.max(0,Math.floor((end-v.started)/v.cooldown)+1));s.value=Math.max(0,s.value-Math.max(0,n-v.spent));v.spent=Math.max(v.spent,n);s.nextAt=Math.max(s.nextAt,v.started+n*v.cooldown);s.lockUntil=v.ends;if(now<v.ends){s.at=Math.max(s.at,now);return s;}s.at=Math.max(s.at,v.ends);s.resting=true;delete s.hunt;}
 const beforeRecovery=s.value;
 if(s.resting&&now>Number(s.lockUntil||0))s.value=Math.min(R.maxChakra(h),s.value+Math.min(CAP_MS,Math.max(0,now-Math.max(s.at,Number(s.lockUntil)||0)))/1000*R.recovery(h,dojo,true));
 else if(s.value<1&&!(s.lockUntil>now))s.value=Math.min(1,s.value+Math.min(CAP_MS,Math.max(0,now-s.at))/1000*R.recovery(h,0,true));
 if(process.env.SHINOBI_LEGACY_PASS==='on'&&process.env.PRELAUNCH_MODE!=='on'&&s.value>beforeRecovery)s.legacyRecovered=(Number(s.legacyRecovered)||0)+s.value-beforeRecovery;
 if(s.lockUntil<=now)delete s.lockUntil;
 s.at=Math.max(s.at,now);return s;
}
// A cumulative report never spends the same action twice. Absolute cooldown windows are
// on the hero, not the page session, so opening another tab cannot create attack allowance.
function spend(h,wanted,now,{dojo=0,mode='adventure',activeSince=now}={}){
 const s=state(h,now);if(s.hunt)recover(h,now,dojo);if(s.lockUntil>now&&mode!=='hunt')return 0;
 const cd=R.cooldown(h)*1000,from=Math.max(s.at,now-600000,activeSince,s.resting?now:0),limit=Math.max(0,Math.floor(wanted));
 recover(h,from,dojo);s.resting=false;let n=0;
 // Resolve the earliest permitted schedule, including real recharge intervals after exhaustion.
 // Client clocks never determine these timestamps, and an active idle hero can recover only to 1.
 while(n<limit){let at=Math.max(Number(s.nextAt)||from,s.at,from);
  if(s.value<1)at=Math.max(at,s.at+Math.ceil((1-s.value)/(R.recovery(h,0,true)/1000)));
  if(at>now)break;recover(h,at,dojo);if(s.value<1)break;
  s.value-=1;s.nextAt=at+cd;n++;
 }
 recover(h,now,dojo);return n;
}
function setResting(h,resting,now,dojo=0){const s=recover(h,now,dojo);if(s.resting&&!resting)s.nextAt=Math.max(s.nextAt,now);s.resting=!!resting;return s;}
function snapshot(profile,now){return Object.fromEntries(profile.heroes.map(h=>[h.tokenId,{value:state(h,now).value,max:R.maxChakra(h),at:now}]))}
module.exports={state,recover,spend,setResting,snapshot,CAP_MS};
