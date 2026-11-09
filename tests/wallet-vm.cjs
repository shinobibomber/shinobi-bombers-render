/* Actual SDK serialization/signatures with simulated wallets and Devnet RPC, not a validator. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const web3=require('../app/node_modules/@solana/web3.js'),spl=require('../app/node_modules/@solana/spl-token'),bs58=require('../app/node_modules/bs58');
const GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',UNIT=1000000n;
const owner=web3.Keypair.generate(),tester=web3.Keypair.generate(),other=web3.Keypair.generate(),studio=web3.Keypair.generate(),mints=new Map(),accounts=new Map(),receipts=new Map(),submitted=[];
let genesis=GENESIS,reject=false,changeAfterSend=false,failNext=false,tamper=false,walletAppend=null,walletPriority=false,rpcFetchMode='ok',capturedRpcFetch;
let solLamports=1000000000,feeUnavailable=false,gasRpcError=false,signCalls=0,solAfterSign=null;
const storage=new Map(),localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))};
function mintInfo(mint){const value=mints.get(mint.toBase58());if(!value)return null;const data=Buffer.alloc(spl.MINT_SIZE);spl.MintLayout.encode({...value,mintAuthorityOption:value.authority?1:0,mintAuthority:value.authority||web3.PublicKey.default,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:web3.PublicKey.default},data);if(value.program)return {data:require('./sr-revenue-fixture.cjs').token2022(data,'mint',['MetadataPointer','TokenMetadata']),owner:value.program,lamports:1000000,executable:false};return {data,owner:spl.TOKEN_PROGRAM_ID,lamports:1000000,executable:false};}
class Connection {
 constructor(url,options){capturedRpcFetch=options?.fetch}
 async getGenesisHash(){if(rpcFetchMode!=='ok')await capturedRpcFetch('https://example.test',{method:'POST'});return genesis}
 async getBalance(){if(gasRpcError)throw Error('RPC balance unavailable');return solLamports}
 async getFeeForMessage(message){return {value:feeUnavailable?null:message.header.numRequiredSignatures*5000+(message.accountKeys.some(k=>k.equals(web3.ComputeBudgetProgram.programId))?400:0)}}
 async getAccountInfo(address){return mints.has(address.toBase58())?mintInfo(address):accounts.has(address.toBase58())?{owner:spl.TOKEN_PROGRAM_ID}:null}
 async getTokenAccountBalance(address){return {value:{amount:accounts.get(address.toBase58()).amount.toString()}}}
 async getMinimumBalanceForRentExemption(size){return size===0?890880:size===165?2039280:1461600}
 async getLatestBlockhash(){return {blockhash:web3.Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:1000}}
 async getParsedTransaction(hash){return receipts.get(hash)||null}
 async sendRawTransaction(bytes){
  assert.equal(genesis,GENESIS);const tx=web3.Transaction.from(bytes);assert.ok(tx.verifySignatures());assert.ok(bytes.length<=1232);submitted.push(tx);
  const hash=bs58.encode(tx.signature),message=tx.compileMessage(),keys=message.accountKeys.map((pubkey,index)=>({pubkey,signer:message.isAccountSigner(index),writable:message.isAccountWritable(index)})),pre=[],post=[],instructions=[];
  const receipt={transaction:{signatures:[hash],message:{accountKeys:keys,instructions}},meta:{err:null,preTokenBalances:pre,postTokenBalances:post}};
  if(failNext){failNext=false;receipt.meta.err={InstructionError:[0,'Custom']};receipts.set(hash,receipt);return hash}
  for(const ix of tx.instructions){
   if(ix.programId.equals(web3.ComputeBudgetProgram.programId)){instructions.push({programId:ix.programId,accounts:[],data:bs58.encode(ix.data)});continue}
   if(ix.programId.equals(web3.SystemProgram.programId)){assert.equal(web3.SystemInstruction.decodeInstructionType(ix),'Create');continue}
   if(ix.programId.toBase58()==='L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'){instructions.push({programId:ix.programId,accounts:ix.keys.map(k=>k.pubkey),data:bs58.encode(ix.data)});continue}   // Phantom's guard: assertions only
   if(ix.programId.equals(spl.ASSOCIATED_TOKEN_PROGRAM_ID)){const [,ata,recipient,mint]=ix.keys;if(!accounts.has(ata.pubkey.toBase58()))accounts.set(ata.pubkey.toBase58(),{owner:recipient.pubkey.toBase58(),mint:mint.pubkey.toBase58(),amount:0n});continue}
   if(ix.programId.equals(spl.TOKEN_PROGRAM_ID)||ix.programId.equals(spl.TOKEN_2022_PROGRAM_ID)){const P=ix.programId;
    switch(ix.data[0]){
     case spl.TokenInstruction.InitializeMint2:{const d=spl.decodeInitializeMint2Instruction(ix);assert.equal(d.data.freezeAuthority,null);mints.set(d.keys.mint.pubkey.toBase58(),{decimals:d.data.decimals,authority:d.data.mintAuthority,supply:0n});break}
     case spl.TokenInstruction.MintToChecked:{const d=spl.decodeMintToCheckedInstruction(ix),mint=mints.get(d.keys.mint.pubkey.toBase58());assert.ok(mint.authority.equals(d.keys.authority.pubkey));mint.supply+=d.data.amount;accounts.get(d.keys.destination.pubkey.toBase58()).amount+=d.data.amount;break}
     case spl.TokenInstruction.SetAuthority:{const d=spl.decodeSetAuthorityInstruction(ix);assert.equal(d.data.authorityType,spl.AuthorityType.MintTokens);assert.equal(d.data.newAuthority,null);mints.get(d.keys.account.pubkey.toBase58()).authority=null;break}
     case spl.TokenInstruction.TransferChecked:{const d=spl.decodeTransferCheckedInstruction(ix,P),from=accounts.get(d.keys.source.pubkey.toBase58()),to=accounts.get(d.keys.destination.pubkey.toBase58());assert.equal(from.owner,d.keys.owner.pubkey.toBase58());assert.ok(from.amount>=d.data.amount);from.amount-=d.data.amount;to.amount+=d.data.amount;break}
     case spl.TokenInstruction.BurnChecked:{const d=spl.decodeBurnCheckedInstruction(ix),ata=d.keys.account.pubkey.toBase58(),account=accounts.get(ata),mint=d.keys.mint.pubkey.toBase58(),index=keys.findIndex(k=>k.pubkey.equals(d.keys.account.pubkey));assert.equal(account.owner,d.keys.owner.pubkey.toBase58());assert.equal(d.data.decimals,6);assert.ok(account.amount>=d.data.amount);pre.push({accountIndex:index,mint,owner:account.owner,uiTokenAmount:{amount:account.amount.toString(),decimals:6}});account.amount-=d.data.amount;mints.get(mint).supply-=d.data.amount;post.push({accountIndex:index,mint,owner:account.owner,uiTokenAmount:{amount:account.amount.toString(),decimals:6}});instructions.push({programId:ix.programId,parsed:{type:'burnChecked',info:{account:ata,mint,authority:account.owner,tokenAmount:{amount:d.data.amount.toString(),decimals:6}}}});break}
     default:throw Error('Unexpected SPL instruction '+ix.data[0]);
    }
   }else{assert.equal(ix.programId.toBase58(),'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');instructions.push({programId:ix.programId,parsed:ix.data.toString()})}
  }
  receipts.set(hash,receipt);if(changeAfterSend){changeAfterSend=false;phantom.publicKey=other.publicKey;phantom.emit('accountChanged',other.publicKey)}return hash;
 }
}
function wallet(signer){const handlers=new Map();return {publicKey:signer.publicKey,connect:async()=>{},disconnect:async()=>{},on:(name,fn)=>handlers.set(name,fn),removeListener:name=>handlers.delete(name),emit:(name,arg)=>handlers.get(name)?.(arg),async signTransaction(tx){signCalls++;if(reject){reject=false;throw Object.assign(Error('rejected'),{code:4001})}if(walletPriority)tx.instructions.unshift(web3.ComputeBudgetProgram.setComputeUnitLimit({units:400000}),web3.ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000}));if(tamper){tamper=false;tx.add(web3.SystemProgram.transfer({fromPubkey:signer.publicKey,toPubkey:other.publicKey,lamports:1}))}if(walletAppend){const f=walletAppend;walletAppend=null;f(tx)}tx.partialSign(signer);if(solAfterSign!==null){solLamports=solAfterSign;solAfterSign=null}return tx}}}
const phantom=wallet(owner),solflare=wallet(tester);
const gasSafety=require('../transaction-safety/gas-safety.js');
const context={Buffer,console,URL,BigInt,AbortController,Response,clearTimeout,setTimeout:(fn,ms)=>setTimeout(fn,ms===15000?1:ms),fetch:async(input,options)=>{if(rpcFetchMode==='timeout')return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('Aborted'))));return new Response('{}',{status:rpcFetchMode==='rate'?429:200})},crypto:crypto.webcrypto,location:{protocol:'file:'},localStorage,dispatchEvent:()=>{},CustomEvent:class{},ShinobiSolana:{...web3,...spl,...require('../app/server/transaction-review.cjs'),Connection},ShinobiBetaConfig:{network:'solana-devnet',tokenAddress:null,studioAddress:studio.publicKey.toBase58()},phantom:{solana:phantom},solflare};context.window=context;
context.ShinobiGasSafety=gasSafety;
const html=fs.readFileSync(require('node:path').join(__dirname,'../app/public/index.html'),'utf8'),walletSource=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(code=>code.includes('// SOURCE: beta-wallet.js'));assert(walletSource,'assembled native wallet source exists');vm.createContext(context);vm.runInContext(walletSource,context);
(async()=>{
 const client=context.BetaWallet;await client.ready;await assert.rejects(client.connect('metamask'),/Phantom or Solflare/);await client.connect('phantom');
 genesis='mainnet';await assert.rejects(client.deploy(),/not Solana Devnet/);assert.equal(submitted.length,0);genesis=GENESIS;
 solLamports=0;await assert.rejects(client.deploy(),e=>e.code==='SOL_GAS_INSUFFICIENT'&&e.paymentNotSubmitted===true);assert.equal(signCalls,0);assert.equal(submitted.length,0);assert.equal(storage.has('shinobi-solana-pending-v1'),false);
 // Mint rent and signature fees alone are insufficient: both new associated token accounts count.
 solLamports=890880+1461600+10000;await assert.rejects(client.deploy(),/enough Devnet SOL/);assert.equal(signCalls,0);solLamports=1000000000;
 await client.deploy();const mint=client.state.tokenAddress;assert.equal(client.state.verified,true);assert.equal(client.state.tokenBalance,(980000000n*UNIT).toString());assert.equal(mints.get(mint).authority,null);assert.equal(submitted[0].instructions.length,7);assert.equal(submitted[0].signatures.length,2);
 await client.distribute(tester.publicKey.toBase58());await client.connect('solflare');assert.equal(client.state.account,tester.publicKey.toBase58());assert.equal(client.state.tokenBalance,(980000n*UNIT).toString());
 const result=await client.redeem(100000);assert.equal(client.state.tokenBalance,(880000n*UNIT).toString());assert.equal(client.verifyRedemption(result.receipt,result.record),result.record);client.acknowledge(result.record.hash);assert.equal((await client.recoverPending()).length,0);
 const forged=structuredClone(result.receipt);forged.transaction.message.instructions[1].parsed='wrong memo';assert.throws(()=>client.verifyRedemption(forged,result.record));
 assert.throws(()=>client.verifyRedemption(result.receipt,{...result.record,account:owner.publicKey.toBase58()}));assert.throws(()=>client.verifyRedemption(result.receipt,{...result.record,amount:1000000}));
 const balance=client.state.tokenBalance;reject=true;await assert.rejects(client.redeem(100000),/rejected/);assert.equal(client.state.tokenBalance,balance);
 const sentBeforeGas=submitted.length,signedBeforeGas=signCalls,pendingBeforeGas=storage.get('shinobi-solana-pending-v1');
 solLamports=0;await assert.rejects(client.redeem(100000),/enough Devnet SOL/);assert.equal(signCalls,signedBeforeGas);assert.equal(submitted.length,sentBeforeGas);assert.equal(storage.get('shinobi-solana-pending-v1'),pendingBeforeGas);solLamports=1000000000;
 feeUnavailable=true;await assert.rejects(client.redeem(100000),e=>e.code==='SOL_GAS_UNAVAILABLE');feeUnavailable=false;gasRpcError=true;await assert.rejects(client.redeem(100000),/could not be verified/);gasRpcError=false;assert.equal(signCalls,signedBeforeGas);
 solAfterSign=0;await assert.rejects(client.redeem(100000),/enough Devnet SOL/);solLamports=1000000000;assert.equal(submitted.length,sentBeforeGas);assert.equal(storage.get('shinobi-solana-pending-v1'),pendingBeforeGas);
 walletPriority=true;solLamports=890880+5000;await assert.rejects(client.redeem(100000),/enough Devnet SOL/);walletPriority=false;solLamports=1000000000;assert.equal(submitted.length,sentBeforeGas);assert.equal(storage.get('shinobi-solana-pending-v1'),pendingBeforeGas);
 tamper=true;await assert.rejects(client.redeem(100000),/differs/);assert.equal(client.state.tokenBalance,balance);
 failNext=true;await assert.rejects(client.redeem(100000),/failed/);assert.equal(accounts.get(spl.getAssociatedTokenAddressSync(new web3.PublicKey(mint),tester.publicKey).toBase58()).amount.toString(),balance);
 await client.connect('phantom');changeAfterSend=true;await assert.rejects(client.redeem(100000),/account changed/);phantom.publicKey=owner.publicKey;await client.connect('phantom');const recovered=await client.recoverPending();assert.equal(recovered.length,1);client.verifyRedemption(recovered[0].receipt,recovered[0].record);client.acknowledge(recovered[0].record.hash);assert.equal((await client.recoverPending()).length,0);
 mints.get(mint).authority=owner.publicKey;await assert.rejects(client.refresh(),/fixed-supply/);mints.get(mint).authority=null;
 await assert.rejects(client.installConfig('0x123'),/not configured/);assert.equal(client.format('123456789'),'123.456789');
 walletPriority=true;await client.deposit(100000,other.publicKey.toBase58(),crypto.randomUUID(),studio.publicKey.toBase58());walletPriority=false;const deposits=await client.recoverPending();assert.equal(deposits.length,1);assert.equal(client.pendingDeposits,1,'pending native deposit remains visible until acknowledgement');const depositReceipt=receipts.get(deposits[0].record.hash);receipts.delete(deposits[0].record.hash);assert.equal((await client.recoverPending()).length,0,'unresolved RPC receipt can return an empty recovery result');assert.equal(client.pendingDeposits,1,'empty recovery result does not erase native pending deposit');receipts.set(deposits[0].record.hash,depositReceipt);const selectedDeposit=deposits[0].record,selection=JSON.stringify([selectedDeposit,{...selectedDeposit,account:other.publicKey.toBase58()},{...selectedDeposit,tokenAddress:web3.Keypair.generate().publicKey.toBase58()},{...selectedDeposit,network:'solana-mainnet'},{...selectedDeposit,kind:'redemption'}]);storage.set('shinobi-solana-pending-v1',selection);assert.equal(client.pendingDeposits,1,'pending getter filters account, mint, network and deposit kind');storage.set('shinobi-solana-pending-v1',JSON.stringify([selectedDeposit]));assert.equal(deposits[0].record.kind,'deposit');client.acknowledge(deposits[0].record.hash);
 // Live deposit (studioAddress null from the live server's config): one transferChecked of the whole amount to custody, no studio account, memo.
 {const before=submitted.length,id=crypto.randomUUID(),r=await client.deposit(50000,other.publicKey.toBase58(),id,null),tx=submitted[submitted.length-1];assert.equal(submitted.length,before+1);
  const transfers=tx.instructions.filter(i=>i.programId.equals(spl.TOKEN_PROGRAM_ID)).map(i=>spl.decodeTransferCheckedInstruction(i)),atas=tx.instructions.filter(i=>i.programId.equals(spl.ASSOCIATED_TOKEN_PROGRAM_ID)),memos=tx.instructions.filter(i=>i.programId.toBase58()==='MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  const custodyAta=spl.getAssociatedTokenAddressSync(new web3.PublicKey(mint),other.publicKey).toBase58();
  assert.deepEqual(transfers.map(t=>[t.data.amount,t.keys.destination.pubkey.toBase58()]),[[50000n*UNIT,custodyAta]],'fee-free: the whole amount to custody in one transfer');
  assert.deepEqual(atas.map(i=>i.keys[1].pubkey.toBase58()),[custodyAta],'only the custody token account is created');assert.deepEqual(memos.map(i=>i.data.toString()),['shinobi-deposit-v2:'+id]);
  assert.equal(r.record.studioFee,0);client.acknowledge(r.record.hash);}
 // Token-2022 SR mint (as released on Mainnet): the wallet reads the mint's owner program on-chain and uses it for the
 // balance account, the custody account creation and the transfer. Other programs never reach a signature.
 {const P22=spl.TOKEN_2022_PROGRAM_ID,m22=web3.Keypair.generate().publicKey,me=new web3.PublicKey(client.state.account);
  mints.set(m22.toBase58(),{decimals:6,authority:null,supply:mints.get(mint).supply,program:P22});
  const mine=spl.getAssociatedTokenAddressSync(m22,me,false,P22).toBase58(),custodyAta=spl.getAssociatedTokenAddressSync(m22,other.publicKey,false,P22).toBase58();
  accounts.set(mine,{owner:me.toBase58(),mint:m22.toBase58(),amount:300000n*UNIT});
  await client.installConfig(m22.toBase58());assert.equal(client.state.tokenAddress,m22.toBase58());assert.equal(client.state.tokenBalance,(300000n*UNIT).toString(),'balance read from the Token-2022 account');
  const before=submitted.length,id=crypto.randomUUID(),r=await client.deposit(40000,other.publicKey.toBase58(),id,null),tx=submitted[submitted.length-1];assert.equal(submitted.length,before+1);
  assert(!tx.instructions.some(i=>i.programId.equals(spl.TOKEN_PROGRAM_ID)),'no classic token instruction for a Token-2022 mint');
  const transfers=tx.instructions.filter(i=>i.programId.equals(P22)).map(i=>spl.decodeTransferCheckedInstruction(i,P22)),atas=tx.instructions.filter(i=>i.programId.equals(spl.ASSOCIATED_TOKEN_PROGRAM_ID));
  assert.deepEqual(transfers.map(t=>[t.data.amount,t.keys.source.pubkey.toBase58(),t.keys.destination.pubkey.toBase58(),t.keys.mint.pubkey.toBase58()]),[[40000n*UNIT,mine,custodyAta,m22.toBase58()]]);
  assert.deepEqual(atas.map(i=>[i.keys[1].pubkey.toBase58(),i.keys[5].pubkey.toBase58()]),[[custodyAta,P22.toBase58()]],'custody account created under Token-2022');
  assert.equal(accounts.get(custodyAta).amount,40000n*UNIT);assert.equal(accounts.get(mine).amount,260000n*UNIT);client.acknowledge(r.record.hash);
  // Phantom on Mainnet appends Lighthouse guard instructions: accepted (assertions only); anything else is still refused.
  const LH=new web3.PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'),guard=keys=>new web3.TransactionInstruction({programId:LH,keys,data:Buffer.from([10,1,2,3])});
  walletAppend=tx=>tx.add(guard([{pubkey:new web3.PublicKey(mine),isSigner:false,isWritable:false}]));
  {const before=submitted.length,r2=await client.deposit(10000,other.publicKey.toBase58(),crypto.randomUUID(),null);assert.equal(submitted.length,before+1,'a deposit with a Lighthouse guard is submitted');
   assert(submitted[submitted.length-1].instructions.some(i=>i.programId.equals(LH)));assert.equal(accounts.get(custodyAta).amount,50000n*UNIT);client.acknowledge(r2.record.hash);}
  walletAppend=tx=>tx.add(new web3.TransactionInstruction({programId:web3.Keypair.generate().publicKey,keys:[],data:Buffer.from([1])}));
  await assert.rejects(client.deposit(10000,other.publicKey.toBase58(),crypto.randomUUID(),null),/differs from the reviewed request.*wallet programs/,'any other added program is refused');
  walletAppend=tx=>tx.add(guard([{pubkey:web3.Keypair.generate().publicKey,isSigner:false,isWritable:true}]));
  await assert.rejects(client.deposit(10000,other.publicKey.toBase58(),crypto.randomUUID(),null),/unexpected account added/,'a Lighthouse instruction may not add a writable account');
  assert.equal(accounts.get(custodyAta).amount,50000n*UNIT,'refused deposits moved nothing');
  mints.set(m22.toBase58(),{decimals:6,authority:null,supply:mints.get(mint).supply,program:web3.Keypair.generate().publicKey});
  await assert.rejects(client.installConfig(m22.toBase58()),'a mint owned by any other program is refused');
  await client.installConfig(mint);assert.equal(client.state.tokenAddress,mint);}
 await client.recoverPending();assert.match(client.state.message,/No pending/);assert.equal(client.state.busy,false);
 const preserved=JSON.stringify([deposits[0].record]);storage.set('shinobi-solana-pending-v1',preserved);rpcFetchMode='rate';await assert.rejects(client.recoverPending(),/rate-limit/);assert.equal(client.state.busy,false);assert.equal(storage.get('shinobi-solana-pending-v1'),preserved);rpcFetchMode='timeout';await assert.rejects(client.recoverPending(),/timed out/);assert.equal(client.state.busy,false);assert.equal(storage.get('shinobi-solana-pending-v1'),preserved);rpcFetchMode='ok';assert.equal(client.pendingDeposits,1,'failed status refresh never erases native pending record');await client.recoverPending();client.acknowledge(deposits[0].record.hash);
 console.log(JSON.stringify({wallets:'Phantom + Solflare',mainnetRpc:'blocked before signing',mint:'1b total: 980m issuer + 20m studio; authority revoked; signatures verified',distribution:'1m gross: 980k tester + 20k studio',burn:'finalized receipt + memo + balance delta verified',rejection:'no burn',walletMutation:'blocked',failedTransaction:'no burn/credit',accountChange:'recover once after reconnect',deposit:'SPL transfer and unique memo; pending recovery',invalidMintAndReceipt:'rejected',pendingDepositGetter:'owner/mint/network/kind scoped; empty or failed receipt recovery preserves count; acknowledgement clears count',validation:'SDK signatures/serialization with simulated RPC; no validator/public deployment'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});




