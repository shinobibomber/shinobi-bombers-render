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
