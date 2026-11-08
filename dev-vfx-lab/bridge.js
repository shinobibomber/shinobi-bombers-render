/* Runs inside the existing game page, never authenticates or mutates game state. */
(() => {
 'use strict';
 const hero={id:'vfx-lab-only',r:5,mythic:'tsukiyomi'},floor=document.createElement('canvas');
 const ready=Promise.all([MythicHero.runtimeReady,MapDesign.ready]).then(async()=>{await MythicHero.preload();await MapDesign.load(1);MapDesign.drawFloor(floor,{W,T,map:1});return true});
 function body(c,x,y,scale,time,visible,aura,direction){
  if(!visible&&!aura)return;
  // Reuse the original aura layers without changing persistent visibility settings.
  const old=Object.getOwnPropertyDescriptor(MythicHero,'auraEnabled');
  Object.defineProperty(MythicHero,'auraEnabled',{configurable:true,get:()=>aura});
  try{
   if(aura)TierAuras.draw(c,hero,x,y,scale,time);
   if(visible){const img=MythicHero.renderFrame(hero,'ATTACK',Math.min(5,Math.floor(time/90)%6),direction);c.drawImage(img,x-20*scale,y-44*scale,40*scale,50*scale);}
   if(aura)TierAuras.drawFront(c,hero,x,y,scale,time);
  }finally{Object.defineProperty(MythicHero,'auraEnabled',old)}
 }
 function paint(c,id,progress,options={}){
  const w=c.canvas.width,h=c.canvas.height,time=progress*2000,x=w*.46,y=h*.69,scale=h/190;
  c.clearRect(0,0,w,h);
  if(options.background!=='transparent'){c.fillStyle='#100a20';c.fillRect(0,0,w,h);}
  if(options.background==='map'){
   c.drawImage(floor,0,0,floor.width,floor.height,0,h*.2,w,h*.8);c.fillStyle='#07031244';c.fillRect(0,h*.2,w,h*.8);
   // Preview props only: static crates, original obstacle scenery, native enemies.
   for(let i=0;i<3;i++){const cx=w*(.62+i*.085),cy=h*(.66+(i%2)*.1),s=h*.065;c.fillStyle='#51321e';c.fillRect(cx-s/2,cy-s,s,s);c.strokeStyle='#c89452';c.lineWidth=3;c.strokeRect(cx-s/2,cy-s,s,s);c.beginPath();c.moveTo(cx-s/2,cy-s);c.lineTo(cx+s/2,cy);c.moveTo(cx+s/2,cy-s);c.lineTo(cx-s/2,cy);c.stroke();ShinobiSprites.blit(c,ShinobiSprites.enemyFrame(i,'i0',false),cx+35,cy+60,scale*.7,false);}
  }
  const angle=({right:0,left:Math.PI,front:Math.PI/2,back:-Math.PI/2})[options.direction||'right'];
  function effect(layer){c.save();c.translate(x+(['void_shuriken','raijin_field'].includes(id)?w*.18:id==='dragon_slash'?w*.10:0),y-h*.12);if(id==='dragon_slash')c.rotate(angle);const size=h*(id==='mythic_dragon_ascension'?.82:.60);c.scale(size/320,size/320);c.translate(-160,-160);c.globalCompositeOperation='source-over';MythicHero.paintSkill(c,id,progress,layer,options.quality||2);c.restore();}
  effect('ground');body(c,x,y,scale,time,options.character!==false,options.aura!==false,options.direction||'right');effect('front');
  if(options.titles!==false){c.fillStyle='#ede4ff';c.font='600 '+Math.round(h*.025)+'px system-ui';c.fillText('TSUKIYOMI / MYTHIC',w*.055,h*.085);c.fillStyle='#fff';c.font='700 '+Math.round(h*.048)+'px system-ui';c.fillText((MythicHero.animationSource.skills[id].vfxName||MythicHero.animationSource.skillSet.clips[id].name),w*.055,h*.145);c.fillStyle='#c3addb';c.font=Math.round(h*.020)+'px system-ui';c.fillText('CELESTIAL TECHNIQUES  /  SHINOBI BOMBERS',w*.055,h*.94);}
 }
 window.MythicVfxLabBridge={ready,paint,get manifest(){return MythicHero.animationSource.skillSet},snapshot:()=>JSON.stringify({heroes:S.h,bombs,map:S.map,ryo:S.ryo})};
})();
