'use strict';
/* Shinobi Command Center, Phase 2: Founder operations (READ-ONLY).
 *
 * Copied to app/server/command-center-founders.cjs by apply-command-center.cjs and called only from the
 * Command Center dispatcher (command-center.cjs), after the staff wallet's role has been checked.
 *
 * It reads the Founder sale and benefit tables written by founders.cjs and, on request, finalized Solana
 * account state for the Founder NFT mints. It never writes: no INSERT/UPDATE/DELETE, no transaction, no
 * signing, no reward, no entitlement change. founders.cjs stays the only code that grants Founder benefits.
 *
 *   collections  supply / sold / reserved / expired per tier, gross receipts, optional on-chain mint check
 *   lookup       one buyer's purchase evidence, entitlement, grants, summons, Sensei and audit (by wallet,
 *                mint address, or tier + serial such as "mythic #5")
 *   integrity    reconciliation checks that should always be empty (missing or duplicate entitlements,
 *                pass accounting, premium over-claims, Sensei discounts, profile tier drift, Market listings)
 *   access       Early Access and Founder's Council eligibility (buyer-bound) beside the current NFT holder
 *   weeks        Premium Summon qualifying-week tracker; the Weekly Mission Pass is not implemented
 *
 * Benefits are bound to the ORIGINAL BUYER (owner decision 2026-11-09): the current on-chain holder is shown
 * as information only and changes nothing. */
const DAY = 86400000, WEEK = 7 * DAY;
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const RANKS = ['Genin', 'Chunin', 'Jonin', 'Elite', 'Legend', 'Mythic'];
const F = () => require('./founders.cjs');
const num = v => (v === null || v === undefined ? null : Number(v));
const sol = lamports => Number(lamports) / 1e9;
const nowOf = store => (store.now ? store.now() : Date.now());
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
/** Runs the given query thunks one after another (the game shares this small connection pool). */
const seq = async list => { const out = []; for (const q of list) out.push(await q()); return out; };
const rows = async (store, sql, args = []) => (await store.pool.query(sql, [store.scope, ...args])).rows;
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/* ---------- On-chain Founder mint state (finalized, read-only, cached) ---------- */
const CHAIN_TTL_MS = 10 * 60000, CHAIN_MIN_REFRESH_MS = 60000, CHAIN_FAIL_TTL_MS = 60000, CHAIN_BUDGET_MS = 25000, CHAIN_PARALLEL = 4;
const chainCache = new Map();   // scope -> { at, ttl, data } | { pending }
function within(promise, deadline) {
  let t; const left = Math.max(1, deadline - Date.now());
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(Object.assign(Error('timeout'), { timeout: true })), left); })]).finally(() => clearTimeout(t));
}
async function parallel(tasks, n) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (i < tasks.length) await tasks[i++](); })); }
async function readChain(ctx) {
  const { store, connection } = ctx, { PublicKey } = require('@solana/web3.js'), deadline = Date.now() + CHAIN_BUDGET_MS;
  // The RPC must be the cluster this build serves, or every mint would look missing.
  if (typeof ctx.checkNetwork === 'function') await within(ctx.checkNetwork(), deadline);
  // Mints come from our own confirmed purchase rows, never from the request (at most 63 by the database constraints).
  const list = await rows(store, "SELECT wallet,tier,serial,mint FROM ryo_founder_purchases WHERE scope=$1 AND status='confirmed' ORDER BY tier,serial");
  const keys = list.map(r => { try { return new PublicKey(r.mint); } catch { return null; } });   // a malformed stored address is reported, not fatal
  const ok = list.map((_, i) => i).filter(i => keys[i]), mintInfo = new Array(list.length);
  for (let i = 0; i < ok.length; i += 100) {
    const part = ok.slice(i, i + 100), v = (await within(connection.getMultipleParsedAccounts(part.map(j => keys[j]), { commitment: 'finalized' }), deadline)).value;
    if (!Array.isArray(v)) throw Error('unexpected RPC answer');
    part.forEach((j, k) => { mintInfo[j] = v[k]; });
  }
  // The holder's token account: the one account holding the single unit (undefined = lookup failed or skipped).
  const largest = new Array(list.length); let partial = false;
  await parallel(ok.map(i => async () => {
    if (Date.now() >= deadline) { partial = true; return; }   // past the time budget: no new request goes out
    try { largest[i] = (await within(connection.getTokenLargestAccounts(keys[i], 'finalized'), deadline)).value.find(a => String(a.amount) === '1')?.address || null; }
    catch { largest[i] = undefined; partial = true; }
  }), CHAIN_PARALLEL);
  const holderKeys = largest.filter(Boolean), holderInfo = new Map();
  for (let i = 0; i < holderKeys.length; i += 100) {
    const v = (await within(connection.getMultipleParsedAccounts(holderKeys.slice(i, i + 100), { commitment: 'finalized' }), deadline)).value;
    if (!Array.isArray(v)) throw Error('unexpected RPC answer');
    v.forEach((a, j) => holderInfo.set(holderKeys[i + j].toBase58(), a));
  }
  const mints = {};
  list.forEach((r, i) => {
    const m = mintInfo[i], p = m?.data?.parsed?.info, issues = [];
    if (!keys[i] || !m) issues.push('NFT_MINT_MISSING');
    else {
      if (m.owner?.toBase58?.() !== TOKEN_2022) issues.push('NFT_WRONG_PROGRAM');
      if (!p || String(p.supply) !== '1' || Number(p.decimals) !== 0) issues.push('NFT_SUPPLY_MISMATCH');
      if (p && p.mintAuthority !== null && p.mintAuthority !== undefined) issues.push('NFT_MINT_AUTHORITY_OPEN');
    }
    let holder = null, holderStatus;
    if (!keys[i] || largest[i] === undefined) holderStatus = 'unavailable';
    else if (largest[i] === null) holderStatus = m ? 'none' : 'unavailable';
    else {
      const info = holderInfo.get(largest[i].toBase58())?.data?.parsed?.info;
      holder = info && String(info.tokenAmount?.amount) === '1' && WALLET_RE.test(String(info.owner)) ? String(info.owner) : null;
      holderStatus = !holder ? 'unavailable' : holder === r.wallet ? 'buyer' : 'transferred';
    }
    mints[r.mint] = { tier: r.tier, serial: Number(r.serial), buyer: r.wallet, holder, holderStatus, supply: p ? String(p.supply) : null, decimals: p ? Number(p.decimals) : null, mintAuthority: p ? (p.mintAuthority ?? null) : null, issues };
  });
  return { status: 'ready', partial, observedAt: nowOf(store), checked: list.length, mints };
}
/** Cached chain state. `refresh` re-reads when the cache is at least a minute old; one read per scope at a time.
 * With `read:false` this never waits and never starts a read: it returns what is cached (or "not checked"). */
async function chain(ctx, { read = true, refresh = false } = {}) {
  const { store } = ctx, key = store.scope, now = nowOf(store), hit = chainCache.get(key);
  if (!read) return hit?.data || { status: 'not_checked', mints: {} };
  if (hit?.pending) return hit.pending;
  const fresh = hit?.data && now - hit.at < hit.ttl;
  if (fresh && !(refresh && now - hit.at >= CHAIN_MIN_REFRESH_MS)) return hit.data;
  if (!ctx.connection || typeof ctx.connection.getMultipleParsedAccounts !== 'function') return { status: 'unavailable', note: 'No Solana connection is available on this server.', mints: {} };
  const pending = readChain(ctx).then(
    // A partial answer (some holder lookups failed or were skipped) is kept for a minute only, then read again.
    data => { chainCache.set(key, { at: nowOf(store), ttl: data.partial ? CHAIN_FAIL_TTL_MS : CHAIN_TTL_MS, data }); return data; },
    e => { const data = { status: 'unavailable', observedAt: nowOf(store), note: e.timeout ? 'Solana RPC did not answer in time.' : e.status ? 'The Solana RPC is not the cluster this build serves.' : 'Solana RPC request failed.', mints: hit?.data?.mints || {} };
      chainCache.set(key, { at: nowOf(store), ttl: CHAIN_FAIL_TTL_MS, data }); return data; });
  chainCache.set(key, { ...(hit || {}), pending });
  return pending;
}
function chainSummary(c) {
  const list = Object.entries(c.mints || {}).map(([mint, m]) => ({ mint, ...m }));
  const issues = {}; for (const m of list) for (const code of m.issues) issues[code] = (issues[code] || 0) + 1;
  return { status: c.status, observedAt: num(c.observedAt), note: c.note || null, checked: list.length, transferred: list.filter(m => m.holderStatus === 'transferred').length,
    issues, mints: list.sort((a, b) => a.tier.localeCompare(b.tier) || a.serial - b.serial) };
}

/* ---------- Collections ---------- */
async function collections(ctx, body = {}) {
  const { store } = ctx, f = F();
  const byTier = await rows(store, 'SELECT tier,status,COUNT(*) AS n,COALESCE(SUM(price_lamports),0) AS lamports FROM ryo_founder_purchases WHERE scope=$1 GROUP BY tier,status');
  const tiers = Object.values(f.TIERS).map(t => {
    const get = s => byTier.find(r => r.tier === t.key && r.status === s), sold = Number(get('confirmed')?.n || 0), reserved = Number(get('pending')?.n || 0);
    return { key: t.key, name: t.name, supply: t.supply, sold, reserved, expired: Number(get('expired')?.n || 0), remaining: Math.max(0, t.supply - sold - reserved),
      soldOut: sold >= t.supply, offerPrice: sol(t.prelaunchLamports), regularPrice: sol(t.lamports), grossConfirmedSol: sol(get('confirmed')?.lamports || 0) };
  });
  const sw = f.switches();
  const c = await chain(ctx, { read: body.chain === true, refresh: body.refresh === true });
  // Sale pause = the Founder sales switch (Command Center owner) or the emergency pause key "founders" (same rule as founders.cjs).
  let paused = null;
  try {
    const own = (await rows(store, 'SELECT paused FROM ryo_founder_control WHERE scope=$1'))[0]?.paused === true;
    const emergency = !!(await rows(store, 'SELECT pauses FROM ryo_admin_control WHERE scope=$1'))[0]?.pauses?.founders;
    paused = own || emergency;
  } catch { /* control tables missing: unknown, shown as not available */ }
  return {
    tiers, totalSupply: f.TOTAL_SUPPLY, mode: f.saleMode(), paused,
    switches: { publicSale: sw.publicSale, privateTesting: sw.privateTesting, redemption: sw.redemption, senseiSol: sw.senseiSol },
    chain: chainSummary(c),
    notes: ['Supply and prices are fixed in founders.cjs (Mythic ' + f.TIERS.mythic.supply + ', Legacy ' + f.TIERS.legacy.supply + '). The Command Center specification proposed 30 + 30; the configured supply is shown here.',
      'Gross receipts are the recorded sale prices of confirmed purchases. Network fees and wallet balances are not included.',
      'Benefits stay with the original buyer. A transferred NFT is information only.'],
  };
}

/* ---------- Integrity checks (all should be empty) ---------- */
const CHECKS = [
  ['CONFIRMED_WITHOUT_ENTITLEMENT', 'crit', 'Confirmed purchase with no entitlement row', s => rows(s, `SELECT p.wallet,p.tier,p.serial,p.mint,p.request_id FROM ryo_founder_purchases p LEFT JOIN ryo_founder_entitlements e ON e.scope=p.scope AND e.request_id=p.request_id
     WHERE p.scope=$1 AND p.status='confirmed' AND e.wallet IS NULL`)],
  ['ENTITLEMENT_WITHOUT_PURCHASE', 'crit', 'Entitlement without a matching confirmed purchase (wallet, tier and mint)', s => rows(s, `SELECT e.wallet,e.tier,e.mint,e.request_id FROM ryo_founder_entitlements e LEFT JOIN ryo_founder_purchases p ON p.scope=e.scope AND p.request_id=e.request_id
     AND p.status='confirmed' AND p.wallet=e.wallet AND p.tier=e.tier AND p.mint=e.mint WHERE e.scope=$1 AND p.request_id IS NULL`)],
  ['DUPLICATE_WALLET_PURCHASE', 'crit', 'Wallet with more than one confirmed Founder purchase', s => rows(s, "SELECT wallet,COUNT(*)::int AS n FROM ryo_founder_purchases WHERE scope=$1 AND status='confirmed' GROUP BY wallet HAVING COUNT(*)>1")],
  ['DUPLICATE_SERIAL', 'crit', 'Serial confirmed more than once in a tier', s => rows(s, "SELECT tier,serial,COUNT(*)::int AS n,array_agg(wallet) AS wallets FROM ryo_founder_purchases WHERE scope=$1 AND status='confirmed' GROUP BY tier,serial HAVING COUNT(*)>1")],
  ['SERIAL_OVER_SUPPLY', 'crit', 'Serial above the tier supply', async s => { const T = F().TIERS; return (await rows(s, "SELECT wallet,tier,serial,status FROM ryo_founder_purchases WHERE scope=$1 AND status IN ('pending','confirmed')")).filter(r => !T[r.tier] || r.serial < 1 || r.serial > T[r.tier].supply); }],
  ['PASS_ACCOUNTING', 'crit', 'Limited Summon Passes left + used does not equal the 10 granted', async s => {
    const list = await rows(s, `SELECT e.wallet,e.activated,e.limited_passes,(SELECT COUNT(*) FROM ryo_founder_summons m WHERE m.scope=e.scope AND m.wallet=e.wallet AND m.kind='limited')::int AS used
      FROM ryo_founder_entitlements e WHERE e.scope=$1`);
    const P = F().LIMITED_PASSES;
    return list.filter(r => (r.activated == null ? Number(r.limited_passes) !== 0 || r.used !== 0 : Number(r.limited_passes) + r.used !== P)).map(r => ({ wallet: r.wallet, activated: num(r.activated), left: Number(r.limited_passes), used: r.used, expected: r.activated == null ? 0 : P }));
  }],
  ['SUMMON_WITHOUT_ACTIVATION', 'crit', 'Founder summon by a wallet that never activated (or has no entitlement)', s => rows(s, `SELECT m.wallet,m.kind,m.request_id,m.created FROM ryo_founder_summons m LEFT JOIN ryo_founder_entitlements e ON e.scope=m.scope AND e.wallet=m.wallet
     WHERE m.scope=$1 AND (e.wallet IS NULL OR e.activated IS NULL OR m.created<e.activated)`)],
  ['SUMMON_RANK_OUT_OF_POOL', 'crit', 'Summoned rank outside its pool (Limited: Chunin-Legend; Premium: Elite-Legend)', s => rows(s, "SELECT wallet,kind,rank,request_id FROM ryo_founder_summons WHERE scope=$1 AND ((kind='limited' AND rank NOT BETWEEN 1 AND 4) OR (kind='premium' AND rank NOT IN (3,4)))")],
  ['PREMIUM_OVERCLAIM', 'crit', 'More Premium Summons than completed qualifying weeks allow', async s => {
    const f = F(), now = nowOf(s), out = [];
    for (const e of await rows(s, "SELECT e.wallet,e.tier,e.activated,(SELECT COUNT(*) FROM ryo_founder_summons m WHERE m.scope=e.scope AND m.wallet=e.wallet AND m.kind='premium')::int AS claimed FROM ryo_founder_entitlements e WHERE e.scope=$1 AND e.activated IS NOT NULL")) {
      const every = f.TIERS[e.tier].premiumEveryWeeks, weeks = await f.qualifyingWeeks(s.pool, s.scope, e.wallet, Number(e.activated), now);
      if (e.claimed > Math.floor(weeks / every)) out.push({ wallet: e.wallet, tier: e.tier, weeks, everyWeeks: every, claimed: e.claimed, allowed: Math.floor(weeks / every) });
    }
    return out;
  }],
  ['PREMIUM_PERIOD_GAP', 'warn', 'Premium Summon periods are not numbered 1, 2, 3…', async s => (await rows(s, "SELECT wallet,COUNT(*)::int AS n,MAX(period)::int AS top FROM ryo_founder_summons WHERE scope=$1 AND kind='premium' GROUP BY wallet")).filter(r => r.n !== r.top)],
  ['SENSEI_DISCOUNT_WITHOUT_TRIAL', 'crit', 'Discounted SOL Sensei outside a running Legacy trial, or price and discount flag disagree', async s => {
    const list = await rows(s, `SELECT x.request_id,x.wallet,x.price_lamports,x.founder_discount,x.status,x.created,e.tier,e.trial_started,e.trial_ends FROM ryo_sensei_sol_purchases x
      LEFT JOIN ryo_founder_entitlements e ON e.scope=x.scope AND e.wallet=x.wallet WHERE x.scope=$1 AND x.status<>'expired'`);
    const F2 = F();
    return list.filter(r => {
      const discounted = Number(r.price_lamports) === F2.SENSEI_LEGACY_LAMPORTS;
      if (discounted !== r.founder_discount) return true;
      if (!r.founder_discount) return false;
      return !(r.tier === 'legacy' && r.trial_started != null && Number(r.created) >= Number(r.trial_started) && Number(r.created) < Number(r.trial_ends));
    }).map(r => ({ wallet: r.wallet, requestId: r.request_id, price: sol(r.price_lamports), founderDiscount: r.founder_discount, status: r.status, created: Number(r.created), tier: r.tier || null }));
  }],
  ['SENSEI_PAID_BY_MYTHIC', 'warn', 'Mythic Founder (Sensei included) also paid SOL for Sensei', s => rows(s, `SELECT x.wallet,x.request_id,x.status,x.created FROM ryo_sensei_sol_purchases x JOIN ryo_founder_entitlements e ON e.scope=x.scope AND e.wallet=x.wallet
     WHERE x.scope=$1 AND e.tier='mythic' AND x.status='confirmed'`)],
  ['TRIAL_RULE', 'warn', 'Sensei trial not exactly 7 days, or on a Mythic entitlement, or before activation', async s => (await rows(s, 'SELECT wallet,tier,activated,trial_started,trial_ends FROM ryo_founder_entitlements WHERE scope=$1 AND trial_started IS NOT NULL'))
    .filter(r => r.tier !== 'legacy' || Number(r.trial_ends) - Number(r.trial_started) !== F().SENSEI_TRIAL_MS || r.activated == null || Number(r.trial_started) < Number(r.activated))
    .map(r => ({ wallet: r.wallet, tier: r.tier, started: num(r.trial_started), ends: num(r.trial_ends), activated: num(r.activated) }))],
  ['TIER_WITHOUT_ENTITLEMENT', 'crit', 'Game profile carries a Founder tier (discounts) but the wallet has no Founder purchase', s => rows(s, `SELECT p.wallet,p.data->>'founderTier' AS tier FROM ryo_profiles p
     LEFT JOIN ryo_founder_entitlements e ON e.scope=p.scope AND e.wallet=p.wallet WHERE p.scope=$1 AND p.data->>'founderTier' IS NOT NULL AND e.wallet IS NULL`)],
  ['TIER_ON_SUSPENDED', 'warn', 'Suspended entitlement whose profile still carries the Founder tier', s => rows(s, `SELECT p.wallet,p.data->>'founderTier' AS tier,e.revoked FROM ryo_profiles p
     JOIN ryo_founder_entitlements e ON e.scope=p.scope AND e.wallet=p.wallet WHERE p.scope=$1 AND e.revoked IS NOT NULL AND p.data->>'founderTier' IS NOT NULL`)],
  ['TIER_OUT_OF_SYNC', 'info', 'Valid entitlement whose profile tier differs (corrected on the player\'s next game load)', s => rows(s, `SELECT p.wallet,p.data->>'founderTier' AS profile_tier,e.tier FROM ryo_profiles p
     JOIN ryo_founder_entitlements e ON e.scope=p.scope AND e.wallet=p.wallet WHERE p.scope=$1 AND e.revoked IS NULL AND (p.data->>'founderTier') IS DISTINCT FROM e.tier`)],
  ['FOUNDER_HEROES_ON_MARKET', 'warn', 'Founder bonus or Founder-summoned hero on sale on the Market (the Market does not block them yet)', s => rows(s, `SELECT id,seller,status,rank,hero->>'tokenId' AS hero,COALESCE(hero->>'founderGrant',hero->>'founderSummon','bound') AS kind,created FROM ryo_market_listings
     WHERE scope=$1 AND status IN ('active','pending') AND (hero->>'founderGrant' IS NOT NULL OR hero->>'founderSummon' IS NOT NULL OR hero->>'founderBound' IS NOT NULL) ORDER BY created DESC`)],
  ['STALE_PENDING', 'warn', 'Founder reservation pending for more than 30 minutes', s => rows(s, "SELECT wallet,tier,serial,request_id,created FROM ryo_founder_purchases WHERE scope=$1 AND status='pending' AND created<$2 ORDER BY created", [nowOf(s) - 30 * 60000])],
];
const clean = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));
/* The database checks are cached for 30 seconds per scope (one run at a time): they scan the Founder tables and the profiles'
 * JSON, and the game shares the same small connection pool, so a few clicks on the Integrity tab must not queue game requests.
 * The cache keeps every finding (capped), not just the 20 shown, so a wallet's own findings are never cut off. */
const CHECK_TTL_MS = 30000, FOUND_CAP = 2000, checkCache = new Map();   // scope -> { at, pending, data }
async function runChecks(store) {
  const hit = checkCache.get(store.scope), now = nowOf(store);
  if (hit?.pending) return hit.pending;
  if (hit?.data && now - hit.at < CHECK_TTL_MS) return hit.data;
  const pending = (async () => {
    const out = [];
    for (const [code, severity, title, run] of CHECKS) {
      try { const found = (await run(store)).map(clean); out.push({ code, severity, title, status: 'ready', count: found.length, found: found.slice(0, FOUND_CAP) }); }
      catch (e) { out.push({ code, severity, title, status: 'unavailable', count: null, found: [], note: e.code === '42P01' ? 'A table this check needs does not exist in this database.' : 'The check could not run.' }); }
    }
    return out;
  })().then(data => { checkCache.set(store.scope, { at: nowOf(store), data }); return data; }, e => { checkCache.delete(store.scope); throw e; });
  checkCache.set(store.scope, { ...(hit || {}), pending });
  return pending;
}
function chainChecks(c) {
  const s = chainSummary(c), out = [];
  for (const [code, title] of [['NFT_MINT_MISSING', 'Founder mint account not found on chain'], ['NFT_SUPPLY_MISMATCH', 'Founder mint supply is not exactly 1 (0 decimals)'], ['NFT_MINT_AUTHORITY_OPEN', 'Founder mint still has a mint authority'], ['NFT_WRONG_PROGRAM', 'Founder mint is not a Token-2022 account']]) {
    const found = s.mints.filter(m => m.issues.includes(code)).map(m => ({ tier: m.tier, serial: m.serial, mint: m.mint, buyer: m.buyer, supply: m.supply, mintAuthority: m.mintAuthority }));
    out.push({ code, severity: 'crit', title: title + ' (on-chain check of ' + new Date(s.observedAt).toISOString().slice(0, 16) + ' UTC)', status: c.status === 'ready' ? 'ready' : 'unavailable', count: found.length, found });
  }
  return out;
}
async function allChecks(ctx) {
  const checks = [...await runChecks(ctx.store)], c = await chain(ctx, { read: false });
  if (c.status === 'ready' || Object.keys(c.mints || {}).length) checks.push(...chainChecks(c));
  else checks.push({ code: 'NFT_ON_CHAIN', severity: 'info', title: 'On-chain mint checks', status: 'not_checked', count: null, found: [], note: 'Run "Check on chain" in Collections to add the mint supply and authority checks.' });
  return checks;
}
async function integrity(ctx) {
  const all = await allChecks(ctx), checks = all.map(({ found, ...c }) => ({ ...c, sample: found.slice(0, 20) }));
  const failing = checks.filter(c => c.status === 'ready' && c.count > 0);
  return { checks, summary: { crit: failing.filter(c => c.severity === 'crit').length, warn: failing.filter(c => c.severity === 'warn').length, info: failing.filter(c => c.severity === 'info').length, unavailable: checks.filter(c => c.status === 'unavailable').length } };
}
/** Findings that name this wallet (as buyer, seller or one of several wallets), from the full list. */
async function findingsFor(ctx, wallet) {
  return (await allChecks(ctx)).filter(k => k.status === 'ready' && k.found.some(s => s.wallet === wallet || s.seller === wallet || s.buyer === wallet || (Array.isArray(s.wallets) && s.wallets.includes(wallet))))
    .map(k => ({ code: k.code, severity: k.severity, title: k.title }));
}

/* ---------- Lookup: one buyer ---------- */
const SERIAL_RE = /^(mythic|legacy)\s*[#-]?\s*(\d{1,3})$/i;
async function lookup(ctx, body = {}) {
  const { store } = ctx, f = F(), now = nowOf(store), raw = typeof body.query === 'string' ? body.query.trim() : '';
  if (!raw) fail('Enter a buyer wallet, a Founder NFT mint address, or a tier and serial such as "mythic #5".');
  let wallet = null, by = null;
  const serial = raw.match(SERIAL_RE);
  if (serial) {
    const tier = serial[1].toLowerCase(), n = Number(serial[2]);
    if (n < 1 || n > f.TIERS[tier].supply) fail('Serials run from 1 to ' + f.TIERS[tier].supply + ' for ' + f.TIERS[tier].name + '.');
    wallet = (await rows(store, "SELECT wallet FROM ryo_founder_purchases WHERE scope=$1 AND tier=$2 AND serial=$3 AND status IN ('confirmed','pending') ORDER BY status LIMIT 1", [tier, n]))[0]?.wallet || null;
    by = 'serial';
  } else if (WALLET_RE.test(raw)) {
    const m = (await rows(store, 'SELECT wallet FROM ryo_founder_purchases WHERE scope=$1 AND mint=$2 LIMIT 1', [raw]))[0];
    wallet = m ? m.wallet : raw; by = m ? 'mint' : 'wallet';
  } else fail('Search by a full wallet or mint address, or a tier and serial such as "mythic #5".');
  if (!wallet) return { found: false, by, query: raw };
  const [purchases, entRows, summons, sensei, auditRows, profileRow, market, weeksRows] = await seq([
    () => rows(store, 'SELECT request_id,tier,serial,mint,price_lamports,status,signature,created,settled FROM ryo_founder_purchases WHERE scope=$1 AND wallet=$2 ORDER BY created DESC LIMIT 20', [wallet]),
    () => rows(store, 'SELECT * FROM ryo_founder_entitlements WHERE scope=$1 AND wallet=$2', [wallet]),
    () => rows(store, 'SELECT request_id,kind,period,rank,roll,hero,created FROM ryo_founder_summons WHERE scope=$1 AND wallet=$2 ORDER BY created DESC LIMIT 50', [wallet]),
    () => rows(store, 'SELECT request_id,price_lamports,founder_discount,status,signature,created,settled FROM ryo_sensei_sol_purchases WHERE scope=$1 AND wallet=$2 ORDER BY created DESC LIMIT 10', [wallet]),
    () => rows(store, 'SELECT actor,action,target,detail,created FROM ryo_founder_audit WHERE scope=$1 AND (target=$2 OR actor=$2) ORDER BY id DESC LIMIT 30', [wallet]),
    () => rows(store, 'SELECT data FROM ryo_profiles WHERE scope=$1 AND wallet=$2', [wallet]),
    () => rows(store, "SELECT id,status,rank,hero->>'tokenId' AS hero,created FROM ryo_market_listings WHERE scope=$1 AND seller=$2 AND (hero->>'founderGrant' IS NOT NULL OR hero->>'founderSummon' IS NOT NULL OR hero->>'founderBound' IS NOT NULL) ORDER BY created DESC LIMIT 20", [wallet]).catch(() => null),
    () => rows(store, 'SELECT week FROM ryo_founder_weeks WHERE scope=$1 AND wallet=$2 ORDER BY week DESC LIMIT 12', [wallet]),
  ]);
  // A wallet with no Founder purchase, entitlement, summon, Sensei payment, or profile tier has nothing to show.
  if (!purchases.length && !entRows.length && !summons.length && !sensei.length && !profileRow[0]?.data?.founderTier) return { found: false, by, query: raw, wallet };
  const e = entRows[0] || null, profile = profileRow[0]?.data || null, t = e ? f.TIERS[e.tier] : null;
  const heroes = Array.isArray(profile?.heroes) ? profile.heroes.filter(h => h && (h.founderGrant || h.founderSummon || h.founderBound)).map(h => ({ tokenId: h.tokenId, name: h.name, rank: h.rank, rankName: RANKS[h.rank] || String(h.rank), source: h.founderBound ? 'buyer-bound Tsukiyomi' : h.founderGrant ? 'activation grant' : 'Founder ' + h.founderSummon + ' summon' })) : [];
  let premium = null;
  if (e && e.activated != null) {
    const weeks = await f.qualifyingWeeks(store.pool, store.scope, wallet, Number(e.activated), now), claimed = summons.filter(s => s.kind === 'premium').length, every = t.premiumEveryWeeks;
    const available = Math.max(0, Math.floor(weeks / every) - claimed);
    premium = { everyWeeks: every, qualifyingWeeks: weeks, claimed, available, nextUnlockInWeeks: available ? 0 : (claimed + 1) * every - weeks, activeThisWeek: weeksRows.some(r => Number(r.week) === f.weekStart(now)) };
  }
  const c = await chain(ctx, { read: false }), onChain = e ? c.mints?.[e.mint] || null : null;
  // Per-wallet integrity: the global checks, filtered to this wallet.
  const issues = await findingsFor(ctx, wallet);
  return {
    found: true, by, query: raw, wallet,
    purchases: purchases.map(r => ({ requestId: r.request_id, tier: r.tier, serial: Number(r.serial), mint: r.mint, price: sol(r.price_lamports), status: r.status, signature: r.signature, created: Number(r.created), settled: num(r.settled) })),
    entitlement: e && { tier: e.tier, name: t.name, mint: e.mint, granted: Number(e.granted), activated: num(e.activated), revoked: num(e.revoked), revokedReason: e.revoked_reason, valid: e.revoked == null,
      limitedPasses: Number(e.limited_passes), trial: e.trial_started != null ? { started: Number(e.trial_started), ends: Number(e.trial_ends), running: now < Number(e.trial_ends) } : null,
      perks: { discountPercent: t.discountBps / 100, chestCooldownHours: e.revoked == null && f.switches().redemption ? 12 : 24, sensei: t.sensei, council: t.council, missionPass: t.missionPass } },
    profile: profile ? { founderTier: profile.founderTier || null, sensei: profile.sensei === true, senseiSource: profile.senseiSource || null, senseiRentalUntil: num(profile.senseiRentalUntil) } : null,
    heroes, premium,
    summons: summons.map(s => ({ requestId: s.request_id, kind: s.kind, period: num(s.period), rank: Number(s.rank), rankName: RANKS[s.rank], roll: Number(s.roll), hero: s.hero?.tokenId || null, created: Number(s.created) })),
    sensei: sensei.map(r => ({ requestId: r.request_id, price: sol(r.price_lamports), founderDiscount: r.founder_discount, status: r.status, signature: r.signature, created: Number(r.created), settled: num(r.settled) })),
    market: market === null ? null : market.map(r => ({ id: r.id, status: r.status, rank: Number(r.rank), hero: r.hero, created: Number(r.created) })),
    audit: auditRows.map(r => ({ actor: r.actor, action: r.action, target: r.target, detail: r.detail, created: Number(r.created) })),
    chain: onChain ? { holder: onChain.holder, holderStatus: onChain.holderStatus, issues: onChain.issues, observedAt: num(c.observedAt) } : { holderStatus: c.status === 'ready' ? 'unavailable' : 'not_checked' },
    issues,
    notes: ['Read-only. Benefits are granted only by the buyer\'s own signed-in actions in the game.', 'Summon rolls are the stored server draws (0-9999); they are not verifiable randomness receipts.'],
  };
}

/* ---------- Early Access and Founder's Council eligibility ---------- */
async function access(ctx) {
  const { store } = ctx, f = F(), c = await chain(ctx, { read: false });
  const list = await rows(store, `SELECT e.wallet,e.tier,e.mint,e.activated,e.revoked,p.serial FROM ryo_founder_entitlements e
    LEFT JOIN ryo_founder_purchases p ON p.scope=e.scope AND p.request_id=e.request_id WHERE e.scope=$1 ORDER BY e.tier,p.serial`);
  const out = list.map(r => { const m = c.mints?.[r.mint];
    return { wallet: r.wallet, tier: r.tier, serial: num(r.serial), mint: r.mint, valid: r.revoked == null, activated: num(r.activated),
      council: r.revoked == null ? f.TIERS[r.tier].council : 'none', earlyAccess: r.revoked == null ? 'eligible' : 'suspended',
      holderStatus: m ? m.holderStatus : 'not_checked', holder: m ? m.holder : null };
  });
  return { members: out, counts: { full: out.filter(m => m.council === 'full').length, community: out.filter(m => m.council === 'community').length, suspended: out.filter(m => !m.valid).length },
    chain: { status: c.status, observedAt: num(c.observedAt) },
    notes: ['Eligibility follows the original buyer (owner decision 2026-11-09); the current holder is shown for information.',
      'No Early Access dates are scheduled, and a Founder NFT never opens the game: access stays with the release stage and PRELAUNCH_MODE.',
      'Founder\'s Council votes are not implemented. The Council is advisory only, with no authority over treasury, emissions or governance.'] };
}

/* ---------- Premium Summon weeks (and the Weekly Mission Pass status) ---------- */
async function weeks(ctx) {
  const { store } = ctx, f = F(), now = nowOf(store), current = f.weekStart(now);
  const ents = await rows(store, `SELECT e.wallet,e.tier,e.activated,e.revoked,(SELECT COUNT(*) FROM ryo_founder_summons m WHERE m.scope=e.scope AND m.wallet=e.wallet AND m.kind='premium')::int AS claimed,
    (SELECT MAX(week) FROM ryo_founder_weeks w WHERE w.scope=e.scope AND w.wallet=e.wallet) AS last_week FROM ryo_founder_entitlements e WHERE e.scope=$1 AND e.activated IS NOT NULL ORDER BY e.tier,e.activated`);
  const members = [];
  for (const e of ents) {
    const every = f.TIERS[e.tier].premiumEveryWeeks, done = await f.qualifyingWeeks(store.pool, store.scope, e.wallet, Number(e.activated), now), available = Math.max(0, Math.floor(done / every) - e.claimed);
    members.push({ wallet: e.wallet, tier: e.tier, valid: e.revoked == null, activated: Number(e.activated), everyWeeks: every, qualifyingWeeks: done, claimed: e.claimed, available,
      nextUnlockInWeeks: available ? 0 : (e.claimed + 1) * every - done, lastActiveWeek: num(e.last_week), activeThisWeek: num(e.last_week) === current });
  }
  const hist = await rows(store, 'SELECT week,COUNT(*)::int AS n FROM ryo_founder_weeks WHERE scope=$1 AND week>=$2 GROUP BY week ORDER BY week DESC', [current - 11 * WEEK]);
  return { currentWeek: current, members, history: hist.map(r => ({ week: Number(r.week), activeFounders: r.n })),
    rules: { reset: 'Monday 00:00 UTC', mythicEveryWeeks: f.TIERS.mythic.premiumEveryWeeks, legacyEveryWeeks: f.TIERS.legacy.premiumEveryWeeks, pool: f.PREMIUM_POOL.map(([r, w]) => ({ rank: RANKS[r], percent: w / 100 })),
      qualifying: 'A week counts once it has fully ended and the Founder played Adventure in it (founders.cjs recordActivity).' },
    missionPass: { status: 'not_implemented', note: 'The Weekly Mission Pass (missions, XP, fragments) has no backend yet. Its design and the Legacy Basic rewards are waiting for owner decisions.' } };
}

module.exports = { collections, integrity, lookup, access, weeks, chain, CHECKS, _chainCache: chainCache };
