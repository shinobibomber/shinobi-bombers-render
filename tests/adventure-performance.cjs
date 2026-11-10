/* Adventure performance guards (owner request 2026-11-10: smooth FPS with many skills on screen). They assert the cheap
 * *behaviour* that makes the screen fast, not a machine-dependent frame rate:
 *   - the native roster cards (the team panel's data source) are not rewritten when nothing changed;
 *   - team slots update their live numbers in place instead of rebuilding their markup;
 *   - floating numbers come from cached sprites, not live font parsing + stroke/fill per particle per frame;
 *   - every animation on the Adventure screen animates only transform/opacity (compositor-only), except one named legacy sweep;
 *   - the ambient fx no longer use mix-blend-mode;
 *   - the header Chest glow layer never shows over the website art.
 * Combat, chakra and rewards are untouched; isolated fixtures only. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity: 15 })).profile;
    f.profile.battleReady = f.profile.heroes.slice(0, 10).map(h => h.tokenId);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.MapDesign?.loaded);
    await p.evaluate(() => {
      window.__w = { roster: 0, strokeOnCv: 0, spriteCanvases: 0, spriteStrokes: 0 };
      const set = CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty = function (k, ...a) { if (String(k).startsWith('--roster-')) __w.roster++; return set.call(this, k, ...a); };
      const stroke = CanvasRenderingContext2D.prototype.strokeText;
      CanvasRenderingContext2D.prototype.strokeText = function (...a) { if (this.canvas.id === 'cv') __w.strokeOnCv++; else __w.spriteStrokes++; return stroke.apply(this, a); };
    });
    await p.locator('.sbw-hdr [data-sbwid="nav-adventure"]').click();
    await p.waitForFunction(() => WebsiteDesign.current() === 'adventure');
    await p.locator('.sbw-scr.on [data-a="work"]').click();
    await p.waitForFunction(() => S.h.filter(h => h.on).length === 10);
    await p.waitForTimeout(1500);

    // ---- 1. Roster cards: no redundant style writes (the old refresh rewrote ~20 properties x 10 cards on every call).
    await p.evaluate(() => { __w.roster = 0; });   // the cards were created and laid out once above; count only what happens next
    await p.waitForTimeout(6000);   // ~24 hud ticks + roster refreshes while ten heroes fight
    const w = await p.evaluate(() => ({ ...__w, particles: Arena3D.particles }));
    assert.equal(w.roster, 0, 'roster cards: layout properties are not rewritten when unchanged (' + w.roster + ' writes)');

    // ---- 2. Floating numbers are drawn from cached sprites: never stroked live onto the game canvas.
    assert.equal(w.strokeOnCv, 0, 'no live strokeText on the game canvas: floating text uses sprites (' + w.strokeOnCv + ' calls)');
    assert(w.spriteStrokes > 0, 'floating numbers did appear and were rendered into sprites (' + w.spriteStrokes + ')');
    assert(w.spriteStrokes < 120, 'each distinct number is rendered once, not per frame (' + w.spriteStrokes + ' sprite renders in 6 s)');

    // ---- 3. Team slots update in place; their values stay correct.
    const slot = await p.evaluate(async () => {
      const slots = [...document.querySelectorAll('.sbw-scr.on .sbw-at-card:not(.empty)')], el = slots[0];
      const info = el.querySelector('.sbw-at-info small'), fill = el.querySelector('.sbw-bar i'), name = el.querySelector('.sbw-at-info strong');
      const idx = [...document.querySelectorAll('.sbw-scr.on .sbw-at-card')].indexOf(el), before = info.textContent;
      const cards = [...document.querySelectorAll('#strip .roster-design-card')], hero = S.h.find(h => String(h.id) === cards[idx].dataset.maphero);
      hero.en = Math.max(2, CombatRules.maxChakra(hero) * .5);   // a visible change of the live number
      await new Promise(r => setTimeout(r, 900));
      const after = el.querySelector('.sbw-at-info small');
      const shown = +(info.textContent.match(/(\d+)\s*\/\s*\d+\s*chakra/) || [])[1];   // the hero keeps fighting, so allow a little drift
      return { sameNodes: after === info && el.querySelector('.sbw-bar i') === fill && el.querySelector('.sbw-at-info strong') === name, changed: info.textContent !== before, text: info.textContent, shown, now: hero.en, width: fill.style.width };
    });
    assert(slot.sameNodes, 'a chakra change updates the slot in place (its markup is not rebuilt)');
    assert(slot.changed && Math.abs(slot.shown - slot.now) <= 4, 'the slot shows the new chakra: ' + slot.text + ' (hero has ' + slot.now.toFixed(1) + ')');
    assert(/^\d/.test(slot.width), 'the bar follows: ' + slot.width);

    // ---- 4. Native roster values stay correct (they feed the team panel).
    const cards = await p.evaluate(() => [...document.querySelectorAll('#strip .roster-design-card[data-maphero]')].map(c => { const h = S.h.find(x => String(x.id) === c.dataset.maphero); const b = c.querySelector('.roster-team-action');
      return { ok: !!h, deployed: c.dataset.deployed === String(!!h.on), button: b.textContent === (h.on ? '✓ Deployed' : 'Deploy'), pressed: b.getAttribute('aria-pressed') === String(!!h.on), name: c.querySelector('.roster-hero-name').textContent === h.name.split(' ')[0], rank: c.querySelector('.roster-hero-rank').textContent.startsWith('✦') }; }));
    assert(cards.length === 10 && cards.every(c => Object.values(c).every(Boolean)), 'all ten roster cards show their hero state: ' + JSON.stringify(cards.filter(c => !Object.values(c).every(Boolean))));
    // The game's own mapRoster() overwrites each card's chakra text; the roster module must put the level back every time
    // (a change-detection cache that trusts only its own last write once left cards reading "97 / 100 chakra" without "Lv. 1").
    await p.waitForTimeout(800);
    const metas = await p.evaluate(() => ({ native: [...document.querySelectorAll('#strip .roster-hero-meta')].map(e => e.textContent), panel: [...document.querySelectorAll('.sbw-scr.on .sbw-at-card:not(.empty) .sbw-at-info small')].map(e => e.textContent) }));
    assert(metas.native.length === 10 && metas.native.every(t => /^Lv\. \d+ +\d+ \/ \d+ chakra$/.test(t)), 'every native roster card keeps its level in the chakra line: ' + JSON.stringify(metas.native.filter(t => !/^Lv\. /.test(t))));
    assert(metas.panel.length === 10 && metas.panel.every(t => /^Lv\. \d+ \d+ \/ \d+ chakra$/.test(t)), 'every team slot shows level and chakra: ' + JSON.stringify(metas.panel.filter(t => !/^Lv\. /.test(t))));
    // A deploy/rest toggle still reaches the card at once.
    await p.evaluate(() => { const c = document.querySelector('#strip .roster-design-card[data-maphero] .roster-team-action'); c.click(); });
    await p.waitForTimeout(500);
    assert.equal(await p.evaluate(() => S.h.filter(h => h.on).length), 9, 'the roster button rests a hero');
    assert.equal(await p.evaluate(() => [...document.querySelectorAll('#strip .roster-design-card[data-maphero]')].filter(c => c.dataset.deployed === 'true').length), 9, 'and the card follows immediately');

    // ---- 5. Compositor-only animations on the page; no blend modes on the ambient fx; no Chest glow over the website art.
    const anim = await p.evaluate(() => { const bad = []; for (const a of document.getAnimations()) { const props = new Set(); for (const k of a.effect.getKeyframes()) for (const key of Object.keys(k)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(key)) props.add(key);
      const extra = [...props].filter(x => x !== 'opacity' && x !== 'transform'); if (extra.length) bad.push((a.animationName || 'transition') + ':' + extra.join(',')); } return { total: document.getAnimations().length, bad: [...new Set(bad)] }; });
    assert(anim.total > 20, 'the ambient animations are running (' + anim.total + ')');
    assert.deepEqual(anim.bad.filter(x => !/^sbw-sweep:/.test(x) && !/^transition:/.test(x)), [], 'only transform/opacity animations repaint-free (allowed: the legacy banner sweep): ' + anim.bad.join(' | '));
    const blends = await p.evaluate(() => [...document.querySelectorAll('#sbwLayer .fx')].flatMap(e => [getComputedStyle(e).mixBlendMode, getComputedStyle(e, '::after').mixBlendMode]).filter(m => m !== 'normal'));
    assert.deepEqual(blends, [], 'ambient fx use no mix-blend-mode');
    assert.equal(await p.evaluate(() => { const b = document.querySelector('.gc-global-chest'); return b ? getComputedStyle(b, '::after').display : 'none'; }), 'none', 'the header Chest glow layer is hidden while the website layer is active');
    assert.deepEqual(errors, []);
  });
  console.log('PASS: Adventure performance guards — roster cards not rewritten when unchanged, team slots updated in place, floating numbers from cached sprites, compositor-only animations, no blend modes on ambient fx, no Chest glow over the website art.');
})().catch(error => { console.error(error); process.exitCode = 1; });
