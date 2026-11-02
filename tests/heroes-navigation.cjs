/* Regression: Adventure's presentation metadata must never join native hero-canvas selectors. */
const { withGame } = require('./harness.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
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
  console.log('PASS: populated Adventure → Heroes navigation uses native controls without a renderer crash or collection changes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
