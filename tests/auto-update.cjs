/* Update notice (auto-update/auto-update.js): after a deploy an open game page shows a 10 s countdown banner and reloads, comes
 * back signed in (silent Phantom reconnect) and on the Adventure map. Safe: it waits while the player is busy (dialog open),
 * sends the last kills before reloading, never loops, and a hidden tab makes no requests. Plus the real /version.json route of the
 * site server. Isolated fixtures only. */
'use strict';
const assert = require('node:assert/strict'), path = require('node:path'), { spawn } = require('node:child_process');
const { withGame } = require('./harness.cjs');
const entered = () => RyoPayments.state.authenticated && !LoginScreen.active;

(async () => {
  await withGame(async ({ p, f, errors }) => {
    f.holdAdventure = false;
    let version = 'v1', versionCalls = 0;
    await p.route('**/version.json', r => { versionCalls++; r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ v: version }) }); });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(entered, null, { timeout: 15000 });
    await p.waitForFunction(() => window.AutoUpdate && window.GlobalChestUI?.ready, null, { timeout: 15000 });

    // 1. Same version: nothing happens.
    await p.evaluate(() => AutoUpdate.check()); await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => AutoUpdate.known), 'v1', 'the page remembers the version it loaded with');
    await p.evaluate(() => AutoUpdate.check()); await p.waitForTimeout(300);
    assert.equal(await p.locator('.sb-autoupdate').count(), 0, 'no banner while the version is unchanged');

    // 2. Hidden tab: no version request, no banner.
    version = 'v2';
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
    const before = versionCalls; await p.evaluate(() => AutoUpdate.check()); await p.waitForTimeout(300);
    assert.equal(versionCalls, before, 'a hidden tab makes no version request');
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });

    // 3. New version while the player is busy (a dialog is open): the banner waits and the countdown does not run.
    await p.evaluate(() => { const d = document.createElement('dialog'); d.id = 'testBusyDialog'; d.textContent = 'busy'; document.body.append(d); d.showModal(); });
    await p.evaluate(() => AutoUpdate.check());
    await p.waitForSelector('.sb-autoupdate');
    await p.waitForTimeout(3500);
    assert.match(await p.locator('.sb-autoupdate [data-au-text]').innerText(), /as soon as you finish/, 'busy: the banner says it is waiting');
    assert.equal(await p.evaluate(() => AutoUpdate.pending), true, 'the update is pending');
    await p.evaluate(() => document.querySelector('#testBusyDialog').close());
    await p.waitForFunction(() => /Reloading in \d+ s/.test(document.querySelector('.sb-autoupdate [data-au-text]')?.textContent || ''), null, { timeout: 5000 });
    const shown = Number((await p.locator('.sb-autoupdate [data-au-text]').innerText()).match(/in (\d+) s/)[1]);
    assert(shown <= 10 && shown >= 6, 'free again: the 10 s countdown runs (' + shown + ' s left)');

    // 4. The countdown ends: the page reloads by itself, signed in again without a signature, kills sent first.
    const mark = f.requests.length;
    await p.evaluate(() => { window.__marker = 'before-reload'; });
    const adventure = () => p.evaluate(() => ({ map: S.map, heroes: S.h.length, team: S.h.filter(h => h.deployed || h.active).length }));
    const was = await adventure();
    const nav = p.waitForEvent('load', { timeout: 30000 });
    await nav;
    await p.waitForFunction(() => window.GlobalChestUI?.ready && !window.GameLoading?.active, null, { timeout: 45000 });
    await p.waitForFunction(entered, null, { timeout: 20000 });
    assert.equal(await p.evaluate(() => window.__marker), undefined, 'the page really reloaded');
    assert.equal(f.requests.slice(mark).filter(r => r.action === 'challenge').length, 0, 'signed in again without a new wallet signature');
    assert(f.requests.slice(mark).some(r => r.action === 'adventure'), 'the Adventure state is synced before and after the reload');
    assert.deepEqual(await adventure(), was, 'back on the same Adventure stage with the same heroes and team');
    assert.equal(await p.locator('.sb-autoupdate').count(), 0, 'no banner after the reload (the page now runs the new version)');
    assert.equal(await p.evaluate(() => AutoUpdate.known), 'v2', 'the reloaded page runs v2');

    // 5. Loop guard: another new version right after a reload does not start another one (5-minute gap).
    version = 'v3';
    await p.evaluate(() => AutoUpdate.check()); await p.waitForTimeout(500);
    assert.equal(await p.locator('.sb-autoupdate').count(), 0, 'no second reload within five minutes');

    // 6. Reload now button: after the gap has passed, the button reloads at once.
    await p.evaluate(() => sessionStorage.removeItem('shinobi-auto-update-v1'));
    await p.evaluate(() => AutoUpdate.check()); await p.waitForSelector('.sb-autoupdate');
    const nav2 = p.waitForEvent('load', { timeout: 30000 });
    await p.locator('.sb-autoupdate [data-au-now]').click();
    await nav2;
    await p.waitForFunction(entered, null, { timeout: 30000 });
    assert.deepEqual(errors.filter(e => !/net::ERR_ABORTED|Failed to fetch|Load failed/i.test(String(e))), [], 'no page errors');
  });

  // 7. The real site server answers /version.json: no-store, GET/HEAD only, the Render commit when set.
  const http = require('node:http');
  const ask = (port, method) => new Promise((resolve, reject) => { const r = http.request({ host: '127.0.0.1', port, path: '/version.json', method }, res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString() })); }); r.on('error', reject); r.end(); });
  for (const [env, expect] of [[{ RENDER_GIT_COMMIT: 'abc123def456' }, /^abc123def456$/], [{ RENDER_GIT_COMMIT: '' }, /^local-/]]) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'site-server.cjs')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RYO_SITE_ORIGIN: 'http://127.0.0.1:' + port, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('server did not start')), 15000); child.stdout.on('data', d => { if (/Website on/.test(d)) { clearTimeout(t); res(); } }); child.on('exit', c => rej(new Error('server exited ' + c))); });
      const r = await ask(port, 'GET'); assert.equal(r.status, 200); assert.match(r.headers['cache-control'], /no-store/); assert.match(JSON.parse(r.body).v, expect, 'version ' + JSON.stringify(env));
      assert.equal((await ask(port, 'HEAD')).status, 200); assert.equal((await ask(port, 'POST')).status, 405, 'POST refused');
      assert.equal(JSON.parse((await ask(port, 'GET')).body).v, JSON.parse(r.body).v, 'stable while the process runs');
    } finally { child.kill(); }
  }
  console.log('PASS: update notice — 10 s countdown banner, waits while busy, reloads signed in without a signature, no loop, hidden tab silent, Reload now, real /version.json (no-store, GET/HEAD, commit id or per-process id).');
})().catch(e => { console.error(e); process.exit(1); });
