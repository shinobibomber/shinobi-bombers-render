'use strict';
const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(__dirname,'../assets/metadata');
function buildRuntime() {
  const meta=JSON.parse(fs.readFileSync(path.join(dir,'tsukiyomi.json'),'utf8'));
  meta.hero.stars=7; meta.hero.classification='Exclusive Mythic NFT';
  const states={}, add=(name,frames,durationMs,loop=false,priority=1,events={})=>states[name]={frames,frameWidth:128,frameHeight:128,durationMs,fps:frames*1000/durationMs,loop,priority,anchor:[64,124],direction:name.startsWith('WALK_')?name.slice(5).toLowerCase():'facing',events,texture:null,assetStatus:'runtime-skinned-approved-views',fallback:'approved-view-skeletal-mesh'};
  add('IDLE',8,1600,true,0);
  for(const dir of ['FRONT','LEFT','RIGHT','BACK'])add('WALK_'+dir,8,800,true,0);
  add('RUN',8,600,true,0);add('ATTACK',6,550,false,2,{blade:3,recover:5});add('BOMB_PLACE',6,600,false,2,{place:2});
  add('HURT',4,400,false,4,{recoil:0});add('DEFEAT',8,1000,false,5,{down:7});add('VICTORY',8,1200,false,1,{sparkle:3});
  for(const name of ['ALERT','QUESTION','LIKE','CELEBRATE'])add('EMOTE_'+name,4,600,false,1,{expression:1});
  for(const direction of ['front','left','right','back']){
    states['WALK_'+direction.toUpperCase()].texture='animations/rig-v3/walk_'+direction+'.png';
    for(const state of ['RUN','ATTACK']){states[state].directionTextures||={};states[state].directionTextures[direction]='animations/rig-v3/'+state.toLowerCase()+'_'+direction+'.png'}
  }
  const skills={};
  for(const [key,count]of Object.entries({dragon_slash:8,void_shuriken:8,raijin_field:10,mythic_dragon_ascension:12})) {
    const s=meta.skills[key], durationMs=count*1000/s.fps, state=key==='mythic_dragon_ascension'?'ULTIMATE_DRAGON_ASCENSION':'SKILL_'+key.toUpperCase();
    add(state,count,durationMs,false,3,{visualPeak:Math.floor(count*.65)});
    skills[key]={name:s.name,path:null,frameWidth:320,frameHeight:320,frameCount:count,fps:s.fps,anchor:[160,160],requiredFrames:count,durationMs,frames:Array.from({length:count},(_,i)=>i),eventsMs:Object.fromEntries(Object.entries(s.events||{}).map(([k,v])=>[k,v*1000/s.fps])),renderer:'celestial-v3',assetStatus:'procedural-vfx-with-generated-dragon',legacySource:{path:s.path,frameCount:s.frameCount},damage:false};
  }
  const data={version:2,presentationVersion:3,hero:meta.hero,frame:meta.frame,states,skills,vfxSources:[{path:'skills/dragon-spirit-v3.png',width:1254,height:1254,kind:'generated-single-sprite'}],aura:{source:'metadata/tsukiyomi.json',unchanged:true,quality:'legacy-extracted-layers'},limits:{actors:128,effects:48,lowEffects:12,textureFrames:160},assetStatus:'articulated-views-and-celestial-vfx'};
  fs.writeFileSync(path.join(dir,'tsukiyomi.json'),JSON.stringify(meta,null,2)+'\n');
  fs.writeFileSync(path.join(dir,'animations.json'),JSON.stringify(data,null,2)+'\n');
  return data;
}
if(require.main===module) console.log('Tsukiyomi runtime manifest:',Object.keys(buildRuntime().states).length,'states; approved-view skeletal animation and celestial VFX.');
module.exports={buildRuntime};
