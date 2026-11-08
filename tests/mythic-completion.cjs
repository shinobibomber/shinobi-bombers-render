'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const {validate}=require('../mythic-hero/tools/validate-atlas.cjs'),R=require('../mythic-hero/automatic-skills.js'),meta=require('../mythic-hero/assets/metadata/production-v9.json');
const root=path.resolve(__dirname,'..'),digest=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 let characters=0,stages=0;
 for(const clip of Object.values(meta.character)){
  const file=path.join(root,'mythic-hero/assets',clip.path);assert.equal(digest(fs.readFileSync(file)),clip.sha256);await validate(file,clip.frames);characters+=clip.frames;
 }
 assert.equal(Object.keys(meta.character).length,36);assert.equal(characters,216);
 for(const [id,clip]of Object.entries(meta.skills)){
  const sums=Array(clip.frames).fill(0),unique=Array(clip.frames).fill('');
  for(const [layer,a]of Object.entries(clip.layers)){
   const file=path.join(root,'mythic-hero/assets',a.path),m=await sharp(file).metadata();assert.equal(digest(fs.readFileSync(file)),a.sha256);assert.deepEqual([m.width,m.height,m.channels],[clip.frames*320,320,4]);
   for(let n=0;n<clip.frames;n++){
    const bytes=await sharp(file).extract({left:n*320,top:0,width:320,height:320}).raw().toBuffer();let pixels=0,edge=0;
    for(let y=0;y<320;y++)for(let x=0;x<320;x++){const alpha=bytes[(y*320+x)*4+3];if(alpha>10)pixels++;if(x===0||y===0||x===319||y===319)edge=Math.max(edge,alpha)}
    assert.equal(edge,0,id+'/'+layer+' transparent margins');sums[n]+=pixels;unique[n]+=digest(bytes);
   }
  }
  assert(sums.every(n=>n>50),id+' has visible content at every combined stage');assert.equal(new Set(unique).size,clip.frames,id+' distinct combined ground/front stages');stages+=clip.frames;
 }
 assert.equal(stages,38);
 const event={scope:'wallet',heroId:'nft-a',mode:'adventure',stream:'one',eligible:true,targetValid:true,chakraSpent:true,staminaEligible:true,melee:true,ranged:true,areaEligible:true,ultimateEligible:true};
 const saved=new Map(),c=R.create({write:(k,v)=>saved.set(k,structuredClone(v))}),seen={};
 for(let n=1;n<=100;n++){
  const e={...event,ordinal:n,now:n*1000},id=c.select(e);if(id){if(seen[id]!=null)assert(e.now-seen[id]>=R.definitions[id].cooldownMs,id+' independent approved interval');seen[id]=e.now}assert.equal(c.select(e),id,'same-event copies retain their original selection');
 }
 assert.equal(Object.keys(seen).length,4);assert.deepEqual(Object.values(c.rules).map(d=>d.cooldownMs),[12000,18000,24000,30000]);assert(Object.isFrozen(c.rules));
 const resumed=R.create({read:k=>saved.get(k)});assert.equal(resumed.select({...event,ordinal:100,now:100000}),c.select({...event,ordinal:100,now:100000}));assert.deepEqual(resumed.inspect('wallet','nft-a').used,c.inspect('wallet','nft-a').used);
 const files=['website-design/website-design.js','mythic-hero/mythic-hero.js'];for(const f of files)assert(!/Seven-star Mythic|★★★★★★★/.test(fs.readFileSync(path.join(root,f),'utf8')),'no Mythic star-rating UI');
 console.log('PASS: 36 RGBA character atlases / 216 aligned cells, 38 clean layered VFX stages, exact source hashes, transparent margins, unique effect stages, approved 12/18/24/30-second intervals and reconnect replay protection.');
})().catch(e=>{console.error(e);process.exitCode=1});
