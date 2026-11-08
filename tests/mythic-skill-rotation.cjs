'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{withGame}=require('./harness.cjs'),economy=require('../app/server/economy.cjs');
const order=[null,'dragon_slash',null,'void_shuriken',null,'raijin_field',null,'mythic_dragon_ascension'];
const descriptor=id=>({tokenId:id,name:'Tsukiyomi',rank:5,level:1,mythic:'tsukiyomi',baseStats:{pw:18,sp:20,st:20}});
(async()=>{
 await withGame(async({p,f,errors})=>{
  f.holdAdventure=false;const heroes=[descriptor('auto-a'),descriptor('auto-b'),descriptor('auto-c')];f.profile=economy.normalizeProfile({...f.profile,heroes,battleReady:heroes.map(h=>h.tokenId)});
  await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!LoginScreen.active);
  const result=await p.evaluate(async()=>{
   await MythicHero.runtimeReady;await MythicHero.preload();Experience.restAll();S.butler=false;tick=()=>{};
   const m=MythicHero,h=S.h.find(h=>h.tokenId==='auto-a'),other=S.h.find(h=>h.tokenId==='auto-b');
   for(const hero of [h,other]){hero.on=true;hero.x=4;hero.y=4;hero.en=60;hero.cd=0;}
   CombatClient.reconcile({combatVersion:1,deployed:[h.tokenId,other.tokenId]});
   for(const row of G)for(const c of row){c.k=0;c.hp=c.maxHp=0}G[4][5]={k:2,hp:100000,maxHp:100000};bombs.length=0;
   const c=document.createElement('canvas');c.width=800;c.height=600;const q=c.getContext('2d');let damage=0;const chosen=[],energy=[],draws=[];
   for(let n=0;n<16;n++){
    m.resetAnimations();h.cd=0;const en=h.en;think(h);const b=bombs.at(-1);if(!b)throw Error('Missing native attack');
    const state=m.controller.get(h)?.state;chosen.push(Object.entries(MythicAutomaticSkills.definitions).find(([,d])=>d.state===state)?.[0]||null);
    const before=JSON.stringify(m.automaticSkills.inspect(RyoPayments.state.account,h.tokenId));
    for(let copy=0;copy<10;copy++)CharacterAnimations.drawProjectile(q,b,performance.now(),{x:300,y:200,scale:1,angle:0});
    draws.push(before===JSON.stringify(m.automaticSkills.inspect(RyoPayments.state.account,h.tokenId)));
    m.resetAnimations();const seen=[],blit=q.drawImage;q.drawImage=function(img,...a){if(img?.mythicEffect)seen.push(img.mythicEffect.skill);return blit.call(this,img,...a)};
    try{CharacterAnimations.drawProjectile(q,b,performance.now(),{x:300,y:200,scale:1,angle:0})}finally{q.drawImage=blit}
    if(['dragon_slash','void_shuriken'].includes(chosen.at(-1))&&(!seen.length||seen.some(id=>id!==chosen.at(-1))))throw Error('Visual cleanup changed an in-flight action choice');
    const hp=G[4][5].hp;boom(b);boom(b);damage+=hp-G[4][5].hp;energy.push(en-h.en);
   }
   m.resetAnimations();other.cd=0;think(other);const otherState=m.controller.get(other)?.state;bombs.length=0;
   const prior=m.automaticSkills.inspect(RyoPayments.state.account,h.tokenId).total;
   h.en=0;h.cd=0;think(h);const zero=bombs.length===0&&m.automaticSkills.inspect(RyoPayments.state.account,h.tokenId).total===prior;
   h.en=5;h.cd=0;G[4][5]={k:1,hp:0,maxHp:0};think(h);const wall=bombs.length===0;
   const before=JSON.stringify({heroes:S.h,grid:G,ryo:S.ryo,bombs});
   for(const id of Object.keys(MythicAutomaticSkills.definitions)){m.skillFrame(id,4);m.cosmeticEvent(h,MythicAutomaticSkills.definitions[id].state,{force:true})}
   const cosmetic=before===JSON.stringify({heroes:S.h,grid:G,ryo:S.ryo,bombs});
   return {chosen,energy,damage,power:h.pw,draws,otherState,zero,wall,cosmetic,version:m.skillRotationVersion};
  });
  assert.equal(result.version,3);assert.deepEqual(result.chosen,order.concat(Array(8).fill(null)));assert(result.energy.every(n=>n===1));assert.equal(result.damage,result.power*16);assert(result.draws.every(Boolean));assert.equal(result.otherState,'ATTACK');assert(result.zero&&result.wall&&result.cosmetic);assert.deepEqual(errors,[]);
  const limits=await p.evaluate(()=>{
   const m=MythicHero,heroes=S.h.filter(h=>h.r===5),time=performance.now(),c=document.createElement('canvas');c.width=800;c.height=600;const q=c.getContext('2d'),paint=m.paintSkill,quality=Arena3D.cfg.fx,rows=[];
   m.resetAnimations();for(const h of heroes){h.on=true;h.x=h.y=4;m.play(h,'ULTIMATE_DRAGON_ASCENSION',{force:true,now:time})}
   try{for(const fx of [2,1,0]){Arena3D.cfg.fx=fx;const layers=[];m.paintSkill=function(c,name,p,layer,...a){layers.push(layer);return paint(c,name,p,layer,...a)};m.drawGround(q,time+500,{proj:()=>[400,300],Sg:()=>1});for(const h of heroes)CharacterAnimations.drawActorEffects(q,h,time+500,{x:400,y:300,scale:1,flip:false});rows.push(layers)}}finally{m.paintSkill=paint;Arena3D.cfg.fx=quality;m.resetAnimations()}return rows;
  });
  assert.deepEqual(limits,[['ground','ground','front','front'],['ground','front'],[]],'cinematic caps: 2 standard, 1 low, 0 off across three Mythics');
  await p.evaluate(()=>{go(1)});await p.locator('.sbw-scr.on .sbw-hcard').first().click();
  await p.locator('.sbw-scr.on [data-k="mability5"]').click();await p.waitForTimeout(400);
  assert.match(await p.locator('.sbw-myth-preview').innerText(),/Mythic Dragon Ascension/);await p.screenshot({path:path.join(__dirname,'out/mythic-auto-ability-desktop.png')});
  await p.setViewportSize({width:390,height:844});await p.screenshot({path:path.join(__dirname,'out/mythic-auto-ability-phone.png')});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.locator('.sbw-myth-preview .sbw-btn').click();
  fs.writeFileSync(path.join(__dirname,'out/mythic-auto-native-results.json'),JSON.stringify(result,null,2));
  console.log('PASS: 16 native authorized-team Adventure attacks, preferred automatic rotation, one Power damage/one chakra, no redraw advancement, duplicate impact protection, zero-chakra/wall guards, independent heroes and cosmetic previews.');
 });
 await withGame(async({p,f,errors})=>{
  f.holdAdventure=false;const hero=descriptor('auto-hunt');f.profile=economy.normalizeProfile({...f.profile,heroes:[hero],battleReady:[hero.tokenId]});f.hunt={others:[]};
  await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!LoginScreen.active&&window.WebsiteDesign?.ready);
  await p.evaluate(async()=>{await MythicHero.runtimeReady;await MythicHero.preload();go(8);window.autoHunt=[];const old=MythicHero.attackSkill;MythicHero.attackSkill=function(h,n,run,context){const skill=old(h,n,run,context);const row=autoHunt.find(r=>r.n===n&&r.id===h.id);if(row)row.copies.push(skill);else autoHunt.push({n,id:h.id,skill,copies:[skill]});return skill}});
  await p.locator('.sbw-scr.on .bh-go').click();await p.locator('.sbw-hunt[open] [data-k="go"]').click();await p.waitForFunction(()=>V2.isBossActive());
  await p.waitForFunction(()=>autoHunt.length>=8,null,{timeout:20000});
  const result=await p.evaluate(()=>{
   const h=S.h.find(h=>h.r===5),fake={id:'non-hunt-actor',r:5,en:10};MythicHero.play(fake,'ATTACK',{direction:'left'});
   const outside=MythicHero.heroFrame(fake,'mythic:WALK_FRONT:3:front',false,'front').mythicAnimation;
   return{rows:autoHunt.slice(0,8),shots:V2.bossState().projectiles.map(s=>({damage:s.damage,cosmetic:s.cosmetic})),hero:h?.tokenId,direction:MythicHero.controller.get(h)?.direction,outside};
  });
  assert.deepEqual(result.rows.map(r=>r.skill),order);for(const r of result.rows)assert(r.copies.every(s=>s===r.skill),'decorative copies share action choice');assert(result.shots.filter(s=>s.cosmetic).every(s=>s.damage===0));
  assert.equal(result.direction,'right','Hunt hero faces the guardian');assert.equal(result.outside.state,'WALK_FRONT','Hunt does not override another actor movement');assert.equal(result.outside.frame,3);
  await p.waitForFunction(()=>V2.bossState()?.hits.some(hit=>hit.mythicSkill==='mythic_dragon_ascension'&&hit.life>.12&&hit.life<.24),null,{timeout:10000});
  await p.screenshot({path:path.join(__dirname,'out/mythic-auto-hunt.png')});await p.evaluate(()=>V2.retreat());
  await p.evaluate(()=>{go(0);Experience.workAll()});await p.waitForFunction(()=>S.h.some(h=>h.r===5&&h.on&&h.x>=0));await p.waitForTimeout(500);await p.screenshot({path:path.join(__dirname,'out/mythic-auto-adventure.png')});assert.deepEqual(errors,[]);
  console.log('PASS: actual paid-fixture Boss Hunt contract drives basic/three signature/ultimate rotation across 8 attacks; decorative shots retain zero damage. Adventure loads after retreat.');
 });
})().catch(e=>{console.error(e);process.exitCode=1});
