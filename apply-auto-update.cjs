/* Update notice build step (after apply-hero-passes; see unpack.cjs). Owner request 2026-11-11: after a deploy, open game pages
 * reload themselves (10 s warning banner) and come back signed in on the Adventure map. Copies auto-update/auto-update.js to the
 * client and adds one script tag; no existing game line is edited, so there is no hook to reverse in tests/preservation.cjs
 * beyond removing the marker block. The version comes from GET /version.json (server/site-server.cjs). */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const marker = '<!-- auto-update -->', script = '<script defer src="assets/auto-update/auto-update.js"></script>';
function applyAutoUpdate(appDir = path.join(__dirname, 'app')) {
  const assets = path.join(appDir, 'public/assets/auto-update');
  fs.rmSync(assets, { recursive: true, force: true }); fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'auto-update', 'auto-update.js'), path.join(assets, 'auto-update.js'));
  const index = path.join(appDir, 'public/index.html');
  let html = fs.readFileSync(index, 'utf8');
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Auto-update: expected one </head>.');
    html = html.replace('</head>', () => marker + '\n' + script + '\n</head>');
  }
  fs.writeFileSync(index, html);
  console.log('Auto-update applied: open game pages reload after a deploy (10 s warning).');
}
module.exports = { applyAutoUpdate, marker, script };
if (require.main === module) applyAutoUpdate();
