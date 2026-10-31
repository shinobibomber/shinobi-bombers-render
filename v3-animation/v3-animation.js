/* Visual-only compatibility adapter and honest production-frame diagnostics. */
(() => {
 'use strict';
 const source=new URL('.',document.currentScript.src),contract=window.ShinobiAnimationContract;
 const previousReady=ShinobiSprites.ready,qualities=['off','low','medium','high'],reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let inventory=null,quality='high',baseFrame,baseCompose,baseHero,white=null,blank=null,circleFrames=new Map(),composites=new WeakMap(),recent=new Map(),studio=null,studioRaf=0;
 try{const saved=localStorage.getItem('shinobi-v3-quality');quality=qualities.includes(saved)?saved:reduced.matches?'low':'high';}catch{quality=reduced.matches?'low':'high';}
 const api=window.V3Animation={loaded:false,ready:null,inventory:null,contract,setQuality,describeHero,openStudio,closeStudio,loadProductionPackage,get quality(){return quality;},get reducedMotion(){return reduced.matches;}};
 api.ready=ShinobiSprites.ready=Promise.all([previousReady,fetch(new URL('inventory.json',source)).then(r=>{if(!r.ok)throw Error('V3 animation inventory unavailable.');return r.json();})]).then(([,data])=>{
  if(!contract||data.schemaVersion!==1||data.classification!=='runtime-compatibility-inventory'||data.nativeModels.length!==8||data.bosses.length!==6)throw Error('Unexpected V3 compatibility inventory.');
  inventory=api.inventory=data;
  // The current stable mapping must not be changed to the twelve concept IDs.
  if(PlayerModels.catalog.some((model,index)=>model.key!==data.nativeModels[index].key))throw Error('Animation inventory no longer matches the stable player identities.');
  baseFrame=TierAuras.frame;baseCompose=TierAuras.compose;baseHero=ShinobiSprites.heroFrame;
  TierAuras.frame=auraFrame;TierAuras.compose=compose;
  ShinobiSprites.heroFrame=DesignModels.heroFrame=function(hero,...args){return compose(hero,baseHero(hero,...args));};
  api.loaded=true;ShinobiSprites.clearCache();dispatchEvent(new CustomEvent('shinobi-v3-animation-ready'));return true;
 }).catch(error=>{console.warn('V3 animation enhancements unavailable; original renderer retained.',error);api.error=error.message;return false;});
 function rankOf(hero){return Math.max(0,Math.min(4,Math.trunc(Number(typeof hero==='object'?hero?.r:hero)||0)));}
 function describeHero(hero){const model=PlayerModels.modelFor(hero),rank=rankOf(hero);return {model:{index:model.index,key:model.key,label:model.label},element:inventory?.nativeModels[model.index]?.element||model.key,rarity:{rank,name:inventory?.rarities[rank]?.name||R[rank][0],color:inventory?.rarities[rank]?.color||R[rank][1]},source:'existing-model-id',productionFrames:false};}
 function neutralGenin(){
  if(white)return white;const original=baseFrame(0);white=document.createElement('canvas');white.width=original.width;white.height=original.height;
  const c=white.getContext('2d',{willReadFrequently:true});c.drawImage(original,0,0);const pixels=c.getImageData(0,0,white.width,white.height);
  // Cosmetic adaptation applies to the aura alone; body RGB/alpha are untouched.
  for(let i=0;i<pixels.data.length;i+=4){const light=Math.max(pixels.data[i],pixels.data[i+1],pixels.data[i+2]);pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=light;}
  c.putImageData(pixels,0,0);white.designSprite=true;white.tierAura={rank:0,name:'Genin',source:'legacy-effect-neutral-silver-adaptation'};return white;
 }
 function auraFrame(value){
  const rank=rankOf(value);if(quality==='off'){if(!blank){blank=document.createElement('canvas');blank.width=320;blank.height=400;blank.designSprite=true;}return blank;}
  if(quality==='low'){
   if(circleFrames.has(rank))return circleFrames.get(rank);const canvas=document.createElement('canvas');canvas.width=320;canvas.height=400;canvas.designSprite=true;
   const c=canvas.getContext('2d'),color=inventory.rarities[rank].color;c.strokeStyle=color;c.lineWidth=3;c.globalAlpha=.7;c.beginPath();c.ellipse(160,352,85+rank*7,22+rank*2,0,0,Math.PI*2);c.stroke();canvas.tierAura={rank,name:inventory.rarities[rank].name,source:'procedural-static-ground-circle'};circleFrames.set(rank,canvas);return canvas;
  }
  return rank===0?neutralGenin():baseFrame(rank);
 }
 function compose(hero,provided){
  const base=provided?.tierAuraBase||provided;if(!base)return provided;if(quality==='off')return base;
  const rank=rankOf(hero);if(quality!=='low'&&rank!==0)return baseCompose(hero,base);
  let byKey=composites.get(base);if(!byKey){byKey=new Map();composites.set(base,byKey);}const key=quality+':'+rank;if(byKey.has(key))return byKey.get(key);
  const result=document.createElement('canvas');result.width=base.width;result.height=base.height;result.designSprite=base.designSprite;
  const c=result.getContext('2d');c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(auraFrame(rank),0,0,result.width,result.height);c.drawImage(base,0,0);
  if(base.playerModel)result.playerModel=base.playerModel;if(base.characterAnimation)result.characterAnimation=base.characterAnimation;
  result.tierAuraBase=base;result.tierAura={rank,name:inventory.rarities[rank].name,source:quality==='low'?'procedural-static-ground-circle':rank===0?'legacy-effect-neutral-silver-adaptation':'legacy-static-effect'};
  byKey.set(key,result);recent.set(result,{byKey,key});if(recent.size>96){const[oldest,record]=recent.entries().next().value;recent.delete(oldest);record.byKey.delete(record.key);}return result;
 }
 function setQuality(next){
  if(!qualities.includes(next))return false;if(next===quality)return true;quality=next;composites=new WeakMap();recent.clear();
  try{localStorage.setItem('shinobi-v3-quality',next);}catch{}
  if(api.loaded){ShinobiSprites.clearCache();ReferenceLayout?.refresh();window.HeroesDesign?.refresh?.();window.RosterDesign?.refresh?.();window.ShrineFusionDesign?.refresh?.();}
  if(studio)studio.querySelector('[data-studio-quality]').value=next;return true;
 }
 addEventListener('shinobi-graphics-quality',event=>setQuality(event.detail?.quality));
 reduced.addEventListener?.('change',()=>{if(studio)studio.querySelector('[data-studio-status]').textContent='Reduced motion '+(reduced.matches?'enabled; preview uses a still pose.':'disabled.');});
 async function loadProductionPackage(manifest,baseUrl){
  // Verify genuine source images; never treat an opaque presentation sheet as alpha.
  const textures={},images=new Map(),root=new URL(baseUrl,location.href);const paths=Array.isArray(manifest?.textures)?manifest.textures:[];
  for(const file of paths){if(!contract.validPath(file)||!file.endsWith('.png'))continue;const url=new URL(file,root);if(url.origin!==location.origin)throw Error('Production animation textures must be served from this game origin.');
   const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Missing production frame: '+file));img.src=url.href;});
   if(image.naturalWidth>4096||image.naturalHeight>4096)throw Error('Production texture exceeds the 4096-pixel texture limit.');
   const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const c=canvas.getContext('2d',{willReadFrequently:true});c.drawImage(image,0,0);const stats=contract.inspectRgba(c.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
   textures[file]={...stats,hasAlpha:stats.transparent>0||stats.partial>0};images.set(file,image);
  }
  const knownIds=inventory?[...[...inventory.nativeModels,...inventory.bosses,...inventory.canonicalV3Models].map(model=>model.key),...inventory.rarities.map(rank=>rank.name.toLowerCase())]:[];
  const validation=contract.validatePackage(manifest,{textures,knownModelIds:knownIds});if(!validation.ok)throw Error(validation.errors.join('\n'));
  // Import/preview only. Activating a new character needs an approved stable ID mapping.
  return {manifest,images,validation,identityMapped:inventory.nativeModels.some(model=>model.key===manifest.modelId)||inventory.bosses.some(model=>model.key===manifest.modelId),classification:'validated-production-package-not-activated'};
 }
 function openStudio(){
  if(!api.loaded)return false;if(!studio)buildStudio();if(!studio.open)studio.showModal();playClock.resume();paintStudio();return true;
 }
 function closeStudio(){if(studio?.open)studio.close();if(studioRaf){cancelAnimationFrame(studioRaf);studioRaf=0;}playClock?.pause();}
 let playClock=null;
 function buildStudio(){
  studio=document.createElement('dialog');studio.id='v3AnimationStudio';studio.setAttribute('aria-labelledby','v3AnimationTitle');
  studio.innerHTML='<header><div><p>DEVELOPER TOOLS · VISUALS ONLY</p><h2 id="v3AnimationTitle">Animation asset studio</h2></div><button type="button" data-studio-close aria-label="Close animation studio">✕</button></header><div class="v3-studio-layout"><div><div class="v3-studio-canvas-wrap"><canvas width="640" height="700" aria-label="Existing animation frame preview"></canvas></div><p data-studio-status role="status"></p></div><section class="v3-studio-controls"><label>Asset group<select data-studio-group><option value="hero">Current Heroes · 8 models</option><option value="boss">Current bosses · 6 models</option></select></label><label>Existing model<select data-studio-model></select></label><label>Rarity<select data-studio-rank></select></label><label>Direction<select data-studio-direction><option value="down">Down / front</option><option value="left">Left · mirrored legacy side</option><option value="right">Right / side</option><option value="up">Up / back fallback</option></select></label><label>Action<select data-studio-action></select></label><label>Aura quality<select data-studio-quality><option value="off">Off</option><option value="low">Low · static circle</option><option value="medium">Medium · existing effect</option><option value="high">High · existing effect</option></select></label><label class="v3-studio-checkbox"><input type="checkbox" data-studio-anchor checked> Show feet anchor / visual bounds</label><label>Frame scrubber<input type="range" data-studio-frame min="0" max="0" value="0" step="1"></label><button type="button" data-studio-play>Pause preview</button><p class="v3-studio-warning">These are existing masked presentation-sheet cells. A one-pose action is not a full motion cycle. The canonical twelve V3 models and production animation loops still require approved clean-alpha artwork.</p><details><summary>Missing production artwork</summary><ul data-studio-missing></ul></details></section></div>';
  document.body.append(studio);studio.querySelector('[data-studio-close]').onclick=closeStudio;studio.addEventListener('cancel',event=>{event.preventDefault();closeStudio();});
  for(const rank of inventory.rarities){const option=document.createElement('option');option.value=rank.rank;option.textContent=rank.name;studio.querySelector('[data-studio-rank]').append(option);}
  for(const item of inventory.missingArtwork){const li=document.createElement('li');li.textContent=item;studio.querySelector('[data-studio-missing]').append(li);}
  const models=()=>{const group=studio.querySelector('[data-studio-group]').value,list=group==='hero'?inventory.nativeModels:inventory.bosses,select=studio.querySelector('[data-studio-model]');select.replaceChildren();for(const model of list){const option=document.createElement('option');option.value=model.index;option.textContent=model.label;select.append(option);}const direction=studio.querySelector('[data-studio-direction]'),rank=studio.querySelector('[data-studio-rank]');direction.disabled=group==='boss';rank.disabled=group==='boss';if(group==='boss')direction.value='down';direction.title=group==='boss'?'Boss action samples contain one front pose; directional action sequences are missing.':'';actions();};
  const actions=()=>{const group=studio.querySelector('[data-studio-group]').value,index=Number(studio.querySelector('[data-studio-model]').value),model=(group==='hero'?inventory.nativeModels:inventory.bosses)[index],select=studio.querySelector('[data-studio-action]');select.replaceChildren();for(const[key,clip]of Object.entries(model.clips)){if(!clip.frames)continue;const option=document.createElement('option');option.value=key;option.textContent=key+' · '+clip.frames+' '+(clip.frames===1?'pose':'cells');select.append(option);}updateStudio();};
  playClock=contract.createClock();studio.querySelector('[data-studio-group]').onchange=models;studio.querySelector('[data-studio-model]').onchange=actions;
  for(const name of ['rank','direction','action','anchor'])studio.querySelector('[data-studio-'+name+']').onchange=updateStudio;
  studio.querySelector('[data-studio-quality]').value=quality;studio.querySelector('[data-studio-quality]').onchange=event=>{setQuality(event.target.value);dispatchEvent(new CustomEvent('shinobi-graphics-quality',{detail:{quality}}));};
  studio.querySelector('[data-studio-frame]').oninput=()=>{playClock.pause();studio.querySelector('[data-studio-play]').textContent='Play preview';paintStudio(true);};
  studio.querySelector('[data-studio-play]').onclick=()=>{if(playClock.paused){playClock.reset();playClock.resume();}else playClock.pause();studio.querySelector('[data-studio-play]').textContent=playClock.paused?'Play preview':'Pause preview';paintStudio(true);};
  models();
 }
 function updateStudio(){if(!studio)return;playClock.reset();const group=studio.querySelector('[data-studio-group]').value,index=Number(studio.querySelector('[data-studio-model]').value),action=studio.querySelector('[data-studio-action]').value,model=(group==='hero'?inventory.nativeModels:inventory.bosses)[index],direction=studio.querySelector('[data-studio-direction]'),directional=group==='hero'&&['idle','walk','run'].includes(action);direction.disabled=!directional;if(!directional)direction.value='down';const nativeDirection=group==='hero'&&direction.value!=='down',count=nativeDirection?3:model.clips[action]?.frames||1,range=studio.querySelector('[data-studio-frame]');range.max=count-1;range.value=0;paintStudio(true);}
 function paintStudio(force=false){
  if(!studio?.open)return;if(studioRaf&&!force)return;if(studioRaf){cancelAnimationFrame(studioRaf);studioRaf=0;}
  const canvas=studio.querySelector('canvas'),c=canvas.getContext('2d'),group=studio.querySelector('[data-studio-group]').value,index=Number(studio.querySelector('[data-studio-model]').value),rank=Number(studio.querySelector('[data-studio-rank]').value),action=studio.querySelector('[data-studio-action]').value,direction=studio.querySelector('[data-studio-direction]').value,model=(group==='hero'?inventory.nativeModels:inventory.bosses)[index],count=model.clips[action]?.frames||1;
  const nativeDirection=group==='hero'&&direction!=='down',range=studio.querySelector('[data-studio-frame]'),actualCount=nativeDirection?3:count,phase=reduced.matches?0:playClock.paused?Number(range.value):Math.floor(playClock.elapsed/125)%actualCount;if(!playClock.paused)range.value=phase;
  c.clearRect(0,0,canvas.width,canvas.height);let frame,info;
  if(group==='hero'){const hero={id:index,r:rank,z:false};const row=direction==='up'?'back':direction==='left'||direction==='right'?'side':'front';frame=compose(hero,nativeDirection?PlayerModels.heroFrame(hero,(action==='idle'?'i':'w')+phase,false,row):CharacterAnimations.heroFrame(hero,'clip:'+action+':'+phase,false,row));info=describeHero(hero);}
  else{const pose=({idle:'i',walk:'w',attack:'a',skill:'a',hurt:'h',defeat:'d'})[action]||'i';frame=CombatModels.bossFrame(index+1,pose+(action==='skill'?1:phase));}
  c.save();if(direction==='left'){c.translate(canvas.width,0);c.scale(-1,1);}c.drawImage(frame,80,45,480,600);c.restore();
  if(studio.querySelector('[data-studio-anchor]').checked){c.strokeStyle='#ffd65e';c.lineWidth=2;c.setLineDash([6,5]);c.strokeRect(80,45,480,600);c.beginPath();c.moveTo(42,573);c.lineTo(598,573);c.stroke();c.setLineDash([]);c.fillStyle='#fff3aa';c.beginPath();c.arc(320,573,5,0,Math.PI*2);c.fill();}
  studio.querySelector('[data-studio-status]').textContent=model.label+' · '+action+' '+(phase+1)+'/'+actualCount+' · '+(actualCount===1?'one legacy pose':nativeDirection?'native direction fallback':'legacy example cells')+(direction==='up'&&group==='hero'?' · back view':'')+(info?' · '+info.rarity.name+' rarity / '+info.element+' element':' · directional action sequences missing')+(reduced.matches?' · reduced motion':'');
  if(studio.open&&!document.hidden&&!playClock.paused&&!reduced.matches)studioRaf=requestAnimationFrame(()=>{studioRaf=0;paintStudio();});
 }
 addEventListener('resize',()=>{if(studio?.open)paintStudio(true);});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){if(studioRaf)cancelAnimationFrame(studioRaf);studioRaf=0;if(playClock&&!playClock.paused){playClock.pause();studio.dataset.visibilityPaused='true';}}else if(studio?.open&&studio.dataset.visibilityPaused==='true'){delete studio.dataset.visibilityPaused;playClock.resume();paintStudio();}});
})();
