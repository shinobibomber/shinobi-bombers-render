/* Player Market for heroes (copied to app/server/market.cjs by apply-market.cjs).
 *
 * Listing escrows the hero: it leaves the seller's profile (and battle-ready roster) and is kept in
 * the listing until it sells, is cancelled, or expires (7 days), when it returns to the seller intact.
 * Buying reuses the token purchase flow: the buyer's Ryo is reserved with a signed custody transfer
 * of the treasury (8%) and studio (2%) shares; when it finalizes the buyer receives the hero, the
 * seller is credited 80%, and the reward pool keeps 10% (quote.operations, like other purchases).
 * A refunded transfer restores the buyer's Ryo and puts the listing back on sale.
 */
'use strict';
const crypto = require('node:crypto');
// Loaded lazily: the build step reads SCHEMA from the source folder, where store.cjs does not exist.
const fail = (...args) => require('./store.cjs').fail(...args);

const MIN_PRICE = [10000, 25000, 80000, 200000, 500000], MAX_PRICE = 100000000;
const DURATION_MS = 7 * 24 * 3600 * 1000, MAX_ACTIVE = 20, PAGE = 10, MAX_HEROES = 500;
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
function listingId(value) { if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) fail('Choose a Market listing.'); return value; }

// Return the seller's expired listings (status active, past expiry) to their profile.
async function sweepLocked(store, c, wallet) {
  const rows = (await c.query("SELECT * FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status='active' AND expires<=$3 FOR UPDATE", [store.scope, wallet, store.now()])).rows;
  if (!rows.length) return 0;
  const profile = await store.profileLocked(c, wallet);
  for (const row of rows) if (!profile.heroes.some(h => h.tokenId === row.hero.tokenId)) profile.heroes.push(row.hero);
  await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
  await c.query("UPDATE ryo_market_listings SET status='expired',settled_at=$3 WHERE scope=$1 AND id=ANY($2::text[])", [store.scope, rows.map(r => r.id), store.now()]);
  return rows.length;
}
async function sweep(store, wallet) {
  const due = (await store.pool.query("SELECT 1 FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status='active' AND expires<=$3 LIMIT 1", [store.scope, wallet, store.now()])).rows.length;
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
    return { cancelled: id };
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
  return { listings: rows.map(r => ({ ...publicListing(r, now), mine: r.seller === wallet })), total, page, pages: Math.max(1, Math.ceil(total / PAGE)), rules: rules() };
}
async function mine(store, wallet) {
  await sweep(store, wallet);
  const now = store.now(), q = (sql, args) => store.pool.query(sql, args).then(r => r.rows);
  const listings = await q("SELECT * FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status IN ('active','pending') ORDER BY created DESC", [store.scope, wallet]);
  const sales = await q("SELECT * FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND status='sold' ORDER BY settled_at DESC LIMIT 20", [store.scope, wallet]);
  const bought = await q("SELECT * FROM ryo_market_listings WHERE scope=$1 AND buyer=$2 AND status='sold' ORDER BY settled_at DESC LIMIT 20", [store.scope, wallet]);
  return { listings: listings.map(r => publicListing(r, now)), sales: sales.map(r => ({ ...publicListing(r, now), soldAt: Number(r.settled_at) })), bought: bought.map(r => ({ ...publicListing(r, now), soldAt: Number(r.settled_at) })), rules: rules() };
}
function rules() { return { minPrice: MIN_PRICE, maxPrice: MAX_PRICE, durationMs: DURATION_MS, maxActive: MAX_ACTIVE, shares: { seller: 100 - SHARES.studio - SHARES.treasury - SHARES.pool, ...SHARES } }; }

// Reserve a purchase of a listing (called by the service with its signed-transfer builder).
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
    if (Number(account.balance) < price) fail('Not enough Ryo in your balance for this hero.');
    const profile = await store.profileLocked(c, wallet);
    if (profile.heroes.length >= MAX_HEROES) fail(`Your collection holds ${MAX_HEROES} heroes. Fuse heroes to free a slot first.`, 409);
    await require('./adventure.cjs').settleLocked(store, c, wallet, profile, false);
    const economy = require('./economy.cjs'), hero = row.hero;
    const q = { economyVersion: economy.VERSION, product: 'market', params: { listingId: id }, title: 'Market · ' + hero.name, base: price, total: price, burn: 0, ...split(price),
      sellerWallet: row.seller, hero: { name: hero.name, rank: hero.rank, level: hero.level } };
    const after = economy.normalizeProfile(structuredClone(profile)); after.heroes.push(hero);
    const tx = await prepare(q);
    await c.query('UPDATE ryo_accounts SET balance=balance-$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, price]);
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
  if (status === 'confirmed') {
    await c.query("UPDATE ryo_market_listings SET status='sold',settled_at=$3 WHERE scope=$1 AND id=$2", [store.scope, id, store.now()]);
    await c.query('INSERT INTO ryo_accounts(scope,wallet,balance) VALUES($1,$2,$3) ON CONFLICT(scope,wallet) DO UPDATE SET balance=ryo_accounts.balance+EXCLUDED.balance', [store.scope, listing.seller, Number(row.quote.seller)]);
  } else await c.query("UPDATE ryo_market_listings SET status='active',buyer=NULL,request_id=NULL WHERE scope=$1 AND id=$2", [store.scope, id]);
}
async function handle(store, wallet, action, body) {
  if (action === 'market-browse') return browse(store, wallet, body);
  if (action === 'market-mine') return mine(store, wallet);
  if (action === 'market-post') return { listing: await post(store, wallet, body) };
  if (action === 'market-cancel') return cancel(store, wallet, body);
  fail('Unknown Market action.');
}
module.exports = { SCHEMA, MIN_PRICE, MAX_PRICE, DURATION_MS, MAX_ACTIVE, split, handle, buy, settled, sweep, rules };
