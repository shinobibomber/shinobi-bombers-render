/* Hero Aura System (website/assets/aura-system.webp): each rarity's own ground ring, wreath and
   particles, layered ground circle → behind-hero aura → hero → foreground particles. Rendering only. */
(() => {
  const sprites = ShinobiSprites, previousReady = sprites.ready;
  const root = new URL('.', document.currentScript.src);
  const layers = new Map(), backs = new Map(), fronts = new Map(), animated = new Map(), composites = new WeakMap(), recent = new Map();
  const motion = matchMedia('(prefers-reduced-motion: reduce)'), phaseCount = 8, cycleMs = 1600;
  let manifest, previousHeroFrame, baseBlit = sprites.blit;
  const api = window.TierAuras = { loaded: false, ready: null, source: null, tiers: [], frame, front, animatedFrame, animatedFront, compose, draw, drawFront,
    get animationFrames() { return animated.size; }, maxAnimationFrames: 5 * phaseCount * 2 };
  const image = new Image();
  const original = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The hero aura sheet could not be loaded.'));
    image.src = new URL('aura-system.webp', root).href;
  });
  const metadata = fetch(new URL('manifest.json', root)).then(response => {
    if (!response.ok) throw new Error('Hero aura coordinates could not be loaded.');
    return response.json();
  });
  api.ready = sprites.ready = Promise.all([previousReady, original, metadata]).then(([, , source]) => {
    if (source.version !== 2 || source.tiers.length !== 5 || image.naturalWidth !== source.width || image.naturalHeight !== source.height) {
      throw new Error('The hero aura sheet and coordinates do not match.');
    }
    manifest = api.source = source;
    api.tiers = source.tiers.map(({ rank, name, color }) => ({ rank, name, color }));
    for (let rank = 0; rank < 5; rank++) { frame(rank); front(rank); }
    previousHeroFrame = sprites.heroFrame;
    sprites.heroFrame = DesignModels.heroFrame = function (hero, ...args) {
      return compose(hero, previousHeroFrame(hero, ...args));
    };
    baseBlit = sprites.blit;
    sprites.blit = function (context, canvas, x, y, scale, flip, alpha) {
      // Body frames stay cached independently of aura time: the animated layers are separate
      // canvases drawn around the unchanged body, never a frame × rank × phase cross-product.
      if (canvas.tierAuraBase && canvas.tierAura) {
        const now = performance.now(), rank = canvas.tierAura.rank;
        baseBlit(context, animatedFrame(rank, now), x, y, scale, flip, alpha);
        baseBlit(context, canvas.tierAuraBase, x, y, scale, flip, alpha);
        return baseBlit(context, animatedFront(rank, now), x, y, scale, flip, alpha);
      }
      return baseBlit(context, canvas, x, y, scale, flip, alpha);
    };
    api.loaded = true;
    sprites.clearCache();
    ReferenceLayout.refresh();
    dispatchEvent(new CustomEvent('shinobi-tier-auras-ready'));
    return true;
  });
  api.ready.catch(error => console.error('Tier auras could not be loaded:', error));

  function tierOf(value) { return Math.max(0, Math.min(4, Math.trunc(Number(value) || 0))); }
  function smooth(low, high, value) {
    const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  }

  // Key one sheet tile off its dark checkerboard once: brightness sets alpha, crop edges are
  // feathered, tiny specks are removed and partly transparent pixels keep their full glow colour
  // (no dark fringe where the glow met the background).
  function layer(rank, part) {
    const id = rank + ':' + part;
    if (layers.has(id)) return layers.get(id);
    const [x, y, width, height] = manifest.tiers[rank][part];
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height), data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      const high = Math.max(data[i], data[i + 1], data[i + 2]) / 255, pixel = i / 4, px = pixel % width, py = Math.floor(pixel / width);
      const edge = smooth(0, 5, Math.min(px, py, width - 1 - px, height - 1 - py));
      const alpha = smooth(.24, .62, high) * edge;
      if (alpha > 0 && high > 0) { const lift = Math.min(1 / high, 1.6); data[i] = Math.min(255, data[i] * lift); data[i + 1] = Math.min(255, data[i + 1] * lift); data[i + 2] = Math.min(255, data[i + 2] * lift); }
      data[i + 3] = Math.round(255 * alpha);
    }
    const seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
    for (let first = 0; first < seen.length; first++) {
      if (seen[first] || data[first * 4 + 3] < 16) continue;
      let head = 0, tail = 1; seen[first] = 1; queue[0] = first;
      while (head < tail) {
        const p = queue[head++], px = p % width, py = Math.floor(p / width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy, n = ny * width + nx;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen[n] || data[n * 4 + 3] < 16) continue;
          seen[n] = 1; queue[tail++] = n;
        }
      }
      if (tail < 4) for (let i = 0; i < tail; i++) data[queue[i] * 4 + 3] = 0;
    }
    for (let i = 3; i < data.length; i += 4) if (data[i] < 10) data[i] = 0;
    context.putImageData(pixels, 0, 0);
    layers.set(id, canvas);
    return canvas;
  }

  // Layout inside the shared 320×400 hero frame (feet at 160,352). phase 0..1 animates gently:
  // the ground ring breathes, the wreath pulses and the particles drift up and fade, looping.
  function paintBack(context, rank, phase, moving) {
    const wave = moving ? Math.cos(phase * Math.PI * 2) : 0;
    const ground = layer(rank, 'ground'), wreath = layer(rank, 'wreath');
    context.save(); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    const gw = 236 * (1 + wave * .03), gh = gw * .3;
    context.globalAlpha = .8 + wave * .15; context.drawImage(ground, 160 - gw / 2, 352 - gh / 2, gw, gh);
    const ww = 312 * (1 + wave * .012), wh = ww * wreath.height / wreath.width;
    context.globalAlpha = .92 + wave * .08; context.drawImage(wreath, 160 - ww / 2, 372 - wh, ww, wh);
    context.restore();
  }
  function paintFront(context, rank, phase, moving) {
    // The particle art is split down the middle and each half rises beside the hero, so the
    // foreground layer never covers the hero's face or body.
    const sparks = layer(rank, 'particles'), half = sparks.width / 2, w = 104, h = w * 2 * sparks.height / sparks.width;
    context.save(); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    // Two copies half a cycle apart rise 40px and fade, so the loop has no visible seam.
    for (const offset of moving ? [0, .5] : [0]) {
      const t = (phase + offset) % 1, rise = moving ? t * 40 : 0;
      context.globalAlpha = moving ? .7 * Math.sin(t * Math.PI) : .55;
      context.drawImage(sparks, 0, 0, half, sparks.height, 160 - 52 - w, 366 - h - rise, w, h);
      context.drawImage(sparks, half, 0, half, sparks.height, 160 + 52, 366 - h - rise, w, h);
    }
    context.restore();
  }
  function surface(width, height) { const c = document.createElement('canvas'); c.width = width; c.height = height; c.designSprite = true; return c; }

  // Static layers (reduced motion, effects off, portraits): full resolution, phase 0.
  function frame(rank) {
    rank = tierOf(rank);
    if (backs.has(rank)) return backs.get(rank);
    if (!manifest) throw new Error('Wait for TierAuras.ready before drawing an aura.');
    const canvas = surface(320, 400); paintBack(canvas.getContext('2d'), rank, 0, false);
    canvas.tierAura = { rank, name: manifest.tiers[rank].name, source: manifest.file, layer: 'back' };
    backs.set(rank, canvas); return canvas;
  }
  function front(rank) {
    rank = tierOf(rank);
    if (fronts.has(rank)) return fronts.get(rank);
    if (!manifest) throw new Error('Wait for TierAuras.ready before drawing an aura.');
    const canvas = surface(320, 400); paintFront(canvas.getContext('2d'), rank, 0, false);
    canvas.tierAura = { rank, name: manifest.tiers[rank].name, source: manifest.file, layer: 'front' };
    fronts.set(rank, canvas); return canvas;
  }
  // Animated layers: 8 cached phases per rank and layer at half resolution (arena actors are
  // small), at most 80 canvases. Low effects quality uses every other phase.
  function still() { return motion.matches || (window.Arena3D?.cfg.fx ?? 1) === 0 || document.hidden; }
  function phaseAt(now) {
    const phase = Math.floor(Math.max(0, now) / (cycleMs / phaseCount)) % phaseCount;
    return (window.Arena3D?.cfg.fx ?? 1) === 1 ? phase - phase % 2 : phase;
  }
  function animated_(rank, now, kind) {
    rank = tierOf(rank);
    if (still()) return kind === 'back' ? frame(rank) : front(rank);
    // The breathing back layer is symmetric (phase p and 8 - p look the same), so those share one canvas.
    const raw = phaseAt(now), phase = kind === 'back' ? Math.min(raw, (phaseCount - raw) % phaseCount) : raw, key = kind + rank + ':' + phase;
    if (animated.has(key)) return animated.get(key);
    const canvas = surface(160, 200), context = canvas.getContext('2d');
    context.scale(.5, .5);
    (kind === 'back' ? paintBack : paintFront)(context, rank, phase / phaseCount, true);
    canvas.tierAura = { rank, name: manifest.tiers[rank].name, source: manifest.file, layer: kind, phase };
    animated.set(key, canvas); return canvas;
  }
  function animatedFrame(rank, now = 0) { return animated_(rank, now, 'back'); }
  function animatedFront(rank, now = 0) { return animated_(rank, now, 'front'); }

  function compose(hero, base) {
    const rank = tierOf(hero?.r);
    if (base.tierAuraBase) base = base.tierAuraBase;
    let byRank = composites.get(base);
    if (!byRank) { byRank = new Map(); composites.set(base, byRank); }
    if (byRank.has(rank)) {
      const cached = byRank.get(rank), record = recent.get(cached);
      if (record) { recent.delete(cached); recent.set(cached, record); }
      return cached;
    }
    const canvas = document.createElement('canvas'); canvas.width = base.width; canvas.height = base.height;
    canvas.designSprite = base.designSprite;
    const context = canvas.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(frame(rank), 0, 0, canvas.width, canvas.height);
    context.drawImage(base, 0, 0);
    context.drawImage(front(rank), 0, 0, canvas.width, canvas.height);
    // Keep the shared model/animation identity metadata used by every menu.
    if (base.playerModel) canvas.playerModel = base.playerModel;
    if (base.characterAnimation) canvas.characterAnimation = base.characterAnimation;
    canvas.tierAura = { rank, name: manifest.tiers[rank].name, source: manifest.file };
    canvas.tierAuraBase = base;
    byRank.set(rank, canvas);
    recent.set(canvas, { byRank, rank });
    if (recent.size > 128) {
      const [oldest, record] = recent.entries().next().value;
      recent.delete(oldest);
      if (record.byRank.get(record.rank) === oldest) record.byRank.delete(record.rank);
    }
    return canvas;
  }

  // Portraits: draw() before the hero, drawFront() after it.
  function draw(context, hero, x, y, scale = 1, now) {
    baseBlit(context, now === undefined ? frame(hero?.r) : animatedFrame(hero?.r, now), x, y, scale, false);
  }
  function drawFront(context, hero, x, y, scale = 1, now) {
    baseBlit(context, now === undefined ? front(hero?.r) : animatedFront(hero?.r, now), x, y, scale, false);
  }
})();
