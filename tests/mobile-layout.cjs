/* Phone layout: on a portrait phone every website screen becomes one readable scrolling column under a
 * compact header and above a bottom navigation bar; turning back to a wide screen restores the exact
 * desktop layout. Isolated fixtures only. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
const output = path.join(__dirname, 'out'); fs.mkdirSync(output, { recursive: true });

const hero = (i, rank) => ({ tokenId: 'm-' + i, rank, level: 1 + i % 5, name: 'Ninja' + i + ' Test', baseStats: { pw: 2 + rank * 3, sp: 2 + rank * 3, st: 2 + rank * 3 } });
const SCREENS = ['home', 'adventure', 'heroes', 'summon', 'fusion', 'dojo', 'market', 'boss-hunt', 'codex', 'guild'];
const desktopBoxes = p => p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on .sbw-stage .hs, .sbw-scr.on .sbw-stage .lv')].map(e => [e.dataset.sbwid || e.className, e.parentElement.className, e.style.left, e.style.top, ...Object.values(e.getBoundingClientRect().toJSON()).map(n => Math.round(n))].join('|')));

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    const heroes = Array.from({ length: 14 }, (_, i) => hero(i, i % 5));
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.slice(0, 12).map(h => h.tokenId) });
    await p.setViewportSize({ width: 1440, height: 1000 });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && WebsiteDesign.current() === 'home');
    await p.waitForTimeout(500);
    const desktop = await desktopBoxes(p);
    assert.equal(await p.locator('.sbw-ph-nav').isVisible(), false, 'desktop has no phone navigation');

    for (const size of [{ width: 390, height: 844 }, { width: 412, height: 915 }]) {
      await p.setViewportSize(size);
      await p.waitForFunction(() => document.getElementById('sbwLayer').classList.contains('sbw-phone'));
      // Compact header: real balance and Chest, large touch targets.
      await p.waitForFunction(() => /\d/.test(document.querySelector('.sbw-ph-ryo b').textContent) && /\d/.test(document.querySelector('.sbw-ph-chest b').textContent));
      const chrome = await p.evaluate(() => [...document.querySelectorAll('.sbw-ph-top button, .sbw-ph-nav button')].map(b => { const r = b.getBoundingClientRect(); return { label: b.textContent.trim() || b.getAttribute('aria-label'), w: r.width, h: r.height, font: parseFloat(getComputedStyle(b.querySelector('b,span') || b).fontSize), fits: [...b.querySelectorAll('b')].every(t => t.scrollWidth <= t.clientWidth + 1) }; }));
      for (const c of chrome) {
        assert(c.w >= 40 && c.h >= 40, `${size.width}px: "${c.label}" is a ${Math.round(c.w)}×${Math.round(c.h)} touch target`);
        assert(c.font >= 11, `${size.width}px: "${c.label}" text is readable`);
        assert(c.fits, `${size.width}px: "${c.label}" value is not cut off`);
      }
      for (const k of SCREENS) {
        const inMore = !(await p.locator(`.sbw-ph-nav .sbw-ph-item[data-k="${k}"]`).count());
        if (inMore) { await p.locator('.sbw-ph-morebtn').click(); await p.locator(`.sbw-ph-more .sbw-ph-item[data-k="${k}"]`).click(); }
        else await p.locator(`.sbw-ph-nav .sbw-ph-item[data-k="${k}"]`).click();
        await p.waitForFunction(k => WebsiteDesign.current() === k, k);
        await p.waitForTimeout(250);
        const view = await p.evaluate(() => {
          const sec = document.querySelector('.sbw-scr.on'), panes = [...sec.querySelectorAll('.sbw-mpane')].map(e => e.getBoundingClientRect());
          const overlap = panes.some((a, i) => panes.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
          // HTML buttons need 24px; artwork hotspots carry an invisible tap area 8px larger on each side.
          const spots = [...sec.querySelectorAll('.sbw-mpane .hs[role="button"]:not([hidden]), .sbw-mpane button:not([hidden])')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(), z = e.classList.contains('hs') ? 16 * (r.width / (e.offsetWidth || 1)) : 0; return { width: r.width && r.width + z, height: r.height && r.height + z }; }).filter(r => r.width && r.height);
          return { panes: panes.length, overlap, sideways: sec.scrollWidth > sec.clientWidth + 1, tall: sec.scrollHeight > sec.clientHeight, small: spots.filter(r => r.width < 24 || r.height < 24).length,
            current: document.querySelector('.sbw-ph-item.on')?.dataset.k || (document.querySelector('.sbw-ph-morebtn.on') ? 'more' : null) };
        });
        assert(view.panes >= 2, `${k}: the screen is split into readable panels`);
        assert.equal(view.overlap, false, `${k}: panels never overlap`);
        assert.equal(view.sideways, false, `${k}: the page never scrolls sideways`);
        assert.equal(view.small, 0, `${k}: every control is at least 24px`);
        assert.equal(view.current, inMore ? 'more' : k, `${k}: the bottom navigation shows where you are`);
        if (size.width === 390) await p.screenshot({ path: path.join(output, 'phone-' + k + '.png') });
      }
      // Dojo → Sensei: every row keeps its label and control on screen, large enough to use.
      await p.locator('.sbw-ph-morebtn').click(); await p.locator('.sbw-ph-more .sbw-ph-item[data-k="dojo"]').click();
      await p.waitForFunction(() => WebsiteDesign.current() === 'dojo');
      await p.evaluate(() => document.querySelector('.sbw-scr.on .sbw-dback button')?.click());
      await p.evaluate(() => document.querySelector('.sbw-scr.on [data-sbwid="msen"]').click());
      await p.waitForFunction(() => WebsiteDesign.current() === 'dojo-sen');
      const sensei = await p.evaluate(() => { const sec = document.querySelector('.sbw-scr.on'); return { sideways: sec.scrollWidth > sec.clientWidth + 1,
        controls: ['.sbw-dsel', '.sbw-dtg', '.sbw-dturn'].map(sel => { const r = sec.querySelector(sel).getBoundingClientRect(); return { sel, h: Math.round(r.height), inside: r.left >= 0 && r.right <= innerWidth + 0.5 }; }) }; });
      assert.equal(sensei.sideways, false, 'Sensei: the page never scrolls sideways');
      for (const c of sensei.controls) { assert(c.inside, `Sensei: ${c.sel} is fully on screen`); assert(c.h >= 24, `Sensei: ${c.sel} is ${c.h}px tall`); }
      if (size.width === 390) await p.screenshot({ path: path.join(output, 'phone-dojo-sen.png') });
      await p.locator('.sbw-ph-nav .sbw-ph-item[data-k="home"]').click();
      await p.waitForFunction(() => WebsiteDesign.current() === 'home');
    }
    // The More sheet closes with Escape; the header Chest opens the real Chest.
    await p.locator('.sbw-ph-morebtn').click();
    assert.equal(await p.locator('.sbw-ph-more').isVisible(), true);
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.sbw-ph-more').isVisible(), false, 'Escape closes the More sheet');
    // The game's own Chest button sits exactly over the phone Chest pill, as it does on desktop.
    const [pill, real] = await p.evaluate(() => [document.querySelector('.sbw-ph-chest'), document.querySelector('[data-gc-chest]')].map(e => Object.values(e.getBoundingClientRect().toJSON()).map(Math.round)));
    assert.deepEqual(real, pill, 'the real Chest button covers the phone Chest pill');
    await p.locator('[data-gc-chest]').click();
    await p.waitForSelector('.gc-dialog[open]');
    await p.keyboard.press('Escape');
    // Back to a wide screen: every hotspot and live value returns to its exact desktop place.
    await p.setViewportSize({ width: 1440, height: 1000 });
    await p.waitForFunction(() => !document.getElementById('sbwLayer').classList.contains('sbw-phone'));
    await p.waitForTimeout(300);
    assert.deepEqual(await desktopBoxes(p), desktop, 'the desktop layout is restored exactly');
    assert.equal(await p.locator('.sbw-mpane').count(), 0, 'no phone panels remain on desktop');
    assert.deepEqual(errors, []);
  });
  console.log('PASS: portrait phones get a readable single-column layout on every screen (no sideways scroll or overlaps, 24px+ controls, 40px+ header and navigation, More sheet, live header values and Chest), and wide screens restore the exact desktop layout.');
})().catch(error => { console.error(error); process.exitCode = 1; });
