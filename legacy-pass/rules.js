/* Shared presentation rules. Only the server may create progress, items or heroes. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LegacyPassRules=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const DAY=86400000,WEEK=7*DAY,ODDS=Object.freeze({Elite:70,Legend:30}),MILESTONES=[20,40,60,80,100];
 const MISSIONS=Object.freeze([
  {id:'kills',name:'Shadow Hunter',target:30,detail:'Defeat 30 server-verified Adventure enemies.'},
  {id:'stages',name:'Village Defender',target:5,detail:'Complete 5 server-verified Adventure stages.'},
  {id:'recovery',name:'Chakra Discipline',target:60,detail:'Recover 60 chakra through valid natural recovery.'},
  {id:'command',name:'Shinobi Commander',target:3,detail:'Attack in Adventure with 3 different owned heroes.'},
  {id:'attacks',name:'Precision Assault',target:50,detail:'Perform 50 verified Adventure attacks.'},
  {id:'guardian',name:'Guardian Challenge',target:10,detail:'Complete 10 verified stages OR finish 1 full verified Boss Hunt.'}
 ]);
 function week(now){const start=Math.floor((now-345600000)/WEEK)*WEEK+345600000;return{id:new Date(start).toISOString().slice(0,10),start,reset:start+WEEK};}
 function normalize(p={}){return{kills:Math.max(0,Math.min(30,Number(p.kills)||0)),stages:Math.max(0,Math.min(10,Number(p.stages)||0)),recovery:Math.max(0,Math.min(60,Number(p.recovery)||0)),attacks:Math.max(0,Math.min(50,Number(p.attacks)||0)),heroes:[...new Set((p.heroes||[]).filter(id=>typeof id==='string'))].slice(0,3),hunts:Math.max(0,Math.min(1,Number(p.hunts)||0))};}
 function missions(p){p=normalize(p);return MISSIONS.map(m=>{const value=m.id==='command'?p.heroes.length:m.id==='guardian'?(p.hunts?10:p.stages):p[m.id];return{...m,value:Math.min(m.target,value),done:value>=m.target,xp:20,...(m.id==='guardian'?{hunts:p.hunts}: {})}});}
 function xp(p){return Math.min(100,missions(p).filter(m=>m.done).length*20);}
 function premiumRank(roll){if(!Number.isInteger(roll)||roll<0||roll>=10000)throw Error('Invalid server random draw');return roll<7000?3:4;}
 function reward(xp){return xp===20?{kind:'shards',quantity:1}:xp===40?{kind:'ticket',quantity:1}:xp===60?{kind:'voucher',quantity:1}:xp===80?{kind:'shards',quantity:2}:xp===100?{kind:'fragment',quantity:1}:null;}
 return{VERSION:1,DAY,WEEK,ODDS,MILESTONES,MISSIONS,week,normalize,missions,xp,premiumRank,reward,FRAGMENTS:2,ITEM_CAP:4,EXPIRY:14*DAY};
});
