/* Direct Chest Reward Spending, real checkout dialog (owner request 2026-11-11). The quote's `chest` offer (stubbed here; the
 * server side is covered by chest-spending-server.cjs) adds a "Pay using" choice: Chest rewards or Game balance. Choosing the
 * chest sends funding:'chest' with the single stored purchase request; the balance choice sends no funding; an insufficient
 * offer disables the chest option with the reason; no offer (switch off) shows no choice. No wallet or RPC. */
const path = require('node:path'), { withGame } = require('./harness.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active);
    let offer = null; const purchases = [];
    await p.route('**/.netlify/functions/ryo', async route => {
      const req = route.request().postDataJSON();
      if (req.action === 'purchase') { purchases.push(req); return route.fallback(); }
      if (req.action !== 'quote') return route.fallback();
      const q = require('../app/server/economy.cjs').quote(f.profile, req.product, req.params);
      await route.fulfill({ json: offer ? { ...q, chest: offer } : q });
    });
    const open = async () => { await p.evaluate(() => { go(2); Combat.quantity(1); Combat.summonBatch(); }); await p.waitForSelector('#tokenCheckoutDialog[open]'); };
    const closeDialog = () => p.evaluate(() => document.querySelector('#tokenCheckoutDialog').close());

    // Switch off (no offer): the checkout is unchanged.
    await open(); assert.equal(await p.locator('#tokenCheckoutDialog .chest-pay').count(), 0, 'no choice without an offer');
    await p.locator('#checkoutCancel').click();

    // An offer that covers the price: choose the chest, see the remaining amount, pay once.
    offer = { enabled: true, chestRyo: 40000, spendableRyo: 40000, nextClaimAt: Date.now() + 3600000, limitedBy: null };
    await open();
    const text = await p.locator('#tokenCheckoutDialog .chest-pay').innerText();
    assert.match(text, /Pay using[\s\S]*Chest rewards[\s\S]*40,000 SR usable now[\s\S]*Game balance/);
    await p.locator('#tokenCheckoutDialog input[value="chest"]').check();
    assert.match(await p.locator('.chest-pay-note').innerText(), /after this purchase: 15,000 SR\. No withdrawal fee, and your claim timer is not used \(next claim/);
    assert.match(await p.locator('#checkoutConfirm').innerText(), /Pay 25,000 SR from Chest/);
    assert.match(await p.locator('#tokenCheckoutDialog dl').innerText(), /Price · paid from Chest rewards/, 'the price row names the source');
    await p.screenshot({ path: path.join(root, 'tests/out/chest-spending-checkout.png') });
    await p.locator('#checkoutConfirm').click();
    await p.waitForFunction(() => !document.querySelector('#tokenCheckoutDialog').open);
    await p.waitForTimeout(800);
    assert.equal(purchases.length, 1, 'one purchase request'); assert.equal(purchases[0].funding, 'chest', 'the request carries funding chest');
    assert.equal(purchases[0].expectedTotal, 25000, 'the same server price');
    await p.waitForFunction(() => !localStorage.getItem('shinobi-ryo-purchase-request-v2'), null, { timeout: 10000 });
    await p.evaluate(() => { Experience.revealAll?.(); RevealDesign?.skip?.(); });
    await p.evaluate(() => { const b = document.querySelector('#revealContinue'); if (b && !b.disabled) b.click(); });

    // Game balance chosen: no funding field.
    await p.waitForFunction(() => !S.v2.revealBatch?.length, null, { timeout: 15000 }).catch(() => {});
    await p.evaluate(() => { S.v2.revealBatch = []; delete S.v2.revealSource; });
    await open(); await p.locator('#tokenCheckoutDialog input[value="balance"]').check();
    assert.doesNotMatch(await p.locator('#checkoutConfirm').innerText(), /Chest/);
    await p.locator('#checkoutConfirm').click(); await p.waitForTimeout(800);
    assert.equal(purchases.length, 2); assert.equal(purchases[1].funding, undefined, 'balance purchases send no funding');
    await p.evaluate(() => { S.v2.revealBatch = []; delete S.v2.revealSource; });

    // Not enough usable chest SR: the chest option is disabled and explains why.
    offer = { enabled: true, chestRyo: 30000, spendableRyo: 10000, nextClaimAt: 0, limitedBy: 'budget' };
    await open();
    assert.equal(await p.locator('#tokenCheckoutDialog input[value="chest"]').isDisabled(), true);
    assert.match(await p.locator('.chest-pay-note').innerText(), /approved Chest reward budget can't cover this purchase/);
    await closeDialog();
    assert.deepEqual(errors, []);
  });
  console.log('PASS: chest spending checkout — "Pay using" choice only with an offer, chest choice shows the remaining chest and the untouched claim timer and sends funding chest once, balance choice unchanged, an insufficient offer disables the chest option with its reason.');
})().catch(e => { console.error(e); process.exitCode = 1; });
