/* Starter Activation build step (after apply-hero-passes, before apply-live-economy; see unpack.cjs). Owner request 2026-11-11.
 * Copies starter-activation/server.cjs to app/server/starter-activation.cjs and starter-activation/starter-activation.js to
 * the client, appends the additive schema, and adds exact-string hooks (each must match exactly once, or the build stops):
 *   store.cjs      a brand-new profile gets createdAt (server clock) and, once the scheduled launch has passed, the starter pack
 *                  (same transaction as the profile row).
 *   economy.cjs    a paid Shrine summon (the purchases Shrine pity counts) advances the 15-summon activation.
 *   adventure.cjs  the 50% starter rate is handed to advance() before the Chest Overflow window (never stored); the
 *                  Adventure response gains `starter` (the player's activation view).
 * Nothing happens until an approver schedules the launch. store/economy/adventure are pinned; the client is its own script. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const S = "require('./starter-activation.cjs')";
const marker = '<!-- starter-activation -->', script = '<script defer src="assets/starter-activation/starter-activation.js"></script>';

const storeHooks = [
  ["if(!row){const data=require('./economy.cjs').initialProfile();await c.query('INSERT INTO ryo_profiles(scope,wallet,data) VALUES($1,$2,$3)'",
   "if(!row){const data=await " + S + ".newProfile(this,c,wallet,require('./economy.cjs').initialProfile());await c.query('INSERT INTO ryo_profiles(scope,wallet,data) VALUES($1,$2,$3)'"],
];
const economyHooks = [
  // A hero fused from a starter Genin stays not salvageable (like the account binding it already inherits).
  ['if(q.params.heroIds.slice(i*3,i*3+3).some(id=>next.heroes.find(h=>h.tokenId===id)?.referralReward===true))fused.referralReward=true;',
   'if(q.params.heroIds.slice(i*3,i*3+3).some(id=>next.heroes.find(h=>h.tokenId===id)?.referralReward===true))fused.referralReward=true;if(q.params.heroIds.slice(i*3,i*3+3).some(id=>next.heroes.find(h=>h.tokenId===id)?.starterGrant===true))fused.starterGrant=true;'],
  ['return {profile:next,result:{product:q.product,title:q.title,outputs,...(shrinePity?{pity:shrinePity}:{}),',
   'if(shrinePity)' + S + '.countPaid(next,q.params.quantity,now);return {profile:next,result:{product:q.product,title:q.title,outputs,...(shrinePity?{pity:shrinePity}:{}),'],
];
const adventureHooks = [
  [" const overflow=await require('./chest-overflow.cjs').window(store,c,wallet,row?.data,",
   ' await ' + S + ".window(store,c,wallet,row?.data,profile);const overflow=await require('./chest-overflow.cjs').window(store,c,wallet,row?.data,"],
  ["  const overflow=await require('./chest-overflow.cjs').window(store,c,wallet,old,pool);",
   '  await ' + S + ".window(store,c,wallet,old,profile);const overflow=await require('./chest-overflow.cjs').window(store,c,wallet,old,pool);"],
  [",overflow:require('./chest-overflow.cjs').status(", ',starter:' + S + ".view(profile),overflow:require('./chest-overflow.cjs').status("],
];

function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1 && !text.split(after).join('').includes(before)) return text; // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Starter Activation patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}
const patch = (file, hooks, label) => fs.writeFileSync(file, hooks.reduce((t, h, i) => replaceOnce(t, h, label + ' ' + i), fs.readFileSync(file, 'utf8')));

function applyStarterActivation(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'starter-activation'), server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(server, 'starter-activation.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Starter Activation v1')) fs.appendFileSync(schema, '\n-- Starter Activation v1 (apply-starter-activation.cjs). Additive; existing data untouched.\n' + require('./starter-activation/server.cjs').SCHEMA + '\n');
  patch(path.join(server, 'store.cjs'), storeHooks, 'store');
  patch(path.join(server, 'economy.cjs'), economyHooks, 'economy');
  patch(path.join(server, 'adventure.cjs'), adventureHooks, 'adventure');
  const assets = path.join(appDir, 'public/assets/starter-activation');
  fs.rmSync(assets, { recursive: true, force: true }); fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(path.join(src, 'starter-activation.js'), path.join(assets, 'starter-activation.js'));
  const index = path.join(appDir, 'public/index.html');
  let html = fs.readFileSync(index, 'utf8');
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Starter Activation: expected one </head>.');
    html = html.replace('</head>', marker + '\n' + script + '\n</head>'); fs.writeFileSync(index, html);
  }
  console.log('Starter Activation applied: dormant until an approver schedules the 12:00 PM PHT launch.');
}
module.exports = { applyStarterActivation, storeHooks, economyHooks, adventureHooks, marker, script };
if (require.main === module) applyStarterActivation();
