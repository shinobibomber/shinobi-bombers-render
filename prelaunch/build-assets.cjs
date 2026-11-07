/* Rebuilds the pre-launch portal artwork (prelaunch/assets/) from the game's own high-resolution sources.
 * Run after `npm run build:local` (some sources live in the assembled app/):  node prelaunch/build-assets.cjs
 * Every output is a crisp, UI-free crop or a transparent cut-out at (or below) its native resolution. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), sharp = require('sharp');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(__dirname, 'assets'), A = p => path.join(ROOT, 'app/public/assets', p);
const webp = (img, file, quality = 80) => img.webp({ quality, alphaQuality: 100, effort: 6, smartSubsample: true }).toFile(path.join(OUT, file));

async function cell(src, x, y, w, h, file, height) {
  // A transparent sprite cell, trimmed to its pixels, never upscaled.
  const buf = await sharp(src).extract({ left: Math.round(x), top: Math.round(y), width: Math.round(w), height: Math.round(h) }).png().toBuffer();
  const trimmed = await sharp(buf).trim({ threshold: 1 }).png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  return webp(sharp(trimmed).resize({ height: Math.min(height, meta.height) }), file, 90);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const old = ['backdrop', 'ninjas-left', 'ninjas-right', 'map', 'dojo', 'boss-hunt', 'tsukiyomi', ...[0, 1, 2, 3, 4, 5].map(i => 'hero' + i)];
  for (const f of old) fs.rmSync(path.join(OUT, f + '.webp'), { force: true });

  // Backgrounds and scenes (no UI baked in).
  await webp(sharp(A('design-v3/village.webp')).resize(1600), 'bg-village.webp', 72);
  await webp(sharp(A('design-v3/academy.webp')).extract({ left: 0, top: 112, width: 1536, height: 864 }).resize(900), 'academy.webp', 78);
  await webp(sharp(path.join(ROOT, 'website/assets/arena1.webp')).resize(900), 'arena.webp', 80);
  await webp(sharp(A('website-design/art/scr-home.webp')).resize(1100), 'demo.webp', 80);
  // Logo, Shrine card, rank auras, Tsukiyomi.
  await webp(sharp(A('login-exact/login-reference.webp')).extract({ left: 480, top: 62, width: 580, height: 212 }), 'logo.webp', 90);   // stops above the small tagline
  await webp(sharp(A('shrine-fusion-design/summoning-shrine.webp')).extract({ left: 360, top: 200, width: 450, height: 440 }).resize(420), 'shrine-card.webp', 82);
  await webp(sharp(A('tier-auras/aura-system.webp')).extract({ left: 392, top: 14, width: 1000, height: 348 }), 'ranks.webp', 82);
  await webp(sharp(path.join(ROOT, 'mythic-hero/reference/tsukiyomi-model.png')).extract({ left: 1015, top: 12, width: 640, height: 915 }).resize(560), 'tsukiyomi-mythic.webp', 84);
  // The eight elemental Shinobi, attack pose with their bombs (transparent).
  const pc = A('design-v3/players-core.webp'), cw = 1774 / 8, ch = 887 / 4;
  // Inset from the cell edges: the row above reaches into the top, neighbours into the sides.
  for (let i = 0; i < 8; i++) await cell(pc, i * cw + 4, 3 * ch + 22, cw - 8, ch - 22, 'hero-' + (i + 1) + '.webp', 220);
  // The five named Boss Hunt bosses (transparent).
  const bs = A('design-v3/bosses.webp');
  const inset = { yuki: 34 };   // Akuma's flames reach into Yuki's cell
  for (const [i, name] of ['akuma', 'yuki', 'raijin', 'daichi', 'orochi'].entries()) { const l = inset[name] || 14; await cell(bs, i * 256 + l, 60, 256 - l - 14, 470, 'boss-' + name + '.webp', 360); }
  console.log('Pre-launch artwork rebuilt in prelaunch/assets/.');
})().catch(e => { console.error(e); process.exit(1); });
