const fs=require('node:fs'),path=require('node:path');
const marker='<!-- integrated-v3-react-ui -->';
function one(text,before,after,label){if(text.includes(after))return text;const n=text.split(before).length-1;if(n!==1)throw Error('V3 integration mismatch: '+label+' ('+n+')');return text.replace(before,after)}
function applyV3UI(appDir=path.join(__dirname,'app')){
 const file=path.join(appDir,'public/index.html');let html=fs.readFileSync(file,'utf8');
 if(!html.includes(marker)){
  html=one(html,'let chest=null,inFlight=false,chestAccount=null;','let chest=null,inFlight=false,chestAccount=null,v3Message="";','Chest state bridge');
  html=one(html,'function open(){render();dialog.showModal();sync()}','function open(){if(window.V3Chest){window.V3Chest.open();return}render();dialog.showModal();sync()}','single manager');
  html=one(html,'window.AdventureChest={open,refresh:sync,','window.AdventureChest={open,refresh:sync,claim:()=>sync(true),get snapshot(){return {chest:chest?{...chest}:null,owner:chestAccount,busy:inFlight,message:v3Message}},','read-only Chest snapshot');
  html=one(html,'const state={authenticated:false,balance:0,withdrawals:[],','const state={authenticated:false,balance:0,deposits:[],withdrawals:[],','deposit records state');
  html=one(html,'function accept(data){state.balance=data.balance;','function accept(data){state.deposits=data.deposits||[];state.balance=data.balance;','deposit records sync');
  html=one(html,"catch(e){set(2,'Preparing fallback shinobi…')}","catch(e){status.textContent='Essential artwork could not load. Check your connection and retry.';const retry=document.createElement('button');retry.textContent='Retry loading';retry.className='b';retry.onclick=()=>location.reload();status.after(retry);console.error('Essential startup task failed:',e);await new Promise(()=>{});}",'honest loading error');
  html=one(html,'await new Promise(resolve=>setTimeout(resolve,Math.max(0,1100-(performance.now()-started))));','// Startup progresses only after real initialization tasks complete.','remove artificial loading wait');
  html=html.replace('</head>',marker+'\n<link rel="stylesheet" href="assets/v3-ui/v3-ui.css">\n<script defer src="assets/v3-ui/v3-ui.js"></script>\n</head>');
 }
 html=one(html,'state.balance=0;state.withdrawals=[];','state.balance=0;state.deposits=[];state.withdrawals=[];','clear deposit records on disconnect');
 // Guard responses at the shared service boundary, including transactions that
 // finalize after a wallet disconnect. The old account recovers them on sign-in.
 html=one(html,'async function refreshInternal(){return accept(await api(\'state\'))}',"async function refreshInternal(){const owner=current(),data=await api('state');if(current()!==owner)throw Error('Wallet changed. Sign in again to recover the previous request.');return accept(data)}",'wallet-bound refresh');
 html=one(html,"localStorage.removeItem(pendingWithdrawKey);accept(data);","if(current()!==address)throw Error('Wallet changed. Sign in again to recover the withdrawal.');localStorage.removeItem(pendingWithdrawKey);accept(data);",'wallet-bound withdrawal');
 html=one(html,"localStorage.removeItem(storageKey);accept(data);notify(data.purchase.status","if(current()!==address)throw Error('Wallet changed. Sign in again to recover the purchase.');localStorage.removeItem(storageKey);accept(data);notify(data.purchase.status",'wallet-bound purchase');
 html=one(html,"async function adventure(active=false,claim=false){const task=async()=>{const data=await api(claim?'claim-adventure':'adventure',{active});if(claim)accept(data);return data.chest};return claim?run(task):task()}","async function adventure(active=false,claim=false){const task=async()=>{const owner=current(),data=await api(claim?'claim-adventure':'adventure',{active});if(current()!==owner)throw Error('Wallet changed. Sign in again to recover the claim.');if(claim)accept(data);return data.chest};return claim?run(task):task()}",'wallet-bound rewards');
 const start=html.indexOf(' async function sync(claim=false){'),end=html.indexOf('\n function open(){',start);
 if(start<0||end<start)throw Error('V3 Chest synchronization boundary missing.');
 html=html.slice(0,start)+` async function sync(claim=false){
  if(inFlight||!RyoPayments.state.authenticated||RyoPayments.state.busy)return {ok:false,message:'Another wallet request is in progress. Wait and retry.'};
  const owner=RyoPayments.state.account;inFlight=true;dispatchEvent(new Event('shinobi-chest'));if(dialog.open)render();
  let message='',ok=false;
  try{const prior=chestAccount===owner&&chest?Number(chest.pending||0)+Number(chest.claimed||0):null,next=await RyoPayments.adventure(active(),claim);if(!RyoPayments.state.authenticated||RyoPayments.state.account!==owner)throw Error('Wallet changed. Sign in again to recover rewards.');chest=next;chestAccount=owner;SessionRyo.recordChest(chest,owner);const gained=prior===null?0:Math.max(0,Number(chest.pending||0)+Number(chest.claimed||0)-prior);if(tab===0&&gained>=1)fl.push({x:W/2-2,y:H/2,t:1,s:'+'+fmt(gained)+' Ryo → Chest'});document.querySelectorAll('.chest-trigger').forEach(b=>b.textContent='▣ Chest · '+fmt(chest.pending));if(claim)message=fmt(chest.credited)+' Ryo claimed. Your spendable and withdrawable balance is updated.';ok=true}
  catch(error){message=error.message}
  finally{inFlight=false;v3Message=RyoPayments.state.account===owner?message:'';if(dialog.open)render(v3Message);dispatchEvent(new Event('shinobi-chest'))}
  return {ok,chest,message};
 }`+html.slice(end);
 html=html.replace('return {chest:chest?{...chest}:null,busy:inFlight,message:v3Message}','return {chest:chest?{...chest}:null,owner:chestAccount,busy:inFlight,message:v3Message}');
 const destination=path.join(appDir,'public/assets/v3-ui');fs.mkdirSync(destination,{recursive:true});
 for(const name of ['v3-ui.js','v3-ui.css']){const source=path.join(__dirname,'v3-ui/dist',name);if(!fs.existsSync(source))throw Error('Build the V3 React UI first: npm --prefix v3-ui run build');fs.copyFileSync(source,path.join(destination,name))}
 fs.writeFileSync(file,html);console.log('V3 shared React header, Chest and knowledge hub connected to existing game services.');
}
module.exports={applyV3UI};if(require.main===module)applyV3UI();
