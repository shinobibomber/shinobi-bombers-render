'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),sharp=require('sharp'),{chromium}=require('../../tests/node_modules/playwright');
const root=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await browser.newPage();await p.setContent('<html></html>');const source=fs.readFileSync(path.join(root,'motion-effects.js'),'utf8');await p.addScriptTag({content:source});
 const reference=fs.readFileSync(path.join(root,'reference/skill-motion-v10.png')),info=await sharp(reference).metadata();
 const result={version:10,effectStatus:'engine-baked-motion-study-vfx-not-poster-crops',reference:{path:'reference/skill-motion-v10.png',sha256:sha(reference),width:info.width,height:info.height,status:'static-composite-reference-only'},generator:{path:'motion-effects.js',sha256:sha(source.replace(/\r\n/g,'\n'))},skills:{}};
 for(const [id,frames]of Object.entries({dragon_slash:8,void_shuriken:8,raijin_field:10,mythic_dragon_ascension:12})){
  const layers={};for(const layer of ['ground','front']){
   const data=await p.evaluate(({id,frames,layer})=>{const atlas=document.createElement('canvas'),cell=document.createElement('canvas');atlas.width=frames*320;atlas.height=cell.width=cell.height=320;const q=atlas.getContext('2d'),c=cell.getContext('2d');for(let i=0;i<frames;i++){c.clearRect(0,0,320,320);TsukiyomiMotionEffects.paint(c,id,i,frames,layer);q.drawImage(cell,i*320,0)}return atlas.toDataURL().split(',')[1]},{id,frames,layer});
   const relative='skills/motion-v10/'+id+'_'+layer+'.png',dest=path.join(root,'assets',relative);fs.mkdirSync(path.dirname(dest),{recursive:true});const bytes=await sharp(Buffer.from(data,'base64')).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer();fs.writeFileSync(dest,bytes);layers[layer]={path:relative,width:frames*320,height:320,sha256:sha(bytes)};
  }result.skills[id]={frames,frameWidth:320,frameHeight:320,anchor:[160,160],layers};
 }
 fs.writeFileSync(path.join(root,'assets/metadata/production-v10.json'),JSON.stringify(result,null,2)+'\n');console.log('Baked four motion-study skills: 8 RGBA layers / 38 stages; no hero or aura pixels changed.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
