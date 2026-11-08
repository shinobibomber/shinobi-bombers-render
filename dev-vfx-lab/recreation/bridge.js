/* Uses the approved game art as a preview backdrop only. Does not replace game VFX. */
(() => {
 'use strict';
 const hero={id:'recreation-preview-only',r:5,mythic:'tsukiyomi'},floor=document.createElement('canvas');let effects;
 const ready=Promise.all([MythicHero.runtimeReady,MapDesign.ready,MythicRecreation.create()]).then(async([,,renderer])=>{effects=renderer;await MythicHero.preload();await MapDesign.load(1);MapDesign.drawFloor(floor,{W,T,map:1});return true});
 function paint(c,id,progress,o={}){
  const w=c.canvas.width,h=c.canvas.height,clip=effects.manifest.clips[id],size=h*.92,groundY=h*.88,centerX=w*.54,actorX=['dragon_slash','void_shuriken'].includes(id)?w*.27:centerX;
  c.clearRect(0,0,w,h);if(o.background!=='transparent'){c.fillStyle='#100a20';c.fillRect(0,0,w,h)}
  if(o.background==='map'){c.drawImage(floor,0,0,floor.width,floor.height,0,0,w,h);c.fillStyle='#09031726';c.fillRect(0,0,w,h)}
  const effect=layer=>{c.save();c.translate(centerX-size*.5,groundY-size*420/512);c.scale(size/512,size/512);if(o.direction==='left'){c.translate(512,0);c.scale(-1,1)}effects.paint(c,id,progress,layer,{frame:o.frame,interpolate:o.interpolate});c.restore()};
  effect('ground');
  const scale=h/230,time=progress*clip.durationMs;
  if(o.aura!==false)TierAuras.draw(c,hero,actorX,groundY,scale,time);
  if(o.character!==false){const img=MythicHero.renderFrame(hero,'ATTACK',Math.min(5,Math.floor(progress*6)),o.direction||'right');c.drawImage(img,actorX-20*scale,groundY-44*scale,40*scale,50*scale)}
  if(o.aura!==false)TierAuras.drawFront(c,hero,actorX,groundY,scale,time);
  effect('front');
 }
 window.MythicRecreationBridge={ready,paint,get manifest(){return effects.manifest},get renderer(){return effects},snapshot:()=>JSON.stringify({heroes:S.h,bombs,map:S.map,ryo:S.ryo,aura:MythicHero.auraEnabled,hero:MythicHero.animationSource.hero})};
})();
