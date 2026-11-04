'use strict';
const fs=require('node:fs'),path=require('node:path');
const walletPatches=[
 ['const reviewed=Buffer.from(tx.serializeMessage()),signed=await ctx.provider.signTransaction(tx);',"await window.ShinobiGasSafety.assertGas(connection,sdk,tx);await assertContext(ctx);\n  const reviewed=Buffer.from(tx.serializeMessage()),signed=await ctx.provider.signTransaction(tx);"],
 ['store(record);state.txHash=hash;',"await window.ShinobiGasSafety.assertGas(connection,sdk,checked.transaction);await assertContext(ctx);\n  store(record);state.txHash=hash;"]
];
const servicePatch=['tx.sign(treasury);return',"await require('./gas-safety.cjs').assertGas(connection,web3,tx,{label:'The game custody wallet',commitment:'finalized'});tx.sign(treasury);return"];
const apiPatches=[
 ["{status:response.status})}return value;","{status:response.status,paymentNotSubmitted:value.paymentNotSubmitted===true})}return value;"],
 ['if(e.status>=400&&e.status<500)localStorage.removeItem(pendingWithdrawKey);','if(e.paymentNotSubmitted===true||(e.status>=400&&e.status<500))localStorage.removeItem(pendingWithdrawKey);'],
 ['if(e.status>=400&&e.status<500)localStorage.removeItem(storageKey);','if(e.paymentNotSubmitted===true||(e.status>=400&&e.status<500))localStorage.removeItem(storageKey);']
];
const handlerPatch=["JSON.stringify({error:e.status?e.message:","JSON.stringify({...(['SOL_GAS_INSUFFICIENT','SOL_GAS_UNAVAILABLE'].includes(e.code)?{paymentNotSubmitted:true}:{}),error:e.status?e.message:"];
function applyTransactionSafety(appDir=path.join(__dirname,'app')){
 const edit=(file,patches)=>{const target=path.join(appDir,file);let source=fs.readFileSync(target,'utf8');for(const [before,after]of patches){if(source.includes(after))continue;if(source.split(before).length!==2)throw Error('Gas safety patch mismatch: '+file);source=source.replace(before,()=>after)}fs.writeFileSync(target,source)};
 edit('public/index.html',[...walletPatches,...apiPatches]);
 edit('public/index.html',[['</head>','<script src="assets/transaction-safety/gas-safety.js"></script>\n</head>']]);
 edit('server/service.cjs',[servicePatch]);
 edit('server/netlify-handler.cjs',[handlerPatch]);
 const assetDir=path.join(appDir,'public/assets/transaction-safety');fs.mkdirSync(assetDir,{recursive:true});
 const source=path.join(__dirname,'transaction-safety/gas-safety.js');fs.copyFileSync(source,path.join(assetDir,'gas-safety.js'));fs.copyFileSync(source,path.join(appDir,'server/gas-safety.cjs'));
 console.log('SOL gas preflight applied before wallet signing/broadcast and server Ryo reservations.');
}
module.exports={applyTransactionSafety,walletPatches,apiPatches,servicePatch,handlerPatch};if(require.main===module)applyTransactionSafety();
