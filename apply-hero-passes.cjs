/* Promotional Hero Passes build step (after apply-chest-overflow, before apply-live-economy; see unpack.cjs). Owner request
 * 2026-11-11. Copies hero-passes/server.cjs to app/server/hero-passes.cjs and hero-passes/hero-passes.js to the client, appends
 * the additive schema, and adds exact-string hooks (each must match exactly once, or the build stops):
 *   service.cjs  the player actions pass-state / pass-claim / pass-redeem (full state after a claim or a use).
 *   index.html   RyoPayments.heroPasses(action, body) + the client script.
 * The admin operations go through the Creators Portal admin actions (creators-portal/server.cjs, approver only, audited).
 * Everything is behind four Control-panel switches that are OFF by default. service.cjs is pinned; preservation reverses the
 * client hook. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const H = "require('./hero-passes.cjs')";
const marker = '<!-- hero-passes -->', script = '<script defer src="assets/hero-passes/hero-passes.js"></script>';

const serviceHooks = [
  ["  if(action==='fusion-shard-craft'){",
   "  if(action==='pass-state')return {heroPasses:await " + H + ".playerState(store,wallet)};\n" +
   "  if(action==='pass-claim'){const passClaim=await " + H + ".claim(store,wallet,body);return {passClaim,heroPasses:await " + H + ".playerState(store,wallet)}}\n" +
   "  if(action==='pass-redeem'){const passRedeem=await " + H + ".redeem(store,wallet,body);return {passRedeem,heroPasses:await " + H + ".playerState(store,wallet),...await state(wallet)}}\n" +
   "  if(action==='fusion-shard-craft'){"],
];
const clientHooks = [
  ["fusionShardCraft:body=>run(async()=>{const data=await api('fusion-shard-craft',body);accept(data);return data}),",
   "fusionShardCraft:body=>run(async()=>{const data=await api('fusion-shard-craft',body);accept(data);return data}),heroPasses:(action,body={})=>{if(!['pass-state','pass-claim','pass-redeem'].includes(action))throw Error('Unknown Hero Pass action.');return api(action,body).then(data=>{if(data.profile)accept(data);return data})},"],
];

function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1 && !text.split(after).join('').includes(before)) return text; // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Hero Passes patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}

function applyHeroPasses(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'hero-passes'), server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(server, 'hero-passes.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Hero Passes v1')) fs.appendFileSync(schema, '\n-- Hero Passes v1 (apply-hero-passes.cjs). Additive; existing data untouched.\n' + require('./hero-passes/server.cjs').SCHEMA + '\n');
  const service = path.join(server, 'service.cjs');
  fs.writeFileSync(service, serviceHooks.reduce((t, h, i) => replaceOnce(t, h, 'service ' + i), fs.readFileSync(service, 'utf8')));
  const assets = path.join(appDir, 'public/assets/hero-passes');
  fs.rmSync(assets, { recursive: true, force: true }); fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(path.join(src, 'hero-passes.js'), path.join(assets, 'hero-passes.js'));
  const index = path.join(appDir, 'public/index.html');
  let html = clientHooks.reduce((t, h, i) => replaceOnce(t, h, 'client ' + i), fs.readFileSync(index, 'utf8'));
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Hero Passes: expected one </head>.');
    html = html.replace('</head>', marker + '\n' + script + '\n</head>');
  }
  fs.writeFileSync(index, html);
  console.log('Hero Passes applied: campaigns, bulk distribution, CLAIM and account-bound passes (all switches OFF by default).');
}
module.exports = { applyHeroPasses, serviceHooks, clientHooks, marker, script };
if (require.main === module) applyHeroPasses();
