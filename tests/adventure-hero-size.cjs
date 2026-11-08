'use strict';
const fs=require('node:fs'),path=require('node:path'),{withGame}=require('./harness.cjs'),economy=require('../app/server/economy.cjs');
const out=path.join(__dirname,'out');
(async()=>{await withGame(async({p,f,errors,assert})=>{
 f.holdAdventure=false;
 const heroes=Array.from({length:10},(_,i)=>({tokenId:'size-'+i,name:i>=8?'Tsukiyomi':'Size '+i,rank:i>=8?5:i%5,look:i%8,level:1,...(i>=8?{mythic:'tsukiyomi'}:{}),baseStats:{pw:18,sp:18,st:18}}));
 f.profile=economy.normalizeProfile({...f.profile,heroes,battleReady:heroes.map(h=>h.tokenId)});
 await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!RyoPayments.state.busy&&!LoginScreen.active&&window.WebsiteDesign?.ready);
 await p.evaluate(async()=>{await MythicHero.runtimeReady;await MythicHero.preload()});
 const result=await p.evaluate(()=>{
  const ca=CharacterAnimations,snapshot=()=>JSON.stringify({heroes:S.h,grid:G,map:S.map,bombs,balance:RyoPayments.state.balance});
  const before=snapshot(),rows=[],sheet=document.createElement('canvas');sheet.width=1080;sheet.height=540;
  const q=sheet.getContext('2d');q.fillStyle='#17132c';q.fillRect(0,0,1080,540);
  const surface=document.createElement('canvas');surface.width=160;surface.height=160;const c=surface.getContext('2d',{willReadFrequently:true});
  function bounds(){const data=c.getImageData(0,0,160,160).data;let top=160,bottom=-1;for(let y=0;y<160;y++)for(let x=0;x<160;x++)if(data[(y*160+x)*4+3]>40){top=Math.min(top,y);bottom=Math.max(bottom,y)}return{top,bottom,height:bottom-top+1}}
  const warm=[];
  for(let model=0;model<8;model++){
   const h={id:100+model,look:model,r:model%5},portrait=PlayerModels.heroFrame(h,'i0').toDataURL();
   for(const [row,direction]of ['front','side','back'].entries()){
    const img=ca.heroFrame(h,'i0',false,direction),source=img.adventureSprite;
    c.clearRect(0,0,160,160);ca.drawAdventureHero(c,img,80,120,2,direction==='side',0);
    rows.push({model,direction,...bounds(),referenceHeight:source.referenceHeight});
    ca.drawAdventureHero(q,img,55+model*120,110+row*140,2,direction==='side',0);
    q.fillStyle='#fff';q.font='12px system-ui';q.fillText(model+' '+direction,12+model*120,130+row*140);warm.push(img);
   }
   if(portrait!==PlayerModels.heroFrame(h,'i0').toDataURL())throw Error('Adventure changed a menu portrait');
   // One reference for the whole walk cycle prevents pose-by-pose size pulsing.
   for(const direction of ['front','side','back']){
    const clips=['w0','w1','w2','w3','a0','a1','s0'].map(pose=>ca.heroFrame(h,pose,false,direction)),refs=clips.slice(0,4).map(img=>img.adventureSprite.referenceHeight);
    if(!refs.every(n=>n===refs[0]))throw Error('Movement changes body scale');warm.push(...clips);
   }
  }
  const body=MythicHero.renderFrame({id:200,r:5},'IDLE',0,'front'),oldAura=localStorage.getItem('sb-mythic-aura');localStorage.setItem('sb-mythic-aura','off');
  c.clearRect(0,0,160,160);ca.drawAdventureHero(c,body,80,120,2,false,0);const reference=bounds();
  ca.drawAdventureHero(q,body,1015,110,2,false,0);if(oldAura===null)localStorage.removeItem('sb-mythic-aura');else localStorage.setItem('sb-mythic-aura',oldAura);q.fillText('Mythic reference',960,130);
  // Capture the native-cell transform and unchanged foot origin, including flip.
  const sample=warm[0],src=sample.adventureSprite,calls=[];
  ca.drawAdventureHero({save(){},restore(){},translate(...a){calls.push(['translate',...a])},scale(...a){calls.push(['scale',...a])},drawImage(texture,...a){calls.push(['draw',texture===src.texture,...a])}},sample,80.3,120.4,2,true,0);
  const originalCreate=document.createElement,originalRead=CanvasRenderingContext2D.prototype.getImageData;let allocations=0,reads=0;
  document.createElement=function(tag,...args){if(tag==='canvas')allocations++;return originalCreate.call(this,tag,...args)};
  CanvasRenderingContext2D.prototype.getImageData=function(...args){reads++;return originalRead.apply(this,args)};
  try{for(let n=0;n<2000;n++)ca.drawAdventureHero(c,warm[n%warm.length],80,120,2,n%2,0)}finally{document.createElement=originalCreate;CanvasRenderingContext2D.prototype.getImageData=originalRead}
  const layered=ShinobiSprites.heroFrame({id:101,look:1,r:4},'i0'),order=[],originalBlit=ShinobiSprites.blit,originalDraw=c.drawImage;
  ShinobiSprites.blit=(_,canvas)=>order.push(canvas.tierAura.layer);c.drawImage=function(...args){order.push('body');return originalDraw.apply(this,args)};
  try{ca.drawAdventureHero(c,layered,80,120,2,false,0)}finally{ShinobiSprites.blit=originalBlit;c.drawImage=originalDraw}
  return{rows,reference,calls,allocations,reads,order,unchanged:snapshot()===before,sheet:sheet.toDataURL()};
 });
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'adventure-hero-size-sheet.png'),Buffer.from(result.sheet.split(',')[1],'base64'));delete result.sheet;
 for(const row of result.rows)assert(Math.abs(row.height-result.reference.height)<=2,'model '+row.model+' '+row.direction+' matches Mythic body height: '+row.height+'/'+result.reference.height);
 assert.equal(result.rows.length,24);assert.deepEqual(result.calls[0],['translate',80,120]);assert.deepEqual(result.calls[1],['scale',-1,1]);assert.equal(result.calls[2][1],true,'native crop draws directly to map');
 assert.equal(result.allocations,0);assert.equal(result.reads,0,'warm map drawing never reads pixels');assert.deepEqual(result.order,['back','body','front']);assert.equal(result.unchanged,true,'rendering cannot modify combat, chakra, map, ownership or Ryo');
 await p.locator('.sbw-hdr [data-sbwid="nav-adventure"]').click();await p.locator('.sbw-scr.on [data-a="work"]').click();await p.waitForFunction(()=>S.h.filter(h=>h.on).length===10);await p.waitForTimeout(700);
 const draws=await p.evaluate(()=>{let calls=0;const original=CharacterAnimations.drawAdventureHero;CharacterAnimations.drawAdventureHero=function(...args){calls++;return original.apply(this,args)};try{draw(performance.now())}finally{CharacterAnimations.drawAdventureHero=original}return{calls,broken:Arena3D.broken}});
 assert.equal(draws.calls,10,'all deployed actors use optimized drawing');assert.equal(draws.broken,false);
 await p.screenshot({path:path.join(out,'adventure-hero-size-desktop.png')});await p.setViewportSize({width:844,height:390});await p.waitForTimeout(400);await p.screenshot({path:path.join(out,'adventure-hero-size-phone.png')});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'adventure-hero-size-results.json'),JSON.stringify({...result,draws},null,2));
 console.log('PASS: eight models match Mythic size, stable cycle scales, native crop drawing, feet/flip alignment, aura layers, unchanged portraits/combat, zero warm allocations/readbacks, ten-hero desktop and phone renders.');
})})().catch(error=>{console.error(error);process.exitCode=1});
