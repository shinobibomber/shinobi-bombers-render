/* Prison rescue build step (after apply-founders, before apply-live-economy; see unpack.cjs).
 *
 * Owner request 2026-11-10: a prisoner freed in Adventure (kind-6 prison cage) becomes a real, account-bound hero granted by
 * the server, instead of a browser-only practice hero that the live sync removed seconds later. Every cage counts.
 * Copies prison-rescue/server.cjs to app/server/prison-rescue.cjs, appends its additive schema, the client script, and
 * exact-string hooks (each must match exactly once, or the build stops):
 *   service.cjs  the `prison-rescue` game action (full state only with a granted hero; a failed state read never hides the grant).
 * Rescued heroes can be salvaged for Upgrade Shards like any other hero (owner decision 2026-11-10).
 *   index.html   the kind-6 branch of boom (signed in: ask the server; signed out: the original practice hero, unchanged),
 *                RyoPayments.prisonRescue, and the rules line about prison rescues.
 * Launch gate (rewardClaims) and operator pause ("purchases", like referral hero claims) live in launch-gates/server.cjs and
 * economic-dashboard/server.cjs. tests/preservation.cjs reverses the client hooks; service.cjs is covered by its pinned hash.
 * The real-time kill -> Chest path is untouched: only the kind-6 branch changes, after the kill event and Chest credit. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const marker = '<!-- prison-rescue -->', script = '<script defer src="assets/prison-rescue/prison-rescue.js"></script>';

const serviceHooks = [
  ["  if(action==='sensei-settings'){",
   "  if(action==='prison-rescue'){const rescue=await require('./prison-rescue.cjs').claim(store,wallet,body);return rescue.status==='granted'?{prisonRescue:rescue,...await state(wallet).catch(()=>({}))}:{prisonRescue:rescue}}\n  if(action==='sensei-settings'){"],
];
const clientHooks = [
  ["if(kind===6){const rank=GameBalance.rollRarity();const hero=mk(rank,false);S.h.push(hero);fl.push({x:b.tx,y:b.ty,t:1,s:'HERO RESCUED'});save();if(window.Experience)Experience.presentRescue(hero)}",
   "if(kind===6){if(window.PrisonRescue?.online()){fl.push({x:b.tx,y:b.ty,t:1,s:'PRISONER FREED'});PrisonRescue.claim({x:b.tx,y:b.ty})}else{const rank=GameBalance.rollRarity();const hero=mk(rank,false);S.h.push(hero);fl.push({x:b.tx,y:b.ty,t:1,s:'HERO RESCUED'});save();if(window.Experience)Experience.presentRescue(hero)}}"],
  // Appended after RyoPayments.founders (the object's tail, added by apply-founders); reversed before the Founders hook.
  ["throw Error('Unknown Founder action.');return api(action,body).then(data=>{accept(data);return data})}};",
   "throw Error('Unknown Founder action.');return api(action,body).then(data=>{accept(data);return data})},prisonRescue:(body={})=>api('prison-rescue',body).then(data=>{if(data.profile)accept(data);return data})};"],
  ['Prison rescues always grant a hero instead of Ryo.',
   'Freeing a prisoner grants an account-bound hero instead of Ryo (signed in, Shrine odds, never Mythic).'],
];

function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1 && !text.split(after).join('').includes(before)) return text; // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Prison rescue patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}
const patch = (file, hooks, label) => fs.writeFileSync(file, hooks.reduce((t, h, i) => replaceOnce(t, h, label + ' ' + i), fs.readFileSync(file, 'utf8')));

function applyPrisonRescue(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'prison-rescue'), server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(server, 'prison-rescue.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Prison Rescue v1')) fs.appendFileSync(schema, '\n-- Prison Rescue v1 (apply-prison-rescue.cjs). Additive; existing data untouched.\n' + require('./prison-rescue/server.cjs').SCHEMA + '\n');
  patch(path.join(server, 'service.cjs'), serviceHooks, 'service');
  const assets = path.join(appDir, 'public/assets/prison-rescue');
  fs.rmSync(assets, { recursive: true, force: true }); fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(path.join(src, 'prison-rescue.js'), path.join(assets, 'prison-rescue.js'));
  const index = path.join(appDir, 'public/index.html');
  let html = clientHooks.reduce((t, h, i) => replaceOnce(t, h, 'client ' + i), fs.readFileSync(index, 'utf8'));
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Prison rescue: expected one </head>.');
    html = html.replace('</head>', marker + '\n' + script + '\n</head>');
  }
  fs.writeFileSync(index, html);
  console.log('Prison rescue applied: every verified prison kill grants one account-bound hero (Shrine odds, never Mythic), 100,000 verified HP apart.');
}
module.exports = { applyPrisonRescue, serviceHooks, clientHooks };
if (require.main === module) applyPrisonRescue();
