'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {create}=require('../mythic-hero/animation-controller.js'),data=require('../mythic-hero/assets/metadata/animations.json');
const events=[],c=create(data,e=>events.push(e)),hero={id:7},h2={id:8};
assert.equal(data.hero.stars,undefined);assert.equal(data.hero.rank,5);
assert.equal(data.presentationVersion,11);assert.equal(data.assetStatus,'approved-rig-atlases-and-poster-vfx');
const required={IDLE:4,WALK_FRONT:8,WALK_LEFT:8,WALK_RIGHT:8,WALK_BACK:8,RUN:8,ATTACK:6,RANGED_ATTACK:6,BOMB_PLACE:6,HURT:4,DEFEAT:6,VICTORY:6,EMOTE_ALERT:4,EMOTE_QUESTION:4,EMOTE_LIKE:4,EMOTE_CELEBRATE:4,SKILL_DRAGON_SLASH:8,SKILL_VOID_SHURIKEN:8,SKILL_RAIJIN_FIELD:10,ULTIMATE_DRAGON_ASCENSION:12};
for(const [name,count]of Object.entries(required)){
  const s=data.states[name];assert.equal(s.frames,count);assert.deepEqual(s.anchor,[64,124]);assert.equal(s.frameWidth,128);assert.equal(s.frameHeight,128);
  c.clear();events.length=0;c.play(hero,name,{now:0,force:true});
  const frames=new Set();
  for(let i=0;i<count;i++)frames.add(c.sample(hero,i*s.durationMs/count+.1,{moving:s.loop&&name!=='IDLE',running:name==='RUN',direction:name.startsWith('WALK_')?name.slice(5).toLowerCase():'front'}).frame);
  assert.equal(frames.size,count,name+' timing visits every frame');
  if(!s.loop){c.sample(hero,s.durationMs+1);c.sample(hero,s.durationMs+2);assert.equal(events.filter(e=>e.name==='complete').length,1);assert.equal(c.get(hero).state,'IDLE')}
}
c.clear();c.sample(hero,0,{moving:true,direction:'left',phase:0});
assert.equal(c.sample(hero,1000,{moving:true,direction:'left',phase:0}).frame,0,'stationary phase does not slide');
assert.equal(c.sample(hero,1200,{moving:true,direction:'left',phase:1}).frame,2);
assert.equal(c.sample(hero,1300,{moving:false}).state,'IDLE');
c.play(hero,'ATTACK',{now:1400,eventId:'shot-a'});assert.equal(c.play(hero,'ATTACK',{now:1410,eventId:'shot-a'}),false);
c.sample(hero,1700);c.sample(hero,2000);assert(c.play(hero,'ATTACK',{now:2100,eventId:'shot-b'}));assert.equal(c.sample(hero,2100).frame,0,'same action restarts');
assert(c.play(hero,'HURT',{now:2150}));assert(!c.play(hero,'ATTACK',{now:2151}));assert(c.play(hero,'DEFEAT',{now:2200}));assert(!c.play(hero,'HURT',{now:2201}));
c.sample(hero,2202,{sleeping:true});assert.equal(c.get(hero).state,'IDLE','rest is not defeat');
c.play(h2,'BOMB_PLACE',{now:2300});c.clear(hero);assert(c.has(h2));c.sweep(new Set([7]),2400);assert.equal(c.size,0);
for(let i=0;i<1000;i++)c.sample({id:i},i);assert.equal(c.size,128);c.sweep(null,40000);assert.equal(c.size,0);
for(const s of Object.values(data.skills)){assert.equal(s.damage,false);assert.equal(s.frames.length,s.requiredFrames);assert(s.frames.every(i=>i>=0&&i<s.frameCount))}
assert.equal(data.skills.mythic_dragon_ascension.frameCount,12,'twelve distinct runtime VFX frames');
assert.equal(data.skills.mythic_dragon_ascension.legacySource.frameCount,10,'legacy source count remains documented');
c.clear();c.sample(hero,0,{moving:true,phase:0});c.play(hero,'ATTACK',{now:10,coalesce:true});
assert.equal(c.play(hero,'ATTACK',{now:30,coalesce:true}),false,'rapid volleys cannot restart the attack every tick');
c.sample(hero,100,{moving:true,phase:1});assert.equal(c.get(hero).moveFrame,2,'gait advances during attack');
c.play(hero,'ULTIMATE_DRAGON_ASCENSION',{now:110});c.sample(hero,200,{moving:true,phase:2,direction:'back'});
assert.equal(c.get(hero).moveFrame,4,'gait survives a skill and facing transition');
const runtime=fs.readFileSync(path.join(__dirname,'../mythic-hero/animation-runtime.js'),'utf8');
assert(!/\.hp\s*[-+]?=|\.ryo\s*[-+]?=|\.en\s*[-+]?=|signTransaction|sendTransaction/.test(runtime),'cosmetics cannot mutate economy or combat');
console.log('PASS: 20 animation states, exact logical frame counts, movement phase sync, events once, repeated attacks, priority/interruptions, per-hero cleanup and explicit art gaps.');
