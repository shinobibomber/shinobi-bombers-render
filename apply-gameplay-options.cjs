const fs=require('node:fs'),path=require('node:path');
const marker='<!-- gameplay-options-v1 -->';
// A collection holds at most this many heroes; summons beyond it are refused until heroes are fused.
const MAX_HEROES=500;
// Fusion list: every Reserve hero of the rank is listed. Elites below level 10 stay visible but
// locked, since Elite → Legend needs three level 10 Elites. Exported so preservation can reverse them.
const fusionListPatches=[
 ["const heroes=S.h.filter(h=>h.r===rank&&(h.r!==3||h.lv===10)&&!BattleRoster.eligible(h)&&h.tokenId&&h.tokenOwner===window.RyoPayments?.state.account).sort((a,b)=>a.pw-b.pw||a.lv-b.lv),next=rank+1;",
  "const listed=S.h.filter(h=>h.r===rank&&!BattleRoster.eligible(h)&&h.tokenId&&h.tokenOwner===window.RyoPayments?.state.account).sort((a,b)=>(a.r===3&&a.lv!==10)-(b.r===3&&b.lv!==10)||a.pw-b.pw||a.lv-b.lv),heroes=listed.filter(h=>h.r!==3||h.lv===10),next=rank+1;"],
 ['<tbody>${heroes.map(h=>`<tr class="${selected.includes(h.id)?\'picked\':\'\'}">',
  '<tbody>${listed.map(h=>`<tr class="${selected.includes(h.id)?\'picked\':\'\'}${h.r===3&&h.lv!==10?\' locked\':\'\'}">'],
 ["${selected.length>=3&&!selected.includes(h.id)?'disabled':''}",
  "${(selected.length>=3&&!selected.includes(h.id))||(h.r===3&&h.lv!==10)?'disabled':''}"],
 ["${R[h.r][0]} · Lv ${h.lv} · Reserve</small>",
  "${R[h.r][0]} · Lv ${h.lv} · ${h.r===3&&h.lv!==10?'Lv 10 needed':'Reserve'}</small>"],
 ["${!heroes.length?'<p class=\"fusion-empty\">No heroes of this rank yet. Summon more shinobi to begin.</p>':''}",
  "${!listed.length?'<p class=\"fusion-empty\">No heroes of this rank yet. Summon more shinobi to begin.</p>':rank===3&&heroes.length<3?'<p class=\"fusion-empty\">Elite → Legend fusion needs three level 10 Elites. Train Elites to level 10 in the Dojo.</p>':''}"]
];
// Boss Hunt: the 5 strongest rested deployed heroes fight (was the first 10). The preview uses the
// same choice, so the screen shows exactly who will fight. Exported so preservation can reverse them.
const BOSS_TEAM="BattleRoster.list().filter(h=>h.on&&h.en>=1).sort((a,c)=>c.pw-a.pw).slice(0,5)";
const bossTeamPatches=[
 ["const team=BattleRoster.list().filter(h=>h.on&&h.en>=1).slice(0,10);","const team="+BOSS_TEAM+";"],
 ["const team=b?b.team:S.h.filter(h=>h.on).slice(0,10).map((h,slot)=>({id:h.id,slot}));\n  const rows=","const team=b?b.team:"+BOSS_TEAM+".map((h,slot)=>({id:h.id,slot}));\n  const rows="],
 ["const team=b?b.team:S.h.filter(h=>h.on).slice(0,10).map((h,slot)=>({id:h.id,slot}));\n  for(const unit of team)","const team=b?b.team:"+BOSS_TEAM+".map((h,slot)=>({id:h.id,slot}));\n  for(const unit of team)"],
 ["Deploy up to 10 rested heroes.","Your 5 strongest rested deployed heroes join the hunt."]
];
// Each defeated enemy shows the Ryo its tier pays (GameBalance.enemyReward: the server's tier
// table at the live loot rate) instead of "TARGET CLEARED". The Chest stays server-verified.
const rewardPatches=[
 ["s:window.RyoPayments?.state.authenticated?'TARGET CLEARED':'+'+Math.floor(reward).toLocaleString()}","s:'+'+(reward<100?Math.floor(reward*10)/10:Math.floor(reward)).toLocaleString()+' Ryo'}"],
 // Announce each defeat so the website can fetch the server-verified Chest right away.
 ["c.k=0;S.ryo=GameBalance.money(S.ryo+reward);","c.k=0;S.ryo=GameBalance.money(S.ryo+reward);dispatchEvent(new CustomEvent('shinobi-enemy-defeated',{detail:{kind,reward}}));"]
];
function replaceOne(text,before,after,label){if(text.includes(after))return text;const count=text.split(before).length-1;if(count!==1)throw Error('Gameplay options patch mismatch: '+label+' ('+count+')');return text.replace(before,()=>after)}
function applyGameplayOptions(appDir=path.join(__dirname,'app')){
 const patch=(file,fn)=>{const name=path.join(appDir,file),before=fs.readFileSync(name,'utf8'),after=fn(before);if(before!==after)fs.writeFileSync(name,after)};
 patch('server/economy.cjs',s=>{
  s=replaceOne(s,"if(![1,5,10,15].includes(params.quantity))fail('Choose 1, 5, 10 or 15 summons.');","if(![1,5,10,15].includes(params.quantity))fail('Choose 1, 5, 10 or 15 summons.');if(profile.heroes.length+params.quantity>"+MAX_HEROES+")fail('Your collection holds '+profile.heroes.length+' of "+MAX_HEROES+" heroes. Fuse heroes to free '+(profile.heroes.length+params.quantity-"+MAX_HEROES+")+' slot(s) before summoning '+params.quantity+'.',409);",'hero limit');
  s=replaceOne(s,'function normalizeProfile(profile){','function normalizeProfile(profile){if(!Number.isInteger(profile.senseiReturnPercent)||profile.senseiReturnPercent<50||profile.senseiReturnPercent>90)profile.senseiReturnPercent=90;if(typeof profile.senseiEnabled!=="boolean")profile.senseiEnabled=true;','Sensei defaults');
  s=replaceOne(s,'return profile.sensei===true||Number(profile.senseiRentalUntil||0)>now','return profile.senseiEnabled!==false&&(profile.sensei===true||Number(profile.senseiRentalUntil||0)>now)','Sensei enabled');
  s=replaceOne(s,"if(profile.heroes.length-list.length+list.length/3<2)fail('Keep at least two heroes in the server token collection after fusion.');","if(list[0].rank===3&&list.some(h=>h.level!==10))fail('Elite to Legend fusion requires three level 10 Elite heroes.');\n  if(profile.heroes.length-list.length<2)fail('Keep at least two heroes even if every fusion attempt fails.');",'fusion eligibility');
  s=replaceOne(s,"title='Fuse '+list.length+' heroes into '+list.length/3;","title='Fusion · '+list.length/3+' attempt'+(list.length===3?'':'s');",'fusion title');
  s=replaceOne(s,'return {economyVersion:VERSION,product,params,title,base,studioFee,total:base+studioFee,treasury:base/10,burn:base/10,operations:base*.8};','return {economyVersion:VERSION,product,params:product===\'fusion\'?{...params,fusionRulesVersion:1}:params,title,base,studioFee,total:base+studioFee,treasury:base/10,burn:base/10,operations:base*.8,...(product===\'fusion\'?{fusion:{version:1,attempts:params.heroIds.length/3,successPercent:[90,80,70,60][profile.heroes.find(h=>h.tokenId===params.heroIds[0]).rank],consumeOnFailure:true,eliteLevelRequired:10}}:{})};','versioned fusion quote');
  s=replaceOne(s,"for(let i=0;i<consumed.size/3;i++)outputs.push(hero(rank+1));","for(let i=0;i<consumed.size/3;i++)if(!q.fusion||crypto.randomInt(100)<q.fusion.successPercent)outputs.push(hero(rank+1));",'server fusion roll');
  s=replaceOne(s,"consumed:q.product==='fusion'?q.params.heroIds:[]","consumed:q.product==='fusion'?q.params.heroIds:[],...(q.product==='fusion'?{fusion:{version:q.fusion?.version||0,attempts:q.params.heroIds.length/3,succeeded:outputs.length,failed:q.params.heroIds.length/3-outputs.length,successPercent:q.fusion?.successPercent??100,totalCharged:q.total}}:{})",'persisted fusion results');return s;
 });
 patch('server/store.cjs',s=>replaceOne(s,"q=economy.quote(profile,product,params);if(q.total!==expectedTotal)","q=economy.quote(profile,product,params);if(product==='fusion'&&(params.fusionRulesVersion!==1||params.fusionRulesAccepted!==1))fail('Fusion rules changed. Refresh and review the success chance and consumption terms before paying.',409);if(q.total!==expectedTotal)",'reviewed fusion rules'));
 patch('server/service.cjs',s=>replaceOne(s,"if(action==='hero-mode'){","if(action==='sensei-settings'){await require('./gameplay-options.cjs').saveSenseiSettings(store,wallet,body);return state(wallet)}\n  if(action==='hero-mode'){",'authenticated settings action'));
 patch('server/adventure.cjs',s=>{
  s=replaceOne(s,'offlineStart=Math.max(last,since)','offlineStart=Math.max(last,since,Number(profile.senseiEnabledSince||0))','no retroactive earnings');
  s=replaceOne(s,'offlineEnd=Math.min(now,until,last+OFFLINE_CAP_MS)','offlineEnd=profile.senseiEnabled===false?last:Math.min(now,until,last+OFFLINE_CAP_MS)','offline disabled');
  return replaceOne(s,'d.energy[h.tokenId]>=45*h.baseStats.st','d.energy[h.tokenId]>=50*h.baseStats.st*profile.senseiReturnPercent/100','server return threshold');
 });
 fs.copyFileSync(path.join(__dirname,'gameplay-options/server.cjs'),path.join(appDir,'server/gameplay-options.cjs'));
 patch('public/index.html',s=>{
  if(s.includes(marker))return s;
  s=replaceOne(s,'h.en>=h.st*45&&BattleRoster.eligible(h)','h.en>=h.st*50*(S.v2.senseiReturnPercent||90)/100&&BattleRoster.eligible(h)','online threshold');
  s=replaceOne(s,'window.RyoPayments={heroMode:','window.RyoPayments={senseiSettings:(returnPercent,enabled)=>run(async()=>accept(await api(\'sensei-settings\',{returnPercent,enabled,active:!document.hidden&&!window.LoginScreen?.active}))),heroMode:','settings client API');
  s=replaceOne(s,'S.dojo=p.profile.dojo;S.butler=','S.v2.senseiReturnPercent=p.profile.senseiReturnPercent||90;S.v2.butlerEnabled=p.profile.senseiEnabled!==false;S.dojo=p.profile.dojo;S.butler=','server preferences sync');
  // Only eligible level 10 Elites appear in selection and select-weakest lists.
  s=s.replaceAll('h.r===rank&&!BattleRoster.eligible(h)&&h.tokenId','h.r===rank&&(h.r!==3||h.lv===10)&&!BattleRoster.eligible(h)&&h.tokenId');
  s=replaceOne(s,'a.every(h=>h&&h.r===a[0].r&&h.r<4)&&S.h.length>=4','a.every(h=>h&&h.r===a[0].r&&h.r<4&&(h.r!==3||h.lv===10))&&S.h.filter(h=>h.tokenId&&h.tokenOwner===window.RyoPayments?.state.account).length>=5','fusion button eligibility');
  s=replaceOne(s,"list.some(h=>!owned(h)||BattleRoster.eligible(h))||S.h.filter(owned).length<4","list.some(h=>!owned(h)||BattleRoster.eligible(h)||(h.r===3&&h.lv!==10))||S.h.filter(owned).length<5",'single fusion');
  s=replaceOne(s,'Math.floor((S.h.filter(owned).length-2)/2)','Math.floor((S.h.filter(owned).length-2)/3)','worst case batch cap');
  s=s.replaceAll('owned(h)&&!BattleRoster.eligible(h)&&h.r===rank','owned(h)&&!BattleRoster.eligible(h)&&h.r===rank&&(h.r!==3||h.lv===10)');
  s=replaceOne(s,"dialog.querySelector('h2').textContent=q.title;","dialog.querySelector('h2').textContent=q.title;if(q.fusion){const warning=document.createElement('p');warning.className='fusion-payment-warning';warning.textContent=q.fusion.attempts+' attempt(s) · '+q.fusion.successPercent+'% success per attempt. Each attempt consumes three selected heroes and charges 25,000 Ryo plus the 2% studio fee, including failed attempts. A failed attempt produces no hero.';dialog.querySelector('.checkout-actions').before(warning)}",'checkout risk disclosure');
  s=replaceOne(s,'const result=await RyoPayments.purchase(q);await deliver();','if(q.fusion)q.params={...q.params,fusionRulesAccepted:1};const result=await RyoPayments.purchase(q);await deliver();','explicit new rules acknowledgement');
  s=replaceOne(s,"const result=row.result;if(result?.product==='summon')","const result=row.result;if(result?.product==='fusion'&&result.fusion)S.v2.fusionOutcome={...result.fusion,owner:p.account,orderId:id,seen:false};if(result?.product==='summon')",'recoverable result summary');
  s=replaceOne(s,'hud();if(S.v2.revealBatch?.length)Experience.refreshReveal();','hud();if(S.v2.revealBatch?.length)Experience.refreshReveal();window.GameplayOptions?.presentFusionOutcome();','show settled result');
  return s.replace('</head>',marker+'\n<link rel="stylesheet" href="assets/gameplay-options/options.css">\n<script defer src="assets/gameplay-options/options.js"></script>\n</head>');
 });
 patch('public/index.html',s=>fusionListPatches.reduce((html,[before,after],i)=>replaceOne(html,before,after,'fusion list '+i),s));
 patch('public/index.html',s=>rewardPatches.reduce((html,[before,after],i)=>replaceOne(html,before,after,'enemy reward '+i),s));
 patch('public/index.html',s=>bossTeamPatches.reduce((html,[before,after],i)=>replaceOne(html,before,after,'boss team '+i),s));
 const dest=path.join(appDir,'public/assets/gameplay-options');fs.mkdirSync(dest,{recursive:true});for(const name of ['options.js','options.css'])fs.copyFileSync(path.join(__dirname,'gameplay-options',name),path.join(dest,name));
 console.log('Server-enforced fusion odds and persisted Sensei preferences applied.');
}
module.exports={applyGameplayOptions,fusionListPatches,bossTeamPatches,rewardPatches,BOSS_TEAM,MAX_HEROES};if(require.main===module)applyGameplayOptions();
