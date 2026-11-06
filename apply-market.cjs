/* Player Market build step: copies market/server.cjs to app/server/market.cjs, adds its table, and
 * wires it into the game server (actions, expiry sweep on state, purchase settlement) and the game
 * client (RyoPayments.market / marketBuy). Exact-string hooks; preservation reverses marketPatches. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const serviceHooks = [
  ["  if(action==='chat-list'||action==='chat-send')return require('./chat.cjs').handle(store,wallet,action,body);",
   "  if(action==='market-buy'){await checkMint();const id=requestId(body.requestId);const row=await require('./market.cjs').buy(store,wallet,id,body,async q=>{\n    const available=await connection.getTokenAccountBalance(treasuryAta,'finalized');if(BigInt(available.value.amount)<BigInt(q.studioFee+q.treasury)*UNIT)fail('Custody tokens are temporarily unavailable.',503);\n    return signedTransaction([...transferTo(studioAddress,BigInt(q.studioFee)*UNIT),...transferTo(revenueAddress,BigInt(q.treasury)*UNIT),memo('shinobi-market-v1:'+id)]);\n   });await progress(row,'purchase');const data=await state(wallet);return {purchase:publicOperation(data.purchases.find(r=>r.request_id===id)||row,'purchase'),...data}}\n  if(action==='market-accept'){await checkMint();const id=requestId(body.requestId);const row=await require('./market.cjs').accept(store,wallet,id,body,async q=>{\n    const available=await connection.getTokenAccountBalance(treasuryAta,'finalized');if(BigInt(available.value.amount)<BigInt(q.studioFee+q.treasury)*UNIT)fail('Custody tokens are temporarily unavailable.',503);\n    return signedTransaction([...transferTo(studioAddress,BigInt(q.studioFee)*UNIT),...transferTo(revenueAddress,BigInt(q.treasury)*UNIT),memo('shinobi-market-v1:'+id)]);\n   });const sale=await progress(row,'purchase');return {sale,...await require('./market.cjs').handle(store,wallet,'market-mine',{}),...await state(wallet)}}\n  if(typeof action==='string'&&action.startsWith('market-')){const result=await require('./market.cjs').handle(store,wallet,action,body);return ['market-post','market-cancel','market-offer','market-offer-cancel','market-offer-decline'].includes(action)?{...result,...await state(wallet)}:result}\n  if(action==='chat-list'||action==='chat-send')return require('./chat.cjs').handle(store,wallet,action,body);"],
  ['async function state(wallet){await checkNetwork();', "async function state(wallet){await checkNetwork();await require('./market.cjs').sweep(store,wallet);"]
];
const storeHook = ["if(status==='confirmed')await require('./chat.cjs').announceLegends(this,c,wallet,row);return {...row,status}",
  "if(status==='confirmed')await require('./chat.cjs').announceLegends(this,c,wallet,row);if(row.product==='market')await require('./market.cjs').settled(this,c,row,status);return {...row,status}"];
// Client API. Exported so tests/preservation.cjs can reverse it.
const marketPatches = [
  // A bought hero is already known, so it joins the collection without the summon reveal.
  ["const outputs=(result?.outputs||[]).map(d=>S.h.find(h=>h.tokenId===d.tokenId&&h.tokenOwner===p.account)).filter(Boolean);",
   "const outputs=result?.product==='market'?[]:(result?.outputs||[]).map(d=>S.h.find(h=>h.tokenId===d.tokenId&&h.tokenOwner===p.account)).filter(Boolean);"],
  ["window.RyoPayments={chat:", "window.RyoPayments={market:(action,body={})=>{if(!['market-browse','market-mine','market-post','market-cancel','market-offer','market-offer-cancel','market-offer-decline','market-accept'].includes(action))throw Error('Unknown Market action.');return ['market-browse','market-mine'].includes(action)?api(action,body):run(async()=>{const data=await api(action,{...body,active:!document.hidden&&!window.LoginScreen?.active});accept(data);return data})},marketBuy:listing=>run(async()=>{const data=await api('market-buy',{listingId:listing.id,expectedPrice:listing.price,requestId:crypto.randomUUID()});accept(data);return data.purchase}),chat:"]
];
function replaceOnce(text, [before, after], label) { if (text.includes(after)) return text; if (text.split(before).length !== 2) throw Error('Market patch mismatch: ' + label); return text.replace(before, () => after); }
function applyMarket(appDir = path.join(__dirname, 'app')) {
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(__dirname, 'market/server.cjs'), path.join(server, 'market.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Market v1')) fs.appendFileSync(schema, '\n-- Market v1\n' + require('./market/server.cjs').SCHEMA + '\n');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Market offers v1')) fs.appendFileSync(schema, '\n-- Market offers v1\n' + require('./market/server.cjs').OFFER_SCHEMA + '\n');
  const service = path.join(server, 'service.cjs'); let text = fs.readFileSync(service, 'utf8');
  serviceHooks.forEach((hook, i) => { text = replaceOnce(text, hook, 'service ' + i); }); fs.writeFileSync(service, text);
  const store = path.join(server, 'store.cjs'); fs.writeFileSync(store, replaceOnce(fs.readFileSync(store, 'utf8'), storeHook, 'store settlement'));
  const index = path.join(appDir, 'public/index.html'); fs.writeFileSync(index, marketPatches.reduce((html, hook, i) => replaceOnce(html, hook, 'client ' + i), fs.readFileSync(index, 'utf8')));
  console.log('Player Market applied: hero listings, purchases through token checkout, 80/10/8/2 split.');
}
module.exports = { applyMarket, marketPatches, serviceHooks, storeHook };
if (require.main === module) applyMarket();
