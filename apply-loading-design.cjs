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
  ["await new Promise(resolve=>setTimeout(resolve,Math.max(0,1100-(performance.now()-started))));", "/* No artificial minimum: progress follows completed startup work. */"]
];
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
  for (const name of ['loading-design.js', 'loading-design.css', 'loading-reference.png']) fs.copyFileSync(path.join(__dirname, 'loading-design', name), path.join(dest, name));
  if (!done) html = html.replace('</head>', marker + '\n<link rel="stylesheet" href="assets/loading-design/loading-design.css">\n<script defer src="assets/loading-design/loading-design.js"></script>\n</head>');
  fs.writeFileSync(file, html);
  console.log('Enhanced loading artwork applied; real asset/font milestones and explicit error retry retained.');
}
module.exports = { applyLoadingDesign, startupPatches };
if (require.main === module) applyLoadingDesign();
