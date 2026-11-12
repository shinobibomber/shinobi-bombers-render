/* Player Market for heroes (copied to app/server/market.cjs by apply-market.cjs).
 *
 * Listing escrows the hero: it leaves the seller's profile (and battle-ready roster) and is kept in
 * the listing until it sells, is cancelled, or expires (7 days), when it returns to the seller intact.
 * Buying reuses the purchase flow: the buyer pays the price, the seller is credited 80% and 20% goes back to the
 * Adventure Chest reward pool (owner decision 2026-11-12). No Ryo leaves custody, so the sale settles in the game ledger
 * at once (quote.settlement 'internal'); older on-chain sales keep their recorded quotes.
 * A refunded purchase restores the buyer's Ryo and puts the listing back on sale.
 *
 * Offers: a buyer offers less than the asking price (at least the rank minimum). The offered Ryo is
 * held out of their balance until the seller accepts or declines, the buyer cancels, the offer
 * expires (48 hours, never past the listing), or the listing closes; every other outcome returns it.
 * Accepting runs the same purchase flow at the offered price, paid from the held Ryo.
 */
'use strict';
const crypto = require('node:crypto');
// Loaded lazily: the build step reads SCHEMA from the source folder, where store.cjs does not exist.
const fail = (...args) => require('./store.cjs').fail(...args);

/* Owner decision 2026-11-12: only Jonin (2), Elite (3) and Legend (4) trade. Default minimums 150,000 / 400,000 /
 * 1,000,000 Ryo; admins change them through an approved /admin/ 'marketPrices' proposal (ryo_admin_control.config).
 * A listing and an offer record the minimum they were made under (min_price), so a later change only applies to new
 * ones. Rows from before this rule (min_price NULL) that break it are retired: hero back to the seller, offers refunded. */
const RANKS = ['Genin', 'Chunin', 'Jonin', 'Elite', 'Legend', 'Mythic'];
const TRADABLE = [2, 3, 4], PRICE_KEYS = { 2: 'jonin', 3: 'elite', 4: 'legend' };
const MIN_PRICE = [null, null, 150000, 400000, 1000000], MAX_PRICE = 100000000;   // defaults, indexed by rank
const DURATION_MS = 7 * 24 * 3600 * 1000, MAX_ACTIVE = 20, PAGE = 10, MAX_HEROES = 500;
const OFFER_MS = 48 * 3600 * 1000, MAX_OFFERS = 10;
// Owner decision 2026-11-12: the seller receives 80% and 20% goes back to the Adventure Chest reward pool. No studio or
// treasury share and no separate Market reserve: the 20% stays in custody and counts as reward pool income on both servers.
const SHARES = { studio: 0, treasury: 0, pool: 20 }; // percent; the seller receives the rest (80%)
const SWEEP_MS = 60 * 1000, SWEEP_BATCH = 50, NOTICE_PAGE = 50;
// Account-bound heroes never trade (owner decision 2026-11-12). Values are true, a tier, a kind or a campaign id.
const BOUND_FLAGS = ['referralReward', 'marketBound', 'starterGrant', 'starter', 'creatorReward', 'prisonRescue', 'staffGrant', 'promoPass', 'promoReward', 'founderGrant', 'founderSummon', 'founderBound', 'founder'];
const BOUND_TEXT = 'This hero is bound to your account and cannot be listed, sold or transferred.';
/** The one Market eligibility rule (post, offer, buy, accept and the sweeper). null = tradable. */
function blockReason(hero) {
  if (!hero || typeof hero !== 'object') return { text: 'This hero cannot be traded.' };
  if (hero.nft || hero.mythic || hero.rank === 5) return { text: 'Mythic NFT heroes are traded by moving their NFT, not on the Market.' };
  // Binding first (whatever the rank), so a bound hero is always refused as bound and referral refusals stay audited.
  if (hero.referralReward) return { text: 'Referral-bound heroes cannot be listed, sold or transferred.', code: 'REFERRAL_BOUND' };
  const flag = BOUND_FLAGS.find(f => hero[f] !== undefined && hero[f] !== null && hero[f] !== false);
  if (flag) return { text: BOUND_TEXT, code: 'ACCOUNT_BOUND', flag };
  return TRADABLE.includes(hero.rank) ? null : { text: 'Only Jonin, Elite and Legend heroes can be traded on the Market.' };
}
function refuse(reason, hero) {
  throw Object.assign(Error(reason.text), { status: 409, code: reason.code || 'NOT_TRADABLE', ...(reason.code === 'REFERRAL_BOUND' ? { referralBound: hero?.tokenId } : {}) });
}
/** Admin 'marketPrices' payload: {jonin, elite, legend}, each a whole number 1..MAX_PRICE or null (= the default). */
function validatePrices(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Market prices must be an object with jonin, elite and legend.');
  const keys = Object.keys(payload).filter(k => k !== 'evidence');
  if (keys.some(k => !Object.values(PRICE_KEYS).includes(k))) fail('Market prices accept only jonin, elite and legend.');
  const out = {};
  for (const k of Object.values(PRICE_KEYS)) {
    const v = payload[k];
    if (v === undefined || v === null) { out[k] = null; continue; }
    if (!Number.isSafeInteger(v) || v < 1 || v > MAX_PRICE) fail(`The ${k} minimum must be a whole number from 1 to ${MAX_PRICE.toLocaleString('en-US')} Ryo, or empty for the default.`);
    out[k] = v;
  }
  return out;
}
/** Effective minimums, indexed by rank (null = cannot trade). Read on every call: the server is authoritative. */
async function minPrices(store, c = store.pool) {
  let saved = null;
  try { saved = (await c.query("SELECT config->'marketPrices' AS p FROM ryo_admin_control WHERE scope=$1", [store.scope])).rows[0]?.p || null; } catch { saved = null; }
  let valid = null; try { valid = saved ? validatePrices(saved) : null; } catch { valid = null; }   // an invalid saved value falls back to the defaults
  return MIN_PRICE.map((d, rank) => d === null ? null : (valid?.[PRICE_KEYS[rank]] ?? d));
}
const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_market_listings (
 scope TEXT NOT NULL, id TEXT NOT NULL, seller TEXT NOT NULL, hero JSONB NOT NULL, name TEXT NOT NULL, rank INTEGER NOT NULL,
 perks JSONB NOT NULL, price BIGINT NOT NULL CHECK(price>0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending','sold','cancelled','expired')),
 buyer TEXT, request_id TEXT, created BIGINT NOT NULL, expires BIGINT NOT NULL, settled_at BIGINT,
 PRIMARY KEY(scope,id)
);
CREATE INDEX IF NOT EXISTS ryo_market_browse ON ryo_market_listings(scope,status,rank,price);
CREATE INDEX IF NOT EXISTS ryo_market_seller ON ryo_market_listings(scope,seller,status);
CREATE INDEX IF NOT EXISTS ryo_market_buyer ON ryo_market_listings(scope,buyer,status);`;
const OFFER_SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_market_offers (
 scope TEXT NOT NULL, id TEXT NOT NULL, listing_id TEXT NOT NULL, buyer TEXT NOT NULL, seller TEXT NOT NULL,
 amount BIGINT NOT NULL CHECK(amount>0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','accepted','declined','cancelled','closed','expired','failed','completed')),
 created BIGINT NOT NULL, expires BIGINT NOT NULL, settled_at BIGINT, PRIMARY KEY(scope,id)
);
CREATE INDEX IF NOT EXISTS ryo_market_offers_listing ON ryo_market_offers(scope,listing_id,status);
CREATE INDEX IF NOT EXISTS ryo_market_offers_buyer ON ryo_market_offers(scope,buyer,status);`;
// v2 (2026-11-12), additive and nullable: the minimum each listing/offer was made under, why a listing closed, and
// indexes for the background sweeper. Older code ignores these columns (rollback = revert).
const V2_SCHEMA = `ALTER TABLE ryo_market_listings ADD COLUMN IF NOT EXISTS min_price BIGINT;
ALTER TABLE ryo_market_listings ADD COLUMN IF NOT EXISTS close_reason TEXT;
ALTER TABLE ryo_market_offers ADD COLUMN IF NOT EXISTS min_price BIGINT;
CREATE INDEX IF NOT EXISTS ryo_market_due ON ryo_market_listings(scope,status,expires);
CREATE INDEX IF NOT EXISTS ryo_market_offers_due ON ryo_market_offers(scope,status,expires);
CREATE INDEX IF NOT EXISTS ryo_market_offers_seller ON ryo_market_offers(scope,seller,status,created);
CREATE TABLE IF NOT EXISTS ryo_market_migrations(scope TEXT NOT NULL, id TEXT NOT NULL, done BIGINT NOT NULL, detail JSONB NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY(scope,id));`;

function split(price) {
  const studioFee = Math.floor(price * SHARES.studio / 100), treasury = Math.floor(price * SHARES.treasury / 100), operations = Math.floor(price * SHARES.pool / 100);
  // No Ryo leaves custody, so a Market sale needs no Solana transaction: it settles inside the game ledger at once.
  return { studioFee, treasury, operations, seller: price - studioFee - treasury - operations, settlement: 'internal' };
}
const short = wallet => wallet.slice(0, 4) + '…' + wallet.slice(-4);
function publicHero(hero) {
  const s = require('./gameplay-options.cjs').trainedStats(hero);
  return { name: hero.name, rank: hero.rank, level: hero.level, perks: hero.perks, look: hero.look, bonus: hero.bonus, baseStats: hero.baseStats, stats: s };
}
// mins = the current minimums (minPrices); minOffer = the lowest offer the server accepts now (null = no offers).
function publicListing(row, now, mins = null) {
  const price = Number(row.price), rank = row.hero?.rank, current = mins ? mins[rank] : null;
  const minOffer = current === null || current === undefined ? null : Math.max(current, row.min_price == null ? 0 : Number(row.min_price));
  return { id: row.id, price, status: row.status, created: Number(row.created), expires: Number(row.expires), left: Math.max(0, Number(row.expires) - now),
    seller: short(row.seller), hero: publicHero(row.hero), payout: split(price).seller, rarity: RANKS[rank] || null,
    minPrice: row.min_price == null ? null : Number(row.min_price), minOffer: minOffer !== null && minOffer < price ? minOffer : null,
    ...(row.close_reason ? { closeReason: row.close_reason } : {}) };
}
const publicOffer = (o, now) => ({ id: o.id, listingId: o.listing_id, amount: Number(o.amount), status: o.status, created: Number(o.created), left: Math.max(0, Number(o.expires) - now), buyer: short(o.buyer), payout: split(Number(o.amount)).seller, minPrice: o.min_price == null ? null : Number(o.min_price), ...(o.settled_at != null ? { settledAt: Number(o.settled_at) } : {}) });
function uuid(value, what) { if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) fail('Choose a Market ' + what + '.'); return value; }
const listingId = value => uuid(value, 'listing');
// Starter Ryo (ryo_accounts.bonus, test server) pays for a buy or offer when it covers the whole price;
// held offers remember their pot, so every refund returns to the pot that paid.
async function credit(store, c, wallet, amount, funding) {
  const col = funding === 'bonus' ? 'bonus' : 'balance';
  await c.query(`INSERT INTO ryo_accounts(scope,wallet,${col}) VALUES($1,$2,$3) ON CONFLICT(scope,wallet) DO UPDATE SET ${col}=ryo_accounts.${col}+EXCLUDED.${col}`, [store.scope, wallet, amount]);
}
const bonusTx = (wallet, requestId) => ({ signature: 'bonus:' + wallet + ':' + requestId, wire: '', lastHeight: 0 });
// An internal settlement: nothing is sent on-chain (service progress confirms it at once, like Starter Ryo orders).
const ledgerTx = (wallet, requestId) => ({ signature: 'market:' + wallet + ':' + requestId, wire: '', lastHeight: 0 });
const marketTx = (q, wallet, requestId, prepare) => q.funding === 'bonus' ? bonusTx(wallet, requestId) : q.settlement === 'internal' ? ledgerTx(wallet, requestId) : prepare(q);
async function lockBoth(store, c, a, b) { const [x, y] = [a, b].sort(); const first = await store.locked(c, x), second = await store.locked(c, y); return x === a ? [first, second] : [second, first]; }

// Return every active offer on a listing (except one) to its buyer.
async function closeOffers(store, c, listing, status, except = null) {
  const rows = (await c.query("SELECT * FROM ryo_market_offers WHERE scope=$1 AND listing_id=$2 AND status='active' FOR UPDATE", [store.scope, listing])).rows.filter(o => o.id !== except);
  for (const o of rows) {
    await credit(store, c, o.buyer, Number(o.amount), o.funding);
    await c.query('UPDATE ryo_market_offers SET status=$3,settled_at=$4 WHERE scope=$1 AND id=$2', [store.scope, o.id, status, store.now()]);
  }
  return rows.length;
}
// Return the seller's expired listings to their profile, and refund the buyer's lapsed offers.
async function sweepLocked(store, c, wallet) {
  const now = store.now();
  const rows = (await c.query("SELECT * FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status='active' AND expires<=$3 FOR UPDATE", [store.scope, wallet, now])).rows;
  if (rows.length) {
    const profile = await store.profileLocked(c, wallet);
    for (const row of rows) if (!profile.heroes.some(h => h.tokenId === row.hero.tokenId)) profile.heroes.push(row.hero);
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
    await c.query("UPDATE ryo_market_listings SET status='expired',settled_at=$3,close_reason='expired' WHERE scope=$1 AND id=ANY($2::text[])", [store.scope, rows.map(r => r.id), now]);
    for (const row of rows) await closeOffers(store, c, row.id, 'closed');
  }
  const lapsed = (await c.query(`SELECT o.* FROM ryo_market_offers o JOIN ryo_market_listings l ON l.scope=o.scope AND l.id=o.listing_id
    WHERE o.scope=$1 AND o.buyer=$2 AND o.status='active' AND (o.expires<=$3 OR l.expires<=$3 OR l.status IN ('sold','cancelled','expired')) FOR UPDATE OF o`, [store.scope, wallet, now])).rows;
  for (const o of lapsed) {
    await credit(store, c, wallet, Number(o.amount), o.funding);
    await c.query("UPDATE ryo_market_offers SET status='expired',settled_at=$3 WHERE scope=$1 AND id=$2", [store.scope, o.id, now]);
  }
  return rows.length + lapsed.length;
}
/* Return a listing that breaks the Market rules to its seller (caller holds the seller lock and the listing row):
 * the hero goes back intact (never dropped, whatever the collection size), every offer is refunded to the pot that paid. */
async function retire(store, c, row, reason) {
  const profile = await store.profileLocked(c, row.seller);
  if (!profile.heroes.some(h => h.tokenId === row.hero.tokenId)) profile.heroes.push(row.hero);
  await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, row.seller, JSON.stringify(profile)]);
  await c.query("UPDATE ryo_market_listings SET status='cancelled',settled_at=$3,close_reason=$4 WHERE scope=$1 AND id=$2", [store.scope, row.id, store.now(), reason]);
  return closeOffers(store, c, row.id, 'closed');
}
/* Background sweep (every minute on the game server; restart-safe because everything is in the database). Several
 * servers may run it at once: each item is re-read under its wallet lock and row lock, and acts only if still due.
 * 1. wallets with an expired listing or a lapsed offer: the per-wallet sweep returns heroes and held Ryo;
 * 2. listings from before the v2 rules (min_price NULL): retired when they break them, otherwise stamped with today's minimum;
 * 3. offers from before the v2 rules: refunded when below today's minimum, otherwise stamped. */
async function sweepAll(store) {
  const now = store.now(), mins = await minPrices(store), done = { wallets: 0, retired: 0, stamped: 0, refunded: 0, skipped: 0 };
  // Each item is its own short transaction. The sweep never waits long for a lock (a player's request always wins and
  // the item is retried next minute), and one failing item never stops the others.
  const each = async (label, fn) => {
    try { await store.transaction(async c => { await c.query("SET LOCAL lock_timeout = '500ms'"); await fn(c); }); }
    catch (e) { done.skipped++; if (e?.code !== '55P03') console.error('[market] background sweep skipped ' + label + ':', e?.message || e); }
  };
  const wallets = (await store.pool.query(`SELECT seller AS wallet FROM ryo_market_listings WHERE scope=$1 AND status='active' AND expires<=$2
    UNION SELECT o.buyer FROM ryo_market_offers o JOIN ryo_market_listings l ON l.scope=o.scope AND l.id=o.listing_id
    WHERE o.scope=$1 AND o.status='active' AND (o.expires<=$2 OR l.expires<=$2 OR l.status IN ('sold','cancelled','expired')) LIMIT $3`, [store.scope, now, SWEEP_BATCH])).rows.map(r => r.wallet);
  try { done.bound = await bindFusedOnce(store); done.bound = done.bound || { leftovers: await bindLeftovers(store) }; } catch (e) { console.error('[market] binding of earlier fused heroes failed (retried next minute):', e?.message || e); }
  try { done.confirmed = await confirmInternal(store); } catch (e) { console.error('[market] background sweep could not confirm internal sales:', e?.message || e); }
  for (const wallet of wallets) await each('wallet', async c => { await store.locked(c, wallet); done.wallets += await sweepLocked(store, c, wallet); });
  const legacy = (await store.pool.query("SELECT id,seller FROM ryo_market_listings WHERE scope=$1 AND status='active' AND min_price IS NULL ORDER BY created LIMIT $2", [store.scope, SWEEP_BATCH])).rows;
  for (const { id, seller } of legacy) {
    await each('listing ' + id, async c => {
      await store.locked(c, seller);
      const row = (await c.query("SELECT * FROM ryo_market_listings WHERE scope=$1 AND id=$2 FOR UPDATE", [store.scope, id])).rows[0];
      if (!row || row.status !== 'active' || row.min_price != null) return;
      const min = mins[row.hero?.rank];
      if (blockReason(row.hero) || !(min > 0) || Number(row.price) < min) { await retire(store, c, row, 'rules'); done.retired++; }
      else { await c.query('UPDATE ryo_market_listings SET min_price=$3 WHERE scope=$1 AND id=$2', [store.scope, id, min]); done.stamped++; }
    });
  }
  const offers = (await store.pool.query("SELECT id,buyer FROM ryo_market_offers WHERE scope=$1 AND status='active' AND min_price IS NULL ORDER BY created LIMIT $2", [store.scope, SWEEP_BATCH])).rows;
  for (const { id, buyer } of offers) {
    await each('offer ' + id, async c => {
      await store.locked(c, buyer);
      const o = (await c.query("SELECT * FROM ryo_market_offers WHERE scope=$1 AND id=$2 FOR UPDATE", [store.scope, id])).rows[0];
      if (!o || o.status !== 'active' || o.min_price != null) return;
      const listing = (await c.query('SELECT hero,price,min_price FROM ryo_market_listings WHERE scope=$1 AND id=$2', [store.scope, o.listing_id])).rows[0];
      const min = Math.max(mins[listing?.hero?.rank] || 0, listing?.min_price == null ? 0 : Number(listing.min_price));
      if (!listing || blockReason(listing.hero) || !(min > 0) || Number(o.amount) < min) {
        await credit(store, c, o.buyer, Number(o.amount), o.funding);
        await c.query("UPDATE ryo_market_offers SET status='closed',settled_at=$3 WHERE scope=$1 AND id=$2", [store.scope, id, store.now()]); done.refunded++;
      } else { await c.query('UPDATE ryo_market_offers SET min_price=$3 WHERE scope=$1 AND id=$2', [store.scope, id, min]); done.stamped++; }
    });
  }
  return done;
}
/* One-time (owner decision 2026-11-12): heroes fused BEFORE fusion kept every binding are bound too.
 * 1. Every hero record the game stores (any JSONB column of a ryo_ table: profiles, purchase snapshots and results,
 *    listings, Founder summons, rescues, Starter Activation, Creator redemptions, ...) is searched for heroes that carry
 *    a binding flag: their token ids form the bound set.
 * 2. Confirmed fusions are replayed oldest first: a group of three holding a bound hero binds its output (and that output
 *    binds later fusions in turn). When some attempts of a batch failed the output-to-group order is unknown, so every
 *    output of a batch with a bound group is bound (never too few).
 * 3. Those heroes get marketBound=true in their owner's profile; one on sale goes back to its seller (offers refunded).
 * Heroes are never removed. A listing still being paid for is left alone and the step re-runs next minute. */
const BIND_ID = 'bind-fused-v1';
async function bindFusedOnce(store) {
  if (bindFusedOnce.done?.has(store)) return null;
  if ((await store.pool.query('SELECT 1 FROM ryo_market_migrations WHERE scope=$1 AND id=$2', [store.scope, BIND_ID])).rows.length) { (bindFusedOnce.done ||= new WeakSet()).add(store); return null; }
  const cols = (await store.pool.query("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema=current_schema() AND data_type='jsonb' AND table_name LIKE 'ryo\\_%'")).rows;
  const exists = BOUND_FLAGS.map(f => 'exists(@.' + f + ')').join(' || ');
  const bound = new Set(), isBound = h => BOUND_FLAGS.some(f => h[f] !== undefined && h[f] !== null && h[f] !== false);
  for (const { t, c } of cols) {
    if (!/^[a-z_]+$/.test(t) || !/^[a-z_]+$/.test(c)) continue;
    const scoped = (await store.pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name='scope'", [t])).rows.length;
    const rows = (await store.pool.query(`SELECT jsonb_path_query(${c}, '$.** ? (exists(@.tokenId) && (${exists}))') AS h FROM ${t}${scoped ? ' WHERE scope=$1' : ''}`, scoped ? [store.scope] : [])).rows;
    for (const { h } of rows) if (h && typeof h.tokenId === 'string' && isBound(h)) bound.add(h.tokenId);
  }
  const fused = new Set();
  const fusions = (await store.pool.query("SELECT params,result FROM ryo_purchases WHERE scope=$1 AND product='fusion' AND status='confirmed' ORDER BY COALESCE(settled_at,created),created", [store.scope])).rows;
  for (const f of fusions) {
    const ids = Array.isArray(f.params?.heroIds) ? f.params.heroIds : [], outs = (f.result?.outputs || []).filter(h => h && typeof h.tokenId === 'string');
    const groups = Array.from({ length: Math.floor(ids.length / 3) }, (_, i) => ids.slice(i * 3, i * 3 + 3).some(id => bound.has(id) || fused.has(id)));
    if (!groups.some(Boolean)) continue;
    const take = outs.length === groups.length ? outs.filter((_, i) => groups[i]) : outs;
    for (const h of take) if (!bound.has(h.tokenId)) fused.add(h.tokenId);
  }
  const ids = [...fused], done = { heroes: 0, wallets: 0, returned: 0, pending: 0 };
  if (ids.length) {
    const wallets = (await store.pool.query("SELECT wallet FROM ryo_profiles WHERE scope=$1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(data->'heroes','[]'::jsonb)) h WHERE h->>'tokenId' = ANY($2::text[]))", [store.scope, ids])).rows.map(r => r.wallet);
    for (const wallet of wallets) await store.transaction(async c => {
      await store.locked(c, wallet); const profile = await store.profileLocked(c, wallet); let n = 0;
      for (const h of profile.heroes) if (fused.has(h.tokenId) && !isBound(h)) { h.marketBound = true; n++; }
      if (n) { await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]); done.heroes += n; done.wallets++; }
    });
    const listed = (await store.pool.query("SELECT id,seller,status FROM ryo_market_listings WHERE scope=$1 AND status IN ('active','pending') AND hero->>'tokenId' = ANY($2::text[])", [store.scope, ids])).rows;
    for (const l of listed) {
      if (l.status === 'pending') { done.pending++; continue; }
      await store.transaction(async c => {
        await store.locked(c, l.seller);
        const row = (await c.query('SELECT * FROM ryo_market_listings WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, l.id])).rows[0];
        if (!row || row.status !== 'active') return;
        row.hero = { ...row.hero, marketBound: true }; await retire(store, c, row, 'rules'); done.returned++;
      });
    }
    done.waiting = listed.filter(l => l.status === 'pending').map(l => l.id);
  }
  // Recorded once. Listings still being paid for are kept in the record and finished by bindLeftovers (no new scan).
  await store.pool.query('INSERT INTO ryo_market_migrations(scope,id,done,detail) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [store.scope, BIND_ID, store.now(), JSON.stringify({ ...done, bound: bound.size, fused: ids.length, waiting: done.waiting || [] })]);
  (bindFusedOnce.done ||= new WeakSet()).add(store);
  return done;
}
/* A listed hero the one-time step had to bind while a buyer was paying for it: once that payment settles, the hero is
 * bound wherever it ended up (back on sale: returned to the seller; sold: with the buyer; returned: with the seller). */
async function bindLeftovers(store) {
  const m = (await store.pool.query('SELECT detail FROM ryo_market_migrations WHERE scope=$1 AND id=$2', [store.scope, BIND_ID])).rows[0];
  const waiting = m?.detail?.waiting || []; if (!waiting.length) return 0;
  const left = [];
  for (const id of waiting) {
    const l = (await store.pool.query('SELECT id,seller,buyer,status,hero FROM ryo_market_listings WHERE scope=$1 AND id=$2', [store.scope, id])).rows[0];
    if (!l) continue;
    if (l.status === 'pending') { left.push(id); continue; }
    const owner = l.status === 'sold' ? l.buyer : l.seller;
    await store.transaction(async c => {
      await store.locked(c, l.seller); if (owner !== l.seller) await store.locked(c, owner);
      const row = (await c.query('SELECT * FROM ryo_market_listings WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, id])).rows[0];
      if (row.status === 'active') { row.hero = { ...row.hero, marketBound: true }; await retire(store, c, row, 'rules'); return; }
      const profile = await store.profileLocked(c, owner), h = profile.heroes.find(x => x.tokenId === row.hero?.tokenId);
      if (h && !h.marketBound) { h.marketBound = true; await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, owner, JSON.stringify(profile)]); }
    });
  }
  await store.pool.query("UPDATE ryo_market_migrations SET detail=jsonb_set(detail,'{waiting}',$3::jsonb) WHERE scope=$1 AND id=$2", [store.scope, BIND_ID, JSON.stringify(left)]);
  return waiting.length - left.length;
}
const sweepers = new WeakSet();
/** Is the Market open on this server (the same gate that admits market-post/buy/offer/accept)? Unknown = closed. */
function marketOpen(env = process.env) { try { return require('./launch-gates.cjs').publicGates(env).marketplace === true; } catch { return false; } }
/** Start the background sweep once per store. It runs on the hosted game server (Render sets RENDER=true) or when
 * MARKET_SWEEPER=on; MARKET_SWEEPER=off turns it off (rollback). Started lazily by the first player request (sweep). */
function startSweeper(store, env = process.env, every = SWEEP_MS) {
  const flag = String(env.MARKET_SWEEPER || '').trim();
  if (/^(0|off|false|no)$/i.test(flag) || !(/^(1|on|true|yes)$/i.test(flag) || String(env.RENDER || '') === 'true') || sweepers.has(store)) return null;
  sweepers.add(store); let running = false;
  const tick = async () => {
    // Owner decision 2026-11-12: nothing changes while the Market is closed (launch gate / Admin Control switch off).
    // Opening it starts the sweep: expiry, retirement of pre-rule listings/offers and the one-time fused-hero binding.
    if (running || !marketOpen(env)) return; running = true;
    try { await sweepAll(store); } catch (e) { console.error('[market] background sweep failed:', e?.message || e); } finally { running = false; }
  };
  const timer = setInterval(tick, every); timer.unref?.(); setTimeout(tick, 5000).unref?.();
  return timer;
}
async function sweep(store, wallet) {
  startSweeper(store);
  const now = store.now();
  const due = (await store.pool.query(`SELECT 1 FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status='active' AND expires<=$3
    UNION ALL SELECT 1 FROM ryo_market_offers o JOIN ryo_market_listings l ON l.scope=o.scope AND l.id=o.listing_id
    WHERE o.scope=$1 AND o.buyer=$2 AND o.status='active' AND (o.expires<=$3 OR l.expires<=$3 OR l.status IN ('sold','cancelled','expired')) LIMIT 1`, [store.scope, wallet, now])).rows.length;
  if (due) await store.transaction(async c => { await store.locked(c, wallet); await sweepLocked(store, c, wallet); });
}
/* A Market sale moves no tokens: it is confirmed in the same request. If the server stopped in between, the sale is still
 * pending here with an internal signature (nothing to look up on-chain), so it is confirmed now. settlePurchase is
 * idempotent (status check under the buyer's lock), so a second caller changes nothing. */
async function confirmInternal(store, wallet = null) {
  const rows = (await store.pool.query(`SELECT wallet,request_id FROM ryo_purchases WHERE scope=$1 AND status='pending' AND product='market' AND quote->>'settlement'='internal'
    ${wallet ? 'AND wallet=$2' : ''} LIMIT ${SWEEP_BATCH}`, wallet ? [store.scope, wallet] : [store.scope])).rows;
  for (const r of rows) await store.settlePurchase(r.wallet, r.request_id, 'confirmed');
  return rows.length;
}

async function post(store, wallet, body) {
  if (typeof body.heroId !== 'string') fail('Choose a hero to list.');
  const price = Number(body.price);
  return postLocked(store, wallet, body, price).catch(async e => {
    // The listing rolled back; record the refused attempt for the admin audit trail.
    if (e.referralBound) await store.pool.query('INSERT INTO ryo_creator_audit(scope,actor,action,target,reason,detail,created) VALUES($1,$2,$3,$4,$5,$6,$7)', [store.scope, wallet, 'market.referral-bound-rejected', e.referralBound, 'Referral-bound hero listing refused', '{}', store.now()]).catch(() => {});
    throw e;
  });
}
function postLocked(store, wallet, body, price) {
  return store.transaction(async c => {
    await store.locked(c, wallet); await sweepLocked(store, c, wallet);
    if ((await c.query("SELECT request_id FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1", [store.scope, wallet])).rows.length) fail('Wait for your pending purchase to settle before listing a hero.', 409);
    const profile = await store.profileLocked(c, wallet), hero = profile.heroes.find(h => h.tokenId === body.heroId);
    if (!hero) fail('Only heroes from your signed-in token collection can be listed.');
    // One rule for every Market step: Jonin/Elite/Legend only, never Mythic NFT heroes or account-bound heroes.
    const blocked = blockReason(hero); if (blocked) refuse(blocked, hero);
    const mins = await minPrices(store, c), min = mins[hero.rank];
    if (!Number.isSafeInteger(price) || price < min || price > MAX_PRICE) fail(`Set a price from ${min.toLocaleString('en-US')} to ${MAX_PRICE.toLocaleString('en-US')} Ryo for a ${RANKS[hero.rank]}.`);
    if (profile.heroes.length <= 2) fail('Keep at least two heroes in your collection.');
    const active = Number((await c.query("SELECT COUNT(*) AS n FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status IN ('active','pending')", [store.scope, wallet])).rows[0].n);
    if (active >= MAX_ACTIVE) fail(`You can have up to ${MAX_ACTIVE} heroes on the Market at once.`, 409);
    // Settle Adventure with the current team before the hero leaves it.
    await require('./adventure.cjs').settleLocked(store, c, wallet, profile, body.active === true);
    profile.heroes = profile.heroes.filter(h => h.tokenId !== hero.tokenId);
    profile.battleReady = (profile.battleReady || []).filter(id => id !== hero.tokenId);
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
    const now = store.now(), id = crypto.randomUUID();
    const row = (await c.query('INSERT INTO ryo_market_listings(scope,id,seller,hero,name,rank,perks,price,created,expires,min_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [store.scope, id, wallet, JSON.stringify(hero), String(hero.name || ''), hero.rank, JSON.stringify(hero.perks || []), price, now, now + DURATION_MS, min])).rows[0];
    return publicListing(row, now, mins);
  });
}
async function cancel(store, wallet, body) {
  const id = listingId(body.listingId);
  return store.transaction(async c => {
    await store.locked(c, wallet);
    const row = (await c.query('SELECT * FROM ryo_market_listings WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, id])).rows[0];
    if (!row || row.seller !== wallet) fail('That listing is not yours.');
    if (row.status === 'pending') fail('A buyer is paying for this hero right now. Try again in a moment.', 409);
    if (row.status !== 'active') fail('That listing is no longer on the Market.', 409);
    const profile = await store.profileLocked(c, wallet);
    if (!profile.heroes.some(h => h.tokenId === row.hero.tokenId)) profile.heroes.push(row.hero);
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
    await c.query("UPDATE ryo_market_listings SET status='cancelled',settled_at=$3 WHERE scope=$1 AND id=$2", [store.scope, id, store.now()]);
    await closeOffers(store, c, id, 'closed');
    return { cancelled: id };
  });
}

// Make (or change) an offer: the amount is held out of the buyer's balance.
async function offer(store, wallet, body) {
  const id = listingId(body.listingId), amount = Number(body.amount);
  return store.transaction(async c => {
    const account = await store.locked(c, wallet); await sweepLocked(store, c, wallet);
    const listing = (await c.query('SELECT * FROM ryo_market_listings WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, id])).rows[0];
    if (!listing || listing.status !== 'active' || Number(listing.expires) <= store.now()) fail('This hero is no longer for sale.', 409);
    if (listing.seller === wallet) fail('You cannot make an offer on your own listing.');
    const blocked = blockReason(listing.hero); if (blocked) fail('This hero can no longer be traded on the Market.', 409);
    // The current rank minimum, never below the minimum the listing was made under.
    const min = Math.max((await minPrices(store, c))[listing.hero.rank], listing.min_price == null ? 0 : Number(listing.min_price)), price = Number(listing.price);
    if (min >= price) fail('This listing takes no offers. Buy it now at the listed price.', 409);
    if (!Number.isSafeInteger(amount) || amount < min || amount >= price) fail(`Offer from ${min.toLocaleString('en-US')} up to ${(price - 1).toLocaleString('en-US')} Ryo, or buy now at the listed price.`);
    const previous = (await c.query("SELECT * FROM ryo_market_offers WHERE scope=$1 AND listing_id=$2 AND buyer=$3 AND status='active' FOR UPDATE", [store.scope, id, wallet])).rows[0];
    const held = previous ? Number(previous.amount) : 0, heldBonus = previous?.funding === 'bonus';
    const funding = Number(account.bonus || 0) + (heldBonus ? held : 0) >= amount ? 'bonus' : Number(account.balance) + (heldBonus ? 0 : held) >= amount ? 'balance' : null;
    if (!funding) fail('Not enough Ryo in your balance for this offer.');
    if (!previous && Number((await c.query("SELECT COUNT(*) AS n FROM ryo_market_offers WHERE scope=$1 AND buyer=$2 AND status='active'", [store.scope, wallet])).rows[0].n) >= MAX_OFFERS) fail(`You can have up to ${MAX_OFFERS} open offers at once.`, 409);
    if (previous) await c.query("UPDATE ryo_market_offers SET status='cancelled',settled_at=$3 WHERE scope=$1 AND id=$2", [store.scope, previous.id, store.now()]);
    if (previous) await credit(store, c, wallet, held, previous.funding);
    await c.query(`UPDATE ryo_accounts SET ${funding}=${funding}-$3 WHERE scope=$1 AND wallet=$2`, [store.scope, wallet, amount]);
    const now = store.now();
    const row = (await c.query('INSERT INTO ryo_market_offers(scope,id,listing_id,buyer,seller,amount,created,expires,funding,min_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [store.scope, crypto.randomUUID(), id, wallet, listing.seller, amount, now, Math.min(now + OFFER_MS, Number(listing.expires)), funding, min])).rows[0];
    return { offer: publicOffer(row, now) };
  });
}
async function withdrawOffer(store, wallet, body, by) {
  const id = uuid(body.offerId, 'offer');
  return store.transaction(async c => {
    const o = (await c.query('SELECT * FROM ryo_market_offers WHERE scope=$1 AND id=$2', [store.scope, id])).rows[0];
    if (!o || o[by] !== wallet) fail('That offer is not available.');
    await lockBoth(store, c, o.buyer, o.seller);
    const row = (await c.query('SELECT * FROM ryo_market_offers WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, id])).rows[0];
    if (row.status !== 'active') fail('That offer is already closed.', 409);
    await credit(store, c, row.buyer, Number(row.amount), row.funding);
    await c.query('UPDATE ryo_market_offers SET status=$3,settled_at=$4 WHERE scope=$1 AND id=$2', [store.scope, id, by === 'buyer' ? 'cancelled' : 'declined', store.now()]);
    return { offerId: id, status: by === 'buyer' ? 'cancelled' : 'declined' };
  });
}
// The seller accepts: a purchase for the buyer at the offered price, paid from the held Ryo.
async function accept(store, wallet, requestId, body, prepare) {
  const id = uuid(body.offerId, 'offer');
  return store.transaction(async c => {
    const peek = (await c.query('SELECT * FROM ryo_market_offers WHERE scope=$1 AND id=$2', [store.scope, id])).rows[0];
    if (!peek || peek.seller !== wallet) fail('That offer is not available.');
    await lockBoth(store, c, peek.buyer, wallet);
    const o = (await c.query('SELECT * FROM ryo_market_offers WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, id])).rows[0];
    const old = (await c.query('SELECT * FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND request_id=$3', [store.scope, o.buyer, requestId])).rows[0];
    if (old) { if (old.product !== 'market' || old.params?.offerId !== id) fail('Purchase request ID belongs to another order.'); return old; }
    if (o.status !== 'active' || Number(o.expires) <= store.now()) fail('That offer is no longer open.', 409);
    const listing = (await c.query('SELECT * FROM ryo_market_listings WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, o.listing_id])).rows[0];
    if (!listing || listing.status !== 'active' || Number(listing.expires) <= store.now()) fail('This listing is no longer on the Market.', 409);
    if (blockReason(listing.hero)) fail('This hero can no longer be traded on the Market.', 409);
    // Never below the minimum the offer was made under (legacy offers: the current minimum).
    const floor = o.min_price == null ? Math.max((await minPrices(store, c))[listing.hero.rank], listing.min_price == null ? 0 : Number(listing.min_price)) : Number(o.min_price);
    if (!(floor > 0) || Number(o.amount) < floor || Number(o.amount) >= Number(listing.price)) fail('This offer is below the Market minimum for this hero and cannot be accepted.', 409);
    if ((await c.query("SELECT request_id FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1", [store.scope, o.buyer])).rows.length) fail('The buyer is finishing another purchase. Try again in a moment.', 409);
    const profile = await store.profileLocked(c, o.buyer);
    if (profile.heroes.length >= MAX_HEROES) fail("The buyer's collection is full. Decline the offer or wait.", 409);
    await require('./adventure.cjs').settleLocked(store, c, o.buyer, profile, false);
    const economy = require('./economy.cjs'), hero = listing.hero, price = Number(o.amount);
    const q = { economyVersion: economy.VERSION, product: 'market', params: { listingId: listing.id, offerId: id }, title: 'Market offer · ' + hero.name, base: price, total: price, burn: 0, ...split(price),
      sellerWallet: wallet, hero: { name: hero.name, rank: hero.rank, level: hero.level }, ...(o.funding === 'bonus' ? { funding: 'bonus' } : {}) };
    const after = economy.normalizeProfile(structuredClone(profile)); after.heroes.push(hero);
    const tx = await marketTx(q, o.buyer, requestId, prepare);
    // The offered Ryo is already held, so the buyer's balance is not debited again.
    await c.query("UPDATE ryo_market_listings SET status='pending',buyer=$3,request_id=$4 WHERE scope=$1 AND id=$2", [store.scope, listing.id, o.buyer, requestId]);
    await c.query("UPDATE ryo_market_offers SET status='accepted',settled_at=$3 WHERE scope=$1 AND id=$2", [store.scope, id, store.now()]);
    return (await c.query('INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,created,profile_delta) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',
      [store.scope, o.buyer, requestId, 'market', JSON.stringify(q.params), JSON.stringify(q), JSON.stringify({ product: 'market', title: q.title, outputs: [hero], consumed: [] }), JSON.stringify(after), price, tx.signature, tx.wire, tx.lastHeight, store.now(), JSON.stringify(require('./purchase-delta.cjs').delta(profile, after))])).rows[0];
  });
}

async function browse(store, wallet, body) {
  const now = store.now(), mins = await minPrices(store), where = ["scope=$1", "status='active'", 'expires>$2', 'rank IN (2,3,4)'], args = [store.scope, now];
  // Listings from before the new minimums that are priced below them are being returned to their sellers.
  args.push(mins[2], mins[3], mins[4]); where.push(`(min_price IS NOT NULL OR (rank=2 AND price>=$${args.length - 2}) OR (rank=3 AND price>=$${args.length - 1}) OR (rank=4 AND price>=$${args.length}))`);
  const rank = Number(body.rank); if (TRADABLE.includes(rank)) { args.push(rank); where.push('rank=$' + args.length); }
  const perks = Array.isArray(body.perks) ? [...new Set(body.perks.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))] : [];
  if (perks.length) { args.push(JSON.stringify(perks)); where.push('perks @> $' + args.length + '::jsonb'); }
  const search = typeof body.search === 'string' ? body.search.trim().slice(0, 40) : '';
  if (search) { args.push('%' + search.replace(/[\\%_]/g, m => '\\' + m) + '%'); where.push('name ILIKE $' + args.length); }
  const order = { 'price-asc': 'price ASC, created ASC', 'price-desc': 'price DESC, created ASC', newest: 'created DESC' }[body.sort] || 'price ASC, created ASC';
  const page = Math.max(0, Math.min(1000, Math.floor(Number(body.page) || 0)));
  const total = Number((await store.pool.query('SELECT COUNT(*) AS n FROM ryo_market_listings WHERE ' + where.join(' AND '), args)).rows[0].n);
  const rows = (await store.pool.query(`SELECT * FROM ryo_market_listings WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${page * PAGE}`, args)).rows;
  const mineOffers = rows.length ? (await store.pool.query("SELECT * FROM ryo_market_offers WHERE scope=$1 AND buyer=$2 AND status='active' AND listing_id=ANY($3::text[])", [store.scope, wallet, rows.map(r => r.id)])).rows : [];
  return { listings: rows.map(r => { const o = mineOffers.find(x => x.listing_id === r.id); return { ...publicListing(r, now, mins), mine: r.seller === wallet, myOffer: o ? { ...publicOffer(o, now), funding: o.funding || 'balance' } : null }; }), total, page, pages: Math.max(1, Math.ceil(total / PAGE)), rules: rules(mins) };
}
async function mine(store, wallet) {
  await sweep(store, wallet);
  const now = store.now(), mins = await minPrices(store), q = (sql, args) => store.pool.query(sql, args).then(r => r.rows);
  const listings = await q("SELECT * FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status IN ('active','pending') ORDER BY created DESC", [store.scope, wallet]);
  const received = listings.length ? await q("SELECT * FROM ryo_market_offers WHERE scope=$1 AND listing_id=ANY($2::text[]) AND status='active' AND expires>$3 ORDER BY amount DESC", [store.scope, listings.map(r => r.id), now]) : [];
  const sales = await q("SELECT * FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status='sold' ORDER BY settled_at DESC LIMIT 20", [store.scope, wallet]);
  const bought = await q("SELECT * FROM ryo_market_listings WHERE scope=$1 AND buyer=$2 AND status='sold' ORDER BY settled_at DESC LIMIT 20", [store.scope, wallet]);
  const made = await q(`SELECT o.*, l.hero, l.price, l.status AS listing_status, l.expires AS listing_expires, l.seller AS listing_seller, l.created AS listing_created, l.id AS lid FROM ryo_market_offers o JOIN ryo_market_listings l ON l.scope=o.scope AND l.id=o.listing_id
    WHERE o.scope=$1 AND o.buyer=$2 AND (o.status='active' OR o.settled_at>$3) ORDER BY o.created DESC LIMIT 20`, [store.scope, wallet, now - 7 * 24 * 3600 * 1000]);
  // Listings that came back to the seller in the last 7 days (expired, or returned because the Market rules changed).
  const returned = await q("SELECT * FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status IN ('expired','cancelled') AND close_reason IS NOT NULL AND settled_at>$3 ORDER BY settled_at DESC LIMIT 20", [store.scope, wallet, now - 7 * 24 * 3600 * 1000]);
  return {
    listings: listings.map(r => ({ ...publicListing(r, now, mins), offers: received.filter(o => o.listing_id === r.id).map(o => publicOffer(o, now)) })),
    sales: sales.map(r => ({ ...publicListing(r, now), soldAt: Number(r.settled_at) })),
    bought: bought.map(r => ({ ...publicListing(r, now), soldAt: Number(r.settled_at) })),
    returned: returned.map(r => ({ ...publicListing(r, now), returnedAt: Number(r.settled_at) })),
    offers: made.map(o => ({ ...publicOffer(o, now), listing: { ...publicListing({ id: o.lid, price: o.price, status: o.listing_status, created: o.listing_created, expires: o.listing_expires, seller: o.listing_seller, hero: o.hero }, now) } })),
    held: made.filter(o => o.status === 'active').reduce((n, o) => n + Number(o.amount), 0), rules: rules(mins)
  };
}
/* Everything the client shows comes from here; the server re-checks every value inside its own transaction. */
function rules(mins = MIN_PRICE) {
  return { minPrice: mins, defaultMinPrice: MIN_PRICE, tradableRanks: TRADABLE, maxPrice: MAX_PRICE, durationMs: DURATION_MS, maxActive: MAX_ACTIVE, offerMs: OFFER_MS, maxOffers: MAX_OFFERS,
    boundFlags: BOUND_FLAGS, shares: { seller: 100 - SHARES.studio - SHARES.treasury - SHARES.pool, ...SHARES } };
}
/* Notices: what changed for this player since `since` (offers they made or received, listings that came back).
 * Statuses come from the database only; the client turns them into OFFER ACCEPTED / DECLINED / ... messages. */
async function notices(store, wallet, body) {
  const now = store.now(), since = Math.max(now - 7 * 24 * 3600 * 1000, Math.min(now, Math.floor(Number(body.since) || 0)));
  const q = (sql, args) => store.pool.query(sql, args).then(r => r.rows);
  // Oldest first, a page per kind; when a page is full, `next` says where the client continues, so nothing is skipped.
  const received = await q(`SELECT o.id,o.amount,o.status,o.created,o.settled_at,l.name FROM ryo_market_offers o JOIN ryo_market_listings l ON l.scope=o.scope AND l.id=o.listing_id
    WHERE o.scope=$1 AND o.seller=$2 AND o.status='active' AND o.created>$3 ORDER BY o.created ASC LIMIT $4`, [store.scope, wallet, since, NOTICE_PAGE]);
  const made = await q(`SELECT o.id,o.amount,o.status,o.created,o.settled_at,l.name FROM ryo_market_offers o JOIN ryo_market_listings l ON l.scope=o.scope AND l.id=o.listing_id
    WHERE o.scope=$1 AND o.buyer=$2 AND o.status IN ('accepted','completed','declined','expired','closed','failed') AND o.settled_at>$3 ORDER BY o.settled_at ASC LIMIT $4`, [store.scope, wallet, since, NOTICE_PAGE]);
  const returned = await q("SELECT id,name,status,close_reason,settled_at FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status IN ('expired','cancelled') AND close_reason IS NOT NULL AND settled_at>$3 ORDER BY settled_at ASC LIMIT $4", [store.scope, wallet, since, NOTICE_PAGE]);
  const n = v => v == null ? null : Number(v);
  const full = [[received, 'created'], [made, 'settled_at'], [returned, 'settled_at']].filter(([rows]) => rows.length >= NOTICE_PAGE).map(([rows, k]) => n(rows.at(-1)[k]));
  return { now, next: full.length ? Math.min(...full) - 1 : now, more: full.length > 0, received: received.map(o => ({ id: o.id, amount: n(o.amount), status: o.status, at: n(o.created), hero: o.name })),
    made: made.map(o => ({ id: o.id, amount: n(o.amount), status: o.status, at: n(o.settled_at), hero: o.name })),
    returned: returned.map(r => ({ id: r.id, status: r.status, reason: r.close_reason, at: n(r.settled_at), hero: r.name })) };
}

// Reserve a purchase of a listing at its price (called by the service with its signed-transfer builder).
async function buy(store, wallet, requestId, body, prepare) {
  const id = listingId(body.listingId), expected = Number(body.expectedPrice);
  return store.transaction(async c => {
    const account = await store.locked(c, wallet);
    const old = (await c.query('SELECT * FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND request_id=$3', [store.scope, wallet, requestId])).rows[0];
    if (old) { if (old.product !== 'market' || old.params?.listingId !== id) fail('Purchase request ID belongs to another order.'); return old; }
    if ((await c.query("SELECT request_id FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1", [store.scope, wallet])).rows.length) fail('Recover the pending token purchase first.');
    const row = (await c.query('SELECT * FROM ryo_market_listings WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, id])).rows[0];
    if (!row || row.status !== 'active' || Number(row.expires) <= store.now()) fail('This hero is no longer for sale.', 409);
    if (row.seller === wallet) fail('You cannot buy your own listing. Cancel it in My Listings instead.');
    if (blockReason(row.hero)) fail('This hero can no longer be traded on the Market.', 409);
    const price = Number(row.price); if (price !== expected) fail('The price changed. Review the listing again before buying.', 409);
    // A listing from before the new minimums that is priced below them is being returned to its seller.
    if (row.min_price == null && price < (await minPrices(store, c))[row.hero.rank]) fail('This hero is no longer for sale.', 409);
    // An open offer of this buyer on the same listing is returned first, so it can fund the purchase.
    const own = (await c.query("SELECT * FROM ryo_market_offers WHERE scope=$1 AND listing_id=$2 AND buyer=$3 AND status='active' FOR UPDATE", [store.scope, id, wallet])).rows[0];
    const held = own ? Number(own.amount) : 0, heldBonus = own?.funding === 'bonus';
    const funding = Number(account.bonus || 0) + (heldBonus ? held : 0) >= price ? 'bonus' : Number(account.balance) + (heldBonus ? 0 : held) >= price ? 'balance' : null;
    if (!funding) fail('Not enough Ryo in your balance for this hero.');
    const profile = await store.profileLocked(c, wallet);
    if (profile.heroes.length >= MAX_HEROES) fail(`Your collection holds ${MAX_HEROES} heroes. Fuse heroes to free a slot first.`, 409);
    await require('./adventure.cjs').settleLocked(store, c, wallet, profile, false);
    const economy = require('./economy.cjs'), hero = row.hero;
    const q = { economyVersion: economy.VERSION, product: 'market', params: { listingId: id }, title: 'Market · ' + hero.name, base: price, total: price, burn: 0, ...split(price),
      sellerWallet: row.seller, hero: { name: hero.name, rank: hero.rank, level: hero.level }, ...(funding === 'bonus' ? { funding: 'bonus' } : {}) };
    const after = economy.normalizeProfile(structuredClone(profile)); after.heroes.push(hero);
    const tx = await marketTx(q, wallet, requestId, prepare);
    if (own) { await c.query("UPDATE ryo_market_offers SET status='cancelled',settled_at=$3 WHERE scope=$1 AND id=$2", [store.scope, own.id, store.now()]); await credit(store, c, wallet, held, own.funding); }
    await c.query(`UPDATE ryo_accounts SET ${funding}=${funding}-$3 WHERE scope=$1 AND wallet=$2`, [store.scope, wallet, price]);
    await c.query("UPDATE ryo_market_listings SET status='pending',buyer=$3,request_id=$4 WHERE scope=$1 AND id=$2", [store.scope, id, wallet, requestId]);
    return (await c.query('INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,created,profile_delta) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',
      [store.scope, wallet, requestId, 'market', JSON.stringify(q.params), JSON.stringify(q), JSON.stringify({ product: 'market', title: q.title, outputs: [hero], consumed: [] }), JSON.stringify(after), price, tx.signature, tx.wire, tx.lastHeight, store.now(), JSON.stringify(require('./purchase-delta.cjs').delta(profile, after))])).rows[0];
  });
}
// Called from store.settlePurchase (same transaction) for product 'market'.
async function settled(store, c, row, status) {
  const id = row.params?.listingId; if (!id) return;
  const listing = (await c.query('SELECT * FROM ryo_market_listings WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, id])).rows[0];
  if (!listing || listing.status !== 'pending' || listing.request_id !== row.request_id) {
    // The store has already returned the buyer's Ryo for a failed purchase; an accepted offer must not stay "accepted".
    if (row.params.offerId && status !== 'confirmed') await c.query("UPDATE ryo_market_offers SET status='failed',settled_at=$3 WHERE scope=$1 AND id=$2 AND status='accepted'", [store.scope, row.params.offerId, store.now()]);
    return;
  }
  if (row.params.offerId) await c.query('UPDATE ryo_market_offers SET status=$3,settled_at=$4 WHERE scope=$1 AND id=$2', [store.scope, row.params.offerId, status === 'confirmed' ? 'completed' : 'failed', store.now()]);
  if (status === 'confirmed') {
    await c.query("UPDATE ryo_market_listings SET status='sold',price=$3,settled_at=$4 WHERE scope=$1 AND id=$2", [store.scope, id, Number(row.amount), store.now()]);
    await c.query('INSERT INTO ryo_accounts(scope,wallet,balance) VALUES($1,$2,$3) ON CONFLICT(scope,wallet) DO UPDATE SET balance=ryo_accounts.balance+EXCLUDED.balance', [store.scope, listing.seller, Number(row.quote.seller)]);
    await closeOffers(store, c, id, 'closed');
  } else await c.query("UPDATE ryo_market_listings SET status='active',buyer=NULL,request_id=NULL WHERE scope=$1 AND id=$2", [store.scope, id]);
}
async function handle(store, wallet, action, body) {
  if (action === 'market-browse') return browse(store, wallet, body);
  if (action === 'market-mine') return mine(store, wallet);
  if (action === 'market-notices') return notices(store, wallet, body);
  if (action === 'market-post') return { listing: await post(store, wallet, body) };
  if (action === 'market-cancel') return cancel(store, wallet, body);
  if (action === 'market-offer') return offer(store, wallet, body);
  if (action === 'market-offer-cancel') return withdrawOffer(store, wallet, body, 'buyer');
  if (action === 'market-offer-decline') return withdrawOffer(store, wallet, body, 'seller');
  fail('Unknown Market action.');
}
module.exports = { SCHEMA, OFFER_SCHEMA, V2_SCHEMA, RANKS, TRADABLE, BOUND_FLAGS, MIN_PRICE, MAX_PRICE, DURATION_MS, OFFER_MS, MAX_ACTIVE, MAX_OFFERS, split, handle, buy, accept, settled, sweep, sweepAll, startSweeper, bindFusedOnce, bindLeftovers, confirmInternal, marketOpen, rules, minPrices, validatePrices, blockReason };
