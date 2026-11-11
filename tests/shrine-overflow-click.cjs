'use strict';
/* Owner report 2026-11-11: "summoning shrine when we press x5 x10 and x15 it is opening the chest". The Chest Overflow alert
 * floated in the top-right corner over the Shrine's x5 / x10 / x15 tabs (its "Open Chest" button sat on x5). It is now a
 * centered modal notice: a stray click never reaches "Open Chest", and after Continue the tabs select the quantity and the
 * Chest stays closed. Desktop sizes and phone. */
const { withGame } = require('./harness.cjs');
const OVERFLOW = { chestRyo: 620000, tierPercent: 10, state: 'active', ratePercent: 90, claimReadyAt: null, unavailable: null, thresholds: [500000, 750000, 1000000], graceHours: 12 };
(async () => {
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await withGame(async ({ p, f, errors, assert }) => {
      f.holdAdventure = false; await p.setViewportSize(size);
      await p.locator('#loginPhantom').click(); await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.ChestOverflow && window.WebsiteDesign?.ready);
      await p.evaluate(() => go(2)); await p.waitForTimeout(600);
      const tab = async id => { const b = await p.locator(`.hs[data-sbwid="${id}"]`).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
      const selected = () => p.evaluate(() => { const s = [...document.querySelectorAll('#p2 [onclick]')].find(e => /Combat\.quantity/.test(e.getAttribute('onclick')) && e.classList.contains('selected')); return s && s.getAttribute('onclick'); });
      f.chestOverflow = { ...OVERFLOW, activeFrom: Date.now() - 1000 }; f.pendingChest = OVERFLOW.chestRyo;
      await p.evaluate(() => AdventureChest.refresh()); await p.waitForSelector('dialog.chest-overflow[open]');
      const box = await p.locator('dialog.chest-overflow').boundingBox();
      assert(Math.abs(box.x + box.width / 2 - size.width / 2) < 2 && box.y >= 0 && box.y + box.height <= size.height, 'the alert is a centered notice that fits ' + size.width + 'px');
      // A click aimed at x5 while the alert is up hits the backdrop: no Chest, quantity unchanged.
      const [x5, y5] = await tab('q5'); await p.mouse.click(x5, y5); await p.waitForTimeout(300);
      assert.equal(await p.locator('.gc-dialog[open]').count(), 0, 'a stray click never opens the Chest');
      if (await p.locator('dialog.chest-overflow[open]').count()) await p.locator('dialog.chest-overflow .co-close').click();
      await p.waitForSelector('dialog.chest-overflow', { state: 'hidden' });
      for (const [id, n] of [['q5', 5], ['q10', 10], ['q15', 15], ['k5', 5], ['k10', 10], ['k15', 15]]) {
        const [x, y] = await tab(id); await p.mouse.click(x, y); await p.waitForTimeout(250);
        assert.equal(await p.locator('.gc-dialog[open]').count(), 0, id + ' does not open the Chest at ' + size.width + 'px');
        assert.equal(await selected(), 'Combat.quantity(' + n + ')', id + ' selects ×' + n);
      }
      assert.deepEqual(errors, []);
    });
  }
  console.log('PASS: Shrine ×5 / ×10 / ×15 (tabs and scroll cards) select the quantity and never open the Chest while a Chest Overflow alert is active; the alert is a centered notice (1920, 1366, phone).');
})().catch(e => { console.error(e); process.exitCode = 1; });
