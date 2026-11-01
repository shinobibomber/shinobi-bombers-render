const fs=require('node:fs'),path=require('node:path'),{pipeline}=require('node:stream/promises'),yauzl=require('yauzl');
function entryPath(root,name,mode){
 if(!name||name.includes('\\')||name.includes(':')||name.includes('\0')||path.posix.isAbsolute(name)||name.split('/').some(part=>part==='..'||part==='.'))throw Error('Unsafe archive path.');
 const kind=(mode>>>16)&0xf000;
 if(kind&&kind!==0x8000&&kind!==0x4000)throw Error('Archive links and special files are forbidden.');
 const destination=path.resolve(root,name),relative=path.relative(root,destination);
 if(!relative||relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw Error('Archive path leaves the application directory.');
 return destination;
}
function rejectLinks(root,destination){
 let current=root;
 for(const part of ['',...path.relative(root,destination).split(path.sep)]){if(part)current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Existing archive destination contains a symbolic link.');}
}
async function safeExtract(bytes,{dir}){
 const root=path.resolve(dir);fs.mkdirSync(root,{recursive:true});
 const archive=await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,zip)=>error?reject(error):resolve(zip)));
 return new Promise((resolve,reject)=>{let settled=false,total=0;const names=new Set();const fail=error=>{if(settled)return;settled=true;archive.close();reject(error)};
 archive.on('error',fail);archive.on('end',()=>{if(!settled){settled=true;resolve()}});
 archive.on('entry',entry=>{(async()=>{
  const target=entryPath(root,entry.fileName,entry.externalFileAttributes),key=entry.fileName.replace(/\/$/,'').toLowerCase();
  if(names.has(key))throw Error('Duplicate archive destination.');names.add(key);
  total+=entry.uncompressedSize;if(entry.uncompressedSize>64*1024*1024||total>512*1024*1024)throw Error('Archive exceeds application extraction limits.');
  if(entry.generalPurposeBitFlag&1)throw Error('Encrypted archive entries are not supported.');rejectLinks(root,target);
  if(entry.fileName.endsWith('/'))fs.mkdirSync(target,{recursive:true});else{fs.mkdirSync(path.dirname(target),{recursive:true});rejectLinks(root,target);const input=await new Promise((res,rej)=>archive.openReadStream(entry,(error,stream)=>error?rej(error):res(stream)));await pipeline(input,fs.createWriteStream(target,{flags:fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|(fs.constants.O_NOFOLLOW||0),mode:0o644}));}
  if(!settled)archive.readEntry();
 })().catch(fail)});archive.readEntry();});
}
module.exports={safeExtract,entryPath};
