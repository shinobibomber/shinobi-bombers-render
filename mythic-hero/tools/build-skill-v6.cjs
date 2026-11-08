/* Reference-derived VFX, not new HD production artwork. Never redraws source RGB. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const root=path.resolve(__dirname,'..'),file=path.join(root,'reference/mythic-skill-v6.png');
const rows={
 dragon_slash:{name:'Dragon Slash',stages:8,y:151,h:94,x:[[316,55],[378,76],[454,80],[534,84],[618,84],[702,84],[786,104]]},
 void_shuriken:{name:'Void Shuriken',stages:8,y:333,h:82,x:[[311,56],[378,64],[447,66],[517,68],[589,72],[663,73],[737,77],[816,84]]},
 raijin_field:{name:'Raijin Field',stages:10,y:503,h:92,x:[[303,52],[357,60],[419,65],[486,65],[553,66],[621,65],[687,66],[753,70],[824,86]]},
 mythic_dragon_ascension:{name:'Mythic Dragon Ascension',stages:12,y:687,h:113,x:[[303,45],[349,45],[396,45],[443,46],[490,48],[539,51],[591,55],[647,57],[705,56],[762,62],[825,83]]}
};
const elements={sigil:[27,918,130,79],gold_circle:[171,921,127,73],crescent:[310,918,130,81],vortex:[445,919,104,80],flash:[554,918,88,80],crystals:[649,917,125,82],pillar:[781,918,90,80],impact:[877,916,106,82],flame:[993,918,122,80],trail:[1122,928,122,62]};
async function build(){
 const bytes=fs.readFileSync(file),meta=await sharp(bytes).metadata();if(meta.width!==1536||meta.height!==1024)throw Error('Expected the supplied 1536 x 1024 Mythic Skill reference.');
 const tiles={},clips={},layers=[],cell=160,columns=8;let n=0;
 async function add(key,rect,bottom){
  const [left,top,width,height]=rect,{data}=await sharp(bytes).extract({left,top,width,height}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  // Alpha only: RGB values retain the supplied colour. Border/labels stay outside crops.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,high=Math.max(data[i],data[i+1],data[i+2]),edge=Math.min(x,y,width-1-x,height-1-y),border=!key.includes('gold_circle')&&data[i]>data[i+2]*1.5&&data[i]>data[i+1]*1.1;data[i+3]=border?0:Math.round(255*Math.max(0,Math.min(1,(high-14)/30))*Math.min(1,edge/3));}
  const x=n%columns*cell+Math.floor((cell-width)/2),y=Math.floor(n/columns)*cell+cell-height-4;n++;
  layers.push({input:await sharp(data,{raw:{width,height,channels:4}}).png().toBuffer(),left:x,top:y});
  tiles[key]={rect:[x,y,width,height],anchor:[width/2,bottom?height-7:height/2],sourceRect:rect};return key;
 }
 for(const [id,row]of Object.entries(rows)){const frames=[];for(let i=0;i<row.x.length;i++)frames.push(await add(id+'_'+i,[row.x[i][0],row.y,row.x[i][1],row.h],id==='raijin_field'||id==='mythic_dragon_ascension'));clips[id]={name:row.name,keyStages:row.stages,sourceFrames:frames,durationMs:({dragon_slash:1000,void_shuriken:1200,raijin_field:1500,mythic_dragon_ascension:2000})[id],loop:false,layer:id==='raijin_field'?'split':'foreground',origin:[160,160],anchor:[160,160],visualPeak:.68,damage:false,chakraCost:0};}
 for(const [key,rect]of Object.entries(elements))await add(key,rect,false);
 const height=Math.ceil(n/columns)*cell,out=path.join(root,'assets/skills');fs.mkdirSync(out,{recursive:true});
 await sharp({create:{width:columns*cell,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(layers).png({compressionLevel:9}).toFile(path.join(out,'reference-v6.png'));
 const manifest={version:6,assetStatus:'reference-derived-native-resolution-not-HD-production-art',source:{path:'reference/mythic-skill-v6.png',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),width:1536,height:1024,hasAlpha:false},atlas:{path:'skills/reference-v6.png',width:columns*cell,height,format:'PNG RGBA'},clips,tiles,notes:['Poster labels omit some stage numbers: actual separable rows contain 7/8/9/11 drawings.','8/8/10/12 logical stages use time-based interpolation, not fabricated source frames.','Native RGB and geometry retained; exterior alpha and two-pixel edge feather only.','Clean isolated high-resolution effects and separate authored ground/foreground exports remain missing.']};
 fs.writeFileSync(path.join(root,'assets/metadata/skills-v6.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(require.main===module)build().then(m=>console.log('Reference VFX atlas:',Object.keys(m.tiles).length,'native crops; source',m.source.sha256)).catch(e=>{console.error(e);process.exitCode=1});
module.exports={build};
