/* Original supplied Dojo scenes; live account data and existing service actions. */
(() => {
 const api=window.DojoDesign={loaded:false,ready:null,refresh:()=>{}};
 const base=new URL('.',document.currentScript.src),assets={};
 const sources={hub:['dojo-menu.png',1778,885],dojo:['dojo-list-upgrades.png',1718,916],sensei:['sensei-tab.png',1740,904]};
 const previousReady=ShinobiSprites.ready;
 api.ready=ShinobiSprites.ready=Promise.all([previousReady,...Object.entries(sources).map(([key,[name,w,h]])=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{if(image.naturalWidth!==w||image.naturalHeight!==h)return reject(Error('Dojo scene dimensions changed: '+name));assets[key]=image;resolve()};image.onerror=()=>reject(Error('Original Dojo scene could not load: '+name));image.src=new URL(name,base).href}))]).then(setup);
 api.ready.catch(error=>console.error('Dojo design could not be applied:',error));
 function setup(){
  const bar=document.querySelector('.menu-topbar'),barHome=document.createComment('Dojo shared toolbar');bar.before(barHome);
  const screen=document.createElement('section');screen.id='exactDojoScreen';screen.hidden=true;screen.setAttribute('aria-label','Dojo services');
  const scene=document.createElement('div');scene.id='exactDojoScene';screen.append(scene);document.body.append(screen);
  const artwork=document.createElement('img');artwork.className='dojo-reference-art';artwork.alt='';artwork.draggable=false;artwork.setAttribute('aria-hidden','true');scene.append(artwork);
  const content=document.createElement('div');content.className='dojo-live-content';scene.append(content);
  const wallet=document.createElement('button');wallet.type='button';wallet.className='dojo-wallet-target';wallet.setAttribute('aria-label','Open Ryo wallet');wallet.onclick=()=>ShinobiBetaUI.open();scene.append(wallet);
  const names=['Training Grounds','Apprentice Dojo','Shinobi Dojo','Veteran Dojo','Master Dojo','Grandmaster Dojo','Legendary Dojo'];
  const roman=['—','I','II','III','IV','V','VI'];
  const description=['Basic ninja training facility.','Begin your ninja training.','Refine your skills.','Train like an elite shinobi.','Perfect your techniques.','Reach the peak of training.','The ultimate training ground.'];
  const tierArt=[0,1,2,3,4,5,6].map(i=>crop(assets.dojo,[748,182+i*94,87,65]));
  let tier=1,lastPane='',lastSignature='';
  const fmt=value=>Number(value||0).toLocaleString();
  function box(type,className,text,x,y,w,h){const e=document.createElement(type);e.className=className;if(text!==undefined)e.textContent=text;Object.assign(e.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});content.append(e);return e;}
  function button(label,x,y,w,h,action,visible=false){const b=box('button','dojo-hotspot'+(visible?' dojo-live-button':''),visible?label:'',x,y,w,h);b.type='button';b.setAttribute('aria-label',label);b.onclick=action;return b;}
  function mask(className,x,y,w,h){return box('div','dojo-data-mask '+className,'',x,y,w,h)}
  function render(){
   const pane=DojoServices.pane;
   const profile=window.RyoPayments?.state.profile||{};
   const permanent=!!profile.sensei,rentalUntil=Number(profile.senseiRentalUntil||0),hired=permanent||rentalUntil>Math.max(Number(RyoPayments.state.serverTime||0),Date.now()),on=S.v2.butlerEnabled!==false;
   const signature=[pane,S.dojo,tier,permanent,rentalUntil,hired,on,RyoPayments.state.balance??S.ryo].join('|');
   if(lastSignature===signature)return;lastSignature=signature;
   content.replaceChildren();scene.dataset.pane=pane;
   artwork.src=assets[pane].src;
   const [name,w,h]=sources[pane];scene.style.width=w+'px';scene.style.height=h+'px';
   const toolbar=pane==='hub'?[1055,20,156,27,1229,1272,23,117,24,1404,1450,1498,1548,20,176,47,50,19,108,49]:pane==='dojo'?[1021,18,152,27,1183,1230,22,116,25,1353,1402,1450,1505,18,173,51,39,18,102,51]:[971,14,155,27,1149,1207,22,124,25,1349,1402,1456,1522,14,184,51,35,17,116,46];
   const keys=['balance-x','balance-y','balance-w','balance-h','sound-x','online-x','online-y','online-w','online-h','discord-x','x-x','pumpfun-x','chest-x','chest-y','chest-w','chest-h','back-x','back-y','back-w','back-h'];
   keys.forEach((key,i)=>scene.style.setProperty('--'+key,toolbar[i]+'px'));
   if(pane==='hub'){
    button('Enter Dojo',348,721,453,61,()=>DojoServices.open('dojo'));
    button('Hire Sensei',980,722,450,60,()=>DojoServices.open('sensei'));
   }else if(pane==='dojo'){
    // Keep the original building illustration and ornamental frame. Live values
    // replace only the printed example selection, metrics, row status and price.
    mask('dojo-selection-background',78,470,535,87);
    box('span','dojo-kicker',tier?'TIER '+roman[tier]:'FOUNDATION',89,480,500,24);
    box('h2','dojo-selected-name',names[tier].toUpperCase(),89,507,510,39);
    mask('dojo-metric-mask',143,586,101,31);box('strong','dojo-metric-value',GameBalance.dojoRecovery[tier]+'/min',147,589,97,29);
    mask('dojo-metric-mask',495,586,77,31);box('strong','dojo-metric-value',tier+'/6',502,589,70,29);
    const owned=tier<=S.dojo,next=tier===S.dojo+1;
    const upgrade=button(owned?(tier===S.dojo?'IN SERVICE':'UNLOCKED'):next?'UPGRADE · '+fmt(GameBalance.dojoPrices[tier])+' Ryo':'PREVIOUS TIER REQUIRED',91,785,507,65,()=>DojoServices.upgrade(),true);
    upgrade.classList.add('dojo-upgrade-action');upgrade.disabled=!next||!GameCurrency.canAfford(GameBalance.dojoPrices[tier]);
    for(let i=0;i<7;i++){
     const y=171+i*94;
     // This row wrapper is transparent at the source selection and replaces the
     // highlight when another tier is selected, using original thumbnail art.
     const row=button(names[i],659,y,991,85,()=>DojoServices.selectTier(i));row.classList.add('dojo-live-row');row.classList.toggle('selected',tier===i);row.setAttribute('aria-pressed',String(tier===i));
     if(i===1&&tier!==1){row.style.background='linear-gradient(105deg,#101624,#0a1020)';row.innerHTML='<span class="dojo-row-roman"></span><span class="dojo-row-thumbnail"></span><b class="dojo-row-name"></b><small class="dojo-row-description"></small><span class="dojo-row-all">All</span><span class="dojo-row-rate"></span>';row.querySelector('.dojo-row-roman').textContent=roman[i];row.querySelector('.dojo-row-thumbnail').style.backgroundImage=tierArt[i];row.querySelector('.dojo-row-name').textContent=names[i];row.querySelector('.dojo-row-description').textContent=description[i];row.querySelector('.dojo-row-rate').textContent=GameBalance.dojoRecovery[i]+'/min';}
     mask('dojo-row-status-mask',1337,y+25,89,34);const state=box('span','dojo-row-status',i===S.dojo?'Active':i<S.dojo?'Unlocked':'—',1343,y+28,77,27);state.classList.toggle('active',i===S.dojo);
     mask('dojo-row-price-mask',1460,y+24,177,37);box('strong','dojo-row-price',i===0?'Free':fmt(GameBalance.dojoPrices[i])+' Ryo',1463,y+27,164,30);
    }
   }else{
    mask('sensei-fact-mask',1361,490,252,36);const dojo=button(names[S.dojo],1371,492,242,35,()=>DojoServices.open('dojo'),true);dojo.classList.add('sensei-dojo-action');
    mask('sensei-fact-mask',1566,558,65,35);box('strong','sensei-fact-value',hired?'1':'0',1569,560,58,31);
    mask('sensei-fact-mask',1531,618,107,43);const toggle=button(hired?(on?'ON':'OFF'):'OFF',1545,622,86,35,()=>{V2.toggleButler();render()},true);toggle.classList.add('sensei-rotation-action');toggle.classList.toggle('on',hired&&on);toggle.disabled=!hired;toggle.setAttribute('aria-pressed',String(hired&&on));
    mask('sensei-purchase-mask',893,704,744,120);
    box('strong','sensei-purchase-title',permanent?'HIRED':hired?'RENTED':fmt(GameBalance.senseiCost)+' Ryo',909,708,470,48);
    box('p','sensei-purchase-copy',permanent?'Permanent automatic rotation and up to 12 hours of offline earnings.':hired?'Rental active until '+new Date(rentalUntil).toLocaleString()+'.':'Hire permanently or rent for 7 days. Up to 12 hours of offline earnings.',900,766,469,52);
    const hire=button(hired?(on?'TURN OFF':'TURN ON'):'HIRE SENSEI',1399,713,233,69,()=>{if(hired)V2.toggleButler();else DojoServices.hire();render()},true);hire.classList.add('sensei-primary-action');hire.disabled=!hired&&!GameCurrency.canAfford(GameBalance.senseiCost);
    if(!permanent){const rental=button((hired?'EXTEND':'RENT')+' 7 DAYS · 250,000 Ryo',1399,787,233,31,()=>TokenCheckout.request('sensei-rental'),true);rental.classList.add('sensei-rental-action');rental.disabled=!GameCurrency.canAfford(250000);rental.title='250,000 Ryo plus 2% studio fee';if(hired){const permanentHire=button('Hire permanently · '+fmt(GameBalance.senseiCost)+' Ryo',902,816,466,20,()=>DojoServices.hire(),true);permanentHire.classList.add('sensei-permanent-action');permanentHire.disabled=!GameCurrency.canAfford(GameBalance.senseiCost);}}
   }
   resize();
  }
  function resize(){const pane=DojoServices.pane,[,w,h]=sources[pane],scale=Math.min(innerWidth/w,innerHeight/h);scene.style.setProperty('--dojo-scale',scale);scene.style.left=Math.round((innerWidth-w*scale)/2)+'px';scene.style.top=Math.round((innerHeight-h*scale)/2)+'px';}
  function sync(){const active=tab===4&&!vm&&!LoginScreen.active&&!GameLoading.active;document.body.classList.toggle('exact-dojo-active',active);screen.hidden=!active;screen.inert=!active;if(active){if(lastPane!==DojoServices.pane){lastPane=DojoServices.pane;lastSignature=''}scene.append(bar);render();resize()}else if(bar.parentNode===scene)barHome.after(bar);}
  for(const name of ['open','selectTier','upgrade','hire']){const old=DojoServices[name];DojoServices[name]=function(...args){if(name==='selectTier')tier=args[0];if(name==='open'&&args[0]==='dojo')tier=Math.min(6,S.dojo+1);const result=old.apply(this,args);lastSignature='';sync();return result;};}
  const oldVil=vil;vil=function(...args){const result=oldVil(...args);lastSignature='';sync();return result;};
  const oldGo=go;go=function(...args){const result=oldGo(...args);sync();return result;};
  const oldBack=MenuLayout.back;MenuLayout.back=function(...args){const result=oldBack.apply(this,args);lastSignature='';sync();return result;};
  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
  addEventListener('resize',resize);addEventListener('shinobi-ryo-ledger',()=>{lastSignature='';sync()});
  GameLoading.ready.then(sync);api.refresh=()=>{lastSignature='';sync()};api.loaded=true;sync();return true;
 }
 function crop(image,[x,y,w,h]){const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(image,x,y,w,h,0,0,w,h);return 'url("'+cv.toDataURL()+'")'}
})();

