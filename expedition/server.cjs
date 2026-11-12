'use strict';
/* Expedition Mode (owner spec 2026-11-11; apply-expedition.cjs copies this file to app/server/expedition.cjs).
 *
 * Combat Duty and Expeditions are accounted in combat-duty.cjs / combat-chakra.cjs; this module only
 *   1. hands the Expedition window to the Adventure settlement (whether duty accrues, and the verified Founder benefit),
 *   2. serves the read-only Expedition Hall view (remaining times are computed on demand, no timers, no writes),
 *   3. quotes and settles the OPTIONAL paid acceleration. Standard Expeditions are always free.
 *
 * Paid acceleration (spec sections 7 to 10) has its own Expedition-only payment policy. It never changes the existing
 * 50/30/10/10 SR service router (sr-revenue.cjs), the Boss Hunt split or any other service:
 *   50% Active Reward Pool, 30% Treasury, 10% Community Rewards, 10% Economic Reserve. No burn (owner decision
 *   2026-11-11, replacing the first 40/30/10/10/10 policy with a 10% SPL burn).
 * The four transferChecked instructions from the game custody token account are one atomic custody-signed transaction, so
 * either every allocation happens or none does. Amounts are exact integer base units; the Economic Reserve takes the
 * remainder (as in the SR router), so the parts always sum to the payment. Payment is taken only from the player's deposited game balance (never Starter Ryo, never the Chest) after a
 * server-computed quote the player confirmed; the hero is released only at finalized, successful settlement.
 * The 50% Active Reward Pool share leaves custody like the live v2 router: it is NOT counted as Adventure reward income
 * (operations 0, adventureEligible false) and funds Chest claims only through the existing approved top-up process.
 *
 * Locks (all required; every one is closed by default):
 *   - Control-panel switch `expeditions` (Combat Duty and Expeditions at all),
 *   - Control-panel switch `expeditionAcceleration` (money group, default OFF everywhere),
 *   - environment lock EXPEDITION_ROUTING_ENABLED=on (deployment-level),
 *   - approved per-rarity prices (EXPEDITION_ACCELERATION_PRICES; the provisional test values apply on the test server only),
 *   - on the live build: the approved SR routing configuration, re-verified Squads vault and destinations at every checkout.
 */
const crypto = require('node:crypto');
const D = require('./combat-duty.cjs');
const { fail } = require('./store.cjs');

const MARKER = 'shinobi-expedition-acceleration-v2', VERSION = 2, UNIT = 1000000n;
const RATES = Object.freeze({ activeRewards: 5000, lockedTreasury: 3000, communityRewards: 1000, economicReserve: 1000 });
const TRANSFERS = Object.freeze(['activeRewards', 'lockedTreasury', 'communityRewards', 'economicReserve']);   // the last takes the remainder
// Provisional test-server prices (whole Ryo for a FULL regular-length Expedition of that rarity); subject to economy review.
// They are never used on the live build: there, prices must be set explicitly in EXPEDITION_ACCELERATION_PRICES.
const PROVISIONAL_PRICES = Object.freeze([5000, 10000, 20000, 40000, 75000, 150000]);
// An Expedition this close to its end cannot be accelerated (it completes for free). Well above blockhash validity (~60-90 s),
// finalization and the client's settlement polling, so a confirmed payment practically always settles while the hero is away.
// If it does not (the player left before settlement, or the hero left the wallet), the evidence row records released=false.
const MIN_REMAINING_MS = 15 * 60000;
const QUOTE_STEP_MS = 60000;          // quotes use the remaining time rounded UP to the minute: one stable price per minute
const RECENT_MS = 24 * D.HOUR;        // the Completed tab shows Expeditions completed in the last 24 hours

const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_expedition_revenue(scope TEXT NOT NULL,wallet TEXT NOT NULL,request_id TEXT NOT NULL,signature TEXT NOT NULL,hero_id TEXT NOT NULL,expedition_start BIGINT NOT NULL,total_raw NUMERIC(40,0) NOT NULL CHECK(total_raw>0),allocations JSONB NOT NULL,destinations JSONB NOT NULL,released BOOLEAN NOT NULL,network TEXT NOT NULL,created BIGINT NOT NULL,PRIMARY KEY(scope,wallet,request_id),UNIQUE(scope,signature));
CREATE INDEX IF NOT EXISTS ryo_expedition_revenue_created ON ryo_expedition_revenue(scope,created);
-- v2: no burn. The v1 table (created empty on 2026-11-11; acceleration was never opened) loses its burn column.
ALTER TABLE ryo_expedition_revenue DROP COLUMN IF EXISTS burn_raw;`;

const truthy = v => /^(1|true|on|yes)$/i.test(String(v ?? '').trim());
const sw = key => { try { return require('./feature-switches.cjs').effective(key); } catch { return false; } };
const live = () => { try { return require('./network.cjs').built(__dirname).key === 'mainnet'; } catch { return false; } };
const enabled = () => sw('expeditions');
// Server clock for quotes made inside economy.quote (Store.purchase has no clock argument there). Tests inject the store clock.
let clock = () => Date.now();
function useClock(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); }
/** Verified Founder benefit, exactly as every other Founder benefit: the server-written tier (kept in step with a valid,
 * unrevoked entitlement by founders.applyTier in store.profileLocked) AND the Founder redemption switch. */
function founder(profile) {
  try { const F = require('./founders.cjs'); return !!F.TIERS[profile?.founderTier] && F.switches().redemption === true; } catch { return false; }
}
/** The Combat Duty option for combat-chakra.cjs spend(): null while Expedition Mode is off (nothing accrues). */
const dutyOption = profile => (enabled() ? { founder: founder(profile) } : null);
/** Hands the window to combat-adventure.cjs advance() on the Chest data (read and removed there; never stored). */
function window(data, profile) {
  const opt = dutyOption(profile);
  if (data && typeof data === 'object') { delete data.expeditionWindow; if (opt) data.expeditionWindow = opt; }
  return opt;
}

/* ---------------- Paid acceleration: policy and quote ---------------- */
function prices(env = process.env) {
  const raw = env.EXPEDITION_ACCELERATION_PRICES;
  if (raw === undefined || String(raw).trim() === '') return live() ? null : PROVISIONAL_PRICES;
  const list = String(raw).split(',').map(s => Number(s.trim()));
  return list.length === 6 && list.every(n => Number.isSafeInteger(n) && n >= 1 && n <= 100000000) ? Object.freeze(list) : null;
}
function accelerationProblems(env = process.env) {
  const problems = [];
  if (!enabled()) problems.push('Expedition Mode is off.');
  if (!sw('expeditionAcceleration')) problems.push('The expeditionAcceleration switch is off.');
  if (!truthy(env.EXPEDITION_ROUTING_ENABLED)) problems.push('EXPEDITION_ROUTING_ENABLED is off.');
  if (!prices(env)) problems.push(live() ? 'Approved acceleration prices are not configured (EXPEDITION_ACCELERATION_PRICES).' : 'EXPEDITION_ACCELERATION_PRICES is invalid.');
  return problems;
}
/** Exact base-unit split: floor the first three shares, the remainder goes to the Economic Reserve (as in the SR router). */
function splitRaw(total) {
  if (typeof total !== 'bigint' || total < 1n) fail('Invalid Expedition payment amount.');
  const allocations = {}; let used = 0n;
  for (const name of TRANSFERS.slice(0, -1)) { const n = total * BigInt(RATES[name]) / 10000n; allocations[name] = String(n); used += n; }
  allocations.economicReserve = String(total - used);
  return allocations;
}
function conserved(allocations, totalRaw) {
  const names = TRANSFERS;
  if (!allocations || Object.keys(allocations).length !== names.length || names.some(k => !/^[0-9]+$/.test(String(allocations[k])))) return false;
  return names.reduce((n, k) => n + BigInt(allocations[k]), 0n) === BigInt(totalRaw);
}
/** Remaining-time price: the rarity price for a full REGULAR Expedition, pro rata to the remaining time (rounded up to the
 * minute, then up to a whole Ryo). A Founder's shorter Expedition therefore costs less naturally; no other Founder,
 * Mythic or creator discount is applied on top (spec section 11). */
function price(e, now, list) {
  const regular = D.durationMs({ rank: e.rank }, false), left = Math.ceil(Math.max(0, e.ends - now) / QUOTE_STEP_MS) * QUOTE_STEP_MS;
  return Math.max(1, Math.ceil(list[Math.max(0, Math.min(5, e.rank | 0))] * Math.min(left, regular) / regular));
}
function quoteFor(h, now, list) {
  const e = D.get(h?.chakra)?.exp;
  if (!e || !(now < e.ends)) return null;
  if (e.ends - now < MIN_REMAINING_MS) return { tooLate: true };
  return { total: price(e, now, list), start: e.start, remainingMs: e.ends - now };
}
/** economy.quote hook for product 'expedition' (also used by Store.purchase, so preview and charge always agree). */
function quote(profile, params = {}, now = clock()) {
  const problems = accelerationProblems();
  if (problems.length) throw Object.assign(Error('Expedition acceleration is not available yet. Standard Expeditions are free and complete on their own.'), { status: 403, code: 'EXPEDITION_ACCELERATION_CLOSED' });
  if (!params || typeof params.heroId !== 'string' || !Number.isSafeInteger(params.expeditionStart)) fail('Choose a hero on an Expedition.');
  const h = (profile.heroes || []).find(x => x.tokenId === params.heroId);
  if (!h) fail('Choose one of your heroes on an Expedition.');
  const q = quoteFor(h, now, prices());
  if (!q) fail('This hero is not on an Expedition.', 409);
  if (q.tooLate) fail('This Expedition is almost complete and will finish for free in a moment.', 409);
  if (q.start !== params.expeditionStart) fail('This Expedition changed. Review a new quote.', 409);
  const totalRaw = BigInt(q.total) * UNIT, allocations = splitRaw(totalRaw), ryo = k => Number(BigInt(allocations[k]) / UNIT) + Number(BigInt(allocations[k]) % UNIT) / Number(UNIT);
  return {
    economyVersion: 2, product: 'expedition', params: { heroId: h.tokenId, expeditionStart: q.start }, title: 'Expedite ' + h.name + ' (' + D.RANKS[D.rank(h)] + ')',
    base: q.total, total: q.total, studioFee: 0, treasury: ryo('lockedTreasury'), burn: 0, operations: 0, adventureEligible: false, noBonus: true,
    remainingMs: q.remainingMs,
    expeditionDistribution: { marker: MARKER, version: VERSION, basis: 'full-acceleration-payment', totalRaw: String(totalRaw), allocations, ratesBps: RATES }
  };
}

/* ---------------- Paid acceleration: the atomic custody transaction ---------------- */
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** Called by the service purchase handler inside Store.purchase (wallet-locked). Builds the 4 transfers + memo (no burn).
 * `transferTo(owner, raw)` is the service's custody instruction builder (transferChecked to the owner's
 * associated token account from the custody token account with the official mint, 6 decimals, the
 * registered token program and the custody key as authority). Any failure here means nothing was signed or sent. */
async function instructions(ctx, q, requestId, transferTo, memo) {
  try {
    const problems = accelerationProblems();
    if (problems.length) fail('Expedition acceleration is not activated: ' + problems.join(' ') + ' No payment was submitted.', 503);
    const d = q.expeditionDistribution;
    if (q.product !== 'expedition' || !d || d.version !== VERSION || d.marker !== MARKER || q.studioFee !== 0 || q.operations !== 0) fail('Refresh the Expedition acceleration quote.', 409);
    const totalRaw = BigInt(q.total) * UNIT, expected = splitRaw(totalRaw);
    if (d.totalRaw !== String(totalRaw) || Object.keys(expected).some(k => d.allocations?.[k] !== expected[k]) || !conserved(expected, totalRaw)) fail('Expedition payment amounts do not match the fixed 50/30/10/10 Expedition policy.', 409);
    const reg = require('./treasury-registry.cjs').registry(), sr = require('./sr-revenue.cjs');
    let destinations, lockProof;
    if (live()) {
      // Live: the same reviewed registry destinations, approved routing configuration and Squads/vault verification as the
      // SR service router, re-verified at every checkout.
      const cfg = await sr.config(ctx.store, ctx.client || ctx.store.pool, !!ctx.client);
      if (!cfg?.enabled) fail('Expedition acceleration needs the approved SR vault configuration. No payment was submitted.', 503);
      const locks = sr.activationProblems(ctx); if (locks.length) fail('SR vaults are not activated: ' + locks.join(' ') + ' No payment was submitted.', 503);
      lockProof = await sr.verifyVaults(ctx, cfg); destinations = Object.fromEntries(TRANSFERS.map(k => [k, cfg.destinations[k]]));
    } else {
      // Test server (devnet): the registry addresses as destinations on devnet; no Squads proof exists there.
      await ctx.checkNetwork?.(); destinations = Object.fromEntries(TRANSFERS.map(k => [k, reg.addresses?.[k]]));
      lockProof = { kind: 'devnet-registry-addresses', verified: true, commitment: 'finalized' };
    }
    const own = [ctx.treasuryAddress, ctx.studioAddress, ctx.revenueAddress].filter(Boolean);
    for (const k of TRANSFERS) {
      if (typeof destinations[k] !== 'string' || destinations[k] !== reg.addresses?.[k]) fail('Expedition destinations must equal the reviewed public registry.', 503);
      if (own.includes(destinations[k])) fail('Expedition destinations must be separate from the game custody, studio and revenue wallets.', 503);
    }
    if (new Set(TRANSFERS.map(k => destinations[k])).size !== TRANSFERS.length) fail('Expedition destinations must be four different wallets.', 503);
    q.expeditionDistribution = { ...d, destinations, lockProof, network: live() ? 'mainnet' : 'devnet', configHash: hash(destinations) };
    return [
      ...TRANSFERS.flatMap(k => transferTo(destinations[k], BigInt(expected[k]))),
      memo(MARKER + ':' + hash({ scope: ctx.store.scope, wallet: ctx.wallet, requestId }) + ':' + hash({ hero: q.params.heroId, start: q.params.expeditionStart }).slice(0, 16))
    ];
  } catch (error) { error.paymentNotSubmitted = true; throw error; }
}

/* ---------------- Settlement (store.settlePurchase, wallet-locked, exactly once per purchase) ---------------- */
/** Confirmed (finalized, no error): book the allocation evidence and release the exact Expedition that was paid for.
 * `profile` is the profile about to be saved (current chakra already restored). Refunded: nothing happens. */
async function settled(store, c, row, profile) {
  if (row?.product !== 'expedition') return;
  const d = row.quote?.expeditionDistribution, totalRaw = BigInt(row.amount) * UNIT;
  if (row.quote?.funding === 'bonus' || row.quote?.funding === 'chest' || String(row.signature).startsWith('bonus:')) fail('Expedition acceleration must be paid from the deposited game balance.', 503);
  if (!d || d.version !== VERSION || !row.wire || !d.destinations || !d.lockProof?.verified) fail('Missing persisted Expedition payment evidence.', 503);
  const expected = splitRaw(totalRaw);
  if (d.totalRaw !== String(totalRaw) || Object.keys(expected).some(k => d.allocations?.[k] !== expected[k]) || !conserved(d.allocations, totalRaw)) fail('Persisted Expedition allocation is inconsistent.', 503);
  const h = (profile?.heroes || []).find(x => x.tokenId === row.params?.heroId);
  const released = !!h && D.accelerate(require('./combat-chakra.cjs').state(h, store.now()), row.params.expeditionStart, store.now(), row.request_id);
  await c.query(`INSERT INTO ryo_expedition_revenue(scope,wallet,request_id,signature,hero_id,expedition_start,total_raw,allocations,destinations,released,network,created)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(scope,wallet,request_id) DO NOTHING`,
    [store.scope, row.wallet, row.request_id, row.signature, row.params.heroId, row.params.expeditionStart, String(totalRaw), JSON.stringify(d.allocations), JSON.stringify(d.destinations), released, d.network || 'unknown', store.now()]);
}

/* ---------------- Read-only views ---------------- */
function heroView(h, profile, now, list, ready, deployed) {
  const v = D.view(h, now), max = require('./combat-rules.cjs').maxChakra(h), chakra = h.chakra ? Math.floor(Number(h.chakra.value) || 0) : Math.floor(max);   // no saved chakra yet = full (combat-chakra state())
  const out = { tokenId: h.tokenId, name: h.name, rank: D.rank(h), rankName: D.RANKS[D.rank(h)], look: h.look, mythic: h.mythic || null,
    battleReady: ready.has(h.tokenId), deployed: deployed.has(h.tokenId), chakra, maxChakra: max,
    regularMs: D.durationMs(h, false), founderMs: D.durationMs(h, true), ...v };
  if (v.status === 'expedition' && list) { const q = quoteFor(h, now, list); if (q && !q.tooLate) out.quote = { total: q.total, expeditionStart: q.start }; }
  out.recent = !!v.last && now - Number(v.last.completed) < RECENT_MS;
  return out;
}
/** The Expedition Hall for one player (POST action 'expedition'). Read-only: no settlement, no writes. */
async function view(store, wallet) {
  // Off: no database access at all (the client polls rarely). On: a plain read (no account lock, no writes); the profile is
  // normalized in memory only, exactly as the locked read would return it.
  if (!enabled()) return { expedition: { version: VERSION, enabled: false, serverTime: store.now(), acceleration: { available: false }, heroes: [] } };
  const row = (await store.pool.query('SELECT data FROM ryo_profiles WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0];
  const profile = row ? require('./economy.cjs').normalizeProfile(row.data) : { heroes: [], battleReady: [] };
  const data = (await store.pool.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0]?.data;
  return build(profile, data, store.now());
}
/** The view for a profile and its Chest data at server time `now` (pure). */
function build(profile, data, now) {
  const acceleration = accelerationProblems(), list = acceleration.length ? null : prices();
  const ready = new Set(profile.battleReady || []), deployed = new Set(Array.isArray(data?.team) ? data.team : []);
  const heroes = (profile.heroes || []).map(h => heroView(h, profile, now, list, ready, deployed));
  return { expedition: { version: VERSION, enabled: enabled(), serverTime: now, capMs: D.DUTY_CAP_MS, founder: founder(profile), founderBps: D.FOUNDER_BPS,
    durations: D.HOURS.map((hours, rank) => ({ rank, name: D.RANKS[rank], regularMs: hours * D.HOUR, founderMs: hours * D.HOUR * D.FOUNDER_BPS / 10000 })),
    acceleration: { available: !acceleration.length, minRemainingMs: MIN_REMAINING_MS, policy: { marker: MARKER, ratesBps: RATES, burn: 'none', funding: 'deposited-balance' } },
    heroes } };
}
async function handle(store, wallet, action) {
  if (action === 'expedition') return view(store, wallet);
  fail('Unknown Expedition action.', 404);
}
module.exports = { MARKER, VERSION, RATES, TRANSFERS, PROVISIONAL_PRICES, MIN_REMAINING_MS, QUOTE_STEP_MS, SCHEMA,
  enabled, useClock, founder, dutyOption, window, prices, accelerationProblems, splitRaw, conserved, price, quoteFor, quote, instructions, settled, view, build, handle };
