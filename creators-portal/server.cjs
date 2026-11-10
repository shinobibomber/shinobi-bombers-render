'use strict';
const crypto = require('node:crypto');
const { fail } = require('./store.cjs');
const UNIT = 1000n, DAY = 86400000, MARKER = 'shinobi-creators-portal-v1';
// REFERRAL_ENROLLMENT_LIMIT raises the shared creator + player referral cap (default 1000) for a large launch.
const enrollmentLimit = (() => { const n = Number(process.env.REFERRAL_ENROLLMENT_LIMIT); return Number.isSafeInteger(n) && n >= 1 && n <= 10000000 ? n : 1000; })();
const DEFAULTS = { applicationsPaused: false, enrollmentPaused: false, enrollmentLimit, commissionDays: 90,
  eligibleProducts: ['summon', 'fusion', 'dojo', 'sensei', 'sensei-rental', 'training'], season: 'launch', promotionalSupply: 100 };
const PRODUCTS = DEFAULTS.eligibleProducts;
const ITEMS = [
  ['hero-pass', 'Standard Hero Summon Pass', 'hero', 25000, 100, 2, 'One regular in-game Shrine hero, not an on-chain NFT. Same rarity odds. Not a paid referral mint.']
];
const enabled = () => /^(on|true|1)$/i.test(String(process.env.CREATORS_PORTAL_ENABLED || 'on').trim());
const text = (v, max = 160) => { if (typeof v !== 'string' || !v.trim() || v.length > max) fail('Enter text between 1 and ' + max + ' characters.'); return v.trim(); };
const integer = (v, min, max) => { if (!Number.isSafeInteger(v) || v < min || v > max) fail('Enter a whole number between ' + min + ' and ' + max + '.'); return v; };
const number = v => { const n = Number(v || 0); if (!Number.isSafeInteger(n)) fail('The value exceeds safe display precision.', 503); return n; };
const id = () => crypto.randomUUID();
const requestId = v => { if (typeof v !== 'string' || !/^[-a-zA-Z0-9_]{16,80}$/.test(v)) fail('Invalid request ID.'); return v; };
const walletAddress = v => { try { const { PublicKey } = require('@solana/web3.js'); if (new PublicKey(v).toBase58() !== v) throw Error(); return v; } catch { fail('Enter a valid Solana wallet address.'); } };
const page = body => integer(body.page ?? 0, 0, 100000);
const query = async (c, sql, args) => (await c.query(sql, args)).rows;
async function audit(store, c, actor, action, target, reason, detail = {}) {
  await c.query('INSERT INTO ryo_creator_audit(scope,actor,action,target,reason,detail,created) VALUES($1,$2,$3,$4,$5,$6,$7)', [store.scope, actor, action, target, reason, JSON.stringify(detail), store.now()]);
}
function adminRole(wallet, mutate = false) {
  const has = k => typeof wallet === 'string' && !!wallet && (process.env[k] || '').split(',').map(x => x.trim()).filter(Boolean).includes(wallet);
  if (has('RYO_ADMIN_APPROVERS')) return 'approver';
  if (has('RYO_ADMIN_OPERATORS')) return 'operator';
  if (!mutate && has('RYO_ADMIN_VIEWERS')) return 'viewer';
  fail('An authorized creator administrator is required.', 403);
}
async function program(store, c = store.pool, lock = false) {
  const sql = 'SELECT * FROM ryo_creator_program WHERE scope=$1' + (lock ? ' FOR UPDATE' : '');
  let r = (await query(c, sql, [store.scope]))[0];
  if (!r) { await c.query('INSERT INTO ryo_creator_program(scope,created) VALUES($1,$2) ON CONFLICT DO NOTHING', [store.scope, store.now()]); r = (await query(c, sql, [store.scope]))[0]; }
  return { ...r, config: { ...DEFAULTS, ...r.config } };
}
async function initialize(store) {
  await program(store);
  await syncApprovedCreators(store);
  for (const [itemId, name, kind, price, supply, monthly, detail] of ITEMS) await store.pool.query(`INSERT INTO ryo_creator_shop(scope,id,name,kind,price,supply,monthly_limit,detail)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, [store.scope, itemId, name, kind, price * 1000, supply, monthly, detail]);
}
async function publicInfo(store, origin) {
  const p = await program(store), [n] = await query(store.pool, 'SELECT COUNT(*) AS n FROM ryo_creator_referrals WHERE scope=$1', [store.scope]);
  return { marker: MARKER, enabled: enabled(), playerReferrals: { marker: 'shinobi-player-referrals-v1', passesPerReferral: 2, applicationRequired: false, paidHeroes: 15, clearedStage: 5 }, rules: { ...p.config, version: p.version, eligibleProducts: [...p.config.eligibleProducts],
    milestone: 50000, paidHeroes: 15, clearedStage: 5, adventurePercent: 5, purchasePercent: 5, founderBoxPercent: 10,
    enrollmentRemaining: Math.max(0, p.config.enrollmentLimit - number(n.n) - await require('./player-referrals.cjs').count(store)), origin, cpWithdrawable: false,
    attribution: 'First valid referral link, accepted before any paid order or recorded Adventure progress. One referrer across both programs per verified wallet; attribution never changes. Local link expires after 7 days.',
    progression: 'Stage 5 must be cleared in the server combat verifier (100 server-simulated defeats). A client stage number is never evidence.',
    shopDelivery: 'Standard passes deliver regular in-game Shrine heroes. They are not on-chain NFTs.' } };
}
async function creatorByWallet(store, c, wallet, lock = false) {
  return (await query(c, 'SELECT * FROM ryo_creators WHERE scope=$1 AND wallet=$2' + (lock ? ' FOR UPDATE' : ''), [store.scope, wallet]))[0];
}
async function approved(store, c, wallet, lock = false) {
  const r = await creatorByWallet(store, c, wallet, lock);
  if (!r || r.status !== 'APPROVED') fail('Only an approved, authenticated creator can use this section.', 403);
  return r;
}
function publicCreator(r) { return r ? { id: r.id, displayName: r.display_name, status: r.status, code: r.code, appealSubmitted: !!r.application?.appeal,
  balanceMilli: String(r.balance), publicNote: r.public_note, submitted: number(r.created), reviewed: r.reviewed ? number(r.reviewed) : null } : null; }
async function ledger(store, c, creatorId, eventId, kind, delta, sourceSr = 0n, detail = {}) {
  delta = BigInt(delta);
  const inserted = await query(c, `INSERT INTO ryo_creator_ledger(scope,creator_id,event_id,kind,delta,source_sr,detail,created)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(scope,event_id) DO NOTHING RETURNING sequence`, [store.scope, creatorId, eventId, kind, String(delta), String(sourceSr), JSON.stringify(detail), store.now()]);
  if (!inserted.length) {
    const previous = (await query(c, 'SELECT creator_id,kind,delta,source_sr FROM ryo_creator_ledger WHERE scope=$1 AND event_id=$2', [store.scope, eventId]))[0];
    if (previous.creator_id !== creatorId || previous.kind !== kind || BigInt(previous.delta) !== delta || BigInt(previous.source_sr) !== BigInt(sourceSr)) fail('The CP event ID belongs to another operation.', 409);
    return false;
  }
  const updated = await query(c, 'UPDATE ryo_creators SET balance=balance+$3 WHERE scope=$1 AND id=$2 AND balance+$3>=0 RETURNING balance', [store.scope, creatorId, String(delta)]);
  if (!updated.length) fail('Not enough Creator Points.', 409);
  return true;
}
async function recordEvent(store, c, eventId, wallet, kind, payload = {}) {
  return (await query(c, `INSERT INTO ryo_creator_events(scope,event_id,wallet,kind,payload,created) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT DO NOTHING RETURNING event_id`, [store.scope, eventId, wallet, kind, JSON.stringify(payload), store.now()])).length > 0;
}
async function referral(store, c, wallet, lock = true) {
  return (await query(c, 'SELECT * FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2' + (lock ? ' FOR UPDATE' : ''), [store.scope, wallet]))[0];
}
async function qualify(store, c, r, pending = null) {
  if (r.qualified || !r.stage5 || number(r.paid_mints) < 15) return false;
  const { config, version } = await program(store, c), now = store.now();
  const rules = { version, days: config.commissionDays, purchaseProducts: config.eligibleProducts, percent: 5 };
  await c.query('UPDATE ryo_creator_referrals SET qualified=$3,expires=$4,rules=$5 WHERE scope=$1 AND wallet=$2 AND qualified IS NULL', [store.scope, r.wallet, now, now + rules.days * DAY, JSON.stringify(rules)]);
  await ledger(store, c, r.creator_id, 'milestone:' + r.wallet, 'milestone', 50000n * UNIT, 0n, { referral: privateId(r.wallet), paidMints: number(r.paid_mints), stageCleared: 5 });
  await recordEvent(store, c, 'qualified:' + r.wallet, r.wallet, 'qualified', { creatorId: r.creator_id, rules, expires: now + rules.days * DAY });
  // Anything already in the Chest at qualification remains outside the commission window.
  if (pending === null) pending = (await query(c, 'SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, r.wallet]))[0]?.data?.pending || 0;
  await initLots(store, c, r, pending);
  Object.assign(r, { qualified: now, expires: now + rules.days * DAY, rules, pending_initialized: true });
  return true;
}
async function initLots(store, c, r, pending) {
  if (r.pending_initialized) return;
  if (pending > 0) await c.query(`INSERT INTO ryo_creator_adventure_lots(scope,wallet,event_id,remaining,eligible,created)
    VALUES($1,$2,$3,$4,FALSE,$5) ON CONFLICT DO NOTHING`, [store.scope, r.wallet, 'opening:' + r.wallet, String(Math.floor(pending)), store.now()]);
  await c.query('UPDATE ryo_creator_referrals SET pending_initialized=TRUE WHERE scope=$1 AND wallet=$2', [store.scope, r.wallet]);
}
const privateId = wallet => 'Player ' + crypto.createHash('sha256').update(wallet).digest('hex').slice(0, 10).toUpperCase();
// Owner decision (2026-11-08): an approved creator's earlier player-link (RP…) referrals join the Creator Program,
// so one creator has one referral count and earns CP for them instead of hero passes. Only referrals that are not yet
// qualified and were never paid hero passes move; join time and progress are kept. Already-rewarded referrals and
// referred creator wallets stay player referrals (counted in the creator total). Rows move inside one transaction,
// so the shared enrollment total is unchanged. The creator's OWN attribution is never touched.
async function convertPlayerReferrals(store, c, creator) {
  if (creator?.status !== 'APPROVED' || !creator.application?.termsAt) return 0;
  const rows = await query(c, `SELECT r.* FROM ryo_player_referrals r WHERE r.scope=$1 AND r.referrer=$2 AND r.qualified IS NULL
    AND NOT EXISTS(SELECT 1 FROM ryo_player_referral_rewards w WHERE w.scope=r.scope AND w.referral_wallet=r.wallet)
    AND NOT EXISTS(SELECT 1 FROM ryo_creator_wallets cw WHERE cw.scope=r.scope AND cw.wallet=r.wallet)
    AND NOT EXISTS(SELECT 1 FROM ryo_creator_referrals x WHERE x.scope=r.scope AND x.wallet=r.wallet)
    ORDER BY r.attributed, r.wallet FOR UPDATE`, [store.scope, creator.wallet]);
  for (const p of rows) {
    await c.query('INSERT INTO ryo_creator_referrals(scope,wallet,creator_id,attributed,paid_mints,stage5,proof) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [store.scope, p.wallet, creator.id, p.attributed, p.paid_mints, p.stage5, JSON.stringify(p.proof || {})]);
    await c.query('DELETE FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2 AND referrer=$3', [store.scope, p.wallet, creator.wallet]);
    await recordEvent(store, c, 'converted:' + p.wallet, p.wallet, 'player-referral-converted', { creatorId: creator.id, attributed: number(p.attributed) });
    await qualify(store, c, await referral(store, c, p.wallet));
  }
  if (rows.length) await audit(store, c, 'system', 'referrals.converted', creator.id, 'Approved creator: player-link referrals joined the Creator Program', { count: rows.length });
  return rows.length;
}
// One-time sync for creators approved before this change (idempotent; once per process and scope).
const syncedScopes = new Set();
async function syncApprovedCreators(store) {
  if (syncedScopes.has(store.scope)) return;
  try {
    const approved = await query(store.pool, "SELECT id FROM ryo_creators WHERE scope=$1 AND status='APPROVED' ORDER BY created,id", [store.scope]);
    for (const { id: creatorId } of approved) await store.transaction(async c => {
      const creator = (await query(c, 'SELECT * FROM ryo_creators WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, creatorId]))[0];
      await convertPlayerReferrals(store, c, creator);
    });
    syncedScopes.add(store.scope);
  } catch (error) { console.error('[creators] referral sync will retry:', error.message); }
}
async function application(store, wallet, body) {
  const platform = text(body.platform, 20), channel = safeUrl(body.channelUrl);
  if (!['YouTube', 'Twitch', 'TikTok', 'Facebook', 'X'].includes(platform)) fail('Choose a supported primary platform.');
  if (body.terms !== true) fail('Accept the Creator Program Terms before applying.');
  const data = { platform, channelUrl: channel, links: (Array.isArray(body.links) ? body.links : []).slice(0, 5).map(safeUrl),
    audience: body.audience === '' || body.audience == null ? null : integer(body.audience, 0, 1000000000), reason: text(body.reason, 1500), termsVersion: 1, termsAt: store.now() };
  return store.transaction(async c => {
    const { config } = await program(store, c, true); if (config.applicationsPaused) fail('Creator applications are temporarily paused.', 409);
    await store.locked(c, wallet);
    if (await creatorByWallet(store, c, wallet) || (await query(c, 'SELECT 1 FROM ryo_creator_wallets WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).length) fail('This wallet already has a creator application or reserved identity.', 409);
    const creatorId = id(), code = codeFor();
    await c.query(`INSERT INTO ryo_creators(scope,id,wallet,display_name,status,code,application,created) VALUES($1,$2,$3,$4,'PENDING',$5,$6,$7)`, [store.scope, creatorId, wallet, text(body.displayName, 60), code, JSON.stringify(data), store.now()]);
    await c.query('INSERT INTO ryo_creator_wallets(scope,wallet,creator_id) VALUES($1,$2,$3)', [store.scope, wallet, creatorId]);
    await audit(store, c, wallet, 'application.submitted', creatorId, 'Creator Program Terms accepted');
    return { ok: true };
  });
}
function safeUrl(v) { try { const u = new URL(text(v, 500)); if (u.protocol !== 'https:' || u.username || u.password) throw Error(); return u.href; } catch { fail('Use an HTTPS channel/profile URL.'); } }
const codeFor = () => 'SB' + crypto.randomBytes(7).toString('hex').toUpperCase();
async function assertNewPlayer(store, c, wallet) {
  const [used] = await query(c, `SELECT EXISTS(SELECT 1 FROM ryo_purchases WHERE scope=$1 AND wallet=$2) OR EXISTS(SELECT 1 FROM ryo_spends WHERE scope=$1 AND wallet=$2)
    OR EXISTS(SELECT 1 FROM ryo_adventures WHERE scope=$1 AND wallet=$2 AND (COALESCE((data->>'kills')::numeric,0)>0 OR COALESCE((data->>'pending')::numeric,0)>0)) AS used`, [store.scope, wallet]);
  // A Founder box (pending or confirmed) is a paid order too: it raises the creator to 10% (discount and commission), so a
  // buyer can no longer be attached to a creator afterwards by a link (owner decision 2026-11-10; staff can still link by hand).
  const founder = !used.used && await hasFounderTable(c) && (await query(c, "SELECT 1 FROM ryo_founder_purchases WHERE scope=$1 AND wallet=$2 AND status IN ('pending','confirmed') LIMIT 1", [store.scope, wallet])).length > 0;
  if (used.used || founder) fail('Referral links are for new players before their first order or Adventure progress.', 409);
}
/** Staff tool: the referral link or code from a pasted link (?referral= / ?creator=) or a bare code. */
function referralCodeOf(input) {
  const v = text(input, 300), m = v.match(/[?&](?:referral|creator)=([A-Za-z0-9]{4,32})/i) || v.match(/^([A-Za-z0-9]{4,32})$/);
  if (!m) fail('Enter a referral link or code.');
  return m[1].toUpperCase();
}
/** Staff tool: a registered player by wallet or by username (the pre-launch / game username). */
async function resolvePlayer(store, input) {
  const v = text(input, 80);
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) {
    const wallet = walletAddress(v), row = await hasTable(store.pool, 'ryo_players') ? (await query(store.pool, 'SELECT username FROM ryo_players WHERE scope=$1 AND wallet=$2', [store.scope, wallet]))[0] : null;
    if (!row && !(await query(store.pool, 'SELECT 1 FROM ryo_profiles WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).length) fail('No registered player or game account has that wallet.', 404);
    return { wallet, username: row?.username || null };
  }
  if (!await hasTable(store.pool, 'ryo_players')) fail('Usernames are unavailable here. Enter the player wallet.', 404);
  const row = (await query(store.pool, 'SELECT wallet,username FROM ryo_players WHERE scope=$1 AND username_key=$2', [store.scope, v.toLowerCase()]))[0];
  if (!row) fail('No registered player has that username.', 404);
  return { wallet: row.wallet, username: row.username };
}
const hasTable = async (db, name) => !!(await query(db, 'SELECT to_regclass($1) IS NOT NULL AS t', [name]))[0]?.t;
function paidSummonQuantity(row) {
  if (row.product !== 'summon' || row.quote?.funding === 'bonus' || String(row.signature).startsWith('bonus:') || !row.signature || !row.wire) return 0;
  const outputs = row.result?.outputs || [], quantity = row.params?.quantity;
  if (![1, 5, 10, 15].includes(quantity) || outputs.length !== quantity || new Set(outputs.map(h => h.tokenId)).size !== quantity || outputs.some(h => !h.tokenId || h.starter || h.creatorReward || h.referralReward)) fail('Settled summon output evidence is inconsistent.', 503);
  return quantity;
}
function advanceProof(store, profile, proof, active, report, verified) {
  // Qualification observes the settled combat ledger; a second simulation would spend chakra twice.
  const kills=Math.max(number(proof?.kills),number(verified?.kills));
  return {kills,map:Math.floor(kills/20)+1,last:store.now(),verifier:'settled-combat-v1'};
}
// opts.staff (the approver-only admin tool): skips the new-player rule and the enrollment pause; permanence, self, cycles,
// creator identities and the enrollment limit still apply.
async function attribute(store, wallet, body, opts = {}) {
  let code = text(body.code, 32).toUpperCase();
  // A player link is "RP" + 20 hex characters, always 22 long. A pasted link with extra trailing characters (owner report
  // 2026-11-10: "...AA2AMythic") is the same link with a typo: if its first 22 characters are a real player code, use that code.
  // The code space is 80 random bits, so the prefix identifies exactly one owner; an unknown prefix still fails as before.
  if (/^RP[0-9A-F]{20}[A-Z0-9]{1,10}$/.test(code)) {
    const real = code.slice(0, 22);
    if ((await query(store.pool, 'SELECT 1 FROM ryo_player_referrers WHERE scope=$1 AND code=$2', [store.scope, real])).length) code = real;
  }
  if (code.startsWith('RP')) {
    // An approved creator's player link enrolls new players in the Creator Program; every other RP link is unchanged.
    const owner = (await query(store.pool, "SELECT c.code FROM ryo_player_referrers p JOIN ryo_creators c ON c.scope=p.scope AND c.wallet=p.wallet WHERE p.scope=$1 AND p.code=$2 AND c.status='APPROVED'", [store.scope, code]))[0];
    if (!owner || await require('./player-referrals.cjs').referral(store, store.pool, wallet, false)) return require('./player-referrals.cjs').attribute(store, wallet, code, opts);
    code = owner.code;
  }
  return store.transaction(async c => {
    const { config } = await program(store, c, true);
    await store.locked(c, wallet);
    if (await require('./player-referrals.cjs').referral(store, c, wallet)) fail('Your referral attribution is permanent and cannot be overwritten.', 409);
    const old = await referral(store, c, wallet);
    if (old) { const cr = (await query(c, 'SELECT code FROM ryo_creators WHERE scope=$1 AND id=$2', [store.scope, old.creator_id]))[0]; if (cr.code !== code) fail('Your referral attribution is permanent and cannot be overwritten.', 409); if (opts.onLinked) await opts.onLinked(c, true); return { ok: true, existing: true }; }
    if (config.enrollmentPaused && !opts.staff) fail('New referral enrollment is paused. Previously accepted referrals keep their rewards.', 409);
    const [n] = await query(c, 'SELECT COUNT(*) AS n FROM ryo_creator_referrals WHERE scope=$1', [store.scope]);
    if (number(n.n) + await require('./player-referrals.cjs').count(store, c) >= config.enrollmentLimit) fail('The public referral enrollment limit has been reached.', 409);
    const creator = (await query(c, "SELECT * FROM ryo_creators WHERE scope=$1 AND code=$2 AND status='APPROVED'", [store.scope, code]))[0];
    if (!creator) fail('That creator link is unavailable.', 404);
    if (!creator.application?.termsAt) fail('This creator must accept the program terms before enrolling referrals.', 409);
    if ((await query(c, 'SELECT 1 FROM ryo_creator_wallets WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).length) fail('Creator identities cannot refer themselves or other creator accounts.', 409);
    if ((await query(c, 'SELECT 1 FROM ryo_player_referrals WHERE scope=$1 AND referrer=$2', [store.scope, wallet])).length) fail('An existing referrer cannot become a newly referred player.', 409);
    if (!opts.staff) await assertNewPlayer(store, c, wallet);
    await c.query('INSERT INTO ryo_creator_referrals(scope,wallet,creator_id,attributed) VALUES($1,$2,$3,$4)', [store.scope, wallet, creator.id, store.now()]);
    await recordEvent(store, c, 'attributed:' + wallet, wallet, 'attributed', { creatorId: creator.id });
    if (opts.onLinked) await opts.onLinked(c, false);   // staff audit in the same transaction as the link
    return { ok: true };
  });
}

// Called inside the real Store.settlePurchase transaction, after finalized success only.
async function settledPurchase(store, c, row) {
  // Existing accepted cohorts retain their promised settlement even while new portal access is off.
  const r = await referral(store, c, row.wallet); if (!r) return require('./player-referrals.cjs').settledPurchase(store, c, row);
  const eventId = 'purchase:' + row.wallet + ':' + row.request_id;
  if (!await recordEvent(store, c, eventId, row.wallet, 'purchase', { product: row.product, funding: row.quote?.funding || 'balance', signature: row.signature })) return;
  if (row.quote?.funding === 'bonus' || String(row.signature).startsWith('bonus:') || !row.signature || !row.wire) return;
  const wasQualified = !!r.qualified, settledAt = store.now();
  if (row.product === 'summon') {
    const quantity = paidSummonQuantity(row);
    r.paid_mints = number(r.paid_mints) + quantity;
    await c.query('UPDATE ryo_creator_referrals SET paid_mints=$3 WHERE scope=$1 AND wallet=$2', [store.scope, row.wallet, r.paid_mints]);
    await qualify(store, c, r);
  }
  // The order crossing qualification (including all its initial mints) earns no extra commission.
  // Chest-funded orders (chest-spending.cjs) earn no purchase commission: the creator already earns the Adventure commission
  // on that SR (chestCommission), so the same SR never earns CP twice (owner decision 2026-11-11). Paid mints still count.
  if (row.quote?.funding !== 'chest' && wasQualified && number(row.created) > number(r.qualified) && settledAt < number(r.expires) && r.rules?.purchaseProducts?.includes(row.product))
    await commission(store, c, r, eventId, 'purchase', BigInt(row.amount) * UNIT);
}
// Commission rates (owner decision 2026-11-10): 5% normally, 10% on a referral who bought a Founder box (a CONFIRMED purchase in
// ryo_founder_purchases). Commissions already earned from that referral at 5% (before or after the box) are raised to 10% once,
// automatically, by topUpFounderCommissions. CP stays ledger-only: it never touches Ryo, the reward pool or any token.
const COMMISSION_PERCENT = 5n, FOUNDER_COMMISSION_PERCENT = 10n, TOPUP_KIND = 'founder-commission-topup';
const COMMISSION_KINDS = ['adventure-commission', 'purchase-commission', TOPUP_KIND];
/** The Founder tables are added by a later build step; isolated schemas without them simply pay 5%. */
async function hasFounderTable(c) {
  return !!(await query(c, "SELECT to_regclass('ryo_founder_purchases') IS NOT NULL AS t", []))[0]?.t;
}
async function founderBuyer(store, c, wallet) {
  if (!await hasFounderTable(c)) return false;
  return (await query(c, "SELECT 1 FROM ryo_founder_purchases WHERE scope=$1 AND wallet=$2 AND status='confirmed' LIMIT 1", [store.scope, wallet])).length > 0;
}
// Creator discount (owner decision 2026-11-10): an APPROVED creator pays less for their OWN game services (the Founder discount's
// products): 5%, or 10% once any of their referrals (creator link or player link) has a CONFIRMED Founder box, Mythic or Legacy.
// economy.cjs applies it after the existing discount (Founder discount or Mythic Box 10%, which still never stack with each
// other), one after the other. Store.profileLocked writes profile.creatorDiscountBps on every locked read (apply-founders store
// hook), so the preview quote and the charged purchase always use the current value. Closed with the Creators Portal switch.
const CREATOR_DISCOUNT_BPS = 500, CREATOR_FOUNDER_DISCOUNT_BPS = 1000;
const CREATOR_DISCOUNTED = Object.freeze(['summon', 'training', 'dojo', 'sensei', 'sensei-rental', 'fusion']);
let creatorTables = false;
async function creatorDiscountBps(db, scope, wallet) {
  if (!enabled() || typeof wallet !== 'string') return 0;
  if (!creatorTables) { creatorTables = !!(await db.query("SELECT to_regclass('ryo_creators') IS NOT NULL AS t", [])).rows[0]?.t; if (!creatorTables) return 0; }
  const creator = (await db.query("SELECT id FROM ryo_creators WHERE scope=$1 AND wallet=$2 AND status='APPROVED'", [scope, wallet])).rows[0];
  if (!creator) return 0;
  if (!await hasFounderTable(db)) return CREATOR_DISCOUNT_BPS;
  const boosted = (await db.query(`SELECT 1 FROM ryo_founder_purchases f WHERE f.scope=$1 AND f.status='confirmed' AND f.wallet IN (
      SELECT wallet FROM ryo_creator_referrals WHERE scope=$1 AND creator_id=$2
      UNION SELECT wallet FROM ryo_player_referrals WHERE scope=$1 AND referrer=$3) LIMIT 1`, [scope, creator.id, wallet])).rows.length > 0;
  return boosted ? CREATOR_FOUNDER_DISCOUNT_BPS : CREATOR_DISCOUNT_BPS;
}
async function applyCreatorDiscount(db, scope, wallet, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const bps = await creatorDiscountBps(db, scope, wallet);
  if (bps) profile.creatorDiscountBps = bps; else delete profile.creatorDiscountBps;
  return profile;
}
/** Synchronous part used by economy.cjs quote(): only the server-written profile value counts. */
function creatorDiscount(profile, product) {
  const bps = profile?.creatorDiscountBps;
  if ((bps !== CREATOR_DISCOUNT_BPS && bps !== CREATOR_FOUNDER_DISCOUNT_BPS) || !CREATOR_DISCOUNTED.includes(product) || !enabled()) return { bps: 0, label: '' };
  return { bps, label: 'Creator −' + bps / 100 + '%' };
}
async function commission(store, c, r, source, kind, srMilli) {
  const founder = await founderBuyer(store, c, r.wallet), percent = founder ? FOUNDER_COMMISSION_PERCENT : COMMISSION_PERCENT;
  const cp = BigInt(srMilli) * percent / 100n;
  const created = await query(c, `INSERT INTO ryo_creator_commissions(scope,source_id,creator_id,wallet,kind,sr_milli,cp_milli,created)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING source_id`, [store.scope, source, r.creator_id, r.wallet, kind, String(srMilli), String(cp), store.now()]);
  if (created.length) await ledger(store, c, r.creator_id, 'commission:' + source, kind + '-commission', cp, BigInt(srMilli), { referral: privateId(r.wallet), percent: Number(percent) });
  // The referral's earlier 5% commissions (if any) are raised in the same transaction. A savepoint keeps any top-up error from
  // failing the player's claim or purchase settlement; the dashboard / redemption / admin top-up then credits it later.
  if (founder) {
    await c.query('SAVEPOINT founder_topup');
    try { await topUpFounderCommissions(store, c, { creatorId: r.creator_id, wallet: r.wallet }); await c.query('RELEASE SAVEPOINT founder_topup'); }
    catch { await c.query('ROLLBACK TO SAVEPOINT founder_topup'); await c.query('RELEASE SAVEPOINT founder_topup'); }
  }
}
/** Raises every commission earned at 5% from a Founder-box referral to exactly floor(SR x 10%): one extra ledger row per commission
 *  (event 'topup:<source>', UNIQUE, so it is credited at most once), credited to the creator's balance in the same transaction.
 *  Original commission rows are never edited. The creator row is locked FOR NO KEY UPDATE (the same lock the balance UPDATE
 *  takes, so it never conflicts with the key-share locks of other referrals' commission inserts), one creator at a time in id
 *  order, so concurrent settlements and top-ups cannot deadlock. Returns the CP (milli) credited by this run. */
async function topUpFounderCommissions(store, c, { creatorId = null, wallet = null } = {}) {
  if (!await hasFounderTable(c)) return 0n;
  if (!creatorId && !wallet) {   // every creator (staff view): one creator at a time, ascending id
    const ids = (await query(c, `SELECT DISTINCT m.creator_id FROM ryo_creator_commissions m WHERE m.scope=$1 AND m.cp_milli < m.sr_milli*10/100
      AND EXISTS(SELECT 1 FROM ryo_founder_purchases f WHERE f.scope=m.scope AND f.wallet=m.wallet AND f.status='confirmed')
      AND NOT EXISTS(SELECT 1 FROM ryo_creator_ledger l WHERE l.scope=m.scope AND l.event_id='topup:'||m.source_id) ORDER BY m.creator_id`, [store.scope])).map(r => r.creator_id);
    let sum = 0n; for (const id of ids) sum += await topUpFounderCommissions(store, c, { creatorId: id }); return sum;
  }
  let total = 0n;
  for (let round = 0; round < 50; round++) {
    const rows = await query(c, `SELECT m.source_id,m.creator_id,m.wallet,m.kind,m.sr_milli,m.cp_milli FROM ryo_creator_commissions m
      WHERE m.scope=$1 AND ($2::text IS NULL OR m.creator_id=$2) AND ($3::text IS NULL OR m.wallet=$3) AND m.cp_milli < m.sr_milli*10/100
        AND EXISTS(SELECT 1 FROM ryo_founder_purchases f WHERE f.scope=m.scope AND f.wallet=m.wallet AND f.status='confirmed')
        AND NOT EXISTS(SELECT 1 FROM ryo_creator_ledger l WHERE l.scope=m.scope AND l.event_id='topup:'||m.source_id)
      ORDER BY m.created,m.source_id LIMIT 500`, [store.scope, creatorId, wallet]);
    if (!rows.length) break;
    for (const id of [...new Set(rows.map(m => m.creator_id))].sort()) await c.query('SELECT 1 FROM ryo_creators WHERE scope=$1 AND id=$2 FOR NO KEY UPDATE', [store.scope, id]);
    for (const m of rows) {
      const delta = BigInt(m.sr_milli) * FOUNDER_COMMISSION_PERCENT / 100n - BigInt(m.cp_milli);
      if (delta > 0n && await ledger(store, c, m.creator_id, 'topup:' + m.source_id, TOPUP_KIND, delta, BigInt(m.sr_milli), { referral: privateId(m.wallet), percent: 10, previousPercent: 5, base: m.kind })) total += delta;
    }
    if (rows.length < 500) break;
  }
  return total;
}

/** Adventure commission for eligible Chest SR spent directly on a game service (chest-spending.cjs), exactly once per spend,
 *  the same commission a claim of that SR would have paid (5%, or 10% for a Founder-box referral). */
async function chestCommission(store, c, wallet, source, eligibleMilli) {
  const r = await referral(store, c, wallet); if (!r?.qualified || !(BigInt(eligibleMilli) > 0n)) return;
  if (!await recordEvent(store, c, 'chest-settlement:' + source, wallet, 'chest-settlement', { eligibleMilli: String(eligibleMilli) })) return;
  await commission(store, c, r, source, 'adventure', BigInt(eligibleMilli));
}
// Qualification observes settled server-validated Adventure defeats. It cannot execute attacks,
// consume chakra, accept client stage claims or create a second reward simulation.
async function beginAdventure(store, c, wallet, profile, old, active, report) {
  const r = await referral(store, c, wallet); if (!r) { await require('./player-referrals.cjs').beginAdventure(store, c, wallet, profile, active, report); return null; }
  if (!r.stage5) {
    const verified=(await query(c,'SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2',[store.scope,wallet]))[0]?.data;
    const d = advanceProof(store, profile, r.proof, active, report, verified);
    // A map value of 5 means entered; 100 verified defeats means stage 5 actually cleared.
    if (number(d.kills) >= 100) {
      r.stage5 = store.now();
      await recordEvent(store, c, 'stage5:' + wallet, wallet, 'server-stage-clear', { clearedStage: 5, kills: d.kills, verifier: 'settled-combat-v1' });
    }
    await c.query('UPDATE ryo_creator_referrals SET proof=$3,stage5=$4 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(d), r.stage5 || null]);
    await qualify(store, c, r, old?.pending || 0);
  }
  if (r.qualified) await initLots(store, c, r, old?.pending || 0);
  const parts = [];
  return { r, parts, onReward(amount, at) {
    if (!(amount > 0) || !r.qualified) return;
    const eligible = at > number(r.qualified) && at < number(r.expires);
    const last = parts[parts.length - 1]; if (last?.eligible === eligible) last.amount += amount; else parts.push({ eligible, amount, at });
  } };
}
async function endAdventure(store, c, wallet, tracking, claimed, claimId) {
  if (!tracking?.r.qualified) return;
  const { r, parts } = tracking;
  if (claimed) {
    if (!claimId) fail('The Adventure settlement event is missing.', 503);
    if (!await recordEvent(store, c, 'claim-settlement:' + claimId, wallet, 'claim-settlement', { claimed })) return;
  }
  for (const part of parts) {
    const last = (await query(c, 'SELECT id,eligible FROM ryo_creator_adventure_lots WHERE scope=$1 AND wallet=$2 ORDER BY id DESC LIMIT 1 FOR UPDATE', [store.scope, wallet]))[0];
    if (last && last.eligible === part.eligible) await c.query('UPDATE ryo_creator_adventure_lots SET remaining=remaining+$2 WHERE id=$1', [last.id, String(Math.floor(part.amount))]);
    else await c.query(`INSERT INTO ryo_creator_adventure_lots(scope,wallet,event_id,remaining,eligible,created)
      VALUES($1,$2,$3,$4,$5,$6)`, [store.scope, wallet, 'earned:' + id(), String(Math.floor(part.amount)), part.eligible, part.at]);
  }
  if (!claimed) return;
  let left = BigInt(claimed) * UNIT, eligible = 0n;
  const lots = await query(c, 'SELECT * FROM ryo_creator_adventure_lots WHERE scope=$1 AND wallet=$2 AND remaining>0 ORDER BY id FOR UPDATE', [store.scope, wallet]);
  for (const lot of lots) {
    if (!left) break;
    const take = BigInt(lot.remaining) < left ? BigInt(lot.remaining) : left;
    left -= take; if (lot.eligible) eligible += take;
    await c.query('UPDATE ryo_creator_adventure_lots SET remaining=remaining-$2 WHERE id=$1', [lot.id, String(take)]);
  }
  if (eligible) await commission(store, c, r, 'claim:' + claimId, 'adventure', eligible);
}

async function summary(store, wallet, origin, body = {}) {
  await initialize(store);
  let creator = await creatorByWallet(store, store.pool, wallet);
  // A creator never sees (or spends) a balance missing the Founder-box top-up.
  if (creator?.status === 'APPROVED' && await store.transaction(c => topUpFounderCommissions(store, c, { creatorId: creator.id })) > 0n) creator = await creatorByWallet(store, store.pool, wallet);
  const result = { ...await publicInfo(store, origin), creator: publicCreator(creator), termsAccepted: !!creator?.application?.termsAt };
  try { result.adminRole = adminRole(wallet); } catch { result.adminRole = null; }
  const ownReferral = await referral(store, store.pool, wallet, false);
  result.attribution = ownReferral ? { referral: privateId(wallet), paidMints: ownReferral.paid_mints, stage5: !!ownReferral.stage5, qualified: ownReferral.qualified, appeal: ownReferral.appeal } : null;
  if (creator?.status !== 'APPROVED') return result;
  const args = [store.scope, creator.id], offset = page(body) * 20;
  const linkStats = async (sql, key) => (await query(store.pool, 'SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE qualified IS NOT NULL) AS qualified,COUNT(*) FILTER(WHERE qualified IS NULL) AS pending ' + sql, [store.scope, key]))[0];
  // One count per creator: creator-link referrals plus any remaining player-link referrals (already rewarded with hero passes).
  const viaCreator = await linkStats('FROM ryo_creator_referrals WHERE scope=$1 AND creator_id=$2', creator.id), viaPlayer = await linkStats('FROM ryo_player_referrals WHERE scope=$1 AND referrer=$2', creator.wallet);
  const counts = s => ({ total: number(s.total), qualified: number(s.qualified), pending: number(s.pending) }), cl = counts(viaCreator), pl = counts(viaPlayer);
  const stats = { total: cl.total + pl.total, qualified: cl.qualified + pl.qualified, pending: cl.pending + pl.pending, creatorLink: cl, playerLink: pl };
  const [points] = await query(store.pool, `SELECT COALESCE(SUM(delta) FILTER(WHERE delta>0),0) AS earned,COALESCE(-SUM(delta) FILTER(WHERE kind='redemption'),0) AS redeemed,
    COALESCE(SUM(delta) FILTER(WHERE kind = ANY($3)),0) AS commission FROM ryo_creator_ledger WHERE scope=$1 AND creator_id=$2`, [...args, COMMISSION_KINDS]);
  // Provisional pending commission: 10% of eligible unclaimed Adventure earnings of Founder-box referrals, 5% of the rest.
  const founderLots = await hasFounderTable(store.pool) ? "EXISTS(SELECT 1 FROM ryo_founder_purchases f WHERE f.scope=r.scope AND f.wallet=r.wallet AND f.status='confirmed')" : 'FALSE';
  const [pending] = await query(store.pool, `SELECT COALESCE(SUM(l.remaining) FILTER(WHERE NOT ${founderLots}),0) AS n,COALESCE(SUM(l.remaining) FILTER(WHERE ${founderLots}),0) AS founder
    FROM ryo_creator_adventure_lots l JOIN ryo_creator_referrals r ON r.scope=l.scope AND r.wallet=l.wallet
    WHERE r.scope=$1 AND r.creator_id=$2 AND l.eligible AND l.remaining>0`, args);
  const referrals = await query(store.pool, `SELECT wallet,paid_mints,stage5,qualified,expires,attributed,via FROM (
    SELECT wallet,paid_mints,stage5,qualified,expires,attributed,'creator' AS via FROM ryo_creator_referrals WHERE scope=$1 AND creator_id=$2
    UNION ALL SELECT wallet,paid_mints,stage5,qualified,NULL::bigint AS expires,attributed,'player' AS via FROM ryo_player_referrals WHERE scope=$1 AND referrer=$4) x
    ORDER BY attributed DESC,wallet LIMIT 20 OFFSET $3`, [...args, offset, creator.wallet]);
  const entries = await query(store.pool, 'SELECT sequence,kind,delta,source_sr,detail,created FROM ryo_creator_ledger WHERE scope=$1 AND creator_id=$2 ORDER BY sequence DESC LIMIT 20 OFFSET $3', [...args, offset]);
  const redemptions = await query(store.pool, 'SELECT id,item_id,price,status,result,created FROM ryo_creator_redemptions WHERE scope=$1 AND creator_id=$2 ORDER BY created DESC,id LIMIT 20 OFFSET $3', [...args, offset]);
  const shop = await query(store.pool, "SELECT * FROM ryo_creator_shop WHERE scope=$1 AND id='hero-pass' ORDER BY price,id", [store.scope]);
  const [used] = await query(store.pool, "SELECT COUNT(*) AS n FROM ryo_creator_redemptions r JOIN ryo_creator_shop s ON s.scope=r.scope AND s.id=r.item_id WHERE r.scope=$1 AND s.kind='hero' AND r.season=$2 AND r.status='fulfilled'", [store.scope, result.rules.season]);
  const creatorDiscountPercent = await creatorDiscountBps(store.pool, store.scope, wallet) / 100;
  return { ...result, stats, creatorDiscountPercent, points: { balanceMilli: String(creator.balance), earnedMilli: String(points.earned), redeemedMilli: String(points.redeemed), commissionMilli: String(points.commission), pendingMilli: String(BigInt(pending.n) * COMMISSION_PERCENT / 100n + BigInt(pending.founder) * FOUNDER_COMMISSION_PERCENT / 100n) },
    link: origin.replace(/\/$/, '') + '/?creator=' + creator.code, referrals: referrals.map(r => ({ ...r, wallet: undefined, player: privateId(r.wallet) })), ledger: entries.map(r => ({ ...r, detail: { referral: r.detail.referral, item: r.detail.item, version: r.detail.version, percent: r.detail.percent, base: r.detail.base, reasonCode: r.detail.reasonCode } })),
    redemptions, shop: shop.map(s => ({ ...s, price: String(s.price), remaining: s.supply - s.used, delivery: s.kind === 'hero' ? 'in-game hero' : 'cosmetic' })),
    seasonRemaining: Math.max(0, result.rules.promotionalSupply - number(used.n)), page: page(body) };
}
async function redeem(store, wallet, body) {
  const redemptionId = requestId(body.requestId), itemId = text(body.itemId, 60);
  if (itemId !== 'hero-pass') fail('This reward has been retired from the Creator Shop.', 409);
  return store.transaction(async c => {
    // All redemptions lock the same program row first: global seasonal supply cannot race.
    const { config } = await program(store, c, true);
    await store.locked(c, wallet); const creator = await approved(store, c, wallet, true);
    if (!creator.application?.termsAt) fail('Accept the Creator Program Terms before redeeming rewards.', 409);
    // The balance spent below always includes the Founder-box top-up (the creator row is already locked by this transaction).
    if (await topUpFounderCommissions(store, c, { creatorId: creator.id }) > 0n) creator.balance = (await creatorByWallet(store, c, wallet)).balance;
    const old = (await query(c, 'SELECT * FROM ryo_creator_redemptions WHERE scope=$1 AND id=$2', [store.scope, redemptionId]))[0];
    if (old) { if (old.creator_id !== creator.id || old.item_id !== itemId) fail('Request ID belongs to another redemption.', 409); return { redemption: old, replay: true }; }
    const item = (await query(c, 'SELECT * FROM ryo_creator_shop WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, itemId]))[0];
    if (!item?.enabled || item.used >= item.supply) fail('This reward is unavailable or sold out. No CP was deducted.', 409);
    if (body.version !== item.version || String(body.expectedPriceMilli) !== String(item.price)) fail('Shop price or rules changed. Review the item again.', 409);
    if (BigInt(creator.balance) < BigInt(item.price)) fail('Not enough Creator Points.', 409);
    const now = store.now(), month = new Date(now); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
    const [monthly] = await query(c, "SELECT COUNT(*) AS n FROM ryo_creator_redemptions WHERE scope=$1 AND creator_id=$2 AND item_id=$3 AND created>=$4 AND status='fulfilled'", [store.scope, creator.id, itemId, month.getTime()]);
    if (number(monthly.n) >= item.monthly_limit) fail('Your monthly limit for this reward has been reached.', 409);
    if ((await query(c, "SELECT 1 FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1", [store.scope, wallet])).length) fail('Recover the pending game purchase before redeeming.', 409);
    const profile = await store.profileLocked(c, wallet); let result;
    if (item.kind === 'hero') {
      const [supply] = await query(c, "SELECT COUNT(*) AS n FROM ryo_creator_redemptions r JOIN ryo_creator_shop s ON s.scope=r.scope AND s.id=r.item_id WHERE r.scope=$1 AND r.season=$2 AND r.status='fulfilled' AND s.kind='hero'", [store.scope, config.season]);
      if (number(supply.n) >= config.promotionalSupply) fail('The seasonal promotional hero supply is sold out. No CP was deducted.', 409);
      if (profile.heroes.length >= 500) fail('Your collection is full. Free a hero slot before redeeming.', 409);
      const economy = require('./economy.cjs'), q = economy.quote({ ...profile, mythicPerk: false }, 'summon', { quantity: 1 });
      const fulfillment = economy.fulfill(profile, q, now), hero = fulfillment.result.outputs[0];
      hero.creatorReward = true; hero.creatorRedemption = redemptionId;
      profile.heroes.push(hero); result = { kind: 'hero', outputs: [hero], nftMintAddress: null, delivery: 'Regular in-game Shrine hero; not an on-chain NFT' };
    } else {
      if (!['aura', 'frame', 'bomb', 'badge'].includes(item.kind)) fail('This reward has no configured delivery adapter.', 503);
      profile.creatorCosmetics ||= {}; if (profile.creatorCosmetics[item.kind]) fail('You already own this cosmetic.', 409);
      profile.creatorCosmetics[item.kind] = item.id; result = { kind: item.kind, cosmetic: item.id };
    }
    await ledger(store, c, creator.id, 'redeem:' + redemptionId, 'redemption', -BigInt(item.price), 0n, { item: itemId, version: item.version });
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
    await c.query('UPDATE ryo_creator_shop SET used=used+1 WHERE scope=$1 AND id=$2', [store.scope, itemId]);
    await c.query(`INSERT INTO ryo_creator_redemptions(scope,id,creator_id,wallet,item_id,price,item_version,status,result,season,created)
      VALUES($1,$2,$3,$4,$5,$6,$7,'fulfilled',$8,$9,$10)`, [store.scope, redemptionId, creator.id, wallet, itemId, item.price, item.version, JSON.stringify(result), config.season, now]);
    await audit(store, c, wallet, 'shop.redeemed', creator.id, 'Creator Shop redemption', { redemptionId, itemId, pointsMilli: String(item.price) });
    return { redemption: { id: redemptionId, item_id: itemId, price: String(item.price), status: 'fulfilled', result, created: now } };
  });
}

async function adminSnapshot(store, wallet, body) {
  const role = adminRole(wallet);
  await store.transaction(c => topUpFounderCommissions(store, c));   // balances shown to staff include every owed top-up
  const offset = page(body) * 20, search = typeof body.search === 'string' ? body.search.trim().slice(0, 80) : '';
  const creators = await query(store.pool, `SELECT * FROM ryo_creators WHERE scope=$1 AND (wallet ILIKE $2 OR display_name ILIKE $2 OR code ILIKE $2) ORDER BY created DESC,id LIMIT 20 OFFSET $3`, [store.scope, '%' + search + '%', offset]);
  const refs = await query(store.pool, `SELECT r.*,c.display_name FROM ryo_creator_referrals r JOIN ryo_creators c ON c.scope=r.scope AND c.id=r.creator_id WHERE r.scope=$1 AND (r.wallet ILIKE $2 OR c.display_name ILIKE $2) ORDER BY r.attributed DESC,r.wallet LIMIT 20 OFFSET $3`, [store.scope, '%' + search + '%', offset]);
  const [capacity] = await query(store.pool, `SELECT (SELECT COALESCE(SUM(balance),0) FROM ryo_creators WHERE scope=$1) AS outstanding,
    (SELECT COUNT(*) FROM ryo_creator_referrals WHERE scope=$1 AND qualified IS NULL) AS potential_milestones,
    (SELECT COUNT(*) FROM ryo_creator_redemptions WHERE scope=$1 AND status='fulfilled') AS redemptions`, [store.scope]);
  const audits = await query(store.pool, 'SELECT * FROM ryo_creator_audit WHERE scope=$1 ORDER BY sequence DESC LIMIT 40 OFFSET $2', [store.scope, offset]);
  // Registered players with no referrer in either program (newest first), for the manual referral tool.
  const unreferred = role === 'approver' && await hasTable(store.pool, 'ryo_players') ? await query(store.pool, `SELECT p.username,p.wallet,p.created FROM ryo_players p WHERE p.scope=$1 AND (p.username ILIKE $2 OR p.wallet ILIKE $2)
    AND NOT EXISTS(SELECT 1 FROM ryo_player_referrals r WHERE r.scope=p.scope AND r.wallet=p.wallet) AND NOT EXISTS(SELECT 1 FROM ryo_creator_referrals r WHERE r.scope=p.scope AND r.wallet=p.wallet)
    AND NOT EXISTS(SELECT 1 FROM ryo_creator_wallets w WHERE w.scope=p.scope AND w.wallet=p.wallet) ORDER BY p.created DESC,p.wallet LIMIT 20 OFFSET $3`, [store.scope, '%' + search + '%', offset]) : [];
  const entries = body.creatorId ? await query(store.pool, 'SELECT * FROM ryo_creator_ledger WHERE scope=$1 AND creator_id=$2 ORDER BY sequence DESC LIMIT 40 OFFSET $3', [store.scope, text(body.creatorId, 80), offset]) : [];
  const signals = await query(store.pool, `SELECT creator_id,COUNT(*) AS recent_referrals FROM ryo_creator_referrals WHERE scope=$1 AND attributed>=$2 GROUP BY creator_id HAVING COUNT(*)>=10 ORDER BY COUNT(*) DESC LIMIT 20`, [store.scope, store.now() - DAY]);
  return { role, creators: creators.map(r => ({ ...publicCreator(r), wallet: r.wallet, application: r.application, reviewedBy: r.reviewed_by })), referrals: refs.map(r => ({ ...r, proof: { kills: r.proof?.kills || 0, verifiedStage: r.proof?.map || 1 } })), capacity,
    program: await program(store), shop: await query(store.pool, "SELECT * FROM ryo_creator_shop WHERE scope=$1 AND id='hero-pass' ORDER BY id", [store.scope]), audits, unreferred, ledger: entries, signals: signals.map(r => ({ ...r, signal: 'High referral enrollment in 24 hours; review, not proof of abuse' })), page: page(body) };
}
async function adminAction(store, wallet, body) {
  const access = adminRole(wallet, true), action = text(body.operation, 40), reason = text(body.reason, 500);
  if (['adjust', 'config', 'shop', 'manual-add', 'attribute-referral'].includes(action) && access !== 'approver') fail('An approver role is required for CP, inventory and program changes.', 403);
  // Owner request 2026-11-10: staff link a player to a referrer by hand (e.g. players who used a mistyped link). The game's own
  // attribute() runs with opts.staff (new-player rule and enrollment pause skipped; permanence, self, cycles, creator identities
  // and the enrollment limit kept), then the audit record is written.
  if (action === 'attribute-referral') {
    const player = await resolvePlayer(store, body.player), code = referralCodeOf(body.code);
    const result = await attribute(store, player.wallet, { code }, { staff: true, onLinked: async (c, existing) => audit(store, c, wallet, 'admin.attribute-referral', privateId(player.wallet), reason,
      { code, username: player.username, wallet: player.wallet, existing, staffOverride: true, founderBuyer: await founderBuyer(store, c, player.wallet) }) });
    return { ok: true, existing: !!result?.existing, player: privateId(player.wallet), username: player.username };
  }
  return store.transaction(async c => {
    const p = await program(store, c, true); let target = body.creatorId || 'program', detail = {};
    if (action === 'manual-add') {
      const address = walletAddress(body.wallet);
      if (await creatorByWallet(store, c, address) || await referral(store, c, address) || await require('./player-referrals.cjs').referral(store, c, address) || (await query(c, 'SELECT 1 FROM ryo_creator_wallets WHERE scope=$1 AND wallet=$2', [store.scope, address])).length) fail('This wallet already has a creator or referral identity.', 409);
      const creatorId = id(); target = creatorId;
      await c.query(`INSERT INTO ryo_creators(scope,id,wallet,display_name,status,code,reviewed_by,created,reviewed,application) VALUES($1,$2,$3,$4,'APPROVED',$5,$6,$7,$7,$8)`, [store.scope, creatorId, address, text(body.displayName, 60), codeFor(), wallet, store.now(), JSON.stringify({ manual: true, termsRequired: true })]);
      await c.query('INSERT INTO ryo_creator_wallets(scope,wallet,creator_id) VALUES($1,$2,$3)', [store.scope, address, creatorId]); detail = { wallet: address };
      detail.convertedPlayerReferrals = await convertPlayerReferrals(store, c, (await query(c, 'SELECT * FROM ryo_creators WHERE scope=$1 AND id=$2', [store.scope, creatorId]))[0]);
    } else if (action === 'status') {
      const creator = (await query(c, 'SELECT * FROM ryo_creators WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, text(body.creatorId, 80)]))[0];
      if (!creator) fail('Creator not found.', 404);
      const transitions = { PENDING: ['APPROVED', 'REJECTED'], APPROVED: ['SUSPENDED'], REJECTED: ['APPROVED'], SUSPENDED: ['APPROVED'] };
      if (!transitions[creator.status]?.includes(body.status)) fail('Invalid creator status transition.', 409);
      // Approval never changes the creator's OWN attribution (who referred them). Their own eligible
      // player-link referrals join the Creator Program (convertPlayerReferrals).
      const attribution = body.status === 'APPROVED' ? (await query(c,
        "SELECT 'creator' AS kind, creator_id AS referrer FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2 UNION ALL SELECT 'player' AS kind, referrer FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2", [store.scope, creator.wallet])) : [];
      await c.query('UPDATE ryo_creators SET status=$3,reviewed_by=$4,reviewed=$5,public_note=$6 WHERE scope=$1 AND id=$2', [store.scope, creator.id, body.status, wallet, store.now(), body.publicNote ? text(body.publicNote, 240) : '']); detail = { previous: creator.status, status: body.status, preservedAttribution: attribution };
      if (body.status === 'APPROVED') detail.convertedPlayerReferrals = await convertPlayerReferrals(store, c, { ...creator, status: 'APPROVED' });
    } else if (action === 'adjust') {
      const creatorId = text(body.creatorId, 80), delta = integer(body.deltaMilli, -1000000000000, 1000000000000); if (!delta) fail('An adjustment must be non-zero.');
      const key = requestId(body.requestId); await ledger(store, c, creatorId, 'adjust:' + key, 'adjustment', BigInt(delta), 0n, { reason, actor: wallet, reasonCode: text(body.reasonCode, 40) }); detail = { deltaMilli: delta, event: key };
    } else if (action === 'config') {
      if (body.version !== p.version) fail('Program configuration changed. Refresh before saving.', 409);
      const v = body.config || {};
      if (typeof v.applicationsPaused !== 'boolean' || typeof v.enrollmentPaused !== 'boolean' || !Array.isArray(v.eligibleProducts) || v.eligibleProducts.some(x => !PRODUCTS.includes(x)) || new Set(v.eligibleProducts).size !== v.eligibleProducts.length) fail('Invalid creator program configuration.');
      const cfg = { applicationsPaused: v.applicationsPaused, enrollmentPaused: v.enrollmentPaused, enrollmentLimit: integer(v.enrollmentLimit, 0, 1000000), commissionDays: integer(v.commissionDays, 1, 365), eligibleProducts: v.eligibleProducts,
        season: text(v.season, 40), promotionalSupply: integer(v.promotionalSupply, 0, 1000000) };
      await c.query('UPDATE ryo_creator_program SET config=$2,version=version+1 WHERE scope=$1', [store.scope, JSON.stringify(cfg)]); detail = { previous: p.config, next: cfg };
    } else if (action === 'shop') {
      const itemId = text(body.itemId, 60), price = integer(body.priceCp, 1, 1000000000), supply = integer(body.supply, 0, 1000000), monthly = integer(body.monthlyLimit, 1, 100);
      if (typeof body.enabled !== 'boolean') fail('Choose an enabled state.');
      const item = (await query(c, 'SELECT * FROM ryo_creator_shop WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, itemId]))[0];
      if (itemId !== 'hero-pass') fail('This reward has been retired from the Creator Shop.', 409);
      if (!item || item.version !== body.version || supply < item.used) fail('Item changed, is unavailable, or supply is below fulfilled rewards.', 409);
      await c.query('UPDATE ryo_creator_shop SET price=$3,supply=$4,monthly_limit=$5,enabled=$6,version=version+1 WHERE scope=$1 AND id=$2', [store.scope, itemId, price * 1000, supply, monthly, body.enabled]); detail = { itemId, price, supply, monthly, enabled: body.enabled };
    } else if (action === 'review-referral') {
      const address = walletAddress(body.wallet), risk = body.risk ? text(body.risk, 500) : '';
      const row = await referral(store, c, address); if (!row) fail('Referral not found.', 404);
      await c.query('UPDATE ryo_creator_referrals SET risk=$3 WHERE scope=$1 AND wallet=$2', [store.scope, address, risk]); target = privateId(address); detail = { risk, previous: row.risk, appeal: row.appeal };
    } else fail('Unknown creator administrator operation.');
    await audit(store, c, wallet, 'admin.' + action, target, reason, detail); return { ok: true };
  });
}
async function migrate(store, wallet, body) {
  return store.transaction(async c => {
    await program(store, c, true);
    if (body.accept === true) {
      const r = (await query(c, 'SELECT * FROM ryo_creator_migrations WHERE scope=$1 AND id=$2 FOR UPDATE', [store.scope, text(body.id, 80)]))[0];
      if (!r || r.new_wallet !== wallet || r.accepted || number(r.expires) <= store.now()) fail('Migration is unavailable or expired.', 409);
      if ((await query(c, 'SELECT 1 FROM ryo_creator_wallets WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).length || await referral(store, c, wallet) || await require('./player-referrals.cjs').referral(store, c, wallet) || (await query(c, 'SELECT 1 FROM ryo_player_referrers WHERE scope=$1 AND wallet=$2', [store.scope, wallet])).length) fail('The receiving wallet already has a creator/referral identity.', 409);
      const creator = await approved(store, c, r.old_wallet, true); if (creator.id !== r.creator_id) fail('Creator identity changed.', 409);
      if ((await query(c, "SELECT 1 FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending'", [store.scope, r.old_wallet])).length) fail('Settle the old wallet pending purchase first.', 409);
      // CP/referrals follow the creator ID. Game assets and Ryo do not silently move wallets.
      await c.query('INSERT INTO ryo_creator_wallets(scope,wallet,creator_id) VALUES($1,$2,$3)', [store.scope, wallet, creator.id]);
      await c.query('UPDATE ryo_creators SET wallet=$3 WHERE scope=$1 AND id=$2', [store.scope, creator.id, wallet]);
      await c.query('UPDATE ryo_creator_migrations SET accepted=$3 WHERE scope=$1 AND id=$2', [store.scope, r.id, store.now()]);
      await audit(store, c, wallet, 'wallet.migrated', creator.id, 'Both wallets authenticated; destination accepted a pending migration', { from: r.old_wallet, to: wallet }); return { ok: true };
    }
    const creator = await approved(store, c, wallet, true), destination = walletAddress(body.wallet);
    if (destination === wallet) fail('Choose a different receiving wallet.');
    const migrationId = id();
    await c.query('INSERT INTO ryo_creator_migrations(scope,id,creator_id,old_wallet,new_wallet,expires,created) VALUES($1,$2,$3,$4,$5,$6,$7)', [store.scope, migrationId, creator.id, wallet, destination, store.now() + 15 * 60000, store.now()]);
    await audit(store, c, wallet, 'wallet.migration-requested', creator.id, 'Authenticated source requested wallet migration', { to: destination, id: migrationId });
    return { migrationId, expires: store.now() + 15 * 60000 };
  });
}
async function handle(ctx, wallet, action, body = {}) {
  if (!enabled()) fail('Creators Portal is not enabled on this server.', 503);
  const { store, origin } = ctx;
  if (action === 'creator-public') return publicInfo(store, origin);
  if (action === 'creator-state') return summary(store, wallet, origin, body);
  if (action === 'creator-player-state') return require('./player-referrals.cjs').summary(store, wallet, origin, body);
  if (action === 'creator-player-claim') return require('./player-referrals.cjs').claim(store, wallet, body);
  if (action === 'creator-terms') {
    if (body.terms !== true) fail('Accept the Creator Program Terms.');
    return store.transaction(async c => { const creator = await approved(store, c, wallet, true); await c.query('UPDATE ryo_creators SET application=$3 WHERE scope=$1 AND id=$2', [store.scope, creator.id, JSON.stringify({ ...creator.application, termsAt: store.now(), termsVersion: 1 })]); await audit(store, c, wallet, 'terms.accepted', creator.id, 'Honest marketing and referral disclosure accepted'); return { ok: true }; });
  }
  if (action === 'creator-apply') return application(store, wallet, body);
  if (action === 'creator-attribute') return attribute(store, wallet, body);
  if (action === 'creator-redeem') return redeem(store, wallet, body);
  if (action === 'creator-migrate') return migrate(store, wallet, body);
  if (action === 'creator-admin') { await initialize(store); return adminSnapshot(store, wallet, body); }
  if (action === 'creator-admin-action') { await initialize(store); return adminAction(store, wallet, body); }
  if (action === 'creator-appeal') { const message = text(body.message, 1000); return store.transaction(async c => { await store.locked(c, wallet); const r = await referral(store, c, wallet); const creator = !r && await creatorByWallet(store, c, wallet, true); if (!r && !creator) fail('No creator application or referral attribution found.', 404); if (r?.appeal || creator?.application?.appeal) fail('An appeal is already recorded. An administrator will review it.', 409); if (r) await c.query('UPDATE ryo_creator_referrals SET appeal=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, message]); else await c.query('UPDATE ryo_creators SET application=$3 WHERE scope=$1 AND id=$2', [store.scope, creator.id, JSON.stringify({ ...creator.application, appeal: { message, at: store.now() } })]); await audit(store, c, wallet, 'review.appeal', creator?.id || privateId(wallet), 'Player submitted an appeal', { message }); return { ok: true }; }); }
  fail('Unknown Creators Portal action.', 404);
}
module.exports = { convertPlayerReferrals, syncApprovedCreators, program, audit, assertNewPlayer, paidSummonQuantity, advanceProof, MARKER, DEFAULTS, UNIT, ITEMS, enabled, handle, initialize, publicInfo, application, attribute, settledPurchase, beginAdventure, endAdventure, summary, redeem, adminAction, adminSnapshot, migrate, ledger, recordEvent, qualify, privateId, adminRole, COMMISSION_PERCENT, FOUNDER_COMMISSION_PERCENT, TOPUP_KIND, founderBuyer, topUpFounderCommissions, chestCommission, creatorDiscountBps, applyCreatorDiscount, creatorDiscount, CREATOR_DISCOUNTED };
