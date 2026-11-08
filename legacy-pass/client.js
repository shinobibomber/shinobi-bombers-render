/* Shinobi Legacy Pass: authenticated game-item operations; never requests a wallet transaction. */
(()=>{
 'use strict';
 let dialog=null,content=null,message=null,data=null,busy=false,owner=null,retry=null,clockOffset=0;
 const el=(tag,text,parent,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;parent?.append(n);return n;};
 const btn=(parent,text,fn,disabled=false)=>{const b=el('button',text,parent,'sbw-btn');b.type='button';b.disabled=disabled||busy;b.onclick=fn;return b;};
 const state=()=>window.RyoPayments?.state;
 function storageKey(){const p=state();return 'shinobi-legacy-request:'+p.configuration.network+':'+p.configuration.mint+':'+p.account;}
 function requestId(){if(retry)return retry;try{retry=localStorage.getItem(storageKey());}catch{}if(!retry){retry=crypto.randomUUID();try{localStorage.setItem(storageKey(),retry);}catch{}}return retry;}
 function clearRequest(){retry=null;try{localStorage.removeItem(storageKey());}catch{}}
 function shell(){if(dialog)return;dialog=el('dialog',null,document.body,'sbw-dialog legacy-dialog');dialog.id='legacyPassDialog';dialog.setAttribute('aria-labelledby','legacyPassTitle');el('h2',"Shinobi Legacy Pass",dialog).id='legacyPassTitle';el('p',"Founder's Weekly Mission Pass · Free holder rewards",dialog,'legacy-subtitle');message=el('p','',dialog,'legacy-message');message.setAttribute('role','status');content=el('div',null,dialog);const actions=el('div',null,dialog,'legacy-actions');btn(actions,'Refresh',()=>act('legacy-status'));btn(actions,'Close',()=>dialog.close());dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});}
 async function act(action,body={}){
  if(busy)return;busy=true;message.textContent='Verifying and saving…';dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{if(state()?.account!==owner||!state()?.authenticated)throw Error('Reconnect the wallet that opened this pass.');const response=await RyoPayments.legacy(action,body);if(state().account!==owner)return;data=response.legacy;clockOffset=data.serverTime-Date.now();message.textContent='';
   const result=response.legacyResult;
   if(action==='legacy-redeem'||action==='legacy-deliver'){
    if(action==='legacy-redeem')clearRequest();
    if(result?.status==='delivered'){const shown=window.TokenCheckout?.revealReward(result.hero.tokenId);message.textContent='Premium hero delivered · Permanently account-bound.';if(shown)dialog.close();}
    else message.textContent='Your summon result is saved. Free collection space and finish any pending purchase, then collect the queued hero.';
   }
   if(action==='legacy-ticket')message.textContent='Restored '+Number(result.restored.toFixed(2))+' chakra.';
  }catch(e){message.textContent=e.message;}finally{busy=false;if(data)render();else content.replaceChildren();dialog.querySelectorAll('.legacy-actions button').forEach(b=>b.disabled=false);}
 }
 function section(title){const s=el('section',null,content,'legacy-section');el('h3',title,s);return s;}
 function render(){
  content.replaceChildren();const p=state();if(!data||p.account!==owner)return;
  const entitlement=section('Weekly missions');el('p','Wallet: '+owner,entitlement,'legacy-wallet');el('p','Week of '+data.week.id+' · Monday 00:00 UTC reset',entitlement);el('p','',entitlement,'legacy-countdown');countdown();
  if(!data.nfts.length)el('p',"Hold a registered Founder's Mythic NFT Box to activate a weekly pass. Ownership is checked at finalized commitment.",entitlement);
  else{const label=el('label','Active NFT serial ',entitlement),select=el('select',null,label);select.setAttribute('aria-label','Founder NFT serial');for(const n of data.nfts){const o=el('option','Founder #'+n.serial,select);o.value=n.serial;if(n.serial===data.serial)o.selected=true;}btn(entitlement,data.serial?'Activate selected pass':'Activate this week’s pass',()=>act('legacy-select',{serial:Number(select.value)}));el('p',data.serial?'Verified entitlement · Founder #'+data.serial:'Choose one pass to receive your next verified gameplay events.',entitlement);}
  el('p',data.xp+' / 100 Mission XP · Complete any five missions',entitlement,'legacy-xp');const xp=el('progress',null,entitlement);xp.max=100;xp.value=data.xp;xp.setAttribute('aria-label','Weekly Mission XP');
  const grid=el('div',null,entitlement,'legacy-grid');for(const m of data.missions){const card=el('article',null,grid,'legacy-mission'+(m.done?' is-complete':''));el('h4',m.name+(m.done?' ✓':''),card);el('p',m.detail,card);const meter=el('progress',null,card);meter.max=m.target;meter.value=m.value;meter.setAttribute('aria-label',m.name+' progress');el('small',Number(m.value.toFixed(2))+' / '+m.target+' · 20 XP',card);}
  el('p',data.stageVerification+' Each event advances only the selected NFT pass; activating another pass does not copy progress.',entitlement,'legacy-note');
  const milestones=section('Milestone rewards'),rewards=el('div',null,milestones,'legacy-rewards');
  for(const r of data.milestones){const card=el('article',null,rewards,'legacy-milestone');el('strong',r.xp+' XP',card);el('span',r.quantity+' '+({shards:'Upgrade Shard',ticket:'Chakra Recovery Ticket',voucher:'Training Discount Voucher',fragment:'Premium Hero Summon Fragment'}[r.kind])+(r.quantity>1?'s':''),card);btn(card,r.claimed?'Claimed':'Claim',()=>act('legacy-claim',{serial:data.serial,milestone:r.xp}),r.claimed||!data.serial||data.xp<r.xp);}
  const premium=section('Premium Hero Summon');el('p','Premium Fragments: '+data.fragments+' / 2',premium,'legacy-fragments');el('p','Elite: 70% · Legend: 30% · All other ranks: 0%',premium);el('p','2 fragments = 1 premium summon. Each result rolls independently and is saved permanently. No Ryo or SOL payment.',premium);el('p','Premium heroes are permanently account-bound: no Market, salvage or paid-referral qualification. Fusion keeps this restriction.',premium,'legacy-note');btn(premium,'Redeem Premium Summon',()=>act('legacy-redeem',{requestId:requestId()}),data.fragments<2&&!retry);
  for(const row of data.deliveries.filter(r=>r.status==='queued')){const card=el('div',null,premium,'legacy-queued');el('p',row.hero.name+' · '+(row.hero.rank===3?'Elite':'Legend')+' · Saved delivery',card);btn(card,'Collect queued hero',()=>act('legacy-deliver',{requestId:row.request_id}));}
  const items=section('Holder items');el('p','Tickets and vouchers expire 14 days after claiming. Maximum four of each per wallet. Shards and fragments never expire.',items,'legacy-note');
  if(data.selectedVoucher)btn(items,'Clear selected training voucher',()=>act('legacy-voucher',{itemId:null}));
  const resting=(p.profile?.heroes||[]).filter(h=>h.chakra?.resting&&!(h.chakra.lockUntil>data.serverTime));
  for(const item of data.items){const card=el('article',null,items,'legacy-item');el('h4',item.kind==='ticket'?'Chakra Recovery Ticket':'Training Discount Voucher',card);el('p','Expires '+new Date(Number(item.expires)).toLocaleString()+(item.status==='reserved'?' · Reserved for pending settlement':''),card);
   if(item.kind==='ticket'){el('p','Restores 25% maximum chakra, capped at 20. Resting heroes only; unavailable during Boss Hunt.',card);const label=el('label','Resting hero ',card),select=el('select',null,label);select.setAttribute('aria-label','Recovery target');for(const h of resting){const o=el('option',h.name,select);o.value=h.tokenId;}btn(card,'Use Recovery Ticket',()=>act('legacy-ticket',{itemId:item.id,heroId:select.value}),!resting.length||item.status!=='available');}
   else{el('p','One eligible training purchase: 15% holder discount instead of 10%, with additional savings capped at 10,000 Ryo. Shards unchanged. Consumed only after successful settlement.',card);const selected=data.selectedVoucher===item.id;btn(card,selected?'Remove selected voucher':'Use on next training',()=>act('legacy-voucher',{itemId:selected?null:item.id}),item.status!=='available');}
  }
  if(!data.items.length)el('p','No unexpired holder items yet.',items);
 }
 function countdown(){const n=dialog?.querySelector('.legacy-countdown');if(n&&data){const s=Math.max(0,Math.ceil((data.week.reset-Date.now()-clockOffset)/1000));n.textContent='Resets in '+Math.floor(s/86400)+'d '+Math.floor(s%86400/3600)+'h '+Math.floor(s%3600/60)+'m '+s%60+'s';}}
 async function open(){if(!state()?.authenticated)return window.ShinobiBetaUI?.open();if(busy)return;shell();owner=state().account;data=null;retry=null;try{retry=localStorage.getItem(storageKey());}catch{}dialog.showModal();await act('legacy-status');}
 function entry(){const p=state();if(dialog?.open&&owner!==p?.account){dialog.close();data=null;retry=null;}}
 addEventListener('shinobi-ryo-ledger',entry);setInterval(countdown,1000);window.ShinobiLegacyPass={open};entry();
})();
