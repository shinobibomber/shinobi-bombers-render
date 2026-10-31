const fs = require('node:fs');
const path = require('node:path');
const marker = '<!-- exact-heroes-design -->';
const patches = [
  ["forEach(canvas=>{const bounds=canvas.getBoundingClientRect();", "forEach(canvas=>{if(canvas.hasAttribute('data-exact-hero'))return;const bounds=canvas.getBoundingClientRect();"],
  ["if(cv.tagName!=='CANVAS')return;const rect=cv.getBoundingClientRect();", "if(cv.tagName!=='CANVAS'||cv.hasAttribute('data-exact-hero'))return;const rect=cv.getBoundingClientRect();"]
];
const count = (text, value) => text.split(value).length - 1;
function patchHtml(html) {
  const applied = count(html, marker) === 1;
  if (count(html, '</head>') !== 1 || count(html, marker) > 1 || patches.some(([before, after]) => count(html, before) !== (applied ? 0 : 1) || count(html, after) !== (applied ? 1 : 0))) throw Error('Heroes design source changed or was partially patched.');
  if (applied) return html;
  for (const [before, after] of patches) html = html.replace(before, after);
  return html.replace('</head>', marker + '\n<link rel="stylesheet" href="assets/heroes-design/heroes-design.css">\n<script defer src="assets/heroes-design/heroes-design.js"></script>\n</head>');
}
function applyHeroesDesign(appDir = path.join(__dirname, 'app')) {
  const index = path.join(appDir, 'public/index.html'), html = fs.readFileSync(index, 'utf8'), patched = patchHtml(html);
  const destination = path.join(appDir, 'public/assets/heroes-design'); fs.mkdirSync(destination, { recursive: true });
  for (const file of ['heroes-menu.png', 'heroes-design.js', 'heroes-design.css']) fs.copyFileSync(path.join(__dirname, 'heroes-design', file), path.join(destination, file));
  if (html !== patched) fs.writeFileSync(index, patched);
  console.log('Exact Heroes reference layout and live collection controls applied.');
}
module.exports = { applyHeroesDesign, patchHtml };
if (require.main === module) applyHeroesDesign();
