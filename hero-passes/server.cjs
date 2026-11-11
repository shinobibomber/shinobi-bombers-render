'use strict';
/* Promotional Standard Hero Passes + bulk distribution (apply-hero-passes.cjs copies this file to app/server/hero-passes.cjs).
 * Owner request 2026-11-11. Ships dormant: four Control-panel switches, all OFF by default (feature-switches catalog):
 *   heroPassAdmin        admin section (campaign rules, scan, preview, history)
 *   heroPassDistribution SEND TO ALL ELIGIBLE PLAYERS / RETRY
 *   heroPassClaimUi      the main-menu CLAIM button and Reward Center
 *   heroPassClaims       claiming entitlements and using passes
 *
 * Distribution and claiming are separate, transactional and idempotent:
 *   Send   → one PENDING entitlement per eligible account (PRIMARY KEY campaign + wallet: one tier per account per campaign;
 *            Tier 1 first, else Tier 2; the snapshot is stored on the campaign and inserted in batches; Retry resumes it).
 *            No pass is usable yet; nothing else changes.
 *   Claim  → the signed-in owner of a PENDING entitlement credits exactly its recorded quantity to an account-bound pass
 *            balance (per campaign, for provenance) in one transaction; a repeat returns the stored result.
 *   Use    → passes become regular Shrine-odds in-game heroes (never Mythic, never Shrine pity, no Ryo/SOL effect), bound to
 *            the account like referral heroes (referralReward: the Market refuses them; Fusion output stays bound).
 * Eligibility (owner decisions 2026-11-11): paid Shrine summons = confirmed 'summon' purchases not paid with free starter Ryo,
 * counted by quantity; deposited holdings = min(current game balance, confirmed deposits - pending/confirmed withdrawals),
 * so claimed Chest rewards and starter Ryo never count. */
const MAX_PASSES = 50, BATCH = 500, MAX_USE = 10, COLLECTION_LIMIT = 500, PAGE = 50;
const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_pass_campaigns (scope TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,config JSONB NOT NULL,
  version INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','distributing','done')),cutoff BIGINT,snapshot JSONB,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,created_by TEXT NOT NULL,created BIGINT NOT NULL,updated BIGINT NOT NULL,PRIMARY KEY(scope,id));
CREATE TABLE IF NOT EXISTS ryo_pass_entitlements (scope TEXT NOT NULL,campaign_id TEXT NOT NULL,wallet TEXT NOT NULL,tier SMALLINT NOT NULL CHECK(tier IN (1,2)),
  tier_name TEXT NOT NULL,passes INTEGER NOT NULL CHECK(passes>0),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','revoked')),
  assigned BIGINT NOT NULL,claimed_at BIGINT,claim_request_id TEXT,evidence JSONB NOT NULL,PRIMARY KEY(scope,campaign_id,wallet));
CREATE TABLE IF NOT EXISTS ryo_pass_balances (scope TEXT NOT NULL,wallet TEXT NOT NULL,campaign_id TEXT NOT NULL,passes INTEGER NOT NULL CHECK(passes>=0),
  used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0 AND used<=passes),updated BIGINT NOT NULL,PRIMARY KEY(scope,wallet,campaign_id));
CREATE TABLE IF NOT EXISTS ryo_pass_redemptions (scope TEXT NOT NULL,wallet TEXT NOT NULL,request_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),
  heroes JSONB NOT NULL,created BIGINT NOT NULL,PRIMARY KEY(scope,wallet,request_id));`;
const DEFAULT_CONFIG = Object.freeze({ tiers: [
  { name: 'Investor Appreciation Reward', passes: 5, minPaidSummons: 15, holdings: { enabled: true, minRyo: 50000 } },
  { name: 'Community Appreciation Reward', passes: 3, minPaidSummons: 15, holdings: { enabled: false, minRyo: 0 } },
] });

function fail(message, status = 400) { throw Object.assign(Error(message), { status }); }
const on = key => require('./feature-switches.cjs').effective(key);
const need = (key, label) => { if (!on(key)) fail(label + ' is not enabled.', 403); };
const requestId = v => typeof v === 'string' && /^[-a-zA-Z0-9_]{16,80}$/.test(v) ? v : fail('Invalid request ID.');
const text = (v, max, label) => typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : fail(label + ' is required (up to ' + max + ' characters).');
const whole = (v, min, max, label) => Number.isSafeInteger(v) && v >= min && v <= max ? v : fail(label + ' must be a whole number between ' + min + ' and ' + max + '.');

/** Server-side rule validation (two tiers; positive pass quantities within the admin safety limit; non-negative thresholds). */
function validateConfig(c) {
  if (!c || !Array.isArray(c.tiers) || c.tiers.length !== 2) fail('Two reward tiers are required.');
  return { tiers: c.tiers.map((t, i) => {
    const n = 'Tier ' + (i + 1) + ' ';
    return { name: text(t?.name, 80, n + 'name'), passes: whole(t.passes, 1, MAX_PASSES, n + 'pass quantity'), minPaidSummons: whole(t.minPaidSummons, 0, 100000, n + 'minimum paid summons'),
      holdings: { enabled: t.holdings?.enabled === true, minRyo: whole(t.holdings?.minRyo ?? 0, 0, 1e12, n + 'minimum deposited holdings') } };
  }) };
}
/** Tier for one account's evidence: Tier 1 first, else Tier 2, else none. Never both. */
function tierFor(config, e) {
  for (let i = 0; i < config.tiers.length; i++) {
    const t = config.tiers[i];
    if (e.paidSummons >= t.minPaidSummons && (!t.holdings.enabled || e.holdingsRyo >= t.holdings.minRyo)) return i + 1;
  }
  return 0;
}
/** Read-only eligibility scan from authoritative records (purchases, deposits, withdrawals, balances). */
async function scan(store, c, config) {
  const min = Math.min(...config.tiers.map(t => t.minPaidSummons));
  const rows = (await c.query(`WITH s AS (SELECT wallet,SUM(CASE WHEN (params->>'quantity') ~ '^[0-9]{1,4}$' THEN (params->>'quantity')::int ELSE 0 END) AS n
      FROM ryo_purchases WHERE scope=$1 AND product='summon' AND status='confirmed' AND COALESCE(quote->>'funding','')<>'bonus' GROUP BY wallet),
    d AS (SELECT wallet,SUM(amount) AS n FROM ryo_deposits WHERE scope=$1 GROUP BY wallet),
    w AS (SELECT wallet,SUM(amount) AS n FROM ryo_withdrawals WHERE scope=$1 AND status IN ('pending','confirmed') GROUP BY wallet)
    SELECT p.wallet,COALESCE(s.n,0) AS summons,COALESCE(a.balance,0) AS balance,COALESCE(d.n,0) AS deposits,COALESCE(w.n,0) AS withdrawals
    FROM ryo_profiles p LEFT JOIN s ON s.wallet=p.wallet LEFT JOIN ryo_accounts a ON a.scope=p.scope AND a.wallet=p.wallet
    LEFT JOIN d ON d.wallet=p.wallet LEFT JOIN w ON w.wallet=p.wallet WHERE p.scope=$1 AND COALESCE(s.n,0)>=$2 ORDER BY p.wallet`, [store.scope, min])).rows;
  const out = [];
  for (const r of rows) {
    const balance = Number(r.balance), net = Number(r.deposits) - Number(r.withdrawals);
    const e = { paidSummons: Number(r.summons), balanceRyo: balance, netDepositsRyo: net, holdingsRyo: Math.max(0, Math.min(balance, net)) };
    const tier = tierFor(config, e);
    if (tier) out.push({ wallet: r.wallet, tier, passes: config.tiers[tier - 1].passes, tierName: config.tiers[tier - 1].name, evidence: e });
  }
  return out;
}
const counts = list => ({ tier1: list.filter(x => x.tier === 1).length, tier2: list.filter(x => x.tier === 2).length, total: list.length,
  passes: list.reduce((n, x) => n + x.passes, 0) });
async function campaign(store, c, id, lock = false) {
  const r = (await c.query('SELECT * FROM ryo_pass_campaigns WHERE scope=$1 AND id=$2' + (lock ? ' FOR UPDATE' : ''), [store.scope, String(id || '')])).rows[0];
  return r || fail('Campaign not found.', 404);
}
const view = r => ({ id: r.id, name: r.name, config: r.config, version: r.version, status: r.status, cutoff: r.cutoff == null ? null : Number(r.cutoff), progress: r.progress, created: Number(r.created), updated: Number(r.updated) });

/* ---------- Admin (approver only; called from creators-portal adminAction with an audit callback) ---------- */
async function admin(store, actor, body, audit) {
  const op = body.operation;
  need('heroPassAdmin', 'Hero Pass administration');
  if (op === 'pass-campaigns') {
    const list = (await store.pool.query('SELECT * FROM ryo_pass_campaigns WHERE scope=$1 ORDER BY created DESC LIMIT 20', [store.scope])).rows.map(view);
    return { campaigns: list, defaults: DEFAULT_CONFIG, switches: { admin: true, distribution: on('heroPassDistribution'), claimUi: on('heroPassClaimUi'), claims: on('heroPassClaims') } };
  }
  if (op === 'pass-campaign-save') {
    const name = text(body.name, 80, 'Campaign name'), config = validateConfig(body.config), now = store.now();
    return store.transaction(async c => {
      if (!body.campaignId) {
        const id = 'cmp-' + require('node:crypto').randomUUID();
        await c.query('INSERT INTO ryo_pass_campaigns(scope,id,name,config,version,status,created_by,created,updated) VALUES($1,$2,$3,$4,1,$5,$6,$7,$7)', [store.scope, id, name, JSON.stringify(config), 'draft', actor, now]);
        await audit(c, 'admin.pass-campaign-created', id, { name, config, version: 1 });
        return { campaign: view(await campaign(store, c, id)) };
      }
      const old = await campaign(store, c, body.campaignId, true);
      if (old.status !== 'draft') fail('This campaign has started distribution; its rules are locked. Create a new campaign.', 409);
      if (body.version !== old.version) fail('These rules were changed elsewhere. Reload and review them again.', 409);
      await c.query('UPDATE ryo_pass_campaigns SET name=$3,config=$4,version=version+1,updated=$5 WHERE scope=$1 AND id=$2', [store.scope, old.id, name, JSON.stringify(config), now]);
      await audit(c, 'admin.pass-campaign-saved', old.id, { name, config, version: old.version + 1, previous: { name: old.name, config: old.config, version: old.version } });
      return { campaign: view(await campaign(store, c, old.id)) };
    });
  }
  if (op === 'pass-scan' || op === 'pass-preview') {
    const r = await campaign(store, store.pool, body.campaignId), list = await scan(store, store.pool, r.config);
    if (op === 'pass-scan') return { campaign: view(r), counts: counts(list) };
    const page = Number.isSafeInteger(body.page) && body.page >= 0 ? body.page : 0;
    return { campaign: view(r), counts: counts(list), page, pages: Math.max(1, Math.ceil(list.length / PAGE)), rows: list.slice(page * PAGE, page * PAGE + PAGE) };
  }
  if (op === 'pass-send' || op === 'pass-retry') {
    need('heroPassDistribution', 'Hero Pass distribution');
    if (op === 'pass-send') {
      if (body.confirm !== 'SEND') fail('Confirm the distribution first.');
      await store.transaction(async c => {
        const r = await campaign(store, c, body.campaignId, true);
        if (r.status !== 'draft') fail('This campaign was already sent. Use Retry for incomplete assignments.', 409);
        if (body.version !== r.version) fail('The rules changed since your preview. Review them again.', 409);
        const list = await scan(store, c, r.config), now = store.now();
        if (Number.isSafeInteger(body.expectedTotal) && body.expectedTotal !== list.length) fail('Eligibility changed since your preview (' + list.length + ' accounts now). Preview again.', 409);
        await c.query("UPDATE ryo_pass_campaigns SET status='distributing',cutoff=$3,snapshot=$4,progress=$5,updated=$3 WHERE scope=$1 AND id=$2",
          [store.scope, r.id, now, JSON.stringify(list), JSON.stringify({ total: list.length, assigned: 0, batches: 0 })]);
        await audit(c, 'admin.pass-distribution-started', r.id, { version: r.version, cutoff: now, ...counts(list) });
      });
    }
    return distribute(store, body.campaignId, audit);
  }
  if (op === 'pass-history') {
    const r = await campaign(store, store.pool, body.campaignId);
    const by = (await store.pool.query('SELECT tier,status,COUNT(*) AS n,SUM(passes) AS passes FROM ryo_pass_entitlements WHERE scope=$1 AND campaign_id=$2 GROUP BY tier,status', [store.scope, r.id])).rows
      .map(x => ({ tier: Number(x.tier), status: x.status, count: Number(x.n), passes: Number(x.passes) }));
    const recent = (await store.pool.query('SELECT wallet,tier,tier_name,passes,status,assigned,claimed_at FROM ryo_pass_entitlements WHERE scope=$1 AND campaign_id=$2 ORDER BY assigned DESC,wallet LIMIT 100', [store.scope, r.id])).rows
      .map(x => ({ wallet: x.wallet, tier: Number(x.tier), tierName: x.tier_name, passes: Number(x.passes), status: x.status, assigned: Number(x.assigned), claimedAt: x.claimed_at == null ? null : Number(x.claimed_at) }));
    const sum = s => by.filter(x => x.status === s).reduce((n, x) => n + x.count, 0), passesOf = s => by.filter(x => x.status === s).reduce((n, x) => n + x.passes, 0);
    return { campaign: view(r), summary: { tier1: by.filter(x => x.tier === 1).reduce((n, x) => n + x.count, 0), tier2: by.filter(x => x.tier === 2).reduce((n, x) => n + x.count, 0),
      pending: sum('pending'), pendingPasses: passesOf('pending'), claimed: sum('claimed'), claimedPasses: passesOf('claimed'), revoked: sum('revoked'),
      failed: Math.max(0, (r.progress?.total || 0) - by.reduce((n, x) => n + x.count, 0)) }, recent };
  }
  fail('Unknown Hero Pass administrator operation.', 404);
}
/** Inserts the stored snapshot as PENDING entitlements in batches (idempotent: re-running only adds what is missing). */
async function distribute(store, id, audit) {
  const head = await campaign(store, store.pool, id);
  if (head.status === 'draft') fail('Send the campaign first.', 409);
  const list = Array.isArray(head.snapshot) ? head.snapshot : [];
  for (let i = 0; i < list.length; i += BATCH) {
    const slice = list.slice(i, i + BATCH);
    await store.transaction(async c => {
      const values = [], args = [store.scope, head.id, Number(head.cutoff)];
      slice.forEach((x, j) => { const k = 4 + j * 5; values.push(`($1,$2,$${k},$${k + 1},$${k + 2},$${k + 3},'pending',$3,$${k + 4})`); args.push(x.wallet, x.tier, x.tierName, x.passes, JSON.stringify(x.evidence)); });
      if (values.length) await c.query('INSERT INTO ryo_pass_entitlements(scope,campaign_id,wallet,tier,tier_name,passes,status,assigned,evidence) VALUES ' + values.join(',') + ' ON CONFLICT (scope,campaign_id,wallet) DO NOTHING', args);
      await c.query("UPDATE ryo_pass_campaigns SET progress=jsonb_set(jsonb_set(progress,'{assigned}',to_jsonb(GREATEST(COALESCE((progress->>'assigned')::int,0),$3::int))),'{batches}',to_jsonb($4::int)),updated=$5 WHERE scope=$1 AND id=$2",
        [store.scope, head.id, Math.min(list.length, i + slice.length), Math.ceil((i + slice.length) / BATCH), store.now()]);
    });
  }
  const assigned = Number((await store.pool.query('SELECT COUNT(*) AS n FROM ryo_pass_entitlements WHERE scope=$1 AND campaign_id=$2', [store.scope, head.id])).rows[0].n);
  await store.transaction(async c => {
    await c.query("UPDATE ryo_pass_campaigns SET status=CASE WHEN $3::int>=$4::int THEN 'done' ELSE status END,progress=jsonb_set(progress,'{assigned}',to_jsonb($3::int)),updated=$5 WHERE scope=$1 AND id=$2",
      [store.scope, head.id, assigned, list.length, store.now()]);
    await audit(c, 'admin.pass-distribution-finished', head.id, { snapshot: list.length, assigned });
  });
  return { campaign: view(await campaign(store, store.pool, head.id)), snapshot: list.length, assigned, missing: Math.max(0, list.length - assigned) };
}

/* ---------- Player ---------- */
async function balanceRows(store, c, wallet, lock = false) {
  return (await c.query('SELECT b.campaign_id,b.passes,b.used,COALESCE(k.created,0) AS created FROM ryo_pass_balances b LEFT JOIN ryo_pass_campaigns k ON k.scope=b.scope AND k.id=b.campaign_id WHERE b.scope=$1 AND b.wallet=$2 ORDER BY created,b.campaign_id' + (lock ? ' FOR UPDATE OF b' : ''), [store.scope, wallet])).rows;
}
const available = rows => rows.reduce((n, r) => n + Number(r.passes) - Number(r.used), 0);
async function playerState(store, wallet) {
  if (!on('heroPassClaimUi')) return { ui: false };
  const ents = (await store.pool.query('SELECT e.campaign_id,k.name AS campaign,e.tier,e.tier_name,e.passes,e.status,e.assigned,e.claimed_at FROM ryo_pass_entitlements e JOIN ryo_pass_campaigns k ON k.scope=e.scope AND k.id=e.campaign_id WHERE e.scope=$1 AND e.wallet=$2 ORDER BY e.assigned DESC LIMIT 50', [store.scope, wallet])).rows
    .map(r => ({ campaignId: r.campaign_id, campaign: r.campaign, tier: Number(r.tier), tierName: r.tier_name, passes: Number(r.passes), status: r.status, assigned: Number(r.assigned), claimedAt: r.claimed_at == null ? null : Number(r.claimed_at) }));
  const uses = (await store.pool.query('SELECT request_id,quantity,heroes,created FROM ryo_pass_redemptions WHERE scope=$1 AND wallet=$2 ORDER BY created DESC LIMIT 20', [store.scope, wallet])).rows
    .map(r => ({ quantity: Number(r.quantity), created: Number(r.created), heroes: (r.heroes || []).map(h => ({ name: h.name, rank: h.rank })) }));
  return { ui: true, claims: on('heroPassClaims'), pending: ents.filter(e => e.status === 'pending'), history: ents.filter(e => e.status !== 'pending'),
    passes: available(await balanceRows(store, store.pool, wallet)), uses };
}
async function claim(store, wallet, body) {
  need('heroPassClaims', 'Reward claiming');
  const id = requestId(body.requestId), campaignId = String(body.campaignId || '');
  return store.transaction(async c => {
    await store.locked(c, wallet);
    const e = (await c.query('SELECT * FROM ryo_pass_entitlements WHERE scope=$1 AND campaign_id=$2 AND wallet=$3 FOR UPDATE', [store.scope, campaignId, wallet])).rows[0];
    if (!e) fail('No reward found for this account.', 404);
    const result = r => ({ campaignId, tier: Number(r.tier), tierName: r.tier_name, passes: Number(r.passes), status: r.status, claimedAt: r.claimed_at == null ? null : Number(r.claimed_at) });
    if (e.status === 'claimed') return { claim: result(e), replay: true };
    if (e.status !== 'pending') fail('This reward is no longer available.', 410);
    const now = store.now();
    await c.query("UPDATE ryo_pass_entitlements SET status='claimed',claimed_at=$4,claim_request_id=$5 WHERE scope=$1 AND campaign_id=$2 AND wallet=$3", [store.scope, campaignId, wallet, now, id]);
    await c.query('INSERT INTO ryo_pass_balances(scope,wallet,campaign_id,passes,used,updated) VALUES($1,$2,$3,$4,0,$5) ON CONFLICT(scope,wallet,campaign_id) DO UPDATE SET passes=ryo_pass_balances.passes+$4,updated=$5', [store.scope, wallet, campaignId, Number(e.passes), now]);
    return { claim: result({ ...e, status: 'claimed', claimed_at: now }), passes: available(await balanceRows(store, c, wallet)) };
  });
}
async function redeem(store, wallet, body) {
  need('heroPassClaims', 'Hero Pass use');
  const id = requestId(body.requestId), quantity = whole(body.quantity, 1, MAX_USE, 'Pass quantity');
  return store.transaction(async c => {
    await store.locked(c, wallet);
    const old = (await c.query('SELECT quantity,heroes FROM ryo_pass_redemptions WHERE scope=$1 AND wallet=$2 AND request_id=$3', [store.scope, wallet, id])).rows[0];
    if (old) { if (Number(old.quantity) !== quantity) fail('This request was already used for a different amount.', 409); return { heroes: old.heroes, replay: true, passes: available(await balanceRows(store, c, wallet)) }; }
    if ((await c.query("SELECT 1 FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1", [store.scope, wallet])).rows.length) fail('Wait for the pending purchase to settle before using Hero Passes.', 409);
    const rows = await balanceRows(store, c, wallet, true);
    if (available(rows) < quantity) fail('Not enough Hero Passes.', 409);
    const profile = await store.profileLocked(c, wallet);
    if (profile.heroes.length + quantity > COLLECTION_LIMIT) fail('Your collection is full. Free hero slots before using Hero Passes.', 409);
    const economy = require('./economy.cjs'), now = store.now(), heroes = [];
    let left = quantity;
    for (const r of rows) {
      const take = Math.min(left, Number(r.passes) - Number(r.used)); if (!take) continue;
      for (let i = 0; i < take; i++) {
        const q = economy.quote({ ...profile, mythicPerk: false }, 'summon', { quantity: 1 });
        const hero = economy.fulfill(profile, q, now).result.outputs[0];   // Shrine odds; no pity option, never Mythic
        hero.referralReward = true; hero.promoPass = r.campaign_id; hero.promoReward = true;
        profile.heroes.push(hero); heroes.push(hero);
      }
      await c.query('UPDATE ryo_pass_balances SET used=used+$4,updated=$5 WHERE scope=$1 AND wallet=$2 AND campaign_id=$3', [store.scope, wallet, r.campaign_id, take, now]);
      left -= take; if (!left) break;
    }
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
    await c.query('INSERT INTO ryo_pass_redemptions(scope,wallet,request_id,quantity,heroes,created) VALUES($1,$2,$3,$4,$5,$6)', [store.scope, wallet, id, quantity, JSON.stringify(heroes), now]);
    return { heroes, passes: available(await balanceRows(store, c, wallet)) };
  });
}

module.exports = { SCHEMA, DEFAULT_CONFIG, MAX_PASSES, validateConfig, tierFor, scan, admin, distribute, playerState, claim, redeem };
