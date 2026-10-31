const fs = require('node:fs');
const path = require('node:path');
const marker = '<!-- exact-reveal-design -->';
const script = '<script defer src="assets/reveal-design/reveal-design.js"></script>';
const patches = [
  ["if(!dialog.open&&!document.body.classList.contains('is-loading'))dialog.showModal()}", "if(!dialog.open&&!document.body.classList.contains('is-loading'))dialog.showModal();window.RevealDesign?.refresh()}"],
  ["card.classList.add('is-revealed')}", "card.classList.add('is-revealed');window.RevealDesign?.paint(i)}"],
  ['function spotlight(card,h){', 'function spotlight(card,h){if(window.RevealDesign?.loaded)return null;'],
  ['async function celebrateGroup(reduced){', 'async function celebrateGroup(reduced){if(window.RevealDesign?.loaded)return;']
];
const count = (text, value) => text.split(value).length - 1;
function patchHtml(html) {
  if (count(html, '</head>') !== 1) throw Error('Reveal design requires one HTML head.');
  const applied = count(html, marker) === 1;
  if (count(html, marker) > 1 || count(html, script) !== (applied ? 1 : 0)) throw Error('Inconsistent reveal design marker.');
  for (const [from, to] of patches) {
    if (applied) { if (count(html, to) !== 1) throw Error('Reveal design hooks are partial or upstream source changed.'); }
    else if (count(html, from) !== 1 || html.includes(to)) throw Error('Reveal design hook does not match upstream source.');
  }
  if (applied) return html;
  for (const [from, to] of patches) html = html.replace(from, to);
  return html.replace('</head>', marker + '\n<link rel="stylesheet" href="assets/reveal-design/reveal-design.css">\n' + script + '\n</head>');
}
function applyRevealDesign(appDir = path.join(__dirname, 'app')) {
  const index = path.join(appDir, 'public/index.html'), original = fs.readFileSync(index, 'utf8'), patched = patchHtml(original);
  const source = path.join(__dirname, 'reveal-design'), dest = path.join(appDir, 'public/assets/reveal-design');
  const files = ['reveal-design.js', 'reveal-design.css', 'reveal-design.png'];
  for (const file of files) if (!fs.statSync(path.join(source, file)).isFile()) throw Error('Missing original reveal asset ' + file);
  fs.mkdirSync(dest, { recursive: true }); for (const file of files) fs.copyFileSync(path.join(source, file), path.join(dest, file));
  if (patched !== original) fs.writeFileSync(index, patched);
  console.log('Original reveal design applied to persisted reveal batches.');
}
module.exports = { applyRevealDesign, patchHtml };
if (require.main === module) applyRevealDesign();
