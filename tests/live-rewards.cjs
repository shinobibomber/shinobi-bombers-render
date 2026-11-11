/* Defeating an enemy fetches the server-verified Chest right away; the header Chest and the
 * Adventure "Session gained" banner follow it live. Isolated fixtures only. */
const { withGame } = require('./harness.cjs');
const economy = require('../app/server/economy.cjs');
// Keep this sync test independent of random target priority and the old multi-shot damage rate.
// Targets retain the real Bronze HP. Rarity, trained Power, cooldowns and chakra remain native.
const deployFixture = p => p.evaluate(() => { for(const row of G)for(const c of row)if(c.k>1){c.k=2;c.hp=c.maxHp=GameBalance.enemyHP(2);delete c.boss;}go(0);Experience.workAll(); });
// Register before authentication: a live battle can defeat a target during the login wait.
// Observe the entire authenticated session, exactly as the real cumulative kill report does.
const observeKills = (p, details=false) => p.evaluate(details => {
  window.__k=details?[]:0;
  addEventListener('shinobi-enemy-defeated', e => {
    if(RyoPayments.state.authenticated&&e.detail.kind>=2&&e.detail.kind<=5){if(details)__k.push(e.detail);else __k++;}
  });
}, details);

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    const heroes = Array.from({ length: 4 }, (_, i) => ({ tokenId: 'live-' + i, rank: 4, level: 10, name: 'Live ' + i, baseStats: { pw: 15, sp: 15, st: 15 } }));
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId) });
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    // Measure synthetic defeat bursts with a stationary roster. Deployment has its own valid
    // acknowledgement sync, which must not be mistaken for a duplicate defeat request.
    await p.evaluate(()=>{Experience.restAll();go(0);});
    await p.waitForFunction(() => WebsiteDesign.current() === 'adventure' && AdventureChest.snapshot.chest?.pending === 12345);
    const label = () => p.evaluate(() => [...document.querySelectorAll('.sbw-scr.on .sbw-cover')].some(e => e.textContent === 'SESSION GAINED'));
    assert.equal(await label(), true, 'the banner reads SESSION GAINED, not POTENTIAL REWARD');
    await p.waitForFunction(()=>!AdventureChest.snapshot.busy&&!RyoPayments.state.busy);
    await p.waitForTimeout(1600);
    await p.waitForFunction(()=>!AdventureChest.snapshot.busy&&!RyoPayments.state.busy);

    // The server credits the Chest; a defeated enemy must bring it in without the 15s poll.
    const before = f.requests.filter(r => r.action === 'adventure').length;
    f.pendingChest = 12345 + 812;
    await p.evaluate(() => dispatchEvent(new CustomEvent('shinobi-enemy-defeated', { detail: { kind: 5, reward: 812.5 } })));
    await p.waitForFunction(() => AdventureChest.snapshot.chest?.pending === 13157, null, { timeout: 4000 });
    assert.equal(f.requests.filter(r => r.action === 'adventure').length, before + 1, 'one sync per defeat burst');
    await p.waitForFunction(() => document.querySelector('.sbw-hdr .sbw-chest')?.textContent === 'Chest : 13,157', null, { timeout: 3000 });
    await p.waitForFunction(() => [...document.querySelectorAll('.sbw-scr.on .lv')].some(e => e.textContent === '+812 Ryo'), null, { timeout: 3000 });

    // A burst of defeats is throttled to one more sync, not one per enemy.
    f.pendingChest = 13157 + 400;
    const mid = f.requests.filter(r => r.action === 'adventure').length;
    await p.evaluate(() => { for (let i = 0; i < 10; i++) dispatchEvent(new CustomEvent('shinobi-enemy-defeated', { detail: { kind: 2, reward: 35.6 } })); });
    await p.waitForFunction(() => AdventureChest.snapshot.chest?.pending === 13557, null, { timeout: 5000 });
    assert.equal(f.requests.filter(r => r.action === 'adventure').length, mid + 1, 'ten defeats cause one throttled sync');
    await p.waitForFunction(() => [...document.querySelectorAll('.sbw-scr.on .lv')].some(e => e.textContent === '+1,212 Ryo'), null, { timeout: 3000 });

    // The real battle dispatches the event when an enemy falls.
    await p.evaluate(() => { window.__defeats = 0; addEventListener('shinobi-enemy-defeated', () => window.__defeats++); });
    await deployFixture(p);
    await p.waitForFunction(() => window.__defeats > 0, null, { timeout: 30000 });
    assert.deepEqual(errors, []);
  });
  // End to end with the real server Adventure code: every kill the battle makes is credited, and
  // the Chest equals the sum of the "+X Ryo" rewards shown over the defeated enemies.
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.realAdventure = { rate: 60 };
    const heroes = [0, 1, 2, 3, 4].map(i => ({ tokenId: 'e2e-' + i, rank: i, level: 1, name: 'E ' + i, baseStats: { pw: [2, 4.5, 7.5, 10.5, 13.5][i], sp: [2, 4.5, 7.5, 10.5, 13.5][i], st: [2, 4.5, 7.5, 10.5, 13.5][i] } }));
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId) });
    await observeKills(p,true);
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    await deployFixture(p);
    await p.waitForFunction(() => __k.length >= 12, null, { timeout: 90000 });
    // Stop the battle so no kill lands after the comparison, then let the final sync settle.
    await p.evaluate(() => Experience.restAll());
    await p.waitForTimeout(1500);
    await p.waitForFunction(() => KillReport.pending === 0 && !AdventureChest.snapshot.busy, null, { timeout: 10000 });
    await p.waitForTimeout(1000);
    const r = await p.evaluate(() => ({ kills: __k.length, shown: __k.reduce((n, e) => n + e.reward, 0), chest: AdventureChest.snapshot.chest.pending }));
    assert.equal(f.advData.reportedKills, r.kills, `every defeated enemy is credited by the server (bank ${Math.round(f.advData.reportBudget || 0)} HP)`);
    assert(Math.abs(r.chest - r.shown) < 1, `the Chest (${r.chest}) equals the rewards shown over the enemies (${r.shown})`);
    assert.deepEqual(errors, []);
  });
  // Closing the game: kills from the last seconds are sent at once (keepalive) and still credited;
  // Session gained starts again at 0 when the game is opened again.
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.realAdventure = { rate: 60 };
    const heroes = [0, 1, 2, 3, 4].map(i => ({ tokenId: 'cls-' + i, rank: i, level: 1, name: 'C ' + i, baseStats: { pw: [2, 4.5, 7.5, 10.5, 13.5][i], sp: [2, 4.5, 7.5, 10.5, 13.5][i], st: [2, 4.5, 7.5, 10.5, 13.5][i] } }));
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId) });
    const signIn = async () => { await p.locator('#loginPhantom').click(); await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready); };
    await observeKills(p);
    await signIn();
    await deployFixture(p);
    await p.waitForFunction(() => __k >= 6, null, { timeout: 90000 });
    // Stop the scheduled sync, then close the page the moment more kills are unsent.
    await p.waitForFunction(() => KillReport.pending > 0, null, { timeout: 30000 });
    // A synthetic pagehide does not actually stop this fixture's animation loop.
    // Match a closed page: freeze simulation in the same task as the snapshot,
    // otherwise an already-fired projectile can legitimately add another kill
    // after atClose and make the exact closing-total assertion race the battle.
    const atClose = await p.evaluate(() => { Experience.restAll(); tick=()=>{}; return { kills: __k, gained: SessionRyo.gained }; });
    const before = f.requests.filter(r => r.action === 'adventure').length;
    await p.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
    await p.waitForFunction(n => true, before);
    await new Promise(r => setTimeout(r, 1500));
    const closing = f.requests.filter(r => r.action === 'adventure').slice(before);
    assert(closing.length >= 1 && closing.some(r => r.active === false && Array.isArray(r.killTotals)), 'leaving the game sends the final kill totals');
    assert.equal(f.advData.reportedKills, atClose.kills, 'kills from the last seconds before closing are credited');
    assert(atClose.gained > 0, 'Session gained counted this visit');
    // Reopening in the same tab resumes the saved sign-in (session renewal, 2026-11-11): no new signature or click.
    await p.reload(); await p.waitForFunction(() => window.GameLoading && !GameLoading.active);
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    await p.waitForFunction(() => AdventureChest.snapshot.chest && !AdventureChest.snapshot.busy);
    assert.equal(await p.evaluate(() => SessionRyo.gained), 0, 'Session gained starts at 0 each time the game is opened');
    assert(await p.evaluate(() => AdventureChest.snapshot.chest.pending) > 0, 'the Chest keeps every credited reward');
    assert.deepEqual(errors, []);
  });
  // GO OFFLINE with a Sensei: pending kills are saved, the server is told the player is offline, the
  // wallet disconnects, and coming back shows what the Sensei earned while away.
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.realAdventure = { rate: 60 };
    const heroes = [0, 1, 2, 3, 4].map(i => ({ tokenId: 'off-' + i, rank: i, level: 1, name: 'O ' + i, baseStats: { pw: [2, 4.5, 7.5, 10.5, 13.5][i], sp: [2, 4.5, 7.5, 10.5, 13.5][i], st: [2, 4.5, 7.5, 10.5, 13.5][i] } }));
    f.profile = economy.normalizeProfile({ ...f.profile, heroes, battleReady: heroes.map(h => h.tokenId), sensei: true, senseiEnabled: true });
    const signIn = async () => { await p.locator('#loginPhantom').click(); await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready); };
    await observeKills(p);
    // Diagnostics for the rare 'in-flight defeat' mismatch: report and defeat timeline, printed only when it happens.
    await p.evaluate(()=>{window.__rep=[];window.__kt=[];const of=window.fetch;window.fetch=async(u,o)=>{try{const b=JSON.parse(o?.body||'{}');if(b.action==='adventure')__rep.push({t:Math.round(performance.now()),active:b.active,seq:b.combatSeq,heroes:(b.combatHeroes||[]).map(h=>h.id+':'+h.attacks+'/'+h.kills.join(''))})}catch{}return of(u,o)};addEventListener('shinobi-enemy-defeated',e=>__kt.push({t:Math.round(performance.now()),hero:e.detail.heroId,kind:e.detail.kind}));});
    await signIn();
    assert.equal(await p.locator('.sbw-walletbtn').textContent(), 'GO OFFLINE');
    await deployFixture(p);
    await p.waitForFunction(() => __k >= 5 && KillReport.pending > 0, null, { timeout: 90000 });
    await p.locator('.sbw-hdr [data-sbwid="wallet"]').click();
    await p.waitForSelector('.sbw-offline[open]');
    assert.match(await p.locator('.sbw-offline').textContent(), /Sensei keeps your team fighting for up to 12 hours/);
    const kills = await p.evaluate(() => { Experience.restAll(); return __k; });
    f.holdAdventure=true;const held=p.waitForRequest(r=>r.url().includes('/.netlify/functions/ryo')&&r.postDataJSON()?.action==='adventure');
    await p.evaluate(()=>{void RyoPayments.adventure(true,false).catch(()=>{});});await held;
    const before = f.requests.filter(r => r.action === 'adventure').length;
    await p.locator('.sbw-offline [data-k="go"]').click();
    await p.waitForFunction(()=>CombatClient.leaving);assert(await p.evaluate(()=>RyoPayments.state.authenticated),'offline save waits for the held active read');
    f.holdAdventure=false;f.release('adventure');
    await p.waitForFunction(() => !RyoPayments.state.authenticated && LoginScreen.active, null, { timeout: 10000 });
    const final = f.requests.filter(r => r.action === 'adventure').slice(before);
    assert(final.some(r => r.active === false && Array.isArray(r.killTotals)), 'going offline sends the final kill totals as offline');
    const finalKills=await p.evaluate(()=>__k);assert(finalKills>=kills);if(f.advData.reportedKills!==finalKills){const t=await p.evaluate(()=>({rep:__rep.slice(-4),kills:__kt.slice(-8)}));const sess=Object.entries(f.advData.combatSessions||{}).map(([id,v])=>({id,heroes:Object.fromEntries(Object.entries(v.heroes).map(([h,x])=>[h,x.seen+'/'+x.accepted+'/'+x.kills.join('')]))}));console.error('DIAG',JSON.stringify({reported:f.advData.reportedKills,finalKills,timeline:t,server:sess},null,1));}assert.equal(f.advData.reportedKills,finalKills,'all in-flight defeats are saved before disconnect');
    assert.equal(f.advData.active, false, 'the server marks the player offline right away');
    // Two hours away, then sign in again.
    f.advData.last -= 2 * 3600000;
    for(const h of f.profile.heroes)if(h.chakra){h.chakra.at-=2*3600000;h.chakra.nextAt-=2*3600000;}
    await signIn();
    await p.waitForSelector('.sbw-dialog[open]', { timeout: 10000 });
    const text = await p.locator('.sbw-dialog[open]').textContent();
    assert.match(text, /Welcome back!.*Your Sensei earned [\d,]+ Ryo while you were offline for/s, 'coming back shows the Sensei earnings');
    assert(Number(text.match(/earned ([\d,]+) Ryo/)[1].replace(/,/g, '')) > 0);
    await p.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  });
  // Rotation off: the dialog offers to turn the Sensei on before going offline.
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false; f.profile = { ...f.profile, sensei: true, senseiEnabled: false };
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy && !LoginScreen.active && window.WebsiteDesign?.ready);
    await p.locator('.sbw-hdr [data-sbwid="wallet"]').click();
    await p.waitForSelector('.sbw-offline [data-k="on"]');
    await p.locator('.sbw-offline [data-k="on"]').click();
    await p.waitForFunction(() => !RyoPayments.state.authenticated && LoginScreen.active, null, { timeout: 10000 });
    assert(f.requests.some(r => r.action === 'sensei-settings' && r.enabled === true), 'Turn on Sensei & go offline enables rotation first');
    assert.deepEqual(errors, []);
  });
  console.log('PASS: each defeat fetches the verified Chest within seconds (throttled), the Chest and Session gained count up live, the banner reads SESSION GAINED, the server credits every battle kill (Chest = rewards shown), kills right before closing still count, Session gained resets per visit, and GO OFFLINE saves kills, hands the team to the Sensei and reports offline earnings.');
})().catch(error => { console.error(error); process.exitCode = 1; });
