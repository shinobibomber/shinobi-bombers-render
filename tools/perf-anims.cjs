/* Lists the running CSS/Web animations on a screen and the properties they animate (development tool):
 * node tools/perf-anims.cjs <home|adventure|heroes|fusion>. Non-compositor properties force style/paint work every frame. */
const { withGame } = require('../tests/harness.cjs');
const economy = require('../app/server/economy.cjs');
const screen = process.argv[2] || 'home';
const COMPOSITOR = new Set(['transform', 'opacity', 'translate', 'rotate', 'scale', 'filter', 'backdrop-filter', 'offset', 'offsetDistance', 'offsetRotate', 'offsetAnchor', 'offsetPath', 'offsetPosition', 'composite', 'easing', 'computedOffset', 'offset']);
(async () => {
  await withGame(async ({ p, f }) => {
    f.holdAdventure = false;
    for (const quantity of [...Array(24).fill(15), 10, 1, 1]) f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity })).profile;
    f.profile.battleReady = f.profile.heroes.slice().sort((a, b) => b.rank - a.rank).slice(0, 10).map(h => h.tokenId);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    await p.evaluate(i => WebsiteDesign.open(i), screen); await p.waitForFunction(i => WebsiteDesign.current() === i, screen); await p.waitForTimeout(1500);
    const rows = await p.evaluate(() => {
      const out = new Map();
      for (const a of document.getAnimations()) {
        if (a.playState !== 'running') continue;
        const t = a.effect && a.effect.target, name = a.animationName || a.transitionProperty || 'web-animation';
        const props = new Set(); try { for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) props.add(p); } catch { /* ignore */ }
        const sel = t ? (t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + '.' + String(t.className && t.className.baseVal !== undefined ? t.className.baseVal : t.className).trim().split(/\s+/).slice(0, 3).join('.')) : '?';
        const key = name + ' | ' + [...props].filter(x => !['offset', 'computedOffset', 'easing', 'composite'].includes(x)).join(',') + ' | ' + sel.slice(0, 60);
        out.set(key, (out.get(key) || 0) + 1);
      }
      return [...out];
    });
    let bad = 0;
    for (const [key, n] of rows.sort((a, b) => b[1] - a[1])) {
      const props = key.split(' | ')[1].split(',').filter(Boolean), off = props.filter(x => !COMPOSITOR.has(x));
      if (off.length) bad += n; console.log(String(n).padStart(4) + 'x  ' + (off.length ? 'NON-COMPOSITOR ' : '               ') + key);
    }
    console.log('total running animations: ' + rows.reduce((a, [, n]) => a + n, 0) + ', on non-compositor properties: ' + bad);
  });
})().catch(e => { console.error(e); process.exit(1); });
