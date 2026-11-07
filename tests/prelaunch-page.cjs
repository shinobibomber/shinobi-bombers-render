/* Pre-launch portal in a real browser (Playwright), served by the real site host in PRELAUNCH_MODE with an
 * in-memory Postgres. A test Wallet Standard wallet signs with a real ed25519 key; no transaction exists.
 * Checks: every text key exists in EN and PT-BR, sign-in → registration with a ?ref= link → dashboard,
 * referral list on the referrer's dashboard, language switch, Comfort mode, reduced motion, keyboard
 * skip link, phone layout without sideways scroll, legal pages, no page errors. Screenshots in tests/out/. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('playwright'), { PGlite } = require('@electric-sql/pglite');
const ROOT = path.resolve(__dirname, '..'), APP_SERVER = path.join(ROOT, 'app/server'), OUT = path.join(__dirname, 'out');
const web3 = require(path.join(ROOT, 'app/node_modules/@solana/web3.js'));

// 1. Every data-i18n key used by the pages exists in both languages (and the lists are lists).
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'prelaunch/i18n/en.json'), 'utf8')), pt = JSON.parse(fs.readFileSync(path.join(ROOT, 'prelaunch/i18n/pt-BR.json'), 'utf8'));
assert.deepEqual(Object.keys(pt).sort(), Object.keys(en).sort(), 'PT-BR has exactly the English keys');
const used = new Set();
for (const f of ['index.html', 'rules.html', 'privacy.html', 'terms.html']) {
  const html = fs.readFileSync(path.join(ROOT, 'prelaunch', f), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-list)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(';').forEach(p => used.add(p.split(':')[1]));
}
const js = fs.readFileSync(path.join(ROOT, 'prelaunch/prelaunch.js'), 'utf8');
for (const m of js.matchAll(/\bt\('([a-zA-Z0-9_.-]+)'/g)) if (!m[1].endsWith('.')) used.add(m[1]);   // 'err.' + code etc. are dynamic
for (const k of ['region.asia', 'region.south-america', 'status.IN_PROGRESS', 'status.QUALIFIED', 'kind.beta', 'kind.launch', 'kind.maintenance', 'kind.referral', 'kind.community', 'err.default']) used.add(k);
// Every error code the API or wallet adapter can return has a message in both languages.
const codes = new Set([...fs.readFileSync(path.join(ROOT, 'prelaunch/server.cjs'), 'utf8').matchAll(/'([A-Z][A-Z_]{3,})'/g)].map(m => m[1]).filter(c => !/^(POST|JSON|QUALIFIED|IN_PROGRESS|PENDING|APPROVED|REJECTED|SUSPENDED)$/.test(c)));
for (const c of ['WALLET_REJECTED', 'WALLET_NO_SIGN', 'NETWORK', 'ACCEPT']) codes.add(c);
for (const c of codes) used.add('err.' + c);
for (const k of used) { assert.ok(k in en, 'missing EN key ' + k); assert.ok(k in pt, 'missing PT-BR key ' + k); }
for (const k of Object.keys(en)) if (Array.isArray(en[k])) assert.equal(pt[k].length, en[k].length, 'same list length ' + k);

const keyPair = () => { const kp = web3.Keypair.generate(), priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.slice(0, 32))]), format: 'der', type: 'pkcs8' });
  return { wallet: kp.publicKey.toBase58(), sign: bytes => [...crypto.sign(null, Buffer.from(bytes), priv)] }; };

(async () => {
  // 2. The real site host, in-process, with PGlite standing in for the pg Pool.
  const db = new PGlite(), schema = fs.readFileSync(path.join(APP_SERVER, 'schema.sql'), 'utf8'); await db.exec(schema);
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  class Pool { async query(s, a) { const r = await lock(); try { return await db.query(s, a); } finally { r(); } } async connect() { const r = await lock(); return { query: (s, a) => db.query(s, a), release: r }; } end() {} }
  require.cache[require.resolve('pg', { paths: [APP_SERVER] })] = { id: 'pg', loaded: true, exports: { Pool } };
  const port = 20000 + Math.floor(Math.random() * 20000), url = 'http://localhost:' + port;
  Object.assign(process.env, { SOLANA_NETWORK: 'devnet', PRELAUNCH_MODE: 'on', RYO_SCOPE: 'solana-devnet:page-test', DATABASE_URL: 'postgres://pglite', RYO_SITE_ORIGIN: url, DISCORD_URL: 'https://discord.gg/example', DEMO_URL: 'https://demo.example/' });
  for (const k of ['RYO_TREASURY_SECRET', 'RYO_TOKEN_MINT', 'RYO_STUDIO_WALLET', 'RYO_REVENUE_WALLET', 'STARTER_PACK', 'LAUNCH_AT']) delete process.env[k];
  const { server } = require(path.join(ROOT, 'server/site-server.cjs'));
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(), errors = [];
  const results = []; let failed = 0;
  const check = async (name, fn) => { try { await fn(); results.push('PASS  ' + name); } catch (e) { failed++; results.push('FAIL  ' + name + '\n        ' + String(e.message).split('\n')[0]); } };

  async function open(viewport, wallet, extra = {}) {
    const ctx = await browser.newContext({ viewport, ...extra }), p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    if (wallet) {
      await p.exposeFunction('__testSign', bytes => wallet.sign(bytes));
      await p.addInitScript(address => {
        const w = { version: '1.0.0', name: 'Test Wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains: ['solana:devnet'], accounts: [],
          features: { 'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [{ address, chains: ['solana:devnet'], features: ['solana:signMessage'] }] }) },
            'solana:signMessage': { version: '1.0.0', signMessage: async ({ message }) => [{ signedMessage: message, signature: new Uint8Array(await window.__testSign([...message])) }] } } };
        addEventListener('wallet-standard:app-ready', e => e.detail.register(w));
      }, wallet.wallet);
    }
    return p;
  }
  async function register(p, username) {
    await p.click('#heroConnect');
    await p.getByRole('button', { name: /Test Wallet/ }).click();
    await p.waitForSelector('#registerDialog[open]');
    await p.fill('#registerForm input[name=username]', username);
    await p.check('#registerForm input[name=accept]');
    await p.click('#registerForm button[type=submit]');
    await p.waitForSelector('#dashboard:not([hidden])');
    await p.waitForFunction(() => Math.abs(document.querySelector('#dashboard').getBoundingClientRect().top) < 120, null, { timeout: 5000 });
  }

  const referrer = keyPair(), friend = keyPair(), creatorKey = keyPair(), adminKey = keyPair();
  process.env.RYO_ADMIN_APPROVERS = adminKey.wallet;   // the admin panel appears for this wallet only
  let code;
  await check('desktop: landing page renders every section, honest launch status, Discord link, no page errors', async () => {
    const p = await open({ width: 1440, height: 900 });
    await p.goto(url + '/');
    await p.waitForFunction(() => document.querySelector('#discordLink') && !document.querySelector('#discordLink').hidden);
    for (const id of ['#home', '#intro', '#join', '#referral', '#rewards', '#community', '#faq']) assert.ok(await p.isVisible(id), id);
    assert.equal(await p.textContent('h1'), 'THE SHINOBI ERA BEGINS SOON');
    assert.equal(await p.textContent('#launchStatus'), 'OFFICIAL LAUNCH: TO BE ANNOUNCED');
    assert.equal(await p.isVisible('#countdown'), false, 'no countdown to an invented date');
    assert.match(await p.textContent('.badge'), /PRE-LAUNCH — GAME SERVER NOT YET OPEN/);
    assert.match(await p.textContent('#referral'), /2 FREE RANDOM HEROES[\s\S]*permanently non-marketable/);
    assert.equal(await p.getAttribute('#discordLink', 'href'), 'https://discord.gg/example');
    assert.equal(await p.isVisible('#discordSoon'), false, 'the placeholder hides once a Discord link is set');
    assert.equal(await p.isVisible('#xLink'), false, 'no X link is shown when none is configured');
    // The demo (test server) is offered from the hero, the menu and its own section, clearly labelled.
    assert.ok(await p.isVisible('#heroDemo')); assert.ok(await p.isVisible('#demo')); assert.ok(await p.isVisible('#navLinks a[href="#demo"]'));
    assert.equal(await p.getAttribute('#demoLink', 'href'), 'https://demo.example/'); assert.equal(await p.getAttribute('#demoLink', 'target'), '_blank');
    assert.match(await p.textContent('#demo'), /test server \(Solana Devnet\)[\s\S]*do not carry over to the official launch/);
    assert.equal(await p.locator('#demo li').count(), 5);
    assert.equal(await p.locator('#newsList article').count(), 1);
    assert.equal(await p.locator('[data-i18n]').evaluateAll(els => els.filter(e => /^[a-z]+\.[a-zA-Z0-9.]+$/.test(e.textContent.trim())).length), 0, 'no raw keys on screen');
    await p.screenshot({ path: path.join(OUT, 'prelaunch-desktop.png'), fullPage: true });
    await p.close();
  });
  await check('sign-in + registration: the referrer registers and gets a permanent RP link', async () => {
    const p = await open({ width: 1440, height: 900 }, referrer);
    await p.goto(url + '/'); await register(p, 'Akira');
    code = (await p.textContent('#dCode')).trim(); assert.match(code, /^RP[0-9A-F]{20}$/);
    assert.equal(await p.inputValue('#refLink'), url + '/?referral=' + code);
    assert.match(await p.textContent('#dashWelcome'), /Welcome, Akira/);
    assert.equal(await p.textContent('#sInvited'), '0');
    await p.close();
  });
  await check('?ref= link → friend registers with the code → linked permanently; referrer sees them (no fake progress)', async () => {
    const f = await open({ width: 1440, height: 900 }, friend);
    await f.goto(url + '/?ref=' + code); await register(f, 'Bunta');
    await f.waitForFunction(() => !document.querySelector('#dReferredBy').hidden);
    assert.equal(await f.textContent('#dReferredBy'), 'Invited by Akira');
    await f.close();
    const p = await open({ width: 1440, height: 900 }, referrer);
    await p.goto(url + '/'); await p.click('#heroConnect'); await p.getByRole('button', { name: /Test Wallet/ }).click();
    await p.waitForSelector('#dashboard:not([hidden])'); await p.waitForFunction(() => document.querySelector('#sInvited').textContent === '1');
    const row = await p.textContent('#refList .ref-item:not(.head)');
    assert.match(row, /Bunta/); assert.match(row, /Awaiting Official Launch/); assert.match(row, /IN PROGRESS/); assert.match(row, /LOCKED/);
    assert.match(await p.textContent('#board'), /Akira[\s\S]*1/);
    await p.waitForFunction(() => Math.abs(document.querySelector('#dashboard').getBoundingClientRect().top) < 120, null, { timeout: 5000 });   // scrolled into view after sign-in
    await p.screenshot({ path: path.join(OUT, 'prelaunch-dashboard.png'), fullPage: false });
    // Sign out ends the session: a reload shows the public page.
    await p.click('#logoutBtn'); await p.reload(); await p.waitForTimeout(400);
    assert.equal(await p.isVisible('#dashboard'), false);
    await p.close();
  });
  await check('creator program: apply after sign-in → pending → admin approves on the page → creator link', async () => {
    const p = await open({ width: 1440, height: 900 }, creatorKey);
    await p.goto(url + '/');
    assert.ok(await p.isVisible('#creators')); assert.ok(await p.isVisible('#navLinks a[href="#creators"]'));
    assert.match(await p.textContent('#creators'), /50,000 Creator Points[\s\S]*5% CP commission[\s\S]*no cash or crypto value/);
    // One click: sign in, register, and the application opens by itself.
    await p.click('#creatorCta'); await p.getByRole('button', { name: /Test Wallet/ }).click();
    await p.waitForSelector('#registerDialog[open]'); await p.fill('#registerForm input[name=username]', 'StreamKing'); await p.check('#registerForm input[name=accept]');
    await p.click('#registerForm button[type=submit]');
    await p.waitForSelector('#creatorDialog[open]');
    assert.equal(await p.inputValue('#creatorForm input[name=displayName]'), 'StreamKing');
    await p.fill('#creatorForm input[name=displayName]', 'Stream King');
    await p.selectOption('#creatorForm select[name=platform]', 'Twitch');
    await p.fill('#creatorForm input[name=channelUrl]', 'http://twitch.tv/streamking');
    await p.fill('#creatorForm textarea[name=reason]', 'Weekly ninja game streams.');
    await p.check('#creatorForm input[name=terms]'); await p.click('#creatorForm button[type=submit]');
    assert.match(await p.textContent('#apStatus'), /https:\/\//, 'http links are refused before sending');
    await p.fill('#creatorForm input[name=channelUrl]', 'https://twitch.tv/streamking'); await p.fill('#creatorForm input[name=audience]', '5400');
    await p.click('#creatorForm button[type=submit]');
    await p.waitForFunction(() => /APPLICATION UNDER REVIEW/.test(document.querySelector('#creatorBody').textContent));
    assert.equal(await p.isVisible('#adminPanel'), false, 'creators do not see the admin panel');
    await p.close();

    const a = await open({ width: 1440, height: 900 }, adminKey);
    await a.goto(url + '/'); await register(a, 'TeamAdmin');
    await a.waitForSelector('#adminPanel:not([hidden]) .admin-item');
    const item = a.locator('.admin-item', { hasText: 'Stream King' });
    assert.match(await item.textContent(), /Twitch[\s\S]*5,400[\s\S]*Weekly ninja game streams/);
    await item.getByRole('button', { name: 'Approve' }).click();
    assert.match(await a.textContent('#toast'), /Enter a reason first/);
    await item.locator('input').first().fill('Verified Twitch channel');
    await item.getByRole('button', { name: 'Approve' }).click();
    await a.waitForFunction(() => /APPROVED/.test([...document.querySelectorAll('.admin-item')].find(n => /Stream King/.test(n.textContent))?.textContent || ''));
    await a.screenshot({ path: path.join(OUT, 'prelaunch-admin.png'), fullPage: false });
    await a.close();

    const c = await open({ width: 1440, height: 900 }, creatorKey);
    await c.goto(url + '/'); await c.click('#heroConnect'); await c.getByRole('button', { name: /Test Wallet/ }).click();
    await c.waitForSelector('#creatorCode');
    assert.match(await c.textContent('#creatorCode'), /^SB[0-9A-F]{14}$/);
    assert.doesNotMatch(await c.textContent('#creatorBody'), /null|undefined/, 'no empty placeholders');
    assert.equal(await c.inputValue('#creatorLink'), url + '/?creator=' + (await c.textContent('#creatorCode')));
    await c.locator('#creatorCard').scrollIntoViewIfNeeded();
    await c.screenshot({ path: path.join(OUT, 'prelaunch-creator.png'), fullPage: false });
    await c.close();
  });
  await check('PT-BR: language switch translates the page and is remembered', async () => {
    const p = await open({ width: 1280, height: 860 });
    await p.goto(url + '/'); await p.selectOption('#langSelect', 'pt-BR');
    await p.waitForFunction(() => document.documentElement.lang === 'pt-BR');
    assert.equal(await p.textContent('h1'), 'A ERA SHINOBI COMEÇA EM BREVE');
    assert.equal(await p.textContent('#launchStatus'), 'LANÇAMENTO OFICIAL: A SER ANUNCIADO');
    await p.reload(); await p.waitForFunction(() => document.documentElement.lang === 'pt-BR');
    await p.close();
    const b = await open({ width: 1280, height: 860 }, null, { locale: 'pt-BR' });
    await b.goto(url + '/'); await b.waitForFunction(() => document.documentElement.lang === 'pt-BR'); await b.close();
  });
  await check('accessibility: skip link first, Comfort mode persists, reduced motion stops animation', async () => {
    const p = await open({ width: 1280, height: 860 }, null, { reducedMotion: 'reduce' });
    await p.goto(url + '/'); await p.keyboard.press('Tab');
    assert.equal(await p.evaluate(() => document.activeElement.className), 'skip');
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.dot')).animationName), 'none');
    await p.click('#comfortBtn'); assert.equal(await p.getAttribute('#comfortBtn', 'aria-pressed'), 'true');
    await p.reload(); assert.ok(await p.evaluate(() => document.documentElement.classList.contains('comfort')));
    await p.close();
  });
  await check('phone 390×844: no sideways scroll, collapsible menu, 44px controls, register works', async () => {
    const p = await open({ width: 390, height: 844 }, keyPair(), { isMobile: true, hasTouch: true });
    await p.goto(url + '/');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'no horizontal scroll');
    assert.equal(await p.isVisible('#navLinks'), false); await p.click('.menu-toggle'); assert.equal(await p.isVisible('#navLinks'), true);
    await p.click('#navLinks a[href="#faq"]'); assert.equal(await p.isVisible('#navLinks'), false, 'menu closes after navigation');
    const small = await p.locator('button:visible, .btn:visible').evaluateAll(els => els.filter(e => e.getBoundingClientRect().height < 44).map(e => e.id || e.className));
    assert.deepEqual(small, []);
    await p.screenshot({ path: path.join(OUT, 'prelaunch-phone.png'), fullPage: true });
    await register(p, 'Chiyo');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'dashboard fits too');
    await p.screenshot({ path: path.join(OUT, 'prelaunch-phone-dashboard.png'), fullPage: false });
    await p.close();
  });
  await check('legal pages: referral rules, privacy and draft terms render in both languages', async () => {
    const p = await open({ width: 1024, height: 800 });
    await p.goto(url + '/rules'); await p.waitForFunction(() => document.querySelectorAll('main ol')[0]?.children.length === 11 && document.querySelectorAll('#creator-program + ol li').length === 7);
    assert.match(await p.textContent('main'), /15 paid hero summons[\s\S]*Stage 5/);
    await p.goto(url + '/terms'); await p.waitForSelector('.draft'); assert.match(await p.textContent('.draft'), /DRAFT/);
    await p.goto(url + '/privacy'); await p.selectOption('#langSelect', 'pt-BR'); await p.waitForFunction(() => document.querySelector('h1').textContent === 'Aviso de Privacidade');
    await p.close();
  });
  await check('no page errors anywhere', async () => assert.deepEqual(errors, []));

  await browser.close(); server.close();
  console.log(results.join('\n'));
  if (failed) { console.error('\n' + failed + ' pre-launch page check(s) failed.'); process.exit(1); }
  console.log('\nPASS: pre-launch portal in the browser (' + results.length + ' checks).');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
