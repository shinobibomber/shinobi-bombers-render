/* Real Shrine quantity/purchase/reveal path against an isolated simulated ledger. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const host=fs.readFileSync(path.join(__dirname,'test-adventure-reference.cjs'),'utf8'),setup=host.slice(0,host.indexOf('harness+=String.raw`'));
const cases=String.raw`
 await p.evaluate(()=>ShinobiSprites.ready);await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!RyoPayments.state.busy&&!LoginScreen.active);
 balance=10000000;deferFirstPurchase=false;await p.evaluate(()=>RyoPayments.refresh());await p.evaluate(()=>go(2));await p.waitForFunction(()=>V3Summoning.loaded);
 await p.setViewportSize({width:1536,height:1024});await p.waitForTimeout(200);
 const out=path.resolve(__dirname,'../previews/v3-summoning');fs.mkdirSync(out,{recursive:true});
 assert.equal(await p.locator('.v3-summoning-layout').count(),1);assert.equal(await p.locator('.v3-summoning-purchase table tbody tr').count(),5);assert.match(await p.locator('.v3-summoning-purchase table').textContent(),/60%.*25%.*10%.*4%.*1%/s);
 assert.equal(await p.locator('#exactShrineScene>.crafting-reference-art').isVisible(),false,'no screenshot UI behind interactive shrine');
 await p.screenshot({path:path.join(out,'shrine-desktop.png'),scale:'css'});
 const reports=[];
 for(const quantity of [1,5,10,15]){
  await p.evaluate(n=>{go(2);Combat.quantity(n)},quantity);assert.equal(await p.locator('.summon-quantities button.selected').textContent(),'×'+quantity);assert.match(await p.locator('.summon-price').textContent(),new RegExp((quantity*25000).toLocaleString()));
  const before={balance,heroes:profile.heroes.length,purchases:purchases.length};await p.locator('.summon-main').click();await p.waitForSelector('#tokenCheckoutDialog[open]');assert.match(await p.locator('#checkoutConfirm').textContent(),new RegExp((quantity*25500).toLocaleString()));await p.locator('#checkoutConfirm').click();await p.waitForSelector('#summonReveal[open]');
  assert.equal(before.balance-balance,quantity*25500);assert.equal(profile.heroes.length-before.heroes,quantity);assert.equal(purchases.length-before.purchases,1);
  const serverIds=purchases[0].result.outputs.map(h=>h.tokenId).sort();const initial=await p.evaluate(()=>S.v2.revealBatch.map(item=>item.hero.tokenId).sort());assert.deepEqual(initial,serverIds,'gallery shows exactly server output IDs');
  const rawBefore=await p.evaluate(()=>JSON.stringify(S.v2.revealBatch.map(item=>item.hero)));
  assert.equal(await p.locator('.v3-reveal-one').isEnabled(),true);assert.equal(await p.locator('.v3-summon-again').isVisible(),false);
  if(quantity===5){await p.locator('.v3-reveal-one').click();await p.waitForFunction(()=>S.v2.revealBatch.some(item=>item.revealed));}
  await p.evaluate(()=>Experience.revealAll());await p.waitForFunction(()=>S.v2.revealBatch.every(item=>item.revealed));await p.waitForTimeout(500);
  assert.equal(await p.locator('.v3-summon-again').isVisible(),true);assert.equal(await p.locator('.v3-reveal-one').isEnabled(),false);assert.equal(await p.evaluate(()=>JSON.stringify(S.v2.revealBatch.map(item=>item.hero))),rawBefore,'reveal does not mutate or reroll heroes');
  await p.evaluate(()=>Experience.revealAll());assert.equal(purchases.length-before.purchases,1);assert.equal(before.balance-balance,quantity*25500,'revealing twice never charges again');
  const layout=await p.locator('.reveal-grid').evaluate(el=>({columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,overflowX:el.scrollWidth>el.clientWidth+1,overflowY:el.scrollHeight>el.clientHeight+1}));assert.equal(layout.overflowX,false);assert.equal(layout.overflowY,false);if(quantity===10)assert.equal(layout.columns,5,'ten outcomes are five above and five below');
  const pixels=await p.locator('.clean-reveal-portrait canvas').evaluateAll(canvases=>canvases.map(canvas=>{let n=0;const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;for(let i=3;i<data.length;i+=4)if(data[i]>30)n++;return n}));assert(pixels.every(n=>n>100),'every revealed model has visible pixels');assert.equal(await p.locator('.v3-reveal-summary span').count(),5);assert.equal(await p.locator('[class*=new-label]').count(),0);
  if(quantity===10)await p.screenshot({path:path.join(out,'reveal-ten-desktop.png'),scale:'css'});
  reports.push({quantity,charged:quantity*25500,heroIds:serverIds.length,columns:layout.columns});
  if(quantity===15){await p.setViewportSize({width:390,height:844});await p.waitForTimeout(300);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:path.join(out,'reveal-mobile.png'),scale:'css'});await p.setViewportSize({width:1536,height:1024});}
  if(quantity===1){await p.locator('.v3-summon-again').click();await p.waitForFunction(()=>!document.getElementById('summonReveal').open);assert.equal(await p.evaluate(()=>tab),2);assert.equal(purchases.length-before.purchases,1,'Summon Again only navigates');}
  else await p.locator('#revealContinue').click();
 }
 await p.evaluate(()=>{go(2);Combat.quantity(15)});await p.setViewportSize({width:390,height:844});await p.waitForTimeout(200);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await p.locator('.summon-main').isVisible(),true);assert(await p.locator('.summon-quantities button').evaluateAll(buttons=>buttons.every(b=>b.getBoundingClientRect().width>50&&b.getBoundingClientRect().height>40)),'mobile quantity controls retain real touch targets');assert(await p.locator('.summon-price').evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.v3-summoning-purchase').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right}),'price stays inside purchase panel');await p.screenshot({path:path.join(out,'shrine-mobile.png'),scale:'css'});
 await p.locator('.v3-summoning-sidebar button').filter({hasText:'Hero Gallery'}).click();assert.equal(await p.evaluate(()=>tab),1);
 await p.evaluate(()=>go(2));await p.locator('.v3-summoning-sidebar button').filter({hasText:'Rarity Rates'}).click();assert.equal(await p.locator('#v3SummonRates').evaluate(el=>document.activeElement===el),true);
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('.v3-shrine-scroll').evaluate(el=>getComputedStyle(el).animationName),'none');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',purchases:reports,realRates:true,duplicateCharges:false,rerolls:false,tenCardGrid:'5×2',mobile:true,reducedMotion:true,pageErrors:errors,previews:out},null,2));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}})().catch(error=>{console.error(error);process.exitCode=1});
`;
const compiled=setup+'\nharness+='+JSON.stringify(cases)+';\nconst mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(harness,__filename);';const wrapper=new Module(__filename,module);wrapper.filename=__filename;wrapper.paths=module.paths;wrapper._compile(compiled,__filename);
