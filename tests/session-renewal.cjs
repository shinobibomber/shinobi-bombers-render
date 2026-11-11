/* Wallet sessions stay signed in while used, up to 24 hours (owner request 2026-11-11). Real Store + schema on an
 * in-memory Postgres (PGlite) with a controlled clock; no external service. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { Store } = require('../app/server/store.cjs');
const R = require('../app/server/session-renewal.cjs');
const H = 3600000, MIN = 60000, hash = t => crypto.createHash('sha256').update(t).digest('hex');
const WALLET = '7jY9NvNLhJQYi4fEB1qp1z8BjQmWKnC8EZaMgbRy3D6X';

(async () => {
  const db = new PGlite(), schema = fs.readFileSync(path.join(__dirname, '../app/server/schema.sql'), 'utf8');
  await db.exec(schema); await db.exec(schema); // re-running the schema (every build) is safe
  let now = 1_800_000_000_000, failUpdate = false;
  const pool = {
    query: (q, a) => { if (failUpdate && /^UPDATE ryo_sessions/.test(q)) return Promise.reject(Error('simulated database failure')); return db.query(q, a); },
    async connect() { return { query: (q, a) => db.query(q, a), release() {} }; },
  };
  const store = new Store(pool, 'session-test', () => now), other = new Store(pool, 'other-scope', () => now);
  const row = async token => (await db.query('SELECT expires,created FROM ryo_sessions WHERE scope=$1 AND token_hash=$2', ['session-test', hash(token)])).rows[0];
  const status = async (token, s = store) => { try { await s.authenticate(token); return 200; } catch (e) { return e.status; } };
  async function signIn() {
    await db.query('INSERT INTO ryo_challenges(scope,wallet,nonce,message,expires,created) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(scope,wallet) DO UPDATE SET nonce=$3,message=$4,expires=$5,created=$6', ['session-test', WALLET, 'n' + now, 'msg', now + 120000, now - 10000]);
    return (await store.login(WALLET, 'n' + now, () => true)).token;
  }

  // 1. A new session lasts 1 hour and records when the wallet signed.
  const t0 = now, token = await signIn();
  assert.deepEqual([Number((await row(token)).expires), Number((await row(token)).created)], [t0 + H, t0]);

  // 2. More than 30 minutes left: used, not extended (no write on every request).
  now = t0 + 20 * MIN; assert.equal(await store.authenticate(token), WALLET);
  assert.equal(Number((await row(token)).expires), t0 + H, 'not extended while more than 30 minutes remain');

  // 3. Less than 30 minutes left: extended to 1 hour from this request.
  now = t0 + 40 * MIN; assert.equal(await store.authenticate(token), WALLET);
  assert.equal(Number((await row(token)).expires), now + H, 'extended to 1 hour from the request');

  // 4. Playing for many hours: always signed in, never beyond 24 hours after the signature.
  for (now = t0 + 40 * MIN; now < t0 + 24 * H; now += 15 * MIN) {
    assert.equal(await status(token), 200, 'signed in at +' + (now - t0) / MIN + ' min');
    assert(Number((await row(token)).expires) <= t0 + 24 * H, 'never beyond the 24-hour maximum');
  }
  assert.equal(Number((await row(token)).expires), t0 + 24 * H, 'ends exactly 24 hours after signing');
  now = t0 + 24 * H; assert.equal(await status(token), 401, 'a new signature is required after 24 hours');
  now = t0 + 24 * H + 5 * MIN; assert.equal(await status(token), 401);

  // 5. An idle session expires after 1 hour and is never revived.
  now = t0 + 30 * H; const idle = await signIn(), t1 = now;
  now = t1 + H; assert.equal(await status(idle), 401, 'expired at exactly 1 hour without use');
  assert.equal(Number((await row(idle)).expires), t1 + H, 'an expired session is not extended');
  now = t1 + H + 1; assert.equal(await status(idle), 401);

  // 6. Sessions created before the column existed count from their original sign-in (expires - 1 hour).
  const legacy = 'legacy-session-token', t2 = now; await db.query('INSERT INTO ryo_sessions(scope,token_hash,wallet,expires) VALUES($1,$2,$3,$4)', ['session-test', hash(legacy), WALLET, t2 + H]);
  now = t2 + 45 * MIN; assert.equal(await status(legacy), 200);
  assert.deepEqual([Number((await row(legacy)).expires), Number((await row(legacy)).created)], [now + H, t2], 'legacy session extended, sign-in time recorded');
  for (; now < t2 + 24 * H; now += 20 * MIN) assert.equal(await status(legacy), 200);
  assert.equal(Number((await row(legacy)).expires), t2 + 24 * H);
  now = t2 + 24 * H; assert.equal(await status(legacy), 401, 'legacy session also ends 24 hours after its sign-in');

  // 7. A failed extension does not fail the request; the next request extends it.
  now = t2 + 30 * H; const flaky = await signIn(), t3 = now;
  now = t3 + 50 * MIN; failUpdate = true; assert.equal(await store.authenticate(flaky), WALLET, 'still authenticated');
  assert.equal(Number((await row(flaky)).expires), t3 + H); failUpdate = false;
  now = t3 + 51 * MIN; await store.authenticate(flaky); assert.equal(Number((await row(flaky)).expires), now + H);

  // 8. Concurrent requests never shorten a session; scope and token are still enforced.
  const before = Number((await row(flaky)).expires);
  await db.query('UPDATE ryo_sessions SET expires=$3 WHERE scope=$1 AND token_hash=$2', ['session-test', hash(flaky), before + 10 * MIN]);
  now = before - 25 * MIN; await store.authenticate(flaky); assert.equal(Number((await row(flaky)).expires), before + 10 * MIN, 'a later expiry is kept');
  assert.equal(await status(flaky, other), 401, 'another scope cannot use the session');
  assert.equal(await status('unknown-token'), 401); assert.equal(await status('x'.repeat(101)), 401); assert.equal(await status(null), 401);

  // 9. Module limits as approved by the owner.
  assert.deepEqual([R.SESSION_MS, R.RENEW_BELOW_MS, R.MAX_MS], [H, 30 * MIN, 24 * H]);
  await db.close();
  console.log('PASS: sessions extend while used (1 h, renewed below 30 min), end 24 h after signing, idle sessions expire and are never revived; legacy sessions, failed extensions and scope handled.');
})().catch(e => { console.error(e); process.exit(1); });
