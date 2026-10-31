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
  function resize(){const scale=Math.min(innerWidth/1536,innerHeight/1024);for(const {scene}of scenes.values()){scene.style.setProperty('--crafting-scale',scale);scene.style.left=Math.round((innerWidth-1536*scale)/2)+'px';scene.style.top=Math.round((innerHeight-1024*scale)/2)+'px'}}
  function sync(){
   const selected=(tab===2||tab===6)&&!LoginScreen.active&&!GameLoading.active?tab:null;
   const active=selected!==null;if(document.body.classList.contains('exact-crafting-active')!==active)document.body.classList.toggle('exact-crafting-active',active);
   for(const [page,{screen,scene,section,home}]of scenes){const current=selected===page;screen.hidden=!current;screen.inert=!current;if(current){if(section.parentNode!==scene)scene.append(section);if(bar.parentNode!==scene)scene.append(bar)}else{if(section.parentNode===scene)home.after(section);if(bar.parentNode===scene)barHome.after(bar)}}
   resize();
  }
  function shrine(){
   const section=scenes.get(2).section;
   const canvas=section.querySelector('#shrinePortrait');if(canvas){canvas.id='exactShrinePortrait';canvas.width=484;canvas.height=712;canvas.setAttribute('aria-label','Current shared Shinobi player model');}
   const recruited=section.querySelector('.shrine-controls > p.mut');if(recruited)recruited.textContent='Heroes recruited: '+S.h.length;
   let fee=section.querySelector('.exact-summon-fee');if(!fee){fee=document.createElement('small');fee.className='exact-summon-fee';section.querySelector('.shrine-controls')?.append(fee)}
   fee.textContent='A 2% studio fee is shown at checkout.';
   paint(performance.now());
  }
  function fusion(){
   const section=scenes.get(6).section;
   section.querySelectorAll('[data-fusionhero]').forEach(canvas=>{canvas.dataset.exactFusionhero=canvas.dataset.fusionhero;canvas.removeAttribute('data-fusionhero');canvas.width=160;canvas.height=176});
   const selected=[...section.querySelectorAll('.fusion-table tr.picked')].map(row=>S.h.find(h=>h.id===Number(row.querySelector('canvas')?.dataset.exactFusionhero))).filter(Boolean);
   let models=section.querySelector('.exact-fusion-models');if(!models){models=document.createElement('div');models.className='exact-fusion-models';for(let i=0;i<3;i++){const c=document.createElement('canvas');c.width=192;c.height=192;c.setAttribute('aria-label','Selected fusion hero '+(i+1));models.append(c)}section.querySelector('.fusion-preview')?.append(models)}
   models.querySelectorAll('canvas').forEach((c,i)=>{c.dataset.selectedHero=selected[i]?.id??''});
   const next=section.querySelector('.fusion-summary h4 b')?.textContent||'Chunin';
   const caption=section.querySelector('.fusion-caption');if(caption)caption.textContent='NEW HERO · LEVEL 1 ('+next.toUpperCase()+')';
   const button=section.querySelector('#fuseButton');if(button)button.textContent='FUSE NOW';
   section.querySelectorAll('.fusion-stats>div').forEach((el,i)=>el.style.setProperty('--fusion-stat-icon',fusionIcons[i]));
   paint(performance.now());
  }
  function draw(canvas,hero,now,scale){const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';if(hero)ShinobiSprites.blit(context,PlayerModels.portraitFrame(hero,now),canvas.width/2,canvas.height-10,scale,false)}
  function paint(now){
   if(tab===2){const c=document.getElementById('exactShrinePortrait');if(c)draw(c,lastS||{id:0,r:4},now,12)}
   if(tab===6){for(const c of scenes.get(6).section.querySelectorAll('[data-exact-fusionhero]'))draw(c,S.h.find(h=>h.id===Number(c.dataset.exactFusionhero)),now,3.6);for(const c of scenes.get(6).section.querySelectorAll('.exact-fusion-models canvas')){const hero=c.dataset.selectedHero===''?null:S.h.find(h=>h.id===Number(c.dataset.selectedHero));draw(c,hero,now,4.1)}}
  }
  const oldSumm=summ;summ=function(...args){const result=oldSumm(...args);shrine();return result};
  const oldFusion=FusionUI.render;FusionUI.render=function(...args){const result=oldFusion(...args);fusion();return result};
  const oldGo=go;go=function(...args){const result=oldGo(...args);sync();return result};
  addEventListener('resize',resize);new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
  GameLoading.ready.then(sync);let last=0;function animate(now){requestAnimationFrame(animate);if(document.hidden||!scenes.get(tab)?.screen||scenes.get(tab).screen.hidden||now-last<160)return;last=now;paint(now)}requestAnimationFrame(animate);
  api.loaded=true;api.refresh=()=>{if(tab===2)shrine();if(tab===6)fusion();sync()};sync();if(tab===2)summ();if(tab===6)V2.clearFusion();return true;
 }
})();
