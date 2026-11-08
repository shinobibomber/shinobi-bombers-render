/* Bug and crash sweep: every website screen and the main dialogs at desktop and phone sizes, with
 * page errors, console errors and failed or 4xx/5xx requests recorded. Isolated fixtures only. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');

const hero = (i, rank) => ({ tokenId: 's-' + i, rank, level: 1 + i % 5, name: 'Sweep' + i + ' Test', baseStats: { pw: 2 + rank * 3, sp: 2 + rank * 3, st: 2 + rank * 3 } });
const SCREENS = ['home', 'adventure', 'heroes', 'summon', 'fusion', 'dojo', 'market', 'boss-hunt', 'codex', 'guild'];

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    const issues = [];
    p.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text().slice(0, 160)); });
    p.on('requestfailed', r => { if (!/favicon/.test(r.url())) issues.push('failed: ' + r.url() + ' ' + (r.failure()?.errorText || '')); });
    p.on('response', r => { if (r.status() >= 400) issues.push('HTTP ' + r.status() + ': ' + r.url()); });
    f.holdAdventure = false;f.profile.upgradeShards=100; f.balance = 5000000;
    const heroes = Array.from({ length: 16 }, (_, i) => hero(i, i % 5));
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.slice(0, 12).map(h => h.tokenId), sensei: true });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && WebsiteDesign.current() === 'home');
    for (const size of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await p.setViewportSize(size);
      for (const k of SCREENS) {
        await p.evaluate(k => ({ home: () => go(5), adventure: () => go(0), heroes: () => go(1), summon: () => go(2), fusion: () => go(6), dojo: () => go(4, 0), market: () => go(4, 1), 'boss-hunt': () => go(8), codex: () => go(3), guild: () => document.querySelector('.sbw-ph-more .sbw-ph-item[data-k="guild"], .sbw-hdr [data-sbwid="nav-guild"]')?.click() })[k](), k);
        await p.waitForFunction(k => WebsiteDesign.current() === k, k, { timeout: 5000 });
        await p.waitForTimeout(400);
      }
      // Dialogs: Chest, Summon History, GO OFFLINE (stay online), chat, training checkout (cancel).
      await p.evaluate(() => go(5)); await p.waitForFunction(() => WebsiteDesign.current() === 'home');
      await p.locator('[data-gc-chest]').click(); await p.waitForSelector('.gc-dialog[open]'); await p.keyboard.press('Escape');
      await p.evaluate(() => document.querySelector('.sbw-scr.on [data-sbwid="chatbar"]').click()); await p.waitForSelector('.sbw-chatpop:not([hidden])'); await p.keyboard.press('Escape');
      await p.evaluate(() => (document.querySelector('.sbw-ph-wallet') && getComputedStyle(document.querySelector('.sbw-ph-wallet')).display !== 'none' ? document.querySelector('.sbw-ph-wallet') : document.querySelector('.sbw-hdr [data-sbwid="wallet"]')).click());
      await p.waitForSelector('.sbw-offline[open]'); await p.locator('.sbw-offline [data-k="stay"], .sbw-offline [data-k="x"]').first().click();
      await p.evaluate(() => go(2)); await p.waitForFunction(() => WebsiteDesign.current() === 'summon');
      await p.evaluate(() => document.querySelector('.sbw-scr.on [data-sbwid="sb-hist"]').click()); await p.waitForSelector('.sbw-history[open]'); await p.keyboard.press('Escape');
      await p.evaluate(() => { up(S.h.findIndex(h => h.tokenId === 's-0')); });
      await p.locator('.hero-upgrade-dialog button').filter({hasText:/^Upgrade/}).click();
      await p.waitForSelector('#checkoutCancel', { state: 'visible' }); await p.locator('#checkoutCancel').click();
      // Adventure keeps running on both layouts.
      await p.evaluate(() => go(0)); await p.waitForTimeout(1500);
    }
    assert.equal(f.requests.filter(r => ['purchase', 'withdraw', 'deposit', 'claim-adventure'].includes(r.action)).length, 0, 'the sweep moves no funds');
    assert.deepEqual(issues, [], 'no console errors or failed requests');
    assert.deepEqual(errors, [], 'no page errors');
  });
  console.log('PASS: every screen, the Chest, chat, GO OFFLINE, Summon History and training checkout at desktop and phone sizes run without page errors, console errors or failed requests.');
})().catch(error => { console.error(error); process.exitCode = 1; });
