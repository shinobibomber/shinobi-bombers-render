/* Fusion Shards build step (after apply-shrine-pity, before apply-live-economy; see unpack.cjs). Owner request 2026-11-11.
 * Copies fusion-shards/server.cjs to app/server/fusion-shards.cjs and fusion-shards/fusion-shards.js to the client, appends the
 * additive schema, and adds exact-string hooks (each must match exactly once, or the build stops):
 *   economy.cjs  quote() passes the fusion quote through fusion-shards.quote (optional params.fusionShards: +5% each, up to
 *                100%); fulfill() deducts the quoted Fusion Shards in profile_after (fusion-shards.consume).
 *   store.cjs    confirmed settlement re-applies the Fusion Shard cost to the CURRENT balance (like Training's Upgrade Shards).
 *   service.cjs  the `fusion-shard-craft` game action (2 Upgrade Shards -> 1 Fusion Shard).
 *   index.html   RyoPayments.fusionShardCraft and the checkout note (FusionShards.decorate) + the client script.
 * economy.cjs / store.cjs / service.cjs are covered by their pinned hashes; tests/preservation.cjs reverses the client hooks. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const F = "require('./fusion-shards.cjs')";
const marker = '<!-- fusion-shards -->', script = '<script defer src="assets/fusion-shards/fusion-shards.js"></script>';

const economyHooks = [
  ["function quote(profile,product,params={}){return require('./hero-upgrades.cjs').trainingQuote(profile,nativeQuote(profile,product,params));}",
   "function quote(profile,product,params={}){return " + F + ".quote(profile,require('./hero-upgrades.cjs').trainingQuote(profile,nativeQuote(profile,product,params)));}"],
  ["require('./hero-upgrades.cjs').consume(next,q);",
   "require('./hero-upgrades.cjs').consume(next,q);" + F + ".consume(next,q);"],
];
const storeHooks = [
  ["row.profile_after.upgradeShards=require('./hero-upgrades.cjs').settlementShards(current,row);",
   "row.profile_after.upgradeShards=require('./hero-upgrades.cjs').settlementShards(current,row);row.profile_after.fusionShards=" + F + ".settlementShards(current,row);"],
];
const serviceHooks = [
  ["  if(action==='hero-salvage'){",
   "  if(action==='fusion-shard-craft'){const fusionShardCraft=await " + F + ".craft(store,wallet,body);return {fusionShardCraft,...await state(wallet)}}\n  if(action==='hero-salvage'){"],
];
const clientHooks = [
  ["salvage:body=>run(async()=>{const data=await api('hero-salvage',body);accept(data);return data}),",
   "salvage:body=>run(async()=>{const data=await api('hero-salvage',body);accept(data);return data}),fusionShardCraft:body=>run(async()=>{const data=await api('fusion-shard-craft',body);accept(data);return data}),"],
  ['window.ChestSpending?.decorate(dialog,q);', 'window.FusionShards?.decorate(dialog,q);window.ChestSpending?.decorate(dialog,q);'],
];

function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1 && !text.split(after).join('').includes(before)) return text; // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Fusion Shards patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}
const patch = (file, hooks, label) => fs.writeFileSync(file, hooks.reduce((t, h, i) => replaceOnce(t, h, label + ' ' + i), fs.readFileSync(file, 'utf8')));

function applyFusionShards(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'fusion-shards'), server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(server, 'fusion-shards.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Fusion Shards v1')) fs.appendFileSync(schema, '\n-- Fusion Shards v1 (apply-fusion-shards.cjs). Additive; existing data untouched.\n' + require('./fusion-shards/server.cjs').SCHEMA + '\n');
  patch(path.join(server, 'economy.cjs'), economyHooks, 'economy');
  patch(path.join(server, 'store.cjs'), storeHooks, 'store');
  patch(path.join(server, 'service.cjs'), serviceHooks, 'service');
  const assets = path.join(appDir, 'public/assets/fusion-shards');
  fs.rmSync(assets, { recursive: true, force: true }); fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(path.join(src, 'fusion-shards.js'), path.join(assets, 'fusion-shards.js'));
  const index = path.join(appDir, 'public/index.html');
  let html = clientHooks.reduce((t, h, i) => replaceOnce(t, h, 'client ' + i), fs.readFileSync(index, 'utf8'));
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Fusion Shards: expected one </head>.');
    html = html.replace('</head>', marker + '\n' + script + '\n</head>');
  }
  fs.writeFileSync(index, html);
  console.log('Fusion Shards applied: craft 2 Upgrade Shards -> 1 Fusion Shard; each Fusion Shard per attempt adds +5% fusion success, up to 100%.');
}
module.exports = { applyFusionShards, economyHooks, storeHooks, serviceHooks, clientHooks, marker, script };
if (require.main === module) applyFusionShards();
