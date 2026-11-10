/* Prison rescue in the real game page (owner request 2026-11-10): freeing a prisoner while signed in sends the kill report first,
 * asks the server for the rescue hero (retrying while the kill is being verified), plays the "Hero rescued" reveal with the
 * SERVER's hero (no local practice hero any more), and ends on Adventure. A prisoner that has to wait shows a message and is
 * delivered quietly after a later Chest sync. Only the prison-rescue action is stubbed (the isolated fixture has no rescue
 * server: prison-rescue-server.cjs covers the server rules); the game, kill report, reveal and inventory are the real page. */
const path = require('node:path');
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    const base = [economy.hero(1), economy.hero(2)];
    f.profile = economy.normalizeProfile({ ...f.profile, heroes: base, battleReady: base.map(h => h.tokenId) });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    await p.waitForFunction(() => window.PrisonRescue?.online());

    const snapshot = () => ({ economyVersion: 2, balance: f.balance, profile: economy.normalizeProfile(f.profile), purchases: f.purchases, withdrawals: f.withdrawals, deposits: f.deposits, spends: [], nextWithdrawalAt: f.nextWithdrawalAt, serverTime: Date.now() });
    const actions = [], answers = []; let granted = null;
    await p.route('**/.netlify/functions/ryo', async route => {
      const req = route.request().postDataJSON(); actions.push(req.action);
      if (req.action !== 'prison-rescue') return route.fallback();
      const next = answers.shift() || 'unverified';
      let body;
      if (next === 'granted') {
        const hero = { ...economy.hero(3), referralReward: true, prisonRescue: true, rescueId: req.requestId };
        f.profile.heroes.push(hero); f.profile = economy.normalizeProfile(f.profile); granted = hero.tokenId;
        body = { prisonRescue: { status: 'granted', id: req.requestId, rank: 3, hero, created: Date.now(), waiting: 0 }, ...snapshot() };
      } else body = { prisonRescue: next === 'early' ? { status: 'early', progress: 37, waiting: 1 } : { status: next, waiting: 0 } };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const free = () => p.evaluate(() => {
      const h = S.h.find(x => x.tokenId), b = { tx: 1, ty: 1, d: 99999, o: h.id };
      G[1][1] = { k: 6, hp: 2500, maxHp: 2500 }; bombs.push(b); boom(b);
      return { practice: S.h.filter(x => !x.tokenId).length, text: fl.map(x => x.s) };
    });
    const practiceBefore = await p.evaluate(() => S.h.filter(x => !x.tokenId).length);
    // The page's once-per-load check (counts earlier page sessions) happens after a Chest sync; let it finish first.
    await p.evaluate(() => AdventureChest.refresh());
    await p.waitForFunction(() => PrisonRescue.checked, null, { timeout: 15000 });
    assert.equal(await p.evaluate(() => PrisonRescue.waiting), false, 'nothing waiting: the page stops asking');
    const startAt = actions.length;

    // ---- A freed prisoner: kill report first, one "being verified" retry, then the server's hero is revealed.
    answers.push('unverified', 'granted');
    const freed = await free();
    assert(freed.text.includes('PRISONER FREED'), 'the cage shows PRISONER FREED');
    assert.equal(freed.practice, practiceBefore, 'no local practice hero is created while signed in');
    await p.waitForFunction(() => S.v2.revealSource === 'prison' && S.v2.revealBatch?.length === 1 && document.querySelector('#revealContinue'), null, { timeout: 20000 });
    const first = actions.indexOf('prison-rescue', startAt);
    assert(first > startAt && actions.slice(startAt, first).includes('adventure'), 'the kill report (adventure sync) is sent before asking: ' + actions.join(','));
    assert.equal(actions.slice(startAt).filter(a => a === 'prison-rescue').length, 2, 'retried once while the kill was being verified');
    assert.equal(await p.evaluate(() => S.v2.revealBatch[0].hero.tokenId), granted, 'the reveal shows the server-granted hero');
    assert.match(await p.locator('#revealTitle').innerText(), /Hero rescued/);
    const inInventory = await p.evaluate(id => { const h = S.h.find(x => x.tokenId === id); return h && { owner: h.tokenOwner === RyoPayments.state.account, bound: h.referralBound === true, r: h.r }; }, granted);
    assert.deepEqual(inInventory, { owner: true, bound: true, r: 3 }, 'the rescued hero is in the inventory, account-bound (lock badge)');
    await p.evaluate(() => { Experience.revealAll(); RevealDesign.skip(); });
    await p.waitForFunction(() => S.v2.revealBatch.every(i => i.revealed) && !document.querySelector('#revealContinue').disabled);
    await p.locator('#revealContinue').click();
    await p.waitForFunction(() => !document.querySelector('dialog[open] #revealContinue') && WebsiteDesign.current() === 'adventure', null, { timeout: 15000 });
    await p.waitForTimeout(1500);
    assert.equal(await p.evaluate(id => S.h.filter(x => x.tokenId === id).length, granted), 1, 'the hero stays after the next sync (it is a server hero)');

    // ---- A prisoner that has to wait: message, no reveal; delivered after a later Chest sync.
    answers.push('early'); const asked = actions.length;
    await free();
    await p.waitForFunction(() => /37% there/.test(document.querySelector('.prison-rescue-toast.show')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await p.evaluate(() => S.v2.revealBatch?.length || 0), 0, 'nothing to reveal yet');
    assert.equal(await p.evaluate(() => PrisonRescue.waiting), true);
    answers.push('granted');
    await p.evaluate(() => { dispatchEvent(new Event('shinobi-beta-wallet')); dispatchEvent(new Event('shinobi-chest')); });
    await p.waitForFunction(() => S.v2.revealSource === 'prison' && S.v2.revealBatch?.length === 1, null, { timeout: 15000 });
    assert.equal(await p.evaluate(() => S.v2.revealBatch[0].hero.tokenId), granted, 'the waiting prisoner is delivered');
    assert(actions.slice(asked).filter(a => a === 'prison-rescue').length >= 2);
    assert.equal(await p.evaluate(() => PrisonRescue.waiting), false);
    await p.evaluate(() => { Experience.revealAll(); RevealDesign.skip(); });
    await p.waitForFunction(() => S.v2.revealBatch.every(i => i.revealed) && !document.querySelector('#revealContinue').disabled);
    await p.screenshot({ path: path.join(root, 'tests/out/prison-rescue.png') });
    await p.locator('#revealContinue').click();
    assert.deepEqual(errors, []);
  });
  console.log('PASS: prison rescue client — kill report first, retry while verifying, the server hero is revealed and stays in the inventory (no local practice hero), waiting prisoners show a message and arrive after a later Chest sync.');
})().catch(e => { console.error(e); process.exitCode = 1; });
