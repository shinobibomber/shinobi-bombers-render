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

/* Legacy report parser retained for compatibility. Settlement uses combat-adventure.cjs. */
function killReport(r){
 if(!r||typeof r.killSession!=='string'||!/^[-a-zA-Z0-9_]{8,64}$/.test(r.killSession)||!Array.isArray(r.killTotals)||r.killTotals.length!==8||!r.killTotals.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1e7))return null;
 return {id:r.killSession,totals:r.killTotals,stage:Number.isSafeInteger(r.killStage)&&r.killStage>=1&&r.killStage<=1e6?r.killStage:1};
}
/* Hero training (max level 5). Every level-up is a stored, server-rolled +1: Genin and Chunin gain
   Power, Jonin/Elite/Legend gain a random stat, and Lv4→5 gives two +1s (random rolls may repeat).
   A hero's stats are its base (rolled inside its rank's band) plus this bonus, in the browser battle
   (GameBalance.recalculateHero), in Sensei offline time and in the kill budget alike. */
// Rank 5 is Mythic (Tsukiyomi, NFT only): one band above Legend; it trains at twice Legend prices.
const STAT_BANDS=[[1,3],[3,6],[6,9],[9,12],[12,15],[17,20]],STATS=['pw','sp','st'],MAX_LEVEL=5;
function trainingPrice(rank,level){return require('./hero-upgrade-rules.cjs').trainingPrice(rank,level)}
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
 return require('./combat-rules.cjs').stats(h);
}
// Maximum sustained Power-based action rate of the strongest ten battle-ready heroes.
function teamDps(roster){
 const rules=require('./combat-rules.cjs');return roster.map(h=>rules.damage(h)/rules.cooldown(h)).sort((a,b)=>b-a).slice(0,10).reduce((n,v)=>n+v,0);
}
/* Hero identity: perks (rank+1 distinct, the game's own perks(r) pool) and look (character model 0–7)
   are stored on the server, so every device and every Market buyer sees the same hero. Heroes
   minted before this get a permanent roll from their token id, so normalizing never changes it. */
function rollIdentity(rank,rand){
 return {perks:require('./combat-rules.cjs').normalizePerks(rank,[],rand),look:rand(8)};
}
function assignIdentity(h){
 return require('./combat-identity.cjs').assign(h);
}
/* Token purchase split (summons, training, Dojo, Sensei, fusion): the price is the total charged;
   2% studio, 10% treasury and 8% burned leave custody on-chain, and the remaining 80% stays as
   operations income that funds the Adventure reward pool. */
function purchaseSplit(base){
 const studioFee=Math.floor(base*2/100),treasury=Math.floor(base*10/100),burn=Math.floor(base*8/100);
 return {studioFee,treasury,burn,operations:base-studioFee-treasury-burn};
}
Object.assign(module.exports,{MAX_LEVEL,trainingPrice,levelUp,migrateHero,trainedStats,rollIdentity,assignIdentity,purchaseSplit});
module.exports.teamDps=teamDps;module.exports.killReport=killReport;
