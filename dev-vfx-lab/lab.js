(() => {
 'use strict';
 const $=id=>document.getElementById(id),canvas=$('preview'),c=canvas.getContext('2d'),iframe=$('engine');
 let bridge,manifest,initializing=false,playing=false,elapsed=0,last=0,raf=0,frames=0,stamp=0,fps=0;
 const options=()=>({background:$('background').value,character:$('character').checked,aura:$('aura').checked,direction:$('direction').value,quality:Number($('quality').value)});
 const clip=()=>manifest.clips[$('skill').value];
 function render(){if(!bridge)return;bridge.paint(c,$('skill').value,Math.min(1,elapsed/clip().durationMs),options());const n=Math.round(elapsed/1000*30);$('seek').value=String(n);$('frame').value=n+' / '+Math.round(clip().durationMs/1000*30);$('timing').textContent=clip().keyStages+' key stages · 30 fps inspection · '+clip().durationMs+' ms · '+fps+' render fps';}
 function tick(time){raf=0;if(!bridge)return;if(last&&playing){elapsed+=(time-last)*Number($('speed').value);if(elapsed>clip().durationMs){if($('loop').checked)elapsed%=clip().durationMs;else{elapsed=clip().durationMs;playing=false;}}}last=time;frames++;if(time-stamp>500){fps=Math.round(frames*1000/(time-stamp));frames=0;stamp=time;}if(playing)render();if(!document.hidden)raf=requestAnimationFrame(tick);}
 function seek(frame){playing=false;elapsed=Math.max(0,Math.min(clip().durationMs,frame/30*1000));render();}
 $('play').onclick=()=>{playing=true;last=0};$('pause').onclick=()=>{playing=false};$('restart').onclick=()=>{elapsed=0;playing=true;last=0;render()};
 $('prev').onclick=()=>seek(Math.round(elapsed/1000*30)-1);$('next').onclick=()=>seek(Math.round(elapsed/1000*30)+1);$('seek').oninput=()=>seek(Number($('seek').value));
 for(const id of ['background','character','aura','direction','quality'])$(id).onchange=render;
 $('skill').onchange=()=>{elapsed=0;last=0;$('seek').max=String(Math.round(clip().durationMs/1000*30));render()};
 addEventListener('visibilitychange',()=>{last=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;}else if(!raf)raf=requestAnimationFrame(tick)});
 async function init(){
  if(bridge||initializing)return;const w=iframe.contentWindow;if(!w?.MythicHero)return;initializing=true;
  const script=w.document.createElement('script');script.src='/vfx-lab/bridge.js';await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;w.document.head.append(script)});
  bridge=w.MythicVfxLabBridge;await bridge.ready;manifest=bridge.manifest;
  for(const [id,s]of Object.entries(manifest.clips)){const o=document.createElement('option');o.value=id;o.textContent=s.name;$('skill').append(o)}
  for(const id of ['play','pause','restart','prev','next'])$(id).disabled=false;
  $('status').textContent='Ready · shared game art · no wallet connected · no gameplay actions';$('skill').onchange();playing=true;raf=requestAnimationFrame(tick);
  window.VfxLab.ready=true;
 }
 window.VfxLab={ready:false,get bridge(){return bridge},get elapsed(){return elapsed},get playing(){return playing},renderAt(id,progress,opts={}){playing=false;$('skill').value=id;elapsed=Math.max(0,Math.min(1,progress))*manifest.clips[id].durationMs;for(const key of ['background','direction','quality'])if(opts[key]!==undefined)$(key).value=String(opts[key]);for(const key of ['character','aura'])if(opts[key]!==undefined)$(key).checked=opts[key];$('seek').max=String(Math.round(clip().durationMs/1000*30));render();return canvas;},pause(){playing=false},play(){playing=true;last=0}};
 iframe.addEventListener('load',()=>init().catch(e=>{$('status').textContent='Preview could not load: '+e.message}));if(iframe.contentDocument?.readyState==='complete')init().catch(e=>{$('status').textContent=e.message});
})();
