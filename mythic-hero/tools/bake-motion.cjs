/* Deterministically bakes the game's skinned sprite renderer into 128px RGBA atlases.
 * Uses only approved character textures, not another hero's anatomy or generated body art. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp'),{chromium}=require('../../tests/node_modules/playwright');
const root=path.resolve(__dirname,'..'),target=path.join(root,'assets/animations/rig-v3');
(async()=>{
 fs.mkdirSync(target,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const p=await browser.newPage();await p.setContent('<html><body></body></html>');await p.addScriptTag({content:fs.readFileSync(path.join(root,'articulated-sprite.js'),'utf8')});
  const result={version:3,source:'approved-views-skeletal-mesh',generatorSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'articulated-sprite.js'),'utf8').replace(/\r\n/g,'\n')).digest('hex'),clips:{}};
  for(const direction of ['front','left','right','back']){
   const file=path.join(root,'assets/character/tsukiyomi_'+direction+'.png'),image='data:image/png;base64,'+fs.readFileSync(file).toString('base64');
   for(const [state,frames]of [['walk',8],['run',8],['attack',6],['idle',8],['ranged_attack',6]]){
    const pixels=await p.evaluate(async({image,direction,state,frames})=>{
     const img=new Image();img.src=image;await img.decode();const atlas=document.createElement('canvas');atlas.width=frames*128;atlas.height=128;
     const c=atlas.getContext('2d');for(let i=0;i<frames;i++){c.save();c.beginPath();c.rect(i*128,0,128,128);c.clip();c.translate(i*128+64,124);c.scale(.4,.4);TsukiyomiRig.paint(c,img,state==='walk'?'WALK_'+direction.toUpperCase():state.toUpperCase(),i,direction,frames);c.restore()}return atlas.toDataURL().split(',')[1];
    },{image,direction,state,frames});
    const name=state+'_'+direction+'.png';fs.writeFileSync(path.join(target,name),await sharp(Buffer.from(pixels,'base64')).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer());
    result.clips[state+'_'+direction]={path:'animations/rig-v3/'+name,frames,sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
   }
  }
  fs.writeFileSync(path.join(root,'assets/metadata/rig-v3.json'),JSON.stringify(result,null,2)+'\n');console.log('Baked 20 approved-view atlases: four-direction walk/run/melee/ranged/idle, 144 frames.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
