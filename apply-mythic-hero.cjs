/* Tsukiyomi, the Mythic Shinobi (rank 5, Limited NFT Box): build step.
 * Copies the hero's assets and renderer (mythic-hero/) to app/public/assets/mythic-hero/, adds the
 * on-chain ownership module (app/server/mythic-hero.cjs) and its table, and teaches the game a sixth
 * rank: Mythic stats 15–18, Legend's ultimate and training prices, violet colours, the NFT link on
 * each hero and the "Check NFT" action. Exact-string hooks; tests/preservation.cjs reverses mythicPatches. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const marker = '<!-- mythic-hero -->', script = '<script defer src="assets/mythic-hero/animation-controller.js"></script>\n<script defer src="assets/mythic-hero/articulated-sprite.js"></script>\n<script defer src="assets/mythic-hero/skill-effects.js"></script>\n<script defer src="assets/mythic-hero/mythic-hero.js"></script>\n<script defer src="assets/mythic-hero/animation-runtime.js"></script>';
const V = "'#c98bff'"; // Mythic violet
// Game client. [before, after, count]
const mythicPatches = [
  ['g.drawImage(floor.canvas,0,0);', 'g.drawImage(floor.canvas,0,0);window.MythicHero?.drawGround?.(g,now,{proj,Sg});', 1],
  ['["Legend","#f59e0b",1]];', '["Legend","#f59e0b",1],["Mythic","#b36bff",0]];', 1],
  ['[lo,hi]=[[1,3],[3,6],[6,9],[9,12],[12,15]][r]', '[lo,hi]=[[1,3],[3,6],[6,9],[9,12],[12,15],[15,18]][r]', 1],
  // The Genin–Legend bands stay byte-for-byte (the real-time rewards guard pins them); Mythic is appended.
  ['const statBands=[[1,3],[3,6],[6,9],[9,12],[12,15]];', 'const statBands=[[1,3],[3,6],[6,9],[9,12],[12,15]];statBands.push([15,18])/* Mythic */;', 1],
  ['*[1,1.5,2,2.5,3][h.r])}', '*[1,1.5,2,2.5,3,3][h.r])}', 1],
  // Mythic uses Legend's attacks and ultimate rules; only the name and colours are his.
  ["const kind=h.r===4?(h.id%2?'rasengan':'chidori'):", "const kind=h.r>=4?(h.id%2?'rasengan':'chidori'):", 1],
  ["b.ultimate=h.r===4?'Nine-Tail Chakra Burst':'Thunder Dragon';b.kind=h.r===4?'rasengan':'lightning';", "b.ultimate=h.r===5?'Mythic Dragon Ascension':h.r===4?'Nine-Tail Chakra Burst':'Thunder Dragon';b.kind=h.r>=4?'rasengan':'lightning';", 1],
  ["type:'cast',legend:h.r===4,", "type:'cast',legend:h.r>=4,", 1],
  ["<p><b>Ultimate: ${h.r===4?'Nine-Tail Chakra Burst':'Thunder Dragon'}</b><span>Every 8 attacks · ${h.r===4?'2.2×':'1.8×'} damage", "<p><b>Ultimate: ${h.r===5?'Mythic Dragon Ascension':h.r===4?'Nine-Tail Chakra Burst':'Thunder Dragon'}</b><span>Every 8 attacks · ${h.r>=4?'2.2×':'1.8×'} damage", 1],
  // Mythic attacks like a Legend (5 shots, 1 chakra each); its skills are visuals on those normal shots and
  // the 8th-volley Mythic Dragon Ascension is a visual only (normal damage, no splash, no extra chakra).
  ['h.bm=h.r+1;h.rg=h.r+1;h.statsVersion=3;return h}', 'h.bm=h.r+1;h.rg=h.r+1;if(h.r===5){h.bm=5;h.rg=5}h.statsVersion=3;return h}', 1],
  ['bm:r+1,rg:r+1', 'bm:Math.min(r,4)+1,rg:Math.min(r,4)+1', 1],
  ['if(h.r>=3&&charge%8===0){b.ultimate=h.r===5?', 'if(h.r===5&&charge%8===0)b.mythicUlt=1;else if(h.r>=3&&charge%8===0){b.ultimate=h.r===5?', 1],
  ["damage + nearby splash</span>", "damage + nearby splash</span>${h.r===5?'<small> · Mythic: visual only, normal damage</small>':''}", 1],
  ["h.r===4?'#ffd36a':'#b9c7ff'", "h.r===5?'#e2b8ff':h.r===4?'#ffd36a':'#b9c7ff'", 1],
  ["h.r===4?'#ffb23a':'#8fa8ff'", "h.r===5?'#b36bff':h.r===4?'#ffb23a':'#8fa8ff'", 1],
  ["h.r===4?'#ffd36a':'#cfd8ff'", "h.r===5?'#e2b8ff':h.r===4?'#ffd36a':'#cfd8ff'", 1],
  ["['35','50','65','80','99'][h.r]", "['35','50','65','80','99','99'][h.r]", 1],
  ["['00','30','46','60','80'][h.r]", "['00','30','46','60','80','80'][h.r]", 1],
  ["['#ffffff','#9dffc2','#8fd8ff','#e0a8ff','#ffe08a'][h.r]", "['#ffffff','#9dffc2','#8fd8ff','#e0a8ff','#ffe08a','#e2b8ff'][h.r]", 1],
  ["colors=['#a2adb7','#66c885','#63b6ff','#bc82ff','#ffd166']", "colors=['#a2adb7','#66c885','#63b6ff','#bc82ff','#ffd166'," + V + "]", 1],
  ["colors=['#b8c9d5','#5bfa90','#52c8ff','#cf79ff','#ffe16b']", "colors=['#b8c9d5','#5bfa90','#52c8ff','#cf79ff','#ffe16b'," + V + "]", 1],
  ["colors=['#daeaff','#45ff8a','#2dafff','#d948ff','#ffc23a']", "colors=['#daeaff','#45ff8a','#2dafff','#d948ff','#ffc23a'," + V + "]", 1],
  ["colors=['#b5c7cf','#6ef294','#63ceff','#d69cff','#ffe28b']", "colors=['#b5c7cf','#6ef294','#63ceff','#d69cff','#ffe28b'," + V + "]", 1],
  // Each signed-in hero keeps its NFT link (Mythic heroes only).
  ['if(Number.isInteger(descriptor.look))h.look=descriptor.look;', 'if(Number.isInteger(descriptor.look))h.look=descriptor.look;h.nft=descriptor.nft||null;', 1],
  ["window.RyoPayments={hunt:", "window.RyoPayments={mythic:()=>run(async()=>{const data=await api('mythic-refresh',{});accept(data);return data}),hunt:", 1],
  ['<p>Genin: 1 perk · Chunin: 2 · Jonin: 3 · Elite: 4 · Legend: 5.</p>', '<p>Genin: 1 perk · Chunin: 2 · Jonin: 3 · Elite: 4 · Legend: 5 · Mythic (NFT): 6.</p>', 1]
];
const economyHooks = [["[[1,3],[3,6],[6,9],[9,12],[12,15]][rank]", "[[1,3],[3,6],[6,9],[9,12],[12,15],[15,18]][rank]"]];
const serviceHooks = [
  ["for(const row of await store.pendingPurchases(wallet))await progress(row,'purchase');return store.state(wallet)}",
   "for(const row of await store.pendingPurchases(wallet))await progress(row,'purchase');const mythic=await require('./mythic-hero.cjs').sync(store,wallet,connection);const result=await store.state(wallet);return mythic.enabled?{...result,mythic}:result}"],
  ["  if(action==='market-buy'){", "  if(action==='mythic-refresh'){await checkNetwork();const checked=await require('./mythic-hero.cjs').refresh(store,wallet,connection);return {...checked,...await state(wallet)}}\n  if(action==='market-buy'){"]
];
function replaceCount(text, [before, after, count = 1], label) {
  if (text.split(after).length - 1 === count && (!text.includes(before) || after.includes(before))) return text;
  const n = text.split(before).length - 1; if (n !== count) throw Error('Mythic hero patch mismatch: ' + label + ' (' + n + ')');
  return text.split(before).join(after);
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name), b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
function applyMythicHero(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'mythic-hero'), dest = path.join(appDir, 'public/assets/mythic-hero');
  if (!fs.existsSync(path.join(src, 'assets/metadata/tsukiyomi.json'))) throw Error('Tsukiyomi assets are missing: run node mythic-hero/tools/build-assets.cjs');
  fs.rmSync(dest, { recursive: true, force: true });
  copyDir(path.join(src, 'assets'), dest);
  fs.copyFileSync(path.join(src, 'mythic-hero.js'), path.join(dest, 'mythic-hero.js'));
  for (const file of ['animation-controller.js','animation-runtime.js','articulated-sprite.js','skill-effects.js']) fs.copyFileSync(path.join(src,file),path.join(dest,file));
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(server, 'mythic-hero.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Mythic hero v1')) fs.appendFileSync(schema, '\n-- Mythic hero v1\n' + require('./mythic-hero/server.cjs').SCHEMA + '\n');
  const economy = path.join(server, 'economy.cjs');
  fs.writeFileSync(economy, economyHooks.reduce((text, hook, i) => replaceCount(text, hook, 'economy ' + i), fs.readFileSync(economy, 'utf8')));
  const service = path.join(server, 'service.cjs');
  fs.writeFileSync(service, serviceHooks.reduce((text, hook, i) => replaceCount(text, hook, 'service ' + i), fs.readFileSync(service, 'utf8')));
  const index = path.join(appDir, 'public/index.html');
  let html = mythicPatches.reduce((text, hook, i) => replaceCount(text, hook, 'client ' + i), fs.readFileSync(index, 'utf8'));
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Mythic hero: expected one </head>.');
    html = html.replace('</head>', marker + '\n' + script + '\n</head>');
  }
  fs.writeFileSync(index, html);
  console.log('Mythic hero applied: Tsukiyomi (rank 5, Mythic), lazy-loaded art, NFT ownership check (dormant until MYTHIC_BOX_MINTS or MYTHIC_BOX_COLLECTION is set).');
}
module.exports = { applyMythicHero, mythicPatches, economyHooks, serviceHooks, marker, script };
if (require.main === module) applyMythicHero();
