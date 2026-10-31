/* Pure visual asset contract. No game state, rewards, ownership or damage APIs. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ShinobiAnimationContract=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const DIRECTIONS=Object.freeze(['down','left','right','up']);
 const ACTIONS=Object.freeze(['idle','walk','run','bomb_place','basic_attack','skill','ultimate','hurt','defeat','victory']);
 const identifier=/^[a-z][a-z0-9-]{0,63}$/;
 const validPath=value=>typeof value==='string'&&value.length>0&&value.length<240&&/^[a-zA-Z0-9_./-]+$/.test(value)&&!/^(?:[a-z]+:|[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)/i.test(value)&&!value.includes('//');
 function inspectRgba(data,width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!data||data.length!==width*height*4)throw Error('Expected a complete RGBA pixel buffer.');
  let transparent=0,opaque=0,partial=0;for(let i=3;i<data.length;i+=4){if(data[i]===0)transparent++;else if(data[i]===255)opaque++;else partial++;}
  return {width,height,transparent,opaque,partial,total:width*height,hasTransparentPixels:transparent>0,hasVisiblePixels:opaque+partial>0};
 }
 function validatePackage(manifest,options={}){
  const errors=[],warnings=[],textures=options.textures||{},known=options.knownModelIds;
  const error=(path,message)=>errors.push(path+': '+message);
  if(!manifest||typeof manifest!=='object')return {ok:false,errors:['manifest: Expected an object.'],warnings};
  if(manifest.schemaVersion!==1)error('schemaVersion','Expected production contract version 1.');
  if(manifest.classification!=='production-frames')error('classification','Concept/reference boards are not production sprite packages.');
  if(!identifier.test(manifest.modelId||''))error('modelId','Use a stable lowercase model identifier.');
  if(known&&!known.includes(manifest.modelId))error('modelId','This model has no approved identity mapping in the current game.');
  if(manifest.visualOnly!==true)error('visualOnly','Animation metadata must not control gameplay.');
  if(!['hero','boss','aura','vfx'].includes(manifest.kind))error('kind','Expected hero, boss, aura or vfx.');
  if(!Array.isArray(manifest.canvas)||manifest.canvas.length!==2||manifest.canvas.some(n=>!Number.isInteger(n)||n<1||n>2048))error('canvas','Use fixed integer frame dimensions between 1 and 2048.');
  if(!Array.isArray(manifest.anchor)||manifest.anchor.length!==2||manifest.anchor.some(n=>!Number.isFinite(n)||n<0||n>1))error('anchor','Use a normalized [x,y] feet/contact anchor.');
  if(!Array.isArray(manifest.textures)||manifest.textures.length<1)error('textures','At least one real texture is required.');
  const paths=new Set();for(const file of Array.isArray(manifest.textures)?manifest.textures:[]){
   if(!validPath(file)||!file.endsWith('.png')){error('textures','Only safe relative PNG paths are accepted.');continue;}
   if(paths.has(file))error('textures','Duplicate texture path '+file);paths.add(file);
   const image=textures[file];if(!image){error(file,'The frame/atlas file has not been loaded or verified.');continue;}
   if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width>4096||image.height>4096)error(file,'Texture dimensions are invalid or exceed 4096 pixels.');
   if(!image.hasAlpha||image.hasTransparentPixels!==true)error(file,'Real fully transparent background pixels are required; a painted checkerboard is not alpha.');
   if(image.hasVisiblePixels===false)error(file,'The texture is empty.');
  }
  const names=new Set();if(!Array.isArray(manifest.clips)||!manifest.clips.length)error('clips','At least one real animation clip is required.');
  for(const [ci,clip]of (Array.isArray(manifest.clips)?manifest.clips:[]).entries()){
   if(!clip||typeof clip!=='object'){error('clips['+ci+']','Expected an animation object.');continue;}
   const label='clips['+ci+']',key=clip.action+':'+clip.direction;
   if(!ACTIONS.includes(clip.action))error(label,'Unsupported animation action.');
   if(!DIRECTIONS.includes(clip.direction))error(label,'Direction must be down, left, right or up.');
   if(names.has(key))error(label,'Duplicate action/direction clip.');names.add(key);
   if(!Number.isFinite(clip.fps)||clip.fps<1||clip.fps>60)error(label,'FPS must be between 1 and 60.');
   if(typeof clip.loop!=='boolean')error(label,'An explicit loop flag is required.');
   if(!Array.isArray(clip.frames)||!clip.frames.length){error(label,'No real frames were supplied.');continue;}
   if(clip.frames.length===1)warnings.push(label+': One pose is available; this is not an authored motion cycle.');
   const used=new Set();for(const [fi,frame]of clip.frames.entries()){
    const p=label+'.frames['+fi+']';if(!frame||typeof frame!=='object'){error(p,'Expected a frame object.');continue;}const texture=textures[frame.texture],rect=frame.rect;
    if(!paths.has(frame.texture))error(p,'Texture must be declared in this package.');
    if(!Array.isArray(rect)||rect.length!==4||rect.some(n=>!Number.isInteger(n))||rect[0]<0||rect[1]<0||rect[2]<1||rect[3]<1){error(p,'Invalid atlas frame rectangle.');continue;}
    if(texture&&(rect[0]+rect[2]>texture.width||rect[1]+rect[3]>texture.height))error(p,'Frame lies outside its texture.');
    if(Array.isArray(manifest.canvas)&&(rect[2]!==manifest.canvas[0]||rect[3]!==manifest.canvas[1]))error(p,'All frames must keep the declared fixed canvas dimensions.');
    const address=frame.texture+':'+rect.join(',');if(used.has(address))warnings.push(p+': Repeated pose rectangle; verify genuine motion instead of duplicating still artwork.');used.add(address);
    if(frame.events!==undefined&&(!Array.isArray(frame.events)||frame.events.some(e=>!e||!/^visual_[a-z0-9_]+$/.test(e.name||'')||Object.keys(e).some(k=>!['name'].includes(k)))))error(p,'Only named visual cues are allowed; damage, movement and rewards remain outside animation metadata.');
   }
  }
  warnings.push('Manual art review is still required for costume identity, captions, painted backgrounds, halos and motion continuity.');
  return {ok:errors.length===0,errors,warnings};
 }
 function directionFromVector(dx,dy,previous='down'){if(!Number.isFinite(dx)||!Number.isFinite(dy)||(!dx&&!dy))return DIRECTIONS.includes(previous)?previous:'down';return Math.abs(dx)>Math.abs(dy)?dx<0?'left':'right':dy<0?'up':'down';}
 function frameAt(clip,elapsedMs,{reducedMotion=false,playing=true,frozenMs=0}={}){if(!clip?.frames?.length)return 0;if(reducedMotion)return 0;const elapsed=playing?elapsedMs:frozenMs,n=Math.floor(Math.max(0,Number(elapsed)||0)*clip.fps/1000);return clip.loop?n%clip.frames.length:Math.min(clip.frames.length-1,n);}
 function createClock(now=()=>performance.now()){
  let accumulated=0,started=now(),paused=false;
  return {get elapsed(){return accumulated+(paused?0:Math.max(0,now()-started));},get paused(){return paused;},pause(){if(!paused){accumulated+=Math.max(0,now()-started);paused=true;}},resume(){if(paused){started=now();paused=false;}},reset(){accumulated=0;started=now();}};
 }
 return Object.freeze({DIRECTIONS,ACTIONS,validPath,inspectRgba,validatePackage,directionFromVector,frameAt,createClock});
});
