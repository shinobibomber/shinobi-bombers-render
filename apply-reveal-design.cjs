const fs = require('node:fs');
const path = require('node:path');
const marker = '<!-- exact-reveal-design -->';
const script = '<script defer src="assets/reveal-design/reveal-design.js"></script>';
// Narrow presentation hooks only. Exported so preservation checks can reverse
// these exact edits and still hash every original gameplay/payment module.
const cinematicPatches = [
  ["function showReveal(){if(!pending().length)return;", "function showReveal(){if(!pending().length)return;if(window.RevealDesign?.loaded&&!RevealDesign.canReveal())return;"],
  ["if(!item||item.revealed||busy)return false;", "if(!item||item.revealed||busy||(window.RevealDesign?.loaded&&!RevealDesign.canReveal()))return false;"],
  ["if(S.v2.revealSource==='summon'&&item.hero.r>=3&&pending().some", "if(!window.RevealDesign?.loaded&&S.v2.revealSource==='summon'&&item.hero.r>=3&&pending().some"],
  ["if(rare&&card){card.classList.add('rare-opening');if(!reduced)await pause(1000)}", "if(window.RevealDesign?.loaded){await RevealDesign.open(i);if(pending()[i]!==item||!RevealDesign.canReveal())return false}else if(rare&&card){card.classList.add('rare-opening');if(!reduced)await pause(1000)}"],
  ["save();if(rare&&!reduced)await pause(1100);", "save();if(rare&&!reduced&&!window.RevealDesign?.loaded)await pause(1100);"],
  ["document.getElementById('revealAll').disabled=busy||batchRun||allRevealed()}", "document.getElementById('revealAll').disabled=busy||batchRun||allRevealed();window.RevealDesign?.sync()}"],
  ["async function finishReveal(){if(busy||batchRun||!allRevealed())return;", "async function finishReveal(){if(busy||batchRun||!allRevealed()||(window.RevealDesign?.loaded&&!RevealDesign.canReveal()))return;"],
  ["if(!was||wasRevealed||!opened)return false;const card=", "if(!was||wasRevealed||!opened)return false;if(window.RevealDesign?.loaded)return opened;const card="],
  // Reward reveal (owner request 2026-11-10): referral passes, Creator Shop heroes, the prison-cage rescue grant and the Founder
  // Limited / Premium summon passes play the same reveal as the Summoning Shrine. A 'reward' source has no paid Summon Again
  // (reveal-design.js only offers it for 'summon') and finishes on the Heroes screen.
  ["const fusion=S.v2.revealSource==='fusion',prison=S.v2.revealSource==='prison';", "const fusion=S.v2.revealSource==='fusion',prison=S.v2.revealSource==='prison',reward=S.v2.revealSource==='reward';"],
  ["${fusion?'CHAKRA COMBINED':prison?'THE CAGE IS OPEN':'THE SCROLLS HAVE ANSWERED'}", "${fusion?'CHAKRA COMBINED':prison?'THE CAGE IS OPEN':reward?'REWARD DELIVERED':'THE SCROLLS HAVE ANSWERED'}"],
  ["${fusion?'Fusion complete · reveal your heroes':prison?'Hero rescued · reveal your shinobi':'Reveal your shinobi'}", "${fusion?'Fusion complete · reveal your heroes':prison?'Hero rescued · reveal your shinobi':reward?'Reward received · reveal your shinobi':'Reveal your shinobi'}"],
  ["${fusion?'FUSION SCROLL':prison?'RESCUED SHINOBI':'SHINOBI SCROLL'}", "${fusion?'FUSION SCROLL':prison?'RESCUED SHINOBI':reward?'REWARD SCROLL':'SHINOBI SCROLL'}"],
  ["go(source==='fusion'?6:source==='prison'?0:2);nextRescue()}", "go(source==='fusion'?6:source==='prison'?0:source==='reward'?1:2);if(source==='reward')window.HeroesDesign?.showNewest?.();nextRescue()}"],
  // presentRewardIds(tokenIds): sync the profile first (the heroes were just granted by the server), then reveal the player's own
  // heroes with those ids. Returns false (and reveals nothing) while another reveal is open or when a hero is not in the collection.
  ["workAll,restAll,reveal,revealAll,finishReveal,presentFusion(heroes){", "presentReward(heroes){if(!heroes.length||pending().length)return false;S.v2.revealSource='reward';S.v2.revealBatch=heroes.map(hero=>({hero:JSON.parse(JSON.stringify(hero)),revealed:false}));save();showReveal();return true},presentRewardIds(ids){try{window.TokenCheckout?.syncProfile?.()}catch{}const owner=window.RyoPayments?.state?.account,heroes=(Array.isArray(ids)?ids:[]).map(id=>S.h.find(h=>h.tokenId===id&&h.tokenOwner===owner)).filter(Boolean);return Experience.presentReward(heroes)},workAll,restAll,reveal,revealAll,finishReveal,presentFusion(heroes){"]
];
const patches = [
  ["if(!dialog.open&&!document.body.classList.contains('is-loading'))dialog.showModal()}", "if(!dialog.open&&!document.body.classList.contains('is-loading'))dialog.showModal();window.RevealDesign?.refresh()}"],
  ["card.classList.add('is-revealed')}", "card.classList.add('is-revealed');window.RevealDesign?.paint(i)}"],
  ['function spotlight(card,h){', 'function spotlight(card,h){if(window.RevealDesign?.loaded)return null;'],
  ['async function celebrateGroup(reduced){', 'async function celebrateGroup(reduced){if(window.RevealDesign?.loaded)return;'],
  ...cinematicPatches
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
  // Retired HD atlas loader; earlier generated builds may still include it.
  const modelsScript = '<script defer src="assets/reveal-design/reveal-models.js"></script>';
  if (applied) return html.replace(modelsScript + '\n', '').replace(modelsScript, '');
  for (const [from, to] of patches) html = html.replace(from, to);
  return html.replace('</head>', marker + '\n<link rel="stylesheet" href="assets/reveal-design/reveal-design.css">\n' + script + '\n</head>');
}
function applyRevealDesign(appDir = path.join(__dirname, 'app')) {
  const index = path.join(appDir, 'public/index.html'), original = fs.readFileSync(index, 'utf8'), patched = patchHtml(original);
  const source = path.join(__dirname, 'reveal-design'), dest = path.join(appDir, 'public/assets/reveal-design');
  const files = ['reveal-design.js', 'reveal-design.css', 'reveal-design.png'];
  for (const file of files) if (!fs.statSync(path.join(source, file)).isFile()) throw Error('Missing original reveal asset ' + file);
  fs.mkdirSync(dest, { recursive: true }); for (const file of files) fs.copyFileSync(path.join(source, file), path.join(dest, file));
  // Reuse the website's original scroll artwork for the sealed and opening states.
  for (const file of ['rv-scroll.webp', 'rv-open.webp']) fs.copyFileSync(path.join(__dirname, 'website/assets', file), path.join(dest, file));
  if (patched !== original) fs.writeFileSync(index, patched);
  console.log('Original reveal design applied to persisted reveal batches.');
}
module.exports = { applyRevealDesign, patchHtml, cinematicPatches };
if (require.main === module) applyRevealDesign();
