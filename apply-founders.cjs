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

// Live: the Sensei is a one-time SOL purchase (owner decision 2026-11-09). The Dojo Sensei pane (pinned scene file, so a
// reversible build hook on the copied asset) shows the server's SOL price via FounderPanel.sensei and offers no Ryo hire
// or Ryo rental. Without SOL mode (test server) the pane is unchanged.
const dojoSenseiHooks = [
  ["box('strong','sensei-purchase-title',permanent?'HIRED':hired?'RENTED':fmt(GameBalance.senseiCost)+' Ryo',909,708,470,48);\n    box('p','sensei-purchase-copy',permanent?'Permanent automatic rotation and up to 12 hours of offline earnings.':hired?'Rental active until '+new Date(rentalUntil).toLocaleString()+'.':'Hire permanently or rent for 7 days. Up to 12 hours of offline earnings.',900,766,469,52);\n    const hire=button(hired?(on?'TURN OFF':'TURN ON'):'HIRE SENSEI',1399,713,233,69,()=>{if(hired)V2.toggleButler();else DojoServices.hire();render()},true);hire.classList.add('sensei-primary-action');hire.disabled=!hired&&!GameCurrency.canAfford(GameBalance.senseiCost);","const sol=window.FounderPanel&&FounderPanel.sensei&&FounderPanel.sensei.mode()?FounderPanel.sensei:null,offer=sol&&sol.cached();if(sol&&sol.due())sol.offer().then(()=>{lastSignature='';render()},()=>{});const solPrice=offer?(offer.mythicIncluded?'FREE WITH MYTHIC':offer.price+' SOL'+(offer.usd?' ≈ $'+offer.usd.toFixed(2):'')):'PAID IN SOL';\n    box('strong','sensei-purchase-title',permanent?'HIRED':hired?'RENTED':sol?solPrice:fmt(GameBalance.senseiCost)+' Ryo',909,708,470,48);\n    box('p','sensei-purchase-copy',permanent?'Permanent automatic rotation and up to 12 hours of offline earnings.':hired?'Rental active until '+new Date(rentalUntil).toLocaleString()+'.':sol?'One-time payment in SOL: permanent rotation and up to 12 hours of offline earnings.':'Hire permanently or rent for 7 days. Up to 12 hours of offline earnings.',900,766,469,52);\n    const hire=button(hired?(on?'TURN OFF':'TURN ON'):'HIRE SENSEI',1399,713,233,69,()=>{if(hired)V2.toggleButler();else if(sol){if(window.SbwHireSensei)SbwHireSensei()}else DojoServices.hire();render()},true);hire.classList.add('sensei-primary-action');hire.disabled=!hired&&(sol?!!(offer&&!offer.enabled&&!offer.mythicIncluded):!GameCurrency.canAfford(GameBalance.senseiCost));"],
  ["if(!permanent){const rental=","if(!permanent&&sol&&hired){const permanentHire=button('Hire permanently · '+(offer?offer.price+' SOL':'SOL'),902,816,466,20,()=>{if(window.SbwHireSensei)SbwHireSensei()},true);permanentHire.classList.add('sensei-permanent-action');}else if(!permanent&&!sol){const rental="],
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
  // v2 after v1: Mythic early bird #1-#3 at 0.5 SOL and 33 Mythic serials. app/ is rebuilt from the archive on every build, so
  // schema.sql always carries the current MIGRATION_V2; db:init re-runs it each deploy (idempotent, keeps existing rows).
  if (!fs.readFileSync(schema, 'utf8').includes('-- Founders v2')) fs.appendFileSync(schema, '\n-- Founders v2 (apply-founders.cjs): Mythic early bird and 33 supply. Idempotent; existing rows kept.\n' + require('./founders/server.cjs').MIGRATION_V2 + '\n');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Founders v3')) fs.appendFileSync(schema, '\n-- Founders v3: prelaunch prices; historical receipts preserved.\n' + require('./founders/server.cjs').MIGRATION_V3 + '\n');
  patch(path.join(server, 'economy.cjs'), economyHooks, 'economy');
  patch(path.join(server, 'service.cjs'), serviceHooks, 'service');
  patch(path.join(server, 'hero-upgrades.cjs'), salvageHooks, 'salvage');
  const assets = path.join(appDir, 'public/assets/founders');
  fs.rmSync(assets, { recursive: true, force: true }); fs.mkdirSync(assets, { recursive: true });
  for (const f of ['founders-game.js', 'founders-game.css']) fs.copyFileSync(path.join(src, f), path.join(assets, f));
  const dojoScene = path.join(appDir, 'public/assets/dojo-design/dojo-design.js');
  if (fs.existsSync(dojoScene)) patch(dojoScene, dojoSenseiHooks, 'dojo sensei');
  const index = path.join(appDir, 'public/index.html');
  let html = clientHooks.reduce((t, h, i) => replaceOnce(t, h, 'client ' + i), fs.readFileSync(index, 'utf8'));
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Founders: expected one </head>.');
    html = html.replace('</head>', marker + '\n<link rel="stylesheet" href="assets/founders/founders-game.css">\n' + script + '\n</head>');
  }
  fs.writeFileSync(index, html);
  console.log("Founder's NFT Boxes applied: Mythic 33 / Legacy 30; prelaunch 0.7 / 0.25 SOL, public game 1 / 0.5 SOL; 1 per wallet across tiers; buyer-bound benefits; switches fail closed.");
}
module.exports = { applyFounders, economyHooks, serviceHooks, salvageHooks, clientHooks, dojoSenseiHooks };
if (require.main === module) applyFounders();
