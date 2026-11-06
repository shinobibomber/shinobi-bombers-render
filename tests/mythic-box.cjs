/* Limited Mythic NFT Box in the browser (isolated fixtures, fake wallet adapter): the home EVENT card
 * (price and supply left), the box dialog (perks, 10% discount scope, 20 pcs, 1 SOL / 1.5 SOL, max 2),
 * minting (wallet signs the server's transaction, then confirmation), Tsukiyomi arriving with the
 * 10% purchase discount, the 2-per-wallet limit, and the phone layout. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('./harness.cjs');
const output = path.join(__dirname, 'out'); fs.mkdirSync(output, { recursive: true });
const login = async p => {
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
};

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.box = { sold: 2, supply: 20 };
    await login(p);
    await p.evaluate(() => go(5)); await p.waitForFunction(() => WebsiteDesign.current() === 'home');
    // Event card over the printed banner, with the live supply.
    await p.waitForFunction(() => /18 \/ 20 left/.test(document.querySelector('.sbw-scr.on .sbw-boxcard em')?.textContent || ''), null, { timeout: 15000 });
    const card = await p.locator('.sbw-scr.on .sbw-boxcard').textContent();
    assert.match(card, /MYTHIC NFT BOX[\s\S]*Tsukiyomi 7★ · 10% off[\s\S]*1 SOL · 18 \/ 20 left/);
    await p.screenshot({ path: path.join(output, 'mythic-box-home.png') });
    // Pressing the event opens the box: description, perks, supply and price.
    await p.locator('.sbw-scr.on [data-sbwid="ev"]').click(); await p.waitForSelector('.sbw-boxdlg[open]');
    await p.waitForFunction(() => /18 of 20 left/.test(document.querySelector('.sbw-boxdlg')?.textContent || ''));
    const text = (await p.evaluate(() => document.querySelector('.sbw-boxdlg').innerText)).replace(/\s+/g, ' ');
    for (const re of [/LIMITED MYTHIC NFT BOX/, /EXCLUSIVE INITIAL INVESTOR OFFER/, /7-STAR MYTHIC HERO \+ MYTHIC AURA/, /Tsukiyomi ?★★★★★★★/, /10% DISCOUNT ON ALL IN-GAME PURCHASES/,
      /Included: Summon, Fusion, Dojo, Sensei, Training/, /Not included: Marketplace transactions, Boss Hunt entrance fee/, /LIMITED SUPPLY · 20 PCS ONLY/, /◎ 1 SOL/, /Max 2 per wallet · a 2nd box is 1\.5 SOL/, /Solana Devnet/, /MINT NOW/])
      assert.match(text, re);
    assert.equal(await p.evaluate(() => S.h.some(h => h.r === 5)), false);
    await p.screenshot({ path: path.join(output, 'mythic-box-dialog.png') });
    // Mint: the wallet signs the server's transaction (fake adapter), then the box is confirmed.
    await p.evaluate(() => { window.__signed = []; MythicBox.wallet = { async signAndSend(wire, expect) { __signed.push({ wire, ...expect }); return '5'.repeat(88); } }; });
    await p.locator('.sbw-boxdlg [data-k="mint"]').click();
    await p.waitForFunction(() => /Mythic NFT Box #3 minted/.test(document.querySelector('.sbw-boxdlg .bx-msg.ok')?.textContent || ''), null, { timeout: 20000 });
    const signed = await p.evaluate(() => __signed);
    assert.deepEqual([signed.length, signed[0].wire, signed[0].price, signed[0].owner], [1, 'FIXTURE-WIRE', 1, await p.evaluate(() => RyoPayments.state.account)]);
    await p.waitForFunction(() => S.h.some(h => h.r === 5) && /◎ 1\.5 SOL/.test(document.querySelector('.sbw-boxdlg').textContent));
    assert.match(await p.locator('.sbw-boxdlg').textContent(), /Your 2nd box: 1 SOL \+ 0\.5 SOL[\s\S]*Your boxes: #3/);
    // The 10% holder discount reaches the purchase quote.
    const q = await p.evaluate(() => RyoPayments.quote('summon', { quantity: 1 }));
    assert.equal(q.total, 22500, 'holders pay 10% less'); assert.match(q.title, /Mythic −10%/);
    // Second box at 1.5 SOL, then the wallet limit.
    await p.locator('.sbw-boxdlg [data-k="mint"]').click();
    await p.waitForFunction(() => /Mythic NFT Box #4 minted/.test(document.querySelector('.sbw-boxdlg .bx-msg.ok')?.textContent || ''), null, { timeout: 20000 });
    assert.equal((await p.evaluate(() => __signed))[1].price, 1.5);
    const limit = await p.evaluate(() => { const b = document.querySelector('.sbw-boxdlg [data-k="mint"]'); return [b.disabled, b.textContent]; });
    assert.deepEqual(limit, [true, 'Limit reached (2)']);
    await p.keyboard.press('Escape');
    // Phone: the event card stays in the Events panel and the dialog fits.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForFunction(() => document.getElementById('sbwLayer').classList.contains('sbw-phone'));
    await p.locator('.sbw-scr.on .sbw-boxcard').scrollIntoViewIfNeeded();
    const phoneCard = await p.evaluate(() => { const r = document.querySelector('.sbw-scr.on .sbw-boxcard').getBoundingClientRect(); return r.width > 200 && r.left >= 0 && r.right <= innerWidth + 1; });
    assert.equal(phoneCard, true);
    await p.screenshot({ path: path.join(output, 'mythic-box-phone-home.png') });
    await p.locator('.sbw-scr.on [data-sbwid="ev"]').click(); await p.waitForSelector('.sbw-boxdlg[open]');
    const fits = await p.evaluate(() => { const d = document.querySelector('.sbw-boxdlg'); return d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= innerWidth + 1; });
    assert.equal(fits, true, 'the box dialog fits a phone');
    await p.screenshot({ path: path.join(output, 'mythic-box-phone.png') });
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Mythic Box event card (price, supply left), box dialog (perks, 10% discount scope, 20 pcs, 1 / 1.5 SOL, max 2), mint through the wallet with confirmation, Tsukiyomi and the 10% discount for the holder, the wallet limit, and phone layout.');
})().catch(e => { console.error(e); process.exit(1); });
