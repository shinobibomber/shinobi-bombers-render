/* Unchanged supplied scenes, with actual account values and existing game actions. */
(() => {
 const root=new URL('.',document.currentScript.src),previousReady=ShinobiSprites.ready;
 const images={},api=window.ShrineFusionDesign={loaded:false,ready:null};
 const artReady=Promise.all(['summoning-shrine','fusion-menu'].map(name=>new Promise((resolve,reject)=>{const im=images[name]=new Image();im.onload=()=>{if(im.naturalWidth!==1536||im.naturalHeight!==1024)reject(Error('Unexpected '+name+' dimensions.'));else resolve()};im.onerror=()=>reject(Error('Original '+name+' scene is unavailable.'));im.src=new URL(name+'.png',root).href})));
 api.ready=ShinobiSprites.ready=Promise.all([previousReady,artReady]).then(setup);
 api.ready.catch(error=>console.error('Shrine/Fusion design could not be applied:',error));
 function setup(){
  const bar=document.querySelector('.menu-topbar'),barHome=document.createComment('Shrine/Fusion shared toolbar');bar.before(barHome);
  const fusionIcons=[[937,648,34,34],[1103,648,34,34],[1267,648,34,34],[937,707,34,34],[1103,707,34,34],[1267,707,34,34]].map(([x,y,w,h])=>{const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(images['fusion-menu'],x,y,w,h,0,0,w,h);return 'url("'+cv.toDataURL()+'")'});
  const scenes=new Map();
  for(const [page,key,name]of [[2,'summoning-shrine','Shrine'],[6,'fusion-menu','Fusion']]){
   const section=document.getElementById('p'+page),home=document.createComment(name+' page');section.before(home);
   const screen=document.createElement('section');screen.id='exact'+name+'Screen';screen.className='exact-crafting-screen';screen.hidden=true;screen.setAttribute('aria-label',name==='Shrine'?'Summoning Shrine':'Fusion');
   const scene=document.createElement('div');scene.id='exact'+name+'Scene';scene.className='exact-crafting-scene';screen.append(scene);
   const art=images[key];art.className='crafting-reference-art';art.alt='';art.setAttribute('aria-hidden','true');art.draggable=false;scene.append(art);document.body.append(screen);
   const wallet=document.createElement('button');wallet.type='button';wallet.className='crafting-wallet-target';wallet.setAttribute('aria-label','Open Ryo wallet');wallet.onclick=()=>ShinobiBetaUI.open();scene.append(wallet);
   scenes.set(page,{screen,scene,section,home});
  }
  function resize(){const scale=Math.min(innerWidth/1536,innerHeight/1024);for(const [page,{scene}]of scenes){const mobile=page===2&&innerWidth<700;scene.classList.toggle('shrine-mobile',mobile);scene.style.setProperty('--crafting-scale',mobile?1:scale);scene.style.left=mobile?'0px':Math.round((innerWidth-1536*scale)/2)+'px';scene.style.top=mobile?'0px':Math.round((innerHeight-1024*scale)/2)+'px';}fitHeader();}
  function fitHeader(){const amount=document.getElementById('ry');if(!amount)return;if(tab!==2){amount.style.removeProperty('font-size');return;}amount.style.fontSize=Math.max(12,Math.min(18,185/Math.max(1,amount.textContent.trim().length)))+'px';}
  function sync(){
   const selected=(tab===2||tab===6)&&!LoginScreen.active&&!GameLoading.active?tab:null;
   const active=selected!==null;if(document.body.classList.contains('exact-crafting-active')!==active)document.body.classList.toggle('exact-crafting-active',active);
   for(const [page,{screen,scene,section,home}]of scenes){const current=selected===page;screen.hidden=!current;screen.inert=!current;if(current){if(section.parentNode!==scene)scene.append(section);if(bar.parentNode!==scene)scene.append(bar)}else{if(section.parentNode===scene)home.after(section);if(bar.parentNode===scene)barHome.after(bar)}}
   resize();
  }
  function shrine(){
   const section=scenes.get(2).section;
   const canvas=section.querySelector('#shrinePortrait');if(canvas){canvas.id='exactShrinePortrait';canvas.setAttribute('aria-label','Current shared Shinobi player model');}
   const recruited=section.querySelector('.shrine-controls > p.mut');if(recruited)recruited.textContent='Heroes recruited: '+S.h.length;
   let fee=section.querySelector('.exact-summon-fee');if(!fee){fee=document.createElement('small');fee.className='exact-summon-fee';section.querySelector('.shrine-controls')?.append(fee)}
   fee.textContent='A 2% studio fee is shown at checkout.';
   fitHeader();paint(performance.now());
  }
  function fusion(){
   const section=scenes.get(6).section;
   section.querySelectorAll('[data-fusionhero]').forEach(canvas=>{canvas.dataset.exactFusionhero=canvas.dataset.fusionhero;canvas.removeAttribute('data-fusionhero');canvas.width=160;canvas.height=176});
   const selected=[...section.querySelectorAll('.fusion-table input:checked')].map(input=>{const row=input.closest('tr'),portrait=row?.querySelector('canvas');return S.h.find(h=>h.id===Number(portrait?.dataset.exactFusionhero))}).filter(Boolean).slice(0,3);
   let models=section.querySelector('.exact-fusion-models');if(!models){models=document.createElement('div');models.className='exact-fusion-models';for(let i=0;i<3;i++){const slot=document.createElement('div');slot.className='fusion-input-slot';const c=document.createElement('canvas');c.setAttribute('aria-label','Selected fusion hero '+(i+1));const label=document.createElement('span');label.className='fusion-input-name';slot.append(c,label);models.append(slot)}section.querySelector('.fusion-preview')?.append(models)}
   models.querySelectorAll('canvas').forEach((c,i)=>{const hero=selected[i];c.dataset.selectedHero=hero?.id??'';c.parentNode.classList.toggle('has-hero',!!hero);c.nextElementSibling.textContent=hero?hero.name.split(' ')[0]:'Select hero '+(i+1);c.nextElementSibling.title=hero?.name||'Choose a Reserve hero from the list';c.setAttribute('aria-label',hero?hero.name:'Empty fusion input '+(i+1))});
   const next=(section.querySelector('.fusion-summary h4 b')?.textContent||'Chunin').replace(/^\s*1\s*/, '').trim();
   const caption=section.querySelector('.fusion-caption');if(caption)caption.textContent='NEW HERO · LEVEL 1 ('+next.toUpperCase()+')';
   const button=section.querySelector('#fuseButton');if(button)button.textContent='FUSE NOW';
   section.querySelectorAll('.fusion-stats>div').forEach((el,i)=>el.style.setProperty('--fusion-stat-icon',fusionIcons[i]));
   paint(performance.now());
  }
  function draw(canvas,hero,now){
   const w=canvas.clientWidth||112,h=canvas.clientHeight||78,density=Math.min(2,Math.max(1,devicePixelRatio||1));
   if(canvas.width!==Math.round(w*density))canvas.width=Math.round(w*density);if(canvas.height!==Math.round(h*density))canvas.height=Math.round(h*density);
   const context=canvas.getContext('2d');context.setTransform(density,0,0,density,0,0);context.clearRect(0,0,w,h);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
   if(hero){const scale=Math.min((w-8)/40,(h-8)/50)*.94;if(PlayerModels.drawPortrait)PlayerModels.drawPortrait(context,hero,w/2,h-9,scale,now);else ShinobiSprites.blit(context,PlayerModels.portraitFrame(hero,now),w/2,h-9,scale,false)}
   else if(canvas.closest('.fusion-input-slot')){context.fillStyle='#a5bdd1';context.font='300 25px Arial';context.textAlign='center';context.textBaseline='middle';context.fillText('+',w/2,h/2)}
   canvas.dataset.portraitVisible=String(!!hero);context.setTransform(1,0,0,1,0,0);
  }
  function shrinePortrait(canvas,hero,now){
   // Layout dimensions are stable while the scene is uniformly transformed.
   // getBoundingClientRect would include that transform and cause double scaling.
   const density=Math.min(2,Math.max(1,devicePixelRatio||1)),w=canvas.clientWidth||222,h=canvas.clientHeight||331;
   if(canvas.width!==Math.round(w*density))canvas.width=Math.round(w*density);
   if(canvas.height!==Math.round(h*density))canvas.height=Math.round(h*density);
   const context=canvas.getContext('2d');context.setTransform(density,0,0,density,0,0);context.clearRect(0,0,w,h);
   context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
   // A real village scene replaces the flat patch that hid the printed example.
   // The original outer scroll, side cards and lightning remain in the artwork.
   const village=DesignModels.images?.village;
   if(village?.complete){const cropWidth=village.naturalHeight*w/h;context.drawImage(village,(village.naturalWidth-cropWidth)/2,0,cropWidth,village.naturalHeight,0,0,w,h);}
   else{context.fillStyle='#081425';context.fillRect(0,0,w,h);}
   const shade=context.createLinearGradient(0,0,0,h);shade.addColorStop(0,'#02091a44');shade.addColorStop(.62,'#02091a88');shade.addColorStop(1,'#030b14dd');context.fillStyle=shade;context.fillRect(0,0,w,h);
   const glow=context.createRadialGradient(w/2,h*.68,10,w/2,h*.68,150);glow.addColorStop(0,'#e5b04c30');glow.addColorStop(1,'#e5b04c00');context.fillStyle=glow;context.fillRect(0,0,w,h);
   const scale=Math.min((w-24)/40,(h-40)/50)*.96;
   context.save();context.beginPath();context.rect(6,6,w-12,h-12);context.clip();
   if(PlayerModels.drawPortrait)PlayerModels.drawPortrait(context,hero,w/2,h-33,scale,now);
   else ShinobiSprites.blit(context,PlayerModels.portraitFrame(hero,now),w/2,h-33,scale,false);
   context.restore();
   context.setTransform(1,0,0,1,0,0);
  }
  function paint(now){
   if(tab===2){const c=document.getElementById('exactShrinePortrait');if(c)shrinePortrait(c,lastS||{id:0,r:4},now)}
   if(tab===6){for(const c of scenes.get(6).section.querySelectorAll('[data-exact-fusionhero]'))draw(c,S.h.find(h=>h.id===Number(c.dataset.exactFusionhero)),now,3.6);for(const c of scenes.get(6).section.querySelectorAll('.exact-fusion-models canvas')){const hero=c.dataset.selectedHero===''?null:S.h.find(h=>h.id===Number(c.dataset.selectedHero));draw(c,hero,now,4.1)}}
  }
  const oldSumm=summ;summ=function(...args){const result=oldSumm(...args);shrine();return result};
  const oldFusion=FusionUI.render;FusionUI.render=function(...args){const result=oldFusion(...args);fusion();return result};
  const oldGo=go;go=function(...args){const result=oldGo(...args);sync();return result};
  addEventListener('resize',resize);addEventListener('shinobi-ryo-ledger',fitHeader);new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
  GameLoading.ready.then(sync);let last=0;function animate(now){requestAnimationFrame(animate);if(document.hidden||!scenes.get(tab)?.screen||scenes.get(tab).screen.hidden||now-last<160)return;last=now;paint(now)}requestAnimationFrame(animate);
  api.loaded=true;api.refresh=()=>{if(tab===2)shrine();if(tab===6)fusion();sync()};sync();if(tab===2)summ();if(tab===6)V2.clearFusion();return true;
 }
})();
