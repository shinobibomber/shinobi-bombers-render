/* A paid Boss Hunt is an authoritative timed auto-attack against one guardian.
 * Entry snapshots fix Power/cooldown/chakra; reports never choose damage or attack totals. */
'use strict';
const R=require('./combat-rules.cjs'),C=require('./combat-chakra.cjs'),D=require('./combat-duty.cjs'),fail=(...args)=>require('./store.cjs').fail(...args);
const SCHEMA="ALTER TABLE ryo_hunt_entries ADD COLUMN IF NOT EXISTS combat JSONB;";
const save=(c,store,wallet,p)=>c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[store.scope,wallet,JSON.stringify(p)]);
function attacks(unit,at,end){return Math.min(unit.energy,Math.max(0,Math.floor((Math.min(at,end-1,(unit.ends??end)-1)-unit.started)/unit.cooldown)+1));}
async function activate(store,wallet,id){return store.transaction(async c=>{
 await store.locked(c,wallet);const row=(await c.query('SELECT * FROM ryo_hunt_entries WHERE scope=$1 AND id=$2 AND wallet=$3 FOR UPDATE',[store.scope,id,wallet])).rows[0];if(!row)fail('That hunt is not yours.');
 const payment=(await c.query('SELECT status FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND request_id=$3',[store.scope,wallet,id])).rows[0];
 if(payment?.status!=='confirmed')return {id,seconds:60,guardian:row.guardian,pending:true,refunded:payment?.status==='refunded'};
 if(row.combat?.team)return {id,started:row.combat.started,seconds:60,guardian:row.guardian,team:row.combat.team.map(u=>u.id),pending:false,combat:row.combat};
 const now=store.now(),p=await store.profileLocked(c,wallet);await require('./adventure.cjs').settleLocked(store,c,wallet,p,false);
 if(p.heroes.some(h=>h.chakra?.hunt&&h.chakra.hunt.ends>now))fail('Finish your current hunt first.',409);
 let duty=null;try{duty=require('./expedition.cjs').dutyOption(p)}catch{duty=null}   // Expedition Mode (off: no Expedition blocks)
 const ready=new Set(p.battleReady),team=p.heroes.filter(h=>ready.has(h.tokenId)&&C.recover(h,now,p.dojo).value>=1&&!(h.chakra.lockUntil>now)&&!(duty&&D.away(h.chakra,now))).sort((a,b)=>R.damage(b)-R.damage(a)).slice(0,5);
 if(!team.length)fail('Rest a battle-ready hero before starting your paid hunt.',409);
 const combat={version:1,started:now,ends:now+60000,team:team.map(h=>({id:h.tokenId,started:Math.max(now,h.chakra.nextAt),power:R.damage(h),cooldown:R.cooldown(h)*1000,energy:Math.floor(h.chakra.value)}))};
 // Expedition Mode: hunt attacks count toward Combat Duty with the option (verified Founder benefit) snapshotted at entry.
 for(const h of team){const u=combat.team.find(x=>x.id===h.tokenId);h.chakra.hunt={...u,entryId:id,ends:combat.ends,spent:0,...(duty?{duty}:{})};h.chakra.lockUntil=combat.ends;h.chakra.resting=false;C.recover(h,now,p.dojo);}
 await save(c,store,wallet,p);await c.query('UPDATE ryo_hunt_entries SET combat=$3,started=$4 WHERE scope=$1 AND id=$2',[store.scope,id,JSON.stringify(combat),now]);
 return {id,started:now,seconds:60,guardian:row.guardian,team:combat.team.map(u=>u.id),pending:false,combat,chakra:C.snapshot(p,now)};
 });}
async function report(store,wallet,body){
 if(typeof body.entryId!=='string')fail('Choose a hunt.');
 return store.transaction(async c=>{
  await store.locked(c,wallet);const e=(await c.query('SELECT * FROM ryo_hunt_entries WHERE scope=$1 AND id=$2 AND wallet=$3 FOR UPDATE',[store.scope,body.entryId,wallet])).rows[0];if(!e)fail('That hunt is not yours.');
  const payment=(await c.query('SELECT status FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND request_id=$3',[store.scope,wallet,e.id])).rows[0];
  if(payment?.status!=='confirmed'||!e.combat?.team)return {damage:Number(e.damage),pending:true};
  const now=store.now(),combat=e.combat,p=await store.profileLocked(c,wallet);
  if(body.finish===true)combat.ends=Math.min(combat.ends,now);
  const actual=combat.team.reduce((n,u)=>n+attacks(u,now,combat.ends)*u.power,0);
  for(const h of p.heroes){if(h.chakra?.hunt?.entryId===e.id)h.chakra.hunt.ends=Math.min(h.chakra.hunt.ends,combat.ends);C.recover(h,now,p.dojo);}
  const kept=Math.max(Number(e.damage),actual);await save(c,store,wallet,p);
  await c.query('UPDATE ryo_hunt_entries SET damage=$3,reported=$4,combat=$5 WHERE scope=$1 AND id=$2',[store.scope,e.id,kept,now,JSON.stringify(combat)]);
  return {damage:kept,capped:Number(body.damage)>kept,closed:now>=combat.ends,chakra:C.snapshot(p,now)};
 });
}
module.exports={SCHEMA,activate,report,attacks};
