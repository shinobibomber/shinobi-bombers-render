/* Summoning Shrine Legend pity in the real game page (owner request 2026-11-11): the Shrine shows "LEGEND PITY  N / 150 Summons"
 * with a bar and the summons left from the server profile, "NEXT SUMMON GUARANTEED LEGEND!" at 149, the reveal tags a guaranteed
 * Legend "Pity Guarantee!" (a natural Legend has no tag), and Summon History shows the pity after a batch. Isolated fixture. */
const path = require('node:path'), { withGame } = require('./harness.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    f.profile.shrineLegendPity = 95;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    await p.evaluate(() => go(2)); await p.waitForFunction(() => WebsiteDesign.current() === 'summon');
    await p.waitForFunction(() => /95 \/ 150/.test(document.querySelector('.sbw-scr.on .sbw-pity')?.textContent || ''));
    const panel = await p.locator('.sbw-scr.on .sbw-pity').innerText();
    assert.match(panel, /LEGEND PITY[\s\S]*95 \/ 150[\s\S]*55 summons to a guaranteed Legend/);
    // Fully visible inside the Legend banner (above its View details button), not hidden or clipped.
    const box = await p.locator('.sbw-scr.on .sbw-pity').evaluate(e => { const r = e.getBoundingClientRect(), v = document.querySelector('.sbw-scr.on .hs[data-sbwid="lg-view"]')?.getBoundingClientRect(), em = e.querySelector('em').getBoundingClientRect(); return { inside: em.bottom <= r.bottom + 0.5, aboveButton: !v || r.bottom <= v.top + 2, visible: r.width > 100 && r.height > 40 && getComputedStyle(e).position === 'absolute' }; });
    assert.deepEqual(box, { inside: true, aboveButton: true, visible: true }, 'the pity panel is fully visible above View details');
    assert.equal((await p.locator('.sbw-scr.on .sbw-pity s').evaluate(e => e.style.width)), '63.3%');
    await p.screenshot({ path: path.join(root, 'tests/out/shrine-pity.png') });
    // 149: the next summon is guaranteed.
    f.profile.shrineLegendPity = 149; await p.evaluate(() => RyoPayments.refresh());
    await p.waitForFunction(() => /NEXT SUMMON GUARANTEED LEGEND!/.test(document.querySelector('.sbw-scr.on .sbw-pity')?.textContent || ''));
    assert.equal(await p.locator('.sbw-scr.on .sbw-pity.ready').count(), 1);
    // Reveal: a guaranteed Legend carries the tag, a natural one does not.
    await p.evaluate(() => {
      const base = S.h.find(h => h.tokenId) || S.h[0];
      const guaranteed = { ...JSON.parse(JSON.stringify(base)), id: 9001, r: 4, name: 'Pity Legend', shrinePity: 'guaranteed' };
      const natural = { ...JSON.parse(JSON.stringify(base)), id: 9002, r: 4, name: 'Natural Legend' };
      Experience.presentReward([guaranteed, natural]);
      S.v2.revealSource = 'summon';   // as a Shrine purchase result (presentReward marks a reward reveal)
    });
    await p.waitForFunction(() => S.v2.revealBatch?.length === 2 && document.querySelector('#revealContinue'));
    await p.evaluate(() => { Experience.revealAll(); RevealDesign.skip(); });
    await p.waitForFunction(() => S.v2.revealBatch.every(i => i.revealed));
    const tags = await p.evaluate(() => [...document.querySelectorAll('.reveal-card')].map(c => ({ name: c.querySelector('.cinematic-name')?.textContent, tag: !c.querySelector('.cinematic-pity')?.hidden })));
    assert.deepEqual(tags.map(t => [t.name, t.tag]), [['Pity Legend', true], ['Natural Legend', false]], 'only the guaranteed Legend is tagged');
    await p.screenshot({ path: path.join(root, 'tests/out/shrine-pity-reveal.png') });
    await p.waitForFunction(() => !document.querySelector('#revealContinue')?.disabled);
    await p.locator('#revealContinue').click();
    // The same flagged hero outside a Shrine reveal (reward / received elsewhere) never shows the tag.
    await p.waitForFunction(() => !S.v2.revealBatch?.length);
    await p.evaluate(() => { const base = S.h.find(h => h.tokenId) || S.h[0]; Experience.presentReward([{ ...JSON.parse(JSON.stringify(base)), id: 9003, r: 4, name: 'Received Legend', shrinePity: 'guaranteed' }]); });
    await p.waitForFunction(() => S.v2.revealBatch?.length === 1 && document.querySelector('#revealContinue'));
    await p.evaluate(() => { Experience.revealAll(); RevealDesign.skip(); });
    await p.waitForFunction(() => S.v2.revealBatch.every(i => i.revealed));
    assert.equal(await p.evaluate(() => [...document.querySelectorAll('.reveal-card .cinematic-pity')].some(t => !t.hidden)), false, 'no tag outside a Shrine reveal');
    await p.waitForFunction(() => !document.querySelector('#revealContinue')?.disabled);
    await p.locator('#revealContinue').click();
    // Starter Ryo (spent first, never counts): the panel names paid summons instead of over-promising.
    f.bonus = 100000; await p.evaluate(() => RyoPayments.refresh());
    await p.evaluate(() => go(2));
    await p.waitForFunction(() => WebsiteDesign.current() === 'summon' && /NEXT PAID SUMMON GUARANTEED LEGEND! Starter Ryo doesn't count/.test(document.querySelector('.sbw-scr.on .sbw-pity')?.textContent || ''));
    const em = await p.locator('.sbw-scr.on .sbw-pity').evaluate(e => { const r = e.getBoundingClientRect(), m = e.querySelector('em').getBoundingClientRect(); const em = e.querySelector('em'); return m.top >= r.top - 0.5 && m.bottom <= r.bottom + 0.5 && m.right <= r.right + 0.5 && em.scrollWidth <= em.clientWidth + 1 && em.scrollHeight <= em.clientHeight + 1; });
    assert.equal(em, true, 'the starter note fits inside the panel, not cut off');
    await p.locator('.sbw-scr.on .sbw-pity').screenshot({ path: path.join(root, 'tests/out/shrine-pity-starter.png') });
    f.bonus = 0; await p.evaluate(() => RyoPayments.refresh());
    // Summon History shows the guarantee and the pity after the batch.
    const hero = { tokenId: 'pity-history-hero', rank: 4, name: 'History Legend', shrinePity: 'guaranteed', baseStats: { pw: 13, sp: 13, st: 13 } };
    f.purchases.unshift({ request_id: 'pity-history-0001', product: 'summon', amount: '25000', status: 'confirmed', acknowledged: true, created: String(Date.now()), signature: 'S'.repeat(80), quote: { product: 'summon', params: { quantity: 1 } }, result: { product: 'summon', outputs: [hero], pity: { before: 149, after: 0, guaranteed: [0], legends: [0], threshold: 150 } } });
    await p.evaluate(() => RyoPayments.refresh());
    await p.evaluate(() => go(2)); await p.waitForFunction(() => WebsiteDesign.current() === 'summon');
    await p.locator('.sbw-scr.on .hs[data-sbwid="sb-hist"]').click();
    await p.waitForFunction(() => /Pity guarantee/.test(document.querySelector('dialog.sbw-history[open]')?.textContent || ''), null, { timeout: 15000 });
    assert.match(await p.locator('dialog.sbw-history').innerText(), /Legend pity after: 0 \/ 150[\s\S]*History Legend[\s\S]*Pity guarantee/);
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Shrine Legend pity UI — Shrine panel N / 150 with bar and summons left, "NEXT SUMMON GUARANTEED LEGEND!" at 149, reveal tag only on a guaranteed Legend, Summon History shows the guarantee and pity after.');
})().catch(e => { console.error(e); process.exitCode = 1; });
