/* Live SOL Sensei (owner decision 2026-11-09): with the server's senseiSol on, the Hire a Sensei dialog and the Dojo
 * Sensei pane offer only the one-time SOL purchase at the server's price (with an estimated USD value when the
 * /founders price check has one), never a Ryo hire or a Ryo rental. Without senseiSol the Ryo offer is unchanged.
 * Isolated fixtures only: no wallet, no RPC, no payment. */
const { withGame } = require('./harness.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    f.config = { ...f.config, senseiSol: true };
    f.profile = { ...f.profile, dojo: 1, sensei: false, senseiRentalUntil: 0 };
    f.senseiSolInfo = { senseiSol: { enabled: true, owned: false, regularPrice: 0.4, price: 0.4, founderDiscount: false, trialEnds: null, purchase: null } };
    await p.route('**/api/prelaunch', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { founders: { usdPerSol: 190 } } }) }));
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.FounderPanel?.sensei);
    assert.equal(await p.evaluate(() => FounderPanel.sensei.mode()), true, 'SOL mode follows the server configuration');

    // 1. Hire a Sensei dialog (Sensei page, not hired): Cancel + one SOL button, no Ryo, no rental.
    await p.evaluate(() => go(4)); await p.waitForFunction(() => WebsiteDesign.current() === 'dojo');
    await p.locator('.sbw-scr.on [data-sbwid="msen"]').click(); await p.waitForFunction(() => WebsiteDesign.current() === 'dojo-sen');
    const card = await p.locator('.sbw-scr.on .sbw-dhired').innerText();
    assert.match(card, /one-time SOL payment/, 'the NOT HIRED card explains the SOL purchase'); assert(!/rent/i.test(card), 'no rental on the card: ' + card);
    await p.locator('.sbw-scr.on .sbw-dturn').click();
    await p.waitForFunction(() => document.querySelector('dialog.sbw-dialog[open] [data-k="sol"]')?.textContent.includes('≈ $76.00'));
    const dialog = await p.evaluate(() => { const d = document.querySelector('dialog.sbw-dialog[open]'); return { text: d.innerText, buttons: [...d.querySelectorAll('button')].map(b => b.textContent), disabled: d.querySelector('[data-k="sol"]').disabled }; });
    assert.deepEqual(dialog.buttons, ['Cancel', 'Hire permanently · 0.4 SOL (≈ $76.00)'], 'only Cancel and the SOL purchase');
    assert.equal(dialog.disabled, false);
    assert(!/Ryo|Rent/i.test(dialog.text), 'no Ryo price and no rental in SOL mode: ' + dialog.text);
    // The Founder button is for Founders only: the Sensei is not sold there any more.
    assert.equal(await p.locator('.fd-launch').isHidden(), true, 'no Founder button for a non-Founder, even with SOL Sensei on');
    // The SOL button buys right here on the Sensei tab (owner decision 2026-11-10): one sensei-sol-buy request, the outcome
    // shown in this dialog, and the Founder panel never opens. (The isolated server answers 'expired', so no wallet is
    // involved and nothing is charged.)
    await p.locator('dialog.sbw-dialog[open] [data-k="sol"]').click();
    for (let i = 0; i < 50 && !f.senseiSolBuys; i++) await p.waitForTimeout(100);
    assert.equal(f.senseiSolBuys, 1, 'the SOL button starts exactly one SOL purchase');
    await p.waitForFunction(() => /payment expired; nothing was charged/.test(document.querySelector('dialog.sbw-dialog[open]')?.innerText || ''));
    assert.equal(await p.evaluate(() => !!document.querySelector('dialog[open] #fd-title')), false, 'the Founder panel is not used to buy the Sensei');
    assert.equal(await p.locator('dialog.sbw-dialog[open] [data-k="sol"]').isEnabled(), true, 'the button is usable again after the outcome');
    await p.locator('dialog.sbw-dialog[open] [data-k="x"]').click();
    // The Founder panel itself never offers a Sensei purchase.
    await p.evaluate(() => FounderPanel.open()); await p.waitForFunction(() => document.querySelector('dialog[open] #fd-title'));
    const panel = await p.evaluate(() => document.querySelector('dialog[open] #fd-title').closest('dialog').innerText);
    assert(!/Buy permanent Sensei|SOL Sensei opens later/.test(panel), 'no Sensei purchase in the Founder panel: ' + panel);
    await p.keyboard.press('Escape');

    // 2. Dojo Sensei pane (exact scene): SOL price, no Ryo rental button; a running rental can be made permanent with SOL.
    const pane = () => p.evaluate(() => { DojoServices.open('sensei'); const q = s => document.querySelector(s); return { title: q('.sensei-purchase-title')?.textContent, copy: q('.sensei-purchase-copy')?.textContent, rental: !!q('.sensei-rental-action'), permanent: q('.sensei-permanent-action')?.textContent || null, hire: q('.sensei-primary-action')?.disabled }; });
    await p.evaluate(() => go(4));
    await p.waitForFunction(() => { DojoServices.open('sensei'); return /SOL/.test(document.querySelector('.sensei-purchase-title')?.textContent || ''); });
    assert.deepEqual(await pane(), { title: '0.4 SOL ≈ $76.00', copy: 'One-time payment in SOL: permanent rotation and up to 12 hours of offline earnings.', rental: false, permanent: null, hire: false }, 'Dojo pane: SOL price, no Ryo rental');
    { const until = Date.now() + 3600000; f.profile.senseiRentalUntil = until; await p.evaluate(u => { RyoPayments.state.profile.senseiRentalUntil = u; }, until); }
    await p.waitForFunction(() => { DojoServices.open('sensei'); return document.querySelector('.sensei-purchase-title')?.textContent === 'RENTED'; });
    const rented = await pane();
    assert.deepEqual([rented.rental, rented.permanent], [false, 'Hire permanently · 0.4 SOL'], 'a running rental keeps its time; no extension, only the SOL upgrade');

    // 3. Legacy Founder price comes from the server and is explained.
    f.profile.senseiRentalUntil = 0; await p.evaluate(() => { RyoPayments.state.profile.senseiRentalUntil = 0; });
    f.senseiSolInfo = { senseiSol: { ...f.senseiSolInfo.senseiSol, price: 0.2, founderDiscount: true, trialEnds: Date.now() + 86400000 } };
    await p.evaluate(() => FounderPanel.sensei.offer());
    if (await p.evaluate(() => WebsiteDesign.current()) !== 'dojo-sen') { await p.evaluate(() => go(4)); await p.waitForFunction(() => ['dojo', 'dojo-sen'].includes(WebsiteDesign.current())); if (await p.evaluate(() => WebsiteDesign.current()) === 'dojo') { await p.locator('.sbw-scr.on [data-sbwid="msen"]').click(); await p.waitForFunction(() => WebsiteDesign.current() === 'dojo-sen'); } }
    await p.locator('.sbw-scr.on .sbw-dturn').click();
    await p.waitForFunction(() => document.querySelector('dialog.sbw-dialog[open] [data-k="sol"]')?.textContent.includes('0.2 SOL'));
    const legacy = await p.evaluate(() => document.querySelector('dialog.sbw-dialog[open]').innerText);
    assert.match(legacy, /Legacy Founder price \(regular 0\.4 SOL\)/);
    assert.match(legacy, /Hire permanently · 0\.2 SOL \(≈ \$38\.00\)/);
    await p.locator('dialog.sbw-dialog[open] [data-k="x"]').click();

    // 4. Mainnet always sells the Sensei for SOL (the server refuses Ryo Sensei there even with the SOL switch off);
    //    the test server keeps the Ryo offer. A paused SOL sale shows as paused, never as a Ryo button.
    assert.deepEqual(await p.evaluate(() => { const real = window.RyoPayments, probe = c => { window.RyoPayments = { state: { configuration: c } }; try { return FounderPanel.sensei.mode(); } finally { window.RyoPayments = real; } };
      return [probe({ network: 'solana-mainnet', senseiSol: false }), probe({ network: 'solana-devnet', senseiSol: false }), probe({ network: 'solana-devnet', senseiSol: true })]; }), [true, false, true]);
    f.senseiSolInfo = { senseiSol: { ...f.senseiSolInfo.senseiSol, enabled: false, price: 0.4, founderDiscount: false, trialEnds: null } };
    await p.evaluate(() => FounderPanel.sensei.offer());
    await p.locator('.sbw-scr.on .sbw-dturn').click();
    await p.waitForFunction(() => /paused/.test(document.querySelector('dialog.sbw-dialog[open]')?.innerText || ''));
    assert.equal(await p.locator('dialog.sbw-dialog[open] [data-k="sol"]').isDisabled(), true, 'a paused SOL sale cannot be started');
    await p.locator('dialog.sbw-dialog[open] [data-k="x"]').click();
    // The cached offer belongs to one wallet: another account never sees it (for example a Legacy Founder price).
    assert.equal(await p.evaluate(() => { const real = window.RyoPayments; window.RyoPayments = { state: { account: 'AnotherWallet111111111111111111111111111111', configuration: real.state.configuration } }; try { return FounderPanel.sensei.cached(); } finally { window.RyoPayments = real; } }), null, 'no offer is shown for a different wallet');
    assert.deepEqual(errors, []);
  });
  console.log('PASS: live SOL Sensei: the Hire dialog and the Dojo Sensei pane offer only the server-priced SOL purchase (USD estimate, Legacy Founder price), no Ryo hire or rental; running rentals keep their time.');
})().catch(error => { console.error(error); process.exitCode = 1; });
