'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {loadGameBase:realLoadGameBase,MAX_BYTES,ASSET_API}=require('../download-game-base.cjs'),out=path.join(__dirname,'out');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(out,'base-download-')),bytes=Buffer.from('isolated verified game archive fixture'),expected=crypto.createHash('sha256').update(bytes).digest('hex');
const loadGameBase=options=>realLoadGameBase({archive:null,...options});
const fixture=name=>{const p=path.join(root,name);fs.mkdirSync(p);return p;},quiet=()=>{},fast=async()=>{};
(async()=>{try{
 let calls=0;const waits=[],urls=[],dir=fixture('retry');
 const got=await loadGameBase({root:dir,expected,log:quiet,sleep:async n=>waits.push(n),fetchImpl:async(url,options)=>{urls.push(url);if(url.startsWith(ASSET_API))assert.equal(options.headers.Accept,'application/octet-stream');return ++calls<3?new Response('gateway unavailable',{status:504}):new Response(bytes);}});
 assert.deepEqual(got,bytes);assert.equal(calls,3);assert.deepEqual(waits,[1000,2500]);assert.notEqual(urls[0],urls[1]);assert(urls[2].startsWith(ASSET_API),'fallback uses the pinned official release asset');assert.deepEqual(fs.readFileSync(path.join(dir,'vendor/game-base.zip')),bytes);
 assert.deepEqual(await loadGameBase({root:dir,expected,log:quiet,fetchImpl:async()=>{throw Error('cache must avoid network')}}),bytes);
 const previous=fixture('previous');fs.writeFileSync(path.join(previous,'verified-game.zip'),bytes);assert.deepEqual(await loadGameBase({root:previous,expected,log:quiet,fetchImpl:async()=>{throw Error('offline cache fallback')}}),bytes);
 for(const status of [408,429,500,502,503,504]){let n=0;await loadGameBase({root:fixture('http-'+status),expected,log:quiet,sleep:fast,fetchImpl:async()=>++n===1?new Response('',{status}):new Response(bytes)});assert.equal(n,2);}
 calls=0;await loadGameBase({root:fixture('network'),expected,log:quiet,sleep:fast,fetchImpl:async()=>{if(++calls<3)throw TypeError('connection reset');return new Response(bytes)}});assert.equal(calls,3);
 calls=0;await assert.rejects(()=>loadGameBase({root:fixture('exhausted'),expected,log:quiet,sleep:fast,fetchImpl:async()=>{calls++;return new Response('',{status:504})}}),/after 4 attempts/);assert.equal(calls,4);
 calls=0;await assert.rejects(()=>loadGameBase({root:fixture('missing'),expected,log:quiet,sleep:fast,fetchImpl:async()=>{calls++;return new Response('',{status:404})}}),/unavailable: 404/);assert.equal(calls,1,'permanent errors are not retried');
 const bad=fixture('bad');await assert.rejects(()=>loadGameBase({root:bad,expected,log:quiet,sleep:fast,fetchImpl:async()=>new Response('wrong archive')}),/integrity/);assert(!fs.existsSync(path.join(bad,'vendor/game-base.zip')),'bad download never reaches cache');
 const corrupt=fixture('corrupt');fs.writeFileSync(path.join(corrupt,'verified-game.zip'),'bad cache');await assert.rejects(()=>loadGameBase({root:corrupt,expected,log:quiet,fetchImpl:async()=>{throw Error('must fail closed')}}),/integrity/);
 const override=fixture('override');fs.writeFileSync(path.join(override,'base.zip'),bytes);assert.deepEqual(await loadGameBase({root:override,archive:'base.zip',expected,log:quiet}),bytes);await assert.rejects(()=>loadGameBase({root:override,archive:'missing.zip',expected,log:quiet}),/ENOENT/);
 let oversizedSignal;await assert.rejects(()=>loadGameBase({root:fixture('oversized'),expected,log:quiet,sleep:fast,fetchImpl:async(_,options)=>{oversizedSignal=options.signal;return new Response('',{headers:{'content-length':String(MAX_BYTES+1)}})}}),/size limit/);assert(oversizedSignal.aborted,'rejected bodies cannot leave an unbounded network request running');
 calls=0;await assert.rejects(()=>loadGameBase({root:fixture('timeout'),expected,timeoutMs:5,attempts:2,log:quiet,sleep:fast,fetchImpl:async(_,o)=>{calls++;return new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}}),/timed out/);assert.equal(calls,2);
 console.log('PASS: official API fallback, 504/network/timeout retries, fresh retry URLs, bounded attempts, verified caches/override, permanent HTTP rejection, corruption fail-closed and download-size limit.');
 }finally{if(path.dirname(root)!==path.resolve(out)||!path.basename(root).startsWith('base-download-'))throw Error('Unsafe fixture cleanup path');fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
