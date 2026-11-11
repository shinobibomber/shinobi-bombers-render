/* Founder benefits play the Summoning Shrine reveal (owner request 2026-11-10): activating the Founder box (Legend + Elite) and using a
 * Limited Summon Pass reveal the granted heroes, close the Founder panel first, never reveal a replayed (already delivered) summon,
 * and finish on the Heroes screen with the newest heroes first. Only the Founder actions are stubbed (the isolated game fixture has no
 * Founder server); everything else is the real page, panel and reveal. No wallet, RPC or payment is involved. */
const path = require('node:path');
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    const base = [economy.hero(1), economy.hero(2), economy.hero(3)];
    f.profile = economy.normalizeProfile({ ...f.profile, heroes: base, battleReady: base.map(h => h.tokenId) });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);

    // Stub of the Founder server actions, backed by the fixture's real profile.
    const snapshot = () => ({ economyVersion: 2, balance: f.balance, profile: economy.normalizeProfile(f.profile), purchases: f.purchases, withdrawals: f.withdrawals, deposits: f.deposits, spends: [], nextWithdrawalAt: f.nextWithdrawalAt, serverTime: Date.now() });
    let activated = null, passes = 10, summons = 0, replayNext = false, tier = 'legacy'; const granted = [];
    const status = () => ({ founder: { tier, name: tier === 'mythic' ? 'Mythic' : 'Legacy', mint: 'FixtureMint', valid: true, redemptionOpen: true, activated, limitedPasses: passes, passesOnActivation: 10,
      limitedPool: [{ rank: 'Chunin', percent: 62.5 }, { rank: 'Jonin', percent: 25 }, { rank: 'Elite', percent: 10 }, { rank: 'Legend', percent: 2.5 }], premium: { everyWeeks: 4, qualifyingWeeks: 0, claimed: 0, available: 0, pool: [] },
      chestCooldownHours: 12, discountPercent: 5, sensei: tier === 'mythic' ? 'permanent' : 'trial', trial: null, missionPass: { level: tier === 'mythic' ? 'full' : 'basic', status: 'coming with the Missions update' }, council: tier === 'mythic' ? 'full' : 'community', privileges: 'selected', earlyAccess: 'eligible' } });
    await p.route('**/.netlify/functions/ryo', async route => {
      const req = route.request().postDataJSON();
      if (!/^founder-/.test(req.action)) return route.fallback();
      const grant = (rank, tag) => { const h = { ...economy.hero(rank), founderGrant: tag }; f.profile.heroes.push(h); f.profile = economy.normalizeProfile(f.profile); granted.push(h.tokenId); return h; };
      let body;
      if (req.action === 'founder-status') body = { ...status(), senseiSol: null };
      else if (req.action === 'founder-activate') { activated = Date.now(); const heroes = [...(tier === 'mythic' ? [(() => { const h = { ...economy.hero(5), tokenId: 'founder-tsukiyomi-fixture', name: 'Tsukiyomi', mythic: 'tsukiyomi', founderBound: true, founderGrant: 'mythic' }; f.profile.heroes.push(h); f.profile = economy.normalizeProfile(f.profile); granted.push(h.tokenId); return h; })()] : []), grant(4, tier), grant(3, tier)]; body = { activation: { activated, heroes }, ...status(), ...snapshot() }; }
      else if (req.action === 'founder-summon') {
        if (replayNext) body = { summon: { kind: 'limited', period: null, rank: 1, rankName: 'Chunin', hero: { ...f.profile.heroes.at(-1) }, replay: true }, ...status() };
        else { passes--; summons++; const hero = grant(1, 'limited'); body = { summon: { kind: 'limited', period: null, rank: 1, rankName: 'Chunin', hero }, ...status(), ...snapshot() }; }
      } else return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'unknown' }) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const finish = async () => {
      await p.evaluate(() => { Experience.revealAll(); RevealDesign.skip(); });
      await p.waitForFunction(() => S.v2.revealBatch.every(i => i.revealed) && !document.querySelector('#revealContinue').disabled);
      await p.locator('#revealContinue').click();
      await p.waitForFunction(() => WebsiteDesign.current() === 'heroes' && !document.querySelector('dialog[open] #revealContinue'), null, { timeout: 15000 });
    };
    const firstCards = n => p.evaluate(n => [...document.querySelectorAll('.sbw-scr.on .sbw-hcard')].slice(0, n).map(c => c.querySelector('.sbw-hc-top b')?.textContent), n);

    // ---- Activation: Legend + Elite are revealed.
    await p.evaluate(() => go(5)); await p.waitForFunction(() => WebsiteDesign.current() === 'home');
    await p.evaluate(() => FounderPanel.open()); await p.waitForSelector('.fd-dialog[open] .fd-actions button');
    await p.getByRole('button', { name: 'Activate Founder benefits' }).click();
    await p.waitForFunction(() => S.v2.revealSource === 'reward' && S.v2.revealBatch?.length === 2 && document.querySelector('#revealContinue'), null, { timeout: 15000 });
    assert.equal(await p.locator('.fd-dialog').evaluate(d => d.open), false, 'the Founder panel makes way for the reveal');
    assert.match(await p.locator('#revealTitle').innerText(), /Reward received/);
    assert.deepEqual(await p.evaluate(() => S.v2.revealBatch.map(i => i.hero.tokenId).sort()), granted.slice(0, 2).sort(), 'the batch is exactly the two activation heroes');
    assert.deepEqual(await p.evaluate(() => S.v2.revealBatch.map(i => i.hero.r).sort()), [3, 4]);
    await finish();
    assert.equal(await p.evaluate(() => document.querySelector('#p1 .heroes-sort').value), 'new');
    assert.deepEqual((await firstCards(2)).sort(), ['ELITE', 'LEGEND'], 'the activation heroes are first on the Heroes screen');

    // ---- Limited Summon Pass: the one hero is revealed.
    await p.evaluate(() => go(5)); await p.waitForFunction(() => WebsiteDesign.current() === 'home');
    await p.evaluate(() => FounderPanel.open()); await p.waitForFunction(() => [...document.querySelectorAll('.fd-actions button')].some(b => /Limited Summon Pass/.test(b.textContent) && !b.disabled));
    await p.getByRole('button', { name: 'Use a Limited Summon Pass' }).click();
    await p.waitForFunction(() => S.v2.revealSource === 'reward' && S.v2.revealBatch?.length === 1 && document.querySelector('#revealContinue'), null, { timeout: 15000 });
    assert.equal(await p.evaluate(() => S.v2.revealBatch[0].hero.tokenId), granted.at(-1));
    await finish();
    assert.equal((await firstCards(1))[0], 'CHUNIN', 'the new pass hero is first');
    assert.equal(summons, 1);

    // ---- Mythic Founder: Tsukiyomi is revealed as MYTHIC (not as an Elite / Legend) along with the Legend and the Elite.
    activated = null; tier = 'mythic'; granted.length = 0;
    await p.evaluate(() => go(5)); await p.waitForFunction(() => WebsiteDesign.current() === 'home');
    await p.evaluate(() => FounderPanel.open()); await p.waitForFunction(() => [...document.querySelectorAll('.fd-actions button')].some(b => /Activate Founder benefits/.test(b.textContent) && !b.disabled));
    await p.getByRole('button', { name: 'Activate Founder benefits' }).click();
    await p.waitForFunction(() => S.v2.revealSource === 'reward' && S.v2.revealBatch?.length === 3 && document.querySelector('#revealContinue'), null, { timeout: 15000 });
    assert.deepEqual(await p.evaluate(() => S.v2.revealBatch.map(i => i.hero.r).sort()), [3, 4, 5]);
    const announced = await p.evaluate(() => { const i = S.v2.revealBatch.findIndex(x => x.hero.r === 5); const opening = RevealDesign.open(i); const text = document.querySelector('.cinematic-announcement')?.textContent; RevealDesign.skip(); return { text, i }; });
    assert.match(announced.text, /MYTHIC AWAKENED · Tsukiyomi/, 'the announcement names a Mythic, not an Elite or Legend');
    await p.evaluate(() => { Experience.revealAll(); RevealDesign.skip(); });
    await p.waitForFunction(() => S.v2.revealBatch.every(i => i.revealed) && !document.querySelector('#revealContinue').disabled);
    assert.deepEqual((await p.locator('.reveal-card .cinematic-rank').allInnerTexts()).sort(), ['Elite', 'Legend', 'Mythic'], 'each card names its own rank (Mythic is not shown as Legend)');
    assert((await p.locator('.reveal-card[data-rank="4"]').count()) >= 1 && (await p.evaluate(() => [...document.querySelectorAll('.reveal-card')].some(c => /Tsukiyomi, .*Mythic/.test(c.getAttribute('aria-label') || '')))), 'the Mythic card is labelled Mythic for screen readers');
    // Owner request 2026-11-11: the Mythic card is red (not Legend gold) and shows Tsukiyomi once his art has loaded.
    const mythicCard = p.locator('.reveal-card[data-rank="5"]');
    assert.equal(await mythicCard.count(), 1, 'the Mythic card has its own rank');
    assert.equal((await mythicCard.evaluate(c => c.style.getPropertyValue('--rank-color'))).trim(), '#ff3b3b', 'red, not Legend gold');
    await p.waitForFunction(() => window.MythicHero?.assetsReady === true, null, { timeout: 30000 });
    await p.waitForFunction(() => { const cv = document.querySelector('.reveal-card[data-rank="5"] canvas'); if (!cv?.width) return false; const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++; return n > 200; }, null, { timeout: 15000 });
    await p.screenshot({ path: path.join(root, 'tests/out/founder-reveal-mythic.png') });
    await finish(); tier = 'legacy';

    // ---- A replayed summon (the server says it was already delivered) never reveals again.
    await p.evaluate(() => go(5)); await p.waitForFunction(() => WebsiteDesign.current() === 'home');
    await p.evaluate(() => FounderPanel.open()); await p.waitForFunction(() => [...document.querySelectorAll('.fd-actions button')].some(b => /Limited Summon Pass/.test(b.textContent) && !b.disabled));
    replayNext = true; await p.getByRole('button', { name: 'Use a Limited Summon Pass' }).click(); await p.waitForTimeout(1500);
    assert.deepEqual(await p.evaluate(() => ({ batch: S.v2.revealBatch?.length || 0, open: document.querySelector('.fd-dialog').open })), { batch: 0, open: true }, 'no reveal for a replay; the Founder panel stays open');
    assert.equal(summons, 1, 'no new hero was granted');
    assert.deepEqual(errors, []);
    await p.screenshot({ path: path.join(root, 'tests/out/founder-reveal.png') });
  });
  console.log('PASS: Founder activation and Limited Summon Pass play the reward reveal (panel closes first, exact granted heroes, ends on Heroes with the newest first); replays never reveal.');
})().catch(e => { console.error(e); process.exitCode = 1; });
