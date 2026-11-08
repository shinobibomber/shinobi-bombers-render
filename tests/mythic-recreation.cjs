'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),sharp=require('sharp'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'dev-vfx-lab/recreation'),out=path.join(root,'previews/mythic-recreation'),manifest=require('../dev-vfx-lab/recreation/manifest.json'),{start}=require('../dev-vfx-lab/local-server.cjs'),{allowed,handle}=require('../dev-vfx-lab/handler.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 fs.mkdirSync(out,{recursive:true});assert.deepEqual(Object.values(manifest.clips).map(s=>s.frameCount),[8,8,10,12]);assert.equal(manifest.source.sha256,sha(fs.readFileSync(path.join(root,manifest.source.path))));
 assert.equal(manifest.generatorSha256,sha(fs.readFileSync(path.join(dir,'authoring.js'),'utf8').replace(/\r\n/g,'\n')));
 const alphaResults=[];
 for(const[id,s]of Object.entries(manifest.clips)){
  const hashes=[];assert.equal(s.frames.length,s.frameCount);assert(Math.abs(s.frames.reduce((sum,f)=>sum+f.durationMs,0)-s.durationMs)<1e-6,'frame durations sum to the clip duration');
  for(const[layer,a]of Object.entries(s.layers)){
   const file=path.join(dir,a.path),m=await sharp(file).metadata();assert(m.hasAlpha);assert.equal(m.channels,4);assert.equal(m.width,a.width);assert.equal(m.height,a.height);assert.equal(sha(fs.readFileSync(file)),a.sha256);
   let peakEdge=0,visible=0,partial=0,empty=0;
   for(const f of s.frames){const[x,y,width,height]=f.rect;assert.deepEqual(f.anchor,[256,420]);const d=await sharp(file).extract({left:x,top:y,width,height}).raw().toBuffer();let ink=0;for(let py=0;py<512;py++)for(let px=0;px<512;px++){const alpha=d[(py*512+px)*4+3];if(alpha)ink++;else empty++;if(alpha>0&&alpha<255)partial++;if(px<16||py<16||px>=496||py>=496)peakEdge=Math.max(peakEdge,alpha)}visible+=ink;if(layer==='combined'){assert(ink>25,id+' visible frame '+f.index);hashes.push(sha(d))}}
   assert.equal(peakEdge,0,id+'/'+layer+' has 16px fully transparent margins');if(layer==='combined'){assert(partial>0&&empty>0);assert.equal(new Set(hashes).size,s.frameCount,id+' distinct frames')}
   alphaResults.push({id,layer,visible,partial,empty,peakEdge});
  }
 }
 for(const env of [{},{SHINOBI_VFX_LAB:'on',RENDER:'true'},{SHINOBI_VFX_LAB:'on',SOLANA_NETWORK:'mainnet'}])assert.equal(allowed({socket:{remoteAddress:'127.0.0.1'}},env),false);
 const host=await start(),browser=await chromium.launch({channel:'chrome',headless:true}),p=await browser.newPage({viewport:{width:1550,height:1100}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==host.url)return r.abort();if(['/api/ryo','/.netlify/functions/ryo'].includes(u.pathname))return r.fulfill({status:503,contentType:'application/json',body:'{"error":"Isolated art preview"}'});return r.continue()});
  await p.goto(host.url+'/vfx-lab/recreation');await p.waitForFunction(()=>window.RecreationLab?.ready,null,{timeout:60000});await p.locator('#pause').click();
  // Freeze the native background simulation in this isolated fixture so the
  // before/after assertion measures preview mutations, not ordinary game ticks.
  await p.frames().find(f=>new URL(f.url()).pathname==='/play/').evaluate(()=>{tick=()=>{}});
  const before=await p.evaluate(()=>({snapshot:RecreationLab.bridge.snapshot(),runtime:document.getElementById('engine').contentWindow.MythicHero.animationSource.presentationVersion,renderer:document.getElementById('engine').contentWindow.MythicHero.paintSkill.toString()}));
  const interpolation=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=512;const q=c.getContext('2d',{willReadFrequently:true}),r=RecreationLab.bridge.renderer;const sample=(p,frame)=>{q.clearRect(0,0,512,512);r.paint(q,'void_shuriken',p,'combined',{frame});return Array.from(q.getImageData(256,260,1,1).data)};return{a:sample(0,4),b:sample(0,5),mixed:sample(.64)}});const mix=.64*7-4;assert(Math.abs(interpolation.mixed[3]-(interpolation.a[3]*(1-mix)+interpolation.b[3]*mix))<=2,'interpolation retains opaque eclipse core');assert(interpolation.mixed[3]>240,'eclipse stays dark over bright maps');
  for(const[id,s]of Object.entries(manifest.clips)){
   await p.locator('#skill').selectOption(id);assert.equal(await p.locator('#filmstrip button').count(),s.frameCount);await p.locator('#next').click();assert.equal(await p.locator('#frame').textContent(),'2 / '+s.frameCount);await p.locator('#prev').click();assert.equal(await p.locator('#frame').textContent(),'1 / '+s.frameCount);
   await p.evaluate(id=>RecreationLab.renderAt(id,.64,{background:'map'}),id);await p.locator('#preview').screenshot({path:path.join(out,id+'-adventure.png')});
   const sheet=await p.request.get(host.url+'/vfx-lab/recreation/'+s.layers.combined.path);assert.equal(sheet.status(),200);assert.equal(sha(await sheet.body()),s.layers.combined.sha256);
  }
  await p.locator('#speed').selectOption('0.5');await p.locator('#restart').click();await p.waitForTimeout(250);await p.locator('#pause').click();const slow=await p.evaluate(()=>RecreationLab.elapsed);assert(slow>20&&slow<350);await p.waitForTimeout(80);assert.equal(await p.evaluate(()=>RecreationLab.elapsed),slow);
  await p.locator('#loop').uncheck();await p.locator('#speed').selectOption('2');await p.locator('#restart').click();await p.waitForFunction(()=>!RecreationLab.playing,null,{timeout:4000});
  await p.evaluate(()=>RecreationLab.renderAt('void_shuriken',.6,{frame:5,background:'transparent',character:false,aura:false}));
  const transparency=await p.evaluate(()=>{const c=document.getElementById('preview'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let blank=0,ink=0;for(let i=3;i<d.length;i+=4){if(d[i])ink++;else blank++}return{blank,ink}});assert(transparency.blank>100000&&transparency.ink>1000);
  const downloadPromise=p.waitForEvent('download');await p.locator('#save-frame').click();const download=await downloadPromise;const frameFile=path.join(out,'downloaded-transparent-frame.png');await download.saveAs(frameFile);assert((await sharp(frameFile).metadata()).hasAlpha);
  await p.evaluate(()=>RecreationLab.renderAt('mythic_dragon_ascension',.64,{background:'map',character:true,aura:true}));await p.screenshot({path:path.join(out,'review-desktop.png'),fullPage:true});
  const contact=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1800;const q=c.getContext('2d');const panel=document.createElement('canvas');panel.width=800;panel.height=450;const pc=panel.getContext('2d');Object.keys(RecreationLab.bridge.manifest.clips).forEach((id,i)=>{for(let j=0;j<2;j++){RecreationLab.bridge.paint(pc,id,j?.67:.32,{background:j?'map':'dark',character:true,aura:true});q.drawImage(panel,j*800,i*450);q.fillStyle='#0b0712e8';q.fillRect(j*800,i*450,800,42);q.fillStyle='#f3e9ff';q.font='bold 19px system-ui';q.fillText(RecreationLab.bridge.manifest.clips[id].name+(j?' · Adventure':' · Formation'),j*800+18,i*450+28)}});return c.toDataURL().split(',')[1]});fs.writeFileSync(path.join(out,'showcase.png'),Buffer.from(contact,'base64'));
  await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(out,'review-phone.png'),fullPage:true});
  const after=await p.evaluate(()=>({snapshot:RecreationLab.bridge.snapshot(),runtime:document.getElementById('engine').contentWindow.MythicHero.animationSource.presentationVersion,renderer:document.getElementById('engine').contentWindow.MythicHero.paintSkill.toString()}));assert.deepEqual(after,before,'preview never alters character, aura, rarity, game state or active renderer');assert.deepEqual(errors,[]);
  for(const url of ['/vfx-lab/recreation/authoring.js','/vfx-lab/recreation/masters/dragon_slash.png','/vfx-lab/recreation/../../package.json','/vfx-lab/__proto__'])assert.equal((await p.request.get(host.url+url)).status(),404,'only explicit preview assets are served');
  fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify({node:process.version,frames:38,alphaResults,transparency,gameStatePreserved:true,errors,mp4Supported:await p.evaluate(()=>MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42001f'))},null,2));
 }finally{await browser.close();host.stop()}
 const baseline=JSON.parse(fs.readFileSync(path.join(dir,'preservation.json'))),localBaseline=path.join(root,'tests/out/mythic-recreation-preservation.json');if(fs.existsSync(localBaseline))Object.assign(baseline,JSON.parse(fs.readFileSync(localBaseline)));Object.assign(baseline,require('../dev-vfx-lab/recreation/release-preservation.json'));for(const[file,hash]of Object.entries(baseline))assert.equal(sha(fs.readFileSync(path.join(root,file))),hash,'protected source/build matches review or authorized release: '+file);
 console.log('PASS: 38 distinct frames, 12 RGBA atlases, transparent margins, hash provenance, preview controls, real PNG download, desktop/phone comparison, local-only routes and '+Object.keys(baseline).length+' protected source/build files (nine authorized integration overrides).');
})().catch(e=>{console.error(e);process.exitCode=1});
