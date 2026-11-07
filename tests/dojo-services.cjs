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
    // Cards stay still so the value patches stay aligned; buttons never scale over the card's printed copy.
    const motion = await p.evaluate(async () => { const seen = new Set(); for (let i = 0; i < 6; i++) { for (const id of ['dcard', 'scard', 'enter', 'msen']) seen.add(id + ':' + getComputedStyle(document.querySelector('.sbw-scr.on .hs[data-sbwid="' + id + '"] > .sl')).transform); await new Promise(r => setTimeout(r, 500)); } return [...seen]; });
    assert.deepEqual(motion.sort(), ['dcard:none', 'enter:none', 'msen:none', 'scard:none'], 'Dojo cards and their buttons never move or scale');
    assert.deepEqual(await read(), { tier: 'TIER II', name: 'SHINOBI DOJO', rate: '5/min', lvl: '2/6', rot: 'ON · 3h left', fit: true });
    // The rental ends while the page stays open: it must flip without a profile refresh.
    // Keep the simulated server authoritative too: a late display-settings/state
    // response must not restore the fixture's old three-hour rental during this check.
    const rentalUntil = Date.now() + 1200;
    f.profile.senseiRentalUntil = rentalUntil;
    await p.evaluate(until => { RyoPayments.state.profile.senseiRentalUntil = until; }, rentalUntil);
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on .sbw-drot')?.textContent === 'NOT HIRED', null, { timeout: 4000 });
    // Sensei page without a Sensei: the locked chakra selector stays opaque so the artwork's printed
    // dropdown never ghosts through it (Chromium dims disabled selects to 70% by default).
    await p.locator('.sbw-scr.on [data-sbwid="msen"]').click(); await p.waitForFunction(() => WebsiteDesign.current() === 'dojo-sen');
    const locked = () => p.locator('.sbw-scr.on .sbw-dsel').evaluate(e => { const s = getComputedStyle(e); return { disabled: e.disabled, opacity: s.opacity, solid: /rgb\(11, 24, 48\)$/.test(s.backgroundColor), lock: /rect/.test(s.backgroundImage), hint: !!e.title }; });
    assert.deepEqual(await locked(), { disabled: true, opacity: '1', solid: true, lock: true, hint: true }, 'an unhired Sensei shows an opaque locked selector');
    await p.evaluate(() => { RyoPayments.state.profile.sensei = true; });
    await p.waitForFunction(() => !document.querySelector('.sbw-scr.on .sbw-dsel').disabled);
    assert.deepEqual(await locked(), { disabled: false, opacity: '1', solid: true, lock: false, hint: false }, 'hiring unlocks the selector');
    await p.evaluate(() => { RyoPayments.state.profile.sensei = false; }); await p.locator('.sbw-scr.on .sbw-dback button').click(); await p.waitForFunction(() => WebsiteDesign.current() === 'dojo');
    // Permanent Sensei with rotation turned off, and a higher tier, from the next server profile.
    await p.evaluate(() => Object.assign(RyoPayments.state.profile, { sensei: true, senseiEnabled: false, dojo: 6 }));
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on .sbw-drot')?.textContent === 'OFF');
    const top = await read();
    assert.equal(top.tier, 'TIER VI'); assert.equal(top.name, 'LEGENDARY DOJO'); assert.equal(top.lvl, '6/6'); assert.equal(top.fit, true, 'long names still fit their slot');
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Dojo Services shows the server tier, rented Sensei time, live rental expiry and rotation state, all within their artwork slots.');
})().catch(error => { console.error(error); process.exitCode = 1; });
