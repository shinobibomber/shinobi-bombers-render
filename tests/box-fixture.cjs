/* In-memory Limited Mythic NFT Box for browser fixtures (tests/harness.cjs). f.box: { sold, supply }.
 * box-mint returns a placeholder wire (the test's fake wallet adapter "signs" it); box-confirm grants
 * Tsukiyomi and the 10% perk like the real server's NFT check. */
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
function info(f) {
  const b = f.box, mine = b.mine, supply = b.supply ?? 20, remaining = Math.max(0, supply - (b.sold || 0) - mine.length);
  return { network: 'solana-devnet', supply, sold: (b.sold || 0) + mine.filter(m => m.status === 'confirmed').length, reserved: mine.filter(m => m.status === 'pending').length, remaining,
    perWallet: 2, owned: mine.length, price: mine.length < 2 ? (mine.length ? 1.5 : 1) : null, firstPrice: 1, secondPrice: 1.5,
    perks: ['7-star Mythic hero: Tsukiyomi', 'Mythic Aura', '10% off', 'Exclusive NFT holder tier'], mine: mine.map(m => ({ serial: m.serial, mint: m.mint, status: m.status, price: m.price })), soldOut: remaining === 0, limitReached: mine.length >= 2 };
}
function handle(f, req, snapshot) {
  f.box = f.box || {}; f.box.mine = f.box.mine || [];
  const b = f.box;
  if (req.action === 'box-info') return { box: info(f), ...snapshot() };
  if (req.action === 'box-mint') {
    const existing = b.mine.find(m => m.requestId === req.requestId);
    if (existing) return { mint: { ...existing, wire: existing.status === 'pending' ? 'FIXTURE-WIRE' : null }, box: info(f), ...snapshot() };
    if (b.mine.length >= 2) fail('Each wallet can mint up to 2 Mythic Boxes.', 409);
    if (info(f).remaining <= 0) fail('All Mythic Boxes are taken.', 409);
    const m = { requestId: req.requestId, serial: (b.sold || 0) + b.mine.length + 1, mint: 'BoxMint' + (b.mine.length + 1) + 'x'.repeat(30), price: b.mine.length ? 1.5 : 1, status: 'pending' };
    b.mine.push(m); (b.mints = b.mints || []).push(req.requestId);
    return { mint: { ...m, wire: 'FIXTURE-WIRE' }, box: info(f), ...snapshot() };
  }
  if (req.action === 'box-confirm') {
    const m = b.mine.find(x => x.requestId === req.requestId); if (!m) fail('That box mint was not found.', 404);
    if (req.signature && m.status === 'pending') {
      m.status = 'confirmed'; m.signature = req.signature;
      if (!f.profile.heroes.some(h => h.rank === 5)) f.profile.heroes.push({ tokenId: 'mythic-' + m.mint, rank: 5, level: 1, name: 'Tsukiyomi', mythic: 'tsukiyomi', stars: 7, nft: { mint: m.mint }, baseStats: { pw: 16, sp: 15, st: 17 } });
      f.profile.mythicPerk = true;
    }
    return { mint: { ...m }, box: info(f), ...snapshot() };
  }
  fail('Unknown Mythic Box action.');
}
module.exports = { handle };
