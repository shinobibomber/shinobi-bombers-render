/* Performance-oriented UI behaviour (client performance work, 2026-11-11). Behavioural guards, not frame rates:
 *  - The Fusion Reserve list is windowed: with 370+ Reserve heroes only the visible rows and their canvases exist, scrolling
 *    renders the rows that come into view (with their portraits), selecting rows still drives the game's own checkboxes, and the
 *    cached native text (pick counter) never goes stale after a selection.
 *  - The Heroes backdrop is one shared inherited value (not ~200 KB copied onto every card) and every card still resolves it.
 *  - The Expedition Hall shows long lists 60 cards at a time.
 *  - The measured AUTO low-effects state engages only when the page is slow, pauses ONLY decorative layers, and releases again.
 *  - Visual quality never changes gameplay values (heroes' Power/Speed/Stamina/chakra and the combat rules are identical).
 * Isolated fixtures only. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
process.env.EXPEDITIONS_ENABLED = 'on';
const X = require('../app/server/expedition.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    for (const quantity of [...Array(24).fill(15), 10, 1, 1]) f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity })).profile;
    f.profile.battleReady = f.profile.heroes.slice().sort((a, b) => b.rank - a.rank).slice(0, 10).map(h => h.tokenId);
    f.expedition = () => X.build(f.profile, { team: [] }, Date.now()).expedition;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.Expedition);
    const open = async id => { await p.evaluate(i => WebsiteDesign.open(i), id); await p.waitForFunction(i => WebsiteDesign.current() === i, id); await p.waitForTimeout(900); };

    // ---- 1. Fusion list: windowed, scrollable, selectable, counter correct
    await open('fusion');
    const dom = () => p.evaluate(() => ({ rows: document.querySelectorAll('.sbw-scr.on .sbw-frow').length, canvases: document.querySelectorAll('.sbw-scr.on .sbw-frow canvas').length, total: document.querySelectorAll('#p6 .fusion-table tbody tr').length, height: document.querySelector('.sbw-scr.on .sbw-fvp')?.style.height }));
    let d = await dom();
    assert(d.total > 150, 'the native Reserve table holds the whole collection (' + d.total + ')');
    assert(d.rows > 0 && d.rows <= 24, 'only the visible rows are in the DOM (' + d.rows + ' of ' + d.total + ')');
    assert.equal(d.canvases, d.rows, 'one portrait canvas per rendered row');
    assert.equal(parseInt(d.height), d.total * 60, 'the scroll height still covers every hero');
    const first = await p.evaluate(() => document.querySelector('.sbw-scr.on .sbw-frow').dataset.i);
    assert.equal(first, '0', 'starts at the first hero');
    await p.evaluate(() => { const l = document.querySelector('.sbw-scr.on .sbw-flist'); l.scrollTop = l.scrollHeight; });
    await p.waitForFunction(() => +document.querySelector('.sbw-scr.on .sbw-frow')?.dataset.i > 100, null, { timeout: 5000 });
    d = await dom();
    assert(d.rows <= 24, 'after scrolling to the end the DOM is still small (' + d.rows + ')');
    const last = await p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on .sbw-frow')].pop().dataset.i);
    assert.equal(+last, d.total - 1, 'the last hero is reachable by scrolling');
    const painted = await p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on .sbw-frow canvas')].every(c => { const g = c.getContext('2d'), data = g.getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < data.length; i += 4) if (data[i]) return true; return false; }));
    assert(painted, 'rows that scroll into view get their portraits immediately');
    await p.evaluate(() => { document.querySelector('.sbw-scr.on .sbw-flist').scrollTop = 0; });
    await p.waitForFunction(() => document.querySelector('.sbw-scr.on .sbw-frow')?.dataset.i === '0');
    // selecting three rows drives the game's own checkboxes and the (cached) native counter follows
    for (let k = 0; k < 3; k++) { await p.locator('.sbw-scr.on .sbw-frow').nth(k).click(); await p.waitForTimeout(250); }
    const picked = await p.evaluate(() => ({ checked: document.querySelectorAll('#p6 .fusion-table input[type=checkbox]:checked').length, slots: [...document.querySelectorAll('.sbw-scr.on .sbw-fslot')].filter(e => !e.hidden).length, on: document.querySelectorAll('.sbw-scr.on .sbw-frow.on').length, counter: (document.querySelector('#p6').innerText.match(/\d+\s*\/\s*3 picked/i) || [''])[0] }));
    assert.equal(picked.checked, 3, 'three native checkboxes are checked');
    assert.equal(picked.slots, 3, 'three fusion slots are shown');
    assert.equal(picked.on, 3, 'the three selected rows show as selected');
    assert(/3\s*\/\s*3 picked/i.test(picked.counter), 'the native counter says 3 / 3 picked: ' + picked.counter);
    const counterShown = await p.evaluate(() => document.body.innerText.includes('3 / 3 picked') || document.body.innerText.includes('3/3 picked') || /3\s*\/\s*3 picked/i.test(document.querySelector('.sbw-scr.on').innerText));
    assert(counterShown, 'the website screen shows the live pick counter (cache not stale)');
    await p.evaluate(() => V2.clearFusion()); await p.waitForTimeout(400);
    assert.equal(await p.evaluate(() => document.querySelectorAll('#p6 .fusion-table input[type=checkbox]:checked').length), 0, 'clearing works');

    // ---- 2. Heroes backdrop: shared, inherited, still resolved on every card
    await open('heroes');
    const bd = await p.evaluate(() => { const cards = [...document.querySelectorAll('#p1 .hero-sheet')]; return { cards: cards.length, inline: cards.filter(c => c.style.getPropertyValue('--hero-backdrop')).length, resolved: cards.filter(c => getComputedStyle(c.querySelector('.hero-portrait'), '::before').backgroundImage.startsWith('url("data:image/png;base64,')).length }; });
    assert(bd.cards >= 10 && bd.inline === 0 && bd.resolved === bd.cards, 'one shared backdrop; every card still resolves it: ' + JSON.stringify(bd));

    // ---- 3. Expedition Hall pages long lists
    await p.evaluate(() => Expedition.refresh()); await p.waitForFunction(() => Expedition.view?.heroes?.length > 300);
    await p.evaluate(() => Expedition.open('duty')); await p.waitForSelector('.sbw-exp-list .sbw-exp-card');
    let hall = await p.evaluate(() => ({ cards: document.querySelectorAll('.sbw-exp-card').length, more: document.querySelector('[data-exp-more]')?.textContent || '' }));
    assert.equal(hall.cards, 60, 'the first page shows 60 cards');
    assert(/Show 60 more \(\d+ left\)/.test(hall.more), 'a "show more" button reports the rest: ' + hall.more);
    await p.locator('[data-exp-more]').click(); await p.waitForTimeout(300);
    hall = await p.evaluate(() => ({ cards: document.querySelectorAll('.sbw-exp-card').length }));
    assert.equal(hall.cards, 120, 'show more adds the next 60');
    await p.evaluate(() => Expedition.close());

    // ---- 4. AUTO low-effects: only when slow, only decorative layers, released again; gameplay values untouched
    await open('home');
    const gameplay = () => p.evaluate(() => JSON.stringify([S.h.slice(0, 40).map(h => [h.id, h.pw, h.sp, h.st, Math.round(h.en)]), [0, 1, 2, 3, 4, 5].map(r => CombatRules.cooldown({ rank: r, baseStats: { pw: 5, sp: 5, st: 5 } }))]));
    await p.waitForFunction(() => !document.querySelector('#sbwLayer').hasAttribute('data-auto-low'), null, { timeout: 60000 });   // the heavier screens above may legitimately have engaged it; it must release
    const before = await gameplay();
    assert.equal(await p.evaluate(() => document.querySelector('#sbwLayer').hasAttribute('data-auto-low')), false, 'a healthy page keeps every effect');
    const cdp = await p.context().newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 24 });
    await p.waitForFunction(() => document.querySelector('#sbwLayer').hasAttribute('data-auto-low'), null, { timeout: 40000 });
    const paused = await p.evaluate(() => { const a = document.getAnimations().filter(x => x.effect?.target?.closest?.('#sbwLayer') && (x.effect.target.matches('.fx, .fx *, .petals i') )); return { total: a.length, paused: a.filter(x => x.playState === 'paused').length }; });
    if (paused.paused !== paused.total) console.log('UNPAUSED:', JSON.stringify(await p.evaluate(() => document.getAnimations().filter(x => x.effect?.target?.closest?.('#sbwLayer') && x.effect.target.matches('.fx, .fx *, .petals i') && x.playState !== 'paused').slice(0, 6).map(x => [x.animationName || x.constructor.name, x.effect.target.className, x.effect.pseudoElement || '']))));
    assert(paused.total > 0 && paused.paused === paused.total, 'when slow, the decorative ambient animations pause (' + paused.paused + '/' + paused.total + ')');
    assert.equal(await p.evaluate(() => document.querySelector('#sbwLayer').dataset.effectsPaused), 'true', 'AUTO also uses the existing effects-paused state (hero frames, auras, rims)');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await p.waitForFunction(() => !document.querySelector('#sbwLayer').hasAttribute('data-auto-low'), null, { timeout: 60000 });
    assert.equal(await p.evaluate(() => document.querySelector('#sbwLayer').dataset.effectsPaused), 'false', 'effects resume when the page is healthy again');
    assert.equal(await gameplay(), before, 'visual quality changes never touch hero stats, chakra or the combat rules');

    // ---- 5. Hidden tab: read-only polling pauses, and catches up the moment the tab is visible again
    const calls = []; p.on('request', r => { try { if (r.method() === 'POST' && /"action":"expedition"/.test(r.postData() || '')) calls.push(Date.now()); } catch {} });
    await open('home'); await p.evaluate(() => Expedition.open('duty')); await p.waitForTimeout(500);   // with the Hall open the state is polled every 20 s
    const live = calls.length; await p.waitForTimeout(23000);
    assert(calls.length - live >= 1, 'a visible tab keeps polling Expedition state (' + (calls.length - live) + ' calls in 23 s)');
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(600); const hiddenFrom = calls.length; await p.waitForTimeout(23000);
    assert.equal(calls.length, hiddenFrom, 'a hidden tab makes no Expedition poll requests');
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(1500);
    assert(calls.length > hiddenFrom, 'coming back to the tab refreshes Expedition state at once');
    await p.evaluate(() => Expedition.close());

    assert.deepEqual(errors, [], 'no page errors');
  });
  console.log('PASS: performance UI — windowed Fusion list (visible rows only, scroll, select, live counter), shared Heroes backdrop, paged Expedition Hall, measured AUTO low-effects (decorative only, released, gameplay unchanged).');
})().catch(e => { console.error(e); process.exit(1); });
