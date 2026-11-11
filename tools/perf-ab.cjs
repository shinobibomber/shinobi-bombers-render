/* A/B experiment (development tool): injects CSS variants into a live screen and measures style recalcs / task time per second.
 * node tools/perf-ab.cjs <home|adventure|heroes> */
const { withGame } = require('../tests/harness.cjs');
const economy = require('../app/server/economy.cjs');
const screen = process.argv[2] || 'home';
const VARIANTS = {
  baseline: '',
  'no animations at all': '#sbwLayer *, #sbwLayer *::before, #sbwLayer *::after { animation: none !important; }',
  'no sweep (bg-position)': '#sbwLayer .sh>.sl::after, #sbwLayer .sl::after { animation: none !important; }',
  'no filter animations': '#sbwLayer .glowp>.sl, .village-banner { animation: none !important; }',
  'no .fx layers': '#sbwLayer .fx, #sbwLayer .petals, #sbwLayer .petals i { animation: none !important; }',
  'hide mirrored canvas filter': 'canvas#cv, .sbw-mirror { filter: none !important; }',
};
(async () => {
  await withGame(async ({ p, f }) => {
    f.holdAdventure = false;
    for (const quantity of [...Array(24).fill(15), 10, 1, 1]) f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity })).profile;
    f.profile.battleReady = f.profile.heroes.slice().sort((a, b) => b.rank - a.rank).slice(0, 10).map(h => h.tokenId);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.MapDesign?.loaded);
    const cdp = await p.context().newCDPSession(p); await cdp.send('Performance.enable');
    await p.evaluate(i => WebsiteDesign.open(i), screen); await p.waitForFunction(i => WebsiteDesign.current() === i, screen);
    if (screen === 'adventure') { await p.evaluate(() => { for (const h of S.h) h.en = CombatRules.maxChakra(h); Experience.workAll(); }); }
    await p.waitForTimeout(2000);
    const get = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    for (const [name, css] of Object.entries(VARIANTS)) {
      await p.evaluate(c => { let s = document.getElementById('__ab'); if (!s) { s = document.createElement('style'); s.id = '__ab'; document.head.appendChild(s); } s.textContent = c; }, css);
      await p.waitForTimeout(700); const a = await get(); await p.waitForTimeout(4000); const b = await get(), secs = 4;
      console.log(name.padEnd(30), 'recalc/s', ((b.RecalcStyleCount - a.RecalcStyleCount) / secs).toFixed(1).padStart(5), ' style ms/s', ((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000 / secs).toFixed(1).padStart(6), ' task ms/s', ((b.TaskDuration - a.TaskDuration) * 1000 / secs).toFixed(1).padStart(6), ' script ms/s', ((b.ScriptDuration - a.ScriptDuration) * 1000 / secs).toFixed(1).padStart(6));
    }
  });
})().catch(e => { console.error(e); process.exit(1); });
