const fs = require('node:fs');
const path = require('node:path');

function applyLoginScreen(appDir = path.join(__dirname, 'app')) {
  const publicDir = path.join(appDir, 'public');
  const index = path.join(publicDir, 'index.html');
  let html = fs.readFileSync(index, 'utf8');
  const marker = '<!-- exact-login-screen -->';
  const assets = path.join(publicDir, 'assets', 'login-exact');

  if (!html.includes(marker) && !html.includes('</head>')) {
    throw new Error('Cannot apply login artwork: application HTML has no closing head.');
  }
  if (!fs.existsSync(path.join(__dirname, 'login-screen', 'login-reference.png'))) {
    throw new Error('Cannot apply login artwork: approved reference image is missing.');
  }

  fs.mkdirSync(assets, { recursive: true });
  for (const file of ['login-exact.css', 'login-exact.js', 'login-reference.png']) {
    fs.copyFileSync(path.join(__dirname, 'login-screen', file), path.join(assets, file));
  }
  if (!html.includes(marker)) {
    html = html.replace('</head>', `${marker}\n<link rel="stylesheet" href="assets/login-exact/login-exact.css">\n<script defer src="assets/login-exact/login-exact.js"></script>\n</head>`);
    fs.writeFileSync(index, html);
  }
  // Live network line over the painted Devnet note (live build only; see login-network.js), and the official community
  // links behind the artwork's Discord / X / Pump.fun buttons (public URLs, owner request 2026-11-09).
  for (const file of ['login-network.css', 'login-network.js']) fs.copyFileSync(path.join(__dirname, 'login-screen', file), path.join(assets, file));
  const networkMarker = '<!-- login-network-note -->';
  if (!html.includes(networkMarker)) {
    html = html.replace('<script defer src="assets/login-exact/login-exact.js"></script>\n', m => `${m}${networkMarker}\n<link rel="stylesheet" href="assets/login-exact/login-network.css">\n<script defer src="assets/login-exact/login-network.js"></script>\n`);
    if (!html.includes(networkMarker)) throw new Error('Cannot apply the login network line: login artwork script tag not found.');
    fs.writeFileSync(index, html);
  }
  const links = JSON.parse(fs.readFileSync(path.join(__dirname, 'login-screen', 'community-links.json'), 'utf8'));
  for (const key of ['discord', 'x', 'pumpfun']) if (!/^https:\/\/[^\s"'<>]+$/.test(links[key] || '')) throw new Error('community-links.json: ' + key + ' must be an https:// URL.');
  fs.writeFileSync(path.join(publicDir, 'community-links.json'), JSON.stringify(links, null, 2) + '\n');
  console.log('Exact login artwork and existing wallet controls applied.');
}

module.exports = { applyLoginScreen };
if (require.main === module) applyLoginScreen();
