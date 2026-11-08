/* Preview-only atlas reader. No runtime game registration or combat callbacks. */
(() => {
 'use strict';
 async function create(){
  const res=await fetch('/vfx-lab/recreation/manifest.json');if(!res.ok)throw Error('Missing recreation manifest');const manifest=await res.json(),images=new Map();
  await Promise.all(Object.values(manifest.clips).flatMap(s=>Object.values(s.layers)).map(a=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{if(img.width!==a.width||img.height!==a.height)return reject(Error('Invalid sheet dimensions'));images.set(a.path,img);resolve()};img.onerror=()=>reject(Error('Missing '+a.path));img.src='/vfx-lab/recreation/'+a.path})));
  const scratch=document.createElement('canvas');scratch.width=scratch.height=512;const blend=scratch.getContext('2d');
  function paint(c,id,progress,layer='combined',options={}){
   const s=manifest.clips[id];if(!s)return;const explicit=Number.isInteger(options.frame),p=Math.max(0,Math.min(1,progress)),u=explicit?Math.max(0,Math.min(s.frameCount-1,options.frame)):p*(s.frameCount-1),n=Math.floor(u),mix=options.interpolate===false||explicit?0:u-n;
   const img=images.get(s.layers[layer].path),fade=explicit?1:Math.min(1,p/.035,(1-p)/.06);
   // Mix premultiplied frames on a transparent scratch surface. Compositing two
   // half-opacity cells directly over the map would incorrectly wash out the core.
   blend.clearRect(0,0,512,512);blend.globalCompositeOperation='lighter';
   function cell(index,alpha){if(alpha<=0)return;blend.globalAlpha=alpha;blend.drawImage(img,...s.frames[index].rect,0,0,512,512)}
   cell(n,1-mix);if(mix)cell(Math.min(n+1,s.frameCount-1),mix);blend.globalAlpha=1;
   c.save();c.globalAlpha*=fade;c.drawImage(scratch,0,0);c.restore();
  }
  return{manifest,paint};
 }
 window.MythicRecreation={create};
})();
