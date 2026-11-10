'use strict';
/* Mythic Box perk after an NFT transfer (review finding 2026-11-11): when a box NFT moves to another wallet, the new holder's sync
 * takes Tsukiyomi from the previous holder, and the previous holder now also loses the Mythic Box 10% perk at once (unless it still
 * holds another box hero). Before, the perk stayed on the old wallet until its own next sync. Isolated PGlite fixtures only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), mythic = require('../app/server/mythic-hero.cjs'), economy = require('../app/server/economy.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(); const now = Date.UTC(2026, 10, 11, 12);
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'mythic-perk-test', () => now);
  const profile = w => store.profile(w), boxHeroes = async w => (await profile(w)).heroes.filter(h => h.tokenId.startsWith('mythic-')).map(h => h.tokenId);
  const quote = async w => economy.quote(await profile(w), 'summon', { quantity: 1 }).total;
  const A = address(), B = address(), C = address(), M1 = address(), M2 = address();

  await mythic.apply(store, A, [M1]);
  assert.equal((await profile(A)).mythicPerk, true); assert.deepEqual(await boxHeroes(A), ['mythic-' + M1]); assert.equal(await quote(A), 22500, 'holder pays 10% less');
  // The NFT moves to B; only B syncs (A's own sync never runs, e.g. its RPC check keeps failing).
  await mythic.apply(store, B, [M1]);
  assert.deepEqual(await boxHeroes(B), ['mythic-' + M1]); assert.equal((await profile(B)).mythicPerk, true);
  assert.deepEqual(await boxHeroes(A), [], 'Tsukiyomi leaves the old wallet');
  assert.equal((await profile(A)).mythicPerk, false, 'and so does the Mythic Box perk'); assert.equal(await quote(A), 25000, 'the old wallet pays the regular price');
  // A previous holder with another box keeps the perk.
  await mythic.apply(store, C, [M2]); await mythic.apply(store, C, [M2, M1]);   // C now holds both (M1 came from B)
  assert.equal((await profile(B)).mythicPerk, false, 'B lost its only box');
  await mythic.apply(store, A, [M2]);   // M2 moves to A; C still holds M1
  assert.equal((await profile(C)).mythicPerk, true, 'C still holds another box: the perk stays');
  assert.deepEqual(await boxHeroes(C), ['mythic-' + M1]);
  assert.equal((await profile(A)).mythicPerk, true);
  await db.close();
  console.log('PASS: Mythic Box perk follows the NFT — a previous holder loses Tsukiyomi and the 10% perk at the new holder\'s sync unless it still holds another box.');
})().catch(e => { console.error(e); process.exitCode = 1; });
