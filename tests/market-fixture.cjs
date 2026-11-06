/* In-memory Market for browser fixtures (tests/harness.cjs). Uses the real market module's price
 * rules, split and stats so the UI is exercised against the same numbers as the server. Listings
 * from other sellers are seeded by tests in f.market.listings ({ id, seller, hero, price }). */
const crypto = require('node:crypto');
const market = require('../app/server/market.cjs'), economy = require('../app/server/economy.cjs');
const { trainedStats } = require('../app/server/gameplay-options.cjs');

const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const view = (l, account, now) => ({ id: l.id, price: l.price, status: l.status, created: l.created, expires: l.expires, left: Math.max(0, l.expires - now), seller: l.seller.slice(0, 4) + '…' + l.seller.slice(-4),
  mine: l.seller === account, payout: market.split(l.price).seller, hero: { name: l.hero.name, rank: l.hero.rank, level: l.hero.level, perks: l.hero.perks, look: l.hero.look, bonus: l.hero.bonus, baseStats: l.hero.baseStats, stats: trainedStats(l.hero) } });

async function handle(f, req, account, snapshot) {
  const now = Date.now(), m = f.market = f.market || { listings: [] };
  for (const l of m.listings) { l.status = l.status || 'active'; l.created = l.created || now; l.expires = l.expires || now + market.DURATION_MS; l.hero = economy.normalizeProfile({ heroes: [l.hero] }).heroes[0]; }
  const profile = () => (f.profile = economy.normalizeProfile(f.profile));
  if (req.action === 'market-browse') {
    let rows = m.listings.filter(l => l.status === 'active' && l.expires > now);
    if (Number.isInteger(req.rank) && req.rank >= 0) rows = rows.filter(l => l.hero.rank === req.rank);
    if (req.perks?.length) rows = rows.filter(l => req.perks.every(k => l.hero.perks.includes(k)));
    if (req.search) rows = rows.filter(l => l.hero.name.toLowerCase().includes(req.search.toLowerCase()));
    rows.sort(req.sort === 'price-desc' ? (a, b) => b.price - a.price : req.sort === 'newest' ? (a, b) => b.created - a.created : (a, b) => a.price - b.price);
    const page = req.page || 0;
    return { listings: rows.slice(page * 10, page * 10 + 10).map(l => view(l, account, now)), total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / 10)), rules: market.rules() };
  }
  if (req.action === 'market-mine') {
    const own = m.listings.filter(l => l.seller === account);
    return { listings: own.filter(l => ['active', 'pending'].includes(l.status)).map(l => view(l, account, now)), sales: own.filter(l => l.status === 'sold').map(l => view(l, account, now)), bought: [], rules: market.rules() };
  }
  if (req.action === 'market-post') {
    const p = profile(), hero = p.heroes.find(h => h.tokenId === req.heroId);
    if (!hero) fail('Only heroes from your signed-in token collection can be listed.');
    if (!Number.isSafeInteger(req.price) || req.price < market.MIN_PRICE[hero.rank] || req.price > market.MAX_PRICE) fail(`Set a price from ${market.MIN_PRICE[hero.rank].toLocaleString('en-US')} to 100,000,000 Ryo for this rank.`);
    if (p.heroes.length <= 2) fail('Keep at least two heroes in your collection.');
    p.heroes = p.heroes.filter(h => h !== hero); p.battleReady = p.battleReady.filter(id => id !== hero.tokenId);
    const l = { id: crypto.randomUUID(), seller: account, hero, price: req.price, status: 'active', created: now, expires: now + market.DURATION_MS }; m.listings.push(l);
    return { listing: view(l, account, now), ...snapshot() };
  }
  if (req.action === 'market-cancel') {
    const l = m.listings.find(x => x.id === req.listingId && x.seller === account && x.status === 'active'); if (!l) fail('That listing is no longer on the Market.', 409);
    l.status = 'cancelled'; profile().heroes.push(l.hero); return { cancelled: l.id, ...snapshot() };
  }
  if (req.action === 'market-buy') {
    const l = m.listings.find(x => x.id === req.listingId);
    if (!l || l.status !== 'active') fail('This hero is no longer for sale.', 409);
    if (l.seller === account) fail('You cannot buy your own listing. Cancel it in My Listings instead.');
    if (l.price !== req.expectedPrice) fail('The price changed. Review the listing again before buying.', 409);
    if (f.balance < l.price) fail('Not enough Ryo in your balance for this hero.');
    f.balance -= l.price; l.status = 'sold'; profile().heroes.push(l.hero);
    const purchase = { request_id: req.requestId, amount: String(l.price), status: 'confirmed', acknowledged: false, created: String(now), signature: 'M'.repeat(80),
      quote: { product: 'market', params: { listingId: l.id }, title: 'Market · ' + l.hero.name, base: l.price, total: l.price, ...market.split(l.price) }, result: { product: 'market', title: 'Market · ' + l.hero.name, outputs: [l.hero], consumed: [] } };
    f.purchases = [purchase, ...f.purchases];
    return { purchase, ...snapshot() };
  }
  fail('Unknown Market action.');
}
module.exports = { handle };
