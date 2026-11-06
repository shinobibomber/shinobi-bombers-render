/* Test-server Starter Pack on the real store (in-memory Postgres): off unless STARTER_PACK=on; once per
 * account; a brand-new account holds exactly the 15 pack heroes (1 Mythic Tsukiyomi without an NFT,
 * Legend, Elite, Jonin, Chunin, 10 Genin) while an existing account keeps its heroes; 10,000,000
 * starter Ryo pays for summons, the Boss Hunt entry and Market buys/offers with no on-chain transaction
 * and no reward-pool income, offer refunds return to the starter pot, and withdrawals never use it. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../app/server');
const economy = require(path.join(root, 'economy.cjs')), { Store } = require(path.join(root, 'store.cjs'));
const starter = require(path.join(root, 'starter-pack.cjs')), market = require(path.join(root, 'market.cjs')), hunt = require(path.join(root, 'boss-hunt.cjs'));
const ON = { STARTER_PACK: 'on' }, never = async () => { throw Error('A starter-funded purchase must not build an on-chain transaction.'); };

(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  const store = new Store(pool, 'test-starter', () => Date.now());
  const acct = async w => { const r = (await db.query('SELECT balance,bonus FROM ryo_accounts WHERE scope=$1 AND wallet=$2', [store.scope, w])).rows[0]; return { balance: String(r.balance), bonus: String(r.bonus) }; };
  const ranks = p => p.heroes.map(h => h.rank).sort((a, b) => b - a);

  // Off unless enabled.
  await store.profile('newbie');
  assert.equal(await starter.grant(store, 'newbie', {}), null); assert.equal((await store.profile('newbie')).heroes.length, 2);
  // A brand-new account: exactly the 15 pack heroes and 10,000,000 starter Ryo, once.
  assert.deepEqual(await starter.grant(store, 'newbie', ON), { heroes: 15, bonus: 10000000 });
  let p = await store.profile('newbie');
  assert.deepEqual(ranks(p), [5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const tsu = p.heroes.find(h => h.rank === 5);
  assert.deepEqual([tsu.name, tsu.mythic, tsu.starter, 'nft' in tsu, tsu.perks.length], ['Tsukiyomi', 'tsukiyomi', true, false, 6], 'a non-NFT starter Tsukiyomi');
  assert.equal(p.battleReady.length, 15); assert.equal(p.mythicPerk, undefined, 'no holder discount');
  assert.deepEqual(await acct('newbie'), { balance: '0', bonus: '10000000' });
  assert.equal(await starter.grant(store, 'newbie', ON), null, 'only once');
  assert.equal((await store.profile('newbie')).heroes.length, 15);
  // An existing account keeps its heroes and gains the pack.
  await store.transaction(async c => { await store.locked(c, 'veteran'); const prof = await store.profileLocked(c, 'veteran'); prof.dojo = 2; await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, 'veteran', JSON.stringify(prof)]); await c.query('UPDATE ryo_accounts SET balance=500000 WHERE scope=$1 AND wallet=$2', [store.scope, 'veteran']); });
  await starter.grant(store, 'veteran', ON);
  assert.equal((await store.profile('veteran')).heroes.length, 17);
  assert.deepEqual(await acct('veteran'), { balance: '500000', bonus: '10000000' });

  // Summon paid with starter Ryo: no chain transaction, starter pot debited, balance untouched.
  let q = economy.quote(await store.profile('veteran'), 'summon', { quantity: 5 });
  const row = await store.purchase('veteran', 'starter-summon-0001', 'summon', { quantity: 5 }, q.total, never);
  assert.equal(row.quote.funding, 'bonus'); assert.match(row.signature, /^bonus:/);
  assert.deepEqual(await acct('veteran'), { balance: '500000', bonus: String(10000000 - q.total) });
  await store.settlePurchase('veteran', 'starter-summon-0001', 'confirmed');
  assert.equal((await store.profile('veteran')).heroes.length, 22, 'the summoned heroes arrive');
  // Reward-pool income ignores starter-funded purchases.
  const income = (await db.query("SELECT COALESCE(SUM((quote->>'operations')::numeric),0) AS n FROM ryo_purchases WHERE scope=$1 AND status='confirmed' AND COALESCE(quote->>'funding','')<>'bonus'", [store.scope])).rows[0].n;
  assert.equal(Number(income), 0); assert.match(fs.readFileSync(path.join(root, 'adventure.cjs'), 'utf8'), /COALESCE\(quote->>'funding',''\)<>'bonus'/);
  assert.match(fs.readFileSync(path.join(root, 'service.cjs'), 'utf8'), /row\.quote\?\.funding==='bonus'\)return publicOperation\(await settle\('confirmed'\)/);
  // A purchase larger than the starter pot falls back to the deposited balance (with its on-chain transaction).
  await db.query('UPDATE ryo_accounts SET bonus=1000 WHERE scope=$1 AND wallet=$2', [store.scope, 'veteran']);
  q = economy.quote(await store.profile('veteran'), 'summon', { quantity: 1 });
  let prepared = 0;
  const paid = await store.purchase('veteran', 'starter-summon-0002', 'summon', { quantity: 1 }, q.total, async () => { prepared++; return { signature: 'S'.repeat(88), wire: 'd2lyZQ==', lastHeight: 1 }; });
  assert.deepEqual([prepared, paid.quote.funding, (await acct('veteran')).balance], [1, undefined, String(500000 - q.total)]);
  await store.settlePurchase('veteran', 'starter-summon-0002', 'confirmed');
  await db.query('UPDATE ryo_accounts SET bonus=10000000 WHERE scope=$1 AND wallet=$2', [store.scope, 'veteran']);

  // Boss Hunt entry with starter Ryo: no chain transaction.
  await hunt.beforeEnter(store, 'newbie');
  const entry = await store.purchase('newbie', 'starter-hunt-00001', 'hunt', {}, hunt.FEE, never);
  assert.equal(entry.quote.funding, 'bonus'); await hunt.record(store, 'newbie', entry, { name: '' });
  await store.settlePurchase('newbie', 'starter-hunt-00001', 'confirmed'); // the service settles starter rows at once
  assert.equal((await acct('newbie')).bonus, String(10000000 - hunt.FEE));

  // Market: offers held in starter Ryo return to it; a starter-funded buy has no chain transaction.
  const sellerHero = (await store.profile('veteran')).heroes.find(h => h.rank === 2);
  const listed = await market.handle(store, 'veteran', 'market-post', { heroId: sellerHero.tokenId, price: 200000 });
  const listingId = listed.listing?.id || listed.id || (await db.query("SELECT id FROM ryo_market_listings WHERE scope=$1 AND status='active'", [store.scope])).rows[0].id;
  const before = Number((await acct('newbie')).bonus);
  const off = await market.handle(store, 'newbie', 'market-offer', { listingId, amount: 150000 });
  assert.equal(Number((await acct('newbie')).bonus), before - 150000);
  assert.equal((await db.query('SELECT funding FROM ryo_market_offers WHERE scope=$1 AND id=$2', [store.scope, off.offer.id])).rows[0].funding, 'bonus');
  await market.handle(store, 'newbie', 'market-offer-cancel', { offerId: off.offer.id });
  assert.equal(Number((await acct('newbie')).bonus), before, 'the cancelled offer returns to the starter pot');
  const bought = await market.buy(store, 'newbie', 'starter-market-0001', { listingId, expectedPrice: 200000 }, never);
  assert.equal(bought.quote.funding, 'bonus'); assert.equal(Number((await acct('newbie')).bonus), before - 200000);
  const sellerBefore = Number((await acct('veteran')).balance);
  await store.settlePurchase('newbie', 'starter-market-0001', 'confirmed');
  assert.equal(Number((await acct('veteran')).balance), sellerBefore + Number(bought.quote.seller), 'the seller is paid as usual');
  assert((await store.profile('newbie')).heroes.some(h => h.tokenId === sellerHero.tokenId));

  // Withdrawals never touch starter Ryo.
  await assert.rejects(store.reserve('newbie', 'starter-withdraw-01', 100000, never), /balance|Ryo/i);
  const stats = await starter.stats(store);
  assert.deepEqual([stats.accounts, stats.spent > 0, stats.outstanding > 0], [2, true, true]);
  console.log('PASS: Starter Pack: off unless STARTER_PACK=on, once per account, 15 heroes (non-NFT Tsukiyomi) and 10,000,000 starter Ryo; starter Ryo pays summons, the Boss Hunt entry and Market buys/offers without on-chain transactions or reward-pool income, refunds return to it, larger prices fall back to the balance, and withdrawals never use it.');
})().catch(e => { console.error(e); process.exit(1); });
