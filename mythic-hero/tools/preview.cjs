/* Opens the actual game using the existing isolated harness. Never connects a real wallet/RPC. */
'use strict';
const {withGame}=require('../../tests/harness.cjs'),economy=require('../../app/server/economy.cjs');
const smoke=process.argv.includes('--smoke');
withGame(async({p,f})=>{
 f.holdAdventure=false;
 const heroes=Array.from({length:10},(_,i)=>({tokenId:'preview-'+i,name:i<3?'Tsukiyomi':'Legend',rank:i<3?5:4,level:1,baseStats:{pw:16,sp:15,st:17},mythic:i<3?'tsukiyomi':undefined,nft:i<3?{mint:'local-fixture-'+i}:undefined}));
 f.profile=economy.normalizeProfile({...f.profile,heroes,battleReady:heroes.map(h=>h.tokenId)});
 await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!LoginScreen.active);
 await p.evaluate(async()=>{
  await MythicHero.runtimeReady;await MythicHero.preload();go(0);Experience.workAll();
  const box=document.createElement('aside');box.style.cssText='position:fixed;right:12px;bottom:12px;z-index:99999;width:310px;padding:12px;border:1px solid #b885ff;background:#100923;color:#efe2ff;border-radius:12px;font:14px system-ui';
  const title=document.createElement('b');title.textContent='LOCAL FIXTURE / MYTHIC V4';box.append(title,document.createElement('br'));
  const select=document.createElement('select'),direction=document.createElement('select'),size=document.createElement('select');
  for(const s of Object.keys(MythicHero.animationSource.states)){const o=document.createElement('option');o.value=o.textContent=s;select.append(o)}
  for(const s of ['front','left','right','back']){const o=document.createElement('option');o.value=o.textContent=s;direction.append(o)}
  for(const s of [32,48,64,128]){const o=document.createElement('option');o.value=String(s);o.textContent=s+'px';size.append(o)}size.value='64';
  box.append(select,direction,size);const canvas=document.createElement('canvas');canvas.width=286;canvas.height=200;box.append(canvas);
  const replay=document.createElement('button');replay.textContent='Play on deployed Tsukiyomi';replay.onclick=()=>MythicHero.cosmeticEvent(S.h.find(h=>h.r===5),select.value,{force:true,direction:direction.value});box.append(replay);
  const note=document.createElement('p');note.textContent='Articulated approved views and celestial VFX. No live account, NFT, purchase or reward settlement.';box.append(note);document.body.append(box);
  let start=performance.now(),frameId;select.onchange=direction.onchange=()=>{start=performance.now()};
  const paint=time=>{const state=select.value,clip=MythicHero.animationSource.states[state],index=Math.floor((time-start)%clip.durationMs/clip.durationMs*clip.frames),h=S.h.find(h=>h.r===5),c=canvas.getContext('2d');c.clearRect(0,0,286,200);ShinobiSprites.blit(c,MythicHero.renderFrame(h,state,index,direction.value),143,175,Number(size.value)/40,false,1);const name=state==='ULTIMATE_DRAGON_ASCENSION'?'mythic_dragon_ascension':state.startsWith('SKILL_')?state.slice(6).toLowerCase():null;if(name){const img=MythicHero.skillFrame(name,index);if(img)c.drawImage(img,80,50,125,125)}frameId=requestAnimationFrame(paint)};
  frameId=requestAnimationFrame(paint);addEventListener('pagehide',()=>cancelAnimationFrame(frameId),{once:true});
 });
 console.log('Local isolated Mythic preview running. Close Chrome or press Ctrl+C. No live wallet/RPC.');
 if(smoke){await p.waitForTimeout(600);await p.screenshot({path:require('path').resolve(__dirname,'../../tests/out/mythic-interactive-preview.png')});return}
 await new Promise(resolve=>{process.once('SIGINT',resolve);p.context().browser().once('disconnected',resolve)});
},{},{headed:!smoke}).catch(e=>{console.error(e);process.exitCode=1});
