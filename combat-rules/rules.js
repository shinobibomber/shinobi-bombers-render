/* Shared combat contract: browser presentation and authoritative Node settlement. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CombatRules=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const VERSION=1,BANDS=[[1,3],[3,6],[6,9],[9,12],[12,15],[17,20]],COUNTS=[1,2,3,4,5,7],DOJO=[1,2,5,8,11,14,17];
 const PERKS=Object.freeze([
  ['Bounty Hunter','+3% server-verified Adventure Ryo; funded claim limits apply.'],
  ['Armor Breaker','Prioritizes guardians and high-HP targets; no extra damage.'],
  ['Wind Step','12% faster movement.'],
  ['Fast Charge','+0.5 chakra per minute while resting; adds to base and Dojo recovery.'],
  ['Chakra Saver','10% more maximum chakra; every attack still costs 1.'],
  ['Piercing Shuriken','+1 tile attack range; solid walls still block attacks.'],
  ['Swift Hands','8% shorter attack cooldown; each attack costs 1 chakra.']
 ].map((p,id)=>Object.freeze({id,name:p[0],description:p[1]})));
 const rank=h=>Math.max(0,Math.min(5,Number(h?.rank??h?.r)||0));
 const perkCount=r=>COUNTS[Math.max(0,Math.min(5,Number(r)||0))];
 function normalizePerks(r,existing,rand){
  const out=[...new Set(Array.isArray(existing)?existing.filter(i=>Number.isInteger(i)&&i>=0&&i<7):[])].slice(0,perkCount(r));
  const pool=PERKS.map(p=>p.id).filter(id=>!out.includes(id));
  while(out.length<perkCount(r)){const n=Math.max(0,Math.min(pool.length-1,Math.floor(rand(pool.length))||0));out.push(pool.splice(n,1)[0]);}return out;
 }
 const perks=h=>h?.perks||h?.pk||[],has=(h,id)=>perks(h).includes(id);
 function stat(h,k){const direct=h?.rank==null?Number(h?.[k]):0;if(direct)return Math.max(1,direct);const band=BANDS[rank(h)];return Math.max(1,Math.max(band[0],Math.min(band[1],Number(h?.baseStats?.[k])||band[0]))+(Number(h?.bonus?.[k])||0));}
 function stats(h){return {pw:stat(h,'pw'),sp:stat(h,'sp'),st:stat(h,'st')}}
 const damage=h=>stat(h,'pw');
 const cooldown=h=>Math.round(Math.max(.6,1.6-stat(h,'sp')*.05)*(has(h,6)?.92:1)*1e6)/1e6;
 const maxChakra=h=>Math.round(stat(h,'st')*50*(has(h,4)?1.1:1)*1000)/1000;
 const recovery=(h,dojo=0,resting=true)=>((resting?DOJO[Math.max(0,Math.min(6,dojo|0))]:1)+(resting&&has(h,3)?.5:0))/60;
 const movementMultiplier=h=>has(h,2)?1.12:1;
 const range=h=>(rank(h)===5?6:rank(h)+1)+(has(h,5)?1:0);
 const volley=h=>rank(h)===5?7:rank(h)+1;
 const rewardMultiplier=h=>has(h,0)?1.03:1;
 function consume(h){if(!Number.isFinite(h.en)||h.en<1)return false;h.en-=1;return true;}
 return Object.freeze({VERSION,BANDS,COUNTS,DOJO,PERKS,rank,perkCount,normalizePerks,perks,has,stats,damage,cooldown,maxChakra,recovery,movementMultiplier,range,volley,rewardMultiplier,consume});
});
