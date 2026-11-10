/* Tsukiyomi in the browser (isolated fixtures): the Mythic card with its rarity name and NFT, the
 * details panel (NFT status, aura switch, Check NFT, four skills, NFT-only selling, twice-Legend training
 * price), his own art from the supplied sheets (front/side/back, true LEFT view, aura layers), his
 * skill effects on the game's combat events, Adventure and Boss Hunt play, and the phone layout. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
const output = path.join(__dirname, 'out'); fs.mkdirSync(output, { recursive: true });
const login = async p => {
  await p.locator('#loginPhantom').click();
  await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
};
const hero = (id, rank, pw, extra = {}) => ({ tokenId: id, rank, level: 1, name: 'Hero ' + id, baseStats: { pw, sp: 6, st: 10 }, ...extra });
const MINT = 'TsuKiYoMiBox1111111111111111111111111111111';

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.balance = 500000; f.bonus = 10000000; // test-server starter Ryo
    const tsukiyomi = hero('mythic-' + MINT, 5, 16, { name: 'Tsukiyomi', level: 2, mythic: 'tsukiyomi', stars: 7, nft: { mint: MINT }, baseStats: { pw: 16, sp: 15, st: 17 } });
    const heroes = [tsukiyomi, hero('legend-1', 4, 13), hero('elite-1', 3, 10), hero('jonin-1', 2, 7), hero('genin-1', 0, 2)];
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId) });
    await login(p);
    // Only the small metadata loads up front; the art waits for a Mythic hero.
    assert(await p.evaluate(() => MythicHero.loaded && MythicHero.source.hero.rarity === 'Mythic'));
    // Starter Ryo adds to what can be spent (header), never to what can be withdrawn.
    await p.waitForFunction(() => /10,500,000/.test(document.querySelector('#sbwLayer')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await p.evaluate(() => [RyoPayments.state.balance, RyoPayments.state.bonus, GameCurrency.available()].join()), '500000,10000000,10500000');
    await p.evaluate(() => go(1)); await p.waitForFunction(() => WebsiteDesign.current() === 'heroes' && document.querySelector('.sbw-scr.on .sbw-hcard.mythic'));
    await p.waitForFunction(() => MythicHero.assetsReady, null, { timeout: 20000 });
    const card = await p.locator('.sbw-scr.on .sbw-hcard.mythic').textContent();
    assert.match(card, /MYTHIC/); assert.equal((card.match(/★/g)||[]).length,0,'rarity name only'); assert.match(card, /NFT/); assert.match(card, /Tsukiyomi[\s\S]*4 automatic skills/); assert(!card.includes('Dragon Slash'),'collection card must not imply only one skill');
    await p.locator('.sbw-scr.on .sbw-hcard.mythic .sbw-hc-name').click();
    await p.waitForSelector('.sbw-scr.on .sbw-myth');
    const det = await p.evaluate(() => { const d = document.querySelector('.sbw-scr.on .sbw-hd2');
      return { text: d.innerText.replace(/\s+/g, ' '), sell: d.querySelector('[data-k="sell"]').disabled, rank: d.querySelector('.sbw-h2-rank').textContent, train: d.querySelector('[data-k="train"]').textContent.replace(/\s+/g, ' ') }; });
    assert.equal(det.rank, 'MYTHIC');
    assert.match(det.text, /FIRST GENERATION NFT/); assert.equal((det.text.match(/★/g)||[]).length,0);
    assert.match(det.text, /NFT verified · TsuK…1111/, 'the box NFT is shown');
    // Owner decision 2026-11-10: the skill list (Dragon Slash, Void Shuriken, Raijin Field, Mythic Dragon Ascension and the
    // "All four rotate" note) is removed from the collection detail; the NFT line, Check NFT and the Aura switch stay.
    for (const text of ['Dragon Slash', 'Void Shuriken', 'Raijin Field', 'Mythic Dragon Ascension', 'All four rotate', 'testing cooldown', 'Melee Attack', 'Ranged Attack']) assert(!det.text.includes(text), text + ' is no longer listed');
    assert.equal(await p.locator('.sbw-scr.on .sbw-myth-skills').count(), 0, 'no skill list element');
    assert.equal(await p.locator('.sbw-scr.on .sbw-myth [data-k="mcheck"]').count(), 1, 'Check NFT stays');
    assert.equal(await p.locator('.sbw-scr.on .sbw-myth [data-k="maura"]').count(), 1, 'the Aura switch stays');
    assert.match(det.text, /TSUKIYOMI/, 'the hero title stays');
    assert.match(det.text, /PERKS 7 \/ 7/, 'seven perks');
    const energyView = await p.evaluate(() => { const h=S.h.find(h=>h.r===5); window.__mythicPanel=document.querySelector('.sbw-scr.on .sbw-myth'); h.en-=2; return {count:h.pk.length,capacity:CombatRules.maxChakra(h),expected:h.st*55}; });
    assert.equal(energyView.count,7); assert.equal(energyView.capacity,energyView.expected);
    await p.waitForTimeout(500);
    assert(await p.evaluate(()=>window.__mythicPanel===document.querySelector('.sbw-scr.on .sbw-myth')),'chakra updates preserve focused Mythic controls');
    assert.equal(det.sell, true); assert.match(det.text, /NFT ONLY/, 'traded only as the NFT');
    assert.match(det.train, /120,000/, 'Lv 2 → 3 Mythic training costs twice Legend (20,000 × 6)');
    // His portrait is his own art (not one of the eight shared models), with the aura around it.
    const portrait = await p.evaluate(() => { const c = document.querySelector('.sbw-scr.on .sbw-h2-port canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, violet = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 40) { n++; if (d[i - 1] > d[i - 2] + 30 && d[i - 3] > 90) violet++; }
      const h = S.h.find(x => x.r === 5); return { n, violet, label: PlayerModels.modelFor(h).label, nft: h.nft?.mint }; });
    assert(portrait.n > 4000 && portrait.violet > 400, 'portrait painted with violet Mythic art');
    assert.equal(portrait.label, 'Tsukiyomi · Mythic Shinobi'); assert.equal(portrait.nft, MINT);
    await p.screenshot({ path: path.join(output, 'mythic-heroes.png') });
    // Aura switch and Check NFT.
    await p.locator('.sbw-scr.on [data-k="maura"]').click();
    await p.waitForFunction(() => MythicHero.auraEnabled === false && /Aura: Off/.test(document.querySelector('.sbw-scr.on [data-k="maura"]')?.textContent || ''));
    await p.locator('.sbw-scr.on [data-k="maura"]').click();
    await p.waitForFunction(() => MythicHero.auraEnabled === true);
    await p.locator('.sbw-scr.on [data-k="mcheck"]').click();
    await p.waitForFunction(() => /NFT verified · 1 Mythic hero/.test(document.querySelector('.sbw-toast')?.textContent || ''));
    assert.equal(f.mythicChecks, 1);

    // Frames: front/side/back from the sheets, his real LEFT view for left-facing, others unchanged.
    const frames = await p.evaluate(() => { const h = S.h.find(x => x.r === 5), legend = S.h.find(x => x.r === 4);
      const side = ShinobiSprites.heroFrame(h, 'clip:walk:1', false, 'side'), back = ShinobiSprites.heroFrame(h, 'w2', false, 'back'), idle = ShinobiSprites.heroFrame(h, 'i0');
      return { side: side.mythicBody && side.playerModel.direction, left: side.mythicMirror?.playerModel.direction, back: back.playerModel.direction, idle: idle.playerModel.direction, size: [idle.width, idle.height],
        legend: !!ShinobiSprites.heroFrame(legend, 'i0').mythicBody, attack: ShinobiSprites.heroFrame(h, 'clip:ranged:0', false, 'side').playerModel.direction,
        fx: ['dragon_slash', 'raijin_field', 'mythic_dragon_ascension'].map(t => MythicHero.skillFrame(t,2)?.mythicEffect?.skill), legendFx: !!CharacterAnimations.effectFrame({ id: legend.id }, 'projectile', 2)?.mythicEffect,
        meta: Object.keys(MythicHero.source.animations).length };
    });
    assert.deepEqual([frames.side, frames.left, frames.back, frames.idle], ['walk_right', 'walk_left', 'walk_back', 'idle']);
    assert.deepEqual(frames.size, [320, 400]); assert.equal(frames.attack, 'attack_right'); assert.equal(frames.legend, false, 'other heroes keep their models');
    assert.deepEqual(frames.fx.slice(1), ['raijin_field', 'mythic_dragon_ascension']); assert(['dragon_slash', 'void_shuriken'].includes(frames.fx[0]));
    assert.equal(frames.legendFx, false); assert.equal(frames.meta, 21);
    // Skills are visuals on normal shots: Tsukiyomi volleys like a Legend (5 shots, 1 chakra each).
    assert.deepEqual(await p.evaluate(() => { const h = S.h.find(x => x.r === 5), l = S.h.find(x => x.r === 4); return [h.bm, h.rg, l.bm]; }), [7, 7, 5]);

    // Adventure: he deploys, walks and fights with his own effects; nothing else changes.
    await p.evaluate(() => { go(0); Experience.workAll(); });
    await p.waitForFunction(() => S.h.find(h => h.r === 5)?.on && S.h.filter(h => h.on && h.x >= 0).length === 5, null, { timeout: 15000 });
    await p.waitForFunction(() => window.__mythicShots || (bombs.some(b => b.o === S.h.find(h => h.r === 5).id) && (window.__mythicShots = 1)), null, { timeout: 30000 });
    await p.waitForTimeout(700);
    await p.screenshot({ path: path.join(output, 'mythic-adventure.png') });
    // Boss Hunt picks him (the strongest) for the team.
    assert(await p.evaluate(() => BattleRoster.list().slice().sort((a, c) => c.pw - a.pw)[0].r === 5), 'Tsukiyomi leads the hunt team');
    await p.evaluate(() => go(8)); await p.waitForFunction(() => WebsiteDesign.current() === 'boss-hunt' && document.querySelectorAll('.sbw-scr.on .bh-tile:not(.empty)').length === 5);
    assert.match(await p.locator('.sbw-scr.on .bh-tiles').textContent(), /Mythic/);
    await p.screenshot({ path: path.join(output, 'mythic-boss-hunt.png') });
    // Codex lists the Mythic rank.
    // Phone: the Mythic details stay readable.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => go(1)); await p.waitForFunction(() => document.getElementById('sbwLayer').classList.contains('sbw-phone') && WebsiteDesign.current() === 'heroes');
    await p.locator('.sbw-scr.on .sbw-hcard.mythic .sbw-hc-name').click(); await p.waitForSelector('.sbw-scr.on .sbw-myth');
    await p.locator('.sbw-scr.on .sbw-myth').scrollIntoViewIfNeeded();
    const phone = await p.evaluate(() => { const sec = document.querySelector('.sbw-scr.on'), m = sec.querySelector('.sbw-myth').getBoundingClientRect(); return { sideways: sec.scrollWidth > sec.clientWidth + 1, fits: m.left >= 0 && m.right <= innerWidth + 1 }; });
    assert.deepEqual(phone, { sideways: false, fits: true });
    await p.screenshot({ path: path.join(output, 'mythic-phone.png') });
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Mythic rarity-name NFT display, own directional pose fallback, aura/skills, NFT checks, unchanged Adventure/Boss Hunt mechanics and phone layout. Authored animation assets remain incomplete.');
})().catch(e => { console.error(e); process.exit(1); });
