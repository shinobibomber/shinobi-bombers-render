/* Repeatable client performance benchmark (development tool, not part of the regression suite: frame times are machine
 * dependent). Drives the real built game (app/public) in Playwright Chrome against the isolated fixture server from
 * tests/harness.cjs; no wallet, no network, no real data.
 *
 *   node tools/perf-bench.cjs <label> [out.json]
 *
 * Profiles: desktop (1440x1000) and phone (390x844, DPR 2, 4x CPU throttle). Scenarios per profile:
 *   home-idle, adventure-10 (ten deployed heroes fighting), heroes-376, fusion-376, transitions (menu switching).
 * Per scenario: rAF frame times (avg FPS, median/p95/p99/max ms, frames over 33 ms), long tasks (>50 ms), main-thread
 * script/layout/style time from the DevTools Performance domain, JS heap after GC, DOM nodes and canvas counts.
 * Headless Chrome paces rAF at the display rate; use the same machine and the same label order for before/after runs. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('../tests/harness.cjs');
const economy = require('../app/server/economy.cjs');
const label = process.argv[2] || 'run', out = process.argv[3] || path.join(__dirname, '../tests/out/perf-' + label + '.json');
const DURATION = Number(process.env.BENCH_MS) || 6000;
const pct = (a, q) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const r1 = n => Math.round(n * 10) / 10;

async function measure(p, cdp, ms) {
  await cdp.send('HeapProfiler.collectGarbage');
  await p.evaluate(() => {
    window.__b = { fr: [], lt: [], stop: false }; let last = performance.now();
    const loop = t => { window.__b.fr.push(t - last); last = t; if (!window.__b.stop) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__b.lt.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }
  });
  const get = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const m0 = await get(); await p.waitForTimeout(ms); const m1 = await get();
  const page = await p.evaluate(() => { window.__b.stop = true; return { fr: window.__b.fr.slice(2), lt: window.__b.lt, nodes: document.getElementsByTagName('*').length, canvases: document.getElementsByTagName('canvas').length }; });
  await cdp.send('HeapProfiler.collectGarbage'); const m2 = await get();
  const secs = ms / 1000, fr = page.fr, total = fr.reduce((a, b) => a + b, 0) || 1;
  return {
    fps: r1(fr.length / (total / 1000)), frameMedianMs: r1(pct(fr, .5)), p95Ms: r1(pct(fr, .95)), p99Ms: r1(pct(fr, .99)), maxMs: r1(Math.max(0, ...fr)),
    framesOver33ms: fr.filter(x => x > 33.4).length, frames: fr.length,
    longTasks: page.lt.length, longTaskMs: r1(page.lt.reduce((a, b) => a + b, 0)),
    scriptMsPerSec: r1((m1.ScriptDuration - m0.ScriptDuration) * 1000 / secs), layoutMsPerSec: r1((m1.LayoutDuration - m0.LayoutDuration) * 1000 / secs),
    styleMsPerSec: r1((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000 / secs), taskMsPerSec: r1((m1.TaskDuration - m0.TaskDuration) * 1000 / secs),
    layoutsPerSec: r1((m1.LayoutCount - m0.LayoutCount) / secs), styleRecalcsPerSec: r1((m1.RecalcStyleCount - m0.RecalcStyleCount) / secs),
    heapMB: r1(m2.JSHeapUsedSize / 1048576), domNodes: page.nodes, canvases: page.canvases,
  };
}

async function profile(name, pageOptions, throttle) {
  const results = {};
  await withGame(async ({ p, f, errors }) => {
    f.holdAdventure = false;
    for (const quantity of [...Array(24).fill(15), 10, 1, 1]) f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity })).profile;
    f.profile.battleReady = f.profile.heroes.slice().sort((a, b) => b.rank - a.rank).slice(0, 10).map(h => h.tokenId);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.MapDesign?.loaded);
    const cdp = await p.context().newCDPSession(p); await cdp.send('Performance.enable');
    if (throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const go = async id => { await p.evaluate(i => WebsiteDesign.open(i), id); await p.waitForFunction(i => WebsiteDesign.current() === i, id, { timeout: 20000 }); await p.waitForTimeout(800); };
    await go('home'); results['home-idle'] = await measure(p, cdp, DURATION);
    await go('adventure');
    await p.evaluate(() => { for (const h of S.h) h.en = CombatRules.maxChakra(h); Experience.workAll(); });
    await p.waitForFunction(() => S.h.filter(h => h.on).length >= 10, null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2500);
    results['adventure-10'] = await measure(p, cdp, DURATION);
    await go('heroes'); results['heroes-376'] = await measure(p, cdp, DURATION);
    await go('fusion'); results['fusion-376'] = await measure(p, cdp, DURATION);
    // Menu transitions: click-to-ready time (the screen the player asked for is current and painted), 3 rounds.
    const byScreen = {}; const ids = ['home', 'heroes', 'adventure', 'summon', 'fusion', 'dojo', 'home']; const times = [];
    for (let round = 0; round < 3; round++) for (const id of ids) {
      const t = await p.evaluate(async i => { const s = performance.now(); WebsiteDesign.open(i); while (WebsiteDesign.current() !== i && performance.now() - s < 15000) await new Promise(r => requestAnimationFrame(r)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - s; }, id);
      times.push(t); (byScreen[id] = byScreen[id] || []).push(Math.round(t)); await p.waitForTimeout(150);
    }
    results.transitions = { byScreen, count: times.length, medianMs: r1(pct(times, .5)), p95Ms: r1(pct(times, .95)), maxMs: r1(Math.max(...times)) };
    const lastHeap = await measure(p, cdp, 1500); results.afterTransitions = { heapMB: lastHeap.heapMB, domNodes: lastHeap.domNodes, canvases: lastHeap.canvases };
    results.pageErrors = errors.length;
  }, pageOptions);
  return results;
}

(async () => {
  const all = { label, at: new Date().toISOString(), durationMs: DURATION };
  if (process.env.BENCH_ONLY !== 'phone') all.desktop = await profile('desktop', {}, 1);
  if (process.env.BENCH_ONLY !== 'desktop') all.phone = await profile('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 4);
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(all, null, 1));
  const row = (k, r) => r && r.fps ? k.padEnd(14) + ('fps ' + r.fps).padEnd(10) + ('med ' + r.frameMedianMs).padEnd(10) + ('p95 ' + r.p95Ms).padEnd(10) + ('p99 ' + r.p99Ms).padEnd(10) + ('max ' + r.maxMs).padEnd(10) + ('>33ms ' + r.framesOver33ms).padEnd(10) + ('LT ' + r.longTasks).padEnd(7) + ('script ' + r.scriptMsPerSec + 'ms/s').padEnd(18) + ('heap ' + r.heapMB + 'MB').padEnd(12) + ('dom ' + r.domNodes) : '';
  for (const prof of ['desktop', 'phone'].filter(x => all[x])) { console.log('--- ' + prof); for (const k of ['home-idle', 'adventure-10', 'heroes-376', 'fusion-376']) console.log(row(k, all[prof][k])); console.log('transitions   ', JSON.stringify(all[prof].transitions), 'after:', JSON.stringify(all[prof].afterTransitions), 'pageErrors', all[prof].pageErrors); }
  console.log('written ' + out);
})().catch(e => { console.error(e); process.exit(1); });
