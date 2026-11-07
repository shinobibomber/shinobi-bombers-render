'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path'),{withGame}=require('./harness.cjs');
const result=spawnSync(process.execPath,[path.join(__dirname,'financial-server.cjs'),'--beta-economy'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
(async()=>{
 await withGame(async({p,f,errors,assert})=>{
  f.holdAdventure=false;
  await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!RyoPayments.state.busy&&!LoginScreen.active);
  await p.evaluate(()=>{go(2);Combat.quantity(1);Combat.summonBatch()});await p.waitForSelector('#tokenCheckoutDialog[open]');
  const text=await p.locator('#tokenCheckoutDialog').innerText();
  for(const value of ['80%','20,000 Ryo','10%','2,500 tokens','8%','2,000 tokens','2%','500 tokens'])assert(text.includes(value),value);
  assert(!text.includes('Community Rewards'));assert.equal(await p.locator('#checkoutConfirm').isEnabled(),true,'beta checkout needs no live vault approval');
  await p.screenshot({path:path.join(__dirname,'out/beta-economy-checkout-desktop.png')});
  await p.setViewportSize({width:390,height:844});await p.screenshot({path:path.join(__dirname,'out/beta-economy-checkout-mobile.png')});
  assert.equal(await p.locator('#tokenCheckoutDialog').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  await p.locator('#checkoutConfirm').click();await p.waitForFunction(()=>!RyoPayments.state.busy&&S.v2.revealBatch?.length===1);
  assert.equal(f.balance,475000);assert.equal(f.purchases[0].quote.revenueDistribution,undefined);assert.deepEqual(errors,[]);
 });
 console.log('PASS: beta keeps original signed transfers, gas safety, 80/10/8/2 checkout, Market reward funding and no live vault prerequisite.');
})().catch(e=>{console.error(e);process.exitCode=1});
