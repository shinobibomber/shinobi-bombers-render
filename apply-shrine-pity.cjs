/* Summoning Shrine Legend hard pity build step (after apply-chest-spending, before apply-live-economy; see unpack.cjs).
 * Owner request 2026-11-11. Copies shrine-pity/server.cjs to app/server/shrine-pity.cjs and adds exact-string hooks (each must
 * match exactly once, or the build stops):
 *   economy.cjs  fulfill() takes an options argument; ONLY with options.shrinePity the summon branch rolls through shrine-pity
 *                (hard pity 150, counter in the profile, result.pity); every other caller is byte-for-byte the old roll.
 *   store.cjs    the paid Shrine purchase passes { shrinePity: true } for product 'summon' unless paid with free starter Ryo.
 *   index.html   the client hero keeps the server's 'guaranteed' flag (reveal "Pity Guarantee!" tag).
 * economy.cjs / store.cjs are covered by their pinned hashes; tests/preservation.cjs reverses the client hook. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const P = "require('./shrine-pity.cjs')";
const ROLL = "roll<6000?0:roll<8500?1:roll<9500?2:roll<9900?3:4";

const economyHooks = [
  ['function fulfill(profile,q,now=Date.now()){const next=normalizeProfile(structuredClone(profile)),outputs=[];',
   'function fulfill(profile,q,now=Date.now(),options={}){const next=normalizeProfile(structuredClone(profile)),outputs=[];let shrinePity=null;'],
  ["if(q.product==='summon'){for(let i=0;i<q.params.quantity;i++){const roll=crypto.randomInt(10000),rank=" + ROLL + ";outputs.push(hero(rank))}next.heroes.push(...outputs)}",
   "if(q.product==='summon'){if(options&&options.shrinePity===true){const r=" + P + ".roll(next,q.params.quantity,()=>{const roll=crypto.randomInt(10000);return " + ROLL + "},hero);outputs.push(...r.heroes);next.shrineLegendPity=r.summary.after;shrinePity=r.summary}else for(let i=0;i<q.params.quantity;i++){const roll=crypto.randomInt(10000),rank=" + ROLL + ";outputs.push(hero(rank))}next.heroes.push(...outputs)}"],
  ['return {profile:next,result:{product:q.product,title:q.title,outputs,',
   'return {profile:next,result:{product:q.product,title:q.title,outputs,...(shrinePity?{pity:shrinePity}:{}),'],
];
const storeHooks = [
  ['const fulfillment=economy.fulfill(profile,q,this.now()),',
   "const fulfillment=economy.fulfill(profile,q,this.now(),{shrinePity:product==='summon'&&!bonusPaid}),"],
];
const clientHooks = [
  ['h.referralBound=descriptor.referralReward===true;',
   "h.referralBound=descriptor.referralReward===true;h.shrinePity=descriptor.shrinePity==='guaranteed'?'guaranteed':undefined;"],
];

function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1 && !text.split(after).join('').includes(before)) return text; // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Shrine pity patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}
const patch = (file, hooks, label) => fs.writeFileSync(file, hooks.reduce((t, h, i) => replaceOnce(t, h, label + ' ' + i), fs.readFileSync(file, 'utf8')));

function applyShrinePity(appDir = path.join(__dirname, 'app')) {
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(__dirname, 'shrine-pity/server.cjs'), path.join(server, 'shrine-pity.cjs'));
  patch(path.join(server, 'economy.cjs'), economyHooks, 'economy');
  patch(path.join(server, 'store.cjs'), storeHooks, 'store');
  patch(path.join(appDir, 'public/index.html'), clientHooks, 'client');
  console.log('Shrine Legend pity applied: a Legend by the 150th paid Shrine summon in a row (balance or Chest), Shrine only.');
}
module.exports = { applyShrinePity, economyHooks, storeHooks, clientHooks };
if (require.main === module) applyShrinePity();
