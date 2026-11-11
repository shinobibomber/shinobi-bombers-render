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
    assert.match(art.src, /assets\/login-exact\/login-reference\.webp$/);
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
    await p.waitForFunction(() => document.getElementById('loginMessage').textContent.startsWith('Sign-in cancelled in your wallet.') && !document.getElementById('loginPhantom').disabled);   // a rejection shows the friendly message (apply-signin.cjs), not the raw wallet error
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
    // First paint, before deferred scripts run: a compact card with no artwork to download, and the
    // login art (not a loading illustration) is the one preloaded image.
    let releasePresentation;
    const holdPresentation = async route => { await new Promise(resolve => { releasePresentation = resolve; }); await route.fallback(); };
    await p.route('**/assets/loading-design/loading-design.js', holdPresentation);
    await p.reload({ waitUntil: 'commit' });
    await p.waitForFunction(() => document.querySelector('#gameLoading .loading-card') && typeof LoadingDesign === 'undefined');
    assert.equal(await p.locator('#gameLoading img, #gameLoading .loading-emblem').count(), 0, 'the startup card downloads no artwork');
    assert.match(await p.locator('#enhanced-startup-preload').getAttribute('href'), /login-exact\/login-reference\.webp$/, 'the login art is preloaded first');
    assert.equal(await p.locator('#gameLoading').evaluate(screen => getComputedStyle(screen).display), 'grid', 'critical card CSS is present before hydration');
    await p.screenshot({ path: path.join(output, 'loading-first-paint.png'), scale: 'css' });
    releasePresentation();
    await p.evaluate(() => GameLoading.ready);
    await p.unroute('**/assets/loading-design/loading-design.js', holdPresentation);

    // Login first: with a game sprite sheet and the fonts still loading, the login screen is already up.
    await p.addInitScript(() => {
      Object.defineProperty(document.fonts, 'ready', { value: new Promise(resolve => { window.releaseTestFonts = resolve; }) });
    });
    let releaseSprites;
    const holdSprites = async route => { await new Promise(resolve => { releaseSprites = resolve; }); await route.fallback(); };
    await p.route('**/assets/design-v3/terrain.webp', holdSprites);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => LoginScreen.active);
    assert.equal(await p.evaluate(() => GameLoading.active), true, 'the game is still preparing behind the login screen');
    assert.equal(await p.evaluate(() => document.querySelector('main').inert), true, 'the game stays inert behind login');
    assert.equal(await p.locator('#gameLoading').evaluate(screen => getComputedStyle(screen).display), 'none', 'no loading card covers the login screen');
    // Signing in before the game is ready shows the progress card until it is.
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !LoginScreen.active);
    assert.equal(await p.locator('#gameLoading').evaluate(screen => getComputedStyle(screen).display), 'grid', 'the progress card shows after sign-in while the game prepares');
    const actualPercent = await p.locator('#loadingProgress').evaluate(progress => Math.round(Number(progress.getAttribute('aria-valuenow')) / Number(progress.getAttribute('aria-valuemax')) * 100) + '%');
    assert.equal(await p.locator('#loadingPercent').textContent(), actualPercent, 'visible percentage follows completed native milestones');
    const fill = await p.locator('#loadingProgress i').evaluate(element => ({ property: getComputedStyle(element).transitionProperty, width: element.style.width }));
    assert.equal(fill.property, 'transform', 'progress animates a compositor transform rather than layout width');
    assert.equal(fill.width, '');
    await p.screenshot({ path: path.join(output, 'loading-after-sign-in.png'), scale: 'css' });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.screenshot({ path: path.join(output, 'loading-mobile.png'), scale: 'css' });
    assert.equal(await p.locator('#gameLoading').evaluate(screen => screen.scrollWidth > screen.clientWidth + 1), false);
    await p.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await p.locator('#gameLoading').evaluate(screen => screen.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0, 'reduced motion stops loading decoration');
    releaseSprites();
    await p.waitForFunction(() => document.getElementById('loadingPercent')?.textContent === '67%');
    assert.equal(await p.evaluate(() => GameLoading.active), true, 'fonts must finish before native completion');
    await p.evaluate(() => releaseTestFonts());
    await p.evaluate(() => GameLoading.ready);
    await p.waitForFunction(() => !GameLoading.active && !document.getElementById('gameLoading'));
    assert.equal(await p.evaluate(() => LoginScreen.active), false, 'finishing startup does not pop the login back up');
    await p.waitForFunction(() => window.WebsiteDesign?.current() && !document.body.classList.contains('at-login'));
    await p.unroute('**/assets/design-v3/terrain.webp', holdSprites);
    await p.evaluate(() => BetaWallet.disconnect());
    await p.waitForFunction(() => LoginScreen.active);

    // The login art failing to load stops at a retry, without claiming success or touching the wallet.
    const signIns = f.loginSerial;
    let failLoginArt = true;
    await p.route('**/assets/login-exact/login-reference.webp', route => failLoginArt ? route.abort() : route.fallback());
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#gameLoading.loading-failed');
    assert.equal(await p.evaluate(() => GameLoading.active), true, 'failed required art cannot claim startup success');
    assert.equal(await p.evaluate(() => LoginScreen.active), false);
    assert(await p.locator('#loadingRetry').isVisible(), 'missing required art exposes retry');
    assert.notEqual(await p.locator('#loadingPercent').textContent(), '100%');
    await p.screenshot({ path: path.join(output, 'loading-error-mobile.png'), scale: 'css' });
    failLoginArt = false;
    await Promise.all([p.waitForNavigation({ waitUntil: 'domcontentloaded' }), p.locator('#loadingRetry').click()]);
    await p.waitForFunction(() => LoginScreen.active);
    await p.evaluate(() => releaseTestFonts());
    await p.evaluate(() => GameLoading.ready);
    assert.equal(await p.evaluate(() => LoginScreen.active), true, 'retry resumes the login screen');
    assert.equal(f.loginSerial, signIns, 'loading/retry never signs in');
    assert.equal(f.requests.filter(request => mutations.has(request.action)).length, 0, 'loading/retry never moves funds');
    assert.deepEqual(errors, []);
    console.log('PASS: login shows as soon as its artwork is ready while the game prepares behind it, a compact progress card covers only signed-in waiting, real milestones, art failure/retry, reduced motion and no wallet activity.');
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
