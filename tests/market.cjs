/* Player Market in the browser: list a hero from Heroes (rank minimum, 80% payout shown), browse
 * with rank and skills filters, sort and search, buy through the confirmation (the hero joins the
 * buyer's collection), cancel from My Listings, and the phone layout. Isolated fixtures only. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
const output = path.join(__dirname, 'out'); fs.mkdirSync(output, { recursive: true });

const OTHER = 'OtHeRsElLeR' + '9'.repeat(33);
const hero = (id, rank, name) => ({ tokenId: id, rank, level: 1, name, baseStats: { pw: 2 + rank * 3, sp: 2 + rank * 3, st: 2 + rank * 3 } });
const seed = () => Array.from({ length: 12 }, (_, i) => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(i).padStart(12, '0'), seller: OTHER, price: [10000, 25000, 80000, 200000, 500000][i % 5] * (1 + i),
  hero: hero('mk-' + i, i % 5, ['Kai', 'Ren', 'Aki', 'Yuki', 'Sora', 'Nao'][i % 6] + ' of Leaf ' + i) }));
const cards = p => p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on .sbw-mcard')].map(c => ({ name: c.querySelector('.mc-name').textContent, rank: c.querySelector('.mc-top b').textContent, price: +c.querySelector('.mc-price').textContent.replace(/\D/g, ''), perks: c.querySelector('.mc-perks').textContent })));
const settle = p => p.waitForFunction(() => !document.querySelector('.sbw-scr.on .sbw-empty b')?.textContent.startsWith('Loading'));

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.balance = 5000000; f.market = { listings: seed() };
    const mine = [hero('my-genin', 0, 'Seller Genin'), hero('my-legend', 4, 'Seller Legend'), hero('my-chunin', 1, 'Seller Chunin')];
    f.profile = economy.normalizeProfile({ ...f.profile, heroes: mine, battleReady: mine.map(h => h.tokenId) });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && WebsiteDesign.current() === 'home');

    // Browse: 10 cheapest first, two pages, no stray filter badges.
    await p.evaluate(() => go(4, 1)); await p.waitForFunction(() => WebsiteDesign.current() === 'market' && document.querySelectorAll('.sbw-scr.on .sbw-mcard').length === 10);
    let list = await cards(p);
    assert.deepEqual(list.map(c => c.price), [...list.map(c => c.price)].sort((a, b) => a - b), 'cheapest first');
    assert.equal(await p.locator('.sbw-scr.on .sbw-mpages button').count(), 2, 'two pages');
    assert.equal(await p.locator('.sbw-scr.on .sbw-mbadge:not(.wide)').isVisible(), false, 'no skills badge until skills are chosen');
    const fit = await p.evaluate(() => { const g = document.querySelector('.sbw-scr.on .sbw-mgrid').getBoundingClientRect(); return [...document.querySelectorAll('.sbw-scr.on .sbw-mcard')].every(c => { const r = c.getBoundingClientRect(); return r.right <= g.right + 1 && r.bottom <= g.bottom + 1; }); });
    assert(fit, 'every card fits inside the listings panel');
    // Rank chip, skills filter (has all chosen), price sort, search, reset.
    await p.locator('.sbw-scr.on [data-sbwid="f5"]').click(); await settle(p);
    await p.waitForFunction(() => [...document.querySelectorAll('.sbw-scr.on .sbw-mcard .mc-top b')].every(b => b.textContent === 'LEGEND'));
    assert.equal((await cards(p)).length, 2, 'Legend filter');
    const legendPerks = f.market.listings.filter(l => l.hero.rank === 4).map(l => l.hero.perks);
    const perk = legendPerks[0][0];
    await p.locator('.sbw-scr.on [data-sbwid="dd2"]').click(); await p.waitForSelector('.sbw-perks[open]');
    await p.locator(`.sbw-perk-list input[value="${perk}"]`).check(); await p.locator('.sbw-perks [data-k="apply"]').click(); await settle(p);
    const expected = legendPerks.filter(ps => ps.includes(perk)).length;
    await p.waitForFunction(n => document.querySelectorAll('.sbw-scr.on .sbw-mcard').length === n, expected);
    assert.equal(await p.locator('.sbw-scr.on .sbw-mbadge:not(.wide)').textContent(), '1', 'the Skills badge counts chosen skills');
    await p.locator('.sbw-scr.on [data-sbwid="rst"]').click(); await p.waitForFunction(() => document.querySelectorAll('.sbw-scr.on .sbw-mcard').length === 10);
    await p.locator('.sbw-scr.on [data-sbwid="dd3"]').click(); await settle(p); await p.waitForTimeout(200);
    list = await cards(p); assert.deepEqual(list.map(c => c.price), [...list.map(c => c.price)].sort((a, b) => b - a), 'Price ↓ after one tap');
    await p.locator('.sbw-scr.on [data-sbwid="srch"]').click(); await p.locator('.sbw-dialog[open] input').fill('Leaf 7'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelectorAll('.sbw-scr.on .sbw-mcard').length === 1);
    assert.equal((await cards(p))[0].name, 'Ren of Leaf 7', 'search by name');
    await p.locator('.sbw-scr.on [data-sbwid="rst"]').click(); await p.waitForFunction(() => document.querySelectorAll('.sbw-scr.on .sbw-mcard').length === 10);
    await p.screenshot({ path: path.join(output, 'market-browse.png') });

    // Buy: the confirmation shows the price, the buyer pays it and the hero joins the collection.
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="0"]').click();
    const target = (await cards(p))[0];
    await p.locator('.sbw-scr.on [data-sbwid="buy"]').click(); await p.waitForSelector('.sbw-dialog[open] [data-k="buy"]');
    assert.match(await p.locator('.sbw-dialog[open]').textContent(), new RegExp(target.price.toLocaleString('en-US') + ' Ryo'));
    await p.locator('.sbw-dialog[open] [data-k="buy"]').click();
    await p.waitForFunction(name => S.h.some(h => h.name === name), target.name);
    assert.equal(f.balance, 5000000 - target.price, 'the buyer pays the listed price');
    assert.equal(f.requests.filter(r => r.action === 'market-buy').length, 1, 'one purchase request');

    // Sell from Heroes: the dialog enforces the rank minimum and shows the 80% payout.
    await p.locator('.sbw-hdr [data-sbwid="nav-heroes"]').click(); await p.waitForFunction(() => WebsiteDesign.current() === 'heroes');
    await p.evaluate(() => window.Market.openListing(S.h.find(h => h.tokenId === 'my-legend').id));
    await p.waitForSelector('.sbw-sell[open]');
    assert.equal(await p.locator('.sbw-sell input').inputValue(), '500000', 'a Legend starts at its 500,000 minimum');
    await p.locator('.sbw-sell input').fill('400000'); await p.locator('.sbw-sell [data-k="post"]').click();
    assert.match(await p.locator('.sbw-sell .sbw-msg').textContent(), /500,000/, 'below the minimum is refused');
    await p.locator('.sbw-sell input').fill('1000000');
    assert.match(await p.locator('.sbw-sell .sbw-sell-out').textContent(), /800,000 Ryo.*reward pool 100,000.*treasury 80,000.*studio 20,000/s, 'the 80/10/8/2 split is shown');
    await p.locator('.sbw-sell [data-k="post"]').click(); await p.waitForSelector('.sbw-sell[open]', { state: 'detached' }).catch(() => {});
    await p.waitForFunction(() => !S.h.some(h => h.tokenId === 'my-legend'));
    // My Listings shows it with Cancel; cancelling brings the hero back.
    await p.evaluate(() => go(4, 1)); await p.waitForFunction(() => WebsiteDesign.current() === 'market');
    await p.locator('.sbw-scr.on [data-sbwid="tb4"]').click();
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on .sbw-mcard .mc-name')?.textContent === 'Seller Legend');
    await p.locator('.sbw-scr.on .mc-cancel').click();
    await p.waitForFunction(() => S.h.some(h => h.tokenId === 'my-legend'));
    assert.equal(f.market.listings.find(l => l.hero.tokenId === 'my-legend').status, 'cancelled');

    // Phone: the Market stacks into readable two-column cards without sideways scrolling.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator('.sbw-scr.on [data-sbwid="tb1"]').click();
    await p.waitForFunction(() => document.querySelectorAll('.sbw-scr.on .sbw-mcard').length >= 2 && document.getElementById('sbwLayer').classList.contains('sbw-phone'));
    const phone = await p.evaluate(() => { const sec = document.querySelector('.sbw-scr.on'), c = [...sec.querySelectorAll('.sbw-mcard')].map(e => e.getBoundingClientRect()); return { sideways: sec.scrollWidth > sec.clientWidth + 1, twoColumns: c[0].top === c[1].top && c[0].width > 150 }; });
    assert.deepEqual(phone, { sideways: false, twoColumns: true });
    await p.screenshot({ path: path.join(output, 'market-phone.png') });
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Market browse (cheapest first, pages, rank and skills filters, price sort, search, reset), buy with confirmation, sell from Heroes with rank minimum and 80/10/8/2 payout, My Listings cancel, and the phone layout.');
})().catch(error => { console.error(error); process.exitCode = 1; });
