const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {safeExtract,entryPath}=require('../safe-extract.cjs');
function zip(entries){const chunks=[],central=[];let offset=0;for(const [name,value='',mode=0x81a40000]of entries){const n=Buffer.from(name),b=Buffer.from(value),h=Buffer.alloc(30),c=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(b.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x314,4);c.writeUInt16LE(20,6);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(mode>>>0,38);c.writeUInt32LE(offset,42);chunks.push(h,n,b);central.push(c,n);offset+=h.length+n.length+b.length;}const d=Buffer.concat(central),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(entries.length,8);e.writeUInt16LE(entries.length,10);e.writeUInt32LE(d.length,12);e.writeUInt32LE(offset,16);return Buffer.concat([...chunks,d,e]);}
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'shinobi-extract-'));try{
 const output=path.join(root,'app');await safeExtract(zip([['public/hello.txt','verified']]),{dir:output});assert.equal(fs.readFileSync(path.join(output,'public/hello.txt'),'utf8'),'verified');
 for(const name of ['../outside','/outside','C:/outside','folder\\outside','folder/../outside'])await assert.rejects(safeExtract(zip([[name,'bad']]),{dir:path.join(root,'unsafe')}));
 await assert.rejects(safeExtract(zip([['escape','../../outside',0xa1ff0000]]),{dir:path.join(root,'links')}),/links/);
 await assert.rejects(safeExtract(zip([['same','one'],['same','two']]),{dir:path.join(root,'duplicate')}),/Duplicate/);
 assert.throws(()=>entryPath(output,'../other',0x81a40000));assert(!fs.existsSync(path.join(root,'outside')));
 console.log('PASS: bounded extraction, verified file contents, traversal/absolute/backslash/duplicate/symlink rejection.');
 }finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(error=>{console.error(error);process.exitCode=1});
