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
  if (!fs.existsSync(path.join(publicDir, 'assets', 'design-v3', 'ref-login.png'))) {
    throw new Error('Cannot apply login artwork: original reference image is missing.');
  }

  fs.mkdirSync(assets, { recursive: true });
  for (const file of ['login-exact.css', 'login-exact.js']) {
    fs.copyFileSync(path.join(__dirname, 'login-screen', file), path.join(assets, file));
  }
  if (!html.includes(marker)) {
    html = html.replace('</head>', `${marker}\n<link rel="stylesheet" href="assets/login-exact/login-exact.css">\n<script defer src="assets/login-exact/login-exact.js"></script>\n</head>`);
    fs.writeFileSync(index, html);
  }
  console.log('Exact login artwork and existing wallet controls applied.');
}

module.exports = { applyLoginScreen };
if (require.main === module) applyLoginScreen();
