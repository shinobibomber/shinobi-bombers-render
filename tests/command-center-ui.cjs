'use strict';
/* Shinobi Command Center console in a real browser against the real service + PGlite schema.
   Isolated fixtures only (mock Phantom, fixture RPC). Screenshots go to tests/out/command-center-*.png. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { PGlite } = require('@electric-sql/pglite'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), { Keypair } = require('../app/node_modules/@solana/web3.js');
const { Store, hash } = require('../app/server/store.cjs'), { createService, GENESIS } = require('../app/server/service.cjs');
(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'app/server/schema.sql'), 'utf8'));
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  let now = Date.now();
  const store = new Store(pool, 'cc-ui', () => now);
  const names = ['treasury', 'studio', 'revenue', 'mint', 'owner', 'operator', 'viewer', 'moderator', 'player', 'reporter'];
  const K = Object.fromEntries(names.map(n => [n, Keypair.generate()])), W = Object.fromEntries(names.map(n => [n, K[n].publicKey.toBase58()]));
  process.env.RYO_ADMIN_OWNERS = W.owner; process.env.RYO_ADMIN_OPERATORS = W.operator; process.env.RYO_ADMIN_VIEWERS = W.viewer; delete process.env.RYO_ADMIN_APPROVERS;
  const service = createService({ store, connection: { async getGenesisHash() { return GENESIS; } }, treasury: K.treasury, mint: W.mint, origin: 'http://127.0.0.1', studioAddress: W.studio, revenueAddress: W.revenue });
  const tokens = {};
  for (const n of names) { tokens[n] = 'cc-ui-' + n; await pool.query('INSERT INTO ryo_sessions(scope,token_hash,wallet,expires) VALUES($1,$2,$3,$4)', [store.scope, hash(tokens[n]), W[n], now + 86400000]); }
  const byWallet = Object.fromEntries(names.map(n => [W[n], tokens[n]]));
  const call = (n, action, body = {}) => service.handle(action, body, tokens[n]);
  let seq = 0; const w = (n, action, body) => call(n, action, { requestId: 'cc-ui-request-' + String(++seq).padStart(6, '0'), scope: store.scope, ...body });
  // Fixture data through the real actions.
  await w('owner', 'cc-role-grant', { wallet: W.moderator, role: 'moderator', reason: 'UI test moderator grant', expectedVersion: 0 });
  const say = async (n, text) => { now += 2500; return (await call(n, 'chat-send', { channel: 'global', text, name: n === 'player' ? 'Kuro' : 'Hikari' })).messages.at(-1); };
  const spam = await say('player', 'selling cheap ryo, DM me');
  const xss = await say('player', '<img src=x onerror="window.__xss=1"> hi');
  await say('reporter', 'please stop spamming');
  await call('reporter', 'chat-report', { messageId: spam.id, category: 'spam', details: 'Third time today' });
  await call('reporter', 'chat-report', { messageId: xss.id, category: 'offensive' });
  // Founder fixture (Phase 2): a clean Mythic buyer, and a confirmed Legacy purchase WITHOUT an entitlement (a defect the integrity tab must show).
  const FB = { good: Keypair.generate().publicKey.toBase58(), bad: Keypair.generate().publicKey.toBase58() }, FM = { good: Keypair.generate().publicKey.toBase58(), bad: Keypair.generate().publicKey.toBase58() };
  await pool.query("INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,signature,created,settled) VALUES($1,'founder-ui-request-0001',$2,'mythic',1,$3,700000000,'confirmed','m','w',1,'sig-good',$5,$5),($1,'founder-ui-request-0002',$4,'legacy',1,$6,250000000,'confirmed','m','w',1,'sig-bad',$5,$5)", [store.scope, FB.good, FM.good, FB.bad, now - 86400000, FM.bad]);
  await pool.query("INSERT INTO ryo_founder_entitlements(scope,wallet,tier,request_id,mint,granted,activated,limited_passes) VALUES($1,$2,'mythic','founder-ui-request-0001',$3,$4,$4,10)", [store.scope, FB.good, FM.good, now - 86400000]);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/ryo') {
      let input = ''; for await (const chunk of req) input += chunk; const body = JSON.parse(input); let result;
      try {
        if (body.action === 'challenge') result = { nonce: 'fixture', message: 'Wallet: ' + body.wallet + '\nOrigin: http://127.0.0.1:' + server.address().port };
        else if (body.action === 'login') result = { token: byWallet[body.wallet] };
        else { now = Date.now(); result = await service.handle(body.action, body, String(req.headers.authorization || '').replace(/^Bearer /, '')); }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
      } catch (e) { res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.status ? e.message : 'Service unavailable' })); }
      return;
    }
    const file = { '/admin/command-center/': 'index.html', '/admin/command-center/cc.js': 'cc.js', '/admin/command-center/cc.css': 'cc.css' }[url.pathname];
    if (!file) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'text/css', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    res.end(fs.readFileSync(path.join(root, 'command-center/public', file)));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/admin/command-center/', out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
  const shot = (p, name) => p.screenshot({ path: path.join(out, 'command-center-' + name + '.png'), fullPage: true });
  const noSideScroll = async (p, label) => assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, label + ' never scrolls sideways');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    const open = async (who, viewport = { width: 1440, height: 900 }) => {
      const p = await browser.newPage({ viewport }), errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
      await p.addInitScript(wallet => { window.phantom = { solana: { isPhantom: true, connect: async () => ({ publicKey: { toString: () => wallet } }), signMessage: async () => ({ signature: new Uint8Array(64) }), on() {} } }; }, W[who]);
      await p.goto(base); assert.equal(await p.locator('#view').isHidden(), true, 'nothing is shown before sign-in');
      await p.locator('#connect').click(); await p.waitForSelector('#view:not([hidden])');
      return { p, errors };
    };
    const waitText = (p, sel, re) => p.waitForFunction(([s, src]) => new RegExp(src).test(document.querySelector(s)?.textContent || ''), [sel, re.source]);

    // ---- Owner, desktop ----
    const { p, errors } = await open('owner');
    await p.waitForSelector('.kpi');
    assert.match(await p.locator('#network').textContent(), /^DEVNET TEST · cc-ui$/, 'the network banner names the network and scope');
    assert.equal(await p.locator('#who-role').textContent(), 'Owner');
    assert.match(await p.locator('#view').innerText(), /New sign-ups[\s\S]*Unavailable/i, 'unrecorded metrics are shown as unavailable, not invented');
    assert.match(await p.locator('#view').innerText(), /Open chat reports\s*2/i);
    await shot(p, 'overview-desktop');

    await p.goto(base + '#chat'); await p.waitForSelector('.report');
    assert.equal(await p.evaluate(() => window.__xss), undefined, 'chat text is never executed'); assert.equal(await p.locator('#view img').count(), 0, 'or rendered as markup');
    assert.match(await p.locator('#view').innerText(), /selling cheap ryo, DM me/);
    await shot(p, 'chat-desktop');
    // Mute from the report card: reason + duration + explicit confirmation, enforced by the server.
    const spamCard = p.locator('.card', { hasText: 'selling cheap ryo' });
    await spamCard.getByRole('button', { name: 'Mute' }).click(); await p.waitForSelector('#dialog[open]');
    assert.match(await p.locator('#dialog-body').innerText(), /Current standing: can chat/);
    await p.locator('#dialog select[name="duration"]').selectOption('60');
    await p.locator('#dialog-ok').click();   // no reason yet: refused by form validation
    assert.equal(await p.locator('#dialog').getAttribute('open'), '', 'a reason is required');
    await p.locator('#dialog textarea[name="reason"]').fill('Repeated off-platform selling');
    await shot(p, 'moderation-dialog');
    await p.locator('#dialog-ok').click(); await waitText(p, '#notice', /Mute player: done/);
    await assert.rejects(call('player', 'chat-send', { channel: 'global', text: 'still here?' }), /muted/, 'the server enforces the mute');

    // Planned modules are shown as not implemented, with nothing to click.
    await p.goto(base + '#planned-nft'); await waitText(p, '#view', /Not implemented/);
    assert.equal(await p.locator('#view button').count(), 0, 'no simulated controls for missing backends');
    await p.goto(base + '#chat'); await p.waitForSelector('.tabs'); await p.getByRole('tab', { name: 'Other channels' }).click(); await waitText(p, '#view', /no backend/);

    await p.goto(base + '#players'); await p.locator('input[type="search"]').fill(W.player); await p.getByRole('button', { name: 'Look up' }).click();
    await waitText(p, '#view', /Chat standing[\s\S]*Muted/); assert.match(await p.locator('#view').innerText(), /Economy \(read-only\)/);
    await shot(p, 'player-desktop');

    await p.goto(base + '#announcements'); await p.waitForSelector('textarea[name="en"]');
    await p.locator('textarea[name="en"]').fill('Server maintenance at 03:00 UTC.');
    await p.getByRole('button', { name: 'Review and submit' }).click(); await p.waitForSelector('#dialog[open]');
    await p.locator('#dialog textarea[name="reason"]').fill('Scheduled hosting maintenance window'); await p.locator('#dialog-ok').click();
    await waitText(p, '#notice', /submitted for review/);
    assert.equal(await p.getByRole('button', { name: 'Approve' }).isDisabled(), true, 'the proposer cannot approve their own announcement');

    await p.goto(base + '#audit'); await p.waitForSelector('#view tbody tr').catch(async e => { console.error('DEBUG notice:', await p.locator('#notice').textContent(), '| view:', (await p.locator('#view').innerText()).slice(0, 300), errors); throw e; });
    assert.match(await p.locator('#view').innerText(), /cc\.chat\.mute[\s\S]*hash ✓/); assert.equal(await p.locator('#view .badge.crit').count(), 0, 'every record verifies');
    await shot(p, 'audit-desktop');
    await p.goto(base + '#health'); await waitText(p, '#view', /Solana RPC/); await shot(p, 'health-desktop');

    // ---- Founder NFTs (Phase 2): tabs, all read-only except the existing Pause / Suspend ----
    await p.goto(base + '#founders'); await p.waitForSelector('.tabs');
    assert.deepEqual(await p.locator('.tabs button').allTextContents(), ['Overview', 'Collections', 'Entitlement lookup', 'Integrity checks', 'Early access & Council', 'Premium weeks']);
    await waitText(p, '#view', /Purchases/); await shot(p, 'founders-overview');
    await p.getByRole('tab', { name: 'Collections' }).click(); await waitText(p, '#view', /2 sold|1 sold/);
    assert.match(await p.locator('#view').innerText(), /Mythic[\s\S]*1 sold[\s\S]*Legacy[\s\S]*1 sold/i); assert.match(await p.locator('#view').innerText(), /Not checked yet/);
    await p.getByRole('button', { name: 'Check on chain' }).click(); await waitText(p, '#view', /No Solana connection is available/);   // the UI fixture has no Solana RPC: shown, never faked
    await shot(p, 'founders-collections');
    await p.getByRole('tab', { name: 'Entitlement lookup' }).click(); await p.locator('input[type="search"]').fill('mythic #1'); await p.getByRole('button', { name: 'Look up' }).click();
    await waitText(p, '#view', /Purchase evidence[\s\S]*Entitlement[\s\S]*valid/); assert.match(await p.locator('#view').innerText(), new RegExp(FB.good.slice(0, 8)));
    await shot(p, 'founders-lookup');
    await p.locator('input[type="search"]').fill(FB.bad); await p.getByRole('button', { name: 'Look up' }).click(); await waitText(p, '#view', /CONFIRMED_WITHOUT_ENTITLEMENT/);
    await p.locator('input[type="search"]').fill(Keypair.generate().publicKey.toBase58()); await p.getByRole('button', { name: 'Look up' }).click(); await waitText(p, '#view', /No Founder purchase found/);
    await p.getByRole('tab', { name: 'Integrity checks' }).click(); await waitText(p, '#view', /CONFIRMED_WITHOUT_ENTITLEMENT/);
    assert.match(await p.locator('#view').innerText(), /Critical\s*1/i); assert.match(await p.locator('#view').innerText(), /nothing is repaired here|Nothing is repaired here/i); assert.equal(await p.locator('#view button').count(), 7, 'no action buttons besides the six tabs and Refresh');
    await shot(p, 'founders-integrity');
    await p.getByRole('tab', { name: 'Early access & Council' }).click(); await waitText(p, '#view', /Council: full/); assert.match(await p.locator('#view').innerText(), /never opens the game/);
    await p.getByRole('tab', { name: 'Premium weeks' }).click(); await waitText(p, '#view', /Weekly Mission Pass[\s\S]*Not implemented/);
    await shot(p, 'founders-weeks');

    await p.locator('#lang').selectOption('pt'); await waitText(p, '#sidebar', /Visão geral/); assert.equal(await p.evaluate(() => document.documentElement.lang), 'pt-BR');
    await p.locator('#lang').selectOption('en');

    // ---- Tablet and phone ----
    await p.goto(base + '#overview'); await p.waitForSelector('.kpi');
    await p.setViewportSize({ width: 900, height: 1100 }); await p.waitForTimeout(200); await noSideScroll(p, 'tablet'); await shot(p, 'overview-tablet');
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200); await noSideScroll(p, 'phone');
    assert.equal(await p.locator('#menu').isVisible(), true, 'phones get a menu button');
    await shot(p, 'overview-mobile');
    await p.locator('#menu').click(); await p.waitForTimeout(300); assert.equal(await p.locator('#menu').getAttribute('aria-expanded'), 'true');
    await shot(p, 'nav-mobile');
    await p.locator('#sidebar a[href="#chat"]').click(); await p.waitForSelector('.tabs'); await p.waitForTimeout(300); await noSideScroll(p, 'phone chat'); await shot(p, 'chat-mobile');
    const tap = await p.locator('.tabs button').first().boundingBox(); assert(tap.height >= 44, 'touch targets are at least 44px on phones');
    await p.goto(base + '#founders'); await p.waitForSelector('.tabs'); await p.getByRole('tab', { name: 'Integrity checks' }).click(); await waitText(p, '#view', /CONFIRMED_WITHOUT_ENTITLEMENT/); await p.waitForTimeout(200); await noSideScroll(p, 'phone Founder integrity'); await shot(p, 'founders-mobile');
    assert.deepEqual(errors, [], 'no page errors');

    // ---- Viewer: read-only, no chat evidence ----
    const v = await open('viewer');
    await v.p.waitForSelector('.kpi'); assert.equal(await v.p.locator('#who-readonly').isVisible(), true, 'read-only roles are labelled');
    await v.p.goto(base + '#chat'); await waitText(v.p, '#view', /Permission required/);
    assert.equal(await v.p.locator('#view button').count(), 0);
    assert.equal(await v.p.locator('#sidebar a[href="#roles"]').count(), 0, 'staff roles are only listed for the Owner');
    await v.p.goto(base + '#founders'); await waitText(v.p, '#view', /Permission required/); assert.equal(await v.p.locator('#view .tabs').count(), 0, 'viewers get no Founder data (full wallets)');
    await v.p.goto(base + '#audit'); await v.p.waitForSelector('#view tbody tr');
    assert.deepEqual(v.errors, []);
    // ---- Moderator: moderation yes, economy no ----
    const m = await open('moderator');
    await m.p.goto(base + '#players'); await m.p.locator('input[type="search"]').fill(W.player); await m.p.getByRole('button', { name: 'Look up' }).click();
    await waitText(m.p, '#view', /Chat standing/); assert.doesNotMatch(await m.p.locator('#view').innerText(), /Economy|Recent transactions/, 'moderators never see balances or transactions');
    assert.deepEqual(m.errors, []);
    await v.p.locator('#signout').click(); assert.equal(await v.p.locator('#view').isHidden(), true, 'sign-out clears the console');
  } finally { await browser?.close(); await new Promise(r => server.close(r)); await db.close(); }
  console.log('PASS: Command Center UI sign-in, network banner, truthful KPIs, report queue, guarded mute enforced by the server, not-implemented modules, player lookup redaction, two-person announcements, audit verification, EN/PT-BR, tablet/phone layouts, viewer/moderator scopes and no script injection.');
})().catch(e => { console.error(e); process.exitCode = 1; });
