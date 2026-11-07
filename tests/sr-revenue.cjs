'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),web3=require('../app/node_modules/@solana/web3.js'),spl=require('../app/node_modules/@solana/spl-token'),bs58=require('../app/node_modules/bs58');
const {Store}=require('../app/server/store.cjs'),router=require('../app/server/sr-revenue.cjs'),admin=require('../app/server/economic-dashboard.cjs'),economy=require('../app/server/economy.cjs');
(async()=>{
 const db=new PGlite(),schema=fs.readFileSync(path.join(__dirname,'../app/server/schema.sql'),'utf8');await db.exec(schema);await db.exec(schema);
 let tail=Promise.resolve();const lock=async()=>{let release;const before=tail;tail=new Promise(r=>release=r);await before;return release};
 const pool={async query(s,a){const release=await lock();try{return await db.query(s,a)}finally{release()}},async connect(){const release=await lock();return{query:(s,a)=>db.query(s,a),release}}};
 const store=new Store(pool,'sr-fixture',()=>1900000000000),other=new Store(pool,'other-scope',()=>1900000000000),treasury=web3.Keypair.generate(),mint=web3.Keypair.generate().publicKey;
 const address=()=>web3.Keypair.generate().publicKey.toBase58(),operator=address(),reviewer=address(),wallet=address(),source=address();
 const cfg={enabled:true,destinations:{lockedTreasury:source,activeRewards:treasury.publicKey.toBase58(),communityRewards:address(),economicReserve:address()},products:[...router.APPROVED],evidence:'Approved isolated full-service revenue policy'};
 const receipt=new Map();let multisig=true,delegate=false,network=true;
 const connection={async getAccountInfo(key){if(key.toBase58()===source){if(!multisig)return{owner:web3.SystemProgram.programId,data:Buffer.alloc(0)};return require('./sr-revenue-fixture.cjs').multisig()}
   const ata=spl.getAssociatedTokenAddressSync(mint,new web3.PublicKey(source),true);if(key.equals(ata)&&delegate){const data=Buffer.alloc(spl.ACCOUNT_SIZE);spl.AccountLayout.encode({mint,owner:new web3.PublicKey(source),amount:0n,delegateOption:1,delegate:treasury.publicKey,state:1,isNativeOption:0,isNative:0n,delegatedAmount:1n,closeAuthorityOption:0,closeAuthority:web3.PublicKey.default},data);return{owner:spl.TOKEN_PROGRAM_ID,data}}return null},async getParsedTransaction(sig){return receipt.get(sig)||null}};
 const ctx={store,wallet,connection,mint:mint.toBase58(),treasuryAddress:treasury.publicKey.toBase58(),studioAddress:address(),revenueAddress:address(),async checkNetwork(){if(!network)throw Error('Wrong network')}};
 process.env.RYO_ADMIN_APPROVERS=operator+','+reviewer;process.env.RYO_ADMIN_OPERATORS='';
 const call=(w,action,body={})=>admin.handle(ctx,w,action,body),version=async()=>Number((await pool.query('SELECT version FROM ryo_admin_control WHERE scope=$1',[store.scope])).rows[0]?.version||0);
 const propose=async(kind,payload)=>call(operator,'admin-propose',{kind,payload,version:await version(),reason:'Verified fixture policy'});
 const approve=p=>call(reviewer,'admin-review',{id:p.id,approve:true,reason:'Independent verification'});
 const memo=text=>new web3.TransactionInstruction({programId:new web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),keys:[],data:Buffer.from(text)});
 const treasuryAta=spl.getAssociatedTokenAddressSync(mint,treasury.publicKey),transfer=(owner,amount)=>{const key=new web3.PublicKey(owner),ata=spl.getAssociatedTokenAddressSync(mint,key,true);return[spl.createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey,ata,key,mint),spl.createTransferCheckedInstruction(treasuryAta,mint,ata,treasury.publicKey,amount,6)]};
 try{
  for(const price of [1,11,25000,22500,54000000]){const s=router.split(price),d=s.revenueDistribution;assert.equal(Object.values(d.allocations).reduce((n,v)=>n+BigInt(v),0n),BigInt(price)*router.UNIT);assert.deepEqual([s.treasury,s.operations,s.community,s.reserve,s.burn,s.studioFee],[price*.5,price*.3,price*.1,price*.1,0,0]);}
  const q=economy.quote(economy.initialProfile(),'summon',{quantity:1});assert.equal((await router.preview(store,wallet,q)).revenueDistribution.ready,false);await assert.rejects(router.instructions(ctx,q,crypto.randomUUID(),transfer,memo),e=>e.paymentNotSubmitted&&/approved vault/.test(e.message));
  assert.throws(()=>router.validateConfig({...cfg,destinations:{...cfg.destinations,communityRewards:source}}),/distinct/);assert.throws(()=>router.validateConfig({...cfg,products:['market']}),/excluded/);
  const pending=await propose('revenueRouting',cfg);await assert.rejects(call(operator,'admin-review',{id:pending.id,approve:true,reason:'self'}),/different authorized/);
  multisig=false;await assert.rejects(approve(pending),/multisig/);assert.equal(await router.config(store),null,'unverified ordinary wallet cannot become Locked Treasury');multisig=true;
  delegate=true;await assert.rejects(approve(pending),/delegate/);delegate=false;await approve(pending);assert.equal((await router.preview(store,wallet,q)).revenueDistribution.ready,true);
  const badActive={...cfg,destinations:{...cfg.destinations,activeRewards:address()}},wrong=await propose('revenueRouting',badActive);await assert.rejects(approve(wrong),/existing player-custody/);
  const instructions=await router.instructions(ctx,q,'approved-quote-fixture',transfer,memo),token=instructions.filter(i=>i.programId.equals(spl.TOKEN_PROGRAM_ID));assert.equal(token.length,3);assert(token.every(i=>i.data[0]===spl.TokenInstruction.TransferChecked));
  const otherWallet=await router.instructions({...ctx,wallet:address()},economy.quote(economy.initialProfile(),'summon',{quantity:1}),'approved-quote-fixture',transfer,memo);
  assert(!instructions.at(-1).data.equals(otherWallet.at(-1).data),'same request ID from distinct wallets must never share a payment signature');
  assert.deepEqual(token.map(i=>spl.decodeTransferCheckedInstruction(i).data.amount),[12500n,2500n,2500n].map(n=>n*router.UNIT));assert(!instructions.some(i=>i.programId.equals(spl.TOKEN_PROGRAM_ID)&&i.data[0]===spl.TokenInstruction.BurnChecked));
  await store.transaction(async c=>{await store.locked(c,wallet);await c.query('UPDATE ryo_accounts SET balance=1000000 WHERE scope=$1 AND wallet=$2',[store.scope,wallet])});
  const purchaseId=crypto.randomUUID(),row=await store.purchase(wallet,purchaseId,'summon',{quantity:1},25000,async(q,c)=>{
   const list=await router.instructions({...ctx,client:c},q,purchaseId,transfer,memo),tx=new web3.Transaction({feePayer:treasury.publicKey,recentBlockhash:web3.Keypair.generate().publicKey.toBase58()}).add(...list);tx.sign(treasury);assert(tx.verifySignatures());return{signature:bs58.encode(tx.signature),wire:tx.serialize().toString('base64'),lastHeight:100};
  });
  assert.equal((await router.summary(ctx,pool)).transactions,0,'pending route is never booked');await store.settlePurchase(wallet,purchaseId,'confirmed');await store.settlePurchase(wallet,purchaseId,'confirmed');
  let sum=await router.summary(ctx,pool);assert.equal(sum.transactions,1);assert.equal(sum.totalsRaw.activeRewards,'7500000000');assert.equal(Number((await router.income(store,pool)).n),7500);
  assert.equal((await router.summary({...ctx,store:other},pool)).transactions,0,'separate scope');
  // A failed route credits nothing; the reservation is returned and no hero is delivered.
  const before=(await store.profile(wallet)).heroes.length,id=crypto.randomUUID();await store.purchase(wallet,id,'summon',{quantity:1},25000,async q=>require('./sr-revenue-fixture.cjs').stamp(q,{signature:'refund-fixture',wire:'wire',lastHeight:10}));await store.settlePurchase(wallet,id,'refunded');assert.equal((await store.profile(wallet)).heroes.length,before);assert.equal((await router.summary(ctx,pool)).transactions,1);
  // Store-generated bonus purchases never make cash allocations or fund Adventure.
  await pool.query('UPDATE ryo_accounts SET bonus=100000 WHERE scope=$1 AND wallet=$2',[store.scope,wallet]);const bonusId=crypto.randomUUID();await store.purchase(wallet,bonusId,'summon',{quantity:1},25000,()=>{throw Error('bonus must never route tokens')});await store.settlePurchase(wallet,bonusId,'confirmed');assert.equal((await router.summary(ctx,pool)).transactions,1);
  assert.equal(require('../app/server/market.cjs').split(100000).adventureEligible,false,'new Market fee pool is explicitly separate');
  await assert.rejects(router.instructions(ctx,economy.quote(economy.initialProfile(),'sensei'),crypto.randomUUID(),transfer,memo),/not approved/);
  assert.equal(economy.quote(economy.initialProfile(),'hunt').revenueDistribution,undefined,'Boss Hunt remains a separate prize budget');
  await pool.query(`INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created)
    VALUES($1,$2,'market-separate','market','{}',$3,'{}','{}',100000,'market-separate-signature','wire',1,'confirmed',$4)`,[store.scope,wallet,JSON.stringify({operations:10000,adventureEligible:false}),store.now()]);
  assert.equal(Number((await router.income(store,pool)).n),7500,'unapproved Market fees never fund Adventure');
  const sig=bs58.encode(crypto.randomBytes(64)),topup={source:'lockedTreasury',signature:sig,amountRaw:'100000000',evidence:'Multisig authorized Adventure replenishment'};
  assert.throws(()=>router.validateReplenishment({...topup,source:'communityRewards'}),/remain separate/);const p=await propose('revenueReplenishment',topup);await assert.rejects(approve(p),/not finalized/);
  const sourceAta=spl.getAssociatedTokenAddressSync(mint,new web3.PublicKey(source),true).toBase58();
  const balances=(a,b)=>[{accountIndex:0,mint:ctx.mint,owner:source,uiTokenAmount:{amount:String(a),decimals:6}},{accountIndex:1,mint:ctx.mint,owner:ctx.treasuryAddress,uiTokenAmount:{amount:String(b),decimals:6}}];
  const proof={slot:123,meta:{err:null,preTokenBalances:balances(200000000n,0n),postTokenBalances:balances(100000000n,100000000n)},transaction:{signatures:[sig],message:{accountKeys:[{pubkey:new web3.PublicKey(sourceAta)},{pubkey:treasuryAta}],instructions:[{programId:spl.TOKEN_PROGRAM_ID,parsed:{type:'transferChecked',info:{source:sourceAta,destination:treasuryAta.toBase58(),mint:ctx.mint,tokenAmount:{amount:'100000000',decimals:6}}}}]}}};
  receipt.set(sig,proof);assert.equal(Number((await router.income(store,pool)).n),7500,'observed but unapproved transfer is not active funding');await approve(p);assert.equal(Number((await router.income(store,pool)).n),7600);
  const replay=await propose('revenueReplenishment',topup);await assert.rejects(approve(replay),/already accounted/);assert.equal(Number((await router.income(store,pool)).n),7600);
  const corrupt=structuredClone(proof);corrupt.transaction.message.accountKeys=proof.transaction.message.accountKeys;corrupt.transaction.message.instructions=proof.transaction.message.instructions;corrupt.meta.postTokenBalances[1].uiTokenAmount.amount='999999999';const sig2=bs58.encode(crypto.randomBytes(64));corrupt.transaction.signatures=[sig2];receipt.set(sig2,corrupt);await assert.rejects(router.verifyReplenishment(ctx,cfg,{...topup,signature:sig2}),/balance changes/);
  network=false;await assert.rejects(router.instructions(ctx,economy.quote(economy.initialProfile(),'summon',{quantity:1}),crypto.randomUUID(),transfer,memo),e=>e.paymentNotSubmitted);network=true;
  const count=Number((await pool.query('SELECT COUNT(*) AS n FROM ryo_admin_audit WHERE scope=$1',[store.scope])).rows[0].n);assert(count>0);
  console.log('PASS: SR revenue — exact 50/30/10/10 SDK transfers, zero burn, whole-payment conservation, external multisig/delegate checks, two-wallet config/replenishment approval, finalized funding evidence and replay rejection, pending/refund/bonus exclusions, scoped ledger and separate market revenue.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
