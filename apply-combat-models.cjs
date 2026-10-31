const fs = require('node:fs');
const path = require('node:path');

const marker = '<!-- exact-combat-models -->';
const script = '<script defer src="assets/combat-models/combat-models.js"></script>';
const deathMarker = '/* exact-combat-defeat */';
const hurtMarker = '/* exact-combat-hurt */';
const patches = [
  ["if(c.k===6){SS.drawPrisonCage", "if(c.k===6&&!boss){SS.drawPrisonCage"],
  ["if(k===6)drawPrisonCage", "if(k===6&&!boss)drawPrisonCage"],
  [
    "const pose=((now/620+a.seed*3)|0)&1?'i1':'i0',img=SS.enemyFrame(c.k,pose,boss),flip=a.flip;",
    hurtMarker + "const pose=a.hit>0?'h0':(((now/620+a.seed*3)|0)&1?'i1':'i0'),img=SS.enemyFrame(c.k,pose,boss),flip=a.flip;"
  ],
  ["img=SS.enemyFrame(d.k,'i1',d.boss);", deathMarker + "img=SS.enemyFrame(d.k,'d0',d.boss);"],
  ["SS.whiteOf(img,'e'+d.k+(d.boss?'B':'')+'i1')", "SS.whiteOf(img,'e'+d.k+(d.boss?'B':'')+'d0')"]
];
const count = (text, snippet) => text.split(snippet).length - 1;

function patchHtml(html) {
  const fail = reason => { throw new Error('Cannot apply combat models: ' + reason); };
  if (count(html, '</head>') !== 1) fail('expected one closing head.');
  const applied = count(html, marker) === 1;
  if (count(html, marker) > 1 || count(html, deathMarker) !== (applied ? 1 : 0) ||
      count(html, hurtMarker) !== (applied ? 1 : 0) || count(html, script) !== (applied ? 1 : 0)) {
    fail('the arena renderer changed or the combat-model patch is incomplete.');
  }
  for (const [original, replacement] of patches) {
    if (count(html, original) !== (applied ? 0 : 1) || count(html, replacement) !== (applied ? 1 : 0)) {
      fail('the arena renderer changed or the combat-model patch is incomplete.');
    }
  }
  if (applied) return html;
  for (const [original, replacement] of patches) html = html.replace(original, replacement);
  return html.replace('</head>', marker + '\n' + script + '\n</head>');
}

function applyCombatModels(appDir = path.join(__dirname, 'app')) {
  const publicDir = path.join(appDir, 'public');
  const index = path.join(publicDir, 'index.html');
  const html = fs.readFileSync(index, 'utf8');
  const patched = patchHtml(html);
  const files = ['combat-models.js', 'frames.json', 'EnemyModel.png', 'BossModel.png'];
  for (const file of files) {
    if (!fs.statSync(path.join(__dirname, 'combat-models', file)).isFile()) {
      throw new Error('Cannot apply combat models: missing source file ' + file);
    }
  }
  const assets = path.join(publicDir, 'assets', 'combat-models');
  fs.mkdirSync(assets, { recursive: true });
  for (const file of files) fs.copyFileSync(path.join(__dirname, 'combat-models', file), path.join(assets, file));
  if (patched !== html) fs.writeFileSync(index, patched);
  console.log('Original enemy and boss models applied to the shared combat renderer.');
}

module.exports = { applyCombatModels, patchHtml };
if (require.main === module) applyCombatModels();
