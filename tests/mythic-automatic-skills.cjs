'use strict';
const assert=require('node:assert/strict'),{create,definitions,order}=require('../mythic-hero/automatic-skills.js');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),preserved=require('../mythic-hero/preservation-v2.json');
for(const file of [...preserved.assets,preserved.latestReference])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file.path))).digest('hex'),file.sha256,'approved identity/aura/reference unchanged: '+file.path);
const zero=Object.fromEntries(Object.keys(definitions).map(id=>[id,{cooldownMs:0}]));
const store=new Map(),c=create({config:zero,read:k=>store.get(k),write:(k,v)=>store.set(k,structuredClone(v))});
const base={scope:'devnet:wallet-a',heroId:'nft-1',mode:'adventure',stream:'page-one',eligible:true,targetValid:true,chakraSpent:true,staminaEligible:true,melee:true,ranged:true,areaEligible:true,ultimateEligible:true};
const event=(n,extra={})=>({...base,ordinal:n,now:n*600,...extra});
assert.equal(Object.keys(definitions).length,4);assert(Object.values(definitions).every(d=>d.gameplayEffect===false));assert.deepEqual(Object.values(definitions).map(d=>d.cooldownMs),[12000,18000,24000,30000]);
for(let n=1;n<=24;n++){
 const choice=c.select(event(n));assert.equal(choice,order[(n-1)%8]);
 for(let copy=0;copy<7;copy++)assert.equal(c.select(event(n)),choice);
}
assert.equal(c.inspect(base.scope,base.heroId).total,24);assert.equal(c.select(event(1)),null,'old replay rejected');
const independent=create({config:Object.fromEntries(Object.keys(definitions).map(id=>[id,{cooldownMs:10000}]))});
for(let n=1;n<=8;n++)assert.equal(independent.select(event(n)),order[n-1]);
const clocks=independent.inspect(base.scope,base.heroId).used;assert.equal(new Set(Object.values(clocks)).size,4);
independent.select(event(9));assert.equal(independent.select(event(10)),null,'all independent cooldowns block this skill slot');assert.deepEqual(independent.inspect(base.scope,base.heroId).used,clocks);
independent.select(event(11));assert.equal(independent.select(event(12,{now:12000})),'dragon_slash');assert.deepEqual(independent.inspect(base.scope,base.heroId).used,{...clocks,dragon_slash:12000},'fallback updates only the selected skill cooldown');
const restored=create({config:zero,read:k=>store.get(k),write:(k,v)=>store.set(k,structuredClone(v))});
assert.equal(restored.select(event(24)),order[7],'reconnect returns original choice');assert.equal(restored.inspect(base.scope,base.heroId).total,24);
assert.equal(restored.select(event(25,{stream:'page-two'})),null,'new page keeps hero rotation');
assert.equal(restored.select(event(1,{heroId:'nft-2'})),null,'independent hero starts at basic');
assert.equal(restored.select(event(1,{scope:'devnet:wallet-b'})),null,'wallet state isolated');
const cooldown=create({config:{dragon_slash:{cooldownMs:20000},void_shuriken:{enabled:false},raijin_field:{enabled:false},mythic_dragon_ascension:{enabled:false}}});
assert.equal(cooldown.select(event(1)),null);assert.equal(cooldown.select(event(2)),'dragon_slash');
for(let n=3;n<=16;n++)assert.equal(cooldown.select(event(n)),null,'ineligible cooldown falls back to basic');
assert.equal(cooldown.select(event(17)),null);assert.equal(cooldown.select(event(18,{now:25000})),'dragon_slash');
assert.equal(cooldown.inspect(base.scope,base.heroId).used.dragon_slash,25000);assert.equal(cooldown.inspect(base.scope,base.heroId).used.void_shuriken,undefined);
for(const mode of ['adventure','hunt'])for(const melee of [true,false]){
 const rotation=create({config:zero});for(let n=1;n<=24;n++)assert.equal(rotation.select(event(n,{mode,melee,ranged:!melee,areaEligible:false})),order[(n-1)%8],mode+' all four skills on '+(melee?'melee':'ranged')+' without area damage');
 const timed=create(),seen=new Set();for(let n=1;n<=240;n++){const id=timed.select(event(n,{mode,melee,ranged:!melee,now:n*1000}));if(id)seen.add(id)}assert.equal(seen.size,4,'all four eligible with real cooldowns');
}
// A cooldown wait preserves the next preference; reload preserves both cursor and clocks.
const fairStore=new Map(),fair=create({read:k=>fairStore.get(k),write:(k,v)=>fairStore.set(k,structuredClone(v))});for(let n=1;n<=8;n++)fair.select(event(n));for(let n=9;n<=16;n++)fair.select(event(n));assert.equal(fair.inspect(base.scope,base.heroId).nextSkill,0);fair.select(event(17));assert.equal(fair.select(event(18,{now:50000})),'dragon_slash');const fairReload=create({read:k=>fairStore.get(k)});fairReload.select(event(19,{now:51000}));assert.equal(fairReload.select(event(20,{now:52000})),'void_shuriken');
const legacy={version:2,total:8,lastTime:4800,used:{dragon_slash:1200,void_shuriken:2400,raijin_field:3600,mythic_dragon_ascension:4800},streams:{'adventure:page-one':{ordinal:8,choice:'mythic_dragon_ascension'}}};const migrated=create({read:()=>legacy});assert.equal(migrated.select(event(8)),'mythic_dragon_ascension');assert.deepEqual(migrated.inspect(base.scope,base.heroId).used,legacy.used);assert.equal(migrated.inspect(base.scope,base.heroId).nextSkill,0);
const empty=create();for(const key of ['eligible','targetValid','chakraSpent','staminaEligible'])assert.equal(empty.select(event(1,{[key]:false})),null);assert.equal(empty.size,0,'ineligible events do not advance state');
for(let n=0;n<1000;n++)empty.select(event(1,{heroId:'bounded-'+n}));assert.equal(empty.size,128);
const unavailable=create({config:Object.fromEntries(Object.keys(definitions).map(id=>[id,{enabled:false}]))});for(let n=1;n<=16;n++)assert.equal(unavailable.select(event(n)),null);
assert.throws(()=>create({config:{dragon_slash:{cooldownMs:-1}}}));
console.log('PASS: independent skills, preferred 8-action rotation, eligibility/fallback, independent cooldowns, immutable defaults, wallet/hero scope, replay/draw deduplication, reconnect restoration and bounded presentation state.');
