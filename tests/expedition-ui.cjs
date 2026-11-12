/* Expedition Hall in the real game page (owner spec 2026-11-11). While Expedition Mode is off, Home is unchanged (the printed
 * DAILY MISSIONS art, no panel). When on: the EXPEDITION HALL panel covers exactly that panel, lists up to three heroes in the
 * required priority (on Expedition, near the 18-hour limit, recently completed) with a notification dot; View All opens the
 * full Expedition Hall with its three tabs; the optional Expedite flow shows the server quote and the 50/30/10/10 split and
 * sends only the server's quote after an explicit confirmation; the Heroes Collection detail shows Combat Duty and the
 * Expedition; a hero on an Expedition cannot be deployed or picked by Work All. Desktop + phone. The view is built by the
 * real server module (expedition.cjs build) from the fixture profile. Isolated fixture (server logic: expedition-*.cjs). */
const assert = require('node:assert/strict'), path = require('node:path'), { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs'), X = require('../app/server/expedition.cjs'), D = require('../app/server/combat-duty.cjs');
const root = path.resolve(__dirname, '..'), H = D.HOUR;
process.env.EXPEDITIONS_ENABLED = 'on'; process.env.EXPEDITION_ACCELERATION_ENABLED = 'on'; process.env.EXPEDITION_ROUTING_ENABLED = 'on';
(async () => {
  for (const phone of [false, true]) await withGame(async ({ p, f, errors }) => {
    f.holdAdventure = false;
    const t = Date.now(), mk = (rank, name) => ({ ...economy.hero(rank), name });
    const away = mk(4, 'Kai of Crimson Dusk'), near = mk(1, 'Ren of Silent Rain'), back = mk(2, 'Aki of Hidden Leaf'), fresh = mk(0, 'Nao of Ember Ridge');
    away.chakra = { version: 1, value: 40, at: t, nextAt: t, resting: true, duty: { v: 1, ms: D.DUTY_CAP_MS, exp: { start: t - 4 * H - 38 * 60000, ends: t + 82 * 60000, ms: 6 * H, rank: 4, founder: false } } };
    near.chakra = { version: 1, value: 60, at: t, nextAt: t, resting: true, duty: { v: 1, ms: 15 * H } };
    back.chakra = { version: 1, value: 20, at: t, nextAt: t, resting: true, duty: { v: 1, ms: 0, n: 1, last: { start: t - 5 * H, ends: t - H, ms: 4 * H, rank: 2, founder: false, completed: t - H } } };
    f.profile = economy.normalizeProfile({ ...f.profile, heroes: [away, near, back, fresh] }); f.profile.battleReady = f.profile.heroes.map(h => h.tokenId);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.Expedition);
    await p.evaluate(() => go(5)); await p.waitForFunction(() => WebsiteDesign.current() === 'home');
    // Off: no panel, the printed panel's buttons behave as before.
    await p.evaluate(() => Expedition.refresh());
    assert.equal(await p.locator('.sbw-scr.on .sbw-exp-panel').isHidden(), true, 'no Expedition panel while Expedition Mode is off');
    // On: the panel covers the DAILY MISSIONS slot.
    f.expedition = () => X.build(f.profile, { team: [] }, Date.now()).expedition;
    await p.evaluate(() => Expedition.refresh());
    await p.waitForFunction(() => { const e = document.querySelector('.sbw-scr.on .sbw-exp-panel'); return e && !e.hidden && e.querySelectorAll('.sbw-exp-row').length === 3; });
    const panel = await p.evaluate(() => { const e = document.querySelector('.sbw-scr.on .sbw-exp-panel'); return { text: e.innerText.replace(/\s+/g, ' '), rows: [...e.querySelectorAll('.sbw-exp-row strong')].map(s => s.firstChild.textContent), dot: !!e.querySelector('.sbw-exp-dot'), left: e.style.left, top: e.style.top, w: e.style.width, h: e.style.height }; });
    assert.match(panel.text, /EXPEDITION HALL.*View All/); assert.deepEqual(panel.rows, ['Kai', 'Ren', 'Aki'], 'priority: on Expedition, near the limit, recently completed');
    assert.match(panel.text, /On Expedition 1h 22m left.*Combat Duty 15h \/ 18h.*Expedition complete Ready for battle/);
    assert.equal(panel.dot, true, 'notification indicator for the new Expedition news');
    if (!phone) assert.deepEqual([panel.left, panel.top, panel.w, panel.h].map(v => parseFloat(v)), [1252, 645, 400, 215], 'exactly the DAILY MISSIONS panel area (artwork coordinates)');
    await p.screenshot({ path: path.join(root, 'tests/out/expedition-home' + (phone ? '-phone' : '') + '.png') });
    // View All: full Expedition Hall with three tabs.
    await p.locator('.sbw-scr.on .sbw-exp-all').click();
    await p.waitForSelector('.sbw-exp-hall .sbw-exp-tabs');
    assert.deepEqual(await p.locator('.sbw-exp-tabs button').evaluateAll(b => b.map(x => x.firstChild.textContent + ' ' + x.querySelector('i').textContent)), ['Combat Duty 2', 'On Expedition 1', 'Completed 1']);
    assert.match(await p.locator('.sbw-exp-list').innerText(), /Ren of Silent Rain.*15h \/ 18h/s);
    await p.locator('[data-exp-tab="away"]').click();
    assert.match(await p.locator('.sbw-exp-list').innerText(), /Kai of Crimson Dusk.*LEGEND.*1h 22m left.*Expedition 6h · returns in 1h 22m/s);
    const quote = X.price(away.chakra.duty.exp, Date.now(), X.prices());
    assert.match(await p.locator('[data-exp-expedite]').innerText(), new RegExp('Expedite · ' + quote.toLocaleString('en-US') + ' Ryo'));
    await p.locator('[data-exp-tab="done"]').click();
    assert.match(await p.locator('.sbw-exp-list').innerText(), /Aki of Hidden Leaf.*Ready for battle/s);
    if (phone) assert(await p.evaluate(() => { const s = document.querySelector('.sbw-exp-sheet').getBoundingClientRect(); return s.left >= 0 && s.right <= innerWidth + .5 && document.documentElement.scrollWidth <= innerWidth + .5; }), 'the Hall fits the phone screen');
    // Expedite: server quote, split disclosure, explicit confirmation, then only the server's quote is sent.
    await p.locator('[data-exp-tab="away"]').click(); await p.locator('[data-exp-expedite]').click();
    await p.waitForFunction(() => /Pay [\d,]+ Ryo/.test(document.querySelector('.sbw-exp-confirm')?.innerText || ''));
    const confirm = (await p.locator('.sbw-exp-confirm').innerText()).replace(/\s+/g, ' ');
    assert.match(confirm, /optional: the Expedition is free/); assert.match(confirm, /50% Active Reward Pool · 30% Treasury · 10% Community Rewards · 10% Economic Reserve\./); assert.doesNotMatch(confirm, /burn/i);
    assert.equal(f.requests.filter(r => r.action === 'purchase').length, 0, 'nothing is charged before the confirmation');
    await p.screenshot({ path: path.join(root, 'tests/out/expedition-confirm' + (phone ? '-phone' : '') + '.png') });
    await p.locator('[data-exp-pay]').click();
    await p.waitForFunction(() => !document.querySelector('.sbw-exp-confirm'));
    const sent = f.requests.filter(r => r.action === 'purchase');
    assert.equal(sent.length, 1); assert.equal(sent[0].product, 'expedition'); assert.deepEqual(sent[0].params, { heroId: away.tokenId, expeditionStart: away.chakra.duty.exp.start }); assert.equal(typeof sent[0].requestId, 'string');
    assert.equal(sent[0].expectedTotal, f.requests.filter(r => r.action === 'quote').pop() && economy.quote(f.profile, 'expedition', sent[0].params).total, 'the confirmed server quote');
    await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sbw-exp-hall'));
    // A hero on an Expedition cannot be deployed (toggle and Work All); the others can.
    const deploy = await p.evaluate(id => { const i = S.h.findIndex(h => h.tokenId === id); tog(i); const h = S.h[i]; return { on: h.on, toast: document.getElementById('toast').textContent }; }, away.tokenId);
    assert.equal(deploy.on, false); assert.match(deploy.toast, /on an Expedition/);
    await p.evaluate(() => { for (const h of S.h) h.en = CombatRules.maxChakra(h); Experience.workAll(); });
    assert.equal(await p.evaluate(id => S.h.find(h => h.tokenId === id).on, away.tokenId), false, 'Work All skips heroes on an Expedition');
    assert(await p.evaluate(id => S.h.filter(h => h.on).some(h => h.tokenId === id), near.tokenId), 'Work All still deploys other heroes');
    // Heroes Collection detail: Combat Duty / Expedition rows.
    if (!phone) {
      await p.evaluate(() => go(1)); await p.waitForFunction(() => WebsiteDesign.current() === 'heroes');
      const idx = await p.evaluate(id => [...document.querySelectorAll('.sbw-hcard')].findIndex(c => /Kai/.test(c.textContent)), away.tokenId);
      assert(idx >= 0); await p.locator('.sbw-hcard').nth(idx).click();
      await p.waitForFunction(() => /ON EXPEDITION/.test(document.querySelector('.sbw-exp-detail')?.innerText || ''));
      assert.match((await p.locator('.sbw-exp-detail').innerText()).replace(/\s+/g, ' '), /ON EXPEDITION 1h 2\dm left.*Expedition 6h · 1h 2\dm left.*Expedite now [\d,]+ Ryo \(optional\)/);
      await p.screenshot({ path: path.join(root, 'tests/out/expedition-heroes.png') });
    }
    assert.deepEqual(errors, [], 'no page errors');
  }, phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {});
  console.log('PASS: Expedition Hall UI: hidden while off; panel over DAILY MISSIONS with priority and notification; full Hall tabs; confirmed server quote with split disclosure; Heroes detail; no deploy or Work All while away; desktop + phone.');
})().catch(e => { console.error(e); process.exit(1); });
