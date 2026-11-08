/* Hero training (max level 5): real checkout through the game, the server's +1 gains reach the
 * battle stats, the new price table, the gain toast, and Max level at 5. Isolated fixtures only. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');

const hero = (id, rank, level, base) => ({ tokenId: id, rank, level, name: 'Trainee ' + id, baseStats: { pw: base, sp: base, st: base } });
const login = async p => {
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
};
const find = (p, id) => p.evaluate(id => { const h = S.h.find(h => h.tokenId === id); return h && { lv: h.lv, pw: h.pw, sp: h.sp, st: h.st, bonus: h.bonus, cost: GameBalance.trainingCost(h) }; }, id);
const train = async (p, id) => {
  // up() resolves only after the checkout closes, so start it without waiting for it.
  await p.evaluate(id => { up(S.h.findIndex(h => h.tokenId === id)); }, id);
  await p.locator('.hero-upgrade-dialog button').filter({hasText:/^Upgrade/}).click();
  await p.waitForSelector('#checkoutConfirm', { state: 'visible' });
  await p.locator('#checkoutConfirm').click();
};

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.balance = 2000000;
    // A Lv7 Jonin from the old 10-level system arrives converted to Lv5 with five +1s.
    f.profile = economy.normalizeProfile({ ...f.profile, upgradeShards:30, battleReady: [], heroes: [hero('genin', 0, 1, 2), hero('chunin', 1, 1, 4), hero('legend', 4, 4, 13), hero('old-jonin', 2, 7, 7), hero('spare', 0, 1, 1)] });
    await login(p);
    await p.waitForFunction(() => ['genin', 'chunin', 'legend', 'old-jonin'].every(id => S.h.some(h => h.tokenId === id)));
    // Prices: step price × rank (Genin 1, Chunin 1.5, Legend 3).
    assert.equal((await find(p, 'genin')).cost, 10000);
    assert.equal((await find(p, 'chunin')).cost, 15000);
    assert.equal((await find(p, 'legend')).cost, 240000, 'Lv4→5 Legend: 80,000 × 3');
    const old = await find(p, 'old-jonin');
    assert.equal(old.lv, 5); assert.equal(old.bonus.pw + old.bonus.sp + old.bonus.st, 5, 'old training converts to five +1s');
    assert.deepEqual([old.pw, old.sp, old.st], [7 + old.bonus.pw, 7 + old.bonus.sp, 7 + old.bonus.st], 'battle stats are base + training');

    // Training a Genin through the real checkout: +1 Power, Lv 2, and a toast naming the gain.
    const before = await find(p, 'genin'), paid = f.balance;
    await train(p, 'genin');
    await p.waitForFunction(() => /Training complete · Lv 2 · \+1 Power/.test(document.getElementById('toast').textContent));
    const after = await find(p, 'genin');
    assert.deepEqual([after.lv, after.pw, after.sp, after.st], [2, before.pw + 1, before.sp, before.st], 'a Genin level-up adds exactly +1 Power');
    assert.equal(paid - f.balance, 10000, 'charged the step price (2% studio share included)');
    assert.equal(after.cost, 20000, 'the next step costs 20,000');

    // Legend Lv4→5: two +1s, then Max level.
    const legendBefore = await find(p, 'legend');
    await train(p, 'legend');
    await p.waitForFunction(() => /Training complete · Lv 5 · /.test(document.getElementById('toast').textContent));
    const legend = await find(p, 'legend');
    assert.equal(legend.lv, 5);
    assert.equal((legend.pw - legendBefore.pw) + (legend.sp - legendBefore.sp) + (legend.st - legendBefore.st), 2, 'Lv4→5 gives two +1s');
    await p.evaluate(() => go(1));
    const button = await p.evaluate(() => { const i = S.h.findIndex(h => h.tokenId === 'legend'), b = document.querySelector(`#p1 button[onclick="up(${i})"]`); return b && { text: b.textContent, disabled: b.disabled }; });
    assert.deepEqual(button, { text: 'Max level', disabled: true }, 'level 5 is the maximum');
    assert.match(await p.evaluate(() => document.getElementById('p1').textContent), /5\/5/, 'levels read x/5');
    // Website Heroes screen (rarest first, so the Legend is selected): Lv. 5 / 5 and a MAX LEVEL
    // label that fits inside its button.
    await p.locator('.sbw-hdr [data-sbwid="nav-heroes"]').click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'heroes' && document.querySelector('.sbw-xbtn.train'));
    const detail = await p.evaluate(() => { const s = document.querySelector('.sbw-xbtn.train span'); return { max: s.parentElement.classList.contains('max'), fits: s.scrollWidth <= s.clientWidth + .5, level: document.querySelector('.sbw-h2-top p').textContent.replace(/\s+/g, ' ') }; });
    assert.deepEqual({ max: detail.max, fits: detail.fits }, { max: true, fits: true }, 'MAX LEVEL fits its button');
    assert.match(detail.level, /Lv\. 5 \/ 5/);
    await p.locator('.sbw-xbtn.train').click();await p.waitForSelector('.hero-upgrade-dialog[open]');assert(await p.getByRole('button',{name:/Salvage hero/}).isEnabled(),'max-level heroes still expose salvage');await p.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  });
  console.log('PASS: training checkout adds the server-rolled +1 (Genin Power, Lv4→5 double), new price table with the 2% fee, gain toast, converted old heroes, base + training battle stats and Max level at 5.');
})().catch(error => { console.error(error); process.exitCode = 1; });
