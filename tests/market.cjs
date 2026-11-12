/* Player Market in the browser: clean live controls (no printed placeholders, no Items/Resources/
 * Element), Jonin/Elite/Legend only (rank filter, no Genin/Chunin listings), BUY NOW and MAKE OFFER on
 * every For Sale card with its minimum offer, browse with rank and skills filters, sort and search, the
 * Make Offer popup (asking price, minimum, available balance; refused below the minimum), offer held
 * then cancelled, buy with confirmation, sell from Heroes (new minimums, 80% payout; Genin and
 * account-bound heroes refused), receive and accept an offer, the NEW OFFER RECEIVED notice, cancel a
 * listing, History (sold and bought), and the phone layout. Isolated fixtures only. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
const output = path.join(__dirname, 'out'); fs.mkdirSync(output, { recursive: true });

const OTHER = 'OtHeRsElLeR' + '9'.repeat(33), MIN = { 2: 150000, 3: 400000, 4: 1000000 };
const hero = (id, rank, name, extra = {}) => ({ tokenId: id, rank, level: 1, name, baseStats: { pw: 2 + rank * 3, sp: 2 + rank * 3, st: 2 + rank * 3 }, ...extra });
// 12 tradable listings (Jonin/Elite/Legend, priced above their minimum) and two old Genin/Chunin rows that must not show.
const seed = () => [...Array.from({ length: 12 }, (_, i) => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(i).padStart(12, '0'), seller: OTHER, price: MIN[2 + i % 3] * (2 + (i % 4)),
  hero: hero('mk-' + i, 2 + i % 3, ['Kai', 'Ren', 'Aki', 'Yuki', 'Sora', 'Nao'][i % 6] + ' of Leaf ' + i) })),
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000098', seller: OTHER, price: 20000, hero: hero('mk-genin', 0, 'Old Genin') },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099', seller: OTHER, price: 30000, hero: hero('mk-chunin', 1, 'Old Chunin') }];
const cards = p => p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on .sbw-mcard')].map(c => ({ name: c.querySelector('.mc-name').textContent, rank: c.querySelector('.mc-top b').textContent, tag: c.querySelector('.mc-top em').textContent, price: +c.querySelector('.mc-price').childNodes[1].textContent.replace(/\D/g, ''), min: c.querySelector('.mc-min')?.textContent || '', acts: [...c.querySelectorAll('[data-cact]')].map(b => b.textContent) })));
const count = (p, n) => p.waitForFunction(n => document.querySelectorAll('.sbw-scr.on .sbw-mcard').length === n, n);
const tab = async (p, t) => { await p.locator(`.sbw-scr.on .sbw-mbar [data-tab="${t}"]`).click(); };
const openNotice = async p => { await p.waitForSelector('.sbw-dialog[open]'); const t = await p.locator('.sbw-dialog[open]').textContent(); await p.locator('.sbw-dialog[open] .sbw-btn').last().click(); return t; };

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.balance = 50000000; f.market = { listings: seed() };
    const mine = [hero('my-genin', 0, 'Seller Genin'), hero('my-legend', 4, 'Seller Legend'), hero('my-jonin', 2, 'Seller Jonin'), hero('my-founder', 3, 'Founder Elite', { founderGrant: 'gold' }), hero('my-extra', 0, 'Spare Genin')];
    f.profile = economy.normalizeProfile({ ...f.profile, heroes: mine, battleReady: mine.map(h => h.tokenId) });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && WebsiteDesign.current() === 'home');
    await p.evaluate(() => go(4, 1)); await p.waitForFunction(() => WebsiteDesign.current() === 'market'); await count(p, 10);

    // Clean controls: no printed tabs, filters, cards or buttons show; no Items/Resources/Element.
    const clean = await p.evaluate(() => { const sec = document.querySelector('.sbw-scr.on'), panel = sec.querySelector('.sbw-mpanel').getBoundingClientRect();
      const visibleArt = [...sec.querySelectorAll('.hs:not([hidden])')].filter(e => { const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return x > panel.left && x < panel.right && y > panel.top && y < panel.bottom; }).length;
      return { visibleArt, text: sec.innerText, tabs: [...sec.querySelectorAll('[data-tab]')].map(t => t.textContent), ranks: [...sec.querySelectorAll('[data-rank]')].map(t => t.textContent) }; });
    assert.equal(clean.visibleArt, 0, 'no printed controls show through the listings panel');
    assert(!/ITEMS|RESOURCES|Element/i.test(clean.text), 'Items, Resources and Element are gone');
    assert.deepEqual(clean.tabs, ['For Sale', 'My Listings', 'My Offers', 'History']);
    assert.deepEqual(clean.ranks, ['All', 'Jonin', 'Elite', 'Legend'], 'only tradable ranks can be filtered');
    const fit = await p.evaluate(() => { const g = document.querySelector('.sbw-scr.on .sbw-mgrid').getBoundingClientRect(); return [...document.querySelectorAll('.sbw-scr.on .sbw-mcard')].every(c => { const r = c.getBoundingClientRect(), n = c.querySelector('.mc-name'), a = c.querySelector('.mc-acts')?.getBoundingClientRect(); return r.right <= g.right + 1 && r.bottom <= g.bottom + 1 && n.scrollHeight <= n.clientHeight + 1 && (!a || a.bottom <= r.bottom + 1); }); });
    assert(fit, 'every card, name and card button fits');
    let list = await cards(p);
    assert(list.every(c => ['JONIN', 'ELITE', 'LEGEND'].includes(c.rank)), 'Genin and Chunin listings never show');
    assert(list.every(c => c.acts.join('|') === 'BUY NOW|💰 OFFER' && /^Min offer [\d,]+$/.test(c.min)), 'every For Sale card has BUY NOW, MAKE OFFER and its minimum offer');
    assert.deepEqual(list.map(c => c.price), [...list.map(c => c.price)].sort((a, b) => a - b), 'cheapest first');
    // Rank, skills (has all chosen), sort, search, reset.
    await p.locator('.sbw-scr.on [data-rank="4"]').click(); await count(p, 4);
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

    // MAKE OFFER from the card: the popup shows the asking price, minimum and balance; below the minimum is refused.
    const target = (await cards(p))[2];
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="2"] [data-cact="offer"]').click(); await p.waitForSelector('.sbw-offer[open]');
    const facts = (await p.locator('.sbw-offer .sbw-offer-facts').textContent()).replace(/\s+/g, ' ');
    const rankMin = MIN[{ JONIN: 2, ELITE: 3, LEGEND: 4 }[target.rank]];
    assert.match(facts, new RegExp('Seller asking price' + target.price.toLocaleString('en-US') + ' Ryo.*Minimum allowed offer' + rankMin.toLocaleString('en-US') + ' Ryo.*Your available game balance50,000,000 Ryo'), 'the offer popup facts');
    assert.equal(await p.locator('.sbw-offer [data-k="go"]').textContent(), 'Submit offer');
    await p.locator('.sbw-offer input').fill(String(rankMin - 1)); await p.locator('.sbw-offer [data-k="go"]').click();
    assert.match(await p.locator('.sbw-offer .sbw-msg').textContent(), /Offer from/, 'an offer below the rank minimum is refused');
    await p.locator('.sbw-offer input').fill(String(target.price)); await p.locator('.sbw-offer [data-k="go"]').click();
    assert.match(await p.locator('.sbw-offer .sbw-msg').textContent(), /Offer from/, 'an offer at the asking price is refused (use Buy now)');
    const amount = Math.floor(target.price * 0.8);
    await p.locator('.sbw-offer input').fill(String(amount)); await p.locator('.sbw-offer [data-k="go"]').click();
    await p.waitForFunction(() => [...document.querySelectorAll('.sbw-scr.on .mc-top em')].some(e => e.textContent === 'OFFER SENT'));
    assert.equal(f.balance, 50000000 - amount, 'the offer is held from the balance');
    await tab(p, 'offers'); await p.waitForFunction(() => document.querySelector('.sbw-scr.on .mc-top em')?.textContent === 'WAITING');
    assert.match(await p.locator('.sbw-scr.on .sbw-mheld').textContent(), /held in offers/);
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="0"]').click(); await p.locator('.sbw-scr.on [data-act="cancel-offer"]').click();
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on .mc-top em')?.textContent === 'CANCELLED');
    assert.equal(f.balance, 50000000, 'cancelling returns the held Ryo');

    // BUY NOW with the confirmation; the hero joins the collection.
    await tab(p, 'heroes'); await count(p, 10);
    const buy = (await cards(p))[0];
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="0"] [data-cact="buy"]').click(); await p.waitForSelector('.sbw-mdialog[open] [data-k="go"]');
    assert.match(await p.locator('.sbw-mdialog[open]').textContent(), new RegExp(buy.price.toLocaleString('en-US') + ' Ryo'));
    await p.locator('.sbw-mdialog[open] [data-k="go"]').click();
    await p.waitForFunction(name => S.h.some(h => h.name === name), buy.name);
    assert.equal(f.balance, 50000000 - buy.price, 'the buyer pays the listed price');

    // Sell from Heroes: Genin and account-bound heroes are refused; the Legend minimum is 1,000,000; 80/10/8/2 payout.
    await p.evaluate(() => window.Market.openListing(S.h.find(h => h.tokenId === 'my-genin').id));
    assert.match(await openNotice(p), /Only Jonin, Elite and Legend/, 'a Genin cannot be listed');
    await p.evaluate(() => window.Market.openListing(S.h.find(h => h.tokenId === 'my-founder').id));
    assert.match(await openNotice(p), /Account-bound hero.*cannot be listed/s, 'a Founder bonus hero cannot be listed');
    await p.evaluate(() => window.Market.openListing(S.h.find(h => h.tokenId === 'my-legend').id)); await p.waitForSelector('.sbw-sell[open]');
    assert.equal(await p.locator('.sbw-sell input').inputValue(), '1000000', 'a Legend starts at its 1,000,000 minimum');
    await p.locator('.sbw-sell input').fill('800000'); await p.locator('.sbw-sell [data-k="go"]').click();
    assert.match(await p.locator('.sbw-sell .sbw-msg').textContent(), /1,000,000/, 'below the minimum is refused');
    await p.locator('.sbw-sell input').fill('2000000');
    assert.match(await p.locator('.sbw-sell .sbw-sell-out').textContent(), /1,600,000 Ryo \(80%\) · reward pool 400,000 \(20%\)/);
    await p.locator('.sbw-sell [data-k="go"]').click(); await p.waitForFunction(() => !S.h.some(h => h.tokenId === 'my-legend'));
    // A buyer offers 1,500,000; the seller accepts and receives 80% of it.
    const listing = f.market.listings.find(l => l.hero.tokenId === 'my-legend');
    f.market.offers.push({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', listingId: listing.id, buyer: OTHER, amount: 1500000 });
    const before = f.balance;
    await tab(p, 'mine'); await p.waitForFunction(() => document.querySelector('.sbw-scr.on .mc-top em')?.textContent === '1 OFFER');
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="0"]').click();
    assert.match(await p.locator('.sbw-scr.on .md-offer').textContent(), /1,500,000 Ryo.*WAITING.*you receive 1,200,000/s, 'the seller sees the offer, its status and their 80%');
    await p.locator('.sbw-scr.on [data-act="accept"]').click(); await p.waitForSelector('.sbw-mdialog[open]');
    await p.locator('.sbw-mdialog[open] [data-k="go"]').click();
    await p.waitForFunction(() => !document.querySelector('.sbw-mdialog[open]'));
    assert.equal(f.balance - before, 1200000, 'accepting pays the seller 80% of the offer');
    // A Jonin listed at its 150,000 default; a new offer arrives and the seller is notified; then the listing is cancelled.
    await p.evaluate(() => window.Market.openListing(S.h.find(h => h.tokenId === 'my-jonin').id)); await p.waitForSelector('.sbw-sell[open]');
    assert.equal(await p.locator('.sbw-sell input').inputValue(), '150000', 'a Jonin starts at its 150,000 minimum');
    await p.locator('.sbw-sell input').fill('300000');
    await p.locator('.sbw-sell [data-k="go"]').click(); await p.waitForFunction(() => !S.h.some(h => h.tokenId === 'my-jonin'));
    const jonin = f.market.listings.find(l => l.hero.tokenId === 'my-jonin');
    await p.evaluate(() => window.ShinobiMarket.notices()); await p.waitForTimeout(300);   // baseline
    f.market.offers.push({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', listingId: jonin.id, buyer: OTHER, amount: 200000, created: Date.now() + 1000 });
    await p.evaluate(() => window.ShinobiMarket.notices());
    assert.match(await openNotice(p), /NEW OFFER RECEIVED!.*A player has offered 200,000 Ryo for your Seller Jonin/s, 'the seller is notified of a new offer');
    await tab(p, 'mine'); await p.waitForFunction(() => document.querySelectorAll('.sbw-scr.on .sbw-mcard').length === 1);
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="0"]').click(); await p.locator('.sbw-scr.on [data-act="cancel"]').click();
    await p.waitForFunction(() => S.h.some(h => h.tokenId === 'my-jonin'));
    // History: the sale and the purchase.
    await tab(p, 'history'); await p.waitForFunction(() => document.querySelectorAll('.sbw-scr.on .sbw-mcard').length === 2);
    assert.deepEqual((await cards(p)).map(c => c.tag).sort(), ['BOUGHT', 'SOLD'], 'History shows the sale and the purchase');

    // Phone: toolbar, two-column cards with usable buttons and details in one column, no sideways scroll.
    await p.setViewportSize({ width: 390, height: 844 });
    await tab(p, 'heroes');
    await p.waitForFunction(() => document.querySelectorAll('.sbw-scr.on .sbw-mcard').length >= 2 && document.getElementById('sbwLayer').classList.contains('sbw-phone'));
    await p.locator('.sbw-scr.on .sbw-mcard[data-i="1"] .mc-name').click(); await p.waitForTimeout(300);
    const phone = await p.evaluate(() => { const sec = document.querySelector('.sbw-scr.on'), c = [...sec.querySelectorAll('.sbw-mcard')].map(e => e.getBoundingClientRect()), tabs = [...sec.querySelectorAll('[data-tab]')];
      return { sideways: sec.scrollWidth > sec.clientWidth + 1, twoColumns: Math.abs(c[0].top - c[1].top) < 4 && c[0].width > 150, tabsOneLine: tabs.every(t => t.scrollWidth <= t.clientWidth + 1 && t.getBoundingClientRect().height < 50),
        buttons: [...sec.querySelectorAll('.sbw-mdet .sbw-mbtn')].every(b => b.getBoundingClientRect().height >= 40),
        cardButtons: [...sec.querySelectorAll('.sbw-mcard .mc-btn')].every(b => { const r = b.getBoundingClientRect(); return r.height >= 30 && b.scrollWidth <= b.clientWidth + 1; }) }; });
    assert.deepEqual(phone, { sideways: false, twoColumns: true, tabsOneLine: true, buttons: true, cardButtons: true });
    await p.screenshot({ path: path.join(output, 'market-phone.png'), fullPage: false });
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Market shows only live controls, Jonin/Elite/Legend only (no Genin/Chunin listings or filters), BUY NOW and MAKE OFFER with the minimum offer on every card, browse filters/sort/search, the offer popup (asking price, minimum, balance; below minimum and at price refused), offers held and cancelled, buy now, sell with the new minimums and payout (Genin and Founder bonus heroes refused), accept at 80%, the NEW OFFER RECEIVED notice, listing cancel, History, and the phone layout.');
})().catch(error => { console.error(error); process.exitCode = 1; });
