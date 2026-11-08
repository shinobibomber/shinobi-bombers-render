'use strict';
const assert=require('node:assert/strict'),E=require('../app/server/economy.cjs'),R=require('../app/server/combat-rules.cjs');
for(let rank=0;rank<6;rank++){
 const old={tokenId:'permanent-'+rank,rank,level:4,trainingVersion:2,identityVersion:1,name:'Keep identity',look:3,baseStats:{pw:rank===5?15:3,sp:rank===5?16:3,st:rank===5?18:3},bonus:{pw:1,sp:1,st:1},perks:[6,2,0,3,4,5].slice(0,rank+1),...(rank===5?{nft:{mint:'same-nft'}}:{})};
 const p=E.normalizeProfile({heroes:[structuredClone(old)],battleReady:[old.tokenId]}),h=p.heroes[0];
 assert.equal(h.perks.length,R.COUNTS[rank]);assert.equal(new Set(h.perks).size,h.perks.length);assert.deepEqual(h.perks.slice(0,old.perks.length),old.perks);
 assert.equal(h.level,4);assert.equal(h.look,3);assert.equal(h.name,old.name);assert.deepEqual(h.bonus,old.bonus);assert.deepEqual(h.nft,old.nft);
 if(rank===5){assert.deepEqual(h.perks.slice().sort(),[0,1,2,3,4,5,6]);assert.equal(h.baseStats.st,18);assert(Object.values(h.baseStats).every(n=>n>=17&&n<=20));}
 assert.deepEqual(E.normalizeProfile(structuredClone(p)),p,'migration never rerolls again');
 const restored=JSON.parse(JSON.stringify(h));assert.deepEqual(E.normalizeProfile({heroes:[restored],battleReady:[]}).heroes[0],h,'serialization/account transfer preserves identity');
 for(let i=0;i<20;i++){const fresh=E.hero(rank);assert.equal(fresh.perks.length,R.COUNTS[rank]);assert.equal(new Set(fresh.perks).size,fresh.perks.length);if(rank===5)assert(Object.values(fresh.baseStats).every(n=>n>=17&&n<=20));}
}
const invalid=E.normalizeProfile({heroes:[{tokenId:'repair',rank:4,perks:[6,6,-1,2,99],level:1,look:4}],battleReady:[]}).heroes[0];
assert.deepEqual(invalid.perks.slice(0,2),[6,2]);assert.equal(new Set(invalid.perks).size,5);
console.log('PASS: six rank allocations, Mythic seven-perk migration and 17–20 stats, stable valid identities/training/NFT metadata, serialization and unique new rolls.');
