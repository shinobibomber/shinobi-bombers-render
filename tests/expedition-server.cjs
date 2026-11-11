'use strict';
/* Expedition Mode server: the read-only Expedition Hall view and the OPTIONAL paid acceleration through the real service
 * (PGlite, mocked RPC, throw-away keys; nothing touches a network or a real token).
 * Runs three isolated processes: live Token-2022 (the released SR mint program), live classic SPL, and the devnet test server.
 * Proves: every lock closed by default; server-authoritative remaining-time quotes (Founder pays less only through the shorter
 * Expedition); the exact Expedition split (50% Active Reward Pool, 30% Locked Treasury, 10% Community, 10% Reserve; owner
 * decision 2026-11-11, no burn) in base units with conservation; ONE custody-signed atomic transaction of exactly four
 * transferChecked to the reviewed registry destinations and NO burn instruction (official mint, 6 decimals, custody
 * authority, correct token program) and a memo; no Starter Ryo, no Chest, no client amounts; release only at finalized
 * settlement; refund on failure (hero stays away, no evidence booked); idempotent replays; one pending payment at a time;
 * no Adventure income from the 50% Reward Pool share; and the existing 50/30/10/10 service router unchanged (no burn in a summon). */
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '').slice(7);
if (!MODE) {
  const { spawnSync } = require('node:child_process');
  for (const mode of ['live-t22', 'live-spl', 'devnet']) {
    const r = spawnSync(process.execPath, [__filename, '--mode=' + mode], { stdio: 'inherit', env: process.env });
    if (r.status !== 0) { console.error('FAILED: expedition-server ' + mode); process.exit(r.status || 1); }
  }
  console.log('PASS: Expedition server (live Token-2022, live SPL, devnet): closed locks, quotes, 50/30/10/10 atomic custody transaction with no burn, settlement, refund, idempotency, isolation from existing services.');
  process.exit(0);
}
const LIVE = MODE.startsWith('live'), T22 = MODE === 'live-t22';
const fixture = require('./sr-revenue-fixture.cjs'); if (LIVE) fixture.liveEconomy();
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js'), splBase = require('../app/node_modules/@solana/spl-token'), bs58 = require('../app/node_modules/bs58');
const PROGRAM = T22 ? splBase.TOKEN_2022_PROGRAM_ID : splBase.TOKEN_PROGRAM_ID;
const { Store } = require('../app/server/store.cjs'), { createService } = require('../app/server/service.cjs'), economy = require('../app/server/economy.cjs');
const X = require('../app/server/expedition.cjs'), D = require('../app/server/combat-duty.cjs'), sr = require('../app/server/sr-revenue.cjs');
const player = web3.Keypair.generate(), treasury = web3.Keypair.generate(), studio = web3.Keypair.generate().publicKey, revenue = web3.Keypair.generate().publicKey, mint = web3.Keypair.generate().publicKey;
if (LIVE) { fixture.activate(mint, T22 ? { program: 'token-2022' } : {}); process.env.RYO_STUDIO_WALLET = studio.toBase58(); process.env.RYO_REVENUE_WALLET = revenue.toBase58(); }
const wallet = player.publicKey.toBase58(), scope = 'solana-devnet:' + mint + ':' + treasury.publicKey, UNIT = 1000000n, H = D.HOUR;
const statuses = new Map(), wires = new Map();
let now = 1900000000000, autoFinalize = true, failNext = false;
const connection = {
  async getBalance() { return 5000000000; }, async getFeeForMessage() { return { value: 5000 }; }, async getMinimumBalanceForRentExemption(size) { return size === 0 ? 890880 : 2039280; },
  async getGenesisHash() { return require('../app/server/service.cjs').GENESIS; }, async getBlockHeight() { return 1; }, async getParsedTransaction() { return null; },
  async getSignatureStatuses(hashes) { return { value: hashes.map(h => statuses.get(h) || null) }; },
  async getLatestBlockhash() { return { blockhash: web3.Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 50 }; },
  async getTokenAccountBalance() { return { value: { amount: (1000000000n * UNIT).toString() } }; },
  async getAccountInfo(pubkey) {
    if (LIVE) { const known = fixture.chainAccount(pubkey, mint); if (known !== undefined) return known; }
    if (pubkey.equals(revenue)) return fixture.multisig();
    const data = Buffer.alloc(splBase.MINT_SIZE); splBase.MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: web3.PublicKey.default, supply: 1000000000n * UNIT, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: web3.PublicKey.default }, data);
    return { owner: PROGRAM, data: T22 ? fixture.token2022(data, 'mint', ['MetadataPointer', 'TokenMetadata']) : data };
  },
  async sendRawTransaction(wire) {
    const tx = web3.Transaction.from(wire); assert.ok(tx.verifySignatures(), 'custody-signed'); assert.ok(wire.length <= 1232, 'fits one Solana transaction');
    assert.equal(tx.feePayer.toBase58(), treasury.publicKey.toBase58());
    const hash = bs58.encode(tx.signature); wires.set(hash, tx);
    if (failNext) { failNext = false; statuses.set(hash, { confirmationStatus: 'finalized', err: { InstructionError: [0, 'Custom'] } }); }
    else if (autoFinalize) statuses.set(hash, { confirmationStatus: 'finalized', err: null });
    return hash;
  }
};
const set = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
(async () => {
  const db = new PGlite(), schema = fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8');
  // Live already has the empty v1 table (with burn_raw, created 2026-11-11): the schema must migrate it, twice without error.
  await db.exec('CREATE TABLE ryo_expedition_revenue(scope TEXT NOT NULL,wallet TEXT NOT NULL,request_id TEXT NOT NULL,signature TEXT NOT NULL,hero_id TEXT NOT NULL,expedition_start BIGINT NOT NULL,total_raw NUMERIC(40,0) NOT NULL CHECK(total_raw>0),allocations JSONB NOT NULL,destinations JSONB NOT NULL,burn_raw NUMERIC(40,0) NOT NULL CHECK(burn_raw>0),released BOOLEAN NOT NULL,network TEXT NOT NULL,created BIGINT NOT NULL,PRIMARY KEY(scope,wallet,request_id),UNIQUE(scope,signature))');
  await db.exec(schema); await db.exec(schema);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name='ryo_expedition_revenue' AND column_name='burn_raw'")).rows[0].n, 0, 'v1 burn column removed');
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, scope, () => now); X.useClock(() => now);
  const service = createService({ store, connection, treasury, mint: mint.toBase58(), origin: 'https://shinobi-beta.example', studioAddress: studio.toBase58(), revenueAddress: revenue.toBase58() });
  if (LIVE) await fixture.configure(store);
  const challenge = await service.handle('challenge', { wallet });
  const key = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(player.secretKey.slice(0, 32))]), format: 'der', type: 'pkcs8' });
  const session = await service.handle('login', { wallet, nonce: challenge.nonce, signature: crypto.sign(null, Buffer.from(challenge.message), key).toString('base64') });
  await pool.query('UPDATE ryo_sessions SET expires=$1', [now + 30 * economy.DAY]);
  const call = (action, body = {}) => service.handle(action, body, session.token);
  await call('state');
  const balance = async () => Number((await pool.query('SELECT balance,bonus FROM ryo_accounts WHERE scope=$1 AND wallet=$2', [scope, wallet])).rows[0].balance);
  const setBalance = (b, bonus = 0) => pool.query('UPDATE ryo_accounts SET balance=$3,bonus=$4 WHERE scope=$1 AND wallet=$2', [scope, wallet, b, bonus]);
  // Two heroes on Expeditions (Legend regular, Mythic snapshot as Founder), one fighting.
  const p = await store.profile(wallet), mk = (id, rank, extra) => ({ ...economy.hero(rank), tokenId: id, name: id + ' of Ember Ridge', ...extra });
  const legend = mk('legend-1', 4), mythic = mk('mythic-1', 5), genin = mk('genin-1', 0);
  for (const h of [legend, mythic, genin]) h.chakra = { version: 1, value: 3, at: now, nextAt: now, resting: true };
  legend.chakra.duty = { v: 1, ms: D.DUTY_CAP_MS, exp: { start: now - H, ends: now + 5 * H, ms: 6 * H, rank: 4, founder: false } };
  mythic.chakra.duty = { v: 1, ms: D.DUTY_CAP_MS, exp: { start: now - H, ends: now + 3 * H, ms: 4 * H, rank: 5, founder: true } };
  genin.chakra.duty = { v: 1, ms: 12 * H };
  p.heroes = [legend, mythic, genin]; p.battleReady = ['legend-1', 'mythic-1', 'genin-1'];
  await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [scope, wallet, JSON.stringify(p)]);
  const T0 = now, params = (id, start = T0 - H) => ({ heroId: id, expeditionStart: start });

  // 1. Every lock closed by default: no Expedition view content, no quote, no payment.
  for (const k of ['EXPEDITIONS_ENABLED', 'EXPEDITION_ACCELERATION_ENABLED', 'EXPEDITION_ROUTING_ENABLED', 'EXPEDITION_ACCELERATION_PRICES']) set(k);
  let view = (await call('expedition')).expedition;
  assert.equal(view.enabled, false, 'Expedition Mode is OFF by default'); assert.equal(view.acceleration.available, false);
  await assert.rejects(call('quote', { product: 'expedition', params: params('legend-1') }), e => e.status === 403 && e.code === 'EXPEDITION_ACCELERATION_CLOSED');
  set('EXPEDITIONS_ENABLED', 'on');
  await assert.rejects(call('quote', { product: 'expedition', params: params('legend-1') }), /not available yet/, 'acceleration switch still off');
  set('EXPEDITION_ACCELERATION_ENABLED', 'on');
  await assert.rejects(call('quote', { product: 'expedition', params: params('legend-1') }), /not available yet/, 'routing lock still off');
  set('EXPEDITION_ROUTING_ENABLED', 'on');
  if (LIVE) {
    await assert.rejects(call('quote', { product: 'expedition', params: params('legend-1') }), /not available yet/, 'live: unapproved prices are never used');
    assert(X.accelerationProblems().some(p => /prices/.test(p)));
    set('EXPEDITION_ACCELERATION_PRICES', '5000,10000,20000,40000,75000,150000');
  } else assert.deepEqual(X.prices(), X.PROVISIONAL_PRICES, 'devnet: provisional test prices');
  set('EXPEDITION_ACCELERATION_PRICES', 'nonsense'); assert.equal(X.prices(), null, 'invalid price configuration closes acceleration');
  set('EXPEDITION_ACCELERATION_PRICES', '5000,10000,20000,40000,75000,150000');

  // 2. The view: statuses and server-computed quotes (remaining time, rounded up to the minute).
  view = (await call('expedition')).expedition;
  const vh = id => view.heroes.find(h => h.tokenId === id);
  assert.equal(view.enabled, true); assert.equal(view.capMs, 18 * H); assert.equal(view.acceleration.available, true);
  assert.deepEqual(view.acceleration.policy.ratesBps, { activeRewards: 5000, lockedTreasury: 3000, communityRewards: 1000, economicReserve: 1000 });
  assert.equal(vh('legend-1').status, 'expedition'); assert.equal(vh('legend-1').remainingMs, 5 * H); assert.equal(vh('genin-1').status, 'duty'); assert.equal(vh('genin-1').dutyMs, 12 * H);
  assert.equal(vh('legend-1').quote.total, Math.ceil(75000 * 5 / 6), 'Legend: 5 of 6 regular hours left');
  assert.equal(vh('mythic-1').quote.total, Math.ceil(150000 * 3 / 8), 'Founder Mythic: 3 h left of a 4 h Expedition, priced per regular hour (no extra discount)');
  assert.equal(vh('genin-1').quote, undefined, 'no quote for a hero that is not away');

  // 3. Quotes: server-authoritative and bound to the exact Expedition.
  const q = await call('quote', { product: 'expedition', params: params('legend-1') });
  assert.equal(q.total, 62500); assert.equal(q.noBonus, true); assert.equal(q.operations, 0); assert.equal(q.adventureEligible, false); assert.equal(q.studioFee, 0);
  assert.equal(q.revenueDistribution, undefined, 'never routed through the 50/30/10/10 service router');
  const al = q.expeditionDistribution.allocations, raw = BigInt(q.total) * UNIT;
  assert.deepEqual(al, { activeRewards: String(raw / 2n), lockedTreasury: String(raw * 3n / 10n), communityRewards: String(raw / 10n), economicReserve: String(raw / 10n) });
  assert.equal(al.burn, undefined, 'no burn allocation'); assert.equal(q.burn, 0);
  assert.equal(Object.values(al).reduce((n, v) => n + BigInt(v), 0n), raw, '50 + 30 + 10 + 10 = 100%');
  await assert.rejects(call('quote', { product: 'expedition', params: params('legend-1', T0 - 2 * H) }), /changed/, 'a stale Expedition reference is refused');
  await assert.rejects(call('quote', { product: 'expedition', params: params('genin-1') }), /not on an Expedition/);
  await assert.rejects(call('quote', { product: 'expedition', params: params('nobody') }), /Choose one of your heroes/);
  // Conservation and deterministic rounding for any base-unit total (the Economic Reserve takes the remainder).
  for (const t of [1n, 3n, 7n, 9n, 11n, 99n, 10001n, 123456789n, 2n ** 64n - 1n, ...Array.from({ length: 200 }, () => BigInt('0x' + crypto.randomBytes(8).toString('hex')) + 1n)]) {
    const s = X.splitRaw(t), sum = Object.values(s).reduce((n, v) => n + BigInt(v), 0n); assert.equal(sum, t);
    assert(BigInt(s.economicReserve) >= t / 10n && BigInt(s.economicReserve) <= t / 10n + 3n, 'deterministic rounding: at most 3 base units of remainder go to the Economic Reserve');
    assert.deepEqual(Object.keys(s), ['activeRewards', 'lockedTreasury', 'communityRewards', 'economicReserve']);
  }

  // 4. Payment refusals: wrong total, Starter Ryo, Chest, insufficient balance; nothing is charged or sent.
  await setBalance(1000000);
  const sent = wires.size, id1 = crypto.randomUUID();
  await assert.rejects(call('purchase', { product: 'expedition', params: q.params, expectedTotal: q.total + 1, requestId: id1 }), /price changed/);
  await setBalance(0, 1000000);
  await assert.rejects(call('purchase', { product: 'expedition', params: q.params, expectedTotal: q.total, requestId: crypto.randomUUID() }), /Not enough deposited Ryo/, 'Starter Ryo never pays for acceleration');
  await setBalance(1000000);
  await assert.rejects(call('purchase', { product: 'expedition', params: q.params, expectedTotal: q.total, requestId: crypto.randomUUID(), funding: 'chest' }), /Chest rewards pay for/, 'Chest rewards never pay for acceleration');
  assert.equal(wires.size, sent, 'no transaction was sent'); assert.equal(await balance(), 1000000);

  // 5. Successful payment: one atomic custody transaction, verified instruction by instruction.
  const id = crypto.randomUUID(), before = await balance();
  const done = await call('purchase', { product: 'expedition', params: q.params, expectedTotal: q.total, requestId: id });
  assert.equal(done.purchase.status, 'confirmed'); assert.equal(await balance(), before - q.total, 'charged exactly the confirmed quote');
  const row = (await pool.query('SELECT * FROM ryo_purchases WHERE scope=$1 AND request_id=$2', [scope, id])).rows[0], tx = wires.get(row.signature);
  const reg = require('../app/server/treasury-registry.cjs').registry().addresses, custodyAta = splBase.getAssociatedTokenAddressSync(mint, treasury.publicKey, false, PROGRAM);
  const tokenIx = tx.instructions.filter(i => i.programId.equals(PROGRAM));
  const transfers = tokenIx.filter(i => i.data[0] === splBase.TokenInstruction.TransferChecked).map(i => splBase.decodeTransferCheckedInstruction(i, PROGRAM));
  const burns = tokenIx.filter(i => i.data[0] === splBase.TokenInstruction.BurnChecked).map(i => splBase.decodeBurnCheckedInstruction(i, PROGRAM));
  assert.equal(transfers.length, 4, 'exactly four allocation transfers'); assert.equal(burns.length, 0, 'no burn instruction');
  assert.equal(tokenIx.length, 4, 'no other token instruction (no approvals, closes or extra transfers)');
  const want = { lockedTreasury: al.lockedTreasury, activeRewards: al.activeRewards, communityRewards: al.communityRewards, economicReserve: al.economicReserve };
  for (const [role, amount] of Object.entries(want)) {
    const dest = splBase.getAssociatedTokenAddressSync(mint, new web3.PublicKey(reg[role]), true, PROGRAM);
    const t = transfers.find(x => x.keys.destination.pubkey.equals(dest)); assert(t, role + ' transfer to the reviewed registry destination');
    assert.equal(t.data.amount, BigInt(amount), role + ' exact amount'); assert.equal(t.data.decimals, 6); assert(t.keys.source.pubkey.equals(custodyAta)); assert(t.keys.mint.pubkey.equals(mint)); assert(t.keys.owner.pubkey.equals(treasury.publicKey));
  }
  assert.equal(transfers.reduce((n, t) => n + t.data.amount, 0n), raw, 'on-chain transfers sum to the full payment');
  assert.equal(transfers.find(t => t.keys.destination.pubkey.equals(splBase.getAssociatedTokenAddressSync(mint, new web3.PublicKey(reg.activeRewards), true, PROGRAM))).data.amount, raw / 2n, '50% to the Active Reward Pool');
  const memo = tx.instructions.find(i => i.programId.toBase58() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  assert(memo && memo.data.toString().startsWith(X.MARKER + ':'), 'Expedition memo marker');
  assert(!tx.instructions.some(i => i.programId.equals(web3.SystemProgram.programId)), 'no SOL or system transfer');
  // Settlement: evidence booked once, the exact Expedition released, chakra untouched.
  const ev = (await pool.query('SELECT * FROM ryo_expedition_revenue WHERE scope=$1', [scope])).rows;
  assert.equal(ev.length, 1); assert.equal(ev[0].request_id, id); assert.equal(ev[0].signature, row.signature); assert.equal(ev[0].released, true);
  assert.equal(ev[0].burn_raw, undefined, 'no burn column'); assert.deepEqual(ev[0].allocations, al); assert.equal(ev[0].network, LIVE ? 'mainnet' : 'devnet');
  for (const k of X.TRANSFERS) assert.equal(ev[0].destinations[k], reg[k]);
  const after = await store.profile(wallet), lh = after.heroes.find(h => h.tokenId === 'legend-1');
  assert.equal(D.away(lh.chakra, now), false, 'back from the Expedition'); assert.equal(lh.chakra.duty.ms, 0, 'Combat Duty reset');
  assert.equal(lh.chakra.duty.last.accelerated, id); assert.equal(lh.chakra.duty.last.completed, now); assert(lh.chakra.value < 10, 'chakra is not refilled by acceleration');
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM ryo_service_revenue WHERE scope=$1', [scope])).rows[0].n, 0, 'no 50/30/10/10 service revenue booked');
  assert.equal((await sr.income(store, pool)).n, 0, 'the 50% Active Reward Pool share is not Adventure reward income until an approved top-up');
  // Replays: the same request is the same order; no second charge, transaction or release.
  const again = await call('purchase', { product: 'expedition', params: q.params, expectedTotal: q.total, requestId: id });
  assert.equal(again.purchase.status, 'confirmed'); assert.equal(await balance(), before - q.total); assert.equal((await pool.query('SELECT COUNT(*) AS n FROM ryo_expedition_revenue WHERE scope=$1', [scope])).rows[0].n, 1);
  await assert.rejects(call('purchase', { product: 'expedition', params: { ...q.params }, expectedTotal: q.total, requestId: crypto.randomUUID() }), /not on an Expedition/, 'an Expedition can be paid for only once');

  // 6. One pending payment at a time; a failed transaction refunds and the hero stays on its Expedition.
  autoFinalize = false; now += 60000;
  const q2 = await call('quote', { product: 'expedition', params: params('mythic-1') }), pid = crypto.randomUUID();
  const pending = await call('purchase', { product: 'expedition', params: q2.params, expectedTotal: q2.total, requestId: pid });
  assert.equal(pending.purchase.status, 'pending');
  assert(D.away((await store.profile(wallet)).heroes.find(h => h.tokenId === 'mythic-1').chakra, now), 'still away until the payment is finalized');
  await assert.rejects(call('purchase', { product: 'summon', params: { quantity: 1 }, expectedTotal: 25000, requestId: crypto.randomUUID() }), /pending token purchase/, 'concurrent payment requests are refused');
  const prow = (await pool.query('SELECT * FROM ryo_purchases WHERE scope=$1 AND request_id=$2', [scope, pid])).rows[0];
  statuses.set(prow.signature, { confirmationStatus: 'finalized', err: { InstructionError: [0, 'Custom'] } }); autoFinalize = true;
  await call('state');
  assert.equal((await pool.query('SELECT status FROM ryo_purchases WHERE scope=$1 AND request_id=$2', [scope, pid])).rows[0].status, 'refunded');
  assert.equal(await balance(), before - q.total, 'a failed payment is refunded in full');
  assert(D.away((await store.profile(wallet)).heroes.find(h => h.tokenId === 'mythic-1').chakra, now), 'a refunded payment releases nothing');
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM ryo_expedition_revenue WHERE scope=$1', [scope])).rows[0].n, 1, 'no evidence for a failed payment');

  // 7. The minimum remaining time: an Expedition about to finish completes for free.
  now = 1900000000000 + 3 * H - 60000;
  await assert.rejects(call('quote', { product: 'expedition', params: params('mythic-1') }), /almost complete/);
  now = 1900000000000 + 3 * H + 1;
  view = (await call('expedition')).expedition; assert.equal(vh('mythic-1').status, 'returned', 'it completed on its own for free'); assert.equal(vh('mythic-1').recent, true);

  // 8. Existing services are unchanged: a summon still uses its own policy (no burn, no Expedition split).
  if (LIVE) assert.deepEqual(sr.RATES, { lockedTreasury: 5000, activeRewards: 3000, communityRewards: 1000, economicReserve: 1000 });
  const sq = await call('quote', { product: 'summon', params: { quantity: 1 } });
  assert.equal(sq.expeditionDistribution, undefined); assert.equal(sq.noBonus, undefined);
  const sid = crypto.randomUUID(), sdone = await call('purchase', { product: 'summon', params: { quantity: 1 }, expectedTotal: sq.total, requestId: sid });
  const stx = wires.get(sdone.purchase.signature || (await pool.query('SELECT signature FROM ryo_purchases WHERE scope=$1 AND request_id=$2', [scope, sid])).rows[0].signature);
  const sburns = stx.instructions.filter(i => i.programId.equals(PROGRAM) && i.data[0] === splBase.TokenInstruction.BurnChecked).length;
  assert.equal(sburns, LIVE ? 0 : 1, LIVE ? 'live summon: no burn (50/30/10/10 unchanged)' : 'devnet summon: its legacy 8% burn unchanged');
  assert(!stx.instructions.some(i => i.programId.toBase58() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' && i.data.toString().startsWith(X.MARKER)), 'no Expedition memo on other services');

  // 9. Turning acceleration off closes new payments immediately.
  set('EXPEDITION_ROUTING_ENABLED');
  await assert.rejects(call('quote', { product: 'expedition', params: params('legend-1') }), /not available yet/);
  console.log('PASS: expedition-server ' + MODE);
})().catch(e => { console.error(e); process.exit(1); });
