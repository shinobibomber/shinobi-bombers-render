const fs = require('node:fs');
const path = require('node:path');

function applyMainMenu(appDir = path.join(__dirname, 'app')) {
  const publicDir = path.join(appDir, 'public');
  const index = path.join(publicDir, 'index.html');
  let html = fs.readFileSync(index, 'utf8');
  const marker = '<!-- exact-main-menu -->';
  const assets = path.join(publicDir, 'assets', 'main-menu');

  if (!html.includes(marker) && !html.includes('</head>')) {
    throw new Error('Cannot apply main menu artwork: application HTML has no closing head.');
  }
  if (!fs.existsSync(path.join(publicDir, 'assets', 'design-v3', 'ref-home.png'))) {
    throw new Error('Cannot apply main menu artwork: original reference image is missing.');
  }

  fs.mkdirSync(assets, { recursive: true });
  for (const file of ['main-menu.css', 'main-menu.js']) {
    fs.copyFileSync(path.join(__dirname, 'main-menu', file), path.join(assets, file));
  }
  if (!html.includes(marker)) {
    html = html.replace('</head>', `${marker}\n<link rel="stylesheet" href="assets/main-menu/main-menu.css">\n<script defer src="assets/main-menu/main-menu.js"></script>\n</head>`);
    fs.writeFileSync(index, html);
  }
  console.log('Exact main menu artwork and live player panels applied.');
}

module.exports = { applyMainMenu };
if (require.main === module) applyMainMenu();
