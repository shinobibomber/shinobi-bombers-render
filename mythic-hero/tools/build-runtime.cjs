'use strict';
const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(__dirname,'../assets/metadata');
function buildRuntime() {
  const meta=JSON.parse(fs.readFileSync(path.join(dir,'tsukiyomi.json'),'utf8'));
  delete meta.hero.stars;meta.hero.generation='First Generation';meta.hero.classification='Exclusive Mythic NFT';
  meta.hero.presentation={rarityLabel:'Mythic',baseStatBand:[17,20],visualVolley:7,baseRange:6,effectiveRange:7,perks:7};
  const states={}, add=(name,frames,durationMs,loop=false,priority=1,events={})=>states[name]={frames,frameWidth:128,frameHeight:128,durationMs,fps:frames*1000/durationMs,loop,priority,anchor:[64,124],direction:name.startsWith('WALK_')?name.slice(5).toLowerCase():'facing',events,texture:null,assetStatus:'runtime-skinned-approved-views',fallback:'approved-view-skeletal-mesh'};
  add('IDLE',4,1600,true,0);states.IDLE.sourceFrames=8;states.IDLE.sourceIndices=[0,2,4,6];
  for(const dir of ['FRONT','LEFT','RIGHT','BACK'])add('WALK_'+dir,8,800,true,0);
  add('RUN',8,600,true,0);add('ATTACK',6,550,false,2,{blade:3,recover:5});add('RANGED_ATTACK',6,550,false,2,{release:3,recover:5});add('BOMB_PLACE',6,600,false,2,{place:2});
  add('HURT',4,400,false,4,{recoil:0});add('DEFEAT',6,1000,false,5,{down:5});add('VICTORY',6,1200,false,1,{sparkle:3});
  for(const name of ['ALERT','QUESTION','LIKE','CELEBRATE'])add('EMOTE_'+name,4,600,false,1,{expression:1});
  // Sample a readable static pose under reduced motion, without changing event timing.
  for(const [state,frame]of Object.entries({ATTACK:3,RANGED_ATTACK:3,BOMB_PLACE:2,HURT:1,DEFEAT:5,VICTORY:3,EMOTE_ALERT:1,EMOTE_QUESTION:1,EMOTE_LIKE:1,EMOTE_CELEBRATE:1}))states[state].reducedFrame=frame;
  for(const direction of ['front','left','right','back']){
    states['WALK_'+direction.toUpperCase()].texture='animations/rig-v3/walk_'+direction+'.png';
    for(const state of ['RUN','ATTACK','RANGED_ATTACK','IDLE']){states[state].directionTextures||={};states[state].directionTextures[direction]='animations/rig-v3/'+state.toLowerCase()+'_'+direction+'.png'}
  }
  const skills={},v6=JSON.parse(fs.readFileSync(path.join(dir,'skills-v6.json'),'utf8'));
  const definitions=require('../automatic-skills.js').definitions;
  for(const [key,s]of Object.entries(v6.clips))s.name=meta.skills[key].name=definitions[key].name;
  for(const [key,count]of Object.entries({dragon_slash:8,void_shuriken:8,raijin_field:10,mythic_dragon_ascension:12})) {
    const s=meta.skills[key], durationMs=v6.clips[key].durationMs, state=key==='mythic_dragon_ascension'?'ULTIMATE_DRAGON_ASCENSION':'SKILL_'+key.toUpperCase();
    add(state,count,durationMs,false,3,{visualPeak:Math.floor(count*.65)});
    skills[key]={name:s.name,path:null,frameWidth:320,frameHeight:320,frameCount:count,fps:count*1000/durationMs,anchor:[160,160],requiredFrames:count,durationMs,frames:Array.from({length:count},(_,i)=>i),eventsMs:Object.fromEntries(Object.entries(s.events||{}).map(([k,v])=>[k,v*1000/s.fps])),renderer:'reference-v6',assetStatus:v6.assetStatus,legacySource:{path:s.path,frameCount:s.frameCount},damage:false};
  }
  const production=JSON.parse(fs.readFileSync(path.join(dir,'production-v9.json'),'utf8'));
  const effects=JSON.parse(fs.readFileSync(path.join(dir,'production-v11.json'),'utf8'));
  for(const [state,clip]of Object.entries(states)){const base=state.startsWith('WALK_')?'walk':state.toLowerCase();if(['idle','walk','run','attack','ranged_attack','hurt','defeat','bomb_place','victory'].includes(base)){delete clip.texture;delete clip.sourceIndices;delete clip.sourceFrames;clip.directionTextures={};for(const direction of ['front','left','right','back'])clip.directionTextures[direction]=production.character[base+'_'+direction].path;clip.assetStatus=production.characterStatus;clip.columns=clip.frames}}
  for(const [id,skill]of Object.entries(skills)){const clip=effects.skills[id];skill.renderer='baked-v11';skill.frameWidth=clip.frameWidth;skill.frameHeight=clip.frameHeight;skill.columns=clip.columns;skill.anchor=clip.anchor;skill.durationMs=clip.durationMs;skill.fps=skill.requiredFrames*1000/clip.durationMs;skill.vfxName=definitions[id].vfxName;skill.assetStatus=effects.effectStatus;skill.layers=effects.skills[id].layers;skill.animationEvents={visualOnly:true,hitAuthority:'native-combat-only'}}
  const cleanSources=Object.values(effects.skills).flatMap(s=>Object.values(s.layers));
  const data={version:2,presentationVersion:11,automaticSkills:Object.fromEntries(Object.entries(definitions).map(([id,d])=>[id,{...d,enabled:true}])),skillSet:v6,vfxReference:effects.reference,characterReference:{file:'reference/latest-animation-v2.png',productionFramesAvailable:false,status:'composite-design-reference-only'},hero:meta.hero,frame:meta.frame,states,skills,vfxSources:cleanSources,aura:{source:'metadata/tsukiyomi.json',unchanged:true,quality:'legacy-extracted-layers'},limits:{actors:128,effects:48,lowEffects:12,textureFrames:160},assetStatus:'approved-rig-atlases-and-poster-vfx'};
  fs.writeFileSync(path.join(dir,'tsukiyomi.json'),JSON.stringify(meta,null,2)+'\n');
  fs.writeFileSync(path.join(dir,'animations.json'),JSON.stringify(data,null,2)+'\n');
  return data;
}
if(require.main===module) console.log('Tsukiyomi runtime manifest:',Object.keys(buildRuntime().states).length,'states; approved-view skeletal animation and celestial VFX.');
module.exports={buildRuntime};
