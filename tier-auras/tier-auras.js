/* Clean source auras and bounded Elite/Legend energy animation. Rendering only. */
(() => {
  const sprites = ShinobiSprites, previousReady = sprites.ready;
  const root = new URL('.', document.currentScript.src);
  const auraFrames = new Map(), animatedFrames = new Map(), composites = new WeakMap(), recent = new Map();
  const motion = matchMedia('(prefers-reduced-motion: reduce)'), phaseCount = 24;
  let manifest, previousHeroFrame, baseBlit = sprites.blit;
  const api = window.TierAuras = { loaded: false, ready: null, source: null, tiers: [], frame, animatedFrame, compose, draw,
    get animationFrames() { return animatedFrames.size; }, maxAnimationFrames: phaseCount * 2 };
  const image = new Image();
  const original = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The original tier aura sheet could not be loaded.'));
    image.src = new URL('auras.png', root).href;
  });
  const metadata = fetch(new URL('manifest.json', root)).then(response => {
    if (!response.ok) throw new Error('Tier aura coordinates could not be loaded.');
    return response.json();
  });
  api.ready = sprites.ready = Promise.all([previousReady, original, metadata]).then(([, , source]) => {
    if (source.version !== 1 || source.tiers.length !== 5 || image.naturalWidth !== source.width || image.naturalHeight !== source.height) {
      throw new Error('The tier aura sheet and coordinates do not match.');
    }
    manifest = api.source = source;
    api.tiers = source.tiers.map(({ rank, name, color }) => ({ rank, name, color }));
    for (let rank = 0; rank < 5; rank++) frame(rank);
    previousHeroFrame = sprites.heroFrame;
    sprites.heroFrame = DesignModels.heroFrame = function (hero, ...args) {
      return compose(hero, previousHeroFrame(hero, ...args));
    };
    baseBlit = sprites.blit;
    sprites.blit = function (context, canvas, x, y, scale, flip, alpha) {
      // Body frames remain cached independently of aura time. This avoids a
      // frame/rarity/phase cross-product and never repaints the character itself.
      if (canvas.tierAuraBase && canvas.tierAura?.rank >= 3) {
        baseBlit(context, animatedFrame(canvas.tierAura.rank, performance.now()), x, y, scale, flip, alpha);
        return baseBlit(context, canvas.tierAuraBase, x, y, scale, flip, alpha);
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
  function frame(rank) {
    rank = tierOf(rank);
    if (auraFrames.has(rank)) return auraFrames.get(rank);
    if (!manifest) throw new Error('Wait for TierAuras.ready before drawing an aura.');
    const tier = manifest.tiers[rank], [x, y, width, height] = tier.rect;
    const texture = document.createElement('canvas'); texture.width = width; texture.height = height;
    const context = texture.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    isolateEffect(pixels.data, tier, width, height);
    context.putImageData(pixels, 0, 0);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 400; canvas.designSprite = true;
    const painter = canvas.getContext('2d'); painter.imageSmoothingEnabled = true; painter.imageSmoothingQuality = 'high';
    // The old effect occupied only the lower half of the shared frame and was
    // mostly hidden by the body. Widen the same original effect around its foot
    // anchor; retain its colors, outlines and native source design.
    const scale = Math.min(292 / width, tier.scale * 1.22), vertical = Math.min(scale, .60);
    // Preserve the source design but fit its low ground sparks inside the quad.
    // Previously the last ~40px were cut off at a hard canvas edge.
    painter.globalAlpha = tier.rank >= 3 ? .88 : 1;
    painter.drawImage(texture, 160 - tier.pivot[0] * scale, 336 - tier.pivot[1] * vertical, width * scale, height * vertical);
    painter.globalAlpha = 1;
    if (tier.rank >= 3) energy(painter, tier.rank, 0, false);
    canvas.tierAura = { rank, name: tier.name, source: manifest.file };
    auraFrames.set(rank, canvas);
    return canvas;
  }

  function smooth(low, high, value) {
    const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  }
  function isolateEffect(data, tier, width, height) {
    // The standalone effects contain no character. Isolate the supplied luminous
    // tier color and white highlights from the dark environmental backdrop.
    // Keep every retained source RGB value; change only rendering alpha.
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
      const saturation = high ? delta / high : 0;
      let hue = 0;
      if (delta) {
        if (high === r) hue = ((g - b) / delta) % 6;
        else if (high === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue = (hue * 60 + 360) % 360;
      }
      const distance = Math.min(Math.abs(hue - tier.hue), 360 - Math.abs(hue - tier.hue));
      const colored = smooth(.22, .38, saturation) * (1 - smooth(tier.hueTolerance - 10, tier.hueTolerance + 10, distance));
      const highlight = smooth(.72, .9, high) * (1 - smooth(.16, .32, saturation));
      const strength = smooth(.18, .55, high) * Math.max(colored, highlight);
      const pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width);
      const edge = smooth(0, 4, Math.min(x, y, width - 1 - x, height - 1 - y));
      data[i + 3] = Math.round(255 * strength * edge);
    }
    // Thresholding can leave tiny detached scenery flecks. Remove only those
    // components once at load; intentional stars and luminous lines remain.
    const seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
    for (let first = 0; first < seen.length; first++) {
      if (seen[first] || data[first * 4 + 3] < 12) continue;
      let head = 0, tail = 1; seen[first] = 1; queue[0] = first;
      while (head < tail) {
        const p = queue[head++], x = p % width, y = Math.floor(p / width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, n = ny * width + nx;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen[n] || data[n * 4 + 3] < 12) continue;
          seen[n] = 1; queue[tail++] = n;
        }
      }
      if (tail < 8) for (let i = 0; i < tail; i++) data[queue[i] * 4 + 3] = 0;
    }
    for (let i = 3; i < data.length; i += 4) if (data[i] < 12) data[i] = 0;
  }

  function energy(context, rank, angle, moving) {
    const gold = rank === 4, color = gold ? '#ffc735' : '#c76aff', core = gold ? '#fff4be' : '#f3d9ff';
    context.save(); context.lineCap = 'round'; context.lineJoin = 'round';
    // Smooth floor illumination leaves the face and costume clear.
    const light = context.createRadialGradient(160, 342, 8, 160, 342, 146);
    light.addColorStop(0, gold ? '#ffb81940' : '#b740ff38'); light.addColorStop(1, '#00000000');
    context.fillStyle = light; context.fillRect(10, 196, 300, 198);
    const paths = [
      [142, 39, 0, Math.PI * 2],
      [128, 32, angle, angle + Math.PI * 1.3],
      [110, 24, -angle + Math.PI, -angle + Math.PI * 2.25]
    ];
    for (let pass = 0; pass < 2; pass++) {
      context.strokeStyle = pass ? core : color; context.lineWidth = pass ? 1.7 : 7;
      context.globalAlpha = pass ? .95 : .24;
      for (const [rx, ry, start, end] of paths) {
        context.beginPath(); context.ellipse(160, 342, rx, ry, 0, start, end); context.stroke();
      }
    }
    // A pair of smooth climbing trails provides a distinct tall silhouette.
    for (const side of [-1, 1]) {
      context.globalAlpha = .7; context.strokeStyle = color; context.lineWidth = 2.4;
      context.beginPath(); context.moveTo(160 + side * 95, 337);
      context.bezierCurveTo(160 + side * 153, 291, 160 + side * 72, 229, 160 + side * (91 + Math.sin(angle) * 6), gold ? 187 : 214);
      context.stroke();
    }
    if (gold) {
      // Controlled lightning follows a fixed contour: no random flashes.
      for (const side of [-1, 1]) {
        context.beginPath(); context.moveTo(160 + side * 130, 327);
        context.lineTo(160 + side * 111, 291); context.lineTo(160 + side * 124, 277);
        context.lineTo(160 + side * 101, 243); context.lineTo(160 + side * 111, 219);
        context.strokeStyle = core; context.lineWidth = 1.8; context.globalAlpha = .58 + Math.sin(angle) * .12; context.stroke();
      }
    }
    const count = moving ? (gold ? 7 : 5) : 3;
    for (let i = 0; i < count; i++) {
      const a = angle + i * Math.PI * 2 / count, x = 160 + Math.cos(a) * 130;
      const y = 307 + Math.sin(a) * 44 - (i % 3) * 34, size = gold ? 3 : 2.5;
      context.globalAlpha = .72; context.fillStyle = core; context.beginPath();
      context.moveTo(x, y - size * 2); context.lineTo(x + size, y); context.lineTo(x, y + size * 2); context.lineTo(x - size, y); context.closePath(); context.fill();
    }
    context.restore();
  }

  function animatedFrame(rank, now = 0) {
    rank = tierOf(rank);
    const quality = window.Arena3D?.cfg.fx ?? 1;
    if (rank < 3 || motion.matches || quality === 0 || document.hidden) return frame(rank);
    const phase = Math.floor(Math.max(0, now) / (2000 / phaseCount)) % phaseCount;
    const quantized = quality === 1 ? phase - phase % 2 : phase;
    const key = rank + ':' + quantized;
    if (animatedFrames.has(key)) return animatedFrames.get(key);
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 200; canvas.designSprite = true;
    const context = canvas.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(frame(rank), 0, 0, 160, 200);
    context.save(); context.scale(.5, .5);
    const angle = quantized * Math.PI * 2 / phaseCount;
    context.globalAlpha = .7 + Math.sin(angle) * .08;
    energy(context, rank, angle, true); context.restore();
    canvas.tierAura = { rank, name: manifest.tiers[rank].name, source: manifest.file, phase: quantized };
    animatedFrames.set(key, canvas);
    return canvas;
  }

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

  function draw(context, hero, x, y, scale = 1, now) {
    baseBlit(context, now === undefined ? frame(hero?.r) : animatedFrame(hero?.r, now), x, y, scale, false);
  }
})();
