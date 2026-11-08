'use strict';
// Promote the reviewed RGBA bytes without regenerating or resampling the art.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),review=path.join(root,'dev-vfx-lab/recreation'),assets=path.join(root,'mythic-hero/assets'),source=JSON.parse(fs.readFileSync(path.join(review,'manifest.json')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const production={version:11,effectStatus:'reviewed-poster-recreation-rgba',reference:{path:'reference/mythic-skill-v6.png',sha256:source.source.sha256,status:'composite-reference-faithful-recreation'},generator:{path:'../dev-vfx-lab/recreation/authoring.js',sha256:source.generatorSha256},method:source.method,cell:source.cell,skills:{}};
fs.mkdirSync(path.join(assets,'skills/poster-v11'),{recursive:true});
for(const[id,s]of Object.entries(source.clips)){
 const clip=production.skills[id]={frames:s.frameCount,frameWidth:512,frameHeight:512,columns:4,anchor:s.anchor,durationMs:s.durationMs,layers:{}};
 for(const layer of ['ground','front']){
  const a=s.layers[layer],bytes=fs.readFileSync(path.join(review,a.path));if(sha(bytes)!==a.sha256)throw Error('Review hash mismatch: '+id+'/'+layer);
  const dest='skills/poster-v11/'+id+'_'+layer+'.png';fs.writeFileSync(path.join(assets,dest),bytes);clip.layers[layer]={...a,path:dest};
 }
}
fs.writeFileSync(path.join(assets,'metadata/production-v11.json'),JSON.stringify(production,null,2)+'\n');
console.log('Promoted eight reviewed atlas files byte-for-byte; 38 animation frames.');
