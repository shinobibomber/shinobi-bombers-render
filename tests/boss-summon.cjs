/* Summon History lists summoned heroes; Boss Hunt fights with the 5 strongest rested heroes
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
    const order = (id, status, created, outputs, quantity) => ({ request_id: id, amount: String(25500 * quantity), status, acknowledged: true, created: String(created), signature: 'S'.repeat(80),
      quote: { product: 'summon', params: { quantity }, title: 'Summon ' + quantity }, result: status === 'confirmed' ? { product: 'summon', outputs } : null });
    f.purchases = [order('summon-new-0001', 'confirmed', now, [kept, gone], 2), order('summon-pend-0002', 'pending', now - 1000, [], 1),
      order('summon-refd-0003', 'refunded', now - 2000, [], 1), { request_id: 'fusion-0004', amount: '25500', status: 'confirmed', created: String(now - 3000), quote: { product: 'fusion' }, result: { product: 'fusion', outputs: [] } }];
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

  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    const heroes = Array.from({ length: 8 }, (_, i) => hero('boss-' + i, i % 5, 2 + i * 1.5));
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId) });
    await login(p);
    await p.evaluate(() => { go(0); Experience.workAll(); });
    await p.waitForFunction(() => S.h.filter(h => h.on).length === 8);
    await p.evaluate(() => go(8)); await p.waitForFunction(() => WebsiteDesign.current() === 'boss-hunt');
    await p.waitForTimeout(300);
    const strongest = await p.evaluate(() => BattleRoster.list().filter(h => h.on && h.en >= 1).sort((a, c) => c.pw - a.pw).slice(0, 5).map(h => h.id));
    const panel = await p.evaluate(() => {
      const fits = el => el.scrollWidth <= el.clientWidth + 1, rect = el => el.getBoundingClientRect();
      const rows = [...document.querySelectorAll('.sbw-scr.on .sbw-mechrow')], ranks = rect(document.querySelector('.sbw-scr.on .sbw-soonpanel')), viewAll = rect(document.querySelector('.sbw-scr.on [data-sbwid="rk"]'));
      return { label: document.querySelector('.sbw-scr.on .sbw-cover.sbw-left[style*="1030px"][style*="420px"]')?.textContent, tiles: document.querySelectorAll('.sbw-scr.on .sbw-btile:not(.empty)').length,
        rows: rows.length, rowsFit: rows.every(fits), rowsSingleLine: rows.every(r => r.scrollHeight <= r.clientHeight + 1), ranksBelowViewAll: ranks.top >= viewAll.bottom - 0.5 };
    });
    assert.equal(panel.label, 'Hunt team (5/5)'); assert.equal(panel.tiles, 5, 'five hunt tiles are filled');
    assert.equal(panel.rows, 4); assert(panel.rowsFit && panel.rowsSingleLine, 'mechanics rows fit on one line each');
    assert(panel.ranksBelowViewAll, 'the rankings panel no longer cuts the View All button');
    await p.screenshot({ path: path.join(output, 'boss-hunt-team.png') });
    await p.evaluate(() => V2.startBoss());
    await p.waitForFunction(() => /HUNT ACTIVE|IN COMBAT|Hunt in progress/i.test(document.getElementById('p8')?.innerText || ''));
    const fighting = await p.evaluate(() => [...document.querySelectorAll('#p8 .hunt-hero')].length);
    assert.equal(fighting, 5, 'the hunt starts with exactly five heroes');
    const roster = await p.evaluate(ids => ids.map(id => S.h.find(h => h.id === id).pw), strongest);
    assert.deepEqual(roster, [...roster].sort((a, b) => b - a), 'they are the strongest rested heroes');
    await p.evaluate(() => V2.retreat());
    assert.deepEqual(errors, []);
  });
  // A running hunt no longer freezes Adventure: the 5 hunt heroes leave the map, the others keep
  // defeating enemies, and the hunt heroes come back when the hunt ends.
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    const heroes = [4, 4, 4, 4, 4, 3, 3, 3].map((r, i) => hero('hunt-' + i, r, r === 4 ? 13.5 : 10.5));
    heroes.forEach(h => { h.baseStats.sp = h.baseStats.pw; h.baseStats.st = h.baseStats.pw; });
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId) });
    await login(p);
    await p.evaluate(() => { go(0); Experience.workAll(); });
    await p.waitForFunction(() => S.h.filter(h => h.on && h.x >= 0).length === 8);
    const team = await p.evaluate(() => { S.v2.bestBoss = 400; go(8); V2.startBoss(); go(0); return BattleRoster.list().filter(h => h.on && h.en >= 1).sort((a, c) => c.pw - a.pw).slice(0, 5).map(h => h.id); });
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
  console.log('PASS: Summon History lists summoned heroes (owned, fused, pending, refunded); Boss Hunt fights with the 5 strongest rested heroes, its panels fit, and Adventure keeps fighting during a hunt.');
})().catch(error => { console.error(error); process.exitCode = 1; });
