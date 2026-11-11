/* CPU profile of one scenario (development tool): node tools/perf-profile.cjs <home|adventure|heroes|fusion> [phone]
 * Prints the top self-time functions and the top inclusive-time source files, using the DevTools Profiler. */
const { withGame } = require('../tests/harness.cjs');
const economy = require('../app/server/economy.cjs');
const scenario = process.argv[2] || 'fusion', phone = process.argv[3] === 'phone';
(async () => {
  await withGame(async ({ p, f }) => {
    f.holdAdventure = false;
    for (const quantity of [...Array(24).fill(15), 10, 1, 1]) f.profile = economy.fulfill(f.profile, economy.quote(f.profile, 'summon', { quantity })).profile;
    f.profile.battleReady = f.profile.heroes.slice().sort((a, b) => b.rank - a.rank).slice(0, 10).map(h => h.tokenId);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready && window.MapDesign?.loaded);
    const cdp = await p.context().newCDPSession(p); if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const go = async id => { await p.evaluate(i => WebsiteDesign.open(i), id); await p.waitForFunction(i => WebsiteDesign.current() === i, id, { timeout: 20000 }); await p.waitForTimeout(800); };
    const name = { home: 'home', adventure: 'adventure', heroes: 'heroes', fusion: 'fusion' }[scenario];
    const enter = scenario.startsWith('enter-') ? scenario.slice(6) : null; if (enter) await go('home');
    if (scenario === 'adventure') { await go('adventure'); await p.evaluate(() => { for (const h of S.h) h.en = CombatRules.maxChakra(h); Experience.workAll(); }); await p.waitForTimeout(2500); } else if (!enter) await go(name);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
    if (enter) await p.evaluate(i => WebsiteDesign.open(i), enter);
    await p.waitForTimeout(enter ? 3500 : 5000);
    const { profile } = await cdp.send('Profiler.stop');
    const dt = profile.timeDeltas, self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
    profile.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (dt[i] || 0)));
    const total = [...self.values()].reduce((a, b) => a + b, 0) || 1, rows = new Map(), files = new Map();
    for (const [id, t] of self) {
      const n = byId.get(id), cf = n.callFrame, key = (cf.functionName || '(anonymous)') + '  ' + (cf.url || '').split('/').slice(-2).join('/') + ':' + cf.lineNumber;
      rows.set(key, (rows.get(key) || 0) + t);
      const file = (cf.url || '(native)').split('/').slice(-2).join('/'); files.set(file, (files.get(file) || 0) + t);
    }
    const show = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).forEach(([n, t]) => console.log((t / 1000).toFixed(0).padStart(6) + ' ms  ' + (100 * t / total).toFixed(1).padStart(5) + '%  ' + n.slice(0, 120)));
    if (process.env.CALLERS) { const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id); const by = new Map(); for (const [id, t] of self) { const n = byId.get(id); if (n.callFrame.functionName !== process.env.CALLERS) continue; const chain = []; let cur = parent.get(id), d = 0; while (cur && d++ < 4) { const cf = byId.get(cur).callFrame; chain.push((cf.functionName || '(anon)') + '@' + (cf.url || '').split('/').pop() + ':' + cf.lineNumber); cur = parent.get(cur); } const k = chain.join(' < '); by.set(k, (by.get(k) || 0) + t); } console.log('-- callers of ' + process.env.CALLERS); show(by, 6); }
    console.log('=== ' + scenario + (phone ? ' (phone, 4x CPU)' : '') + ': ' + (total / 1000).toFixed(0) + ' ms sampled over 5 s'); console.log('-- top self-time functions'); show(rows, 18); console.log('-- by file'); show(files, 8);
  }, phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {});
})().catch(e => { console.error(e); process.exit(1); });
