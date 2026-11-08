/* Bake the approved rig and code-native VFX. No poster pixels or replacement hero art. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp'),{chromium}=require('../../tests/node_modules/playwright');
const root=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const counts={IDLE:4,WALK:8,RUN:8,ATTACK:6,RANGED_ATTACK:6,HURT:4,DEFEAT:6,BOMB_PLACE:6,VICTORY:6};
async function bake(){
 const out={version:9,characterStatus:'approved-rig-baked-not-new-hand-drawn-reference-poses',effectStatus:'engine-baked-transparent-vfx',character:{},skills:{},sources:{}};
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const p=await browser.newPage();await p.setContent('<html><body></body></html>');
  for(const file of ['articulated-sprite.js','skill-effects.js']){const source=fs.readFileSync(path.join(root,file));out.sources[file]=sha(Buffer.from(source.toString().replace(/\r\n/g,'\n')));await p.addScriptTag({content:source.toString()})}
  for(const direction of ['front','left','right','back']){
   const file='character/tsukiyomi_'+direction+'.png',bytes=fs.readFileSync(path.join(root,'assets',file)),image='data:image/png;base64,'+bytes.toString('base64');out.sources[file]=sha(bytes);
   for(const [state,frames]of Object.entries(counts)){
    const data=await p.evaluate(async({image,direction,state,frames})=>{
     const img=new Image();img.src=image;await img.decode();const c=document.createElement('canvas');c.width=frames*128;c.height=128;const q=c.getContext('2d');
     for(let i=0;i<frames;i++){q.save();q.beginPath();q.rect(i*128,0,128,128);q.clip();q.translate(i*128+64,124);q.scale(.4,.4);TsukiyomiRig.paint(q,img,state==='WALK'?'WALK_'+direction.toUpperCase():state,state==='IDLE'?i*2:i,direction,state==='IDLE'?8:frames);q.restore()}
     return c.toDataURL().split(',')[1];
    },{image,direction,state,frames});
    const name=state.toLowerCase()+'_'+direction,relative='animations/approved-v9/'+name+'.png',dest=path.join(root,'assets',relative);fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.writeFileSync(dest,await sharp(Buffer.from(data,'base64')).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer());
    out.character[name]={path:relative,frames,width:frames*128,height:128,anchor:[64,124],sha256:sha(fs.readFileSync(dest))};
   }
  }
  const dragon=fs.readFileSync(path.join(root,'assets/skills/dragon-spirit-v3.png'));out.sources['skills/dragon-spirit-v3.png']=sha(dragon);
  for(const [id,frames]of Object.entries({dragon_slash:8,void_shuriken:8,raijin_field:10,mythic_dragon_ascension:12})){
   const layers={};
   for(const layer of ['ground','front']){
    const data=await p.evaluate(async({dragon,id,frames,layer})=>{
     const img=new Image();img.src=dragon;await img.decode();const atlas=document.createElement('canvas');atlas.width=frames*320;atlas.height=320;
     const cell=document.createElement('canvas');cell.width=cell.height=320;const c=cell.getContext('2d'),q=atlas.getContext('2d');
     for(let i=0;i<frames;i++){
      c.clearRect(0,0,320,320);
      if(layer!=='ground'||id==='raijin_field'||id==='mythic_dragon_ascension'){
       TsukiyomiEffects.paint(c,id,i,frames,layer,img);
       if(id==='dragon_slash'&&layer==='front'&&i>=3&&i<=6){c.save();c.globalAlpha=.15*Math.sin((i-2)/5*Math.PI);c.drawImage(img,114,74,90,110);c.restore()}
      }
      q.drawImage(cell,i*320,0);
     }
     return atlas.toDataURL().split(',')[1];
    },{dragon:'data:image/png;base64,'+dragon.toString('base64'),id,frames,layer});
    const relative='skills/clean-v9/'+id+'_'+layer+'.png',dest=path.join(root,'assets',relative);fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.writeFileSync(dest,await sharp(Buffer.from(data,'base64')).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer());
    layers[layer]={path:relative,width:frames*320,height:320,sha256:sha(fs.readFileSync(dest))};
   }
   out.skills[id]={frames,frameWidth:320,frameHeight:320,anchor:[160,160],layers};
  }
  fs.writeFileSync(path.join(root,'assets/metadata/production-v9.json'),JSON.stringify(out,null,2)+'\n');
  console.log('Baked 36 character atlases / 216 rig cells and 8 transparent VFX atlases / 38 layered effect stages. Original character and aura PNGs unchanged.');
 }finally{await browser.close()}
 return out;
}
module.exports={bake};if(require.main===module)bake().catch(e=>{console.error(e);process.exitCode=1});
