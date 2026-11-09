/* Beta combat contract. Exact reversible client edits; original wallet/settlement stays intact. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const clientPatches=require('./combat-rules/client-patches.json');
const script='<script src="assets/combat-rules/rules.js"></script>\n<script defer src="assets/combat-rules/client.js"></script>';
function replaceOne(s,a,b){const n=s.split(a).length-1;if(n!==1)throw Error('Combat patch anchor '+a.slice(0,90)+' ('+n+')');return s.replace(a,()=>b)}
function refreshSources(app=path.join(__dirname,'app')){
 const dest=path.join(app,'public/assets/combat-rules');fs.mkdirSync(dest,{recursive:true});
 for(const f of ['rules.js','client.js'])fs.copyFileSync(path.join(__dirname,'combat-rules',f),path.join(dest,f));
 for(const [src,name]of [['rules.js','combat-rules.cjs'],['identity.cjs','combat-identity.cjs'],['chakra.cjs','combat-chakra.cjs'],['adventure.cjs','combat-adventure.cjs'],['hunt.cjs','combat-hunt.cjs'],['transfer.cjs','combat-transfer.cjs']])fs.copyFileSync(path.join(__dirname,'combat-rules',src),path.join(app,'server',name));
}
function applyCombatRules(app=path.join(__dirname,'app')){
 refreshSources(app);
 const patch=(file,fn)=>{const f=path.join(app,file);fs.writeFileSync(f,fn(fs.readFileSync(f,'utf8')))};
 patch('public/index.html',s=>{for(const[a,b,n]of clientPatches){if(s.split(a).length-1!==n)throw Error('Combat client patch mismatch '+a.slice(0,70));s=s.split(a).join(b)}return replaceOne(s,'</head>',script+'\n</head>')});
 patch('server/economy.cjs',s=>replaceOne(s,'[15,18]','[17,20]'));
 patch('server/adventure.cjs',s=>{
  const from=s.indexOf('function advance('),to=s.indexOf('async function settleLocked(');if(from<0||to<=from)throw Error('Adventure integration boundary changed');
  s=s.slice(0,from)+"const advance=require('./combat-adventure.cjs').advance;\n"+s.slice(to);
  s=s.replaceAll("await c.query('INSERT INTO ryo_adventures(scope,wallet,data)","await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[store.scope,wallet,JSON.stringify(profile)]);\n await c.query('INSERT INTO ryo_adventures(scope,wallet,data)");
  return replaceOne(s,'return {pending:d.pending/1000,',"return {combatVersion:1,deployed:d.team||[],chakra:require('./combat-chakra.cjs').snapshot(profile,store.now()),attackAck:Object.fromEntries(Object.entries(d.combatSessions?.[report?.killSession]?.heroes||{}).map(([id,v])=>[id,v.seen])),pending:d.pending/1000,");
 });
 patch('server/store.cjs',s=>{
  // Chakra rules (owner decision 2026-11-10): a hero moved to Reserve stops recovering; moved back, it recovers from now.
  s=replaceOne(s,'else if(!ready)p.battleReady=p.battleReady.filter(n=>n!==id);',"else if(!ready)p.battleReady=p.battleReady.filter(n=>n!==id);require('./combat-chakra.cjs').setReserve(p.heroes.find(h=>h.tokenId===id),!p.battleReady.includes(id),this.now(),p.dojo);");
  s=replaceOne(s,"return require('./economy.cjs').normalizeProfile(row.data)","const before=JSON.stringify(row.data),profile=require('./economy.cjs').normalizeProfile(row.data);if(before!==JSON.stringify(profile))await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[this.scope,wallet,JSON.stringify(profile)]);return profile");
  s=replaceOne(s,"if(ready&&!p.battleReady.includes(id))", "if(p.heroes.find(h=>h.tokenId===id)?.chakra?.lockUntil>this.now())fail('Finish the Boss Hunt before changing its roster.',409);if(ready&&!p.battleReady.includes(id))");
  return replaceOne(s,"else await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[this.scope,wallet,JSON.stringify(row.profile_after)]);","else {const current=await this.profileLocked(c,wallet),latest=new Map(current.heroes.map(h=>[h.tokenId,h]));for(const h of row.profile_after.heroes){const old=latest.get(h.tokenId);if(old?.chakra)h.chakra=old.chakra}await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[this.scope,wallet,JSON.stringify(require('./economy.cjs').normalizeProfile(row.profile_after))]);}");
 });
 patch('server/market.cjs',s=>replaceOne(s,"if (!hero) fail('Only heroes from your signed-in token collection can be listed.');","if (!hero) fail('Only heroes from your signed-in token collection can be listed.');\n    if(hero.chakra?.lockUntil>store.now())fail('Finish the Boss Hunt before listing it.',409);"));
 patch('server/mythic-hero.cjs',s=>{
  s=replaceOne(s,'dropFrom(profile, hero.tokenId); changed = true;',"await require('./combat-transfer.cjs').detach(store,c,wallet,hero);dropFrom(profile, hero.tokenId); changed = true;");
  return replaceOne(s,'hero = dropFrom(others.get(row.wallet), tokenId) || hero;',"hero = dropFrom(others.get(row.wallet), tokenId) || hero;await require('./combat-transfer.cjs').detach(store,c,row.wallet,hero);");
 });
 patch('server/service.cjs',s=>{
  s=replaceOne(s,'report:{killSession:body.killSession,killTotals:body.killTotals,killStage:body.killStage}',"report:body.combatVersion===1?{combatVersion:1,killSession:body.killSession,combatSeq:body.combatSeq,combatHeroes:body.combatHeroes,deployed:body.deployed,killStage:body.killStage}:null");
  s=replaceOne(s,"const entry=await hunt.record(store,wallet,row,body);await progress(row,'purchase');return {entry,","await hunt.record(store,wallet,row,body);await store.pool.query(\"UPDATE ryo_hunt_entries SET combat=$3 WHERE scope=$1 AND id=$2 AND combat IS NULL\",[store.scope,id,JSON.stringify({version:1,waiting:true})]);await progress(row,'purchase');const entry=await require('./combat-hunt.cjs').activate(store,wallet,id);return {entry,");
  return replaceOne(s,"if(action==='hunt-report')return require('./boss-hunt.cjs').report(store,wallet,body);","if(action==='hunt-ready'){for(const row of await store.pendingPurchases(wallet))await progress(row,'purchase');return {entry:await require('./combat-hunt.cjs').activate(store,wallet,body.entryId)}}\n  if(action==='hunt-report')return require('./combat-hunt.cjs').report(store,wallet,body);");
 });
 patch('server/schema.sql',s=>s+'\n-- Combat contract v1\nALTER TABLE ryo_hunt_entries ADD COLUMN IF NOT EXISTS combat JSONB;\n');
 console.log('Combat rules v1: seven permanent perks, Power damage, one chakra per action, persistent server accounting.');
}
module.exports={applyCombatRules,refreshSources,clientPatches,script};if(require.main===module){if(process.argv.includes('--refresh-sources'))refreshSources();else applyCombatRules();}
