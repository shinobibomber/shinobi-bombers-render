/* Dojo Services hub follows the signed-in server profile live (tier, Sensei hired, rented,
 * expired, rotation off) and every value fits its artwork slot. Isolated fixtures only. */
const { withGame } = require('./harness.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    f.profile = { ...f.profile, dojo: 2, sensei: false, senseiRentalUntil: Date.now() + 3 * 3600000 + 60000, senseiEnabled: true };
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    await p.evaluate(() => go(4)); await p.waitForFunction(() => WebsiteDesign.current() === 'dojo');
    const read = () => p.evaluate(() => {
      const q = c => document.querySelector('.sbw-scr.on .' + c), fits = e => e.scrollWidth <= e.clientWidth + 1;
      return { tier: q('sbw-dpill').textContent, name: q('sbw-dname').textContent, rate: q('sbw-dval').textContent, lvl: document.querySelectorAll('.sbw-scr.on .sbw-dval')[1].textContent,
        rot: q('sbw-drot').textContent, fit: [...document.querySelectorAll('.sbw-scr.on .sbw-dsvc')].filter(e => !fits(e)).map(e => e.className + ':' + e.scrollWidth + '/' + e.clientWidth).join() || true };
    });
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on .sbw-drot')?.textContent.startsWith('ON'));
    assert.deepEqual(await read(), { tier: 'TIER II', name: 'SHINOBI DOJO', rate: '5/min', lvl: '2/6', rot: 'ON · 3h left', fit: true });
    // The rental ends while the page stays open: it must flip without a profile refresh.
    await p.evaluate(() => { RyoPayments.state.profile.senseiRentalUntil = Date.now() + 1200; });
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on .sbw-drot')?.textContent === 'NOT HIRED', null, { timeout: 4000 });
    // Permanent Sensei with rotation turned off, and a higher tier, from the next server profile.
    await p.evaluate(() => Object.assign(RyoPayments.state.profile, { sensei: true, senseiEnabled: false, dojo: 6 }));
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on .sbw-drot')?.textContent === 'OFF');
    const top = await read();
    assert.equal(top.tier, 'TIER VI'); assert.equal(top.name, 'LEGENDARY DOJO'); assert.equal(top.lvl, '6/6'); assert.equal(top.fit, true, 'long names still fit their slot');
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Dojo Services shows the server tier, rented Sensei time, live rental expiry and rotation state, all within their artwork slots.');
})().catch(error => { console.error(error); process.exitCode = 1; });
