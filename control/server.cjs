/* Admin Control panel API (POST /api/control) and page (/admin/control), mounted by server/site-server.cjs in every
 * stage: pre-launch portal, private testing and the public game. Owner decision 2026-11-09: one admin wallet may open or
 * close any feature; every change is audited (feature-switches.cjs). It moves no funds and changes no balances.
 *
 * Sign-in: the site's wallet message bound to RYO_SITE_ORIGIN (service.cjs verifySignature), a 2-minute window and a single-use
 * nonce. The panel keeps its OWN challenges and sessions (ryo_control_challenges / ryo_control_sessions): a game or portal
 * session never opens the panel, a panel session never opens the game, and a panel challenge never replaces a pending game
 * login. Every wallet gets the same challenge answer and the same work (admin wallets are not revealed); only an admin
 * wallet can complete a sign-in. Expired challenges are removed; pending ones are never evicted.
 * Session: 8 hours, cookie Path=/api/control, HttpOnly, SameSite=Strict; the role is re-checked on every request.
 * Opening a money or Founder feature (turn ON, or reset to a Render value that is ON) also needs a FRESH wallet signature
 * over that exact change (action 'confirm' → sign → set/clear with nonce + signature, 2 minutes, single use), so a script
 * running on the same site can never open one with a signed-in admin's session. Closing stays one step (fail safe).
 * Roles (hosting environment): write = RYO_ADMIN_OWNERS, RYO_ADMIN_APPROVERS; read = also RYO_ADMIN_OPERATORS, RYO_ADMIN_VIEWERS.
 * Requests: same origin only, JSON only, header X-SB-Control: 1, ≤ 4 KB, rate-limited per IP. */
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');

const COOKIE = 'sb_control', WINDOW = 60000, LIMITS = { all: 120, challenge: 10, set: 30 }, CHALLENGE_MS = 120000, SESSION_MS = 8 * 3600000;
// Opening these needs a valid FOUNDERS_REVENUE_WALLET (their SOL receipt wallet); the panel refuses, as the start-up guard does.
const FOUNDER_SOL_KEYS = ['foundersPublicSale', 'foundersPrivateTesting', 'senseiSol'];
const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');
const PAGE_DIR = path.join(__dirname, 'public');
// The wallet connector is the reviewed pre-launch one (prelaunch/wallet.js), served from here so the panel works in every stage.
const PAGES = { '/admin/control': 'index.html', '/admin/control/': 'index.html', '/admin/control/control.js': 'control.js', '/admin/control/control.css': 'control.css',
  '/admin/control/wallet.js': path.join('..', '..', 'prelaunch', 'wallet.js') };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };

function fail(message, status = 400, code) { throw Object.assign(Error(message), { status, code }); }
const list = (env, name) => String(env[name] || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);

function createControl({ gameDir, env = process.env, pool = null, now = Date.now }) {
  const server = path.join(gameDir, 'server'), need = name => require(path.join(server, name));
  const fromApp = name => require(require.resolve(name, { paths: [server] }));
  const { verifySignature } = need('service.cjs'), FS = need('feature-switches.cjs'), network = need('network.cjs');
  const { PublicKey } = fromApp('@solana/web3.js'), net = network.resolve(env);
  const origin = new URL(env.RYO_SITE_ORIGIN).origin, secure = origin.startsWith('https://');
  const headers = secure ? { ...HEADERS, 'Strict-Transport-Security': 'max-age=31536000' } : HEADERS;
  // Money and Founder switches: opening one needs a fresh signature (see the header comment).
  const opens = (key, enabled) => !!FS.CATALOG[key] && FS.CATALOG[key].group !== 'gameplay' && (enabled === true || (enabled === null && FS.envValue(key, env) === true));
  const confirmStatement = (key, enabled) => 'Confirm in the Shinobi Bombers Control panel: ' + (enabled === null ? 'reset to Render (ON) ' : 'turn ON ') + FS.CATALOG[key].label + '. This is free: it does not send a transaction or move any funds.';
  // The panel's own small pool (site-server.cjs gives the game's switch loader a separate connection); tests pass one in.
  if (!pool) { pool = new (fromApp('pg').Pool)({ connectionString: env.DATABASE_URL, max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000, statement_timeout: 15000 }); pool.on('error', e => console.warn('[control] pool: ' + e.message)); }
  const scope = env.RYO_SCOPE;
  let ready = null;
  // The feature-switch loader starts first and unconditionally (site-server.cjs also starts it for the game itself), so a
  // switch closed in the panel can never reopen because a table check failed. The build's db:init creates the tables;
  // this best-effort check only helps a fresh database and never blocks the loader.
  const createTables = async () => { for (const sql of FS.SCHEMA.split(/;\s*\n/).map(x => x.trim().replace(/;$/, '')).filter(Boolean)) await pool.query(sql); };
  const init = () => ready || (ready = (async () => { FS.start(pool, scope); try { await createTables(); } catch (e) { console.warn('[control] table check: ' + e.message); } })());
  init();

  const buckets = new Map();
  function limit(ip, kind) {
    const t = now();
    // Bounded memory without wiping live counters: drop expired entries; if still full, refuse new addresses for now.
    if (buckets.size > 20000) for (const [k, v] of buckets) if (t - v.start >= WINDOW) buckets.delete(k);
    if (buckets.size > 20000 && !buckets.has(ip)) fail('Too many requests. Wait a minute.', 429, 'RATE_LIMITED');
    const b = buckets.get(ip) || { start: t, all: 0, challenge: 0, set: 0 };
    if (t - b.start >= WINDOW) Object.assign(b, { start: t, all: 0, challenge: 0, set: 0 });
    b.all++; if (kind !== 'all' && b[kind] !== undefined) b[kind]++; buckets.set(ip, b);
    if (b.all > LIMITS.all || (LIMITS[kind] && b[kind] > LIMITS[kind])) fail('Too many requests. Wait a minute.', 429, 'RATE_LIMITED');
  }
  const wallet = v => { try { if (typeof v === 'string' && new PublicKey(v).toBase58() === v) return v; } catch {} fail('Enter a valid Solana wallet address.', 400, 'WALLET_INVALID'); };
  function role(w) {
    if (list(env, 'RYO_ADMIN_OWNERS').includes(w)) return 'owner';
    if (list(env, 'RYO_ADMIN_APPROVERS').includes(w)) return 'approver';
    if (list(env, 'RYO_ADMIN_OPERATORS').includes(w)) return 'operator';
    if (list(env, 'RYO_ADMIN_VIEWERS').includes(w)) return 'viewer';
    return null;
  }
  const canWrite = r => r === 'owner' || r === 'approver';
  // The site's standard sign-in message (wallet.js validates this exact format before signing). Replay-safe: the nonce is
  // single-use and stored per wallet by Store.challenge/login, so a portal signature cannot open the panel or vice versa.
  const SIGN_IN = 'Sign in to the Shinobi Bombers Control panel. This is free: it does not send a transaction or move any funds.';
  const message = (w, nonce, t, statement = SIGN_IN) => [new URL(origin).host + ' wants you to sign in with your Solana account:', w, '',
    statement, '',
    'URI: ' + origin, 'Version: 1', 'Chain ID: ' + net.key, 'Nonce: ' + nonce,
    'Issued At: ' + new Date(t).toISOString(), 'Expiration Time: ' + new Date(t + 120000).toISOString()].join('\n');
  const cookie = (token, maxAge) => COOKIE + '=' + (token ? encodeURIComponent(token) : '') + '; Path=/api/control; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secure ? '; Secure' : '');
  function token(req) {
    const raw = (String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '=')) || '').slice(COOKIE.length + 1);
    try { const t = decodeURIComponent(raw); return t.length <= 100 ? t : ''; } catch { return ''; }
  }
  async function admin(req) {
    const t = token(req); if (!t) fail('Sign in with an admin wallet.', 401, 'SIGN_IN');
    await init();
    const row = (await pool.query('SELECT wallet FROM ryo_control_sessions WHERE scope=$1 AND token_hash=$2 AND expires>$3', [scope, sha256(t), now()])).rows[0];
    if (!row) fail('Your Control panel session expired. Sign in again.', 401, 'SIGN_IN');
    const r = role(row.wallet);   // removed from RYO_ADMIN_* = no access, even with a live session
    if (!r) fail('This wallet has no admin role.', 403, 'ADMIN_ONLY');
    return { wallet: row.wallet, role: r };
  }
  function founderWalletProblems() {
    if (!String(env.FOUNDERS_REVENUE_WALLET || '').trim()) return ['FOUNDERS_REVENUE_WALLET is not set in Render.'];
    try { return network.founderRevenueProblems(env, server, network.built(server)); } catch (e) { return [e.message]; }
  }
  function release() {
    const out = { network: net.key };
    try {
      out.mintReleased = network.mintReleased ? network.mintReleased(env, server) : false;
      out.launched = network.launched ? network.launched(env, server) : false;
      out.prelaunch = network.prelaunch(env, server); out.stage = network.releaseStage(env, server);
      out.hold = !!String(env.GAME_LAUNCH_HOLD || '').trim() && !/^(0|off|false|no)$/i.test(String(env.GAME_LAUNCH_HOLD).trim());
    } catch {}
    return out;
  }
  async function state(who) {
    await init();
    return { wallet: who.wallet, role: who.role, canWrite: canWrite(who.role), panelDisabled: FS.panelDisabled(env), release: release(),
      switches: await FS.view(pool, scope, env), loadedAt: Date.now() };
  }

  // A new single-use challenge (sign-in or change confirmation). Expired ones are removed; pending ones are never evicted,
  // so nobody can push an admin's pending sign-in out by requesting more challenges for that wallet.
  async function newChallenge(w, statement) {
    const nonce = crypto.randomBytes(16).toString('hex'), t = now(), m = message(w, nonce, t, statement);
    await init();
    await pool.query('DELETE FROM ryo_control_challenges WHERE scope=$1 AND created<$2', [scope, t - CHALLENGE_MS]);
    await pool.query('INSERT INTO ryo_control_challenges(scope,nonce,wallet,message,created) VALUES($1,$2,$3,$4,$5)', [scope, nonce, w, m, t]);
    return { nonce, message: m, expires: t + CHALLENGE_MS };
  }
  // Consumes a challenge (deleted as it is read, whatever the outcome) and checks it was signed for exactly this statement.
  async function useChallenge(w, nonce, signature, statement) {
    if (typeof signature !== 'string' || signature.length > 100 || typeof nonce !== 'string' || !/^[0-9a-f]{32}$/.test(nonce)) return false;
    await init();
    const ch = (await pool.query('DELETE FROM ryo_control_challenges WHERE scope=$1 AND nonce=$2 AND wallet=$3 RETURNING message,created', [scope, nonce, w])).rows[0], t = now();
    return !!ch && t - Number(ch.created) < CHALLENGE_MS && ch.message === message(w, nonce, Number(ch.created), statement) && verifySignature(w, ch.message, signature);
  }
  const version = v => { if (!Number.isSafeInteger(v) || v < 0) fail('Refresh the panel and try again.', 400, 'BAD_VERSION'); return v; };
  const target = body => body.action === 'clear' ? null : body.enabled === true ? true : body.enabled === false ? false : undefined;

  async function dispatch(req, body, ip) {
    const action = body.action; limit(ip, action === 'challenge' ? 'challenge' : ['set', 'clear', 'confirm'].includes(action) ? 'set' : 'all');
    if (action === 'challenge') {
      // Same work and the same answer for every wallet (admin wallets are not revealed); only an admin can complete it.
      return { data: await newChallenge(wallet(body.wallet)) };
    }
    if (action === 'login') {
      const w = wallet(body.wallet);
      if (typeof body.signature !== 'string' || body.signature.length > 100 || typeof body.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(body.nonce)) fail('Invalid wallet signature.', 400, 'SIGNATURE_INVALID');
      const ok = await useChallenge(w, body.nonce, body.signature, SIGN_IN), t = now();
      if (!ok || !role(w)) fail('Invalid, expired or already used signature. Request a new sign-in.', 401, 'SIGNATURE_INVALID');
      const session = crypto.randomBytes(32).toString('base64url');
      await pool.query('DELETE FROM ryo_control_sessions WHERE scope=$1 AND expires<=$2', [scope, t]);
      await pool.query('INSERT INTO ryo_control_sessions(scope,token_hash,wallet,created,expires) VALUES($1,$2,$3,$4,$5)', [scope, sha256(session), w, t, t + SESSION_MS]);
      return { data: await state({ wallet: w, role: role(w) }), cookie: cookie(session, SESSION_MS / 1000) };
    }
    if (action === 'logout') {
      const t = token(req); if (t) { await init(); await pool.query('DELETE FROM ryo_control_sessions WHERE scope=$1 AND token_hash=$2', [scope, sha256(t)]); }
      return { data: { ok: true }, cookie: cookie('', 0) };
    }
    const who = await admin(req);
    if (action === 'state') return { data: await state(who) };
    if (action === 'log') { await init(); return { data: { log: await FS.log(pool, scope, Number.isSafeInteger(body.limit) ? body.limit : 50) } }; }
    if (action === 'set' || action === 'clear' || action === 'confirm') {
      if (!canWrite(who.role)) fail('Only owner or approver wallets can change switches.', 403, 'ADMIN_ONLY');
      if (FS.panelDisabled(env)) fail('The panel is switched off (FEATURE_PANEL_DISABLED=on in Render): changes are not saved. Use the Render settings.', 409, 'PANEL_DISABLED');
      if (!FS.CATALOG[body.key]) fail('Unknown feature switch.', 400, 'UNKNOWN_SWITCH');
      const enabled = action === 'confirm' ? (body.enabled === null ? null : body.enabled === true ? true : undefined) : target(body);
      if (enabled === undefined && action === 'confirm') fail('Only opening a feature needs a confirmation.', 400, 'BAD_REQUEST');
      version(body.expectedVersion);
      const opening = enabled !== undefined && opens(body.key, enabled);
      if (opening && FOUNDER_SOL_KEYS.includes(body.key)) {
        const problems = founderWalletProblems();
        if (problems.length) fail('Cannot open this sale: ' + problems.join(' '), 409, 'FOUNDERS_WALLET');
      }
      if (action === 'confirm') {
        if (!opening) fail('Only opening a feature needs a confirmation.', 400, 'BAD_REQUEST');
        return { data: await newChallenge(who.wallet, confirmStatement(body.key, enabled)) };
      }
      if (opening) {
        if (body.signature === undefined) fail('Opening this feature needs a fresh wallet confirmation.', 428, 'CONFIRM_SIGNATURE');
        // Check what FS.change would refuse BEFORE the confirmation is used up, so a typo or a stale view never burns it.
        if (typeof body.reason !== 'string' || body.reason.trim().length < 8 || body.reason.length > 300) fail('Write a reason (8-300 characters).', 400, 'BAD_REQUEST');
        const cur = (await pool.query('SELECT version FROM ryo_feature_switch_versions WHERE scope=$1 AND key=$2', [scope, body.key])).rows[0];
        if ((cur ? Number(cur.version) : 0) !== body.expectedVersion) fail('Someone else changed this switch. Refresh and try again.', 409, 'STALE');
        if (!(await useChallenge(who.wallet, body.nonce, body.signature, confirmStatement(body.key, enabled))))
          fail('The wallet confirmation is invalid, expired or already used. Try again.', 403, 'CONFIRM_SIGNATURE');
      }
      await init();
      const r = await FS.change(pool, scope, { key: body.key, enabled, actor: who.wallet, reason: body.reason, expectedVersion: body.expectedVersion, now: now() });
      // Newest audit-chain hash in the hosting logs: a later rewrite of the log table can be compared against it.
      try { const [top] = await FS.log(pool, scope, 1); if (top) console.log('[control] ' + body.key + ' -> ' + (enabled === null ? 'reset' : enabled ? 'ON' : 'OFF') + ' by ' + who.wallet + ' (log #' + top.seq + ' ' + top.hash + ')'); } catch {}
      const refreshed = await FS.load(pool, scope);   // false: saved, but the panel shows it after the next 5-second refresh
      return { data: { changed: r, refreshed, ...(await state(who)) } };
    }
    fail('Unknown action.', 404, 'UNKNOWN_ACTION');
  }

  function send(res, status, data, extra = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers, ...extra });
    res.end(JSON.stringify(data));
  }
  // Render's proxy appends the address it saw: the rightmost entry cannot be forged by the client.
  const clientIp = req => { const f = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean); return f.length ? f[f.length - 1] : (req.socket?.remoteAddress || 'unknown'); };
  function handle(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST required.', code: 'BAD_REQUEST' });
    if (req.headers.origin !== origin || req.headers['x-sb-control'] !== '1' || !/^application\/json\b/i.test(String(req.headers['content-type'] || '')))
      return send(res, 403, { error: 'Request origin is not allowed.', code: 'ORIGIN' });
    // Too large: answer 413 at once, keep nothing, and close. Up to 1 MB of the rest is drained (so the proxy sees the 413,
    // not a reset); anything beyond that is cut off.
    const MAX = 4096, DRAIN = 1 << 20;
    const tooLarge = () => { if (aborted) return; aborted = true; chunks = []; send(res, 413, { error: 'Request is too large.', code: 'BAD_REQUEST' }, { Connection: 'close' }); };
    let size = 0, chunks = [], aborted = false;
    const declared = Number(req.headers['content-length']);
    if (declared > DRAIN) { tooLarge(); res.on('finish', () => req.destroy()); return; }
    if (declared > MAX) tooLarge();
    // Upload deadline (idle 10 s while the body arrives); cleared once the body is complete so a slow save is never cut.
    req.setTimeout(10000, () => { aborted = true; if (!res.headersSent) send(res, 408, { error: 'Request timed out.', code: 'BAD_REQUEST' }, { Connection: 'close' }); req.destroy(); });
    req.on('data', c => { size += c.length; if (size > DRAIN) return req.destroy(); if (aborted) return; if (size > MAX) tooLarge(); else chunks.push(c); });
    req.on('error', () => { if (!res.headersSent) send(res, 400, { error: 'Invalid request.', code: 'BAD_REQUEST' }); });
    req.on('end', async () => {
      req.setTimeout(0);
      if (aborted) return;
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return send(res, 400, { error: 'Invalid JSON.', code: 'BAD_REQUEST' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string') return send(res, 400, { error: 'Missing action.', code: 'BAD_REQUEST' });
      try { const { data, cookie: c } = await dispatch(req, body, clientIp(req)); send(res, 200, data, c ? { 'Set-Cookie': c } : {}); }
      catch (e) {
        const status = Number.isInteger(e.status) && e.status >= 400 && e.status < 600 ? e.status : 500;
        if (status >= 500) console.error('[control]', e);
        send(res, status, { error: status >= 500 ? 'The Control panel is temporarily unavailable.' : e.message, code: e.code || (status === 409 ? 'STALE' : 'ERROR') }, status === 401 ? { 'Set-Cookie': cookie('', 0) } : {});
      }
    });
  }
  /** Static page files; returns false when the path is not part of the panel. */
  function page(req, res, name) {
    const file = PAGES[name]; if (!file) return false;
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, headers); res.end(); return true; }
    if (name === '/admin/control') { res.writeHead(308, { Location: '/admin/control/', 'Cache-Control': 'no-store' }); res.end(); return true; }
    let body; try { body = fs.readFileSync(path.join(PAGE_DIR, file)); } catch { res.writeHead(503, headers); res.end(); return true; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache', ...headers });
    res.end(req.method === 'HEAD' ? undefined : body); return true;
  }
  return { handle, page, init, pool };
}
module.exports = { createControl };
