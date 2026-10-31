/* Current native-grid rendering and gameplay regression; simulated wallet only. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const source=fs.readFileSync(path.join(__dirname,'test-adventure-reference.cjs'),'utf8'),setup=source.slice(0,source.indexOf('harness+=String.raw`'));
const cases=String.raw`
 await p.evaluate(()=>ShinobiSprites.ready);
 await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!RyoPayments.state.busy&&!LoginScreen.active);
 balance=1000000;await p.evaluate(()=>RyoPayments.refresh());
 await p.waitForFunction(()=>V3Adventure.loaded);
 const checks=await p.evaluate(()=>{
  const report=[],owned=S.h.filter(h=>BattleRoster.eligible(h));
  tick=()=>{};owned.slice(0,2).forEach(h=>{h.on=true;h.en=h.st*50});
  const functions={think:think.toString(),boom:boom.toString(),free:free.toString(),blast:blast.toString()};
  for(let number=1;number<=8;number++){
   S.map=number;newMap();
   const original=G.flat(),originalJSON=JSON.stringify(G),solid=G.flat().filter(cell=>cell.k===1).length;
   const targetRefs=original.filter(cell=>cell.k>1),floor=document.createElement('canvas'),ctx=floor.getContext('2d'),drawImage=ctx.drawImage.bind(ctx);let imageCalls=0;
   ctx.drawImage=(...args)=>{imageCalls++;drawImage(...args)};
   V3Adventure.drawFloor(floor,{W,H,T,map:number,G});MapDesign.alignGrid();
   const isNative=G.every((row,y)=>row.every((cell,x)=>cell.k===1===(!!(x%2&&y%2))));
   const pixels=ctx.getImageData(0,0,floor.width,floor.height).data;let transparent=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255)transparent++;
   const walls=document.createElement('canvas');walls.width=1240;walls.height=465;V3Adventure.drawWall(walls.getContext('2d'),1,1,{map:number});
   report.push({number,solid,isNative,objectsPreserved:G.flat().every((cell,i)=>cell===original[i]),dataPreserved:JSON.stringify(G)===originalJSON,targetsPreserved:targetRefs.every(cell=>G.flat().includes(cell)),imageCalls,source:floor.dataset.renderSource,theme:floor.dataset.v3Environment,transparent,spawnValid:S.h.filter(h=>h.on).every(h=>G[h.y]?.[h.x]?.k===0)});
  }
  // The retained base blast primitive remains cardinal and stops at the first
  // solid/destructible obstacle; it is not the active ranged attack mode.
  const blank=()=>Array.from({length:H},()=>Array.from({length:W},()=>({k:0,hp:0})));
  G=blank();bombs=[];G[4][7]={k:1,hp:0};G[4][3]={k:2,hp:100};G[2][5]={k:1,hp:0};
  const rays=blast({x:5,y:4,r:5}),keys=new Set(rays.map(([x,y])=>x+','+y));
  const cardinal=rays.every(([x,y])=>x===5||y===4),blocked=!keys.has('7,4')&&!keys.has('8,4')&&!keys.has('5,2'),crateHit=keys.has('3,4')&&!keys.has('2,4');
  const movement=free(0,0)&&!free(7,4)&&!free(3,4)&&!free(-1,0);const path=bfs(5,4,(x,y)=>x===8&&y===4);const pathValid=path&&path.every(([x,y])=>G[y][x].k===0);
  // Active combat wrapper remains a single-hit ranged projectile. Verify a
  // real target clears once and the unobstructed next tile remains unchanged.
  G=blank();bombs=[];fx=[];fl=[];const hero=owned[0];hero.x=2;hero.y=2;hero.on=true;hero.en=100;hero.r=0;hero.bm=1;hero.rg=3;hero.cd=0;hero.p=[];hero.pk=[];hero.baseStats={pw:2,sp:2,st:2};hero.pw=2;hero.sp=2;hero.st=2;
  G[2][4]={k:2,hp:1};G[2][5]={k:2,hp:999};const beforeEnergy=hero.en;think(hero);const shot=bombs.find(b=>b.o===hero.id),shotExists=!!shot;const earnedBefore=S.earned;if(shot)boom(shot);const activeRanged=G[2][4].k===0&&G[2][5].hp===999,energyUsed=hero.en<beforeEnergy,rewardOnce=S.earned>earnedBefore;
  const codeUntouched=Object.entries(functions).every(([key,value])=>({think,boom,free,blast}[key]).toString()===value);
  S.map=1;newMap();go(0);hud();RosterDesign.refresh();Arena3D.rebuild();draw(performance.now());
  return {report,cardinal,blocked,crateHit,movement,pathValid,shotExists,activeRanged,energyUsed,rewardOnce,codeUntouched,broken:Arena3D.broken,grid:[W,H,T]};
 });
 assert.deepEqual(checks.grid,[31,17,40]);assert.equal(checks.report.length,8);
 for(const map of checks.report){assert.equal(map.solid,120,'native odd/odd walls retained on theme'+map.number);assert(map.isNative&&map.objectsPreserved&&map.dataPreserved&&map.targetsPreserved&&map.spawnValid,'rendering never rewrites grid on theme'+map.number);assert.equal(map.imageCalls,0,'no screenshot floor draw');assert.equal(map.source,'native-grid-code-art');assert.equal(map.transparent,0,'ground fully opaque');}
 for(const key of ['cardinal','blocked','crateHit','movement','pathValid','shotExists','activeRanged','energyUsed','rewardOnce','codeUntouched'])assert(checks[key],key);assert.equal(checks.broken,false);
 const out=path.resolve(__dirname,'../previews/v3-native-adventure');fs.mkdirSync(out,{recursive:true});await p.waitForTimeout(2200);await p.screenshot({path:path.join(out,'desktop.png'),scale:'css'});
 await p.setViewportSize({width:390,height:844});await p.waitForTimeout(200);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:path.join(out,'mobile.png'),scale:'css'});
 await p.emulateMedia({reducedMotion:'reduce'});const atmosphere=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=1240;c.height=465;V3Adventure.drawAtmosphere(c.getContext('2d'),12345);return c.getContext('2d').getImageData(0,0,1240,465).data.some(n=>n>0)});assert.equal(atmosphere,false,'reduced motion disables ambient particles');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',nativeGrid:checks.grid,environments:checks.report.map(x=>({theme:x.theme,solid:x.solid,objectsPreserved:x.objectsPreserved,screenshotFloorCalls:x.imageCalls})),retainedBlastPrimitive:'cardinal, wall/crate stopping',activeCombat:'existing ranged projectile unchanged',reducedMotion:true,pageErrors:errors,previews:out},null,2));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}})().catch(error=>{console.error(error);process.exitCode=1});
`;
const capture=" const sceneRequests=[];p.on('request',request=>{if(request.url().includes('/map-design/map')&&request.url().endsWith('.webp'))sceneRequests.push(request.url())}); await p.goto(url);";
const compiled=setup+'\nharness=harness.replace(" await p.goto(url);",'+JSON.stringify(capture)+');\nharness+='+JSON.stringify(cases.replace("assert.deepEqual(errors,[]);console.log", "assert.deepEqual(sceneRequests,[],'native renderer skips eight unused full-scene map downloads');assert.deepEqual(errors,[]);console.log"))+';\nconst mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(harness,__filename);';const wrapper=new Module(__filename,module);wrapper.filename=__filename;wrapper.paths=module.paths;wrapper._compile(compiled,__filename);
