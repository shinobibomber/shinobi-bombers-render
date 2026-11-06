/* Player Market in the browser: clean live controls (no printed placeholders, no Items/Resources/
 * Element), browse with rank and skills filters, sort and search, buy with confirmation, make and
 * cancel an offer (Ryo held then returned), sell from Heroes (rank minimum, 80% payout), receive
 * and accept an offer, cancel a listing, and the phone layout. Isolated fixtures only. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
const output = path.join(__dirname, 'out'); fs.mkdirSync(output, { recursive: true });

const OTHER = 'OtHeRsElLeR' + '9'.repeat(33);
const hero = (id, rank, name) => ({ tokenId: id, rank, level: 1, name, baseStats: { pw: 2 + rank * 3, sp: 2 + rank * 3, st: 2 + rank * 3 } });
const seed = () => Array.from({ length: 12 }, (_, i) => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(i).padStart(12, '0'), seller: OTHER, price: [10000, 25000, 80000, 200000, 500000][i % 5] * (1 + i),
  hero: hero('mk-' + i, i % 5, ['Kai', 'Ren', 'Aki', 'Yuki', 'Sora', 'Nao'][i % 6] + ' of Leaf ' + i) }));
const cards = p => p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on .sbw-mcard')].map(c => ({ name: c.querySelector('.mc-name').textContent, rank: c.querySelector('.mc-top b').textContent, tag: c.querySelector('.mc-top em').textContent, price: +c.querySelector('.mc-price').childNodes[1].textContent.replace(/\D/g, '') })));
const count = (p, n) => p.waitForFunction(n => document.querySelectorAll('.sbw-scr.on .sbw-mcard').length === n, n);
const tab = async (p, t) => { await p.locator(`.sbw-scr.on .sbw-mbar [data-tab="${t}"]`).click(); };

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.balance = 5000000; f.market = { listings: seed() };
    const mine = [hero('my-genin', 0, 'Seller Genin'), hero('my-legend', 4, 'Seller Legend'), hero('my-chunin', 1, 'Seller Chunin')];
    f.profile = economy.normalizeProfile({ ...f.profile, heroes: mine, battleReady: mine.map(h => h.tokenId) });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && WebsiteDesign.current() === 'home');
    await p.evaluate(() => go(4, 1)); await p.waitForFunction(() => WebsiteDesign.current() === 'market'); await count(p, 10);

    // Clean controls: no printed tabs, filters, cards or buttons show; no Items/Resources/Element.
    const clean = await p.evaluate(() => { const sec = document.querySelector('.sbw-scr.on'), panel = sec.querySelector('.sbw-mpanel').getBoundingClientRect();
      const visibleArt = [...sec.querySelectorAll('.hs:not([hidden])')].filter(e => { const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return x > panel.left && x < panel.right && y > panel.top && y < panel.bottom; }).length;
      return { visibleArt, text: sec.innerText, tabs: [...sec.querySelectorAll('[data-tab]')].map(t => t.textContent) }; });
    assert.equal(clean.visibleArt, 0, 'no printed controls show through the listings panel');
    assert(!/ITEMS|RESOURCES|Element/i.test(clean.text), 'Items, Resources and Element are gone');
    assert.deepEqual(clean.tabs, ['For Sale', 'My Listings', 'My Offers']);
    const fit = await p.evaluate(() => { const g = document.querySelector('.sbw-scr.on .sbw-mgrid').getBoundingClientRect(); return [...document.querySelectorAll('.sbw-scr.on .sbw-mcard')].every(c => { const r = c.getBoundingClientRect(), n = c.querySelector('.mc-name'); return r.right <= g.right + 1 && r.bottom <= g.bottom + 1 && n.scrollHeight <= n.clientHeight + 1; }); });
    assert(fit, 'every card and name fits');
    let list = await cards(p);
    assert.deepEqual(list.map(c => c.price), [...list.map(c => c.price)].sort((a, b) => a - b), 'cheapest first');
    // Rank, skills (has all chosen), sort, search, reset.
    await p.locator('.sbw-scr.on [data-rank="4"]').click(); await count(p, 2);
    const legendPerks = f.market.listings.filter(l => l.hero.rank === 4).map(l => l.hero.perks), perk = legendPerks[0][0];
    await p.locator('.sbw-scr.on [data-skills]').click(); await p.waitForSelector('.sbw-perks[open]');
    await p.locator(`.sbw-perk-list input[value="${perk}"]`).check(); await p.locator('.sbw-perks [data-k="apply"]').click();
    await count(p, legendPerks.filter(ps => ps.includes(perk)).length);
    assert.equal(await p.locator('.sbw-scr.on [data-skills] b').textContent(), '1', 'the Skills button counts chosen skills');
    await p.locator('.sbw-scr.on [data-reset]').click(); await count(p, 10);
    await p.locator('.sbw-scr.on .sbw-msort select').selectOption('price-desc'); await p.waitForTimeout(300);
    list = await cards(p); assert.deepEqual(list.map(c => c.price), [...list.map(c => c.price)].sort((a, b) => b - a), 'high to low');
    await p.locator('.sbw-scr.on .sbw-msearch input').fill('Leaf 7'); await count(p, 1);
    assert.equal((await cards(p))[0].name, 'Ren of Leaf 7', 'search by name');
    await p.locator('.sbw-scr.on [data-reset]').click(); await count(p, 10);
    await p.screenshot({ path: path.join(output, 'market-browse.png') });

    // Make an offer: the Ryo is held; cancelling returns it.
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="2"]').click();
    const target = (await cards(p))[2];
    await p.locator('.sbw-scr.on [data-act="offer"]').click(); await p.waitForSelector('.sbw-offer[open]');
    await p.locator('.sbw-offer input').fill('5000'); await p.locator('.sbw-offer [data-k="go"]').click();
    assert.match(await p.locator('.sbw-offer .sbw-msg').textContent(), /Offer from/, 'an offer below the rank minimum is refused');
    const amount = Math.floor(target.price * 0.8);
    await p.locator('.sbw-offer input').fill(String(amount)); await p.locator('.sbw-offer [data-k="go"]').click();
    await p.waitForFunction(() => [...document.querySelectorAll('.sbw-scr.on .mc-top em')].some(e => e.textContent === 'OFFER SENT'));
    assert.equal(f.balance, 5000000 - amount, 'the offer is held from the balance');
    await tab(p, 'offers'); await p.waitForFunction(() => document.querySelector('.sbw-scr.on .mc-top em')?.textContent === 'WAITING');
    assert.match(await p.locator('.sbw-scr.on .sbw-mheld').textContent(), /held in offers/);
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="0"]').click(); await p.locator('.sbw-scr.on [data-act="cancel-offer"]').click();
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on .mc-top em')?.textContent === 'CANCELLED');
    assert.equal(f.balance, 5000000, 'cancelling returns the held Ryo');

    // Buy now with the confirmation; the hero joins the collection.
    await tab(p, 'heroes'); await count(p, 10);
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="0"]').click();
    const buy = (await cards(p))[0];
    await p.locator('.sbw-scr.on [data-act="buy"]').click(); await p.waitForSelector('.sbw-mdialog[open] [data-k="go"]');
    assert.match(await p.locator('.sbw-mdialog[open]').textContent(), new RegExp(buy.price.toLocaleString('en-US') + ' Ryo'));
    await p.locator('.sbw-mdialog[open] [data-k="go"]').click();
    await p.waitForFunction(name => S.h.some(h => h.name === name), buy.name);
    assert.equal(f.balance, 5000000 - buy.price, 'the buyer pays the listed price');

    // Sell from Heroes: rank minimum and the 80/10/8/2 payout.
    await p.evaluate(() => window.Market.openListing(S.h.find(h => h.tokenId === 'my-legend').id)); await p.waitForSelector('.sbw-sell[open]');
    assert.equal(await p.locator('.sbw-sell input').inputValue(), '500000', 'a Legend starts at its 500,000 minimum');
    await p.locator('.sbw-sell input').fill('400000'); await p.locator('.sbw-sell [data-k="go"]').click();
    assert.match(await p.locator('.sbw-sell .sbw-msg').textContent(), /500,000/, 'below the minimum is refused');
    await p.locator('.sbw-sell input').fill('1000000');
    assert.match(await p.locator('.sbw-sell .sbw-sell-out').textContent(), /800,000 Ryo.*reward pool 100,000.*treasury 80,000.*studio 20,000/s);
    await p.locator('.sbw-sell [data-k="go"]').click(); await p.waitForFunction(() => !S.h.some(h => h.tokenId === 'my-legend'));
    // A buyer offers 700,000; the seller accepts and receives 80% of it.
    const listing = f.market.listings.find(l => l.hero.tokenId === 'my-legend');
    f.market.offers.push({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', listingId: listing.id, buyer: OTHER, amount: 700000 });
    const before = f.balance;
    await tab(p, 'mine'); await p.waitForFunction(() => document.querySelector('.sbw-scr.on .mc-top em')?.textContent === '1 OFFER');
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="0"]').click();
    assert.match(await p.locator('.sbw-scr.on .md-offer').textContent(), /700,000 Ryo.*you receive 560,000/s, 'the seller sees the offer and their 80%');
    await p.locator('.sbw-scr.on [data-act="accept"]').click(); await p.waitForSelector('.sbw-mdialog[open]');
    await p.locator('.sbw-mdialog[open] [data-k="go"]').click();
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on .mc-top em')?.textContent === 'SOLD');
    assert.equal(f.balance - before, 560000, 'accepting pays the seller 80% of the offer');
    // Another listing, cancelled from its details.
    await p.evaluate(() => window.Market.openListing(S.h.find(h => h.tokenId === 'my-chunin').id)); await p.waitForSelector('.sbw-sell[open]');
    await p.locator('.sbw-sell [data-k="go"]').click(); await p.waitForFunction(() => !S.h.some(h => h.tokenId === 'my-chunin'));
    await tab(p, 'mine'); await p.waitForFunction(() => document.querySelectorAll('.sbw-scr.on .sbw-mcard').length === 2);
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="0"]').click(); await p.locator('.sbw-scr.on [data-act="cancel"]').click();
    await p.waitForFunction(() => S.h.some(h => h.tokenId === 'my-chunin'));

    // Phone: toolbar, two-column cards and details in one column, no sideways scroll.
    await p.setViewportSize({ width: 390, height: 844 });
    await tab(p, 'heroes');
    await p.waitForFunction(() => document.querySelectorAll('.sbw-scr.on .sbw-mcard').length >= 2 && document.getElementById('sbwLayer').classList.contains('sbw-phone'));
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="1"]').click(); await p.waitForTimeout(300);
    const phone = await p.evaluate(() => { const sec = document.querySelector('.sbw-scr.on'), c = [...sec.querySelectorAll('.sbw-mcard')].map(e => e.getBoundingClientRect()), tabs = [...sec.querySelectorAll('[data-tab]')];
      return { sideways: sec.scrollWidth > sec.clientWidth + 1, twoColumns: Math.abs(c[0].top - c[1].top) < 4 && c[0].width > 150, tabsOneLine: tabs.every(t => t.scrollWidth <= t.clientWidth + 1 && t.getBoundingClientRect().height < 50),
        buttons: [...sec.querySelectorAll('.sbw-mdet .sbw-mbtn')].every(b => b.getBoundingClientRect().height >= 40) }; });
    assert.deepEqual(phone, { sideways: false, twoColumns: true, tabsOneLine: true, buttons: true });
    await p.screenshot({ path: path.join(output, 'market-phone.png'), fullPage: false });
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Market shows only live controls (no Items/Resources/Element or printed placeholders), browse filters/sort/search, offers (held, cancelled, accepted at 80%), buy now, sell with rank minimum and payout, listing cancel, and the phone layout.');
})().catch(error => { console.error(error); process.exitCode = 1; });
