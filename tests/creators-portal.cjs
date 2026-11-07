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
     if (req.action === 'creator-redeem') { f.profile = await store.profile(account); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...result, ...snapshot() }) }); }
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
     await p.locator('[data-redeem="creator-aura"]').click(); await p.locator('.cp-modal button[value="confirm"]').click();
     await p.waitForFunction(() => RyoPayments.state.profile.creatorCosmetics?.aura === 'creator-aura');
     for (const item of ['creator-frame','creator-badge','creator-bomb']) { await p.locator('[data-redeem="'+item+'"]').click(); await p.locator('.cp-modal button[value="confirm"]').click(); await p.waitForFunction(id => Object.values(RyoPayments.state.profile.creatorCosmetics || {}).includes(id), item); }
     assert(await p.evaluate(() => document.body.classList.contains('cp-has-frame') && document.body.classList.contains('cp-has-badge')));
     const cosmetic = await p.evaluate(() => {
       const ctx = document.createElement('canvas').getContext('2d'); let strokes = 0; const original = ctx.stroke.bind(ctx); ctx.stroke = (...a) => { strokes++; return original(...a); };
       const damage = GameBalance.damage(S.h[0]); CharacterAnimations.drawActorEffects(ctx, { id: -1234 }, performance.now(), { x: 50, y: 50, scale: 1 });
       return { installed: CharacterAnimations.creatorCosmeticsInstalled, strokes, damage, after: GameBalance.damage(S.h[0]) };
     }); assert(cosmetic.installed && cosmetic.strokes > 0); assert.equal(cosmetic.damage, cosmetic.after, 'cosmetics do not modify damage');
     await p.locator('#creatorsPanel [data-tab="history"]').click(); assert.match(await p.locator('.cp-table').innerText(), /not an NFT/);
     await p.locator('#creatorsPanel [data-tab="admin"]').click();
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
 console.log('PASS: integrated Creators Portal — Home Creator replaces Tutorial without stale artwork, original header, themed desktop/mobile modal, keyboard focus/Escape/tabs, public overview, wallet application, admin approval, atomic CP shop/profile, privacy and existing navigation preservation.');
})().catch(e => { console.error(e); process.exitCode = 1; });
