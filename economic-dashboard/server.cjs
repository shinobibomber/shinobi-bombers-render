'use strict';
const crypto=require('node:crypto');
const {fail}=require('./store.cjs');
const MARKER='ryo-economic-dashboard-v1';
const PAUSES=['purchases','withdrawals','claims'];
// Market buys and new listings follow the purchases pause.
const GATES={purchase:'purchases','market-buy':'purchases','market-post':'purchases','market-offer':'purchases','market-accept':'purchases',withdraw:'withdrawals','claim-adventure':'claims'};
const DEFAULTS={vaults:[],seasons:[],financial:null,monitor:{concentrationPercent:40,claimRyo:100000,pendingMinutes:30}};
const canonical=x=>x&&typeof x==='object'?(Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}'):JSON.stringify(x);
const digest=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
function role(wallet){
 const list=name=>String(process.env[name]||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(list('RYO_ADMIN_APPROVERS').includes(wallet))return 'approver';
 if(list('RYO_ADMIN_OPERATORS').includes(wallet))return 'operator';
 if(list('RYO_ADMIN_VIEWERS').includes(wallet))return 'viewer';
 fail('This wallet has no economic dashboard access. Ask the service owner to configure its admin role.',403);
}
function text(value,max=240){if(typeof value!=='string'||!value.trim()||value.length>max)fail('A non-empty text value is required (maximum '+max+' characters).');return value.trim()}
function safeNum(x){const n=Number(x||0);if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER)fail('An aggregate exceeds safe display precision. Export raw ledger data for review.',503);return n}
function int(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)fail('Value must be a whole number between '+min+' and '+max+'.');return value}
function address(value){try{const {PublicKey}=require('@solana/web3.js');if(new PublicKey(value).toBase58()!==value)throw Error();return value}catch{fail('Invalid Solana wallet address.')}}
function validate(kind,payload,now){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('Configuration payload must be an object.');
 if(kind==='vaults'){
  if(!Array.isArray(payload.vaults)||payload.vaults.length>16)fail('Configure at most 16 allocation vaults.');
  const seen=new Set();return {vaults:payload.vaults.map(v=>{const wallet=address(v.wallet);if(seen.has(wallet))fail('Allocation vault addresses must be unique.');seen.add(wallet);return {label:text(v.label,60),wallet,evidence:text(v.evidence,240)}})};
 }
 if(kind==='seasons'){
  if(!Array.isArray(payload.seasons)||payload.seasons.length>40)fail('Configure at most 40 seasons.');
  const seasons=payload.seasons.map(s=>({name:text(s.name,60),start:int(s.start,0,8640000000000000),end:int(s.end,1,8640000000000000)})).sort((a,b)=>a.start-b.start);
  for(let i=0;i<seasons.length;i++)if(seasons[i].end<=seasons[i].start||(i&&seasons[i].start<seasons[i-1].end))fail('Season ranges must be non-overlapping and end after they start.');return {seasons};
 }
 if(kind==='financial'){
  const p=payload;return {financial:{currency:/^[A-Z]{3}$/.test(p.currency)?p.currency:fail('Use an ISO currency code such as USD.'),cashMinor:int(p.cashMinor,0,Number.MAX_SAFE_INTEGER),monthlyCostMinor:int(p.monthlyCostMinor,1,Number.MAX_SAFE_INTEGER),asOf:int(p.asOf,now-366*86400000,now),evidence:text(p.evidence,500),notes:text(p.notes,500)}};
 }
 if(kind==='monitor')return {monitor:{concentrationPercent:int(payload.concentrationPercent,1,100),claimRyo:int(payload.claimRyo,1,1000000000),pendingMinutes:int(payload.pendingMinutes,1,10080)}};
 if(kind==='resume'){if(!PAUSES.includes(payload.control))fail('Unknown emergency control.');return {control:payload.control}}
 fail('Unknown configuration kind.');
}
async function control(store,c=store.pool,lock=false){
 await c.query('INSERT INTO ryo_admin_control(scope,installed) VALUES($1,$2) ON CONFLICT DO NOTHING',[store.scope,store.now()]);
 return (await c.query('SELECT * FROM ryo_admin_control WHERE scope=$1'+(lock?' FOR UPDATE':''),[store.scope])).rows[0];
}
async function audit(store,c,actor,action,data){
 const last=(await c.query('SELECT sequence,hash FROM ryo_admin_audit WHERE scope=$1 ORDER BY sequence DESC LIMIT 1',[store.scope])).rows[0];
 const row={sequence:safeNum(last?.sequence)+1,actor,action,data,created:store.now(),previous:last?.hash||'genesis'};
 row.hash=digest(row);await c.query('INSERT INTO ryo_admin_audit(scope,sequence,actor,action,data,created,previous,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[store.scope,row.sequence,actor,action,JSON.stringify(data),row.created,row.previous,row.hash]);return row;
}
async function guard(store,action,wallet,body={}){
 const gate=GATES[action];if(!gate)return;
 const row=(await store.pool.query('SELECT pauses FROM ryo_admin_control WHERE scope=$1',[store.scope])).rows[0];
 if(row?.pauses?.[gate]){
  // A persisted order can only replay its original operation; core Store validation remains in force.
  const table=action==='purchase'||action==='market-buy'?'ryo_purchases':action==='withdraw'?'ryo_withdrawals':null;
  if(table&&wallet&&typeof body.requestId==='string'&&(await store.pool.query('SELECT request_id FROM '+table+' WHERE scope=$1 AND wallet=$2 AND request_id=$3',[store.scope,wallet,body.requestId])).rows.length)return;
  fail('New '+gate+' are temporarily paused by the operator. Existing balances and pending transaction recovery remain available.',503);
 }
}
const unavailableChain=()=>({status:'unavailable',reason:'Finalized Devnet RPC verification unavailable. No chain values have been estimated.',vaults:[],circulating:null,locked:null});
async function readChain(ctx,vaults){
 try{
  await ctx.checkNetwork();
  const {PublicKey}=require('@solana/web3.js'),{TOKEN_PROGRAM_ID}=require('@solana/spl-token');
  const mint=new PublicKey(ctx.mint),supply=await ctx.connection.getTokenSupply(mint,'finalized');
  const rows=[{label:'Player custody',wallet:ctx.treasuryAddress},{label:'Studio fees',wallet:ctx.studioAddress},{label:'Revenue treasury',wallet:ctx.revenueAddress},...vaults];
  const unique=[...new Set(rows.map(v=>v.wallet))];
  const balances=new Map(await Promise.all(unique.map(async wallet=>{
   const reply=await ctx.connection.getParsedTokenAccountsByOwner(new PublicKey(wallet),{mint},'finalized');
   let raw=0n;for(const item of reply.value){const a=item.account,info=a.data?.parsed?.info;if(a.owner.toString()!==TOKEN_PROGRAM_ID.toBase58()||info?.mint!==ctx.mint||info.owner!==wallet||info.tokenAmount.decimals!==supply.value.decimals)throw Error('Unexpected token account response');raw+=BigInt(info.tokenAmount.amount)}
   return [wallet,{amountRaw:String(raw),slot:reply.context.slot}];
  })));
  const monitored=[...balances.values()].reduce((n,v)=>n+BigInt(v.amountRaw),0n);
  const custody=balances.get(ctx.treasuryAddress).amountRaw;
  return {status:'verified',commitment:'finalized',supplyRaw:supply.value.amount,decimals:supply.value.decimals,slot:supply.context.slot,custodyRaw:custody,vaults:rows.map(v=>({...v,...balances.get(v.wallet),lockStatus:'Not verifiable: no lock/vesting program evidence configured'})),outsideMonitoredRaw:String(BigInt(supply.value.amount)-monitored),circulating:null,locked:null,coverage:'Outside monitored wallets is a residual, not a verified circulating supply. Wallet balances do not prove a contractual lock. Slots can differ.'};
 }catch{return unavailableChain()}
}
async function chain(ctx,vaults){
 let timer;try{return await Promise.race([readChain(ctx,vaults),new Promise(resolve=>{timer=setTimeout(()=>resolve(unavailableChain()),8000)})])}finally{clearTimeout(timer)}
}
async function snapshot(ctx,wallet){
 const {store}=ctx,now=store.now();
 const result=await store.transaction(async c=>{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  const ctl=await control(store,c),config={...DEFAULTS,...ctl.config},q=async(sql,args=[])=> (await c.query(sql,[store.scope,...args])).rows;
  const purchase=(await q("SELECT COUNT(*) AS orders,COALESCE(SUM(amount),0) AS spent,COALESCE(SUM((quote->>'base')::numeric),0) AS base,COALESCE(SUM((quote->>'operations')::numeric),0) AS recycled,COALESCE(SUM((quote->>'treasury')::numeric),0) AS treasury,COALESCE(SUM((quote->>'burn')::numeric),0) AS burned,COALESCE(SUM((quote->>'studioFee')::numeric),0) AS fees FROM ryo_purchases WHERE scope=$1 AND status='confirmed'"))[0];
  const [liabilities]=await q("SELECT (SELECT COALESCE(SUM(balance),0) FROM ryo_accounts WHERE scope=$1) AS balances,(SELECT COALESCE(SUM(amount),0) FROM ryo_purchases WHERE scope=$1 AND status='pending') AS purchases,(SELECT COALESCE(SUM(amount),0) FROM ryo_withdrawals WHERE scope=$1 AND status='pending') AS withdrawals,(SELECT COALESCE(SUM(amount),0) FROM ryo_market_offers WHERE scope=$1 AND status='active') AS offers,(SELECT COALESCE(SUM((data->>'pending')::numeric),0)/1000 FROM ryo_adventures WHERE scope=$1) AS chests,(SELECT COALESCE(SUM((data->>'claimed')::numeric),0) FROM ryo_adventures WHERE scope=$1) AS claimed");
  const products=await q("SELECT product,COUNT(*) AS orders,COALESCE(SUM(amount),0) AS spent,COALESCE(SUM(jsonb_array_length(COALESCE(result->'outputs','[]'::jsonb))),0) AS outputs,COALESCE(SUM(CASE WHEN product='fusion' THEN jsonb_array_length(COALESCE(result->'consumed','[]'::jsonb))/3 ELSE 0 END),0) AS attempts FROM ryo_purchases WHERE scope=$1 AND status='confirmed' GROUP BY product ORDER BY spent DESC");
  const [activity]=await q("SELECT COUNT(DISTINCT p.wallet) AS active,COUNT(DISTINCT p.wallet) FILTER(WHERE EXISTS(SELECT 1 FROM ryo_profiles r WHERE r.scope=p.scope AND r.wallet=p.wallet AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.data->'heroes','[]'::jsonb)) h WHERE NOT (r.data ? 'battleReady') OR COALESCE(r.data->'battleReady','[]'::jsonb) ? (h->>'tokenId')))) AS eligible FROM ryo_presence p WHERE p.scope=$1 AND p.last_seen>$2",[now-90000]);
  const leaders=await q("SELECT wallet,(data->>'claimed')::numeric AS claimed,(data->>'pending')::numeric/1000 AS pending,(data->>'kills')::numeric AS kills FROM ryo_adventures WHERE scope=$1 ORDER BY claimed DESC NULLS LAST,wallet LIMIT 25");
  const [pop]=await q("SELECT COUNT(*) FILTER(WHERE COALESCE((data->>'claimed')::numeric,0)>0) AS earners FROM ryo_adventures WHERE scope=$1");
  const transactions=await q("SELECT 'purchase' AS kind,wallet,request_id,signature,status,amount,created,settled_at FROM ryo_purchases WHERE scope=$1 AND status!='confirmed' UNION ALL SELECT 'withdrawal',wallet,request_id,signature,status,amount,created,settled_at FROM ryo_withdrawals WHERE scope=$1 AND status!='confirmed' ORDER BY created DESC LIMIT 100");
  const txCounts=await q("SELECT 'purchase' AS kind,status,COUNT(*) AS count,COALESCE(SUM(amount),0) AS amount FROM ryo_purchases WHERE scope=$1 GROUP BY status UNION ALL SELECT 'withdrawal',status,COUNT(*),COALESCE(SUM(amount),0) FROM ryo_withdrawals WHERE scope=$1 GROUP BY status");
  const periods=JSON.stringify(config.seasons);
  const [claimTotals]=await q("SELECT COALESCE(SUM(amount),0) AS recorded,COALESCE(SUM(amount) FILTER(WHERE NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS s(start BIGINT,\"end\" BIGINT) WHERE created>=s.start AND created<s.\"end\")),0) AS outside FROM ryo_reward_claims WHERE scope=$1",[periods]);
  const seasonTotals=await q("SELECT s.name,s.start,s.\"end\",COALESCE(SUM(r.amount),0) AS distributed FROM jsonb_to_recordset($2::jsonb) AS s(name TEXT,start BIGINT,\"end\" BIGINT) LEFT JOIN ryo_reward_claims r ON r.scope=$1 AND r.created>=s.start AND r.created<s.\"end\" GROUP BY s.name,s.start,s.\"end\" ORDER BY s.start",[periods]);
  const claimAlerts=await q('SELECT wallet,COUNT(*) AS claims,SUM(amount) AS amount FROM ryo_reward_claims WHERE scope=$1 AND created>=$2 GROUP BY wallet HAVING SUM(amount)>=$3 ORDER BY amount DESC LIMIT 25',[now-86400000,config.monitor.claimRyo]);
  const proposals=await q('SELECT id,kind,payload,proposer,reviewer,reason,status,version,created,reviewed FROM ryo_admin_proposals WHERE scope=$1 ORDER BY created DESC LIMIT 100');
  const audits=await q('SELECT sequence,actor,action,data,created,previous,hash FROM ryo_admin_audit WHERE scope=$1 ORDER BY sequence DESC LIMIT 100');
  const numRow=r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,['wallet','product','kind','status'].includes(k)?v:safeNum(v)]));
  const liability=numRow(liabilities),flow=numRow(purchase),recorded=safeNum(claimTotals.recorded),total=liability.claimed;
  const [legacy]=await q('SELECT COALESCE(SUM(amount),0) AS spent FROM ryo_spends WHERE scope=$1');flow.purchaseSpent=flow.spent;flow.legacySpent=safeNum(legacy.spent);flow.spent+=flow.legacySpent;
  const top1=total?100*safeNum(leaders[0]?.claimed)/total:0,top10=total?100*leaders.slice(0,10).reduce((n,r)=>n+safeNum(r.claimed),0)/total:0;
  const seasons=seasonTotals.map(s=>({...s,start:safeNum(s.start),end:safeNum(s.end),distributed:safeNum(s.distributed),completeHistory:safeNum(s.start)>=safeNum(ctl.installed)}));
  const alerts=claimAlerts.map(r=>({wallet:r.wallet,signal:'High claim volume (24h)',detail:safeNum(r.amount)+' Ryo across '+r.claims+' claims',severity:'review'}));
  if(top1>=config.monitor.concentrationPercent&&total)alerts.push({wallet:leaders[0].wallet,signal:'Reward concentration',detail:top1.toFixed(2)+'% of lifetime claimed Ryo',severity:'review'});
  for(const r of transactions)if(r.status==='pending'&&now-safeNum(r.created)>config.monitor.pendingMinutes*60000)alerts.push({wallet:r.wallet,signal:'Stale pending transaction',detail:r.kind+' '+r.request_id,severity:'review'});
  return {marker:MARKER,serverTime:now,role:role(wallet),wallet,scope:store.scope,control:{version:ctl.version,config,pauses:ctl.pauses,installed:safeNum(ctl.installed)},flow,products:products.map(numRow),liabilities:{...liability,reserved:liability.purchases+liability.withdrawals+liability.offers,total:liability.balances+liability.purchases+liability.withdrawals+liability.offers+liability.chests},rewards:{claimed:total,recorded,unassignedHistory:Math.max(0,total-recorded),outsideSeasons:safeNum(claimTotals.outside),seasons,pool:Math.max(0,flow.recycled-total)},activity:numRow(activity),concentration:{top1Percent:top1,top10Percent:top10,earners:safeNum(pop.earners),leaders:leaders.map(numRow)},alerts,transactions,transactionCounts:txCounts.map(numRow),proposals,audits,nft:{minted:null,reason:'The beta stores hero entitlements. No NFT mint/escrow service is deployed.'}};
 });
 result.chain=await chain(ctx,result.control.config.vaults);
 result.solvency=result.chain.status==='verified'?{custodyRyo:Number(BigInt(result.chain.custodyRaw))/10**result.chain.decimals,knownLiabilities:result.liabilities.total}:null;
 if(result.solvency)result.solvency.surplus=result.solvency.custodyRyo-result.solvency.knownLiabilities;
 const f=result.control.config.financial;result.runway=f?{...f,months:f.cashMinor/f.monthlyCostMinor,stale:now-f.asOf>31*86400000,verification:'Entered evidence reviewed by a distinct authorized approver; not a bank feed.'}:null;
 return result;
}
async function handle(ctx,wallet,action,body){
 const access=role(wallet),{store}=ctx;
 if(action==='admin-snapshot')return snapshot(ctx,wallet);
 if(access==='viewer')fail('An operator or approver role is required.',403);
 const reason=text(body.reason,500);
 return store.transaction(async c=>{
  const ctl=await control(store,c,true),now=store.now();
  if(action==='admin-pause'){
   if(!PAUSES.includes(body.control))fail('Unknown emergency control.');
   const pauses={...ctl.pauses,[body.control]:{actor:wallet,reason,at:now}};
   await c.query('UPDATE ryo_admin_control SET pauses=$2,version=version+1 WHERE scope=$1',[store.scope,JSON.stringify(pauses)]);
   await audit(store,c,wallet,'emergency.pause',{control:body.control,reason});return {ok:true};
  }
  if(action==='admin-propose'){
   if(body.version!==Number(ctl.version))fail('Configuration changed. Refresh before proposing.',409);
   const payload=validate(body.kind,body.payload,now),id=crypto.randomUUID();
   await c.query('INSERT INTO ryo_admin_proposals(scope,id,kind,payload,proposer,reason,version,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[store.scope,id,body.kind,JSON.stringify(payload),wallet,reason,ctl.version,now]);
   await audit(store,c,wallet,'configuration.proposed',{id,kind:body.kind,payload,reason});return {ok:true,id};
  }
  if(action==='admin-review'){
   if(access!=='approver')fail('An approver role is required.',403);
   if(typeof body.approve!=='boolean')fail('Choose approve or reject.');
   const p=(await c.query('SELECT * FROM ryo_admin_proposals WHERE scope=$1 AND id=$2 FOR UPDATE',[store.scope,text(body.id,80)])).rows[0];
   if(!p||p.status!=='pending')fail('Proposal is unavailable or already reviewed.',409);
   if(p.proposer===wallet)fail('A different authorized wallet must review this proposal.',403);
   if(now-safeNum(p.created)>7*86400000)fail('Proposal expired. Create a new proposal.',409);
   if(body.approve){
    if(Number(p.version)!==Number(ctl.version))fail('Proposal is stale. Re-propose against the current configuration.',409);
    const payload=validate(p.kind,['financial','monitor'].includes(p.kind)?p.payload[p.kind]:p.payload,now);
    if(p.kind==='resume'){
     const pauses={...ctl.pauses};delete pauses[payload.control];await c.query('UPDATE ryo_admin_control SET pauses=$2,version=version+1 WHERE scope=$1',[store.scope,JSON.stringify(pauses)]);
    }else await c.query('UPDATE ryo_admin_control SET config=$2,version=version+1 WHERE scope=$1',[store.scope,JSON.stringify({...ctl.config,...payload})]);
   }
   const status=body.approve?'approved':'rejected';
   await c.query('UPDATE ryo_admin_proposals SET status=$3,reviewer=$4,reviewed=$5 WHERE scope=$1 AND id=$2',[store.scope,p.id,status,wallet,now]);
   await audit(store,c,wallet,'configuration.'+status,{id:p.id,kind:p.kind,payload:p.payload,proposer:p.proposer,reason});return {ok:true};
  }
  fail('Unknown admin action.',404);
 });
}
module.exports={handle,guard,snapshot,validate,canonical,digest,MARKER};
