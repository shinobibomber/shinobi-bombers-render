/* Purchase settlement without lost updates — build step (after apply-starter-activation, before apply-live-economy; see
 * unpack.cjs). Owner request 2026-11-11. Copies purchase-delta/server.cjs to app/server/purchase-delta.cjs, appends the additive
 * column (ryo_purchases.profile_delta) and adds exact-string hooks in store.cjs (each must match exactly once):
 *   purchase  records the change the purchase makes (profile_delta) next to profile_after;
 *   settle    a confirmed purchase with a recorded change applies it to the CURRENT profile instead of writing back the
 *             purchase-time profile; the existing Upgrade/Fusion Shard settlement and chakra handling then run as before.
 * Market purchases record it in market/server.cjs. store.cjs is pinned. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const D = "require('./purchase-delta.cjs')";
const storeHooks = [
  ["'INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[this.scope,wallet,id,product,JSON.stringify(params),JSON.stringify(q),JSON.stringify(fulfillment.result),JSON.stringify(fulfillment.profile),q.total,tx.signature,tx.wire,tx.lastHeight,this.now()]",
   "'INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,created,profile_delta) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',[this.scope,wallet,id,product,JSON.stringify(params),JSON.stringify(q),JSON.stringify(fulfillment.result),JSON.stringify(fulfillment.profile),q.total,tx.signature,tx.wire,tx.lastHeight,this.now(),JSON.stringify(" + D + ".delta(profile,fulfillment.profile))]"],
  ['const current=await this.profileLocked(c,wallet);row.profile_after.upgradeShards=',
   'const current=await this.profileLocked(c,wallet);if(row.profile_delta)row.profile_after=' + D + '.apply(current,row.profile_delta);row.profile_after.upgradeShards='],
];
function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1 && !text.split(after).join('').includes(before)) return text; // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Purchase delta patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}
function applyPurchaseDelta(appDir = path.join(__dirname, 'app')) {
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(__dirname, 'purchase-delta/server.cjs'), path.join(server, 'purchase-delta.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Purchase delta v1')) fs.appendFileSync(schema, '\n-- Purchase delta v1 (apply-purchase-delta.cjs). Additive; existing data untouched.\n' + require('./purchase-delta/server.cjs').SCHEMA + '\n');
  const store = path.join(server, 'store.cjs');
  fs.writeFileSync(store, storeHooks.reduce((t, h, i) => replaceOnce(t, h, 'store ' + i), fs.readFileSync(store, 'utf8')));
  console.log('Purchase delta applied: confirmed purchases apply their own change to the current profile (no lost updates).');
}
module.exports = { applyPurchaseDelta, storeHooks };
if (require.main === module) applyPurchaseDelta();
