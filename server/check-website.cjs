/* Build guard (dependency-free): the website is the final design served at "/".
   Fails the build if a required website file is missing, if any website script has a syntax error,
   or if the website entry page was replaced by the game assembly. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const site = path.resolve(__dirname, '..', 'website');
const required = ['index.html', 'app.js', 'app.css', 'cm.js', 'cm.css', 'site-config.js', 'game-link/game-link.js', 'game-link/game-link.css', 'whitepaper.html'];
const missing = required.filter(f => !fs.existsSync(path.join(site, f)));
if (missing.length) { console.error('Website files missing: ' + missing.join(', ')); process.exit(1); }
for (const f of required.filter(f => f.endsWith('.js'))) {
  try { new vm.Script(fs.readFileSync(path.join(site, f), 'utf8'), { filename: f }); } catch (e) { console.error('Website script error in ' + f + ': ' + e.message); process.exit(1); }
}
const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
if (!html.includes('id="sbdata"') || !html.includes('game-link/game-link.js')) { console.error('website/index.html is not the website entry page (was it overwritten?).'); process.exit(1); }
const assets = fs.readdirSync(path.join(site, 'assets')).filter(f => f.endsWith('.webp')).length;
if (assets < 80) { console.error('Website artwork incomplete: ' + assets + ' assets.'); process.exit(1); }
// Pre-launch portal (served at "/" when PRELAUNCH_MODE=on): files present, scripts parse, both languages complete.
const pre = path.resolve(__dirname, '..', 'prelaunch');
const preFiles = ['index.html', 'rules.html', 'privacy.html', 'terms.html', 'prelaunch.css', 'prelaunch.js', 'wallet.js', 'server.cjs', 'schema.sql', 'announcements.json', 'i18n/en.json', 'i18n/pt-BR.json', 'assets/logo.webp'];
const preMissing = preFiles.filter(f => !fs.existsSync(path.join(pre, f)));
if (preMissing.length) { console.error('Pre-launch files missing: ' + preMissing.join(', ')); process.exit(1); }
for (const f of ['prelaunch.js', 'wallet.js']) { try { new vm.Script(fs.readFileSync(path.join(pre, f), 'utf8'), { filename: f }); } catch (e) { console.error('Pre-launch script error in ' + f + ': ' + e.message); process.exit(1); } }
let en, pt;
try { en = JSON.parse(fs.readFileSync(path.join(pre, 'i18n/en.json'), 'utf8')); pt = JSON.parse(fs.readFileSync(path.join(pre, 'i18n/pt-BR.json'), 'utf8')); JSON.parse(fs.readFileSync(path.join(pre, 'announcements.json'), 'utf8')); }
catch (e) { console.error('Pre-launch JSON error: ' + e.message); process.exit(1); }
const gaps = [...Object.keys(en).filter(k => !(k in pt)).map(k => 'pt-BR lacks ' + k), ...Object.keys(pt).filter(k => !(k in en)).map(k => 'en lacks ' + k)];
if (gaps.length) { console.error('Pre-launch translations incomplete: ' + gaps.slice(0, 5).join(', ')); process.exit(1); }
console.log('Website checked: ' + required.length + ' files, ' + assets + ' artwork assets. Served at "/", game at "/play/". Pre-launch portal: ' + preFiles.length + ' files, ' + Object.keys(en).length + ' texts in EN + PT-BR.');
