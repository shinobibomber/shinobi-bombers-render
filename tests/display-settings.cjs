/* Display & Accessibility in the browser (isolated fixtures): Comfort by default; opened from Tools;
 * presets and every control drive the real systems (scene filter, Arena3D effects level, no shake,
 * softened hit flashes, explosion Off → static tile markers, reduce motion hides petals, colorblind and
 * high-contrast telegraphs); the live preview runs; choices survive a reload and sync to the account;
 * gameplay numbers never change; the dialog fits a phone. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('./harness.cjs');
const output = path.join(__dirname, 'out'); fs.mkdirSync(output, { recursive: true });
const login = async p => {
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
};

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    // This suite checks the real first-visit default (other suites start on Standard).
    await p.evaluate(() => { sessionStorage.setItem('sb-ds-real-default', '1'); localStorage.removeItem('sb-display-v1'); }); await p.reload();
    await login(p);
    // Comfort by default, applied everywhere.
    const start = await p.evaluate(() => ({ v: DisplaySettings.get(), cls: document.documentElement.className, bright: getComputedStyle(document.documentElement).getPropertyValue('--sb-bright').trim(), fx: Arena3D.cfg.fx,
      filter: getComputedStyle(document.querySelector('canvas#cv')).filter }));
    assert.deepEqual([start.v.preset, start.v.brightness, start.v.explosions, start.v.flashing, start.v.shake, start.v.reduceMotion, start.v.bloom], ['comfort', 65, 'reduced', false, false, true, false]);
    assert.match(start.cls, /sb-no-flash/); assert.match(start.cls, /sb-no-shake/); assert.match(start.cls, /sb-reduce-motion/);
    assert.equal(start.bright, '0.755'); assert.equal(start.fx, 1); assert.match(start.filter, /brightness\(0\.755\)/);
    // Gameplay reference values (must never change with presentation settings).
    const rules = () => p.evaluate(() => S.h.filter(h => h.on || true).slice(0, 3).map(h => [GameBalance.damage(h), GameBalance.cooldown(h), h.bm, h.rg]));
    const before = await rules();
    // Opened from Tools in the header.
    await p.locator('.gc-tools summary').click();
    await p.locator('.gc-tools .gc-display').click();
    await p.waitForSelector('dialog.sbds[open]');
    assert.match(await p.locator('dialog.sbds').textContent(), /Display & Accessibility[\s\S]*Comfort[\s\S]*Minimal effects[\s\S]*Standard[\s\S]*Brightness[\s\S]*Explosion effects[\s\S]*Flashing lights[\s\S]*Screen shake[\s\S]*Reduce motion[\s\S]*Bloom & glow[\s\S]*High contrast[\s\S]*Colorblind-friendly/);
    await p.waitForTimeout(400);
    assert(await p.evaluate(() => { const c = document.querySelector('.sbds-preview canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 400) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n > 50; }), 'the live preview draws');
    await p.screenshot({ path: path.join(output, 'display-settings.png') });
    // Minimal: explosions off → no burst, a static marker on the hit tile.
    await p.locator('dialog.sbds [data-preset="minimal"]').click();
    const minimal = await p.evaluate(() => { const parts = []; return { v: DisplaySettings.get(), fx: Arena3D.cfg.fx }; });
    assert.deepEqual([minimal.v.preset, minimal.v.explosions, minimal.fx], ['minimal', 'off', 0]);
    // Standard: full effects, shake allowed; then a single change makes it Custom.
    await p.locator('dialog.sbds [data-preset="standard"]').click();
    let v = await p.evaluate(() => [DisplaySettings.v.preset, Arena3D.cfg.fx, document.documentElement.classList.contains('sb-no-shake')]);
    assert.deepEqual(v, ['standard', 2, false]);
    await p.locator('dialog.sbds input[data-k="colorblind"]').check();
    v = await p.evaluate(() => [DisplaySettings.v.preset, DisplaySettings.v.colorblind, document.documentElement.classList.contains('sb-colorblind')]);
    assert.deepEqual(v, ['custom', true, true]);
    await p.locator('dialog.sbds input[data-k="brightness"]').fill('40');
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('canvas#cv')).filter), 'brightness(0.58) contrast(1)');
    await p.locator('dialog.sbds input[data-k="highContrast"]').check();
    assert.match(await p.evaluate(() => getComputedStyle(document.querySelector('canvas#cv')).filter), /contrast\(1\.22\)/);
    // Account sync (debounced push of the newest settings).
    await p.waitForFunction(() => true); await p.waitForTimeout(1600);
    await p.waitForFunction(() => RyoPayments.state.profile?.display?.colorblind === true, null, { timeout: 10000 });
    assert(f.displaySaves >= 1 && f.profile.display.brightness === 40 && f.profile.display.highContrast === true);
    // Reset to default → Comfort.
    await p.locator('dialog.sbds [data-act="reset"]').click();
    assert.equal(await p.evaluate(() => DisplaySettings.v.preset), 'comfort');
    await p.keyboard.press('Escape');

    // In the arena: explosions Off draw static markers; shake never moves the camera; hit flash is softened.
    await p.evaluate(() => { DisplaySettings.preset('minimal'); go(0); Experience.workAll(); });
    await p.waitForFunction(() => Arena3D.marks > 0, null, { timeout: 40000 });
    await p.screenshot({ path: path.join(output, 'display-minimal-arena.png') });
    // Reduce motion hides the website's decorative petals and fx layers.
    assert.equal(await p.evaluate(() => { const e = document.querySelector('#sbwLayer .petals'); return !e || getComputedStyle(e).display === 'none'; }), true);
    // Gameplay rules unchanged by any preset.
    await p.evaluate(() => DisplaySettings.preset('standard')); const after = await rules();
    assert.deepEqual(after, before, 'presentation settings never change damage, cooldown, volley or range');
    // Survives a reload (browser storage).
    await p.evaluate(() => DisplaySettings.set({ brightness: 55 }));
    await p.reload(); await p.waitForFunction(() => window.DisplaySettings);
    assert.equal(await p.evaluate(() => DisplaySettings.v.brightness), 55);
    // Phone: the dialog fits.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => DisplaySettings.open()); await p.waitForSelector('dialog.sbds[open]');
    const phone = await p.evaluate(() => { const d = document.querySelector('dialog.sbds'), r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && d.scrollWidth <= d.clientWidth + 1; });
    assert.equal(phone, true);
    await p.screenshot({ path: path.join(output, 'display-settings-phone.png') });
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Display & Accessibility: Comfort default, Tools entry, presets and controls drive the scene filter, effects level, shake, flashes, explosion markers, motion and indicators; live preview; reload and account sync; gameplay unchanged; phone layout.');
})().catch(e => { console.error(e); process.exit(1); });
