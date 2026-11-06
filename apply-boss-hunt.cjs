/* Boss Hunt daily rankings build step: copies boss-hunt/server.cjs to app/server/boss-hunt.cjs, adds
 * its tables, wires the paid entry / damage report / board actions and daily settlement into the
 * game server, and turns the game's local Boss Hunt into a 60-second, no-chakra damage run that
 * needs a paid entry. Exact-string hooks; tests/preservation.cjs reverses bossHuntPatches. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const economyHook = ["function quote(profile,product,params={}){\r\n normalizeProfile(profile);", "function quote(profile,product,params={}){\r\n normalizeProfile(profile);if(product==='hunt')return require('./boss-hunt.cjs').quote(VERSION);"];
const serviceHooks = [
  ["  if(action==='market-buy'){", "  if(action==='hunt-enter'){await checkMint();const id=requestId(body.requestId),hunt=require('./boss-hunt.cjs');await hunt.beforeEnter(store,wallet);const row=await store.purchase(wallet,id,'hunt',{},hunt.FEE,async q=>{\n    const available=await connection.getTokenAccountBalance(treasuryAta,'finalized');if(BigInt(available.value.amount)<BigInt(q.burn+q.treasury)*UNIT)fail('Custody tokens are temporarily unavailable.',503);\n    return signedTransaction([...(q.treasury>0?transferTo(revenueAddress,BigInt(q.treasury)*UNIT):[]),spl.createBurnCheckedInstruction(treasuryAta,key(mint),treasury.publicKey,BigInt(q.burn)*UNIT,6),memo('shinobi-hunt-v1:'+id)]);\n   });const entry=await hunt.record(store,wallet,row,body);await progress(row,'purchase');return {entry,...await hunt.board(store,wallet),...await state(wallet)}}\n  if(action==='hunt-report')return require('./boss-hunt.cjs').report(store,wallet,body);\n  if(action==='hunt-board')return require('./boss-hunt.cjs').board(store,wallet);\n  if(action==='market-buy'){"],
  ["async function state(wallet){await checkNetwork();", "async function state(wallet){await checkNetwork();await require('./boss-hunt.cjs').settleDue(store);await require('./boss-hunt.cjs').grantWaiting(store,wallet);"]
];
// Game client: the API and the paid, no-chakra damage run. Exported so preservation can reverse them.
const TEAM_BEFORE = 'BattleRoster.list().filter(h=>h.on&&h.en>=1).sort((a,c)=>c.pw-a.pw).slice(0,5)', TEAM_AFTER = 'BattleRoster.list().slice().sort((a,c)=>c.pw-a.pw).slice(0,5)';
const bossHuntPatches = [
  ["window.RyoPayments={market:", "window.RyoPayments={hunt:(action,body={})=>{if(!['hunt-board','hunt-enter','hunt-report'].includes(action))throw Error('Unknown Boss Hunt action.');return action==='hunt-enter'?run(async()=>{const data=await api(action,body);accept(data);return data}):api(action,body)},market:", 1],
  // The hunt team: the 5 strongest battle-ready heroes; no deployment or chakra needed.
  [TEAM_BEFORE, TEAM_AFTER, 3],
  ["  if(!team.length)return toast('Deploy a rested hero first');\r\n  const stage=init().bestBoss+1,max=GameBalance.huntHP(stage);\r\n  boss={id:++huntSerial,stage,hp:max,max,time:90,",
   "  if(!team.length)return toast('Make a hero battle-ready first');\r\n  const entry=window.BossHunt?.takeEntry();if(!entry)return toast('Pay the entrance fee on the Boss Hunt screen to start.');\r\n  const stage=entry.guardian+1,max=1e12;\r\n  boss={id:++huntSerial,entry,stage,hp:max,max,time:60,", 1],
  ["toast('Hunt '+stage+' started · Adventure continues')", "toast('Boss Hunt started · deal all the damage you can in 60 seconds')", 1],
  // No local rewards: damage goes to the server's daily ranking.
  ["  if(result==='victory'){\r\n   const v=init();if(done.stage>v.bestBoss){v.bestBoss=done.stage;done.reward=GameBalance.huntReward(done.stage);reward(done.reward);count('ryo',done.reward);count('bosses');if(done.stage%5===0)S.h.push(mk(1,false));}\r\n   logs=['Guardian defeated! +'+done.reward.toLocaleString()+' Ryo'+(done.stage%5===0?' · Chunin hero joined your collection.':'.')];\r\n  }else logs=[result==='retreat'?'Your team retreated. Chakra spent is not refunded.':'Time expired. Recover chakra in the Dojo and try again.'];\r\n  done.projectiles=[];lastHunt=done;save();hud();toast(logs[0]);",
   "  logs=[(result==='retreat'?'Hunt ended early':'Time up')+' · '+Math.round(done.damage).toLocaleString()+' damage dealt.'];\r\n  done.projectiles=[];lastHunt=done;save();hud();toast(logs[0]);window.BossHunt?.ended(done);", 1],
  // Every volley fires; nothing spends chakra (shockwaves stay visual).
  ["unit.cd-=dt;if(!h||h.en<1||unit.cd>0)continue;", "unit.cd-=dt;if(!h||unit.cd>0)continue;", 1],
  ["const count=Math.min(h.bm,Math.floor(h.en));", "const count=h.bm;", 1],
  ["h.en=Math.max(0,h.en-count);unit.cd=GameBalance.cooldown(h);", "unit.cd=GameBalance.cooldown(h);", 1],
  ["   for(const unit of state.team){const h=S.h.find(h=>h.id===unit.id);if(h)h.en=Math.max(0,h.en-drain)}\r\n   state.events.unshift('Guardian shockwave · '+drain+' chakra drained per hero.');",
   "   state.events.unshift('Guardian shockwave!');", 1],
  // Before a hunt, the arena shows today's guardian.
  ["stage=b?.stage||S.v2.bestBoss+1;\n  const sky=c", "stage=b?.stage||(window.BossHunt?.guardian()??S.v2.bestBoss)+1;\n  const sky=c", 1],
  // Heroes stand on the arena floor (the floor starts at y 220), in two columns.
  ["const position=slot=>({x:175+(slot%2)*165,y:195+Math.floor(slot/2)*88});", "const position=slot=>({x:300+(slot%2)*150,y:290+Math.floor(slot/2)*105});", 1],
  ["c.globalAlpha=h.en<1?.45:1;", "c.globalAlpha=1/* hunt heroes never tire */;", 1],
  ["firing?'a1':h.en<1?'s0':SS.idleName(now,h.id)", "firing?'a1':SS.idleName(now,h.id)", 1],
  [";c.fillStyle='#14212a';c.fillRect(p.x-35,p.y+30,70,4);c.fillStyle=colors[h.r];c.fillRect(p.x-35,p.y+30,70*Math.min(1,h.en/(h.st*50)),4)}", "/* no chakra bar */}", 1],
  // Readable arena labels (outlined); the old "STRIKE TEAM n OF 10" caption is gone.
  ["c.font='12px system-ui';c.textAlign='center';c.fillStyle=colors[h.r];c.fillText(h.name.split(' ')[0],p.x,p.y+23)",
   "c.font='bold 18px system-ui';c.textAlign='center';c.lineJoin='round';c.lineWidth=4;c.strokeStyle='#05030f';c.strokeText(h.name.split(' ')[0],p.x,p.y+28);c.fillStyle=colors[h.r];c.fillText(h.name.split(' ')[0],p.x,p.y+28)", 1],
  ["c.font='bold 19px system-ui';c.fillStyle='#f4d4b5';c.textAlign='center';c.fillText(guardians[(stage-1)%6],target.x,535);",
   "c.font='bold 24px system-ui';c.textAlign='center';c.lineJoin='round';c.lineWidth=5;c.strokeStyle='#05030f';c.strokeText(guardians[(stage-1)%6],target.x,540);c.fillStyle='#ffe2c4';c.fillText(guardians[(stage-1)%6],target.x,540);", 1],
  ["c.fillStyle='#a4b2c3';c.font='11px system-ui';c.textAlign='left';c.fillText('GUARDIAN SANCTUARY  /  STRIKE TEAM '+team.length+' OF 10',28,34);", "/* no arena caption */", 1]
];
function replaceCount(text, [before, after, count], label) {
  if (text.split(after).length - 1 === count && !text.includes(before)) return text;
  const n = text.split(before).length - 1; if (n !== count) throw Error('Boss Hunt patch mismatch: ' + label + ' (' + n + ')');
  return text.split(before).join(after);
}
const exportHook = ['module.exports={normalizeProfile,', 'module.exports={hero,normalizeProfile,'];
function applyBossHunt(appDir = path.join(__dirname, 'app')) {
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(__dirname, 'boss-hunt/server.cjs'), path.join(server, 'boss-hunt.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Boss Hunt v1')) fs.appendFileSync(schema, '\n-- Boss Hunt v1\n' + require('./boss-hunt/server.cjs').SCHEMA + '\n');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Boss Hunt weekly v1')) fs.appendFileSync(schema, '\n-- Boss Hunt weekly v1\n' + require('./boss-hunt/server.cjs').WEEKLY_SCHEMA + '\n');
  const economy = path.join(server, 'economy.cjs'); fs.writeFileSync(economy, replaceCount(replaceCount(fs.readFileSync(economy, 'utf8'), [...economyHook, 1], 'economy quote'), [...exportHook, 1], 'economy hero export'));
  const service = path.join(server, 'service.cjs'); let text = fs.readFileSync(service, 'utf8');
  serviceHooks.forEach((hook, i) => { text = replaceCount(text, [...hook, 1], 'service ' + i); }); fs.writeFileSync(service, text);
  const index = path.join(appDir, 'public/index.html');
  fs.writeFileSync(index, bossHuntPatches.reduce((html, hook, i) => replaceCount(html, hook, 'client ' + i), fs.readFileSync(index, 'utf8')));
  console.log('Boss Hunt applied: 10,000 Ryo entry (80% prize pool, 10% treasury, 10% burn), daily and weekly rankings, no-chakra 60-second runs.');
}
module.exports = { applyBossHunt, bossHuntPatches, economyHook, serviceHooks };
if (require.main === module) applyBossHunt();
