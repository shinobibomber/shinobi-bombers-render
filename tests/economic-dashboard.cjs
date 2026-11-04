'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {PGlite}=require('@electric-sql/pglite'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),{Keypair}=require('../app/node_modules/@solana/web3.js'),{TOKEN_PROGRAM_ID}=require('../app/node_modules/@solana/spl-token');
const {Store,hash}=require('../app/server/store.cjs'),{createService,GENESIS}=require('../app/server/service.cjs'),admin=require('../app/server/economic-dashboard.cjs');
(async()=>{
 const db=new PGlite(),schema=fs.readFileSync(path.join(root,'app/server/schema.sql'),'utf8');await db.exec(schema);await db.exec(schema);
 const pool={query:(s,a)=>db.query(s,a),async connect(){return {query:(s,a)=>db.query(s,a),release(){}}}};
 let now=Date.UTC(2026,10,4),rpcDown=false;const store=new Store(pool,'isolated-admin',()=>now),other=new Store(pool,'different-scope',()=>now);
 const keys=Array.from({length:9},()=>Keypair.generate()),[treasury,studio,revenue,mint,operator,approver,viewer,player,vault]=keys;
 const addr=k=>k.publicKey.toBase58(),ow=addr(operator),aw=addr(approver),vw=addr(viewer),pw=addr(player);
 process.env.RYO_ADMIN_OPERATORS=ow;process.env.RYO_ADMIN_APPROVERS=aw;process.env.RYO_ADMIN_VIEWERS=vw;
 const connection={
  async getGenesisHash(){if(rpcDown)throw Error('RPC unavailable');return GENESIS},
  async getTokenSupply(){return {context:{slot:1234},value:{amount:'900000000000000',decimals:6}}},
  async getParsedTokenAccountsByOwner(owner){return {context:{slot:1235},value:[{account:{owner:TOKEN_PROGRAM_ID,data:{parsed:{info:{owner:owner.toBase58(),mint:addr(mint),tokenAmount:{amount:owner.equals(treasury.publicKey)?'5000000000000':'100000000000',decimals:6}}}}}}]}},
  async getSignatureStatuses(){return {value:[{confirmationStatus:'finalized',err:{InstructionError:[0,'failed']}}]}},
  async getBlockHeight(){return 100}
 };
 const ctx={store,connection,mint:addr(mint),treasuryAddress:addr(treasury),studioAddress:addr(studio),revenueAddress:addr(revenue),checkNetwork:async()=>{if(await connection.getGenesisHash()!==GENESIS)throw Error('network')}};
 const service=createService({...ctx,treasury,origin:'http://127.0.0.1',studioAddress:addr(studio),revenueAddress:addr(revenue)});
 const tokens={};for(const w of [ow,aw,vw,pw]){tokens[w]='isolated-'+w;await pool.query('INSERT INTO ryo_sessions(scope,token_hash,wallet,expires) VALUES($1,$2,$3,$4)',[store.scope,hash(tokens[w]),w,now+3600000])}
 const call=(w,action,body={})=>service.handle(action,body,tokens[w]);
 try{
 await assert.rejects(service.handle('admin-snapshot',{},'invalid'),/expired/);
 await assert.rejects(call(pw,'admin-snapshot'),e=>e.status===403);
 await assert.rejects(call(vw,'admin-pause',{control:'claims',reason:'test'}),e=>e.status===403);
 let s=await call(vw,'admin-snapshot');assert.equal(s.flow.spent,0);assert.equal(s.runway,null);assert.equal(s.chain.circulating,null);assert.equal(s.chain.supplyRaw,'900000000000000');assert.equal(s.role,'viewer');assert.equal(s.nft.minted,null);
 const propose=async(kind,payload)=>call(ow,'admin-propose',{kind,payload,reason:'Verified isolated test evidence',version:(await call(ow,'admin-snapshot')).control.version});
 const approve=async p=>call(aw,'admin-review',{id:p.id,approve:true,reason:'Independent evidence review complete'});
 const proposal=await propose('vaults',{vaults:[{label:'Rewards allocation',wallet:addr(vault),evidence:'Approved allocation document'}]});
 await assert.rejects(call(ow,'admin-review',{id:proposal.id,approve:true,reason:'self'}),/approver role/);
 // Both wallets can be approvers, but even then self approval is refused.
 process.env.RYO_ADMIN_APPROVERS=aw+','+ow;
 await assert.rejects(call(ow,'admin-review',{id:proposal.id,approve:true,reason:'self'}),/different authorized wallet/);
 process.env.RYO_ADMIN_APPROVERS=aw;await approve(proposal);
 await assert.rejects(approve(proposal),/already reviewed/);
 s=await call(ow,'admin-snapshot');assert.equal(s.chain.vaults.length,4);assert.equal(s.control.version,1);
 const stale=await propose('monitor',{concentrationPercent:40,claimRyo:100,pendingMinutes:1});
 await call(ow,'admin-pause',{control:'purchases',reason:'Investigating checkout anomaly'});
 await assert.rejects(approve(stale),/stale/);
 await assert.rejects(call(pw,'purchase',{product:'summon'}),/temporarily paused/);
 // Read-only state recovery is available while purchases are paused.
 await call(pw,'state');
 for(const control of ['claims','withdrawals'])await call(ow,'admin-pause',{control,reason:'Investigating settlement anomaly'});
 await assert.rejects(call(pw,'claim-adventure'),/temporarily paused/);await assert.rejects(call(pw,'withdraw'),/temporarily paused/);
 await admin.guard(store,'adventure');await admin.guard(store,'state');await admin.guard(store,'deposit');
 const resume=await propose('resume',{control:'claims'});await approve(resume);await admin.guard(store,'claim-adventure');
 const mon=await propose('monitor',{concentrationPercent:40,claimRyo:100,pendingMinutes:1});await approve(mon);
 const finance=await propose('financial',{currency:'USD',cashMinor:1200000,monthlyCostMinor:200000,asOf:now,evidence:'Bank statement #verified-fixture',notes:'Hosting and approved operating costs'});await approve(finance);
 await assert.rejects(propose('financial',{currency:'USD',cashMinor:-1,monthlyCostMinor:100,asOf:now,evidence:'x',notes:'x'}),/whole number/);
 await assert.rejects(propose('seasons',{seasons:[{name:'A',start:1,end:100},{name:'B',start:99,end:200}]}),/non-overlapping/);
 const periods=await propose('seasons',{seasons:[{name:'Beta season',start:now,end:now+86400000}]});await approve(periods);
 const q={base:25000,studioFee:500,total:25500,treasury:2500,burn:2500,operations:20000};
 for(const [id,product,status,amount,result]of [['confirmed-summon','summon','confirmed',25500,{outputs:[{},{}]}],['confirmed-fusion','fusion','confirmed',25500,{outputs:[{}],consumed:['a','b','c']}],['pending-buy','summon','pending',25500,{outputs:[]}],['refunded-buy','summon','refunded',25500,{outputs:[]}]])await pool.query('INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[store.scope,pw,id,product,'{}',JSON.stringify(q),JSON.stringify(result),'{}',amount,id+'-signature','PRIVATE_WIRE_MUST_NOT_LEAK',99,status,now-3600000]);
 await pool.query('INSERT INTO ryo_withdrawals(scope,wallet,request_id,amount,signature,wire,last_height,status,created) VALUES($1,$2,$3,100000,$4,$5,99,$6,$7)',[store.scope,pw,'pending-withdraw','withdraw-signature','PRIVATE_WIRE_MUST_NOT_LEAK','pending',now-3600000]);
 await pool.query('UPDATE ryo_accounts SET balance=500000 WHERE scope=$1 AND wallet=$2',[store.scope,pw]);
 const data={map:1,target:0,hp:100,kills:30,pending:500000,claimed:300,last:now,active:false,energy:{}};
 await pool.query('INSERT INTO ryo_adventures(scope,wallet,data) VALUES($1,$2,$3)',[store.scope,pw,JSON.stringify(data)]);
 await pool.query('INSERT INTO ryo_reward_claims(scope,wallet,amount,created) VALUES($1,$2,100,$3)',[store.scope,pw,now]);
 await store.presence(pw,tokens[pw],true);await other.profile('other-wallet');
 await pool.query('INSERT INTO ryo_spends(scope,wallet,request_id,amount,created) VALUES($1,$2,$3,200,$4)',[store.scope,pw,'legacy-service',now]);
 await admin.guard(store,'purchase',pw,{requestId:'pending-buy'});await admin.guard(store,'withdraw',pw,{requestId:'pending-withdraw'});
 await assert.rejects(admin.guard(store,'purchase',ow,{requestId:'pending-buy'}),/temporarily paused/);
 s=await call(ow,'admin-snapshot');assert.equal(s.flow.legacySpent,200);assert.equal(s.flow.spent,51200);
 assert.equal(s.flow.purchaseSpent,51000);assert.equal(s.flow.recycled,40000);assert.equal(s.flow.treasury,5000);assert.equal(s.flow.burned,5000);assert.equal(s.liabilities.reserved,125500);assert.equal(s.liabilities.chests,500);assert.equal(s.rewards.unassignedHistory,200);assert.equal(s.rewards.seasons[0].distributed,100);assert.equal(s.runway.months,6);assert.equal(s.activity.eligible,1);assert.equal(s.activity.active,1);assert.equal(s.concentration.top1Percent,100);assert(s.alerts.some(a=>a.signal==='High claim volume (24h)'));assert(s.alerts.some(a=>a.signal==='Stale pending transaction'));assert.equal(s.products.find(p=>p.product==='fusion').attempts,1);assert(!JSON.stringify(s).includes('PRIVATE_WIRE'));
 // Audit rows are verifiable in order, including their complete payloads.
 let previous='genesis';for(const a of s.audits.slice().reverse()){assert.equal(a.previous,previous);const {hash:recordHash,...payload}=a;assert.equal(recordHash,admin.digest({...payload,sequence:Number(a.sequence),created:Number(a.created)}));previous=a.hash}
 rpcDown=true;const unavailable=await call(ow,'admin-snapshot');assert.equal(unavailable.chain.status,'unavailable');assert.equal(unavailable.chain.supplyRaw,undefined);assert.equal(unavailable.flow.spent,51200);rpcDown=false;
 // Recovery refunds the reserved amounts even under the emergency gate.
 const state=await call(pw,'state');assert.equal(state.withdrawals[0].status,'refunded');assert.equal(state.purchases.find(p=>p.request_id==='pending-buy').status,'refunded');
 assert.equal(await store.balance(pw),625500);
 // Claim observation shares the existing balance transaction, rolls back on error, and never
 // duplicates on a replay with no whole Ryo remaining.
 const adventure=require('../app/server/adventure.cjs');const before=Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_reward_claims')).rows[0].n);
 const claim=await adventure.adventure(store,pw,{claim:true,active:false},10000000);assert.equal(claim.credited,500);
 assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_reward_claims')).rows[0].n),before+1);
 await assert.rejects(adventure.adventure(store,pw,{claim:true,active:false},10000000),/No funded whole/);
 assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_reward_claims')).rows[0].n),before+1);
 await pool.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2',[store.scope,pw,JSON.stringify({...data,pending:1000,claimed:800})]);
 const realQuery=pool.query;const failingPool={query:realQuery,async connect(){return {release(){},query:async(sql,args)=>{if(sql.startsWith('INSERT INTO ryo_reward_claims'))throw Error('injected observation write failure');return realQuery(sql,args)}}}};
 const beforeBalance=await store.balance(pw);await assert.rejects(adventure.adventure(new Store(failingPool,store.scope,()=>now),pw,{claim:true},10000000),/injected/);assert.equal(await store.balance(pw),beforeBalance);
 s=await call(ow,'admin-snapshot');
 // Actual browser layout and wallet entry flow, isolated API data; no external wallet or RPC.
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/ryo'){
   let input='';for await(const chunk of req)input+=chunk;const body=JSON.parse(input);let result;
   try{if(body.action==='challenge')result={nonce:'fixture',message:'Wallet: '+ow+'\nOrigin: http://127.0.0.1:'+server.address().port};else if(body.action==='login')result={token:tokens[ow]};else result=await service.handle(body.action,body,String(req.headers.authorization||'').replace(/^Bearer /,''));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result))}catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}))}return;
  }
  const file={'/admin/':'index.html','/admin/dashboard.js':'dashboard.js','/admin/dashboard.css':'dashboard.css'}[req.url];if(!file){res.writeHead(404).end();return}res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':'text/css'});res.end(fs.readFileSync(path.join(root,'economic-dashboard',file)));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'chrome'});const p=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(wallet=>{window.phantom={solana:{isPhantom:true,connect:async()=>({publicKey:{toString:()=>wallet}}),signMessage:async()=>({signature:new Uint8Array(64)})}}},ow);
  await p.goto('http://127.0.0.1:'+server.address().port+'/admin/');assert.equal(await p.locator('#dashboard').isHidden(),true);await p.locator('#connect').click();await p.waitForSelector('#dashboard:not([hidden])');
  await p.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.match(await p.locator('#metrics').innerText(),/900,000,000/);
  const screenshotDir=path.join(__dirname,'out');fs.mkdirSync(screenshotDir,{recursive:true});await p.screenshot({path:path.join(screenshotDir,'economic-dashboard-desktop.png'),fullPage:true});
  await p.locator('#controls button').first().click();await p.waitForSelector('#confirm[open]');assert.equal(await p.locator('#confirm button[value="confirm"]').isEnabled(),true);await p.locator('#confirm button[value="cancel"]').click();await p.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  await p.setViewportSize({width:390,height:844});await p.screenshot({path:path.join(screenshotDir,'economic-dashboard-mobile.png'),fullPage:true});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await p.locator('#disconnect').click();assert.equal(await p.locator('#dashboard').isHidden(),true);
 }finally{await browser?.close();await new Promise(r=>server.close(r))}
 console.log('PASS: economic dashboard permissions, exact ledger sums, scope isolation, finalized RPC/unavailable states, claim atomicity and replay, approvals/self-review/stale versions, audited emergency gates/recovery, finance runway, concentration signals and desktop/mobile UI.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
