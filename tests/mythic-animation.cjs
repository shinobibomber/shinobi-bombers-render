'use strict';
const fs=require('node:fs'),path=require('node:path'),{withGame}=require('./harness.cjs'),economy=require('../app/server/economy.cjs');
const out=path.join(__dirname,'out');
(async()=>{
 await withGame(async({p,f,assert,errors})=>{
  f.holdAdventure=false;
  const heroes=Array.from({length:10},(_,i)=>({tokenId:'animation-fixture-'+i,name:i<3?'Tsukiyomi':'Legend',rank:i<3?5:4,level:1,mythic:i<3?'tsukiyomi':undefined,nft:i<3?{mint:'fixture-'+i}:undefined,baseStats:{pw:16,sp:15,st:17}}));
  f.profile=economy.normalizeProfile({...f.profile,heroes,battleReady:heroes.map(h=>h.tokenId)});
  const downloaded=[];p.on('request',r=>{if(r.url().includes('/mythic-hero/animations/')&&!r.url().includes('/rig-v3/')&&!r.url().includes('/approved-v9/'))downloaded.push(r.url())});
  await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!LoginScreen.active);
  await p.evaluate(async()=>{await MythicHero.runtimeReady;await MythicHero.preload();go(1)});
  const details=await p.evaluate(()=>{
    const h=S.h.find(x=>x.r===5),m=MythicHero,manifest=m.animationSource,before=JSON.stringify({ryo:S.ryo,map:S.map,heroes:S.h,bombs});
    const gallery=document.createElement('canvas');gallery.id='mythic-animation-gallery';gallery.width=1040;gallery.height=Object.keys(manifest.states).length*112;
    gallery.style.cssText='position:fixed;inset:0;z-index:99999;background:#100c22';document.body.append(gallery);
    const c=gallery.getContext('2d');c.fillStyle='#100c22';c.fillRect(0,0,gallery.width,gallery.height);let row=0;
    for(const [state,clip]of Object.entries(manifest.states)){
      c.fillStyle='#e4d3ff';c.font='12px system-ui';c.fillText(state,8,row*112+25);c.fillStyle='#b0a5c1';c.font='10px system-ui';c.fillText(clip.frames+' frames / articulated views',8,row*112+44);
      for(let i=0;i<clip.frames;i++){const dir=state.startsWith('WALK_')?state.slice(5).toLowerCase():'front',img=m.renderFrame(h,state,i,dir);c.drawImage(img,228+i*66,row*112,66,83);c.fillText(String(i+1),248+i*66,row*112+100)}row++;
    }
    const after=JSON.stringify({ryo:S.ryo,map:S.map,heroes:S.h,bombs});
    const count=gallery.getContext('2d').getImageData(0,0,1040,gallery.height).data.filter((v,i)=>i%4===3&&v>0).length;
    return {unchanged:before===after,count,size:m.stats(),states:Object.keys(manifest.states).length,stars:manifest.hero.stars};
  });
  assert(details.unchanged);assert.equal(details.states,20);assert.equal(details.stars,undefined);assert(details.count>10000);assert.equal(downloaded.length,0,'borrowed Fire bodies are not requested');
  // Export the actual runtime-rendered atlas, including offscreen rows, without screenshot cropping.
  fs.writeFileSync(path.join(out,'mythic-animation-states.png'),Buffer.from(await p.locator('#mythic-animation-gallery').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const effects=await p.evaluate(()=>{
    document.querySelector('#mythic-animation-gallery').remove();const c=document.createElement('canvas');c.width=1100;c.height=520;c.id='mythic-skill-gallery';document.body.append(c);
    const ctx=c.getContext('2d');ctx.fillStyle='#100c22';ctx.fillRect(0,0,c.width,c.height);let row=0;const counts=[];
    for(const [name,s]of Object.entries(MythicHero.animationSource.skills)){
      ctx.fillStyle='#efdeff';ctx.font='14px system-ui';ctx.fillText(name+' — celestial VFX v3',12,row*130+18);
      const indices=[];for(let i=0;i<s.requiredFrames;i++){const img=MythicHero.skillFrame(name,i);indices.push(img.mythicEffect.step);ctx.drawImage(img,15+i*88,row*130+27,80,90)}counts.push(indices.length);row++;
    }return counts;
  });assert.deepEqual(effects,[8,8,10,12]);
  fs.writeFileSync(path.join(out,'mythic-animation-skills.png'),Buffer.from(await p.locator('#mythic-skill-gallery').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  await p.evaluate(()=>document.querySelector('#mythic-skill-gallery').remove());
  const safe=await p.evaluate(()=>{
    const m=MythicHero,h=S.h.find(x=>x.r===5),other=S.h.find(x=>x.r===4);let tile;
    for(let y=0;y<G.length&&!tile;y++)for(let x=0;x<G[y].length&&!tile;x++)if(G[y][x].k===0)tile={x,y};
    const before=JSON.stringify({ryo:S.ryo,map:S.map,heroes:S.h,bombs}),cfg=Arena3D.cfg;
    m.resetAnimations();cfg.fx=2;for(let i=0;i<1000;i++)m.spawnSkill('raijin_field',h,tile);const cap=m.stats().effects;
    m.resetAnimations();cfg.fx=1;for(let i=0;i<100;i++)m.spawnSkill('raijin_field',h,tile);const low=m.stats().effects;
    m.resetAnimations();cfg.fx=0;const off=m.spawnSkill('raijin_field',h,tile);cfg.fx=2;
    const invalid=m.spawnSkill('raijin_field',h,{x:-1,y:-1}),otherPlayed=m.play(other,'ATTACK');
    const ctx=document.createElement('canvas').getContext('2d'),geometry={proj:(x,y)=>[x,y],Sg:()=>1};
    m.spawnSkill('raijin_field',h,tile);m.drawGround(ctx,performance.now()+2000,geometry);const expired=m.stats().effects;
    m.spawnSkill('raijin_field',h,tile);const old=S.h;S.h=S.h.filter(x=>x!==h);m.drawGround(ctx,performance.now(),geometry);const removed=m.stats().effects;S.h=old;
    const after=JSON.stringify({ryo:S.ryo,map:S.map,heroes:S.h,bombs});m.resetAnimations();
    return {cap,low,off,invalid,otherPlayed,expired,removed,unchanged:before===after,stats:m.stats()};
  });assert.deepEqual([safe.cap,safe.low,safe.off,safe.invalid,safe.otherPlayed,safe.expired,safe.removed,safe.unchanged],[48,12,false,false,false,0,0,true]);assert(safe.stats.bodyTextures<=160);assert(safe.stats.effectTextures<=120);
  await p.evaluate(()=>{go(0);Experience.workAll()});
  await p.waitForFunction(()=>S.h.filter(h=>h.on&&h.x>=0).length===10,{},{timeout:15000});
  await p.waitForFunction(()=>bombs.some(b=>S.h.find(h=>h.id===b.o)?.r===5),{},{timeout:30000});
  await p.screenshot({path:path.join(out,'mythic-animation-adventure.png')});
  await p.evaluate(()=>{const h=S.h.find(x=>x.r===5);MythicHero.cosmeticEvent(h,'ULTIMATE_DRAGON_ASCENSION',{force:true})});
  await p.waitForTimeout(650);await p.screenshot({path:path.join(out,'mythic-animation-ultimate.png')});
  const cleanup=await p.evaluate(()=>{S.map++;newMap();const n=MythicHero.stats();go(1);return {effects:n.effects,after:MythicHero.stats()}});
  assert.equal(cleanup.effects,0);assert.equal(cleanup.after.effects,0);assert.equal(cleanup.after.actors,0);
  // Exercise the real authored-atlas import path with synthetic test pixels, not production art.
  const sharp=require('sharp'),runtime=structuredClone(require('../mythic-hero/assets/metadata/animations.json'));
  runtime.states.IDLE.texture='animations/test-idle.png';runtime.states.IDLE.columns=4;delete runtime.states.IDLE.sourceFrames;delete runtime.states.IDLE.sourceIndices;runtime.states.IDLE.assetStatus='test-fixture';
  delete runtime.states.IDLE.directionTextures;
  const atlas=await sharp({create:{width:512,height:128,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(Array.from({length:4},(_,i)=>({input:{create:{width:80,height:100,channels:4,background:{r:i===0?255:0,g:0,b:i===0?0:255,alpha:1}}},left:(i%4)*128+24,top:Math.floor(i/4)*128+24}))).png().toBuffer();
  await p.route('**/mythic-hero/metadata/animations.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(runtime)}));
  await p.route('**/mythic-hero/animations/test-idle.png',r=>r.fulfill({contentType:'image/png',body:atlas}));
  await p.reload();
  const imported=await p.evaluate(async()=>{await MythicHero.runtimeReady;await MythicHero.preload();return [0,3].map(i=>{const c=MythicHero.renderFrame({id:999,r:5},'IDLE',i,'front');return [...c.getContext('2d').getImageData(160,200,1,1).data]})});
  assert.deepEqual(imported,[[255,0,0,255],[0,0,255,255]],'authored atlas rows/columns override fallback at the fixed pivot');
  assert.deepEqual(errors,[]);
 });
 console.log('PASS: all 20 states rendered, 4 VFX timelines rendered, no borrowed-body download, capped pools/caches, effect-off and invalid-tile guards, 10 deployed heroes, native shots, map/menu cleanup, no combat/reward mutation.');
})().catch(e=>{console.error(e);process.exitCode=1});
