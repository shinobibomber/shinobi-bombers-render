'use strict';
/* Purchase settlement without lost updates (owner request 2026-11-11, "go fix it"), real Store / PGlite. A purchase records only
 * what it changed (profile_delta); confirmed settlement applies that to the CURRENT profile, so changes made while the purchase
 * was pending (a granted hero, a Battle-Ready change, a settings toggle, a Dojo/Sensei field, a hero that left) survive.
 * Refunds change nothing; rows from before this change (no profile_delta) settle exactly as before; Upgrade/Fusion Shard
 * settlement and chakra keep their own rules. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), economy = require('../app/server/economy.cjs'), D = require('../app/server/purchase-delta.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
(async () => {
  /* ---------- Pure functions ---------- */
  const H = (id, extra = {}) => ({ ...economy.hero(0), tokenId: id, ...extra });
  {
    const before = economy.normalizeProfile({ heroes: [H('a'), H('b'), H('c', { level: 1 })], battleReady: ['a', 'b'], dojo: 1, sensei: { on: false } });
    const after = structuredClone(before); after.heroes = after.heroes.filter(h => h.tokenId !== 'a'); after.heroes.find(h => h.tokenId === 'c').level = 2;
    after.heroes.push(H('n')); after.battleReady = ['b', 'n']; after.dojo = 2; delete after.sensei; after.heroes.find(h => h.tokenId === 'b').chakra = 1;
    const d = D.delta(before, after);
    assert.deepEqual([d.added.map(h => h.tokenId), d.removed, d.changed.map(h => h.tokenId), d.readyAdd, d.readyRemove], [['n'], ['a'], ['c'], ['n'], ['a']], 'delta: added, removed, changed (chakra ignored), Battle-Ready');
    assert.deepEqual(d.fields, { dojo: { value: 2 }, sensei: { unset: true } }, 'delta: only the top-level fields the purchase changed');
    assert(!('heroes' in d.fields) && !('upgradeShards' in d.fields), 'heroes and shards are never field overwrites');
    // Meanwhile: c gained chakra, b left (e.g. listed), x was granted, a setting was toggled, x made Battle-Ready.
    const current = structuredClone(before); current.heroes = current.heroes.filter(h => h.tokenId !== 'b'); current.heroes.find(h => h.tokenId === 'c').chakra = 7;
    current.heroes.push(H('x')); current.battleReady = ['a', 'x']; current.settingA = true;
    const next = D.apply(current, d), ids = next.heroes.map(h => h.tokenId).sort();
    assert.deepEqual(ids, ['c', 'n', 'x'], 'consumed hero removed, output added, granted hero kept, a hero that left is not brought back');
    assert.deepEqual([next.heroes.find(h => h.tokenId === 'c').level, next.heroes.find(h => h.tokenId === 'c').chakra], [2, 7], 'changed hero: purchase stats, current chakra');
    assert.deepEqual(next.battleReady.sort(), ['n', 'x'], 'Battle-Ready: purchase changes + concurrent changes, never a hero not owned');
    assert.deepEqual([next.dojo, 'sensei' in next, next.settingA], [2, false, true], 'fields: purchase changes applied, concurrent toggle kept');
    assert.deepEqual(D.apply(D.apply(current, d), d).heroes.length, 3, 'an added hero is never duplicated');
    assert.throws(() => D.apply(current, { v: 2 }), /Unknown purchase change format/);
    assert.equal(current.heroes.length, 3, 'apply never mutates the current profile');
  }

  /* ---------- Real Store ---------- */
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(), now = Date.UTC(2026, 10, 11, 12), rid = 0;
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'purchase-delta-test', () => now);
  const tx = async () => ({ signature: 'pd-sig-' + crypto.randomUUID(), wire: 'wire', lastHeight: 1 });
  const id = () => 'pd-request-' + String(++rid).padStart(8, '0');
  const save = async (w, p) => pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, JSON.stringify(p)]);
  const edit = async (w, f) => { const p = await store.profile(w); f(p); await save(w, p); };   // a change made outside the purchase
  const player = async () => { const w = address(); await edit(w, p => { p.heroes = []; p.battleReady = []; }); await pool.query('UPDATE ryo_accounts SET balance=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, 1e9]); return w; };
  const buy = async (w, product, params) => store.purchase(w, id(), product, params, economy.quote(await store.profile(w), product, params).total, tx);
  const tokens = p => p.heroes.map(h => h.tokenId);

  // Summon pending; meanwhile a hero is granted (Boss Hunt / Founder / Mythic sync), Battle-Ready and a setting change.
  {
    const w = await player(); const granted = H('granted-' + crypto.randomUUID());
    const row = await buy(w, 'summon', { quantity: 5 });
    assert(row.profile_delta && row.profile_delta.added.length === 5, 'the purchase records its change set');
    await edit(w, p => { p.heroes.push(granted); p.battleReady = [granted.tokenId]; p.settingsToggle = 'on'; });
    await store.settlePurchase(w, row.request_id, 'confirmed');
    const p = await store.profile(w);
    assert.equal(p.heroes.length, 6, 'five summoned heroes + the granted one');
    assert(tokens(p).includes(granted.tokenId) && row.result.outputs.every(h => tokens(p).includes(h.tokenId)), 'nothing lost');
    assert(p.battleReady.includes(granted.tokenId) && p.settingsToggle === 'on', 'Battle-Ready and settings changes survive');
  }
  // Dojo pending; meanwhile a different field changes, and a hero is removed.
  {
    const w = await player(); await edit(w, p => p.heroes.push(H('keep'), H('leaves')));
    const row = await buy(w, 'dojo', {});
    await edit(w, p => { p.heroes = p.heroes.filter(h => h.tokenId !== 'leaves'); p.bossHuntSeen = 3; });
    await store.settlePurchase(w, row.request_id, 'confirmed');
    const p = await store.profile(w);
    assert.deepEqual([p.dojo, p.bossHuntSeen, tokens(p)], [1, 3, ['keep']], 'Dojo tier applied, concurrent field kept, a hero that left is not brought back');
  }
  // Fusion pending (consumes three, adds one); meanwhile another hero is granted.
  {
    const w = await player(); const group = Array.from({ length: 3 }, () => ({ ...economy.hero(0), tokenId: crypto.randomUUID(), level: 5 }));
    await edit(w, p => { p.heroes.push(H('spare1'), H('spare2'), ...group); p.battleReady = []; });
    const row = await buy(w, 'fusion', { heroIds: group.map(h => h.tokenId), fusionRulesVersion: 1, fusionRulesAccepted: 1 });
    await edit(w, p => p.heroes.push(H('boss-reward')));
    await store.settlePurchase(w, row.request_id, 'confirmed');
    const p = await store.profile(w);
    assert(group.every(h => !tokens(p).includes(h.tokenId)), 'consumed heroes stay consumed');
    assert(tokens(p).includes('boss-reward'), 'the hero granted during the fusion survives');
    assert.equal(p.heroes.length, 3 + row.result.outputs.length, 'spares + fusion outputs + the granted hero');
  }
  // Training pending; meanwhile chakra drains and Upgrade Shards are earned: stats from the purchase, chakra + shard balance current.
  {
    const w = await player(); const t = H('trainee', { level: 1 }); await edit(w, p => { p.heroes.push(t); p.upgradeShards = 100; });
    const q = economy.quote(await store.profile(w), 'training', { heroId: 'trainee' });
    const row = await store.purchase(w, id(), 'training', { ...q.params, upgradeRulesAccepted: 1 }, q.total, tx);
    const spent = 100 - row.profile_after.upgradeShards; assert(spent > 0);
    await edit(w, p => { p.heroes.find(h => h.tokenId === 'trainee').chakra = 3; p.upgradeShards += 10; p.heroes.push(H('late')); });
    await store.settlePurchase(w, row.request_id, 'confirmed');
    const p = await store.profile(w), h = p.heroes.find(x => x.tokenId === 'trainee'), trained = row.profile_after.heroes.find(x => x.tokenId === 'trainee');
    assert.equal(p.upgradeShards, 110 - spent, 'Upgrade Shards: current balance minus the training cost');
    assert.deepEqual([h.level, h.chakra], [trained.level, 3], 'training stats applied, current chakra kept');
    assert(tokens(p).includes('late'), 'hero added during training survives');
  }
  // Refund: nothing from the purchase, concurrent changes kept.
  {
    const w = await player(); const row = await buy(w, 'summon', { quantity: 1 });
    await edit(w, p => p.heroes.push(H('kept')));
    await store.settlePurchase(w, row.request_id, 'refunded');
    assert.deepEqual(tokens(await store.profile(w)), ['kept'], 'a refund applies nothing and keeps concurrent changes');
  }
  // A row from before this change (no profile_delta) settles exactly as before (purchase-time profile).
  {
    const w = await player(); const row = await buy(w, 'summon', { quantity: 1 });
    await pool.query('UPDATE ryo_purchases SET profile_delta=NULL WHERE scope=$1 AND request_id=$2', [store.scope, row.request_id]);
    await edit(w, p => p.heroes.push(H('legacy-lost')));
    await store.settlePurchase(w, row.request_id, 'confirmed');
    assert.deepEqual(tokens(await store.profile(w)), tokens(row.profile_after), 'legacy settlement unchanged');
  }
  // A replayed settlement is a no-op.
  {
    const w = await player(); const row = await buy(w, 'summon', { quantity: 5 });
    await store.settlePurchase(w, row.request_id, 'confirmed'); await store.settlePurchase(w, row.request_id, 'confirmed');
    assert.equal((await store.profile(w)).heroes.length, 5, 'settling twice adds nothing');
  }
  await db.close();
  console.log('PASS: purchase settlement keeps changes made while a purchase is pending (granted heroes, Battle-Ready, settings, fields, heroes that left), applies only the purchase\'s own change (summon, Dojo, fusion, training), keeps chakra and shard rules, refunds apply nothing, legacy rows settle as before.');
})().catch(e => { console.error(e); process.exitCode = 1; });
