/* In-memory Market for browser fixtures (tests/harness.cjs). Uses the real market module's price
 * rules, split and stats so the UI is exercised against the same numbers as the server. Listings
 * from other sellers are seeded by tests in f.market.listings ({ id, seller, hero, price }) and
 * offers on the player's own listings in f.market.offers ({ id, listingId, buyer, amount }). */
const crypto = require('node:crypto');
const market = require('../app/server/market.cjs'), economy = require('../app/server/economy.cjs');
const { trainedStats } = require('../app/server/gameplay-options.cjs');

const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const short = w => w.slice(0, 4) + '…' + w.slice(-4);
const view = (l, account, now) => ({ id: l.id, price: l.price, status: l.status, created: l.created, expires: l.expires, left: Math.max(0, l.expires - now), seller: short(l.seller),
  mine: l.seller === account, payout: market.split(l.price).seller, hero: { name: l.hero.name, rank: l.hero.rank, level: l.hero.level, perks: l.hero.perks, look: l.hero.look, bonus: l.hero.bonus, baseStats: l.hero.baseStats, stats: trainedStats(l.hero) } });
const offerView = (o, now) => ({ id: o.id, listingId: o.listingId, amount: o.amount, status: o.status, created: o.created, left: Math.max(0, o.expires - now), buyer: short(o.buyer), payout: market.split(o.amount).seller });

async function handle(f, req, account, snapshot) {
  const now = Date.now(), m = f.market = f.market || { listings: [] }; m.offers = m.offers || [];
  for (const l of m.listings) { l.status = l.status || 'active'; l.created = l.created || now; l.expires = l.expires || now + market.DURATION_MS; l.hero = economy.normalizeProfile({ heroes: [l.hero] }).heroes[0]; }
  for (const o of m.offers) { o.status = o.status || 'active'; o.created = o.created || now; o.expires = o.expires || now + market.OFFER_MS; }
  const profile = () => (f.profile = economy.normalizeProfile(f.profile));
  const listing = id => m.listings.find(l => l.id === id);
  const closeOffers = (id, keep) => { for (const o of m.offers.filter(o => o.listingId === id && o.status === 'active' && o !== keep)) { o.status = 'closed'; if (o.buyer === account) f.balance += o.amount; } };
  const sell = (l, price, buyer, offerId) => {
    l.status = 'sold'; l.price = price; closeOffers(l.id);
    const purchase = { request_id: crypto.randomUUID(), amount: String(price), status: 'confirmed', acknowledged: false, created: String(now), signature: 'M'.repeat(80),
      quote: { product: 'market', params: { listingId: l.id, ...(offerId ? { offerId } : {}) }, title: 'Market · ' + l.hero.name, base: price, total: price, ...market.split(price) }, result: { product: 'market', title: 'Market · ' + l.hero.name, outputs: [l.hero], consumed: [] } };
    if (buyer === account) { profile().heroes.push(l.hero); f.purchases = [purchase, ...f.purchases]; }
    if (l.seller === account) f.balance += market.split(price).seller;
    return purchase;
  };
  if (req.action === 'market-browse') {
    let rows = m.listings.filter(l => l.status === 'active' && l.expires > now);
    if (Number.isInteger(req.rank) && req.rank >= 0) rows = rows.filter(l => l.hero.rank === req.rank);
    if (req.perks?.length) rows = rows.filter(l => req.perks.every(k => l.hero.perks.includes(k)));
    if (req.search) rows = rows.filter(l => l.hero.name.toLowerCase().includes(req.search.toLowerCase()));
    rows.sort(req.sort === 'price-desc' ? (a, b) => b.price - a.price : req.sort === 'newest' ? (a, b) => b.created - a.created : (a, b) => a.price - b.price);
    const page = req.page || 0;
    return { listings: rows.slice(page * 10, page * 10 + 10).map(l => { const o = m.offers.find(o => o.listingId === l.id && o.buyer === account && o.status === 'active'); return { ...view(l, account, now), myOffer: o ? offerView(o, now) : null }; }),
      total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / 10)), rules: market.rules() };
  }
  if (req.action === 'market-mine') {
    const own = m.listings.filter(l => l.seller === account), made = m.offers.filter(o => o.buyer === account);
    return { listings: own.filter(l => ['active', 'pending'].includes(l.status)).map(l => ({ ...view(l, account, now), offers: m.offers.filter(o => o.listingId === l.id && o.status === 'active').sort((a, b) => b.amount - a.amount).map(o => offerView(o, now)) })),
      sales: own.filter(l => l.status === 'sold').map(l => view(l, account, now)), bought: [], offers: made.map(o => ({ ...offerView(o, now), listing: view(listing(o.listingId), account, now) })),
      held: made.filter(o => o.status === 'active').reduce((n, o) => n + o.amount, 0), rules: market.rules() };
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
    l.status = 'cancelled'; closeOffers(l.id); profile().heroes.push(l.hero); return { cancelled: l.id, ...snapshot() };
  }
  if (req.action === 'market-offer') {
    const l = listing(req.listingId); if (!l || l.status !== 'active') fail('This hero is no longer for sale.', 409);
    const min = market.MIN_PRICE[l.hero.rank]; if (!Number.isSafeInteger(req.amount) || req.amount < min || req.amount >= l.price) fail(`Offer from ${min.toLocaleString('en-US')} up to ${(l.price - 1).toLocaleString('en-US')} Ryo, or buy now at the listed price.`);
    const prev = m.offers.find(o => o.listingId === l.id && o.buyer === account && o.status === 'active'), held = prev ? prev.amount : 0;
    if (f.balance + held < req.amount) fail('Not enough Ryo in your balance for this offer.');
    if (prev) prev.status = 'cancelled'; f.balance += held - req.amount;
    const o = { id: crypto.randomUUID(), listingId: l.id, buyer: account, amount: req.amount, status: 'active', created: now, expires: now + market.OFFER_MS }; m.offers.push(o);
    return { offer: offerView(o, now), ...snapshot() };
  }
  if (req.action === 'market-offer-cancel' || req.action === 'market-offer-decline') {
    const o = m.offers.find(x => x.id === req.offerId && x.status === 'active'); if (!o) fail('That offer is already closed.', 409);
    o.status = req.action === 'market-offer-cancel' ? 'cancelled' : 'declined'; if (o.buyer === account) f.balance += o.amount;
    return { offerId: o.id, status: o.status, ...snapshot() };
  }
  if (req.action === 'market-accept') {
    const o = m.offers.find(x => x.id === req.offerId && x.status === 'active'), l = o && listing(o.listingId);
    if (!o || !l || l.seller !== account || l.status !== 'active') fail('That offer is no longer open.', 409);
    o.status = 'completed'; const sale = sell(l, o.amount, o.buyer, o.id);
    return { sale: { request_id: sale.request_id, status: 'confirmed' }, ...await handle(f, { action: 'market-mine' }, account, snapshot), ...snapshot() };
  }
  if (req.action === 'market-buy') {
    const l = listing(req.listingId);
    if (!l || l.status !== 'active') fail('This hero is no longer for sale.', 409);
    if (l.seller === account) fail('You cannot buy your own listing. Cancel it in My Listings instead.');
    if (l.price !== req.expectedPrice) fail('The price changed. Review the listing again before buying.', 409);
    const own = m.offers.find(o => o.listingId === l.id && o.buyer === account && o.status === 'active'), held = own ? own.amount : 0;
    if (f.balance + held < l.price) fail('Not enough Ryo in your balance for this hero.');
    if (own) own.status = 'cancelled'; f.balance -= l.price - held;
    const purchase = sell(l, l.price, account);
    return { purchase, ...snapshot() };
  }
  fail('Unknown Market action.');
}
module.exports = { handle };
