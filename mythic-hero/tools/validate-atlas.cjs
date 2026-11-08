/* Validates supplied art without editing it. Visual identity/text review is still required. */
'use strict';
const assert=require('node:assert/strict'),sharp=require('sharp'),path=require('node:path');
async function validate(file,frames,columns=frames){
 assert(Number.isSafeInteger(frames)&&frames>0&&frames<=64);assert(Number.isSafeInteger(columns)&&columns>0&&columns<=frames);
 const meta=await sharp(file).metadata();assert.equal(meta.format,'png');assert.equal(meta.channels,4,'must be RGBA');assert(meta.hasAlpha);
 assert.equal(meta.width,columns*128);assert.equal(meta.height,Math.ceil(frames/columns)*128);
 const {data,info}=await sharp(file).raw().toBuffer({resolveWithObject:true});const bounds=[];
 for(let i=0;i<frames;i++){
  const ox=i%columns*128,oy=Math.floor(i/columns)*128;let pixels=0,minX=128,minY=128,maxX=0,maxY=0;
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
   const alpha=data[((oy+y)*info.width+ox+x)*4+3];
   if(x===0||y===0||x===127||y===127)assert(alpha<16,'frame '+i+' touches an edge');
   if(alpha>40){pixels++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}
  }
  assert(pixels>500,'frame '+i+' is empty or too small');bounds.push({frame:i,x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1,footY:maxY});
 }
 return {file:path.basename(file),frames,columns,anchor:[64,124],bounds,visualReviewRequired:true};
}
if(require.main===module)validate(process.argv[2],Number(process.argv[3]),Number(process.argv[4]||process.argv[3])).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={validate};
