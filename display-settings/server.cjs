/* Display & Accessibility settings synced to the player's account (profile.display). Presentation only:
 * a small validated object; the newest copy (by its own 'updated' time) wins, older pushes are ignored. */
'use strict';
const { fail } = require('./store.cjs');
const BOOLS = ['flashing', 'shake', 'reduceMotion', 'bloom', 'highContrast', 'colorblind'];
function clean(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Choose valid display settings.');
  const brightness = Math.round(Number(raw.brightness)), updated = Number(raw.updated);
  if (!['comfort', 'minimal', 'standard', 'custom'].includes(raw.preset) || !Number.isInteger(brightness) || brightness < 20 || brightness > 100
    || !['full', 'reduced', 'off'].includes(raw.explosions) || BOOLS.some(k => typeof raw[k] !== 'boolean') || !Number.isSafeInteger(updated) || updated <= 0) fail('Choose valid display settings.');
  return { preset: raw.preset, brightness, explosions: raw.explosions, ...Object.fromEntries(BOOLS.map(k => [k, raw[k]])), updated };
}
async function save(store, wallet, body) {
  const display = clean(body?.display);
  return store.transaction(async c => {
    await store.locked(c, wallet);
    const profile = await store.profileLocked(c, wallet);
    if (Number(profile.display?.updated || 0) >= display.updated) return { saved: false };
    profile.display = display;
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, wallet, JSON.stringify(profile)]);
    return { saved: true };
  });
}
module.exports = { clean, save };
