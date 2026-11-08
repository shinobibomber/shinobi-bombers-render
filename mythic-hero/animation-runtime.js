/* Tsukiyomi automatic animation adapter V2: basic/signature alternation on native attacks.
 * Authorization and settlement stay in the existing engine; this adapter never applies damage. Approved views are skinned,
 * not replaced with another hero. See metadata/animations.json and ASSET_AUDIT.md. */
(() => {
  'use strict';
  const api=window.MythicHero, sprites=window.ShinobiSprites, ca=window.CharacterAnimations;
  const root=new URL('.',document.currentScript.src), motion=matchMedia('(prefers-reduced-motion: reduce)');
  const textures=new Map(), bodies=new Map(), authored=new Map(), slots=Array.from({length:48},()=>({active:false}));
  let manifest, controller, sequence=0, sweepAt=0, observedStage;
  let shots=new WeakMap(), completed=new WeakSet();
  const selected=new WeakMap(); // Immutable action choice survives transient visual cleanup.
  const skillOrder=Object.keys(MythicAutomaticSkills.definitions);
  const skillStates=skillOrder.map(id=>MythicAutomaticSkills.definitions[id].state);
  const stream=crypto.randomUUID();let ordinal=0,skills;
  const storageKey='sb-mythic-auto-v2';
  let stored=new Map(),persistTimer=0;
  try{stored=new Map(Object.entries(JSON.parse(sessionStorage.getItem(storageKey)||'{}')).slice(-128))}catch{}
  function readStored(key){return stored.get(key)}
  function flushStored(){clearTimeout(persistTimer);persistTimer=0;try{sessionStorage.setItem(storageKey,JSON.stringify(Object.fromEntries(stored)))}catch{}}
  function writeStored(key,value){stored.delete(key);stored.set(key,value);if(stored.size>128)stored.delete(stored.keys().next().value);if(!persistTimer)persistTimer=setTimeout(flushStored,250)}
  addEventListener('pagehide',flushStored);addEventListener('visibilitychange',()=>{if(document.hidden)flushStored()});
  function scope(){return RyoPayments.state.authenticated?RyoPayments.state.account:null}
  function selectSkill(h,event){
    if(!api.isMythic(h)||!scope()||!h.tokenId||h.tokenOwner!==scope())return null;
    return skills.select({...event,scope:scope(),heroId:h.tokenId,now:Date.now()});
  }
  function shotFor(h,b){return selected.get(b)||shots.get(b)||{skill:null}}
  function huntSkill(h,attack,run,context={}){
    if(!api.isMythic(h))return undefined;
    const u=context.contract,elapsed=Date.now()-(u?.started||0),scheduled=u?Math.min(u.energy,Math.floor(Math.max(0,elapsed)/u.cooldown)+1):0;
    const skill=selectSkill(h,{mode:'hunt',stream:String(run||''),ordinal:attack,
      eligible:!!run&&u?.id===h.tokenId&&elapsed>=0&&elapsed<60000&&attack<=scheduled,
      targetValid:true,chakraSpent:attack<=u?.energy,staminaEligible:attack<=u?.energy,
      melee:false,ranged:true,areaEligible:true,ultimateEligible:attack>=8});
    const chosen=skill?MythicAutomaticSkills.definitions[skill].state:'RANGED_ATTACK';
    // Native Hunt formation stands to the left of its guardian; use the approved RIGHT view.
    play(h,chosen,{eventId:'hunt:'+run+':'+attack,direction:'right'});
    return skill;
  }
  const now=()=>performance.now(), owner=id=>S.h.find(h=>h.id===id && api.isMythic(h));
  const reduced=()=>motion.matches || !!window.DisplaySettings?.v.reduceMotion;
  const level=()=>window.Arena3D?.cfg?.fx ?? 2;
  const allowFX=()=>!document.hidden && level()>0 && window.DisplaySettings?.v.explosions!=='off';
  function reset() { controller?.clear(); for(const s of slots)s.active=false; shots=new WeakMap();completed=new WeakSet(); }
  const ready=api.ready;
  api.runtimeReady=sprites.ready=Promise.all([ready,fetch(new URL('metadata/animations.json',root)).then(r=>{if(!r.ok)throw Error('Missing Mythic runtime manifest');return r.json()})]).then(([,data])=>{
    if(data.version!==2 || data.hero.rarity!=='Mythic' || data.hero.rank!==5)throw Error('Invalid Mythic registration');
    manifest=api.animationSource=data;
    observedStage=S.map;
    const preload0=api.preload;let loadAuthored;
    skills=api.automaticSkills=MythicAutomaticSkills.create({config:data.automaticSkills,read:readStored,write:writeStored});
    const importPlan=new Map();
    for(const s of Object.values(data.states))for(const file of [s.texture,...Object.values(s.directionTextures||{})].filter(Boolean))importPlan.set(file,{width:(s.columns||s.sourceFrames||s.frames)*128,height:Math.ceil((s.sourceFrames||s.frames)/(s.columns||s.sourceFrames||s.frames))*128});
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
    api.attackSkill=huntSkill; api.skillRotationVersion=3;
    api.paintSkill=(c,name,progress,layer='all',quality=2)=>api.assetsReady&&TsukiyomiCleanEffects.paint(c,name,progress,layer,authored,data,quality);
    api.stats=()=>({actors:controller.size,effects:slots.filter(s=>s.active).length,bodyTextures:bodies.size,effectTextures:textures.size,capacity:slots.length});
    api.frameInfo=frameInfo; api.emote=(kind,index=0)=>renderFrame({id:'emote-preview',r:5},'EMOTE_'+kind.toUpperCase(),index,'front');
    const oldFrame=sprites.heroFrame, oldPose=ca.poseFor, oldPlay=ca.play;
    api.heroFrame=sprites.heroFrame=DesignModels.heroFrame=function(h,pose,blink,direction){
      if(!api.isMythic(h))return oldFrame.apply(this,arguments);
      if(window.V2?.isBossActive?.()&&V2.bossState()?.team?.some(unit=>unit.id===h.id)&&controller.has(h)){
        const r=controller.sample(h,now(),{direction:MythicAnimation.facing(direction||controller.get(h).direction),sleeping:h.en<1,reducedMotion:reduced()});
        return renderFrame(h,r.state,r.frame,r.direction);
      }
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
      const shot=shotFor(h,b);
      // Fields resolve visually on the target tile; the dragon appears at its caster.
      if(!shot.skill){draw(c,basicProjectile(),p.x,p.y,30*p.scale,p.angle,.95);return true;}
      if(shot.skill==='raijin_field'||shot.skill==='mythic_dragon_ascension')return true;
      // Travel remains entirely controlled by the native projectile; art never moves it.
      const progress=Number.isFinite(b.life)&&b.life>0?Math.max(0,Math.min(1,1-b.t/b.life)):0;
      const frame=shot.skill==='void_shuriken'?2+Math.floor(progress*4)%4:Math.min(7,Math.floor(progress*8));
      const width=(level()===1?48:62)*p.scale;
      // combat-rules/client.js draws the seven decorative copies around this ONE native
      // projectile. This renderer supplies one brighter cached core, never another fan.
      draw(c,skillFrame(shot.skill,reduced()?4:frame),p.x,p.y,width,p.angle,reduced()?.72:.98);return true;
    };
    ca.drawActorEffects=function(c,h,time,p){
      if(!api.isMythic(h))return oldActor.apply(this,arguments);
      if(!allowFX() || !api.assetsReady)return;
      const r=controller.get(h);if(!r)return;
      if(['ATTACK','SKILL_DRAGON_SLASH'].includes(r.state)){
        const progress=Math.max(0,(time-r.started)/manifest.states[r.state].durationMs);
        const angle=r.direction==='back'?-Math.PI/2:r.direction==='front'?Math.PI/2:p.flip?Math.PI:0;
        if(progress>.2 && progress<.9)drawSkill(c,'dragon_slash',r.state==='ATTACK'?progress*.25:reduced()?.5:progress,p.x+Math.cos(angle)*10*p.scale,p.y-14*p.scale+Math.sin(angle)*8*p.scale,66*p.scale,angle,reduced()?.5:.88);
      }
      if(r.state==='ULTIMATE_DRAGON_ASCENSION'&&ultimateVisible(h)){
        const s=manifest.skills.mythic_dragon_ascension;
        // The body stays visible below the rising dragon; no screen flash or camera shake.
        drawSkill(c,'mythic_dragon_ascension',reduced()?.6:(time-r.started)/s.durationMs,p.x,p.y-3*p.scale,(level()===1?104:150)*p.scale,0,reduced()?.45:.95,'front');
      }
      if(r.state==='VICTORY' && !reduced()){
        const progress=(time-r.started)/manifest.states.VICTORY.durationMs;
        c.save();c.fillStyle='#d8b1ff';c.globalAlpha*=Math.sin(Math.min(1,progress)*Math.PI)*.6;
        for(let i=0;i<4;i++){const a=i*Math.PI/2+progress;c.fillRect(p.x+Math.cos(a)*17*p.scale,p.y-20*p.scale+Math.sin(a)*18*p.scale,2,2)}c.restore();
      }
    };
    ca.drawImpacts=function(c,time,geo){oldImpact.apply(this,arguments);drawPool(c,time,geo,'front')};
    api.drawGround=(c,time,geo)=>{drawPool(c,time,geo,'ground');drawUltimateGround(c,time,geo)};
    // Legacy impact storage is kept for other heroes; Mythic uses the bounded split-layer pool.
    const oldEffect=api.effectFrame;
    ca.effectOverride=function(h,type,phase){
      if(!(api.isMythic(h)||owner(h?.id)))return undefined;
      if(type==='explosion'||type==='skill')return null;
      return oldEffect(h,type,phase);
    };
    const think0=think;think=function(h){
      const before=bombs.length,energy=h.en,eligible=h.on&&h.x>=0&&h.y>=0&&window.CombatClient?.canAttack(h)&&BattleRoster.eligible(h),result=think0.apply(this,arguments);
      if(api.isMythic(h)&&bombs.length>before){const b=bombs[bombs.length-1];
        const target=G[b.ty]?.[b.tx],distance=Math.abs(b.tx-b.x)+Math.abs(b.ty-b.y);
        const skill=selectSkill(h,{mode:'adventure',stream,ordinal:++ordinal,eligible,
          targetValid:!!target&&target.k>1&&distance<=CombatRules.range(h),chakraSpent:(energy-h.en)===1,staminaEligible:energy>=1,
          melee:distance<=1,ranged:true,areaEligible:!!target&&target.k!==1,ultimateEligible:true});
        const choice=Object.freeze({skill});shots.set(b,choice);selected.set(b,choice);
        const direction=b.ty<b.y?'back':b.ty>b.y?'front':b.tx<b.x?'left':'right';
        play(h,skill?MythicAutomaticSkills.definitions[skill].state:distance<=1?'ATTACK':'RANGED_ATTACK',{eventId:'adventure:'+stream+':'+ordinal,direction});
      }return result;
    };
    const boom0=boom;boom=function(b){
      const h=owner(b.o),valid=bombs.includes(b)&&!completed.has(b),x=Number.isFinite(b.tx)?b.tx:b.x,y=Number.isFinite(b.ty)?b.ty:b.y;
      const shot=shotFor(h,b),result=boom0.apply(this,arguments);
      if(valid&&h){completed.add(b);if(shot?.skill==='raijin_field')spawn('raijin_field',h,x,y);else if(shot?.skill==='void_shuriken')spawn('void_shuriken',h,x,y,6)}return result;
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
      if(!shot.mythicSkill){draw(c,basicProjectile(),x,y,35,angle,.95);return true;}
      let record=shots.get(shot);if(!record){record={born:time,skill:shot.mythicSkill};shots.set(shot,record)}
      if(record.skill==='raijin_field'||record.skill==='mythic_dragon_ascension')return true;
      const step=reduced()?4:Math.floor((time-record.born)/85)%6;
      draw(c,skillFrame(record.skill,step),x,y,shot.ultimate?90:66,angle,reduced()?.6:.95);return true;
    };
    ca.drawHuntImpact=function(c,hit,p,id){
      if(!owner(id))return hunt0.apply(this,arguments);
      if(!allowFX())return true;
      if(!hit.mythicSkill){draw(c,basicProjectile(),p.x,p.y,25,0,Math.min(1,hit.life/.2));return true;}
      const name=skillOrder.includes(hit.mythicSkill)?hit.mythicSkill:(hit.ultimate?'mythic_dragon_ascension':'dragon_slash'),s=manifest.skills[name],age=Math.max(0,.8-hit.life);
      draw(c,skillFrame(name,reduced()?5:Math.min(s.requiredFrames-1,Math.floor(age/.8*s.requiredFrames))),p.x,p.y,hit.ultimate?160:90,0,Math.min(1,hit.life/.2)*(reduced()?.55:.9));return true;
    };
    api.spawnSkill=(skill,h,tile)=>spawn(skill,h,tile?.x,tile?.y);
    sprites.clearCache?.();return true;
  });
  api.runtimeReady.catch(e=>console.error('Mythic animation runtime:',e));
  let basicTexture;
  function basicProjectile(){
    if(basicTexture)return basicTexture;
    const c=basicTexture=document.createElement('canvas');c.width=c.height=96;const q=c.getContext('2d');
    const glow=q.createRadialGradient(48,48,1,48,48,43);glow.addColorStop(0,'#f9e5ff');glow.addColorStop(.2,'#d968ff');glow.addColorStop(1,'#a04dff00');q.fillStyle=glow;q.fillRect(0,0,96,96);
    q.strokeStyle='#ffd576';q.lineWidth=2;q.beginPath();q.ellipse(48,48,25,25,0,0,Math.PI*2);q.moveTo(8,48);q.lineTo(88,48);q.moveTo(48,8);q.lineTo(48,88);q.stroke();
    q.fillStyle='#fff0ff';q.beginPath();q.moveTo(48,27);q.lineTo(54,42);q.lineTo(69,48);q.lineTo(54,54);q.lineTo(48,69);q.lineTo(42,54);q.lineTo(27,48);q.lineTo(42,42);q.closePath();q.fill();return c;
  }
  function play(h,state,options={}){return api.isMythic(h)&&controller ? controller.play(h,state,options) : false}
  function frameInfo(h,pose='i0',dir='front',time=now()){
    let state='IDLE',index=0,facing=MythicAnimation.facing(dir);
    if(pose.startsWith('mythic:')){[,state,index,facing]=pose.split(':');index=Number(index)}
    else {
      const legacy={i:'IDLE',w:'WALK_'+facing.toUpperCase(),r:'RUN',a:'ATTACK',b:'BOMB_PLACE',h:'HURT',d:'DEFEAT',v:'VICTORY',k:'ULTIMATE_DRAGON_ASCENSION',idle:'IDLE',walk:'WALK_'+facing.toUpperCase(),run:'RUN',melee:'ATTACK',ranged:'RANGED_ATTACK',bomb:'BOMB_PLACE',hurt:'HURT',die:'DEFEAT',victory:'VICTORY',skill:'ULTIMATE_DRAGON_ASCENSION'};
      const parts=pose.split(':');state=legacy[parts[0]==='clip'?parts[1]:pose[0]]||'IDLE';
      index=parts[0]==='clip'?Number(parts[2]):parseInt(pose.slice(1),10)||0;
      if(pose[0]==='i')index=Math.floor(time/400)%manifest.states.IDLE.frames;
    }
    const clip=manifest.states[state]||manifest.states.IDLE;index=Math.max(0,Math.min(clip.frames-1,Number(index)||0));
    const names={IDLE:'idle',RANGED_ATTACK:'attack_'+facing,RUN:'run_'+facing,ATTACK:'attack_'+facing,BOMB_PLACE:'bomb_place',HURT:'hurt',DEFEAT:'defeat',VICTORY:'victory'};
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
    const atlas=authored.get(clip.directionTextures?.[dir] || clip.texture);
    // Shared baked idle/movement/attack; rare reactions use the same fixed-foot rig once
    // per cache miss. Do not scale/tilt the entire character on top of the articulated pose.
    ctx.save();ctx.translate(160,352);
    if(atlas){const columns=clip.columns||clip.sourceFrames||clip.frames,source=clip.sourceIndices?.[index]??index;ctx.drawImage(atlas,source%columns*128,Math.floor(source/columns)*128,128,128,-64*2.5,-124*2.5,320,320)}
    else TsukiyomiRig.paint(ctx,img,state,index,dir,clip.frames);ctx.restore();
    TsukiyomiRig.expression(ctx,state,index,clip.frames);
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
    if(s.renderer==='reference-v6'||s.renderer==='baked-v9'){
      const c=document.createElement('canvas');c.width=320;c.height=320;
      api.paintSkill(c.getContext('2d'),name,(step+.5)/s.requiredFrames,layer);
      c.mythicEffect={skill:name,frame,step,layer,assetStatus:s.assetStatus};textures.set(key,c);
      if(textures.size>120)textures.delete(textures.keys().next().value);return c;
    }
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
  function drawSkill(c,name,progress,x,y,width,angle=0,alpha=1,layer='all'){
    if(x<-width||y<-width||x>c.canvas.width+width||y>c.canvas.height+width)return;
    c.save();c.translate(x,y);c.rotate(angle);c.scale(width/320,width/320);c.translate(-160,-160);c.globalAlpha*=alpha;c.globalCompositeOperation='screen';
    api.paintSkill(c,name,Math.max(0,Math.min(1,progress)),layer,level()===1||reduced()?1:2);c.restore();
  }
  function ultimateVisible(h){const cap=level()<2?1:2;let n=0;for(const hero of S.h){if(controller.get(hero)?.state==='ULTIMATE_DRAGON_ASCENSION'){if(hero===h)return n<cap;n++}}return false}
  function drawUltimateGround(c,time,geo){
    if(!allowFX()||!api.assetsReady)return;
    for(const h of S.h){
      if(!api.isMythic(h)||!h.on||h.x<0||h.y<0)continue;
      const r=controller.get(h);if(r?.state!=='ULTIMATE_DRAGON_ASCENSION'||!ultimateVisible(h))continue;
      const duration=manifest.skills.mythic_dragon_ascension.durationMs,progress=(time-r.started)/duration;
      if(progress<0||progress>=1)continue;
      const gy=h.y+.62,p=geo.proj(h.x+.5,gy),scale=geo.Sg(gy)*1.60;
      drawSkill(c,'mythic_dragon_ascension',reduced()?.6:progress,p[0],p[1]-3*scale,(level()===1?104:150)*scale,0,reduced()?.45:.95,'ground');
    }
  }
  function drawPool(c,time,geo,layer){
    if(!allowFX()){for(const s of slots)s.active=false;return}
    for(const slot of slots){if(!slot.active)continue;
      const s=manifest.skills[slot.name],age=time-slot.started,duration=(s.requiredFrames-slot.startFrame)*1000/s.fps;
      if(age>=duration||!owner(slot.owner)||!G[slot.y]?.[slot.x]){slot.active=false;continue}
      if(layer==='ground'&&slot.name!=='raijin_field')continue;
      const p=geo.proj(slot.x+.5,slot.y+.5,0),scale=geo.Sg(slot.y+.5);
      const progress=reduced()?(slot.startFrame+2)/s.requiredFrames:(slot.startFrame+Math.max(0,age)*s.fps/1000)/s.requiredFrames;
      drawSkill(c,slot.name,progress,p[0],p[1],(level()===1?76:104)*scale,0,Math.min(1,(duration-age)/150)*(reduced()?.5:.9),layer);
    }
  }
})();
