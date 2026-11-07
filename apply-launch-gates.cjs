/* Launch gates build step (after apply-referral-bound, before apply-network): copies launch-gates/server.cjs
 * to app/server/launch-gates.cjs, checks each authenticated action against its gate before the pause guard,
 * publishes the gates in `config`, and refuses a client deposit before the wallet is asked to sign when
 * deposits are closed. Exact-string hooks; preservation reverses gateClientPatches and the service hooks
 * are covered by the maintained baseline hash. */
'use strict';
const fs = require('node:fs'), path = require('node:path');

const serviceHooks = [
  ["await require('./economic-dashboard.cjs').guard(store,action,wallet,body);", "require('./launch-gates.cjs').check(action,body);await require('./economic-dashboard.cjs').guard(store,action,wallet,body);", 1],
  ['tokenPurchases:true,', "tokenPurchases:true,launchGates:require('./launch-gates.cjs').publicGates(),", 1],
];
const gateClientPatches = [
  ['async function deposit(amount){return run(async()=>{current();', "async function deposit(amount){return run(async()=>{if(configuration?.launchGates?.solDeposits===false)throw Error('Deposits are not open yet.');current();", 1],
];

function replaceCount(text, [before, after, count = 1], label) {
  if (text.split(after).length - 1 === count && (!text.includes(before) || after.includes(before))) return text;
  const n = text.split(before).length - 1; if (n !== count) throw Error('Launch gate patch mismatch: ' + label + ' (' + n + ')');
  return text.split(before).join(after);
}
function applyLaunchGates(appDir = path.join(__dirname, 'app')) {
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(__dirname, 'launch-gates/server.cjs'), path.join(server, 'launch-gates.cjs'));
  const service = path.join(server, 'service.cjs');
  fs.writeFileSync(service, serviceHooks.reduce((t, h, i) => replaceCount(t, h, 'service ' + i), fs.readFileSync(service, 'utf8')));
  const index = path.join(appDir, 'public/index.html');
  fs.writeFileSync(index, gateClientPatches.reduce((t, h, i) => replaceCount(t, h, 'client ' + i), fs.readFileSync(index, 'utf8')));
  console.log('Launch gates: summoning, Market, reward claims, deposits and withdrawals each switchable (Mainnet default off).');
}
module.exports = { applyLaunchGates, serviceHooks, gateClientPatches };
if (require.main === module) applyLaunchGates();
