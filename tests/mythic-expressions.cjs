'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {withGame}=require('./harness.cjs'),economy=require('../app/server/economy.cjs');
const manifest=require('../mythic-hero/assets/metadata/animations.json'),{create}=require('../mythic-hero/animation-controller.js');
const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../mythic-hero/articulated-sprite.js'),'utf8'),sandbox);
const rig=sandbox.window.TsukiyomiRig,states=['IDLE','ATTACK','BOMB_PLACE','HURT','DEFEAT','VICTORY','EMOTE_ALERT','EMOTE_QUESTION','EMOTE_LIKE','EMOTE_CELEBRATE'];
// All reactions keep the same foot anchor; breathing/blinking are localized above it.
for(const direction of ['front','left','right','back'])for(const state of states)for(let i=0;i<manifest.states[state].frames;i++){
 const foot=rig.point(64,124,state,i,direction,manifest.states[state].frames);
 assert.deepEqual([...foot],[64,124],state+' planted pivot');
}
const open=rig.gesture('IDLE',6,8);open.blink=0;
assert(rig.point(64,56,'IDLE',6,'front',8)[1]<rig.point(64,56,'IDLE',6,'front',8,open)[1]-1,'blink closes the existing eye band');
assert(rig.point(64,40,'DEFEAT',7,'front',8)[1]>rig.point(64,40,'DEFEAT',0,'front',8)[1]+15,'defeat sinks into a kneel');
for(const state of states.filter(s=>s!=='IDLE')){
 const events=[],c=create(manifest,e=>events.push(e)),h={id:7},clip=manifest.states[state];
 c.play(h,state,{now:0});const frames=[];
 for(let i=0;i<clip.frames;i++)frames.push(c.sample(h,i*clip.durationMs/clip.frames+.1,{reducedMotion:true}).frame);
 assert.equal(new Set(frames).size,1,state+' respects reduced motion');assert.equal(frames[0],clip.reducedFrame);
 c.sample(h,clip.durationMs+1,{reducedMotion:true});c.sample(h,clip.durationMs+2,{reducedMotion:true});
 for(const name of [...Object.keys(clip.events),'complete'])assert.equal(events.filter(e=>e.name===name).length,1,state+' callback '+name+' stays once');
}
(async()=>{
 await withGame(async({p,f,errors})=>{
  f.profile=economy.normalizeProfile({...f.profile,heroes:[{tokenId:'expression-mythic',name:'Tsukiyomi',rank:5,level:1,mythic:'tsukiyomi',baseStats:{pw:16,sp:15,st:17}}]});
  await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!LoginScreen.active);
  await p.evaluate(async()=>{await MythicHero.runtimeReady;await MythicHero.preload();go(1)});
  const result=await p.evaluate(({states})=>{
   const m=MythicHero,h=S.h.find(h=>h.r===5),before=JSON.stringify({heroes:S.h,bombs,ryo:S.ryo,map:S.map});
   const gallery=document.createElement('canvas');gallery.width=1230;gallery.height=states.length*150;
   const c=gallery.getContext('2d');c.fillStyle='#100c22';c.fillRect(0,0,gallery.width,gallery.height);
   const unique={},directions={},iconPixels={},icons=[];
   for(const [row,state]of states.entries()){
    const clip=m.animationSource.states[state],images=[];
    c.fillStyle='#edddff';c.font='15px system-ui';c.fillText(state,10,row*150+25);
    for(let i=0;i<clip.frames;i++){const img=m.renderFrame(h,state,i,'front');images.push(img.toDataURL());c.drawImage(img,175+i*110,row*150+4,104,130)}
    unique[state]=new Set(images).size;
    directions[state]=new Set(['front','left','right','back'].map(d=>m.renderFrame(h,state,Math.floor(clip.frames/2),d).toDataURL())).size;
    if(state.startsWith('EMOTE_')){const img=m.renderFrame(h,state,1,'front'),pixels=img.getContext('2d').getImageData(240,35,46,60).data;iconPixels[state]=pixels.filter((v,i)=>i%4===3&&v>200).length;icons.push(Array.from(pixels).join(','));}
   }
   // Actual returned frames remain stable after warming, including icons and reactions.
   for(const state of states)for(let i=0;i<m.animationSource.states[state].frames;i++)m.renderFrame(h,state,i,'front');
   const original=document.createElement;let canvases=0;document.createElement=function(tag,...args){if(tag==='canvas')canvases++;return original.call(this,tag,...args)};
   let calls=0;const start=performance.now();for(let n=0;n<20;n++)for(const state of states)for(let i=0;i<m.animationSource.states[state].frames;i++){m.renderFrame(h,state,i,'front');calls++;}
   const warmMs=performance.now()-start;document.createElement=original;
   // Sample hurt under OS reduced motion later in Playwright; keep this read-only.
   return {gallery:gallery.toDataURL(),unique,directions,iconPixels,distinctIcons:new Set(icons).size,canvases,calls,warmMs,unchanged:before===JSON.stringify({heroes:S.h,bombs,ryo:S.ryo,map:S.map}),stats:m.stats()};
  },{states});
  fs.writeFileSync(path.join(__dirname,'out/mythic-v4-expressions.png'),Buffer.from(result.gallery.split(',')[1],'base64'));delete result.gallery;
  for(const state of states){assert.equal(result.unique[state],manifest.states[state].frames,state+' distinct rendered frames');assert.equal(result.directions[state],4,state+' own four source views');}
  assert(Object.values(result.iconPixels).every(n=>n>300),'four legible vector expressions');assert.equal(result.distinctIcons,4);assert.equal(result.canvases,0);assert(result.warmMs<1000);assert.equal(result.unchanged,true);assert(result.stats.bodyTextures<=160);
  await p.emulateMedia({reducedMotion:'reduce'});
  const reduced=await p.evaluate(()=>{const h=S.h.find(h=>h.r===5),t=performance.now();MythicHero.resetAnimations();MythicHero.play(h,'HURT',{now:t});return [20,200,350].map(dt=>CharacterAnimations.poseFor(h,t+dt,{}))});
  assert.equal(new Set(reduced).size,1,'actual browser adapter keeps the reduced-motion reaction still');
  assert.deepEqual(errors,[]);console.log(JSON.stringify(result));
 });
 console.log('PASS: four-view gestures, localized blink, fixed soles, 10 distinct action timelines, vector emotes, reduced-motion event timing, no warm allocations and unchanged gameplay.');
})().catch(e=>{console.error(e);process.exitCode=1});
