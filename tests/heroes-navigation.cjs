/* Regression: Adventure's presentation metadata must never join native hero-canvas selectors. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    // A real fixture fulfillment supplies enough heroes to exercise the next page.
    f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity: 15 })).profile;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    const initial = await p.evaluate(() => ({
      ids: S.h.map(hero => [hero.id, hero.tokenId, hero.tokenOwner]),
      balance: RyoPayments.state.balance
    }));
    const adventure = p.locator('.sbw-hdr [data-sbwid="nav-adventure"]');
    const heroes = p.locator('.sbw-hdr [data-sbwid="nav-heroes"]');
    await adventure.click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'adventure');
    await p.locator('.sbw-scr.on [data-a="work"]').click();
    await p.waitForFunction(() => S.h.some(hero => hero.on));
    await p.waitForFunction(() => document.querySelectorAll('.sbw-at-card:not(.empty)').length > 0);
    const roster = await p.locator('.sbw-at-card:not(.empty)').evaluateAll(cards => cards.map(card => {
      const slot = Number(card.dataset.i);
      const native = document.querySelectorAll('#p0 article.map-hero')[slot];
      const hero = S.h.find(item => item.id === Number(native.dataset.maphero));
      return { actual: card.querySelector('strong').textContent, expected: hero.name.split(' ')[0], id: Number(card.dataset.sbwHero), expectedId: hero.id };
    }));
    for (const card of roster) {
      assert.equal(card.actual, card.expected, 'Adventure label resolves the native roster hero ID');
      assert.equal(card.id, card.expectedId, 'presentation metadata stores the matching persistent hero ID');
    }
    assert.equal(await p.locator('#sbwLayer [data-hero]').count(), 0, 'overlay metadata stays outside native hero-canvas selectors');
    await heroes.focus();
    await p.keyboard.press('Enter');
    await p.waitForTimeout(200);
    assert.deepEqual(errors, [], 'Adventure → Heroes must not throw in the native hero renderer');
    assert.equal(await p.evaluate(() => WebsiteDesign.current()), 'heroes');
    assert(await p.locator('.sbw-hcard').count() > 0, 'Heroes renders the actual collection');
    const next = p.locator('.sbw-scr.on [data-sbwid="pn"]');
    const previous = p.locator('.sbw-scr.on [data-sbwid="pp"]');
    const pageValue = () => p.locator('#p1 .heroes-page-select').inputValue();
    const visibleHeroes = () => p.locator('.sbw-hcard .sbw-hc-name').allTextContents();
    const firstPage = await visibleHeroes();
    assert.equal(await pageValue(), '0');
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on [data-sbwid="pp"]').getAttribute('aria-disabled') === 'true');
    await previous.focus();
    await p.keyboard.press('Enter');
    assert.equal(await pageValue(), '0', 'previous is harmless at the first page');
    await next.click();
    await p.waitForFunction(() => document.querySelector('#p1 .heroes-page-select').value === '1');
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on [role="status"]').textContent === '2 / 2');
    assert.notDeepEqual(await visibleHeroes(), firstPage, 'next displays the second collection page');
    assert.equal(await p.locator('dialog[open]').count(), 0, 'pager must not open a hero detail/perk dialog');
    assert.equal(await p.evaluate(() => WebsiteDesign.current()), 'heroes');
    assert.equal(await next.getAttribute('aria-disabled'), 'true', 'last-page state mirrors the native pager');
    await next.focus();
    await p.keyboard.press('Enter');
    assert.equal(await pageValue(), '1', 'next is harmless at the last page');
    await previous.focus();
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('#p1 .heroes-page-select').value === '0');
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on [role="status"]').textContent === '1 / 2');
    assert.deepEqual(await visibleHeroes(), firstPage, 'keyboard previous returns to the original collection page');
    assert.equal(await p.locator('dialog[open]').count(), 0);
    for (let attempt = 0; attempt < 3; attempt++) {
      await adventure.click();
      await p.waitForFunction(() => WebsiteDesign.current() === 'adventure');
      await p.locator('.sbw-scr.on [data-a="manage"]').click();
      await p.waitForFunction(() => WebsiteDesign.current() === 'heroes');
      await p.waitForFunction(() => document.querySelectorAll('.sbw-hcard').length > 0);
    }
    assert.deepEqual(errors, [], 'repeated header and Manage heroes navigation stays error-free');
    const after = await p.evaluate(() => ({
      ids: S.h.map(hero => [hero.id, hero.tokenId, hero.tokenOwner]),
      balance: RyoPayments.state.balance
    }));
    assert.deepEqual(after, initial, 'menu navigation preserves inventory and balance');
  });
  console.log('PASS: Adventure → Heroes and collection paging use native controls without renderer crashes, unwanted details, or collection changes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
