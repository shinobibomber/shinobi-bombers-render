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

 // Concurrency: send() takes the same per-wallet account row lock (store.locked) as deposits and
 // purchases. This single-connection PGlite pool cannot exercise row locks, so it is not asserted here.
 console.log('PASS: chat send/list, sanitizing, link blocking, names, rate limits, polling, scope isolation, and retention.');
})().catch(error=>{console.error(error);process.exitCode=1});
