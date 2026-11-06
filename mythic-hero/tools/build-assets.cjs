/* Builds Tsukiyomi's production assets from the three supplied reference sheets (reference/):
 *   1. tsukiyomi-model.png       → the four direction poses (FRONT / LEFT / RIGHT / BACK views)
 *   2. mythic-animation-sheet.png → Dragon Slash, Void Shuriken, Raijin Field, Mythic Dragon Ascension
 *   3. mythic-aura-sheet.png      → the existing Mythic Aura: its 13 asset tiles and 8 animation frames
 * Only drawn artwork is taken: crops exclude every label, panel border and sheet background, the
 * backdrop becomes real alpha, and the pose art is never recoloured or redrawn. Character motion is
 * made from the exact reference poses (anchored at the feet), so every frame shows the same hero.
 * Usage: node mythic-hero/tools/build-assets.cjs   (writes mythic-hero/assets/)
 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const sharp = require('sharp');
const { character, glow, keepMain, bounds } = require('./cutout.cjs');

const ROOT = path.join(__dirname, '..'), REF = path.join(ROOT, 'reference'), OUT = path.join(ROOT, 'assets');
const SOURCES = { model: 'tsukiyomi-model.png', animation: 'mythic-animation-sheet.png', aura: 'mythic-aura-sheet.png' };
const CELL = 128, FOOT = [64, 124], BODY = 116; // 128×128 frames, centre-bottom anchor, hero height

const raw = async (file, rect) => sharp(path.join(REF, file)).extract(rect).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const png = (data, info) => sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 });
const write = async (rel, pipeline) => { const file = path.join(OUT, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); await pipeline.toFile(file); return rel.replace(/\\/g, '/'); };
const blank = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });

/* ---------- 1. Direction poses ---------- */
const POSES = { front: [52, 263], left: [278, 476], right: [479, 668], back: [678, 870] };
async function poses() {
  const out = {};
  for (const [name, [x0, x1]] of Object.entries(POSES)) {
    const { data, info } = await raw(SOURCES.model, { left: x0, top: 552, width: x1 - x0, height: 280 });
    character(data, info.width, info.height, [0, 7, 28]); keepMain(data, info.width, info.height);
    const b = bounds(data, info.width, info.height);
    const buffer = await png(data, info).extract({ left: b.x, top: b.y, width: b.width, height: b.height }).toBuffer();
    const trimmed = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    // Foot pivot: the centre of the opaque pixels in the lowest 12 rows (the boots), on the bottom edge.
    let sum = 0, count = 0;
    for (let y = b.height - 12; y < b.height; y++) for (let x = 0; x < b.width; x++) if (trimmed.data[(y * b.width + x) * 4 + 3] > 128) { sum += x; count++; }
    out[name] = { buffer, width: b.width, height: b.height, pivot: [Math.round(sum / count), b.height] };
  }
  return out;
}

/* ---------- 2. Frame renderer: an exact pose, transformed about its foot pivot ---------- */
const svgBuf = svg => Buffer.from(svg);
async function renderFrame(pose, t = {}) {
  const k = BODY / pose.height, sx = t.sx || 1, sy = t.sy || 1;
  const w = Math.max(1, Math.round(pose.width * k * sx)), h = Math.max(1, Math.round(pose.height * k * sy));
  let img = await sharp(pose.buffer).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  let piv = [pose.pivot[0] * w / pose.width, h];
  let iw = w, ih = h;
  // Tint and fade the pose itself, before rotation adds transparent corners.
  if (t.tint) img = await sharp(img).composite([{ input: { create: { width: iw, height: ih, channels: 4, background: { ...t.tint } } }, blend: 'atop' }]).png().toBuffer();
  if (t.alpha != null && t.alpha < 1) img = await sharp(img).composite([{ input: { create: { width: iw, height: ih, channels: 4, background: { r: 0, g: 0, b: 0, alpha: t.alpha } } }, blend: 'dest-in' }]).png().toBuffer();
  if (t.rot) {
    // sharp rotates clockwise about the centre and grows the canvas; follow the pivot through it.
    const rotated = await sharp(img).rotate(t.rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
    const a = t.rot * Math.PI / 180, cx = piv[0] - w / 2, cy = piv[1] - h / 2;
    piv = [cx * Math.cos(a) - cy * Math.sin(a) + rotated.info.width / 2, cx * Math.sin(a) + cy * Math.cos(a) + rotated.info.height / 2];
    img = rotated.data; iw = rotated.info.width; ih = rotated.info.height;
  }
  // Compose on a 3× canvas so poses can lean or jump past the cell edge, then crop the cell.
  const pad = CELL, layers = [];
  for (const u of t.under || []) layers.push({ input: u.input, left: Math.round(pad + u.left), top: Math.round(pad + u.top) });
  layers.push({ input: img, left: Math.round(pad + FOOT[0] + (t.dx || 0) - piv[0]), top: Math.round(pad + FOOT[1] + (t.dy || 0) - piv[1]) });
  for (const o of t.over || []) layers.push({ input: o.input, left: Math.round(pad + o.left), top: Math.round(pad + o.top), blend: o.blend || 'over' });
  // sharp extracts before compositing within one pipeline, so compose first, then crop the cell.
  const full = await blank(CELL * 3, CELL * 3).composite(layers).png().toBuffer();
  // A tilted pose swings one boot below the foot line; lift the frame so nothing passes the anchor.
  const { data, info } = await sharp(full).raw().toBuffer({ resolveWithObject: true });
  let lowest = 0;
  for (let y = pad + FOOT[1]; y < pad + CELL; y++) for (let x = pad; x < pad + CELL; x++) if (data[(y * info.width + x) * 4 + 3] > 40) lowest = y;
  const lift = Math.max(0, lowest - (pad + FOOT[1] + 1));
  return sharp(full).extract({ left: pad, top: pad + lift, width: CELL, height: CELL }).png().toBuffer();
}
async function sheet(rel, frames) {
  const composite = frames.map((input, i) => ({ input, left: i * CELL, top: 0 }));
  await write(rel, blank(CELL * frames.length, CELL).composite(composite).png({ compressionLevel: 9 }));
  return rel;
}

/* ---------- 3. Effects from the animation sheet ---------- */
const SKILLS = {
  dragon_slash: { y: [150, 216], centres: [908, 966, 1023, 1080, 1138, 1195, 1252, 1307], anchor: 'centre', label: 'Dragon Slash' },
  void_shuriken: { y: [270, 327], centres: [908, 966, 1023, 1081, 1139, 1197, 1254, 1310], anchor: 'centre', label: 'Void Shuriken' },
  raijin_field: { y: [366, 433], clearAbove: [1130, 379], centres: [891, 930, 972, 1018, 1065, 1113, 1159, 1208, 1258, 1312], anchor: 'bottom', label: 'Raijin Field' },
  // Frame 5 is not drawn on the sheet and frame 11 is hidden behind frame 12, so 10 frames exist.
  mythic_dragon_ascension: { y: [484, 557], centres: [888, 927, 968, 1011, 1055, 1100, 1149, 1197, 1245, 1320], sheetLabels: [1, 2, 3, 4, 6, 7, 8, 9, 10, 12], wideLast: [1262, 1345], anchor: 'bottom', label: 'Mythic Dragon Ascension' }
};
const SHEET_X = [874, 1338]; // inside the skill panels (their borders and the info boxes stay out)
async function effectFrames(spec) {
  const c = spec.centres, cuts = [];
  // Neighbouring frames can touch (the large crescents and dragons), so each boundary is the darkest
  // column between two frame centres; a 3px feather softens the cut.
  const row = await raw(SOURCES.animation, { left: SHEET_X[0], top: spec.y[0], width: SHEET_X[1] - SHEET_X[0], height: spec.y[1] - spec.y[0] });
  const column = x => { let s = 0; for (let y = 0; y < row.info.height; y++) { const i = (y * row.info.width + x - SHEET_X[0]) * 4; s += Math.max(row.data[i], row.data[i + 1], row.data[i + 2]); } return s; };
  const cutsAt = [SHEET_X[0]];
  for (let i = 0; i < c.length - 1; i++) {
    const lo = Math.round(c[i] + (c[i + 1] - c[i]) * 0.3), hi = Math.round(c[i + 1] - (c[i + 1] - c[i]) * 0.3);
    let best = lo; for (let x = lo; x <= hi; x++) if (column(x) < column(best)) best = x;
    cutsAt.push(spec.wideLast && i === c.length - 2 ? Math.max(best, spec.wideLast[0]) : best);
  }
  cutsAt.push(SHEET_X[1]);
  for (let i = 0; i < c.length; i++) {
    const left = cutsAt[i], right = cutsAt[i + 1];
    const { data, info } = await raw(SOURCES.animation, { left, top: spec.y[0], width: right - left, height: spec.y[1] - spec.y[0] });
    glow(data, info.width, info.height, 46, 150, 0);
    // The Raijin header underline runs above the short frames only; the tall pillars on the right start higher.
    if (spec.clearAbove) for (let y = 0; y < spec.clearAbove[1] - spec.y[0]; y++) for (let x = 0; x < info.width && left + x < spec.clearAbove[0]; x++) data[(y * info.width + x) * 4 + 3] = 0;
    for (let y = 0; y < info.height; y++) for (const [x, f] of [[0, 1], [1, 2], [2, 3], [info.width - 1, 1], [info.width - 2, 2], [info.width - 3, 3]]) {
      if (x < 0 || x >= info.width) continue; const k = (y * info.width + x) * 4 + 3;
      if ((x < 3 && i > 0) || (x >= info.width - 3 && i < c.length - 1)) data[k] = Math.round(data[k] * f / 4);
    }
    // Drop printed lines: the header underline (flat) and panel borders (thin and tall).
    const n = info.width * info.height, label = new Int32Array(n).fill(-1), queue = new Int32Array(n), drop = [];
    for (let s = 0; s < n; s++) {
      if (label[s] >= 0 || data[s * 4 + 3] < 10) continue;
      const id = drop.length; let head = 0, tail = 1, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1; label[s] = id; queue[0] = s;
      while (head < tail) {
        const p = queue[head++], x = p % info.width, y = (p - x) / info.width;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, q = ny * info.width + nx;
          if (nx < 0 || ny < 0 || nx >= info.width || ny >= info.height || label[q] >= 0 || data[q * 4 + 3] < 10) continue;
          label[q] = id; queue[tail++] = q;
        }
      }
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      drop.push((h <= 4 && w >= 10) || (w <= 3 && h >= 14));
    }
    for (let p = 0; p < n; p++) if (label[p] < 0 || drop[label[p]]) data[p * 4 + 3] = 0;
    keepMain(data, info.width, info.height, 0.012);
    const b = bounds(data, info.width, info.height, 6);
    cuts.push({ data, info, b, x: left, y: spec.y[0] });
  }
  return cuts;
}
async function effectSheet(name, spec) {
  const cuts = await effectFrames(spec);
  // One cell size per effect. Centre effects share a centre line; ground effects share the sheet's ground line.
  const W = Math.ceil(Math.max(...cuts.map(f => f.b.width)) / 8) * 8 + 8, H = Math.ceil(Math.max(...cuts.map(f => spec.anchor === 'bottom' ? f.b.y + f.b.height : f.b.height)) / 8) * 8 + 8;
  const ground = Math.max(...cuts.map(f => f.b.y + f.b.height));
  const layers = [];
  for (let i = 0; i < cuts.length; i++) {
    const f = cuts[i], piece = await png(f.data, f.info).extract({ left: f.b.x, top: f.b.y, width: f.b.width, height: f.b.height }).toBuffer();
    const left = i * W + Math.round((W - f.b.width) / 2);
    const top = spec.anchor === 'bottom' ? H - 4 - (ground - f.b.y) : Math.round((H - f.b.height) / 2);
    layers.push({ input: piece, left, top: Math.max(0, top) });
  }
  const rel = await write(`skills/${name}.png`, blank(W * cuts.length, H).composite(layers).png({ compressionLevel: 9 }));
  return { rel, width: W, height: H, frames: cuts.length };
}

/* ---------- 4. Mythic Aura from the existing aura sheet ---------- */
const AURA_ROWS = [
  { y: [293, 381], half: 50, centres: [646, 767, 889, 1014, 1136, 1259, 1376], names: ['outer_glyph_ring', 'inner_halo_ring', 'sacred_floor_sigil', 'summoning_seal', 'divine_halo_crown', 'energy_wings_left', 'energy_wings_right'] },
  { y: [424, 511], half: 50, centres: [647, 771, 894, 1014, 1137, 1258, 1379], names: ['orbit_rings', 'aerial_shards', 'rune_tablets', 'particle_sparks', 'energy_pillars', 'aura_flames', 'light_burst'] }
];
const AURA_FRAMES = { y: [113, 195], half: 43, centres: [647, 751, 855, 960, 1065, 1170, 1276, 1382] };
async function auraTile(cx, half, y) {
  const { data, info } = await raw(SOURCES.aura, { left: cx - half, top: y[0], width: half * 2, height: y[1] - y[0] });
  glow(data, info.width, info.height, 62, 165, 5);
  const b = bounds(data, info.width, info.height, 6);
  return png(data, info).extract({ left: b.x, top: b.y, width: b.width, height: b.height });
}
async function aura() {
  const parts = {};
  for (const row of AURA_ROWS) for (let i = 0; i < row.names.length; i++) {
    const pipeline = await auraTile(row.centres[i], row.half, row.y), meta = await pipeline.clone().toBuffer({ resolveWithObject: true });
    parts[row.names[i]] = { path: await write(`aura/${row.names[i]}.png`, sharp(meta.data)), width: meta.info.width, height: meta.info.height };
  }
  // The supplied 8-frame aura animation, as one strip of equal cells.
  const cells = [];
  for (const cx of AURA_FRAMES.centres) cells.push(await (await auraTile(cx, AURA_FRAMES.half, AURA_FRAMES.y)).toBuffer({ resolveWithObject: true }));
  const W = Math.max(...cells.map(c => c.info.width)) + 4, H = Math.max(...cells.map(c => c.info.height)) + 4;
  const strip = await write('aura/aura_frames.png', blank(W * cells.length, H).composite(cells.map((c, i) => ({ input: c.data, left: i * W + Math.round((W - c.info.width) / 2), top: H - 2 - c.info.height }))).png());
  return { parts, frames: { path: strip, frameWidth: W, frameHeight: H, frameCount: cells.length, fps: 8, loop: true } };
}

/* ---------- 5. Overlays drawn for the motion frames (slash trail, emotes, victory glow) ---------- */
const emoteSvg = kind => {
  const bubble = (fill, glyph) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><defs><radialGradient id="g"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${fill}"/></radialGradient></defs><circle cx="20" cy="18" r="15" fill="url(#g)" stroke="#2a0f45" stroke-width="2.5"/><path d="M14 31 L12 38 L20 32 Z" fill="${fill}" stroke="#2a0f45" stroke-width="2"/>${glyph}</svg>`;
  if (kind === 'alert') return bubble('#ff5a6a', '<text x="20" y="26" font-family="Arial Black,Arial" font-weight="900" font-size="22" text-anchor="middle" fill="#7a0010">!</text>');
  if (kind === 'question') return bubble('#5ab8ff', '<text x="20" y="26" font-family="Arial Black,Arial" font-weight="900" font-size="21" text-anchor="middle" fill="#06306a">?</text>');
  if (kind === 'like') return bubble('#ff8ccf', '<path d="M20 28 C8 20 10 10 16 11 C18 11 20 13 20 15 C20 13 22 11 24 11 C30 10 32 20 20 28 Z" fill="#e8125f"/>');
  return bubble('#ffd257', '<path d="M20 7 L23 15 L32 15 L25 20 L28 29 L20 24 L12 29 L15 20 L8 15 L17 15 Z" fill="#c47a00" stroke="#7a4a00" stroke-width="1"/>');
};
const victoryGlow = a => svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><radialGradient id="v" cx="50%" cy="55%" r="50%"><stop offset="0" stop-color="#fff3c4" stop-opacity="${0.85 * a}"/><stop offset=".45" stop-color="#c77dff" stop-opacity="${0.45 * a}"/><stop offset="1" stop-color="#7a2cff" stop-opacity="0"/></radialGradient></defs><ellipse cx="64" cy="70" rx="60" ry="60" fill="url(#v)"/></svg>`);
const sparkles = (a, seed) => {
  let s = ''; for (let i = 0; i < 6; i++) { const x = 14 + ((seed * 37 + i * 41) % 100), y = 8 + ((seed * 53 + i * 29) % 70), r = 2 + (i % 3); s += `<path d="M${x} ${y - r * 2} L${x + r / 2} ${y - r / 2} L${x + r * 2} ${y} L${x + r / 2} ${y + r / 2} L${x} ${y + r * 2} L${x - r / 2} ${y + r / 2} L${x - r * 2} ${y} L${x - r / 2} ${y - r / 2} Z" fill="${i % 2 ? '#ffe08a' : '#e2ccff'}" opacity="${a}"/>`; }
  return svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">${s}</svg>`);
};

/* ---------- 6. Motion definitions (frame transforms of the exact poses) ---------- */
const TAU = Math.PI * 2;
function motions(trail) {
  const side = d => d === 'left' ? -1 : d === 'right' ? 1 : 0;
  const walk = (d, run) => Array.from({ length: 8 }, (_, i) => {
    const t = i / 8, bounce = Math.abs(Math.sin(t * TAU)), contact = 1 - bounce, f = side(d);
    return { dy: -(run ? 6 : 3) * bounce, sy: 1 - (run ? 0.045 : 0.022) * contact, sx: 1 + (run ? 0.02 : 0.01) * contact,
      rot: (f ? f * (run ? 7 : 2.5) : 0) + (run ? 3 : 2) * Math.sin(t * TAU) * (f ? 0.5 : 1) };
  });
  const attack = d => {
    const f = side(d) || 1, v = side(d) === 0;
    const steps = [{ rot: -5, dx: -2, sy: .97 }, { rot: -9, dx: -4, sy: .95 }, { rot: 8, dx: 6, sy: 1.02, trail: [2, .9] }, { rot: 10, dx: 8, sy: 1.02, trail: [4, 1] }, { rot: 5, dx: 4, trail: [6, .55] }, { rot: 0, dx: 1 }];
    return steps.map(s => {
      const out = v ? { sx: d === 'front' ? 1 + (s.dx || 0) * .006 : 1 - (s.dx || 0) * .004, sy: (s.sy || 1) * (d === 'front' ? 1 + (s.dx || 0) * .006 : 1), dy: d === 'front' ? 0 : -Math.max(0, s.dx || 0) * .3, rot: (s.rot || 0) * .25 }
        : { rot: s.rot * f, dx: (s.dx || 0) * f, sy: s.sy || 1 };
      if (s.trail) out.over = [{ kind: 'trail', frame: s.trail[0], alpha: s.trail[1], dir: d }];
      return out;
    });
  };
  const anim = {
    idle: Array.from({ length: 8 }, (_, i) => { const b = Math.sin(i / 8 * TAU); return { sy: 1 + .014 * b, sx: 1 - .007 * b, rot: .5 * Math.sin(i / 8 * TAU + .6) }; }),
    walk_front: walk('front'), walk_left: walk('left'), walk_right: walk('right'), walk_back: walk('back'),
    run_front: walk('front', true), run_left: walk('left', true), run_right: walk('right', true), run_back: walk('back', true),
    attack_front: attack('front'), attack_left: attack('left'), attack_right: attack('right'), attack_back: attack('back'),
    bomb_place: [{ sy: .97 }, { sy: .9, sx: 1.04 }, { sy: .86, sx: 1.06, dy: 1 }, { sy: .88, sx: 1.05 }, { sy: .96, sx: 1.01 }, { sy: 1 }],
    hurt: [{ rot: -7, dx: -4, tint: { r: 255, g: 60, b: 90, alpha: .45 } }, { rot: -10, dx: -6, tint: { r: 255, g: 255, b: 255, alpha: .35 } }, { rot: -5, dx: -3 }, { rot: -2, dx: -1 }],
    // Defeat: staggers back, crumples to one knee and fades; it stays inside the cell.
    defeat: Array.from({ length: 8 }, (_, i) => { const t = (i + 1) / 8, e = t * t; return { rot: -26 * e + (i === 0 ? 4 : 0), dx: -5 * e, sy: 1 - .3 * e, sx: 1 + .08 * e, alpha: 1 - .5 * Math.max(0, t - .5) * 2, tint: i >= 4 ? { r: 40, g: 16, b: 70, alpha: .12 * (i - 3) } : undefined }; }),
    victory: Array.from({ length: 8 }, (_, i) => { const t = i / 7, jump = Math.sin(Math.min(1, t * 1.4) * Math.PI); return { dy: -5 * jump, sy: 1 + .015 * jump, sx: 1 - .01 * jump, glow: .35 + .65 * Math.sin(t * Math.PI), sparkle: i }; })
  };
  for (const emote of ['alert', 'question', 'like', 'celebrate']) anim[emote] = [.45, 1.15, 1, 1].map((s, i) => ({ emote, scale: s, sy: i === 1 ? 1.015 : 1 }));
  return anim;
}
const POSE_OF = name => /_(front|left|right|back)$/.exec(name)?.[1] || 'front';

async function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  const meta = {
    version: 1, hero: { id: 13, key: 'tsukiyomi', name: 'Tsukiyomi', title: 'Mythic Shinobi', rarity: 'Mythic', rank: 5, stars: 7, theme: 'Lunar / Celestial / Void' },
    sources: Object.fromEntries(Object.entries(SOURCES).map(([k, f]) => [k, { file: 'reference/' + f, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(REF, f))).digest('hex') }])),
    frame: { width: CELL, height: CELL, anchor: FOOT, format: 'PNG RGBA', displaySizes: [32, 48, 64] },
    character: {}, previews: {}, animations: {}, skills: {}, aura: {}
  };
  const P = await poses();
  for (const [name, pose] of Object.entries(P)) {
    meta.previews[name] = { path: await write(`previews/tsukiyomi_${name}.png`, sharp(pose.buffer).png({ compressionLevel: 9 })), width: pose.width, height: pose.height, anchor: pose.pivot };
    meta.character[name] = { path: await write(`character/tsukiyomi_${name}.png`, sharp(await renderFrame(pose))), ...meta.frame, direction: name };
  }
  // Skills first: the attack trail reuses Dragon Slash art.
  const fps = { dragon_slash: 16, void_shuriken: 16, raijin_field: 14, mythic_dragon_ascension: 12 };
  for (const [name, spec] of Object.entries(SKILLS)) {
    const s = await effectSheet(name, spec);
    meta.skills[name] = { label: spec.label, path: s.rel, frameWidth: s.width, frameHeight: s.height, frameCount: s.frames, fps: fps[name], loop: false,
      anchor: spec.anchor === 'bottom' ? [s.width / 2, s.height - 4] : [s.width / 2, s.height / 2], layer: name === 'mythic_dragon_ascension' ? 'ultimate' : 'skill-front' };
  }
  // Ultimate timeline: 12 steps; steps 5 and 11 hold frames 4 and 10 (not drawn separately on the sheet).
  meta.skills.mythic_dragon_ascension.sheetLabels = SKILLS.mythic_dragon_ascension.sheetLabels;
  meta.skills.mythic_dragon_ascension.timeline = [0, 1, 2, 3, 3, 4, 5, 6, 7, 8, 8, 9];
  meta.skills.mythic_dragon_ascension.events = { burst: 10, end: 11 };
  meta.skills.dragon_slash.direction = 'right'; meta.skills.dragon_slash.events = { impact: 6 };
  meta.skills.void_shuriken.events = { launch: 5, impact: 6 };
  meta.skills.raijin_field.events = { strike: 6, peak: 7 };

  const slash = await sharp(path.join(OUT, meta.skills.dragon_slash.path)).raw().toBuffer({ resolveWithObject: true });
  const sw = meta.skills.dragon_slash.frameWidth, sh = meta.skills.dragon_slash.frameHeight;
  const trailOf = async (frame, alpha, dir) => {
    let img = sharp(slash.data, { raw: slash.info }).extract({ left: frame * sw, top: 0, width: sw, height: sh });
    const size = 64; img = img.resize(size, Math.round(size * sh / sw));
    if (dir === 'left') img = img.flop();
    if (dir === 'front' || dir === 'back') img = img.rotate(dir === 'front' ? 90 : -90, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    let buf = await img.png().toBuffer();
    if (alpha < 1) buf = await sharp(buf).composite([{ input: { create: { width: (await sharp(buf).metadata()).width, height: (await sharp(buf).metadata()).height, channels: 4, background: { r: 0, g: 0, b: 0, alpha } } }, blend: 'dest-in' }]).png().toBuffer();
    const m = await sharp(buf).metadata();
    const at = { right: [96, 70], left: [32, 70], front: [64, 82], back: [64, 52] }[dir];
    return { input: buf, left: at[0] - m.width / 2, top: at[1] - m.height / 2, blend: 'screen' };
  };
  const anim = motions();
  for (const [name, steps] of Object.entries(anim)) {
    const pose = P[POSE_OF(name)], frames = [];
    for (let i = 0; i < steps.length; i++) {
      const s = { ...steps[i] }, over = [], under = [];
      for (const o of s.over || []) if (o.kind === 'trail') over.push(await trailOf(o.frame, o.alpha, o.dir));
      if (s.glow) { under.push({ input: victoryGlow(s.glow), left: 0, top: 0 }); over.push({ input: sparkles(s.glow, s.sparkle), left: 0, top: 0, blend: 'screen' }); }
      if (s.emote) { const size = Math.round(36 * s.scale), icon = await sharp(svgBuf(emoteSvg(s.emote))).resize(size, size).png().toBuffer(); over.push({ input: icon, left: 108 - size / 2, top: 22 - size / 2 }); }
      frames.push(await renderFrame(pose, { ...s, over, under }));
    }
    const rel = await sheet(`animations/${name}.png`, frames);
    const loop = /^(idle|walk|run)/.test(name), dir = POSE_OF(name);
    const fpsOf = { idle: 6, walk: 10, run: 14, attack: 14, bomb_place: 10, hurt: 10, defeat: 8, victory: 8 };
    const kind = Object.keys(fpsOf).find(k => name.startsWith(k)) || 'emote';
    meta.animations[name] = { path: rel, frameWidth: CELL, frameHeight: CELL, frameCount: frames.length, fps: fpsOf[kind] || 8, loop, anchor: FOOT, direction: dir, layer: 'character',
      events: kind === 'attack' ? { slash: 2, recover: 4 } : kind === 'bomb_place' ? { place: 2 } : kind === 'defeat' ? { down: 7 } : undefined };
  }
  const a = await aura();
  meta.aura = { source: 'Existing Mythic Hero Aura sheet (reference/mythic-aura-sheet.png), reused as supplied',
    layers: ['sacred_floor_sigil', 'particle_sparks', 'energy_wings', 'outer_glyph_ring', 'character', 'orbit_rings', 'aerial_shards', 'skill_front', 'ultimate'],
    parts: a.parts, frames: a.frames };
  fs.mkdirSync(path.join(OUT, 'metadata'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'metadata', 'tsukiyomi.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}
if (require.main === module) build().then(m => console.log('Tsukiyomi assets:', Object.keys(m.animations).length, 'animations,', Object.keys(m.skills).length, 'skills,', Object.keys(m.aura.parts).length, 'aura parts.')).catch(e => { console.error(e); process.exit(1); });
module.exports = { build };
