/* Player Market for heroes (copied to app/server/market.cjs by apply-market.cjs).
 *
 * Listing escrows the hero: it leaves the seller's profile (and battle-ready roster) and is kept in
 * the listing until it sells, is cancelled, or expires (7 days), when it returns to the seller intact.
 * Buying reuses the token purchase flow: the buyer's Ryo is reserved with a signed custody transfer
 * of the treasury (8%) and studio (2%) shares; when it finalizes the buyer receives the hero, the
 * seller is credited 80%, and the reward pool keeps 10% (quote.operations, like other purchases).
 * A refunded transfer restores the buyer's Ryo and puts the listing back on sale.
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

const MIN_PRICE = [10000, 25000, 80000, 200000, 500000], MAX_PRICE = 100000000;
const DURATION_MS = 7 * 24 * 3600 * 1000, MAX_ACTIVE = 20, PAGE = 10, MAX_HEROES = 500;
const OFFER_MS = 48 * 3600 * 1000, MAX_OFFERS = 10;
const SHARES = { studio: 2, treasury: 8, pool: 10 }; // percent; the seller receives the rest (80%)
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

function split(price) {
  const studioFee = Math.floor(price * SHARES.studio / 100), treasury = Math.floor(price * SHARES.treasury / 100), operations = Math.floor(price * SHARES.pool / 100);
  return { studioFee, treasury, operations, seller: price - studioFee - treasury - operations };
}
const short = wallet => wallet.slice(0, 4) + '…' + wallet.slice(-4);
function publicHero(hero) {
  const s = require('./gameplay-options.cjs').trainedStats(hero);
  return { name: hero.name, rank: hero.rank, level: hero.level, perks: hero.perks, look: hero.look, bonus: hero.bonus, baseStats: hero.baseStats, stats: s };
}
function publicListing(row, now) {
  return { id: row.id, price: Number(row.price), status: row.status, created: Number(row.created), expires: Number(row.expires), left: Math.max(0, Number(row.expires) - now),
    seller: short(row.seller), hero: publicHero(row.hero), payout: split(Number(row.price)).seller };
}
const publicOffer = (o, now) => ({ id: o.id, listingId: o.listing_id, amount: Number(o.amount), status: o.status, created: Number(o.created), left: Math.max(0, Number(o.expires) - now), buyer: short(o.buyer), payout: split(Number(o.amount)).seller });
function uuid(value, what) { if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) fail('Choose a Market ' + what + '.'); return value; }
const listingId = value => uuid(value, 'listing');
async function lockBoth(store, c, a, b) { const [x, y] = [a, b].sort(); const first = await store.locked(c, x), second = await store.locked(c, y); return x === a ? [first, second] : [second, first]; }

// Return every active offer on a listing (except one) to its buyer.
async function closeOffers(store, c, listing, status, except = null) {
  const rows = (await c.query("SELECT * FROM ryo_market_offers WHERE scope=$1 AND listing_id=$2 AND status='active' FOR UPDATE", [store.scope, listing])).rows.filter(o => o.id !== except);
  for (const o of rows) {
    await c.query('INSERT INTO ryo_accounts(scope,wallet,balance) VALUES($1,$2,$3) ON CONFLICT(scope,wallet) DO UPDATE SET balance=ryo_accounts.balance+EXCLUDED.balance', [store.scope, o.buyer, Number(o.amount)]);
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
    await c.query("UPDATE ryo_market_listings SET status='expired',settled_at=$3 WHERE scope=$1 AND id=ANY($2::text[])", [store.scope, rows.map(r => r.id), now]);
    for (const row of rows) await closeOffers(store, c, row.id, 'closed');
  }
  const lapsed = (await c.query(`SELECT o.* FROM ryo_market_offers o JOIN ryo_market_listings l ON l.scope=o.scope AND l.id=o.listing_id
    WHERE o.scope=$1 AND o.buyer=$2 AND o.status='active' AND (o.expires<=$3 OR l.expires<=$3 OR l.status IN ('sold','cancelled','expired')) FOR UPDATE OF o`, [store.scope, wallet, now])).rows;
  for (const o of lapsed) {
    await c.query('UPDATE ryo_accounts SET balance=balance+$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, Number(o.amount)]);
    await c.query("UPDATE ryo_market_offers SET status='expired',settled_at=$3 WHERE scope=$1 AND id=$2", [store.scope, o.id, now]);
  }
  return rows.length + lapsed.length;
}
async function sweep(store, wallet) {
  const now = store.now();
  const due = (await store.pool.query(`SELECT 1 FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status='active' AND expires<=$3
    UNION ALL SELECT 1 FROM ryo_market_offers o JOIN ryo_market_listings l ON l.scope=o.scope AND l.id=o.listing_id
    WHERE o.scope=$1 AND o.buyer=$2 AND o.status='active' AND (o.expires<=$3 OR l.expires<=$3 OR l.status IN ('sold','cancelled','expired')) LIMIT 1`, [store.scope, wallet, now])).rows.length;
  if (due) await store.transaction(async c => { await store.locked(c, wallet); await sweepLocked(store, c, wallet); });
}

async function post(store, wallet, body) {
  if (typeof body.heroId !== 'string') fail('Choose a hero to list.');
  const price = Number(body.price);
  return store.transaction(async c => {
    await store.locked(c, wallet); await sweepLocked(store, c, wallet);
    if ((await c.query("SELECT request_id FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1", [store.scope, wallet])).rows.length) fail('Wait for your pending purchase to settle before listing a hero.', 409);
    const profile = await store.profileLocked(c, wallet), hero = profile.heroes.find(h => h.tokenId === body.heroId);
    if (!hero) fail('Only heroes from your signed-in token collection can be listed.');
    if (!Number.isSafeInteger(price) || price < MIN_PRICE[hero.rank] || price > MAX_PRICE) fail(`Set a price from ${MIN_PRICE[hero.rank].toLocaleString('en-US')} to ${MAX_PRICE.toLocaleString('en-US')} Ryo for this rank.`);
    if (profile.heroes.length <= 2) fail('Keep at least two heroes in your collection.');
    const active = Number((await c.query("SELECT COUNT(*) AS n FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status IN ('active','pending')", [store.scope, wallet])).rows[0].n);
    if (active >= MAX_ACTIVE) fail(`You can have up to ${MAX_ACTIVE} heroes on the Market at once.`, 409);
    // Settle Adventure with the current team before the hero leaves it.
    await require('./adventure.cjs').settleLocked(store, c, wallet, profile, body.active === true);
    profile.heroes = profile.heroes.filter(h => h.tokenId !== hero.tokenId);
    profile.battleReady = (profile.battleReady || []).filter(id => id !== hero.tokenId);
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
    const now = store.now(), id = crypto.randomUUID();
    const row = (await c.query('INSERT INTO ryo_market_listings(scope,id,seller,hero,name,rank,perks,price,created,expires) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [store.scope, id, wallet, JSON.stringify(hero), String(hero.name || ''), hero.rank, JSON.stringify(hero.perks || []), price, now, now + DURATION_MS])).rows[0];
    return publicListing(row, now);
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
    const min = MIN_PRICE[listing.rank], price = Number(listing.price);
    if (!Number.isSafeInteger(amount) || amount < min || amount >= price) fail(`Offer from ${min.toLocaleString('en-US')} up to ${(price - 1).toLocaleString('en-US')} Ryo, or buy now at the listed price.`);
    const previous = (await c.query("SELECT * FROM ryo_market_offers WHERE scope=$1 AND listing_id=$2 AND buyer=$3 AND status='active' FOR UPDATE", [store.scope, id, wallet])).rows[0];
    const held = previous ? Number(previous.amount) : 0;
    if (Number(account.balance) + held < amount) fail('Not enough Ryo in your balance for this offer.');
    if (!previous && Number((await c.query("SELECT COUNT(*) AS n FROM ryo_market_offers WHERE scope=$1 AND buyer=$2 AND status='active'", [store.scope, wallet])).rows[0].n) >= MAX_OFFERS) fail(`You can have up to ${MAX_OFFERS} open offers at once.`, 409);
    if (previous) await c.query("UPDATE ryo_market_offers SET status='cancelled',settled_at=$3 WHERE scope=$1 AND id=$2", [store.scope, previous.id, store.now()]);
    await c.query('UPDATE ryo_accounts SET balance=balance+$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, held - amount]);
    const now = store.now();
    const row = (await c.query('INSERT INTO ryo_market_offers(scope,id,listing_id,buyer,seller,amount,created,expires) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [store.scope, crypto.randomUUID(), id, wallet, listing.seller, amount, now, Math.min(now + OFFER_MS, Number(listing.expires))])).rows[0];
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
    await c.query('UPDATE ryo_accounts SET balance=balance+$3 WHERE scope=$1 AND wallet=$2', [store.scope, row.buyer, Number(row.amount)]);
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
    if ((await c.query("SELECT request_id FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1", [store.scope, o.buyer])).rows.length) fail('The buyer is finishing another purchase. Try again in a moment.', 409);
    const profile = await store.profileLocked(c, o.buyer);
    if (profile.heroes.length >= MAX_HEROES) fail("The buyer's collection is full. Decline the offer or wait.", 409);
    await require('./adventure.cjs').settleLocked(store, c, o.buyer, profile, false);
    const economy = require('./economy.cjs'), hero = listing.hero, price = Number(o.amount);
    const q = { economyVersion: economy.VERSION, product: 'market', params: { listingId: listing.id, offerId: id }, title: 'Market offer · ' + hero.name, base: price, total: price, burn: 0, ...split(price),
      sellerWallet: wallet, hero: { name: hero.name, rank: hero.rank, level: hero.level } };
    const after = economy.normalizeProfile(structuredClone(profile)); after.heroes.push(hero);
    const tx = await prepare(q);
    // The offered Ryo is already held, so the buyer's balance is not debited again.
    await c.query("UPDATE ryo_market_listings SET status='pending',buyer=$3,request_id=$4 WHERE scope=$1 AND id=$2", [store.scope, listing.id, o.buyer, requestId]);
    await c.query("UPDATE ryo_market_offers SET status='accepted',settled_at=$3 WHERE scope=$1 AND id=$2", [store.scope, id, store.now()]);
    return (await c.query('INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [store.scope, o.buyer, requestId, 'market', JSON.stringify(q.params), JSON.stringify(q), JSON.stringify({ product: 'market', title: q.title, outputs: [hero], consumed: [] }), JSON.stringify(after), price, tx.signature, tx.wire, tx.lastHeight, store.now()])).rows[0];
  });
}

async function browse(store, wallet, body) {
  const now = store.now(), where = ["scope=$1", "status='active'", 'expires>$2'], args = [store.scope, now];
  const rank = Number(body.rank); if (Number.isInteger(rank) && rank >= 0 && rank <= 4) { args.push(rank); where.push('rank=$' + args.length); }
  const perks = Array.isArray(body.perks) ? [...new Set(body.perks.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))] : [];
  if (perks.length) { args.push(JSON.stringify(perks)); where.push('perks @> $' + args.length + '::jsonb'); }
  const search = typeof body.search === 'string' ? body.search.trim().slice(0, 40) : '';
  if (search) { args.push('%' + search.replace(/[\\%_]/g, m => '\\' + m) + '%'); where.push('name ILIKE $' + args.length); }
  const order = { 'price-asc': 'price ASC, created ASC', 'price-desc': 'price DESC, created ASC', newest: 'created DESC' }[body.sort] || 'price ASC, created ASC';
  const page = Math.max(0, Math.min(1000, Math.floor(Number(body.page) || 0)));
  const total = Number((await store.pool.query('SELECT COUNT(*) AS n FROM ryo_market_listings WHERE ' + where.join(' AND '), args)).rows[0].n);
  const rows = (await store.pool.query(`SELECT * FROM ryo_market_listings WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${page * PAGE}`, args)).rows;
  const mineOffers = rows.length ? (await store.pool.query("SELECT * FROM ryo_market_offers WHERE scope=$1 AND buyer=$2 AND status='active' AND listing_id=ANY($3::text[])", [store.scope, wallet, rows.map(r => r.id)])).rows : [];
  return { listings: rows.map(r => { const o = mineOffers.find(x => x.listing_id === r.id); return { ...publicListing(r, now), mine: r.seller === wallet, myOffer: o ? publicOffer(o, now) : null }; }), total, page, pages: Math.max(1, Math.ceil(total / PAGE)), rules: rules() };
}
async function mine(store, wallet) {
  await sweep(store, wallet);
  const now = store.now(), q = (sql, args) => store.pool.query(sql, args).then(r => r.rows);
  const listings = await q("SELECT * FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status IN ('active','pending') ORDER BY created DESC", [store.scope, wallet]);
  const received = listings.length ? await q("SELECT * FROM ryo_market_offers WHERE scope=$1 AND listing_id=ANY($2::text[]) AND status='active' AND expires>$3 ORDER BY amount DESC", [store.scope, listings.map(r => r.id), now]) : [];
  const sales = await q("SELECT * FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status='sold' ORDER BY settled_at DESC LIMIT 20", [store.scope, wallet]);
  const bought = await q("SELECT * FROM ryo_market_listings WHERE scope=$1 AND buyer=$2 AND status='sold' ORDER BY settled_at DESC LIMIT 20", [store.scope, wallet]);
  const made = await q(`SELECT o.*, l.hero, l.price, l.status AS listing_status, l.expires AS listing_expires, l.seller AS listing_seller, l.created AS listing_created, l.id AS lid FROM ryo_market_offers o JOIN ryo_market_listings l ON l.scope=o.scope AND l.id=o.listing_id
    WHERE o.scope=$1 AND o.buyer=$2 AND (o.status='active' OR o.settled_at>$3) ORDER BY o.created DESC LIMIT 20`, [store.scope, wallet, now - 7 * 24 * 3600 * 1000]);
  return {
    listings: listings.map(r => ({ ...publicListing(r, now), offers: received.filter(o => o.listing_id === r.id).map(o => publicOffer(o, now)) })),
    sales: sales.map(r => ({ ...publicListing(r, now), soldAt: Number(r.settled_at) })),
    bought: bought.map(r => ({ ...publicListing(r, now), soldAt: Number(r.settled_at) })),
    offers: made.map(o => ({ ...publicOffer(o, now), listing: { ...publicListing({ id: o.lid, price: o.price, status: o.listing_status, created: o.listing_created, expires: o.listing_expires, seller: o.listing_seller, hero: o.hero }, now) } })),
    held: made.filter(o => o.status === 'active').reduce((n, o) => n + Number(o.amount), 0), rules: rules()
  };
}
function rules() { return { minPrice: MIN_PRICE, maxPrice: MAX_PRICE, durationMs: DURATION_MS, maxActive: MAX_ACTIVE, offerMs: OFFER_MS, maxOffers: MAX_OFFERS, shares: { seller: 100 - SHARES.studio - SHARES.treasury - SHARES.pool, ...SHARES } }; }

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
    const price = Number(row.price); if (price !== expected) fail('The price changed. Review the listing again before buying.', 409);
    // An open offer of this buyer on the same listing is returned first, so it can fund the purchase.
    const own = (await c.query("SELECT * FROM ryo_market_offers WHERE scope=$1 AND listing_id=$2 AND buyer=$3 AND status='active' FOR UPDATE", [store.scope, id, wallet])).rows[0];
    const held = own ? Number(own.amount) : 0;
    if (Number(account.balance) + held < price) fail('Not enough Ryo in your balance for this hero.');
    const profile = await store.profileLocked(c, wallet);
    if (profile.heroes.length >= MAX_HEROES) fail(`Your collection holds ${MAX_HEROES} heroes. Fuse heroes to free a slot first.`, 409);
    await require('./adventure.cjs').settleLocked(store, c, wallet, profile, false);
    const economy = require('./economy.cjs'), hero = row.hero;
    const q = { economyVersion: economy.VERSION, product: 'market', params: { listingId: id }, title: 'Market · ' + hero.name, base: price, total: price, burn: 0, ...split(price),
      sellerWallet: row.seller, hero: { name: hero.name, rank: hero.rank, level: hero.level } };
    const after = economy.normalizeProfile(structuredClone(profile)); after.heroes.push(hero);
    const tx = await prepare(q);
    if (own) await c.query("UPDATE ryo_market_offers SET status='cancelled',settled_at=$3 WHERE scope=$1 AND id=$2", [store.scope, own.id, store.now()]);
    await c.query('UPDATE ryo_accounts SET balance=balance-$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, price - held]);
    await c.query("UPDATE ryo_market_listings SET status='pending',buyer=$3,request_id=$4 WHERE scope=$1 AND id=$2", [store.scope, id, wallet, requestId]);
    return (await c.query('INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [store.scope, wallet, requestId, 'market', JSON.stringify(q.params), JSON.stringify(q), JSON.stringify({ product: 'market', title: q.title, outputs: [hero], consumed: [] }), JSON.stringify(after), price, tx.signature, tx.wire, tx.lastHeight, store.now()])).rows[0];
  });
}
// Called from store.settlePurchase (same transaction) for product 'market'.
async function settled(store, c, row, status) {
  const id = row.params?.listingId; if (!id) return;
  const listing = (await c.query('SELECT * FROM ryo_market_listings WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, id])).rows[0];
  if (!listing || listing.status !== 'pending' || listing.request_id !== row.request_id) return;
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
  if (action === 'market-post') return { listing: await post(store, wallet, body) };
  if (action === 'market-cancel') return cancel(store, wallet, body);
  if (action === 'market-offer') return offer(store, wallet, body);
  if (action === 'market-offer-cancel') return withdrawOffer(store, wallet, body, 'buyer');
  if (action === 'market-offer-decline') return withdrawOffer(store, wallet, body, 'seller');
  fail('Unknown Market action.');
}
module.exports = { SCHEMA, OFFER_SCHEMA, MIN_PRICE, MAX_PRICE, DURATION_MS, OFFER_MS, MAX_ACTIVE, MAX_OFFERS, split, handle, buy, accept, settled, sweep, rules };
