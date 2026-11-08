/* The real-DOM Chat screen: live Global + System, placeholder channels, responsive layouts. */
const { withGame } = require('./harness.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    await p.evaluate(() => WebsiteDesign.open('chat'));
    await p.waitForFunction(() => WebsiteDesign.current() === 'chat' && document.querySelector('.sbw-chat'));
    assert.equal(await p.locator('.sbw-cs-tab').count(), 8, 'all eight channels are listed');
    assert.equal(await p.locator('.sbw-cs-title').textContent(), 'GLOBAL CHAT');
    // Live Global: messages are plain text; rejected links stay editable.
    const input = p.locator('.sbw-cs-form input');
    await input.fill('<b>Hello</b> shinobi'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => [...document.querySelectorAll('.sbw-cs-mt')].some(n => n.textContent === '<b>Hello</b> shinobi'));
    assert.equal(await p.locator('.sbw-cs-log b').filter({ hasText: 'Hello' }).count(), 0, 'messages are text, never markup');
    assert.equal(await input.inputValue(), '', 'a sent message clears the input');
    await input.fill('visit evil.xyz now'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => /Links are not allowed/.test(document.querySelector('.sbw-cs-note').textContent));
    assert.equal(await input.inputValue(), 'visit evil.xyz now', 'a rejected message stays editable');
    // Placeholder channels render without errors and disable sending.
    for (const ch of ['Guild', 'Team', 'Direct Messages', 'Trade', 'Event', 'Help', 'System']) {
      await p.locator('.sbw-cs-tab', { hasText: ch }).click();
      assert.equal(await p.locator('.sbw-cs-tab.on').getAttribute('data-ch'), ch);
      assert.equal(await input.isDisabled(), true, ch + ' is read-only for now');
    }
    await p.locator('.sbw-cs-tab', { hasText: 'Global' }).click();
    assert.equal(await input.isDisabled(), false, 'Global accepts messages again');
    // Responsive: tablet hides the side column behind the Social button; phone shows the channel strip.
    await p.setViewportSize({ width: 1000, height: 700 });
    await p.waitForTimeout(300);
    assert.equal(await p.locator('.sbw-cs-side').isVisible(), false, 'tablet hides the side panels');
    await p.locator('.sbw-cs-social-btn').click();
    assert.equal(await p.locator('.sbw-cs-side').isVisible(), true, 'the Social button opens them');
    await p.setViewportSize({ width: 390, height: 800 });
    await p.waitForTimeout(400);
    assert.equal(await p.locator('.sbw-cs-form input').isVisible(), true, 'phone keeps the composer reachable');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'phone never scrolls sideways');
    assert.deepEqual(errors, [], 'no page errors');
    console.log('chat screen ok');
  });
})().catch(e => { console.error(e); process.exit(1); });
