'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{chromium}=require('playwright'),{start}=require('../dev-vfx-lab/local-server.cjs');
const root=path.resolve(__dirname,'..'),review=require('../dev-vfx-lab/recreation/manifest.json'),live=require('../mythic-hero/assets/metadata/animations.json'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 assert.equal(live.presentationVersion,11);let sheets=0;
 for(const[id,s]of Object.entries(review.clips)){
  const actual=live.skills[id];assert.equal(actual.renderer,'baked-v11');assert.equal(actual.durationMs,s.durationMs);assert.equal(actual.requiredFrames,s.frameCount);assert.deepEqual(actual.anchor,s.anchor);assert.equal(actual.columns,4);
  for(const layer of ['ground','front']){const a=actual.layers[layer];for(const prefix of ['mythic-hero/assets','app/public/assets/mythic-hero'])assert.equal(sha(fs.readFileSync(path.join(root,prefix,a.path))),s.layers[layer].sha256,'reviewed art survives packaging');sheets++}
 }
 const host=await start(),browser=await chromium.launch({channel:'chrome',headless:true}),p=await browser.newPage();
 try{
  await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==host.url)return r.abort();if(['/api/ryo','/.netlify/functions/ryo'].includes(u.pathname))return r.fulfill({status:503,body:'{}'});return r.continue()});
  await p.goto(host.url+'/vfx-lab/recreation');await p.waitForFunction(()=>window.RecreationLab?.ready,null,{timeout:60000});
  const result=await p.evaluate(()=>{
   const m=document.getElementById('engine').contentWindow.MythicHero,r=RecreationLab.bridge.renderer,a=document.createElement('canvas'),b=document.createElement('canvas'),master=document.createElement('canvas');a.width=a.height=b.width=b.height=320;master.width=master.height=512;
   const ca=a.getContext('2d',{willReadFrequently:true}),cb=b.getContext('2d',{willReadFrequently:true}),cm=master.getContext('2d');let frames=0;
   for(const[id,s]of Object.entries(r.manifest.clips))for(let n=0;n<s.frameCount;n++)for(const layer of ['ground','front']){
    ca.clearRect(0,0,320,320);cb.clearRect(0,0,320,320);cm.clearRect(0,0,512,512);m.paintSkill(ca,id,.5,layer,2,n);r.paint(cm,id,.5,layer,{frame:n});cb.drawImage(master,0,0,320,320);
    const x=ca.getImageData(0,0,320,320).data,y=cb.getImageData(0,0,320,320).data;if(!x.every((v,i)=>v===y[i]))throw Error('Frame differs from review: '+id+'/'+layer+'/'+n);frames++;
   }
   ca.clearRect(0,0,320,320);m.paintSkill(ca,'void_shuriken',.64,'front');const alpha=ca.getImageData(160,162,1,1).data[3];if(alpha<240)throw Error('Eclipse lost opacity');return{layerFrames:frames,eclipseAlpha:alpha};
  });
  assert.equal(result.layerFrames,76);console.log('PASS: '+sheets+' deployed sheets match review hashes; 76 runtime layer frames pixel-match the preview; interpolation retains opaque eclipse core.',result);
 }finally{await browser.close();host.stop()}
})().catch(e=>{console.error(e);process.exitCode=1});
