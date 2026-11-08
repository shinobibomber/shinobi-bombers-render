/* Verified base archive loader. Transient upstream failures never bypass integrity checks. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{setTimeout:delay}=require('node:timers/promises');
const URL='https://github.com/shinobibomber/shinobi-bombers-render/releases/download/v3-reference-beta/Shinobi-Bombers-Render.zip';
// The same public release asset, pinned by ID as well as the immutable content hash.
const ASSET_API='https://api.github.com/repos/shinobibomber/shinobi-bombers-render/releases/assets/693667821';
const SHA256='b1833d4d77bc7845e01c02215a4715203cd82767bc3c432d4aba80f708e298c2';
const RETRY=new Set([408,425,429,500,502,503,504]),MAX_BYTES=256*1024*1024;
function verify(bytes,expected=SHA256){if(crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw Object.assign(Error('Deployment archive integrity check failed.'),{permanent:true});return bytes;}
function cache(file,bytes,log){let temporary;try{fs.mkdirSync(path.dirname(file),{recursive:true});temporary=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temporary,bytes,{flag:'wx'});fs.renameSync(temporary,file);}catch{log('Verified archive cache could not be saved; continuing with verified download.');}finally{if(temporary)try{fs.rmSync(temporary,{force:true});}catch{}}}
async function loadGameBase({root=__dirname,archive=process.env.SB_BASE_ARCHIVE,fetchImpl=fetch,sleep=delay,log=console.log,expected=SHA256,timeoutMs=45000,attempts=4}={}){
 if(archive){const file=path.resolve(root,archive);return verify(fs.readFileSync(file),expected);}
 const cached=path.join(root,'vendor/game-base.zip');
 for(const file of [cached,path.join(root,'verified-game.zip')])if(fs.existsSync(file)){
  const bytes=verify(fs.readFileSync(file),expected);log('Using SHA-256 verified game archive cache.');if(file!==cached)cache(cached,bytes,log);return bytes;
 }
 let last='network error';
 for(let attempt=1;attempt<=attempts;attempt++){
  last='network/download error';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   // A fresh query on retries avoids reusing a cached gateway error or stale redirect.
   const source=attempt>=3?ASSET_API:URL;if(attempt===3)log('Trying official GitHub release-asset API fallback.');
   const url=attempt===1?source:source+'?download=1&sb_archive_retry='+Date.now()+'-'+attempt;
   const response=await fetchImpl(url,{signal:controller.signal,headers:{Accept:'application/octet-stream','Cache-Control':'no-cache','User-Agent':'Shinobi-Bombers-verified-build'}});
   if(!response.ok){last='HTTP '+response.status;await response.body?.cancel();if(!RETRY.has(response.status))throw Object.assign(Error('Release archive unavailable: '+response.status),{permanent:true});throw Error(last);}
   if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Object.assign(Error('Release archive exceeds the download size limit.'),{permanent:true});
   const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BYTES)throw Object.assign(Error('Release archive exceeds the download size limit.'),{permanent:true});chunks.push(Buffer.from(chunk));}
   const bytes=verify(Buffer.concat(chunks,size),expected);cache(cached,bytes,log);log('Game archive downloaded and SHA-256 verified.');return bytes;
  }catch(error){if(error.permanent)throw error;if(controller.signal.aborted)last='download timed out';else if(!last.startsWith('HTTP '))last='network/download error';if(attempt===attempts)break;const wait=[1000,2500,5000][Math.min(attempt-1,2)];log('Game archive '+last+'; retrying '+(attempt+1)+'/'+attempts+' in '+wait+'ms.');clearTimeout(timer);await sleep(wait);
  }finally{controller.abort();clearTimeout(timer);}
 }
 throw Error('Release archive unavailable after '+attempts+' attempts ('+last+'). No unverified archive was used.');
}
module.exports={loadGameBase,verify,SHA256,URL,ASSET_API,MAX_BYTES};
