/* Test-server Starter Pack (env STARTER_PACK=on; off by default and for mainnet).
 * Every account receives it once: 15 heroes (1 Mythic Tsukiyomi, 1 Legend, 1 Elite, 1 Jonin,
 * 1 Chunin, 10 Genin) and 10,000,000 starter Ryo. Starter Ryo lives in ryo_accounts.bonus: it pays for
 * anything (summons, fusion, Dojo, Sensei, training, the Boss Hunt entry, Market buys and offers) when
 * it covers the whole price, never withdraws, and moves no custody tokens (bonus-funded purchases have
 * no on-chain transaction and add nothing to the reward pool). The starter Tsukiyomi is not an NFT, so
 * it gives no holder discount and the NFT check leaves it alone. Brand-new accounts swap their two
 * default Genin for the pack, so they hold exactly 15 heroes. */
'use strict';
const BONUS = 10000000, RANKS = [5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], MAX_HEROES = 500, MAX_READY = 50;
const SCHEMA = `ALTER TABLE ryo_accounts ADD COLUMN IF NOT EXISTS bonus BIGINT NOT NULL DEFAULT 0 CHECK(bonus>=0);
ALTER TABLE ryo_market_offers ADD COLUMN IF NOT EXISTS funding TEXT NOT NULL DEFAULT 'balance';
CREATE TABLE IF NOT EXISTS ryo_starter_grants(scope TEXT NOT NULL, wallet TEXT NOT NULL, heroes INTEGER NOT NULL, bonus BIGINT NOT NULL, granted BIGINT NOT NULL, PRIMARY KEY(scope,wallet));`;
const enabled = (env = process.env) => /^(1|on|true|yes)$/i.test(String(env.STARTER_PACK || ''));

function heroes() {
  const economy = require('./economy.cjs');
  return RANKS.map(rank => {
    const h = economy.hero(rank);
    // The starter Mythic is Tsukiyomi without an NFT (no holder discount, untouched by the NFT check).
    return rank === 5 ? { ...h, tokenId: 'starter-mythic-' + h.tokenId, name: 'Tsukiyomi', mythic: 'tsukiyomi', starter: true } : { ...h, starter: true };
  });
}
// A profile nobody has touched: the two default level-1 Genin and nothing else.
const untouched = p => p.heroes.length === 2 && p.heroes.every(h => h.rank === 0 && h.level === 1) && !p.dojo && !p.sensei;

async function grant(store, wallet, env = process.env) {
  if (!enabled(env)) return null;
  if ((await store.pool.query('SELECT 1 FROM ryo_starter_grants WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows.length) return null;
  return store.transaction(async c => {
    await store.locked(c, wallet);
    if ((await c.query('SELECT 1 FROM ryo_starter_grants WHERE scope=$1 AND wallet=$2 FOR UPDATE', [store.scope, wallet])).rows.length) return null;
    const profile = await store.profileLocked(c, wallet);
    const purchases = Number((await c.query('SELECT COUNT(*) AS n FROM ryo_purchases WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0].n);
    if (!purchases && untouched(profile)) { profile.heroes = []; profile.battleReady = []; }
    const pack = heroes().slice(0, Math.max(0, MAX_HEROES - profile.heroes.length));
    profile.heroes.push(...pack);
    profile.battleReady = [...new Set([...(profile.battleReady || []), ...pack.map(h => h.tokenId)])].slice(0, MAX_READY);
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(require('./economy.cjs').normalizeProfile(profile))]);
    await c.query('UPDATE ryo_accounts SET bonus=bonus+$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, BONUS]);
    await c.query('INSERT INTO ryo_starter_grants(scope,wallet,heroes,bonus,granted) VALUES($1,$2,$3,$4,$5)', [store.scope, wallet, pack.length, BONUS, store.now ? store.now() : Date.now()]);
    return { heroes: pack.length, bonus: BONUS };
  });
}
async function bonus(store, wallet) {
  try { return Number((await store.pool.query('SELECT bonus FROM ryo_accounts WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).rows[0]?.bonus || 0); } catch { return 0; }
}
async function stats(store) {
  try {
    const [r] = (await store.pool.query(`SELECT (SELECT COALESCE(SUM(bonus),0) FROM ryo_accounts WHERE scope=$1) AS outstanding,
      (SELECT COALESCE(SUM(amount),0) FROM ryo_purchases WHERE scope=$1 AND quote->>'funding'='bonus' AND status='confirmed') AS spent,
      (SELECT COUNT(*) FROM ryo_starter_grants WHERE scope=$1) AS accounts`, [store.scope])).rows;
    return { outstanding: Number(r.outstanding), spent: Number(r.spent), accounts: Number(r.accounts), enabled: enabled() };
  } catch { return null; }
}
module.exports = { BONUS, RANKS, SCHEMA, enabled, heroes, grant, bonus, stats };
