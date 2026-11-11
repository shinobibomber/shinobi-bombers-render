'use strict';
/* Mistyped referral links (owner report 2026-11-10: players used ".../?referral=RP...AA2AMythic" instead of ".../?referral=RP...AA2A").
 * Prevention: a code that is a real "RP" + 20 hex code plus up to 10 trailing characters resolves to the real code, for player links and
 * for an approved creator's player link; an unknown prefix or a longer / odd suffix still fails; exact codes are unchanged.
 * Repair: tools/fix-referral-attribution.cjs lists sign-ups with no referrer and attributes the named ones through the game's own
 * attribute(), so every normal rule still applies (new players only, permanent attribution, creators, self). Isolated fixtures only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite'), web3 = require('../app/node_modules/@solana/web3.js');
const { Store } = require('../app/server/store.cjs'), cp = require('../app/server/creators-portal.cjs');
const tool = require('../tools/fix-referral-attribution.cjs');
const address = () => web3.Keypair.generate().publicKey.toBase58();
(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8'));
  let tail = Promise.resolve(), now = Date.UTC(2026, 10, 10, 12);
  const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new Store(pool, 'referral-typo-test', () => now), origin = 'https://shinobi.example';
  process.env.CREATORS_PORTAL_ENABLED = 'on';
  const call = (wallet, action, body = {}) => cp.handle({ store, origin }, wallet, action, body);
  const rows = async (s, a = []) => (await pool.query(s, [store.scope, ...a])).rows;
  const referrerOf = async w => (await rows('SELECT referrer FROM ryo_player_referrals WHERE scope=$1 AND wallet=$2', [w]))[0]?.referrer || null;
  const player = async (name, wallet = address()) => { await pool.query("INSERT INTO ryo_players(scope,wallet,player_id,username,username_key,created,last_login) VALUES($1,$2,$3,$4,$5,$6,$6)", [store.scope, wallet, crypto.randomUUID(), name, name.toLowerCase(), now]); now += 1000; return wallet; };

  const owner = address(), real = (await call(owner, 'creator-player-state')).code;
  assert.match(real, /^RP[0-9A-F]{20}$/);

  /* ---------- Prevention ---------- */
  const a = address(); await call(a, 'creator-attribute', { code: real + 'Mythic' });
  assert.equal(await referrerOf(a), owner, 'the typo link (real code + "Mythic") attributes to the real owner');
  const b = address(); await call(b, 'creator-attribute', { code: real.toLowerCase() + 'mythic' });
  assert.equal(await referrerOf(b), owner, 'lower case is the same');
  const c = address(); await call(c, 'creator-attribute', { code: real });
  assert.equal(await referrerOf(c), owner, 'the exact code is unchanged');
  const unknown = 'RP' + crypto.randomBytes(10).toString('hex').toUpperCase() + 'MYTHIC';
  await assert.rejects(call(address(), 'creator-attribute', { code: unknown }), /unavailable/, 'an unknown prefix still fails');
  await assert.rejects(call(address(), 'creator-attribute', { code: real + '-MYTHIC' }), /unavailable/i, 'a suffix with other characters is not guessed');
  await assert.rejects(call(address(), 'creator-attribute', { code: real + 'ABCDEFGHIJK' }), /between 1 and 32/, 'input over 32 characters is refused outright (the 10-character suffix limit leaves no room beyond it)');
  const other = address(), otherCode = (await call(other, 'creator-player-state')).code;
  const d = address(); await call(d, 'creator-attribute', { code: otherCode + 'X' });
  assert.equal(await referrerOf(d), other, 'each owner is resolved by its own prefix');
  // Permanent attribution is unchanged: a typo link cannot move an already attributed player.
  await assert.rejects(call(a, 'creator-attribute', { code: otherCode + 'MYTHIC' }), /permanent/);
  // A creator's player link with a typo still enrolls the player in the Creator Program (same as the exact link).
  const admin = address(); process.env.RYO_ADMIN_APPROVERS = admin;
  await cp.adminAction(store, admin, { operation: 'manual-add', wallet: admin, displayName: 'Creator', reason: 'fixture creator' }); await call(admin, 'creator-terms', { terms: true });
  const creatorLink = (await call(admin, 'creator-player-state')).code, e = address();
  await call(e, 'creator-attribute', { code: creatorLink + 'MYTHIC' });
  assert.equal(Number((await rows('SELECT COUNT(*) AS n FROM ryo_creator_referrals WHERE scope=$1 AND wallet=$2', [e]))[0].n), 1, 'a creator link with a typo enrolls the player as a creator referral');

  /* ---------- Repair tool ---------- */
  assert.equal(tool.codeOf('https://shinobibombers.fun/?referral=RP009D06A47C922627AA2AMythic'), 'RP009D06A47C922627AA2A', 'a pasted link (even the typo link) gives the real code');
  assert.equal(tool.codeOf('rp009d06a47c922627aa2a'), 'RP009D06A47C922627AA2A'); assert.equal(tool.codeOf('nonsense'), null);
  const t1 = await player('Hikari'), t2 = await player('Kuro'), t3 = await player('Aoi'), t4 = await player('Ren'), t5 = await player('Sora');
  await pool.query("INSERT INTO ryo_adventures(scope,wallet,data) VALUES($1,$2,$3)", [store.scope, t3, JSON.stringify({ kills: 5, pending: 0 })]);   // Aoi already played
  await call(t2, 'creator-attribute', { code: otherCode });   // Kuro already has another referrer
  const list = await tool.unreferred(store, 0), names = list.map(x => x.username);
  assert(names.includes('Hikari') && names.includes('Aoi') && names.includes('Ren') && names.includes('Sora'), 'unreferred sign-ups are listed: ' + names);
  assert(!names.includes('Kuro'), 'a referred player is not listed'); assert.equal(list[0].username, 'Sora', 'newest first');
  assert.deepEqual((await tool.unreferred(store, now - 2500)).map(x => x.username), ['Sora', 'Ren'], '--since filters');
  const resolved = await tool.resolve(store, { usernames: ['hikari', 'Nobody'], wallets: [t4, 'bad'] });
  assert.equal(resolved[0].wallet, t1); assert(resolved[1].error); assert.equal(resolved[2].username, 'Ren'); assert(resolved[3].error);
  assert.equal((await tool.status(store, t1, real)).state, 'ready');
  assert.equal((await tool.status(store, t2, real)).state, 'blocked', 'already attributed to another referrer (permanent)');
  assert.equal((await tool.status(store, t3, real)).state, 'blocked', 'has Adventure progress: the game only attributes new players');
  assert.equal((await tool.status(store, owner, real)).state === 'ready', true, 'status alone does not check self (the game does when applying)');
  assert.equal((await tool.status(store, a, real)).state, 'done', 'already attributed to this referrer'); assert.equal((await tool.status(store, t1, 'RP' + '0'.repeat(20))).state, 'blocked');
  // The game's own attribute() is what the tool applies, so its rules hold: self is refused, a ready player is attributed once.
  await assert.rejects(cp.attribute(store, owner, { code: real }), /yourself/);
  await cp.attribute(store, t1, { code: real }); assert.equal(await referrerOf(t1), owner);
  assert.equal((await tool.status(store, t1, real)).state, 'done'); assert(!(await tool.unreferred(store, 0)).map(x => x.username).includes('Hikari'), 'a repaired player leaves the list');
  await assert.rejects(call(t1, 'creator-attribute', { code: otherCode }), /permanent/, 'the repaired attribution is permanent too');
  await db.close();
  console.log('PASS: mistyped referral links — a real code plus trailing characters resolves to the real owner (players and approved creators), unknown or long suffixes still fail, attribution stays permanent; the repair tool lists sign-ups without a referrer and applies the game\'s own rules.');
})().catch(e => { console.error(e); process.exitCode = 1; });
