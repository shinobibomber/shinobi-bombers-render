/* Upgrade Shards v1: account-bound game items, never tokens or NFTs. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HeroUpgradeRules=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const VERSION=1,SHARDS=Object.freeze([1,2,3,4,5,7]),RANKS=Object.freeze(['Genin','Chunin','Jonin','Elite','Legend','Mythic']);
 const shards=rank=>SHARDS[rank]||0;
 const trainingPrice=(rank,level)=>Math.round(([10000,20000,40000,80000][level-1]||0)*([1,1.5,2,2.5,3,6][rank]||0));
 function normalize(profile){if(!Number.isSafeInteger(profile.upgradeShards)||profile.upgradeShards<0)profile.upgradeShards=0;return profile;}
 return Object.freeze({VERSION,SHARDS,RANKS,shards,trainingPrice,normalize});
});
