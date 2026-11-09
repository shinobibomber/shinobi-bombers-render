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
    // Moderation as a player sees it (server-enforced in chat.cjs; staff actions simulated in the DB).
    const store = f.chatStore, other = 'OtherWa11etZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
    const seeded = (await store.pool.query("INSERT INTO ryo_chat(scope,channel,wallet,name,text,created) VALUES($1,'global',$2,'Spammer','cheap ryo here',$3) RETURNING id", [store.scope, other, Date.now()])).rows[0].id;
    await p.waitForFunction(id => !!document.querySelector('.sbw-cs-rep[data-report="' + id + '"]'), Number(seeded), { timeout: 15000 });
    assert.equal(await p.locator('.sbw-cs-msg.mine .sbw-cs-rep').count(), 0, 'own messages have no report button');
    await p.locator('.sbw-cs-rep[data-report="' + seeded + '"]').click();
    await p.locator('.sbw-cs-report select').selectOption('scam'); await p.locator('.sbw-cs-report input').fill('asks for wallet seed');
    await p.locator('.sbw-cs-report button[type="submit"]').click();
    await p.waitForFunction(() => /moderators will review/.test(document.querySelector('.sbw-cs-note').textContent));
    assert.equal(await p.locator('.sbw-cs-report').isHidden(), true, 'the report panel closes after sending');
    const stored = (await store.pool.query('SELECT category,details,snapshot_text FROM ryo_cc_chat_reports WHERE scope=$1 AND message_id=$2', [store.scope, seeded])).rows[0];
    assert.deepEqual(stored, { category: 'scam', details: 'asks for wallet seed', snapshot_text: 'cheap ryo here' });
    // A staff hide removes the message from the open screen on the next poll.
    await store.pool.query('UPDATE ryo_chat SET hidden=$3 WHERE scope=$1 AND id=$2', [store.scope, seeded, Date.now()]);
    await p.waitForFunction(() => ![...document.querySelectorAll('.sbw-cs-mt')].some(n => n.textContent === 'cheap ryo here'), null, { timeout: 15000 });
    // A mute disables the composer and explains why; the server refuses sends regardless.
    await store.pool.query('INSERT INTO ryo_cc_chat_status(scope,wallet,muted_until,updated) VALUES($1,$2,$3,$4)', [store.scope, (await p.evaluate(() => RyoPayments.state.account)), Date.now() + 600000, Date.now()]);
    await p.waitForFunction(() => /muted in Global chat until/.test(document.querySelector('.sbw-cs-note').textContent), null, { timeout: 15000 });
    assert.equal(await input.isDisabled(), true, 'a muted player cannot type'); assert.equal(await input.getAttribute('placeholder'), 'Sending is restricted');
    await store.pool.query('DELETE FROM ryo_cc_chat_status WHERE scope=$1', [store.scope]);
    await p.waitForFunction(() => !document.querySelector('.sbw-cs-form input').disabled, null, { timeout: 15000 });
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
