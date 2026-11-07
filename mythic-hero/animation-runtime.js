/* Tsukiyomi animation adapter v3: articulated locomotion and celestial VFX.
 * Observes authoritative gameplay events; never applies damage. Approved views are skinned,
 * not replaced with another hero. See metadata/animations.json and ASSET_AUDIT.md. */
(() => {
  'use strict';
  const api=window.MythicHero, sprites=window.ShinobiSprites, ca=window.CharacterAnimations;
  const root=new URL('.',document.currentScript.src), motion=matchMedia('(prefers-reduced-motion: reduce)');
  const textures=new Map(), bodies=new Map(), authored=new Map(), slots=Array.from({length:48},()=>({active:false}));
  let manifest, controller, sequence=0, shotSequence=0, sweepAt=0, observedStage;
  let shots=new WeakMap(), completed=new WeakSet();
  const now=()=>performance.now(), owner=id=>S.h.find(h=>h.id===id && api.isMythic(h));
  const reduced=()=>motion.matches || !!window.DisplaySettings?.v.reduceMotion;
  const level=()=>window.Arena3D?.cfg?.fx ?? 2;
  const allowFX=()=>!document.hidden && level()>0 && window.DisplaySettings?.v.explosions!=='off';
  function reset() { controller?.clear(); for(const s of slots)s.active=false; shots=new WeakMap();completed=new WeakSet(); }
  const ready=api.ready;
  api.runtimeReady=sprites.ready=Promise.all([ready,fetch(new URL('metadata/animations.json',root)).then(r=>{if(!r.ok)throw Error('Missing Mythic runtime manifest');return r.json()})]).then(([,data])=>{
    if(data.version!==2 || data.hero.stars!==7 || data.hero.rank!==5)throw Error('Invalid Mythic registration');
    manifest=api.animationSource=data;
    observedStage=S.map;
    const preload0=api.preload;let loadAuthored;
    const importPlan=new Map();
    for(const s of Object.values(data.states))for(const file of [s.texture,...Object.values(s.directionTextures||{})].filter(Boolean))importPlan.set(file,{width:(s.columns||s.frames)*128,height:Math.ceil(s.frames/(s.columns||s.frames))*128});
    for(const s of Object.values(data.skills))if(s.path&&!Object.values(api.source.skills).some(old=>old.path===s.path))importPlan.set(s.path,{width:s.frameWidth*s.frameCount,height:s.frameHeight});
    for(const s of data.vfxSources||[])importPlan.set(s.path,{width:s.width,height:s.height});
    api.preload=()=>loadAuthored || (loadAuthored=preload0().then(()=>Promise.all([...importPlan].map(([file,size])=>new Promise((resolve,reject)=>{
      if(!/^(animations|skills)\/[a-zA-Z0-9_/-]+\.png$/.test(file))return reject(Error('Invalid authored sprite path'));
      const image=new Image();
      image.onload=()=>{if(image.width!==size.width||image.height!==size.height)return reject(Error('Authored sprite grid mismatch: '+file));authored.set(file,image);resolve()};
      image.onerror=()=>reject(Error('Missing authored sprite: '+file));image.src=new URL(file,root).href;
    })))).then(()=>{bodies.clear();textures.clear();sprites.clearCache?.();return true}).catch(error=>{loadAuthored=null;throw error}));
    controller=api.controller=MythicAnimation.create(data,event=>dispatchEvent(new CustomEvent('shinobi-mythic-animation',{detail:event})));
    api.play=play; api.resetAnimations=reset; api.renderFrame=renderFrame; api.skillFrame=skillFrame;
    api.stats=()=>({actors:controller.size,effects:slots.filter(s=>s.active).length,bodyTextures:bodies.size,effectTextures:textures.size,capacity:slots.length});
    api.frameInfo=frameInfo; api.emote=(kind,index=0)=>renderFrame({id:'emote-preview',r:5},'EMOTE_'+kind.toUpperCase(),index,'front');
    const oldFrame=sprites.heroFrame, oldPose=ca.poseFor, oldPlay=ca.play;
    api.heroFrame=sprites.heroFrame=DesignModels.heroFrame=function(h,pose,blink,direction){
      if(!api.isMythic(h))return oldFrame.apply(this,arguments);
      const i=frameInfo(h,pose,direction);return renderFrame(h,i.state,i.index,i.facing);
    };
    ca.poseFor=function(h,time,context={}){
      if(!api.isMythic(h))return oldPose.apply(this,arguments);
      if(time-sweepAt>1000){sweepAt=time;controller.sweep(new Set(S.h.map(h=>h.tokenId ?? h.id)),time)}
      const r=controller.sample(h,time,{...context,running:context.moving && Number(h.sp)>=8,reducedMotion:reduced()});
      // Comfort reduces ambient motion/effects, not essential walking feedback. OS-level
      // reduced motion still holds the sprite. Comfort uses the gentler walk amplitude.
      if(r.moving && !['HURT','DEFEAT','BOMB_PLACE'].includes(r.state))return 'mythic:'+(Number(h.sp)>=8&&!reduced()?'RUN':'WALK_'+r.direction.toUpperCase())+':'+(motion.matches?0:r.moveFrame)+':'+r.direction;
      return 'mythic:'+r.state+':'+r.frame+':'+r.direction;
    };
    ca.play=function(h,state,time){if(api.isMythic(h))return play(h,state,{now:time});return oldPlay.apply(this,arguments)};
    const oldProjectile=ca.drawProjectile,oldImpact=ca.drawImpacts,oldActor=ca.drawActorEffects;
    ca.drawProjectile=function(c,b,time,p){
      const h=owner(b.o);if(!h)return oldProjectile.apply(this,arguments);
      if(!allowFX() || !api.assetsReady)return true;
      let shot=shots.get(b);if(!shot){shot={skill:(shotSequence++%2?'void_shuriken':'dragon_slash')};shots.set(b,shot)}
      // Travel remains entirely controlled by the native projectile; art never moves it.
      const progress=Number.isFinite(b.life)&&b.life>0?Math.max(0,Math.min(1,1-b.t/b.life)):0;
      const frame=shot.skill==='void_shuriken'?2+Math.floor(progress*4)%4:Math.min(7,Math.floor(progress*8));
      const width=(level()===1?48:62)*p.scale;
      if(!reduced()&&level()>1){const dx=Math.cos(p.angle)*10*p.scale,dy=Math.sin(p.angle)*10*p.scale;draw(c,skillFrame(shot.skill,frame),p.x-dx,p.y-dy,width*.8,p.angle,.16)}
      draw(c,skillFrame(shot.skill,reduced()?4:frame),p.x,p.y,width,p.angle,.85);return true;
    };
    ca.drawActorEffects=function(c,h,time,p){
      if(!api.isMythic(h))return oldActor.apply(this,arguments);
      if(!allowFX() || !api.assetsReady)return;
      const r=controller.get(h);if(!r)return;
      if(['ATTACK','SKILL_DRAGON_SLASH'].includes(r.state)){
        const progress=Math.max(0,(time-r.started)/manifest.states[r.state].durationMs);
        const angle=r.direction==='back'?-Math.PI/2:r.direction==='front'?Math.PI/2:p.flip?Math.PI:0;
        if(progress>.2 && progress<.9)draw(c,skillFrame('dragon_slash',Math.min(7,Math.floor(progress*8))),p.x+Math.cos(angle)*10*p.scale,p.y-14*p.scale+Math.sin(angle)*8*p.scale,66*p.scale,angle,.62);
      }
      if(r.state==='ULTIMATE_DRAGON_ASCENSION'){
        const s=manifest.skills.mythic_dragon_ascension,index=Math.min(11,Math.floor((time-r.started)/s.durationMs*12));
        // The body stays visible below the rising dragon; no screen flash or camera shake.
        draw(c,skillFrame('mythic_dragon_ascension',reduced()?7:index),p.x,p.y-3*p.scale,(level()===1?104:150)*p.scale,0,reduced()?.45:.82);
      }
      if(r.state==='VICTORY' && !reduced()){
        const progress=(time-r.started)/manifest.states.VICTORY.durationMs;
        c.save();c.fillStyle='#d8b1ff';c.globalAlpha*=Math.sin(Math.min(1,progress)*Math.PI)*.6;
        for(let i=0;i<4;i++){const a=i*Math.PI/2+progress;c.fillRect(p.x+Math.cos(a)*17*p.scale,p.y-20*p.scale+Math.sin(a)*18*p.scale,2,2)}c.restore();
      }
    };
    ca.drawImpacts=function(c,time,geo){oldImpact.apply(this,arguments);drawPool(c,time,geo,'front')};
    api.drawGround=(c,time,geo)=>drawPool(c,time,geo,'ground');
    // Legacy impact storage is kept for other heroes; Mythic uses the bounded split-layer pool.
    const oldEffect=api.effectFrame;
    ca.effectOverride=function(h,type,phase){
      if(!(api.isMythic(h)||owner(h?.id)))return undefined;
      if(type==='explosion'||type==='skill')return null;
      return oldEffect(h,type,phase);
    };
    const think0=think;think=function(h){
      const before=bombs.length,result=think0.apply(this,arguments);
      if(api.isMythic(h)&&bombs.length>before){const b=bombs[bombs.length-1];
        shots.set(b,{skill:shotSequence++%2?'void_shuriken':'dragon_slash'});
        play(h,b.mythicUlt?'ULTIMATE_DRAGON_ASCENSION':Number.isFinite(b.tx)?'ATTACK':'BOMB_PLACE',{eventId:++sequence,coalesce:true});
      }return result;
    };
    const boom0=boom;boom=function(b){
      const h=owner(b.o),valid=bombs.includes(b)&&!completed.has(b),x=Number.isFinite(b.tx)?b.tx:b.x,y=Number.isFinite(b.ty)?b.ty:b.y;
      const shot=shots.get(b),result=boom0.apply(this,arguments);
      if(valid&&h){completed.add(b);spawn('raijin_field',h,x,y);if(shot?.skill==='void_shuriken')spawn('void_shuriken',h,x,y,6)}return result;
    };
    const map0=newMap;newMap=function(){const result=map0.apply(this,arguments);reset();if(S.map>observedStage)for(const h of S.h)if(api.isMythic(h)&&h.on)play(h,'VICTORY');observedStage=S.map;return result};
    const go0=go;go=function(screen){const result=go0.apply(this,arguments);if(screen!==0)reset();return result};
    addEventListener('visibilitychange',()=>{if(document.hidden)reset()});
    // Explicit integration point for future approved hurt/defeat/skill mechanics. Cosmetic only.
    api.cosmeticEvent=(h,state,options={})=>{
      if(!play(h,state,options))return false;
      const skill={SKILL_RAIJIN_FIELD:'raijin_field',SKILL_VOID_SHURIKEN:'void_shuriken'}[state];
      if(skill)spawn(skill,h,options.tile?.x ?? Math.round(h.x),options.tile?.y ?? Math.round(h.y));
      return true;
    };
    const hunt0=ca.drawHuntImpact;
    const huntProjectile0=ca.drawHuntProjectile;
    ca.drawHuntProjectile=function(c,shot,x,y,time,id,angle){
      const h=owner(id);if(!h)return huntProjectile0.apply(this,arguments);
      if(!allowFX())return true;
      let record=shots.get(shot);if(!record){record={born:time,skill:shotSequence++%2?'void_shuriken':'dragon_slash'};shots.set(shot,record)}
      const step=reduced()?4:Math.floor((time-record.born)/85)%6;
      draw(c,skillFrame(record.skill,step),x,y,shot.ultimate?90:66,angle,.8);return true;
    };
    ca.drawHuntImpact=function(c,hit,p,id){
      if(!owner(id))return hunt0.apply(this,arguments);
      if(!allowFX())return true;
      const name=hit.ultimate?'mythic_dragon_ascension':'raijin_field',s=manifest.skills[name],age=Math.max(0,.8-hit.life);
      draw(c,skillFrame(name,reduced()?5:Math.min(s.requiredFrames-1,Math.floor(age/.8*s.requiredFrames))),p.x,p.y,hit.ultimate?160:90,0,Math.min(1,hit.life/.2)*.75);return true;
    };
    api.spawnSkill=(skill,h,tile)=>spawn(skill,h,tile?.x,tile?.y);
    sprites.clearCache?.();return true;
  });
  api.runtimeReady.catch(e=>console.error('Mythic animation runtime:',e));
  function play(h,state,options={}){return api.isMythic(h)&&controller ? controller.play(h,state,options) : false}
  function frameInfo(h,pose='i0',dir='front',time=now()){
    let state='IDLE',index=0,facing=MythicAnimation.facing(dir);
    if(pose.startsWith('mythic:')){[,state,index,facing]=pose.split(':');index=Number(index)}
    else {
      const legacy={i:'IDLE',w:'WALK_'+facing.toUpperCase(),r:'RUN',a:'ATTACK',b:'BOMB_PLACE',h:'HURT',d:'DEFEAT',v:'VICTORY',k:'ULTIMATE_DRAGON_ASCENSION',idle:'IDLE',walk:'WALK_'+facing.toUpperCase(),run:'RUN',melee:'ATTACK',ranged:'ATTACK',bomb:'BOMB_PLACE',hurt:'HURT',die:'DEFEAT',victory:'VICTORY',skill:'ULTIMATE_DRAGON_ASCENSION'};
      const parts=pose.split(':');state=legacy[parts[0]==='clip'?parts[1]:pose[0]]||'IDLE';
      index=parts[0]==='clip'?Number(parts[2]):parseInt(pose.slice(1),10)||0;
      if(pose[0]==='i')index=Math.floor(time/200)%8;
    }
    const clip=manifest.states[state]||manifest.states.IDLE;index=Math.max(0,Math.min(clip.frames-1,Number(index)||0));
    const names={IDLE:'idle',RUN:'run_'+facing,ATTACK:'attack_'+facing,BOMB_PLACE:'bomb_place',HURT:'hurt',DEFEAT:'defeat',VICTORY:'victory'};
    return {state,index,facing,name:state.startsWith('WALK_')?'walk_'+facing:names[state]||'attack_'+facing,assetStatus:clip.assetStatus};
  }
  const empty=document.createElement('canvas');empty.width=320;empty.height=400;empty.designSprite=true;
  function renderFrame(h,state,index=0,direction='front'){
    if(!manifest||!api.assetsReady){api.preload().catch(()=>{});return empty}
    const clip=manifest.states[state]||manifest.states.IDLE,dir=MythicAnimation.facing(direction);
    index=Math.max(0,Math.min(clip.frames-1,index|0));
    const key=state+':'+index+':'+dir;
    if(bodies.has(key))return bodies.get(key);
    const c=document.createElement('canvas');c.width=320;c.height=400;c.designSprite=true;c.mythicBody=true;
    const ctx=c.getContext('2d'),view=api.source.character[dir],img=api.getTexture(view.path);
    const phase=index/clip.frames*Math.PI*2;let sx=1,sy=1,rot=0,dx=0,dy=0;
    // Explicit pose-rig fallback: stable foot pivot, unchanged costume, bounded motion.
    if(state==='IDLE')sy=1+.008*Math.sin(phase);
    if(state==='BOMB_PLACE')sy=1-.12*Math.sin(index/(clip.frames-1)*Math.PI);
    if(state==='HURT'){rot=-.035*(1-index/clip.frames);dx=-3*(1-index/clip.frames)}
    if(state==='DEFEAT'){sy=1-.25*index/7;rot=-.15*index/7}
    if(state==='VICTORY')dy=-8*Math.sin(index/7*Math.PI);
    if(state==='ATTACK'||state.startsWith('SKILL_'))rot=.03*Math.sin(index/(clip.frames-1)*Math.PI)*(dir==='left'?-1:1);
    const atlas=authored.get(clip.directionTextures?.[dir] || clip.texture);
    ctx.save();ctx.translate(160+(atlas?0:dx),352+(atlas?0:dy));ctx.rotate(atlas?0:rot);ctx.scale(atlas?1:sx,atlas?1:sy);
    if(atlas){const columns=clip.columns||clip.frames;ctx.drawImage(atlas,index%columns*128,Math.floor(index/columns)*128,128,128,-64*2.5,-124*2.5,320,320)}
    else TsukiyomiRig.paint(ctx,img,state,index,dir,clip.frames);ctx.restore();
    if(!atlas && state.startsWith('EMOTE_')){
      const labels={EMOTE_ALERT:'!',EMOTE_QUESTION:'?',EMOTE_LIKE:'♥',EMOTE_CELEBRATE:'✦'};
      ctx.save();ctx.fillStyle='#dfb6ff';ctx.font='bold 30px system-ui';ctx.textAlign='center';ctx.fillText(labels[state],260,70-Math.sin(index/3*Math.PI)*5);ctx.restore();
    }
    c.playerModel={model:'tsukiyomi',key,direction:frameInfo(h,'mythic:'+state+':'+index+':'+dir).name};
    c.mythicAnimation={state,frame:index,direction:dir,assetStatus:clip.assetStatus};
    bodies.set(key,c);if(bodies.size>manifest.limits.textureFrames)bodies.delete(bodies.keys().next().value);
    if(dir==='right')c.mythicMirror=renderFrame(h,state,index,'left');
    return c;
  }
  function skillFrame(name,index,layer='all'){
    if(!api.assetsReady||!manifest?.skills[name])return null;
    const s=manifest.skills[name],step=Math.max(0,Math.min(s.requiredFrames-1,index|0)),frame=s.frames[step],key=name+':'+frame+':'+layer;
    if(textures.has(key))return textures.get(key);
    if(s.renderer==='celestial-v3'){
      const c=document.createElement('canvas');c.width=320;c.height=320;
      TsukiyomiEffects.paint(c.getContext('2d'),name,step,s.requiredFrames,layer,authored.get('skills/dragon-spirit-v3.png'));
      c.mythicEffect={skill:name,frame,step,layer,assetStatus:s.assetStatus};textures.set(key,c);
      if(textures.size>120)textures.delete(textures.keys().next().value);return c;
    }
    const [ax,ay]=s.anchor,w=Math.max(ax,s.frameWidth-ax)*2,h=Math.max(ay,s.frameHeight-ay)*2,c=document.createElement('canvas');c.width=w;c.height=h;
    const ctx=c.getContext('2d'),x=w/2-ax,y=h/2-ay;
    if(name==='raijin_field'&&layer!=='all'){ctx.beginPath();const split=y+s.frameHeight-14;ctx.rect(0,layer==='ground'?split:0,w,layer==='ground'?h-split:split);ctx.clip()}
    ctx.drawImage(authored.get(s.path)||api.getTexture(s.path),frame*s.frameWidth,0,s.frameWidth,s.frameHeight,x,y,s.frameWidth,s.frameHeight);
    c.mythicEffect={skill:name,frame,step,layer,assetStatus:s.assetStatus};textures.set(key,c);
    if(textures.size>120)textures.delete(textures.keys().next().value);return c;
  }
  function draw(c,img,x,y,width,angle=0,alpha=1){
    if(!img||x<-width||y<-width||x>c.canvas.width+width||y>c.canvas.height+width)return;
    c.save();c.translate(x,y);c.rotate(angle);c.globalAlpha*=alpha;c.globalCompositeOperation='screen';c.drawImage(img,-width/2,-width*img.height/img.width/2,width,width*img.height/img.width);c.restore();
  }
  function spawn(name,h,x,y,startFrame=0){
    if(!api.isMythic(h)||!manifest?.skills[name]||!allowFX()||!Number.isInteger(x)||!Number.isInteger(y)||!G[y]?.[x]||G[y][x].k===1)return false;
    const cap=level()===1?12:48;let slot=null;
    for(let i=0;i<cap;i++)if(!slots[i].active){slot=slots[i];break}
    if(!slot)return false;
    Object.assign(slot,{active:true,name,owner:h.id,x,y,started:now(),startFrame});return true;
  }
  function drawPool(c,time,geo,layer){
    if(!allowFX()){for(const s of slots)s.active=false;return}
    for(const slot of slots){if(!slot.active)continue;
      const s=manifest.skills[slot.name],age=time-slot.started,duration=(s.requiredFrames-slot.startFrame)*1000/s.fps;
      if(age>=duration||!owner(slot.owner)||!G[slot.y]?.[slot.x]){slot.active=false;continue}
      if(layer==='ground'&&slot.name!=='raijin_field')continue;
      const frame=reduced()?Math.min(s.requiredFrames-1,slot.startFrame+2):slot.startFrame+Math.floor(Math.max(0,age)*s.fps/1000),p=geo.proj(slot.x+.5,slot.y+.5,0),scale=geo.Sg(slot.y+.5);
      draw(c,skillFrame(slot.name,frame,layer),p[0],p[1],(level()===1?76:104)*scale,0,Math.min(1,(duration-age)/150)*.7);
    }
  }
})();
