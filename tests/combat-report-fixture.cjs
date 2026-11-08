/* Test driver for real server-authorized cumulative attack reports. No fabricated reward amounts. */
'use strict';
const R=require('../app/server/combat-rules.cjs');
async function driver(store,wallet,clock){
 const profile=await store.profile(wallet),start=clock(),heroes=profile.heroes.filter(h=>profile.battleReady.includes(h.tokenId)).slice(0,10),session='fixture-'+require('node:crypto').randomUUID();
 return ()=>({combatVersion:1,killSession:session,killStage:1,deployed:heroes.map(h=>h.tokenId),combatHeroes:heroes.map(h=>{const attacks=Math.min(Math.floor(h.chakra?.value??R.maxChakra(h)),Math.max(0,Math.floor((clock()-start)/(R.cooldown(h)*1000))));return {id:h.tokenId,attacks,kills:[Math.floor(attacks/Math.ceil(100/R.damage(h))),0,0,0,0]}})});
}
module.exports={driver};
