'use strict';
const fs = require('node:fs'), path = require('node:path');
const marker = '<!-- creators-portal-v1 -->';
// All client hooks are reversible by preservation.cjs. No game combat formula changes.
const creatorPatches = [
  ['window.RyoPayments={displaySettings:', "window.RyoPayments={creators:(action,body={})=>{if(!/^creator-(public|state|apply|attribute|redeem|migrate|admin|admin-action|appeal|terms|player-state|player-claim)$/.test(action))throw Error('Unknown Creators Portal action.');return api(action,body,action!=='creator-public').then(data=>{if(data.profile)accept(data);return data})},displaySettings:", 1],
  ["session=await api('login',{wallet:address,nonce:challenge.nonce,signature},false)", "session=await api('login',{wallet:address,nonce:challenge.nonce,signature,...(window.CreatorsPortal?.referralCode()?{creatorCode:window.CreatorsPortal.referralCode()}:{})},false)", 1],
  ["if(session.wallet!==address||typeof session.token!=='string')throw Error('Invalid Ryo session.');sessionVersion++;", "if(session.wallet!==address||typeof session.token!=='string')throw Error('Invalid Ryo session.');window.CreatorsPortal?.attributionResult(session);sessionVersion++;", 1]
];
const serviceHooks = [
  ["  if(action==='config'){", "  if(action==='creator-public')return require('./creators-portal.cjs').handle({store,origin},null,action,body);\n  if(action==='config'){"],
  ["return store.login(wallet,body.nonce,message=>verifySignature(wallet,message,body.signature))", "const session=await store.login(wallet,body.nonce,message=>verifySignature(wallet,message,body.signature));if(body.creatorCode&&require('./creators-portal.cjs').enabled()){try{await require('./creators-portal.cjs').attribute(store,wallet,{code:body.creatorCode});session.referralAccepted=true}catch(e){session.referralMessage=e.message}}return session"],
  ["  if(action==='sensei-settings'){", "  if(typeof action==='string'&&action.startsWith('creator-')){const result=await require('./creators-portal.cjs').handle({store,origin},wallet,action,body);return ['creator-redeem','creator-player-claim'].includes(action)?{...result,...await state(wallet)}:result}\n  if(action==='sensei-settings'){"]
];
const storeHooks = [
  ["if(status==='confirmed')await require('./chat.cjs').announceLegends(this,c,wallet,row);", "if(status==='confirmed'){await require('./chat.cjs').announceLegends(this,c,wallet,row);await require('./creators-portal.cjs').settledPurchase(this,c,row);}"]
];
const adventureHooks = [
  ['function advance(data,profile,now,active,ratePercent=50,report=null){', 'function advance(data,profile,now,active,ratePercent=50,report=null,onReward=null){'],
  ['function step(seconds,run,sensei){', 'function step(seconds,run,sensei,at=now){'],
  ['d.pending+=Math.floor(PAY[d.target]*Math.max(.35,1-.1*Math.floor(d.map/100))*rate);', 'const earned=Math.floor(PAY[d.target]*Math.max(.35,1-.1*Math.floor(d.map/100))*rate);d.pending+=earned;if(onReward)onReward(earned,at);'],
  ['true,economy.senseiActive(profile,at));', 'true,economy.senseiActive(profile,at),at);'],
  ["if(online&&tally)require('./gameplay-options.cjs').creditKills(d,tally,budget,rate,now);", "if(online&&tally){const before=d.pending;require('./gameplay-options.cjs').creditKills(d,tally,budget,rate,now);if(onReward&&d.pending>before)onReward(d.pending-before,now);}"],
  [' const d=advance(row?.data,profile,store.now(),active,rewardRatePercent(Math.max(0,Number(income.n)-Number(used.n))));', " const cp=await require('./creators-portal.cjs').beginAdventure(store,c,wallet,profile,row?.data,active,null);\n const d=advance(row?.data,profile,store.now(),active,rewardRatePercent(Math.max(0,Number(income.n)-Number(used.n))),null,cp?.onReward);\n await require('./creators-portal.cjs').endAdventure(store,c,wallet,cp,0,null);"],
  ['  const d=advance(old,profile,store.now(),active,rewardRatePercent(pool),report);', "  const cp=await require('./creators-portal.cjs').beginAdventure(store,c,wallet,profile,old,active,report);\n  const d=advance(old,profile,store.now(),active,rewardRatePercent(pool),report,cp?.onReward);let creatorClaimId=null;"],
  ["   await c.query('INSERT INTO ryo_reward_claims(scope,wallet,amount,created) VALUES($1,$2,$3,$4)',[store.scope,wallet,credited,store.now()]);", "   creatorClaimId=(await c.query('INSERT INTO ryo_reward_claims(scope,wallet,amount,created) VALUES($1,$2,$3,$4) RETURNING id',[store.scope,wallet,credited,store.now()])).rows[0].id;"],
  ["  const rate=rewardRatePercent(pool);", "  await require('./creators-portal.cjs').endAdventure(store,c,wallet,cp,credited,creatorClaimId);\n  const rate=rewardRatePercent(pool);"]
];
function replace(text, [before, after, count = 1], label) {
  if (text.split(after).length - 1 === count) return text;
  const n = text.split(before).length - 1; if (n !== count) throw Error('Creators Portal patch mismatch: ' + label + ' (' + n + ')');
  return text.split(before).join(after);
}
function applyCreatorsPortal(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'creators-portal'), server = path.join(appDir, 'server'), publicDir = path.join(appDir, 'public'), dest = path.join(publicDir, 'assets/creators-portal');
  fs.mkdirSync(dest, { recursive: true });
  for (const file of ['portal.js', 'portal.css']) fs.copyFileSync(path.join(src, file), path.join(dest, file));
  for (const rank of [0, 3, 4]) fs.copyFileSync(path.join(__dirname, 'website/assets', 'hero' + rank + '.webp'), path.join(dest, 'hero' + rank + '.webp'));
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(server, 'creators-portal.cjs'));
  fs.copyFileSync(path.join(src, 'player-server.cjs'), path.join(server, 'player-referrals.cjs'));
  const schema = path.join(server, 'schema.sql'); if (!fs.readFileSync(schema, 'utf8').includes('-- Creators Portal v1:')) fs.appendFileSync(schema, '\n' + fs.readFileSync(path.join(src, 'schema.sql'), 'utf8').replace(/\r\n?/g, '\n') + '\n');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Player Referrals v1:')) fs.appendFileSync(schema, '\n' + fs.readFileSync(path.join(src, 'player-schema.sql'), 'utf8').replace(/\r\n?/g, '\n') + '\n');
  for (const [file, hooks] of [['service.cjs', serviceHooks], ['store.cjs', storeHooks], ['adventure.cjs', adventureHooks]]) {
    const p = path.join(server, file), source = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, hooks.reduce((s, hook, i) => file==='adventure.cjs' && source.includes("const advance=require('./combat-adventure.cjs').advance;") && i<5 ? s : replace(s, hook, file + ':' + i), source));
  }
  const index = path.join(publicDir, 'index.html'); let html = fs.readFileSync(index, 'utf8');
  for (const hook of creatorPatches) html = replace(html, hook, 'authenticated client API');
  if (!html.includes(marker)) html = html.replace('</head>', marker + '\n<link rel="stylesheet" href="assets/creators-portal/portal.css">\n<script defer src="assets/creators-portal/portal.js"></script>\n</head>');
  fs.writeFileSync(index, html);
  console.log('Creators Portal assembled: wallet allowlist, CP ledger, referral qualification, commissions, limited in-game rewards and admin management.');
}
module.exports = { applyCreatorsPortal, creatorPatches, serviceHooks, storeHooks, adventureHooks };
if (require.main === module) applyCreatorsPortal();
