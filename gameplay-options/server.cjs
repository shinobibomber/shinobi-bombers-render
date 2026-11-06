/* Authenticated Sensei preferences. Settle elapsed time with the old settings first. */
const {fail}=require('./store.cjs');
async function saveSenseiSettings(store,wallet,body){
 const percent=body.returnPercent;
 if(!Number.isInteger(percent)||percent<50||percent>90||typeof body.enabled!=='boolean')fail('Choose a return threshold from 50% to 90% and an on/off setting.');
 return store.transaction(async c=>{
  await store.locked(c,wallet);
  if((await c.query("SELECT request_id FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1",[store.scope,wallet])).rows.length)fail('Wait for the pending purchase to settle before changing Sensei settings.',409);
  const profile=await store.profileLocked(c,wallet),now=store.now();
  if(!profile.sensei&&Number(profile.senseiRentalUntil||0)<=now)fail('Hire or rent Sensei first.');
  await require('./adventure.cjs').settleLocked(store,c,wallet,profile,body.active===true);
  if(profile.senseiEnabled===false&&body.enabled)profile.senseiEnabledSince=now;
  profile.senseiReturnPercent=percent;profile.senseiEnabled=body.enabled;
  await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[store.scope,wallet,JSON.stringify(profile)]);
  return profile;
 });
}
module.exports={saveSenseiSettings};

/* Adventure kill credit. The browser battle reports its cumulative kills per page session
   (tier × Fortune bonus); the server credits them at its own reward table, but only within the
   damage the team could have dealt online (teamDps), with 1.5× slack for sync timing. Totals are cumulative, so a retried or replayed
   request never pays twice, and kills over budget wait until budget accrues. */
const KILL_HP=[100,213,1000,1625],KILL_PAY=[35625,81250,406250,812500],KILL_SLACK=1.5,KILL_CARRY=4000,KILL_SESSIONS=4;
function killReport(r){
 if(!r||typeof r.killSession!=='string'||!/^[-a-zA-Z0-9_]{8,64}$/.test(r.killSession)||!Array.isArray(r.killTotals)||r.killTotals.length!==8||!r.killTotals.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1e7))return null;
 return {id:r.killSession,totals:r.killTotals,stage:Number.isSafeInteger(r.killStage)&&r.killStage>=1&&r.killStage<=1e6?r.killStage:1};
}
function creditKills(d,tally,budget,rate,now){
 if(!d.reports||typeof d.reports!=='object')d.reports={};
 const done=(d.reports[tally.id]?.t||[0,0,0,0,0,0,0,0]).slice();
 // A stage can only be under-reported down to one stage per 100 credited kills (the payout taper).
 const stage=Math.max(tally.stage,Math.floor((d.reportedKills||0)/100)+1),taper=Math.max(.35,1-.1*Math.floor(stage/100));
 let room=(d.reportBudget||0)+budget*KILL_SLACK;
 for(let i=0;i<8;i++){const kind=i>>1,bonus=i&1;
  while(done[i]<tally.totals[i]&&room>=KILL_HP[kind]){room-=KILL_HP[kind];done[i]++;d.pending+=Math.floor(KILL_PAY[kind]*taper*rate*(bonus?1.15:1));d.kills++;d.reportedKills=(d.reportedKills||0)+1}
 }
 d.reportBudget=Math.min(KILL_CARRY,room);d.map=stage;d.lastReport=now;d.reports[tally.id]={t:done,at:now};
 for(const id of Object.keys(d.reports).sort((a,b)=>d.reports[b].at-d.reports[a].at).slice(KILL_SESSIONS))delete d.reports[id];
}
// Online damage while a client is reporting but this call carries no report (e.g. a roster change):
// bank it for the next report instead of paying the server's own kill sequence a second time.
function bankKills(d,budget){d.reportBudget=Math.min(KILL_CARRY,(d.reportBudget||0)+budget*KILL_SLACK)}
/* Hero training (max level 5). Every level-up is a stored, server-rolled +1: Genin and Chunin gain
   Power, Jonin/Elite/Legend gain a random stat, and Lv4→5 gives two +1s (random rolls may repeat).
   A hero's stats are its base (rolled inside its rank's band) plus this bonus, in the browser battle
   (GameBalance.recalculateHero), in Sensei offline time and in the kill budget alike. */
const STAT_BANDS=[[1,3],[3,6],[6,9],[9,12],[12,15]],STATS=['pw','sp','st'],MAX_LEVEL=5;
const TRAINING_STEP=[10000,20000,40000,80000],TRAINING_RANK=[1,1.5,2,2.5,3];
function trainingPrice(rank,level){return Math.round(TRAINING_STEP[level-1]*TRAINING_RANK[rank])}
function levelUp(h,rand){
 const gains={},rolls=h.level+1===MAX_LEVEL?2:1;h.bonus={pw:0,sp:0,st:0,...h.bonus};
 for(let i=0;i<rolls;i++){const key=h.rank<=1?'pw':STATS[rand(3)];h.bonus[key]++;gains[key]=(gains[key]||0)+1}
 h.level++;return gains;
}
// Heroes trained under the old 10-level system keep up to level 5 and receive the +1s those levels
// now give. Rolls come from the token id, so normalizing again never changes them.
function migrateHero(h){
 if(h.trainingVersion===2)return h;
 const target=Math.max(1,Math.min(MAX_LEVEL,Math.floor(Number(h.level))||1));let step=0;
 h.level=1;h.bonus={pw:0,sp:0,st:0};
 while(h.level<target)levelUp(h,n=>require('node:crypto').createHash('sha256').update(h.tokenId+':training:'+step++).digest()[0]%n);
 h.trainingVersion=2;return h;
}
function trainedStats(h){
 const lo=(STAT_BANDS[h.rank]||STAT_BANDS[0])[0];
 return Object.fromEntries(STATS.map(k=>[k,(Number(h.baseStats?.[k])||lo)+(Number(h.bonus?.[k])||0)]));
}
// Top damage per second of the 10 strongest battle-ready heroes at their trained stats, with the
// battle's cooldown (rank+1 shots per max(.6,1.6-speed×.05)s) and the best perks (+1 damage, 15%
// faster). Base stats alone under-count trained heroes, so their kills used to queue.
function teamDps(roster){
 return roster.map(h=>{const s=trainedStats(h);
  return (h.rank+1)*(Math.max(1,s.pw)+1)/(Math.max(.6,1.6-s.sp*.05)*.85)}).sort((a,b)=>b-a).slice(0,10).reduce((n,v)=>n+v,0);
}
/* Hero identity: perks (rank+1 distinct, the game's own perks(r) pool) and look (character model 0–7)
   are stored on the server, so every device and every Market buyer sees the same hero. Heroes
   minted before this get a permanent roll from their token id, so normalizing never changes it. */
function rollIdentity(rank,rand){
 const pool=[0,1,2,3,4,6];if(rank>0)pool.push(5);const perks=[];
 for(let n=0;n<rank+1&&pool.length;n++)perks.push(pool.splice(rand(pool.length),1)[0]);
 return {perks,look:rand(8)};
}
function assignIdentity(h){
 if(h.identityVersion===1&&Array.isArray(h.perks)&&Number.isInteger(h.look))return h;
 let step=0;const rand=n=>require('node:crypto').createHash('sha256').update(h.tokenId+':identity:'+step++).digest().readUInt32BE(0)%n;
 Object.assign(h,rollIdentity(Math.max(0,Math.min(4,Number(h.rank)||0)),rand),{identityVersion:1});return h;
}
Object.assign(module.exports,{MAX_LEVEL,trainingPrice,levelUp,migrateHero,trainedStats,rollIdentity,assignIdentity});
module.exports.teamDps=teamDps;module.exports.killReport=killReport;module.exports.creditKills=creditKills;module.exports.bankKills=bankKills;
