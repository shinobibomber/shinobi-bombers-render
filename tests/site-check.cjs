#!/usr/bin/env node
/* Website + game-link checks (isolated: no wallet, no real API calls, no transactions).
 *  A. preview mode  – website opened from disk with the default site-config.js (no game connected)
 *  B. live mode     – website + unmodified game served together by server/site-server.cjs (game at /play/)
 * Usage: node tests/site-check.cjs  (after npm run build and npm --prefix tests ci) */
const { chromium } = require('playwright'), path = require('node:path'), assert = require('node:assert/strict'), { spawn } = require('node:child_process'), fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '..'), FILE = pathToFileURL(path.join(ROOT, 'website', 'index.html')).href;
const ROUTES = ['home', 'summon', 'fusion', 'market', 'boss-hunt', 'guild', 'guild-shop', 'adventure', 'heroes', 'codex', 'chat', 'dojo'];
const results = []; let failed = 0;
async function check(name, fn) { try { await fn(); results.push('PASS  ' + name); } catch (e) { failed++; results.push('FAIL  ' + name + '\n        ' + String(e.message).split('\n')[0]); } }
const blockFonts = p => p.route(/fonts\.(googleapis|gstatic)\.com|api\.devnet\.solana\.com/, r => r.abort());
const hs = (p, id) => p.locator(`.scr.on .hs[data-id="${id}"]`);

async function startServer() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'site-server.cjs')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RYO_SITE_ORIGIN: 'http://127.0.0.1:' + port }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('server did not start')), 8000); child.stdout.on('data', d => { if (/Website on/.test(d)) { clearTimeout(t); res(); } }); child.on('exit', c => rej(new Error('server exited ' + c))); });
  return { url: 'http://127.0.0.1:' + port, stop: () => child.kill() };
}

(async () => {
  fs.mkdirSync(path.join(ROOT, 'tests', 'out'), { recursive: true });
  const browser = await chromium.launch(); const errors = [];
  const page = async (vp = { width: 1672, height: 941 }) => { const p = await browser.newPage({ viewport: vp }); p.on('pageerror', e => errors.push(e.message)); await blockFonts(p); return p; };

  /* ---------------- A. preview mode ---------------- */
  {
    const p = await page();
    await check('preview: every route renders without page errors', async () => { for (const r of ROUTES) { await p.goto(FILE + '#' + r); await p.waitForSelector('.scr.on .base'); } assert.deepEqual(errors, []); });
    await check('preview: header keeps the existing demo values', async () => { await p.goto(FILE + '#home'); await p.waitForTimeout(300); assert.match(await p.locator('.scr.on .lv-ryo').textContent(), /884,250 Ryo/); assert.equal(await p.locator('.sbg-cover').count(), 0); });
    await check('preview: wallet pill opens #play (preview status) and Escape returns to the same screen', async () => {
      await p.goto(FILE + '#market'); await hs(p, 'wallet').click(); await p.waitForSelector('.sbg-play:not([hidden])');
      assert.match(await p.locator('.sbg-status').textContent(), /Preview mode/); assert.equal(await p.locator('.sbg-play a[href]').count(), 0, 'no game link without a configured URL');
      await p.keyboard.press('Escape'); await p.waitForSelector('.sbg-play', { state: 'hidden' }); assert.equal(await p.evaluate(() => location.hash), '#market'); assert.equal(await p.locator('.scr.on').getAttribute('id'), 'scr-market'); });
    await check('preview: "+" next to Ryo opens the website Chest (existing demo)', async () => { await p.goto(FILE + '#fusion'); await hs(p, 'ryoplus').click(); await p.waitForSelector('#cm:not([hidden])'); await p.keyboard.press('Escape'); });
    await check('preview: Summon keeps its existing demo reveal', async () => { await p.goto(FILE + '#summon'); await hs(p, 'go').click(); await p.waitForSelector('.rev'); await p.keyboard.press('Escape'); });
    await p.close();
  }

  /* ---------------- B. live mode (same-origin host) ---------------- */
  const hasGame = fs.existsSync(path.join(ROOT, 'app', 'server', 'render-server.cjs'));
  if (!hasGame) results.push('SKIP  live mode – app/ not assembled (npm run build)');
  else {
    const srv = await startServer();
    try {
      const p = await page(); const url = srv.url;
      await check('live: site-config served from environment points at /play/', async () => { const r = await (await fetch(url + '/site-config.js')).text(); assert.match(r, /"gameUrl":"\/play\/"/); });
      await check('live: game health, API and config reach the game server at root paths', async () => {
        assert.equal((await fetch(url + '/healthz')).status, 200);
        const api = await fetch(url + '/.netlify/functions/ryo', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: '{"action":"config"}' }); assert.ok([200, 400, 403, 503].includes(api.status), 'API answered ' + api.status);
        const c = await fetch(url + '/play/beta-config.json'); assert.notEqual((await c.text()).includes('"tokenAddress": null'), true, 'must not serve the static placeholder config');
        assert.equal((await fetch(url + '/play/../server/service.cjs')).status, 404); });
      await check('live: real game page loads at /play/ (Canvas game, own login)', async () => { const g = await page(); await g.goto(url + '/play/'); await g.waitForTimeout(2500); assert.match(await g.title(), /Shinobi Bombers/); assert.ok(await g.locator('canvas').count() > 0); await g.close(); });
      await check('live: header shows no demo account values', async () => {
        await p.goto(url + '/#home'); await p.waitForTimeout(400);
        assert.equal(await p.locator('.scr.on .lv-ryo').textContent(), '— Ryo'); assert.equal(await p.locator('.scr.on .lv-chest').textContent(), 'Chest');
        assert.deepEqual(await p.locator('.scr.on .sbg-cover').allTextContents(), ['Sign in', '—']); });
      await check('live: Chest button hands off to the game (no website Chest, link = /play/)', async () => {
        await p.locator('.scr.on .chestbtn').click(); await p.waitForSelector('.md'); assert.equal(await p.locator('#cm').isHidden(), true);
        assert.equal(await p.locator('.md [data-sbg-open]').getAttribute('href'), url + '/play/'); await p.keyboard.press('Escape'); });
      await check('live: Summon / Fuse / Train / Dojo upgrade / Work All hand off instead of simulating', async () => {
        for (const [r, id] of [['summon', 'go'], ['fusion', 'fuse'], ['heroes', 'dtrain'], ['dojo', 'upg'], ['adventure', 'wa'], ['boss-hunt', 'ch']]) {
          await p.goto(url + '/#' + r); await hs(p, id).click(); await p.waitForSelector('.md [data-sbg-open]', { timeout: 3000 }); assert.equal(await p.locator('.rev,.cine').count(), 0, r + ' must not run a demo'); await p.keyboard.press('Escape'); await p.waitForSelector('.md', { state: 'detached' }); } });
      await check('live: Guild and Chat actions report the missing service honestly', async () => {
        await p.goto(url + '/#guild'); await hs(p, 'qg2').click(); await p.waitForTimeout(200); assert.match(await p.locator('#toast').textContent(), /Guild isn't available yet/); assert.equal(await p.locator('.md').count(), 0);
        await p.goto(url + '/#chat'); await p.locator('.chin').fill('hello'); await hs(p, 'send').click(); await p.waitForTimeout(200); assert.match(await p.locator('#toast').textContent(), /Chat isn't available yet/); assert.equal(await p.locator('.cmsg.me').count(), 0); });
      await check('live: demo Adventure does not credit a fake Chest', async () => { await p.goto(url + '/#adventure'); await p.waitForTimeout(4000); assert.equal(await p.locator('.apop').count(), 0); assert.equal(await p.locator('.scr.on .lv-chest').textContent(), 'Chest'); });
      await check('live: design-only interactions still work (filters, tabs, galleries)', async () => {
        await p.goto(url + '/#market'); await hs(p, 'dd1').click(); await p.waitForSelector('.dd'); await p.keyboard.press('Escape');
        await p.goto(url + '/#codex'); await hs(p, 'cs5').click(); await p.waitForSelector('.cxp:not([hidden])'); });
      await check('live: #play page links to the game and the optional same-origin preview loads it', async () => {
        await p.goto(url + '/#dojo'); await hs(p, 'wallet').click(); await p.waitForSelector('.sbg-play:not([hidden])');
        assert.match(await p.locator('.sbg-status').textContent(), /Game connected/); assert.equal(await p.locator('.sbg-actions a').first().getAttribute('href'), url + '/play/');
        await p.locator('.sbg-play summary').click(); const f = p.frameLocator('.sbg-frame'); await f.locator('canvas').first().waitFor({ timeout: 8000 });
        await p.locator('.sbg-x').click(); await p.waitForSelector('.sbg-play', { state: 'hidden' }); assert.equal(await p.evaluate(() => location.hash), '#dojo'); });
      await check('live: #play page fits a 390×844 phone without horizontal scrolling', async () => {
        const m = await page({ width: 390, height: 844 }); await m.goto(url + '/#play'); await m.waitForSelector('.sbg-play:not([hidden])');
        assert.ok(await m.evaluate(() => document.querySelector('.sbg-panel').scrollWidth <= document.querySelector('.sbg-panel').clientWidth + 1)); await m.screenshot({ path: path.join(ROOT, 'tests', 'out', 'play-mobile.png') }); await m.close(); });
      await check('live: no page errors', async () => assert.deepEqual(errors, []));
      await p.close();
    } finally { srv.stop(); }
  }
  await browser.close();
  console.log('Website + game-link checks (isolated; no wallet, no transactions):\n' + results.map(r => '  ' + r).join('\n'));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
