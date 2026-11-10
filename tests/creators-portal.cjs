'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), { Store } = require('../app/server/store.cjs');
const creators = require('../app/server/creators-portal.cjs'), { withGame } = require('./harness.cjs');
const root = path.resolve(__dirname, '..');
async function database(f, account) {
 const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'app/server/schema.sql'), 'utf8'));
 let tail = Promise.resolve(); const lock = async () => { let release; const old = tail; tail = new Promise(r => release = r); await old; return release; };
 const pool = { async query(q, a) { const release = await lock(); try { return await db.query(q, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (q, a) => db.query(q, a), release }; } };
 const store = new Store(pool, 'browser-creators', Date.now); await creators.initialize(store);
 await store.transaction(async c => { await store.locked(c, account); await store.profileLocked(c, account); await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, account, JSON.stringify(f.profile)]); });
 return { store, db };
}
const login = async p => { await p.locator('#loginPhantom').click(); await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready); };
async function fixture(p, f, account, snapshot) {
 const { store, db } = await database(f, account), ctx = { store, origin: new URL(p.url()).origin };
 process.env.RYO_ADMIN_APPROVERS = account;
 await p.route('**/.netlify/functions/ryo', async route => {
   const req = route.request().postDataJSON(); if (!req.action?.startsWith('creator-')) return route.fallback();
   try {
     const result = await creators.handle(ctx, req.action === 'creator-public' ? null : account, req.action, req);
     if (['creator-redeem','creator-player-claim'].includes(req.action)) { f.profile = await store.profile(account); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...result, ...snapshot() }) }); }
     return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
   } catch (e) { return route.fulfill({ status: e.status || 400, contentType: 'application/json', body: JSON.stringify({ error: e.message }) }); }
 });
 return { store, db, ctx };
}
(async () => {
 fs.mkdirSync(path.join(root, 'tests/out'), { recursive: true });
 await withGame(async ({ p, f, errors, account, snapshot, assert }) => {
   const { store, db } = await fixture(p, f, account, snapshot);
   try {
     assert.equal(await p.locator('.cp-login-link').count(), 0, 'the sign-in artwork has no extra Creator shortcut');
     await p.evaluate(() => CreatorsPortal.open());
     await p.waitForFunction(() => CreatorsPortal.snapshot?.rules);
     assert.match(await p.locator('#creatorsPanel').innerText(), /50,000 CP/);
     assert.equal(await p.locator('#creatorsPanel [data-tab="shop"]').count(), 0, 'unsigned visitors cannot see creator-only sections');
     await p.locator('#creatorsPanel [data-cp="close"]').click(); await login(p);
     assert.equal(await p.locator('[data-sbwid="nav-creators"]').count(), 0, 'Creators Portal is removed from the shared header');
     assert.equal(await p.locator('.sbw-hdr [data-sbwid^="nav-"]').count(), 10, 'the original ten header tabs remain');
     const trigger = p.locator('[data-sbwid="tut"]');
     assert.equal(await trigger.getAttribute('aria-label'), 'Creator');
     assert.equal(await trigger.locator('.sl').count(), 0, 'printed Tutorial label and icon cannot show through');
     assert.equal(await trigger.innerText(), '✦\nCreator');
     await p.screenshot({ path: path.join(root, 'tests/out/creator-button-desktop.png') });
     await trigger.focus(); await p.keyboard.press('Enter');
     await p.waitForFunction(() => document.querySelector('#creatorsPanel').matches(':modal'));
     await p.waitForFunction(() => !document.querySelector('#creatorsPanel').hasAttribute('aria-busy'));
     assert.equal(await p.locator('#creatorsPanel').getAttribute('data-design'), 'creator-popup-v2');
     assert.equal(await p.locator('.cp-hero-art img').evaluateAll(imgs => imgs.every(i => i.complete && i.naturalWidth > 0)), true, 'existing Shinobi artwork is packaged');
     await p.keyboard.press('Escape');
     assert.equal(await p.locator('#creatorsPanel').isVisible(), false);
     assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'closing returns keyboard focus to Creator');
     await trigger.click();
     await p.waitForFunction(() => !document.querySelector('#creatorsPanel').hasAttribute('aria-busy'));
     await p.locator('#cp-tab-overview').focus(); await p.keyboard.press('ArrowDown');
     await p.waitForFunction(() => document.activeElement?.id === 'cp-tab-apply');
     await p.locator('.cp-sections [data-tab="apply"]').click();
     await p.locator('[data-form="apply"] [name="displayName"]').fill('Moonlit Shinobi');
     await p.locator('[data-form="apply"] [name="channelUrl"]').fill('https://youtube.com/@moonlit-fixture');
     await p.locator('[data-form="apply"] [name="reason"]').fill('I create honest gameplay tutorials and disclose all referral rewards.');
     await p.locator('[data-form="apply"] [name="terms"]').check();
     await p.locator('[data-form="apply"] button[type="submit"]').click();
     await p.waitForFunction(() => CreatorsPortal.snapshot?.creator?.status === 'PENDING');
     assert.match(await p.locator('#creatorsPanel').innerText(), /Application Under Review/);
     await p.locator('#creatorsPanel [data-tab="admin"]').click();
     await p.locator('[data-status="APPROVED"]').click();
     await p.locator('.cp-modal [name="reason"]').fill('Verified creator channel and authenticated wallet in fixture.');
     await p.locator('.cp-modal button[value="confirm"]').click();
     await p.waitForFunction(() => CreatorsPortal.snapshot?.creator?.status === 'APPROVED');
     const creator = (await creators.summary(store, account, 'http://fixture')).creator;
     await creators.adminAction(store, account, { operation: 'adjust', creatorId: creator.id, deltaMilli: 125000000, reasonCode: 'fixture', reason: 'Isolated fixture points', requestId: crypto.randomUUID() });
     const referred = 'AGpFskd9re9Q9vopk1JXXhw7ziDFGuvV7783rn1AqCiQ';
     await creators.attribute(store, referred, { code: creator.code });
     await p.locator('#creatorsPanel [data-tab="dashboard"]').click();
     await p.evaluate(() => CreatorsPortal.open());
     await p.waitForFunction(() => CreatorsPortal.snapshot?.points?.balanceMilli === '125000000');
     await p.waitForFunction(() => !document.querySelector('#creatorsPanel').hasAttribute('aria-busy'));
     assert(!(await p.locator('.cp-notice').innerText()).includes('Loading creator program'), 'reopening during a refresh cannot leave a stale loading notice');
     assert.match(await p.locator('#creatorsPanel').innerText(), /125,000 CP/);
     assert.match(await p.locator('.cp-link').innerText(), /\/?creator=/);
     await p.screenshot({ path: path.join(root, 'tests/out/creators-dashboard-desktop.png') });
     await p.locator('#creatorsPanel [data-tab="referrals"]').click();
     assert.match(await p.locator('.cp-table').innerText(), /Player [A-F0-9]{10}/);
     assert(!(await p.locator('#creatorsPanel').innerText()).includes(referred), 'referral tracker does not leak player wallets');
     await p.locator('#creatorsPanel [data-tab="shop"]').click();
     await p.screenshot({ path: path.join(root, 'tests/out/creators-shop-desktop.png') });
     await p.locator('[data-redeem="hero-pass"]').click();
     await p.locator('.cp-modal button[value="confirm"]').click();
     await p.waitForFunction(() => CreatorsPortal.snapshot?.points?.balanceMilli === '100000000');
     assert(f.profile.heroes.some(h => h.creatorReward), 'shop delivers a real hero into the current game profile');
     assert.equal(await p.locator('[data-redeem]').count(), 1, 'only Standard Hero Summon Pass remains');
     assert.equal(await p.locator('[data-redeem="creator-aura"]').count(), 0);
     // The Creator Shop hero plays the same reveal: the panel closes, the hero is revealed, then the Heroes screen opens (newest first).
     await p.waitForFunction(() => S.v2.revealSource === 'reward' && S.v2.revealBatch?.length === 1 && document.querySelector('#revealContinue'), null, { timeout: 15000 });
     assert.equal(await p.locator('#creatorsPanel').isVisible(), false, 'the Creators panel makes way for the reveal');
     assert.match(await p.locator('#revealTitle').innerText(), /Reward received/);
     await p.evaluate(() => { Experience.revealAll(); RevealDesign.skip(); });
     await p.waitForFunction(() => S.v2.revealBatch.every(i => i.revealed) && !document.querySelector('#revealContinue').disabled);
     await p.locator('#revealContinue').click();
     await p.waitForFunction(() => WebsiteDesign.current() === 'heroes' && document.querySelectorAll('.sbw-scr.on .sbw-hcard').length >= 1, null, { timeout: 15000 });
     await p.evaluate(() => CreatorsPortal.open()); await p.waitForFunction(() => !document.querySelector('#creatorsPanel').hasAttribute('aria-busy') && CreatorsPortal.snapshot?.marker === 'shinobi-creators-portal-v1');
     await p.locator('#creatorsPanel [data-tab="history"]').click(); assert.match(await p.locator('.cp-table').innerText(), /not an NFT/);
     // Owner request 2026-11-10: staff link a player who used a mistyped link (listed sign-ups without a referrer, "Use", link).
     const uiFan = require('../app/node_modules/@solana/web3.js').Keypair.generate().publicKey.toBase58();
     await store.pool.query("INSERT INTO ryo_players(scope,wallet,player_id,username,username_key,created,last_login) VALUES($1,$2,$3,'UiFan','uifan',$4,$4)", [store.scope, uiFan, crypto.randomUUID(), Date.now()]);
     await p.locator('#creatorsPanel [data-tab="admin"]').click();
     await p.waitForSelector('[data-admin="link-referral"]');
     await p.locator('[data-admin="link-referral"] summary').click();
     await p.locator('[data-fill-player="UiFan"]').click();
     assert.equal(await p.locator('[data-form="attribute"] [name="player"]').inputValue(), 'UiFan', '"Use" fills the player');
     const creatorCode = await p.evaluate(() => CreatorsPortal.snapshot.creator.code);
     await p.locator('[data-form="attribute"] [name="code"]').fill(new URL(p.url()).origin + '/?creator=' + creatorCode);
     await p.locator('[data-form="attribute"] [name="reason"]').fill('Fixture: player used a broken link');
     await p.locator('[data-form="attribute"] button').click();
     await p.waitForFunction(() => /UiFan is now linked/.test(document.querySelector('#creatorsPanel .cp-notice')?.textContent || ''), null, { timeout: 15000 });
     assert.equal((await store.pool.query('SELECT COUNT(*) AS n FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [store.scope, uiFan])).rows[0].n * 1, 1, 'the staff link creates the referral');
     assert.equal(await p.locator('[data-fill-player="UiFan"]').count(), 0, 'the linked player leaves the list');
     await p.screenshot({ path: path.join(root, 'tests/out/creators-admin-desktop.png') });
     await p.locator('#creatorsPanel [data-cp="close"]').click();
     await p.locator('[data-sbwid="nav-guild"]').click(); await p.waitForFunction(() => WebsiteDesign.current() === 'guild');
     assert.equal(await p.locator('#creatorsPanel').isVisible(), false, 'existing Guild remains separate and operational');
     await p.locator('[data-sbwid="nav-heroes"]').click(); await p.waitForFunction(() => WebsiteDesign.current() === 'heroes');
     await p.locator('[data-sbwid="nav-adventure"]').click(); await p.waitForFunction(() => WebsiteDesign.current() === 'adventure');
     assert.deepEqual(errors, []);
   } finally { await db.close(); }
 });
 await withGame(async ({ p, f, errors, account, snapshot, assert }) => {
   const { store, db } = await fixture(p, f, account, snapshot);
   try {
     await creators.adminAction(store, account, { operation: 'manual-add', wallet: account, displayName: 'Sakura Streams', reason: 'Verified fixture manual approval' });
     await creators.handle({ store, origin: 'http://fixture' }, account, 'creator-terms', { terms: true });
     const c = (await creators.summary(store, account, 'http://fixture')).creator;
     await creators.adminAction(store, account, { operation: 'adjust', creatorId: c.id, deltaMilli: 50000000, reasonCode: 'fixture', reason: 'Isolated fixture points', requestId: crypto.randomUUID() });
     await login(p);
     assert.equal(await p.locator('.sbw-ph-more [data-k="creators"]').count(), 0);
     const trigger = p.locator('[data-sbwid="tut"]'); await trigger.scrollIntoViewIfNeeded();
     await p.screenshot({ path: path.join(root, 'tests/out/creator-button-mobile.png') });
     await trigger.click(); await p.waitForFunction(() => CreatorsPortal.snapshot?.creator?.status === 'APPROVED');
     assert.equal(await p.locator('#creatorsPanel').evaluate(el => el.matches(':modal')), true, 'mobile Creator opens the modal');
     await p.locator('#creatorsPanel [data-tab="dashboard"]').click();
     await p.screenshot({ path: path.join(root, 'tests/out/creators-dashboard-mobile.png') });
     const bounds = await p.locator('#creatorsPanel').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth })); assert(bounds.scroll <= bounds.width + 1, 'mobile portal has no page-width overflow');
     const shell = await p.locator('.cp-shell').evaluate(el => { const r = el.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:el.clientWidth, scroll:el.scrollWidth }; });
     assert(shell.left >= 0 && shell.right <= 390 && shell.top >= 0 && shell.bottom <= 844, 'mobile popup stays inside the viewport');
     assert(shell.scroll <= shell.width + 1, 'the popup content cannot overflow horizontally');
     assert.equal(await p.locator('.cp-sections').getAttribute('aria-orientation'), 'horizontal');
     await p.locator('#creatorsPanel [data-tab="shop"]').click(); await p.screenshot({ path: path.join(root, 'tests/out/creators-shop-mobile.png') });
     await p.locator('[data-redeem="hero-pass"]').click(); await p.waitForSelector('dialog.cp-modal[open]');
     await p.evaluate(() => RyoPayments.reset()); await p.waitForFunction(() => !document.querySelector('#creatorsPanel').textContent.includes('Sakura Streams'));
     assert.equal(await p.locator('dialog.cp-modal[open]').count(), 0, 'wallet changes dismiss private confirmation forms');
     assert.equal(await p.locator('#creatorsPanel [data-tab="shop"]').count(), 0, 'sign-out clears private creator data and sections');
     assert.deepEqual(errors, []);
   } finally { await db.close(); }
 }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
 for (const width of [1440,390]) await withGame(async ({p,f,errors,account,snapshot,assert}) => {
   const {store,db}=await fixture(p,f,account,snapshot);
   try {
     await p.evaluate(()=>CreatorsPortal.openPlayer());await p.waitForFunction(()=>CreatorsPortal.snapshot?.rules&&!document.querySelector('#creatorsPanel').hasAttribute('aria-busy'));
     assert.match(await p.locator('.cp-topline .cp-wallet').innerText(),/invite friends/);assert.equal(await p.locator('#cp-tab-apply').count(),0,'signed-out referral overview does not offer an application');
     await p.keyboard.press('Escape');
     await login(p);
     const button=p.locator('[data-sbwid="news"]'); await button.scrollIntoViewIfNeeded();
     assert.equal(await button.getAttribute('aria-label'),'Referral');
     assert.equal(await button.locator('.sl').count(),0,'old News label and icon are removed');
     const a=await p.locator('[data-sbwid="tut"]').boundingBox(), b=await button.boundingBox(); assert(a.x+a.width<=b.x+1,'Referral sits beside Creator');
     await button.click(); await p.waitForFunction(()=>CreatorsPortal.snapshot?.marker==='shinobi-player-referrals-v1');
     await p.waitForFunction(()=>!document.querySelector('#creatorsPanel').hasAttribute('aria-busy'));
     assert.equal(await p.locator('#creatorsPanel [data-tab="apply"]').count(),0,'players never apply');
     assert.equal(await p.locator('#creatorsPanel [data-tab="shop"]').count(),0,'no CP shop for regular referrals');
     assert.match(await p.locator('.cp-link').innerText(),/\/?referral=RP/);
     assert.equal((await creators.summary(store,account,'http://fixture')).creator,null,'no automatic creator account');
     const state=await p.evaluate(()=>CreatorsPortal.snapshot), invitee='AGpFskd9re9Q9vopk1JXXhw7ziDFGuvV7783rn1AqCiQ';
     await creators.attribute(store,invitee,{code:state.code});
     await store.transaction(async c=>{await c.query('UPDATE ryo_player_referrals SET paid_mints=15,stage5=$3 WHERE scope=$1 AND wallet=$2',[store.scope,invitee,Date.now()]); const r=(await c.query('SELECT * FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2',[store.scope,invitee])).rows[0];await require('../app/server/player-referrals.cjs').qualify(store,c,r)});
     await p.evaluate(()=>CreatorsPortal.openPlayer());await p.waitForFunction(()=>Number(CreatorsPortal.snapshot?.passes?.available)===2);
     await p.locator('#cp-tab-dashboard').click();
     await p.screenshot({path:path.join(root,`tests/out/player-referrals-${width}.png`)});
     const bounds=await p.locator('.cp-shell').evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:el.scrollWidth,width:el.clientWidth}});
     assert(bounds.left>=0&&bounds.right<=width&&bounds.scroll<=bounds.width+1,'referral popup fits the screen');
     const initial=f.profile.heroes.length;await p.locator('[data-player-claim="2"]').click();await p.locator('.cp-modal button[value="confirm"]').click();
     await p.waitForFunction(()=>Number(CreatorsPortal.snapshot?.passes?.claimed)===2);
     assert.equal(f.profile.heroes.length,initial+2);assert(f.profile.heroes.slice(-2).every(h=>h.referralReward));
     // The claimed heroes play the Summoning Shrine reveal (owner request 2026-11-10): the panel closes, nothing to buy again, and
     // finishing lands on the Heroes screen with the newest heroes first (they are Genin, so rarest-first would hide them).
     await p.waitForFunction(()=>S.v2.revealSource==='reward'&&S.v2.revealBatch?.length===2&&document.querySelector('#revealContinue'),null,{timeout:15000});
     assert.equal(await p.locator('#creatorsPanel').isVisible(),false,'the referral panel makes way for the reveal');
     assert.match(await p.locator('#revealTitle').innerText(),/Reward received/); assert.equal(await p.locator('.reveal-card .card-back').first().innerText().then(t=>/REWARD SCROLL/.test(t)),true);
     assert.deepEqual(await p.evaluate(()=>S.v2.revealBatch.map(i=>[i.hero.tokenOwner===RyoPayments.state.account,!!i.hero.tokenId])),[[true,true],[true,true]],'the batch holds the player\'s own delivered heroes');
     assert.equal(await p.locator('#revealAgain:visible, [data-reveal-again]:visible').count(),0,'no paid Summon Again for a reward');
     await p.evaluate(()=>{Experience.revealAll();RevealDesign.skip()});
     await p.waitForFunction(()=>S.v2.revealBatch.every(i=>i.revealed)&&!document.querySelector('#revealContinue').disabled);
     await p.locator('#revealContinue').click();
     await p.waitForFunction(()=>WebsiteDesign.current()==='heroes'&&document.querySelectorAll('.sbw-scr.on .sbw-hcard').length>=2,null,{timeout:15000});
     assert.equal(await p.evaluate(()=>document.querySelector('#p1 .heroes-sort').value),'new','the Heroes screen shows the newest heroes first');
     const firstTwo=await p.evaluate(()=>[...document.querySelectorAll('.sbw-scr.on .sbw-hcard')].slice(0,2).map(c=>({lock:!!c.querySelector('.sbw-bound'),rank:c.querySelector('.sbw-hc-top b')?.textContent})));
     assert.deepEqual(firstTwo.map(c=>c.lock),[true,true],'both new referral heroes are first and carry the referral-bound lock (their rank follows the summon odds)');
     await p.screenshot({path:path.join(root,`tests/out/reward-heroes-${width}.png`)});
     await p.evaluate(()=>CreatorsPortal.openPlayer());await p.waitForFunction(()=>Number(CreatorsPortal.snapshot?.passes?.claimed)===2&&!document.querySelector('#creatorsPanel').hasAttribute('aria-busy'));
     assert.equal(await p.locator('[data-player-claim="2"]').isDisabled(),true);
     await p.locator('#cp-tab-history').click();assert.match(await p.locator('.cp-table').innerText(),/not NFTs/);
     await p.locator('#cp-tab-referrals').click();assert.match(await p.locator('.cp-table').innerText(),/2 passes unlocked/);assert(!(await p.locator('#creatorsPanel').innerText()).includes(invitee));
     await p.keyboard.press('Escape');assert.equal(await p.locator('#creatorsPanel').isVisible(),false);
     await p.evaluate(()=>go(5));await p.waitForFunction(()=>WebsiteDesign.current()==='home');   // the reveal finished on the Heroes screen
     await p.locator('[data-sbwid="tut"]').click();await p.waitForFunction(()=>CreatorsPortal.snapshot?.marker==='shinobi-creators-portal-v1');
     assert.equal(await p.locator('#cp-tab-apply').count(),1,'creator application stays separate');assert.equal(await p.locator('[data-player-claim]').count(),0);
     assert.deepEqual(errors,[]);
   } finally {await db.close()}
 },{viewport:{width,height:width===390?844:1000},...(width===390?{isMobile:true,hasTouch:true}:{})});
 console.log('PASS: Creator and player referrals — separate Home buttons, hero-only Creator Shop, no-application player dashboard, immediate two-pass rewards, real profile claim and history, private referrals, desktop/mobile modal layouts and existing game preservation.');
})().catch(e => { console.error(e); process.exitCode = 1; });
