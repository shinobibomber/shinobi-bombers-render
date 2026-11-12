/* Player Market server rules on the real store (in-memory Postgres): Jonin/Elite/Legend only with the 2026-11-12
 * minimums (150,000 / 400,000 / 1,000,000, admin-configurable), account-bound heroes refused at every step, listing
 * escrow, cancel/expiry returning the hero intact, buying through the purchase flow (reserve, confirm, refund), the
 * 80/10/8/2 split, offers (held once, change, decline, cancel, accept at the offered price, recorded minimum, refund,
 * expiry), the background sweeper (expiry, retirement of listings/offers made before the new rules, idempotent),
 * notices, and the purchases pause. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../app/server');
const economy = require(path.join(root, 'economy.cjs')), { Store } = require(path.join(root, 'store.cjs')), market = require(path.join(root, 'market.cjs'));
const { guard, validate } = require(path.join(root, 'economic-dashboard.cjs'));

const SELLER = 'seller-wallet', BUYER = 'buyer-wallet', OTHER = 'other-wallet';
const hero = (id, rank, extra = {}) => ({ tokenId: id, rank, level: 1, name: 'Hero ' + id, baseStats: { pw: 3 + rank * 3, sp: 3 + rank * 3, st: 3 + rank * 3 }, ...extra });
const filler = (prefix, n) => Array.from({ length: n }, (_, i) => hero(prefix + '-f' + i, 0));
const rejects = async (promise, pattern, message) => { await assert.rejects(promise, error => pattern.test(error.message), message); };

(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  let clock = 1_900_000_000_000; const store = new Store(pool, 'test-market', () => clock);
  const setup = (wallet, balance, heroes) => store.transaction(async c => { await store.locked(c, wallet); await c.query('UPDATE ryo_accounts SET balance=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, balance]); await store.profileLocked(c, wallet);
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(economy.normalizeProfile({ dojo: 0, heroes, battleReady: heroes.map(h => h.tokenId) }))]); });
  const profile = wallet => store.profile(wallet);
  const balance = async wallet => Number((await store.pool.query('SELECT balance FROM ryo_accounts WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0].balance);
  const tx = []; const prepare = async q => { tx.push(q); return { signature: 'S' + tx.length + 'x'.repeat(80), wire: 'd2lyZQ==', lastHeight: 100 }; };
  const post = (wallet, heroId, price) => market.handle(store, wallet, 'market-post', { heroId, price });
  const offer = (wallet, listingId, amount) => market.handle(store, wallet, 'market-offer', { listingId, amount });
  const has = async (wallet, id) => (await profile(wallet)).heroes.some(h => h.tokenId === id);
  const setPrices = async prices => { await store.pool.query("INSERT INTO ryo_admin_control(scope,version,config,pauses,installed) VALUES($1,1,$2,'{}',$3) ON CONFLICT(scope) DO UPDATE SET config=$2", [store.scope, JSON.stringify(prices ? { marketPrices: prices } : {}), clock]); };

  /* ---------- Tradable ranks and the new minimums ---------- */
  await setup(SELLER, 0, [hero('s-genin', 0), hero('s-chunin', 1), hero('s-jonin', 2, { level: 3 }), hero('s-jonin2', 2), hero('s-elite', 3), hero('s-elite2', 3), hero('s-legend', 4), hero('s-legend2', 4), hero('s-mythic', 5), hero('s-nft', 4, { nft: { mint: 'x' } }), ...filler('s', 4)]);
  await setup(BUYER, 5_000_000, [hero('b-1', 0), hero('b-2', 0)]);
  await setup(OTHER, 5_000_000, [hero('o-1', 0), hero('o-2', 0)]);
  assert.deepEqual(market.MIN_PRICE, [null, null, 150000, 400000, 1000000], 'default minimums by rank');
  assert.deepEqual(await market.minPrices(store), [null, null, 150000, 400000, 1000000]);
  await rejects(post(SELLER, 's-genin', 200000), /Only Jonin, Elite and Legend/, 'Genin cannot be listed');
  await rejects(post(SELLER, 's-chunin', 200000), /Only Jonin, Elite and Legend/, 'Chunin cannot be listed');
  await rejects(post(SELLER, 's-mythic', 2000000), /Mythic NFT heroes/, 'Mythic cannot be listed');
  await rejects(post(SELLER, 's-nft', 2000000), /Mythic NFT heroes/, 'NFT heroes cannot be listed');
  await rejects(post(SELLER, 's-jonin', 100000), /from 150,000/, 'Jonin 100,000 rejected');
  await rejects(post(SELLER, 's-elite', 300000), /from 400,000/, 'Elite 300,000 rejected');
  await rejects(post(SELLER, 's-legend', 800000), /from 1,000,000/, 'Legend 800,000 rejected');
  await rejects(post(SELLER, 's-legend', 100000001), /100,000,000/, 'maximum 100,000,000 unchanged');
  await rejects(post(SELLER, 'b-1', 500000), /token collection/, 'only your own heroes');
  const legendBefore = (await profile(SELLER)).heroes.find(h => h.tokenId === 's-legend');
  const listed = (await post(SELLER, 's-legend', 1000000)).listing;
  assert.deepEqual([listed.price, listed.payout, listed.rarity, listed.minPrice], [1000000, 800000, 'Legend', 1000000], 'Legend 1,000,000 accepted, 80% payout, minimum recorded');
  assert.equal(listed.minOffer, null, 'a listing at its minimum takes no offers');
  assert.equal((await post(SELLER, 's-legend2', 2000000)).listing.minOffer, 1000000, 'Legend 2,000,000 accepted, offers from the minimum');
  assert.equal((await post(SELLER, 's-jonin2', 150000)).listing.price, 150000, 'Jonin 150,000 accepted');
  const jonin = (await post(SELLER, 's-jonin', 250000)).listing;
  assert.equal((await post(SELLER, 's-elite', 400000)).listing.price, 400000, 'Elite 400,000 accepted');
  assert.equal((await post(SELLER, 's-elite2', 700000)).listing.price, 700000, 'Elite 700,000 accepted');
  let seller = await profile(SELLER);
  assert(!seller.heroes.some(h => h.tokenId === 's-legend') && !seller.battleReady.includes('s-legend'), 'a listed hero leaves the collection and roster (escrow)');

  /* ---------- Account-bound heroes are refused, whatever their rank ---------- */
  const BOUND = { referralReward: true, starterGrant: true, starter: true, creatorReward: true, prisonRescue: true, staffGrant: true, promoPass: 'campaign-1', promoReward: true, founderGrant: 'gold', founderSummon: 'premium', founderBound: true };
  await setup(OTHER, 5_000_000, [hero('o-1', 0), hero('o-2', 0), hero('o-3', 0), ...Object.entries(BOUND).map(([k, v]) => hero('bound-' + k, 3, { [k]: v }))]);
  for (const k of Object.keys(BOUND)) await rejects(market.handle(store, OTHER, 'market-post', { heroId: 'bound-' + k, price: 500000 }), /bound|Referral-bound/, 'bound hero refused: ' + k);
  assert.equal((await profile(OTHER)).heroes.length, 3 + Object.keys(BOUND).length, 'refused heroes stay in the collection');
  for (const k of Object.keys(BOUND)) assert(market.blockReason(hero('x', 2, { [k]: BOUND[k] })), 'blockReason: ' + k);
  assert.equal(market.blockReason(hero('x', 2)), null, 'a plain Jonin is tradable');
  assert.equal(market.blockReason(hero('x', 4, { founderGrant: null, starter: false })), null, 'empty flags do not bind');

  /* ---------- Browsing ---------- */
  const all = await market.handle(store, BUYER, 'market-browse', {});
  assert.equal(all.total, 6); assert.deepEqual(all.listings.map(l => l.price), [150000, 250000, 400000, 700000, 1000000, 2000000], 'cheapest first');
  assert.deepEqual(all.rules.tradableRanks, [2, 3, 4]); assert.deepEqual(all.rules.minPrice, [null, null, 150000, 400000, 1000000]);
  assert.equal((await market.handle(store, BUYER, 'market-browse', { rank: 4 })).total, 2);
  assert.equal((await market.handle(store, BUYER, 'market-browse', { rank: 0 })).total, 6, 'a Genin filter is ignored (no Genin trade)');
  assert.equal((await market.handle(store, BUYER, 'market-browse', { search: 's-jonin' })).total, 2, 'search matches the hero name');
  assert.deepEqual(all.listings.find(l => l.id === listed.id).hero.perks, legendBefore.perks, 'buyers see the server-owned perks');

  /* ---------- Buying ---------- */
  await rejects(market.buy(store, SELLER, 'req-self', { listingId: listed.id, expectedPrice: 1000000 }, prepare), /your own listing/);
  await rejects(market.buy(store, BUYER, 'req-stale', { listingId: listed.id, expectedPrice: 900000 }, prepare), /price changed/, 'a manipulated price is refused');
  const row = await market.buy(store, BUYER, 'req-1', { listingId: listed.id, expectedPrice: 1000000 }, prepare);
  const q = row.quote;
  assert.deepEqual([q.total, q.studioFee, q.treasury, q.operations, q.seller, q.burn], [1000000, 0, 0, 200000, 800000, 0], 'split: 80% seller, 20% back to the reward pool, no studio/treasury share, no burn');
  assert.equal(q.settlement, 'internal'); assert.equal(tx.length, 0, 'a Market sale sends nothing on-chain'); assert(row.signature.startsWith('market:'), 'internal settlement id');
  assert.equal(await balance(BUYER), 4000000, 'the buyer pays the listed price');
  await rejects(market.buy(store, OTHER, 'req-2', { listingId: listed.id, expectedPrice: 1000000 }, prepare), /no longer for sale/, 'a second buyer cannot buy it');
  await rejects(market.handle(store, SELLER, 'market-cancel', { listingId: listed.id }), /paying for this hero/, 'a pending sale cannot be cancelled');
  assert.equal((await market.buy(store, BUYER, 'req-1', { listingId: listed.id, expectedPrice: 1000000 }, prepare)).request_id, row.request_id, 'replaying the same request returns the same order');
  await store.settlePurchase(BUYER, 'req-1', 'refunded');
  assert.equal(await balance(BUYER), 5000000, 'a refunded transfer restores the buyer');
  await store.settlePurchase(BUYER, 'req-1', 'refunded');
  assert.equal(await balance(BUYER), 5000000, 'a duplicate settlement callback changes nothing');
  const adventureBefore = Number((await require('../app/server/sr-revenue.cjs').income(store, store.pool)).n);
  await market.buy(store, BUYER, 'req-3', { listingId: listed.id, expectedPrice: 1000000 }, prepare);
  await store.settlePurchase(BUYER, 'req-3', 'confirmed'); await store.settlePurchase(BUYER, 'req-3', 'confirmed');
  const bought = (await profile(BUYER)).heroes.filter(h => h.tokenId === 's-legend');
  assert.equal(bought.length, 1, 'the hero transfers exactly once');
  for (const key of ['rank', 'level', 'perks', 'look', 'bonus', 'baseStats', 'name']) assert.deepEqual(bought[0][key], legendBefore[key], 'the buyer receives the same hero: ' + key);
  assert.equal(await balance(SELLER), 800000, 'the seller is credited 80% once');
  assert.equal(Number((await require('../app/server/sr-revenue.cjs').income(store, store.pool)).n), adventureBefore + 200000, 'the 20% Market share funds the Adventure reward pool');
  const mine = await market.handle(store, SELLER, 'market-mine', {});
  assert.equal(mine.sales.length, 1); assert.equal(mine.sales[0].payout, 800000);
  assert.equal((await market.handle(store, BUYER, 'market-mine', {})).bought.length, 1, 'purchase history');

  /* ---------- Offers ---------- */
  await rejects(offer(BUYER, jonin.id, 149999), /from 150,000 up to 249,999/, 'an offer below the rank minimum is refused');
  await rejects(offer(BUYER, jonin.id, 250000), /buy now/, 'an offer at the price is a purchase');
  await rejects(offer(SELLER, jonin.id, 200000), /your own listing/, 'no offers on your own listing');
  await rejects(offer(BUYER, jonin.id, 200000.5), /from 150,000/, 'whole numbers only');
  await rejects(offer('poor-wallet', jonin.id, 200000), /Not enough Ryo/, 'an offer needs the balance');
  const joninTwo = all.listings.find(l => l.price === 150000);
  await rejects(offer(BUYER, joninTwo.id, 150000), /takes no offers/, 'a listing at its minimum takes no offers');
  const made = await offer(BUYER, jonin.id, 180000);
  assert.equal(made.offer.minPrice, 150000, 'the offer records its minimum');
  assert.equal(await balance(BUYER), 3820000, 'the offer is held from the balance');
  await offer(BUYER, jonin.id, 180000);
  assert.equal(await balance(BUYER), 3820000, 'submitting the same offer twice holds it once');
  await offer(BUYER, jonin.id, 200000);
  assert.equal(await balance(BUYER), 3800000, 'changing an offer holds only the new amount');
  await offer(OTHER, jonin.id, 190000);
  let seen = await market.handle(store, SELLER, 'market-mine', {});
  assert.deepEqual(seen.listings.find(l => l.id === jonin.id).offers.map(o => o.amount), [200000, 190000], 'the seller sees offers, highest first');
  assert.equal((await market.handle(store, BUYER, 'market-mine', {})).held, 200000, 'the buyer sees the held Ryo');
  const notes = await market.handle(store, SELLER, 'market-notices', { since: clock - 1000 });
  assert.equal(notes.received.length, 2, 'the seller is notified of new offers');
  let [high, low] = seen.listings.find(l => l.id === jonin.id).offers;
  await rejects(market.handle(store, BUYER, 'market-offer-decline', { offerId: high.id }), /not available/, 'only the seller declines');
  await market.handle(store, SELLER, 'market-offer-decline', { offerId: low.id });
  assert.equal(await balance(OTHER), 5000000, 'a declined offer is returned');
  await rejects(market.handle(store, SELLER, 'market-offer-decline', { offerId: low.id }), /already closed/, 'declining twice changes nothing');
  assert.equal(await balance(OTHER), 5000000);
  // Accept, transfer refunded: the held Ryo comes back once, the offer is failed, the hero is on sale again.
  await market.accept(store, SELLER, 'acc-1', { offerId: high.id }, prepare);
  { const aq = (await store.pool.query('SELECT quote FROM ryo_purchases WHERE scope=$1 AND request_id=$2', [store.scope, 'acc-1'])).rows[0].quote; assert.deepEqual([aq.total, aq.seller, aq.studioFee, aq.treasury, aq.operations], [200000, 160000, 0, 0, 40000], 'sold at the offered price, same 80/20 split'); }
  assert.equal(await balance(BUYER), 3800000, 'accepting does not charge the buyer twice');
  await rejects(market.handle(store, BUYER, 'market-offer-cancel', { offerId: high.id }), /already closed/, 'an accepted offer can no longer be cancelled');
  await rejects(market.accept(store, SELLER, 'acc-1b', { offerId: high.id }, prepare), /no longer open/, 'an offer is accepted only once');
  await store.settlePurchase(BUYER, 'acc-1', 'refunded'); await store.settlePurchase(BUYER, 'acc-1', 'refunded');
  assert.equal(await balance(BUYER), 4000000, 'a failed transfer returns the held Ryo exactly once');
  assert.equal((await market.handle(store, BUYER, 'market-mine', {})).offers.find(o => o.id === high.id).status, 'failed');
  assert.equal((await market.handle(store, OTHER, 'market-browse', { rank: 2 })).total, 2, 'and relists the hero');
  // Accept and confirm: the buyer gets the hero, the seller 80% of the offer, the other offers return.
  await offer(BUYER, jonin.id, 210000); await offer(OTHER, jonin.id, 160000);
  const sellerBefore = await balance(SELLER), best = (await market.handle(store, SELLER, 'market-mine', {})).listings.find(l => l.id === jonin.id).offers[0];
  await market.accept(store, SELLER, 'acc-2', { offerId: best.id }, prepare);
  await rejects(market.buy(store, OTHER, 'req-race', { listingId: jonin.id, expectedPrice: 250000 }, prepare), /no longer for sale/, 'Buy Now cannot race an accepted offer');
  await store.settlePurchase(BUYER, 'acc-2', 'confirmed');
  assert.equal((await profile(BUYER)).heroes.filter(h => h.tokenId === 's-jonin').length, 1, 'the buyer receives the hero once');
  assert.equal(await balance(SELLER) - sellerBefore, 168000, 'the seller receives 80% of the offer');
  assert.equal(await balance(BUYER), 3790000); assert.equal(await balance(OTHER), 5000000, 'the other offer is returned when the hero sells');
  const buyerNotes = await market.handle(store, BUYER, 'market-notices', { since: clock - 1000 });
  assert(buyerNotes.made.some(o => o.status === 'completed' && o.amount === 210000), 'the buyer is notified of the completed purchase');
  // An admin minimum raised after an offer was made: the recorded minimum still applies to that offer.
  const elite = (await market.handle(store, BUYER, 'market-browse', { rank: 3 })).listings.find(l => l.price === 700000);
  const eliteOffer = (await offer(BUYER, elite.id, 450000)).offer;
  await setPrices({ jonin: 200000, elite: 500000, legend: null });
  assert.deepEqual(await market.minPrices(store), [null, null, 200000, 500000, 1000000], 'admin prices persist; null keeps the default');
  await rejects(offer(OTHER, elite.id, 450000), /from 500,000/, 'new offers use the new minimum');
  await setup(SELLER, await balance(SELLER), [...(await profile(SELLER)).heroes, hero('s-elite3', 3)]);
  await rejects(post(SELLER, 's-elite3', 450000), /from 500,000/, 'new listings use the new minimum');
  const sellerMid = await balance(SELLER);
  await market.accept(store, SELLER, 'acc-3', { offerId: eliteOffer.id }, prepare);
  await store.settlePurchase(BUYER, 'acc-3', 'confirmed');
  assert.equal(await balance(SELLER) - sellerMid, 360000, 'an offer keeps the rules it was made under');
  await setPrices(null);
  // Cancel a listing with offers, and offer expiry.
  const eliteB = (await market.handle(store, BUYER, 'market-browse', { rank: 3 })).listings.find(l => l.price === 400000);
  const legend2 = (await market.handle(store, BUYER, 'market-browse', { rank: 4 })).listings[0];
  await offer(OTHER, legend2.id, 1500000); assert.equal(await balance(OTHER), 3500000);
  await market.handle(store, SELLER, 'market-cancel', { listingId: legend2.id });
  assert.equal(await balance(OTHER), 5000000, 'a cancelled listing returns its offers');
  assert(await has(SELLER, 's-legend2'), 'and its hero');
  const eliteListing = (await post(SELLER, 's-legend2', 3000000)).listing;
  await offer(OTHER, eliteListing.id, 1200000); assert.equal(await balance(OTHER), 3800000);
  clock += market.OFFER_MS + 1;
  await rejects(market.accept(store, SELLER, 'acc-4', { offerId: (await market.handle(store, OTHER, 'market-browse', { rank: 4 })).listings[0].myOffer?.id || 'x'.repeat(36) }, prepare), /no longer open|Choose a Market offer|not available/, 'an expired offer cannot be accepted');

  /* ---------- Background sweeper: expiry for everyone, idempotent ---------- */
  const first = await market.sweepAll(store);
  assert(first.wallets >= 1, 'the sweeper processes due wallets');
  assert.equal(await balance(OTHER), 5000000, 'an expired offer is refunded without the buyer logging in');
  const again = await market.sweepAll(store);
  assert.equal(again.wallets + again.retired + again.refunded, 0, 'a second sweep (another server) changes nothing');
  assert.equal(await balance(OTHER), 5000000);
  clock += market.DURATION_MS;
  await market.sweepAll(store);
  assert(await has(SELLER, 's-legend2') && await has(SELLER, 's-elite2') === false, 'an expired listing returns its hero to the seller');
  assert((await market.handle(store, SELLER, 'market-mine', {})).returned.some(r => r.closeReason === 'expired'), 'returned listings are in history');
  assert.equal(market.startSweeper(store, { MARKET_SWEEPER: 'off', RENDER: 'true' }), null, 'MARKET_SWEEPER=off disables the job');
  assert.equal(market.startSweeper(store, {}), null, 'no background job outside the hosted game server');
  assert.equal(market.marketOpen({ MARKETPLACE_ENABLED: 'off' }), false, 'Market switched off: the background job does nothing (no returns, refunds or binding)');
  assert.equal(market.marketOpen({ MARKETPLACE_ENABLED: 'on' }), true, 'Market switched on: the background job runs');

  /* ---------- Listings and offers made before the new rules (min_price NULL) are retired safely ---------- */
  await setup(SELLER, 0, [hero('l-a', 0), hero('l-b', 0), hero('l-c', 0)]);
  await setup(BUYER, 1_000_000, [hero('b-1', 0), hero('b-2', 0)]);
  const legacy = async (id, h, price) => { await store.pool.query('INSERT INTO ryo_market_listings(scope,id,seller,hero,name,rank,perks,price,created,expires) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [store.scope, id, SELLER, JSON.stringify(h), h.name, h.rank, '[]', price, clock, clock + market.DURATION_MS]); return id; };
  const legacyOffer = async (id, listingId, amount) => { await store.pool.query("UPDATE ryo_accounts SET balance=balance-$3 WHERE scope=$1 AND wallet=$2", [store.scope, BUYER, amount]); await store.pool.query("INSERT INTO ryo_market_offers(scope,id,listing_id,buyer,seller,amount,created,expires,funding) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'balance')", [store.scope, id, listingId, BUYER, SELLER, amount, clock, clock + market.OFFER_MS]); };
  const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  await legacy(uid(1), hero('old-genin', 0), 20000); await legacyOffer(uid(11), uid(1), 15000);
  await legacy(uid(2), hero('old-jonin-low', 2), 90000); await legacyOffer(uid(12), uid(2), 85000);
  await legacy(uid(3), hero('old-elite-ok', 3), 900000); await legacyOffer(uid(13), uid(3), 300000); await legacyOffer(uid(14), uid(3), 450000);
  await legacy(uid(4), hero('old-founder', 4, { founderGrant: 'gold' }), 3000000);
  assert.equal(await balance(BUYER), 150000, 'legacy offers hold 850,000');
  assert.equal((await market.handle(store, BUYER, 'market-browse', {})).listings.some(l => [uid(1), uid(2)].includes(l.id)), false, 'below-minimum legacy listings are off the Market at once');
  await rejects(market.buy(store, BUYER, 'req-old', { listingId: uid(2), expectedPrice: 90000 }, prepare), /no longer for sale/, 'and cannot be bought');
  await rejects(market.buy(store, BUYER, 'req-old2', { listingId: uid(4), expectedPrice: 3000000 }, prepare), /can no longer be traded/, 'a bound legacy hero cannot be bought');
  const retired = await market.sweepAll(store);
  assert.equal(retired.retired, 3, 'Genin, under-minimum Jonin and bound Legend listings are retired');
  for (const id of ['old-genin', 'old-jonin-low', 'old-founder']) assert(await has(SELLER, id), 'retired hero returned: ' + id);
  assert(!await has(SELLER, 'old-elite-ok'), 'a compliant legacy listing stays on sale');
  assert.equal(await balance(BUYER), 1_000_000 - 450000, 'offers on retired listings and below-minimum legacy offers are refunded; a valid one stays held');
  const kept = (await store.pool.query('SELECT id,status,min_price FROM ryo_market_offers WHERE scope=$1 AND listing_id=$2 ORDER BY amount', [store.scope, uid(3)])).rows;
  assert.deepEqual(kept.map(o => [o.status, o.min_price == null ? null : Number(o.min_price)]), [['closed', null], ['active', 400000]], 'below-minimum legacy offer closed, valid one stamped');
  assert.equal(Number((await store.pool.query('SELECT min_price FROM ryo_market_listings WHERE scope=$1 AND id=$2', [store.scope, uid(3)])).rows[0].min_price), 400000, 'a compliant legacy listing is stamped with today\'s minimum');
  const twice = await market.sweepAll(store);
  assert.equal(twice.retired + twice.refunded + twice.stamped, 0, 'retirement runs once');
  assert.equal(await balance(BUYER), 550000, 'and never refunds twice');
  assert((await market.handle(store, SELLER, 'market-notices', { since: clock - 1000 })).returned.filter(r => r.reason === 'rules').length === 3, 'sellers are notified of returned listings');

  /* ---------- A sale saved but not yet confirmed (the server stopped) is confirmed by the next sweep, once ---------- */
  await setup(SELLER, 0, [hero('i-a', 2), hero('i-b', 0), hero('i-c', 0)]);
  await setup(BUYER, 1_000_000, [hero('b-1', 0), hero('b-2', 0)]);
  const il = (await post(SELLER, 'i-a', 150000)).listing;
  const ir = await market.buy(store, BUYER, 'int-1', { listingId: il.id, expectedPrice: 150000 }, prepare);
  assert.equal(ir.status, 'pending'); assert.equal(await balance(BUYER), 850000);
  await market.sweepAll(store); await market.sweepAll(store);   // the background sweep (and any recovery through progress) confirms it
  assert.equal((await profile(BUYER)).heroes.filter(h => h.tokenId === 'i-a').length, 1, 'the buyer receives the hero once');
  assert.equal(await balance(SELLER), 120000, 'the seller is paid 80% once');
  assert.equal(await market.confirmInternal(store), 0, 'nothing left to confirm');

  /* ---------- Heroes fused from bound heroes before this update are bound once ---------- */
  const W2 = 'fuser-wallet', purchase = (id, product, params, result, profileAfter) => store.pool.query(`INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created,settled_at)
    VALUES($1,$2,$3,$4,$5,'{}',$6,$7,1,$3,'',0,'confirmed',$8,$8)`, [store.scope, W2, id, product, JSON.stringify(params), JSON.stringify(result), JSON.stringify(profileAfter), clock++]);
  await purchase('snap', 'summon', {}, { outputs: [] }, { heroes: [hero('fg-1', 2, { founderGrant: 'gold' }), hero('pl-1', 2), hero('pl-2', 2)] });   // the only record of the Founder flag
  await purchase('fuse-1', 'fusion', { heroIds: ['fg-1', 'pl-1', 'pl-2', 'pl-3', 'pl-4', 'pl-5'] }, { outputs: [hero('fz-1', 3), hero('fz-ok', 3)] }, {});
  await purchase('fuse-2', 'fusion', { heroIds: ['fz-1', 'el-1', 'el-2'] }, { outputs: [hero('fz-2', 4)] }, {});
  await setup(W2, 0, [hero('fz-1', 3), hero('fz-ok', 3), hero('x-1', 0), hero('x-2', 0)]);
  await store.pool.query('INSERT INTO ryo_market_listings(scope,id,seller,hero,name,rank,perks,price,created,expires,min_price) VALUES($1,$2,$3,$4,$5,4,$6,2000000,$7,$8,1000000)', [store.scope, uid(50), W2, JSON.stringify(hero('fz-2', 4)), 'Hero fz-2', '[]', clock, clock + market.DURATION_MS]);
  // The earlier background sweeps already ran the one-time step (nothing to bind then): run it again on a fresh server.
  await store.pool.query('DELETE FROM ryo_market_migrations WHERE scope=$1', [store.scope]);
  const fresh = new Store(pool, 'test-market', () => clock), bindRun = await market.bindFusedOnce(fresh);
  assert.deepEqual([bindRun.heroes, bindRun.returned], [1, 1], 'one fused hero bound in a profile, one listed fused hero returned');
  const w2 = (await profile(W2)).heroes;
  assert.equal(w2.find(h => h.tokenId === 'fz-1').marketBound, true, 'fused from a Founder hero: bound');
  assert.equal(w2.find(h => h.tokenId === 'fz-2').marketBound, true, 'fused from a bound fused hero: bound and back from the Market');
  assert.notEqual(w2.find(h => h.tokenId === 'fz-ok').marketBound, true, 'a group without bound heroes stays tradable');
  await rejects(market.handle(store, W2, 'market-post', { heroId: 'fz-1', price: 500000 }), /bound to your account/, 'a newly bound hero cannot be listed');
  assert.equal(await market.bindFusedOnce(new Store(pool, 'test-market', () => clock)), null, 'the binding runs once (marker), on any server');

  /* ---------- Admin: validated, audited proposals ---------- */
  assert.deepEqual(validate('marketPrices', { jonin: 150000, elite: null, legend: 2000000 }, clock), { marketPrices: { jonin: 150000, elite: null, legend: 2000000 } });
  assert.throws(() => validate('marketPrices', { jonin: 0 }, clock), /whole number from 1/);
  assert.throws(() => validate('marketPrices', { genin: 1000 }, clock), /only jonin, elite and legend/);
  assert.throws(() => validate('marketPrices', { legend: 100000001 }, clock), /whole number/);
  await store.pool.query("UPDATE ryo_admin_control SET config=$2 WHERE scope=$1", [store.scope, JSON.stringify({ marketPrices: { jonin: 'bad' } })]);
  assert.deepEqual(await market.minPrices(store), [null, null, 150000, 400000, 1000000], 'an invalid saved value falls back to the defaults');
  await setPrices(null);

  /* ---------- The purchases pause ---------- */
  await store.pool.query("UPDATE ryo_admin_control SET pauses=$2 WHERE scope=$1", [store.scope, JSON.stringify({ purchases: true })]);
  await rejects(guard(store, 'market-buy', BUYER, { requestId: 'req-new' }), /paused/, 'pausing purchases pauses Market buys');
  await rejects(guard(store, 'market-post', SELLER, {}), /paused/, 'and new listings');
  await rejects(guard(store, 'market-offer', BUYER, {}), /paused/); await rejects(guard(store, 'market-accept', SELLER, { requestId: 'x' }), /paused/);
  await guard(store, 'market-browse', BUYER, {}); await guard(store, 'market-notices', BUYER, {});
  assert.deepEqual(market.rules().shares, { seller: 80, studio: 0, treasury: 0, pool: 20 });
  await db.close();
  console.log('PASS: Market Jonin/Elite/Legend only with 150k/400k/1M minimums (admin-configurable, recorded per listing and offer), Genin/Chunin/Mythic/NFT and every account-bound flag refused, escrow, browsing, buy reserve/refund/confirm once with the identical hero, unchanged 80/10/8/2 split, offers (held once, change, decline, accept at the offered price, refund once, expiry, close on sale or cancel), background sweeper (expiry for everyone, retirement of pre-rule listings/offers with heroes returned and offers refunded, idempotent), notices and the purchases pause.');
})().catch(error => { console.error(error); process.exitCode = 1; });
