/* Test-server Starter Pack build step (after apply-mythic-box): the starter-pack module and its table,
 * starter Ryo (ryo_accounts.bonus) spending in token purchases without an on-chain transaction, the
 * grant in state(), reward-pool income without starter-funded purchases, and the client's spendable
 * balance. Enabled only with STARTER_PACK=on. Exact-string hooks; preservation reverses starterPatches. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const starterPatches = [
  ['h.nft=descriptor.nft||null;', 'h.nft=descriptor.nft||null;h.starter=descriptor.starter===true;', 1],
  ['state.balance=data.balance;', 'state.balance=data.balance;state.bonus=Number(data.bonus)||0;', 1],
  ['available(){return window.RyoPayments?.state.authenticated?Number(RyoPayments.state.balance):0}', 'available(){return window.RyoPayments?.state.authenticated?Number(RyoPayments.state.balance)+(Number(RyoPayments.state.bonus)||0):0}', 1]
];
const storeHooks = [
  // The wallet lock also reads the starter pot, so every spender (purchases, Market) sees it.
  ["return (await client.query('SELECT balance FROM ryo_accounts WHERE scope=$1 AND wallet=$2 FOR UPDATE',[this.scope,wallet])).rows[0]}", "return (await client.query('SELECT balance,bonus FROM ryo_accounts WHERE scope=$1 AND wallet=$2 FOR UPDATE',[this.scope,wallet])).rows[0]}", 1],
  ["if(Number(account.balance)<q.total)fail('Not enough deposited Ryo, including the studio fee.');",
   "const bonusPaid=Number(account.bonus||0)>=q.total;if(bonusPaid)q.funding='bonus';else if(Number(account.balance)<q.total)fail('Not enough deposited Ryo, including the studio fee.');", 1],
  ["tx=await prepare(q);await c.query('UPDATE ryo_accounts SET balance=balance-$3 WHERE scope=$1 AND wallet=$2',[this.scope,wallet,q.total]);",
   "tx=bonusPaid?{signature:'bonus:'+wallet+':'+id,wire:'',lastHeight:0}:await prepare(q);await c.query(bonusPaid?'UPDATE ryo_accounts SET bonus=bonus-$3 WHERE scope=$1 AND wallet=$2':'UPDATE ryo_accounts SET balance=balance-$3 WHERE scope=$1 AND wallet=$2',[this.scope,wallet,q.total]);", 1]
];
const serviceHooks = [
  // Starter-funded purchases have no on-chain transaction: they settle at once.
  ["const settle=status=>kind==='purchase'?store.settlePurchase(row.wallet,row.request_id,status):store.settle(row.wallet,row.request_id,status);",
   "const settle=status=>kind==='purchase'?store.settlePurchase(row.wallet,row.request_id,status):store.settle(row.wallet,row.request_id,status);if(kind==='purchase'&&row.quote?.funding==='bonus')return publicOperation(await settle('confirmed'),kind);", 1],
  ["const result=await store.state(wallet);",
   "await require('./starter-pack.cjs').grant(store,wallet);const starterRyo=await require('./starter-pack.cjs').bonus(store,wallet);const result={...await store.state(wallet),...(starterRyo?{bonus:starterRyo}:{})};", 1]
];
const adventureHooks = [
  ["const income=(await c.query(\"SELECT COALESCE(SUM((quote->>'operations')::numeric),0) AS n FROM ryo_purchases WHERE scope=$1 AND status='confirmed'\",[store.scope])).rows[0];",
   "const income=(await c.query(\"SELECT COALESCE(SUM((quote->>'operations')::numeric),0) AS n FROM ryo_purchases WHERE scope=$1 AND status='confirmed' AND COALESCE(quote->>'funding','')<>'bonus'\",[store.scope])).rows[0];", 2]
];
function replaceCount(text, [before, after, count = 1], label) {
  if (text.split(after).length - 1 === count && (!text.includes(before) || after.includes(before))) return text;
  const n = text.split(before).length - 1; if (n !== count) throw Error('Starter Pack patch mismatch: ' + label + ' (' + n + ')');
  return text.split(before).join(after);
}
function applyStarterPack(appDir = path.join(__dirname, 'app')) {
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(__dirname, 'starter-pack/server.cjs'), path.join(server, 'starter-pack.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes('-- Starter pack v1')) fs.appendFileSync(schema, '\n-- Starter pack v1\n' + require('./starter-pack/server.cjs').SCHEMA + '\n');
  for (const [file, hooks] of [['store.cjs', storeHooks], ['service.cjs', serviceHooks], ['adventure.cjs', adventureHooks]]) {
    const p = path.join(server, file); fs.writeFileSync(p, hooks.reduce((t, h, i) => replaceCount(t, h, file + ' ' + i), fs.readFileSync(p, 'utf8')));
  }
  const index = path.join(appDir, 'public/index.html');
  fs.writeFileSync(index, starterPatches.reduce((t, h, i) => replaceCount(t, h, 'client ' + i), fs.readFileSync(index, 'utf8')));
  console.log('Starter pack applied: 15 heroes + 10,000,000 starter Ryo per account when STARTER_PACK=on (spend only, never withdrawn).');
}
module.exports = { applyStarterPack, starterPatches, storeHooks, serviceHooks, adventureHooks };
if (require.main === module) applyStarterPack();
