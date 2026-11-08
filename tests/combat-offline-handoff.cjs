'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const calls=[],timers=[],listeners={},hero={id:1,tokenId:'owned',tokenOwner:'owner',on:true,x:1},bombs=[{o:1}],context={CombatRules:{},S:{h:[hero]},bombs,performance:{now:()=>0},setInterval(){},setTimeout(resolve){timers.push(resolve);},addEventListener(name,fn){listeners[name]=fn;},BattleRoster:{eligible:()=>true,list:()=>[hero]},ShinobiSprites:{ready:new Promise(()=>{})},RyoPayments:{state:{account:'owner',authenticated:true},adventure:async active=>{calls.push(active);return{};}}};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../app/public/assets/combat-rules/client.js'),'utf8'),context);
 const task=context.CombatClient.beginOffline();await Promise.resolve();assert(context.CombatClient.leaving);assert(!context.CombatClient.canAttack(hero),'draining never permits another shot');assert.equal(timers.length,1);
 await context.RyoPayments.adventure(true,false);assert.equal(calls.at(-1),true,'automatic defeat refresh remains online while a projectile is in flight');
 await context.RyoPayments.adventure(false,false);assert.equal(calls.at(-1),false,'explicit pagehide remains offline');
 bombs.length=0;timers.shift()();await task;await context.RyoPayments.adventure(true,false);assert.equal(calls.at(-1),false,'after drain every later refresh stays offline');
 context.CombatClient.cancelOffline();await context.RyoPayments.adventure(true,false);assert.equal(calls.at(-1),true,'failed handoff can resume online safely');
 context.RyoPayments.state.account='new-owner';context.CombatClient.payload();assert.equal(context.CombatClient.leaving,false,'wallet change clears the old handoff state');
 console.log('PASS: offline handoff stops new attacks immediately, keeps automatic in-flight-hit reports online until drained, honors explicit close, then forces offline; cancellation and wallet changes reset safely.');
})().catch(e=>{console.error(e);process.exitCode=1});
