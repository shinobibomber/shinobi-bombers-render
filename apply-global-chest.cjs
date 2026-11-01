const fs=require('node:fs'),path=require('node:path');
const marker='<!-- global-chest-design14 -->';
function once(text,before,after,label){if(text.includes(after))return text;const count=text.split(before).length-1;if(count!==1)throw Error('Global Chest compatibility mismatch: '+label+' ('+count+')');return text.replace(before,after)}
function applyGlobalChest(appDir=path.join(__dirname,'app')){
 const file=path.join(appDir,'public/index.html');let html=fs.readFileSync(file,'utf8');
 if(!html.includes(marker)){
  html=once(html,'pollTimer=null,pollStartedAt=0;','pollTimer=null,pollStartedAt=0,sessionVersion=0;','session marker');
  html=once(html,'function reset(){if(pollTimer)','function reset(){sessionVersion++;if(pollTimer)','invalidate old session');
  html=once(html,'const expected=authenticated?current():wallet.state.account,controller=', 'const expected=authenticated?current():wallet.state.account,sessionAtRequest=sessionVersion,controller=','capture session');
  html=once(html,'if(wallet.state.account!==expected)throw Error(', 'if(wallet.state.account!==expected||(authenticated&&sessionVersion!==sessionAtRequest))throw Error(','reject stale response');
  html=once(html,'token=session.token;account=address;configuration=cfg;','sessionVersion++;token=session.token;account=address;configuration=cfg;','new authenticated generation');
  html=once(html,'const state={authenticated:false,balance:0,withdrawals:[],','const state={authenticated:false,balance:0,deposits:[],withdrawals:[],','deposit history state');
  html=once(html,'state.balance=0;state.withdrawals=[];','state.balance=0;state.deposits=[];state.withdrawals=[];','clear prior deposit history');
  html=once(html,'function accept(data){state.balance=data.balance;','function accept(data){state.deposits=data.deposits||[];state.balance=data.balance;','expose actual deposit history');
  html=once(html,'window.BetaWallet={ready,connect,',"window.BetaWallet={get pendingDeposits(){return readPending().filter(record=>record&&record.kind==='deposit'&&record.network===NETWORK&&record.account===state.account&&record.tokenAddress===state.tokenAddress).length},ready,connect,",'read-only scoped pending deposits');
  html=once(html,'let chest=null,inFlight=false,chestAccount=null;','let chest=null,inFlight=false,chestAccount=null,sharedMessage="",sharedTask=null;','Chest message state');
  html=once(html,'function open(){render();dialog.showModal();sync()}', 'function open(){if(window.GlobalChestUI?.ready){window.GlobalChestUI.open();return}render();dialog.showModal();sync()}','shared manager entry');
  html=once(html,'window.AdventureChest={open,refresh:sync,','window.AdventureChest={open,refresh:sync,claim:()=>sync(true),get snapshot(){return {chest:chest?{...chest}:null,owner:chestAccount,busy:inFlight,message:sharedMessage}},','read-only Chest bridge');
  const start=html.indexOf(' async function sync(claim=false){'),end=html.indexOf('\n function open(){',start);if(start<0||end<start)throw Error('Native Chest synchronization boundary missing.');
  html=html.slice(0,start)+` async function sync(claim=false){
  if(inFlight)return !claim&&sharedTask?sharedTask:{ok:false,message:'Another wallet request is in progress. Wait and retry.'};
  if(!RyoPayments.state.authenticated||RyoPayments.state.busy)return {ok:false,message:'Another wallet request is in progress. Wait and retry.'};
  const owner=RyoPayments.state.account;inFlight=true;dispatchEvent(new Event('shinobi-chest'));if(dialog.open)render();
  sharedTask=(async()=>{let message='',ok=false;
  try{const prior=chestAccount===owner&&chest?Number(chest.pending||0)+Number(chest.claimed||0):null,next=await RyoPayments.adventure(active(),claim);if(!RyoPayments.state.authenticated||RyoPayments.state.account!==owner)throw Error('Wallet changed. Sign in again to recover rewards.');chest=next;chestAccount=owner;SessionRyo.recordChest(chest,owner);const gained=prior===null?0:Math.max(0,Number(chest.pending||0)+Number(chest.claimed||0)-prior);if(tab===0&&gained>=1)fl.push({x:W/2-2,y:H/2,t:1,s:'+'+fmt(gained)+' Ryo → Chest'});document.querySelectorAll('.chest-trigger').forEach(b=>b.textContent='▣ Chest · '+fmt(chest.pending));if(claim)message=fmt(chest.credited)+' Ryo claimed into your game balance. No on-chain withdrawal was sent.';ok=true}
  catch(error){message=error.message}finally{inFlight=false;sharedMessage=RyoPayments.state.account===owner?message:'';if(dialog.open)render(sharedMessage);dispatchEvent(new Event('shinobi-chest'))}
  return {ok,chest,message};
  })();return sharedTask;
 }`+html.slice(end);
  html=html.replace('</head>',marker+'\n<link rel="stylesheet" href="assets/chest-ui/global-chest.css">\n<script defer src="assets/chest-ui/global-chest.js"></script>\n</head>');
 }
 const destination=path.join(appDir,'public/assets/chest-ui');fs.mkdirSync(destination,{recursive:true});
 for(const name of ['global-chest.js','global-chest.css']){const source=path.join(__dirname,'chest-ui/dist',name);if(!fs.existsSync(source))throw Error('Build chest-ui first.');fs.copyFileSync(source,path.join(destination,name))}
 fs.copyFileSync(path.join(__dirname,'chest-ui/art/reference.png'),path.join(destination,'reference.png'));fs.writeFileSync(file,html);console.log('Design14 shared header and Chest connected; existing game systems preserved.');
}
module.exports={applyGlobalChest};if(require.main===module)applyGlobalChest();
