const fs = require('node:fs');
const path = require('node:path');

const marker = '<!-- exact-adventure-design -->';
const arenaMarker = '/* exact-adventure-design-arena */';
const script = '<script defer src="assets/adventure-design/adventure-design.js"></script>';
const patches = [
  [
    'let geo;function setGeo(){const t=cfg.tilt;geo=',
    arenaMarker + 'let geo;function setGeo(){if(window.AdventureDesign?.loaded){geo=AdventureDesign.geometry(cfg.tilt);return;}const t=cfg.tilt;geo='
  ],
  [
    'function buildFloor(){',
    'function buildFloor(){\n  if(window.AdventureDesign?.loaded){AdventureDesign.drawFloor(floor.canvas,{W,H,T,proj,Sg,map:S.map,G});floor.G=G;floor.map=S.map;floor.tilt=cfg.tilt;return;}'
  ],
  [
    'function pillar(x,y){',
    'function pillar(x,y){\n  if(window.AdventureDesign?.loaded){AdventureDesign.drawWall(g,x,y,{proj,Sg,map:S.map});return;}'
  ],
  [
    'function torii(x,y,now){',
    'function torii(x,y,now){if(window.AdventureDesign?.loaded)return;'
  ]
];

function count(text, value) { return text.split(value).length - 1; }

function patchHtml(html) {
  const fail = reason => { throw new Error('Cannot apply Adventure design: ' + reason); };
  const applied = count(html, marker) === 1;
  if (count(html, '</head>') !== 1) fail('expected one closing head.');
  if (count(html, marker) > 1 || count(html, arenaMarker) !== (applied ? 1 : 0) ||
      count(html, script) !== (applied ? 1 : 0)) fail('partial or duplicate design patch.');
  for (const [original, replacement] of patches) {
    // Each replacement begins with some original function heads, so remove it
    // before validating that no second, unpatched implementation remains.
    const replacementCount = count(html, replacement);
    const remainder = html.split(replacement).join('');
    if (replacementCount !== (applied ? 1 : 0) || count(remainder, original) !== (applied ? 0 : 1)) {
      fail('arena floor, camera or wall implementation changed.');
    }
  }
  if (applied) return html;
  for (const [original, replacement] of patches) html = html.replace(original, replacement);
  return html.replace('</head>', marker + '\n<link rel="stylesheet" href="assets/adventure-design/adventure-design.css">\n' + script + '\n</head>');
}

function applyAdventureDesign(appDir = path.join(__dirname, 'app')) {
  const publicDir = path.join(appDir, 'public');
  const index = path.join(publicDir, 'index.html');
  const html = fs.readFileSync(index, 'utf8');
  const patched = patchHtml(html);
  const files = ['adventure-design.js', 'adventure-design.css', 'map-crops.json', 'adventure-mode.png', 'map.png'];
  for (const file of files) {
    if (!fs.statSync(path.join(__dirname, 'adventure-design', file)).isFile()) throw new Error('Missing Adventure asset ' + file);
  }
  const assets = path.join(publicDir, 'assets', 'adventure-design');
  fs.mkdirSync(assets, { recursive: true });
  for (const file of files) fs.copyFileSync(path.join(__dirname, 'adventure-design', file), path.join(assets, file));
  if (patched !== html) fs.writeFileSync(index, patched);
  console.log('Exact Adventure layout and source map terrain applied to the live grid.');
}

module.exports = { applyAdventureDesign, patchHtml };
if (require.main === module) applyAdventureDesign();
