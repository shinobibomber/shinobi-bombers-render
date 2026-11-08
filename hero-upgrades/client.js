/* Hero upgrade/salvage chooser. All inventory changes are server-authoritative. */
(()=>{
 'use strict';
 const R=HeroUpgradeRules,originalUp=window.up;let dialog=null,busy=false,selected=null,retry=null;
 const el=(tag,text,parent)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;parent?.append(e);return e;};
 GameBalance.trainingCost=h=>R.trainingPrice(h.r,h.lv);
 const originalPurchase=RyoPayments.purchase;RyoPayments.purchase=function(q){if(q.training)q.params={...q.params,upgradeRulesAccepted:R.VERSION};return originalPurchase.call(this,q);};
 const state=()=>RyoPayments.state,owned=id=>state().profile?.heroes?.find(h=>h.tokenId===id),count=()=>state().profile?.upgradeShards||0;
 function shell(title){if(!dialog){dialog=el('dialog');dialog.className='sbw-dialog hero-upgrade-dialog';document.body.append(dialog);dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault()});}dialog.replaceChildren();dialog.setAttribute('aria-labelledby','heroUpgradeTitle');el('h2',title,dialog).id='heroUpgradeTitle';return dialog;}
 function button(parent,label,fn,disabled=false,cls=''){const b=el('button',label,parent);b.type='button';b.className='sbw-btn '+cls;b.disabled=disabled;b.onclick=fn;return b;}
 function show(){if(!dialog.open)dialog.showModal();}
 function chooser(id){
  if(busy)return;const hero=owned(id);if(!hero)return toast('Choose an owned in-game hero.');selected={id,account:state().account};
  const d=shell(hero.name+' · Hero training'),amount=R.shards(hero.rank),max=hero.level>=5;
  el('p','Upgrade Shards: '+count()+' · '+R.RANKS[hero.rank]+' uses '+amount+' per training level.',d);
  const choices=el('div',null,d);choices.className='hero-upgrade-choices';
  button(choices,max?'Upgrade / Train · Max level':'Upgrade / Train · '+R.trainingPrice(hero.rank,hero.level).toLocaleString()+' Ryo + '+amount+' shard(s)',async()=>{
   if(!owned(id)||state().account!==selected.account)return dialog.close();dialog.close();const i=S.h.findIndex(h=>h.tokenId===id);if(i>=0)await originalUp(i);
  },max||count()<amount);
  if(!max&&count()<amount)el('p','Salvage a spare hero to collect the missing shards.',d).className='hero-upgrade-note';
  button(choices,'Salvage hero · Receive '+amount+' Upgrade Shard(s)',()=>confirm(id),!!(hero.nft||hero.accountBound||hero.legacyPassReward),'sbw-alt');
  if(hero.accountBound||hero.legacyPassReward)el('p','Premium reward hero · Permanently account-bound; cannot be sold or salvaged.',d).className='hero-upgrade-note';
  if(hero.nft)el('p','NFT-bound heroes cannot be salvaged.',d).className='hero-upgrade-note';
  const actions=el('div',null,d);actions.className='sbw-acts';button(actions,'Cancel',()=>dialog.close(),false,'sbw-alt');show();
 }
 function confirm(id){
  const hero=owned(id);if(!hero||state().account!==selected?.account)return dialog?.close();
  const d=shell('Permanently salvage '+hero.name+'?'),amount=R.shards(hero.rank);
  el('p','This permanently removes this hero, its training and its place in your team. This cannot be undone.',d);
  el('p','You receive '+amount+' Upgrade Shard(s). Shards are account-bound game items used with Ryo for training.',d);
  const message=el('p','',d);message.setAttribute('role','alert');const actions=el('div',null,d);actions.className='sbw-acts';
  button(actions,'Back',()=>chooser(id),false,'sbw-alt');
  const yes=button(actions,'Salvage permanently',async()=>{
   if(busy)return;if(state().account!==selected?.account||!state().authenticated)return dialog.close();busy=true;for(const b of d.querySelectorAll('button'))b.disabled=true;message.textContent='Saving salvage…';
   if(!retry||retry.heroId!==id||retry.account!==selected.account)retry={heroId:id,account:selected.account,requestId:crypto.randomUUID()};
   const local=S.h.find(h=>h.tokenId===id);
   try{
    // Stop new attacks, finish already executed shots and sync their defeats before removal.
    if(local){local.on=false;local.p=[];const deadline=performance.now()+2000;while(bombs.some(b=>b.o===local.id)&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));}
    await AdventureChest.refresh();const result=await RyoPayments.salvage({heroId:id,requestId:retry.requestId,salvageRulesVersion:R.VERSION});
    if(local)for(let i=bombs.length-1;i>=0;i--)if(bombs[i].o===local.id)bombs.splice(i,1);
    await TokenCheckout.deliver();retry=null;dialog.close();toast('Hero salvaged · +'+result.salvage.shards+' Upgrade Shard(s)');
   }catch(error){message.textContent=error.message;for(const b of d.querySelectorAll('button'))b.disabled=false;yes.textContent='Retry salvage';}finally{busy=false;}
  },false,'hero-salvage-confirm');yes.dataset.salvageConfirm='1';show();
 }
 window.HeroUpgrades={open:chooser,get busy(){return busy}};
 window.up=function(i){const h=S.h[i];if(h?.tokenId&&h.tokenOwner===state().account)return chooser(h.tokenId);return originalUp(i);};
 addEventListener('shinobi-ryo-ledger',()=>{if(dialog?.open&&selected&&selected.account!==state().account){dialog.close();retry=null;}});
})();
