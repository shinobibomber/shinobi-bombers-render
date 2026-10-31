const fs = require('node:fs');
const path = require('node:path');
const marker = '<!-- exact-tier-auras -->';
const script = '<script defer src="assets/tier-auras/tier-auras.js"></script>';
const patches = [
  [
    "  g.save();g.strokeStyle=col;g.globalAlpha=.35+h.r*.1+Math.sin(now/260+seed)*.06;g.lineWidth=1.4;g.beginPath();g.ellipse(sx,sy,15*s0,(cfg.tilt?5.6:8)*s0,0,0,7);g.stroke();g.restore();\r\n  if(h.r>=1){g.globalCompositeOperation='lighter';const rad=(24+h.r*4)*s0,gr=g.createRadialGradient(sx,sy-18*s0,2,sx,sy-18*s0,rad);gr.addColorStop(0,col+['00','30','46','60','80'][h.r]);gr.addColorStop(1,col+'00');g.fillStyle=gr;g.fillRect(sx-rad,sy-18*s0-rad,rad*2,rad*2);g.globalCompositeOperation='source-over'}\r\n  for(let i=0;i<h.r+1;i++){const t=i*2.4+now/1800;g.fillStyle=col;g.fillRect(Math.round(sx+Math.cos(t)*19*s0),Math.round(sy-18*s0+Math.sin(t)*10*s0-Math.sin(t*1.7)*6*s0),Math.max(1.5,1.6*s0),Math.max(1.5,1.6*s0))}\r\n",
    "  /* exact-tier-aura-ambient */if(!window.TierAuras?.loaded){\n  g.save();g.strokeStyle=col;g.globalAlpha=.35+h.r*.1+Math.sin(now/260+seed)*.06;g.lineWidth=1.4;g.beginPath();g.ellipse(sx,sy,15*s0,(cfg.tilt?5.6:8)*s0,0,0,7);g.stroke();g.restore();\r\n  if(h.r>=1){g.globalCompositeOperation='lighter';const rad=(24+h.r*4)*s0,gr=g.createRadialGradient(sx,sy-18*s0,2,sx,sy-18*s0,rad);gr.addColorStop(0,col+['00','30','46','60','80'][h.r]);gr.addColorStop(1,col+'00');g.fillStyle=gr;g.fillRect(sx-rad,sy-18*s0-rad,rad*2,rad*2);g.globalCompositeOperation='source-over'}\r\n  for(let i=0;i<h.r+1;i++){const t=i*2.4+now/1800;g.fillStyle=col;g.fillRect(Math.round(sx+Math.cos(t)*19*s0),Math.round(sy-18*s0+Math.sin(t)*10*s0-Math.sin(t*1.7)*6*s0),Math.max(1.5,1.6*s0),Math.max(1.5,1.6*s0))}\r\n  }\n"
  ],
  [
    "if(h.r>=3){g.save();g.globalCompositeOperation='lighter';g.strokeStyle=h.r===4?'#fff3ab':'#edc8ff';",
    "if(h.r>=3&&!window.TierAuras?.loaded){g.save();g.globalCompositeOperation='lighter';g.strokeStyle=h.r===4?'#fff3ab':'#edc8ff';"
  ]
];
const count = (text, value) => text.split(value).length - 1;
function patchHtml(html) {
  const fail = reason => { throw new Error('Cannot apply tier auras: ' + reason); };
  if (count(html, '</head>') !== 1) fail('expected one HTML head.');
  const applied = count(html, marker) === 1;
  if (count(html, marker) > 1 || count(html, script) !== (applied ? 1 : 0)) fail('inconsistent aura script marker.');
  for (const [from, to] of patches) {
    if (applied) { if (count(html, to) !== 1) fail('rarity visuals were changed or partly patched.'); }
    else if (count(html, from) !== 1 || html.includes(to)) fail('rarity visuals do not match the expected renderer.');
  }
  if (applied) return html;
  for (const [from, to] of patches) html = html.replace(from, to);
  return html.replace('</head>', marker + '\n' + script + '\n</head>');
}
function applyTierAuras(appDir = path.join(__dirname, 'app')) {
  const index = path.join(appDir, 'public', 'index.html');
  const html = fs.readFileSync(index, 'utf8'), patched = patchHtml(html);
  const files = ['tier-auras.js', 'manifest.json', 'auras.png'];
  for (const name of files) if (!fs.statSync(path.join(__dirname, 'tier-auras', name)).isFile()) throw Error('Missing original aura asset ' + name);
  const dest = path.join(appDir, 'public', 'assets', 'tier-auras'); fs.mkdirSync(dest, { recursive: true });
  for (const name of files) fs.copyFileSync(path.join(__dirname, 'tier-auras', name), path.join(dest, name));
  if (patched !== html) fs.writeFileSync(index, patched);
  console.log('Original tier aura effects applied to all shared player frames.');
}
module.exports = { applyTierAuras, patchHtml };
if (require.main === module) applyTierAuras();
