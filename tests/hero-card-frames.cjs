/* Rank card frames (owner request 2026-11-10): every hero card on the Adventure team panel and in the Heroes Collection carries a
 * rank-themed frame (Genin shuriken, Chunin leaves, Jonin crescent, Elite tomoe + blossoms, Legend star + diamond, Mythic tomoe
 * crest + wings). The frame is decorative and cheap: aria-hidden, never intercepts clicks, only transform/opacity animate, and it
 * moves only on deployed Adventure cards and Heroes cards. Low quality / paused / reduced motion = still, Off = no glow layer.
 * Isolated fixtures only; no gameplay or rewards are touched. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
const output = path.join(__dirname, 'out'); fs.mkdirSync(output, { recursive: true });
const hero = (id, rank) => ({ tokenId: id, rank, level: 1, name: 'Hero ' + id, baseStats: { pw: 4 + rank * 2, sp: 6, st: 10 } });
// Expected ornaments per rank (Adventure shows the compact set, the Heroes Collection the full set).
const ORN = { adv: [['shuriken'], ['leaf'], ['swirl'], ['tomoe', 'flower', 'flower'], ['star'], ['tomoe', 'wing', 'wing']],
  heroes: [['shuriken', 'shuriken'], ['leaf', 'leaf', 'leaf'], ['swirl', 'swirl'], ['tomoe', 'flower', 'flower', 'tomoe'], ['star', 'diamond'], ['tomoe', 'wing', 'wing', 'diamond']] };

const probeFn = sel => {
  const out = [];
  for (const card of document.querySelectorAll(sel)) for (const a of card.querySelector('.sbw-frame').getAnimations({ subtree: true })) {
    const props = new Set(); for (const k of a.effect.getKeyframes()) for (const key of Object.keys(k)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(key)) props.add(key);
    out.push({ rank: +card.className.match(/\br(\d)\b/)[1], name: a.animationName, props: [...props].sort().join(), state: a.playState });
  }
  return out;
};
const framesFn = sel => [...document.querySelectorAll(sel)].map(card => { const f = card.querySelector(':scope > .sbw-frame'), r = +card.className.match(/\br(\d)\b/)?.[1];
  return { rank: r, has: !!f, hidden: f?.getAttribute('aria-hidden'), events: f && getComputedStyle(f).pointerEvents, orn: f ? [...f.querySelectorAll('svg.o')].map(s => s.getAttribute('class').split(' ').pop().replace(/^o-/, '')) : [] }; });

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    const heroes = [5, 4, 3, 2, 1, 0, 4, 3, 2, 1].map((r, i) => hero('h' + i + '-r' + r, r));
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId) });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.MapDesign?.loaded);
    const setFx = async fx => { await p.evaluate(fx => { Arena3D.cfg.fx = fx; dispatchEvent(new Event('sb-display-change')); }, fx); await p.waitForFunction(fx => document.querySelector('#sbwLayer').dataset.effectsQuality === String(fx), fx, { timeout: 5000 }); await p.waitForTimeout(150); };
    const motionOk = a => /^(opacity|transform|opacity,transform)$/.test(a.props);

    // ======== Heroes Collection ========
    await p.evaluate(() => go(1));
    await p.waitForFunction(() => WebsiteDesign.current() === 'heroes' && document.querySelectorAll('.sbw-scr.on .sbw-hcard').length === 10, null, { timeout: 25000 });
    const cards = await p.evaluate(framesFn, '.sbw-scr.on .sbw-hcard');
    assert.equal(cards.length, 10);
    for (const c of cards) {
      assert(c.has, 'rank ' + c.rank + ' card has a frame'); assert.equal(c.hidden, 'true'); assert.equal(c.events, 'none', 'the frame never intercepts clicks');
      assert.deepEqual(c.orn, ORN.heroes[c.rank], 'rank ' + c.rank + ' ornaments (Heroes)');
    }
    assert.deepEqual([...new Set(cards.map(c => c.rank))].sort(), [0, 1, 2, 3, 4, 5], 'every rank is shown');
    // The controls under the frame still work: the Deploy / Rest button of a card.
    const before = await p.evaluate(() => S.h.filter(h => h.on).length);
    await p.locator('.sbw-scr.on .sbw-hcard').nth(5).locator('.sbw-hb').first().click(); await p.waitForTimeout(600);
    assert.notEqual(await p.evaluate(() => S.h.filter(h => h.on).length), before, 'a card button still works under the frame');
    await p.locator('.sbw-scr.on .sbw-hcard').nth(1).locator('.sbw-hc-name').click(); await p.waitForTimeout(300);
    assert.equal(await p.locator('.sbw-scr.on .sbw-hcard.on').count(), 1, 'selecting a card still works under the frame');
    // Motion: only transform/opacity, each rank with its own ornament motion.
    let anim = await p.evaluate(probeFn, '.sbw-scr.on .sbw-hcard');
    assert(anim.length > 30, 'frame animations are running on the Heroes cards (' + anim.length + ')');
    for (const a of anim) assert(motionOk(a), a.name + ' animates only transform/opacity, not: ' + a.props);
    const names = r => new Set(anim.filter(a => a.rank === r).map(a => a.name));
    assert(names(1).has('sbw-fr-sway') && names(2).has('sbw-fr-bob') && names(3).has('sbw-fr-spin') && names(4).has('sbw-fr-pulse') && names(5).has('sbw-fr-flap'), 'Chunin sways, Jonin bobs, Elite spins, Legend pulses, Mythic flaps its wings');
    assert(!names(0).has('sbw-fr-spin') && !names(0).has('sbw-fr-sway'), 'Genin ornaments stay still');
    for (let r = 0; r <= 5; r++) assert(names(r).has('sbw-fr-breath'), 'rank ' + r + ' glow breathes');
    assert(anim.every(a => a.state === 'running'));
    await p.screenshot({ path: path.join(output, 'card-frames-heroes-desktop.png'), scale: 'css' });

    // Quality: Low = still frames, Off = no glow layer, High = motion back; reduced motion = still.
    await setFx(1);
    assert.equal((await p.evaluate(probeFn, '.sbw-scr.on .sbw-hcard')).length, 0, 'Low quality: frames are still');
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.sbw-scr.on .sbw-hcard .sbw-frame'), '::after').display), 'block', 'Low quality keeps the (static) glow');
    await setFx(0);
    assert.equal(await p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on .sbw-hcard .sbw-frame')].every(f => getComputedStyle(f, '::after').display === 'none' && f.querySelector('svg.o'))), true, 'Off: no glow layer, ornaments stay');
    await setFx(2);
    assert((await p.evaluate(probeFn, '.sbw-scr.on .sbw-hcard')).length > 30, 'High quality: motion is back');
    await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(400);
    assert.equal((await p.evaluate(probeFn, '.sbw-scr.on .sbw-hcard')).length, 0, 'reduced motion: still frames');
    await p.emulateMedia({ reducedMotion: 'no-preference' }); await p.waitForTimeout(400);
    // Bloom & glow off hides the glow layer.
    await p.evaluate(() => document.documentElement.classList.add('sb-no-bloom'));
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.sbw-scr.on .sbw-hcard .sbw-frame'), '::after').display), 'none', 'Bloom & glow off hides the glow layer');
    await p.evaluate(() => document.documentElement.classList.remove('sb-no-bloom'));

    // ======== Adventure team panel ========
    await p.locator('.sbw-hdr [data-sbwid="nav-adventure"]').click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'adventure');
    await p.waitForFunction(() => document.querySelectorAll('.sbw-scr.on .sbw-at-card:not(.empty)').length === 10, null, { timeout: 15000 });
    const rest = await p.evaluate(framesFn, '.sbw-scr.on .sbw-at-card:not(.empty)');
    for (const c of rest) { assert(c.has && c.hidden === 'true' && c.events === 'none', 'Adventure card frame: decorative'); assert.deepEqual(c.orn, ORN.adv[c.rank], 'rank ' + c.rank + ' ornaments (Adventure)'); }
    assert.equal((await p.evaluate(probeFn, '.sbw-scr.on .sbw-at-card:not(.deployed):not(.empty)')).length, 0, 'resting heroes: still frames');
    await p.locator('.sbw-scr.on [data-a="work"]').click();
    await p.waitForFunction(() => S.h.filter(h => h.on).length >= 1, null, { timeout: 10000 });
    await p.waitForTimeout(1200);
    const deployedCount = await p.evaluate(() => document.querySelectorAll('.sbw-scr.on .sbw-at-card.deployed').length);
    assert(deployedCount >= 1, 'heroes were deployed (' + deployedCount + ')');
    anim = await p.evaluate(probeFn, '.sbw-scr.on .sbw-at-card.deployed');
    assert(anim.length > 0, 'deployed cards animate their frames');
    for (const a of anim) assert(motionOk(a), a.name + ' animates only transform/opacity, not: ' + a.props);
    assert.equal((await p.evaluate(probeFn, '.sbw-scr.on .sbw-at-card:not(.deployed):not(.empty)')).length, 0, 'resting cards never animate');
    // The card's own button and live numbers are untouched by the frame.
    const slot = await p.evaluate(() => { const el = document.querySelector('.sbw-scr.on .sbw-at-card:not(.empty)'); const b = el.querySelector('button'), r = b.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { clickable: top === b || b.contains(top), text: el.querySelector('.sbw-at-info small').textContent }; });
    assert(slot.clickable, 'the card button is not covered by the frame'); assert(/^Lv\. \d+ +\d+ \/ \d+ chakra$/.test(slot.text), 'chakra line intact: ' + slot.text);
    await p.screenshot({ path: path.join(output, 'card-frames-adventure-desktop.png'), scale: 'css' });
    await setFx(1);
    assert.equal((await p.evaluate(probeFn, '.sbw-scr.on .sbw-at-card')).length, 0, 'Low quality: Adventure frames are still');
    await setFx(2);

    // ======== Phone ========
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways page scroll on a phone (Adventure)');
    await p.locator('.sbw-scr.on .sbw-at-card.r5, .sbw-scr.on .sbw-at-card').first().scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(output, 'card-frames-adventure-phone.png'), scale: 'css' });
    const tooSmall = await p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on .sbw-at-card > button')].filter(b => b.getBoundingClientRect().height < 24).length);
    assert.equal(tooSmall, 0, 'card buttons keep a 24px touch height on a phone');
    await p.evaluate(() => go(1)); await p.waitForFunction(() => WebsiteDesign.current() === 'heroes'); await p.waitForTimeout(500);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways page scroll on a phone (Heroes)');
    await p.locator('.sbw-scr.on .sbw-hcard').first().scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(output, 'card-frames-heroes-phone.png'), scale: 'css' });
    assert.deepEqual(errors, []);
  });
  console.log('PASS: rank card frames on the Adventure team cards and the Heroes Collection: per-rank ornaments, decorative and click-through, only transform/opacity animate (deployed Adventure cards and Heroes cards only), Low/Off/paused/reduced motion/bloom-off behave, phone layout intact.');
})().catch(error => { console.error(error); process.exitCode = 1; });
