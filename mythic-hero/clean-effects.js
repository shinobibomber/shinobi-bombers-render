/* Shared clean VFX atlases: no allocations, particle spawning or gameplay callbacks. */
(()=>{
 'use strict';
 const clamp=x=>Math.max(0,Math.min(1,x));
 function paint(c,id,progress,layer,images,manifest,quality=2){
  const s=manifest.skills[id];if(!s||!Number.isFinite(progress))return false;
  const t=clamp(progress);if(t===0||t===1)return true;
  const u=clamp((t*s.requiredFrames-.5)/(s.requiredFrames-1))*(s.requiredFrames-1),a=Math.floor(u),mix=quality===1?0:u-a;
  const fade=Math.min(1,t/.06,(1-t)/.1);
  for(const name of layer==='all'?['ground','front']:[layer]){
   if(name==='ground'&&!['raijin_field','mythic_dragon_ascension'].includes(id))continue;
   const image=images.get(s.layers[name]?.path);if(!image)continue;
   c.save();c.globalAlpha*=fade*(1-mix);c.drawImage(image,a*320,0,320,320,0,0,320,320);c.restore();
   if(mix>0){c.save();c.globalAlpha*=fade*mix;c.drawImage(image,Math.min(a+1,s.requiredFrames-1)*320,0,320,320,0,0,320,320);c.restore()}
  }
  return true;
 }
 window.TsukiyomiCleanEffects={version:9,paint};
})();
