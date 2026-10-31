/* Exact standalone tier effects from the supplied aura sheet, shared by every hero renderer. */
(() => {
  const sprites = ShinobiSprites, previousReady = sprites.ready;
  const root = new URL('.', document.currentScript.src);
  const auraFrames = new Map(), composites = new WeakMap(), recent = new Map();
  let manifest, previousHeroFrame;
  const api = window.TierAuras = { loaded: false, ready: null, source: null, tiers: [], frame, compose, draw };
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
    isolateEffect(pixels.data, tier);
    context.putImageData(pixels, 0, 0);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 400; canvas.designSprite = true;
    const painter = canvas.getContext('2d'); painter.imageSmoothingEnabled = true; painter.imageSmoothingQuality = 'high';
    const scale = tier.scale;
    painter.drawImage(texture, 160 - tier.pivot[0] * scale, 352 - tier.pivot[1] * scale, width * scale, height * scale);
    canvas.tierAura = { rank, name: tier.name, source: manifest.file };
    auraFrames.set(rank, canvas);
    return canvas;
  }

  function isolateEffect(data, tier) {
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
      const colored = saturation > .3 && distance <= tier.hueTolerance;
      const highlight = high > .76 && saturation < .24;
      const strength = Math.max(0, Math.min(1, (high - .18) / .31));
      data[i + 3] = colored || highlight ? Math.round(255 * strength) : 0;
    }
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

  function draw(context, hero, x, y, scale = 1) {
    sprites.blit(context, frame(hero?.r), x, y, scale, false);
  }
})();
