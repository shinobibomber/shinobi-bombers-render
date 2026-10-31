const fs = require('node:fs');
const path = require('node:path');

const headMarker = '<!-- exact-player-models -->';
const directionMarker = '/* exact-player-models-direction */';
const scriptTag = '<script defer src="assets/player-models/player-models.js"></script>';
const patches = [
  [
    'a={px:h.x,py:h.y,face:1,phase:0,atk:-9999,born:now,seen:false,moving:false};',
    directionMarker + "a={px:h.x,py:h.y,face:1,direction:'front',phase:0,atk:-9999,born:now,seen:false,moving:false};"
  ],
  [
    'else{a.phase+=d*3;a.moving=d>.0006;if(Math.abs(dx)>.0004)a.face=dx>0?1:-1}',
    "else{a.phase+=d*3;a.moving=d>.0006;if(Math.abs(dx)>.0004)a.face=dx>0?1:-1;if(a.moving)a.direction=Math.abs(dy)>Math.abs(dx)?(dy<0?'back':'front'):'side'}"
  ],
  [
    'img=SS.heroFrame(h,pose,!atkPose&&!sleeping&&SS.blinkNow(now,seed)),flip=a.face<0;',
    "img=SS.heroFrame(h,pose,!atkPose&&!sleeping&&SS.blinkNow(now,seed),a.direction),flip=a.direction==='side'&&a.face<0;"
  ],
  [
    'try{await ShinobiSprites.ready;set(2,',
    "try{if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));await ShinobiSprites.ready;set(2,"
  ]
];

function occurrences(text, snippet) {
  return text.split(snippet).length - 1;
}

function patchHtml(html) {
  const fail = reason => { throw new Error('Cannot apply player models: ' + reason); };
  if (occurrences(html, '</head>') !== 1) fail('expected one closing head.');
  const headCount = occurrences(html, headMarker);
  const directionCount = occurrences(html, directionMarker);
  if (headCount !== directionCount || headCount > 1) fail('partial or duplicate player-model patch.');
  const applied = headCount === 1;
  if (occurrences(html, scriptTag) !== (applied ? 1 : 0)) fail('player-model script marker is inconsistent.');
  for (const [original, replacement] of patches) {
    if (occurrences(html, original) !== (applied ? 0 : 1) ||
        occurrences(html, replacement) !== (applied ? 1 : 0)) {
      fail('arena renderer changed or was only partly patched.');
    }
  }
  if (applied) return html;
  for (const [original, replacement] of patches) html = html.replace(original, replacement);
  return html.replace('</head>', headMarker + '\n' + scriptTag + '\n</head>');
}

function applyPlayerModels(appDir = path.join(__dirname, 'app')) {
  const publicDir = path.join(appDir, 'public');
  const index = path.join(publicDir, 'index.html');
  const html = fs.readFileSync(index, 'utf8');
  // Validate the complete patch before touching generated application files.
  const patched = patchHtml(html);
  const files = ['player-models.js', 'frames.json', 'playermodel.png'];
  for (const file of files) {
    if (!fs.statSync(path.join(__dirname, 'player-models', file)).isFile()) {
      throw new Error('Cannot apply player models: missing source asset ' + file);
    }
  }
  const assets = path.join(publicDir, 'assets', 'player-models');
  fs.mkdirSync(assets, { recursive: true });
  for (const file of files) fs.copyFileSync(path.join(__dirname, 'player-models', file), path.join(assets, file));
  if (patched !== html) fs.writeFileSync(index, patched);
  console.log('Exact player models and arena direction rendering applied.');
}

module.exports = { applyPlayerModels, patchHtml };
if (require.main === module) applyPlayerModels();
