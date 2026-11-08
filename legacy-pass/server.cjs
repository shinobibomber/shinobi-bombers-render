'use strict';
const crypto=require('node:crypto'),R=require('./legacy-pass-rules.cjs'),{fail}=require('./store.cjs');
const contexts=new WeakMap();
const enabled=()=>String(process.env.SHINOBI_LEGACY_PASS||'').toLowerCase()==='on'&&String(process.env.PRELAUNCH_MODE||'').toLowerCase()!=='on';
const setContext=(store,ctx)=>contexts.set(store,ctx);
function activityCollector(now){
 const events=[];if(!enabled())return{events,push:null};
 const sums=new Map(),week=R.week(now).id;
 return{events,push(e){if(Number.isFinite(e.at)&&R.week(e.at).id!==week)return;const key=e.id||e.kind+':'+(e.heroId||'');let row=sums.get(key);if(!row){row={...e};sums.set(key,row);events.push(row);}else if(!e.id)row.quantity+=e.quantity;}};
}
const save=(store,c,wallet,p)=>c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[store.scope,wallet,JSON.stringify(p)]);
const pending=async(store,c,wallet)=>(await c.query("SELECT request_id FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1",[store.scope,wallet])).rows.length>0;
const requestId=id=>{if(typeof id!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(id))fail('Use a unique redemption request ID.');return id;};
async function eligible(store,wallet,c=store.pool){
 const ctx=contexts.get(store);if(!ctx?.connection||!ctx.checkNetwork)fail('Finalized NFT verification is unavailable.',503);
 await ctx.checkNetwork();
 const registry=(await c.query("SELECT serial,mint FROM ryo_mythic_boxes WHERE scope=$1 AND status='confirmed' AND serial BETWEEN 1 AND 20 ORDER BY serial",[store.scope])).rows;
 if(!registry.length)return [];
 const held=await require('./mythic-hero.cjs').heldMints(ctx.connection,wallet,{mints:new Set(registry.map(r=>r.mint)),collection:null});
 return registry.filter(r=>held.includes(r.mint));
}
async function owned(store,wallet,serial,c){const nft=(await eligible(store,wallet,c)).find(n=>n.serial===serial);if(!nft)fail('Hold the registered Founder NFT for this serial on the correct network.',403);return nft;}
async function balance(store,c,wallet){return Number((await c.query('SELECT COALESCE(SUM(delta),0) AS n FROM ryo_legacy_fragments WHERE scope=$1 AND wallet=$2',[store.scope,wallet])).rows[0].n);}
async function passLocked(store,c,serial,mint,week){await c.query("INSERT INTO ryo_legacy_passes(scope,week,serial,mint,created) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",[store.scope,week,serial,mint,store.now()]);const p=(await c.query('SELECT * FROM ryo_legacy_passes WHERE scope=$1 AND week=$2 AND serial=$3 FOR UPDATE',[store.scope,week,serial])).rows[0];if(p?.mint!==mint)fail('NFT serial registry conflict.',503);return p;}
async function recoveryBaseline(store,c,wallet,profile){for(const h of profile.heroes){const total=Number(h.chakra?.legacyRecovered)||0;await c.query('INSERT INTO ryo_legacy_recovery(scope,wallet,hero_id,total) VALUES($1,$2,$3,$4) ON CONFLICT(scope,wallet,hero_id) DO UPDATE SET total=$4',[store.scope,wallet,h.tokenId,total]);}}
async function select(store,wallet,serial){
 if(!Number.isInteger(serial))fail('Choose a Founder NFT serial.');
 return store.transaction(async c=>{await store.locked(c,wallet);const nft=await owned(store,wallet,serial,c),week=R.week(store.now()).id,p=await store.profileLocked(c,wallet);
  // Settle before changing entitlement: old activity cannot be replayed into the new pass.
  const active=(await c.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2',[store.scope,wallet])).rows[0]?.data?.active===true;
  await require('./adventure.cjs').settleLocked(store,c,wallet,p,active);
  await passLocked(store,c,serial,nft.mint,week);await recoveryBaseline(store,c,wallet,p);
  await c.query('INSERT INTO ryo_legacy_wallets(scope,wallet,week,serial) VALUES($1,$2,$3,$4) ON CONFLICT(scope,wallet) DO UPDATE SET week=$3,serial=$4',[store.scope,wallet,week,serial]);return {serial,week};
 });
}
// Called only inside existing server transactions with already-accepted activity.
async function recordLocked(store,c,wallet,events){
 if(!enabled()||!events.length)return;
 const week=R.week(store.now()).id,a=(await c.query('SELECT week,serial FROM ryo_legacy_wallets WHERE scope=$1 AND wallet=$2',[store.scope,wallet])).rows[0];
 if(!a||a.week!==week||!a.serial)return;
 // Ownership must still be finalized now; an RPC outage never invents progress.
 let nft;try{nft=(await eligible(store,wallet,c)).find(n=>n.serial===a.serial);}catch{return;}if(!nft)return;
 const row=await passLocked(store,c,a.serial,nft.mint,week),p=R.normalize(row.progress);
 let changed=false;const merged=new Map();for(const e of events){if(Number.isFinite(e.at)&&R.week(e.at).id!==week)continue;const key=e.id||e.kind+':'+(e.heroId||'');if(e.id)merged.set(key,e);else{const old=merged.get(key);merged.set(key,{...e,quantity:(old?.quantity||0)+e.quantity});}}
 for(const e of merged.values()){
  if(!['attacks','kills','stages','recovery','hunts'].includes(e.kind)||!Number.isFinite(e.quantity)||e.quantity<=0)continue;
  // Accepted Adventure counters already prevent replay. Stop writing saturated counters;
  // stable Hunt IDs still receive receipts so a report cannot move into another pass.
  if(!e.id&&((e.kind==='attacks'&&p.attacks>=50&&p.heroes.length>=3)||(e.kind==='kills'&&p.kills>=30)||(e.kind==='stages'&&p.stages>=10)||(e.kind==='recovery'&&p.recovery>=60)))continue;
  const id=e.id||crypto.randomUUID();const inserted=await c.query('INSERT INTO ryo_legacy_events(scope,wallet,event_id,week,serial,kind,quantity,hero_id,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING event_id',[store.scope,wallet,id,week,a.serial,e.kind,e.quantity,e.heroId||null,store.now()]);if(!inserted.rows.length)continue;
  changed=true;p[e.kind]+=e.quantity;if(e.kind==='attacks'&&e.heroId&&!p.heroes.includes(e.heroId))p.heroes.push(e.heroId);
 }
 if(changed)await c.query('UPDATE ryo_legacy_passes SET progress=$4 WHERE scope=$1 AND week=$2 AND serial=$3',[store.scope,week,a.serial,JSON.stringify(R.normalize(p))]);
}
async function flushLocked(store,c,wallet,profile,events=[]){
 if(!enabled())return;
 const a=(await c.query('SELECT week,serial FROM ryo_legacy_wallets WHERE scope=$1 AND wallet=$2',[store.scope,wallet])).rows[0];if(!a?.serial||a.week!==R.week(store.now()).id)return;
 const watermarks=new Map((await c.query('SELECT hero_id,total FROM ryo_legacy_recovery WHERE scope=$1 AND wallet=$2',[store.scope,wallet])).rows.map(r=>[r.hero_id,r]));
 for(const h of profile.heroes){const total=Number(h.chakra?.legacyRecovered)||0,old=watermarks.get(h.tokenId);
  if(old&&total===Number(old.total))continue;
  if(old&&total>Number(old.total))events.push({kind:'recovery',quantity:total-Number(old.total),heroId:h.tokenId});
  await c.query('INSERT INTO ryo_legacy_recovery(scope,wallet,hero_id,total) VALUES($1,$2,$3,$4) ON CONFLICT(scope,wallet,hero_id) DO UPDATE SET total=$4',[store.scope,wallet,h.tokenId,total]);
 }
 await recordLocked(store,c,wallet,events);
}
async function status(store,wallet){
 const nfts=await eligible(store,wallet),now=store.now(),week=R.week(now),a=(await store.pool.query('SELECT * FROM ryo_legacy_wallets WHERE scope=$1 AND wallet=$2',[store.scope,wallet])).rows[0];
 const serial=a?.week===week.id&&nfts.some(n=>n.serial===a.serial)?a.serial:null;
 const pass=serial?(await store.pool.query('SELECT progress FROM ryo_legacy_passes WHERE scope=$1 AND week=$2 AND serial=$3',[store.scope,week.id,serial])).rows[0]:null;
 const claims=serial?(await store.pool.query('SELECT milestone,result FROM ryo_legacy_claims WHERE scope=$1 AND week=$2 AND serial=$3',[store.scope,week.id,serial])).rows:[];
 const items=(await store.pool.query("SELECT id,kind,status,expires FROM ryo_legacy_items WHERE scope=$1 AND wallet=$2 AND status<>'used' AND (expires>$3 OR status='reserved') ORDER BY created",[store.scope,wallet,now])).rows;
 const deliveries=(await store.pool.query("SELECT request_id,hero,status FROM ryo_legacy_redemptions WHERE scope=$1 AND wallet=$2 AND status='queued' ORDER BY created",[store.scope,wallet])).rows;
 return{enabled:true,week,serverTime:now,nfts,serial,missions:R.missions(pass?.progress),xp:R.xp(pass?.progress),milestones:R.MILESTONES.map(x=>({xp:x,...R.reward(x),claimed:claims.some(c=>c.milestone===x)})),fragments:await balance(store,store.pool,wallet),items,selectedVoucher:a?.voucher||null,deliveries,odds:R.ODDS,stageVerification:'Server-simulated stage completions count. Client-reported online stage numbers are not proof.',limits:{shards:3,tickets:1,vouchers:1,fragments:1}};
}
async function claim(store,wallet,body){
 const serial=body.serial,milestone=body.milestone;if(!R.reward(milestone))fail('Choose a reward milestone.');
 return store.transaction(async c=>{await store.locked(c,wallet);const nft=await owned(store,wallet,serial,c),now=store.now(),week=R.week(now).id,row=await passLocked(store,c,serial,nft.mint,week);
  const old=(await c.query('SELECT result FROM ryo_legacy_claims WHERE scope=$1 AND week=$2 AND serial=$3 AND milestone=$4',[store.scope,week,serial,milestone])).rows[0];if(old)return{...old.result,alreadyClaimed:true};
  if(R.xp(row.progress)<milestone)fail('Complete more verified missions first.',409);
  const reward=R.reward(milestone),result={...reward,serial,week,milestone};
  if(reward.kind==='shards'){const p=await store.profileLocked(c,wallet);if(!Number.isSafeInteger(p.upgradeShards+reward.quantity))fail('Upgrade Shard capacity exceeded.',409);p.upgradeShards+=reward.quantity;await save(store,c,wallet,p);}
  else if(reward.kind==='fragment')await c.query('INSERT INTO ryo_legacy_fragments(scope,wallet,event_id,delta,created) VALUES($1,$2,$3,1,$4)',[store.scope,wallet,'milestone:'+week+':'+serial,now]);
  else {const count=Number((await c.query("SELECT COUNT(*) AS n FROM ryo_legacy_items WHERE scope=$1 AND wallet=$2 AND kind=$3 AND status<>'used' AND (expires>$4 OR status='reserved')",[store.scope,wallet,reward.kind,now])).rows[0].n);if(count>=R.ITEM_CAP)fail('Inventory full: use or wait for an item to expire before claiming.',409);result.itemId=crypto.randomUUID();result.expires=now+R.EXPIRY;await c.query("INSERT INTO ryo_legacy_items(scope,id,wallet,kind,status,expires,created) VALUES($1,$2,$3,$4,'available',$5,$6)",[store.scope,result.itemId,wallet,reward.kind,result.expires,now]);}
  await c.query('INSERT INTO ryo_legacy_claims(scope,week,serial,milestone,wallet,result,created) VALUES($1,$2,$3,$4,$5,$6,$7)',[store.scope,week,serial,milestone,wallet,JSON.stringify(result),now]);return result;
 });
}
function rollHero(randomInt=crypto.randomInt){const h=require('./economy.cjs').hero(R.premiumRank(randomInt(10000)));return{...h,accountBound:true,legacyPassReward:true,referralReward:true,rewardSource:'shinobi-legacy-pass'};}
async function deliverLocked(store,c,wallet,row){
 if(row.status==='delivered')return row;
 const p=await store.profileLocked(c,wallet);if(p.heroes.length>=500||await pending(store,c,wallet))return row;
 if(!p.heroes.some(h=>h.tokenId===row.hero.tokenId))p.heroes.push(row.hero);await save(store,c,wallet,p);
 await c.query("UPDATE ryo_legacy_redemptions SET status='delivered',delivered=$4 WHERE scope=$1 AND wallet=$2 AND request_id=$3",[store.scope,wallet,row.request_id,store.now()]);return{...row,status:'delivered'};
}
async function redeem(store,wallet,body){
 const id=requestId(body.requestId);
 return store.transaction(async c=>{await store.locked(c,wallet);let row=(await c.query('SELECT * FROM ryo_legacy_redemptions WHERE scope=$1 AND wallet=$2 AND request_id=$3 FOR UPDATE',[store.scope,wallet,id])).rows[0];if(row)return deliverLocked(store,c,wallet,row);
  if(await balance(store,c,wallet)<2)fail('Two Premium Summon Fragments are required.',409);
  const hero=rollHero();hero.legacyRedemptionId=id;const now=store.now();
  await c.query('INSERT INTO ryo_legacy_fragments(scope,wallet,event_id,delta,created) VALUES($1,$2,$3,-2,$4)',[store.scope,wallet,'redeem:'+wallet+':'+id,now]);
  row=(await c.query("INSERT INTO ryo_legacy_redemptions(scope,wallet,request_id,hero,status,created) VALUES($1,$2,$3,$4,'queued',$5) RETURNING *",[store.scope,wallet,id,JSON.stringify(hero),now])).rows[0];return deliverLocked(store,c,wallet,row);
 });
}
async function deliver(store,wallet,body){return store.transaction(async c=>{await store.locked(c,wallet);const row=(await c.query('SELECT * FROM ryo_legacy_redemptions WHERE scope=$1 AND wallet=$2 AND request_id=$3 FOR UPDATE',[store.scope,wallet,requestId(body.requestId)])).rows[0];if(!row)fail('Choose an owned premium redemption.');return deliverLocked(store,c,wallet,row);});}
async function ticket(store,wallet,body){return store.transaction(async c=>{
 await store.locked(c,wallet);if(await pending(store,c,wallet))fail('Settle the pending purchase before using a recovery ticket.',409);
 const now=store.now(),p=await store.profileLocked(c,wallet),h=p.heroes.find(h=>h.tokenId===body.heroId);if(!h)fail('Choose an owned resting hero.');
 const item=(await c.query("SELECT * FROM ryo_legacy_items WHERE scope=$1 AND wallet=$2 AND id=$3 AND kind='ticket' FOR UPDATE",[store.scope,wallet,body.itemId])).rows[0];
 if(!item||item.status!=='available'||Number(item.expires)<=now)fail('Recovery ticket is unavailable or expired.',409);
 if(p.heroes.some(h=>h.chakra?.lockUntil>now))fail('Recovery tickets cannot be used during an active Boss Hunt.',409);
 const adv=(await c.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2',[store.scope,wallet])).rows[0]?.data;if(adv?.active&&adv.team?.includes(h.tokenId))fail('Rest this hero before using a recovery ticket.',409);
 const C=require('./combat-chakra.cjs'),s=C.recover(h,now,p.dojo);if(!s.resting)fail('Choose a resting hero.',409);
 await flushLocked(store,c,wallet,p);const max=require('./combat-rules.cjs').maxChakra(h),gain=Math.min(max-s.value,max*.25,20);if(gain<=0)fail('This hero already has full chakra.',409);
 s.value=Math.min(max,s.value+gain);await save(store,c,wallet,p);await c.query("UPDATE ryo_legacy_items SET status='used',used=$4 WHERE scope=$1 AND wallet=$2 AND id=$3",[store.scope,wallet,item.id,now]);return{heroId:h.tokenId,restored:gain,value:s.value};
 });}
async function chooseVoucher(store,wallet,id){return store.transaction(async c=>{await store.locked(c,wallet);if(id){const item=(await c.query("SELECT id FROM ryo_legacy_items WHERE scope=$1 AND wallet=$2 AND id=$3 AND kind='voucher' AND status='available' AND expires>$4",[store.scope,wallet,id,store.now()])).rows[0];if(!item)fail('Training voucher is unavailable or expired.');}await c.query('INSERT INTO ryo_legacy_wallets(scope,wallet,week,voucher) VALUES($1,$2,$3,$4) ON CONFLICT(scope,wallet) DO UPDATE SET voucher=$4',[store.scope,wallet,R.week(store.now()).id,id||null]);return{selectedVoucher:id||null};});}
async function trainingQuoteLocked(store,c,wallet,profile,q){
 if(q.product!=='training'||!enabled())return q;
 let id=q.params.legacyVoucherId;if(!id)id=(await c.query('SELECT voucher FROM ryo_legacy_wallets WHERE scope=$1 AND wallet=$2',[store.scope,wallet])).rows[0]?.voucher;if(!id)return q;
 const item=(await c.query("SELECT * FROM ryo_legacy_items WHERE scope=$1 AND wallet=$2 AND id=$3 AND kind='voucher'",[store.scope,wallet,id])).rows[0];if(!item||item.status!=='available'||Number(item.expires)<=store.now())fail('Selected training voucher is unavailable or expired. Choose another quote.',409);
 if(!(await eligible(store,wallet,c)).length)fail('A current Founder NFT holder is required for the training voucher.',403);
 const hero=profile.heroes.find(h=>h.tokenId===q.params.heroId),raw=require('./gameplay-options.cjs').trainingPrice(hero.rank,hero.level),standard=Math.round(raw*.9),saved=Math.min(10000,standard-Math.round(raw*.85)),price=standard-saved;
 const sr=require('./sr-revenue.cjs'),split=sr.enabled()?sr.split(price):require('./gameplay-options.cjs').purchaseSplit(price);
 return{...q,...split,base:price,total:price,params:{...q.params,legacyVoucherId:id},legacyVoucher:{id,standard,savings:saved,totalDiscountPercent:15,extraSavingsCap:10000},title:'Train '+hero.name+' · Legacy holder discount: 15% total (extra savings capped at 10,000 Ryo)'};
}
async function reserveVoucherLocked(store,c,wallet,id,q){if(!q.legacyVoucher)return;const result=await c.query("UPDATE ryo_legacy_items SET status='reserved',reserved_by=$4 WHERE scope=$1 AND wallet=$2 AND id=$3 AND status='available' AND expires>$5 RETURNING id",[store.scope,wallet,q.legacyVoucher.id,id,store.now()]);if(!result.rows.length)fail('Training voucher could not be reserved.',409);}
async function settleVoucherLocked(store,c,wallet,row,status){if(!row.quote?.legacyVoucher)return;const id=row.quote.legacyVoucher.id;
 const result=await c.query("UPDATE ryo_legacy_items SET status=$5,used=$6,reserved_by=NULL WHERE scope=$1 AND wallet=$2 AND id=$3 AND status='reserved' AND reserved_by=$4 RETURNING id",[store.scope,wallet,id,row.request_id,status==='confirmed'?'used':'available',status==='confirmed'?store.now():null]);if(!result.rows.length)fail('Reserved training voucher is missing.',503);
 if(status==='confirmed')await c.query('UPDATE ryo_legacy_wallets SET voucher=NULL WHERE scope=$1 AND wallet=$2 AND voucher=$3',[store.scope,wallet,id]);
}
async function quote(store,wallet,product,params){return store.transaction(async c=>{await store.locked(c,wallet);const p=await store.profileLocked(c,wallet);return trainingQuoteLocked(store,c,wallet,p,require('./economy.cjs').quote(p,product,params));});}
async function handle(store,wallet,action,body={}){
 if(!enabled())fail('The Shinobi Legacy Pass is not enabled.',404);
 if(action!=='legacy-status'){require('./launch-gates.cjs').check('creator-redeem',{});await require('./economic-dashboard.cjs').guard(store,'purchase',wallet,{});}
 let result;
 if(action==='legacy-status')return{legacy:await status(store,wallet)};
 if(action==='legacy-select')result=await select(store,wallet,body.serial);
 else if(action==='legacy-claim')result=await claim(store,wallet,body);
 else if(action==='legacy-redeem')result=await redeem(store,wallet,body);
 else if(action==='legacy-deliver')result=await deliver(store,wallet,body);
 else if(action==='legacy-ticket')result=await ticket(store,wallet,body);
 else if(action==='legacy-voucher')result=await chooseVoucher(store,wallet,body.itemId);
 else fail('Unknown Legacy Pass action.',404);
 return{legacy:await status(store,wallet),legacyResult:result};
}
module.exports={enabled,setContext,activityCollector,eligible,owned,select,status,claim,redeem,deliver,ticket,chooseVoucher,recordLocked,flushLocked,rollHero,trainingQuoteLocked,reserveVoucherLocked,settleVoucherLocked,quote,handle};
