/* V6: supplied reference art plus continuous engine animation; cosmetic only. */
(() => {
 'use strict';
 const tau=Math.PI*2,clamp=n=>Math.max(0,Math.min(1,n)),smooth=n=>{n=clamp(n);return n*n*(3-2*n)};
 // Precompute chain geometry once. No particle instances or paths allocated per frame.
 const chains=new Path2D();for(let side=-1;side<=1;side+=2)for(let i=0;i<15;i++){const a=i*.13+side*.3,x=Math.cos(a)*side*77,y=48-i*6;chains.ellipse(x,y,5,2.6,side*.8,0,tau);}
 function sprite(c,image,m,key,x=0,y=0,scale=1,angle=0,alpha=1){
  const t=m.tiles[key];if(!t||alpha<=0)return;const [sx,sy,w,h]=t.rect;
  c.save();c.translate(x,y);c.rotate(angle);c.globalAlpha*=clamp(alpha);c.drawImage(image,sx,sy,w,h,-t.anchor[0]*scale,-t.anchor[1]*scale,w*scale,h*scale);c.restore();
 }
 function sequence(c,image,m,id,t,x,y,scale,angle=0){
  const keys=m.clips[id].sourceFrames,u=clamp(t)*(keys.length-1),a=Math.floor(u),mix=u-a;
  sprite(c,image,m,keys[a],x,y,scale,angle,1-mix);if(mix>0)sprite(c,image,m,keys[Math.min(a+1,keys.length-1)],x,y,scale,angle,mix);
 }
 function paint(c,id,progress,layer,image,m,quality=2){
  if(!image||!m?.clips[id]||!Number.isFinite(progress))return false;
  if(layer==='ground'&&id!=='raijin_field'&&id!=='mythic_dragon_ascension')return true;
  const t=clamp(progress),fade=smooth(t/.12)*smooth((1-t)/.22);if(fade<=0)return true;
  c.save();c.translate(160,160);c.globalAlpha*=fade;c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
  if(id==='raijin_field'&&layer!=='all'){c.beginPath();c.rect(-160,layer==='ground'?48:-160,320,layer==='ground'?112:208);c.clip();}
  if(id==='dragon_slash'){
   const sweep=smooth(t),copies=quality===1?2:3;
   // The row's largest crescents overlap adjoining drawings. Use its complete
   // reusable crescent instead of displaying a hard-cut poster rectangle.
   for(let i=copies-1;i>=0;i--)sprite(c,image,m,'crescent',-36+sweep*55-i*17,-12+i*8,(.35+sweep*.85)-i*.08,-.12+i*.12,1-i*.2);
   if(t>.4&&t<.84)sprite(c,image,m,m.clips.raijin_field.sourceFrames[8],16,-2,.58,-.4,Math.sin(clamp((t-.4)/.44)*Math.PI)*.55);
   if(t>.64)sprite(c,image,m,'flash',55,-10,.8,0,Math.sin(clamp((t-.64)/.36)*Math.PI));
  }else if(id==='void_shuriken'){
   const radius=62*Math.sin(Math.PI*t),count=quality===1?3:6;
   sprite(c,image,m,'sigil',0,0,.5+smooth(t)*.3,-t*2,Math.sin(Math.PI*t));
   for(let i=0;i<count;i++){const a=i*tau/count+t*3.6;sprite(c,image,m,m.clips[id].sourceFrames[3],Math.cos(a)*radius,Math.sin(a)*radius*.72,.45,a+.4,Math.sin(Math.PI*t));}
   sequence(c,image,m,id,t,0,0,1.1+t*.25,t>.7?(t-.7)*1.6:0);
   if(t>.68)sprite(c,image,m,'impact',0,18,1.15,0,Math.sin(clamp((t-.68)/.32)*Math.PI));
  }else if(id==='raijin_field'){
   sequence(c,image,m,id,t,0,61,1.7);
   if(t>.2&&t<.9){c.save();c.scale(.65+smooth(t)*.45,1);c.strokeStyle='#e6abff';c.lineWidth=quality===1?1.4:2;c.globalAlpha*=Math.sin(Math.PI*clamp((t-.2)/.7))*.8;c.stroke(chains);c.restore();}
  }else{
   if(layer!=='front')sprite(c,image,m,'gold_circle',0,64,1.6,-t*.35,.8);
   if(layer!=='ground'){
    if(t<.36)sequence(c,image,m,id,t*.8,0,67,1.5);
    else sprite(c,image,m,m.clips.raijin_field.sourceFrames[8],Math.sin(t*4)*14,63-smooth((t-.36)/.45)*24,1.05+smooth((t-.36)/.45)*.95,-.1+t*.14);
    if(t>.28&&t<.86)sprite(c,image,m,'vortex',0,35,1.25,t*.7,Math.sin(Math.PI*clamp((t-.28)/.58))*.55);
    if(t>.77)sprite(c,image,m,'impact',0,55,1.8,0,Math.sin(clamp((t-.77)/.23)*Math.PI));
   }
  }
  // Bounded decorative motes reuse source art; quality controls reduce draw count.
  if(layer!=='ground'&&t>.25)for(let i=0;i<(quality===1?3:7);i++){const a=i*2.399963+t*.8,r=(26+i*9)*Math.sin(t*Math.PI);sprite(c,image,m,'flash',Math.cos(a)*r,Math.sin(a)*r*.6-20*t,.035+(i%3)*.015,a,Math.sin(t*Math.PI)*.7);}
  c.restore();return true;
 }
 window.TsukiyomiSkillV6={version:6,paint};
})();
