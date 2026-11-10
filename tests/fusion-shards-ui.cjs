/* Fusion Shards in the real game page (owner request 2026-11-11): the Fusion screen panel (success rate, Fusion Shards per
 * attempt, Fill to 100%, balances, Craft), the crafting dialog (Craft Max with confirmation, balances from the server), the
 * checkout note, and a fusion purchase at a guaranteed 100% that consumes the Fusion Shards. Desktop + phone. Isolated fixture. */
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto'), { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
const root = path.resolve(__dirname, '..');
const genin = n => Array.from({ length: n }, () => ({ ...economy.hero(0), tokenId: crypto.randomUUID() }));
const panel = p => p.locator('.sbw-scr.on .sbw-fshards');
const open = async p => {
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.FusionShards);
  await p.evaluate(() => go(6)); await p.waitForFunction(() => WebsiteDesign.current() === 'fusion');
  await p.waitForFunction(() => { const e = document.querySelector('.sbw-scr.on .sbw-fshards'); return e && !e.hidden; });
};
(async () => {
  /* ---------- Desktop: craft, fill to 100%, checkout, purchase ---------- */
  await withGame(async ({ p, f, errors }) => {
    f.holdAdventure = false;
    f.profile.upgradeShards = 9; f.profile.fusionShards = 1; f.profile.battleReady = f.profile.heroes.map(h => h.tokenId); f.profile.heroes.push(...genin(3));
    await open(p);
    const text = async () => (await panel(p).innerText()).replace(/\s+/g, ' ');
    assert.match(await text(), /SUCCESS 90%.*0 \/ 2.*FILL 100%.*◆ 1 Fusion · 9 Upgrade Shards.*\+5% per Fusion Shard.*CRAFT/);
    // The panel sits fully inside the Fuse panel, above the price row, and the old note text is hidden.
    const box = await panel(p).evaluate(e => { const r = e.getBoundingClientRect(), now = document.querySelector('.sbw-scr.on .hs[data-sbwid="fuse"], .sbw-scr.on .hs[data-sbwid*="fuse"]')?.getBoundingClientRect(); return { w: r.width > 400, h: r.height > 50, inView: r.bottom <= innerHeight && r.right <= innerWidth, rows: [...e.querySelectorAll('.sbw-fs-row')].every(x => x.scrollWidth <= x.clientWidth + 1), noteHidden: [...document.querySelectorAll('.sbw-scr.on .sbw-cover')].filter(c => /resulting hero will be/.test(c.textContent)).every(c => c.hidden) }; });
    assert.deepEqual(box, { w: true, h: true, inView: true, rows: true, noteHidden: true }, 'panel layout');
    // Craft Max: confirmation first, then the server balances.
    await panel(p).locator('[data-fs="craft"]').click();
    const dlg = p.locator('dialog.fusion-craft[open]'); await dlg.waitFor();
    assert.match((await dlg.innerText()).replace(/\s+/g, ' '), /Upgrade Shards 9 Fusion Shards 1/);
    await dlg.locator('[data-a="max"]').click();
    assert.match(await dlg.locator('[data-k="msg"]').innerText(), /Convert 8 Upgrade Shards into 4 Fusion Shards\? This is permanent/);
    assert.equal(f.profile.fusionShards, 1, 'nothing crafted before Confirm');
    await dlg.locator('[data-a="yes"]').click();
    await p.waitForFunction(() => /Crafted 4 Fusion Shards\. You now have 5\./.test(document.querySelector('dialog.fusion-craft [data-k="msg"]')?.textContent || ''));
    assert.deepEqual([f.profile.upgradeShards, f.profile.fusionShards], [1, 5], 'server balances after crafting');
    assert.match((await dlg.innerText()).replace(/\s+/g, ' '), /Upgrade Shards 1 Fusion Shards 5/);
    assert.equal(await dlg.locator('[data-a="max"]').isDisabled(), true, 'Craft Max disabled with 1 Upgrade Shard');
    await p.screenshot({ path: path.join(root, 'tests/out/fusion-shards-craft.png') });
    await dlg.locator('[data-a="close"]').click();
    // Fill to 100%.
    await panel(p).locator('[data-fs="fill"]').click();
    await p.waitForFunction(() => /90% → 100%/.test(document.querySelector('.sbw-scr.on .sbw-fshards')?.textContent || ''));
    assert.match(await text(), /2 \/ 2.*◆ 5 Fusion · 1 Upgrade Shards.*100% GUARANTEED SUCCESS/);
    assert.equal(await p.locator('.sbw-scr.on .sbw-fshards.full').count(), 1);
    assert.equal(await panel(p).locator('[data-fs="+"]').isDisabled(), true, 'cannot go past 100%');
    await p.screenshot({ path: path.join(root, 'tests/out/fusion-shards.png') });
    // Checkout at 100%: the quote carries the shards; the note explains them.
    await p.evaluate(() => { V2.fuseBatch(0, 1); });   // not awaited: it resolves only after the checkout is answered
    const checkout = p.locator('dialog[open] #checkoutConfirm'); await checkout.waitFor();
    const note = (await p.locator('dialog[open]').innerText()).replace(/\s+/g, ' ');
    assert.match(note, /1 attempt\(s\) · 100% success per attempt/);
    assert.match(note, /Fusion Shards: uses 2 \(2 per attempt\) · success 90% \+ 10% = 100% · GUARANTEED SUCCESS/);
    await p.screenshot({ path: path.join(root, 'tests/out/fusion-shards-checkout.png') });
    await checkout.click();
    await p.waitForFunction(() => /Token purchase finalized|Fusion/.test(document.body.textContent) && RyoPayments.state.profile?.fusionShards === 3, null, { timeout: 20000 });
    const row = f.purchases.find(r => r.quote?.product === 'fusion');
    assert.deepEqual([row.quote.fusion.successPercent, row.quote.fusion.shards, row.result.outputs.length, row.result.outputs[0].rank], [100, 2, 1, 1], 'a guaranteed Chunin, 2 Fusion Shards used');
    // Short: more per attempt than the balance shows how many are missing.
    f.profile.fusionShards = 1; await p.evaluate(() => RyoPayments.refresh());
    await p.waitForFunction(() => /Need 1 more Fusion Shard(?!s)/.test(document.querySelector('.sbw-scr.on .sbw-fshards')?.textContent || ''));
    assert.equal(await p.locator('.sbw-scr.on .sbw-fshards.short').count(), 1);
    // A fusion the balance can't fully cover uses what it can for every attempt, and the checkout says so before paying.
    await p.evaluate(() => { if (S.v2.revealBatch?.length) { Experience.revealAll(); RevealDesign.skip(); } });
    await p.waitForFunction(() => !S.v2.revealBatch?.length || !document.querySelector('#revealContinue')?.disabled);
    if (await p.locator('#revealContinue').isVisible().catch(() => false)) await p.locator('#revealContinue').click();
    await p.waitForFunction(() => !S.v2.revealBatch?.length);
    f.profile.heroes.push(...genin(3)); await p.evaluate(() => RyoPayments.refresh());
    await p.waitForFunction(() => V2.batchCapacity(0) >= 1);
    await p.evaluate(() => { V2.fuseBatch(0, 1); });
    await p.locator('dialog[open] #checkoutConfirm').waitFor();
    const capped = (await p.locator('dialog[open]').innerText()).replace(/\s+/g, ' ');
    assert.match(capped, /95% success per attempt/);
    assert.match(capped, /Your 1 Fusion Shard\(s\) cover 1 per attempt for 1 attempt\(s\), not 2\. Fusion Shards: uses 1/);
    await p.locator('dialog[open] #checkoutCancel').click();
    assert.deepEqual(errors, []);
  });

  /* ---------- Phone: the panel and the crafting dialog fit ---------- */
  await withGame(async ({ p, f, errors }) => {
    f.holdAdventure = false; f.profile.upgradeShards = 4; f.profile.fusionShards = 0;
    await open(p);
    const fit = await panel(p).evaluate(e => { const r = e.getBoundingClientRect(); return r.width > 150 && r.left >= -1 && r.right <= innerWidth + 1 && [...e.querySelectorAll('button')].every(b => { const x = b.getBoundingClientRect(); return x.width > 10 && x.height > 10; }); });
    assert.equal(fit, true, 'phone: panel inside the screen with usable buttons');
    await panel(p).scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(root, 'tests/out/fusion-shards-phone.png') });
    await panel(p).locator('[data-fs="craft"]').click();
    const dlg = p.locator('dialog.fusion-craft[open]'); await dlg.waitFor();
    assert.equal(await dlg.evaluate(d => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }), true, 'phone: crafting dialog fits');
    await dlg.locator('[data-a="one"]').click(); await dlg.locator('[data-a="yes"]').click();
    await p.waitForFunction(() => /Crafted 1 Fusion Shard\. You now have 1\./.test(document.querySelector('dialog.fusion-craft [data-k="msg"]')?.textContent || ''));
    assert.deepEqual([f.profile.upgradeShards, f.profile.fusionShards], [2, 1]);
    await p.screenshot({ path: path.join(root, 'tests/out/fusion-shards-phone-craft.png') });
    assert.deepEqual(errors, []);
  }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  console.log('PASS: Fusion Shards UI — Fusion panel (rate, per attempt, Fill 100%, balances, Craft) over the next-rank note, Craft Max with confirmation and server balances, 100% GUARANTEED SUCCESS, checkout note, a guaranteed fusion consuming 2 Fusion Shards, the "need more" warning; phone panel and dialog fit.');
})().catch(e => { console.error(e); process.exitCode = 1; });
