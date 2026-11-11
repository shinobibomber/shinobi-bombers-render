/* In-game Support tickets in the real game page (owner request 2026-11-12): Reward Center, Help & Support, Contact Support opens the
 * ticket dialog; the player sends a ticket, sees the team's reply, replies, and sees a closed ticket as final. The server side is the
 * REAL support module on an in-memory Postgres (the harness routes support-* to it), so limits and ownership are the production
 * rules. Checks: text from the server (including the player's own) is never HTML, internal notes never show, errors are readable,
 * the Control-panel switch OFF closes the dialog's form, and the dialog fits a phone. Isolated fixtures only. */
const assert = require('node:assert/strict'), path = require('node:path'), { withGame } = require('./harness.cjs');
const root = path.resolve(__dirname, '..'), S = require('../app/server/support.cjs');
const XSS = '<img src=x onerror="window.__xss=1"> hello';
const dialogText = p => p.locator('dialog.sup-dialog[open]').innerText().then(t => t.replace(/\s+/g, ' '));
const staff = (f, change) => f.chatStore.transaction(c => S.staffChange(c, { scope: f.chatStore.scope, wallet: 'StaffWalletNeverShownToPlayers1111111111', now: Date.now(), ...change }));
async function openSupport(p) {
  await p.evaluate(() => HeroPasses.open('rewards'));
  await p.waitForSelector('dialog.hp-center[open]');
  await p.locator('dialog.hp-center').getByRole('button', { name: 'Help & Support', exact: true }).click();
  await p.locator('dialog.hp-center').getByRole('button', { name: 'Contact Support', exact: true }).click();
  await p.waitForSelector('dialog.sup-dialog[open]');
}
async function signIn(p, f) {
  f.holdAdventure = false; f.heroPasses = { ui: true, claims: true, pending: [], history: [], passes: 0, uses: [] };
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.HeroPasses && window.SupportTickets);
  await p.evaluate(() => HeroPasses.refresh());
}
(async () => {
  delete process.env.SUPPORT_TICKETS_ENABLED;
  await withGame(async ({ p, f, errors }) => {
    await signIn(p, f);
    await openSupport(p);
    await p.waitForFunction(() => /You have no tickets yet\./.test(document.querySelector('dialog.sup-dialog[open]')?.textContent || ''));
    assert.match(await dialogText(p), /SUPPORT ✕ Tell us what went wrong.*deleted 30 days after they are resolved\./);

    // A ticket whose text looks like HTML is shown as text, never as markup.
    await p.getByRole('button', { name: 'New ticket', exact: true }).click();
    // Errors are readable and keep what the player typed.
    await p.getByLabel('Short title').fill('ab'); await p.getByLabel('What happened?').fill(XSS);
    await p.getByRole('button', { name: 'Send ticket', exact: true }).click();
    await p.waitForFunction(() => /subject must be 3 to 80/.test(document.querySelector('.sup-msg')?.textContent || ''));
    assert.equal(await p.getByLabel('What happened?').inputValue(), XSS, 'the text typed survives an error');
    await p.getByLabel('Short title').fill('<b>Hero</b> missing'); await p.getByLabel('Order reference').fill('nothing-like-this-1');
    await p.getByRole('button', { name: 'Send ticket', exact: true }).click();
    await p.waitForFunction(() => /could not find that order on your account/.test(document.querySelector('.sup-msg')?.textContent || ''));
    await p.getByLabel('Order reference').fill('');
    await p.getByLabel('What happened?').fill(XSS);
    await p.getByRole('button', { name: 'Send ticket', exact: true }).click();
    await p.waitForFunction(() => /TICKET #\d+/.test(document.querySelector('dialog.sup-dialog[open]')?.textContent || '') && /Ticket sent/.test(document.querySelector('.sup-msg')?.textContent || ''));
    const text = await dialogText(p);
    assert(text.includes('<b>Hero</b> missing') && text.includes(XSS), 'subject and message are shown as typed text');
    assert.equal(await p.locator('dialog.sup-dialog img, dialog.sup-dialog b').count(), 0, 'no element was created from the text');
    assert.equal(await p.evaluate(() => window.__xss), undefined, 'the text did not run');
    assert.match(text, /Something is broken|Payment or deposit/); assert.match(text, /Waiting for the team/);
    await p.screenshot({ path: path.join(root, 'tests/out/support-ticket.png') });
    const id = Number((await dialogText(p)).match(/TICKET #(\d+)/)[1]);

    // The team answers (and leaves an internal note); Refresh shows the answer, never the note or the staff wallet.
    const row = await f.chatStore.pool.query('SELECT version FROM ryo_support_tickets WHERE id=$1', [id]);
    await staff(f, { id, kind: 'note', message: 'INTERNAL suspect an alt account' });
    await staff(f, { id, kind: 'reply', expected: Number(row.rows[0].version), message: 'We are on it. Please check your Heroes screen.', status: 'investigating' });
    await p.getByRole('button', { name: 'Refresh', exact: true }).click();
    await p.waitForFunction(() => /Support team/.test(document.querySelector('dialog.sup-dialog[open]')?.textContent || ''));
    const seen = await dialogText(p);
    assert(seen.includes('We are on it. Please check your Heroes screen.')); assert.match(seen, /Being looked at/);
    assert(!seen.includes('INTERNAL') && !seen.includes('StaffWallet'), 'no internal note or staff wallet for the player');

    // The player replies; the send button needs text.
    assert.equal(await p.getByRole('button', { name: 'Send reply', exact: true }).isDisabled(), true, 'an empty reply cannot be sent');
    await p.getByPlaceholder('Write a reply…').fill('Found it, thank you!');
    await p.getByRole('button', { name: 'Send reply', exact: true }).click();
    await p.waitForFunction(() => /Message sent\./.test(document.querySelector('.sup-msg')?.textContent || ''));
    assert.match(await dialogText(p), /You · .*Found it, thank you!/);
    assert.equal(await p.getByPlaceholder('Write a reply…').inputValue(), '', 'the reply box is empty after sending');

    // List view, then a closed ticket is final.
    await p.getByRole('button', { name: 'Back', exact: true }).click();
    await p.waitForFunction(() => document.querySelectorAll('dialog.sup-dialog .sup-item').length === 1);
    assert.match(await dialogText(p), /<b>Hero<\/b> missing Payment or deposit · Being looked at/);
    const cur = Number((await f.chatStore.pool.query('SELECT version FROM ryo_support_tickets WHERE id=$1', [id])).rows[0].version);
    await staff(f, { id, kind: 'update', expected: cur, status: 'closed' });
    await p.locator('dialog.sup-dialog .sup-item').click();
    await p.waitForFunction(() => /This ticket is closed\./.test(document.querySelector('dialog.sup-dialog[open]')?.textContent || ''));
    assert.equal(await p.getByPlaceholder('Write a reply…').count(), 0, 'no reply box on a closed ticket');

    // Switch OFF (Control panel): the dialog says so and offers no form.
    process.env.SUPPORT_TICKETS_ENABLED = 'off';
    await p.locator('dialog.sup-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await p.evaluate(() => SupportTickets.open());
    await p.waitForFunction(() => /not open right now/.test(document.querySelector('dialog.sup-dialog[open]')?.textContent || ''));
    assert.equal(await p.getByRole('button', { name: 'New ticket', exact: true }).count(), 0, 'no New ticket button while the switch is off');
    delete process.env.SUPPORT_TICKETS_ENABLED;
    assert.deepEqual(errors, []);
  });

  /* Phone: the dialog and the form fit the screen and never scroll sideways. */
  await withGame(async ({ p, f, errors }) => {
    await signIn(p, f);
    await openSupport(p);
    await p.getByRole('button', { name: 'New ticket', exact: true }).click();
    await p.waitForSelector('dialog.sup-dialog .sup-form');
    const fit = await p.locator('dialog.sup-dialog[open]').evaluate(d => { const r = d.getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= innerWidth + 1, bottom: r.bottom <= innerHeight + 1, noSideScroll: d.scrollWidth <= d.clientWidth + 1 }; });
    assert.deepEqual(fit, { inside: true, bottom: true, noSideScroll: true }, 'the Support dialog fits the phone');
    await p.screenshot({ path: path.join(root, 'tests/out/support-phone.png') });
    assert.deepEqual(errors, []);
  }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  console.log('PASS: Support UI: opens from Help & Support; errors readable; text shown as text (no HTML); team reply shown, internal notes and staff wallets never; player reply; closed ticket final; switch OFF closes the form; phone fit.');
})().catch(e => { console.error(e); process.exitCode = 1; });
