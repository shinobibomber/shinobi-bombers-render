/* Reviewed RGBA VFX. One reusable surface preserves premultiplied frame alpha. */
(()=>{
 'use strict';
 const clamp=x=>Math.max(0,Math.min(1,x));
 let scratch,blend;
 function paint(c,id,progress,layer,images,manifest,quality=2,frame=null){
  const s=manifest.skills[id];if(!s||!Number.isFinite(progress))return false;
  const explicit=Number.isInteger(frame),t=clamp(progress);if(!explicit&&(t===0||t===1))return true;
  const u=explicit?Math.max(0,Math.min(s.requiredFrames-1,frame)):t*(s.requiredFrames-1),a=Math.floor(u),mix=quality===1||explicit?0:u-a;
  const fade=explicit?1:Math.min(1,t/.035,(1-t)/.06),w=s.frameWidth,h=s.frameHeight,columns=s.columns;
  if(!scratch){scratch=document.createElement('canvas');scratch.width=w;scratch.height=h;blend=scratch.getContext('2d')}
  for(const name of layer==='all'?['ground','front']:[layer]){
   const image=images.get(s.layers[name]?.path);if(!image)continue;
   blend.clearRect(0,0,w,h);blend.globalCompositeOperation='lighter';
   const cell=(index,alpha)=>{if(alpha<=0)return;blend.globalAlpha=alpha;blend.drawImage(image,(index%columns)*w,Math.floor(index/columns)*h,w,h,0,0,w,h)};
   cell(a,1-mix);if(mix)cell(Math.min(a+1,s.requiredFrames-1),mix);blend.globalAlpha=1;
   c.save();c.globalAlpha*=fade;c.drawImage(scratch,0,0,w,h,0,0,320,320);c.restore();
  }
  return true;
 }
 window.TsukiyomiCleanEffects={version:11,paint};
})();
