const fs = require('node:fs');
const path = require('node:path');
const marker = '<!-- original-art-render-quality -->';
const patches = [
  ['s=s0*1.36*Math.max(.05,pop);', 's=s0*1.60*Math.max(.05,pop);'],
  ['c.imageSmoothingEnabled=!!cv.designSprite;if(alpha!==undefined)', "c.imageSmoothingEnabled=!!cv.designSprite;if(cv.designSprite)c.imageSmoothingQuality='high';if(alpha!==undefined)"]
];
const count = (text, value) => text.split(value).length - 1;
function patchHtml(html) {
  const applied = count(html, marker) === 1;
  if (count(html, marker) > 1 || count(html, '</head>') !== 1) throw Error('Invalid rendering quality source markers.');
  for (const [from, to] of patches) {
    if (count(html, applied ? to : from) !== 1 || count(html, applied ? from : to) !== 0) throw Error('Rendering quality hooks changed or were partially applied.');
  }
  if (applied) return html;
  for (const [from, to] of patches) html = html.replace(from, to);
  return html.replace('</head>', marker + '\n</head>');
}
function applyRenderQuality(appDir = path.join(__dirname, 'app')) {
  const file = path.join(appDir, 'public/index.html'), html = fs.readFileSync(file, 'utf8'), patched = patchHtml(html);
  // These original-art helpers are also copied by their owning build adapters.
  // Refresh them here so incremental local builds and full builds agree.
  for (const [folder, name] of [['player-models','player-models.js'],['heroes-design','heroes-design.js'],['roster-design','roster-design.js'],['tier-auras','tier-auras.js']]) {
    const dest = path.join(appDir, 'public/assets', folder); fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(__dirname, folder, name), path.join(dest, name));
  }
  if (html !== patched) fs.writeFileSync(file, patched);
  console.log('Original hero portraits, visible tier auras and 18% larger Adventure actors applied.');
}
module.exports = { applyRenderQuality, patchHtml };
if (require.main === module) applyRenderQuality();
