'use strict';
const {withGame}=require('./harness.cjs');
(async()=>{await withGame(async({p,f,assert,errors})=>{
 f.holdAdventure=false;
 await p.locator('#loginPhantom').click();await p.waitForFunction(()=>RyoPayments.state.authenticated&&!LoginScreen.active);
 const rows=await p.evaluate(()=>{
  const ready=CombatClient.canAttack;CombatClient.canAttack=()=>true;Experience.restAll();S.butler=false;const result=[];
  function board(){bombs.length=0;for(const row of G)for(const c of row){c.k=0;c.hp=c.maxHp=0}G[4][6]={k:2,hp:10000,maxHp:10000};}
  for(let rank=0;rank<6;rank++){
   const h=mk(rank,true);h.x=4;h.y=4;h.pk=CombatRules.normalizePerks(rank,[5,6,1],()=>0);h.baseStats={pw:rank===5?20:10,sp:10,st:10};h.bonus={pw:5,sp:0,st:0};GameBalance.recalculateHero(h);h.en=10;h.cd=0;S.h=[h];board();
   let total=0,projectiles=0;for(let n=0;n<8;n++){h.cd=0;think(h);const b=bombs.at(-1);if(!b)throw Error('No attack rank '+rank);projectiles+=bombs.length;const hp=G[4][6].hp;boom(b);boom(b);total+=hp-G[4][6].hp;}
   const left=h.en;h.en=0;h.cd=0;think(h);const blocked=bombs.length===0;
   h.en=1;h.cd=0;think(h);const miss=bombs.at(-1);G[4][6].k=0;boom(miss);
   result.push({rank,power:h.pw,total,projectiles,left,blocked,missEnergy:h.en,volley:h.bm,range:h.rg});
  }
  const h=mk(5,true);h.x=4;h.y=4;h.en=100;h.cd=0;S.h=[h];board();G[4][5]={k:1,hp:0};think(h);const wall=bombs.length===0;
  board();G[4][6]={k:2,hp:100,maxHp:100};G[6][4]={k:5,hp:1625,maxHp:1625};h.pk=[1];h.cd=0;think(h);const priority=bombs.at(-1)?.ty===6;
  const saved=JSON.stringify({en:h.en,hp:G[6][4].hp,bombs:bombs.length,ryo:S.ryo});
  if(window.MythicHero)for(const state of ['SKILL_DRAGON_SLASH','SKILL_VOID_SHURIKEN','SKILL_RAIJIN_FIELD','ULTIMATE_DRAGON_ASCENSION'])MythicHero.play(h,state,{now:performance.now()});
  const cosmetic=saved===JSON.stringify({en:h.en,hp:G[6][4].hp,bombs:bombs.length,ryo:S.ryo});
  bombs.length=0;board();G[4][6].k=0;G[10][10]={k:2,hp:100,maxHp:100};
  const plain=mk(0,true),wind=mk(0,true);plain.pk=[];wind.pk=[2];for(const [i,x]of [plain,wind].entries()){x.tokenId=RyoPayments.state.profile.battleReady[i];x.tokenOwner=RyoPayments.state.account;x.sp=1;x.en=100;x.y=4;x.cd=10}plain.x=4;wind.x=6;plain.p=[[5,4]];wind.p=[[7,4]];S.h=[plain,wind];tick(.1);const movement=[plain.x-4,wind.x-6];
  plain.on=wind.on=false;plain.en=wind.en=100;plain.st=wind.st=10;plain.pk=[];wind.pk=[3,4];S.dojo=3;tick(60);const recovery=[plain.en-100,wind.en-100],capacity=CombatRules.maxChakra(wind);
  CombatClient.canAttack=ready;Experience.restAll();return {result,wall,priority,cosmetic,movement,recovery,capacity};
 });
 for(const r of rows.result){assert.equal(r.total,r.power*8,'trained Power per actual hit, including eighth ultimate');assert.equal(r.projectiles,8,'one combat projectile per attack');assert.equal(r.left,2,'eight attacks consume eight chakra');assert(r.blocked);assert.equal(r.missEnergy,0,'miss costs one chakra');}
 assert.equal(rows.result[5].volley,7);assert.equal(rows.result[5].range,7);assert(rows.wall,'solid wall stops Piercing');assert(rows.priority,'Armor Breaker prioritizes high-HP target');assert(rows.cosmetic,'skill callbacks cannot mutate combat');assert(Math.abs(rows.movement[1]/rows.movement[0]-1.12)<1e-8,'Wind Step changes actual movement by 12%: '+JSON.stringify(rows.movement));assert(Math.abs(rows.recovery[1]/rows.recovery[0]-1.15)<1e-8,'Fast Charge changes actual Dojo rest recovery by 15%');assert.equal(rows.capacity,550,'Chakra Saver changes actual maximum capacity by 10%');assert.deepEqual(errors,[]);
 await p.evaluate(()=>go(3));await p.waitForFunction(()=>WebsiteDesign.current()==='codex');await p.locator('.sbw-scr.on [data-sbwid=cs0]').click();await p.waitForFunction(()=>document.querySelector('.sbw-scr.on')?.innerText.includes('1 Attack = Hero Power Damage = 1 Chakra'));
 assert((await p.locator('.sbw-scr.on').innerText()).includes('Skill VFX = 0 Additional Chakra'));
 const guideBox=await p.locator('.cxp').boundingBox(),rankBox=await p.locator('.sbw-codex-ranks').boundingBox();assert(rankBox.x>=guideBox.x+guideBox.width,'rank cover stays inside the right artwork panel');
 assert.equal(await p.locator('.sbw-codex-ranks b').count(),6);assert(!/[★☆]/.test(await p.locator('.sbw-codex-ranks').innerText()),'artwork rank stars are covered by the six named rarities');
 await p.screenshot({path:require('node:path').join(__dirname,'out/combat-guide.png')});
 await p.setViewportSize({width:390,height:844});await p.waitForTimeout(400);assert(await p.locator('.cxp.sbw-mflow').count());assert(await p.locator('.cxp').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'phone guide wraps without horizontal clipping');await p.screenshot({path:require('node:path').join(__dirname,'out/combat-guide-phone.png')});
 console.log('PASS: native six-rank attacks, trained Power, exact chakra, zero-chakra stop, misses, duplicate callback protection, decorative volleys, wall collision, targeting and skill-only state.');
 });})().catch(e=>{console.error(e);process.exitCode=1});
