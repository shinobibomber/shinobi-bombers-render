/* Summon History lists summoned heroes; Boss Hunt is a paid 10,000 Ryo damage run by the 5 strongest heroes
 * and its panels neither overflow nor cut the artwork's buttons. Isolated fixtures only. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
const output = path.join(__dirname, 'out'); fs.mkdirSync(output, { recursive: true });

const login = async p => {
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
};
const hero = (id, rank, pw) => ({ tokenId: id, rank, level: 1, name: 'Hero ' + id, baseStats: { pw, sp: 4, st: 8 } });

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    const kept = hero('kept-legend', 4, 13.5), gone = hero('fused-genin', 0, 2), now = Date.now();
    f.profile = economy.normalizeProfile({ ...f.profile, heroes: [...f.profile.heroes, kept] });
    const order = (id, status, created, outputs, quantity) => ({ request_id: id, amount: String(25000 * quantity), status, acknowledged: true, created: String(created), signature: 'S'.repeat(80),
      quote: { product: 'summon', params: { quantity }, title: 'Summon ' + quantity }, result: status === 'confirmed' ? { product: 'summon', outputs } : null });
    f.purchases = [order('summon-new-0001', 'confirmed', now, [kept, gone], 2), order('summon-pend-0002', 'pending', now - 1000, [], 1),
      order('summon-refd-0003', 'refunded', now - 2000, [], 1), { request_id: 'fusion-0004', amount: '25000', status: 'confirmed', created: String(now - 3000), quote: { product: 'fusion' }, result: { product: 'fusion', outputs: [] } }];
    await login(p);
    await p.evaluate(() => go(2)); await p.waitForFunction(() => WebsiteDesign.current() === 'summon');
    await p.locator('.sbw-scr.on [data-sbwid="sb-hist"]').click();
    await p.waitForSelector('.sbw-history[open]');
    assert.equal(await p.locator('.gc-dialog[open]').count(), 0, 'Summon History no longer opens the Chest');
    const view = await p.evaluate(() => ({ batches: [...document.querySelectorAll('.sbw-sh-batch header')].map(h => h.textContent),
      heroes: [...document.querySelectorAll('.sbw-sh-hero')].map(h => ({ name: h.querySelector('b').textContent, rank: h.querySelector('small').textContent, gone: h.classList.contains('gone') })),
      summary: document.querySelector('.sbw-sh-sum').textContent }));
    assert.equal(view.batches.length, 3, 'only summon orders are listed');
    assert.match(view.batches[0], /×2 summon/); assert.match(view.batches[1], /Settling/); assert.match(view.batches[2], /Refunded/);
    assert.deepEqual(view.heroes, [{ name: 'Hero kept-legend', rank: 'Legend', gone: false }, { name: 'Hero fused-genin', rank: 'Genin · no longer in collection', gone: true }]);
    assert.match(view.summary, /2 heroes from 3 summons/);
    await p.screenshot({ path: path.join(output, 'summon-history.png') });
    await p.keyboard.press('Escape');
    await p.waitForSelector('.sbw-history', { state: 'detached' }).catch(() => {});
    assert.equal(await p.evaluate(() => document.querySelector('dialog.sbw-dialog')?.classList.contains('sbw-history')), false, 'closing restores the shared dialog');
    assert.deepEqual(errors, []);
  });

  // Boss Hunt: live panels (no printed placeholders), the 5 strongest battle-ready heroes picked
  // automatically (even undeployed or out of chakra), a paid 10,000 Ryo entry, a no-chakra damage run,
  // damage reported to the daily ranking, the prize pool and rankings, and the phone layout.
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.balance = 100000;
    const heroes = Array.from({ length: 8 }, (_, i) => hero('boss-' + i, i % 5, 2 + i * 1.5));
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId) });
    f.hunt = { week: [{ name: 'KuroSenpai', points: 28, damage: 90000 }, { name: 'YukiChan', points: 17 }], lastWeek: { week: '2029-12-24', winners: [{ rank: 1, name: 'KuroSenpai', wallet: 'Kuro…1111', points: 61, prize: 'Legend hero' }, { rank: 4, name: 'Raizen', wallet: 'Raiz…4444', points: 30, prize: 'Elite hero' }] },
      others: [{ name: 'KuroSenpai', damage: 42000 }, { name: 'YukiChan', damage: 31000 }], yesterday: { day: '2030-01-01', pool: 18000, winners: [{ rank: 1, name: 'KuroSenpai', wallet: 'Kuro…1111', damage: 99000, prize: 10800 }] } };
    await login(p);
    // Nobody deployed and some heroes out of chakra: the hunt team does not need either.
    await p.evaluate(() => S.h.filter(h => h.tokenId).forEach((h, i) => { h.on = false; if (i % 2) h.en = 0; }));
    await p.evaluate(() => go(8)); await p.waitForFunction(() => WebsiteDesign.current() === 'boss-hunt' && document.querySelector('.sbw-scr.on .bh-pool'));
    const view = await p.evaluate(() => { const sec = document.querySelector('.sbw-scr.on');
      return { art: [...sec.querySelectorAll('.hs:not([hidden])')].map(e => e.dataset.sbwid), text: sec.innerText, tiles: sec.querySelectorAll('.bh-tile:not(.empty)').length, fit: getComputedStyle(sec.querySelector('.sbw-bh-canvas')).objectFit }; });
    assert.deepEqual(view.art, ['back'], 'only the Back button remains from the artwork');
    assert(!/POTENTIAL REWARDS|FIRST-CLEAR|Manage Team|Not yet/i.test(view.text), 'no first-clear reward, fragments or Manage Team');
    assert.match(view.text, /TODAY'S PRIZE POOL[\s\S]*16,000 Ryo/, 'the prize pool shows Ryo (2 entries × 8,000)');
    assert.match(view.text, /Auto-select strongest 5/); assert.match(view.text, /CHALLENGE · 10,000 Ryo/);
    assert.equal(view.tiles, 5, 'five auto-selected heroes'); assert.equal(view.fit, 'contain', 'the whole arena is shown (moon included)');
    const strongest = await p.evaluate(() => BattleRoster.list().slice().sort((a, c) => c.pw - a.pw).slice(0, 5).map(h => h.id));
    await p.locator('.sbw-scr.on [data-act="auto"]').click();
    await p.waitForFunction(() => /^Hunt team: /.test(document.querySelector('.sbw-toast')?.textContent || ''));
    // Challenge: the confirmation shows the fee; paying starts the hunt with the strongest five.
    await p.locator('.sbw-scr.on .bh-go').click(); await p.waitForSelector('.sbw-hunt[open]');
    assert.match(await p.locator('.sbw-hunt').textContent(), /60 seconds[\s\S]*10,000 Ryo[\s\S]*8,000 prize pool · 1,000 treasury · 1,000 burned/);
    await p.locator('.sbw-hunt [data-k="go"]').click();
    await p.waitForFunction(() => V2.isBossActive());
    assert.equal(f.balance, 90000, 'the 10,000 Ryo entrance fee is paid');
    assert.deepEqual(await p.evaluate(() => V2.bossState().team.map(u => u.id)), strongest, 'the hunt team is the 5 strongest battle-ready heroes');
    const chakra = await p.evaluate(() => S.h.map(h => h.en));
    await p.waitForFunction(() => V2.bossState().damage > 0, null, { timeout: 15000 });
    const later = await p.evaluate(() => S.h.map(h => h.en));
    assert(later.every((en, i) => en >= chakra[i] - 1e-9), 'the hunt spends no chakra (heroes at 0 chakra still fight)');
    assert.match(await p.locator('.sbw-scr.on .bh-go').textContent(), /HUNTING · \d+s/);
    assert(await p.evaluate(() => V2.bossState().time <= 60), 'hunts last 60 seconds');
    await p.screenshot({ path: path.join(output, 'boss-hunt-fight.png') });
    // Ending reports the damage; the ranking and my day update.
    await p.evaluate(() => V2.retreat());
    await p.waitForFunction(() => /You: <b>/.test(document.querySelector('.sbw-scr.on .bh-rk.day .you')?.innerHTML || ''), null, { timeout: 15000 });
    const dealt = f.hunt.entries[0].damage;
    assert(dealt > 0 && f.hunt.reports.length >= 1, 'the damage was reported to the server');
    assert.match(await p.locator('.sbw-scr.on .sbw-bh-mine').textContent(), new RegExp('Damage today' + dealt.toLocaleString('en-US')));
    // Two ranking buttons, each with its own pop-up: standings plus the previous day's / week's winners.
    const buttons = await p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on .sbw-bh-ranks .bh-rk')].map(b => [b.dataset.act, b.textContent.replace(/\s+/g, ' ').trim()]));
    assert.deepEqual(buttons.map(b => b[0]), ['daily', 'weekly'], 'separate Daily and Weekly buttons');
    assert.match(buttons[0][1], /DAILY RANKINGS.*1st KuroSenpai · 42,000 dmg.*You: \d+(st|nd|rd|th) · [\d,]+ dmg · ends in/);
    assert.match(buttons[1][1], /WEEKLY RANKINGS.*1st KuroSenpai · 28 pts.*You: 3rd · 8 pts · Legend hero/, 'my provisional weekly place');
    await p.locator('.sbw-scr.on .bh-rk.day').click(); await p.waitForSelector('.sbw-rankdlg.daily[open]');
    const daily = await p.locator('.sbw-rankdlg').textContent();
    assert.match(daily, /Daily Rankings[\s\S]*Prize pool[\s\S]*Today's standings[\s\S]*KuroSenpai[\s\S]*42,000 dmg[\s\S]*Previous day's winners[\s\S]*Jan 1[\s\S]*pool 18,000 Ryo[\s\S]*99,000 dmg[\s\S]*10,800 Ryo/, 'Daily: today and the previous day');
    assert(!/Weekly Rankings/.test(daily), 'the daily pop-up shows only daily rankings');
    await p.screenshot({ path: path.join(output, 'boss-hunt-daily.png') });
    await p.locator('.sbw-rankdlg [data-k="x"]').click(); await p.waitForFunction(() => !document.querySelector('.sbw-rankdlg[open]'));
    await p.locator('.sbw-scr.on .bh-rk.wk').click(); await p.waitForSelector('.sbw-rankdlg.weekly[open]');
    const weekly = await p.locator('.sbw-rankdlg').textContent();
    assert.match(weekly, /Weekly Rankings[\s\S]*This week's standings[\s\S]*1stKuroSenpai[\s\S]*28 pts[\s\S]*Legend hero[\s\S]*2nd[\s\S]*17 pts/, 'weekly standings by points with prizes');
    assert.match(weekly, /Last week's winners[\s\S]*Dec 24 – Dec 30[\s\S]*Legend hero[\s\S]*Elite hero/, "last week's winners");
    await p.screenshot({ path: path.join(output, 'boss-hunt-weekly.png') });
    await p.locator('.sbw-rankdlg [data-k="swap"]').click(); await p.waitForSelector('.sbw-rankdlg.daily[open]');
    await p.keyboard.press('Escape');
    // No tiny text on the Boss Hunt panels.
    const tiny = await p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on [class*="sbw-bh-"] *')].filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.getBoundingClientRect().width && (c => parseFloat(getComputedStyle(e).fontSize) * c.getBoundingClientRect().width / c.offsetWidth)(e.closest('.sbw-cv')) < 10).map(e => e.className + ':' + e.textContent.slice(0, 30)));
    assert.deepEqual(tiny, [], 'Boss Hunt text is at least 10px on screen');
    // Phone: stacked panels, a full-width arena and a one-line Challenge button.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForFunction(() => document.getElementById('sbwLayer').classList.contains('sbw-phone'));
    const phone = await p.evaluate(() => { const sec = document.querySelector('.sbw-scr.on'), go = sec.querySelector('.bh-go').getBoundingClientRect(), arena = sec.querySelector('.sbw-bh-arena').getBoundingClientRect();
      return { sideways: sec.scrollWidth > sec.clientWidth + 1, goOneLine: go.height < 70 && go.width > 300, arena: arena.width > 340 && Math.abs(arena.width / arena.height - 1200 / 660) < 0.05 }; });
    assert.deepEqual(phone, { sideways: false, goOneLine: true, arena: true });
    await p.screenshot({ path: path.join(output, 'boss-hunt-phone.png') });
    assert.deepEqual(errors, []);
  });
  // A running hunt never freezes Adventure: the 5 hunt heroes leave the map, the others keep
  // defeating enemies, and the hunt heroes come back when the hunt ends.
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.balance = 100000;
    const heroes = [4, 4, 4, 4, 4, 3, 3, 3].map((r, i) => hero('hunt-' + i, r, r === 4 ? 13.5 : 10.5));
    heroes.forEach(h => { h.baseStats.sp = h.baseStats.pw; h.baseStats.st = h.baseStats.pw; });
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId) });
    await login(p);
    await p.evaluate(() => { go(0); Experience.workAll(); });
    await p.waitForFunction(() => S.h.filter(h => h.on && h.x >= 0).length === 8);
    await p.evaluate(() => go(8)); await p.waitForFunction(() => WebsiteDesign.current() === 'boss-hunt' && document.querySelector('.sbw-scr.on .bh-go'));
    await p.locator('.sbw-scr.on .bh-go').click(); await p.waitForSelector('.sbw-hunt[open]'); await p.locator('.sbw-hunt [data-k="go"]').click();
    await p.waitForFunction(() => V2.isBossActive());
    const team = await p.evaluate(() => { go(0); return V2.bossState().team.map(u => u.id); });
    assert.equal(team.length, 5);
    await p.evaluate(() => { window.__huntKills = 0; addEventListener('shinobi-enemy-defeated', () => { if (V2.isBossActive()) __huntKills++; }); });
    await p.waitForFunction(() => __huntKills >= 2, null, { timeout: 60000 });
    const during = await p.evaluate(team => ({ active: V2.isBossActive(), away: S.h.filter(h => team.includes(h.id)).every(h => h.x < 0), others: S.h.filter(h => h.on && !team.includes(h.id)).every(h => h.x >= 0) }), team);
    assert.deepEqual(during, { active: true, away: true, others: true }, 'Adventure keeps fighting with the other heroes during the hunt');
    await p.evaluate(() => V2.retreat());
    await p.waitForFunction(team => S.h.filter(h => team.includes(h.id)).every(h => h.x >= 0), team, { timeout: 3000 });
    assert.equal(await p.evaluate(() => document.getElementById('p8')?.innerText.includes('Adventure pauses')), false, 'no screen says Adventure pauses');
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Summon History lists summoned heroes (owned, fused, pending, refunded); Boss Hunt shows only live panels, auto-picks the 5 strongest battle-ready heroes, takes the 10,000 Ryo entry (80% pool, 10% treasury, 10% burn), runs 60 seconds without chakra, shows daily and weekly rankings (Legend/Elite prizes), reports damage to the daily ranking and prize pool, fits phones, and Adventure keeps fighting during a hunt.');
})().catch(error => { console.error(error); process.exitCode = 1; });
