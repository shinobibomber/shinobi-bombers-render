'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp'),{chromium}=require('playwright');
const {start}=require('../dev-vfx-lab/local-server.cjs'),{allowed}=require('../dev-vfx-lab/handler.cjs'),root=path.resolve(__dirname,'..'),out=path.join(__dirname,'out');
const {withGame}=require('./harness.cjs'),economy=require('../app/server/economy.cjs');
(async()=>{
 const manifest=require('../mythic-hero/assets/metadata/skills-v6.json'),sum=b=>crypto.createHash('sha256').update(b).digest('hex');
 assert.equal(sum(fs.readFileSync(path.join(root,'mythic-hero',manifest.source.path))),manifest.source.sha256);
 assert.deepEqual(Object.values(manifest.clips).map(s=>s.keyStages),[8,8,10,12]);assert.deepEqual(Object.values(manifest.clips).map(s=>s.sourceFrames.length),[7,8,9,11]);
 const meta=await sharp(path.join(root,'mythic-hero/assets',manifest.atlas.path)).metadata();assert(meta.hasAlpha);assert.equal(meta.width,manifest.atlas.width);assert.equal(meta.height,manifest.atlas.height);
 const req={socket:{remoteAddress:'127.0.0.1'}};assert(allowed(req,{SHINOBI_VFX_LAB:'on'}));for(const env of [{},{SHINOBI_VFX_LAB:'on',RENDER:'true'},{SHINOBI_VFX_LAB:'on',RENDER_SERVICE_ID:'service-fixture'},{SHINOBI_VFX_LAB:'on',PRELAUNCH_MODE:'on'},{SHINOBI_VFX_LAB:'on',PRELAUNCH_MODE:' ON '},{SHINOBI_VFX_LAB:'on',SOLANA_NETWORK:'mainnet'},{SHINOBI_VFX_LAB:'on',SOLANA_NETWORK:' MAINNET '}])assert.equal(allowed(req,env),false);assert.equal(allowed({socket:{remoteAddress:'203.0.113.1'}},{SHINOBI_VFX_LAB:'on'}),false);
 const host=await start(),browser=await chromium.launch({headless:true,channel:'chrome'}),p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==host.url)return route.abort();if(['/api/ryo','/.netlify/functions/ryo'].includes(u.pathname))return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'No wallet/API operations in VFX lab'})});return route.continue()});
  await p.goto(host.url+'/vfx-lab/tsukiyomi');await p.waitForFunction(()=>VfxLab.ready,null,{timeout:60000});await p.locator('#pause').click();
  const result=await p.evaluate(()=>{
   const lab=VfxLab,b=lab.bridge,w=document.getElementById('engine').contentWindow,before=b.snapshot(),ids=Object.keys(b.manifest.clips),c=document.createElement('canvas');c.width=320;c.height=320;const q=c.getContext('2d',{willReadFrequently:true}),unique={},edges={},ends={};
   for(const id of ids){const hashes=[];let edge=0;for(let n=0;n<12;n++){q.clearRect(0,0,320,320);w.MythicHero.paintSkill(q,id,(n+.5)/12);hashes.push(c.toDataURL());const d=q.getImageData(0,0,320,320).data;for(let x=0;x<320;x++)edge=Math.max(edge,d[x*4+3],d[((319*320)+x)*4+3]);for(let y=0;y<320;y++)edge=Math.max(edge,d[(y*320)*4+3],d[(y*320+319)*4+3]);}unique[id]=new Set(hashes).size;edges[id]=edge;
    ends[id]=[0,1].map(t=>{q.clearRect(0,0,320,320);w.MythicHero.paintSkill(q,id,t);return q.getImageData(0,0,320,320).data.filter((v,i)=>i%4===3&&v>0).length});}
   const create=w.document.createElement,read=w.CanvasRenderingContext2D.prototype.getImageData;let allocations=0,reads=0,calls=0;const originalDraw=q.drawImage;
   w.document.createElement=function(tag,...a){if(tag==='canvas')allocations++;return create.call(this,tag,...a)};w.CanvasRenderingContext2D.prototype.getImageData=function(...a){reads++;return read.apply(this,a)};
   q.drawImage=function(...a){calls++;return originalDraw.apply(this,a)};const start=performance.now();try{for(let n=0;n<400;n++)w.MythicHero.paintSkill(q,ids[n%4],(n%59)/60,'all',n%2?1:2)}finally{w.document.createElement=create;w.CanvasRenderingContext2D.prototype.getImageData=read;q.drawImage=originalDraw}
   const warmMs=performance.now()-start;
   return{unique,edges,ends,allocations,reads,calls,warmMs,unchanged:b.snapshot()===before,mp4:MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42001f'),webcodecs:typeof VideoEncoder};
  });
  for(const n of Object.values(result.unique))assert.equal(n,12,'continuous reference-art animation is distinct');for(const n of Object.values(result.edges))assert.equal(n,0,'transparent VFX margins');for(const ends of Object.values(result.ends))assert.deepEqual(ends,[0,0],'effects begin/end cleanly');assert.equal(result.allocations,0);assert.equal(result.reads,0);assert(result.unchanged);
  await p.locator('#skill').selectOption('void_shuriken');await p.locator('#next').click();assert.match(await p.locator('#frame').textContent(),/^1 \/ /);await p.locator('#prev').click();assert.match(await p.locator('#frame').textContent(),/^0 \/ /);
  await p.locator('#speed').selectOption('2');await p.locator('#play').click();await p.waitForTimeout(120);await p.locator('#pause').click();const paused=await p.evaluate(()=>VfxLab.elapsed);await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>VfxLab.elapsed),paused);
  await p.locator('#loop').uncheck();await p.locator('#speed').selectOption('2');await p.locator('#restart').click();await p.waitForTimeout(800);assert.equal(await p.evaluate(()=>VfxLab.playing),false);
  fs.mkdirSync(out,{recursive:true});
  for(const id of Object.keys(manifest.clips)){await p.evaluate(id=>VfxLab.renderAt(id,.64,{background:'map'}),id);await p.locator('#preview').screenshot({path:path.join(out,'v6-'+id+'.png')});}
  await p.screenshot({path:path.join(out,'v6-lab-desktop.png')});await p.setViewportSize({width:390,height:844});await p.screenshot({path:path.join(out,'v6-lab-phone.png')});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const id of ['character','aura'])await p.locator('#'+id).uncheck();await p.locator('#background').selectOption('transparent');await p.locator('#direction').selectOption('back');await p.locator('#quality').selectOption('1');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'mythic-v6-results.json'),JSON.stringify(result,null,2));console.log('PASS: exact reference provenance, 4 continuous effects, clean endpoints/margins, no warm allocation/readback, no game mutation, developer-only route, all transport controls, desktop/mobile renders.',JSON.stringify(result));
 }finally{await browser.close();host.stop()}
 await withGame(async({p,f,errors})=>{
  const hero={tokenId:'v6-layer-fixture',name:'Tsukiyomi',rank:5,level:1,mythic:'tsukiyomi',baseStats:{pw:18,sp:18,st:18}};
  f.holdAdventure=false;f.profile=economy.normalizeProfile({...f.profile,heroes:[hero],battleReady:[hero.tokenId]});
  await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!LoginScreen.active);
  const layers=await p.evaluate(async()=>{
   await MythicHero.runtimeReady;await MythicHero.preload();const h=S.h.find(h=>h.r===5),time=performance.now();h.on=true;h.x=2;h.y=2;
   const before=JSON.stringify({heroes:S.h,bombs,map:S.map,ryo:S.ryo}),c=document.createElement('canvas');c.width=c.height=400;const q=c.getContext('2d'),old=MythicHero.paintSkill,calls=[];
   MythicHero.play(h,'ULTIMATE_DRAGON_ASCENSION',{now:time,force:true});MythicHero.paintSkill=(ctx,name,progress,layer,...a)=>{calls.push(layer);return old(ctx,name,progress,layer,...a)};
   try{MythicHero.drawGround(q,time+600,{proj:()=>[200,200],Sg:()=>1});CharacterAnimations.drawActorEffects(q,h,time+600,{x:200,y:200,scale:1.6,flip:false});}
   finally{MythicHero.paintSkill=old;MythicHero.resetAnimations();}
   return{calls,unchanged:before===JSON.stringify({heroes:S.h,bombs,map:S.map,ryo:S.ryo})};
  });
  assert.deepEqual(layers.calls,['ground','front'],'ultimate circle is behind the hero; dragon is in front');assert(layers.unchanged);assert.deepEqual(errors,[]);
 });
})().catch(e=>{console.error(e);process.exitCode=1});
