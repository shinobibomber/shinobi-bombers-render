/* Founder's NFT Boxes build step (after apply-treasury and apply-hero-upgrades; see unpack.cjs).
 *
 * Copies founders/server.cjs to app/server/founders.cjs, appends its additive schema, the game panel client, and
 * exact-string hooks (each must match exactly once, or the build stops):
 *   economy.cjs        Founder discount (10% Mythic / 5% Legacy, never stacked with the Mythic Box 10%) and, on the
 *                      live build, the removal of the Ryo Sensei products (Sensei is bought with SOL).
 *   service.cjs        founder-* / sensei-sol-* game actions, pending Founder/Sensei settlement and the profile's
 *                      founderTier flag in state(), the senseiSol config flag (only when enabled), and
 *                      qualifying-week activity from active Adventure play.
 *   hero-upgrades.cjs  the buyer-bound Founder Tsukiyomi cannot be salvaged (like NFT-bound heroes).
 *   index.html         RyoPayments.founders and the Founder panel script.
 * The 12 h Founder Chest cooldown lives in treasury/treasury-rewards.cjs (claimCooldownFor) and asks founders.cjs.
 * Only source files are edited; app/ is generated. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const marker = '<!-- founders -->', script = '<script defer src="assets/founders/founders-game.js"></script>';
const F = "require('./founders.cjs')";

const economyHooks = [
  ["normalizeProfile(profile);if(product==='hunt')return require('./boss-hunt.cjs').quote(VERSION);",
   "normalizeProfile(profile);if(product==='hunt')return require('./boss-hunt.cjs').quote(VERSION);" + F + ".assertRyoProduct(product);"],
  ["if(profile.mythicPerk===true){base=Math.round(base*.9);title+=' · Mythic −10%'}",
   "{const fd=" + F + ".discount(profile,product);if(profile.mythicPerk===true&&fd.bps<=1000){base=Math.round(base*.9);title+=' · Mythic −10%'}else if(fd.bps>0){base=Math.round(base*(10000-fd.bps)/10000);title+=' · '+fd.label}}"],
];
const serviceHooks = [
  ["  if(['box-info','box-mint','box-confirm'].includes(action)){",
   "  if(" + F + ".GAME_ACTIONS.includes(action)){await checkNetwork();const founders=await " + F + ".handleGame({store,connection,revenueAddress,origin},wallet,action,body);return {...founders,...await state(wallet)}}\n  if(['box-info','box-mint','box-confirm'].includes(action)){"],
  ["await require('./mythic-box.cjs').sweep({store,connection},wallet);",
   "await require('./mythic-box.cjs').sweep({store,connection},wallet);await " + F + ".sweep({store,connection},wallet);await " + F + ".syncProfile(store,wallet);"],
  ["if(action==='config'){await checkMint();return {economyVersion:2,", "if(action==='config'){await checkMint();return {...(" + F + ".switches().senseiSol?{senseiSol:true}:{}),economyVersion:2,"],
  ["const chest=await require('./adventure.cjs').adventure(store,wallet,{active:body.active===true,claim,",
   "if(body.active===true)await " + F + ".recordActivity(store,wallet);const chest=await require('./adventure.cjs').adventure(store,wallet,{active:body.active===true,claim,"],
];
const salvageHooks = [
  ["if(hero.nft)fail('NFT-bound heroes cannot be salvaged.", "if(hero.nft||hero.founderBound)fail('NFT-bound heroes cannot be salvaged."],
];
const clientHooks = [
  // Appended at the end of the RyoPayments object (a tail no other build step owns), so every other hook stays intact.
  ["get state(){return {...state,account,configuration:configuration?{...configuration}:null}}};", "get state(){return {...state,account,configuration:configuration?{...configuration}:null}},founders:(action,body={})=>{if(!/^(founder-(status|activate|summon|sensei-trial)|sensei-sol-(info|buy|confirm))$/.test(action))throw Error('Unknown Founder action.');return api(action,body).then(data=>{accept(data);return data})}};"],
];

function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1 && !text.split(after).join('').includes(before)) return text; // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Founders patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}
function patch(file, hooks, label) {
  fs.writeFileSync(file, hooks.reduce((t, h, i) => replaceOnce(t, h, label + ' ' + i), fs.readFileSync(file, 'utf8')));
}

function applyFounders(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'founders'), server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(server, 'founders.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Founders v1')) fs.appendFileSync(schema, '\n-- Founders v1 (apply-founders.cjs). Additive; existing data untouched.\n' + require('./founders/server.cjs').SCHEMA + '\n');
  patch(path.join(server, 'economy.cjs'), economyHooks, 'economy');
  patch(path.join(server, 'service.cjs'), serviceHooks, 'service');
  patch(path.join(server, 'hero-upgrades.cjs'), salvageHooks, 'salvage');
  const assets = path.join(appDir, 'public/assets/founders');
  fs.rmSync(assets, { recursive: true, force: true }); fs.mkdirSync(assets, { recursive: true });
  for (const f of ['founders-game.js', 'founders-game.css']) fs.copyFileSync(path.join(src, f), path.join(assets, f));
  const index = path.join(appDir, 'public/index.html');
  let html = clientHooks.reduce((t, h, i) => replaceOnce(t, h, 'client ' + i), fs.readFileSync(index, 'utf8'));
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Founders: expected one </head>.');
    html = html.replace('</head>', marker + '\n<link rel="stylesheet" href="assets/founders/founders-game.css">\n' + script + '\n</head>');
  }
  fs.writeFileSync(index, html);
  console.log("Founder's NFT Boxes applied: Mythic 1 SOL / Legacy 0.5 SOL, 30 each, 1 per wallet across tiers; buyer-bound benefits; switches fail closed.");
}
module.exports = { applyFounders, economyHooks, serviceHooks, salvageHooks, clientHooks };
if (require.main === module) applyFounders();
