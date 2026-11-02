/* Global chat for signed-in wallets. Plain text only: no links, rate-limited, and only the
   newest messages are kept. Names are the sender's nickname plus their short wallet. */
const {fail}=require('./store.cjs');
const CHANNELS=['global'],MAX_TEXT=200,KEEP=200,PAGE=50,MIN_GAP_MS=2000,BURST=10,BURST_MS=30000;
const LINK=/(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|gg|xyz|app|me|co|ly|link|site|online|fun|dev|sol)\b|t\.me\/|discord\.gg)/i;
const short=wallet=>wallet.slice(0,4)+'…'+wallet.slice(-4);
function channel(value){if(!CHANNELS.includes(value))fail('Unknown chat channel.');return value}
function clean(text){
 if(typeof text!=='string')fail('Type a message first.');
 const value=text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g,' ').replace(/\s+/g,' ').trim();
 if(!value)fail('Type a message first.');
 if([...value].length>MAX_TEXT)fail('Messages can be up to '+MAX_TEXT+' characters.');
 if(LINK.test(value))fail('Links are not allowed in chat.');
 return value;
}
function name(value){const n=typeof value==='string'?value.normalize('NFKC').replace(/[^\p{L}\p{N} _.-]/gu,'').replace(/\s+/g,' ').trim():'';return [...n].slice(0,14).join('').trim()||'Shinobi'}
function publicMessage(row,wallet){return {id:Number(row.id),name:row.name,from:short(row.wallet),mine:row.wallet===wallet,text:row.text,created:Number(row.created)}}
async function list(store,wallet,body,client){
 const ch=channel(body.channel),after=body.after===undefined?0:body.after;
 if(!Number.isSafeInteger(after)||after<0)fail('Invalid chat position.');
 const run=c=>c.query('SELECT id,wallet,name,text,created FROM ryo_chat WHERE scope=$1 AND channel=$2 AND id>$3 ORDER BY id DESC LIMIT $4',[store.scope,ch,after,PAGE]);
 const rows=(await (client?run(client):run(store.pool))).rows.reverse();
 return {channel:ch,messages:rows.map(row=>publicMessage(row,wallet)),serverTime:store.now()};
}
async function send(store,wallet,body){
 const ch=channel(body.channel),text=clean(body.text),sender=name(body.name);
 return store.transaction(async c=>{
  // The account row lock serializes one wallet's sends, so the limits hold under concurrency.
  await store.locked(c,wallet);const now=store.now();
  const recent=(await c.query('SELECT text,created FROM ryo_chat WHERE scope=$1 AND wallet=$2 AND created>$3 ORDER BY id DESC',[store.scope,wallet,now-BURST_MS])).rows;
  if(recent[0]&&now-Number(recent[0].created)<MIN_GAP_MS)fail('Slow down a little before sending again.',429);
  if(recent.length>=BURST)fail('You are sending messages too quickly. Wait a few seconds.',429);
  if(recent.some(row=>row.text===text))fail('You already sent that message.',429);
  await c.query('INSERT INTO ryo_chat(scope,channel,wallet,name,text,created) VALUES($1,$2,$3,$4,$5,$6)',[store.scope,ch,wallet,sender,text,now]);
  await c.query('DELETE FROM ryo_chat WHERE scope=$1 AND channel=$2 AND id<=(SELECT id FROM ryo_chat WHERE scope=$1 AND channel=$2 ORDER BY id DESC OFFSET $3 LIMIT 1)',[store.scope,ch,KEEP]);
  return list(store,wallet,{channel:ch,after:Number.isSafeInteger(body.after)?body.after:0},c);
 });
}
function handle(store,wallet,action,body){return action==='chat-send'?send(store,wallet,body):list(store,wallet,body)}
module.exports={handle,clean,name,MAX_TEXT,KEEP,PAGE};
