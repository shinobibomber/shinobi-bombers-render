'use strict';
const fs=require('node:fs'),path=require('node:path'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../app/server'),E=require(root+'/economy.cjs'),L=require(root+'/legacy-pass.cjs'),R=require(root+'/legacy-pass-rules.cjs'),{Store}=require(root+'/store.cjs'),web3=require('../app/node_modules/@solana/web3.js');
async function fixture(){
 const db=new PGlite();await db.exec(fs.readFileSync(root+'/schema.sql','utf8'));
 let tail=Promise.resolve();async function lock(){let release;const prior=tail;tail=new Promise(r=>release=r);await prior;return release;}
 const pool={async query(q,a){const release=await lock();try{return await db.query(q,a);}finally{release();}},async connect(){const release=await lock();return{query:(q,a)=>db.query(q,a),release};}};
 const f={db,pool,now:Date.parse('2026-11-09T00:00:00Z'),network:true,rpc:true,held:new Map(),calls:[]};
 f.wallet=web3.Keypair.generate().publicKey.toBase58();f.other=web3.Keypair.generate().publicKey.toBase58();f.mints=[web3.Keypair.generate().publicKey.toBase58(),web3.Keypair.generate().publicKey.toBase58()];
 f.connection={async getParsedTokenAccountsByOwner(owner,{programId},commitment){f.calls.push(commitment);if(!f.rpc)throw Error('RPC unavailable');return{value:programId.toBase58().startsWith('Tokenz')?(f.held.get(owner.toBase58())||[]).map(mint=>({account:{data:{parsed:{info:{mint,tokenAmount:{amount:'1',decimals:0}}}}}})):[]};}};
 f.store=new Store(pool,'devnet-legacy-fixture',()=>f.now);f.context={connection:f.connection,async checkNetwork(){if(!f.network)throw Error('Wrong Solana network');}};L.setContext(f.store,f.context);
 f.held.set(f.wallet,f.mints.slice());
 for(let i=0;i<2;i++)await pool.query("INSERT INTO ryo_mythic_boxes(scope,request_id,wallet,serial,mint,price_lamports,status,message,wire,last_height,created) VALUES($1,$2,$3,$4,$5,1000000000,'confirmed','','',1,$6)",[f.store.scope,'founder-'+i,f.wallet,i+1,f.mints[i],f.now]);
 f.save=async(p,wallet=f.wallet)=>{await f.store.transaction(async c=>{await f.store.locked(c,wallet);await c.query('INSERT INTO ryo_profiles(scope,wallet,data) VALUES($1,$2,$3) ON CONFLICT(scope,wallet) DO UPDATE SET data=$3',[f.store.scope,wallet,JSON.stringify(E.normalizeProfile(p))]);});};
 f.profile=(n=3)=>E.normalizeProfile({heroes:Array.from({length:n},()=>E.hero(3)),battleReady:[],upgradeShards:100,dojo:0});
 await f.save(f.profile());await f.save(f.profile(),f.other);
 f.events=async(events,wallet=f.wallet)=>f.store.transaction(async c=>{await f.store.locked(c,wallet);await L.recordLocked(f.store,c,wallet,events);});
 f.complete=async(serial=1)=>{await L.select(f.store,f.wallet,serial);const ids=(await f.store.profile(f.wallet)).heroes.map(h=>h.tokenId);await f.events([{id:'kills:'+R.week(f.now).id+':'+serial,kind:'kills',quantity:30},{id:'recovery:'+R.week(f.now).id+':'+serial,kind:'recovery',quantity:60},{id:'hunt:'+R.week(f.now).id+':'+serial,kind:'hunts',quantity:1},...ids.slice(0,3).map((heroId,i)=>({id:'attacks:'+R.week(f.now).id+':'+serial+':'+i,kind:'attacks',quantity:20,heroId}))]);};
 f.item=async(kind,wallet=f.wallet,expires=f.now+R.EXPIRY)=>{const id=require('node:crypto').randomUUID();await pool.query("INSERT INTO ryo_legacy_items(scope,id,wallet,kind,status,expires,created) VALUES($1,$2,$3,$4,'available',$5,$6)",[f.store.scope,id,wallet,kind,expires,f.now]);return id;};
 f.fragments=async(n,wallet=f.wallet)=>{for(let i=0;i<n;i++)await pool.query('INSERT INTO ryo_legacy_fragments(scope,wallet,event_id,delta,created) VALUES($1,$2,$3,1,$4)',[f.store.scope,wallet,'fixture:'+require('node:crypto').randomUUID(),f.now]);};
 return f;
}
module.exports={fixture,E,L,R,root,Store,web3};
