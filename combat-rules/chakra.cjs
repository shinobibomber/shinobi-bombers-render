'use strict';
const R=require('./combat-rules.cjs'),D=require('./combat-duty.cjs');
const CAP_MS=12*3600000;
/* Chakra rules (owner decisions 2026-11-10, Codex):
 *  - Reserve heroes (not battle-ready) never recover chakra (s.reserve). Time spent in Reserve is never credited later.
 *  - Battle-ready heroes resting on the bench recover at the Dojo rate (R.recovery), up to full.
 *  - A deployed hero that runs out rests (s.napping) until R.restTarget (10% of its max chakra) is back at the Dojo rate,
 *    then fights at full speed until it runs out again. The rest starts the moment it is below 1 chakra by any route
 *    (exhausted, deployed from the bench below 1, after a hunt, older saves), exactly when the page starts it, and
 *    recovery is capped at the exact target on both sides, so the page and the server always agree on every attack. A
 *    rest continues on the bench until 10% is back (benching and redeploying never skips it); the bench recovers at the
 *    same Dojo rate up to full.
 * Expedition Mode (owner spec 2026-11-11, combat-duty.cjs): every accepted attack adds its cooldown to the hero's Combat Duty
 * (h.chakra.duty). At 18 hours the hero leaves on a free Expedition and accepts no attack until it ends; its chakra keeps
 * recovering as on the bench and is never refilled. Without Expedition data every rule below is exactly as before. */
function state(h,now,legacy){
 const cap=R.maxChakra(h);
 if(!h.chakra||h.chakra.version!==1)h.chakra={version:1,value:Number.isFinite(legacy)?Math.max(0,Math.min(cap,legacy)):cap,at:now,nextAt:now,resting:true};
 const s=h.chakra;s.value=Math.max(0,Math.min(cap,Number(s.value)||0));if(!Number.isFinite(Number(s.at)))s.at=now;return s;
}
function recover(h,now,dojo=0){
 const s=state(h,now);
 if(s.hunt){const v=s.hunt,end=Math.min(now,v.ends-1),n=Math.min(v.energy,Math.max(0,Math.floor((end-v.started)/v.cooldown)+1));if(v.duty&&n>v.spent)D.add(h,s,(n-v.spent)*v.cooldown,v.ends,v.duty);s.value=Math.max(0,s.value-Math.max(0,n-v.spent));v.spent=Math.max(v.spent,n);s.nextAt=Math.max(s.nextAt,v.started+n*v.cooldown);s.lockUntil=v.ends;if(now<v.ends){s.at=Math.max(s.at,now);return s;}s.at=Math.max(s.at,v.ends);s.resting=true;delete s.hunt;}
 D.release(s,now);
 const free=now>Number(s.lockUntil||0),elapsed=Math.min(CAP_MS,Math.max(0,now-Math.max(Number(s.at)||0,Number(s.lockUntil)||0)))/1000;
 if(!s.reserve&&!s.resting&&s.value<1&&free)s.napping=true;   // a deployed hero below 1 chakra rests from this moment
 if(!s.reserve&&free){
  const target=R.restTarget(h);
  if(s.resting)s.value=Math.min(R.maxChakra(h),s.value+elapsed*R.recovery(h,dojo,true));   // bench: up to full (a rest in progress continues until 10%)
  else if(s.napping&&s.value<target)s.value=Math.min(target,s.value+elapsed*R.recovery(h,dojo,true));          // resting deployed: up to 10%, never lowered
  if(s.napping&&s.value+1e-9>=target){s.value=Math.max(s.value,target);delete s.napping;}                        // the rest ends on (at least) the exact target
 }
 if(s.lockUntil<=now)delete s.lockUntil;
 s.at=Math.max(Number(s.at)||0,now);return s;
}
// A cumulative report never spends the same action twice. Absolute cooldown windows are
// on the hero, not the page session, so opening another tab cannot create attack allowance.
function spend(h,wanted,now,{dojo=0,mode='adventure',activeSince=now,duty=null}={}){
 const s=state(h,now);if(s.hunt)recover(h,now,dojo);if(s.lockUntil>now&&mode!=='hunt')return 0;if(duty&&D.away(s,now))return 0;   // on an Expedition: no attack (Expedition Mode on)
 const cd=R.cooldown(h)*1000,from=Math.max(s.at,now-600000,activeSince,s.resting?now:0),limit=Math.max(0,Math.floor(wanted));
 recover(h,from,dojo);s.resting=false;let n=0;
 const rate=R.recovery(h,dojo,true)/1000;
 // Resolve the earliest permitted schedule, including the rest after exhaustion: below 1 chakra the hero rests until
 // 10% is back (Dojo rate), then attacks at its cooldown, one chakra each. Client clocks never set these timestamps.
 while(n<limit){
  if(s.value<1&&!s.reserve)s.napping=true;
  let at=Math.max(Number(s.nextAt)||from,s.at,from);
  if(duty&&D.away(s,at))at=Math.max(at,Number(s.duty.exp.ends));   // an Expedition that ended inside this window: fight from its end
  if(s.napping){if(!(rate>0))break;at=Math.max(at,s.at+Math.ceil(Math.max(0,R.restTarget(h)-s.value)/rate));}
  if(at>now)break;recover(h,at,dojo);
  if(s.napping||s.value<1)break;   // still resting; less than one chakra never grants an attack (the end of a rest clamps to the exact target)
  s.value=Math.max(0,s.value-1);s.nextAt=at+cd;n++;
  if(D.add(h,s,cd,at,duty))break;   // Combat Duty: this attack's cooldown; at 18 hours the Expedition starts at this attack
 }
 recover(h,now,dojo);return n;
}
function setResting(h,resting,now,dojo=0){const s=recover(h,now,dojo);if(s.resting&&!resting)s.nextAt=Math.max(s.nextAt,now);s.resting=!!resting;if(!resting&&!s.reserve&&s.value<1&&!(s.lockUntil>now))s.napping=true;return s;}
/** Reserve status: chakra is first settled under the old status, so a move never credits or loses time. */
function setReserve(h,reserve,now,dojo=0){const s=recover(h,now,dojo);if(reserve)s.reserve=true;else delete s.reserve;return s;}
function snapshot(profile,now){return Object.fromEntries(profile.heroes.map(h=>{const s=state(h,now);return [h.tokenId,{value:s.value,max:R.maxChakra(h),at:now,...(s.napping?{napping:true}:{}),...(s.reserve?{reserve:true}:{}),...(s.duty?{duty:Math.round(D.get(s).ms)}:{}),...(D.away(s,now)?{expeditionEnds:s.duty.exp.ends}:{})}]}))}
module.exports={state,recover,spend,setResting,setReserve,snapshot,CAP_MS};
