/* Summoning Shrine Legend hard pity (owner request 2026-11-11). apply-shrine-pity.cjs copies this file to
 * app/server/shrine-pity.cjs and makes ONLY the paid Shrine purchase use it:
 *   Store.purchase (product 'summon', paid from the game balance or Chest rewards, never free starter Ryo)
 *     -> economy.fulfill(profile, q, now, { shrinePity: true }) -> roll() below.
 * Every other hero source (referral passes, Creator Shop, Founder boxes and passes, Mythic Box, prison rescue and staff grants,
 * fusion, Market, starter pack) calls fulfill / hero() without that option and never reads or changes the counter.
 *
 * profile.shrineLegendPity = consecutive paid Shrine summons since the last Shrine Legend (0..149; missing = 0, owner decision:
 * everyone starts at 0). Each summon of a batch is handled in order: at 149 the next summon is a guaranteed Legend (no roll);
 * otherwise the normal Shrine odds (Genin 60 / Chunin 25 / Jonin 10 / Elite 4 / Legend 1; never Mythic). Any Shrine Legend
 * (natural or guaranteed) resets the counter to 0; every other rank adds 1. No soft pity.
 * The rolls and the new counter are frozen with the purchase (result / profile_after) and written only at confirmed settlement,
 * so pending, refunded, failed or replayed purchases never move it. */
'use strict';
const THRESHOLD = 150, MAX = THRESHOLD - 1, LEGEND = 4;

/** The stored counter, validated (anything unexpected counts as 0). */
function counter(profile) {
  const n = profile?.shrineLegendPity;
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX ? n : 0;
}
/** Rolls `quantity` Shrine heroes in order with hard pity. rollRank() = the normal Shrine roll; makeHero(rank) = economy.hero. */
function roll(profile, quantity, rollRank, makeHero) {
  let pity = counter(profile);
  const before = pity, heroes = [], guaranteed = [], legends = [];
  for (let i = 0; i < quantity; i++) {
    const forced = pity >= MAX, rank = forced ? LEGEND : rollRank();
    if (!Number.isSafeInteger(rank) || rank < 0 || rank > LEGEND) throw Error('Invalid Shrine roll.');
    const hero = makeHero(rank);
    if (rank === LEGEND) { legends.push(i); if (forced) { guaranteed.push(i); hero.shrinePity = 'guaranteed'; } pity = 0; }
    else pity++;
    heroes.push(hero);
  }
  return { heroes, summary: { before, after: pity, guaranteed, legends, threshold: THRESHOLD } };
}

module.exports = { THRESHOLD, MAX, counter, roll };
