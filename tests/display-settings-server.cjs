/* Display & Accessibility account sync on the real store: strict validation, saved in profile.display,
 * newer settings win (older or equal timestamps are ignored), and nothing else in the profile changes. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../app/server');
const { Store } = require(path.join(root, 'store.cjs')), display = require(path.join(root, 'display-settings.cjs'));
const ok = (o = {}) => ({ preset: 'comfort', brightness: 65, explosions: 'reduced', flashing: false, shake: false, reduceMotion: true, bloom: false, highContrast: false, colorblind: false, updated: 1000, ...o });

(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  const store = new Store(pool, 'test-display', () => Date.now());
  const before = await store.profile('w1');
  for (const bad of [null, [], ok({ brightness: 10 }), ok({ brightness: 101 }), ok({ explosions: 'mega' }), ok({ shake: 'yes' }), ok({ preset: 'x' }), ok({ updated: 0 }), ok({ flashing: undefined })])
    await assert.rejects(display.save(store, 'w1', { display: bad }), /valid display settings/);
  assert.deepEqual(await display.save(store, 'w1', { display: ok({ preset: 'minimal', explosions: 'off', updated: 2000, extra: 'ignored' }) }), { saved: true });
  let p = await store.profile('w1');
  assert.deepEqual(p.display, ok({ preset: 'minimal', explosions: 'off', updated: 2000 }), 'only the known keys are stored');
  assert.deepEqual(p.heroes, before.heroes, 'heroes untouched');
  assert.deepEqual(await display.save(store, 'w1', { display: ok({ preset: 'standard', updated: 1500 }) }), { saved: false }, 'an older copy never overwrites');
  assert.equal((await store.profile('w1')).display.preset, 'minimal');
  assert.deepEqual(await display.save(store, 'w1', { display: ok({ preset: 'standard', brightness: 100, explosions: 'full', flashing: true, shake: true, reduceMotion: false, bloom: true, updated: 3000 }) }), { saved: true });
  assert.equal((await store.profile('w1')).display.preset, 'standard');
  assert.match(fs.readFileSync(path.join(root, 'service.cjs'), 'utf8'), /action==='display-settings'\)\{await require\('\.\/display-settings\.cjs'\)\.save\(store,wallet,body\);return state\(wallet\)\}/);
  console.log('PASS: Display & Accessibility account sync: strict validation, profile.display storage, newer-wins, nothing else changed.');
})().catch(e => { console.error(e); process.exit(1); });
