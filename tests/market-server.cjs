/* Player Market server rules on the real store (in-memory Postgres): listing escrow, price rules,
 * cancel/expiry returning the hero intact, buying through the purchase flow (reserve, confirm,
 * refund), the 80/10/8/2 split, reward pool income and the purchases pause. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../app/server');
const economy = require(path.join(root, 'economy.cjs')), { Store } = require(path.join(root, 'store.cjs')), market = require(path.join(root, 'market.cjs'));
const { guard } = require(path.join(root, 'economic-dashboard.cjs'));

const SELLER = 'seller-wallet', BUYER = 'buyer-wallet', OTHER = 'other-wallet';
const hero = (id, rank, extra = {}) => ({ tokenId: id, rank, level: 1, name: 'Hero ' + id, baseStats: { pw: 3 + rank * 3, sp: 3 + rank * 3, st: 3 + rank * 3 }, ...extra });
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

  await setup(SELLER, 0, [hero('s-genin', 0), hero('s-jonin', 2, { level: 3 }), hero('s-legend', 4), hero('s-chunin', 1)]);
  await setup(BUYER, 2_000_000, [hero('b-1', 0), hero('b-2', 0)]);
  await setup(OTHER, 2_000_000, [hero('o-1', 0), hero('o-2', 0)]);
  const legendBefore = (await profile(SELLER)).heroes.find(h => h.tokenId === 's-legend');

  // Price rules: rank minimum, maximum, ownership and the two-hero floor.
  await rejects(post(SELLER, 's-genin', 9999), /from 10,000/, 'Genin minimum is 10,000');
  await rejects(post(SELLER, 's-legend', 499999), /from 500,000/, 'Legend minimum is 500,000');
  await rejects(post(SELLER, 's-genin', 100000001), /100,000,000/, 'maximum 100,000,000');
  await rejects(post(SELLER, 'b-1', 50000), /token collection/, 'only your own heroes');
  const listed = (await post(SELLER, 's-legend', 1000000)).listing;
  assert.equal(listed.price, 1000000); assert.equal(listed.payout, 800000, 'the seller is shown an 80% payout');
  let seller = await profile(SELLER);
  assert(!seller.heroes.some(h => h.tokenId === 's-legend'), 'a listed hero leaves the collection (escrow)');
  assert(!seller.battleReady.includes('s-legend'), 'and the battle-ready roster');
  await post(SELLER, 's-jonin', 80000);
  await rejects(post(SELLER, 's-genin', 10000), /at least two heroes/, 'sellers keep at least two heroes');

  // Browsing: rank, perks (has all), name search, sort, and own listings marked.
  const all = await market.handle(store, BUYER, 'market-browse', {});
  assert.equal(all.total, 2); assert.deepEqual(all.listings.map(l => l.price), [80000, 1000000], 'cheapest first by default');
  assert.deepEqual((await market.handle(store, BUYER, 'market-browse', { sort: 'price-desc' })).listings.map(l => l.price), [1000000, 80000]);
  assert.equal((await market.handle(store, BUYER, 'market-browse', { rank: 4 })).total, 1);
  assert.equal((await market.handle(store, BUYER, 'market-browse', { perks: legendBefore.perks })).listings[0].hero.name, 'Hero s-legend', 'the perks filter finds heroes with every chosen perk');
  const missing = [0, 1, 2, 3, 4, 5, 6].find(k => !legendBefore.perks.includes(k) && !(seller.heroes.concat([]).length && false));
  if (missing !== undefined) assert.equal((await market.handle(store, BUYER, 'market-browse', { rank: 4, perks: [missing] })).total, 0, 'a perk the hero lacks filters it out');
  assert.equal((await market.handle(store, BUYER, 'market-browse', { search: 'jonin' })).total, 1, 'search matches the hero name');
  assert.equal((await market.handle(store, SELLER, 'market-browse', {})).listings.every(l => l.mine), true);
  assert.deepEqual(all.listings[1].hero.perks, legendBefore.perks, 'buyers see the server-owned perks');

  // Buying: own listing, stale price, then a reserve that blocks a second buyer.
  await rejects(market.buy(store, SELLER, 'req-self', { listingId: listed.id, expectedPrice: 1000000 }, prepare), /your own listing/);
  await rejects(market.buy(store, BUYER, 'req-stale', { listingId: listed.id, expectedPrice: 900000 }, prepare), /price changed/);
  const row = await market.buy(store, BUYER, 'req-1', { listingId: listed.id, expectedPrice: 1000000 }, prepare);
  const q = tx.at(-1);
  assert.deepEqual([q.total, q.studioFee, q.treasury, q.operations, q.seller, q.burn], [1000000, 20000, 80000, 100000, 800000, 0], 'split: 2% studio, 8% treasury, 10% pool, 80% seller, no burn');
  assert.equal(await balance(BUYER), 1000000, 'the buyer pays the listed price');
  assert.equal((await market.handle(store, OTHER, 'market-browse', {})).total, 1, 'a pending sale is off the Market');
  await rejects(market.buy(store, OTHER, 'req-2', { listingId: listed.id, expectedPrice: 1000000 }, prepare), /no longer for sale/, 'a second buyer cannot buy it');
  await rejects(market.handle(store, SELLER, 'market-cancel', { listingId: listed.id }), /paying for this hero/, 'a pending sale cannot be cancelled');
  assert.equal((await market.buy(store, BUYER, 'req-1', { listingId: listed.id, expectedPrice: 1000000 }, prepare)).request_id, row.request_id, 'replaying the same request returns the same order');

  // Refunded transfer: the buyer is restored and the hero is back on sale.
  await store.settlePurchase(BUYER, 'req-1', 'refunded');
  assert.equal(await balance(BUYER), 2000000);
  assert.equal((await market.handle(store, OTHER, 'market-browse', {})).total, 2, 'a refunded sale returns to the Market');

  // Confirmed: the buyer owns the identical hero, the seller receives 80%, the pool gains 10%.
  const poolBefore = Number((await store.pool.query("SELECT COALESCE(SUM((quote->>'operations')::numeric),0) AS n FROM ryo_purchases WHERE scope=$1 AND status='confirmed'", [store.scope])).rows[0].n);
  await market.buy(store, BUYER, 'req-3', { listingId: listed.id, expectedPrice: 1000000 }, prepare);
  await store.settlePurchase(BUYER, 'req-3', 'confirmed');
  const bought = (await profile(BUYER)).heroes.find(h => h.tokenId === 's-legend');
  for (const key of ['rank', 'level', 'perks', 'look', 'bonus', 'baseStats', 'name']) assert.deepEqual(bought[key], legendBefore[key], 'the buyer receives the same hero: ' + key);
  assert.equal(await balance(SELLER), 800000, 'the seller is credited 80%');
  const poolAfter = Number((await store.pool.query("SELECT COALESCE(SUM((quote->>'operations')::numeric),0) AS n FROM ryo_purchases WHERE scope=$1 AND status='confirmed'", [store.scope])).rows[0].n);
  assert.equal(poolAfter - poolBefore, 100000, 'the reward pool income grows by 10%');
  const mine = await market.handle(store, SELLER, 'market-mine', {});
  assert.equal(mine.sales.length, 1); assert.equal(mine.sales[0].payout, 800000); assert.equal(mine.listings.length, 1);
  assert.equal((await market.handle(store, BUYER, 'market-mine', {})).bought.length, 1);

  // Cancel returns the hero; an expired listing returns on the seller's next visit.
  const jonin = mine.listings[0];
  await market.handle(store, SELLER, 'market-cancel', { listingId: jonin.id });
  assert((await profile(SELLER)).heroes.some(h => h.tokenId === 's-jonin' && h.level === 3), 'a cancelled hero returns intact');
  const relisted = (await post(SELLER, 's-jonin', 90000)).listing;
  clock += market.DURATION_MS + 1;
  assert.equal((await market.handle(store, BUYER, 'market-browse', {})).total, 0, 'expired listings leave the Market');
  await rejects(market.buy(store, BUYER, 'req-4', { listingId: relisted.id, expectedPrice: 90000 }, prepare), /no longer for sale/);
  await market.sweep(store, SELLER);
  assert((await profile(SELLER)).heroes.some(h => h.tokenId === 's-jonin'), 'an expired hero returns to the seller');

  // The listing cap and the purchases pause.
  await store.pool.query("INSERT INTO ryo_admin_control(scope,version,config,pauses,installed) VALUES($1,1,'{}',$2,$3)", [store.scope, JSON.stringify({ purchases: true }), clock]);
  await rejects(guard(store, 'market-buy', BUYER, { requestId: 'req-new' }), /paused/, 'pausing purchases pauses Market buys');
  await rejects(guard(store, 'market-post', SELLER, {}), /paused/, 'and new listings');
  await guard(store, 'market-browse', BUYER, {});
  assert.deepEqual(market.rules().shares, { seller: 80, studio: 2, treasury: 8, pool: 10 });
  assert.deepEqual(market.MIN_PRICE, [10000, 25000, 80000, 200000, 500000]);
  await db.close();
  console.log('PASS: Market escrow, rank minimums and maximum, perks/rank/search/sort browsing, buy reserve/refund/confirm with the identical hero, 80/10/8/2 split with reward pool income, cancel and expiry returns, and the purchases pause.');
})().catch(error => { console.error(error); process.exitCode = 1; });
