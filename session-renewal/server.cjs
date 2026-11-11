/* Wallet sessions that stay signed in while the player is playing (owner request 2026-11-11: players were signed out
 * mid-game because every session ended exactly 1 hour after the wallet signature, however active the player was).
 *
 * Rules (server-enforced; the browser cannot extend anything):
 *  - a new session lasts 1 hour, as before;
 *  - any authenticated request made while less than 30 minutes remain extends it to 1 hour from that request;
 *  - never beyond 24 hours after the wallet signature (`created`); after that a new signature is required;
 *  - an expired session is never revived (only rows with expires > now are read or extended).
 * Sessions created before this column existed (created NULL) count from their original sign-in, expires - 1 hour.
 * The open game reports to the server every 15 s (Chest sync), so an open, signed-in game keeps its session.
 * Built by apply-session-renewal.cjs into app/server/session-renewal.cjs; store.cjs authenticate() calls it. */
'use strict';
const SESSION_MS = 3600000, RENEW_BELOW_MS = 30 * 60000, MAX_MS = 24 * 3600000;
const SCHEMA = 'ALTER TABLE ryo_sessions ADD COLUMN IF NOT EXISTS created BIGINT;';

async function authenticate(store, token, hash, fail) {
  if (typeof token !== 'string' || token.length > 100) fail('Sign in with your wallet.', 401);
  const now = store.now(), key = hash(token);
  const row = (await store.pool.query('SELECT wallet,expires,created FROM ryo_sessions WHERE scope=$1 AND token_hash=$2 AND expires>$3', [store.scope, key, now])).rows[0];
  if (!row) fail('Wallet session expired. Sign in again.', 401);
  const expires = Number(row.expires), signedIn = row.created == null ? expires - SESSION_MS : Number(row.created);
  const next = Math.min(now + SESSION_MS, signedIn + MAX_MS);
  if (expires - now < RENEW_BELOW_MS && next > expires) {
    // GREATEST: concurrent requests never shorten a session; the expires>now guard never revives an expired one.
    // A failed extension does not fail this (validly authenticated) request; the next request tries again.
    try {
      await store.pool.query('UPDATE ryo_sessions SET expires=GREATEST(expires,$4),created=COALESCE(created,$5) WHERE scope=$1 AND token_hash=$2 AND expires>$3', [store.scope, key, now, next, signedIn]);
    } catch (e) { console.warn('Wallet session extension failed:', e && e.message); }
  }
  return row.wallet;
}

module.exports = { authenticate, SCHEMA, SESSION_MS, RENEW_BELOW_MS, MAX_MS };
