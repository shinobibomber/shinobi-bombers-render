/* Pre-launch portal API (POST /api/prelaunch), mounted by server/site-server.cjs when PRELAUNCH_MODE=on.
 *
 * Only accounts and referrals exist here: wallet sign-in (Sign-In With Solana message, signed for free, no
 * transaction), registration (unique username, language, region), the player's referral link and list,
 * a referral leaderboard, and launch status/announcements. The game API is not mounted at all in
 * pre-launch mode, so nothing here can summon, trade, claim, deposit or withdraw.
 *
 * It reuses the game's own modules from the assembled app/ (the same tables, keyed by RYO_SCOPE), so every
 * registration, referral code and attribution carries into the live game when it opens:
 *   Store.challenge/login/authenticate (one-time nonce, server-stored message, 120 s expiry, 1 h session),
 *   service.verifySignature (ed25519), creators-portal.attribute (permanent, self/cycle/new-player checks),
 *   player-referrals.identity (RP… codes).
 */
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');

const COOKIE = 'sb_pl';
const RESERVED = new Set(['admin', 'administrator', 'moderator', 'mod', 'support', 'shinobi', 'shinobibombers', 'official', 'staff', 'system', 'team', 'dev', 'developer', 'null', 'undefined', 'root']);
// Per client address per minute. Generous enough for many players behind one shared address (mobile carriers, cafés).
const LIMITS = { all: 240, challenge: 20, register: 20 }, WINDOW = 60000;
const on = (v, fallback) => v === undefined || v === '' ? fallback : /^(1|on|true|yes)$/i.test(String(v).trim());
const safeUrl = (v, mail = false) => { try { const u = new URL(String(v || '')); return u.protocol === 'https:' || (mail && u.protocol === 'mailto:') ? u.href : null; } catch { return null; } };
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const fail = (message, status = 400, code = 'BAD_REQUEST') => { throw Object.assign(Error(message), { status, code }); };

// Maps the reused modules' English messages to stable codes the page translates.
const CODES = [
  [/already has a creator application/i, 'CREATOR_EXISTS'], [/supported primary platform/i, 'CREATOR_PLATFORM'], [/HTTPS channel/i, 'CREATOR_URL'],
  [/applications are temporarily paused/i, 'CREATOR_PAUSED'], [/authorized creator administrator|approver role is required/i, 'ADMIN_ONLY'],
  [/Invalid creator status transition/i, 'CREATOR_TRANSITION'], [/referred player cannot become a creator/i, 'CREATOR_REFERRED'],
  [/creator link is unavailable|must accept the program terms/i, 'CREATOR_UNKNOWN'], [/Creator not found/i, 'CREATOR_NOT_FOUND'],
  [/Creators Portal is not enabled/i, 'CREATOR_DISABLED'], [/Enter text between/i, 'TEXT_INVALID'], [/Enter a whole number/i, 'NUMBER_INVALID'],
  [/yourself/i, 'REFERRAL_SELF'], [/Circular/i, 'REFERRAL_CYCLE'], [/permanent|cannot become referred/i, 'REFERRAL_PERMANENT'],
  [/unavailable/i, 'REFERRAL_UNKNOWN'], [/paused|limit has been reached/i, 'REFERRAL_CLOSED'], [/new players/i, 'REFERRAL_NOT_NEW'],
  [/Wait a moment/i, 'RATE_LIMITED'], [/Invalid, expired or already used/i, 'SIGNATURE_INVALID'], [/session expired|Sign in with your wallet/i, 'SIGN_IN'],
];
const codeOf = e => e.code && /^[A-Z_]+$/.test(e.code) ? e.code : (CODES.find(([re]) => re.test(e.message || '')) || [, 'SERVER_ERROR'])[1];

function readAnnouncements(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    const text = v => v && typeof v.en === 'string' ? { en: v.en.slice(0, 600), 'pt-BR': typeof v['pt-BR'] === 'string' ? v['pt-BR'].slice(0, 600) : v.en.slice(0, 600) } : null;
    return (Array.isArray(list) ? list : []).filter(a => a && /^\d{4}-\d{2}-\d{2}$/.test(a.date) && text(a.title) && text(a.body))
      .map(a => ({ id: String(a.id || a.date).slice(0, 40), date: a.date, kind: ['beta', 'launch', 'maintenance', 'referral', 'community'].includes(a.kind) ? a.kind : 'community', title: text(a.title), body: text(a.body) }))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  } catch { return []; }
}

function createPrelaunch({ gameDir, env = process.env, pool = null, now = Date.now, announcementsFile = path.join(__dirname, 'announcements.json') } = {}) {
  const server = path.join(gameDir, 'server'), need = name => require(path.join(server, name));
  const fromApp = name => require(require.resolve(name, { paths: [server] }));
  const { Store } = need('store.cjs'), { verifySignature } = need('service.cjs'), cp = need('creators-portal.cjs'), players = need('player-referrals.cjs');
  const network = need('network.cjs'), net = network.resolve(env), { PublicKey } = fromApp('@solana/web3.js');
  const origin = new URL(env.RYO_SITE_ORIGIN).origin, secureCookie = origin.startsWith('https://');
  pool = pool || new (fromApp('pg').Pool)({ connectionString: env.DATABASE_URL, max: 8, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000, statement_timeout: 15000 });
  const store = new Store(pool, env.RYO_SCOPE, now);
  const flags = { registration: on(env.REGISTRATION_ENABLED, true), referrals: on(env.REFERRALS_ENABLED, true), creatorApply: on(env.CREATOR_APPLICATIONS_ENABLED, true) };
  const launchAt = (() => { const t = Date.parse(env.LAUNCH_AT || ''); return Number.isFinite(t) ? new Date(t).toISOString() : null; })();
  const links = { discord: safeUrl(env.DISCORD_URL), x: safeUrl(env.X_URL), support: safeUrl(env.SUPPORT_URL, true), demo: safeUrl(env.DEMO_URL) };
  const buckets = new Map(); let board = null;

  function limit(ip, kind) {
    const t = now(); if (buckets.size > 50000) buckets.clear();
    const b = buckets.get(ip) || { start: t, all: 0, challenge: 0, register: 0 };
    if (t - b.start >= WINDOW) Object.assign(b, { start: t, all: 0, challenge: 0, register: 0 });
    const own = kind === 'challenge' || kind === 'register';
    b.all++; if (own) b[kind]++; buckets.set(ip, b);
    if (b.all > LIMITS.all || (own && b[kind] > LIMITS[kind])) fail('Too many requests. Wait a minute and try again.', 429, 'RATE_LIMITED');
  }
  const wallet = v => { try { if (typeof v === 'string' && new PublicKey(v).toBase58() === v) return v; } catch {} fail('Enter a valid Solana wallet address.', 400, 'WALLET_INVALID'); };
  const rows = async (sql, args = []) => (await pool.query(sql, [store.scope, ...args])).rows;
  const playerRow = async w => (await rows('SELECT * FROM ryo_players WHERE scope=$1 AND wallet=$2', [w]))[0] || null;
  const publicPlayer = (p, code) => p && { playerId: p.player_id, username: p.username, language: p.language, region: p.region, status: p.status,
    leaderboardVisible: p.leaderboard_visible, registered: Number(p.created), referralCode: code, referralLink: code ? origin + '/?referral=' + code : null };
  async function referralCode(w) { return (await rows('SELECT code FROM ryo_player_referrers WHERE scope=$1 AND wallet=$2', [w]))[0]?.code || null; }
  async function me(w) {
    const p = await playerRow(w); if (!p) return { wallet: w, registered: false };
    const by = (await rows(`SELECT p.username FROM ryo_player_referrals r LEFT JOIN ryo_players p ON p.scope=r.scope AND p.wallet=r.referrer WHERE r.scope=$1 AND r.wallet=$2`, [w]))[0];
    const byCreator = by ? null : (await rows(`SELECT c.display_name FROM ryo_creator_referrals r JOIN ryo_creators c ON c.scope=r.scope AND c.id=r.creator_id WHERE r.scope=$1 AND r.wallet=$2`, [w]))[0];
    return { wallet: w, registered: true, player: publicPlayer(p, await referralCode(w)), referredBy: by ? (by.username || 'a Shinobi') : byCreator ? byCreator.display_name : null };
  }
  function username(v) {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(v)) fail('Usernames are 3–16 letters, numbers or _.', 400, 'USERNAME_INVALID');
    if (RESERVED.has(v.toLowerCase())) fail('That username is reserved.', 409, 'USERNAME_TAKEN');
    return v;
  }
  const language = v => ['en', 'pt-BR'].includes(v) ? v : fail('Choose English or Português (Brasil).', 400, 'LANGUAGE_INVALID');
  const region = v => ['asia', 'south-america'].includes(v) ? v : fail('Choose a server region.', 400, 'REGION_INVALID');

  async function register(w, body) {
    if (!flags.registration) fail('Registration is closed right now.', 403, 'REGISTRATION_CLOSED');
    const name = username(body.username), lang = language(body.language ?? 'en'), reg = region(body.region ?? 'asia');
    let created = false;
    try {
      await store.transaction(async c => {
        await store.locked(c, w);   // serializes repeated requests from the same wallet
        if ((await c.query('SELECT 1 FROM ryo_players WHERE scope=$1 AND wallet=$2', [store.scope, w])).rows.length) return;
        if ((await c.query('SELECT 1 FROM ryo_players WHERE scope=$1 AND username_key=$2', [store.scope, name.toLowerCase()])).rows.length) fail('That username is taken.', 409, 'USERNAME_TAKEN');
        const t = now();
        await c.query('INSERT INTO ryo_players(scope,wallet,player_id,username,username_key,language,region,created,last_login) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)',
          [store.scope, w, crypto.randomUUID(), name, name.toLowerCase(), lang, reg, t]);
        await cp.audit(store, c, w, 'player.registered', cp.privateId(w), 'Pre-launch registration');
        created = true;
      });
    } catch (e) { if (e.code === '23505') fail('That username is taken.', 409, 'USERNAME_TAKEN'); throw e; }
    await players.identity(store, w);   // the permanent RP… code
    let referral = null;
    const code = typeof body.referralCode === 'string' ? body.referralCode.trim().toUpperCase() : '';
    if (created && code && /^[A-Z0-9]{4,32}$/.test(code)) {
      if (!flags.referrals) referral = { accepted: false, code: 'REFERRAL_CLOSED' };
      else try { const r = await cp.attribute(store, w, { code }); referral = { accepted: true, existing: !!r?.existing }; board = null; }
      catch (e) { referral = { accepted: false, code: codeOf(e), message: e.message }; }
    }
    return { ...await me(w), created, referral };
  }
  async function preferences(w, body) {
    const p = await playerRow(w); if (!p) fail('Register first.', 409, 'NOT_REGISTERED');
    const lang = body.language === undefined ? p.language : language(body.language), reg = body.region === undefined ? p.region : region(body.region);
    const visible = body.leaderboardVisible === undefined ? p.leaderboard_visible : body.leaderboardVisible === true;
    await rows('UPDATE ryo_players SET language=$3,region=$4,leaderboard_visible=$5 WHERE scope=$1 AND wallet=$2', [w, lang, reg, visible]);
    board = null; return me(w);
  }
  async function referrals(w, body) {
    if (!await playerRow(w)) fail('Register first.', 409, 'NOT_REGISTERED');
    const page = body.page ?? 0; if (!Number.isSafeInteger(page) || page < 0 || page > 10000) fail('Invalid page.');
    const [s] = await rows(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE qualified IS NULL) AS progress, COUNT(*) FILTER (WHERE qualified IS NOT NULL) AS qualified
      FROM ryo_player_referrals WHERE scope=$1 AND referrer=$2`, [w]);
    const [r] = await rows('SELECT COALESCE(SUM(passes-claimed),0) AS available, COALESCE(SUM(claimed),0) AS earned FROM ryo_player_referral_rewards WHERE scope=$1 AND wallet=$2', [w]);
    const list = await rows(`SELECT r.wallet, r.attributed, r.paid_mints, r.stage5, r.qualified, p.username FROM ryo_player_referrals r
      LEFT JOIN ryo_players p ON p.scope=r.scope AND p.wallet=r.wallet WHERE r.scope=$1 AND r.referrer=$2 ORDER BY r.attributed DESC, r.wallet LIMIT 20 OFFSET $3`, [w, page * 20]);
    return { page, pageSize: 20, prelaunch: true,
      stats: { invited: Number(s.total), inProgress: Number(s.progress), qualified: Number(s.qualified), rewardsAvailable: Number(r.available), heroesEarned: Number(r.earned) },
      referrals: list.map(x => ({ player: x.username || cp.privateId(x.wallet), joined: Number(x.attributed),
        status: x.qualified ? 'QUALIFIED' : 'IN_PROGRESS', paidHeroes: Math.min(15, Number(x.paid_mints)), stage5: !!x.stage5, rewardLocked: !x.qualified })) };
  }
  async function leaderboard(body) {
    const page = body.page ?? 0; if (!Number.isSafeInteger(page) || page < 0 || page > 4) fail('Invalid page.');
    if (!board || now() - board.at > 60000) board = { at: now(), rows: (await rows(`SELECT p.username, COUNT(*) AS n, MIN(r.attributed) AS first FROM ryo_player_referrals r
      JOIN ryo_players p ON p.scope=r.scope AND p.wallet=r.referrer AND p.leaderboard_visible AND p.status='active'
      WHERE r.scope=$1 GROUP BY p.username ORDER BY n DESC, first ASC, p.username LIMIT 100`)).map((x, i) => ({ rank: i + 1, player: x.username, registrations: Number(x.n) })) };
    return { page, pageSize: 20, basis: 'registered-referrals', updated: board.at, rows: board.rows.slice(page * 20, page * 20 + 20) };
  }
  /* ---------- Creator Program (the game's creators-portal rules, unchanged) ---------- */
  const ctx = { store, origin };
  const pageOf = body => { const p = body.page ?? 0; if (!Number.isSafeInteger(p) || p < 0 || p > 10000) fail('Invalid page.'); return p; };
  async function creatorState(w, body = {}) {
    const page = pageOf(body), s = await cp.handle(ctx, w, 'creator-state', { page });
    const r = s.rules || {};
    const out = { creator: s.creator, adminRole: s.adminRole, termsAccepted: s.termsAccepted, applicationsOpen: flags.creatorApply && !r.applicationsPaused,
      rules: { milestone: r.milestone, adventurePercent: r.adventurePercent, purchasePercent: r.purchasePercent, commissionDays: r.commissionDays, paidHeroes: r.paidHeroes, clearedStage: r.clearedStage, cpWithdrawable: false } };
    if (s.creator?.status === 'APPROVED') {
      const list = await rows(`SELECT r.wallet, r.attributed, r.qualified, p.username FROM ryo_creator_referrals r LEFT JOIN ryo_players p ON p.scope=r.scope AND p.wallet=r.wallet
        WHERE r.scope=$1 AND r.creator_id=$2 ORDER BY r.attributed DESC, r.wallet LIMIT 20 OFFSET $3`, [s.creator.id, page * 20]);
      Object.assign(out, { link: s.link, page, pageSize: 20, stats: { total: Number(s.stats.total), qualified: Number(s.stats.qualified), pending: Number(s.stats.pending) },
        balanceMilli: s.points.balanceMilli,
        referrals: list.map(x => ({ player: x.username || cp.privateId(x.wallet), joined: Number(x.attributed), status: x.qualified ? 'QUALIFIED' : 'IN_PROGRESS' })) });
    }
    return out;
  }
  async function creatorApply(w, body) {
    if (!flags.creatorApply) fail('Creator applications are temporarily paused.', 403, 'CREATOR_PAUSED');
    if (!await playerRow(w)) fail('Register first.', 409, 'NOT_REGISTERED');
    // A wallet that joined through any referral link can never be approved, so say so before it applies.
    if ((await rows('SELECT 1 FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2 UNION ALL SELECT 1 FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [w])).length)
      fail('Wallets that joined through a referral link cannot become creators.', 409, 'CREATOR_REFERRED');
    const links = (Array.isArray(body.links) ? body.links : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 5);
    const audience = body.audience === '' || body.audience == null ? null : Number(body.audience);
    await cp.handle(ctx, w, 'creator-apply', { displayName: body.displayName, platform: body.platform, channelUrl: body.channelUrl, links, audience, reason: body.reason, terms: body.terms === true });
    return creatorState(w);
  }
  async function creatorAdmin(w, body = {}) {
    const search = typeof body.search === 'string' ? body.search.slice(0, 80) : '', page = pageOf(body);
    const s = await cp.handle(ctx, w, 'creator-admin', { search, page });
    const order = { PENDING: 0, APPROVED: 1, SUSPENDED: 2, REJECTED: 3 };
    return { role: s.role, page, pageSize: 20, search,
      creators: s.creators.map(c => ({ id: c.id, displayName: c.displayName, status: c.status, code: c.code, wallet: c.wallet, submitted: c.submitted, reviewed: c.reviewed, publicNote: c.publicNote,
        application: { platform: c.application?.platform || null, channelUrl: c.application?.channelUrl || null, links: c.application?.links || [], audience: c.application?.audience ?? null, reason: c.application?.reason || '' } }))
        .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)) };
  }
  async function creatorAdminAction(w, body) {
    // Only application review is offered on the landing page; program, CP and shop changes stay in the game.
    if (body.operation !== 'status' || !['APPROVED', 'REJECTED', 'SUSPENDED'].includes(body.status)) fail('Only approve, reject or suspend is available here.', 403, 'ADMIN_ONLY');
    await cp.handle(ctx, w, 'creator-admin-action', { operation: 'status', creatorId: body.creatorId, status: body.status, reason: body.reason, publicNote: body.publicNote || '' });
    return creatorAdmin(w, body);
  }

  function status() {
    return { prelaunch: true, network: net.label, launchAt, registrationEnabled: flags.registration, referralsEnabled: flags.referrals,
      links, announcements: readAnnouncements(announcementsFile),
      referralProgram: { paidHeroes: 15, clearedStage: 5, heroesPerReferral: 2, bound: true } };
  }

  async function authenticated(req) {
    const token = sessionToken(req);
    if (!token) fail('Sign in with your wallet.', 401, 'SIGN_IN');
    return { wallet: await store.authenticate(token), token };
  }
  function sessionToken(req) {
    const raw=(String(req.headers.cookie||'').split(/;\s*/).find(c=>c.startsWith(COOKIE+'='))||'').slice(COOKIE.length+1);
    try { const token=decodeURIComponent(raw);return token.length<=100?token:''; }catch{return '';}
  }
  const cookie = (token, maxAge) => COOKIE + '=' + (token ? encodeURIComponent(token) : '') + '; Path=/api/prelaunch; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secureCookie ? '; Secure' : '');
  const siwsMessage = (w, nonce, t) => [new URL(origin).host + ' wants you to sign in with your Solana account:', w, '',
    'Sign in to Shinobi Bombers. This is free: it does not send a transaction or move any funds.', '',
    'URI: ' + origin, 'Version: 1', 'Chain ID: ' + net.key, 'Nonce: ' + nonce,
    'Issued At: ' + new Date(t).toISOString(), 'Expiration Time: ' + new Date(t + 120000).toISOString()].join('\n');

  async function dispatch(req, body, ip) {
    const action = body.action; limit(ip, action);
    if (action === 'status') return { data: status() };
    if (action === 'leaderboard') return { data: await leaderboard(body) };
    if (action === 'challenge') {
      const w = wallet(body.wallet), nonce = crypto.randomBytes(16).toString('hex'), t = now();
      const message = siwsMessage(w, nonce, t);
      return { data: await store.challenge(w, message, nonce) };
    }
    if (action === 'login') {
      const w = wallet(body.wallet);
      if (typeof body.signature !== 'string' || body.signature.length > 100 || typeof body.nonce !== 'string') fail('Invalid wallet signature.', 400, 'SIGNATURE_INVALID');
      const session = await store.login(w, body.nonce, message => {
        const issued=Date.parse(message.match(/\nIssued At: ([^\n]+)\n/)?.[1]||'');
        return Number.isFinite(issued)&&issued<=now()&&now()<issued+120000&&message===siwsMessage(w,body.nonce,issued)&&verifySignature(w,message,body.signature);
      });
      await rows('UPDATE ryo_players SET last_login=$3 WHERE scope=$1 AND wallet=$2', [w, now()]);
      return { data: await me(w), cookie: cookie(session.token, 3600) };
    }
    if (action === 'logout') {
      const token = sessionToken(req);
      if (token) await rows('DELETE FROM ryo_sessions WHERE scope=$1 AND token_hash=$2', [hash(token)]);
      return { data: { ok: true }, cookie: cookie('', 0) };
    }
    const { wallet: w } = await authenticated(req);
    if (action === 'me') return { data: await me(w) };
    if (action === 'register') return { data: await register(w, body) };
    if (action === 'preferences') return { data: await preferences(w, body) };
    if (action === 'referrals') return { data: await referrals(w, body) };
    if (action === 'creator') return { data: await creatorState(w, body) };
    if (action === 'creator-apply') { limit(ip, 'register'); return { data: await creatorApply(w, body) }; }
    if (action === 'creator-admin') return { data: await creatorAdmin(w, body) };
    if (action === 'creator-admin-action') return { data: await creatorAdminAction(w, body) };
    fail('Unknown action.', 404, 'UNKNOWN_ACTION');
  }

  function clientIp(req) {
    // Render's proxy appends the address it saw; the rightmost entry cannot be forged by the client.
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    return fwd.length ? fwd[fwd.length - 1] : (req.socket?.remoteAddress || 'unknown');
  }
  function send(res, status, data, extra = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(JSON.stringify(data));
  }
  function handle(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST required.', code: 'BAD_REQUEST' });
    // CSRF: same origin only, JSON only, and a custom header a cross-site form cannot send.
    if (req.headers.origin !== origin || req.headers['x-sb-prelaunch'] !== '1') return send(res, 403, { error: 'Request origin is not allowed.', code: 'ORIGIN' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON required.', code: 'BAD_REQUEST' });
    let size = 0, chunks = [], aborted = false;
    req.on('data', chunk => { size += chunk.length; if (size > 4096) { aborted = true; chunks = []; } else if (!aborted) chunks.push(chunk); });
    req.on('error', () => { if (!res.headersSent) send(res, 400, { error: 'Invalid request.', code: 'BAD_REQUEST' }); });
    req.on('end', async () => {
      if (aborted) return send(res, 413, { error: 'Request is too large.', code: 'BAD_REQUEST' });
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return send(res, 400, { error: 'Invalid JSON.', code: 'BAD_REQUEST' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string') return send(res, 400, { error: 'Missing action.', code: 'BAD_REQUEST' });
      try { const { data, cookie: c } = await dispatch(req, body, clientIp(req)); send(res, 200, data, c ? { 'Set-Cookie': c } : {}); }
      catch (e) {
        const status = Number.isInteger(e.status) && e.status >= 400 && e.status < 600 ? e.status : 500;
        if (status >= 500) console.error('[prelaunch]', e);
        send(res, status, { error: status >= 500 ? 'The pre-launch service is temporarily unavailable.' : e.message, code: status >= 500 ? 'SERVER_ERROR' : codeOf(e) }, status === 401 ? { 'Set-Cookie': cookie('', 0) } : {});
      }
    });
  }
  return { handle, store, pool, status, close: () => pool.end?.() };
}
module.exports = { createPrelaunch, COOKIE, readAnnouncements };
