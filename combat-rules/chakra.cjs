'use strict';
const R=require('./combat-rules.cjs');
const CAP_MS=12*3600000;
/* Chakra rules (owner decisions 2026-11-10, Codex):
 *  - Reserve heroes (not battle-ready) never recover chakra (s.reserve). Time spent in Reserve is never credited later.
 *  - Battle-ready heroes resting on the bench recover at the Dojo rate (R.recovery).
 *  - A deployed hero that runs out keeps fighting as it recovers: it regains chakra at the Dojo rate (capped at 1, so an
 *    idle deployed hero banks nothing) and attacks again as soon as it has 1 — Training Grounds 1 attack/min, Legendary
 *    17/min. (The earlier "nap until full" rule stopped Adventure rewards for hours; saved naps are cleared.) */
function state(h,now,legacy){
 const cap=R.maxChakra(h);
 if(!h.chakra||h.chakra.version!==1)h.chakra={version:1,value:Number.isFinite(legacy)?Math.max(0,Math.min(cap,legacy)):cap,at:now,nextAt:now,resting:true};
 const s=h.chakra;s.value=Math.max(0,Math.min(cap,Number(s.value)||0));return s;
}
function recover(h,now,dojo=0){
 const s=state(h,now);
 if(s.hunt){const v=s.hunt,end=Math.min(now,v.ends-1),n=Math.min(v.energy,Math.max(0,Math.floor((end-v.started)/v.cooldown)+1));s.value=Math.max(0,s.value-Math.max(0,n-v.spent));v.spent=Math.max(v.spent,n);s.nextAt=Math.max(s.nextAt,v.started+n*v.cooldown);s.lockUntil=v.ends;if(now<v.ends){s.at=Math.max(s.at,now);return s;}s.at=Math.max(s.at,v.ends);s.resting=true;delete s.hunt;}
 delete s.napping;   // the retired nap-until-full state: a hero saved mid-nap fights again with the chakra it has
 if(!s.reserve&&s.resting&&now>Number(s.lockUntil||0))s.value=Math.min(R.maxChakra(h),s.value+Math.min(CAP_MS,Math.max(0,now-Math.max(s.at,Number(s.lockUntil)||0)))/1000*R.recovery(h,dojo,true));
 else if(!s.reserve&&s.value<1&&!(s.lockUntil>now))s.value=Math.min(1,s.value+Math.min(CAP_MS,Math.max(0,now-Math.max(s.at,Number(s.lockUntil)||0)))/1000*R.recovery(h,dojo,true));
 if(s.lockUntil<=now)delete s.lockUntil;
 s.at=Math.max(s.at,now);return s;
}
// A cumulative report never spends the same action twice. Absolute cooldown windows are
// on the hero, not the page session, so opening another tab cannot create attack allowance.
function spend(h,wanted,now,{dojo=0,mode='adventure',activeSince=now}={}){
 const s=state(h,now);if(s.hunt)recover(h,now,dojo);if(s.lockUntil>now&&mode!=='hunt')return 0;
 const cd=R.cooldown(h)*1000,from=Math.max(s.at,now-600000,activeSince,s.resting?now:0),limit=Math.max(0,Math.floor(wanted));
 recover(h,from,dojo);s.resting=false;let n=0;
 // Resolve the earliest permitted schedule, including recharge after exhaustion: below 1 chakra the next attack waits
 // until 1 chakra has been regained at the Dojo rate. Client clocks never determine these timestamps.
 while(n<limit){let at=Math.max(Number(s.nextAt)||from,s.at,from);
  if(s.value<1)at=Math.max(at,s.at+Math.ceil((1-s.value)/(R.recovery(h,dojo,true)/1000)));
  // The scheduled moment holds a full chakra; a float shortfall (0.9999999) never drops a genuine attack or its kill.
  if(at>now)break;recover(h,at,dojo);if(s.value+1e-9<1)break;
  s.value=Math.max(0,s.value-1);s.nextAt=at+cd;n++;
 }
 recover(h,now,dojo);return n;
}
function setResting(h,resting,now,dojo=0){const s=recover(h,now,dojo);if(s.resting&&!resting)s.nextAt=Math.max(s.nextAt,now);s.resting=!!resting;return s;}
/** Reserve status: chakra is first settled under the old status, so a move never credits or loses time. */
function setReserve(h,reserve,now,dojo=0){const s=recover(h,now,dojo);if(reserve)s.reserve=true;else delete s.reserve;return s;}
function snapshot(profile,now){return Object.fromEntries(profile.heroes.map(h=>{const s=state(h,now);return [h.tokenId,{value:s.value,max:R.maxChakra(h),at:now,...(s.reserve?{reserve:true}:{})}]}))}
module.exports={state,recover,spend,setResting,setReserve,snapshot,CAP_MS};
