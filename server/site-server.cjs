/* Same-origin host for the website + the unmodified Shinobi Bombers game.
 *
 *   /                     → redirects to /play/ (the game is the home page; 302 so it can be undone)
 *   /index.html, /assets… → your website (website/)               – static, design unchanged
 *   /site-config.js       → generated from env (GAME_URL, GAME_EMBED_PREVIEW)
 *   /play/…               → the complete game page and its assets   – served by the GAME'S OWN server code
 *   /.netlify/functions/ryo, /api/ryo, /beta-config.json, /healthz
 *                         → passed straight to the game's server   – root paths the game client expects
 *
 * The game's routing, origin checks, API, request limits and file-safety rules are reused, not re-implemented:
 * requests for the game are handed to game/runtime/server/render-server.cjs exactly as its own host would.
 * Private settings (DATABASE_URL, RYO_TREASURY_SECRET, …) are read from the server environment only.
 * Set RYO_SITE_ORIGIN to this host's public origin (e.g. https://www.example.com) – the game binds wallet
 * sign-in to it.
 *
 * SOLANA_NETWORK (devnet | mainnet, see network/network.cjs) must match the network app/ was built for;
 * an unsafe or mismatched Mainnet environment stops the server before it listens.
 */
'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SITE_DIR = fs.realpathSync(path.join(ROOT, 'website'));
const ADMIN_DIR = path.join(ROOT, 'economic-dashboard');
const CC_DIR = path.join(ROOT, 'command-center', 'public');   // Shinobi Command Center staff console
const GAME_DIR = path.resolve(process.env.GAME_RUNTIME_DIR || path.join(ROOT, 'app'));   // assembled by `npm run build`
const MOUNT = '/play';
const GAME_ROOT_PATHS = new Set(['/.netlify/functions/ryo', '/api/ryo', '/beta-config.json', '/healthz']);
const network = require(path.join(ROOT, 'network', 'network.cjs'));
const NET = network.resolve();
// Files served from this repo (not app/) that name the network: reworded on the live server.
const NETWORK_TEXT = new Set([path.join(ADMIN_DIR, 'index.html'), path.join(ADMIN_DIR, 'dashboard.js'), path.join(SITE_DIR, 'game-link', 'game-link.js')]);
const MAINNET_RULES = NET.key === 'mainnet' ? network.mainnetRules() : null;
const networkText = file => network.rewriteText(fs.readFileSync(file, 'utf8'), file, MAINNET_RULES);

// PRELAUNCH_MODE=on (live server before launch): the pre-launch portal and its API are the only public pages.
// RELEASE_STAGE=portal (default): the game page, the game API and the admin dashboard are not mounted at all.
// RELEASE_STAGE=private (Stage 1, private live testing): the game is mounted, but every game path answers exactly
// as in "portal" unless the request carries a private pass (PRIVATE_COOKIE) for a live session of a wallet listed
// in RYO_PRIVATE_TEST_WALLETS. The check runs on the server for every request, on every hostname.
// The release rule reads the reviewed registry of the installed game build (the released SR mint opens the game).
const PRELAUNCH = network.prelaunch(process.env, path.join(GAME_DIR, 'server'));
const PRIVATE = network.privateTesting(process.env, path.join(GAME_DIR, 'server'));
const TESTERS = PRIVATE ? network.privateTesters() : new Set();
const PRELAUNCH_DIR = path.join(ROOT, 'prelaunch');
const PRIVATE_DIR = path.join(ROOT, 'private-access');
const PRELAUNCH_PAGES = { '/': 'index.html', '/rules': 'rules.html', '/privacy': 'privacy.html', '/terms': 'terms.html' };
const IMAGE_TYPES = new Set(['.webp', '.png', '.jpg', '.svg']);
const { PRIVATE_COOKIE } = require(path.join(PRELAUNCH_DIR, 'server.cjs'));

function loadPrelaunch() {
  if (!fs.existsSync(path.join(GAME_DIR, 'server', 'store.cjs'))) throw Error('Refusing to start: PRELAUNCH_MODE=on but the app is not built (run `npm run build`).');
  network.assertStartup(process.env, path.join(GAME_DIR, 'server'));
  if (PRIVATE && !TESTERS.size) throw Error('Refusing to start: RELEASE_STAGE=private without valid RYO_PRIVATE_TEST_WALLETS.');
  return require(path.join(PRELAUNCH_DIR, 'server.cjs')).createPrelaunch({ gameDir: GAME_DIR, privateAccess: PRIVATE ? { allowed: w => TESTERS.has(w) } : null });
}

/* Paths of the game that stay closed to everyone without a private pass while the portal is public. */
const gamePath = name => name === MOUNT || name.startsWith(MOUNT + '/') || (GAME_ROOT_PATHS.has(name) && name !== '/healthz') || name === '/admin' || name.startsWith('/admin/');
const passes = new Map(), PASS_CACHE_MS = 15000;
/** True only for a live session token of an allowlisted wallet. Any error answers false (fail closed). */
async function privatePass(req) {
  const raw = (String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(PRIVATE_COOKIE + '=')) || '').slice(PRIVATE_COOKIE.length + 1);
  if (!raw || raw.length > 200) return false;
  let token; try { token = decodeURIComponent(raw); } catch { return false; }
  const key = require('node:crypto').createHash('sha256').update(token).digest('hex'), t = Date.now(), hit = passes.get(key);
  if (hit && hit.until > t) return TESTERS.has(hit.wallet);
  let wallet; try { wallet = await prelaunch.store.authenticate(token); } catch { passes.delete(key); return false; }
  if (!TESTERS.has(wallet)) return false;
  if (passes.size > 1000) passes.clear();
  passes.set(key, { wallet, until: t + PASS_CACHE_MS });
  return true;
}
const PRIVATE_PAGE_HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
/** The owner's sign-in page for private testing. Only exists when RELEASE_STAGE=private. */
function servePrivatePage(req, res, name) {
  if (!['GET', 'HEAD'].includes(req.method)) return sendSite(req, res, 405, 'GET or HEAD required.');
  const file = { '/private-test': 'index.html', '/private-test/private-access.js': 'private-access.js', '/private-test/private-access.css': 'private-access.css' }[name];
  if (!file) return sendSite(req, res, 404, 'Not found.');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], ...PRIVATE_PAGE_HEADERS });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(path.join(PRIVATE_DIR, file)).on('error', () => res.destroy()).pipe(res);
}

function loadGame() {
  if (PRELAUNCH && !PRIVATE) return null;
  if (!fs.existsSync(path.join(GAME_DIR, 'server', 'render-server.cjs'))) {
    if (NET.key === 'mainnet') throw Error('Refusing to start: SOLANA_NETWORK=mainnet but the game is not built (run `npm run build`).');
    console.warn('[site] app/ not found – run `npm run build` to assemble the game. Website only.');
    return null;
  }
  network.assertStartup(process.env, path.join(GAME_DIR, 'server'));
  let handler, ready = true;
  try {
    handler = require(path.join(GAME_DIR, 'server', 'netlify-handler.cjs')).handler;
  } catch (e) {
    ready = false;
    console.warn('[site] Game API dependencies are not installed (run `npm run build`). The game page loads, but wallet/Ryo requests return 503.');
    handler = async () => ({ statusCode: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: 'Ryo service is unavailable: game server dependencies are not installed.' }) });
  }
  const { createServer } = require(path.join(GAME_DIR, 'server', 'render-server.cjs'));
  const server = createServer({ publicRoot: path.join(GAME_DIR, 'public'), handler });
  return { listener: server.listeners('request')[0], ready };
}

/* website config: only http(s) URLs or same-origin absolute paths are accepted */
function siteConfig() {
  const raw = (process.env.GAME_URL ?? (game ? MOUNT + '/' : '')).trim();
  const ok = raw === '' || /^\/(?!\/)/.test(raw) || /^https?:\/\/[^\s"'<>]+$/i.test(raw);
  const cfg = { gameUrl: ok ? raw : '', embedPreview: process.env.GAME_EMBED_PREVIEW !== 'false' };
  if (!ok) console.warn('[site] Ignoring invalid GAME_URL – use https://… or a path such as /play/.');
  return '/* generated by server/site-server.cjs from GAME_URL / GAME_EMBED_PREVIEW */\nwindow.SB_SITE_CONFIG=' + JSON.stringify(cfg) + ';\n';
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const SITE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' };
// Portal-only policy: the game/whitepaper have separate script requirements. No inline/external JS,
// framing, remote API or object embeds are required for off-chain wallet message authentication.
const PRELAUNCH_HEADERS = { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", 'X-Frame-Options':'DENY',
  ...(String(process.env.RYO_SITE_ORIGIN||'').startsWith('https://')?{'Strict-Transport-Security':'max-age=31536000'}:{}) };

function sendSite(req, res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...SITE_HEADERS });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** Static file from a base folder: GET/HEAD only, no dot-files or traversal, typed extensions only. */
async function serveFrom(base, req, res, name, allowed = null) {
  if (!['GET', 'HEAD'].includes(req.method)) return sendSite(req, res, 405, 'GET or HEAD required.');
  if (name.split('/').some(p => p.startsWith('.')) || name.includes('\\') || name.includes('\0')) return sendSite(req, res, 404, 'Not found.');
  const root = fs.realpathSync(base), candidate = path.resolve(root, '.' + name);
  if (!candidate.startsWith(root + path.sep)) return sendSite(req, res, 404, 'Not found.');
  let target; try { target = await fs.promises.realpath(candidate); } catch { return sendSite(req, res, 404, 'Not found.'); }
  if (!target.startsWith(root + path.sep) || (await fs.promises.stat(target)).isDirectory()) return sendSite(req, res, 404, 'Not found.');
  const ext = path.extname(target).toLowerCase(), type = TYPES[ext];
  if (!type || (allowed && !allowed.has(ext))) return sendSite(req, res, 404, 'Not found.');
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': IMAGE_TYPES.has(ext) ? 'public, max-age=86400' : 'no-cache', ...SITE_HEADERS, ...(root===fs.realpathSync(PRELAUNCH_DIR)?PRELAUNCH_HEADERS:{}) });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(target).on('error', () => res.destroy()).pipe(res);
}

function prelaunchRoute(req, res, url, name) {
  const fail = () => { if (!res.headersSent) sendSite(req, res, 503, 'Service is temporarily unavailable.'); };
  if (name === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', mode: 'prelaunch' })); }
  if (name === '/api/prelaunch') return prelaunch.handle(req, res);
  if (name === '/api/ryo' || name === '/.netlify/functions/ryo') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ error: 'The game opens at the official launch.', code: 'PRELAUNCH' })); }
  if (name === '/beta-config.json' || name === '/admin' || name.startsWith('/admin/')) return sendSite(req, res, 404, 'Not found.');
  // Game artwork stays readable (the portal and the whitepaper use it); nothing else of the game is served.
  if (name.startsWith(MOUNT + '/assets/')) return serveFrom(path.join(GAME_DIR, 'public', 'assets'), req, res, name.slice((MOUNT + '/assets').length), IMAGE_TYPES).catch(fail);
  if (name === MOUNT || name.startsWith(MOUNT + '/')) { res.writeHead(302, { Location: '/' + url.search, 'Cache-Control': 'no-store' }); return res.end(); }
  const clean = name.replace(/\.html$/, '').replace(/(.)\/$/, '$1'), page = PRELAUNCH_PAGES[clean];
  if (page && clean !== name) { res.writeHead(308, { Location: clean + url.search, 'Cache-Control': 'no-store' }); return res.end(); }
  if (page) return serveFrom(PRELAUNCH_DIR, req, res, '/' + page).catch(fail);
  if (name.startsWith('/pl/')) return serveFrom(PRELAUNCH_DIR, req, res, name.slice(3), new Set(['.css', '.js', '.json', '.webp', '.png', '.svg', '.ico'])).catch(fail);
  return null;
}

async function serveSite(req, res, name) {
  if (!['GET', 'HEAD'].includes(req.method)) return sendSite(req, res, 405, 'GET or HEAD required.');
  if (name === '/site-config.js') return sendSite(req, res, 200, siteConfig(), TYPES['.js']);
  if (name.split('/').some(p => p.startsWith('.')) || name.includes('\\') || name.includes('\0')) return sendSite(req, res, 404, 'Not found.');
  const candidate = path.resolve(SITE_DIR, '.' + (name === '/' ? '/index.html' : name));
  if (!candidate.startsWith(SITE_DIR + path.sep)) return sendSite(req, res, 404, 'Not found.');
  let target; try { target = await fs.promises.realpath(candidate); } catch { return sendSite(req, res, 404, 'Not found.'); }
  if (!target.startsWith(SITE_DIR + path.sep) || (await fs.promises.stat(target)).isDirectory()) return sendSite(req, res, 404, 'Not found.');
  const type = TYPES[path.extname(target).toLowerCase()]; if (!type) return sendSite(req, res, 404, 'Not found.');
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...SITE_HEADERS });
  if (req.method === 'HEAD') return res.end();
  if (MAINNET_RULES && NETWORK_TEXT.has(target)) return res.end(networkText(target));
  fs.createReadStream(target).on('error', () => res.destroy()).pipe(res);
}

// Live server only: the public, read-only Chapter 04 treasury transparency page and its JSON (pre-launch and
// launched). Public addresses + finalized chain observations from a process-wide 60 s cache (bounded RPC load).
// No wallet, session, signature or transaction is involved. The beta/Devnet server answers 404.
/* Founder's NFT Boxes public files, mounted in every release stage: NFT metadata JSON (the URI written into each NFT),
 * the NFT artwork, and links to the sale terms on the portal. No account, wallet or sale data is served here. */
const FOUNDERS_DIR = path.join(ROOT, 'founders', 'public');
/* After the public release the pre-launch portal (and its #founders section) is gone, but minted Founder NFTs link to
 * /founders/terms: serve the same sale terms (prelaunch/i18n/en.json fd.terms) as a plain read-only page. */
function founderTermsPage(req, res) {
  let t; try { t = JSON.parse(fs.readFileSync(path.join(PRELAUNCH_DIR, 'i18n', 'en.json'), 'utf8')); } catch { return sendSite(req, res, 503, 'Service is temporarily unavailable.'); }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const items = (Array.isArray(t['fd.terms']) ? t['fd.terms'] : []).map(x => '<li>' + esc(x) + '</li>').join('');
  const body = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Founder\'s NFT Boxes — terms · Shinobi Bombers</title>' +
    '<style>body{margin:0;font:16px/1.55 system-ui,sans-serif;background:#0d0717;color:#f6f1ff}main{max-width:760px;margin:0 auto;padding:32px 16px}h1{font-size:1.5rem}li{margin:.5em 0}a{color:#ffcf4a}</style></head>' +
    '<body><main><h1>' + esc(t['fd.title'] || "Founder's NFT Boxes") + ' — ' + esc(t['fd.terms.title'] || 'Sale terms') + '</h1><ul>' + items + '</ul><p><a href="/">Shinobi Bombers</a></p></main></body></html>';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', ...SITE_HEADERS, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
  return res.end(req.method === 'HEAD' ? undefined : body);
}
async function foundersRoute(req, res, url, name) {
  if (!['GET', 'HEAD'].includes(req.method)) return sendSite(req, res, 405, 'GET or HEAD required.');
  // Serial must exist in its tier (founders.cjs TIERS supply: Mythic #1-#33, Legacy #1-#30).
  const m = name.match(/^\/founders\/metadata\/(mythic|legacy)-([1-9][0-9]?)\.json$/);
  if (m) {
    const F = require(path.join(GAME_DIR, 'server', 'founders.cjs'));
    if (Number(m[2]) > F.TIERS[m[1]].supply) return sendSite(req, res, 404, 'Not found.');
    const body = JSON.stringify(F.metadata(process.env.RYO_SITE_ORIGIN, m[1], Number(m[2])));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*', ...SITE_HEADERS });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  if (name.startsWith('/founders/art/')) return serveFrom(FOUNDERS_DIR, req, res, name.slice('/founders'.length), new Set(['.png']));
  if (name === '/founders/terms' && !PRELAUNCH) return founderTermsPage(req, res);
  if (['/founders', '/founders/', '/founders/terms'].includes(name)) { res.writeHead(302, { Location: '/#founders', 'Cache-Control': 'no-store' }); return res.end(); }
  return sendSite(req, res, 404, 'Not found.');
}

const TREASURY_DIR = path.join(ROOT, 'treasury', 'public');
const TREASURY_FILES = { '/treasury': 'index.html', '/treasury/treasury.js': 'treasury.js', '/treasury/treasury.css': 'treasury.css' };
const TREASURY_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
let treasurySnapshot = null;
// Public JSON rate limit, per client address (Render appends the address it saw: rightmost entry).
const TREASURY_LIMIT = 60, TREASURY_WINDOW = 60000, treasuryHits = new Map();
function treasuryLimited(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean), ip = fwd.length ? fwd[fwd.length - 1] : (req.socket?.remoteAddress || 'unknown');
  const now = Date.now(); if (treasuryHits.size > 50000) treasuryHits.clear();
  const b = treasuryHits.get(ip); if (!b || now - b.start >= TREASURY_WINDOW) { treasuryHits.set(ip, { start: now, n: 1 }); return false; }
  return ++b.n > TREASURY_LIMIT;
}
// SR available for player Chest claims: from the game's own read-only action once launched; in pre-launch nothing is
// configured, so the status says so (no placeholder number). Any failure is reported as unavailable.
async function treasuryClaimFunding(dir) {
  const rewards = require(path.join(dir, 'treasury-rewards.cjs'));
  if (PRELAUNCH) return rewards.claimFundingNotConfigured();
  if (!game) return rewards.claimFundingNotConfigured('The game is not installed on this server, so no claim wallet is configured.');
  try {
    const origin = String(process.env.RYO_SITE_ORIGIN || '').trim();
    const reply = await Promise.race([require(path.join(dir, 'netlify-handler.cjs')).handler({ httpMethod: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin: new URL(origin).origin } : {}) }, body: JSON.stringify({ action: 'treasury-claim-funding' }) }),
      new Promise((_, reject) => setTimeout(() => reject(Error('timeout')), 8000))]);
    if (reply.statusCode !== 200) throw Error('status ' + reply.statusCode);
    return JSON.parse(reply.body);
  } catch { return { applicable: true, status: 'unavailable', availableRyo: null, claimsOpen: false, note: 'Claim funding is temporarily unavailable. Nothing is shown as available.' }; }
}
async function treasuryRoute(req, res, url, name) {
  if (NET.key !== 'mainnet') return sendSite(req, res, 404, 'Not found.');
  if (!['GET', 'HEAD'].includes(req.method)) return sendSite(req, res, 405, 'GET or HEAD required.');
  if (name === '/treasury/') { res.writeHead(308, { Location: '/treasury' + url.search, 'Cache-Control': 'no-store' }); return res.end(); }
  if (name === '/treasury-registry.json') {
    if (treasuryLimited(req)) { res.writeHead(429, { 'Content-Type': TYPES['.json'], 'Retry-After': '60', 'Cache-Control': 'no-store', ...SITE_HEADERS }); return res.end(JSON.stringify({ error: 'Too many requests. Try again in a minute.' })); }
    let body;
    try {
      const dir = path.join(GAME_DIR, 'server'), registry = require(path.join(dir, 'treasury-registry.cjs')), verify = require(path.join(dir, 'treasury-verify.cjs'));
      treasurySnapshot = treasurySnapshot || verify.cachedSnapshot(() => verify.mainnetConnection(process.env));
      const [snap, claimFunding] = await Promise.all([treasurySnapshot(), treasuryClaimFunding(dir)]);
      body = JSON.stringify({ marker: 'shinobi-treasury-public-v1', readOnly: true, registry: registry.publicView(), verification: verify.publicSummary(snap), claimFunding, paymentsEnabled: !PRELAUNCH && require(path.join(dir, 'launch-gates.cjs')).srRoutingEnabled(), prelaunch: PRELAUNCH });
    } catch { return sendSite(req, res, 503, 'The treasury registry is unavailable until the game build is installed.'); }
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'public, max-age=30', ...SITE_HEADERS });
    return res.end(req.method === 'HEAD' ? '' : body);
  }
  const file = TREASURY_FILES[name];
  if (!file) return sendSite(req, res, 404, 'Not found.');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache', ...SITE_HEADERS, 'Content-Security-Policy': TREASURY_CSP });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(path.join(TREASURY_DIR, file)).on('error', () => res.destroy()).pipe(res);
}

const prelaunch = PRELAUNCH ? loadPrelaunch() : null;
const game = loadGame();

/* Canonical host. Wallet sign-in, CSRF checks and Founder NFT links are bound to ONE origin (RYO_SITE_ORIGIN), so a
 * page served from an old host (e.g. shinobibombers.onrender.com after a custom domain) could never sign in. Hosts listed
 * in RYO_SITE_REDIRECT_HOSTS answer page loads (GET/HEAD) with a 301 to the same path and query on RYO_SITE_ORIGIN.
 * Never redirected: other hosts (no open redirect), other methods (the origin check already refuses them), /healthz
 * (Render health checks) and public Founder NFT metadata/art (NFTs keep resolving on every host). Unset = no change. */
const CANONICAL = (() => {
  let origin = null; try { const u = new URL(String(process.env.RYO_SITE_ORIGIN || '').trim()); if (u.protocol === 'https:' && !u.username && !u.password) origin = u.origin; } catch {}
  const hosts = new Set(String(process.env.RYO_SITE_REDIRECT_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean));
  if (origin) hosts.delete(new URL(origin).host);
  return origin && hosts.size ? { origin, hosts } : null;
})();
function canonicalRedirect(req, res, url, name) {
  if (!CANONICAL || !['GET', 'HEAD'].includes(req.method)) return false;
  const host = String(req.headers.host || '').trim().toLowerCase().replace(/:\d+$/, '');
  if (!CANONICAL.hosts.has(host) || name === '/healthz' || name.startsWith('/founders/metadata/') || name.startsWith('/founders/art/')) return false;
  res.writeHead(301, { Location: CANONICAL.origin + url.pathname + url.search, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(req.method === 'HEAD' ? undefined : 'Moved to ' + CANONICAL.origin + '\n');
  return true;
}

const server = http.createServer((req, res) => {
  let url; try { url = new URL(req.url, 'http://localhost'); } catch { return sendSite(req, res, 400, 'Invalid path.'); }
  let name; try { name = decodeURIComponent(url.pathname); } catch { return sendSite(req, res, 400, 'Invalid path.'); }
  if (canonicalRedirect(req, res, url, name)) return;
  // Read-only release policy: available during pre-launch without mounting any game or money API.
  if (require('../dev-vfx-lab/handler.cjs').handle(req, res, name)) return;
  if(name==='/economy-policy.json'){
    if(!['GET','HEAD'].includes(req.method))return sendSite(req,res,405,'GET or HEAD required.');
    try { const policy=require(path.join(GAME_DIR,'server/sr-revenue.cjs')).publicPolicy();
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...SITE_HEADERS});
      return res.end(req.method==='HEAD'?'':JSON.stringify({...policy,prelaunch:PRELAUNCH,monetaryEndpointsMounted:!PRELAUNCH}));
    }catch{return sendSite(req,res,503,'Economy policy is unavailable until the game build is installed.');}
  }
  if (name === '/founders' || name.startsWith('/founders/')) return foundersRoute(req, res, url, name).catch(() => { if (!res.headersSent) sendSite(req, res, 503, 'Service is temporarily unavailable.'); });
  if (name === '/treasury' || name.startsWith('/treasury/') || name === '/treasury-registry.json') return treasuryRoute(req, res, url, name).catch(() => { if (!res.headersSent) sendSite(req, res, 503, 'Service is temporarily unavailable.'); });
  if (PRIVATE && gamePath(name)) {
    const fail = () => { if (!res.headersSent) sendSite(req, res, 503, 'Service is temporarily unavailable.'); };
    return privatePass(req).then(ok => {
      if (ok) { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); return route(req, res, url, name, true); }
      // No pass: exactly the portal's answer for this path (302 to the portal, 403 PRELAUNCH, 404, or artwork).
      if (prelaunchRoute(req, res, url, name) === null) sendSite(req, res, 404, 'Not found.');
    }).catch(fail);
  }
  if (PRIVATE && (name === '/private-test' || name.startsWith('/private-test/'))) return servePrivatePage(req, res, name);
  if (PRELAUNCH && prelaunchRoute(req, res, url, name) !== null) return;
  route(req, res, url, name, !PRELAUNCH);
});

/* Mainnet without the token settings (private live testing before the SR mint is registered): the game's own
 * /beta-config.json answers 503, so the browser falls back to Solana's public RPC, which refuses website requests
 * (403 "Access forbidden"). Answer with the network and the browser RPC only; the client accepts this form
 * ({network, rpcUrl}, no tokenAddress) and keeps every payment path disabled. Anything else: the game's own answer. */
function rpcOnlyConfig(req, res) {
  if (NET.key !== 'mainnet' || process.env.RYO_TOKEN_MINT) return false;   // with the mint, the game's own config answers (studio wallet optional on live)
  let rpcUrl; try { const u = new URL(String(process.env.SOLANA_PUBLIC_RPC_URL || '')); if (u.protocol !== 'https:' || u.username || u.password) return false; rpcUrl = u.href; } catch { return false; }
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ network: NET.id, rpcUrl }));
  return true;
}

/** Website, admin shell and (when `gameOpen`) the game. While the portal is public, gameOpen is true only after a private pass. */
function route(req, res, url, name, gameOpen) {
  // Public login shell only. Every data read and mutation uses the wallet-authenticated Ryo API.
  if (name === '/admin') { res.writeHead(308, { Location: '/admin/', 'Cache-Control': 'no-store' }); return res.end(); }
  if (name === '/admin/command-center') { res.writeHead(308, { Location: '/admin/command-center/', 'Cache-Control': 'no-store' }); return res.end(); }
  if (name.startsWith('/admin/')) {
    if (!['GET', 'HEAD'].includes(req.method)) return sendSite(req, res, 405, 'GET or HEAD required.');
    // Fixed file maps only: the Ryo Observatory, and the Command Center (staff console, shown network comes from the API).
    const cc = { '/admin/command-center/': 'index.html', '/admin/command-center/cc.js': 'cc.js', '/admin/command-center/cc.css': 'cc.css' }[name];
    const file = cc || { '/admin/': 'index.html', '/admin/dashboard.js': 'dashboard.js', '/admin/dashboard.css': 'dashboard.css' }[name];
    if (!file) return sendSite(req, res, 404, 'Not found.');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-store', ...SITE_HEADERS, ...(cc ? { 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' } : {}),
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    if (req.method === 'HEAD') return res.end();
    if (cc) { fs.createReadStream(path.join(CC_DIR, file)).on('error', () => res.destroy()).pipe(res); return; }
    if (MAINNET_RULES) return res.end(networkText(path.join(ADMIN_DIR, file)));
    fs.createReadStream(path.join(ADMIN_DIR, file)).on('error', () => res.destroy()).pipe(res); return;
  }
  // The whitepaper (website/whitepaper.html) at a clean URL, with or without the game installed.
  if (name === '/whitepaper/' || name === '/whitepaper.html') { res.writeHead(308, { Location: '/whitepaper' + url.search, 'Cache-Control': 'no-store' }); return res.end(); }
  if (name === '/whitepaper') return serveSite(req, res, '/whitepaper.html').catch(() => { if (!res.headersSent) sendSite(req, res, 503, 'Service is temporarily unavailable.'); });
  if (game && gameOpen) {
    if ((name === '/beta-config.json' || name === MOUNT + '/beta-config.json') && rpcOnlyConfig(req, res)) return;
    if (GAME_ROOT_PATHS.has(name)) return game.listener(req, res);
    if (name === '/' && !PRELAUNCH) { res.writeHead(302, { Location: MOUNT + '/' + url.search, 'Cache-Control': 'no-store', ...SITE_HEADERS }); return res.end(); }
    if (name === MOUNT) { res.writeHead(308, { Location: MOUNT + '/' + url.search }); return res.end(); }
    if (url.pathname.startsWith(MOUNT + '/')) { req.url = url.pathname.slice(MOUNT.length) + url.search; return game.listener(req, res); }
    if (gamePath(name)) return sendSite(req, res, 404, 'Not found.');   // e.g. an encoded mount path: never served from website/
  } else if (game) {
    if (gamePath(name)) return sendSite(req, res, 404, 'Not found.');   // closed game (no private pass): never reachable here, kept as a backstop
  } else if (name === MOUNT || name.startsWith(MOUNT + '/') || GAME_ROOT_PATHS.has(name)) {
    return sendSite(req, res, 503, 'The game is not installed on this server yet.');
  }
  serveSite(req, res, name).catch(() => { if (!res.headersSent) sendSite(req, res, 503, 'Service is temporarily unavailable.'); });
}
server.requestTimeout = 30000; server.headersTimeout = 15000;

if (require.main === module) {
  const port = Number(process.env.PORT) || 10000;
  server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`[site] Website on http://localhost:${port}/  ·  Solana ${NET.label}${PRIVATE ? '  ·  PRE-LAUNCH portal public  ·  PRIVATE LIVE TESTING (game for ' + TESTERS.size + ' allowlisted wallet' + (TESTERS.size === 1 ? '' : 's') + ' only)' : PRELAUNCH ? '  ·  PRE-LAUNCH portal (game closed until launch)' :'  ·  game ' + (game ? 'at ' + MOUNT + '/' + (game.ready ? '' : ' (API dependencies missing)') : 'not installed')}`);
    if (game && !process.env.RYO_SITE_ORIGIN) console.warn('[site] RYO_SITE_ORIGIN is not set – wallet sign-in will be rejected until it matches this host\'s public origin.');
  });
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 10000).unref(); });
}
module.exports = { server, siteConfig, prelaunch };
