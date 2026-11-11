'use strict';
/* Fusion Shards (apply-fusion-shards.cjs copies this file to app/server/fusion-shards.cjs). Owner request 2026-11-11.
 *
 * Account-bound game items in the hero profile (`profile.fusionShards`, whole number >= 0; missing = 0). Never tokens, never
 * NFTs, never on a hero, never transferable.
 *   Craft:  2 Upgrade Shards -> 1 Fusion Shard. Action `fusion-shard-craft {quantity | max:true, requestId,
 *           craftRulesVersion}`: wallet lock, refused while a purchase is pending (a pending Training settlement re-checks
 *           Upgrade Shards), one transaction, idempotent by request id (immutable receipt in ryo_fusion_shard_crafts).
 *           No Ryo, Chest or Adventure effect.
 *   Boost:  a fusion quote may carry `params.fusionShards` = Fusion Shards per attempt (the same for every attempt of a batch).
 *           Each adds +5 percentage points to the server's base success rate (Genin 90, Chunin 80, Jonin 70, Elite 60), up to a
 *           guaranteed 100%; using more than needed for 100% is refused. Price, discounts and revenue are unchanged.
 *           The balance is checked at quote and at purchase (fulfil), deducted in the purchase's profile_after, and re-applied
 *           to the CURRENT balance at confirmed settlement (settlementShards), exactly like Training's Upgrade Shards. Refunds,
 *           expiry and failures consume nothing; success and failed attempts both consume them.
 */
const VERSION = 1, STEP = 5, RATE = 2, MAX_CRAFT = 1000000;
const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_fusion_shard_crafts (scope TEXT NOT NULL,wallet TEXT NOT NULL,request_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity>0),upgrade_before INTEGER NOT NULL,upgrade_after INTEGER NOT NULL,fusion_before INTEGER NOT NULL,
  fusion_after INTEGER NOT NULL,created BIGINT NOT NULL,PRIMARY KEY(scope,wallet,request_id));`;

function fail(message, status = 400) { const e = Error(message); e.status = status; throw e; }
const balance = p => Number.isSafeInteger(p?.fusionShards) && p.fusionShards > 0 ? p.fusionShards : 0;
const upgrade = p => Number.isSafeInteger(p?.upgradeShards) && p.upgradeShards > 0 ? p.upgradeShards : 0;
/** Fusion Shards needed per attempt for 100% from a base success rate. */
const neededFor = base => Math.max(0, Math.ceil((100 - base) / STEP));

/** Wraps the server fusion quote: validates the optional per-attempt shard count and raises successPercent. */
function quote(profile, q) {
  if (q.product !== 'fusion' || !q.fusion) return q;
  const raw = q.params?.fusionShards;
  if (raw === undefined || raw === 0) return q;
  if (!Number.isSafeInteger(raw) || raw < 0) fail('Choose a whole number of Fusion Shards.');
  const base = q.fusion.successPercent, needed = neededFor(base);
  if (raw > needed) fail('Only ' + needed + ' Fusion Shard(s) per attempt are needed for 100% success at this rank.');
  const total = raw * q.fusion.attempts, have = balance(profile);
  if (have < total) fail('This fusion needs ' + total + ' Fusion Shard(s). You have ' + have + '. Craft more from Upgrade Shards (2 = 1).', 409);
  q.fusion = { ...q.fusion, baseSuccessPercent: base, successPercent: Math.min(100, base + STEP * raw), shardsPerAttempt: raw, shards: total, shardRulesVersion: VERSION };
  return q;
}
/** economy.fulfill: deducts the quoted Fusion Shards in the purchase's profile_after (re-checks the balance). */
function consume(profile, q) {
  if (q.product !== 'fusion' || !q.fusion?.shards) return;
  const cost = q.fusion.shards;
  if (q.fusion.shardRulesVersion !== VERSION || !Number.isSafeInteger(cost) || cost < 1) fail('Fusion Shard rules changed. Review a new quote.', 409);
  if (balance(profile) < cost) fail('Not enough Fusion Shards.', 409);
  profile.fusionShards = balance(profile) - cost;
}
/** store.settlePurchase (confirmed): the Fusion Shard balance to store, from the CURRENT profile (undefined keeps it absent). */
function settlementShards(current, row) {
  const cost = row.product === 'fusion' ? row.quote?.fusion?.shards : undefined;
  if (!cost) return current.fusionShards === undefined ? undefined : balance(current);
  if (row.quote.fusion.shardRulesVersion !== VERSION || !Number.isSafeInteger(cost) || cost < 1 || balance(current) < cost) fail('Reserved Fusion Shards are unavailable. Contact support.', 409);
  return balance(current) - cost;
}

/** Crafting: 2 Upgrade Shards -> 1 Fusion Shard, all or nothing, idempotent by request id. */
async function craft(store, wallet, body = {}) {
  if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId) || body.craftRulesVersion !== VERSION) fail('Review the Fusion Shard crafting again.');
  const max = body.max === true;
  if (!max && (!Number.isSafeInteger(body.quantity) || body.quantity < 1 || body.quantity > MAX_CRAFT)) fail('Choose how many Fusion Shards to craft.');
  // A retry of a craft that already went through gets its receipt even while operators pause purchases.
  const done = (await store.pool.query('SELECT quantity,upgrade_after,fusion_after FROM ryo_fusion_shard_crafts WHERE scope=$1 AND wallet=$2 AND request_id=$3', [store.scope, wallet, body.requestId])).rows[0];
  if (done && !max && done.quantity !== body.quantity) fail('This crafting request was already used for a different amount.', 409);
  if (done) return { quantity: done.quantity, upgradeShards: done.upgrade_after, fusionShards: done.fusion_after, replay: true };
  await require('./economic-dashboard.cjs').guard(store, 'purchase', wallet, {});
  return store.transaction(async c => {
    await store.locked(c, wallet);
    const old = (await c.query('SELECT quantity,upgrade_after,fusion_after FROM ryo_fusion_shard_crafts WHERE scope=$1 AND wallet=$2 AND request_id=$3', [store.scope, wallet, body.requestId])).rows[0];
    if (old && !max && old.quantity !== body.quantity) fail('This crafting request was already used for a different amount.', 409);
    if (old) return { quantity: old.quantity, upgradeShards: old.upgrade_after, fusionShards: old.fusion_after, replay: true };
    if ((await c.query("SELECT request_id FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1", [store.scope, wallet])).rows.length) fail('Wait for the pending purchase to settle before crafting Fusion Shards.', 409);
    const profile = await store.profileLocked(c, wallet), up = upgrade(profile), fu = balance(profile);
    const quantity = max ? Math.min(MAX_CRAFT, Math.floor(up / RATE)) : body.quantity;
    if (quantity < 1 || up < quantity * RATE) fail('Crafting ' + (max ? 'a Fusion Shard' : quantity + ' Fusion Shard(s)') + ' needs ' + (max ? RATE : quantity * RATE) + ' Upgrade Shards. You have ' + up + '.', 409);
    if (!Number.isSafeInteger(fu + quantity)) fail('Invalid Fusion Shard balance.', 409);
    profile.upgradeShards = up - quantity * RATE; profile.fusionShards = fu + quantity;
    await c.query('INSERT INTO ryo_fusion_shard_crafts(scope,wallet,request_id,quantity,upgrade_before,upgrade_after,fusion_before,fusion_after,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [store.scope, wallet, body.requestId, quantity, up, profile.upgradeShards, fu, profile.fusionShards, store.now()]);
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
    return { quantity, upgradeShards: profile.upgradeShards, fusionShards: profile.fusionShards };
  });
}

module.exports = { VERSION, STEP, RATE, SCHEMA, balance, neededFor, quote, consume, settlementShards, craft };
