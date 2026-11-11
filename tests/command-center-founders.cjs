'use strict';
/* Command Center Phase 2, Founder operations (read-only), through the real service dispatcher, Store and schema on PGlite.
 * Covers the role matrix, the collection view (with a fake Solana connection for the optional on-chain check), the entitlement
 * lookup (wallet / mint / "tier #serial"), every integrity check (a clean Founder is never flagged, each seeded defect is),
 * Early Access / Council eligibility, the Premium Summon week tracker, and "no write of any kind". Isolated fixtures only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..'), web3 = require('../app/node_modules/@solana/web3.js'), { Keypair, PublicKey } = web3;
const { Store, hash } = require('../app/server/store.cjs'), { createService, GENESIS } = require('../app/server/service.cjs');
const ops = require('../app/server/command-center-founders.cjs');
(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'app/server/schema.sql'), 'utf8'));
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  const DAY = 86400000, WEEK = 7 * DAY;
  const now0 = Date.UTC(2027, 0, 6, 12);   // a Wednesday
  let now = now0;
  const store = new Store(pool, 'cc-founders-test', () => now);
  const K = n => Keypair.generate().publicKey.toBase58();
  const staff = ['treasury', 'studio', 'revenue', 'mint', 'owner', 'approver', 'operator', 'viewer', 'moderator', 'support', 'outsider'];
  const W = Object.fromEntries(staff.map(n => [n, K()])), kp = {};
  process.env.RYO_ADMIN_OWNERS = W.owner; process.env.RYO_ADMIN_APPROVERS = W.approver; process.env.RYO_ADMIN_OPERATORS = W.operator; process.env.RYO_ADMIN_VIEWERS = W.viewer;
  process.env.FOUNDERS_REWARD_REDEMPTION_ENABLED = 'on';
  // Fake Solana connection: only the read calls the on-chain check makes.
  const T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', chainMints = new Map(), holders = new Map(); let rpcCalls = 0, rpcDown = false, rpcDelayMs = 0, badGenesis = false;
  const parsedMint = o => ({ owner: new PublicKey(o.program || T22), data: { parsed: { info: { supply: o.supply ?? '1', decimals: o.decimals ?? 0, mintAuthority: o.authority ?? null } } } });
  const connection = {
    async getGenesisHash() { return badGenesis ? 'WrongClusterGenesisHash11111111111111111111111' : GENESIS; },
    async getMultipleParsedAccounts(keys) { rpcCalls++; if (rpcDelayMs) await new Promise(r => setTimeout(r, rpcDelayMs)); if (rpcDown) throw Error('RPC down'); return { value: keys.map(k => { const m = chainMints.get(k.toBase58()); if (m) return parsedMint(m); const h = holders.get(k.toBase58()); return h ? { data: { parsed: { info: { owner: h.owner, tokenAmount: { amount: '1' } } } } } : null; }) }; },
    async getTokenLargestAccounts(mintKey) { rpcCalls++; if (rpcDown) throw Error('RPC down'); const a = [...holders.entries()].find(([, h]) => h.mint === mintKey.toBase58()); return { value: a ? [{ address: new PublicKey(a[0]), amount: '1' }] : [] }; },
  };
  const service = createService({ store, connection, treasury: Keypair.generate(), mint: W.mint, origin: 'http://127.0.0.1', studioAddress: W.studio, revenueAddress: W.revenue });
  const tokens = {};
  for (const n of ['owner', 'approver', 'operator', 'viewer', 'moderator', 'support', 'outsider', 'treasury', 'studio', 'revenue']) { tokens[n] = 'ccf-session-' + n; await pool.query('INSERT INTO ryo_sessions(scope,token_hash,wallet,expires) VALUES($1,$2,$3,$4)', [store.scope, hash(tokens[n]), W[n], now + 30 * DAY]); }
  await pool.query("INSERT INTO ryo_cc_roles(scope,wallet,role,granted_by,reason,created) VALUES($1,$2,'moderator',$3,'fixture',$4),($1,$5,'support',$3,'fixture',$4)", [store.scope, W.moderator, W.owner, now, W.support]);
  const call = (n, action, body = {}) => service.handle(action, body, tokens[n]);
  const status = code => e => e.status === code;
  const ACTIONS = ['cc-founder-collections', 'cc-founder-lookup', 'cc-founder-integrity', 'cc-founder-access', 'cc-founder-weeks'];

  /* ---------- Fixture: buyers and their records ---------- */
  const ws = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'gina', 'hank'], B = Object.fromEntries(ws.map(n => [n, K()])), M = Object.fromEntries(ws.map(n => [n, K()]));
  let n = 0; const rid = () => 'founder-fixture-' + String(++n).padStart(8, '0');
  const purchase = (name, tier, serial, status = 'confirmed', price = tier === 'mythic' ? 700000000 : 250000000, created = now0 - 40 * DAY) =>
    pool.query('INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,signature,created,settled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [store.scope, rid(), B[name], tier, serial, M[name], price, status, 'msg', 'wire', 100, status === 'confirmed' ? 'sig-' + name : null, created, status === 'confirmed' ? created + 1000 : null]);
  const entitle = async (name, tier, o = {}) => {
    const p = (await pool.query('SELECT request_id FROM ryo_founder_purchases WHERE scope=$1 AND wallet=$2', [store.scope, B[name]])).rows[0];
    await pool.query('INSERT INTO ryo_founder_entitlements(scope,wallet,tier,request_id,mint,granted,activated,revoked,revoked_reason,limited_passes,trial_started,trial_ends) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [store.scope, B[name], tier, p.request_id, M[name], now0 - 40 * DAY, o.activated ?? null, o.revoked ?? null, o.revoked ? 'fixture suspension' : null, o.passes ?? 0, o.trialStart ?? null, o.trialEnds ?? null]);
  };
  const summon = (name, kind, period, rank, created = now0 - 20 * DAY) => pool.query('INSERT INTO ryo_founder_summons(scope,wallet,request_id,kind,period,rank,roll,hero,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [store.scope, B[name], rid(), kind, period, rank, 1234, JSON.stringify({ tokenId: 'hero-' + n }), created]);
  const profile = (name, data) => pool.query('INSERT INTO ryo_profiles(scope,wallet,data) VALUES($1,$2,$3) ON CONFLICT(scope,wallet) DO UPDATE SET data=EXCLUDED.data', [store.scope, B[name], JSON.stringify(data)]);
  const weekStart = t => { const d = new Date(t), day = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY; };
  const thisWeek = weekStart(now0), act = thisWeek - 6 * WEEK;
  // alice: clean Mythic. Activated 6 weeks ago, 3 qualifying weeks (one Premium claimed), 3 of 10 Limited passes used, founder heroes in the profile.
  await purchase('alice', 'mythic', 1); await entitle('alice', 'mythic', { activated: act, passes: 7 });
  for (const w of [act + WEEK, act + 2 * WEEK, act + 3 * WEEK]) await pool.query('INSERT INTO ryo_founder_weeks(scope,wallet,week,first_seen) VALUES($1,$2,$3,$4)', [store.scope, B.alice, w, w + DAY]);
  for (const r of [1, 2, 1]) await summon('alice', 'limited', null, r); await summon('alice', 'premium', 1, 4);
  await profile('alice', { heroes: [{ tokenId: 'founder-tsukiyomi-' + M.alice, name: 'Tsukiyomi', rank: 5, founderBound: true, founderGrant: 'mythic' }, { tokenId: 'g1', name: 'Legend', rank: 4, founderGrant: 'mythic' }], founderTier: 'mythic', sensei: true, senseiSource: 'founder-mythic' });
  // bob: clean Legacy with a running Sensei trial and a discounted SOL Sensei bought inside it.
  await purchase('bob', 'legacy', 1, 'confirmed', 250000000); const bobAct = now0 - 5 * DAY;
  await entitle('bob', 'legacy', { activated: bobAct, passes: 10, trialStart: bobAct + DAY, trialEnds: bobAct + DAY + 7 * DAY }); await profile('bob', { heroes: [], founderTier: 'legacy' });
  await pool.query("INSERT INTO ryo_sensei_sol_purchases(scope,request_id,wallet,price_lamports,founder_discount,reference,status,message,wire,last_height,signature,created) VALUES($1,$2,$3,200000000,TRUE,$4,'confirmed','m','w',1,'sig-sensei-bob',$5)", [store.scope, rid(), B.bob, K(), bobAct + 2 * DAY]);
  // carol: a confirmed purchase with NO entitlement row (defect).
  await purchase('carol', 'legacy', 2);
  // dave: Mythic who used a pass without activating, passes not adding up, and Premium claims with no qualifying weeks (defects).
  await purchase('dave', 'mythic', 2); await entitle('dave', 'mythic', { activated: now0 - 14 * DAY, passes: 5 }); await summon('dave', 'limited', null, 1); await summon('dave', 'premium', 1, 3); await summon('dave', 'premium', 2, 3);
  // erin: Legacy with a discounted Sensei price but no trial (defect), plus a profile tier on a suspended entitlement (defect).
  await purchase('erin', 'legacy', 3); await entitle('erin', 'legacy', { activated: now0 - 10 * DAY, passes: 10, revoked: now0 - DAY }); await profile('erin', { heroes: [], founderTier: 'legacy' });
  await pool.query("INSERT INTO ryo_sensei_sol_purchases(scope,request_id,wallet,price_lamports,founder_discount,reference,status,message,wire,last_height,signature,created) VALUES($1,$2,$3,200000000,TRUE,$4,'confirmed','m','w',1,'sig-sensei-erin',$5)", [store.scope, rid(), B.erin, K(), now0 - 3 * DAY]);
  // frank: a profile claims a Founder tier but there is no Founder purchase at all (defect); a founder hero sits on the Market (defect).
  await profile('frank', { heroes: [], founderTier: 'mythic' });
  await pool.query("INSERT INTO ryo_market_listings(scope,id,seller,hero,name,rank,perks,price,created,expires) VALUES($1,$2,$3,$4,'Legend',4,'[]',500000,$5,$6)", [store.scope, '11111111-1111-4111-8111-111111111111', B.alice, JSON.stringify({ tokenId: 'listed-founder-hero', rank: 4, founderGrant: 'mythic' }), now0, now0 + 7 * DAY]);
  // gina: a reservation pending for over 30 minutes (warning). hank: an expired reservation only.
  await purchase('gina', 'legacy', 4, 'pending', 250000000, now0 - 2 * 3600000); await purchase('hank', 'legacy', 5, 'expired', 250000000, now0 - 3 * DAY);
  const tableCounts = async () => Object.fromEntries(await Promise.all(['ryo_founder_purchases', 'ryo_founder_entitlements', 'ryo_founder_summons', 'ryo_founder_weeks', 'ryo_sensei_sol_purchases', 'ryo_profiles', 'ryo_accounts', 'ryo_market_listings', 'ryo_founder_audit', 'ryo_admin_audit', 'ryo_cc_requests'].map(async t => [t, JSON.stringify((await pool.query('SELECT * FROM ' + t + ' ORDER BY 1,2,3 LIMIT 1000')).rows)])));
  const before = await tableCounts();
  // From here on, record every SQL statement the service runs: Phase 2 may only SELECT (no write, no row lock).
  const stmts = [], rawQuery = pool.query, rawConnect = pool.connect;
  pool.query = (s, a) => { stmts.push(String(s)); return rawQuery(s, a); };
  pool.connect = async () => { const c = await rawConnect(); return { query: (s, a) => { stmts.push(String(s)); return c.query(s, a); }, release: c.release }; };

  /* ---------- Roles ---------- */
  for (const a of ACTIONS) {
    for (const r of ['viewer', 'moderator', 'support', 'outsider']) await assert.rejects(call(r, a, { query: 'mythic #1' }), status(403), r + ' cannot use ' + a);
    for (const r of ['owner', 'approver', 'operator']) assert.equal((await call(r, a, { query: 'mythic #1' })).status, 'ready', r + ' can read ' + a);
  }
  await assert.rejects(service.handle('cc-founder-integrity', {}, 'not-a-session'), status(401));
  await assert.rejects(call('owner', 'cc-founder-grant', {}), status(404), 'there is no grant, issue or edit action at all');

  /* ---------- Collections ---------- */
  const col = (await call('operator', 'cc-founder-collections')).data;
  const mythic = col.tiers.find(t => t.key === 'mythic'), legacy = col.tiers.find(t => t.key === 'legacy');
  assert.deepEqual([mythic.supply, mythic.sold, mythic.reserved, mythic.remaining], [33, 2, 0, 31]);
  assert.deepEqual([legacy.supply, legacy.sold, legacy.reserved, legacy.expired, legacy.remaining], [30, 3, 1, 1, 26]);
  assert.equal(mythic.grossConfirmedSol, 1.4, 'two confirmed Mythic purchases at 0.7 SOL'); assert.equal(col.totalSupply, 63);
  assert.equal(col.paused, false); assert.equal(col.mode, 'off'); assert.equal(col.chain.status, 'not_checked'); assert.equal(rpcCalls, 0, 'no Solana call unless asked');
  await rawQuery('INSERT INTO ryo_founder_control(scope,paused,updated,actor) VALUES($1,TRUE,$2,$3)', [store.scope, now, W.owner]);
  assert.equal((await call('operator', 'cc-founder-collections')).data.paused, true, 'the sale pause is shown');
  await rawQuery('DELETE FROM ryo_founder_control WHERE scope=$1', [store.scope]);
  // On-chain check: alice's NFT is held by alice, bob's moved to someone else, carol's mint has a mint authority left, dave's mint is missing.
  const stranger = K(), hold = (name, owner) => { const acct = K(); holders.set(acct, { mint: M[name], owner }); };
  chainMints.set(M.alice, {}); hold('alice', B.alice); chainMints.set(M.bob, {}); hold('bob', stranger); chainMints.set(M.carol, { authority: K() }); hold('carol', B.carol);
  const chk = (await call('owner', 'cc-founder-collections', { chain: true })).data.chain;
  assert.equal(chk.status, 'ready'); assert.equal(chk.checked, 5, 'five confirmed Founder purchases are checked (alice, bob, carol, dave, erin)');
  const bySerial = Object.fromEntries(chk.mints.map(m => [m.buyer, m]));
  assert.equal(bySerial[B.alice].holderStatus, 'buyer'); assert.equal(bySerial[B.bob].holderStatus, 'transferred'); assert.equal(bySerial[B.bob].holder, stranger);
  assert.deepEqual(bySerial[B.carol].issues, ['NFT_MINT_AUTHORITY_OPEN']); assert.deepEqual(bySerial[B.dave].issues, ['NFT_MINT_MISSING']); assert.equal(chk.transferred, 1);
  const callsAfter = rpcCalls; await call('owner', 'cc-founder-collections', { chain: true }); assert.equal(rpcCalls, callsAfter, 'the on-chain result is cached');
  rpcDown = true; now += 11 * 60000; const failed = (await call('owner', 'cc-founder-collections', { chain: true })).data.chain; rpcDown = false;
  assert.equal(failed.status, 'unavailable', 'an RPC failure is shown, never as healthy'); assert(failed.note);
  now += 61000; assert.equal((await call('owner', 'cc-founder-collections', { chain: true })).data.chain.status, 'ready', 'a failure is retried after a minute');

  /* ---------- Lookup ---------- */
  const byWallet = (await call('operator', 'cc-founder-lookup', { query: B.alice })).data;
  assert.equal(byWallet.found, true); assert.equal(byWallet.by, 'wallet'); assert.equal(byWallet.entitlement.tier, 'mythic'); assert.equal(byWallet.entitlement.limitedPasses, 7);
  assert.equal(byWallet.summons.filter(s => s.kind === 'limited').length, 3); assert.equal(byWallet.summons.find(s => s.kind === 'premium').roll, 1234);
  assert.deepEqual(byWallet.heroes.map(h => h.source).sort(), ['activation grant', 'buyer-bound Tsukiyomi']);
  assert.deepEqual([byWallet.premium.everyWeeks, byWallet.premium.qualifyingWeeks, byWallet.premium.claimed, byWallet.premium.available], [2, 3, 1, 0]);
  assert.equal(byWallet.market.length, 1, 'the listed Founder hero is shown'); assert.equal(byWallet.chain.holderStatus, 'buyer'); assert(byWallet.issues.some(i => i.code === 'FOUNDER_HEROES_ON_MARKET'));
  assert.equal(byWallet.purchases[0].signature, 'sig-alice');
  assert.equal((await call('operator', 'cc-founder-lookup', { query: M.alice })).data.by, 'mint');
  const bySerialQ = (await call('operator', 'cc-founder-lookup', { query: 'Mythic #1' })).data; assert.equal(bySerialQ.wallet, B.alice); assert.equal(bySerialQ.by, 'serial');
  assert.equal((await call('operator', 'cc-founder-lookup', { query: 'legacy #30' })).data.found, false, 'a free serial finds nothing');
  assert.equal((await call('operator', 'cc-founder-lookup', { query: K() })).data.found, false);
  await assert.rejects(call('operator', 'cc-founder-lookup', { query: 'mythic #99' }), /Serials run from 1 to 33/); await assert.rejects(call('operator', 'cc-founder-lookup', { query: '' }), status(400)); await assert.rejects(call('operator', 'cc-founder-lookup', { query: "x'; DROP TABLE ryo_founder_purchases;--" }), status(400));
  const bobView = (await call('operator', 'cc-founder-lookup', { query: B.bob })).data; assert.equal(bobView.entitlement.trial.running, true); assert.equal(bobView.chain.holderStatus, 'transferred'); assert.equal(bobView.sensei[0].price, 0.2);

  /* ---------- Integrity checks ---------- */
  const integ = (await call('approver', 'cc-founder-integrity')).data, found = Object.fromEntries(integ.checks.map(c => [c.code, c]));
  const walletsOf = c => new Set((found[c].sample || []).map(s => s.wallet || s.seller));
  assert.equal(found.CONFIRMED_WITHOUT_ENTITLEMENT.count, 1); assert(walletsOf('CONFIRMED_WITHOUT_ENTITLEMENT').has(B.carol));
  assert.equal(found.PASS_ACCOUNTING.count, 1, 'dave: 5 passes left + 1 used is not 10'); assert(walletsOf('PASS_ACCOUNTING').has(B.dave));
  assert.equal(found.PREMIUM_OVERCLAIM.count, 1); assert(walletsOf('PREMIUM_OVERCLAIM').has(B.dave));
  assert.equal(found.SENSEI_DISCOUNT_WITHOUT_TRIAL.count, 1); assert(walletsOf('SENSEI_DISCOUNT_WITHOUT_TRIAL').has(B.erin), 'erin: discounted Sensei with no trial');
  assert.equal(found.TIER_WITHOUT_ENTITLEMENT.count, 1); assert(walletsOf('TIER_WITHOUT_ENTITLEMENT').has(B.frank));
  assert.equal(found.TIER_ON_SUSPENDED.count, 1); assert(walletsOf('TIER_ON_SUSPENDED').has(B.erin));
  assert.equal(found.FOUNDER_HEROES_ON_MARKET.count, 1); assert.equal(found.STALE_PENDING.count, 1); assert(walletsOf('STALE_PENDING').has(B.gina));
  for (const code of ['DUPLICATE_WALLET_PURCHASE', 'DUPLICATE_SERIAL', 'SERIAL_OVER_SUPPLY', 'SUMMON_RANK_OUT_OF_POOL', 'ENTITLEMENT_WITHOUT_PURCHASE']) assert.equal(found[code].count, 0, code + ' is clean');
  for (const code of Object.keys(found)) for (const c of [found[code]]) if (c.status === 'ready' && c.sample.length) assert(!walletsOf(code).has(B.alice) || code === 'FOUNDER_HEROES_ON_MARKET', 'alice (clean) is never flagged by ' + code);
  assert(!['PASS_ACCOUNTING', 'PREMIUM_OVERCLAIM', 'CONFIRMED_WITHOUT_ENTITLEMENT', 'SENSEI_DISCOUNT_WITHOUT_TRIAL'].some(c => walletsOf(c).has(B.bob)), 'bob (clean Legacy with a running trial) is never flagged');
  assert(integ.summary.crit >= 5 && integ.summary.warn >= 2);
  for (const code of ['NFT_MINT_MISSING', 'NFT_SUPPLY_MISMATCH', 'NFT_MINT_AUTHORITY_OPEN', 'NFT_WRONG_PROGRAM']) assert(found[code], 'the on-chain check ' + code + ' joins once "Check on chain" ran');
  assert.equal(found.NFT_MINT_AUTHORITY_OPEN.count, 1); assert.equal(found.NFT_MINT_MISSING.count, 2, 'dave and erin have no mint on the fake chain');
  const ownerView = (await call('owner', 'cc-founder-lookup', { query: B.erin })).data; assert(ownerView.issues.some(i => i.code === 'SENSEI_DISCOUNT_WITHOUT_TRIAL') && ownerView.issues.some(i => i.code === 'TIER_ON_SUSPENDED'), 'the lookup lists the wallet\'s own findings');
  assert.equal(ownerView.entitlement.valid, false);

  /* ---------- Access and weeks ---------- */
  const acc = (await call('operator', 'cc-founder-access')).data, accBy = Object.fromEntries(acc.members.map(m => [m.wallet, m]));
  assert.deepEqual([acc.counts.full, acc.counts.community, acc.counts.suspended], [2, 1, 1]);
  assert.equal(accBy[B.alice].council, 'full'); assert.equal(accBy[B.bob].council, 'community'); assert.equal(accBy[B.erin].earlyAccess, 'suspended'); assert.equal(accBy[B.bob].holderStatus, 'transferred');
  assert(acc.notes.some(x => /never opens the game/.test(x)));
  const wk = (await call('operator', 'cc-founder-weeks')).data, wkBy = Object.fromEntries(wk.members.map(m => [m.wallet, m]));
  assert.equal(wk.currentWeek, thisWeek); assert.deepEqual([wkBy[B.alice].qualifyingWeeks, wkBy[B.alice].claimed, wkBy[B.alice].available], [3, 1, 0]); assert.equal(wkBy[B.alice].nextUnlockInWeeks, 1);
  assert.equal(wk.missionPass.status, 'not_implemented'); assert(wk.history.length >= 3); assert.equal(wk.rules.mythicEveryWeeks, 2);

  /* ---------- Nothing was written ---------- */
  assert(stmts.length > 40, 'statements were recorded (' + stmts.length + ')');
  const offenders = stmts.filter(q => !/^\s*(SELECT|WITH)\b/i.test(q) || /\bFOR\s+(UPDATE|SHARE|NO KEY UPDATE)\b/i.test(q));
  assert.deepEqual(offenders, [], 'every statement is a plain SELECT: no write, no row lock');
  assert.deepEqual(await tableCounts(), before, 'no Founder, profile, account, market, audit or request row changed');
  assert.equal(typeof ops.CHECKS[0][3], 'function');

  /* ---------- Hardening ---------- */
  // Custody, studio and revenue wallets never reach the tools, even with a valid session.
  for (const r of ['treasury', 'studio', 'revenue']) for (const a of ACTIONS) await assert.rejects(call(r, a, { query: 'mythic #1' }), status(403), r + ' wallet refused for ' + a);
  // Odd input types are refused, not coerced.
  for (const q of [['mythic #1'], { a: 1 }, 7, null]) await assert.rejects(call('owner', 'cc-founder-lookup', { query: q }), status(400), 'query of type ' + typeof q);
  // The integrity checks are cached for 30 s: a repeat call runs no check queries.
  const nStmts = stmts.length; await call('owner', 'cc-founder-integrity'); assert(stmts.length - nStmts < 8, 'a repeated integrity call is served from the cache (' + (stmts.length - nStmts) + ' statements)');
  // A table missing from the database: those checks report "unavailable", the rest still run, nothing throws.
  now += 31000; await rawQuery('ALTER TABLE ryo_founder_summons RENAME TO ryo_founder_summons_gone');
  const partial = (await call('owner', 'cc-founder-integrity')).data, unavailable = partial.checks.filter(c => c.status === 'unavailable').map(c => c.code);
  await rawQuery('ALTER TABLE ryo_founder_summons_gone RENAME TO ryo_founder_summons');
  assert(unavailable.includes('PASS_ACCOUNTING') && unavailable.includes('SUMMON_RANK_OUT_OF_POOL'), 'checks that need the missing table are unavailable: ' + unavailable);
  assert.equal(partial.checks.find(c => c.code === 'CONFIRMED_WITHOUT_ENTITLEMENT').status, 'ready', 'the other checks still run');
  assert(partial.checks.find(c => c.code === 'PASS_ACCOUNTING').note.includes('does not exist'));
  // A slow chain read never makes the other tabs wait.
  now += 31000 + 11 * 60000; rpcDelayMs = 1500; const slowRead = call('owner', 'cc-founder-collections', { chain: true, refresh: true });
  await new Promise(r => setTimeout(r, 100));
  const t0 = Date.now(); await call('operator', 'cc-founder-integrity'); await call('operator', 'cc-founder-access'); await call('operator', 'cc-founder-lookup', { query: B.alice });
  assert(Date.now() - t0 < 1200, 'integrity / access / lookup do not wait for the chain read (' + (Date.now() - t0) + ' ms)');
  assert.equal((await slowRead).data.chain.status, 'ready'); rpcDelayMs = 0;
  // The RPC must be the cluster this build serves: a wrong cluster is reported, never as "every mint is missing".
  now += 11 * 60000; badGenesis = true; const wrong = (await call('owner', 'cc-founder-collections', { chain: true })).data.chain; badGenesis = false;
  assert.equal(wrong.status, 'unavailable'); assert.match(wrong.note, /not the cluster/);
  // A malformed stored mint address is reported as missing; the check as a whole still works.
  const zed = K(); await pool.query("INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,signature,created,settled) VALUES($1,'founder-bad-mint-0001',$2,'legacy',6,'not-a-valid-address',250000000,'confirmed','m','w',1,'sig-zed',$3,$3)", [store.scope, zed, now0 - DAY]);
  now += 61000 + 11 * 60000; const bad = (await call('owner', 'cc-founder-collections', { chain: true })).data.chain;
  assert.equal(bad.status, 'ready'); const zedMint = bad.mints.find(m => m.mint === 'not-a-valid-address'); assert.deepEqual([zedMint.issues, zedMint.holderStatus], [['NFT_MINT_MISSING'], 'unavailable']);
  // More than 20 findings in one check: the table shows 20, but a wallet's own finding is never cut off.
  for (let serial = 7; serial <= 30; serial++) { const w2 = K(); await rawQuery("INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,signature,created,settled) VALUES($1,$2,$3,'legacy',$4,$5,250000000,'confirmed','m','w',1,$6,$7,$7)", [store.scope, 'founder-many-' + String(serial).padStart(4, '0') + '-xx', w2, serial, K(), 'sig-many-' + serial, now0 - DAY]); }
  now += 31000; const many = (await call('owner', 'cc-founder-integrity')).data.checks.find(c => c.code === 'CONFIRMED_WITHOUT_ENTITLEMENT');
  assert(many.count > 20 && many.sample.length === 20, 'the table shows 20 of ' + many.count);
  assert((await call('owner', 'cc-founder-lookup', { query: B.carol })).data.issues.some(i => i.code === 'CONFIRMED_WITHOUT_ENTITLEMENT'), 'the wallet\'s own finding is found even beyond the first 20');
  // Duplicate serials name their wallets (checked with a duplicate inserted past the unique index).
  await rawQuery('DROP INDEX ryo_founder_serial'); const dup = K();
  await pool.query("INSERT INTO ryo_founder_purchases(scope,request_id,wallet,tier,serial,mint,price_lamports,status,message,wire,last_height,signature,created,settled) VALUES($1,'founder-dup-serial-0001',$2,'mythic',1,$3,700000000,'confirmed','m','w',1,'sig-dup',$4,$4)", [store.scope, dup, K(), now0 - DAY]);
  now += 31000; assert((await call('owner', 'cc-founder-lookup', { query: dup })).data.issues.some(i => i.code === 'DUPLICATE_SERIAL'), 'a duplicate serial is attributed to its wallets');
  await db.close();
  console.log('PASS: Command Center Founder operations — roles (viewer/moderator/support refused), collections with a cached on-chain check, entitlement lookup by wallet/mint/serial, every integrity check flags its seeded defect and no clean Founder, access and week tracker, and no write of any kind.');
})().catch(e => { console.error(e); process.exitCode = 1; });
