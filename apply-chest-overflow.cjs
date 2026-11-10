/* Chest Overflow build step (after apply-fusion-shards, before apply-live-economy; see unpack.cjs). Owner request 2026-11-11.
 * Copies chest-overflow/server.cjs to app/server/chest-overflow.cjs and chest-overflow/chest-overflow.js to the client, and adds
 * exact-string hooks in app/server/adventure.cjs (each must match exactly once, or the build stops):
 *   settleLocked() and adventure() compute the overflow window (chest-overflow.window, same locked transaction) and pass it to
 *   advance() as its optional 8th argument (combat-adventure.cjs applies the tier per defeat); the Adventure response gains
 *   `overflow` (chest-overflow.status; after a claim in the same request the timer has restarted, so no window is reported).
 * adventure.cjs is covered by its pinned hash; the client asset is a separate script (no index.html code hooks). */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const O = "require('./chest-overflow.cjs')";
const marker = '<!-- chest-overflow -->', script = '<script defer src="assets/chest-overflow/chest-overflow.js"></script>';
const POOL = 'Math.max(0,Number(income.n)-Number(used.n))';

// The window is computed just BEFORE the Creators Portal block (whose own hooks match the advance() lines exactly, so those lines
// stay untouched) and reaches advance() on the Chest data (data.overflowWindow, removed by advance before anything is saved).
const adventureHooks = [
  [" const cp=await require('./creators-portal.cjs').beginAdventure(store,c,wallet,profile,row?.data,active,null);",
   ' const overflow=await ' + O + '.window(store,c,wallet,row?.data,' + POOL + ");\n const cp=await require('./creators-portal.cjs').beginAdventure(store,c,wallet,profile,row?.data,active,null);"],
  ["  const cp=await require('./creators-portal.cjs').beginAdventure(store,c,wallet,profile,old,active,report);",
   '  const overflow=await ' + O + ".window(store,c,wallet,old,pool);\n  const cp=await require('./creators-portal.cjs').beginAdventure(store,c,wallet,profile,old,active,report);"],
  ['nextRateAt:rate<100?(Math.floor(pool/REWARD_POOL_STEP)+1)*REWARD_POOL_STEP:null};',
   'nextRateAt:rate<100?(Math.floor(pool/REWARD_POOL_STEP)+1)*REWARD_POOL_STEP:null,overflow:' + O + '.status(d,credited?' + O + '.CLAIMED:overflow,store.now())};'],
];

function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1 && !text.split(after).join('').includes(before)) return text; // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Chest overflow patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}

function applyChestOverflow(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'chest-overflow'), server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(server, 'chest-overflow.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Chest Overflow v1')) fs.appendFileSync(schema, '\n-- Chest Overflow v1 (apply-chest-overflow.cjs). Additive; existing data untouched.\n' + require('./chest-overflow/server.cjs').SCHEMA + '\n');
  const file = path.join(server, 'adventure.cjs');
  fs.writeFileSync(file, adventureHooks.reduce((t, h, i) => replaceOnce(t, h, 'adventure ' + i), fs.readFileSync(file, 'utf8')));
  const assets = path.join(appDir, 'public/assets/chest-overflow');
  fs.rmSync(assets, { recursive: true, force: true }); fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(path.join(src, 'chest-overflow.js'), path.join(assets, 'chest-overflow.js'));
  const index = path.join(appDir, 'public/index.html');
  let html = fs.readFileSync(index, 'utf8');
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Chest overflow: expected one </head>.');
    html = html.replace('</head>', marker + '\n' + script + '\n</head>');
    fs.writeFileSync(index, html);
  }
  console.log('Chest Overflow applied: from a 500,000 Ryo Chest, new enemy rewards -10/-20/-30% once the claim is available + 12 h grace.');
}
module.exports = { applyChestOverflow, adventureHooks, marker, script };
if (require.main === module) applyChestOverflow();
