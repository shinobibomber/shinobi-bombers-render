const fs = require('node:fs'), path = require('node:path');
const marker = '<!-- exact-startup-design -->';
const before = "await ShinobiSprites.ready;set(2,'Shinobi and arenas ready')";
const after = "await ShinobiSprites.ready;await window.LoadingDesign?.ready;set(2,'Shinobi and arenas ready')";
const count = (text, part) => text.split(part).length - 1;
// Relative to the maintained startup gate (which already awaits LoadingDesign).
// Preservation reverses only these reviewed presentation/timing hooks.
const startupPatches = [
  ["catch(e){set(2,'Preparing fallback shinobi…')}", "catch(e){await window.LoadingDesign.fail(e)}"],
  ["await Promise.race([fonts,new Promise(resolve=>setTimeout(resolve,1500))]);", "await fonts.catch(error=>window.LoadingDesign.fail(error));"],
  ["await new Promise(resolve=>setTimeout(resolve,Math.max(0,1100-(performance.now()-started))));", "/* No artificial minimum: progress follows completed startup work. */"],
  ["progress.querySelector('i').style.width=(step/3*100)+'%'", "progress.querySelector('i').style.transform='scaleX('+(step/3)+')'"],
  ["status.textContent=text};", "status.textContent=text;document.getElementById('loadingPercent').textContent=Math.round(step/3*100)+'%'};"],
  // Login is shown early by loading-design.js; the gate must not reset a sign-in already in progress.
  ["GameLoading.active=false;LoginScreen.show();", "GameLoading.active=false;if(LoginScreen.active)main.inert=true;else LoginScreen.show();"]
];
const originalLoading = '<div id="gameLoading" role="status" aria-live="polite"><div class="loading-emblem" aria-hidden="true"><span>忍</span></div><p class="loading-eyebrow">ENTER THE HIDDEN VILLAGE</p><h1>SHINOBI <span>BOMBERS</span></h1><p id="loadingStatus">Preparing your shinobi…</p><div id="loadingProgress" role="progressbar" aria-label="Loading game" aria-valuemin="0" aria-valuemax="3" aria-valuenow="0"><i></i></div><small>Forge your ninja way</small></div>';
const staticLoading = `<!-- enhanced-startup-markup --><div id="gameLoading" class="loading-compact" role="status" aria-live="polite" aria-busy="true"><div class="loading-card"><p class="loading-brand" aria-hidden="true">SHINOBI <span>BOMBERS</span></p><h2 class="loading-accessible-title">Preparing the Hidden Village</h2><p class="loading-accessible-tip">Ninja tip: Fuse three eligible heroes of the same rank to unlock the next rarity.</p><div id="loadingProgress" role="progressbar" aria-label="Loading game" aria-valuemin="0" aria-valuemax="3" aria-valuenow="0"><i style="transform:scaleX(0)"></i></div><p class="loading-line"><span id="loadingStatus">Preparing the village…</span><strong id="loadingPercent" aria-hidden="true">0%</strong></p><button id="loadingRetry" type="button" hidden>Retry loading</button></div></div><!-- /enhanced-startup-markup -->`;
function applyLoadingDesign(appDir = path.join(__dirname, 'app')) {
  const file = path.join(appDir, 'public/index.html');
  let html = fs.readFileSync(file, 'utf8');
  const done = count(html, marker) === 1;
  if (count(html, marker) > 1 || count(html, '</head>') !== 1 || count(html, done ? after : before) !== 1) throw Error('Startup gate changed or partially patched');
  if (!done) html = html.replace(before, after);
  for (const [original, replacement] of startupPatches) {
    if (count(html, replacement) === 1 && count(html, original) === 0) continue;
    if (count(html, original) !== 1 || count(html, replacement) !== 0) throw Error('Startup presentation hook changed: ' + original);
    html = html.replace(original, replacement);
  }
  const dest = path.join(appDir, 'public/assets/loading-design');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of ['loading-design.js', 'loading-design.css']) fs.copyFileSync(path.join(__dirname, 'loading-design', name), path.join(dest, name));
  fs.rmSync(path.join(dest, 'loading-reference.png'), { force: true }); // the compact gate has no artwork
  if (count(html, '<!-- enhanced-startup-markup -->') === 1) {
    html = html.replace(/<!-- enhanced-startup-markup -->[\s\S]*?<!-- \/enhanced-startup-markup -->/, staticLoading);
  } else {
    if (count(html, originalLoading) !== 1) throw Error('Original startup markup changed');
    html = html.replace(originalLoading, staticLoading);
  }
  // First paint already has the final scene and zeroed bar, before deferred JS.
  const css = fs.readFileSync(path.join(__dirname, 'loading-design/loading-design.css'), 'utf8');
  const style = '<style id="enhanced-startup-critical">' + css + '</style>';
  if (html.includes('id="enhanced-startup-critical"')) html = html.replace(/<style id="enhanced-startup-critical">[\s\S]*?<\/style>/, style);
  else html = html.replace('</head>', style + '\n</head>');
  html = html.replace('<link rel="stylesheet" href="assets/loading-design/loading-design.css">', '');
  if (!html.includes('id="enhanced-startup-preload"')) html = html.replace(/<head([^>]*)>/, '<head$1><link id="enhanced-startup-preload" rel="preload" as="image" href="assets/login-exact/login-reference.png" fetchpriority="high">');
  if (!done) html = html.replace('</head>', marker + '\n<script defer src="assets/loading-design/loading-design.js"></script>\n</head>');
  fs.writeFileSync(file, html);
  console.log('Compact startup gate applied: login shows as soon as its artwork is ready; the game prepares behind it.');
}
module.exports = { applyLoadingDesign, startupPatches };
if (require.main === module) applyLoadingDesign();
