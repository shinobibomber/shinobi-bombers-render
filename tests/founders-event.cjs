/* Events card (Home): the live Founder NFT Box sale. VIEW opens an in-game pop-up with both tiers (server prices and
 * boxes left) and opens the /founders page in a new tab to buy (owner decision 2026-11-10). Isolated fixtures only. */
const { withGame } = require('./harness.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    await p.evaluate(() => go(5)); await p.waitForFunction(() => WebsiteDesign.current() === 'home');
    const card = () => p.locator('.sbw-scr.on .sbw-boxcard').innerText();
    await p.waitForFunction(() => /14 \+ 9 left/.test(document.querySelector('.sbw-scr.on .sbw-boxcard em')?.textContent || ''), null, { timeout: 15000 });
    const text = (await card()).replace(/\s+/g, ' ');
    assert.match(text, /LIMITED EVENT FOUNDER BOXES Mythic 0\.7 · Legacy 0\.25 SOL 14 \+ 9 left VIEW/);
    // The title may run over the space above VIEW (as the old card's did) but stays inside the card; the price line is not cut.
    assert.deepEqual(await p.evaluate(() => { const c = document.querySelector('.sbw-scr.on .sbw-boxcard'), b = c.querySelector('b'), s = c.querySelector('span');
      const scale = c.getBoundingClientRect().width / c.offsetWidth, right = (b.getBoundingClientRect().left - c.getBoundingClientRect().left) / scale + b.scrollWidth;
      return [right <= c.offsetWidth - 2, s.scrollWidth <= s.clientWidth + 1]; }), [true, true], 'the card title and prices fit');
    assert(!/MYTHIC NFT BOX|Tsukiyomi · 10% off|20 \/ 20/.test(text), 'no old Mythic NFT Box offer: ' + text);
    assert.equal(await p.evaluate(() => document.querySelector('.sbw-scr.on .sbw-boxcard img').naturalWidth > 0), true, 'Founder art loads');

    // VIEW: both tiers with live prices and boxes left, the benefits, and the way to buy.
    await p.locator('.sbw-scr.on [data-sbwid="ev"]').click(); await p.waitForSelector('.sbw-fddlg[open]');
    await p.waitForFunction(() => /14 of 33 left/.test(document.querySelector('.sbw-fddlg')?.innerText || ''));
    const pop = (await p.evaluate(() => document.querySelector('.sbw-fddlg').innerText)).replace(/\s+/g, ' ');
    for (const re of [/Founder NFT Boxes/, /Mythic Founder's Box 0\.7 SOL 1 SOL 14 of 33 left/, /Exclusive Mythic Tsukiyomi \+ 1 Legend hero \+ 1 Elite hero/, /Free permanent Sensei/,
      /Legacy Founder's Box 0\.25 SOL 0\.5 SOL 9 of 30 left/, /7-day free Sensei trial/, /One box per wallet across both tiers/, /Buy on the Founders page ↗/])
      assert.match(pop, re);
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.sbw-fddlg .fd-price s')].map(s => s.textContent)), ['1 SOL', '0.5 SOL'], 'regular prices are struck through');
    // The buy button opens /founders in a new tab (the page cannot be embedded) and the game stays open.
    await p.evaluate(() => { window.__opened = []; window.open = (...a) => { __opened.push(a); return null; }; });
    await p.locator('.sbw-fddlg [data-k="go"]').click();
    assert.deepEqual(await p.evaluate(() => __opened), [['/founders', '_blank', 'noopener']]);
    assert.equal(await p.evaluate(() => !!document.querySelector('.sbw-fddlg[open]')), false, 'the pop-up closes; the game stays on Home');

    // Sold out / paused come from the server.
    f.founders = { ...f.founders, tiers: { mythic: { ...f.founders.tiers.mythic, remaining: 0, sold: 33, soldOut: true }, legacy: { ...f.founders.tiers.legacy, remaining: 0, sold: 30, soldOut: true } } };
    await p.locator('.sbw-scr.on [data-sbwid="ev"]').click(); await p.waitForSelector('.sbw-fddlg[open]');
    await p.waitForFunction(() => /SOLD OUT/.test(document.querySelector('.sbw-fddlg')?.innerText || '') && /View the Founders page/.test(document.querySelector('.sbw-fddlg [data-k="go"]')?.textContent || ''));
    await p.locator('.sbw-fddlg [data-k="x"]').click();
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on .sbw-boxcard em')?.textContent === 'SOLD OUT', null, { timeout: 10000 });
    f.founders = { ...f.founders, paused: true };
    await p.locator('.sbw-scr.on [data-sbwid="ev"]').click(); await p.waitForSelector('.sbw-fddlg[open]');
    await p.waitForFunction(() => /paused/.test(document.querySelector('.sbw-fddlg')?.innerText || ''));
    await p.locator('.sbw-fddlg [data-k="x"]').click();

    // Phone: the card stays in the Events panel and the pop-up fits without horizontal scrolling.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForFunction(() => document.getElementById('sbwLayer').classList.contains('sbw-phone'));
    await p.locator('.sbw-scr.on [data-sbwid="ev"]').click(); await p.waitForSelector('.sbw-fddlg[open]');
    const fits = await p.evaluate(() => { const d = document.querySelector('.sbw-fddlg'); return d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth; });
    assert.equal(fits, true, 'the Founder pop-up fits a phone');
    await p.locator('.sbw-fddlg [data-k="x"]').click();
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Events card shows the live Founder NFT Box sale; VIEW shows both tiers (server prices, boxes left, benefits, sold out, paused) and opens /founders in a new tab; phone fits.');
})().catch(error => { console.error(error); process.exitCode = 1; });
