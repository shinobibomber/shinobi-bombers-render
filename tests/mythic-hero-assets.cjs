/* Tsukiyomi's legacy extracted assets match their metadata (not proof of production art quality): 128×128
 * RGBA character frames with the centre-bottom anchor, every required animation with its frame count
 * and four walk directions, the four skills, the existing Mythic Aura parts and 8-frame animation,
 * transparent backgrounds (no baked-in sheet panels), and the copies the build ships to the game. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'mythic-hero/assets'), meta = require(path.join(dir, 'metadata/tsukiyomi.json'));

(async () => {
  assert.deepEqual([meta.hero.name, meta.hero.rarity, meta.hero.rank, meta.hero.id, meta.hero.stars], ['Tsukiyomi', 'Mythic', 5, 13, undefined]);
  for (const source of Object.values(meta.sources)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'mythic-hero', source.file))).digest('hex'), source.sha256, 'reference unchanged: ' + source.file);
  assert.deepEqual([meta.frame.width, meta.frame.height, meta.frame.anchor], [128, 128, [64, 124]]);
  // Legacy files remain archived for provenance; the v2 runtime never loads these borrowed bodies.
  const required = { idle: 4, walk_front: 10, walk_left: 6, walk_right: 6, walk_back: 4, run_front: 10, run_left: 6, run_right: 6, run_back: 4, attack_front: 6, attack_left: 6, attack_right: 6, attack_back: 6,
    bomb_place: 3, hurt: 4, defeat: 8, victory: 5, alert: 4, question: 4, like: 4, celebrate: 4 };
  assert.deepEqual(Object.keys(meta.animations).sort(), Object.keys(required).sort(), 'every required animation');
  const corners = async (file, w, h, cells) => {
    const { data, info } = await sharp(path.join(dir, file)).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4, file + ' is RGBA');
    for (let c = 0; c < cells; c++) for (const [x, y] of [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]]) assert.equal(data[((y) * info.width + c * w + x) * 4 + 3], 0, `${file} cell ${c} corner is transparent`);
    return { data, info };
  };
  for (const [name, a] of Object.entries(meta.animations)) {
    const m = await sharp(path.join(dir, a.path)).metadata();
    assert.deepEqual([a.frameCount, m.width, m.height, a.frameWidth, a.frameHeight], [required[name], 128 * required[name], 128, 128, 128], name + ' sheet size');
    assert(a.fps > 0 && typeof a.loop === 'boolean' && a.anchor[0] === 64 && a.anchor[1] === 124, name + ' timing and anchor');
    const { data, info } = await corners(a.path, 128, 128, a.frameCount);
    // Every frame shows the hero (enough opaque pixels) and his feet sit on the anchor line.
    for (let c = 0; c < a.frameCount; c++) {
      let opaque = 0, lowest = 0;
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (data[(y * info.width + c * 128 + x) * 4 + 3] > 40) { opaque++; lowest = Math.max(lowest, y); }
      assert(opaque > 2500, `${name} frame ${c} has the hero`);
      if (!['defeat', 'victory'].includes(name) && !name.startsWith('run') && !name.startsWith('walk')) assert(lowest >= 118 && lowest <= 126, `${name} frame ${c} stands on the anchor (${lowest})`);
    }
  }
  // Walking and running step: the leg region (below the hip) changes between opposite phases.
  for (const name of ['walk_front', 'walk_right', 'run_left', 'attack_right']) {
    const { data, info } = await sharp(path.join(dir, meta.animations[name].path)).raw().toBuffer({ resolveWithObject: true });
    let diff = 0; for (let y = 84; y < 126; y++) for (let x = 0; x < 128; x++) { const a = (y * info.width + 1 * 128 + x) * 4 + 3, b = (y * info.width + 3 * 128 + x) * 4 + 3; if ((data[a] > 100) !== (data[b] > 100)) diff++; }
    assert(diff > 60, name + ' legs move between steps (' + diff + ')');
  }
  for (const dirName of ['front', 'left', 'right', 'back']) { const c = meta.character[dirName]; assert.equal(c.direction, dirName); await corners(c.path, 128, 128, 1); assert(meta.previews[dirName].height > 250, 'HD ' + dirName + ' view'); }
  const skills = { dragon_slash: 8, void_shuriken: 8, raijin_field: 10, mythic_dragon_ascension: 10 };
  for (const [name, n] of Object.entries(skills)) {
    const s = meta.skills[name], m = await sharp(path.join(dir, s.path)).metadata();
    assert.deepEqual([s.frameCount, m.width, m.height], [n, s.frameWidth * n, s.frameHeight], name);
    await corners(s.path, s.frameWidth, s.frameHeight, n);
  }
  assert.deepEqual(meta.skills.mythic_dragon_ascension.timeline.length, 12, 'the ultimate keeps its 12-step timing');
  assert.deepEqual(meta.skills.mythic_dragon_ascension.sheetLabels, [1, 2, 3, 4, 6, 7, 8, 9, 10, 12]);
  const parts = ['outer_glyph_ring', 'inner_halo_ring', 'sacred_floor_sigil', 'summoning_seal', 'divine_halo_crown', 'energy_wings_left', 'energy_wings_right', 'orbit_rings', 'aerial_shards', 'rune_tablets', 'particle_sparks', 'energy_pillars', 'aura_flames', 'light_burst'];
  assert.deepEqual(Object.keys(meta.aura.parts).sort(), parts.slice().sort(), 'the existing Mythic Aura parts');
  // Aura parts are trimmed tight (pillars and flames may touch a corner): no baked-in panel means
  // the outline of each part is mostly transparent.
  for (const p of parts) {
    const a = meta.aura.parts[p], { data, info } = await sharp(path.join(dir, a.path)).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height, info.channels], [a.width, a.height, 4], p);
    let edge = 0, solid = 0; const at = (x, y) => data[(y * info.width + x) * 4 + 3];
    for (let x = 0; x < info.width; x++) for (const y of [0, info.height - 1]) { edge++; if (at(x, y) > 200) solid++; }
    for (let y = 0; y < info.height; y++) for (const x of [0, info.width - 1]) { edge++; if (at(x, y) > 200) solid++; }
    assert(solid / edge < 0.3, p + ' has no baked-in panel (' + Math.round(100 * solid / edge) + '% opaque outline)');
  }
  assert.equal(meta.aura.frames.frameCount, 8);
  // The build ships the same files to the game.
  const shipped = path.join(root, 'app/public/assets/mythic-hero');
  for (const file of [meta.animations.idle.path, meta.skills.raijin_field.path, meta.aura.parts.outer_glyph_ring.path, 'metadata/tsukiyomi.json'])
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(shipped, file))).digest('hex'), crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex'), 'shipped ' + file);
  assert.equal(fs.readFileSync(path.join(shipped, 'mythic-hero.js'), 'utf8'), fs.readFileSync(path.join(root, 'mythic-hero/mythic-hero.js'), 'utf8'));
  console.log('PASS: Tsukiyomi legacy asset archive: hashed references, 21 archived 128×128 RGBA strips, 4 extracted skills, 14 original Aura parts and 8 aura frames; unchanged shipped bytes. Archived strips are not v2 production animation art.');
})().catch(e => { console.error(e); process.exit(1); });
