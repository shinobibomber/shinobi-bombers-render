'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp'),vm=require('node:vm');
const {withGame}=require('./harness.cjs'),economy=require('../app/server/economy.cjs'),root=path.resolve(__dirname,'../mythic-hero'),out=path.join(__dirname,'out');
const {validate}=require('../mythic-hero/tools/validate-atlas.cjs');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'articulated-sprite.js'),'utf8'),sandbox);
 const point=sandbox.window.TsukiyomiRig.point;
 const rig=JSON.parse(fs.readFileSync(path.join(root,'assets/metadata/rig-v3.json'),'utf8'));
 assert.equal(rig.generatorSha256,digest(fs.readFileSync(path.join(root,'articulated-sprite.js'),'utf8').replace(/\r\n/g,'\n')));
 for(const [name,clip]of Object.entries(rig.clips)){
  const file=path.join(root,'assets',clip.path),direction=name.split('_')[1];
  await validate(file,clip.frames);
  assert.equal(clip.sourceSha256,digest(fs.readFileSync(path.join(root,'assets/character/tsukiyomi_'+direction+'.png'))));
  const meta=await sharp(file).metadata();assert.deepEqual([meta.width,meta.height,meta.channels],[clip.frames*128,128,4]);
  const hashes=[];for(let i=0;i<clip.frames;i++)hashes.push(digest(await sharp(file).extract({left:i*128,top:0,width:128,height:128}).raw().toBuffer()));
  assert.equal(new Set(hashes).size,clip.frames,name+' has distinct frames');
  if(name.startsWith('walk')||name.startsWith('run')){
   const regions=[{left:28,top:73,width:72,height:25},{left:40,top:103,width:48,height:22}];
   for(const region of regions){const a=await sharp(file).extract({...region,left:region.left+2*128}).raw().toBuffer(),b=await sharp(file).extract({...region,left:region.left+6*128}).raw().toBuffer();let changed=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])+Math.abs(a[i+3]-b[i+3])>30)changed++;assert(changed>45,name+' independent '+(region.top>100?'feet':'arms')+' pixels: '+changed)}
  }
 }
 for(const direction of ['front','back']){
  const left=point(54,122,'RUN',2,direction,8),right=point(75,122,'RUN',2,direction,8);
  assert(left[1]<120 && right[1]>121,'one foot lifts while opposite foot plants');
  assert.equal(point(64,40,'WALK_FRONT',2,direction,8)[0],64,'face does not swing with limbs');
 }
 await withGame(async({p,f,errors})=>{
  const heroes=Array.from({length:10},(_,i)=>({tokenId:'motion-'+i,name:'Tsukiyomi',rank:5,level:1,mythic:'tsukiyomi',baseStats:{pw:16,sp:15,st:17}}));
  f.profile=economy.normalizeProfile({...f.profile,heroes,battleReady:heroes.map(h=>h.tokenId)});f.holdAdventure=false;
  await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!LoginScreen.active);
  await p.evaluate(async()=>{await MythicHero.runtimeReady;await MythicHero.preload();go(1)});
  const result=await p.evaluate(()=>{
   const m=MythicHero,h=S.h.find(h=>h.r===5),ca=CharacterAnimations;
   const c=document.createElement('canvas');c.width=1080;c.height=640;const ctx=c.getContext('2d');ctx.fillStyle='#100c22';ctx.fillRect(0,0,c.width,c.height);
   const directions=['front','left','right','back'];for(let j=0;j<4;j++){ctx.fillStyle='#ecdaff';ctx.font='16px system-ui';ctx.fillText(directions[j]+' / RUN',8,j*160+20);for(let i=0;i<8;i++)ctx.drawImage(m.renderFrame(h,'RUN',i,directions[j]),90+i*120,j*160+15,112,140)}
   const sheet=c.toDataURL();m.resetAnimations();let time=performance.now();ca.poseFor(h,time,{moving:true,direction:'side',phase:0});m.play(h,'ATTACK',{now:time+1});
   const tokens=[ca.poseFor(h,time+100,{moving:true,direction:'side',phase:1}),ca.poseFor(h,time+200,{moving:true,direction:'side',phase:2})];
   m.play(h,'ULTIMATE_DRAGON_ASCENSION',{now:time+201});tokens.push(ca.poseFor(h,time+300,{moving:true,direction:'back',phase:3}));
   const reduced0=DisplaySettings.v.reduceMotion;DisplaySettings.v.reduceMotion=true;
   const comfort=[ca.poseFor(h,time+400,{moving:true,direction:'front',phase:4}),ca.poseFor(h,time+500,{moving:true,direction:'front',phase:5})];DisplaySettings.v.reduceMotion=reduced0;
   const saved=JSON.stringify({heroes:S.h,bombs,ryo:S.ryo,map:S.map});
   for(const d of directions)for(let i=0;i<8;i++)m.renderFrame(h,'RUN',i,d);
   const create=document.createElement;let allocations=0;document.createElement=function(tag,...args){if(tag==='canvas')allocations++;return create.call(this,tag,...args)};
   const started=performance.now();for(let i=0;i<1000;i++)m.renderFrame(h,'RUN',i%8,directions[i%4]);const warmMs=performance.now()-started;document.createElement=create;
   let edgeAlpha=0;const uniques={};for(const [name,s]of Object.entries(m.animationSource.skills)){const images=[];for(let i=0;i<s.requiredFrames;i++){const img=m.skillFrame(name,i);images.push(img.toDataURL());const q=img.getContext('2d'),d=q.getImageData(0,0,img.width,img.height).data;for(let x=0;x<img.width;x++)edgeAlpha=Math.max(edgeAlpha,d[x*4+3],d[((img.height-1)*img.width+x)*4+3]);for(let y=0;y<img.height;y++)edgeAlpha=Math.max(edgeAlpha,d[y*img.width*4+3],d[(y*img.width+img.width-1)*4+3])}uniques[name]=new Set(images).size}
   m.resetAnimations();return {sheet,tokens,comfort,allocations,warmMs,edgeAlpha,uniques,unchanged:saved===JSON.stringify({heroes:S.h,bombs,ryo:S.ryo,map:S.map}),stats:m.stats()};
  });
  fs.writeFileSync(path.join(out,'mythic-v3-directional-motion.png'),Buffer.from(result.sheet.split(',')[1],'base64'));delete result.sheet;
  assert(result.comfort.every(t=>t.startsWith('mythic:WALK_FRONT:')));assert.notEqual(result.comfort[0],result.comfort[1],'Comfort keeps gentle locomotion');
  assert(result.tokens.every(t=>t.startsWith('mythic:RUN:')));assert.equal(new Set(result.tokens.map(t=>t.split(':')[2])).size,3,'attacks/ultimate cannot freeze the gait');assert.equal(result.allocations,0);assert(result.warmMs<1000);assert.equal(result.edgeAlpha,0,'VFX have transparent padding, no clipped edges');assert.equal(result.unchanged,true);assert.deepEqual(Object.values(result.uniques),[8,8,10,12]);
  await p.evaluate(()=>{go(0);Experience.workAll()});await p.waitForFunction(()=>S.h.filter(h=>h.on&&h.x>=0).length===10,{},{timeout:15000});
  await p.waitForTimeout(1000);await p.screenshot({path:path.join(out,'mythic-v3-ten-heroes.png')});
  assert.deepEqual(errors,[]);console.log(JSON.stringify(result));
 });
 console.log('PASS: approved-source hashes, 120 distinct motion frames, moving feet/arms in four directions, gait during attacks/ultimate, transparent VFX margins, zero warm-frame allocations, 10 Mythics and preserved game state.');
})().catch(e=>{console.error(e);process.exitCode=1});
