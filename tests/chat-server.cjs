/* Global chat server module against the real schema and Store (PGlite). */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../app/server');
const {Store}=require(path.join(root,'store.cjs')),chat=require(path.join(root,'chat.cjs'));
(async()=>{
 const db=new PGlite();await db.exec(fs.readFileSync(path.join(root,'schema.sql'),'utf8'));
 const pool={query:(s,a)=>db.query(s,a),async connect(){return{query:(s,a)=>db.query(s,a),release(){}}}};
 let clock=1_800_000_000_000;const store=new Store(pool,'test-chat',()=>clock),other=new Store(pool,'other-scope',()=>clock);
 const alice='AliceWa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',bob='BobWa11etBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
 const send=(wallet,text,extra={})=>chat.handle(store,wallet,'chat-send',{channel:'global',text,name:'Alice',...extra});
 const list=(wallet,after)=>chat.handle(store,wallet,'chat-list',{channel:'global',...(after===undefined?{}:{after})});

 assert.deepEqual((await list(alice)).messages,[],'a new channel starts empty');
 const first=await send(alice,'  Hello   shinobi!  ');
 assert.equal(first.messages.length,1);
 assert.deepEqual({...first.messages[0],id:0,created:0},{id:0,name:'Alice',from:'Alic…AAAA',mine:true,text:'Hello shinobi!',created:0},'whitespace is collapsed and the sender is identified');
 const seenByBob=(await list(bob)).messages[0];assert.equal(seenByBob.mine,false,'other players see it as someone else\'s');assert.equal(seenByBob.from,'Alic…AAAA');

 // Validation: nothing reaches the table.
 for(const [text,pattern]of [['',/Type a message/],['   ',/Type a message/],['x'.repeat(201),/up to 200/],['claim at https://evil.example',/Links/],['visit www.scam.io',/Links/],['free sol on airdrop.xyz now',/Links/],['join discord.gg/abc',/Links/]])
  await assert.rejects(send(bob,text),pattern,JSON.stringify(text.slice(0,30)));
 await assert.rejects(chat.handle(store,bob,'chat-send',{channel:'guild',text:'hi'}),/Unknown chat channel/);
 await assert.rejects(chat.handle(store,bob,'chat-list',{channel:'global',after:-1}),/Invalid chat position/);
 await assert.rejects(chat.handle(store,bob,'chat-list',{channel:'global',after:'1'}),/Invalid chat position/);
 assert.equal((await list(bob)).messages.length,1,'rejected messages are never stored');

 // Names: cleaned, capped and never empty. Markup is plain text for the client to render safely.
 clock+=3000;const named=await send(bob,'<b>bold</b> & "quotes"',{name:'  <img src=x> Bob!!  of   the Leaf Village '});
 const latest=named.messages.at(-1);assert.equal(latest.name,'img srcx Bob o','names keep letters/digits only, capped at 14 characters');assert.equal(latest.text,'<b>bold</b> & "quotes"');
 clock+=3000;assert.equal((await send(bob,'no name',{name:'@@@'})).messages.at(-1).name,'Shinobi');
 clock+=3000;assert.equal((await send(bob,'zero​width\u0007bell',{name:'Bob'})).messages.at(-1).text,'zero width bell','control and zero-width characters are removed');

 // Rate limits: a minimum gap, no repeats, and a burst cap per 30 seconds.
 clock+=3000;await send(alice,'one');await assert.rejects(send(alice,'two'),/Slow down/);
 clock+=2500;await assert.rejects(send(alice,'one'),/already sent/);
 const burst=new Store(pool,'test-burst',()=>clock);
 for(let i=0;i<10;i++){clock+=2100;await chat.handle(burst,alice,'chat-send',{channel:'global',text:'burst '+i})}
 clock+=2100;await assert.rejects(chat.handle(burst,alice,'chat-send',{channel:'global',text:'burst 10'}),/too quickly/);
 clock+=30000;await chat.handle(burst,alice,'chat-send',{channel:'global',text:'after the window'});

 // Incremental polling returns only newer messages, oldest first, at most one page.
 const all=(await list(bob)).messages,mid=all[1].id;
 assert.deepEqual((await list(bob,mid)).messages.map(m=>m.id),all.slice(2).map(m=>m.id));
 assert(all.every((m,i)=>!i||m.id>all[i-1].id),'messages are in order');
 assert.equal((await chat.handle(other,alice,'chat-list',{channel:'global'})).messages.length,0,'scopes are isolated');

 // Retention: only the newest KEEP messages stay; a page is at most PAGE messages.
 const busy=new Store(pool,'test-retention',()=>clock),senders=Array.from({length:30},(_,i)=>'Sender'+String(i).padStart(2,'0')+'X'.repeat(30));
 for(let i=0;i<chat.KEEP+25;i++){clock+=1100;await chat.handle(busy,senders[i%30],'chat-send',{channel:'global',text:'message '+i})}
 const kept=(await db.query("SELECT COUNT(*)::int AS n FROM ryo_chat WHERE scope='test-retention'")).rows[0].n;assert.equal(kept,chat.KEEP,'older messages are pruned');
 const page=(await chat.handle(busy,alice,'chat-list',{channel:'global'})).messages;assert.equal(page.length,chat.PAGE);assert.equal(page.at(-1).text,'message '+(chat.KEEP+24),'the page ends with the newest message');

 // Legend summons: posted to System once, only when the real order settles as confirmed.
 const economy=require(path.join(root,'economy.cjs')),crypto=require('node:crypto'),originalRandom=crypto.randomInt;
 const shop=new Store(pool,'test-legend',()=>clock),buyer='BuyerWa11etCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
 await shop.transaction(async c=>{await shop.locked(c,buyer);await c.query('UPDATE ryo_accounts SET balance=1000000 WHERE scope=$1 AND wallet=$2',[shop.scope,buyer]);await shop.profileLocked(c,buyer)});
 clock+=3000;await chat.handle(shop,buyer,'chat-send',{channel:'global',text:'wish me luck',name:'Hikari'});
 const buy=async(id,rolls)=>{const q=economy.quote(await shop.profile(buyer),'summon',{quantity:rolls.length});crypto.randomInt=(...args)=>args.length===1&&args[0]===10000?rolls.shift():originalRandom(...args);
  try{return await shop.purchase(buyer,id,'summon',{quantity:q.params.quantity},q.total,async()=>({signature:'sig-'+id,wire:'wire',lastHeight:1}))}finally{crypto.randomInt=originalRandom}};
 const systemFeed=async()=>(await chat.handle(shop,alice,'chat-list',{channel:'global',systemAfter:0})).system;
 await buy('legend-order-0001',[9950,100,9999,200,300]);
 assert.deepEqual(await systemFeed(),[],'a pending order announces nothing');
 const settled=await shop.settlePurchase(buyer,'legend-order-0001','confirmed');assert.equal(settled.status,'confirmed');
 let feed=await systemFeed();assert.equal(feed.length,1,'a confirmed order is announced once');
 const legends=settled.result.outputs.filter(h=>h.rank===4).map(h=>h.name);assert.equal(legends.length,2);
 assert.equal(feed[0].text,'⭐ Hikari (Buye…CCCC) summoned 2 LEGENDS: '+legends.join(', ')+'!','names the player, short wallet and every Legend');
 assert.deepEqual({name:feed[0].name,from:feed[0].from,mine:feed[0].mine},{name:'System',from:'',mine:false});
 await shop.settlePurchase(buyer,'legend-order-0001','confirmed');
 await shop.transaction(c=>chat.announceLegends(shop,c,buyer,settled));
 assert.equal((await systemFeed()).length,1,'repeated settlement or announcement never duplicates');
 await buy('legend-order-0002',[9990]);await shop.settlePurchase(buyer,'legend-order-0002','refunded');
 await buy('plain-order-00003',[100]);await shop.settlePurchase(buyer,'plain-order-00003','confirmed');
 feed=await systemFeed();assert.equal(feed.length,1,'refunded Legends and ordinary summons are not announced');
 await buy('legend-order-0004',[9900]);await shop.settlePurchase(buyer,'legend-order-0004','confirmed');
 feed=await systemFeed();assert.equal(feed.length,2);assert.match(feed[1].text,/^⭐ Hikari \(Buye…CCCC\) summoned a LEGEND: .+!$/);
 assert.deepEqual((await chat.handle(shop,alice,'chat-list',{channel:'global',systemAfter:feed[0].id})).system.map(m=>m.id),[feed[1].id],'System polling is incremental');
 assert.equal((await chat.handle(shop,alice,'chat-list',{channel:'system'})).messages.length,2,'the System channel can be read directly');
 await assert.rejects(chat.handle(shop,buyer,'chat-send',{channel:'system',text:'fake legend'}),/Unknown chat channel/,'players cannot post to System');
 assert.equal((await chat.handle(shop,alice,'chat-list',{channel:'global'})).system,undefined,'System is only included when asked');
 // Legend fusions: a confirmed successful Elite → Legend fusion is announced; a failed attempt is not.
 const forge=new Store(pool,'test-fusion',()=>clock),fuser='FuserWa11etEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
 const elites=economy.normalizeProfile({dojo:0,sensei:true,battleReady:[],heroes:Array.from({length:8},(_,i)=>({tokenId:'elite-'+i,rank:3,level:10,name:'Elite '+i,baseStats:{pw:10,sp:10,st:10}}))});
 await forge.transaction(async c=>{await forge.locked(c,fuser);await c.query('UPDATE ryo_accounts SET balance=1000000 WHERE scope=$1 AND wallet=$2',[forge.scope,fuser]);await forge.profileLocked(c,fuser);await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2',[forge.scope,fuser,JSON.stringify(elites)])});
 const fuse=async(id,ids,roll)=>{const q=economy.quote(await forge.profile(fuser),'fusion',{heroIds:ids});crypto.randomInt=(...args)=>args.length===1&&args[0]===100?roll:originalRandom(...args);
  try{await forge.purchase(fuser,id,'fusion',{...q.params,fusionRulesAccepted:1},q.total,async()=>({signature:'sig-'+id,wire:'wire',lastHeight:1}))}finally{crypto.randomInt=originalRandom}
  return forge.settlePurchase(fuser,id,'confirmed')};
 const fusionFeed=async()=>(await chat.handle(forge,alice,'chat-list',{channel:'system'})).messages;
 const failed=await fuse('fusion-order-001',['elite-0','elite-1','elite-2'],99);assert.equal(failed.result.outputs.length,0);
 assert.deepEqual(await fusionFeed(),[],'a failed fusion attempt announces nothing');
 const won=await fuse('fusion-order-002',['elite-3','elite-4','elite-5'],0),legend=won.result.outputs[0];assert.equal(legend.rank,4);
 const fused=await fusionFeed();assert.equal(fused.length,1);
 assert.equal(fused[0].text,'⭐ A shinobi (Fuse…EEEE) fused a LEGEND: '+legend.name+'!','a successful Legend fusion is announced');
 await forge.settlePurchase(fuser,'fusion-order-002','confirmed');assert.equal((await fusionFeed()).length,1,'re-settling a fusion never duplicates');
 // Concurrency: send() takes the same per-wallet account row lock (store.locked) as deposits and
 // purchases. This single-connection PGlite pool cannot exercise row locks, so it is not asserted here.
 console.log('PASS: chat send/list, sanitizing, link blocking, names, rate limits, polling, scope isolation, retention and once-only Legend summon and fusion announcements.');
})().catch(error=>{console.error(error);process.exitCode=1});
