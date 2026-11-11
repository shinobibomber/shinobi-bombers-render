/* Cumulative authenticated action reports. Presentation never fabricates damage/rewards. */
(()=>{
 'use strict';
 const R=CombatRules,reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');let owner=null,heroes=new Map(),hunts=new Map(),allowed=new Set(),lastTeam='',lastSync=0,sequence=0,leaving=false,offlineSent=false;const pending=new Set();
 const deployed=()=>S.h.filter(h=>h.on&&h.x>=0&&h.tokenId&&BattleRoster.eligible(h)).slice(0,10).map(h=>h.tokenId);
 function own(){if(owner!==RyoPayments.state.account){owner=RyoPayments.state.account;heroes.clear();hunts.clear();allowed.clear();lastTeam='';sequence=0;leaving=false;offlineSent=false;pending.clear();}}
 function record(h,rows){let r=rows.get(h.tokenId);if(!r){r={id:h.tokenId,attacks:0,kills:[0,0,0,0,0]};rows.set(h.tokenId,r)}return r;}
 const api=window.CombatClient={
  get leaving(){return leaving},
  async beginOffline(){own();leaving=true;offlineSent=false;await Promise.allSettled([...pending]);const ids=new Set(S.h.filter(h=>h.tokenOwner===owner).map(h=>h.id)),deadline=performance.now()+2000;while(bombs.some(b=>ids.has(b.o))&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));await Promise.allSettled([...pending]);},
  cancelOffline(){leaving=false;offlineSent=false;lastTeam='';allowed.clear();},
  attack(h){if(!RyoPayments.state.authenticated||!h.tokenId)return;own();record(h,heroes).attacks++;},
  huntAttack(h,id){if(!id||!h.tokenId)return;own();if(!hunts.has(id)){hunts.set(id,new Map());if(hunts.size>4)hunts.delete(hunts.keys().next().value)}record(h,hunts.get(id)).attacks++;},
  huntPayload(id){own();return {combatVersion:1,attacks:[...(hunts.get(id)?.values()||[])].map(({id,attacks})=>({id,attacks}))};},
  canAttack(h){own();return !leaving&&(!RyoPayments.state.authenticated||allowed.has(h.tokenId));},
  payload(){own();const ready=new Set(BattleRoster.list().map(h=>h.tokenId));return {combatVersion:1,combatSeq:++sequence,combatHeroes:[...heroes.values()].filter(r=>ready.has(r.id)).map(r=>({...r,kills:r.kills.slice()})),deployed:deployed()};},
  reconcile(chest){own();if(chest?.combatVersion===1&&Array.isArray(chest.deployed))allowed=new Set(chest.deployed);if(!chest?.chakra)return;for(const h of S.h){const s=chest.chakra[h.tokenId];if(!s||!Number.isFinite(s.value))continue;const ack=chest.attackAck?.[h.tokenId],local=heroes.get(h.tokenId)?.attacks||0;h.en=Math.max(0,Math.min(R.maxChakra(h),s.value-(Number.isFinite(ack)?Math.max(0,local-ack):0)));h.nap=s.napping?1:0;}},
  /** The server's saved chakra brought forward to the server time (same rule as combat-chakra.cjs recover):
   * Reserve, Boss Hunt and locked heroes gain nothing; bench heroes gain the Dojo rate up to full; a resting deployed
   * hero gains the Dojo rate up to its rest target (10%). */
  projectChakra(h,c,p){const v=Number(c?.value),at=Number(c?.at),t=Number(p?.serverTime)||Date.now();if(!Number.isFinite(v))return v;
   if(!Number.isFinite(at)||c.reserve||c.hunt||Number(c.lockUntil)>t||!(c.resting||c.napping))return v;
   const cap=c.resting?R.maxChakra(h):R.restTarget(h);if(v>=cap)return v;   // never lowered (an older saved rest can hold more)
   return Math.min(cap,v+Math.min(12*3600000,Math.max(0,t-Math.max(at,Number(c.lockUntil)||0)))/1000*R.recovery(h,p?.profile?.dojo||0,true));}
 };
 const originalAdventure=RyoPayments.adventure;
 // While leaving (Go offline), background syncs keep the player's state, so kills from bombs still in flight are credited; only the
 // go-offline report itself (active false) marks the player offline, and every report after it stays offline (owner bug 2026-11-11:
 // a background sync sent as offline first made the server drop the last in-flight defeat).
 RyoPayments.adventure=function(active=false,claim=false){own();if(leaving&&!active)offlineSent=true;const request=originalAdventure.call(this,active&&!(leaving&&offlineSent),claim);pending.add(request);request.then(()=>pending.delete(request),()=>pending.delete(request));return request;};
 addEventListener('shinobi-ryo-ledger',own);
 // Owner report 2026-11-11 ("some players get back to stage 1 of adventurers map"): the stage the game plays (S.map) lived only in
 // this browser's save, so a new device/browser, a wallet's in-app browser or cleared site data started at stage 1, while the
 // server kept the verified stage (never lowered; it decides rewards). The signed-in owner's verified Chest stage is now adopted
 // whenever it is higher than the local one (stages only go up by clearing a map, so this never takes a player backwards).
 function restoreStage(){
  const st=RyoPayments.state,s=window.AdventureChest?.snapshot,m=Number(s?.chest?.map);
  if(!st?.authenticated||!s?.chest||s.owner!==st.account||!Number.isSafeInteger(m)||m<1||m>1000000)return;
  if(typeof S!=='object'||!S||!(m>(Number(S.map)||1)))return;
  try{if(window.V2?.isBossActive?.())return;}catch{/* Boss Hunt state unavailable: adopt now */}
  S.map=m;try{newMap();save();}catch{/* the next frame redraws; the next sync retries the save */}
  try{toast('Adventure progress restored: stage '+m);}catch{}
 }
 addEventListener('shinobi-chest',()=>setTimeout(restoreStage,0));
 setInterval(()=>{own();if(leaving||!RyoPayments.state.authenticated||!window.AdventureChest)return;const signature=deployed().join('|'),now=performance.now();if(signature===lastTeam||now-lastSync<1500||AdventureChest.snapshot.busy)return;lastTeam=signature;lastSync=now;AdventureChest.refresh();},300);
 addEventListener('shinobi-enemy-defeated',e=>{const id=e.detail?.heroId,kind=e.detail?.kind;if(!id||kind<2||kind>6||!RyoPayments.state.authenticated)return;own();const h=S.h.find(h=>h.tokenId===id);if(h)record(h,heroes).kills[kind-2]++;});
 ShinobiSprites.ready.then(()=>{
  const draw=CharacterAnimations.drawProjectile;
  const next={};
  CharacterAnimations.drawProjectile=function(c,b,time,p){const n=Math.min(7,b.visualVolley||1),low=reducedMotion.matches||window.DisplaySettings?.v.reduceMotion||window.Arena3D?.cfg?.fx<2,count=low?1:n;let result;
   Object.assign(next,p);for(let i=0;i<count;i++){const offset=(i-(count-1)/2)*3.5*p.scale;next.x=p.x-Math.sin(p.angle)*offset;next.y=p.y+Math.cos(p.angle)*offset;result=draw.call(this,c,b,time,next);}return result;
  };
 });
})();
