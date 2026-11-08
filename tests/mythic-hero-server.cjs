/* Tsukiyomi (Mythic, rank 5) ownership on the real store (in-memory Postgres) with a fake Solana RPC:
 * dormant until configured; one hero per box NFT held (mint list or verified collection); Mythic
 * stats 17–20 with seven perks; Legend training prices; never listed on the Market; the hero (with its
 * training) follows the NFT to the next holder and leaves the old wallet and its battle-ready team;
 * RPC failures never remove a hero; checks are cached and rate limited; a full collection waits. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../app/server');
const { Keypair, PublicKey } = require(path.resolve(root, '../node_modules/@solana/web3.js'));
const economy = require(path.join(root, 'economy.cjs')), gameplay = require(path.join(root, 'gameplay-options.cjs'));
const { Store } = require(path.join(root, 'store.cjs')), mythic = require(path.join(root, 'mythic-hero.cjs')), market = require(path.join(root, 'market.cjs'));
const META = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const key = () => Keypair.generate().publicKey.toBase58();
const hero = (id, rank, pw) => ({ tokenId: id, rank, level: 1, name: 'Hero ' + id, baseStats: { pw, sp: pw, st: pw } });

// Metaplex metadata bytes with an optional collection {verified, key}.
function metadata(mint, collection) {
  const str = s => { const b = Buffer.from(s); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b]); };
  const parts = [Buffer.from([4]), Buffer.alloc(32, 1), new PublicKey(mint).toBuffer(), str('Mythic Box'), str('SBOX'), str('https://example.invalid/box.json'), Buffer.from([0, 0]), Buffer.from([0]), Buffer.from([0, 1]), Buffer.from([1, 255]), Buffer.from([1, 0])];
  parts.push(collection ? Buffer.concat([Buffer.from([1, collection.verified ? 1 : 0]), new PublicKey(collection.key).toBuffer()]) : Buffer.from([0]));
  return Buffer.concat(parts);
}
// Fake RPC: wallets → tokens [{mint, amount, decimals}], mint → metadata.
function rpc() {
  const holdings = new Map(), metas = new Map(), calls = { owner: 0, meta: 0 }; let down = false;
  return { holdings, metas, calls, setDown: v => { down = v; },
    async getParsedTokenAccountsByOwner(owner, { programId }, commitment) {
      assert.equal(commitment, 'finalized'); calls.owner++; if (down) throw Error('RPC down');
      if (programId.toBase58() !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') return { value: [] };
      return { value: (holdings.get(owner.toBase58()) || []).map(t => ({ account: { data: { parsed: { info: { mint: t.mint, tokenAmount: { amount: String(t.amount ?? 1), decimals: t.decimals ?? 0 } } } } } })) };
    },
    async getMultipleAccountsInfo(addresses, commitment) {
      assert.equal(commitment, 'finalized'); calls.meta++; if (down) throw Error('RPC down');
      return addresses.map(a => { for (const [mint, data] of metas) { const pda = PublicKey.findProgramAddressSync([Buffer.from('metadata'), new PublicKey(META).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(META))[0]; if (pda.equals(a)) return { owner: new PublicKey(META), data }; } return null; });
    } };
}

(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  const store = new Store(pool, 'test-mythic', () => Date.now());
  const setup = (wallet, heroes) => store.transaction(async c => { await store.locked(c, wallet); await store.profileLocked(c, wallet);
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(economy.normalizeProfile({ dojo: 0, heroes, battleReady: heroes.map(h => h.tokenId) }))]); });
  const profile = w => store.profile(w);
  const mythicOf = async w => (await profile(w)).heroes.filter(h => h.rank === 5);
  const [alice, bob, carol, dave] = [key(), key(), key(), key()];
  const [m1, m2, other, coin] = [key(), key(), key(), key()];
  const conn = rpc();
  await setup(alice, [hero('a1', 2, 7), hero('a2', 1, 4)]); await setup(bob, [hero('b1', 0, 2), hero('b2', 0, 2)]);

  // Dormant without configuration: nothing is checked or granted.
  conn.holdings.set(alice, [{ mint: m1 }]);
  assert.deepEqual(await mythic.sync(store, alice, conn, { env: {} }), { enabled: false, mints: [], waiting: 0 });
  assert.equal(conn.calls.owner, 0, 'no RPC call while dormant'); assert.equal((await mythicOf(alice)).length, 0);
  assert.deepEqual(mythic.status({}), { enabled: false, mode: 'off' });
  assert.equal(mythic.config({ MYTHIC_BOX_MINTS: 'not-a-key, ' + m1 }).mints.size, 1, 'invalid addresses are ignored');

  // Mint list: one Tsukiyomi per box NFT held (other NFTs and fungible tokens do not count).
  const env = { MYTHIC_BOX_MINTS: [m1, m2].join(',') };
  conn.holdings.set(alice, [{ mint: m1 }, { mint: other }, { mint: m2, amount: 5, decimals: 0 }, { mint: coin, amount: 1, decimals: 6 }]);
  let r = await mythic.sync(store, alice, conn, { env });
  assert.deepEqual([r.enabled, r.mints], [true, [m1]], 'only the configured box NFT (amount 1, 0 decimals)');
  let [t] = await mythicOf(alice);
  assert.deepEqual([t.tokenId, t.name, t.nft.mint, t.mythic, 'stars' in t, t.level, t.perks.length], ['mythic-' + m1, 'Tsukiyomi', m1, 'tsukiyomi', false, 1, 7]);
  assert.deepEqual(t.perks.slice().sort(),[0,1,2,3,4,5,6]);
  assert(['pw', 'sp', 'st'].every(k => t.baseStats[k] >= 17 && t.baseStats[k] <= 20), 'Mythic base stats roll 17–20');
  assert.equal(gameplay.trainedStats({ rank: 5, baseStats: {}, bonus: {} }).pw, 17, 'Mythic stat band starts at 17');
  assert.equal(gameplay.trainingPrice(5, 1), gameplay.trainingPrice(4, 1), 'Mythic trains at Legend prices');
  const trained = { ...t, level: 1, bonus: { pw: 0, sp: 0, st: 0 } }; gameplay.levelUp(trained, () => 1);
  assert.deepEqual([trained.level, trained.bonus.sp], [2, 1], 'Mythic levels gain a random stat like Legend');
  assert.equal(economy.hero(5).rank, 5);
  // Cached: a second state() within a minute makes no RPC call and no change.
  const before = conn.calls.owner; await mythic.sync(store, alice, conn, { env }); assert.equal(conn.calls.owner, before, 'checks are cached');

  // Never on the Market.
  await assert.rejects(market.handle(store, alice, 'market-post', { heroId: t.tokenId, price: 5_000_000 }), /Mythic NFT heroes are traded by moving their NFT/);

  // Train it, put it in the team, then the NFT moves to bob: the hero (with its training) goes too.
  await store.transaction(async c => { await store.locked(c, alice); const p = await store.profileLocked(c, alice); const h = p.heroes.find(x => x.tokenId === t.tokenId); h.level = 3; h.bonus = { pw: 1, sp: 1, st: 0 }; p.battleReady = [t.tokenId, 'a1']; await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, alice, JSON.stringify(p)]); });
  conn.holdings.set(alice, [{ mint: other }]); conn.holdings.set(bob, [{ mint: m1 }]);
  r = await mythic.sync(store, bob, conn, { env });
  [t] = await mythicOf(bob);
  assert.deepEqual([t.tokenId, t.level, t.bonus.pw, t.bonus.sp], ['mythic-' + m1, 3, 1, 1], 'training moves with the NFT');
  const left = await profile(alice);
  assert.equal(left.heroes.filter(h => h.rank === 5).length, 0, 'the old holder loses the hero');
  assert.deepEqual(left.battleReady, ['a1'], 'and it leaves the old battle-ready team');
  assert.equal((await mythic.sync(store, alice, conn, { env, force: true })).mints.length, 0);
  assert.equal((await db.query("SELECT wallet FROM ryo_mythic_heroes WHERE mint=$1", [m1])).rows[0].wallet, bob);

  // An RPC outage never removes a hero; the next good check applies.
  conn.setDown(true);
  r = await mythic.sync(store, bob, conn, { env, force: true });
  assert.equal(r.unavailable, true); assert.equal((await mythicOf(bob)).length, 1, 'outage keeps the hero');
  conn.setDown(false);
  // The player's Check NFT button: fresh, but at most every 10 seconds.
  r = await mythic.refresh(store, bob, conn, { env });
  assert.deepEqual(r.mythic.mints, [m1]);
  await assert.rejects(mythic.refresh(store, bob, conn, { env }), e => e.status === 429);

  // Verified collection: any NFT of the collection counts; unverified or other collections do not.
  const collection = key(), [x1, x2, x3] = [key(), key(), key()];
  conn.metas.set(x1, metadata(x1, { verified: true, key: collection }));
  conn.metas.set(x2, metadata(x2, { verified: false, key: collection }));
  conn.metas.set(x3, metadata(x3, { verified: true, key: key() }));
  conn.holdings.set(carol, [{ mint: x1 }, { mint: x2 }, { mint: x3 }]);
  await setup(carol, [hero('c1', 0, 2), hero('c2', 0, 2)]);
  r = await mythic.sync(store, carol, conn, { env: { MYTHIC_BOX_COLLECTION: collection } });
  assert.deepEqual(r.mints, [x1], 'only verified members of the collection');
  assert.deepEqual(mythic.collectionOf(metadata(x1, { verified: true, key: collection })), { verified: true, key: collection });
  assert.equal(mythic.collectionOf(metadata(x1)), null);
  assert.deepEqual(mythic.status({ MYTHIC_BOX_COLLECTION: collection }), { enabled: true, mode: 'collection' });

  // A full collection (500 heroes) waits until there is room.
  await setup(dave, Array.from({ length: 500 }, (_, i) => hero('full-' + i, 0, 1)));
  conn.holdings.set(dave, [{ mint: m2 }]);
  r = await mythic.sync(store, dave, conn, { env, force: true });
  assert.deepEqual([r.waiting, (await mythicOf(dave)).length], [1, 0], 'waits at 500 heroes');
  await setup(dave, [hero('d1', 0, 1), hero('d2', 0, 1)]);
  r = await mythic.sync(store, dave, conn, { env, force: true });
  assert.deepEqual([r.waiting, (await mythicOf(dave)).length], [0, 1]);
  console.log('PASS: Mythic Tsukiyomi ownership: dormant until configured, mint list and verified collection checks (finalized), 17–20 stats with 7 perks, Legend training prices, no Market listing, the hero and its training follow the NFT (old team cleared), outages never remove it, cached and rate-limited checks, full collections wait.');
})().catch(e => { console.error(e); process.exit(1); });
