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
  const names = ['treasury', 'studio', 'revenue', 'mint', 'owner', 'operator', 'viewer', 'moderator', 'player', 'reporter', 'approver', 'support'];
  const K = Object.fromEntries(names.map(n => [n, Keypair.generate()])), W = Object.fromEntries(names.map(n => [n, K[n].publicKey.toBase58()]));
  process.env.RYO_ADMIN_OWNERS = W.owner; process.env.RYO_ADMIN_OPERATORS = W.operator; process.env.RYO_ADMIN_VIEWERS = W.viewer; process.env.RYO_ADMIN_APPROVERS = W.approver;
  const service = createService({ store, connection: { async getGenesisHash() { return GENESIS; } }, treasury: K.treasury, mint: W.mint, origin: 'http://127.0.0.1', studioAddress: W.studio, revenueAddress: W.revenue });
  const tokens = {};
  for (const n of names) { tokens[n] = 'cc-ui-' + n; await pool.query('INSERT INTO ryo_sessions(scope,token_hash,wallet,expires) VALUES($1,$2,$3,$4)', [store.scope, hash(tokens[n]), W[n], now + 86400000]); }
  const byWallet = Object.fromEntries(names.map(n => [W[n], tokens[n]]));
  const call = (n, action, body = {}) => service.handle(action, body, tokens[n]);
  let seq = 0; const w = (n, action, body) => call(n, action, { requestId: 'cc-ui-request-' + String(++seq).padStart(6, '0'), scope: store.scope, ...body });
  // Fixture data through the real actions.
  await w('owner', 'cc-role-grant', { wallet: W.moderator, role: 'moderator', reason: 'UI test moderator grant', expectedVersion: 0 });
  await w('owner', 'cc-role-grant', { wallet: W.support, role: 'support', reason: 'UI test support grant', expectedVersion: 1 });
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

  // Stats report fixture: one deposit and two confirmed summons (6 heroes) in the last hours.
  await pool.query("INSERT INTO ryo_deposits(scope,signature,wallet,amount,request_id,created,gross,studio_fee) VALUES($1,'SigUiDep',$2,400000,'ui-dep',$3,400000,0)", [store.scope, W.player, now - 3 * 3600000]);
  for (const [id, ago, ranks] of [['ui-buy-1', 2, [0, 0, 1, 2, 4]], ['ui-buy-2', 1, [3]]]) await pool.query(`INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created)
    VALUES($1,$2,$3,'summon',$4,'{"treasury":1,"burn":0}',$5,'{}',$6,$7,'w',1,'confirmed',$8)`, [store.scope, W.player, id, JSON.stringify({ quantity: ranks.length }), JSON.stringify({ outputs: ranks.map(rank => ({ rank })) }), 25000 * ranks.length, 'Sig' + id, now - ago * 3600000]);

  // Support fixture through the real player action: one ticket with HTML-looking text and an order reference, one plain ticket.
  const ticket = (n, body) => call(n, 'support-submit', { requestId: 'cc-ui-ticket-' + n + '-0001', category: 'payment', ...body });
  await ticket('player', { subject: '<b>Where is my SR?</b>', message: '<img src=x onerror="window.__xss=1"> please help', reference: 'ui-buy-1' });
  await ticket('reporter', { category: 'hero', subject: 'Hero stuck in prison', message: 'My hero has been in prison for two days.' });

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
    const file = { '/admin/command-center/': 'index.html', '/admin/command-center/cc.js': 'cc.js', '/admin/command-center/cc-report.js': 'cc-report.js', '/admin/command-center/cc.css': 'cc.css' }[url.pathname];
    if (!file) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'text/css', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
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

    // ---- Batch A: Game configuration status, Security center + incident register, Creators summary ----
    await p.goto(base + '#config'); await waitText(p, '#view', /Feature switches[\s\S]*Recent switch changes/);
    assert.ok(await p.locator('#view tbody tr').count() >= 20, 'every feature switch is listed'); assert.match(await p.locator('#view').innerText(), /Withdrawals[\s\S]*money|money[\s\S]*Withdrawals/i);
    assert.match(await p.locator('#view').innerText(), /Stage:/); assert.equal(await p.locator('#view button:not(:text-is("Refresh"))').count(), 0, 'read-only: no button besides Refresh');
    assert.equal(await p.locator('#view a[href="/admin/control"]').count(), 1, 'changes are made in the Control panel'); await shot(p, 'config-status');
    await p.goto(base + '#security'); await waitText(p, '#view', /Incident register/); assert.match(await p.locator('#view').innerText(), /Audit chain\s*Verified/i);
    assert.match(await p.locator('#view').innerText(), /Failed sign-ins are not stored/, 'unrecorded signals are labelled not implemented');
    await p.getByRole('button', { name: 'Open incident' }).first().click(); await p.waitForSelector('#dialog[open]');
    await p.locator('#dialog-body [name="title"]').fill('Suspicious referral burst'); await p.locator('#dialog-body [name="severity"]').selectOption('high');
    await p.locator('#dialog-body [name="details"]').fill('Twelve referrals from one creator in a minute.'); await p.locator('#dialog-body [name="reason"]').fill('Noticed on the Creators summary');
    await p.locator('#dialog-ok').click(); await waitText(p, '#view', /Suspicious referral burst/); assert.match(await p.locator('#view').innerText(), /high[\s\S]*Suspicious referral burst[\s\S]*open/i);
    await shot(p, 'security-center');
    await p.locator('tr', { hasText: 'Suspicious referral burst' }).getByRole('button', { name: 'Resolve' }).click(); await p.waitForSelector('#dialog[open]'); await p.locator('#dialog-body [name="reason"]').fill('Verified as a legitimate promotion');
    await p.locator('#dialog-ok').click(); await waitText(p, '#view', /Resolution: Verified as a legitimate promotion/);
    assert.equal(await p.getByRole('button', { name: 'Resolve' }).count(), 0, 'a resolved incident has no more actions');
    await p.goto(base + '#creators'); await waitText(p, '#view', /Creator applications[\s\S]*Not implemented/); assert.match(await p.locator('#view').innerText(), /Marketing campaigns|Paid marketing campaigns/);
    assert.equal(await p.locator('#view button:not(:text-is("Refresh"))').count(), 0, 'the Creators summary has no action buttons'); await shot(p, 'creators-summary');
    assert.equal(await p.locator('#sidebar a[href="#planned-security"], #sidebar a[href="#planned-config"]').count(), 0, 'built modules left the planned list');

    // ---- Support tickets (staff tab): queue, thread, reply, internal note, assign, status; ticket text is never markup ----
    assert.equal(await p.locator('#sidebar a[href="#support"]').count(), 1, 'the Support tab is in the menu'); assert.equal(await p.locator('#sidebar a[href="#planned-support"]').count(), 0, 'Support left the planned list');
    await p.goto(base + '#support'); await waitText(p, '#view', /Where is my SR/);
    assert.equal(await p.evaluate(() => window.__xss), undefined, 'ticket text is never executed'); assert.equal(await p.locator('#view img').count(), 0, 'or rendered as markup');
    assert.match(await p.locator('#view').innerText(), /<b>Where is my SR\?<\/b>[\s\S]*needs a reply/); assert.match(await p.locator('#view').innerText(), /Hero stuck in prison/);
    assert.match(await p.locator('#view').innerText(), /replaced with "\[expired\]" 30 days after/, 'the retention rule is stated');
    await shot(p, 'support-queue');
    await p.locator('#view select[aria-label="Category filter"]').selectOption('hero'); await p.getByRole('button', { name: 'Filter' }).click();
    await p.waitForFunction(() => !/Where is my SR/.test(document.querySelector('#view').textContent)); assert.match(await p.locator('#view').innerText(), /Hero stuck in prison/, 'the category filter narrows the queue');
    await p.locator('#view select[aria-label="Category filter"]').selectOption(''); await p.getByRole('button', { name: 'Filter' }).click(); await waitText(p, '#view', /Where is my SR/);
    await p.getByRole('button', { name: 'Open ticket #1' }).click(); await waitText(p, '#view', /Conversation/);
    const t1 = await p.locator('#view').innerText();
    assert.match(t1, /Order reference: purchase · ui-buy-1 · summon · 125,000 Ryo · confirmed/); assert.match(t1, /please help/); assert.match(t1, /Player · [^\n]*UTC\s+<img src=x/);
    assert.equal(await p.locator('#view img').count(), 0, 'the thread shows the text, not an image');
    await shot(p, 'support-ticket');
    await p.getByLabel('Reply to the player').fill('We are checking your purchase now.'); await p.getByRole('button', { name: 'Send reply' }).click(); await waitText(p, '#notice', /Reply sent\./);
    await waitText(p, '#view', /Awaiting the player/); assert.match(await p.locator('#view').innerText(), /Staff · you[\s\S]*We are checking your purchase now\./);
    await p.getByLabel('Internal note').fill('INTERNAL: purchase looks fine, check the signature.'); await p.getByRole('button', { name: 'Add internal note' }).click(); await waitText(p, '#notice', /Note added\./);
    await waitText(p, '#view', /Internal note \(the player never sees this\)/);
    const seen = await call('player', 'support-view', { id: 1 });
    assert.deepEqual(seen.messages.map(x => x.from), ['you', 'team'], 'the player sees the reply'); assert.ok(!JSON.stringify(seen).includes('INTERNAL'), 'and never the internal note'); assert.ok(!JSON.stringify(seen).includes(W.owner), 'nor the staff wallet');
    await p.getByRole('button', { name: 'Assign to me' }).click(); await p.waitForSelector('#dialog[open]');
    await p.locator('#dialog-ok').click(); assert.equal(await p.locator('#dialog').getAttribute('open'), '', 'a reason is required for an assignment');
    await p.locator('#dialog-body [name="reason"]').fill('Taking this purchase ticket'); await p.locator('#dialog-ok').click(); await waitText(p, '#notice', /Ticket assigned to you\./);
    await waitText(p, '#view', /Assigned to you/); assert.equal(await p.getByRole('button', { name: 'Assign to me' }).count(), 0, 'already assigned to me');
    await p.getByRole('button', { name: 'Change status' }).click(); await p.waitForSelector('#dialog[open]'); assert.match(await p.locator('#dialog-body').innerText(), /Closed is final/);
    await p.locator('#dialog-body [name="status"]').selectOption('resolved'); await p.locator('#dialog-body [name="reason"]').fill('Purchase confirmed on chain'); await p.locator('#dialog-ok').click();
    await waitText(p, '#notice', /Status updated\./); await waitText(p, '#view', /settled[\s\S]*text expires 30 days later/);
    await p.getByRole('button', { name: 'Change status' }).click(); await p.waitForSelector('#dialog[open]');
    await p.locator('#dialog-body [name="status"]').selectOption('closed'); await p.locator('#dialog-body [name="reason"]').fill('Closing after the player confirmed'); await p.locator('#dialog-ok').click();
    await waitText(p, '#view', /This ticket is closed\. A closed ticket is final\./); assert.equal(await p.getByRole('button', { name: 'Send reply' }).count(), 0, 'no controls on a closed ticket');
    await assert.rejects(call('player', 'support-reply', { requestId: 'cc-ui-late-reply-0001', id: 1, message: 'one more thing' }), /closed/, 'the server refuses the player too');
    await shot(p, 'support-closed');
    await p.getByRole('button', { name: '← Back to the queue' }).click(); await waitText(p, '#view', /Hero stuck in prison/);
    assert.doesNotMatch(await p.locator('#view').innerText(), /Where is my SR/, 'a closed ticket leaves the open queue');
    await p.locator('#view select[aria-label="Status filter"]').selectOption('closed'); await p.getByRole('button', { name: 'Filter' }).click(); await waitText(p, '#view', /Where is my SR/);
    await p.locator('#view select[aria-label="Status filter"]').selectOption('open'); await p.getByRole('button', { name: 'Filter' }).click(); await waitText(p, '#view', /Hero stuck in prison/);
    const audit = (await call('owner', 'cc-audit', { prefix: 'cc.support', limit: 20 })).data.entries.map(e => e.action).sort();
    assert.deepEqual(audit, ['cc.support.note', 'cc.support.reply', 'cc.support.update', 'cc.support.update', 'cc.support.update'], 'every staff write is on the audit chain');

    await p.locator('#lang').selectOption('pt'); await waitText(p, '#sidebar', /Visão geral/); assert.equal(await p.evaluate(() => document.documentElement.lang), 'pt-BR');
    assert.match(await p.locator('#sidebar').innerText(), /Tickets de suporte/, 'the Support tab is translated');
    await p.locator('#lang').selectOption('en');

    // ---- Events (staff tab): propose, a DIFFERENT wallet approves, EN/PT-BR, schedule, no rewards. Event text is never markup. ----
    assert.equal(await p.locator('#sidebar a[href="#events"]').count(), 1, 'the Events tab is in the menu'); assert.equal(await p.locator('#sidebar a[href="#planned-events"]').count(), 0, 'Events left the planned list');
    const HOUR_MS = 3600000, DAY_MS = 24 * HOUR_MS, stamp = ms => new Date(ms).toISOString().slice(0, 16), t0 = Date.now();
    // Markup-looking text can no longer be PROPOSED (< and > are refused), so this proposal is inserted directly: the console must still show any stored text as text.
    const evC = { kind: 'maintenance', titleEn: 'Server maintenance', bodyEn: '<img src=x onerror="window.__xss=1"> The game will be offline briefly.', titlePt: 'Manutenção do servidor', bodyPt: 'O jogo ficará offline por pouco tempo.', startsAt: t0 + 2 * DAY_MS, endsAt: t0 + 2 * DAY_MS + HOUR_MS };
    await pool.query("INSERT INTO ryo_cc_events(scope,kind,title_en,body_en,title_pt,body_pt,starts_at,ends_at,content_sha256,proposer,reason,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Planned maintenance window',$11)", [store.scope, evC.kind, evC.titleEn, evC.bodyEn, evC.titlePt, evC.bodyPt, evC.startsAt, evC.endsAt, require('../app/server/events.cjs').contentHash(evC), W.moderator, t0]);
    await assert.rejects(w('moderator', 'cc-event-propose', { ...evC, noRewards: true, reason: 'Markup is refused on the way in' }), /plain text only/, 'the server refuses markup on the way in');
    await p.goto(base + '#events'); await waitText(p, '#view', /Server maintenance/);
    assert.equal(await p.evaluate(() => window.__xss), undefined, 'event text is never executed'); assert.equal(await p.locator('#view img').count(), 0, 'or rendered as markup');
    assert.match(await p.locator('#view').innerText(), /<img src=x onerror="window.__xss=1"> The game will be offline briefly\./); assert.match(await p.locator('#view').innerText(), /Awaiting review/);
    assert.match(await p.locator('#view').innerText(), /Times are entered and stored in UTC[\s\S]*no mention of rewards, prizes or Ryo/, 'the UTC and no-rewards rules are stated');
    await shot(p, 'events-queue');
    // The Owner approves the Moderator's proposal through the guarded dialog: the no-reward confirmation and a reason are both required.
    const maint = p.locator('tr', { hasText: 'Server maintenance' });
    await maint.getByRole('button', { name: 'Approve' }).click(); await p.waitForSelector('#dialog[open]'); assert.match(await p.locator('#dialog-body').innerText(), /promise no reward/i);
    await p.locator('#dialog-body [name="reason"]').fill('Checked the text, no rewards promised'); await p.locator('#dialog-ok').click();
    assert.equal(await p.locator('#dialog').getAttribute('open'), '', 'the no-reward confirmation is required');
    await p.locator('#dialog-body [name="noRewards"]').selectOption('yes'); await p.locator('#dialog-ok').click(); await waitText(p, '#notice', /Event approved/);
    await waitText(p, '#view', /Approved · upcoming/);
    const evSeen = (await call('player', 'cc-events-upcoming', { lang: 'pt' })).events; assert.equal(evSeen.length, 1); assert.equal(evSeen[0].title, 'Manutenção do servidor', 'players read it in Portuguese when they ask for it');
    assert.equal(JSON.stringify(evSeen).includes(W.moderator), false, 'a player never sees a staff wallet');
    // The Owner proposes one: text that mentions a reward is refused in the dialog; the clean text goes through; the proposer cannot approve it.
    const fillForm = async body => { await p.locator('input[name="titleEn"]').fill('Dojo Night'); await p.locator('textarea[name="bodyEn"]').fill(body); await p.locator('input[name="titlePt"]').fill('Noite no Dojo'); await p.locator('textarea[name="bodyPt"]').fill('Encontro da comunidade no Dojo.');
      await p.locator('input[name="starts"]').fill(stamp(t0 + 3 * DAY_MS)); await p.locator('input[name="ends"]').fill(stamp(t0 + 3 * DAY_MS + 2 * HOUR_MS)); await p.getByRole('button', { name: 'Review and submit' }).click(); await p.waitForSelector('#dialog[open]'); };
    await fillForm('Join us and win a big prize at the Dojo.');
    await p.locator('#dialog-body [name="noRewards"]').selectOption('yes'); await p.locator('#dialog-body [name="reason"]').fill('Community evening in the Dojo'); await p.locator('#dialog-ok').click();
    await waitText(p, '#dialog-error', /cannot mention rewards/); assert.equal(await p.locator('#dialog').getAttribute('open'), '', 'a reward promise is refused and the dialog stays open'); await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('#dialog').open);
    await p.locator('textarea[name="bodyEn"]').fill('Join us at the Dojo for a relaxed community evening.'); await p.getByRole('button', { name: 'Review and submit' }).click(); await p.waitForSelector('#dialog[open]');
    await p.locator('#dialog-body [name="noRewards"]').selectOption('yes'); await p.locator('#dialog-body [name="reason"]').fill('Community evening in the Dojo'); await p.locator('#dialog-ok').click();
    await waitText(p, '#notice', /Event submitted for review/); await waitText(p, '#view', /Dojo Night/);
    const mine = p.locator('tr', { hasText: 'Dojo Night' }); assert.equal(await mine.getByRole('button', { name: 'Approve' }).isDisabled(), true, 'the proposer cannot approve their own event');
    assert.equal(await mine.getByRole('button', { name: 'Reject' }).isDisabled(), true);
    const own = (await call('owner', 'cc-events')).data.events.find(e => e.titleEn === 'Dojo Night');
    await assert.rejects(w('owner', 'cc-event-review', { id: own.id, approve: true, expectedVersion: own.version, contentSha256: own.contentSha256, noRewards: true, reason: 'Trying my own proposal' }), e => e.status === 403, 'and the server refuses it too');
    // One-wallet approval ON (how live runs): the proposer's own buttons are enabled; OFF again restores the two-wallet rule.
    const ownDisabled = want => p.waitForFunction(w => { const b = [...document.querySelectorAll('#view tr')].find(r => /Dojo Night/.test(r.textContent))?.querySelector('button.primary'); return !!b && b.disabled === w; }, want);
    process.env.ADMIN_SELF_APPROVAL = 'on'; await p.getByRole('button', { name: 'Refresh' }).click(); await ownDisabled(false);
    delete process.env.ADMIN_SELF_APPROVAL; await p.getByRole('button', { name: 'Refresh' }).click(); await ownDisabled(true);
    await shot(p, "events-proposed");
    // A second wallet rejects it, and unpublish withdraws the approved event.
    await w('operator', 'cc-event-review', { id: own.id, approve: false, expectedVersion: own.version, contentSha256: own.contentSha256, reason: 'Rejected in the UI test' });
    await p.getByRole('button', { name: 'Refresh' }).click(); await waitText(p, '#view', /Rejected/);
    await p.locator('tr', { hasText: 'Server maintenance' }).getByRole('button', { name: 'Unpublish' }).click(); await p.waitForSelector('#dialog[open]'); await p.locator('#dialog-body [name="reason"]').fill('Maintenance was moved'); await p.locator('#dialog-ok').click();
    await waitText(p, '#notice', /Event unpublished/); assert.deepEqual((await call('player', 'cc-events-upcoming')).events, [], 'players stop seeing an unpublished event');
    const evAudit = (await call('owner', 'cc-audit', { prefix: 'cc.event', limit: 20 })).data.entries.map(e => e.action).sort();
    assert.deepEqual(evAudit, ['cc.event.approved', 'cc.event.proposed', 'cc.event.rejected', 'cc.event.unpublished'], 'every event write is on the audit chain');
    // EN / PT-BR console.
    await p.locator('#lang').selectOption('pt'); await waitText(p, '#sidebar', /Eventos/); await waitText(p, '#view', /Propor um evento/);
    assert.match(await p.locator('#view').innerText(), /Despublicado[\s\S]*Rejeitado|Rejeitado[\s\S]*Despublicado/, 'statuses are translated'); assert.match(await p.locator('#view').innerText(), /agenda .utc./i);
    await shot(p, 'events-pt'); await p.locator('#lang').selectOption('en'); await waitText(p, '#view', /Propose an event/);
    // Phone.
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(250); await noSideScroll(p, 'phone Events'); await shot(p, 'events-mobile'); await p.setViewportSize({ width: 1440, height: 900 });
    // Other roles: the Approver has no event access, the Viewer reads only, the Moderator proposes but never reviews.
    const ap = await open('approver'); await ap.p.goto(base + '#events'); await waitText(ap.p, '#view', /Permission required/); assert.equal(await ap.p.locator('#sidebar a[href="#events"]').count(), 1); assert.equal(await ap.p.locator('#view button').count(), 0, 'approvers get no events'); await ap.p.close();
    const vw = await open('viewer'); await vw.p.goto(base + '#events'); await waitText(vw.p, '#view', /Server maintenance/); assert.equal(await vw.p.locator('#view form').count(), 0, 'viewers get no proposal form'); assert.equal(await vw.p.locator('#view button:not(:text-is("Refresh"))').count(), 0, 'and no buttons'); await vw.p.close();
    const md = await open('moderator'); await md.p.goto(base + '#events'); await waitText(md.p, '#view', /Propose an event/); assert.equal(await md.p.getByRole('button', { name: 'Approve' }).count(), 0, 'moderators cannot review'); assert.equal(await md.p.getByRole('button', { name: 'Unpublish' }).count(), 0); assert.deepEqual(md.errors, []); await md.p.close();

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
    await p.goto(base + '#support'); await waitText(p, '#view', /Hero stuck in prison/); await p.waitForTimeout(200); await noSideScroll(p, 'phone Support queue'); await shot(p, 'support-mobile');
    await p.getByRole('button', { name: 'Open ticket #2' }).click(); await waitText(p, '#view', /Conversation/); await p.waitForTimeout(200); await noSideScroll(p, 'phone Support ticket');
    await p.getByRole('button', { name: '← Back to the queue' }).click(); await waitText(p, '#view', /Hero stuck in prison/);
    assert.deepEqual(errors, [], 'no page errors');

    // ---- Viewer: read-only, no chat evidence ----
    const v = await open('viewer');
    await v.p.waitForSelector('.kpi'); assert.equal(await v.p.locator('#who-readonly').isVisible(), true, 'read-only roles are labelled');
    await v.p.goto(base + '#chat'); await waitText(v.p, '#view', /Permission required/);
    assert.equal(await v.p.locator('#view button').count(), 0);
    assert.equal(await v.p.locator('#sidebar a[href="#roles"]').count(), 0, 'staff roles are only listed for the Owner');
    await v.p.goto(base + '#founders'); await waitText(v.p, '#view', /Permission required/); assert.equal(await v.p.locator('#view .tabs').count(), 0, 'viewers get no Founder data (full wallets)');
    await v.p.goto(base + '#audit'); await v.p.waitForSelector('#view tbody tr');
    // Batch A: viewers read the configuration status but get nothing from Security or Creators.
    await v.p.goto(base + '#config'); await waitText(v.p, '#view', /Feature switches/);
    await v.p.goto(base + '#security'); await waitText(v.p, '#view', /Permission required/); assert.equal(await v.p.locator('#view button').count(), 0);
    await v.p.goto(base + '#creators'); await waitText(v.p, '#view', /Permission required/);
    await v.p.goto(base + '#support'); await waitText(v.p, '#view', /Permission required/); assert.equal(await v.p.locator('#view button').count(), 0, 'viewers get no tickets');
    // Stats report: viewers may generate it (totals only, no wallets).
    await v.p.goto(base + '#report'); await waitText(v.p, '#view', /Choose a range and generate the report/);
    assert.equal(await v.p.locator('#sr-download').isDisabled(), true, 'nothing to download before a report exists');
    await v.p.locator('#sr-range').selectOption('7d'); await v.p.locator('#sr-bucket').selectOption('hour'); await v.p.locator('#sr-generate').click();
    await v.p.waitForSelector('#sr-out .sr-tiles .kpi');
    const reportText = await v.p.locator('#sr-out').innerText();
    assert.match(reportText, /Heroes summoned\s*6\b/i, 'tile shows the summoned heroes'); assert.match(reportText, /Ryo spent\s*150,000/i, 'tile shows the Ryo spent');
    assert.match(reportText, /SR deposited\s*400,000/i); assert.match(reportText, /Genin\s*33\.3%\s*2/, 'rarity rows (2 of 6 heroes)');
    for (const w of [W.player, W.owner, W.viewer]) assert.ok(!reportText.includes(w) && !reportText.includes(w.slice(0, 8)), 'no wallet in the report');
    assert.equal(await v.p.locator('#sr-out svg.sr-svg').count(), 3, 'three time charts');
    assert.ok(await v.p.locator('#sr-bars svg rect[fill]:not([fill="transparent"])').count() >= 2, 'stacked bars are drawn');
    const box = await v.p.locator('#sr-money svg').boundingBox(); await v.p.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await waitText(v.p, '.sr-tip.on', /SR deposited/);
    assert.equal(await v.p.locator('#sr-download').isDisabled(), false); assert.equal(await v.p.locator('#sr-copy').isDisabled(), false);
    await v.p.locator('#sr-generate').click(); await waitText(v.p, '#view [role="status"]', /reused from the last minute/);
    await shot(v.p, 'stats-report-desktop');
    await v.p.locator('#sr-range').selectOption('custom'); await v.p.locator('#sr-from').fill('2025-01-01T00:00'); await v.p.locator('#sr-generate').click();
    await waitText(v.p, '#view', /1 Jan 2026/); assert.match(await v.p.locator('#notice').innerText(), /grouped by day|1 Jan 2026/, 'server checks are shown plainly');
    await v.p.locator('#sr-range').selectOption('7d'); await v.p.locator('#sr-generate').click(); await v.p.waitForSelector('#sr-out .sr-tiles .kpi');
    await v.p.setViewportSize({ width: 390, height: 844 }); await v.p.waitForTimeout(300); await noSideScroll(v.p, 'phone Stats report'); await shot(v.p, 'stats-report-mobile');
    assert.deepEqual(v.errors, []);
    // ---- Moderator: moderation yes, economy no ----
    const m = await open('moderator');
    await m.p.goto(base + '#players'); await m.p.locator('input[type="search"]').fill(W.player); await m.p.getByRole('button', { name: 'Look up' }).click();
    await waitText(m.p, '#view', /Chat standing/); assert.doesNotMatch(await m.p.locator('#view').innerText(), /Economy|Recent transactions/, 'moderators never see balances or transactions');
    await m.p.goto(base + '#report'); await waitText(m.p, '#view', /Permission required/);
    await m.p.goto(base + '#support'); await waitText(m.p, '#view', /Permission required/); assert.equal(await m.p.locator('#view button').count(), 0, 'moderators get no tickets');
    assert.deepEqual(m.errors, []);
    // ---- Approver reads tickets but cannot answer; Support can answer ----
    const a = await open('approver'); assert.equal(await a.p.locator('#who-role').textContent(), 'Financial Approver');
    await a.p.goto(base + '#support'); await waitText(a.p, '#view', /Hero stuck in prison/); await a.p.getByRole('button', { name: 'Open ticket #2' }).click(); await waitText(a.p, '#view', /Conversation/);
    assert.match(await a.p.locator('#view').innerText(), /You can read tickets but not answer them\./); for (const name of ['Send reply', 'Add internal note', 'Assign to me', 'Change status']) assert.equal(await a.p.getByRole('button', { name }).count(), 0, 'Approver has no "' + name + '" button');
    await assert.rejects(call('approver', 'cc-support-note', { requestId: 'cc-ui-approver-note-1', scope: store.scope, id: 2, message: 'Approvers cannot write' }), e => e.status === 403, 'and the server refuses it too');
    assert.deepEqual(a.errors, []);
    const sp = await open('support'); assert.equal(await sp.p.locator('#who-role').textContent(), 'Support');
    await sp.p.goto(base + '#support'); await waitText(sp.p, '#view', /Hero stuck in prison/); await sp.p.getByRole('button', { name: 'Open ticket #2' }).click(); await waitText(sp.p, '#view', /Conversation/);
    await sp.p.getByLabel('Reply to the player').fill('Thanks, we are looking into it.'); await sp.p.getByRole('button', { name: 'Send reply' }).click(); await waitText(sp.p, '#notice', /Reply sent\./);
    assert.deepEqual((await call('reporter', 'support-view', { id: 2 })).messages.map(x => x.from), ['you', 'team']); assert.deepEqual(sp.errors, []);
    await v.p.locator('#signout').click(); assert.equal(await v.p.locator('#view').isHidden(), true, 'sign-out clears the console');
  } finally { await browser?.close(); await new Promise(r => server.close(r)); await db.close(); }
  console.log('PASS: Command Center UI sign-in, network banner, truthful KPIs, report queue, guarded mute enforced by the server, not-implemented modules, player lookup redaction, two-person announcements, audit verification, EN/PT-BR, tablet/phone layouts, viewer/moderator scopes, the Support tab (queue, thread, reply, internal notes, assign, status, read-only Approver) and no script injection.');
})().catch(e => { console.error(e); process.exitCode = 1; });
