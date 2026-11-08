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
const GAME_DIR = path.resolve(process.env.GAME_RUNTIME_DIR || path.join(ROOT, 'app'));   // assembled by `npm run build`
const MOUNT = '/play';
const GAME_ROOT_PATHS = new Set(['/.netlify/functions/ryo', '/api/ryo', '/beta-config.json', '/healthz']);
const network = require(path.join(ROOT, 'network', 'network.cjs'));
const NET = network.resolve();
// Files served from this repo (not app/) that name the network: reworded on the live server.
const NETWORK_TEXT = new Set([path.join(ADMIN_DIR, 'index.html'), path.join(ADMIN_DIR, 'dashboard.js'), path.join(SITE_DIR, 'game-link', 'game-link.js')]);
const MAINNET_RULES = NET.key === 'mainnet' ? network.mainnetRules() : null;
const networkText = file => network.rewriteText(fs.readFileSync(file, 'utf8'), file, MAINNET_RULES);

// PRELAUNCH_MODE=on (live server before launch): only the pre-launch portal and its API are served;
// the game page, the game API and the admin dashboard are not mounted at all (see prelaunch/server.cjs).
const PRELAUNCH = network.prelaunch();
const PRELAUNCH_DIR = path.join(ROOT, 'prelaunch');
const PRELAUNCH_PAGES = { '/': 'index.html', '/rules': 'rules.html', '/privacy': 'privacy.html', '/terms': 'terms.html' };
const IMAGE_TYPES = new Set(['.webp', '.png', '.jpg', '.svg']);

function loadPrelaunch() {
  if (!fs.existsSync(path.join(GAME_DIR, 'server', 'store.cjs'))) throw Error('Refusing to start: PRELAUNCH_MODE=on but the app is not built (run `npm run build`).');
  network.assertStartup(process.env, path.join(GAME_DIR, 'server'));
  return require(path.join(PRELAUNCH_DIR, 'server.cjs')).createPrelaunch({ gameDir: GAME_DIR });
}

function loadGame() {
  if (PRELAUNCH) return null;
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

/* Test server only (Devnet): SOLANA_DEVNET_PUBLIC_RPC_URL replaces the browser's Devnet RPC in /beta-config.json,
 * e.g. a provider key restricted to this domain, because Solana's free public RPC refuses some players' networks
 * (HTTP 403 "Access forbidden"). Unset, invalid or on Mainnet: ignored, and the game's own answer is served unchanged.
 * The response mirrors app/server/render-server.cjs exactly except rpcUrl; the client still verifies the Devnet genesis
 * before any transaction, so a wrong-network URL fails closed. Server-side RPC stays SOLANA_DEVNET_RPC_URL. */
const DEVNET_PUBLIC_RPC = (() => {
  const raw = String(process.env.SOLANA_DEVNET_PUBLIC_RPC_URL || '').trim();
  if (!raw || NET.key !== 'devnet') return null;
  try { const u = new URL(raw); if (u.protocol === 'https:' && !u.username && !u.password) return u.href; } catch {}
  console.warn('[site] Ignoring SOLANA_DEVNET_PUBLIC_RPC_URL: it must be an https:// URL.');
  return null;
})();
function betaConfig(req, res) {
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data)); };
  if (!['GET', 'HEAD'].includes(req.method)) return send(405, { error: 'GET or HEAD required.' });
  if (!process.env.RYO_TOKEN_MINT || !process.env.RYO_STUDIO_WALLET) return send(503, { error: 'Public token configuration is not ready.' });
  return send(200, { network: 'solana-devnet', rpcUrl: DEVNET_PUBLIC_RPC, tokenAddress: process.env.RYO_TOKEN_MINT, studioAddress: process.env.RYO_STUDIO_WALLET });
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
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': IMAGE_TYPES.has(ext) ? 'public, max-age=86400' : 'no-cache', ...SITE_HEADERS });
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

const prelaunch = PRELAUNCH ? loadPrelaunch() : null;
const game = loadGame();

const server = http.createServer((req, res) => {
  let url; try { url = new URL(req.url, 'http://localhost'); } catch { return sendSite(req, res, 400, 'Invalid path.'); }
  let name; try { name = decodeURIComponent(url.pathname); } catch { return sendSite(req, res, 400, 'Invalid path.'); }
  // Read-only release policy: available during pre-launch without mounting any game or money API.
  if (require('../dev-vfx-lab/handler.cjs').handle(req, res, name)) return;
  if(name==='/economy-policy.json'){
    if(!['GET','HEAD'].includes(req.method))return sendSite(req,res,405,'GET or HEAD required.');
    try { const policy=require(path.join(GAME_DIR,'server/sr-revenue.cjs')).publicPolicy();
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...SITE_HEADERS});
      return res.end(req.method==='HEAD'?'':JSON.stringify({...policy,prelaunch:PRELAUNCH,monetaryEndpointsMounted:!PRELAUNCH}));
    }catch{return sendSite(req,res,503,'Economy policy is unavailable until the game build is installed.');}
  }
  if (PRELAUNCH && prelaunchRoute(req, res, url, name) !== null) return;
  // Public login shell only. Every data read and mutation uses the wallet-authenticated Ryo API.
  if (name === '/admin') { res.writeHead(308, { Location: '/admin/', 'Cache-Control': 'no-store' }); return res.end(); }
  if (name.startsWith('/admin/')) {
    if (!['GET', 'HEAD'].includes(req.method)) return sendSite(req, res, 405, 'GET or HEAD required.');
    const file = { '/admin/': 'index.html', '/admin/dashboard.js': 'dashboard.js', '/admin/dashboard.css': 'dashboard.css' }[name];
    if (!file) return sendSite(req, res, 404, 'Not found.');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-store', ...SITE_HEADERS,
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    if (req.method === 'HEAD') return res.end();
    if (MAINNET_RULES) return res.end(networkText(path.join(ADMIN_DIR, file)));
    fs.createReadStream(path.join(ADMIN_DIR, file)).on('error', () => res.destroy()).pipe(res); return;
  }
  // The whitepaper (website/whitepaper.html) at a clean URL, with or without the game installed.
  if (name === '/whitepaper/' || name === '/whitepaper.html') { res.writeHead(308, { Location: '/whitepaper' + url.search, 'Cache-Control': 'no-store' }); return res.end(); }
  if (name === '/whitepaper') return serveSite(req, res, '/whitepaper.html').catch(() => { if (!res.headersSent) sendSite(req, res, 503, 'Service is temporarily unavailable.'); });
  if (game) {
    if (name === '/beta-config.json' && DEVNET_PUBLIC_RPC) return betaConfig(req, res);
    if (GAME_ROOT_PATHS.has(name)) return game.listener(req, res);
    if (name === '/') { res.writeHead(302, { Location: MOUNT + '/' + url.search, 'Cache-Control': 'no-store', ...SITE_HEADERS }); return res.end(); }
    if (name === MOUNT) { res.writeHead(308, { Location: MOUNT + '/' + url.search }); return res.end(); }
    if (url.pathname.startsWith(MOUNT + '/')) { req.url = url.pathname.slice(MOUNT.length) + url.search; return game.listener(req, res); }
  } else if (name === MOUNT || name.startsWith(MOUNT + '/') || GAME_ROOT_PATHS.has(name)) {
    return sendSite(req, res, 503, 'The game is not installed on this server yet.');
  }
  serveSite(req, res, name).catch(() => { if (!res.headersSent) sendSite(req, res, 503, 'Service is temporarily unavailable.'); });
});
server.requestTimeout = 30000; server.headersTimeout = 15000;

if (require.main === module) {
  const port = Number(process.env.PORT) || 10000;
  server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`[site] Website on http://localhost:${port}/  ·  Solana ${NET.label}${PRELAUNCH ? '  ·  PRE-LAUNCH portal (game closed until launch)' : '  ·  game ' + (game ? 'at ' + MOUNT + '/' + (game.ready ? '' : ' (API dependencies missing)') : 'not installed')}`);
    if (game && !process.env.RYO_SITE_ORIGIN) console.warn('[site] RYO_SITE_ORIGIN is not set – wallet sign-in will be rejected until it matches this host\'s public origin.');
  });
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 10000).unref(); });
}
module.exports = { server, siteConfig, prelaunch };
