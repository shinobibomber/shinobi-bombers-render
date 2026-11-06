/* Fusion list visibility, the 500-hero collection limit and the header/content seam. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');

const login = async p => {
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
};
const hero = (i, rank, level) => ({ tokenId: 'fx-' + i, rank, level, name: 'Test ' + i, baseStats: { pw: 10 + i % 5, sp: 10, st: 10 } });
const eliteRows = p => p.evaluate(() => [...document.querySelectorAll('.sbw-frow')].map(r => ({ locked: r.classList.contains('locked'), disabled: r.disabled, info: r.querySelector('small').textContent })));

(async () => {
  // Every Reserve Elite is listed; below level 5 (the max) they are locked and explained.
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    f.profile = economy.normalizeProfile({ ...f.profile, battleReady: [], heroes: [...Array.from({ length: 5 }, (_, i) => hero(i, 3, 1 + i % 4)), ...Array.from({ length: 4 }, (_, i) => hero(20 + i, 0, 1))] });
    await login(p);
    await p.evaluate(() => { go(6); FusionUI.tab(3); });
    await p.waitForFunction(() => document.querySelectorAll('.sbw-frow').length === 5);
    const rows = await eliteRows(p);
    assert(rows.every(r => r.locked && r.disabled && /Lv 5 needed/.test(r.info)), 'Elites below level 5 are listed but locked');
    assert.match(await p.locator('.sbw-fnote').textContent(), /needs three level 5 Elites \(0 ready\)/, 'the list explains why nothing can be picked');
    assert.equal(await p.locator('.sbw-fempty').count(), 0, 'the list is never shown as empty while Elites exist');
    await p.evaluate(() => FusionUI.weakest());
    assert.equal(await p.locator('#p6 .fusion-table input:checked').count(), 0, 'Select Weakest never picks a locked Elite');
    assert.deepEqual(errors, []);
  });

  // With level 5 Elites present they come first and are selectable; a full collection cannot summon.
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    const heroes = [...Array.from({ length: 2 }, (_, i) => hero(i, 3, 3)), ...Array.from({ length: 3 }, (_, i) => hero(10 + i, 3, 5)), ...Array.from({ length: 495 }, (_, i) => hero(100 + i, 0, 1))];
    f.profile = economy.normalizeProfile({ ...f.profile, battleReady: [], heroes });
    await login(p);
    assert.equal(await p.evaluate(() => S.h.filter(h => h.tokenOwner === RyoPayments.state.account).length), 500);
    await p.evaluate(() => { go(6); FusionUI.tab(3); });
    await p.waitForFunction(() => document.querySelectorAll('.sbw-frow').length === 5);
    const rows = await eliteRows(p);
    assert.deepEqual(rows.map(r => r.locked), [false, false, false, true, true], 'eligible Elites are listed first');
    assert.equal(await p.locator('.sbw-fnote').count(), 0, 'no warning once three level 5 Elites are ready');
    await p.evaluate(() => FusionUI.weakest());
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#p6 .fusion-table input:checked')].map(i => i.closest('tr').querySelector('small').textContent)), Array(3).fill('Elite · Lv 5 · Reserve'));
    await p.evaluate(() => { V2.clearFusion(); go(2); Combat.quantity(1); Combat.summonBatch(); });
    await p.waitForFunction(() => /holds 500 of 500 heroes/.test(document.getElementById('toast')?.textContent || ''));
    assert.equal(await p.locator('#tokenCheckoutDialog[open]').count(), 0, 'a full collection never reaches checkout');
    assert.equal(f.purchases.length, 0, 'no purchase is created at the hero limit');

    // The shared header leaves no empty strip: content starts where the header art's left part ends.
    for (const [width, height] of [[1366, 768], [1019, 700], [1440, 1000]]) {
      await p.setViewportSize({ width, height }); await p.evaluate(() => go(5)); await p.waitForTimeout(200);
      const seam = await p.evaluate(() => {
        const header = document.querySelector('.sbw-hdr'), art = header.querySelector('.sbw-hdr-img').getBoundingClientRect(), clip = document.querySelector('.sbw-scr.on').style.clipPath;
        return { artLeftBottom: art.top + art.height * 100 / 124, contentTop: parseFloat(/inset\(([\d.]+)px/.exec(clip)[1]), background: getComputedStyle(header).backgroundColor };
      });
      assert(Math.abs(seam.artLeftBottom - seam.contentTop) < 0.5, `content meets the header art at ${width}x${height}`);
      assert.equal(seam.background, 'rgba(0, 0, 0, 0)', 'the header paints no black strip of its own');
    }
    assert.deepEqual(errors, []);
  });
  console.log('PASS: locked sub-level-5 Elites listed and explained, eligible Elites first, 500-hero summon limit, and no header/content strip.');
})().catch(error => { console.error(error); process.exitCode = 1; });
