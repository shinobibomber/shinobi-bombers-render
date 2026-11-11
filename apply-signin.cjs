/* Sign-in experience build step (after apply-reward-pool; see unpack.cjs). Owner request 2026-11-12: sign-in that works on
 * every PC and phone browser and never freezes.
 *
 * Client hooks in the wallet / login code (exact strings, each must match exactly once in both the Devnet and the Mainnet build,
 * or the build stops; tests/preservation.cjs reverses them):
 *   walletWait     a time limit for wallet prompts: connect 60 s, sign-in signature 100 s (the server challenge lives 120 s).
 *                  On timeout the action ends with a clear message and the busy flags are released (no reload needed).
 *   loginContext / sameAccount
 *                  the sign-in SIGNATURE no longer waits on two Solana network (genesis) checks: signing a login message sends
 *                  nothing to the chain, and the server verifies the signed message, which names this site, wallet, mint, network
 *                  and a one-time nonce. The account checks before and after signing stay. Every transaction keeps its full
 *                  network checks (context()/assertContext() are unchanged).
 *   beta-config    the startup config fetch is limited to 15 s instead of waiting forever.
 *   LoginScreen    a cancelled or rejected request shows "Sign-in cancelled…" instead of the raw wallet error.
 * Assets: wallet-signin/wallet-signin.js (phone browsers without a wallet open the game in the Phantom / Solflare app; desktop
 * without the extension gets an install link; a short hint for phone players) and wallet-signin.css (landscape phones: 44 px
 * buttons). No reward, payment, Chakra or server code is touched. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const marker = '<!-- wallet-signin -->';
const tags = '<link rel="stylesheet" href="assets/wallet-signin/wallet-signin.css">\n<script defer src="assets/wallet-signin/wallet-signin.js"></script>';
const CANCELLED = "Sign-in cancelled in your wallet. Tap Phantom or Solflare to try again.";
const clientHooks = [
  ['async function connect(kind,options){',
   "function walletWait(promise,ms,text){let t;Promise.resolve(promise).catch(()=>{});return Promise.race([promise,new Promise((_,no)=>{t=setTimeout(()=>no(Object.assign(Error(text),{code:'WALLET_TIMEOUT'})),ms)})]).finally(()=>clearTimeout(t))}\n" +
   " function loginContext(){if(!provider||!state.account)throw Error('Connect your Solana wallet first.');return {provider,account:state.account,tokenAddress:state.tokenAddress}}\n" +
   " function sameAccount(ctx){if(provider!==ctx.provider||state.account!==ctx.account||ctx.provider.publicKey?.toBase58()!==ctx.account)throw Error('Wallet account changed. Reconnect the original account and recover pending transactions.')}\n" +
   ' async function connect(kind,options){'],
  ['await ready;await p.connect(options&&options.onlyIfTrusted===true?{onlyIfTrusted:true}:undefined);',
   "await ready;await (options&&options.onlyIfTrusted===true?p.connect({onlyIfTrusted:true}):walletWait(p.connect(),60000,'Your wallet did not respond. Open or unlock '+(kind==='phantom'?'Phantom':'Solflare')+', then try again.'));"],
  ["const ctx=await context();if(!ctx.provider.signMessage)throw Error('This wallet does not support message signing.');const result=await ctx.provider.signMessage(new TextEncoder().encode(message),'utf8');await assertContext(ctx);const bytes=",
   "const ctx=loginContext();if(!ctx.provider.signMessage)throw Error('This wallet does not support message signing.');const result=await walletWait(ctx.provider.signMessage(new TextEncoder().encode(message),'utf8'),100000,'Your wallet did not answer the sign-in request. Open your wallet, then try again.');sameAccount(ctx);const bytes="],
  ["const response=await fetch(new URL('beta-config.json',location.href),{cache:'no-store'});",
   "const response=await fetch(new URL('beta-config.json',location.href),{cache:'no-store',...(typeof AbortSignal!=='undefined'&&AbortSignal.timeout?{signal:AbortSignal.timeout(15000)}:{})});"],
  ["catch(e){message.textContent=resume?'':e.message}",
   "catch(e){message.textContent=resume?'':(e&&(e.code===4001||/user rejected|rejected the request|request rejected|cancel|declined|closed the (popup|window)/i.test(String(e.message||''))))?'" + CANCELLED + "':(e&&e.message)||'Sign-in failed. Try again.'}"],
];

function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1 && !text.includes(before)) return text;   // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Sign-in patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}

function applySignin(appDir = path.join(__dirname, 'app')) {
  const assets = path.join(appDir, 'public/assets/wallet-signin');
  fs.rmSync(assets, { recursive: true, force: true }); fs.mkdirSync(assets, { recursive: true });
  for (const f of ['wallet-signin.js', 'wallet-signin.css']) fs.copyFileSync(path.join(__dirname, 'wallet-signin', f), path.join(assets, f));
  const index = path.join(appDir, 'public/index.html');
  let html = clientHooks.reduce((t, h, i) => replaceOnce(t, h, 'client ' + i), fs.readFileSync(index, 'utf8'));
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Sign-in: expected one </head>.');
    html = html.replace('</head>', () => marker + '\n' + tags + '\n</head>');
  }
  fs.writeFileSync(index, html);
  console.log('Sign-in applied: wallet time limits, signature without network waits, phone wallet-app links, landscape buttons.');
}
module.exports = { applySignin, clientHooks, marker, tags, CANCELLED };
if (require.main === module) applySignin();
