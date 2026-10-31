/* Adventure reference UI in an isolated browser with a simulated ledger. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
let harness=fs.readFileSync(path.join(__dirname,'test-ryo-browser.cjs'),'utf8');
harness=harness.slice(0,harness.indexOf(' const review='));
harness=harness.replace("root=path.resolve(__dirname,'../app/public')","root=path.resolve(__dirname,'../app/public')");
harness=harness.replace('browser.newPage({viewport:', 'browser.newPage({deviceScaleFactor:2,viewport:');
harness=harness.replace(' await p.goto(url);',String.raw` await p.route('**/*',async route=>{const requestUrl=new URL(route.request().url());if(requestUrl.pathname==='/.netlify/functions/ryo')return route.fallback();if(requestUrl.origin!==url)return route.abort();const file=path.resolve(root,'.'+(requestUrl.pathname==='/'?'/index.html':decodeURIComponent(requestUrl.pathname)));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});let body=fs.readFileSync(file);if(file.endsWith('index.html'))body=Buffer.from(body.toString().replace('// SOURCE: ryo-payments.js',fakeWallet+'\n// SOURCE: ryo-payments.js'));await route.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.webp':'image/webp','.pdf':'application/pdf'})[path.extname(file)]||'application/octet-stream',body})}); await p.goto(url);`);
harness+=String.raw`
 await p.evaluate(()=>ShinobiSprites.ready);
 await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!RyoPayments.state.busy&&!LoginScreen.active);
 balance=100000000;deferFirstPurchase=false;
 profile=economy.fulfill(profile,economy.quote(profile,'summon',{quantity:15})).profile;
 profile.heroes.forEach((hero,i)=>{hero.rank=i%5;hero.name=['Yuki','Kai','Nao','Sora','Ren'][i%5]+' of Silent Rain '+i;hero.baseStats={pw:hero.rank*3+2,sp:hero.rank*3+2,st:hero.rank*3+2}});
 profile.battleReady=profile.heroes.slice(0,10).map(hero=>hero.tokenId);
 await p.evaluate(()=>RyoPayments.refresh());
 await p.setViewportSize({width:1672,height:1060});
 const out=path.resolve(__dirname,'../previews/adventure-reference');fs.mkdirSync(out,{recursive:true});
 const shot=async name=>{await p.waitForTimeout(300);await p.screenshot({path:path.join(out,name+'.png'),scale:'css'})};
 await p.evaluate(()=>{window.referenceTestTick=tick;tick=()=>{};S.h.forEach(hero=>{hero.on=false;hero.en=hero.st*50});S.map=21;newMap();BattleRoster.list().slice(0,3).forEach(hero=>{hero.on=true;place(hero)});SessionRyo.recordChest({pending:0,claimed:0},RyoPayments.state.account);SessionRyo.reset();SessionRyo.recordChest({pending:4321.875,claimed:0},RyoPayments.state.account);go(0);hud();RosterDesign.refresh()});
 await p.waitForFunction(()=>AdventureDesign.loaded&&RosterDesign.loaded);
 assert.equal(await p.locator('#exactAdventureScreen').isVisible(),true);
 assert.equal(await p.locator('.adventure-stage-number').textContent(),'Stage 21');
 assert.equal((await p.locator('.adventure-stage-name').textContent()).trim(),await p.evaluate(()=>AdventureDesign.themes[AdventureDesign.themeFor(S.map)].name));
 assert.match(await p.locator('#sessionRyo').textContent(),/4,321\s*Ryo/);
 const enemies=await p.locator('.adventure-enemy-count').evaluate(el=>({remaining:Number(el.dataset.remaining),total:Number(el.dataset.total)}));
 assert.equal(enemies.remaining,await p.evaluate(()=>left()));assert.equal(enemies.total,enemies.remaining);
 await p.evaluate(()=>{outer:for(const row of G)for(const cell of row)if(cell.k>1){cell.k=0;cell.hp=0;break outer}hud()});
 const decreased=await p.locator('.adventure-enemy-count').evaluate(el=>({remaining:Number(el.dataset.remaining),total:Number(el.dataset.total)}));
 assert.equal(decreased.remaining,enemies.remaining-1);assert.equal(decreased.total,enemies.total,'initial enemy target count stays stable during a map');
 const roster=p.locator('#strip .roster-design-card');
 assert.equal(await roster.count(),10);
 assert.equal(await p.locator('#strip .roster-team-action[aria-label^="Rest "]').count(),3);
 assert.equal(await p.locator('#strip .roster-team-action[aria-label^="Deploy "]').count(),7);
 const orderedIds=await roster.evaluateAll(cards=>cards.map(card=>Number(card.dataset.maphero)));
 const readyIds=await p.evaluate(()=>BattleRoster.list().map(hero=>hero.id));assert(orderedIds.every(id=>readyIds.includes(id)),'the roster only shows battle-ready heroes');
 await p.evaluate(()=>{hud();hud()});assert.deepEqual(await roster.evaluateAll(cards=>cards.map(card=>Number(card.dataset.maphero))),orderedIds,'HUD refresh does not reorder the bench');
 const rosterData=await roster.evaluateAll(cards=>cards.map(card=>{const hero=S.h.find(hero=>hero.id===Number(card.dataset.maphero));return{rank:card.querySelector('.roster-hero-rank').textContent,expectedRank:R[hero.r][0],meta:card.querySelector('.roster-hero-meta').textContent,level:hero.lv,energy:Math.floor(hero.en),maximum:Math.floor(hero.st*50)}}));for(const item of rosterData){assert(item.rank.includes(item.expectedRank));assert(item.meta.includes('Lv. '+item.level));assert(item.meta.includes(item.energy+' / '+item.maximum+' chakra'))}
 await p.locator('#strip .roster-team-action[aria-label^="Deploy "]').first().focus();const focusedHero=await p.evaluate(()=>document.activeElement.closest('[data-maphero]').dataset.maphero);await p.evaluate(()=>hud());assert.equal(await p.evaluate(()=>document.activeElement.closest('[data-maphero]')?.dataset.maphero),focusedHero,'HUD refresh preserves team control focus');
 const boxes=await roster.evaluateAll(cards=>cards.map(card=>{const box=card.getBoundingClientRect();return{x:box.x,y:box.y,right:box.right,bottom:box.bottom}}));
 assert(boxes.slice(0,5).every(box=>Math.abs(box.y-boxes[0].y)<2),'five team cards above');assert(boxes.slice(5).every(box=>Math.abs(box.y-boxes[5].y)<2),'five team cards below');assert(boxes[5].y>boxes[0].bottom,'team rows separated');
 const textBounds=await roster.evaluateAll(cards=>cards.map(card=>{const box=card.getBoundingClientRect();return[...card.querySelectorAll('.roster-hero-name,.roster-hero-rank,.roster-hero-meta,.roster-team-action')].every(el=>{const b=el.getBoundingClientRect();return b.x>=box.x-1&&b.right<=box.right+1&&b.y>=box.y-1&&b.bottom<=box.bottom+1})}));assert(textBounds.every(Boolean),'team text and controls stay inside their cards');
 const controlPlacement=await p.evaluate(()=>{const arena=document.querySelector('#cv').getBoundingClientRect(),first=document.querySelector('#strip .roster-design-card').getBoundingClientRect();return[...document.querySelectorAll('.exact-adventure-manage,.exact-adventure-work,.exact-adventure-rest,#camToggle')].map(button=>{const b=button.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return{id:button.id,label:button.className,top:b.y,bottom:b.bottom,arenaBottom:arena.bottom,firstTop:first.y,header:b.y>=arena.bottom-1&&b.bottom<=first.y+1,width:b.width,height:b.height,exposed:hit===button||button.contains(hit)}})});for(const control of controlPlacement){assert(control.header,'bulk controls are in the team header beneath the map');assert(control.width>50&&control.height>25,'artwork buttons have usable native hit targets');assert(control.exposed,'bulk and camera controls remain clickable')}
 const canvasPixels=await roster.locator('canvas').evaluateAll(canvases=>canvases.map(canvas=>{const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>20)count++;return count}));assert.equal(canvasPixels.length,10);canvasPixels.forEach(count=>assert(count>1000,'all ten portraits are painted'));
 const lowerHash=async()=>roster.first().locator('canvas').evaluate(canvas=>{const context=canvas.getContext('2d'),start=Math.floor(canvas.height*.6),pixels=context.getImageData(0,start,canvas.width,canvas.height-start).data;let hash=0;for(let i=0;i<pixels.length;i+=13)hash=(hash*31+pixels[i])>>>0;return hash});
 const auraBefore=await lowerHash();await p.waitForTimeout(450);assert.notEqual(await lowerHash(),auraBefore,'hero aura region animates');
 await p.emulateMedia({reducedMotion:'reduce'});await p.waitForTimeout(180);const stillAura=await lowerHash();await p.waitForTimeout(180);assert.equal(await lowerHash(),stillAura,'reduced motion keeps the aura still');await p.emulateMedia({reducedMotion:'no-preference'});
 await shot('adventure-desktop');
 const viewBefore=await p.evaluate(()=>Arena3D.cfg.tilt);await p.locator('#camToggle').click();assert.notEqual(await p.evaluate(()=>Arena3D.cfg.tilt),viewBefore,'camera button changes the actual view');await p.locator('#camToggle').click();assert.equal(await p.evaluate(()=>Arena3D.cfg.tilt),viewBefore);
 // Controls and actions are checked once the roster implementation has
 // supplied their semantic hooks; this guard also catches stale UI modules.
 assert.equal(await p.locator('#strip .roster-design-empty').count(),0,'resting battle-ready heroes fill the bench');
 await p.locator('#strip .roster-team-action[aria-label^="Deploy "]').first().click();assert.equal(await p.evaluate(()=>S.h.filter(hero=>hero.on).length),4);
 const extra=await p.evaluate(()=>BattleRoster.list().filter(hero=>hero.on).at(-1).id);await p.locator('#strip [data-maphero="'+extra+'"] .roster-team-action').click();assert.equal(await p.evaluate(()=>S.h.filter(hero=>hero.on).length),3);
 await p.locator('.exact-adventure-manage').click();assert.equal(await p.evaluate(()=>tab),1);
 assert.equal(await p.locator('#p1 .compact-perks').count(),0,'collection cards have no scrolling perk disclosures');
 const count=p.locator('#p1 .hero-perk-count').first();assert(await count.isVisible());await count.click();assert(await p.locator('#heroDetailDialog').isVisible());assert(await p.locator('#heroDetailDialog .hero-detail-perks').textContent());await p.keyboard.press('Escape');
 await p.evaluate(()=>go(0));await p.locator('.exact-adventure-work').click();assert.equal(await p.evaluate(()=>S.h.filter(hero=>hero.on).length),10);await p.locator('.exact-adventure-rest').click();assert.equal(await p.evaluate(()=>S.h.filter(hero=>hero.on).length),0);
 await p.setViewportSize({width:1218,height:750});await shot('adventure-laptop');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.setViewportSize({width:390,height:844});await shot('adventure-mobile');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const mobileCard=roster.first();await mobileCard.scrollIntoViewIfNeeded();const mobileReadability=await mobileCard.evaluate(card=>{const box=card.getBoundingClientRect(),name=card.querySelector('.roster-hero-name');return{width:box.width,font:Number.parseFloat(getComputedStyle(name).fontSize)}});assert(mobileReadability.width>=280,'mobile team cards are readable instead of shrinking the entire scene');assert(mobileReadability.font>=12,'mobile hero names remain readable');await shot('adventure-mobile-team');
 for(const target of ['.exact-adventure-manage','.exact-adventure-work','.exact-adventure-rest','#camToggle']){const control=p.locator(target);assert(await control.isVisible());assert((await control.boundingBox()).height>=40,'mobile bulk controls are touch-sized')}
 for(const target of ['#ry','.adventure-mobile-session-value']){assert(await p.locator(target).isVisible());assert(await p.locator(target).evaluate(el=>{const box=el.getBoundingClientRect();return box.width>0&&box.x>=-1&&box.right<=innerWidth+1}),'mobile currency/session text fits horizontally')}
 assert.equal(await p.locator('.adventure-mobile-session-value').textContent(),'+4,321','mobile session mirrors the live session value');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({reference:'live stage/enemy/session banner; 5x2 team panel',roster:'three deployed plus seven resting battle-ready heroes',portraits:canvasPixels,aura:'lower portrait region changes across frames',heroes:'perk count opens full detail popup',controls:'manage/work/rest reuse current game actions',mobile:'no horizontal document overflow',pageErrors:errors,screenshots:out},null,2));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}})().catch(error=>{console.error(error);process.exitCode=1});
`;
const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(harness,__filename);
