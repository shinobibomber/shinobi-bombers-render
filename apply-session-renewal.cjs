/* Stay signed in while playing — build step (after apply-expedition, before the Command Center schema; see unpack.cjs).
 * Owner request 2026-11-11 ("players are getting logged out automatically"; approved: renew while active, keep the
 * sign-in through a page reload, 24-hour maximum).
 *
 * Server (session-renewal/server.cjs -> app/server/session-renewal.cjs; store.cjs and schema.sql are pinned):
 *   login         records when the wallet signed (ryo_sessions.created, additive column);
 *   authenticate  a request with < 30 min left extends the session to 1 hour, never beyond 24 hours after signing.
 * Client (exact-string hooks, each must match exactly once; reversed by tests/preservation.cjs):
 *   RyoPayments   keeps the session token in sessionStorage (this tab only; bound to the wallet account and mint) and,
 *                 before asking for a new signature, tries that saved session; reset() (401 expired, wallet changed or
 *                 disconnected) forgets it, so a sign-out is never undone by a reload.
 *   BetaWallet    connect(kind,{onlyIfTrusted:true}) asks the wallet to reconnect only if it already trusts this site
 *                 (no wallet popup).
 *   LoginScreen   on a reload with a saved Phantom session, reconnects silently and opens the game; otherwise (Solflare,
 *                 untrusted, expired) the login screen stays and the next wallet click resumes without a signature when
 *                 the saved session is still valid. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const KEY = "'shinobi-ryo-session-v1'";
const storeHooks = [
  ["'INSERT INTO ryo_sessions(scope,token_hash,wallet,expires) VALUES($1,$2,$3,$4)',[this.scope,hash(token),wallet,this.now()+3600000]",
   "'INSERT INTO ryo_sessions(scope,token_hash,wallet,expires,created) VALUES($1,$2,$3,$4,$5)',[this.scope,hash(token),wallet,this.now()+3600000,this.now()]"],
  ["async authenticate(token){if(typeof token!=='string'||token.length>100)fail('Sign in with your wallet.',401);const row=(await this.pool.query('SELECT wallet FROM ryo_sessions WHERE scope=$1 AND token_hash=$2 AND expires>$3',[this.scope,hash(token),this.now()])).rows[0];if(!row)fail('Wallet session expired. Sign in again.',401);return row.wallet}",
   "async authenticate(token){return require('./session-renewal.cjs').authenticate(this,token,hash,fail)}"],
];
const clientHooks = [
  // RyoPayments: saved session helpers (function declarations, so reset() can use them however early it runs).
  ['function reset(){sessionVersion++;',
   'function savedSession(){try{const v=JSON.parse(sessionStorage.getItem(' + KEY + ")||'null');return v&&typeof v.token==='string'&&v.token.length>0&&v.token.length<=100&&typeof v.account==='string'&&typeof v.mint==='string'&&Number.isFinite(v.at)?v:null}catch{return null}}" +
   'function forgetSession(){try{sessionStorage.removeItem(' + KEY + ')}catch{}}' +
   'function keepSession(cfg){try{sessionStorage.setItem(' + KEY + ',JSON.stringify({token,account,wallet:wallet.state.wallet||null,mint:cfg.mint,at:Date.now()}))}catch{}}' +
   // Only the same account and mint, and only within 24 hours (the server enforces its own limit regardless).
   'async function resumeSession(address,cfg){const saved=savedSession();if(!saved)return false;if(saved.account!==address||saved.mint!==cfg.mint||!(Date.now()-saved.at<86400000)){forgetSession();return false}' +
   // Only an expired session (401) is forgotten; a network or server error keeps it for the next try (after reset()).
   'sessionVersion++;token=saved.token;account=address;configuration=cfg;state.authenticated=true;try{await refreshInternal();return true}catch(e){const keep=e&&e.status===401?null:savedSession();reset();if(keep)try{sessionStorage.setItem(' + KEY + ',JSON.stringify(keep))}catch{}return false}}' +
   // A reset with no session in memory (e.g. current() before the resume) leaves the saved one alone; signing out of an
   // active session (401, wallet changed or disconnected) forgets it.
   'function reset(){if(token)forgetSession();sessionVersion++;'],
  ['async function login(){return run(async()=>{const address=wallet.state.account;',
   'async function login(options={}){return run(async()=>{const address=wallet.state.account;'],
  // After the server/mint check: a still-valid saved session needs no new signature; resumeOnly never asks for one.
  ["const challenge=await api('challenge',{wallet:address},false),message=challenge.message;",
   "if(await resumeSession(address,cfg)){notify('Signed in. Ryo balance can be withdrawn or used in game.');return {...state}}if(options.resumeOnly)return null;const challenge=await api('challenge',{wallet:address},false),message=challenge.message;"],
  ['sessionVersion++;token=session.token;account=address;configuration=cfg;state.authenticated=true;await refreshInternal();',
   'sessionVersion++;token=session.token;account=address;configuration=cfg;state.authenticated=true;keepSession(cfg);await refreshInternal();'],
  ['adventure,login,refresh,deposit,', 'adventure,login,savedWallet:()=>savedSession()?.wallet||null,refresh,deposit,'],
  // BetaWallet: silent reconnect (the wallet refuses instead of showing a popup when it does not trust the site).
  ['async function connect(kind){', 'async function connect(kind,options){'],
  ['await ready;await p.connect();const account=p.publicKey?.toBase58();',
   'await ready;await p.connect(options&&options.onlyIfTrusted===true?{onlyIfTrusted:true}:undefined);if(options&&Number.isFinite(options.deadline)&&Date.now()>options.deadline)throw Error("Wallet reconnect timed out.");const account=p.publicKey?.toBase58();'],
  // LoginScreen: the resume path never asks for a signature and stays silent when it cannot resume.
  ["async function login(kind){if(busy)return;busy=true;screen.querySelectorAll('button').forEach(b=>b.disabled=true);const message=screen.querySelector('#loginMessage');message.textContent='Connect your wallet, then approve the sign-in signature…';try{await BetaWallet.connect(kind);await RyoPayments.login();enter();",
   "async function login(kind,resume=false){if(busy)return;busy=true;screen.querySelectorAll('button').forEach(b=>b.disabled=true);const message=screen.querySelector('#loginMessage');message.textContent=resume?'Restoring your sign-in…':'Connect your wallet, then approve the sign-in signature…';try{if(resume){let t;try{await Promise.race([BetaWallet.connect(kind,{onlyIfTrusted:true,deadline:Date.now()+8000}),new Promise((_,no)=>{t=setTimeout(()=>no(Error('')),9000)})])}finally{clearTimeout(t)}if(!(await RyoPayments.login({resumeOnly:true})))throw Error('')}else{await BetaWallet.connect(kind);await RyoPayments.login()}enter();"],
  ['catch(e){message.textContent=e.message}finally{busy=false;', "catch(e){message.textContent=resume?'':e.message}finally{busy=false;"],
  ["screen.querySelector('#loginPhantom').focus();",
   "screen.querySelector('#loginPhantom').focus();if(RyoPayments.savedWallet?.()==='phantom')login('phantom',true);"],
];
function replaceOnce(text, [before, after], label) {
  const n = text.split(before).length - 1;
  if (n === 0 && text.split(after).length - 1 === 1) return text; // already applied
  if (n !== 1) throw Error('Session renewal patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}
const patchFile = (file, hooks, label) => fs.writeFileSync(file, hooks.reduce((t, h, i) => replaceOnce(t, h, label + ' ' + i), fs.readFileSync(file, 'utf8')));
function applySessionRenewal(appDir = path.join(__dirname, 'app')) {
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(__dirname, 'session-renewal/server.cjs'), path.join(server, 'session-renewal.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Session renewal v1')) fs.appendFileSync(schema, '\n-- Session renewal v1 (apply-session-renewal.cjs). Additive; existing sessions keep working.\n' + require('./session-renewal/server.cjs').SCHEMA + '\n');
  patchFile(path.join(server, 'store.cjs'), storeHooks, 'store');
  patchFile(path.join(appDir, 'public/index.html'), clientHooks, 'client');
  console.log('Session renewal applied: sessions extend while in use (24-hour maximum) and survive a reload in the same tab.');
}
module.exports = { applySessionRenewal, storeHooks, clientHooks };
if (require.main === module) applySessionRenewal();
