/* SOL preflight cost edges and Chest UX; isolated fixtures, no real token transactions. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const sdk=require('../app/node_modules/@solana/web3.js'),spl=require('../app/node_modules/@solana/spl-token');
const {assertGas}=require('../transaction-safety/gas-safety.js'),{withGame}=require('./harness.cjs');
(async()=>{
 const payer=sdk.Keypair.generate().publicKey,mint=sdk.Keypair.generate().publicKey,target=sdk.Keypair.generate().publicKey,ata=spl.getAssociatedTokenAddressSync(mint,target);
 const tx=new sdk.Transaction({feePayer:payer,recentBlockhash:sdk.Keypair.generate().publicKey.toBase58()}).add(spl.createAssociatedTokenAccountIdempotentInstruction(payer,ata,target,mint),spl.createAssociatedTokenAccountIdempotentInstruction(payer,ata,target,mint));
 let existing=false,balance=5000+890880+2039280;const rpc={getFeeForMessage:async()=>({value:5000}),getBalance:async()=>balance,getMinimumBalanceForRentExemption:async size=>size===0?890880:2039280,getAccountInfo:async()=>existing?{}:null};
 const cost=await assertGas(rpc,sdk,tx);assert.equal(cost.rentLamports,'2039280','duplicate ATA instructions fund one account');assert.equal(cost.requiredLamports,String(balance),'exact funded boundary includes account rent and reserve');
 balance--;await assert.rejects(assertGas(rpc,sdk,tx),e=>e.paymentNotSubmitted===true&&e.code==='SOL_GAS_INSUFFICIENT');
 existing=true;balance=5000+890880;assert.equal((await assertGas(rpc,sdk,tx)).rentLamports,'0','existing accounts do not charge creation rent again');
 // Actual token-creation fee payer also funds its native create-account instruction.
 tx.add(sdk.SystemProgram.createAccount({fromPubkey:payer,newAccountPubkey:sdk.Keypair.generate().publicKey,lamports:1461600,space:82,programId:spl.TOKEN_PROGRAM_ID}));await assert.rejects(assertGas(rpc,sdk,tx),/enough Devnet SOL/);
 await assert.rejects(assertGas({...rpc,getFeeForMessage:async()=>({value:null})},sdk,tx),e=>e.code==='SOL_GAS_UNAVAILABLE');
 await assert.rejects(assertGas({...rpc,getBalance:()=>new Promise(()=>{})},sdk,tx,{timeoutMs:20}),e=>e.code==='SOL_GAS_UNAVAILABLE'&&e.paymentNotSubmitted===true,'a stalled fee/balance RPC stops without submission');
 const prefundedTx=new sdk.Transaction({feePayer:payer,recentBlockhash:sdk.Keypair.generate().publicKey.toBase58()}).add(spl.createAssociatedTokenAccountIdempotentInstruction(payer,ata,target,mint));
 balance=5000+890880+2039280-100;assert.equal((await assertGas({...rpc,getAccountInfo:async()=>({owner:sdk.SystemProgram.programId,lamports:100})},sdk,prefundedTx)).rentLamports,'2039180','a prefunded system-owned ATA still needs the remaining token-account rent');
 await withGame(async({p,f,errors})=>{
  assert.equal(await p.evaluate(()=>typeof window.ShinobiGasSafety?.assertGas==='function'&&typeof window.ShinobiSolana?.SystemInstruction?.decodeCreateAccount==='function'),true,'production browser SDK and shared gas helper are available before checkout');
  f.holdAdventure=false;await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!RyoPayments.state.busy&&!LoginScreen.active);
  let definitelyUnsent=true;
  await p.route('**/.netlify/functions/ryo',async route=>{const input=route.request().postDataJSON();if(['withdraw','purchase'].includes(input.action))return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'The game custody wallet does not have enough Devnet SOL. No new payment was submitted.',...(definitelyUnsent?{paymentNotSubmitted:true}:{})})});return route.fallback()});
  const apiGas=await p.evaluate(async()=>{const rejected=[];for(const action of ['withdraw','purchase'])try{if(action==='withdraw')await RyoPayments.withdraw(100000);else await RyoPayments.purchase(await RyoPayments.quote('summon',{quantity:1}))}catch(e){rejected.push(e.paymentNotSubmitted===true)}return {rejected,withdraw:localStorage.getItem('shinobi-ryo-withdraw-request-v1'),purchase:localStorage.getItem('shinobi-ryo-purchase-request-v2'),balance:RyoPayments.state.balance}});
  assert.deepEqual(apiGas,{rejected:[true,true],withdraw:null,purchase:null,balance:500000},'explicit unsent server rejections clear only their local request handles');
  definitelyUnsent=false;
  await p.evaluate(async()=>{try{await RyoPayments.withdraw(100000)}catch{}});assert(await p.evaluate(()=>!!localStorage.getItem('shinobi-ryo-withdraw-request-v1')),'an ambiguous server failure retains recovery state');
  await p.evaluate(()=>localStorage.removeItem('shinobi-ryo-withdraw-request-v1'));definitelyUnsent=true;
  await p.evaluate(()=>{window.__gasAttempts=0;window.__originalGasDeposit=RyoPayments.deposit;RyoPayments.deposit=async()=>{window.__gasAttempts++;throw Object.assign(Error('Your wallet does not have enough Devnet SOL for network fees and account creation. Add Devnet SOL, then retry. No new payment was submitted.'),{paymentNotSubmitted:true})}});
  await p.locator('[data-gc-chest]').click();await p.getByRole('button',{name:'Deposit Ryo',exact:true}).click();await p.locator('#gc-transfer-amount').fill('1000');await p.getByRole('button',{name:'Review deposit',exact:true}).click();await p.getByRole('button',{name:'Confirm deposit',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('.gc-message-error')?.textContent.includes('enough Devnet SOL'));
  assert.equal(await p.getByRole('button',{name:'Confirm deposit',exact:true}).isEnabled(),true,'definitely unsent gas rejection remains retryable, with no false recovery lock');assert.equal(await p.evaluate(()=>BetaWallet.pendingDeposits),0);assert(!f.requests.some(r=>r.action==='deposit'));
  await p.getByRole('button',{name:'Confirm deposit',exact:true}).click();await p.waitForFunction(()=>window.__gasAttempts===2&&!RyoPayments.state.busy);assert.equal(f.balance,500000);
  fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});await p.screenshot({path:path.join(__dirname,'out/gas-preflight-desktop.png')});await p.setViewportSize({width:390,height:844});await p.screenshot({path:path.join(__dirname,'out/gas-preflight-mobile.png')});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 });
 console.log('PASS: SOL fee/rent/reserve boundaries, ATA deduplication, existing-account rent, fail-closed estimates, and Chest retry without fake pending/debit on desktop/mobile.');
})().catch(e=>{console.error(e);process.exitCode=1});
