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
  // game-only artwork patches made by website-src/make_game_patches.py
  for (const f of ['adventure-tr-patch.webp']) fs.copyFileSync(path.join(__dirname, 'website-design', f), path.join(out, 'art', f));
  // reference galleries used by the Codex sections (maps, bosses, hero models, auras)
  const ref = JSON.parse(JSON.stringify(data.ref || {}));
  const walk = o => { for (const k in o) { if (o[k] && typeof o[k] === 'object') walk(o[k]); else if (k === 'src') o[k] = copy(o[k]); } };
  walk(ref);
  fs.writeFileSync(path.join(out, 'screens.json'), JSON.stringify({ screens, ref }));

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
