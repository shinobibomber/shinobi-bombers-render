'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict'),{withGame}=require('./harness.cjs'),economy=require('../app/server/economy.cjs');
const production=require('../mythic-hero/assets/metadata/production-v11.json'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(fs.readFileSync(path.join(__dirname,'../mythic-hero',production.reference.path))),production.reference.sha256);
assert.equal(sha(fs.readFileSync(path.join(__dirname,'../mythic-hero',production.generator.path),'utf8').replace(/\r\n/g,'\n')),production.generator.sha256);
(async()=>{await withGame(async({p,f,errors})=>{
 const heroes=Array.from({length:8},(_,i)=>({tokenId:'mode-v10-'+i,name:'Tsukiyomi',rank:5,level:1,mythic:'tsukiyomi',baseStats:{pw:18,sp:20,st:20}}));
 f.holdAdventure=false;f.profile=economy.normalizeProfile({...f.profile,heroes,battleReady:heroes.map(h=>h.tokenId)});
 await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!LoginScreen.active);
 const results=await p.evaluate(async()=>{
  const m=MythicHero;await m.runtimeReady;await m.preload();Experience.restAll();S.butler=false;tick=()=>{};go(0);
  const heroes=S.h.filter(h=>h.r===5),dirs=[[1,0,'right'],[-1,0,'left'],[0,1,'front'],[0,-1,'back']],rows=[];
  for(const h of heroes){h.on=true;h.x=h.y=6;h.en=100;h.cd=0}CombatClient.reconcile({combatVersion:1,deployed:heroes.map(h=>h.tokenId)});
  for(let mode=0;mode<2;mode++)for(let dir=0;dir<4;dir++){
   const h=heroes[mode*4+dir],[dx,dy,direction]=dirs[dir],distance=mode?3:1,tx=6+dx*distance,ty=6+dy*distance;
   bombs.length=0;for(const row of G)for(const t of row){t.k=0;t.hp=t.maxHp=0}G[ty][tx]={k:2,hp:10000,maxHp:10000};
   const choices=[],timelines=[];let damage=0;const energy=h.en;
   for(let n=0;n<8;n++){
    m.resetAnimations();h.cd=0;think(h);const b=bombs.at(-1);if(!b)throw Error('Missing native '+(mode?'ranged':'melee')+' attack');
    const record=m.automaticSkills.inspect(RyoPayments.state.account,h.tokenId),id=Object.values(record.streams).at(-1).choice;choices.push(id);
    if(m.controller.get(h).direction!==direction)throw Error('Wrong native facing');
    const count=m.stats().effects,hp=G[ty][tx].hp;boom(b);boom(b);damage+=hp-G[ty][tx].hp;if(m.stats().effects!==count)throw Error('Repeated impacts spawned a duplicate effect');
    if(id){
     // Fast basic attacks cannot cut short a signature's independent full timeline.
     m.play(h,'ATTACK',{force:true});const time=performance.now()+m.animationSource.skills[id].durationMs*.7,c=document.createElement('canvas');c.width=c.height=800;const q=c.getContext('2d'),calls=[],old=m.paintSkill;
     m.paintSkill=(c,name,progress,layer,...a)=>{calls.push({name,progress,layer,blend:c.globalCompositeOperation});return old(c,name,progress,layer,...a)};
     const before=JSON.stringify({heroes:S.h,bombs,map:S.map,ryo:S.ryo});
     try{m.drawGround(q,time,{proj:()=>[400,400],Sg:()=>1});CharacterAnimations.drawImpacts(q,time,{proj:()=>[400,400],Sg:()=>1})}finally{m.paintSkill=old}
     if(before!==JSON.stringify({heroes:S.h,bombs,map:S.map,ryo:S.ryo}))throw Error('VFX changed game state');
     if(calls.some(c=>c.blend!=='source-over'))throw Error('Skill palette washed out by additive blend');
     if(!calls.some(c=>c.name===id&&c.layer==='front'&&c.progress>=.69&&c.progress<.8))throw Error('Missing full late-stage '+id+' timeline');
     if(['raijin_field','mythic_dragon_ascension'].includes(id)&&!calls.some(c=>c.name===id&&c.layer==='ground'))throw Error('Missing ground layer');
     timelines.push({id,calls});m.drawGround(q,time+3000,{proj:()=>[400,400],Sg:()=>1});if(m.stats().effects)throw Error('Expired effect not cleaned up');
    }
   }
   rows.push({mode:mode?'ranged':'melee',direction,choices,damage,power:h.pw,spent:energy-h.en,timelines});
   h.en=0;h.cd=0;const before=m.automaticSkills.inspect(RyoPayments.state.account,h.tokenId).total;think(h);if(bombs.length||m.automaticSkills.inspect(RyoPayments.state.account,h.tokenId).total!==before)throw Error('Zero chakra advanced rotation');
  }
  m.resetAnimations();return rows;
 });
 const order=[null,'dragon_slash',null,'void_shuriken',null,'raijin_field',null,'mythic_dragon_ascension'];
 assert.equal(results.length,8);for(const r of results){assert.deepEqual(r.choices,order);assert.equal(r.spent,8);assert.equal(r.damage,r.power*8);assert.equal(r.timelines.length,4)}assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(__dirname,'out/mythic-mode-v10-results.json'),JSON.stringify(results,null,2));
 console.log('PASS: all four skills on 64 native melee/ranged attacks in four directions; exact Power/one chakra, complete independent VFX timelines, no duplicate impact spawns, zero-chakra guards and cleanup.');
});})().catch(e=>{console.error(e);process.exitCode=1});
