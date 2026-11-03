/* Original animated portraits: native source cells, pose-keyed repaint, hidden work. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');

const login = async p => {
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy &&
    !LoginScreen.active && window.WebsiteDesign?.ready);
};
const collection = async p => {
  await p.locator('.sbw-hdr [data-sbwid="nav-heroes"]').click();
  await p.waitForFunction(() => WebsiteDesign.current() === 'heroes' && document.querySelector('.sbw-hcard canvas'));
};

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity: 15 })).profile;
    await login(p);
    // Home strike team: empty slots keep their own 66px tiles and fit the label.
    // The shared .sbw-empty message style once widened them into overlapping boxes.
    await p.waitForFunction(() => document.querySelectorAll('.sbw-scr.on .sbw-tile').length === 5);
    const tiles = await p.locator('.sbw-scr.on .sbw-tile').evaluateAll(nodes => nodes.map(tile => {
      const box = tile.getBoundingClientRect(), label = tile.querySelector('b');
      return { left: box.left, right: box.right, fits: label.scrollWidth <= label.clientWidth && label.getBoundingClientRect().width <= box.width + .5 };
    }));
    assert(tiles.every(tile => tile.fits), 'strike team labels fit inside their tiles');
    assert(tiles.every((tile, i) => !i || tile.left >= tiles[i - 1].right - .5), 'strike team tiles never overlap');
    // Large single portraits draw crisp whole-pixel source texels instead of a smoothed blur.
    const crisp = await p.evaluate(() => [PlayerModels.crispScale(3.7, 1), PlayerModels.crispScale(6.34, 1), PlayerModels.crispScale(6.34, 2)]
      .map(({ scale, crisp }) => ({ crisp, device: PlayerModels.source.scale * scale / 8 })));
    assert.deepEqual(crisp.map(c => c.crisp), [false, true, true], 'only heavy magnification switches to crisp pixels');
    assert(Math.abs(crisp[1].device - 3) < 1e-9 && Math.abs(crisp[2].device * 2 - 6) < 1e-9, 'crisp portraits snap to whole device pixels');
    // Header: the gem pill shows the game's real presence count; its gear opens Tools.
    await p.waitForFunction(() => /\d/.test(document.getElementById('onlinePlayers')?.textContent || '') &&
      document.querySelector('.sbw-online b')?.textContent === document.getElementById('onlinePlayers').textContent.match(/\d[\d,]*/)[0]);
    const gear = await p.locator('.sbw-gear').boundingBox(), summary = await p.locator('.gc-tools summary').boundingBox();
    assert(summary.x <= gear.x && summary.x + summary.width >= gear.x + gear.width - .5 && Math.abs(summary.height - gear.height) < 1, 'the Tools hit area covers the gear without overhanging the header');
    await p.mouse.click(gear.x + gear.width / 2, gear.y + gear.height / 2);
    assert.equal(await p.evaluate(() => document.querySelector('.gc-tools').open), true, 'the gear opens the game Tools menu');
    assert.equal(await p.locator('.gc-tools > div > strong').isVisible(), false, 'the menu does not repeat the pill\'s player count');
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.sbw-walletbtn').textContent(), 'GO OFFLINE', 'the signed-in wallet pill is the GO OFFLINE button');
    // The Home chat bar pops up a chat panel in place instead of switching screens.
    await p.locator('.sbw-scr.on [data-sbwid="chatbar"]').click();
    assert.equal(await p.locator('.sbw-chatpop').isVisible(), true, 'the chat bar opens the chat pop-up');
    assert.equal(await p.evaluate(() => WebsiteDesign.current()), 'home', 'chat opens over Home, not as another screen');
    // Real messages go through the game API to the chat module and render as plain text.
    const chatInput = p.locator('.sbw-cp-in input');
    await chatInput.fill('<b>Hello</b> shinobi'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelectorAll('.sbw-cp-msg').length === 1);
    assert.equal(await p.locator('.sbw-cp-msg span').textContent(), '<b>Hello</b> shinobi', 'messages are shown as text, never markup');
    assert.equal(await p.locator('.sbw-cp-log b').filter({ hasText: 'Hello' }).count(), 0);
    assert.equal(await chatInput.inputValue(), '', 'a sent message clears the input');
    await chatInput.fill('visit evil.xyz now'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => /Links are not allowed/.test(document.querySelector('.sbw-cp-note').textContent));
    assert.equal(await chatInput.inputValue(), 'visit evil.xyz now', 'a rejected message stays editable');
    assert.equal(await p.locator('.sbw-cp-msg').count(), 1, 'rejected messages are never shown');
    // A finalized Legend summon (written by the real settlement announcement) reaches the System tab.
    const chat = require('../app/server/chat.cjs');
    await f.chatStore.transaction(c => chat.announceLegends(f.chatStore, c, 'OtherPlayerWa11etDDDDDDDDDDDDDDDDDDDDDDDDDD', { product: 'summon', request_id: 'legend-order', result: { outputs: [{ rank: 4, name: 'Ren of Hidden Leaf' }] } }));
    await p.waitForSelector('[role="tab"].sbw-cp-unread', { timeout: 8000 });
    await p.getByRole('tab', { name: /System/ }).click();
    assert.equal(await p.locator('.sbw-cp-legend').count(), 1, 'the System tab shows the Legend announcement');
    assert.match(await p.locator('.sbw-cp-legend').textContent(), /summoned a LEGEND: Ren of Hidden Leaf!/);
    assert.equal(await p.locator('[role="tab"].sbw-cp-unread').count(), 0, 'viewing System clears its unread marker');
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.sbw-chatpop').isVisible(), false, 'Escape closes the chat pop-up');
    await p.waitForFunction(() => /LEGEND/.test(document.querySelector('.sbw-chatline')?.textContent || ''));
    assert.equal(await p.locator('.sbw-chatline').isVisible(), true, 'the Home chat bar shows the newest message, here the Legend announcement');
    await collection(p);
    await p.waitForTimeout(600);
    const portraits = await p.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 400;
      const context = canvas.getContext('2d'), sources = new Set(), crops = new Set();
      let hd = 0;
      const originalDraw = context.drawImage.bind(context);
      context.drawImage = (source, ...args) => {
        if (source instanceof HTMLImageElement) hd++;
        else if (!source.tierAura) { sources.add(source); crops.add(source.width + 'x' + source.height); }
        originalDraw(source, ...args);
      };
      const poses = [];
      for (let id = 0; id < 8; id++) {
        const hero = { id, r: id % 5, z: false };
        PlayerModels.drawPortrait(context, hero, 160, 352, 8, 0);
        poses.push([0, 520, 1040].map(t => PlayerModels.portraitPose(hero, t)));
      }
      const sleeping = PlayerModels.portraitPose({ id: 1, z: true }, 520);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) visible++;
      return { hd, textures: sources.size, poses, sleeping, visible,
        requests: performance.getEntriesByType('resource').filter(r => /reveal-models-hd|hero-directions-hd|hero-motion/.test(r.name)).length };
    });
    assert.equal(portraits.hd, 0, 'portraits draw the original native source cells, not HD artwork');
    assert.equal(portraits.textures, 8, 'eight identities draw eight independent native cells');
    assert(portraits.visible > 1000, 'native portraits are visible');
    for (const [a, b, c] of portraits.poses) {
      assert.notEqual(a, b, 'idle portraits animate between original poses');
      assert.equal(a, c, 'idle portraits cycle the two original idle poses');
    }
    assert.equal(portraits.sleeping, 's0', 'sleeping heroes keep the still sleep pose');
    assert.equal(portraits.requests, 0, 'retired HD artwork is never requested');

    // A displayed portrait repaints only when its idle pose flips, never per paint tick.
    await p.evaluate(() => {
      window.__portraitPaints = 0;
      const original = PlayerModels.drawPortrait;
      PlayerModels.drawPortrait = function (context, ...args) {
        if (context.canvas.matches('.sbw-hcard canvas')) window.__portraitPaints++;
        return original.call(this, context, ...args);
      };
    });
    await p.waitForTimeout(1100);
    const paints = await p.evaluate(() => [window.__portraitPaints, document.querySelectorAll('.sbw-hcard canvas').length]);
    assert(paints[0] > 0, 'visible collection portraits keep animating');
    assert(paints[0] <= paints[1] * 3, 'pose-keyed caches limit repaints to idle pose changes: ' + paints.join(' / '));

    await p.evaluate(() => {
      window.__hiddenPortraitPaints = 0;
      const original = PlayerModels.drawPortrait;
      PlayerModels.drawPortrait = function (context, ...args) {
        if (context.canvas.matches('#p1 canvas[data-hero], #strip canvas[data-map-portrait]')) window.__hiddenPortraitPaints++;
        return original.call(this, context, ...args);
      };
    });
    await p.waitForTimeout(600);
    assert.equal(await p.evaluate(() => window.__hiddenPortraitPaints), 0, 'covered native Heroes portraits do not repaint');
    await p.locator('.sbw-hdr [data-sbwid="nav-adventure"]').click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'adventure');
    await p.waitForTimeout(250);
    await p.evaluate(() => { window.__hiddenPortraitPaints = 0; });
    await p.waitForTimeout(600);
    assert.equal(await p.evaluate(() => window.__hiddenPortraitPaints), 0, 'covered native Adventure portraits do not repaint');
    // GO OFFLINE (no Sensei here): a warning, then the game's own wallet disconnect and sign-in screen.
    await p.locator('.sbw-hdr [data-sbwid="wallet"]').click();
    await p.waitForSelector('.sbw-offline[open]');
    assert.match(await p.locator('.sbw-offline .sbw-off-warn').textContent(), /No Sensei is hired/);
    await p.locator('.sbw-offline [data-k="go"]').click();
    await p.waitForFunction(() => !RyoPayments.state.authenticated && LoginScreen.active);
    await login(p);
    assert.equal(await p.locator('.sbw-walletbtn').textContent(), 'GO OFFLINE', 'signing back in restores the GO OFFLINE button');
    await p.waitForSelector('.sbw-dialog[open]');
    assert.match(await p.locator('.sbw-dialog[open]').textContent(), /Welcome back!.*No Sensei was hired/s, 'coming back explains why nothing was earned');
    await p.keyboard.press('Escape');
    assert.deepEqual(errors, [], 'portrait rendering and navigation remain error-free');
  });
  console.log('PASS: eight original animated portraits, pose-keyed repaint, no HD downloads and hidden-paint suppression.');
})().catch(error => { console.error(error); process.exitCode = 1; });
