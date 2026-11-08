'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const {chromium}=require('../../tests/node_modules/playwright');
const root=path.resolve(__dirname,'../..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const specs={dragon_slash:['Dragon Crescent Gale',8,1000,['spark','crescent','expansion','dragon formation','sweep','full crescent','energy trail','dissipation']],void_shuriken:['Void Eclipse Shuriken',8,1200,['spark','shuriken','rotation','orbit','eclipse formation','full eclipse','collapse','energy explosion']],raijin_field:['Thunder Chain Vortex',10,1500,['ground charge','lightning seed','pillars','rising bolts','spiral formation','chains','swirling vortex','full vortex','discharge','ground burst']],mythic_dragon_ascension:['Mythic Dragon Dominion',12,2000,['sigil charge','energy seed','pillars','formation','dragon emergence','coiling dragon','ascension','full dragon','celestial crest','descent energy','impact','energy burst']]};
(async()=>{
 const old=JSON.parse(fs.readFileSync(path.join(root,'mythic-hero/assets/metadata/skills-v6.json'))),elementsFile=path.join(root,'mythic-hero/assets/skills/reference-v6.png');
 const masterBuffers=Object.fromEntries(Object.keys(specs).map(id=>[id,fs.readFileSync(path.join(__dirname,'masters',id+'.png'))]));
 for(const [id,bytes]of Object.entries(masterBuffers)){const m=await sharp(bytes).metadata();if(!m.hasAlpha)throw Error('Missing generated alpha: '+id);}
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const p=await browser.newPage();await p.setContent('<html><body></body></html>');await p.addScriptTag({content:fs.readFileSync(path.join(__dirname,'authoring.js'),'utf8')});
  await p.evaluate(async({masters,elements,tiles})=>{const load=src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src='data:image/png;base64,'+src});window.assets={masters:Object.fromEntries(await Promise.all(Object.entries(masters).map(async([id,b])=>[id,await load(b)]))),elements:await load(elements),tiles}}, {masters:Object.fromEntries(Object.entries(masterBuffers).map(([id,b])=>[id,b.toString('base64')])),elements:fs.readFileSync(elementsFile).toString('base64'),tiles:old.tiles});
  const result={version:11,status:'preview-only-awaiting-art-review',source:{path:'mythic-hero/reference/mythic-skill-v6.png',sha256:old.source.sha256},method:'Four imagegen RGBA master effects, recovered original reusable elements, deterministic Canvas transformation/deformation and keyframe interpolation. Not independently hand-drawn frames.',generatorSha256:sha(fs.readFileSync(path.join(__dirname,'authoring.js'),'utf8').replace(/\r\n/g,'\n')),cell:{width:512,height:512,columns:4,spacing:0,anchor:[256,420],transparentMargin:16},palette:['violet','purple','near-black','gold','white-purple highlights'],integration:{adventure:false,hunt:false,economy:false,characterChanged:false,auraChanged:false,rarityChanged:false},masters:Object.fromEntries(Object.entries(masterBuffers).map(([id,b])=>[id,{path:'masters/'+id+'.png',sha256:sha(b)}])),reused:{path:'mythic-hero/assets/skills/reference-v6.png',sha256:sha(fs.readFileSync(elementsFile)),elements:['crescent','void_shuriken_3','void_shuriken_4','sigil','gold_circle','pillar','impact','flash','vortex']},clips:{}};
  fs.mkdirSync(path.join(__dirname,'assets'),{recursive:true});
  for(const [id,[name,count,durationMs,phases]]of Object.entries(specs)){
   const layers={};
   for(const layer of ['ground','front','combined']){
    const encoded=await p.evaluate(({id,count,layer})=>{const c=document.createElement('canvas');c.width=2048;c.height=Math.ceil(count/4)*512;const q=c.getContext('2d');for(let n=0;n<count;n++){q.save();q.translate(n%4*512,Math.floor(n/4)*512);if(layer!=='front')MythicRecreationAuthoring.paint(q,id,n/(count-1),'ground',assets);if(layer!=='ground')MythicRecreationAuthoring.paint(q,id,n/(count-1),'front',assets);q.restore()}return c.toDataURL().split(',')[1]},{id,count,layer});
    const file=id+'_'+layer+'.png',bytes=await sharp(Buffer.from(encoded,'base64')).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer();fs.writeFileSync(path.join(__dirname,'assets',file),bytes);layers[layer]={path:'assets/'+file,width:2048,height:Math.ceil(count/4)*512,sha256:sha(bytes)};
   }
   result.clips[id]={name,keyStages:count,frameCount:count,durationMs,fps:count*1000/durationMs,loop:false,anchor:[256,420],frameWidth:512,frameHeight:512,layers,frames:Array.from({length:count},(_,i)=>({index:i,rect:[i%4*512,Math.floor(i/4)*512,512,512],durationMs:durationMs/count,anchor:[256,420],phase:phases[i]})),damage:false,chakraCost:0};console.log('Baked '+name+': '+count+' transparent 512px frames / ground, front and combined');
  }
  fs.writeFileSync(path.join(__dirname,'manifest.json'),JSON.stringify(result,null,2)+'\n');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
