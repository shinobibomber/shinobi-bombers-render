/* Applies the Shinobi Bombers website designs (website/) to the game's menu screens.
 *
 * Runs after the 17 existing helpers. It copies the website's screen artwork and screen data into
 * app/public/assets/website-design/ and adds one stylesheet and one deferred script to the game page.
 * The game engine, server, saves, wallet and economy code are not modified: the script draws the website screen
 * above the matching game menu and connects its controls to the game's own functions and live state.
 *
 * Screens enabled in this build are listed in SCREENS (website screen id → game page).
 */
const fs = require('node:fs');
const path = require('node:path');

const SCREENS = ['home', 'codex', 'summon', 'fusion', 'dojo', 'heroes', 'adventure', 'market', 'boss-hunt', 'guild', 'chat'];
const EXTRA_ART = ['assets/sm-tab-on.webp', 'assets/sm-tab-off.webp'];

function applyWebsiteDesign(appDir = path.join(__dirname, 'app'), siteDir = path.join(__dirname, 'website')) {
  const publicDir = path.join(appDir, 'public');
  const index = path.join(publicDir, 'index.html');
  const marker = '<!-- website-design -->';
  let html = fs.readFileSync(index, 'utf8');
  if (!html.includes(marker) && !html.includes('</head>')) throw new Error('Cannot apply website designs: game HTML has no closing head.');

  const site = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
  const match = site.match(/<script type="application\/json" id="sbdata">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Cannot apply website designs: website/index.html has no screen data.');
  const data = JSON.parse(match[1]);

  const out = path.join(publicDir, 'assets', 'website-design');
  fs.mkdirSync(path.join(out, 'art'), { recursive: true });
  const copy = rel => {
    const from = path.join(siteDir, rel);
    if (!fs.existsSync(from)) throw new Error('Cannot apply website designs: missing ' + rel);
    fs.copyFileSync(from, path.join(out, 'art', path.basename(rel)));
    return 'art/' + path.basename(rel);
  };

  const screens = {};
  for (const id of SCREENS) {
    const s = data[id];
    if (!s || !s.hs) throw new Error('Cannot apply website designs: screen "' + id + '" not found in website data.');
    screens[id] = { ...s, img: copy(s.img) };
  }
  for (const rel of EXTRA_ART) copy(rel);
  // One shared header for every screen (website-design/shared-header.webp, made by website-src/make_game_patches.py
  // from the Guild header). Each screen's own header hotspots, Chest button and Ryo label are removed; hdrH records
  // where the screen's own header ends so the runtime can tuck it under the shared header.
  const isHdr = h => h.id === 'logo' || h.id === 'wallet' || h.id === 'ryoplus' || h.id.startsWith('nav-');
  for (const f of ['shared-header.webp']) fs.copyFileSync(path.join(__dirname, 'website-design', f), path.join(out, 'art', f));
  const g = data.guild;
  const header = { img: 'art/shared-header.webp', W: 1536, H: 124, body: 112, hs: g.hs.filter(isHdr), chest: g.chest, hdr: g.hdr, live: g.live.filter(l => l.id === 'ryo') };
  const bottom = s => Math.max(s.chest ? s.chest.r[3] : 0, ...s.hs.filter(isHdr).map(h => h.r[3])) + 4;
  // Dojo: the artwork's three panels become three pages (website-design/dojo-views.json): Services (landing),
  // Upgrades (Enter Dojo) and Sensei (Manage Sensei). Hotspots and live labels are mapped panel by panel.
  const views = JSON.parse(fs.readFileSync(path.join(__dirname, 'website-design', 'dojo-views.json'), 'utf8'));
  const dojoSrc = screens.dojo;
  for (const [key, v] of Object.entries(views)) {
    fs.copyFileSync(path.join(__dirname, 'website-design', 'scr-' + key + '.webp'), path.join(out, 'art', 'scr-' + key + '.webp'));
    const map = r => { const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, p = v.panels.find(p => cx >= p.src[0] && cx < p.src[2] && cy >= p.src[1] && cy < p.src[3]); if (!p) return null;
      return [p.dst[0] + (r[0] - p.src[0]) * p.k, p.dst[1] + (r[1] - p.src[1]) * p.k, p.dst[0] + (r[2] - p.src[0]) * p.k, p.dst[1] + (r[3] - p.src[1]) * p.k].map(Math.round); };
    const d = dojoSrc;
    screens[key] = { ...d, W: v.W, H: v.H, img: 'art/scr-' + key + '.webp', view: v.panels, base: 'dojo', hdrH: 112,
      hs: d.hs.filter(h => !isHdr(h)).map(h => ({ ...h, r: map(h.r) })).filter(h => h.r),
      fx: d.fx.map(f => { const r = map([f.x - f.w / 2, f.y - f.h / 2, f.x + f.w / 2, f.y + f.h / 2]); return r && { ...f, x: (r[0] + r[2]) / 2, y: (r[1] + r[3]) / 2, w: r[2] - r[0], h: r[3] - r[1] }; }).filter(Boolean),
      live: d.live.filter(l => l.id !== 'ryo') };
  }
  for (const [id, s] of Object.entries(screens)) {
    if (s.view) continue;
    screens[id] = { ...s, hdrH: bottom(s), hs: s.hs.filter(h => !isHdr(h)), live: s.live.filter(l => l.id !== 'ryo'), chest: null, hdr: null };
  }
  // reference galleries used by the Codex sections (maps, bosses, hero models, auras)
  const ref = JSON.parse(JSON.stringify(data.ref || {}));
  const walk = o => { for (const k in o) { if (o[k] && typeof o[k] === 'object') walk(o[k]); else if (k === 'src') o[k] = copy(o[k]); } };
  walk(ref);
  fs.writeFileSync(path.join(out, 'screens.json'), JSON.stringify({ screens, ref, header }));

  for (const file of ['website-screens.css', 'website-design.css', 'website-design.js']) {
    fs.copyFileSync(path.join(__dirname, 'website-design', file), path.join(out, file));
  }
  if (!html.includes(marker)) {
    html = html.replace('</head>', `${marker}\n<link rel="stylesheet" href="assets/website-design/website-screens.css">\n<link rel="stylesheet" href="assets/website-design/website-design.css">\n<script defer src="assets/website-design/website-design.js"></script>\n</head>`);
    fs.writeFileSync(index, html);
  }
  console.log('Website designs applied to game screens: ' + SCREENS.join(', ') + '.');
}

module.exports = { applyWebsiteDesign, SCREENS };
if (require.main === module) applyWebsiteDesign();
