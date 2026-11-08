/* Cosmetic selection only. A caller must first execute the native authorized attack.
 * This module has no combat, wallet, network or reward dependency. Its persisted state is
 * presentation state, never evidence for server damage, chakra, cooldowns or settlement. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MythicAutomaticSkills=factory()})(globalThis,function(){
  'use strict';
  const definitions=Object.freeze({
    dragon_slash:Object.freeze({name:'Dragon Slash',state:'SKILL_DRAGON_SLASH',frames:8,trigger:'melee_attack',cosmeticOnRanged:true,cooldownMs:12000,gameplayEffect:false,icon:'☽'}),
    void_shuriken:Object.freeze({name:'Void Shuriken',state:'SKILL_VOID_SHURIKEN',frames:8,trigger:'ranged_attack',cooldownMs:18000,gameplayEffect:false,icon:'✧'}),
    raijin_field:Object.freeze({name:'Raijin Field',state:'SKILL_RAIJIN_FIELD',frames:10,trigger:'eligible_area_attack',cooldownMs:24000,gameplayEffect:false,icon:'ϟ'}),
    mythic_dragon_ascension:Object.freeze({name:'Mythic Dragon Ascension',state:'ULTIMATE_DRAGON_ASCENSION',frames:12,trigger:'ultimate_eligible',cooldownMs:30000,gameplayEffect:false,ultimate:true,icon:'♜'})
  });
  const order=Object.freeze([null,'dragon_slash',null,'void_shuriken',null,'raijin_field',null,'mythic_dragon_ascension']);
  function create({config={},read=()=>null,write=()=>{}}={}){
    const rules=Object.fromEntries(Object.entries(definitions).map(([id,d])=>{
      const c=config[id]||{},ms=Object.prototype.hasOwnProperty.call(c,'cooldownMs')?c.cooldownMs:d.cooldownMs;
      if(ms!==null&&(!Number.isFinite(ms)||ms<0||ms>86400000))throw Error('Invalid cosmetic skill cooldown');
      return [id,Object.freeze({...d,enabled:c.enabled!==false,cosmeticOnRanged:c.cosmeticOnRanged??d.cosmeticOnRanged,cooldownMs:ms})];
    }));
    Object.freeze(rules);
    const actors=new Map();
    function actor(e){
      const key=JSON.stringify([e.scope,e.heroId]);let r=actors.get(key);if(r)return r;
      let saved;try{saved=read(key)}catch{}
      r={position:0,total:0,lastTime:0,used:{},streams:{}};
      if(saved&&saved.version===2&&Number.isSafeInteger(saved.total)&&saved.total>=0){
        r.total=saved.total;r.position=saved.total%8;
        for(const id of Object.keys(definitions))if(Number.isFinite(saved.used?.[id])&&saved.used[id]>=0)r.used[id]=saved.used[id];
        if(Number.isFinite(saved.lastTime)&&saved.lastTime>=0)r.lastTime=saved.lastTime;
        for(const [key,v]of Object.entries(saved.streams||{}).slice(-8))if(key.length<=180&&Number.isSafeInteger(v?.ordinal)&&v.ordinal>0&&(v.choice===null||definitions[v.choice]))r.streams[key]={ordinal:v.ordinal,choice:v.choice};
      }
      if(actors.size>=128)actors.delete(actors.keys().next().value);actors.set(key,r);return r;
    }
    function select(e){
      if(!e||!e.scope||!e.heroId||!['adventure','hunt'].includes(e.mode)||!e.stream||!Number.isSafeInteger(e.ordinal)||e.ordinal<1||!Number.isFinite(e.now)||e.now<0||!e.eligible||!e.targetValid||!e.chakraSpent||!e.staminaEligible)return null;
      const r=actor(e),stream=e.mode+':'+e.stream,last=r.streams[stream];
      if(last&&e.ordinal<=last.ordinal)return e.ordinal===last.ordinal?last.choice:null;
      const time=Math.max(e.now,r.lastTime),desired=order[r.position];r.total++;r.position=r.total%8;r.lastTime=time;
      let choice=null;
      function available(id){const d=rules[id];return d.enabled&&(d.cooldownMs===null||r.used[id]==null||time-r.used[id]>=d.cooldownMs)&&
        (d.trigger!=='melee_attack'||e.melee===true||d.cosmeticOnRanged&&e.ranged===true)&&(d.trigger!=='ranged_attack'||e.ranged===true)&&
        (d.trigger!=='eligible_area_attack'||e.areaEligible===true)&&(d.trigger!=='ultimate_eligible'||r.total>=8&&e.ultimateEligible===true);}
      if(desired){
        // An unavailable skill never stalls an attack or changes other skills' clocks.
        const skills=Object.keys(definitions),start=skills.indexOf(desired);
        for(let n=0;n<skills.length;n++){const id=skills[(start+n)%skills.length];if(available(id)){choice=id;r.used[id]=time;break}}
      }
      r.streams[stream]={ordinal:e.ordinal,choice};
      const streams=Object.keys(r.streams);if(streams.length>8)delete r.streams[streams[0]];
      try{write(JSON.stringify([e.scope,e.heroId]),{version:2,total:r.total,lastTime:r.lastTime,used:{...r.used},streams:r.streams})}catch{}
      return choice;
    }
    return {select,rules,inspect:(scope,id)=>{const r=actors.get(JSON.stringify([scope,id]));return r?JSON.parse(JSON.stringify(r)):null},get size(){return actors.size}};
  }
  return Object.freeze({version:2,definitions,order,create});
});
