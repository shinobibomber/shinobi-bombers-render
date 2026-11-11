/* Expedition Mode build step (after apply-feature-switches, before the Command Center schema; see unpack.cjs). Owner spec
 * 2026-11-11. Copies expedition/server.cjs to app/server/expedition.cjs and expedition/expedition.{js,css} to the client,
 * appends the additive schema, and adds exact-string hooks (each must match exactly once, or the build stops):
 *   adventure.cjs  hands the Expedition window (duty on/off, verified Founder benefit) to both advance() calls.
 *   service.cjs    the read-only player action `expedition`; the Expedition-only atomic custody transaction (4 transfers,
 *                  50/30/10/10, + memo; no burn) for product 'expedition'. Every other product keeps its existing instructions.
 *   store.cjs      Expedition acceleration is never paid with Starter Ryo; confirmed settlement books the evidence and
 *                  releases the exact Expedition paid for (after the current chakra is restored, so it is not overwritten).
 *   economy.cjs    quote() routes product 'expedition' to expedition.cjs (Store.purchase re-quotes it, so preview = charge).
 *   index.html     RyoPayments.expedition(); a hero on an Expedition is never deployed, swapped in by the browser Sensei or
 *                  picked by Work All (the server enforces the same rule); the client script and stylesheet.
 * Combat Duty itself is in combat-rules/duty.cjs (copied by apply-combat-rules.cjs). Everything is OFF until the Control-panel
 * switch `expeditions` is on; paid acceleration has its own closed locks (expedition/server.cjs). service.cjs, store.cjs,
 * economy.cjs, adventure.cjs and schema.sql are pinned; preservation reverses the client hooks. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const X = "require('./expedition.cjs')";
const marker = '<!-- expedition -->', tags = '<link rel="stylesheet" href="assets/expedition/expedition.css">\n<script defer src="assets/expedition/expedition.js"></script>';

const serverHooks = {
  'adventure.cjs': [
    // Appended to the end of the Chest Overflow statement, just before the Creators Portal begin/advance lines, so every
    // earlier hook's text stays intact (tests/creators-server.cjs re-applies those hooks to the built file).
    ["const overflow=await require('./chest-overflow.cjs').window(store,c,wallet,row?.data,Math.max(0,Number(income.n)-Number(used.n)));", "const overflow=await require('./chest-overflow.cjs').window(store,c,wallet,row?.data,Math.max(0,Number(income.n)-Number(used.n)));" + X + ".window(row?.data,profile);"],
    ["const overflow=await require('./chest-overflow.cjs').window(store,c,wallet,old,pool);", "const overflow=await require('./chest-overflow.cjs').window(store,c,wallet,old,pool);" + X + ".window(old,profile);"],
  ],
  'service.cjs': [
    ["  if(action==='hero-salvage'){", "  if(action==='expedition')return " + X + ".handle(store,wallet,action);\n  if(action==='hero-salvage'){"],
    ["return signedTransaction(q.revenueDistribution?await require('./sr-revenue.cjs').instructions(",
     "return signedTransaction(q.expeditionDistribution?await " + X + ".instructions({store,client:c,wallet,connection,mint,treasuryAddress,studioAddress,revenueAddress,checkNetwork},q,id,transferTo,memo):q.revenueDistribution?await require('./sr-revenue.cjs').instructions("],
  ],
  'store.cjs': [
    ['bonusPaid=!chestPaid&&Number(account.bonus||0)>=q.total;', 'bonusPaid=!chestPaid&&q.noBonus!==true&&Number(account.bonus||0)>=q.total;'],
    ["for(const h of row.profile_after.heroes){const old=latest.get(h.tokenId);if(old?.chakra)h.chakra=old.chakra}await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[this.scope,wallet,JSON.stringify(require('./economy.cjs').normalizeProfile(row.profile_after))]);}",
     "for(const h of row.profile_after.heroes){const old=latest.get(h.tokenId);if(old?.chakra)h.chakra=old.chakra}await " + X + ".settled(this,c,row,row.profile_after);await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[this.scope,wallet,JSON.stringify(require('./economy.cjs').normalizeProfile(row.profile_after))]);}"],
  ],
  'economy.cjs': [
    ["function quote(profile,product,params={}){return require('./fusion-shards.cjs')", "function quote(profile,product,params={}){if(product==='expedition')return " + X + ".quote(profile,params);return require('./fusion-shards.cjs')"],
  ],
};
const clientHooks = [
  ['heroPasses:(action,body={})=>{', "expedition:()=>api('expedition',{}),heroPasses:(action,body={})=>{"],
  ['&&BattleRoster.eligible(h)).sort((a,b)=>b.r-a.r)[0];if(s&&r)', '&&BattleRoster.eligible(h)&&!window.Expedition?.away(h)).sort((a,b)=>b.r-a.r)[0];if(s&&r)'],
  ['if(h.on&&(!eligible.has(h)||++n>10))', 'if(h.on&&(!eligible.has(h)||window.Expedition?.away(h)||++n>10))'],
  ["return toast('Reserve hero: move this hero to Battle-ready to use it. Fuse reserves to strengthen your roster.');return oldTog(i)}",
   "return toast('Reserve hero: move this hero to Battle-ready to use it. Fuse reserves to strengthen your roster.');if(!h.on&&window.Expedition?.away(h))return toast('This hero is on an Expedition and returns on its own. See the Expedition Hall.');return oldTog(i)}"],
  ['BattleRoster.list().filter(h=>CombatRules.workAllReady(h))', 'BattleRoster.list().filter(h=>CombatRules.workAllReady(h)&&!window.Expedition?.away(h))'],
];

function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1 && !text.split(after).join('').includes(before)) return text; // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Expedition patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}

function applyExpedition(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'expedition'), server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(server, 'expedition.cjs'));
  if (!fs.existsSync(path.join(server, 'combat-duty.cjs'))) throw Error('Expedition: combat-duty.cjs missing (apply-combat-rules must run first).');
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Expedition Mode v1')) fs.appendFileSync(schema, '\n-- Expedition Mode v1 (apply-expedition.cjs). Additive; existing data untouched.\n' + require(path.join(server, 'expedition.cjs')).SCHEMA + '\n');
  for (const [file, hooks] of Object.entries(serverHooks)) {
    const f = path.join(server, file);
    fs.writeFileSync(f, hooks.reduce((t, h, i) => replaceOnce(t, h, file + ' ' + i), fs.readFileSync(f, 'utf8')));
  }
  const assets = path.join(appDir, 'public/assets/expedition');
  fs.rmSync(assets, { recursive: true, force: true }); fs.mkdirSync(assets, { recursive: true });
  for (const f of ['expedition.js', 'expedition.css']) fs.copyFileSync(path.join(src, f), path.join(assets, f));
  const index = path.join(appDir, 'public/index.html');
  let html = clientHooks.reduce((t, h, i) => replaceOnce(t, h, 'client ' + i), fs.readFileSync(index, 'utf8'));
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Expedition: expected one </head>.');
    html = html.replace('</head>', marker + '\n' + tags + '\n</head>');
  }
  fs.writeFileSync(index, html);
  console.log('Expedition Mode applied: 18-hour Combat Duty, free Expeditions, Expedition Hall (switch `expeditions` OFF by default; paid acceleration locked).');
}
module.exports = { applyExpedition, serverHooks, clientHooks, marker, tags };
if (require.main === module) applyExpedition();
