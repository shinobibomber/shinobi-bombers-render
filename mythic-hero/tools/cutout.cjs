/* Cut-out helpers for the supplied Tsukiyomi reference sheets (Node + sharp, RGBA buffers).
 *  - character(): removes only the exterior backdrop connected to the crop edges (the same idea as
 *    PlayerModels.clearExterior), so enclosed black hair and clothing keep their pixels. Edge pixels
 *    get a soft alpha from their distance to the backdrop colour and are un-blended from it, so no
 *    navy fringe remains.
 *  - glow(): effects drawn on a dark backdrop. Brightness above the backdrop becomes alpha and the
 *    colour is un-premultiplied, giving true transparent RGBA frames for additive or normal drawing.
 */
'use strict';

function character(rgba, width, height, backdrop, tolerance = 26) {
  const n = width * height, dist = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    dist[p] = Math.hypot(rgba[i] - backdrop[0], rgba[i + 1] - backdrop[1], rgba[i + 2] - backdrop[2]);
  }
  const fg = new Uint8Array(n);
  for (let p = 0; p < n; p++) fg[p] = dist[p] > tolerance ? 1 : 0;
  // Close one-pixel gaps in the silhouette before flooding (dilate, then erode).
  // all=false: dilate (any neighbour set); all=true: erode (every neighbour set).
  const morph = (src, all) => {
    const out = new Uint8Array(n);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let any = 0, every = 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, v = nx >= 0 && nx < width && ny >= 0 && ny < height ? src[ny * width + nx] : 0;
        if (v) any = 1; else every = 0;
      }
      out[y * width + x] = all ? every : any;
    }
    return out;
  };
  let solid = fg;
  for (let k = 0; k < 2; k++) solid = morph(solid, false);
  for (let k = 0; k < 2; k++) solid = morph(solid, true);
  const outside = new Uint8Array(n), queue = new Int32Array(n);
  let head = 0, tail = 0;
  const add = p => { if (!outside[p] && !solid[p] && !fg[p]) { outside[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
  while (head < tail) {
    const p = queue[head++], x = p % width, y = (p - x) / width;
    if (x > 0) add(p - 1); if (x < width - 1) add(p + 1); if (y > 0) add(p - width); if (y < height - 1) add(p + width);
  }
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (outside[p]) { rgba[i + 3] = 0; continue; }
    // A pixel touching the removed backdrop is an anti-aliased edge: soft alpha + un-blend.
    const x = p % width, y = (p - x) / width;
    const edge = (x > 0 && outside[p - 1]) || (x < width - 1 && outside[p + 1]) || (y > 0 && outside[p - width]) || (y < height - 1 && outside[p + width]);
    if (!edge) { rgba[i + 3] = 255; continue; }
    const a = Math.max(0, Math.min(1, (dist[p] - 6) / 60));
    if (a <= 0.02) { rgba[i + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.max(0, Math.min(255, Math.round((rgba[i + c] - (1 - a) * backdrop[c]) / a)));
    rgba[i + 3] = Math.round(a * 255);
  }
  return rgba;
}

// floor: brightness at or below this is backdrop (dark panel / checkerboard); full: fully opaque.
function glow(rgba, width, height, floor = 48, full = 150, feather = 4) {
  const n = width * height;
  for (let p = 0; p < n; p++) {
    const i = p * 4, x = p % width, y = (p - x) / width;
    const high = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
    let a = Math.max(0, Math.min(1, (high - floor) / (full - floor)));
    a = a * a * (3 - 2 * a);
    const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
    if (edge < feather) a *= edge / feather;
    if (a < 0.03) { rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0; continue; }
    // Un-premultiply from black so a half-transparent glow keeps its full colour.
    const lift = Math.min(255 / Math.max(1, high), 1 / Math.max(a, 0.35));
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.min(255, Math.round(rgba[i + c] * lift));
    rgba[i + 3] = Math.round(a * 255);
  }
  // Drop isolated specks (checkerboard noise) smaller than 4 pixels.
  const seen = new Uint8Array(n), queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (seen[s] || rgba[s * 4 + 3] < 20) continue;
    let head = 0, tail = 1; seen[s] = 1; queue[0] = s;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, q = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[q] || rgba[q * 4 + 3] < 20) continue;
        seen[q] = 1; queue[tail++] = q;
      }
    }
    if (tail < 4) for (let k = 0; k < tail; k++) rgba[queue[k] * 4 + 3] = 0;
  }
  return rgba;
}

// The game's own cut-out for the shared action sheets (PlayerModels.clearExterior + the thin
// border-line removal of CharacterAnimations.crop), so a reused frame matches the game exactly.
function exterior(rgba, width, height) {
  const data = rgba, palette = [], edge = [];
  for (let x = 0; x < width; x++) edge.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) edge.push(y * width, y * width + width - 1);
  for (const p of edge) {
    const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.max(r, g, b) < 85 && r + g + b < 130 && !palette.some(c => Math.abs(c[0] - r) + Math.abs(c[1] - g) + Math.abs(c[2] - b) < 10)) palette.push([r, g, b]);
  }
  const background = p => {
    const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.max(r, g, b) < 18) return true;
    if (Math.max(r, g, b) > 95 || r + g + b > 150) return false;
    return palette.some(c => (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2 < 22 ** 2);
  };
  const n = width * height, fg = new Uint8Array(n), grown = new Uint8Array(n), solid = new Uint8Array(n);
  for (let p = 0; p < n; p++) fg[p] = background(p) ? 0 : 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let f = 0; for (let dy = -1; dy <= 1 && !f; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && nx < width && ny >= 0 && ny < height && fg[ny * width + nx]) { f = 1; break; } }
    grown[y * width + x] = f;
  }
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    let full = 1; for (let dy = -1; dy <= 1 && full; dy++) for (let dx = -1; dx <= 1; dx++) if (!grown[(y + dy) * width + x + dx]) { full = 0; break; }
    solid[y * width + x] = full;
  }
  const seen = new Uint8Array(n), queue = new Int32Array(n); let head = 0, tail = 0;
  const add = p => { if (seen[p]) return; seen[p] = 1; if (!fg[p] && !solid[p]) queue[tail++] = p; };
  edge.forEach(add);
  while (head < tail) { const p = queue[head++], x = p % width, y = (p - x) / width; data[p * 4 + 3] = 0; if (x > 0) add(p - 1); if (x < width - 1) add(p + 1); if (y > 0) add(p - width); if (y < height - 1) add(p + width); }
  for (const row of [0, 1, height - 2, height - 1]) {
    let opaque = 0; for (let x = 0; x < width; x++) if (data[(row * width + x) * 4 + 3]) opaque++;
    if (opaque > width * .75) for (let x = 0; x < width; x++) data[(row * width + x) * 4 + 3] = 0;
  }
  return data;
}

// Keep the main figure: drop opaque islands smaller than `share` of the largest one (sheet specks).
function keepMain(rgba, width, height, share = 0.02) {
  const n = width * height, label = new Int32Array(n).fill(-1), sizes = [], queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (label[s] >= 0 || rgba[s * 4 + 3] < 8) continue;
    const id = sizes.length; let head = 0, tail = 1; label[s] = id; queue[0] = s;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, q = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || label[q] >= 0 || rgba[q * 4 + 3] < 8) continue;
        label[q] = id; queue[tail++] = q;
      }
    }
    sizes.push(tail);
  }
  const big = Math.max(0, ...sizes);
  for (let p = 0; p < n; p++) if (label[p] >= 0 && sizes[label[p]] < big * share) rgba[p * 4 + 3] = 0;
  return rgba;
}

// Tight bounding box of pixels with alpha above a threshold.
function bounds(rgba, width, height, threshold = 8) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rgba[(y * width + x) * 4 + 3] > threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

module.exports = { character, exterior, glow, keepMain, bounds };
