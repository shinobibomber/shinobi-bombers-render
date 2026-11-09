/* Global chat for signed-in wallets. Plain text only: no links, rate-limited, and only the
   newest messages are kept. Names are the sender's nickname plus their short wallet.
   The read-only System channel carries server announcements such as Legend summons. */
const {fail}=require('./store.cjs');
const CHANNELS=['global'],READABLE=['global','system'],MAX_TEXT=200,KEEP=200,PAGE=50,MIN_GAP_MS=2000,BURST=10,BURST_MS=30000;
const LINK=/(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|gg|xyz|app|me|co|ly|link|site|online|fun|dev|sol)\b|t\.me\/|discord\.gg)/i;
const short=wallet=>wallet.slice(0,4)+'…'+wallet.slice(-4);
function channel(value,read=false){if(!(read?READABLE:CHANNELS).includes(value))fail('Unknown chat channel.');return value}
function position(value){const n=value===undefined?0:value;if(!Number.isSafeInteger(n)||n<0)fail('Invalid chat position.');return n}
function clean(text){
 if(typeof text!=='string')fail('Type a message first.');
 const value=text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g,' ').replace(/\s+/g,' ').trim();
 if(!value)fail('Type a message first.');
 if([...value].length>MAX_TEXT)fail('Messages can be up to '+MAX_TEXT+' characters.');
 if(LINK.test(value))fail('Links are not allowed in chat.');
 return value;
}
function name(value){const n=typeof value==='string'?value.normalize('NFKC').replace(/[^\p{L}\p{N} _.-]/gu,'').replace(/\s+/g,' ').trim():'';return [...n].slice(0,14).join('').trim()||'Shinobi'}
function publicMessage(row,wallet){const system=row.channel==='system';return {id:Number(row.id),name:row.name,from:system?'':short(row.wallet),mine:!system&&row.wallet===wallet,text:row.text,created:Number(row.created)}}
/* Moderation (Shinobi Command Center). Staff decisions live in ryo_cc_chat_status and are enforced
   here, on the server, never only in the browser. Hidden messages stay stored as restricted evidence. */
const WARNING_SHOWN_MS=86400000,REMOVED_WINDOW_MS=86400000,REPORT_CATEGORIES=['spam','scam','harassment','impersonation','offensive','other'],REPORT_LIMIT=10,REPORT_WINDOW_MS=3600000;
const utc=ms=>new Date(Number(ms)).toISOString().slice(0,16).replace('T',' ')+' UTC';
async function standing(db,store,wallet,now){
 const row=(await db.query('SELECT muted_until,banned,last_warning,last_warning_at FROM ryo_cc_chat_status WHERE scope=$1 AND wallet=$2',[store.scope,wallet])).rows[0];
 if(!row)return null;
 if(row.banned)return {banned:true};
 if(Number(row.muted_until)>now)return {mutedUntil:Number(row.muted_until)};
 if(row.last_warning&&now-Number(row.last_warning_at)<WARNING_SHOWN_MS)return {warning:{text:row.last_warning,created:Number(row.last_warning_at)}};
 return null;
}
function refuse(state){
 if(state?.banned)fail('You can no longer send messages in Global chat. You can still read it. Contact support to appeal.',403);
 if(state?.mutedUntil)fail('You are muted in Global chat until '+utc(state.mutedUntil)+'.',403);
}
// One request serves the Global feed and, when systemAfter is given, newer System announcements.
// `removed` lists recently hidden message IDs so clients drop ones they already show.
async function list(store,wallet,body,client){
 const ch=channel(body.channel,true),after=position(body.after),db=client||store.pool,now=store.now();
 const rows=async(name,from)=>(await db.query('SELECT id,channel,wallet,name,text,created FROM ryo_chat WHERE scope=$1 AND channel=$2 AND id>$3 AND hidden IS NULL ORDER BY id DESC LIMIT $4',[store.scope,name,from,PAGE])).rows.reverse().map(row=>publicMessage(row,wallet));
 const result={channel:ch,messages:await rows(ch,after),serverTime:now};
 const channels=body.systemAfter!==undefined&&ch!=='system'?[ch,'system']:[ch];
 if(channels.length>1)result.system=await rows('system',position(body.systemAfter));
 const removed=(await db.query('SELECT id FROM ryo_chat WHERE scope=$1 AND channel=ANY($2) AND hidden>$3 ORDER BY id DESC LIMIT $4',[store.scope,channels,now-REMOVED_WINDOW_MS,PAGE])).rows.map(r=>Number(r.id));
 if(removed.length)result.removed=removed;
 const state=await standing(db,store,wallet,now);if(state)result.standing=state;
 return result;
}
async function send(store,wallet,body){
 const ch=channel(body.channel),text=clean(body.text),sender=name(body.name);
 return store.transaction(async c=>{
  // The account row lock serializes one wallet's sends, so the limits hold under concurrency.
  // Staff mutes and bans take the same lock, so a send never slips past a decision being committed.
  await store.locked(c,wallet);const now=store.now();
  refuse(await standing(c,store,wallet,now));
  const recent=(await c.query('SELECT text,created FROM ryo_chat WHERE scope=$1 AND wallet=$2 AND created>$3 ORDER BY id DESC',[store.scope,wallet,now-BURST_MS])).rows;
  if(recent[0]&&now-Number(recent[0].created)<MIN_GAP_MS)fail('Slow down a little before sending again.',429);
  if(recent.length>=BURST)fail('You are sending messages too quickly. Wait a few seconds.',429);
  if(recent.some(row=>row.text===text))fail('You already sent that message.',429);
  await c.query('INSERT INTO ryo_chat(scope,channel,wallet,name,text,created) VALUES($1,$2,$3,$4,$5,$6)',[store.scope,ch,wallet,sender,text,now]);
  await prune(store,c,ch);
  return list(store,wallet,{channel:ch,after:Number.isSafeInteger(body.after)?body.after:0},c);
 });
}
async function prune(store,c,ch){await c.query('DELETE FROM ryo_chat WHERE scope=$1 AND channel=$2 AND id<=(SELECT id FROM ryo_chat WHERE scope=$1 AND channel=$2 ORDER BY id DESC OFFSET $3 LIMIT 1)',[store.scope,ch,KEEP])}
// Called inside the purchase settlement transaction, so only finalized summons and fusions are
// announced (a failed fusion attempt produces no hero), and the per-order ref makes a repeated
// settlement a no-op.
const VERB={summon:'summoned',fusion:'fused'};
async function announceLegends(store,c,wallet,row){
 const verb=VERB[row?.product],legends=verb?(row.result?.outputs||[]).filter(hero=>hero&&hero.rank===4):[];
 if(!legends.length)return;
 const last=(await c.query("SELECT name FROM ryo_chat WHERE scope=$1 AND wallet=$2 AND channel='global' ORDER BY id DESC LIMIT 1",[store.scope,wallet])).rows[0];
 const who=(last?.name||'A shinobi')+' ('+short(wallet)+')',names=legends.map(hero=>String(hero.name).slice(0,40)).join(', ');
 const text=legends.length===1?'⭐ '+who+' '+verb+' a LEGEND: '+names+'!':'⭐ '+who+' '+verb+' '+legends.length+' LEGENDS: '+names+'!';
 await c.query("INSERT INTO ryo_chat(scope,channel,wallet,name,text,created,ref) VALUES($1,'system',$2,'System',$3,$4,$5) ON CONFLICT DO NOTHING",[store.scope,wallet,text,store.now(),row.product+':'+row.request_id]);
 await prune(store,c,'system');
}
// A signed-in player reports a Global message for staff review. The report stores a snapshot of the
// message, so the evidence survives retention pruning. Reporting never hides anything by itself.
function details(value){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string')fail('Report details must be text.');
 const v=value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g,' ').replace(/\s+/g,' ').trim();
 if([...v].length>300)fail('Report details can be up to 300 characters.');
 return v||null;
}
async function report(store,wallet,body){
 const id=body.messageId;if(!Number.isSafeInteger(id)||id<1)fail('Choose a message to report.');
 if(!REPORT_CATEGORIES.includes(body.category))fail('Choose a report reason.');
 const note=details(body.details);
 return store.transaction(async c=>{
  await store.locked(c,wallet);const now=store.now();
  const m=(await c.query("SELECT id,wallet,name,text,created,hidden FROM ryo_chat WHERE scope=$1 AND id=$2 AND channel='global'",[store.scope,id])).rows[0];
  if(!m)fail('That message is no longer available to report.',404);
  if(m.wallet===wallet)fail('You cannot report your own message.');
  if(m.hidden!==null&&m.hidden!==undefined)return {reported:false,status:'removed'};
  const recent=Number((await c.query('SELECT COUNT(*) AS n FROM ryo_cc_chat_reports WHERE scope=$1 AND reporter=$2 AND created>$3',[store.scope,wallet,now-REPORT_WINDOW_MS])).rows[0].n);
  if(recent>=REPORT_LIMIT)fail('You have sent many reports recently. Please wait before reporting again.',429);
  const r=await c.query('INSERT INTO ryo_cc_chat_reports(scope,message_id,reporter,category,details,target_wallet,snapshot_name,snapshot_text,message_created,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id',[store.scope,id,wallet,body.category,note,m.wallet,m.name,m.text,m.created,now]);
  return {reported:r.rows.length===1,status:r.rows.length?'received':'duplicate'};
 });
}
function handle(store,wallet,action,body){return action==='chat-send'?send(store,wallet,body):list(store,wallet,body)}
module.exports={handle,report,announceLegends,prune,clean,name,standing,MAX_TEXT,KEEP,PAGE,REPORT_CATEGORIES};
