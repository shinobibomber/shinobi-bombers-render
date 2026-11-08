'use strict';
const R=require('./hero-upgrade-rules.cjs'),{fail}=require('./store.cjs');
function trainingQuote(profile,q){
 if(q.product!=='training')return q;
 R.normalize(profile);const hero=profile.heroes.find(h=>h.tokenId===q.params.heroId),cost=R.shards(hero?.rank);
 if(!hero||!cost||hero.level>=5)fail('Choose an owned hero below level 5.');
 if(profile.upgradeShards<cost)fail('Training requires '+cost+' Upgrade Shard(s). You have '+profile.upgradeShards+'. Salvage a spare in-game hero first.',409);
 q.params={...q.params,upgradeRulesVersion:R.VERSION};q.training={version:R.VERSION,shards:cost,level:hero.level};return q;
}
function consume(profile,q){
 if(q.product!=='training')return;
 const hero=profile.heroes.find(h=>h.tokenId===q.params.heroId);R.normalize(profile);
 if(q.training?.version!==R.VERSION||q.params.upgradeRulesVersion!==R.VERSION||!hero||hero.level!==q.training.level||hero.level>=5||q.training.shards!==R.shards(hero.rank))fail('Training rules or hero level changed. Review a new quote.',409);
 if(profile.upgradeShards<q.training.shards)fail('Not enough Upgrade Shards.',409);
 profile.upgradeShards-=q.training.shards;
}
function settlementShards(current,row){
 R.normalize(current);
 // Orders already pending when this feature ships retain their agreed terms.
 if(row.product!=='training'||row.quote?.training?.version!==R.VERSION)return current.upgradeShards;
 const cost=row.quote.training.shards;if(!Number.isSafeInteger(cost)||cost<1||current.upgradeShards<cost)fail('Reserved Upgrade Shards are unavailable. Contact support.',409);
 return current.upgradeShards-cost;
}
function salvageProfile(profile,heroId,now){
 R.normalize(profile);const hero=profile.heroes.find(h=>h.tokenId===heroId);
 if(!hero)fail('Choose an owned in-game hero.');
 if(hero.nft)fail('NFT-bound heroes cannot be salvaged. Their ownership and NFT remain intact.',409);
 if(hero.chakra?.lockUntil>now)fail('Finish the Boss Hunt before salvaging this hero.',409);
 const amount=R.shards(hero.rank);if(!amount||!Number.isSafeInteger(profile.upgradeShards+amount))fail('Invalid shard balance.',409);
 profile.heroes=profile.heroes.filter(h=>h.tokenId!==heroId);profile.battleReady=profile.battleReady.filter(id=>id!==heroId);profile.upgradeShards+=amount;
 return {heroId,rank:hero.rank,shards:amount,hero};
}
async function salvage(store,wallet,body){
 if(typeof body.heroId!=='string'||body.heroId.length>160||typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId)||body.salvageRulesVersion!==R.VERSION)fail('Review the salvage confirmation again.');
 await require('./economic-dashboard.cjs').guard(store,'purchase',wallet,{});
 return store.transaction(async c=>{
  await store.locked(c,wallet);
  const old=(await c.query('SELECT hero_id,rank,shards FROM ryo_hero_salvages WHERE scope=$1 AND wallet=$2 AND request_id=$3',[store.scope,wallet,body.requestId])).rows[0];
  if(old){if(old.hero_id!==body.heroId)fail('Salvage request belongs to another hero.',409);return {heroId:old.hero_id,rank:old.rank,shards:old.shards};}
  if((await c.query("SELECT request_id FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1",[store.scope,wallet])).rows.length)fail('Wait for the pending purchase to settle before salvaging a hero.',409);
  const profile=await store.profileLocked(c,wallet),now=store.now();
  // Validate before settlement; invalid requests cannot alter the collection.
  salvageProfile(structuredClone(profile),body.heroId,now);
  await require('./adventure.cjs').settleLocked(store,c,wallet,profile,false);
  const result=salvageProfile(profile,body.heroId,now);
  await c.query('INSERT INTO ryo_hero_salvages(scope,wallet,request_id,hero_id,rank,shards,hero,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[store.scope,wallet,body.requestId,result.heroId,result.rank,result.shards,JSON.stringify(result.hero),now]);
  await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[store.scope,wallet,JSON.stringify(profile)]);
  return {heroId:result.heroId,rank:result.rank,shards:result.shards};
 });
}
module.exports={trainingQuote,consume,settlementShards,salvageProfile,salvage};
