/* Actual checkout: approved SR breakdown, blocked configuration, bonus funding. No wallet or RPC. */
const path=require('node:path'),{withGame}=require('./harness.cjs');
require('./sr-revenue-fixture.cjs').liveEconomy();
(async()=>{
 await withGame(async({p,f,errors,assert})=>{
  f.holdAdventure=false;
  f.config.revenueDistribution={applicable:true};
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(()=>RyoPayments.state.authenticated&&!RyoPayments.state.busy&&!LoginScreen.active);
  let ready=false,bonus=false;
  await p.route('**/.netlify/functions/ryo',async route=>{
   const req=route.request().postDataJSON();if(req.action!=='quote')return route.fallback();
   const q=require('../app/server/economy.cjs').quote(f.profile,req.product,req.params);
   q.revenueDistribution={...q.revenueDistribution,ready:ready||bonus,note:bonus?'Starter Ryo payment: no tokens will be distributed.':ready?'Vault restrictions are re-verified before submission.':'Awaiting approved SR revenue vault configuration. No payment can be submitted.'};
   if(bonus)q.funding='bonus';
   await route.fulfill({json:q});
  });
  const open=async()=>{await p.evaluate(()=>{go(2);Combat.quantity(1);Combat.summonBatch()});await p.waitForSelector('#tokenCheckoutDialog[open]')};
  await open();
  const text=await p.locator('#tokenCheckoutDialog').innerText();
  for(const value of ['Treasury','50%','12,500 Ryo','Active Adventure Rewards','30%','7,500 Ryo','Community Rewards','Economic Reserve','2,500 Ryo','Automatic service burn','None'])assert(text.includes(value),value);
  assert(!/2% studio|8%|80%/.test(text));assert.equal(await p.locator('#checkoutConfirm').isDisabled(),true);
  await p.locator('#checkoutConfirm').evaluate(e=>e.click());
  // The native disabled control ignores activation without submitting a purchase.
  assert.equal(f.requests.filter(r=>r.action==='purchase').length,0);
  await p.screenshot({path:path.join(__dirname,'out/sr-revenue-checkout-desktop.png')});
  await p.setViewportSize({width:390,height:844});
  await p.screenshot({path:path.join(__dirname,'out/sr-revenue-checkout-mobile.png')});
  assert.equal(await p.locator('#tokenCheckoutDialog').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  await p.locator('#checkoutCancel').click();
  await p.waitForFunction(()=>!RyoPayments.state.busy);bonus=true;await open();
  assert.equal(await p.locator('#checkoutConfirm').isEnabled(),true);assert.match(await p.locator('#tokenCheckoutDialog').innerText(),/no tokens will be distributed/);
  await p.locator('#checkoutCancel').click();await p.waitForFunction(()=>!RyoPayments.state.busy);
  bonus=false;ready=true;await open();await p.locator('#checkoutConfirm').click();
  await p.waitForFunction(()=>!RyoPayments.state.busy&&S.v2.revealBatch?.length===1);
  assert.equal(f.requests.filter(r=>r.action==='purchase').length,1);assert.equal(f.balance,475000);assert.equal(f.purchases[0].quote.burn,0);
  await p.evaluate(()=>GlobalChestUI.openHistory());await p.waitForSelector('.gc-dialog[open]');
  const history=await p.locator('.gc-dialog[open]').innerText();
  for(const value of ['Treasury 50% 12,500','Adventure 30% 7,500','Community 10% 2,500','Reserve 10% 2,500','no burn'])assert(history.includes(value),value);
  await p.screenshot({path:path.join(__dirname,'out/sr-revenue-history-mobile.png')});
  f.purchases[0].quote.funding='bonus';await p.evaluate(()=>RyoPayments.refresh());
  await p.waitForFunction(()=>document.querySelector('.gc-dialog[open]').textContent.includes('Starter Ryo | no token revenue distributed'));
  assert(!await p.locator('.gc-dialog[open]').getByText(/Treasury 50%/).count());
  assert.deepEqual(errors,[]);
 },{}, {srRevenue:true});
 const dashboard=require('node:child_process').spawnSync(process.execPath,[path.join(__dirname,'economic-dashboard.cjs'),'--live-economy'],{stdio:'inherit'});if(dashboard.status!==0)throw Error('Live economy dashboard regression failed.');
 console.log('PASS: live SR checkout allocations, approval gating, starter disclosure, responsive history and live-only admin controls.');
})().catch(e=>{console.error(e);process.exitCode=1});
