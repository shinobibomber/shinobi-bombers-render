/* Display & Accessibility build step (after apply-starter-pack): the settings module and stylesheet
 * (first in <head>, so every later module sees the saved choices), the account-sync action, and
 * presentation hooks in the game renderers: screen shake, explosion bursts (Off = static tile
 * markers), glow, hit flashes and the Boss Hunt danger telegraph. Gameplay is never touched.
 * Exact-string hooks; tests/preservation.cjs reverses displayPatches. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const marker = '<!-- display-settings -->', tags = '<link rel="stylesheet" href="assets/display-settings/display-settings.css">\n<script defer src="assets/display-settings/display-settings.js"></script>';
const displayPatches = [
  ['if(shake>.01&&!reduced){', 'if(shake>.01&&!reduced&&window.DisplaySettings?.v.shake!==false){', 1],
  // Explosions Off: no burst; the hit tile (and an ultimate's 4 neighbours) gets a static marker.
  ['function impactFx(gx,gy,kind,big,killed,boss){', "function impactFx(gx,gy,kind,big,killed,boss){if(window.DisplaySettings?.v.explosions==='off'){for(const [dx,dy] of big?[[0,0],[1,0],[-1,0],[0,1],[0,-1]]:[[0,0]])emit({t:'mark',gx:gx+dx,gy:gy+dy,life:.7,max:.7});return}", 1],
  ["if(p.t==='spark'){g.globalCompositeOperation='lighter';",
   "if(p.t==='mark'){const DS=window.DisplaySettings?.v||{},cb=DS.colorblind,col=cb?'#ffd400':'#ff5a4a',pts=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([a,b])=>proj(p.gx+a,p.gy+b,1));g.globalCompositeOperation='source-over';g.globalAlpha=Math.min(1,k*2.2);g.lineWidth=DS.highContrast?4:3;g.strokeStyle=col;g.setLineDash(cb?[6,4]:[]);g.beginPath();pts.forEach((q,i)=>i?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]));g.closePath();g.fillStyle=col+'33';g.fill();g.stroke();g.setLineDash([])}else if(p.t==='spark'){g.globalCompositeOperation='lighter';", 1],
  ["else if(p.t==='glow'){g.globalCompositeOperation='lighter';g.globalAlpha=k;", "else if(p.t==='glow'){g.globalCompositeOperation='lighter';g.globalAlpha=k*(window.DisplaySettings?.v.bloom===false?.35:1);", 1],
  ['if(a.hit>0){g.globalAlpha=Math.min(1,a.hit/.1);SS.blit(g,SS.whiteOf(', 'if(a.hit>0){g.globalAlpha=Math.min(1,a.hit/.1)*(window.DisplaySettings?.v.flashing===false?.35:1);SS.blit(g,SS.whiteOf(', 1],
  // The Boss Hunt shockwave telegraph: thicker (high contrast), dashed with a symbol (colorblind).
  ["c.strokeStyle='#ff8d6666';c.lineWidth=6;c.beginPath();c.ellipse(600,420,450,155,0,0,7);c.stroke();c.fillStyle='#ffc399';c.font='bold 16px system-ui';c.fillText('SHOCKWAVE INCOMING',600,625)",
   "const DSv=window.DisplaySettings?.v||{};c.strokeStyle=DSv.colorblind?'#ffd400cc':DSv.highContrast?'#ff6a4acc':'#ff8d6666';c.lineWidth=DSv.highContrast?10:6;c.setLineDash(DSv.colorblind?[18,10]:[]);c.beginPath();c.ellipse(600,420,450,155,0,0,7);c.stroke();c.setLineDash([]);c.fillStyle=DSv.colorblind?'#ffd400':'#ffc399';c.font='bold '+(DSv.highContrast?20:16)+'px system-ui';c.fillText((DSv.colorblind?'⚠ ':'')+'SHOCKWAVE INCOMING',600,625)", 1],
  ['get particles(){return parts.length},', "get particles(){return parts.length},get marks(){return parts.filter(p=>p.t==='mark').length},", 1],
  ['window.RyoPayments={box:', "window.RyoPayments={displaySettings:(display)=>api('display-settings',{display}).then(data=>{accept(data);return data}),box:", 1]
];
const serviceHooks = [["  if(action==='mythic-refresh'){", "  if(action==='display-settings'){await require('./display-settings.cjs').save(store,wallet,body);return state(wallet)}\n  if(action==='mythic-refresh'){", 1]];
function replaceCount(text, [before, after, count = 1], label) {
  if (text.split(after).length - 1 === count && (!text.includes(before) || after.includes(before))) return text;
  const n = text.split(before).length - 1; if (n !== count) throw Error('Display settings patch mismatch: ' + label + ' (' + n + ')');
  return text.split(before).join(after);
}
function applyDisplaySettings(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'display-settings'), dest = path.join(appDir, 'public/assets/display-settings');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['display-settings.js', 'display-settings.css']) fs.copyFileSync(path.join(src, f), path.join(dest, f));
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(appDir, 'server/display-settings.cjs'));
  const service = path.join(appDir, 'server/service.cjs');
  fs.writeFileSync(service, serviceHooks.reduce((t, h, i) => replaceCount(t, h, 'service ' + i), fs.readFileSync(service, 'utf8')));
  const index = path.join(appDir, 'public/index.html');
  let html = displayPatches.reduce((t, h, i) => replaceCount(t, h, 'client ' + i), fs.readFileSync(index, 'utf8'));
  if (!html.includes(marker)) {
    const m = /<head[^>]*>/i.exec(html); if (!m) throw Error('Display settings: no <head>.');
    html = html.slice(0, m.index + m[0].length) + '\n' + marker + '\n' + tags + html.slice(m.index + m[0].length);
  }
  fs.writeFileSync(index, html);
  console.log('Display & Accessibility applied: Comfort by default; brightness, explosions, flashing, shake, motion, glow, contrast and colorblind controls.');
}
module.exports = { applyDisplaySettings, displayPatches, serviceHooks, marker, tags };
if (require.main === module) applyDisplaySettings();
