'use strict';
// Actual sale-page rendering with deterministic API responses; no wallet/RPC/network calls.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'prelaunch/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    let prelaunch = true, soldOut = false, mintCalls = 0;
    const response = () => ({ founders: { wallet: 'fixture-wallet', eligible: true, mode: 'public', paused: false, mine: null,
      tiers: Object.fromEntries(['mythic', 'legacy'].map(tier => [tier, { price: prelaunch ? (tier === 'mythic' ? 0.7 : 0.25) : (tier === 'mythic' ? 1 : 0.5), regularPrice: tier === 'mythic' ? 1 : 0.5,
        prelaunchOffer: prelaunch, remaining: soldOut ? 0 : 20, supply: tier === 'mythic' ? 33 : 30, soldOut }])) } });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/prelaunch') {
        const body = route.request().postDataJSON();
        if (body.action === 'founders-mint') {
          mintCalls++;
          const data = response();
          data.purchase = { requestId: body.requestId, tier: body.tier, status: 'pending', price: data.founders.tiers[body.tier].price, wire: 'AA==' };
          data.founders.mine = data.purchase;
          return route.fulfill({ json: data });
        }
        return route.fulfill({ json: response() });
      }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname.startsWith('/pl/')) {
        const file = path.resolve(root, 'prelaunch', url.pathname.slice(4));
        if (file.startsWith(path.join(root, 'prelaunch') + path.sep) && fs.existsSync(file)) return route.fulfill({ path: file });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('https://pricing.example/');
    await page.addScriptTag({ path: path.join(root, 'prelaunch/founders.js') });
    const translate = async lang => {
      const messages = JSON.parse(fs.readFileSync(path.join(root, 'prelaunch/i18n', lang + '.json'), 'utf8'));
      await page.evaluate(({ lang, messages }) => {
        document.documentElement.lang = lang;
        for (const el of document.querySelectorAll('[data-i18n]')) if (typeof messages[el.dataset.i18n] === 'string') el.textContent = messages[el.dataset.i18n];
        for (const el of document.querySelectorAll('[data-i18n-list]')) if (Array.isArray(messages[el.dataset.i18nList])) el.replaceChildren(...messages[el.dataset.i18nList].map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
      }, { lang, messages });
      await page.evaluate(() => window.FoundersBox.refresh());
    };
    for (const lang of ['en', 'pt-BR']) {
      prelaunch = true; soldOut = false; await translate(lang);
      for (const [tier, price] of [['mythic', '0.7'], ['legacy', '0.25']]) {
        assert(await page.locator('#fdEarly-' + tier).isVisible());
        assert((await page.locator('#fdEarly-' + tier).textContent()).includes(price + ' SOL'));
        assert((await page.locator('#fdBuy-' + tier).textContent()).includes(price + ' SOL'));
      }
      for (const width of [1100, 390]) {
        await page.setViewportSize({ width, height: 850 });
        const cards = page.locator('.fd-cards'); await cards.scrollIntoViewIfNeeded();
        assert.equal(await cards.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'cards fit at ' + width);
        fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
        await cards.screenshot({ path: path.join(__dirname, 'out', 'founders-pricing-' + lang + '-' + width + '.png') });
      }
      prelaunch = false; await page.evaluate(() => window.FoundersBox.refresh());
      for (const [tier, price] of [['mythic', '1'], ['legacy', '0.5']]) {
        assert.equal(await page.locator('#fdEarly-' + tier).isVisible(), false);
        assert((await page.locator('#fdBuy-' + tier).textContent()).includes(price + ' SOL'));
      }
      prelaunch = true; soldOut = true; await page.evaluate(() => window.FoundersBox.refresh());
      for (const tier of ['mythic', 'legacy']) {
        assert(await page.locator('#fdBuy-' + tier).isDisabled());
        assert.equal(await page.locator('#fdEarly-' + tier).isVisible(), false);
      }
    }
    // The page still shows the discount when the server switches to public prices.
    prelaunch = true; soldOut = false; await translate('en');
    prelaunch = false;
    await page.locator('#fdBuy-mythic').click();
    await page.waitForFunction(() => document.querySelector('#fdStatus').textContent.includes('The offer has changed'));
    assert.equal(mintCalls, 1);
    assert((await page.locator('#fdBuy-mythic').textContent()).includes('Approve in wallet · 1 SOL'));
    assert((await page.locator('#fdStatus').textContent()).includes('Nothing was charged'));
    // The intentionally invalid wire was never decoded and no wallet signer was needed.
    console.log('PASS: English/Portuguese sale banners and checkout amounts before/after public launch, desktop/mobile fit, sold-out controls, and stale-price buyer confirmation.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
