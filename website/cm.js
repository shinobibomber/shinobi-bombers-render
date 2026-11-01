(()=>{
const $=s=>document.querySelector(s),fmt=n=>Math.round(n).toLocaleString('en-US'),lat=ms=>new Promise(r=>setTimeout(r,ms));
/* STUB DATA LAYER: config + balances below are placeholders. Replace store seed and API.* with the authenticated backend. */
const C={wMin:100000,wMax:1000000,dMin:1000,dMax:1000000,fee:2,cdH:24,wallet:'7Hd7...nEWm'};
const store={s:{spendable:884250,adventure:379840,pool:8529965,rate:100,tokens:940000,lastWd:0,history:[]},f:[],set(p){Object.assign(this.s,p);this.f.forEach(x=>{try{x(this.s)}catch(e){console.error(e)}})},sub(x){this.f.push(x);x(this.s)}};
const seen=new Map(),key=t=>t+'-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const API={
async claim(k){if(seen.has(k))return seen.get(k);await lat(800);const a=store.s.adventure;if(a<=0)throw new Error('No verified rewards to claim.');const r={amount:a};seen.set(k,r);return r},
async withdraw(k,g){if(seen.has(k))return seen.get(k);await lat(900);const s=store.s;if(Date.now()-s.lastWd<C.cdH*36e5)throw new Error('Withdrawal cooldown is active.');if(g>s.spendable)throw new Error('Insufficient Ryo balance.');const fee=Math.floor(g*C.fee/100),r={gross:g,fee,net:g-fee,ts:Date.now()};seen.set(k,r);return r},
async deposit(k,g,pend){if(seen.has(k))return seen.get(k);pend();await lat(2600);if(g>store.s.tokens)throw new Error('Insufficient wallet tokens.');const fee=Math.floor(g*C.fee/100),r={gross:g,fee,net:g-fee};seen.set(k,r);return r}};
const cm=$('#cm'),dlg=$('#cmd'),WR=$('#app');let busyClaim=false,cur=null,ret=null,opener=null,H={tab:'deposit',pg:0};
const setMsg=(t,c)=>{const m=$('#cmmsg');m.textContent=t||'';m.className='msg '+(c||'')};
function drawHist(){const l=store.s.history.filter(h=>h.type===H.tab),n=Math.max(1,Math.ceil(l.length/5));H.pg=Math.min(H.pg,n-1);const N={deposit:'Deposit',withdraw:'Withdraw',claim:'Claim'};
$('#hl').innerHTML=l.slice(H.pg*5,H.pg*5+5).map(h=>`<div class="hr"><span><b>${N[h.type]} ${fmt(h.gross)} Ryo</b><br><small>Fee ${fmt(h.fee)} · Net ${fmt(h.net)} · ${new Date(h.ts).toLocaleString()}</small></span><span class="pill ${h.status}">${h.status}</span></div>`).join('')||'<p>No transactions yet.</p>';
$('#hpg').textContent=(H.pg+1)+' / '+n;$('#hpv').disabled=H.pg<=0;$('#hnx').disabled=H.pg>=n-1;document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===H.tab))}
const bump=(el,t)=>{if(el.textContent!==t){const had=el.textContent;el.textContent=t;if(had){el.classList.remove('flip');void el.offsetWidth;el.classList.add('flip')}}};
store.sub(s=>{/* game-link hook: live game connected → no demo values in the header */ if(window.SBGame&&SBGame.live){SBGame.paintHeader();return}document.querySelectorAll('.lv-chest').forEach(e=>bump(e,'Chest : '+fmt(s.adventure)));document.querySelectorAll('.lv-ryo').forEach(e=>bump(e,fmt(s.spendable)+' Ryo'));document.querySelectorAll('.cdot').forEach(e=>e.hidden=s.adventure<=0);
$('#cmadv').textContent=fmt(s.adventure);$('#cmpool').textContent=fmt(s.pool)+' Ryo';$('#cmrate').textContent=s.rate+'%';
const cs=$('#cmcs');cs.textContent=s.adventure<=0?'Nothing to claim':s.rate>=100?'Maximum loot rate reached':'Claim available';cs.className=s.adventure>0&&s.rate>=100?'ok':'';
$('#cmclaim').disabled=s.adventure<=0||busyClaim;$('#cmd2').hidden=s.adventure<=0;$('#wdav').textContent=fmt(s.spendable)+' Ryo';$('#dpav').textContent=fmt(s.tokens)+' tokens';drawHist()});
$('#cma').textContent='Ryo · '+C.wallet;
$('#cmov').innerHTML=`<div><b>Claimable Rewards</b>Spendable &amp; withdrawable</div><div><b>Withdrawal Cycle</b>Every ${C.cdH} hours</div><div><b>Minimum Withdrawal</b>${fmt(C.wMin)} Ryo</div>`;
$('#cmnt').innerHTML=`<li>Claimed rewards are spendable and withdrawable.</li><li>Withdrawals: minimum ${fmt(C.wMin)} Ryo, once every ${C.cdH} hours, with a ${C.fee}% studio fee.</li><li>Claiming moves Ryo into your game balance; it does not send an on-chain withdrawal.</li><li>Solana network fees are separate and paid from your wallet.</li>`;
$('#wdfl').textContent=$('#dpfl').textContent=`Studio Fee (${C.fee}%)`;$('#wdrng').textContent=`Gross withdraw amount · ${fmt(C.wMin)} – ${fmt(C.wMax)} Ryo`;$('#dprng').textContent=`Gross deposit amount · ${fmt(C.dMin)} – ${fmt(C.dMax)} tokens`;
$('#cmclaim').onclick=async()=>{if(busyClaim||store.s.adventure<=0)return;busyClaim=true;store.set({});setMsg('Claiming verified rewards…');
try{const r=await API.claim(key('claim')),s=store.s;busyClaim=false;store.set({spendable:s.spendable+r.amount,adventure:0,history:[{id:key('h'),type:'claim',gross:r.amount,fee:0,net:r.amount,status:'confirmed',ts:Date.now()},...s.history]});setMsg('Claimed '+fmt(r.amount)+' Ryo to your spendable balance.','ok');if(!dlg.contains(document.activeElement)||document.activeElement.disabled)dlg.focus()}catch(e){busyClaim=false;store.set({});setMsg(e.message,'err')}};
function flow(p,o){const a=$('#'+p+'a'),go=$('#'+p+'go'),box=$('#'+p+'box'),msg=$('#'+p+'msg');let busy=false;
const calc=()=>{const g=Math.floor(+a.value||0),fee=Math.floor(g*C.fee/100);return{g,fee,net:g-fee}};
const say=(t,c)=>{msg.textContent=t||'';msg.className='msg '+(c||'')};
const step=h=>{box.innerHTML=h;go.hidden=!!h;a.disabled=!!h};
const upd=()=>{const c=calc(),e=o.check(c.g);$('#'+p+'fee').textContent=fmt(c.fee)+' Ryo';$('#'+p+'net').textContent=fmt(c.net)+o.unit;go.disabled=busy||!!e;if(a.value)say(e,'err')};
go.onclick=()=>{const c=calc(),e=o.check(c.g);if(e){say(e,'err');return}step(`<p>Confirm: ${o.sum(c)}</p><button class="gb" data-s="auth">Confirm</button> <button class="gb" data-s="x">Cancel</button>`);box.querySelector('button').focus()};
box.onclick=async e=>{const s=e.target.dataset.s;if(!s)return;
if(s==='x'){step('');upd();return}
if(s==='auth'){step('<p>Waiting for wallet authorization…</p><button class="gb" data-s="ok">Approve in wallet</button> <button class="gb" data-s="no">Reject</button>');box.querySelector('button').focus();return}
if(s==='no'){step('');say('Wallet authorization rejected. Nothing was changed.','err');o.fail(calc());upd();return}
if(s==='ok'){const c=calc();busy=true;step('<p>Processing…</p>');try{await o.run(c,key(p),say);a.value='';say(o.done(c),'ok')}catch(x){say(x.message,'err')}busy=false;step('');upd()}};
a.oninput=()=>{say('');upd()};return{reset(){busy=false;step('');a.value='';say('');upd()}}}
const rec=(t,c,st,id)=>({id:id||key('h'),type:t,gross:c.g,fee:c.fee,net:c.net,status:st,ts:Date.now()});
const WD=flow('wd',{label:'WITHDRAW RYO',unit:' tokens',
check:g=>{if(g<C.wMin||g>C.wMax)return`Enter ${fmt(C.wMin)} – ${fmt(C.wMax)} Ryo.`;if(g>store.s.spendable)return'Amount exceeds your available balance.';const l=C.cdH*36e5-(Date.now()-store.s.lastWd);return l>0?`Next withdrawal available in ${Math.ceil(l/36e5)}h.`:''},
sum:c=>`withdraw ${fmt(c.g)} Ryo (fee ${fmt(c.fee)}) → ${fmt(c.net)} tokens`,
run:async(c,k)=>{const r=await API.withdraw(k,c.g),s=store.s;store.set({spendable:s.spendable-r.gross,lastWd:r.ts,history:[{id:k,type:'withdraw',...r,status:'confirmed'},...s.history]})},
done:c=>`Withdrawal settled: ${fmt(c.net)} tokens.`,fail:c=>store.set({history:[rec('withdraw',c,'failed'),...store.s.history]})});
const DP=flow('dp',{label:'DEPOSIT RYO',unit:' Ryo',
check:g=>g<C.dMin||g>C.dMax?`Enter ${fmt(C.dMin)} – ${fmt(C.dMax)} tokens.`:g>store.s.tokens?'Amount exceeds your wallet tokens.':'',
sum:c=>`deposit ${fmt(c.g)} tokens (fee ${fmt(c.fee)}) → ${fmt(c.net)} Ryo`,
run:async(c,k,say)=>{const r0=rec('deposit',c,'pending',k);try{await API.deposit(k,c.g,()=>{store.set({history:[r0,...store.s.history]});say('Pending: waiting for on-chain confirmation…')})}catch(e){store.set({history:store.s.history.map(h=>h.id===k?{...h,status:'failed'}:h)});throw e}
const s=store.s;store.set({tokens:s.tokens-c.g,spendable:s.spendable+c.net,history:s.history.map(h=>h.id===k?{...h,status:'confirmed'}:h)})},
done:c=>`Deposit confirmed: ${fmt(c.net)} Ryo credited.`,fail:c=>store.set({history:[rec('deposit',c,'failed'),...store.s.history]})});
const foc=()=>[...dlg.querySelectorAll('button,input')].filter(e=>!e.disabled&&e.offsetParent!==null);
function showP(n,b){ret=b;cur=n;document.querySelectorAll('.pn').forEach(p=>p.hidden=p.dataset.pn!==n);dlg.classList.add('w','hp');
if(n==='withdraw'){const l=C.cdH*36e5-(Date.now()-store.s.lastWd);$('#wdcd').textContent=l>0?`Next withdrawal available in ${Math.ceil(l/36e5)}h.`:`One successful withdrawal every ${C.cdH} hours.`;WD.reset()}
if(n==='deposit')DP.reset();if(n==='history')drawHist();(document.querySelector(`.pn[data-pn=${n}]`).querySelector('input,.x')).focus()}
function hideP(){if(!cur)return;document.querySelectorAll('.pn').forEach(p=>p.hidden=true);dlg.classList.remove('w','hp');const r=ret;cur=null;r&&r.focus()}
function open(){opener=document.activeElement;setMsg('');cm.hidden=false;WR.inert=true;document.body.style.overflow='hidden';dlg.scrollTop=0;(foc()[0]||dlg).focus()}
function close(){if(cm.hidden)return;hideP();cm.hidden=true;WR.inert=false;document.body.style.overflow='';opener&&opener.focus&&opener.focus()}
document.addEventListener('keydown',e=>{if(cm.hidden||document.querySelector('.md'))return;if(e.key==='Escape'){e.stopPropagation();cur?hideP():close()}
if(e.key==='Tab'){const f=foc(),i=f.indexOf(document.activeElement);if(i<0){e.preventDefault();(f[0]||dlg).focus();return}if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus()}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus()}}});
cm.addEventListener('click',e=>{const t=e.target.closest('[data-x],[data-p],[data-cp],[data-tab]');if(!t)return;if('x'in t.dataset)close();else if(t.dataset.p)showP(t.dataset.p,t);else if('cp'in t.dataset)hideP();else{H.tab=t.dataset.tab;H.pg=0;drawHist()}});
$('#hpv').onclick=()=>{H.pg--;drawHist()};$('#hnx').onclick=()=>{H.pg++;drawHist()};
$('#cmw').onclick=async()=>{try{await navigator.clipboard.writeText(C.wallet);setMsg('Wallet address copied.','ok')}catch(e){setMsg('Copy is not available here.','err')}};
window.SB={store,fmt,key,C,openChest:open,closeChest:close,isOpen:()=>!cm.hidden,refresh:()=>store.set({})};
})();
