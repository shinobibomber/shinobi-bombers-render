'use strict';
/* Promotional Standard Hero Passes (owner request 2026-11-11), real Store / PGlite: rule editing and validation (versions,
 * lock after send), eligibility from authoritative records (paid summons by quantity, starter-Ryo and refunded purchases
 * excluded; deposited holdings = min(balance, deposits - withdrawals)), Tier 1 priority and never both, read-only scan and
 * preview, Send to all (pending only, no usable pass, no Ryo change), re-send/retry idempotent and resuming, switches, claim
 * exactly once (replays, two devices, wrong wallet, quantity from the server only), pass use (bound Shrine-odds heroes, no
 * pity, no Ryo change, replay, insufficient, pending purchase), fusion keeps the binding. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), economy = require('../app/server/economy.cjs'), P = require('../app/server/hero-passes.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
const SW = ['HERO_PASS_ADMIN_ENABLED', 'HERO_PASS_DISTRIBUTION_ENABLED', 'HERO_PASS_CLAIM_UI_ENABLED', 'HERO_PASS_CLAIMS_ENABLED'];
const sw = (name, v) => { process.env[name] = v ? 'on' : 'off'; };
const rejects = async (p, re, m) => assert.rejects(p, e => re.test(e.message), m);
(async () => {
  const env = { ...process.env }; SW.forEach(k => sw(k, true));
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(), now = Date.UTC(2026, 10, 12, 4); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'hero-pass-test', () => now), store2 = new Store(pool, 'hero-pass-test', () => now);   // two app instances
  const audits = []; const audit = async (c, act, target, detail) => { audits.push({ act, target, detail }); };
  const admin = (operation, extra = {}) => P.admin(store, 'approver-wallet', { operation, ...extra }, audit);
  let n = 0; const rid = () => 'hp-request-' + String(++n).padStart(8, '0');
  const buy = async (w, quantity, status = 'confirmed', funding) => pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,$3,'summon',$4,$5,'{}','{}',$6,$7,'w',1,$8,$9)",
    [store.scope, w, rid(), JSON.stringify({ quantity }), JSON.stringify({ product: 'summon', ...(funding ? { funding } : {}) }), quantity * 25000, 'sig-' + crypto.randomUUID(), status, now]);
  const deposit = (w, amount) => pool.query('INSERT INTO ryo_deposits(scope,signature,wallet,amount,request_id,created,gross,studio_fee) VALUES($1,$2,$3,$4,$5,$6,$4,0)', [store.scope, 'dep-' + crypto.randomUUID(), w, amount, rid(), now]);
  const withdraw = (w, amount, status = 'confirmed') => pool.query("INSERT INTO ryo_withdrawals(scope,wallet,request_id,amount,signature,wire,last_height,status,created) VALUES($1,$2,$3,$4,$5,'w',1,$6,$7)", [store.scope, w, rid(), amount, 'wd-' + crypto.randomUUID(), status, now]);
  const setBalance = (w, b) => pool.query('UPDATE ryo_accounts SET balance=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, b]);
  const player = async ({ summons = [], deposits = 0, withdrawals = 0, balance = 0 } = {}) => {
    const w = address(); await store.profile(w); await setBalance(w, balance);
    for (const s of summons) await buy(w, ...(Array.isArray(s) ? s : [s]));
    if (deposits) await deposit(w, deposits); if (withdrawals) await withdraw(w, withdrawals); return w;
  };
  const count = async t => Number((await pool.query('SELECT COUNT(*) AS n FROM ' + t + ' WHERE scope=$1', [store.scope])).rows[0].n);

  const A = await player({ summons: [5, 5, 5], deposits: 60000, balance: 60000 });                       // Tier 1
  const B = await player({ summons: [15], deposits: 60000, withdrawals: 20000, balance: 70000 });          // holdings 40,000 → Tier 2
  const C = await player({ summons: [10, 10], balance: 100000 });                                        // claimed Chest only → Tier 2
  const D = await player({ summons: [14, [5, 'confirmed', 'bonus']], deposits: 90000, balance: 90000 }); // starter Ryo doesn't count
  const E = await player({ summons: [10, [5, 'refunded']], deposits: 90000, balance: 90000 });           // refunded doesn't count
  const F = await player({ summons: [10, [5, 'confirmed', 'chest']], deposits: 50000, balance: 50000 }); // Chest-paid counts; 50,000 exactly
  const G = await player({ balance: 500000, deposits: 500000 });                                        // no summons
  const pending = await player({ summons: [20], deposits: 60000, balance: 60000 });

  /* ---------- Rules ---------- */
  assert.deepEqual((await admin('pass-campaigns')).campaigns, [], 'no campaigns yet');
  for (const bad of [{ passes: 0 }, { passes: 51 }, { passes: 2.5 }, { minPaidSummons: -1 }, { holdings: { enabled: true, minRyo: -5 } }, { name: '' }])
    await rejects(admin('pass-campaign-save', { name: 'X', config: { tiers: [{ ...P.DEFAULT_CONFIG.tiers[0], ...bad }, P.DEFAULT_CONFIG.tiers[1]] } }), /must be a whole number|name is required/, 'invalid ' + JSON.stringify(bad));
  await rejects(admin('pass-campaign-save', { name: 'X', config: { tiers: [] } }), /One or two reward tiers/, 'no tiers refused');
  await rejects(admin('pass-campaign-save', { name: 'X', config: { tiers: [...P.DEFAULT_CONFIG.tiers, P.CUSTOM_PRESET.tiers[0]] } }), /One or two reward tiers/, 'three tiers refused');
  await rejects(admin('pass-campaign-save', { name: 'X', config: { tiers: [{ ...P.CUSTOM_PRESET.tiers[0], passes: null }] } }), /pass quantity must be a whole number/, 'custom reward needs a pass quantity');
  assert.equal(await count('ryo_pass_campaigns'), 0, 'refused rules create nothing');
  const made = (await admin('pass-campaign-save', { name: 'Loyalty Rewards', config: P.DEFAULT_CONFIG })).campaign;
  assert.deepEqual([made.status, made.version], ['draft', 1]);
  await rejects(admin('pass-campaign-save', { campaignId: made.id, version: 7, name: 'Loyalty Rewards', config: P.DEFAULT_CONFIG }), /changed elsewhere/, 'stale version refused');
  const edited = { tiers: [{ ...P.DEFAULT_CONFIG.tiers[0], passes: 10 }, { ...P.DEFAULT_CONFIG.tiers[1], passes: 3 }] };
  const v2 = (await admin('pass-campaign-save', { campaignId: made.id, version: 1, name: 'Loyalty Rewards', config: edited })).campaign;
  assert.deepEqual([v2.version, v2.config.tiers[0].passes], [2, 10], 'Tier 1 quantity edited to 10');
  assert(audits.some(a => a.act === 'admin.pass-campaign-saved' && a.detail.previous.version === 1), 'versioned audit record');

  /* ---------- Scan / preview: read-only, Tier 1 first, never both ---------- */
  const scan = await admin('pass-scan', { campaignId: made.id });
  assert.deepEqual(scan.counts, { tier1: 3, tier2: 2, total: 5, passes: 3 * 10 + 2 * 3 }, 'A, F, pending → Tier 1; B, C → Tier 2');
  const preview = await admin('pass-preview', { campaignId: made.id, page: 0 }), by = Object.fromEntries(preview.rows.map(r => [r.wallet, r]));
  assert.deepEqual([by[A].tier, by[F].tier, by[B].tier, by[C].tier], [1, 1, 2, 2]);
  assert.deepEqual([by[B].evidence.holdingsRyo, by[C].evidence.holdingsRyo, by[F].evidence.paidSummons], [40000, 0, 15], 'holdings rule and Chest-paid summons');
  assert(!by[D] && !by[E] && !by[G], 'starter-Ryo, refunded and no-summon accounts are not eligible');
  assert.equal(await count('ryo_pass_entitlements'), 0, 'scan and preview create nothing');

  /* ---------- Send to all ---------- */
  sw('HERO_PASS_DISTRIBUTION_ENABLED', false);
  await rejects(admin('pass-send', { campaignId: made.id, version: 2, confirm: 'SEND', expectedTotal: 5 }), /not enabled/, 'distribution switch off');
  sw('HERO_PASS_DISTRIBUTION_ENABLED', true);
  await rejects(admin('pass-send', { campaignId: made.id, version: 2, expectedTotal: 5 }), /Confirm the distribution/);
  await rejects(admin('pass-send', { campaignId: made.id, version: 2, confirm: 'SEND', expectedTotal: 4 }), /Eligibility changed/);
  const balancesBefore = (await pool.query('SELECT wallet,balance FROM ryo_accounts WHERE scope=$1 ORDER BY wallet', [store.scope])).rows;
  const heroesBefore = (await store.profile(A)).heroes.length;
  const sent = await admin('pass-send', { campaignId: made.id, version: 2, confirm: 'SEND', expectedTotal: 5 });
  assert.deepEqual([sent.assigned, sent.snapshot, sent.missing, sent.campaign.status], [5, 5, 0, 'done']);
  const ent = (await pool.query("SELECT wallet,tier,passes,status FROM ryo_pass_entitlements WHERE scope=$1 ORDER BY wallet", [store.scope])).rows;
  assert(ent.every(e => e.status === 'pending'), 'distribution only creates pending rewards');
  assert.equal(Number(ent.find(e => e.wallet === A).passes), 10, 'the edited quantity is recorded');
  assert.equal(await count('ryo_pass_balances'), 0, 'no usable pass before a claim');
  assert.deepEqual((await pool.query('SELECT wallet,balance FROM ryo_accounts WHERE scope=$1 ORDER BY wallet', [store.scope])).rows, balancesBefore, 'no Ryo changes');
  assert.equal((await store.profile(A)).heroes.length, heroesBefore, 'no heroes yet');
  await rejects(admin('pass-send', { campaignId: made.id, version: 2, confirm: 'SEND', expectedTotal: 5 }), /already sent/, 'a second Send is refused');
  await rejects(admin('pass-campaign-save', { campaignId: made.id, version: 2, name: 'Changed', config: P.DEFAULT_CONFIG }), /locked/, 'rules lock after Send');
  await setBalance(A, 0);   // a later balance change never removes the reserved reward
  await pool.query('DELETE FROM ryo_pass_entitlements WHERE scope=$1 AND wallet=$2', [store.scope, C]);   // an interrupted batch
  const retried = await admin('pass-retry', { campaignId: made.id });
  assert.deepEqual([retried.assigned, retried.missing], [5, 0], 'retry restores only what is missing');
  await admin('pass-retry', { campaignId: made.id }); assert.equal(await count('ryo_pass_entitlements'), 5, 'retries never duplicate');
  assert.equal((await pool.query("SELECT status FROM ryo_pass_entitlements WHERE scope=$1 AND wallet=$2", [store.scope, A])).rows[0].status, 'pending', 'still reserved after the balance changed');

  /* ---------- Player: claim exactly once ---------- */
  sw('HERO_PASS_CLAIM_UI_ENABLED', false); assert.deepEqual(await P.playerState(store, A), { ui: false }, 'CLAIM switch off: nothing shown');
  sw('HERO_PASS_CLAIM_UI_ENABLED', true);
  const st = await P.playerState(store, A);
  assert.deepEqual([st.ui, st.claims, st.pending.length, st.pending[0].passes, st.pending[0].tierName, st.passes], [true, true, 1, 10, 'Investor Appreciation Reward', 0]);
  assert.deepEqual((await P.playerState(store, D)).pending, [], 'not eligible: no reward');
  sw('HERO_PASS_CLAIMS_ENABLED', false); await rejects(P.claim(store, A, { campaignId: made.id, requestId: rid() }), /not enabled/); sw('HERO_PASS_CLAIMS_ENABLED', true);
  await rejects(P.claim(store, D, { campaignId: made.id, requestId: rid() }), /No reward found/, 'another account cannot claim it');
  const cid = rid(), r1 = await P.claim(store, A, { campaignId: made.id, requestId: cid, quantity: 999 });
  assert.deepEqual([r1.claim.passes, r1.passes], [10, 10], 'credits exactly the recorded quantity (client quantity ignored)');
  assert.equal((await P.claim(store, A, { campaignId: made.id, requestId: cid })).replay, true);
  assert.equal((await P.claim(store, A, { campaignId: made.id, requestId: rid() })).replay, true, 'a second click/tab never credits again');
  assert.equal((await P.playerState(store, A)).passes, 10);
  const two = await Promise.all([P.claim(store, B, { campaignId: made.id, requestId: rid() }), P.claim(store2, B, { campaignId: made.id, requestId: rid() })]);
  assert.equal(two.filter(x => !x.replay).length, 1, 'two devices/instances: one credit'); assert.equal((await P.playerState(store, B)).passes, 3);

  /* ---------- Use passes: bound Shrine-odds heroes ---------- */
  const pity = (await store.profile(A)).shrineLegendPity ?? 0, ryo = await store.balance(A), uid = rid();
  const used = await P.redeem(store, A, { quantity: 3, requestId: uid });
  assert.equal(used.heroes.length, 3); assert.equal(used.passes, 7);
  assert(used.heroes.every(h => h.referralReward === true && h.promoPass === made.id && h.rank >= 0 && h.rank <= 4), 'bound, never Mythic');
  const prof = await store.profile(A);
  assert(used.heroes.every(h => prof.heroes.some(x => x.tokenId === h.tokenId)), 'in the collection');
  assert.deepEqual([prof.shrineLegendPity ?? 0, await store.balance(A)], [pity, ryo], 'no pity change, no Ryo change');
  assert.deepEqual((await P.redeem(store, A, { quantity: 3, requestId: uid })).heroes.map(h => h.tokenId), used.heroes.map(h => h.tokenId), 'replay returns the same heroes');
  await rejects(P.redeem(store, A, { quantity: 2, requestId: uid }), /different amount/);
  await rejects(P.redeem(store, A, { quantity: 8, requestId: rid() }), /Not enough Hero Passes/);
  await rejects(P.redeem(store, A, { quantity: 11, requestId: rid() }), /whole number between 1 and 10/);
  await buy(A, 1, 'pending'); await rejects(P.redeem(store, A, { quantity: 1, requestId: rid() }), /pending purchase/);
  await pool.query("UPDATE ryo_purchases SET status='refunded' WHERE scope=$1 AND wallet=$2 AND status='pending'", [store.scope, A]);
  // Fusion output stays bound when any input is bound.
  const fp = await store.profile(A), bound = { ...used.heroes[0], rank: 0, tokenId: crypto.randomUUID() };
  const genin = [bound, { ...economy.hero(0), tokenId: crypto.randomUUID() }, { ...economy.hero(0), tokenId: crypto.randomUUID() }];
  fp.heroes.push(...genin); fp.battleReady = fp.battleReady.filter(t => !genin.some(g => g.tokenId === t));
  const fq = economy.quote(fp, 'fusion', { heroIds: genin.map(h => h.tokenId), fusionRulesVersion: 1, fusionRulesAccepted: 1 });
  const fout = economy.fulfill(fp, { ...fq, fusion: { ...fq.fusion, successPercent: 100 } }, now).result.outputs[0];
  assert.equal(fout.referralReward, true, 'fusion output stays account-bound when a promotional hero is fused');
  const hist = await admin('pass-history', { campaignId: made.id });
  assert.deepEqual([hist.summary.claimed, hist.summary.claimedPasses, hist.summary.pending, hist.summary.failed], [2, 13, 3, 0], 'history counts');

  /* ---------- Custom reward (owner request 2026-11-12): one tier, 15+ paid summons all time, no holdings, repeatable ---------- */
  assert.deepEqual((await admin('pass-campaigns')).presets.custom, P.CUSTOM_PRESET, 'the custom preset is offered to the admin UI');
  assert.deepEqual([P.CUSTOM_PRESET.tiers.length, P.CUSTOM_PRESET.tiers[0].minPaidSummons, P.CUSTOM_PRESET.tiers[0].holdings.enabled], [1, 15, false]);
  const gift = async (passes, name) => {
    const g = (await admin('pass-campaign-save', { name, config: { tiers: [{ ...P.CUSTOM_PRESET.tiers[0], passes }] } })).campaign;
    assert.deepEqual([g.status, g.config.tiers.length, g.config.tiers[0].passes], ['draft', 1, passes], 'single-tier custom campaign saved');
    return g;
  };
  const g1 = await gift(2, 'Shinobi Appreciation Gift 2026-11-12');
  const gScan = await admin('pass-scan', { campaignId: g1.id });
  assert.deepEqual(gScan.counts, { tier1: 5, tier2: 0, total: 5, passes: 10 }, 'A, B, C, F, pending: 15+ paid summons, holdings ignored');
  const gPrev = await admin('pass-preview', { campaignId: g1.id, page: 0 }), gBy = Object.fromEntries(gPrev.rows.map(r => [r.wallet, r]));
  assert(gBy[C] && gBy[B] && gBy[A], 'no deposits (C) and withdrawn holdings (B) still qualify; a later zero balance (A) too');
  assert(gPrev.rows.every(r => r.tier === 1 && r.passes === 2 && r.tierName === 'Shinobi Appreciation Gift'), 'one tier, the chosen quantity');
  assert(!gBy[D] && !gBy[E] && !gBy[G], 'starter-Ryo, refunded and no-summon accounts are still excluded (G has 500,000 holdings)');
  const ryoBefore = (await pool.query('SELECT wallet,balance FROM ryo_accounts WHERE scope=$1 ORDER BY wallet', [store.scope])).rows;
  const g1Sent = await admin('pass-send', { campaignId: g1.id, version: g1.version, confirm: 'SEND', expectedTotal: 5 });
  assert.deepEqual([g1Sent.assigned, g1Sent.missing, g1Sent.campaign.status], [5, 0, 'done']);
  // Sending again later = a new campaign; the same players receive it again (one entitlement per campaign per account).
  const g2 = await gift(4, 'Shinobi Appreciation Gift 2026-11-19');
  const g2Sent = await admin('pass-send', { campaignId: g2.id, version: g2.version, confirm: 'SEND', expectedTotal: 5 });
  assert.deepEqual([g2Sent.assigned, g2Sent.missing], [5, 0], 'the repeat gift reaches the same 5 accounts');
  const perC = (await pool.query("SELECT campaign_id,passes,status FROM ryo_pass_entitlements WHERE scope=$1 AND wallet=$2 AND campaign_id IN ($3,$4) ORDER BY passes", [store.scope, C, g1.id, g2.id])).rows;
  assert.deepEqual(perC.map(r => [Number(r.passes), r.status]), [[2, 'pending'], [4, 'pending']], 'one pending reward per gift');
  assert.deepEqual((await pool.query('SELECT wallet,balance FROM ryo_accounts WHERE scope=$1 ORDER BY wallet', [store.scope])).rows, ryoBefore, 'custom gifts change no Ryo');
  assert.equal((await P.playerState(store, C)).passes, 0, 'no usable pass before a claim');
  await P.claim(store, C, { campaignId: g1.id, requestId: rid() }); await P.claim(store, C, { campaignId: g2.id, requestId: rid() });
  const cState = await P.playerState(store, C);
  assert.equal(cState.passes, 6, 'both gifts claimed: 2 + 4 passes');
  assert(cState.history.some(e => e.campaign === 'Shinobi Appreciation Gift 2026-11-12' && e.tierName === 'Shinobi Appreciation Gift'), 'player history shows the gift');
  const gHist = await admin('pass-history', { campaignId: g2.id });
  assert.deepEqual([gHist.summary.tier1, gHist.summary.tier2, gHist.summary.claimed, gHist.summary.pending, gHist.summary.failed], [5, 0, 1, 4, 0], 'custom history');

  await db.close(); for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env);
  console.log('PASS: Hero Passes — rules validated/versioned/locked, eligibility (paid summons by quantity incl. Chest-paid; starter Ryo/refunds excluded; holdings = min(balance, deposits - withdrawals)), Tier 1 first and never both, scan/preview read-only, Send creates only pending rewards (no passes, Ryo or heroes), re-send refused, retry resumes without duplicates, rewards stay reserved, switches, claim exactly once (replay, other tab, two instances, wrong wallet, server quantity), pass use (bound Shrine-odds heroes, no pity/Ryo change, replay, limits, pending purchase), fusion keeps the binding, history; custom single-tier reward (15+ paid summons, holdings ignored, chosen quantity, repeat gifts reach the same accounts, no Ryo change, claims add up).');
})().catch(e => { console.error(e); process.exitCode = 1; });
