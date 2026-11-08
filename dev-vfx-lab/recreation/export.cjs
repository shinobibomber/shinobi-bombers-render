/* Record real preview frames to MP4, then decode each output to verify it. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('../../tests/node_modules/playwright'),{start}=require('../local-server.cjs');
const out=path.resolve(__dirname,'../../previews/mythic-recreation'),spec=require('./manifest.json');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const host=await start(),browser=await chromium.launch({channel:'chrome',headless:true}),p=await browser.newPage({viewport:{width:1440,height:1000}}),videos=[];
 try{
  await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==host.url)return r.abort();if(['/api/ryo','/.netlify/functions/ryo'].includes(u.pathname))return r.fulfill({status:503,contentType:'application/json',body:'{"error":"Art export only"}'});return r.continue()});
  for(const id of [...Object.keys(spec.clips),'showcase']){
   await p.goto(host.url+'/vfx-lab/recreation');await p.waitForFunction(()=>window.RecreationLab?.ready,null,{timeout:60000});await p.evaluate(()=>RecreationLab.pause());
   console.log('Recording '+id);
   const record=await p.evaluate(async id=>{
    const canvas=document.getElementById('preview'),q=canvas.getContext('2d'),bridge=RecreationLab.bridge,mime='video/mp4;codecs=avc1.42001f';if(!MediaRecorder.isTypeSupported(mime))throw Error('H.264 MP4 unavailable');canvas.width=1280;canvas.height=720;
    const ids=id==='showcase'?Object.keys(bridge.manifest.clips):[id],segmentMs=6000,durationMs=ids.length*segmentMs,stream=canvas.captureStream(0),track=stream.getVideoTracks()[0],chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:7000000});const done=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=e=>reject(Error(e.error?.message||'Encoder failed'));recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}});let paints=0;
    recorder.start(500);const start=performance.now();
    await new Promise(resolve=>{const tick=()=>{const time=performance.now()-start,index=Math.min(ids.length-1,Math.floor(time/segmentMs)),local=time%segmentMs,skill=ids[index],clip=bridge.manifest.clips[skill];
      // Show one slowed cycle, then one native-duration cycle on the Adventure map.
      const first=local<3000,phase=first?Math.max(0,Math.min(1,(local-250)/2450)):((local-3000)%(clip.durationMs+400))/clip.durationMs;
      bridge.paint(q,skill,Math.min(1,phase),{background:first?'dark':'map',character:true,aura:true,direction:'right',interpolate:true});
      q.fillStyle='#0b0712eb';q.fillRect(0,0,1280,75);q.fillStyle='#c69ae9';q.font='13px system-ui';q.fillText('SHINOBI BOMBERS V3 · LOCAL ART REVIEW',28,25);q.fillStyle='#fff';q.font='bold 25px system-ui';q.fillText(clip.name,28,57);q.fillStyle='#dac4ea';q.font='14px system-ui';q.textAlign='right';q.fillText(first?'Slowed formation':'Adventure · native timing',1252,46);q.textAlign='left';
      track.requestFrame();paints++;if(time>=durationMs)resolve();else setTimeout(tick,1000/30)};tick()});
    recorder.stop();await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('Encoder timeout')),15000))]);stream.getTracks().forEach(t=>t.stop());
    const b=new Uint8Array(await new Blob(chunks,{type:'video/mp4'}).arrayBuffer());let str='';for(let i=0;i<b.length;i+=32768)str+=String.fromCharCode(...b.subarray(i,i+32768));return{base64:btoa(str),durationMs,bytes:b.length,paints};
   },id);
   const file=id+'.mp4';fs.writeFileSync(path.join(out,file),Buffer.from(record.base64,'base64'));
   const info=await p.evaluate(async base64=>{const binary=atob(base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'})),v=document.createElement('video');v.muted=true;v.src=url;await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=()=>reject(Error('Export cannot decode'))});if(!Number.isFinite(v.duration)){v.currentTime=1e10;await new Promise(r=>v.onseeked=r)}const duration=v.duration;v.currentTime=1.8;await new Promise(r=>v.onseeked=r);const c=document.createElement('canvas');c.width=640;c.height=360;c.getContext('2d').drawImage(v,0,0,640,360);const frame=c.toDataURL().split(',')[1];URL.revokeObjectURL(url);return{width:v.videoWidth,height:v.videoHeight,duration,frame}},record.base64);
   if(info.width!==1280||info.height!==720||!Number.isFinite(info.duration)||Math.abs(info.duration-record.durationMs/1000)>.8)throw Error('Invalid export dimensions/duration');fs.writeFileSync(path.join(out,id+'-decoded.png'),Buffer.from(info.frame,'base64'));delete info.frame;delete record.base64;videos.push({file,...record,...info});console.log('Verified '+file+' '+info.duration.toFixed(2)+' seconds');
  }
  fs.writeFileSync(path.join(out,'video-manifest.json'),JSON.stringify({source:'Actual local preview renderer; Chrome H.264 MP4; generated masters plus interpolated motion',videos},null,2)+'\n');
 }finally{await browser.close();host.stop()}
})().catch(e=>{console.error(e);process.exitCode=1});
