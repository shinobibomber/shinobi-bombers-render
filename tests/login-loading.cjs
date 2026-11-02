/* Login/loading presentation against the existing isolated wallet and game startup. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('./harness.cjs');
const output = path.join(__dirname, 'out');
fs.mkdirSync(output, { recursive: true });
const mutations = new Set(['purchase', 'deposit', 'withdraw', 'claim-adventure', 'spend']);
const signedIn = p => p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active);

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    await p.setViewportSize({ width: 1536, height: 1024 });
    await p.evaluate(() => LoginDesign.ready);
    assert.equal(await p.evaluate(() => BetaWallet.state.account), null, 'startup does not connect a wallet');
    assert.equal(f.loginSerial, 0, 'startup does not request a signature or authenticate');
    assert.equal(await p.locator('[data-gc-chest]').count(), 0, 'no authenticated Chest on login');
    const art = await p.locator('.login-reference-art').evaluate(image => ({ src: image.src, w: image.naturalWidth, h: image.naturalHeight, box: image.getBoundingClientRect().toJSON() }));
    assert.match(art.src, /assets\/login-exact\/login-reference\.png$/);
    assert.deepEqual([art.w, art.h], [1536, 1024]);
    assert.deepEqual([art.box.x, art.box.y, art.box.width, art.box.height], [0, 0, 1536, 1024], 'desktop preserves the reference aspect and full artwork');
    for (const [id, expected] of [['loginPhantom', [503, 500, 530, 72]], ['loginSolflare', [503, 589, 530, 71]]]) {
      const box = await p.locator('#' + id).boundingBox();
      for (const [index, key] of ['x', 'y', 'width', 'height'].entries()) assert(Math.abs(box[key] - expected[index]) <= 3, id + ' aligns with the supplied artwork: ' + key);
    }
    assert.equal(await p.locator('#loginScreen [data-community="discord"]').getAttribute('href'), 'https://discord.gg/shinobi-fixture');
    assert(await p.locator('#loginScreen [data-community="x"]').isDisabled(), 'an unconfigured community destination is not invented');
    const desktop = await p.screenshot({ path: path.join(output, 'login-desktop.png'), scale: 'css' });
    const changedPixels = await p.evaluate(async encoded => {
      const captured = new Image(); captured.src = 'data:image/png;base64,' + encoded; await captured.decode();
      const source = document.querySelector('.login-reference-art');
      const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 1024;
      const context = canvas.getContext('2d'); context.drawImage(source, 0, 0);
      const expected = context.getImageData(0, 0, 1536, 1024).data;
      context.drawImage(captured, 0, 0); const actual = context.getImageData(0, 0, 1536, 1024).data;
      let changed = 0;
      for (let i = 0; i < expected.length; i += 4) if ([0, 1, 2].some(channel => Math.abs(expected[i + channel] - actual[i + channel]) > 1)) changed++;
      return changed;
    }, desktop.toString('base64'));
    assert.equal(changedPixels, 0, 'desktop login matches every pixel of the supplied artwork before interaction');

    for (const width of [390, 320]) {
      await p.setViewportSize({ width, height: 844 });
      const geometry = await p.locator('#loginScreen').evaluate(screen => ({ scroll: screen.scrollWidth, client: screen.clientWidth }));
      assert(geometry.scroll <= geometry.client + 1, 'portrait login has no horizontal overflow');
      for (const id of ['loginPhantom', 'loginSolflare']) {
        const box = await p.locator('#' + id).boundingBox();
        assert(box.height >= 44 && box.width >= 44, id + ' remains a usable touch target at ' + width);
        assert(box.x >= 0 && box.x + box.width <= width + 1, id + ' remains within the viewport');
      }
      await p.screenshot({ path: path.join(output, width === 390 ? 'login-mobile.png' : 'login-small-mobile.png'), scale: 'css' });
    }
    await p.locator('#loginPhantom').focus();
    await p.keyboard.press('Tab');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'loginSolflare', 'keyboard moves between the real wallet buttons');
    assert.notEqual(await p.locator('#loginSolflare').evaluate(button => getComputedStyle(button).outlineStyle), 'none', 'keyboard focus is visible');
    await p.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await p.locator('#loginScreen').evaluate(screen => screen.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0);

    await p.evaluate(() => {
      window.testLoginCalls = { providers: [], signatures: 0, recovery: 0, reject: true };
      const connect = BetaWallet.connect, sign = BetaWallet.signLogin, recover = BetaWallet.recoverPending;
      BetaWallet.connect = async kind => { testLoginCalls.providers.push(kind); return connect(kind); };
      BetaWallet.signLogin = async (...args) => { testLoginCalls.signatures++; if (testLoginCalls.reject) throw Error('Signature request rejected by player.'); return sign(...args); };
      BetaWallet.recoverPending = async (...args) => { testLoginCalls.recovery++; return recover(...args); };
    });
    await p.evaluate(() => { document.getElementById('loginPhantom').click(); document.getElementById('loginPhantom').click(); });
    await p.waitForFunction(() => document.getElementById('loginMessage').textContent.includes('rejected') && !document.getElementById('loginPhantom').disabled);
    assert.deepEqual(await p.evaluate(() => testLoginCalls.providers), ['phantom'], 'rapid clicks retain the native login guard');
    assert.equal(await p.evaluate(() => testLoginCalls.signatures), 1);
    assert.equal(f.loginSerial, 0, 'rejected signature never authenticates');
    assert(await p.locator('#loginMessage').isVisible(), 'signature refusal remains readable');
    await p.screenshot({ path: path.join(output, 'login-rejected-mobile.png'), scale: 'css' });
    await p.evaluate(() => { testLoginCalls.reject = false; });
    await p.locator('#loginSolflare').click();
    await signedIn(p);
    assert.deepEqual(await p.evaluate(() => testLoginCalls.providers), ['phantom', 'solflare'], 'provider selection reaches the existing native login handler');
    assert.equal(await p.evaluate(() => testLoginCalls.signatures), 2);
    assert(await p.evaluate(() => testLoginCalls.recovery > 0), 'successful login retains native pending recovery');
    assert.equal(f.loginSerial, 1);
    assert.equal(f.balance, 500000, 'signature login does not move Ryo');
    assert.equal(f.requests.filter(request => mutations.has(request.action)).length, 0, 'login makes no financial requests');
    await p.evaluate(() => BetaWallet.disconnect());
    await p.waitForFunction(() => LoginScreen.active && !document.getElementById('loginScreen').hidden);
    assert.equal(await p.evaluate(() => testLoginCalls.signatures), 2, 'disconnect does not silently sign back in');
    assert.deepEqual(errors, []);
    console.log('PASS: exact login artwork/control alignment, touch and keyboard access, both native wallet buttons, refusal/retry, native recovery and zero financial actions.');
  });

  await withGame(async ({ p, f, errors, assert }) => {
    await p.setViewportSize({ width: 1536, height: 1024 });
    await p.addInitScript(() => {
      // A controllable font milestone proves that startup waits for real work.
      Object.defineProperty(document.fonts, 'ready', { value: new Promise(resolve => { window.releaseTestFonts = resolve; }) });
    });
    let releaseArt;
    const holdLoginArt = async route => { await new Promise(resolve => { releaseArt = resolve; }); await route.fallback(); };
    await p.route('**/assets/login-exact/login-reference.png', holdLoginArt);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelector('.loading-reference-art')?.naturalWidth === 1536 && document.getElementById('loadingPercent')?.textContent === '33%');
    assert.equal(await p.evaluate(() => GameLoading.active), true);
    assert.equal(await p.evaluate(() => document.querySelector('main').inert), true);
    assert.equal(await p.evaluate(() => LoginScreen.active), false, 'login stays gated until its art is ready');
    await p.evaluate(() => {
      const progress = document.getElementById('loadingProgress');
      window.testLoadingSteps = [Number(progress.getAttribute('aria-valuenow'))];
      new MutationObserver(() => testLoadingSteps.push(Number(progress.getAttribute('aria-valuenow')))).observe(progress, { attributes: true, attributeFilter: ['aria-valuenow'] });
    });
    const actualPercent = await p.locator('#loadingProgress').evaluate(progress => Math.round(Number(progress.getAttribute('aria-valuenow')) / Number(progress.getAttribute('aria-valuemax')) * 100) + '%');
    assert.equal(await p.locator('#loadingPercent').textContent(), actualPercent, 'visible percentage follows completed native milestones');
    await p.screenshot({ path: path.join(output, 'loading-desktop.png'), scale: 'css' });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.screenshot({ path: path.join(output, 'loading-mobile.png'), scale: 'css' });
    assert.equal(await p.locator('#gameLoading').evaluate(screen => screen.scrollWidth > screen.clientWidth + 1), false);
    await p.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await p.locator('#gameLoading').evaluate(screen => screen.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0, 'reduced motion stops loading decoration');
    releaseArt();
    await p.waitForFunction(() => document.getElementById('loadingPercent')?.textContent === '67%');
    assert.equal(await p.evaluate(() => GameLoading.active), true, 'fonts must finish before native completion');
    await p.evaluate(() => releaseTestFonts());
    await p.evaluate(() => GameLoading.ready);
    assert.equal(await p.evaluate(() => GameLoading.active), false);
    assert.deepEqual(await p.evaluate(() => [...new Set(testLoadingSteps)]), [1, 2, 3], 'real milestones finish in order');
    await p.unroute('**/assets/login-exact/login-reference.png', holdLoginArt);

    let failLoadingArt = true;
    await p.route('**/assets/loading-design/loading-reference.png', route => failLoadingArt ? route.abort() : route.fallback());
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#gameLoading.loading-failed');
    assert.equal(await p.evaluate(() => GameLoading.active), true, 'failed required art cannot claim startup success');
    assert.equal(await p.evaluate(() => LoginScreen.active), false);
    assert(await p.locator('#loadingRetry').isVisible(), 'missing required art exposes retry');
    assert.notEqual(await p.locator('#loadingPercent').textContent(), '100%');
    await p.screenshot({ path: path.join(output, 'loading-error-mobile.png'), scale: 'css' });
    failLoadingArt = false;
    await Promise.all([p.waitForNavigation({ waitUntil: 'domcontentloaded' }), p.locator('#loadingRetry').click()]);
    await p.waitForFunction(() => typeof releaseTestFonts === 'function');
    await p.evaluate(() => releaseTestFonts());
    await p.evaluate(() => GameLoading.ready);
    assert.equal(await p.evaluate(() => LoginScreen.active), true, 'retry resumes the existing login transition');
    assert.equal(await p.evaluate(() => BetaWallet.state.account), null);
    assert.equal(f.loginSerial, 0);
    assert.equal(f.requests.filter(request => mutations.has(request.action) || ['login', 'challenge'].includes(request.action)).length, 0, 'loading/retry never authorizes or moves funds');
    assert.deepEqual(errors, []);
    console.log('PASS: startup waits for required artwork and fonts, reports actual milestones, handles art failure/retry, and respects reduced motion without wallet activity.');
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
