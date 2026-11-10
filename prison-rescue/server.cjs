/* Prison rescue (apply-prison-rescue.cjs copies this file to app/server/prison-rescue.cjs).
 *
 * Owner decisions 2026-11-10: freeing an Adventure prisoner (a kind-6 prison cage: the stage-25/50/75... commander or a rare
 * random cage) grants a real hero that the SERVER creates and stores in the player's profile, instead of the old browser-only
 * practice hero that vanished at the next sync. Every prison cage freed counts (no daily limit). Rules:
 *   - one hero per prison kill VERIFIED by the authoritative combat accounting (combat-adventure.cjs, per page session
 *     kills[4]: the hero's real Power, cooldown and chakra must cover the cage's 2,500 HP), never per click or per request;
 *   - granted only while actively playing Adventure: the wallet's current page session sent a report in the last 2 minutes;
 *   - cheat guard: maps are generated in the browser, so the server cannot see where cages are, and a modified client could
 *     label ordinary kills as prison kills. So two rescue heroes are at least MIN_DAMAGE of VERIFIED enemy damage apart
 *     (Genin..Legend enemies, i.e. kills[0..3] x their HP; how the kills are labelled does not matter, the damage is real).
 *     Honest play: about 54 enemies per map averaging ~324 HP, a commander cage every 25 maps and a random cage about every
 *     37 maps, so cages are normally ~260,000 HP apart. A prisoner freed sooner is not lost: it WAITS (at most MAX_WAITING)
 *     and is granted once enough damage is verified;
 *   - progress is tracked per page session id for every session the combat accounting still keeps (the last 4), so page
 *     reloads lose nothing; the client checks in once per page load;
 *   - rank odds = the Summoning Shrine's: Genin 60 / Chunin 25 / Jonin 10 / Elite 4 / Legend 1 (never Mythic);
 *   - the hero is account-bound (referralReward: Market listing refused, fusion keeps the binding), flagged prisonRescue
 *     (salvage refused by the apply-prison-rescue hook, so it cannot be turned into Upgrade Shards).
 * Nothing here touches Ryo, the Chest, the reward pool or any token: the kill -> Chest path is unchanged.
 *
 * One action, `prison-rescue {requestId}`, at most ONE hero per request. Normal outcomes are answered with a status (no
 * error), `waiting` (prisoners still to deliver) and `progress` (percent of the damage needed for the next one):
 *   granted (with the hero), early, unverified (no verified prison kill to use), inactive (no fresh Adventure session),
 *   full (500 heroes), pending (a purchase is settling). A replayed requestId returns the stored grant (other wallet: 409). */
'use strict';
const crypto = require('node:crypto');
const fail = (message, status) => require('./store.cjs').fail(message, status);   // lazy: the build reads SCHEMA from the source folder

const FRESH_MS = 2 * 60 * 1000, MIN_DAMAGE = 100000, MAX_WAITING = 3, MAX_HEROES = 500, PRISON = 4;
const ENEMY_HP = [100, 213, 1000, 1625];   // combat-adventure.cjs HP for kills[0..3]
// Cumulative thresholds out of 10,000 (same table as the Shrine summon in economy.cjs fulfill): 60 / 25 / 10 / 4 / 1 %.
const ODDS = [6000, 8500, 9500, 9900, 10000];
const rankFor = roll => ODDS.findIndex(limit => roll < limit);

const SCHEMA = `CREATE TABLE IF NOT EXISTS ryo_prison_rescues(scope TEXT NOT NULL,id TEXT NOT NULL,wallet TEXT NOT NULL,rank INTEGER NOT NULL,roll INTEGER NOT NULL,hero JSONB NOT NULL,session TEXT NOT NULL,created BIGINT NOT NULL,PRIMARY KEY(scope,id));
CREATE INDEX IF NOT EXISTS ryo_prison_rescues_wallet ON ryo_prison_rescues(scope,wallet,created);
CREATE TABLE IF NOT EXISTS ryo_prison_rescue_state(scope TEXT NOT NULL,wallet TEXT NOT NULL,seen JSONB NOT NULL DEFAULT '{}',waiting INTEGER NOT NULL DEFAULT 0,damage BIGINT NOT NULL DEFAULT 0,updated BIGINT NOT NULL,PRIMARY KEY(scope,wallet));`;

const rows = async (c, sql, args) => (await c.query(sql, args)).rows;
const count = n => (Number.isSafeInteger(n) && n > 0 ? n : 0);
/** Verified enemy damage (kills[0..3] x HP) and verified prison kills recorded for one Adventure page session. */
function totals(session) {
  let hp = 0, prison = 0;
  for (const v of Object.values(session?.heroes || {})) { const k = Array.isArray(v?.kills) ? v.kills : []; for (let i = 0; i < 4; i++) hp += count(k[i]) * ENEMY_HP[i]; prison += count(k[PRISON]); }
  return { hp, prison };
}
/** The wallet's CURRENT Adventure page session id, or null when it is not actively playing. */
function currentSession(adventure, now) {
  const d = adventure || {}, session = typeof d.sessionId === 'string' ? d.combatSessions?.[d.sessionId] : null;
  return d.active === true && session && now - Number(d.lastReport) <= FRESH_MS ? d.sessionId : null;
}
/** Folds new verified damage and prison kills of every kept page session into the state (each counted once). */
function fold(st, adventure) {
  const seen = {};
  for (const [id, session] of Object.entries(adventure?.combatSessions || {})) {
    const t = totals(session), was = st.seen[id] || { hp: 0, prison: 0 };
    st.damage += Math.max(0, t.hp - count(was.hp)); st.waiting += Math.max(0, t.prison - count(was.prison));
    seen[id] = t;
  }
  st.seen = seen; st.waiting = Math.min(st.waiting, MAX_WAITING);   // more is never honest play: the extra kills are dropped
}
const progress = st => Math.min(100, Math.floor(st.damage * 100 / MIN_DAMAGE));
const publicGrant = (row, st) => ({ status: 'granted', id: row.id, rank: Number(row.rank), hero: row.hero, created: Number(row.created), waiting: st ? st.waiting : 0, progress: st ? progress(st) : 0 });

async function claim(store, wallet, body = {}, { random = n => crypto.randomInt(n) } = {}) {
  const id = body && body.requestId;
  if (typeof id !== 'string' || !/^[-a-zA-Z0-9_]{16,80}$/.test(id)) fail('Invalid request ID.');
  return store.transaction(async c => {
    await store.locked(c, wallet);   // the same per-wallet lock as Adventure sync, purchases and claims
    const old = (await rows(c, 'SELECT * FROM ryo_prison_rescues WHERE scope=$1 AND id=$2', [store.scope, id]))[0];
    const saved = (await rows(c, 'SELECT seen,waiting,damage FROM ryo_prison_rescue_state WHERE scope=$1 AND wallet=$2', [store.scope, wallet]))[0];
    // A new player's first rescue needs no spacing (damage starts at the threshold).
    const st = saved ? { seen: saved.seen || {}, waiting: Number(saved.waiting), damage: Number(saved.damage) } : { seen: {}, waiting: 0, damage: MIN_DAMAGE };
    if (old) { if (old.wallet !== wallet) fail('Request ID belongs to another rescue.', 409); return { ...publicGrant(old, st), replay: true }; }
    const now = store.now(), before = saved ? JSON.stringify(st) : '';
    const adventure = (await rows(c, 'SELECT data FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [store.scope, wallet]))[0]?.data;
    fold(st, adventure);
    const save = () => c.query('INSERT INTO ryo_prison_rescue_state(scope,wallet,seen,waiting,damage,updated) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(scope,wallet) DO UPDATE SET seen=$3,waiting=$4,damage=$5,updated=$6', [store.scope, wallet, JSON.stringify(st.seen), st.waiting, st.damage, now]);
    const answer = async result => { if (JSON.stringify(st) !== before) await save(); return { ...result, waiting: st.waiting, progress: progress(st) }; };
    const session = currentSession(adventure, now);
    if (!session) return answer({ status: 'inactive' });
    if (st.waiting < 1) return answer({ status: 'unverified' });
    if (st.damage < MIN_DAMAGE) return answer({ status: 'early' });
    if ((await rows(c, "SELECT 1 FROM ryo_purchases WHERE scope=$1 AND wallet=$2 AND status='pending' LIMIT 1", [store.scope, wallet])).length) return answer({ status: 'pending' });
    const economy = require('./economy.cjs'), profile = await store.profileLocked(c, wallet);
    if (profile.heroes.length >= MAX_HEROES) return answer({ status: 'full', limit: MAX_HEROES });
    const roll = random(10000);
    if (!Number.isSafeInteger(roll) || roll < 0 || roll >= 10000) fail('Rescue roll unavailable.', 503);
    const rank = rankFor(roll), hero = economy.hero(rank);
    Object.assign(hero, { referralReward: true, prisonRescue: true, rescueId: id });
    profile.heroes.push(hero);
    const next = economy.normalizeProfile(profile), granted = next.heroes.find(h => h.tokenId === hero.tokenId) || hero;
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(next)]);
    const row = (await rows(c, 'INSERT INTO ryo_prison_rescues(scope,id,wallet,rank,roll,hero,session,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [store.scope, id, wallet, rank, roll, JSON.stringify(granted), session, now]))[0];
    st.waiting--; st.damage = 0;   // one prisoner delivered; the next one needs MIN_DAMAGE of new verified damage
    await save();
    return publicGrant(row, st);
  });
}

module.exports = { SCHEMA, FRESH_MS, MIN_DAMAGE, MAX_WAITING, MAX_HEROES, ODDS, ENEMY_HP, rankFor, totals, currentSession, fold, claim };
