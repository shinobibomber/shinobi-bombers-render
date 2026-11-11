'use strict';
const crypto = require('node:crypto'), { fail } = require('./store.cjs');
const query = async (c, sql, args) => (await c.query(sql, args)).rows;
const cp = () => require('./creators-portal.cjs');
const MARKER = 'shinobi-player-referrals-v1';
async function referral(store, c, wallet, lock = true) {
  return (await query(c, 'SELECT * FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2' + (lock ? ' FOR UPDATE' : ''), [store.scope, wallet]))[0];
}
async function count(store, c = store.pool) {
  return Number((await query(c, 'SELECT COUNT(*) AS n FROM ryo_player_referrals WHERE scope=$1', [store.scope]))[0].n);
}
async function identity(store, wallet) {
  // The common program lock serializes identity/attribution changes in both programs.
  return store.transaction(async c => {
    await cp().program(store, c, true); await store.locked(c, wallet);
    const old = (await query(c, 'SELECT * FROM ryo_player_referrers WHERE scope=$1 AND wallet=$2', [store.scope, wallet]))[0];
    if (old) return old;
    const code = 'RP' + crypto.randomBytes(10).toString('hex').toUpperCase();
    await c.query('INSERT INTO ryo_player_referrers(scope,wallet,code,created) VALUES($1,$2,$3,$4)', [store.scope, wallet, code, store.now()]);
    await cp().audit(store, c, wallet, 'player-referral.link-created', cp().privateId(wallet), 'Authenticated player opened referral dashboard');
    return { wallet, code };
  });
}
async function attribute(store, wallet, code, opts = {}) {   // opts.staff: see creators-portal attribute()
  return store.transaction(async c => {
    const { config } = await cp().program(store, c, true); await store.locked(c, wallet);
    if ((await query(c, 'SELECT 1 FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).length) fail('Your referral attribution is permanent and cannot be overwritten.', 409);
    const old = await referral(store, c, wallet);
    if (old) { const owner = (await query(c, 'SELECT code FROM ryo_player_referrers WHERE scope=$1 AND wallet=$2', [store.scope, old.referrer]))[0]; if (owner.code !== code) fail('Your referral attribution is permanent and cannot be overwritten.', 409); if (opts.onLinked) await opts.onLinked(c, true); return { ok: true, existing: true }; }
    if (config.enrollmentPaused && !opts.staff) fail('New referral enrollment is paused. Accepted referral rewards remain available.', 409);
    const creatorCount = Number((await query(c, 'SELECT COUNT(*) AS n FROM ryo_creator_referrals WHERE scope=$1', [store.scope]))[0].n);
    if (creatorCount + await count(store, c) >= config.enrollmentLimit) fail('The public referral enrollment limit has been reached.', 409);
    const owner = (await query(c, 'SELECT * FROM ryo_player_referrers WHERE scope=$1 AND code=$2', [store.scope, code]))[0];
    if (!owner) fail('That referral link is unavailable.', 404);
    if (owner.wallet === wallet) fail('You cannot refer yourself.', 409);
    if ((await query(c, 'SELECT 1 FROM ryo_creator_wallets WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).length) fail('Creator identities cannot become referred players.', 409);
    if (!opts.staff) await cp().assertNewPlayer(store, c, wallet);
    // Follow both programs, including a creator's reserved wallets after migration.
    // A referred player may now become a creator; RP-only traversal would miss mixed loops.
    const cycle = await query(c, `WITH RECURSIVE edges(wallet,referrer) AS (
      SELECT wallet,referrer FROM ryo_player_referrals WHERE scope=$1
      UNION SELECT r.wallet,w.wallet FROM ryo_creator_referrals r JOIN ryo_creator_wallets w ON w.scope=r.scope AND w.creator_id=r.creator_id WHERE r.scope=$1
    ), ancestors(wallet) AS (
      SELECT $2::text UNION SELECT e.referrer FROM edges e JOIN ancestors a ON e.wallet=a.wallet
    ) SELECT 1 FROM ancestors WHERE wallet=$3`, [store.scope, owner.wallet, wallet]);
    if (cycle.length) fail('Circular referral chains are not allowed.', 409);
    await c.query('INSERT INTO ryo_player_referrals(scope,wallet,referrer,attributed) VALUES($1,$2,$3,$4)', [store.scope, wallet, owner.wallet, store.now()]);
    await cp().recordEvent(store, c, 'player-attributed:' + wallet, wallet, 'player-referral-attributed', { referrer: owner.wallet });
    if (opts.onLinked) await opts.onLinked(c, false);   // staff audit in the same transaction as the link
    return { ok: true };
  });
}
async function qualify(store, c, r) {
  if (r.qualified || !r.stage5 || Number(r.paid_mints) < 15) return false;
  const now = store.now();
  await c.query('UPDATE ryo_player_referrals SET qualified=$3 WHERE scope=$1 AND wallet=$2', [store.scope, r.wallet, now]);
  await c.query(`INSERT INTO ryo_player_referral_rewards(scope,referral_wallet,wallet,created) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [store.scope, r.wallet, r.referrer, now]);
  await cp().recordEvent(store, c, 'player-qualified:' + r.wallet, r.wallet, 'player-referral-qualified', { referrer: r.referrer, passes: 2, paidHeroes: Number(r.paid_mints), clearedStage: 5 });
  r.qualified = now; return true;
}
async function settledPurchase(store, c, row) {
  const r = await referral(store, c, row.wallet); if (!r || r.qualified) return;
  const quantity = cp().paidSummonQuantity(row); if (!quantity) return;
  if (!await cp().recordEvent(store, c, 'player-purchase:' + row.wallet + ':' + row.request_id, row.wallet, 'player-referral-paid-summon', { quantity })) return;
  r.paid_mints = Number(r.paid_mints) + quantity;
  await c.query('UPDATE ryo_player_referrals SET paid_mints=$3 WHERE scope=$1 AND wallet=$2', [store.scope, r.wallet, r.paid_mints]);
  await qualify(store, c, r);
}
async function beginAdventure(store, c, wallet, profile, active, report) {
  const r = await referral(store, c, wallet); if (!r || r.qualified || r.stage5) return;
  const verified=(await c.query('SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2',[store.scope,wallet])).rows[0]?.data;
  const proof = cp().advanceProof(store, profile, r.proof, active, report, verified);
  r.stage5 = Number(proof.kills) >= 100 ? store.now() : null;
  await c.query('UPDATE ryo_player_referrals SET proof=$3,stage5=$4 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(proof), r.stage5]);
  await qualify(store, c, r);
}
async function summary(store, wallet, origin, body = {}) {
  const page = body.page ?? 0; if (!Number.isSafeInteger(page) || page < 0 || page > 100000) fail('Invalid referral page.');
  const owner = await identity(store, wallet), args = [store.scope, wallet];
  const [ownStats] = await query(store.pool, `SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE qualified IS NOT NULL) AS qualified,COUNT(*) FILTER(WHERE qualified IS NULL) AS pending FROM ryo_player_referrals WHERE scope=$1 AND referrer=$2`, args);
  // An approved creator's player-link referrals joined the Creator Program: show the same combined count.
  const creatorId = (await query(store.pool, "SELECT id FROM ryo_creators WHERE scope=$1 AND wallet=$2 AND status='APPROVED'", args))[0]?.id || null;
  const [viaCreator] = creatorId ? await query(store.pool, `SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE qualified IS NOT NULL) AS qualified,COUNT(*) FILTER(WHERE qualified IS NULL) AS pending FROM ryo_creator_referrals WHERE scope=$1 AND creator_id=$2`, [store.scope, creatorId]) : [{ total: 0, qualified: 0, pending: 0 }];
  const stats = { total: String(Number(ownStats.total) + Number(viaCreator.total)), qualified: String(Number(ownStats.qualified) + Number(viaCreator.qualified)), pending: String(Number(ownStats.pending) + Number(viaCreator.pending)), creatorProgram: !!creatorId };
  const [passes] = await query(store.pool, 'SELECT COALESCE(SUM(passes-claimed),0) AS available,COALESCE(SUM(passes),0) AS earned,COALESCE(SUM(claimed),0) AS claimed FROM ryo_player_referral_rewards WHERE scope=$1 AND wallet=$2', args);
  const refs = await query(store.pool, 'SELECT wallet,paid_mints,stage5,qualified,attributed FROM ryo_player_referrals WHERE scope=$1 AND referrer=$2 ORDER BY attributed DESC,wallet LIMIT 20 OFFSET $3', [...args, page * 20]);
  const claims = await query(store.pool, 'SELECT id,quantity,result,created FROM ryo_player_referral_claims WHERE scope=$1 AND wallet=$2 ORDER BY created DESC,id LIMIT 20 OFFSET $3', [...args, page * 20]);
  const own = await referral(store, store.pool, wallet, false);
  const rules = (await cp().publicInfo(store, origin)).rules;
  return { marker: MARKER, code: owner.code, link: origin.replace(/\/$/, '') + '/?referral=' + owner.code, stats, passes,
    referrals: refs.map(r => ({ ...r, wallet: undefined, player: cp().privateId(r.wallet) })), claims, page,
    attribution: own ? { paidMints: own.paid_mints, stage5: !!own.stage5, qualified: own.qualified } : null,
    rules: { paidHeroes: 15, clearedStage: 5, passesPerReferral: 2, enrollmentPaused: rules.enrollmentPaused, enrollmentRemaining: rules.enrollmentRemaining } };
}
async function claim(store, wallet, body) {
  const claimId = body.requestId, quantity = body.quantity ?? 2;
  if (typeof claimId !== 'string' || !/^[-a-zA-Z0-9_]{16,80}$/.test(claimId)) fail('Invalid request ID.');
  if (![1, 2].includes(quantity)) fail('Claim one or two hero passes.');
  return store.transaction(async c => {
    await cp().program(store, c, true); await store.locked(c, wallet);
    const old = (await query(c, 'SELECT * FROM ryo_player_referral_claims WHERE scope=$1 AND id=$2', [store.scope, claimId]))[0];
    if (old) { if (old.wallet !== wallet || old.quantity !== quantity) fail('Request ID belongs to another claim.', 409); return { claim: old, replay: true }; }
    const rewards = await query(c, 'SELECT * FROM ryo_player_referral_rewards WHERE scope=$1 AND wallet=$2 AND claimed<passes ORDER BY created,referral_wallet FOR UPDATE', [store.scope, wallet]);
    if (rewards.reduce((n, r) => n + r.passes - r.claimed, 0) < quantity) fail('Not enough qualified hero passes to claim.', 409);
    if ((await query(c, "SELECT 1 FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1", [store.scope, wallet])).length) fail('Recover the pending game purchase before claiming.', 409);
    const profile = await store.profileLocked(c, wallet); if (profile.heroes.length + quantity > 500) fail('Your collection is full. Free hero slots before claiming.', 409);
    const economy = require('./economy.cjs'), outputs = [], now = store.now();
    for (let i = 0; i < quantity; i++) {
      const q = economy.quote({ ...profile, mythicPerk: false }, 'summon', { quantity: 1 });
      const hero = economy.fulfill(profile, q, now).result.outputs[0];
      hero.creatorReward = true; hero.referralReward = true; hero.referralClaim = claimId;
      profile.heroes.push(hero); outputs.push(hero);
    }
    let left = quantity;
    for (const reward of rewards) { const take = Math.min(left, reward.passes - reward.claimed); if (!take) break; await c.query('UPDATE ryo_player_referral_rewards SET claimed=claimed+$3 WHERE scope=$1 AND referral_wallet=$2', [store.scope, reward.referral_wallet, take]); left -= take; }
    const result = { kind: 'hero', outputs, nftMintAddress: null, delivery: 'Regular in-game Shrine heroes; not NFTs' };
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
    await c.query('INSERT INTO ryo_player_referral_claims(scope,id,wallet,quantity,result,created) VALUES($1,$2,$3,$4,$5,$6)', [store.scope, claimId, wallet, quantity, JSON.stringify(result), now]);
    await cp().audit(store, c, wallet, 'player-referral.claimed', cp().privateId(wallet), 'Qualified referral hero passes claimed', { claimId, quantity });
    return { claim: { id: claimId, quantity, result, created: now } };
  });
}
module.exports = { MARKER, referral, count, identity, attribute, settledPurchase, beginAdventure, qualify, summary, claim };
