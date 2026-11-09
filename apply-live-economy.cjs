/* Live economy build step (owner decision 2026-11-09; runs after apply-founders, see unpack.cjs).
 * Copies live-economy/server.cjs to app/server/live-economy.cjs and applies exact-string hooks (each must match once):
 *   service.cjs         studio/revenue wallets optional on live; fee-free deposit verifier on live; deposit `config`
 *                       fields; Boss Hunt treasury share to the registered Locked Treasury on live.
 *   netlify-handler.cjs studio/revenue wallets not required on live.
 *   index.html          the wallet builds a one-transfer, fee-free deposit when the server's config has studioAddress null
 *                       (only the live server sends that); the Devnet build keeps the 2% studio-fee deposit unchanged.
 * Live-only wording (liveClientPatches) is applied by apply-network.cjs on Mainnet builds, like apply-treasury's.
 * Only source files are edited; app/ is generated. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const L = "require('./live-economy.cjs')";

const serviceHooks = [
  ['address(mint);address(studioAddress);address(revenueAddress);', 'address(mint);' + L + '.wallets(address,studioAddress,revenueAddress);'],
  ['const split=verifyDeposit(receipt,{', 'const split=' + L + '.verifier(verifyDeposit,{spl,key,MEMO,UNIT,stripComputeBudgetInstructions})(receipt,{'],
  // After apply-treasury's publicConfig (which owns the studioFeeBps:200 text): later keys win, so on live the config
  // reports studioAddress null and studioFeeBps 0 without editing another step's output.
  ["...require('./treasury-rewards.cjs').publicConfig(),", "...require('./treasury-rewards.cjs').publicConfig(),..." + L + ".depositConfig(studioAddress),"],
  ["...(q.treasury>0?transferTo(revenueAddress,BigInt(q.treasury)*UNIT):[]),spl.createBurnCheckedInstruction(treasuryAta,key(mint),treasury.publicKey,BigInt(q.burn)*UNIT,6),memo('shinobi-hunt-v1:'",
   "...(q.treasury>0?transferTo(" + L + ".huntTreasury(revenueAddress),BigInt(q.treasury)*UNIT):[]),spl.createBurnCheckedInstruction(treasuryAta,key(mint),treasury.publicKey,BigInt(q.burn)*UNIT,6,[]," + L + ".programId()),memo('shinobi-hunt-v1:'"],
  // SR token program (classic SPL Token or Token-2022, from the reviewed registry on live; classic on the test server):
  // the mint check, the custody account, payouts and burns all use it. Applied after the Boss Hunt hook above.
  ["const value=await spl.getMint(connection,key(mint),'finalized');", 'const value=await ' + L + '.getMint(connection,mint);'],
  ['spl.getAssociatedTokenAddressSync(key(mint),treasury.publicKey)', 'spl.getAssociatedTokenAddressSync(key(mint),treasury.publicKey,false,' + L + '.programId())'],
  // Payouts: the classic `ata` computed by the original (and apply-sr-revenue's text) is left as is; the instructions use
  // the registered program's account. Only text after "return [" is replaced, so every earlier step stays re-runnable.
  ['spl.createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey,ata,owner,key(mint)),spl.createTransferCheckedInstruction(treasuryAta,key(mint),ata,treasury.publicKey,raw,6)]}',
   'spl.createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey,' + L + '.ata(key(mint),owner),owner,key(mint),' + L + '.programId()),spl.createTransferCheckedInstruction(treasuryAta,key(mint),' + L + '.ata(key(mint),owner),treasury.publicKey,raw,6,[],' + L + '.programId())]}'],
  ["spl.createBurnCheckedInstruction(treasuryAta,key(mint),treasury.publicKey,BigInt(q.burn)*UNIT,6)]:[]),memo('shinobi-purchase-v2:'", "spl.createBurnCheckedInstruction(treasuryAta,key(mint),treasury.publicKey,BigInt(q.burn)*UNIT,6,[]," + L + ".programId())]:[]),memo('shinobi-purchase-v2:'"],
];
// No free starter heroes on live (live-economy initialProfile / cleanStarterProfile; the test server is unchanged).
const economyHooks = [
  ['function initialProfile(){return {version:1,dojo:0,sensei:false,heroes:[hero(),hero()]}}', 'function initialProfile(){return ' + L + '.initialProfile({version:1,dojo:0,sensei:false,heroes:[hero(),hero()]})}'],
  ['function normalizeProfile(profile){', 'function normalizeProfile(profile){' + L + '.cleanStarterProfile(profile);'],
];
// /beta-config.json: on live the token config is ready with the mint alone and publishes no studio destination.
const renderHooks = [
  ["if(!process.env.RYO_TOKEN_MINT||!process.env.RYO_STUDIO_WALLET)return send(res,503,{error:'Public token configuration is not ready.'});",
   "if(!" + L + ".tokenConfigReady())return send(res,503,{error:'Public token configuration is not ready.'});"],
  ['tokenAddress:process.env.RYO_TOKEN_MINT,studioAddress:process.env.RYO_STUDIO_WALLET}', 'tokenAddress:process.env.RYO_TOKEN_MINT,studioAddress:' + L + '.publicStudio()}'],
];
const handlerHooks = [
  ['const required={DATABASE_URL,RYO_TREASURY_SECRET,RYO_TOKEN_MINT,RYO_SITE_ORIGIN,RYO_STUDIO_WALLET,RYO_REVENUE_WALLET};',
   'const required=' + L + '.required({DATABASE_URL,RYO_TREASURY_SECRET,RYO_TOKEN_MINT,RYO_SITE_ORIGIN,RYO_STUDIO_WALLET,RYO_REVENUE_WALLET});'],
];
// Wallet deposit: studioAddress === null means "fee-free" (one transfer of the whole amount to custody, no studio account).
const clientPatches = [
  ['!valid(studioAddress)||treasuryAddress===studioAddress||', '(studioAddress!==null&&(!valid(studioAddress)||treasuryAddress===studioAddress))||', 1],
  ['const studioFee=Math.ceil(amount/50),net=amount-studioFee;', 'const studioFee=studioAddress===null?0:Math.ceil(amount/50),net=amount-studioFee;', 1],
  ["return run('Deposit '+amount.toLocaleString()+' tokens: '+studioFee.toLocaleString()+' studio fee, '+net.toLocaleString()+' deposited Ryo.',",
   "return run(studioAddress===null?'Deposit '+amount.toLocaleString()+' tokens to your game balance (no deposit fee).':'Deposit '+amount.toLocaleString()+' tokens: '+studioFee.toLocaleString()+' studio fee, '+net.toLocaleString()+' deposited Ryo.',", 1],
  ['const studio=key(studioAddress),studioAta=sdk.getAssociatedTokenAddressSync(mint,studio);',
   'const feeFree=studioAddress===null,studio=feeFree?null:key(studioAddress),studioAta=feeFree?null:sdk.getAssociatedTokenAddressSync(mint,studio);', 1],
  ['sdk.createAssociatedTokenAccountIdempotentInstruction(owner,destination,treasury,mint),sdk.createAssociatedTokenAccountIdempotentInstruction(owner,studioAta,studio,mint),sdk.createTransferCheckedInstruction(source,mint,destination,owner,BigInt(net)*UNIT,DECIMALS),sdk.createTransferCheckedInstruction(source,mint,studioAta,owner,BigInt(studioFee)*UNIT,DECIMALS),',
   'sdk.createAssociatedTokenAccountIdempotentInstruction(owner,destination,treasury,mint,tokenProgram),...(feeFree?[]:[sdk.createAssociatedTokenAccountIdempotentInstruction(owner,studioAta,studio,mint)]),sdk.createTransferCheckedInstruction(source,mint,destination,owner,BigInt(net)*UNIT,DECIMALS,[],tokenProgram),...(feeFree?[]:[sdk.createTransferCheckedInstruction(source,mint,studioAta,owner,BigInt(studioFee)*UNIT,DECIMALS)]),', 1],
  ["notify('Deposit finalized: '+(amount-Math.ceil(amount/50)).toLocaleString()+' Ryo credited after the 2% studio fee.')",
   "notify(result.record?.studioFee===0?'Deposit finalized: '+amount.toLocaleString()+' Ryo credited (no deposit fee).':'Deposit finalized: '+(amount-Math.ceil(amount/50)).toLocaleString()+' Ryo credited after the 2% studio fee.')", 1],
  // SR token program: verifyMint reads the mint account's owner on-chain and accepts only classic SPL Token or Token-2022
  // (anything else fails in getMint); the balance account and the deposit then use that program. A classic mint behaves
  // exactly as before (tokenProgram undefined -> the library default). The server verifies the registered program anyway.
  ['provider=null,listeners=null;', 'provider=null,listeners=null,tokenProgram;', 1],
  ["const mint=await sdk.getMint(connection,key(address),'confirmed',sdk.TOKEN_PROGRAM_ID);",
   "const owner=(await connection.getAccountInfo(key(address),'confirmed'))?.owner?.toBase58(),program=owner==='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'?key(owner):sdk.TOKEN_PROGRAM_ID;const mint=await sdk.getMint(connection,key(address),'confirmed',program);tokenProgram=program.equals(sdk.TOKEN_PROGRAM_ID)?undefined:program;", 1],
  ['const ata=sdk.getAssociatedTokenAddressSync(key(state.tokenAddress),key(account));', 'const ata=sdk.getAssociatedTokenAddressSync(key(state.tokenAddress),key(account),false,tokenProgram);', 1],
  ['source=sdk.getAssociatedTokenAddressSync(mint,owner),destination=sdk.getAssociatedTokenAddressSync(mint,treasury);',
   'source=sdk.getAssociatedTokenAddressSync(mint,owner,false,tokenProgram),destination=sdk.getAssociatedTokenAddressSync(mint,treasury,false,tokenProgram);', 1],
];
// Live (Mainnet build) wording, applied by apply-network.cjs after apply-treasury's live text.
// (The fee-free notice and the deposit fee line are part of apply-treasury's live patches, which own those strings.)
const liveClientPatches = [
  // No free practice heroes on live: a new local save starts with an empty roster, and token-less practice heroes are
  // dropped when the player signs in (only the server's heroes remain).
  ['S.h.push(mk(0,true),mk(0,true));newMap()}', '/* live: no free practice heroes */newMap()}', 1],
  ['S.h=S.h.filter(h=>h.tokenOwner!==p.account||ids.has(h.tokenId));', 'S.h=S.h.filter(h=>h.tokenId&&(h.tokenOwner!==p.account||ids.has(h.tokenId)));', 1],
  ["mode==='deposit'?(n-Math.ceil(n/50)).toLocaleString()+' Ryo deposited after the 2% studio fee.'", "mode==='deposit'?n.toLocaleString()+' Ryo deposited (no deposit fee).'", 1],
];

function replaceCount(text, [before, after, count = 1], label) {
  if (text.split(after).length - 1 === count && (!text.includes(before) || after.includes(before))) return text; // already applied
  const n = text.split(before).length - 1;
  if (n !== count) throw Error('Live economy patch mismatch: ' + label + ' "' + before.slice(0, 70) + '" (' + n + ')');
  return text.split(before).join(after);
}
function liveClientText(text) { return liveClientPatches.reduce((t, p, i) => replaceCount(t, p, 'live client ' + i), text); }
const patchFile = (file, hooks, label) => fs.writeFileSync(file, hooks.reduce((t, h, i) => replaceCount(t, h, label + ' ' + i), fs.readFileSync(file, 'utf8')));

function applyLiveEconomy(appDir = path.join(__dirname, 'app')) {
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(__dirname, 'live-economy/server.cjs'), path.join(server, 'live-economy.cjs'));
  patchFile(path.join(server, 'service.cjs'), serviceHooks, 'service');
  patchFile(path.join(server, 'economy.cjs'), economyHooks, 'economy');
  patchFile(path.join(server, 'netlify-handler.cjs'), handlerHooks, 'netlify-handler');
  patchFile(path.join(server, 'render-server.cjs'), renderHooks, 'render-server');
  patchFile(path.join(appDir, 'public/index.html'), clientPatches, 'client');
  console.log('Live economy: fee-free SR deposits, Boss Hunt 10% to the Locked Treasury, studio/revenue wallets optional (live build only).');
}
module.exports = { applyLiveEconomy, economyHooks, serviceHooks, handlerHooks, renderHooks, clientPatches, liveClientPatches, liveClientText };
if (require.main === module) applyLiveEconomy();
