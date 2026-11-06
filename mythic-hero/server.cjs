/* Tsukiyomi — the 7-star Mythic hero of the Limited NFT Box for initial investors.
 * A wallet owns one Tsukiyomi for every box NFT it holds, verified on-chain (finalized):
 *   MYTHIC_BOX_MINTS       comma/space separated NFT mint addresses, and/or
 *   MYTHIC_BOX_COLLECTION  a verified Metaplex collection mint (any NFT in it counts).
 * Box NFTs sold in the game (mythic-box.cjs) always count. None of these → the feature is dormant. Supply, price and addresses are
 * configuration for the launch, never code. The hero belongs to the NFT: its level and training move
 * with the NFT to the next holder, and it leaves a wallet (and its battle-ready team) when the NFT does.
 * An RPC failure never removes a hero; only a successful finalized check does. */
'use strict';
const RANK = 5, STARS = 7, CACHE_MS = 60000, REFRESH_MS = 10000, MAX_HEROES = 500;
const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_mythic_heroes(
 scope TEXT NOT NULL, mint TEXT NOT NULL, wallet TEXT, hero JSONB NOT NULL, updated BIGINT NOT NULL,
 PRIMARY KEY(scope,mint));
CREATE INDEX IF NOT EXISTS ryo_mythic_wallet ON ryo_mythic_heroes(scope,wallet);`;
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const web3 = () => require('@solana/web3.js');

function config(env = process.env) {
  const { PublicKey } = web3(), valid = v => { try { return new PublicKey(v).toBase58() === v; } catch { return false; } };
  const mints = String(env.MYTHIC_BOX_MINTS || '').split(/[\s,]+/).filter(Boolean).filter(valid);
  const collection = valid(String(env.MYTHIC_BOX_COLLECTION || '').trim()) ? String(env.MYTHIC_BOX_COLLECTION).trim() : '';
  return { mints: new Set(mints), collection, enabled: mints.length > 0 || !!collection };
}

// Metaplex Token Metadata (borsh): key, update authority, mint, name, symbol, uri, fee, creators,
// primary sale, mutable, edition nonce, token standard, collection {verified, key}. Old accounts may end early.
function collectionOf(data) {
  try {
    let o = 1 + 32 + 32;
    for (let k = 0; k < 3; k++) o += 4 + data.readUInt32LE(o);
    o += 2;
    if (data[o++] === 1) o += 4 + data.readUInt32LE(o) * 34;
    o += 2;
    if (data[o++] === 1) o += 1;
    if (o >= data.length) return null;
    if (data[o++] === 1) o += 1;
    if (o + 33 > data.length || data[o++] !== 1) return null;
    return { verified: data[o] === 1, key: new (web3().PublicKey)(data.subarray(o + 1, o + 33)).toBase58() };
  } catch { return null; }
}
function metadataAddress(mint) {
  const { PublicKey } = web3(), program = new PublicKey(METADATA_PROGRAM);
  return PublicKey.findProgramAddressSync([Buffer.from('metadata'), program.toBuffer(), new PublicKey(mint).toBuffer()], program)[0];
}
// Box NFTs the wallet holds now (amount 1, 0 decimals), at finalized commitment.
async function heldMints(connection, wallet, cfg) {
  const { PublicKey } = web3(), owner = new PublicKey(wallet), nfts = new Set();
  for (const program of TOKEN_PROGRAMS) {
    const result = await connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(program) }, 'finalized');
    for (const { account } of result.value) {
      const info = account?.data?.parsed?.info, amount = info?.tokenAmount;
      if (info?.mint && amount?.amount === '1' && amount.decimals === 0) nfts.add(info.mint);
    }
  }
  const out = [...nfts].filter(mint => cfg.mints.has(mint));
  const rest = cfg.collection ? [...nfts].filter(mint => !cfg.mints.has(mint)) : [];
  for (let i = 0; i < rest.length; i += 100) {
    const chunk = rest.slice(i, i + 100), accounts = await connection.getMultipleAccountsInfo(chunk.map(metadataAddress), 'finalized');
    accounts.forEach((account, j) => {
      if (!account || account.owner?.toBase58?.() !== METADATA_PROGRAM) return;
      const collection = collectionOf(Buffer.from(account.data));
      if (collection?.verified && collection.key === cfg.collection) out.push(chunk[j]);
    });
  }
  return out.sort();
}

// A new Tsukiyomi for a box NFT: Mythic stats (15–18), six perks, his own model. Rolled once per NFT.
function mythicHero(mint) {
  const hero = require('./economy.cjs').hero(RANK);
  return { ...hero, tokenId: 'mythic-' + mint, name: 'Tsukiyomi', mythic: 'tsukiyomi', stars: STARS, nft: { mint } };
}
const isMythic = h => Number(h?.rank) === RANK;
const dropFrom = (profile, tokenId) => {
  const hero = profile.heroes.find(h => h.tokenId === tokenId);
  profile.heroes = profile.heroes.filter(h => h.tokenId !== tokenId);
  if (Array.isArray(profile.battleReady)) profile.battleReady = profile.battleReady.filter(id => id !== tokenId);
  return hero;
};
const save = (c, store, wallet, profile) => c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);

// Make the wallet's Mythic heroes match the box NFTs it holds.
async function apply(store, wallet, mints) {
  const held = new Set(mints);
  const rows = (await store.pool.query('SELECT mint,wallet FROM ryo_mythic_heroes WHERE scope=$1 AND (wallet=$2 OR mint=ANY($3))', [store.scope, wallet, mints])).rows;
  const previous = [...new Set(rows.filter(r => held.has(r.mint) && r.wallet && r.wallet !== wallet).map(r => r.wallet))];
  return store.transaction(async c => {
    // Lock every wallet involved in one fixed order, so two holders syncing at once cannot deadlock.
    for (const w of [wallet, ...previous].sort()) await store.locked(c, w);
    const profile = await store.profileLocked(c, wallet), others = new Map(), now = store.now ? store.now() : Date.now();
    const owned = (await c.query('SELECT * FROM ryo_mythic_heroes WHERE scope=$1 AND (wallet=$2 OR mint=ANY($3)) FOR UPDATE', [store.scope, wallet, mints])).rows;
    let changed = false, waiting = 0;
    // Box holders get the 10% purchase discount (economy quote), one discount however many boxes.
    if (profile.mythicPerk !== held.size > 0) { profile.mythicPerk = held.size > 0; changed = true; }
    // NFTs that left this wallet: the hero leaves too, keeping its latest training in the registry.
    for (const hero of profile.heroes.filter(h => isMythic(h) && h.nft?.mint && !held.has(h.nft.mint))) {
      dropFrom(profile, hero.tokenId); changed = true;
      await c.query('UPDATE ryo_mythic_heroes SET wallet=NULL,hero=$3,updated=$4 WHERE scope=$1 AND mint=$2 AND wallet=$5', [store.scope, hero.nft.mint, JSON.stringify(hero), now, wallet]);
    }
    for (const mint of [...held].sort()) {
      const tokenId = 'mythic-' + mint;
      if (profile.heroes.some(h => h.tokenId === tokenId)) continue;
      if (profile.heroes.length >= MAX_HEROES) { waiting++; continue; }
      const row = owned.find(r => r.mint === mint);
      let hero = row ? row.hero : mythicHero(mint);
      if (row?.wallet && row.wallet !== wallet) {
        // The NFT moved: take the hero (with its training) from the previous holder.
        if (!others.has(row.wallet)) others.set(row.wallet, await store.profileLocked(c, row.wallet));
        hero = dropFrom(others.get(row.wallet), tokenId) || hero;
      }
      profile.heroes.push(hero); changed = true;
      await c.query(`INSERT INTO ryo_mythic_heroes(scope,mint,wallet,hero,updated) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(scope,mint) DO UPDATE SET wallet=EXCLUDED.wallet,hero=EXCLUDED.hero,updated=EXCLUDED.updated`, [store.scope, mint, wallet, JSON.stringify(hero), now]);
    }
    for (const [w, p] of others) await save(c, store, w, p);
    if (changed) await save(c, store, wallet, profile);
    return { changed, waiting };
  });
}

const cache = new Map(), refreshed = new Map();
async function sync(store, wallet, connection, { force = false, env = process.env } = {}) {
  const cfg = config(env);
  // Boxes sold in the game (mythic-box.cjs) count alongside any mints configured in the env.
  let boxes = []; try { boxes = await require('./mythic-box.cjs').mints(store); } catch {}
  for (const mint of boxes) cfg.mints.add(mint);
  if (boxes.length) cfg.enabled = true;
  if (!cfg.enabled || !connection) return { enabled: cfg.enabled, mints: [], waiting: 0 };
  const now = Date.now();
  let entry = cache.get(wallet);
  if (!entry || force || now - entry.at > CACHE_MS) {
    try { entry = { at: now, mints: await heldMints(connection, wallet, cfg) }; }
    catch { return { enabled: true, mints: entry?.mints || [], waiting: 0, unavailable: true }; }
    cache.delete(wallet); cache.set(wallet, entry);
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
  }
  // Same NFTs as the last applied check: the profile already matches, so no database work.
  if (!entry.applied || force) { entry.waiting = (await apply(store, wallet, entry.mints)).waiting; entry.applied = true; }
  return { enabled: true, mints: entry.mints, checkedAt: entry.at, waiting: entry.waiting || 0 };
}
// The player's "Check NFT" button: a fresh on-chain check, at most every 10 seconds per wallet.
async function refresh(store, wallet, connection, options = {}) {
  const last = refreshed.get(wallet) || 0;
  if (Date.now() - last < REFRESH_MS) fail('Please wait a few seconds before checking again.', 429);
  refreshed.set(wallet, Date.now()); if (refreshed.size > 5000) refreshed.delete(refreshed.keys().next().value);
  return { mythic: await sync(store, wallet, connection, { ...options, force: true }) };
}
function status(env = process.env) { const cfg = config(env); return { enabled: cfg.enabled, mode: cfg.collection ? (cfg.mints.size ? 'collection+mints' : 'collection') : cfg.mints.size ? 'mints' : 'off' }; }
function clearCache() { cache.clear(); refreshed.clear(); }

module.exports = { RANK, STARS, SCHEMA, config, collectionOf, heldMints, mythicHero, apply, sync, refresh, status, clearCache };
