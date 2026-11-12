/* Referral-bound heroes (after apply-creators-portal): heroes from player referral rewards are permanently
 * account-bound. market/server.cjs refuses to list them. These hooks keep the binding through fusion
 * (a fused hero is bound when any hero of its group of three was) and tell the client which heroes are
 * bound so it can show the lock. Exact-string hooks; preservation reverses boundClientPatches and the
 * economy hook is covered by the maintained baseline hash. */
'use strict';
const fs = require('node:fs'), path = require('node:path');

// Owner decision 2026-11-12: every account-bound hero stays off the Market, also after Fusion. A hero fused from a group
// holding any account-bound hero (Founder, Creator, Starter Pack, rescue, promo, staff, or already fused-bound) is
// marketBound. Gameplay is unchanged; only market/server.cjs reads it (its BOUND_FLAGS include marketBound).
const MARKET_BOUND_FUSION = "if(q.params.heroIds.slice(i*3,i*3+3).some(id=>{const b=next.heroes.find(h=>h.tokenId===id);return !!b&&['marketBound','starterGrant','starter','creatorReward','prisonRescue','staffGrant','promoPass','promoReward','founderGrant','founderSummon','founderBound','founder'].some(f=>b[f]!==undefined&&b[f]!==null&&b[f]!==false)}))fused.marketBound=true;";
const economyHooks = [
  ['for(let i=0;i<consumed.size/3;i++)if(!q.fusion||crypto.randomInt(100)<q.fusion.successPercent)outputs.push(hero(rank+1));',
   'for(let i=0;i<consumed.size/3;i++)if(!q.fusion||crypto.randomInt(100)<q.fusion.successPercent){const fused=hero(rank+1);if(q.params.heroIds.slice(i*3,i*3+3).some(id=>next.heroes.find(h=>h.tokenId===id)?.referralReward===true))fused.referralReward=true;' + MARKET_BOUND_FUSION + 'outputs.push(fused)}', 1],
];
const boundClientPatches = [
  ['h.nft=descriptor.nft||null;h.starter=descriptor.starter===true;', 'h.nft=descriptor.nft||null;h.starter=descriptor.starter===true;h.referralBound=descriptor.referralReward===true;', 1],
];

function replaceCount(text, [before, after, count = 1], label) {
  if (text.split(after).length - 1 === count && (!text.includes(before) || after.includes(before))) return text;
  const n = text.split(before).length - 1; if (n !== count) throw Error('Referral-bound patch mismatch: ' + label + ' (' + n + ')');
  return text.split(before).join(after);
}
function applyReferralBound(appDir = path.join(__dirname, 'app')) {
  const economy = path.join(appDir, 'server/economy.cjs');
  fs.writeFileSync(economy, economyHooks.reduce((t, h, i) => replaceCount(t, h, 'economy ' + i), fs.readFileSync(economy, 'utf8')));
  const index = path.join(appDir, 'public/index.html');
  fs.writeFileSync(index, boundClientPatches.reduce((t, h, i) => replaceCount(t, h, 'client ' + i), fs.readFileSync(index, 'utf8')));
  console.log('Referral-bound heroes: no Market listing; fusion keeps the binding.');
}
module.exports = { applyReferralBound, economyHooks, boundClientPatches };
if (require.main === module) applyReferralBound();
