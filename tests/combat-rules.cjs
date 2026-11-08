'use strict';
const assert=require('node:assert/strict'),R=require('../combat-rules/rules.js');
const fs=require('node:fs'),html=fs.readFileSync(require('node:path').join(__dirname,'../app/public/index.html'),'utf8');
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())assert.doesNotThrow(()=>new Function(m[1]),'generated native script must parse');
for(const m of html.matchAll(/<script\b[^>]*src="(assets\/[^\"]+\.js)"/gi))assert.doesNotThrow(()=>new Function(fs.readFileSync(require('node:path').join(__dirname,'../app/public',m[1]),'utf8')),'external generated script must parse: '+m[1]);
assert.equal(R.PERKS.length,7);assert.deepEqual(R.PERKS.map(p=>p.id),[0,1,2,3,4,5,6]);
for(let rank=0;rank<6;rank++){
 const pk=R.normalizePerks(rank,[6,6,99],()=>0);assert.equal(pk.length,[1,2,3,4,5,7][rank]);assert.equal(new Set(pk).size,pk.length);assert.equal(pk[0],6);
 const h={rank,perks:pk,baseStats:{pw:18,sp:18,st:18},bonus:{pw:5,sp:0,st:0},en:2};
 assert.equal(R.damage(h),Math.max(R.BANDS[rank][0],Math.min(R.BANDS[rank][1],18))+5);assert(R.consume(h));assert(R.consume(h));assert.equal(h.en,0);assert(!R.consume(h));assert.equal(h.en,0);
}
const h={rank:5,perks:[0,1,2,3,4,5,6],baseStats:{pw:20,sp:20,st:20}};
assert.equal(R.damage(h),20);assert.equal(R.cooldown(h),.6*.92);assert.equal(R.maxChakra(h),1100);assert.equal(R.range(h),7);assert.equal(R.volley(h),7);assert.equal(R.movementMultiplier(h),1.12);assert.equal(R.recovery(h,6),17.5/60);assert.equal(R.rewardMultiplier(h),1.03);
assert.equal(R.range({...h,perks:[]}),6);assert.equal(R.damage({...h,perks:[]}),20);
console.log('PASS: shared seven-perk contract, unique allocations, trained Power, one-chakra attacks, exact passive formulas. Integration validation still required.');
