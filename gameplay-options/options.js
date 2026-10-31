/* Live preferences and explicit fusion outcomes; entitlement changes remain server-owned. */
(() => {
 const api=window.GameplayOptions={presentFusionOutcome,refresh:()=>{}},rates=[90,80,70,60];
 const outcomeDialog=document.createElement('dialog');outcomeDialog.id='fusionOutcomeDialog';outcomeDialog.setAttribute('aria-labelledby','fusionOutcomeTitle');document.body.append(outcomeDialog);
 outcomeDialog.innerHTML='<h2 id="fusionOutcomeTitle">Fusion result</h2><p class="fusion-outcome-copy"></p><button class="b">Continue</button>';
 function finishOutcome(){if(S.v2.fusionOutcome){S.v2.fusionOutcome.seen=true;save()}outcomeDialog.close()}
 outcomeDialog.querySelector('button').onclick=finishOutcome;outcomeDialog.addEventListener('cancel',finishOutcome);
 function summary(result){return result.succeeded+' / '+result.attempts+' successful · '+result.failed+' failed · '+Number(result.totalCharged).toLocaleString()+' Ryo charged. All '+result.attempts*3+' input heroes were consumed.'}
 function presentFusionOutcome(){
  const result=S.v2.fusionOutcome;if(!result||result.seen||result.owner!==RyoPayments.state.account||!RyoPayments.state.authenticated)return;
  if(result.succeeded>0){const reveal=document.getElementById('summonReveal');if(S.v2.revealSource!=='fusion'||!reveal?.open)return;let line=reveal.querySelector('.fusion-outcome-summary');if(!line){line=document.createElement('p');line.className='fusion-outcome-summary';reveal.querySelector('.reveal-header')?.append(line)}line.textContent=summary(result);return;}
  outcomeDialog.querySelector('h2').textContent='Fusion unsuccessful';outcomeDialog.querySelector('p').textContent=summary(result)+' No new hero was created.';
  if(!outcomeDialog.open&&!LoginScreen.active&&!GameLoading.active)outcomeDialog.showModal();
 }
 ShinobiSprites.ready.then(()=>{
  let saving=false;
  const hired=()=>{const p=RyoPayments.state.profile;return !!p&&(p.sensei||Number(p.senseiRentalUntil||0)>Math.max(RyoPayments.state.serverTime||0,Date.now()))};
  async function setSensei(percent,enabled){
   if(saving)return;if(!hired())return toast('Hire or rent Sensei first.');saving=true;refreshSensei();
   try{await RyoPayments.senseiSettings(percent,enabled);await TokenCheckout.deliver();bt=0;toast('Sensei saved · return at '+percent+'% chakra · '+(enabled?'ON':'OFF'))}catch(error){toast(error.message)}finally{saving=false;DojoDesign.refresh();refreshSensei()}
  }
  V2.toggleButler=()=>setSensei(RyoPayments.state.profile?.senseiReturnPercent||90,RyoPayments.state.profile?.senseiEnabled===false);
  function refreshSensei(){
   if(tab!==4||DojoServices.pane!=='sensei')return;
   const root=document.querySelector('#exactDojoScene .dojo-live-content');if(!root)return;
   let controls=root.querySelector('.sensei-return-settings');
   if(!controls){controls=document.createElement('section');controls.className='sensei-return-settings';
    const copy=document.createElement('p');copy.className='sensei-live-description';copy.textContent='Sensei replaces exhausted deployed heroes with the highest-rarity eligible resting heroes. An active Sensei also keeps Adventure earning while closed for up to 12 hours. Your team remains limited to 10 heroes.';
    const row=document.createElement('label');row.className='sensei-return-row';row.textContent='Return to battle at';const select=document.createElement('select');select.id='senseiReturnPercent';select.setAttribute('aria-label','Sensei return chakra percentage');
    for(let value=50;value<=90;value+=10){const option=document.createElement('option');option.value=value;option.textContent=value+'% chakra';select.append(option)}
    select.onchange=()=>setSensei(Number(select.value),RyoPayments.state.profile?.senseiEnabled!==false);row.append(select);
    const note=document.createElement('p');note.className='sensei-return-note';note.textContent='Applies to online rotation and offline Adventure. Minimum 50% · maximum 90%.';controls.append(copy,row,note);root.append(controls);
   }
   const select=controls.querySelector('select');select.value=RyoPayments.state.profile?.senseiReturnPercent||90;select.disabled=saving||!hired()||RyoPayments.state.busy;
  }
  function fusionUI(){
   const root=document.getElementById('p6');if(tab!==6||!root)return;
   const tabs=[...root.querySelectorAll('.fusion-tabs button')],rank=Math.max(0,tabs.findIndex(button=>button.getAttribute('aria-pressed')==='true')),rate=rates[rank];
   const bonus=root.querySelector('.fusion-bonus');if(bonus){bonus.classList.add('fusion-chance-panel');bonus.textContent=rate+'% success per attempt'+(rank===3?' · Level 10 Elites required':'');}
   const copy=root.querySelector('.batch-fusion p');if(copy)copy.textContent='Reserve heroes · 3 consumed per attempt · '+rate+'% success'+(rank===3?' · Level 10 Elites only':'');
   const note=root.querySelector('.batch-fusion>small');if(note)note.textContent='Up to 25 attempts · failed attempts consume heroes and charge the fee';
   const warning=root.querySelector('.fusion-warning');if(warning)warning.textContent='Each attempt: 3 heroes consumed + 25,000 Ryo + 2% fee, including failures.';
   const btn=root.querySelector('#fuseButton');if(btn)btn.textContent='FUSE · '+rate+'%';
   const empty=root.querySelector('.fusion-empty');if(empty&&rank===3)empty.textContent='Move three level 10 Elite heroes to Reserve to attempt Legend fusion.';
  }
  const oldFusion=FusionUI.render;FusionUI.render=function(...args){const result=oldFusion(...args);fusionUI();return result};
  for(const [object,key]of [[DojoDesign,'refresh'],[DojoServices,'open']]){const old=object[key];object[key]=function(...args){const result=old.apply(this,args);refreshSensei();return result};}
  const oldVil=vil;vil=function(...args){const result=oldVil(...args);refreshSensei();return result};
  const oldGo=go;go=function(...args){const result=oldGo(...args);refreshSensei();fusionUI();presentFusionOutcome();return result};
  const oldReveal=Experience.refreshReveal;Experience.refreshReveal=function(...args){const result=oldReveal.apply(this,args);presentFusionOutcome();return result};
  const oldFinish=Experience.finishReveal;Experience.finishReveal=function(...args){const result=oldFinish.apply(this,args);if(!S.v2.revealBatch?.length&&S.v2.fusionOutcome?.succeeded){S.v2.fusionOutcome.seen=true;save()}return result};
  addEventListener('shinobi-ryo-ledger',()=>setTimeout(()=>{refreshSensei();fusionUI();presentFusionOutcome()},0));api.refresh=()=>{refreshSensei();fusionUI();presentFusionOutcome()};api.refresh();
 }).catch(error=>console.error('Gameplay options failed:',error));
})();
