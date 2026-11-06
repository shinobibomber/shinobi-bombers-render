/* Presentation regression: real native prices, unobstructed headings and preview notices. */
const fs = require('node:fs');
const path = require('node:path');
const { withGame } = require('./harness.cjs');
const output = path.join(__dirname, 'out');

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !LoginScreen.active && window.WebsiteDesign?.ready);
    await p.addStyleTag({ content: '#sbwLayer *,#sbwLayer *::before,#sbwLayer *::after{animation:none!important;transition:none!important}' });
    const before = await p.evaluate(() => ({ balance: RyoPayments.state.balance, heroes: S.h.map(h => h.id) }));
    const screens = [['summon', 'summon'], ['heroes', 'heroes'], ['boss-hunt', 'bosshunt'], ['codex', 'codex'], ['guild', 'guild']];
    // Portrait phones get the stacked phone layout (tests/mobile-layout.cjs); a phone held sideways
    // keeps this scaled desktop layout.
    for (const viewport of [{ width: 1672, height: 941 }, { width: 844, height: 390 }]) {
      await p.setViewportSize(viewport);
      for (const [screen, nav] of screens) {
        await p.locator(`.sbw-hdr [data-sbwid="nav-${nav}"]`).click();
        await p.waitForFunction(key => WebsiteDesign.current() === key, screen);
        await p.locator('.sbw-scr.on .sbw-base').evaluate(image => image.decode());
        await p.evaluate(() => document.fonts.ready);
        const geometry = await p.evaluate(() => {
          const header = document.querySelector('.sbw-hdr'), stage = document.querySelector('.sbw-scr.on .sbw-stage');
          const headerRect = header.getBoundingClientRect(), stageRect = stage.getBoundingClientRect();
          const crop = parseFloat(stage.style.clipPath.match(/[\d.]+/)[0]);
          const scale = stageRect.width / stage.offsetWidth;
          const notice = document.querySelector('.sbw-scr.on .sbw-preview');
          // Titles sit on the left, below the header art's left part (row 100 of 124); only the
          // wallet column overhangs further, so full-width notices must clear the whole header.
          const art = header.querySelector('.sbw-hdr-img').getBoundingClientRect();
          return { headerBottom: art.top + art.height * 100 / 124, fullHeaderBottom: headerRect.bottom, contentTop: stageRect.top + crop * scale,
            noticeTop: notice?.getBoundingClientRect().top, noticeBottom: notice?.getBoundingClientRect().bottom,
            headerClipped: getComputedStyle(header).overflow === 'hidden',
            decorationClipped: getComputedStyle(document.querySelector('.sbw-hdr-img')).clipPath !== 'none',
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert(geometry.headerClipped && geometry.decorationClipped, 'stray shared-header artwork is clipped');
        assert(geometry.contentTop >= geometry.headerBottom - 1, `${screen}: title starts below the shared header`);
        assert.equal(geometry.overflow, false, `${screen}: no horizontal overflow`);
        if (screen === 'guild') {
          assert(geometry.noticeTop >= geometry.fullHeaderBottom, 'Guild notice starts below navigation and the wallet column');
          assert(geometry.noticeBottom <= geometry.contentTop, 'Guild notice has space above the original title');
        }
        if (screen === 'summon') {
          await p.waitForFunction(() => document.querySelector('.sbw-pack-price strong')?.textContent === '25,000 Ryo');
          assert.deepEqual(await p.locator('.sbw-pack-price strong').allTextContents(), ['25,000 Ryo', '125,000 Ryo', '250,000 Ryo', '375,000 Ryo']);
          for (const quantity of [1, 5, 10, 15]) {
            const pack = p.locator(`.sbw-scr.on [data-sbwid="k${quantity}"]`);
            await pack.focus(); await p.keyboard.press('Enter');
            await p.waitForFunction(q => document.querySelector(`#p2 [onclick="Combat.quantity(${q})"]`)?.classList.contains('selected'), quantity);
            assert((await pack.getAttribute('aria-label')).includes(`${quantity.toLocaleString()} scroll`));
            // Original poster captions occupy y=103..171 in each 179px card.
            // Test both the base and the tilted foreground: inherited native
            // .card padding previously shifted the cover below the OFF badges.
            for (const hover of [false, true]) {
              if (hover) await pack.hover();
              else { await pack.evaluate(e => e.blur()); await p.mouse.move(0, 0); }
              const coverage = await pack.evaluate(card => {
                const foreground = card.querySelector('.sl'), footer = card.querySelector('.sbw-pack-price');
                return { height: foreground.offsetHeight, top: footer.offsetTop, bottom: footer.offsetTop + footer.offsetHeight,
                  left: footer.offsetLeft, right: footer.offsetLeft + footer.offsetWidth, width: foreground.offsetWidth,
                  backing: getComputedStyle(card).backgroundColor, opaque: getComputedStyle(footer).backgroundImage.includes('rgb(12, 13, 40)') };
              });
              assert.equal(coverage.height, 179, 'native card styles cannot shift the original art coordinates');
              assert(coverage.top <= 103 && coverage.bottom >= 171 && coverage.left <= 8 && coverage.right >= coverage.width - 8,
                `×${quantity}: original discount, quantity and price areas are fully covered (${hover ? 'hover' : 'rest'})`);
              assert(coverage.opaque && coverage.backing === 'rgb(8, 9, 27)', 'opaque foreground and backing conceal captions during animation');
            }
          }
        }
        await p.screenshot({ path: path.join(output, `menu-${screen}-${viewport.width}.png`) });
      }
    }
    assert.deepEqual(await p.evaluate(() => ({ balance: RyoPayments.state.balance, heroes: S.h.map(h => h.id) })), before, 'presentation and quantity selection preserve balance and heroes');
    assert.equal(f.purchases.length, 0, 'quantity buttons never submit a purchase');
    assert.deepEqual(errors, [], 'menu navigation has no runtime errors');
  });
  console.log('PASS: original summon prices, native quantity selection, shared-header clipping and Guild notice layout on desktop/mobile.');
})().catch(error => { console.error(error); process.exitCode = 1; });
