'use strict';
/* Purchase settlement without lost updates (apply-purchase-delta.cjs copies this file to app/server/purchase-delta.cjs).
 * Owner request 2026-11-11 ("go fix it").
 *
 * A purchase used to save the whole purchase-time profile (profile_after) and write it back at confirmed settlement, so a
 * change made to the profile in between (a Boss Hunt reward, a Founder/Mythic sync, a Battle-Ready change, a settings
 * toggle, ...) was lost when the purchase settled. Now the purchase also records only WHAT IT CHANGED (profile_delta):
 *   - heroes it added (outputs), heroes it removed (consumed), heroes it changed (e.g. Training), compared without chakra;
 *   - Battle-Ready entries it added / removed;
 *   - top-level fields it changed (Dojo tier, Sensei, Shrine pity, Starter Activation, ...).
 * At confirmed settlement that change set is applied to the CURRENT profile. Upgrade/Fusion Shards keep their own settlement
 * (re-applied to the current balance) and chakra keeps the current value, exactly as before. A hero the purchase changed but
 * that is no longer in the profile is never brought back (no duplicates); added heroes are never added twice.
 * Purchases still pending from before this change have no profile_delta and settle exactly as before.
 */
const VERSION = 1;
const OWN = new Set(['heroes', 'battleReady', 'upgradeShards', 'fusionShards']);   // handled separately
const json = v => JSON.stringify(v === undefined ? null : v);
const noChakra = h => { const { chakra, ...rest } = h || {}; return rest; };

/** The change a purchase makes: `before` = the profile the purchase was computed from, `after` = its result. */
function delta(before, after) {
  const normalize = p => require('./economy.cjs').normalizeProfile(structuredClone(p));
  const b = normalize(before), a = normalize(after);
  const bh = new Map(b.heroes.map(h => [h.tokenId, h])), ah = new Map(a.heroes.map(h => [h.tokenId, h]));
  const added = [...ah.values()].filter(h => !bh.has(h.tokenId));
  const removed = [...bh.keys()].filter(id => !ah.has(id));
  const changed = [...ah.values()].filter(h => bh.has(h.tokenId) && json(noChakra(bh.get(h.tokenId))) !== json(noChakra(h)));
  const br = new Set(b.battleReady || []), ar = new Set(a.battleReady || []);
  const fields = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (OWN.has(k) || json(b[k]) === json(a[k])) continue;
    fields[k] = k in a ? { value: a[k] } : { unset: true };
  }
  return { v: VERSION, added, removed, changed, readyAdd: [...ar].filter(x => !br.has(x)), readyRemove: [...br].filter(x => !ar.has(x)), fields };
}

/** The current profile with the purchase's change applied (store.settlePurchase, confirmed). */
function apply(current, d) {
  if (!d || d.v !== VERSION) throw Object.assign(Error('Unknown purchase change format.'), { status: 409 });
  const next = structuredClone(current), removed = new Set(d.removed || []);
  next.heroes = (next.heroes || []).filter(h => !removed.has(h.tokenId));
  const at = new Map(next.heroes.map((h, i) => [h.tokenId, i]));
  for (const h of d.changed || []) {   // only heroes still owned; keep their current chakra
    const i = at.get(h.tokenId); if (i === undefined) continue;
    const chakra = next.heroes[i].chakra; next.heroes[i] = { ...structuredClone(h), ...(chakra ? { chakra } : {}) };
    if (!chakra) delete next.heroes[i].chakra;
  }
  for (const h of d.added || []) if (!at.has(h.tokenId)) { next.heroes.push(structuredClone(h)); at.set(h.tokenId, next.heroes.length - 1); }
  const owned = new Set(next.heroes.map(h => h.tokenId));
  const ready = new Set((next.battleReady || []).filter(id => owned.has(id)));
  for (const id of d.readyRemove || []) ready.delete(id);
  for (const id of d.readyAdd || []) if (owned.has(id)) ready.add(id);
  next.battleReady = [...ready];
  for (const [k, f] of Object.entries(d.fields || {})) { if (OWN.has(k)) continue; if (f.unset) delete next[k]; else next[k] = structuredClone(f.value); }
  return next;
}

const SCHEMA = 'ALTER TABLE ryo_purchases ADD COLUMN IF NOT EXISTS profile_delta JSONB;';
module.exports = { VERSION, SCHEMA, delta, apply };
