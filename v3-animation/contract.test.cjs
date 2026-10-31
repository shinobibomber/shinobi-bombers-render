const assert=require('node:assert/strict'),zlib=require('node:zlib'),fs=require('node:fs'),path=require('node:path');
const contract=require('./animation-contract.js'),{inspectPng,crc32}=require('./validate-production-assets.cjs');
function png(width,height,pixels,filterMode=0){
 const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,8+data.length)),8+data.length);return b;},header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++){raw[y*(width*4+1)]=filterMode;for(let x=0;x<width*4;x++){const at=y*width*4+x,up=y?pixels[at-width*4]:0;raw[y*(width*4+1)+x+1]=filterMode===2?(pixels[at]-up)&255:pixels[at];}}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const good={schemaVersion:1,classification:'production-frames',kind:'hero',modelId:'fire',visualOnly:true,canvas:[2,2],anchor:[.5,.88],textures:['idle/000.png'],clips:[{action:'idle',direction:'down',fps:8,loop:true,frames:[{texture:'idle/000.png',rect:[0,0,2,2]}]}]};
const rgba=Buffer.from([0,0,0,0,255,25,15,255,50,45,55,128,0,0,0,0]),pixels=inspectPng(png(2,2,rgba)),textures={'idle/000.png':pixels};
assert.equal(pixels.transparent,2);assert.equal(pixels.partial,1);assert.equal(pixels.opaque,1);assert.equal(inspectPng(png(2,2,rgba,2)).sha256.length,64);assert.deepEqual(inspectPng(png(2,2,rgba,2)).transparent,pixels.transparent);
assert(contract.validatePackage(good,{textures,knownModelIds:['fire']}).ok);assert(!contract.validatePackage({...good,classification:'concept-reference'},{textures}).ok);
assert(!contract.validatePackage(good,{textures:{'idle/000.png':{...pixels,hasTransparentPixels:false}}}).ok,'painted/opaque checkerboards fail alpha contract');
assert(!contract.validatePackage(good,{textures:{'idle/000.png':{...pixels,hasVisiblePixels:false}}}).ok,'empty assets are rejected');
assert(!contract.validatePackage({...good,anchor:[NaN,2]},{textures}).ok);
assert(!contract.validatePackage({...good,canvas:[512,512]},{textures}).ok);
assert(!contract.validatePackage({...good,modelId:'hayate'},{textures,knownModelIds:['fire']}).ok,'unmapped identities cannot be silently substituted');
assert(!contract.validatePackage({...good,textures:['../poster.png']},{textures}).ok);
assert(!contract.validatePackage({...good,textures:['https://outside.example/pose.png']},{textures}).ok);
assert(!contract.validatePackage({...good,clips:[{...good.clips[0],direction:'diagonal'}]},{textures}).ok);
assert(!contract.validatePackage({...good,clips:[{...good.clips[0],frames:[{texture:'idle/000.png',rect:[1,0,2,2]}]}]},{textures}).ok);
assert(!contract.validatePackage({...good,clips:[{...good.clips[0],frames:[{texture:'idle/000.png',rect:[0,0,2,2],events:[{name:'apply_damage',damage:10}]}]}]},{textures}).ok,'visual metadata cannot issue damage');
for(const bad of [null,[],{}, {textures:{},clips:{}},{...good,clips:[null]},{...good,clips:[{...good.clips[0],frames:[null]}]},{...good,clips:[{...good.clips[0],frames:[{texture:'idle/000.png',rect:[0,0,2,2],events:{}}]}]}])assert.doesNotThrow(()=>contract.validatePackage(bad,{textures}));
assert.throws(()=>inspectPng(Buffer.from('not a png')),/PNG/);assert.throws(()=>contract.inspectRgba(new Uint8Array(3),2,2),/RGBA/);
for(const [dx,dy,expected]of[[1,0,'right'],[-1,0,'left'],[0,1,'down'],[0,-1,'up']])assert.equal(contract.directionFromVector(dx,dy),expected);assert.equal(contract.directionFromVector(0,0,'up'),'up');
const clip={fps:8,loop:true,frames:[0,1,2,3]};assert.equal(contract.frameAt(clip,625),1);assert.equal(contract.frameAt(clip,625,{reducedMotion:true}),0);assert.equal(contract.frameAt({...clip,loop:false},5000),3);assert.equal(contract.frameAt(clip,5000,{playing:false,frozenMs:250}),2);
let now=0;const clock=contract.createClock(()=>now);now=100;assert.equal(clock.elapsed,100);clock.pause();now=10000;assert.equal(clock.elapsed,100);clock.resume();now=10150;assert.equal(clock.elapsed,250);clock.reset();assert.equal(clock.elapsed,0);
const inventory=JSON.parse(fs.readFileSync(path.join(__dirname,'inventory.json'),'utf8'));assert.equal(inventory.nativeModels.length,8);assert.equal(inventory.canonicalV3Models.length,12);assert(inventory.canonicalV3Models.every(m=>m.status==='production-frames-missing'&&m.mappedRuntimeIndex===null));assert.equal(inventory.rarities.length,5);assert.equal(inventory.rarities[0].color,'#eef7ff');assert(inventory.nativeModels.every(m=>m.element&&m.clips.idle.frames>0));
console.log('PASS: production contract rejects posters/opaque backgrounds, invalid paths, clips, dimensions, anchors and gameplay events; clock/direction/reduced-motion rules and honest 8+12 inventory verified.');
