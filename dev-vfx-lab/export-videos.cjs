/* Actual Chrome canvas recording. No simulated video files or external wallet/API. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('../tests/node_modules/playwright'),{start}=require('./local-server.cjs');
const out=path.resolve(__dirname,'../previews/mythic-v6'),files={dragon_slash:'tsukiyomi_dragon_crescent_gale',void_shuriken:'tsukiyomi_void_eclipse_shuriken',raijin_field:'tsukiyomi_thunder_chain_vortex',mythic_dragon_ascension:'tsukiyomi_mythic_dragon_dominion'};
(async()=>{
 fs.mkdirSync(out,{recursive:true});const host=await start(),browser=await chromium.launch({headless:true,channel:'chrome'}),p=await browser.newPage({viewport:{width:1440,height:1000}}),results=[];
 try{
  await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==host.url)return r.abort();if(['/api/ryo','/.netlify/functions/ryo'].includes(u.pathname))return r.fulfill({status:503,contentType:'application/json',body:'{"error":"Local video export"}'});return r.continue()});
  await p.goto(host.url+'/vfx-lab/tsukiyomi');await p.waitForFunction(()=>VfxLab.ready,null,{timeout:60000});await p.evaluate(()=>VfxLab.pause());
  for(const [id,name]of [...Object.entries(files),['showcase','tsukiyomi_mythic_skill_showcase']]){
   console.log('Recording:',name);
   // Fresh page releases Chrome's previous native encoder and capture tracks.
   await p.reload();await p.waitForFunction(()=>VfxLab.ready,null,{timeout:60000});await p.evaluate(()=>VfxLab.pause());
   const record=await p.evaluate(async({id,ids})=>{
    const canvas=document.getElementById('preview'),ctx=canvas.getContext('2d'),mime='video/mp4;codecs=avc1.42001f';if(!MediaRecorder.isTypeSupported(mime))throw Error('Chrome H.264 MP4 encoder unavailable');
    canvas.width=1280;canvas.height=720;const list=id==='showcase'?ids:[id],durationMs=list.length*6000,stream=canvas.captureStream(0),track=stream.getVideoTracks()[0],chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6500000}),done=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=e=>reject(Error(e.error?.message||'Recording failed'));recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}});
    let paints=0;const begin=performance.now();recorder.start(500);
    await new Promise(resolve=>{function tick(now){const time=now-begin,index=Math.min(list.length-1,Math.floor(time/6000)),local=(time%6000)/6000,skill=list[index];
     const active=local<.12?0:Math.min(1,(local-.12)/.76),clip=VfxLab.bridge.manifest.clips[skill],phase=active;
     VfxLab.bridge.paint(ctx,skill,phase,{background:'dark',character:true,aura:true,direction:'right',quality:2});
     // Gentle fades between techniques, with no flashing camera treatment.
     const fade=Math.min(1,local/.06,(1-local)/.07);if(fade<1){ctx.fillStyle='#100a20';ctx.globalAlpha=1-fade;ctx.fillRect(0,0,1280,720);ctx.globalAlpha=1;}
     track.requestFrame();paints++;if(time>=durationMs)resolve();else setTimeout(()=>tick(performance.now()),1000/30)}tick(performance.now())});
    recorder.stop();await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('MP4 encoder did not finish')),12000))]);for(const track of stream.getTracks())track.stop();
    const blob=new Blob(chunks,{type:'video/mp4'}),bytes=new Uint8Array(await blob.arrayBuffer());let str='';for(let i=0;i<bytes.length;i+=32768)str+=String.fromCharCode(...bytes.subarray(i,i+32768));return{base64:btoa(str),bytes:bytes.length,paints,durationMs,mime:recorder.mimeType};
   },{id,ids:Object.keys(files)});
   const filename=path.join(out,name+'.mp4');fs.writeFileSync(filename,Buffer.from(record.base64,'base64'));delete record.base64;
   // Verify the actual exported MP4 decodes and has the expected dimensions/duration.
   const info=await p.evaluate(async bytes=>{const binary=atob(bytes),arr=new Uint8Array(binary.length);for(let i=0;i<arr.length;i++)arr[i]=binary.charCodeAt(i);const url=URL.createObjectURL(new Blob([arr],{type:'video/mp4'})),v=document.createElement('video');v.muted=true;v.src=url;await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=()=>reject(Error('Exported MP4 cannot decode'))});let duration=v.duration;if(!Number.isFinite(duration)){v.currentTime=1e10;await new Promise(resolve=>{v.onseeked=resolve});duration=v.duration;}v.currentTime=2.6;await new Promise(resolve=>{v.onseeked=resolve});const c=document.createElement('canvas');c.width=640;c.height=360;c.getContext('2d').drawImage(v,0,0,640,360);const frame=c.toDataURL();URL.revokeObjectURL(url);return{width:v.videoWidth,height:v.videoHeight,duration,frame}},fs.readFileSync(filename).toString('base64'));
   if(info.width!==1280||info.height!==720||!Number.isFinite(info.duration)||Math.abs(info.duration-record.durationMs/1000)>.8)throw Error('Export metadata mismatch: '+JSON.stringify({...info,frame:undefined}));
   fs.writeFileSync(path.join(out,name+'-frame.png'),Buffer.from(info.frame.split(',')[1],'base64'));delete info.frame;results.push({file:filename,...record,...info});console.log('Recorded and decoded:',name,info.duration.toFixed(2)+'s',record.bytes+' bytes');
  }
  fs.writeFileSync(path.join(out,'video-manifest.json'),JSON.stringify({created:new Date().toISOString(),source:'Actual shared game renderer, Chrome canvas.captureStream(30), H.264 MP4',assetStatus:'Reference-derived native-resolution art, not HD production sprite exports',videos:results},null,2)+'\n');
 }finally{await browser.close();host.stop()}
})().catch(e=>{console.error(e);process.exitCode=1});
