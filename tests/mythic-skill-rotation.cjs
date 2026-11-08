'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{withGame}=require('./harness.cjs');
const economy=require('../app/server/economy.cjs');
const order=['dragon_slash','void_shuriken','raijin_field','mythic_dragon_ascension'];
(async()=>{await withGame(async({p,f,errors})=>{
 f.holdAdventure=false;await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!LoginScreen.active);
 const result=await p.evaluate(async()=>{
  await MythicHero.runtimeReady;await MythicHero.preload();Experience.restAll();S.butler=false;
  const can=CombatClient.canAttack;CombatClient.canAttack=()=>true;
  const m=MythicHero,ca=CharacterAnimations,states=['SKILL_DRAGON_SLASH','SKILL_VOID_SHURIKEN','SKILL_RAIJIN_FIELD','ULTIMATE_DRAGON_ASCENSION'];
  const h=mk(5,true),other=mk(5,true);for(const hero of [h,other]){hero.x=4;hero.y=4;hero.en=30;hero.cd=0;hero.on=true;}S.h=[h,other];
  const c=document.createElement('canvas');c.width=1280;c.height=720;const ctx=c.getContext('2d'),gallery=document.createElement('canvas');gallery.width=1280;gallery.height=720;const q=gallery.getContext('2d');q.fillStyle='#100a20';q.fillRect(0,0,1280,720);
  function board(){bombs.length=0;for(const row of G)for(const cell of row){cell.k=0;cell.hp=cell.maxHp=0}G[4][6]={k:2,hp:100000,maxHp:100000};}
  board();let damage=0;const names=[],impacts=[],copies=[],isolated=[];
  for(let n=0;n<12;n++){
   h.cd=0;const energy=h.en;think(h);const b=bombs.at(-1);if(!b)throw Error('No actual attack');
   names.push(states.indexOf(m.controller.get(h).state));const draws=[],original=ctx.drawImage;
   ctx.drawImage=function(image,...a){if(image?.mythicEffect)draws.push(image.mythicEffect.skill);return original.call(this,image,...a)};
   // The real CombatClient wrapper makes seven visual copies; redraws must not advance selection.
   for(let repeat=0;repeat<3;repeat++)ca.drawProjectile(ctx,b,performance.now()+repeat,{x:400,y:300,scale:1,angle:0});ctx.drawImage=original;copies.push(draws);
   const before=G[4][6].hp;boom(b);boom(b);damage+=before-G[4][6].hp;
   const seen=[],paint=m.paintSkill;m.paintSkill=function(ctx,name,...a){seen.push(name);return paint(ctx,name,...a)};
   try{m.drawGround(ctx,performance.now()+150,{proj:()=>[400,300],Sg:()=>1});ca.drawImpacts(ctx,performance.now()+150,{proj:()=>[400,300],Sg:()=>1});}finally{m.paintSkill=paint}
   impacts.push(seen);isolated.push(energy-h.en);
   if(n<4){const id=['dragon_slash','void_shuriken','raijin_field','mythic_dragon_ascension'][n];q.fillStyle='#eee1ff';q.font='18px system-ui';q.fillText((n+1)+'. '+m.animationSource.skills[id].name,n%2*640+24,Math.floor(n/2)*360+27);q.drawImage(m.skillFrame(id,Math.floor(m.animationSource.skills[id].requiredFrames*.6)),n%2*640+160,Math.floor(n/2)*360+30);}
   // Clear visuals only; an actual actor's next choice survives menu/map cleanup.
   m.resetAnimations();
   ca.drawProjectile(ctx,b,performance.now(),{x:400,y:300,scale:1,angle:0});
  }
  other.cd=0;think(other);const otherState=states.indexOf(m.controller.get(other).state);bombs.length=0;
  h.en=0;h.cd=0;think(h);const zero=bombs.length===0;
  h.en=1;h.cd=0;think(h);const afterZero=states.indexOf(m.controller.get(h).state);bombs.length=0;
  // Hunt's seven decorative projectiles receive the native action's single choice.
  const hunt=[],huntImpacts=[],huntCopies=[];
  for(let attack=1;attack<=8;attack++){
   const skill=m.attackSkill(h,attack,'rotation-hunt'),group=[];for(let i=0;i<7;i++)group.push(m.attackSkill(h,attack,'rotation-hunt'));hunt.push(skill);huntCopies.push(group);
   const seen=[],paint=m.paintSkill;m.paintSkill=(ctx,name,...a)=>{seen.push(name);return paint(ctx,name,...a)};
   try{ca.drawHuntImpact(ctx,{mythicSkill:skill,life:.6,rank:5,ultimate:attack===8},{x:400,y:300},h.id)}finally{m.paintSkill=paint}
   // Cached skillFrame path exposes identity through its canvas metadata instead.
   let used;const draw=ctx.drawImage;ctx.drawImage=function(image,...a){used=image?.mythicEffect?.skill;return draw.call(this,image,...a)};
   try{ca.drawHuntImpact(ctx,{mythicSkill:skill,life:.6,rank:5,ultimate:attack===8},{x:400,y:300},h.id)}finally{ctx.drawImage=draw}
   huntImpacts.push(used);
  }
  const before=JSON.stringify({h:S.h,bombs,grid:G,ryo:S.ryo});for(let i=0;i<100;i++)m.attackSkill(h,8,'rotation-hunt');const unchanged=before===JSON.stringify({h:S.h,bombs,grid:G,ryo:S.ryo});
  const afterRun=m.attackSkill(h,1,'rotation-hunt-2');const otherHunt=m.attackSkill(other,1,'independent');
  CombatClient.canAttack=can;return{version:m.skillRotationVersion,names,damage,power:h.pw,energy:isolated,copies,impacts,otherState,zero,afterZero,hunt,huntCopies,huntImpacts,afterRun,otherHunt,unchanged,gallery:gallery.toDataURL()};
 });
 assert.equal(result.version,1);assert.deepEqual(result.names,Array.from({length:12},(_,i)=>i%4));assert.equal(result.damage,result.power*12);assert(result.energy.every(n=>n===1));assert.equal(result.otherState,0);assert(result.zero);assert.equal(result.afterZero,0);
 for(let i=0;i<12;i++){if(i%4<2){assert(result.copies[i].length>0);assert(result.copies[i].every(s=>s===order[i%4]));}else assert.equal(result.copies[i].length,0,'ground/ultimate attacks do not add another traveling skill');if(i%4===0)assert(!result.impacts[i].includes('raijin_field'),'slash does not add lightning');if(i%4===1)assert(result.impacts[i].every(s=>s==='void_shuriken'),'shuriken does not add lightning');}
 assert.deepEqual(result.hunt,Array.from({length:8},(_,i)=>order[i%4]));for(let i=0;i<8;i++)assert(result.huntCopies[i].every(s=>s===result.hunt[i]));assert.deepEqual(result.huntImpacts,result.hunt);assert.equal(result.otherHunt,order[0]);assert.equal(result.afterRun,order[0]);assert(result.unchanged);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(__dirname,'out/mythic-rotation-skills.png'),Buffer.from(result.gallery.split(',')[1],'base64'));delete result.gallery;fs.writeFileSync(path.join(__dirname,'out/mythic-rotation-results.json'),JSON.stringify(result,null,2));
 console.log('PASS: 12 actual attacks cycle four skills; redraws/7 decorative copies do not advance, independent heroes and Hunt actions, no repeated lightning, exact Power damage and 1 chakra, zero-chakra stop and unchanged cosmetic state.');
});
 await withGame(async({p,f,errors})=>{
  f.holdAdventure=false;const hero={tokenId:'rotation-real-hunt',name:'Tsukiyomi',rank:5,level:1,mythic:'tsukiyomi',baseStats:{pw:18,sp:20,st:20}};f.profile=economy.normalizeProfile({...f.profile,heroes:[hero],battleReady:[hero.tokenId]});f.hunt={others:[]};
  await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!LoginScreen.active&&window.WebsiteDesign?.ready);
  await p.evaluate(async()=>{await MythicHero.runtimeReady;await MythicHero.preload();go(8);window.rotationHuntAttacks=[];const old=MythicHero.attackSkill;MythicHero.attackSkill=function(h,n,run){const skill=old(h,n,run);if(!rotationHuntAttacks.some(r=>r.n===n&&r.id===h.id))rotationHuntAttacks.push({n,id:h.id,skill});return skill}});
  await p.locator('.sbw-scr.on .bh-go').click();await p.locator('.sbw-hunt[open] [data-k="go"]').click();await p.waitForFunction(()=>V2.isBossActive());
  await p.waitForFunction(()=>rotationHuntAttacks.length>=8,null,{timeout:20000});
  const rows=await p.evaluate(()=>({skills:rotationHuntAttacks.slice(0,8).map(r=>r.skill),shots:V2.bossState().projectiles.filter(p=>p.rank===5).map(p=>({skill:p.mythicSkill,cosmetic:p.cosmetic,damage:p.damage})),hits:V2.bossState().hits.map(h=>h.mythicSkill)}));
  assert.deepEqual(rows.skills,Array.from({length:8},(_,i)=>order[i%4]));assert(rows.shots.every(s=>order.includes(s.skill)));assert(rows.shots.filter(s=>s.cosmetic).every(s=>s.damage===0));assert(rows.hits.every(s=>order.includes(s)));assert.deepEqual(errors,[]);
  await p.waitForFunction(()=>V2.bossState()?.hits.some(h=>h.mythicSkill==='mythic_dragon_ascension'&&h.life<.65&&h.life>.2),null,{timeout:10000});
  await p.screenshot({path:path.join(__dirname,'out/mythic-rotation-hunt.png')});await p.evaluate(()=>V2.retreat());
  await p.evaluate(()=>{go(0);Experience.workAll()});await p.waitForFunction(()=>S.h.some(h=>h.r===5&&h.on&&h.x>=0));
  await p.waitForFunction(()=>S.h.some(h=>h.r===5&&['SKILL_DRAGON_SLASH','SKILL_VOID_SHURIKEN','SKILL_RAIJIN_FIELD','ULTIMATE_DRAGON_ASCENSION'].includes(MythicHero.controller.get(h)?.state)),null,{timeout:15000});
  await p.screenshot({path:path.join(__dirname,'out/mythic-rotation-adventure.png')});
  console.log('PASS: actual paid Hunt cycles four skills across eight attacks; native decorative projectiles and hit records retain the choice.');
 });
})().catch(e=>{console.error(e);process.exitCode=1});
