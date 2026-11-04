/* ryo-sol-gas-preflight-v1 — shared by the native wallet and server token checkout. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ShinobiGasSafety=api;
})(globalThis,function(){
 'use strict';
 const ATA_PROGRAM='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
 function error(code,message){return Object.assign(new Error(message),{code,status:503,paymentNotSubmitted:true})}
 function lamports(value){if(typeof value==='bigint'){if(value>=0n&&value<=BigInt(Number.MAX_SAFE_INTEGER))return value}else if(Number.isSafeInteger(value)&&value>=0)return BigInt(value);throw error('SOL_GAS_UNAVAILABLE','SOL network fees or balance could not be verified. No new payment was submitted. Refresh and retry.')}
 function sol(value){return (Number(value)/1e9).toLocaleString('en-US',{minimumFractionDigits:9,maximumFractionDigits:9})}
 async function deadline(task,ms){let timer;try{return await Promise.race([task,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('SOL verification timed out')),Math.max(1,Math.min(8000,ms)))})])}finally{clearTimeout(timer)}}
 async function assertGas(connection,sdk,tx,{label='Your wallet',commitment='confirmed',timeoutMs=8000}={}){
  try{
   if(!tx.feePayer)throw Error('Missing fee payer');
   const payer=tx.feePayer,atas=new Map();let nativeSpend=0n;
   for(const ix of tx.instructions){
    if(ix.programId.toString()===ATA_PROGRAM&&ix.keys[0]?.pubkey.equals(payer))atas.set(ix.keys[1].pubkey.toBase58(),ix.keys[1].pubkey);
    if(ix.programId.equals(sdk.SystemProgram.programId)){
     const kind=sdk.SystemInstruction.decodeInstructionType(ix);
     if(kind==='Create'){const data=sdk.SystemInstruction.decodeCreateAccount(ix);if(data.fromPubkey.equals(payer))nativeSpend+=lamports(data.lamports)}
     else if(kind==='Transfer'){const data=sdk.SystemInstruction.decodeTransfer(ix);if(data.fromPubkey.equals(payer))nativeSpend+=lamports(data.lamports)}
     else throw Error('Unsupported native SOL instruction');
    }
   }
   const [feeResult,balanceValue,reserveValue,ataRentValue,infos]=await deadline(Promise.all([
    connection.getFeeForMessage(tx.compileMessage(),commitment),connection.getBalance(payer,commitment),
    connection.getMinimumBalanceForRentExemption(0,commitment),
    atas.size?connection.getMinimumBalanceForRentExemption(165,commitment):Promise.resolve(0),
    Promise.all([...atas.values()].map(ata=>connection.getAccountInfo(ata,commitment)))
   ]),timeoutMs);
   if(feeResult?.value===null||feeResult?.value===undefined)throw Error('Fee estimate unavailable');
   const fee=lamports(feeResult.value),balance=lamports(balanceValue),reserve=lamports(reserveValue),ataRent=lamports(ataRentValue);
   const rent=infos.reduce((total,info)=>{if(info===null)return total+ataRent;if(info?.owner?.equals?.(sdk.SystemProgram.programId)){const held=lamports(info.lamports);return total+(held<ataRent?ataRent-held:0n)}return total},0n);
   const required=fee+nativeSpend+rent+reserve;
   if(balance<required)throw error('SOL_GAS_INSUFFICIENT',label+' does not have enough Devnet SOL for network fees and account creation. Required: '+sol(required)+' SOL (including a minimum SOL reserve); available: '+sol(balance)+' SOL. '+(label==='Your wallet'?'Add Devnet SOL, then retry.':'The operator must top up the custody wallet. Please try again later.')+' No new payment was submitted.');
   return {requiredLamports:String(required),feeLamports:String(fee),rentLamports:String(rent),reserveLamports:String(reserve)};
  }catch(e){if(e?.code==='SOL_GAS_INSUFFICIENT')throw e;throw error('SOL_GAS_UNAVAILABLE',label+' SOL network fees or balance could not be verified. No new payment was submitted. Refresh and retry.')}
 }
 return {assertGas};
});
