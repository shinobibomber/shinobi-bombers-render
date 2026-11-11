'use strict';
/* Support tool: put back a hero that a player salvaged by mistake (owner request 2026-11-10).
 *
 * Every salvage keeps an immutable receipt in ryo_hero_salvages with the exact hero (rank, level, stats, identity) and
 * the Upgrade Shards it paid. This tool reverses ONE receipt: the hero goes back into the player's collection exactly as
 * it was (Reserve, not deployed), the shards from that salvage are taken back, and the change is written to the
 * hash-chained admin audit log (ryo_admin_audit, action "support.salvage-restore"). The receipt itself is never changed.
 *
 * Default is a DRY RUN that only reads and prints. Nothing is written without --apply.
 *     node tools/restore-salvaged-hero.cjs --wallet <player wallet>
 *     node tools/restore-salvaged-hero.cjs --wallet <player wallet> --request <salvage request id> --reason "<why>" --apply
 *
 * It refuses (and changes nothing) when: the receipt is not this wallet's; the hero is already back; this receipt was
 * already restored; the player has a pending purchase (its settlement would overwrite the profile); the player no longer
 * has the shards from that salvage (they were spent; the owner decides: add --allow-spent-shards to restore anyway and take
 * back only the shards still there, the rest is recorded as not recovered); or the collection is full (500).
 * Run it where the game's database settings already exist (the Render Shell of the live service). It prints wallets,
 * hero names and numbers only, never settings or secrets. */
const path = require('node:path');
const SERVER = path.join(__dirname, '../app/server');
const ACTION = 'support.salvage-restore', MAX_HEROES = 500, ACTOR = 'support-tool';
const fail = (message, code) => { throw Object.assign(Error(message), { code }); };
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, REQUEST_RE = /^[a-zA-Z0-9_-]{16,80}$/;

/** Read-only: the wallet's salvage receipts, newest first, with whether each was already restored. */
async function receipts(store, wallet) {
  const rows = (await store.pool.query('SELECT request_id,hero_id,rank,shards,hero,created FROM ryo_hero_salvages WHERE scope=$1 AND wallet=$2 ORDER BY created DESC LIMIT 50', [store.scope, wallet])).rows;
  const done = new Set((await store.pool.query("SELECT data->>'requestId' AS r FROM ryo_admin_audit WHERE scope=$1 AND action=$2 AND data->>'wallet'=$3", [store.scope, ACTION, wallet])).rows.map(r => r.r));
  return rows.map(r => ({ requestId: r.request_id, heroId: r.hero_id, name: r.hero?.name || '?', rank: Number(r.rank), level: Number(r.hero?.level ?? 0), shards: Number(r.shards), created: Number(r.created),
    restored: done.has(r.request_id), wasRestoredBefore: !!r.hero?.restoredFrom, bound: boundFlag(r.hero) }));
}
// Heroes bound to an NFT or a Founder box are never restored by this tool (salvage refuses them; defence in depth).
const boundFlag = h => (h?.nft ? 'NFT-bound' : h?.founderBound ? 'Founder-bound' : h?.founder ? 'Founder' : null);

/** Restores one receipt in a single transaction (account row lock + admin control lock for the audit chain). */
async function restore(store, wallet, requestId, reason, { allowSpentShards = false } = {}) {
  if (!WALLET_RE.test(String(wallet))) fail('Give the player wallet address (--wallet).', 'BAD_WALLET');
  if (!REQUEST_RE.test(String(requestId))) fail('Give the salvage request id shown by the dry run (--request).', 'BAD_REQUEST');
  if (typeof reason !== 'string' || reason.trim().length < 8 || reason.length > 300) fail('Give a reason of 8-300 characters (--reason).', 'BAD_REASON');
  const dashboard = require(path.join(SERVER, 'economic-dashboard.cjs'));
  const R = require(path.join(SERVER, 'hero-upgrade-rules.cjs'));
  return store.transaction(async c => {
    // Same order as a purchase (account row, then the admin control row), so the two can never deadlock each other.
    await store.locked(c, wallet);
    await dashboard.control(store, c, true);   // serializes audit-chain writers
    const rec = (await c.query('SELECT request_id,hero_id,rank,shards,hero,created FROM ryo_hero_salvages WHERE scope=$1 AND wallet=$2 AND request_id=$3', [store.scope, wallet, requestId])).rows[0];
    if (!rec) fail('No salvage with that request id for this wallet.', 'NOT_FOUND');
    if ((await c.query("SELECT 1 FROM ryo_admin_audit WHERE scope=$1 AND action=$2 AND data->>'wallet'=$3 AND data->>'requestId'=$4", [store.scope, ACTION, wallet, requestId])).rows.length) fail('This salvage was already restored.', 'ALREADY_RESTORED');
    if ((await c.query("SELECT 1 FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1", [store.scope, wallet])).rows.length) fail('The player has a pending purchase. Wait until it settles, then run again.', 'PENDING_PURCHASE');
    const profile = await store.profileLocked(c, wallet), shards = Number(rec.shards), hero = rec.hero;
    if (!hero || hero.tokenId !== rec.hero_id) fail('The salvage receipt has no hero copy.', 'NO_COPY');
    if (boundFlag(hero)) fail(boundFlag(hero) + ' heroes are not restored by this tool.', 'BOUND');
    // A hero that was already restored once and salvaged again never gets the spent-shards exception a second time.
    if (allowSpentShards && hero.restoredFrom) fail('This hero was already restored once; --allow-spent-shards is not available for it.', 'REPEAT_GIFT');
    if (profile.heroes.some(h => h.tokenId === rec.hero_id || h.restoredFrom === rec.hero_id)) fail('That hero is already in the collection.', 'ALREADY_OWNED');
    if (profile.heroes.length >= MAX_HEROES) fail('The collection is full (500 heroes).', 'HERO_LIMIT');
    R.normalize(profile);
    const before = Number(profile.upgradeShards || 0);
    if (before < shards && !allowSpentShards) fail('The player has ' + before + ' Upgrade Shard(s); this salvage gave ' + shards + '. They were spent, so the owner must decide (add --allow-spent-shards to restore anyway).', 'SHARDS_SPENT');
    // Owner decision 2026-11-10: with --allow-spent-shards the hero comes back even if the shards were spent; only the shards
    // still there (up to what this salvage paid) are taken back, and the shortfall is recorded in the audit entry.
    const taken = Math.min(before, shards);
    // Back in Reserve as of now: no bench recovery for the time it was gone, no old Boss Hunt lock.
    if (hero.chakra && typeof hero.chakra === 'object') { const { lockUntil, hunt, ...rest } = hero.chakra; hero.chakra = { ...rest, reserve: true, at: store.now() }; }
    // A salvage receipt is unique per hero id (ryo_hero_salvages PRIMARY KEY(scope,hero_id)), so the old id could never be
    // salvaged again. The hero comes back under a fresh id with everything else unchanged (name, rank, level, perks, look
    // and stats are stored on the hero; the id only seeds missing values), and remembers the old id.
    hero.restoredFrom = rec.hero_id; hero.tokenId = require('node:crypto').randomUUID();
    profile.heroes.push(hero);
    profile.upgradeShards = before - taken;
    require(path.join(SERVER, 'economy.cjs')).normalizeProfile(profile);
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
    const data = { wallet, requestId, heroId: rec.hero_id, newHeroId: hero.tokenId, rank: Number(rec.rank), level: Number(hero.level ?? 0), shardsPaidBySalvage: shards, shardsTaken: taken, shardsNotRecovered: shards - taken, shardsBefore: before, shardsAfter: before - taken, salvagedAt: Number(rec.created), reason: reason.trim() };
    const row = await dashboard.audit(store, c, ACTOR, ACTION, data);
    return { ...data, auditSequence: row.sequence };
  });
}

function args(argv) { const at = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; }; return { wallet: at('--wallet'), request: at('--request'), reason: at('--reason'), apply: argv.includes('--apply'), allowSpentShards: argv.includes('--allow-spent-shards') }; }
async function main() {
  const a = args(process.argv.slice(2));
  if (!WALLET_RE.test(String(a.wallet || ''))) { console.error('Usage: node tools/restore-salvaged-hero.cjs --wallet <player wallet> [--request <id> --reason "<why>" --apply]'); process.exitCode = 2; return; }
  if (!process.env.DATABASE_URL || !process.env.RYO_SCOPE) { console.error('Run this where the game database settings are configured (DATABASE_URL and RYO_SCOPE).'); process.exitCode = 2; return; }
  const { Pool } = require(require.resolve('pg', { paths: [SERVER] })), { Store } = require(path.join(SERVER, 'store.cjs'));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, statement_timeout: 15000 }), store = new Store(pool, process.env.RYO_SCOPE);
  try {
    const list = await receipts(store, a.wallet);
    console.log('Scope ' + store.scope + ' · salvages of ' + a.wallet + ' (newest first): ' + list.length + ' · already restored: ' + list.filter(r => r.restored).length);
    for (const r of list) console.log(['  ' + new Date(r.created).toISOString().slice(0, 16).replace('T', ' '), ['Genin', 'Chunin', 'Jonin', 'Elite', 'Legend', 'Mythic'][r.rank] || r.rank, r.name, 'Lv.' + r.level, r.shards + ' shard(s)',
      r.restored ? 'ALREADY RESTORED' : '', r.wasRestoredBefore ? 'WAS A RESTORED HERO' : '', r.bound ? r.bound + ' (not restorable)' : '', 'request ' + r.requestId].filter(Boolean).join('  '));
    if (!a.apply) { console.log('\nDry run: nothing changed. To restore one, add --request <id> --reason "<why>" --apply.'); return; }
    const out = await restore(store, a.wallet, a.request, a.reason, { allowSpentShards: a.allowSpentShards });
    console.log('\nRestored: ' + out.heroId + ' as ' + out.newHeroId + ' (rank ' + out.rank + ', Lv.' + out.level + '). Shards ' + out.shardsBefore + ' -> ' + out.shardsAfter
      + (out.shardsNotRecovered ? ' (' + out.shardsNotRecovered + ' already spent, not recovered)' : '') + '. Audit #' + out.auditSequence + '.');
  } catch (e) { console.error('Not restored: ' + e.message); process.exitCode = 1; }
  finally { await pool.end(); }
}
module.exports = { receipts, restore, ACTION };
if (require.main === module) main();
