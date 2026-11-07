/* Real PostgreSQL-compatible transactions, real wallet signatures; no RPC or live rewards. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), { createService, GENESIS } = require('../app/server/service.cjs');
const cp = require('../app/server/creators-portal.cjs'), adventure = require('../app/server/adventure.cjs');
const addr = k => k.publicKey.toBase58(), newWallet = () => addr(web3.Keypair.generate());
(async () => {
 // Windows Git checkouts use CRLF; the pinned assembled schema must match Linux Render bytes.
 const root = path.resolve(__dirname, '..'), out = path.join(root, 'tests', 'out'); fs.mkdirSync(out, { recursive: true });
 const fixture = fs.mkdtempSync(path.join(out, 'creators-eol-')), originalRead = fs.readFileSync;
 try {
   fs.mkdirSync(path.join(fixture, 'server')); fs.mkdirSync(path.join(fixture, 'public'));
   for (const file of ['service.cjs', 'store.cjs', 'adventure.cjs']) fs.copyFileSync(path.join(root, 'app/server', file), path.join(fixture, 'server', file));
   fs.copyFileSync(path.join(root, 'app/public/index.html'), path.join(fixture, 'public/index.html'));
   const expected = originalRead(path.join(root, 'app/server/schema.sql'), 'utf8'), at = expected.indexOf('\n-- Creators Portal v1:'); assert(at > 0);
   fs.writeFileSync(path.join(fixture, 'server/schema.sql'), expected.slice(0, at));
   const sources = [...['schema.sql','player-schema.sql'].map(file => path.join(root, 'creators-portal',file)), path.join(root, 'prelaunch/schema.sql')];
   fs.readFileSync = function (name, options) { const value = originalRead.apply(this, arguments); return sources.includes(path.resolve(String(name))) && options === 'utf8' ? value.replace(/\r?\n/g, '\r\n') : value; };
   require('../apply-creators-portal.cjs').applyCreatorsPortal(fixture);
   require('../apply-prelaunch.cjs').applyPrelaunch(fixture);   // appended after the Creators Portal schema
   assert.equal(originalRead(path.join(fixture, 'server/schema.sql'), 'utf8'), expected, 'CRLF checkout assembles identical migration bytes');
 } finally {
   fs.readFileSync = originalRead;
   if (!path.resolve(fixture).startsWith(path.resolve(out) + path.sep)) throw Error('Fixture cleanup escaped tests/out');
   fs.rmSync(fixture, { recursive: true, force: true });
 }
 const db = new PGlite(), schema = fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'); await db.exec(schema); await db.exec(schema);
 let tail = Promise.resolve(), failProfile = false; async function lock() { let release; const previous = tail; tail = new Promise(r => release = r); await previous; return release; }
 const runQuery = (sql, args) => { if (failProfile && sql.startsWith('UPDATE ryo_profiles SET data')) { failProfile = false; throw Error('fixture delivery failed'); } return db.query(sql, args); };
 const pool = { async query(s, a) { const release = await lock(); try { return await runQuery(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: runQuery, release }; } };
 let now = Date.UTC(2026, 10, 7, 12), serial = 0;
 const store = new Store(pool, 'isolated-creators', () => now), other = new Store(pool, 'other-creator-scope', () => now);
 const ownerKey = web3.Keypair.generate(), owner = addr(ownerKey), admin = newWallet(), viewer = newWallet(), stranger = newWallet(), operator = newWallet();
 process.env.RYO_ADMIN_APPROVERS = admin; process.env.RYO_ADMIN_VIEWERS = viewer; process.env.RYO_ADMIN_OPERATORS = operator;
 process.env.CREATORS_PORTAL_ENABLED = 'on';
 const ctx = { store, origin: 'https://shinobi.example' }, call = (w, action, body = {}) => cp.handle(ctx, w, action, body);
 const rows = async (sql, args = []) => (await pool.query(sql, [store.scope, ...args])).rows;
 const balance = async () => BigInt((await rows('SELECT balance FROM ryo_creators WHERE scope=$1 AND wallet=$2', [owner]))[0].balance);
 const registerPlayer = async (wallet, ready = true) => store.transaction(async c => {
   await store.locked(c, wallet); const heroes = Array.from({ length: 10 }, (_, i) => ({ tokenId: wallet + '-hero-' + i, rank: 4, level: 1, trainingVersion: 2, identityVersion: 1, perks: [], look: 0, baseStats: { pw: 14, sp: 14, st: 14 }, bonus: { pw: 0, sp: 0, st: 0 } }));
   await store.profileLocked(c, wallet); await c.query('UPDATE ryo_accounts SET balance=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, 100000000]);
   await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify({ heroes, battleReady: ready ? heroes.map(h => h.tokenId) : [], dojo: 0, sensei: false })]);
 });
 async function summon(wallet, quantity = 1, funding = 'balance', status = 'confirmed') {
   if (funding === 'bonus') await pool.query('UPDATE ryo_accounts SET bonus=10000000 WHERE scope=$1 AND wallet=$2', [store.scope, wallet]);
   const requestId = crypto.randomUUID(); now++;
   const row = await store.purchase(wallet, requestId, 'summon', { quantity }, quantity * 25000, async () => ({ signature: 'fixture-' + (++serial), wire: 'fixture-wire', lastHeight: 100 }));
   await store.settlePurchase(wallet, requestId, status); return row;
 }
 async function progress(wallet, target = 100) {
   let state = await adventure.adventure(store, wallet, { active: true }, 1e12), steps = 0;
   while (number((await rows('SELECT proof FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [wallet]))[0].proof.kills) < target) {
     now += 5000; state = await adventure.adventure(store, wallet, { active: true }, 1e12); if (++steps > 100) throw Error('verifier did not progress');
   }
   return state;
 }
 const number = v => Number(v || 0);
 try {
   await cp.initialize(store); await cp.initialize(store);
   const treasury = web3.Keypair.generate(), service = createService({ store, connection: { async getGenesisHash() { return GENESIS; } }, treasury, mint: newWallet(), origin: ctx.origin, studioAddress: newWallet(), revenueAddress: newWallet() });
   await assert.rejects(service.handle('creator-admin', {}, 'forged'), /expired/);
   const challenge = await service.handle('challenge', { wallet: owner }), privateKey = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(ownerKey.secretKey.slice(0, 32))]), format: 'der', type: 'pkcs8' });
   await assert.rejects(service.handle('login', { wallet: owner, nonce: challenge.nonce, signature: Buffer.alloc(64).toString('base64') }), /signature/);
   const signature = crypto.sign(null, Buffer.from(challenge.message), privateKey).toString('base64'), session = await service.handle('login', { wallet: owner, nonce: challenge.nonce, signature });
   await assert.rejects(service.handle('login', { wallet: owner, nonce: challenge.nonce, signature }), /already used/);
   const form = { displayName: 'Moonlit Creator', platform: 'YouTube', channelUrl: 'https://www.youtube.com/@fixture', links: ['https://x.com/fixture'], reason: 'Honest gameplay streams and transparent referral disclosure', terms: true };
   await call(owner, 'creator-apply', form);
   await assert.rejects(call(owner, 'creator-apply', form), /already/);
   await assert.rejects(call(owner, 'creator-redeem', { requestId: crypto.randomUUID(), itemId: 'hero-pass' }), /approved/);
   let own = (await call(owner, 'creator-state')).creator;
   await assert.rejects(call(stranger, 'creator-admin-action', { operation: 'status', creatorId: own.id, status: 'APPROVED', reason: 'frontend admin flag', admin: true }), /administrator/);
   await assert.rejects(call(viewer, 'creator-admin-action', { operation: 'status', creatorId: own.id, status: 'APPROVED', reason: 'viewer' }), /administrator/);
   await call(admin, 'creator-admin-action', { operation: 'status', creatorId: own.id, status: 'APPROVED', reason: 'Verified fixture channel and wallet' });
   let state = await service.handle('creator-state', {}, session.token); assert.equal(state.creator.status, 'APPROVED'); assert(state.link.startsWith(ctx.origin + '/?creator='));
   const invitee = web3.Keypair.generate(), invitedWallet = addr(invitee), invitation = await service.handle('challenge', { wallet: invitedWallet });
   const invitedPrivateKey = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(invitee.secretKey.slice(0, 32))]), format: 'der', type: 'pkcs8' });
   const invitedSession = await service.handle('login', { wallet: invitedWallet, nonce: invitation.nonce, signature: crypto.sign(null, Buffer.from(invitation.message), invitedPrivateKey).toString('base64'), creatorCode: own.code });
   assert.equal(invitedSession.referralAccepted, true, 'first signed login attributes the link before any game state or order');
   await assert.rejects(call(owner, 'creator-attribute', { code: own.code }), /creator identities/i);
   const manual = newWallet(); await call(admin, 'creator-admin-action', { operation: 'manual-add', wallet: manual, displayName: 'Manual Creator', reason: 'Verified wallet and channel' });
   await assert.rejects(call(admin, 'creator-admin-action', { operation: 'manual-add', wallet: manual, displayName: 'Duplicate', reason: 'test' }), /already/);
   assert.equal((await call(manual, 'creator-state')).creator.status, 'APPROVED');
   await call(manual, 'creator-terms', { terms: true });
   const player = newWallet(); await registerPlayer(player); await call(player, 'creator-attribute', { code: own.code });
   await call(player, 'creator-attribute', { code: own.code });
   const manualCode = (await call(manual, 'creator-state')).creator.code;
   await assert.rejects(call(player, 'creator-attribute', { code: manualCode }), /permanent/);
   await assert.rejects(call(admin, 'creator-admin-action', { operation: 'manual-add', wallet: player, displayName: 'Circular identity', reason: 'test' }), /identity/);
   // A client stage, arbitrary kill count or frontend admin flag never proves stage clearance.
   await adventure.adventure(store, player, { active: true, report: { killSession: 'fake-stage-fixture', killStage: 9000, killTotals: [0, 0, 0, 0, 0, 0, 99999, 0] } }, 1e12);
   assert.equal((await rows('SELECT stage5 FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [player]))[0].stage5, null);
   await summon(player, 10); for (let i = 0; i < 4; i++) await summon(player);
   assert.equal((await rows('SELECT paid_mints FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [player]))[0].paid_mints, 14);
   await progress(player, 100); assert.equal(await balance(), 0n, '14 paid mints plus verified Stage 5 does not qualify');
   const fifteenth = await summon(player); assert.equal(await balance(), 50000000n, 'the fifteenth verified mint awards exactly 50,000 CP');
   await store.settlePurchase(player, fifteenth.request_id, 'confirmed'); assert.equal(await balance(), 50000000n, 'settlement replay is idempotent');
   await summon(player, 5); assert.equal(await balance(), 56250000n, 'postqualification 125,000 SR earns 6,250 CP, no repeated milestone');
   let qualified = (await rows('SELECT * FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [player]))[0]; assert.equal(number(qualified.expires) - number(qualified.qualified), 90 * 86400000);
   const paidCount = qualified.paid_mints, beforeBonus = await balance(); await summon(player, 10, 'bonus');
   assert.equal((await rows('SELECT paid_mints FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [player]))[0].paid_mints, paidCount); assert.equal(await balance(), beforeBonus);
   await pool.query('UPDATE ryo_accounts SET bonus=0 WHERE scope=$1 AND wallet=$2', [store.scope, player]);
   await summon(player, 1, 'balance', 'refunded'); assert.equal(await balance(), beforeBonus, 'refunded order earns no CP');
   const second = newWallet(); await registerPlayer(second); await call(second, 'creator-attribute', { code: own.code }); await summon(second, 15);
   assert.equal((await rows('SELECT qualified FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [second]))[0].qualified, null, '15 paid mints without Stage 5 earns no milestone');
   await progress(second, 80); assert.equal((await rows('SELECT qualified FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [second]))[0].qualified, null, 'entering Stage 5 is insufficient');
   await progress(second, 100); assert.equal((await rows("SELECT COUNT(*) AS n FROM ryo_creator_ledger WHERE scope=$1 AND event_id=$2", ['milestone:' + second]))[0].n, 1, 'qualification works in either order');
   // Claiming prequalification Chest earnings pays no commission. Player keeps the whole Ryo claim.
   const beforeClaim = await balance(), beforePlayer = await store.balance(player);
   const firstClaim = await adventure.adventure(store, player, { claim: true }, 1e12);
   assert.equal(await store.balance(player), beforePlayer + firstClaim.credited); assert.equal(await balance(), beforeClaim);
   // Controlled authoritative reward observer fixture: 10,000 newly earned SR, then settle a claim.
   now += 1000;
   await store.transaction(async c => {
     const r = (await c.query('SELECT * FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2 FOR UPDATE', [store.scope, player])).rows[0];
     // Isolate the exact 10,000-SR example from the sub-Ryo prequalification dust that a whole-Ryo
     // claim legitimately leaves behind. FIFO exclusion of the prior full claim was checked above.
     await c.query('UPDATE ryo_creator_adventure_lots SET remaining=0 WHERE scope=$1 AND wallet=$2', [store.scope, player]);
     await cp.endAdventure(store, c, player, { r, parts: [{ eligible: true, amount: 10000000, at: now }] }, 0, null);
     const row = (await c.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, player])).rows[0]; row.data.pending = 10000000; row.data.last = now;
     await c.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, player, JSON.stringify(row.data)]);
   });
   const claim = await adventure.adventure(store, player, { claim: true }, 1e12); assert.equal(claim.credited, 10000); assert.equal(await balance() - beforeClaim, 500000n, '10,000 eligible claimed SR yields 500 CP');
   const afterEligible = await balance(); await assert.rejects(adventure.adventure(store, player, { claim: true }, 0), /funded/); assert.equal(await balance(), afterEligible);
   const previousClaimId = (await rows('SELECT id FROM ryo_reward_claims WHERE scope=$1 AND wallet=$2 ORDER BY id DESC LIMIT 1', [player]))[0].id;
   await store.transaction(async c => {
     const r = (await c.query('SELECT * FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2 FOR UPDATE', [store.scope, player])).rows[0];
     await cp.endAdventure(store, c, player, { r, parts: [{ eligible: true, amount: 1000000, at: now }] }, 0, null);
     const before = (await c.query('SELECT SUM(remaining) AS n FROM ryo_creator_adventure_lots WHERE scope=$1 AND wallet=$2', [store.scope, player])).rows[0].n;
     await cp.endAdventure(store, c, player, { r, parts: [] }, 10000, previousClaimId);
     const after = (await c.query('SELECT SUM(remaining) AS n FROM ryo_creator_adventure_lots WHERE scope=$1 AND wallet=$2', [store.scope, player])).rows[0].n;
     assert.equal(before, after, 'replayed settlement never consumes a later eligible lot');
     const d = (await c.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, player])).rows[0].data; d.pending += 1000000;
     await c.query('UPDATE ryo_adventures SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, player, JSON.stringify(d)]);
   });
   await store.transaction(c => cp.settledPurchase(store, c, { wallet: player, request_id: crypto.randomUUID(), product: 'market', signature: 'fixture-market', wire: 'wire', amount: 100000, created: now, quote: {}, result: {} }));
   await store.transaction(c => cp.settledPurchase(store, c, { wallet: player, request_id: crypto.randomUUID(), product: 'fusion', signature: 'fixture-fusion', wire: 'wire', amount: 25000, created: now, quote: {}, result: { outputs: [{ tokenId: 'fusion' }] } }));
   assert.equal(await balance(), afterEligible + 1250000n, '25,000 eligible service SR earns 1,250 CP; market principal contributes nothing');
   const counter = (await rows('SELECT paid_mints FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [player]))[0].paid_mints; assert.equal(counter, paidCount, 'fusion never counts as paid summons');
   // Program revisions cannot retroactively shorten existing referral windows.
   let settings = await cp.adminSnapshot(store, admin, {});
   await call(admin, 'creator-admin-action', { operation: 'config', version: settings.program.version, config: { ...settings.program.config, commissionDays: 1, enrollmentPaused: true }, reason: 'Future cohorts only' });
   assert.equal((await rows('SELECT expires FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [player]))[0].expires, qualified.expires);
   await assert.rejects(call(newWallet(), 'creator-attribute', { code: own.code }), /paused/);
   const preExpiry = await balance(); now = number(qualified.expires) + 1;
   await store.transaction(c => cp.settledPurchase(store, c, { wallet: player, request_id: crypto.randomUUID(), product: 'summon', signature: 'fixture-expired', wire: 'wire', amount: 25000, created: now - 1, params: { quantity: 1 }, quote: {}, result: { outputs: [{ tokenId: 'expired-hero' }] } }));
   assert.equal(await balance(), preExpiry, 'new commissions stop after saved expiry');
   const lateClaim = await adventure.adventure(store, player, { claim: true }, 1e12);
   assert.equal(lateClaim.credited, 1000); assert.equal(await balance(), preExpiry + 50000n, 'earnings within the saved window can be claimed after expiry');
   // Cosmetic and hero fulfillment share the same transaction as the CP debit and supply reservation.
   const p = await store.profile(owner), beforeHeroes = p.heroes.length; state = await call(owner, 'creator-state');
   let item = state.shop.find(i => i.id === 'hero-pass'); const redeemId = crypto.randomUUID(), order = { requestId: redeemId, itemId: item.id, version: item.version, expectedPriceMilli: item.price };
   await call(owner, 'creator-redeem', order); const spent = await balance(); await call(owner, 'creator-redeem', order);
   assert.equal(await balance(), spent); assert.equal((await store.profile(owner)).heroes.length, beforeHeroes + 1); assert((await store.profile(owner)).heroes.at(-1).creatorReward);
   await call(owner, 'creator-redeem', { ...order, requestId: crypto.randomUUID() });
   await assert.rejects(call(owner, 'creator-redeem', { ...order, requestId: crypto.randomUUID() }), /monthly/);
   const heroLedger = await rows("SELECT COUNT(*) AS n FROM ryo_purchases WHERE scope=$1 AND wallet=$2", [owner]); assert.equal(number(heroLedger[0].n), 0, 'CP rewards create no paid order or reward-pool income');
   assert.deepEqual(state.shop.map(i => i.id), ['hero-pass']);
   for (const itemId of ['creator-aura','creator-frame','creator-badge','creator-bomb']) {
     await assert.rejects(call(owner, 'creator-redeem', { requestId: crypto.randomUUID(), itemId, version: 1, expectedPriceMilli: '1000' }), /retired/);
     await assert.rejects(call(admin, 'creator-admin-action', { operation: 'shop', itemId, priceCp: 1, supply: 1, monthlyLimit: 1, enabled: true, version: 1, reason: 'cannot reopen retired reward' }), /retired/);
   }
   // Retired inventory may exist in an upgraded database but is never returned or redeemable.
   await pool.query("INSERT INTO ryo_creator_shop(scope,id,name,kind,price,supply,monthly_limit) VALUES($1,'creator-aura','Legacy aura','aura',1000,100,1)", [store.scope]);
   const legacyProfile = await store.profile(owner); legacyProfile.creatorCosmetics = { aura: 'creator-aura', frame: 'creator-frame' };
   await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, owner, JSON.stringify(legacyProfile)]);
   assert.deepEqual((await call(owner, 'creator-state')).shop.map(i => i.id), ['hero-pass']);
   assert.deepEqual((await cp.adminSnapshot(store, admin, {})).shop.map(i => i.id), ['hero-pass']);
   const beforeFailure = await balance(), beforeRollbackHeroes = (await store.profile(owner)).heroes.length;
   const shopSettings = (await cp.adminSnapshot(store, admin, {})).shop[0];
   await call(admin, 'creator-admin-action', { operation: 'shop', itemId: 'hero-pass', priceCp: 1, supply: 3, monthlyLimit: 100, enabled: true, version: shopSettings.version, reason: 'One remaining fixture hero' });
   const remaining = { requestId: crypto.randomUUID(), itemId: 'hero-pass', version: 2, expectedPriceMilli: '1000' };
   failProfile = true; await assert.rejects(call(owner, 'creator-redeem', remaining), /delivery failed/);
   assert.equal(await balance(), beforeFailure); assert.equal((await store.profile(owner)).heroes.length, beforeRollbackHeroes);
   assert.equal((await rows('SELECT COUNT(*) AS n FROM ryo_creator_redemptions WHERE scope=$1 AND id=$2', [remaining.requestId]))[0].n, 0);
   const concurrent = await Promise.allSettled([0,1,2].map(() => call(owner, 'creator-redeem', {...remaining,requestId:crypto.randomUUID()})));
   assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1,'global last hero supply cannot race');
   assert.deepEqual((await store.profile(owner)).creatorCosmetics, legacyProfile.creatorCosmetics, 'already delivered cosmetics remain owned after new hero redemptions');
   await call(operator, 'creator-admin-action', { operation: 'status', creatorId: own.id, status: 'SUSPENDED', reason: 'Review signal; preserve earned points' });
   await assert.rejects(call(owner, 'creator-redeem', { ...order, requestId: crypto.randomUUID() }), /approved/);
   assert.equal((await call(owner, 'creator-state')).points, undefined);
   await call(operator, 'creator-admin-action', { operation: 'status', creatorId: own.id, status: 'APPROVED', reason: 'Review resolved' });
   const adjustmentId = crypto.randomUUID(), adjustment = { operation: 'adjust', creatorId: own.id, deltaMilli: 1234, reasonCode: 'correction', requestId: adjustmentId, reason: 'Verified ledger correction' };
   await assert.rejects(call(operator, 'creator-admin-action', adjustment), /approver/);
   const beforeAdjust = await balance(); await call(admin, 'creator-admin-action', adjustment); await call(admin, 'creator-admin-action', adjustment); assert.equal(await balance(), beforeAdjust + 1234n);
   await assert.rejects(call(admin, 'creator-admin-action', { ...adjustment, deltaMilli: 9999 }), /another operation/);
   assert(!(JSON.stringify((await call(owner, 'creator-state')).ledger)).includes(adjustment.reason), 'private administrator evidence is not exposed in creator history');
   const beforeClosure = await balance(); process.env.CREATORS_PORTAL_ENABLED = ' off ';
   await assert.rejects(call(owner, 'creator-state'), /not enabled/);
   await store.transaction(c => cp.settledPurchase(store, c, { wallet: second, request_id: crypto.randomUUID(), product: 'training', signature: 'fixture-existing-cohort', wire: 'wire', amount: 25000, created: now, quote: {}, result: {} }));
   assert.equal(await balance(), beforeClosure + 1250000n, 'closing new portal access preserves commissions owed to an accepted cohort');
   process.env.CREATORS_PORTAL_ENABLED = 'invalid-setting'; await assert.rejects(call(owner, 'creator-state'), /not enabled/); process.env.CREATORS_PORTAL_ENABLED = 'on';
   await call(player, 'creator-appeal', { message: 'Please review my referral evidence.' });
   await assert.rejects(call(player, 'creator-appeal', { message: 'Duplicate' }), /already recorded/);
   const destination = newWallet(), migration = await call(owner, 'creator-migrate', { wallet: destination });
   await assert.rejects(call(stranger, 'creator-migrate', { accept: true, id: migration.migrationId }), /unavailable/);
   await call(destination, 'creator-migrate', { accept: true, id: migration.migrationId });
   assert.equal((await call(destination, 'creator-state')).creator.id, own.id); assert.equal((await call(owner, 'creator-state')).creator, null);
   await assert.rejects(call(owner, 'creator-apply', form), /reserved identity/);
   const report = await cp.adminSnapshot(store, admin, {}); assert(report.audits.some(a => a.action === 'wallet.migrated')); assert(report.ledger.length === 0);
   const publicState = await call(destination, 'creator-state'); assert(publicState.referrals.every(r => !r.wallet)); assert(!JSON.stringify(publicState).includes(player));
   assert.equal((await cp.publicInfo(other, ctx.origin)).rules.enrollmentRemaining, cp.DEFAULTS.enrollmentLimit, 'scopes isolate referral capacity and points');
   process.env.CREATORS_PORTAL_ENABLED = 'off'; await assert.rejects(call(destination, 'creator-state'), /not enabled/); process.env.CREATORS_PORTAL_ENABLED = 'on';
   console.log('PASS: Creators Portal — signed wallet login/replay, admin roles and allowlist, permanent attribution, verified Stage 5, paid mint exclusions/order, exactly-once 50k CP, 5% claimed Adventure/purchase commissions, expiry snapshots, FIFO prequalification exclusion, atomic shop delivery/rollback/concurrency, limits, privacy, corrections, appeals and dual-wallet migration.');
 } finally { await db.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
