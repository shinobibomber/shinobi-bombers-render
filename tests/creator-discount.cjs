'use strict';
/* Creator discount (owner decision 2026-11-10): an APPROVED creator pays less for their own game services: 5%, or 10% once any of
 * their referrals (creator link or player link) has a CONFIRMED Founder box (Mythic or Legacy). It is applied after the existing
 * discount, one after the other: the Founder discount or the Mythic Box 10% (those two still never stack with each other).
 * Preview equals charge; non-creators, pending/suspended creators and a closed portal pay the regular price; Boss Hunt is never
 * discounted. Isolated PGlite fixtures only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), cp = require('../app/server/creators-portal.cjs'), economy = require('../app/server/economy.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
(async () => {
  const prior = { redemption: process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED, portal: process.env.CREATORS_PORTAL_ENABLED, admin: process.env.RYO_ADMIN_APPROVERS };
  process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED = 'on'; process.env.CREATORS_PORTAL_ENABLED = 'on';
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(), now = Date.UTC(2026, 10, 10, 12), serial = 0, rid = 0;
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'creator-discount-test', () => now);
  const admin = address(); process.env.RYO_ADMIN_APPROVERS = admin;
  const call = (wallet, action, body = {}) => cp.handle({ store, origin: 'https://shinobi.example' }, wallet, action, body);
  const quote = async (w, product = 'summon', params = { quantity: 1 }) => economy.quote(await store.profile(w), product, params);
  const total = async (w, ...a) => (await quote(w, ...a)).total;
  const creator = async () => { const wallet = address(); await cp.adminAction(store, admin, { operation: 'manual-add', wallet, displayName: 'Creator ' + wallet.slice(0, 4), reason: 'fixture creator' }); await call(wallet, 'creator-terms', { terms: true }); return wallet; };
  const creatorId = async wallet => (await pool.query('SELECT id FROM ryo_creators WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0].id;
  const creatorReferral = async c => { const w = address(); await pool.query('INSERT INTO ryo_creator_referrals(scope,wallet,creator_id,attributed) VALUES($1,$2,$3,$4)', [store.scope, w, await creatorId(c), now]); return w; };
  const playerReferral = async c => { await call(c, 'creator-player-state'); const w = address(); await pool.query('INSERT INTO ryo_player_referrals(scope,wallet,referrer,attributed) VALUES($1,$2,$3,$4)', [store.scope, w, c, now]); return w; };
  const box = (w, status = 'confirmed') => pool.query(`INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,created,settled)
    VALUES($1,$2,$3,'legacy',$4,$5,500000000,$6,'fixture','wire',1,$7,$7)`, [store.scope, crypto.randomUUID(), w, ++serial, 'mint-' + serial, status, now]);
  const founder = (w, tier) => pool.query('INSERT INTO ryo_founder_entitlements(scope,wallet,tier,request_id,mint,granted) VALUES($1,$2,$3,$4,$5,$6)', [store.scope, w, tier, crypto.randomUUID(), 'ent-' + crypto.randomUUID(), now]);
  const mythicBox = async w => { const p = await store.profile(w); p.mythicPerk = true; await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, w, JSON.stringify(p)]); };

  /* ---------- Who gets it ---------- */
  const player = address(); assert.equal(await total(player), 25000, 'a regular player pays the regular price');
  const pending = address(); await call(pending, 'creator-apply', { displayName: 'Pending', platform: 'YouTube', channelUrl: 'https://www.youtube.com/@pending', links: [], reason: 'An honest pending application for review', terms: true });
  assert.equal(await total(pending), 25000, 'a pending (unapproved) creator pays the regular price');
  const c1 = await creator();
  assert.equal(await total(c1), 23750, 'an approved creator pays 5% less'); assert.match((await quote(c1)).title, /Creator −5%$/);
  assert.equal((await call(c1, 'creator-state')).creatorDiscountPercent, 5, 'the dashboard shows the discount');

  /* ---------- 10% once a referral bought a Founder box ---------- */
  const r1 = await creatorReferral(c1); await box(r1, 'pending');
  assert.equal(await total(c1), 23750, 'a pending (unpaid) Founder box does not count');
  await box(address());   // someone else's box does not count either
  assert.equal(await total(c1), 23750);
  const r2 = await creatorReferral(c1); await box(r2);
  assert.equal(await total(c1), 22500, 'a creator-link referral with a confirmed Founder box: 10%'); assert.match((await quote(c1)).title, /Creator −10%$/);
  assert.equal((await call(c1, 'creator-state')).creatorDiscountPercent, 10);
  const c2 = await creator(), pr = await playerReferral(c2); await box(pr);
  assert.equal(await total(c2), 22500, 'a player-link referral with a Founder box counts too');
  const c3 = await creator(); await creatorReferral(c3); await box(c3);
  assert.equal(await total(c3), 23750, 'the creator\'s own box is not a referral\'s box');

  /* ---------- One after the other, after the Founder or Mythic Box discount ---------- */
  await founder(c1, 'mythic');
  assert.equal(await total(c1), 20250, 'Mythic Founder 10% then creator 10%: 25,000 -> 22,500 -> 20,250');
  assert.match((await quote(c1)).title, /Founder Mythic −10% · Creator −10%$/, 'both discounts listed, in order');
  assert.equal(await total(c1, 'summon', { quantity: 15 }), 303750, '15 summons: 375,000 -> 337,500 -> 303,750');
  const c4 = await creator(); await founder(c4, 'legacy');
  assert.equal(await total(c4), 22563, 'Legacy 5% then creator 5%: 25,000 -> 23,750 -> 22,562.5, rounded to 22,563');
  await mythicBox(c4);
  assert.equal(await total(c4), 21375, 'Mythic Box 10% (it still never stacks with Legacy; the larger applies) then creator 5%: 22,500 -> 21,375');
  assert.match((await quote(c4)).title, /Mythic −10% · Creator −5%$/); assert.doesNotMatch((await quote(c4)).title, /Founder Legacy/);
  const c5 = await creator(); await mythicBox(c5); assert.equal(await total(c5), 21375, 'Mythic Box 10% then creator 5%');
  assert.equal(await total(c1, 'hunt', {}), 10000, 'Boss Hunt entry is never discounted');

  /* ---------- Preview equals charge ---------- */
  await pool.query('UPDATE ryo_accounts SET balance=1000000 WHERE scope=$1 AND wallet=$2', [store.scope, c1]);
  const expected = await total(c1), before = Number((await pool.query('SELECT balance FROM ryo_accounts WHERE scope=$1 AND wallet=$2', [store.scope, c1])).rows[0].balance);
  const paid = 'creator-discount-' + String(++rid).padStart(6, '0');
  await store.purchase(c1, paid, 'summon', { quantity: 1 }, expected, async () => ({ signature: 'creator-discount-sig-' + rid, wire: '', lastHeight: 0 }));
  await store.settlePurchase(c1, paid, 'confirmed');
  assert.equal(before - Number((await pool.query('SELECT balance FROM ryo_accounts WHERE scope=$1 AND wallet=$2', [store.scope, c1])).rows[0].balance), 20250, 'the quoted price is exactly what is charged');
  await assert.rejects(store.purchase(c1, 'creator-discount-' + String(++rid).padStart(6, '0'), 'summon', { quantity: 1 }, 25000, async () => ({ signature: 'x', wire: '', lastHeight: 0 })), /Purchase price changed/, 'a stale full-price total is refused');

  /* ---------- It ends with approval or the portal ---------- */
  await cp.adminAction(store, admin, { operation: 'status', creatorId: await creatorId(c2), status: 'SUSPENDED', reason: 'fixture suspension' });
  assert.equal(await total(c2), 25000, 'a suspended creator pays the regular price');
  process.env.CREATORS_PORTAL_ENABLED = 'off';
  assert.equal(await total(c5), 22500, 'portal closed: no creator discount (the Mythic Box 10% stays)');
  process.env.CREATORS_PORTAL_ENABLED = 'on';
  const forged = await store.profile(player); forged.creatorDiscountBps = 1000;
  assert.equal(economy.quote({ ...forged }, 'summon', { quantity: 1 }).total, 22500, 'quote() trusts only the server-written value (sanity)');
  assert.equal(await total(player), 25000, 'every locked read rewrites the value from the database, so a stored value never sticks');
  assert.equal((await store.profile(player)).creatorDiscountBps, undefined);

  await db.close();
  for (const [k, v] of [['FOUNDERS_REWARD_REDEMPTION_ENABLED', prior.redemption], ['CREATORS_PORTAL_ENABLED', prior.portal], ['RYO_ADMIN_APPROVERS', prior.admin]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  console.log('PASS: creator discount — approved creators 5%, 10% with a confirmed Founder-box referral (creator or player link; pending boxes and their own box do not count), applied after the Founder or Mythic Box discount (which never stack), preview = charge, suspended creators / closed portal / Boss Hunt pay the regular price.');
})().catch(e => { console.error(e); process.exitCode = 1; });
