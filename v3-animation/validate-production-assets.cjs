/* Offline PNG RGBA validator using Node built-ins; no art generation or uploads. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),contract=require('./animation-contract.js');
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function inspectPng(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<45||!bytes.subarray(0,8).equals(signature))throw Error('Expected a PNG file.');
 let offset=8,header=null,ended=false,compressed=[];
 while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),end=offset+12+length;if(length>64*1024*1024||end>bytes.length)throw Error('Truncated or oversized PNG chunk.');if(crc32(bytes.subarray(offset+4,offset+8+length))!==bytes.readUInt32BE(offset+8+length))throw Error('PNG chunk checksum mismatch.');const data=bytes.subarray(offset+8,offset+8+length);
  if(type==='IHDR'){if(header||length!==13)throw Error('Invalid PNG header.');header={width:data.readUInt32BE(0),height:data.readUInt32BE(4),depth:data[8],color:data[9],compression:data[10],filter:data[11],interlace:data[12]};}
  if(type==='IDAT')compressed.push(data);if(type==='IEND'){ended=true;break;}offset=end;
 }
 if(!header||!ended||!compressed.length)throw Error('PNG is missing required chunks.');
 const {width,height,depth,color,compression,filter,interlace}=header;
 if(width<1||height<1||width>4096||height>4096)throw Error('PNG dimensions exceed the production texture limit.');
 if(depth!==8||color!==6||compression!==0||filter!==0||interlace!==0)throw Error('Use an 8-bit non-interlaced true-color RGBA PNG; opaque RGB/concept images are not production frames.');
 const stride=width*4,expected=(stride+1)*height,raw=zlib.inflateSync(Buffer.concat(compressed),{maxOutputLength:expected});if(raw.length!==expected)throw Error('PNG pixel size mismatch.');
 const pixels=Buffer.alloc(stride*height),paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const mode=raw[y*(stride+1)];if(mode>4)throw Error('Invalid PNG row filter.');for(let x=0;x<stride;x++){const value=raw[y*(stride+1)+1+x],left=x>=4?pixels[y*stride+x-4]:0,up=y?pixels[(y-1)*stride+x]:0,upperLeft=y&&x>=4?pixels[(y-1)*stride+x-4]:0;pixels[y*stride+x]=(value+(mode===0?0:mode===1?left:mode===2?up:mode===3?Math.floor((left+up)/2):paeth(left,up,upperLeft)))&255;}}
 const stats=contract.inspectRgba(pixels,width,height);return {...stats,hasAlpha:true,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
function validateFiles(manifestFile){
 const absolute=path.resolve(manifestFile),root=path.dirname(absolute),manifest=JSON.parse(fs.readFileSync(absolute,'utf8')),textures={},fileErrors=[];
 for(const file of Array.isArray(manifest.textures)?manifest.textures:[]){if(!contract.validPath(file)||!file.endsWith('.png'))continue;const target=path.resolve(root,file);if(!target.startsWith(root+path.sep)){fileErrors.push(file+': Path leaves the package.');continue;}try{textures[file]=inspectPng(fs.readFileSync(target));}catch(error){fileErrors.push(file+': '+error.message);}}
 const result=contract.validatePackage(manifest,{textures});result.errors.push(...fileErrors);result.ok=result.errors.length===0;return {...result,modelId:manifest.modelId,classification:'validation-only-no-activation',textures};
}
if(require.main===module){const file=process.argv[2];if(!file){console.error('Usage: node v3-animation/validate-production-assets.cjs <production-manifest.json>');process.exitCode=1;}else try{const report=validateFiles(file);console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={inspectPng,validateFiles,crc32};
