/* Limited Mythic NFT Box build step (after apply-mythic-hero): copies the box module, art and client
 * (app/public/assets/mythic-box/), writes the 20 NFT metadata files, adds the box table, the box-info /
 * box-mint / box-confirm actions and their state sweep, the 10% holder discount in the purchase
 * quote, and RyoPayments.box. Exact-string hooks; tests/preservation.cjs reverses boxPatches. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const marker = '<!-- mythic-box -->', script = '<script defer src="assets/mythic-box/box.js"></script>';
const SITE = process.env.RYO_SITE_ORIGIN || 'https://shinobi-bombers-beta.onrender.com';
// Game client: the Mythic Box API next to the Mythic hero check.
const boxPatches = [
  ["window.RyoPayments={mythic:", "window.RyoPayments={box:(action,body={})=>{if(!['box-info','box-mint','box-confirm'].includes(action))throw Error('Unknown Mythic Box action.');return api(action,body).then(data=>{accept(data);return data})},mythic:", 1]
];
const economyHooks = [
  // Box holders (profile.mythicPerk, set from verified NFTs) pay 10% less; the hunt entry returns earlier.
  ["const split=require('./gameplay-options.cjs').purchaseSplit(base),studioFee=split.studioFee;", "if(profile.mythicPerk===true){base=Math.round(base*.9);title+=' · Mythic −10%'}const split=require('./gameplay-options.cjs').purchaseSplit(base),studioFee=split.studioFee;", 1]
];
const serviceHooks = [
  ["const mythic=await require('./mythic-hero.cjs').sync(store,wallet,connection);", "await require('./mythic-box.cjs').sweep({store,connection},wallet);const mythic=await require('./mythic-hero.cjs').sync(store,wallet,connection);", 1],
  ["  if(action==='mythic-refresh'){", "  if(['box-info','box-mint','box-confirm'].includes(action)){await checkNetwork();const box=await require('./mythic-box.cjs').handle({store,connection,treasury,revenueAddress,origin},wallet,action,body);if(box.mint?.status==='confirmed')await require('./mythic-hero.cjs').sync(store,wallet,connection,{force:true});return {...box,...await state(wallet)}}\n  if(action==='mythic-refresh'){", 1]
];
function replaceCount(text, [before, after, count = 1], label) {
  if (text.split(after).length - 1 === count && (!text.includes(before) || after.includes(before))) return text;
  const n = text.split(before).length - 1; if (n !== count) throw Error('Mythic Box patch mismatch: ' + label + ' (' + n + ')');
  return text.split(before).join(after);
}
function metadata(serial, supply) {
  const base = SITE.replace(/\/$/, '') + '/play/assets/mythic-box/';
  return { name: 'Mythic NFT Box #' + serial, symbol: 'SBBOX', description: `Shinobi Bombers Limited Mythic NFT Box (${serial} of ${supply}). Exclusive initial investor offer: unlocks the Mythic hero Tsukiyomi with the Mythic Aura, a 10% discount on in-game purchases (Summon, Fusion, Dojo, Sensei, Training; not Marketplace transactions or the Boss Hunt entrance fee) and the exclusive NFT holder tier.`,
    image: base + 'box.png', external_url: SITE.replace(/\/$/, '') + '/play/',
    attributes: [{ trait_type: 'Box', value: serial + ' of ' + supply }, { trait_type: 'Hero', value: 'Tsukiyomi (Mythic)' }, { trait_type: 'Aura', value: 'Mythic Aura' }, { trait_type: 'Perk', value: '10% in-game discount' }],
    properties: { category: 'image', files: [{ uri: base + 'box.png', type: 'image/png' }] } };
}
function applyMythicBox(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'mythic-box'), dest = path.join(appDir, 'public/assets/mythic-box');
  fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(path.join(dest, 'metadata'), { recursive: true });
  for (const f of ['box.png', 'box-256.webp', 'promo.webp']) fs.copyFileSync(path.join(src, 'art', f), path.join(dest, f));
  fs.copyFileSync(path.join(src, 'box.js'), path.join(dest, 'box.js'));
  const supply = require('./mythic-box/server.cjs').config().supply;
  for (let n = 1; n <= supply; n++) fs.writeFileSync(path.join(dest, 'metadata', 'box-' + n + '.json'), JSON.stringify(metadata(n, supply), null, 2) + '\n');
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(server, 'mythic-box.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Mythic box v1')) fs.appendFileSync(schema, '\n-- Mythic box v1\n' + require('./mythic-box/server.cjs').SCHEMA + '\n');
  for (const [file, hooks] of [['economy.cjs', economyHooks], ['service.cjs', serviceHooks]]) {
    const p = path.join(server, file); fs.writeFileSync(p, hooks.reduce((t, h, i) => replaceCount(t, h, file + ' ' + i), fs.readFileSync(p, 'utf8')));
  }
  const index = path.join(appDir, 'public/index.html');
  let html = boxPatches.reduce((t, h, i) => replaceCount(t, h, 'client ' + i), fs.readFileSync(index, 'utf8'));
  if (!html.includes(marker)) { if (html.split('</head>').length !== 2) throw Error('Mythic Box: expected one </head>.'); html = html.replace('</head>', marker + '\n' + script + '\n</head>'); }
  fs.writeFileSync(index, html);
  console.log('Mythic Box applied: ' + supply + ' boxes, 1 SOL (2nd box 1.5 SOL), max 2 per wallet, Solana Devnet; holders get Tsukiyomi and 10% off.');
}
module.exports = { applyMythicBox, boxPatches, economyHooks, serviceHooks, metadata };
if (require.main === module) applyMythicBox();
