/* Adversarial wallet discovery/signing fixtures; no RPC, wallet keys or transactions. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../prelaunch/wallet.js'),'utf8');
const ADDRESS='7jY9NvNLhJQYi4fEB1qp1z8BjQmWKnC8EZaMgbRy3D6X';
const account={address:ADDRESS,chains:['solana:mainnet'],features:['solana:signMessage']};
function fixture(){
 const events=new Map(),ctx={Uint8Array,ArrayBuffer,TextEncoder,Date,location:{host:'portal.example',origin:'https://portal.example'},btoa:s=>Buffer.from(s,'binary').toString('base64')};
 ctx.window=ctx;ctx.CustomEvent=class{constructor(type,options){this.type=type;this.detail=options.detail}};
 ctx.addEventListener=(name,fn)=>{const list=events.get(name)||[];list.push(fn);events.set(name,list)};
 ctx.dispatchEvent=e=>{for(const fn of events.get(e.type)||[])fn(e)};
 vm.runInNewContext(source,ctx);let registry;
 ctx.dispatchEvent(new ctx.CustomEvent('wallet-standard:register-wallet',{detail:api=>{registry=api}}));
 return {ctx,api:ctx.SBWallet,register:(...w)=>registry.register(...w)};
}
function wallet(name,custom={}){
 const calls={connect:0,sign:0,transaction:0};let change;
 const forbidden=()=>{calls.transaction++;throw Error('Transaction must never be requested')};
 const w={name,chains:['solana:mainnet'],accounts:[account],features:{
  'standard:connect':{connect:async()=>{calls.connect++;return{accounts:w.accounts}}},
  'standard:events':{on:(_event,fn)=>{change=fn;return()=>{change=null}}},
  'solana:signMessage':{signMessage:async({message})=>{calls.sign++;return[{signedMessage:message,signature:new Uint8Array(64),signatureType:'ed25519'}]}},
  'solana:signTransaction':{signTransaction:forbidden},'solana:signAndSendTransaction':{signAndSendTransaction:forbidden}
 },...custom};
 return{w,calls,change:accounts=>change?.({accounts})};
}
function challenge(at=Date.now()){
 const nonce='1234567890abcdef1234567890abcdef';
 return{nonce,message:['portal.example wants you to sign in with your Solana account:',ADDRESS,'','Sign in to Shinobi Bombers. This is free: it does not send a transaction or move any funds.','','URI: https://portal.example','Version: 1','Chain ID: mainnet','Nonce: '+nonce,'Issued At: '+new Date(at).toISOString(),'Expiration Time: '+new Date(at+120000).toISOString()].join('\n')};
}
(async()=>{
 const f=fixture(),phantom=wallet('Phantom'),solflare=wallet('Solflare'),generic=wallet('Other Wallet'),meta=wallet('MetaMask'),alias=wallet('Meta Mask (Solana)');
 f.register(meta.w,generic.w,alias.w,solflare.w,phantom.w,{name:'Broken',chains:['solana:mainnet'],features:{'standard:connect':{},'solana:signMessage':{}}});
 assert.deepEqual(Array.from(f.api.list(),x=>x.name),['Phantom','Solflare','Other Wallet']);assert.equal(f.api.list()[0].wallet,undefined);assert.equal(f.api.list()[0].provider,undefined);
 await assert.rejects(f.api.connect('std:MetaMask'),e=>e.code==='WALLET_NO_SIGN');assert.equal(meta.calls.connect,0);
 await f.api.connect('std:Phantom');assert.equal(Buffer.from(await f.api.signMessage(challenge().message),'base64').length,64);assert.equal(phantom.calls.transaction,0);
 const before=phantom.calls.sign;
 for(const text of [challenge().message.replace('URI: https://portal.example','URI: https://portal.example.evil'),challenge().message+'\nResources:\n- transfer',challenge().message.replace('Version: 1','Version: 2'),challenge(Date.now()-120001).message])await assert.rejects(f.api.signMessage(text));
 assert.equal(phantom.calls.sign,before,'reject invalid payload before asking the wallet');
 assert.throws(()=>f.api.validateChallenge({...challenge(),nonce:'bad'},ADDRESS,'mainnet'));
 assert.throws(()=>f.api.validateChallenge({message:challenge().message},ADDRESS,'mainnet'),'missing server nonce must fail before signing');
 assert.throws(()=>f.api.validateChallenge(challenge(),ADDRESS,'devnet'));
 phantom.change([]);assert.equal(f.api.active,null);await assert.rejects(f.api.signMessage(challenge().message),e=>e.code==='SIGN_IN');
 const wrong=wallet('Wrong accounts',{accounts:[{...account,chains:['eip155:1']}]}),mutating=wallet('Mutating');f.register(wrong.w,mutating.w);
 await assert.rejects(f.api.connect('std:Wrong accounts'),e=>e.code==='WALLET_REJECTED');
 mutating.w.features['solana:signMessage'].signMessage=async({message})=>{message[0]^=1;return[{signedMessage:message,signature:new Uint8Array(64)}]};
 await f.api.connect('std:Mutating');await assert.rejects(f.api.signMessage(challenge().message),e=>e.code==='SIGNATURE_INVALID');
 const mismatch=wallet('Mismatch');mismatch.w.features['solana:signMessage'].signMessage=async()=>[{signedMessage:new Uint8Array([1,2]),signature:new Uint8Array(64)}];f.register(mismatch.w);
 await f.api.connect('std:Mismatch');await assert.rejects(f.api.signMessage(challenge().message),e=>e.code==='SIGNATURE_INVALID');
 const late=wallet('Late');let release;late.w.features['solana:signMessage'].signMessage=({message})=>new Promise(r=>{release=()=>r([{signedMessage:message,signature:new Uint8Array(64)}])});f.register(late.w);
 await f.api.connect('std:Late');const pending=f.api.signMessage(challenge().message);await f.api.disconnect();release();await assert.rejects(pending,e=>e.code==='SIGN_IN');
 const legacy=fixture();let legacySigns=0,legacyTx=0;legacy.ctx.phantom={solana:{isPhantom:true,publicKey:{toBase58:()=>ADDRESS},connect:async()=>{},signMessage:async()=>{legacySigns++;return{signature:new Uint8Array(64)}},signTransaction:()=>{legacyTx++}}};
 assert.equal(legacy.api.list()[0].id,'legacy:phantom');await legacy.api.connect('legacy:phantom');await legacy.api.signMessage(challenge().message);assert.equal(legacySigns,1);assert.equal(legacyTx,0);
 legacy.ctx.phantom.solana.isMetaMask=true;assert.equal(legacy.api.list().length,0,'MetaMask-marked legacy provider stays hidden');
 assert.equal(f.api.errorCode(Error('Continue at your own risk. This site shows signs of phishing or wallet-draining activity.')),'WALLET_SECURITY_WARNING');
 console.log('PASS: Phantom/Solflare ordering, MetaMask aliases blocked, generic Wallet Standard retained, legacy message signatures, strict SIWS binding, mutation/account/expiry/stale-signature rejection and zero transaction calls.');
})().catch(e=>{console.error(e);process.exitCode=1});
