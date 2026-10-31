/* Shared player art from the original uploaded sheet. No hero/account state is changed. */
(() => {
  const sprites = window.ShinobiSprites;
  const previousReady = sprites.ready;
  const sourceUrl = new URL('.', document.currentScript.src);
  const textures = new Map();
  const frames = new Map();
  const api = window.PlayerModels = { loaded: false, ready: null, source: null, catalog: [], modelFor, heroFrame, portraitFrame, drawPortrait, frameInfo, clearExterior };

  const image = new Image();
  const imageReady = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The original player-model sheet could not be loaded.'));
    image.src = new URL('playermodel.png', sourceUrl).href;
  });
  const manifestReady = fetch(new URL('frames.json', sourceUrl)).then(response => {
    if (!response.ok) throw new Error('Player-model frame coordinates could not be loaded.');
    return response.json();
  });
  const ready = api.ready = Promise.all([previousReady, imageReady, manifestReady]).then(([, , manifest]) => {
    if (manifest.version !== 1 || manifest.models.length !== 8 ||
        image.naturalWidth !== manifest.width || image.naturalHeight !== manifest.height) {
      throw new Error('The player-model source and frame coordinates do not match.');
    }
    api.source = manifest;
    api.catalog = manifest.models.map(({ key, label }) => ({ key, label }));
    // Prepare the small native cells once. Crops never cross a character or label.
    for (let model = 0; model < 8; model++) {
      for (const direction of ['front', 'side', 'back', 'idle']) {
        const cells = manifest.models[model].frames[direction];
        if (cells.length !== 3) throw new Error('Each direction must contain three original frames.');
        cells.forEach((cell, phase) => textures.set([model, direction, phase].join('.'), cut(cell)));
      }
    }
    api.loaded = true;
    // Both entry points are required: legacy portraits delegate to DesignModels,
    // while the arena and newer menus call ShinobiSprites directly.
    sprites.heroFrame = heroFrame;
    DesignModels.heroFrame = heroFrame;
    const previousEnemyFrame = sprites.enemyFrame;
    const enemyFrame = (kind, pose, boss, seed = 0) => kind === 6
      ? heroFrame({ id: Math.abs(seed | 0), r: 0 }, pose)
      : previousEnemyFrame(kind, pose, boss, seed);
    sprites.enemyFrame = enemyFrame;
    DesignModels.enemyFrame = enemyFrame;
    sprites.clearCache();
    ReferenceLayout.refresh();
    if (tab === 1) team();
    else if (tab === 2) summ();
    else if (tab === 4) vil();
    else if (tab === 6) go(6);
    dispatchEvent(new CustomEvent('shinobi-player-models-ready'));
    return true;
  });
  sprites.ready = ready;
  ready.catch(error => console.error('Player models could not be loaded:', error));

  function modelFor(hero) {
    const id = Math.abs(Math.trunc(Number(hero?.id) || 0)) % 8;
    return { index: id, ...api.catalog[id] };
  }

  function frameInfo(hero, pose = 'i0', direction) {
    const model = modelFor(hero);
    const moving = pose.startsWith('w');
    const attack = pose.startsWith('a');
    let row = ['front', 'side', 'back'].includes(direction) ? direction : 'front';
    if (row === 'front' && !moving && !attack) row = 'idle';
    const index = Math.abs(parseInt(pose.slice(1), 10) || 0) % 4;
    const phase = [0, 1, 2, 1][index];
    const key = [model.index, row, phase].join('.');
    return { ...model, direction: row, phase, key, cell: api.source?.models[model.index].frames[row][phase] };
  }

  function heroFrame(hero, pose = 'i0', blink, direction) {
    const info = frameInfo(hero, pose, direction);
    if (!api.loaded) throw new Error('Wait for PlayerModels.ready before drawing player frames.');
    if (frames.has(info.key)) return frames.get(info.key);
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 400; canvas.designSprite = true;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const texture = textures.get(info.key);
    const scale = api.source.scale;
    const [pivotX, pivotY] = info.cell.pivot;
    // Every row keeps the same scale and foot anchor; no stretched poses,
    // recoloring, added costume parts, or radial feathering of the character.
    context.drawImage(texture, 160 - pivotX * scale, 352 - pivotY * scale,
      texture.width * scale, texture.height * scale);
    canvas.playerModel = { key: info.key, model: info.index, direction: info.direction, phase: info.phase };
    frames.set(info.key, canvas);
    return canvas;
  }

  // Menus use the larger original base cells. The action atlas is optimized for
  // small moving actors and contains substantially fewer native face pixels.
  // Keep the model identity, original pose artwork and supplied tier effect.
  function portraitFrame(hero, now = 0) {
    const base = heroFrame(hero, hero.z ? 's0' : sprites.idleName(now, hero.id));
    return window.TierAuras?.loaded ? TierAuras.compose(hero, base) : base;
  }

  // Draw the native source cell only once into the final display canvas. Portraits
  // previously enlarged the cell into a 320x400 frame, then resized it again.
  // The legacy blit scale and foot anchor remain identical for every caller.
  function drawPortrait(context, hero, x, y, scale, now = 0) {
    if (!api.loaded || !hero) return;
    const info = frameInfo(hero, hero.z ? 's0' : sprites.idleName(now, hero.id));
    const texture = textures.get(info.key), ratio = api.source.scale * scale / 8;
    const [pivotX, pivotY] = info.cell.pivot;
    context.save();
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    if (hero.z) context.globalAlpha *= .68;
    if (window.TierAuras?.loaded) {
      const effect = TierAuras.frame(hero.r);
      sprites.blit(context, effect, x, y, scale, false);
      context.save(); context.globalCompositeOperation = 'screen';
      context.globalAlpha *= .28 + Math.max(0, Math.min(4, hero.r)) * .035;
      sprites.blit(context, effect, x, y, scale, false); context.restore();
    }
    context.drawImage(texture, x - pivotX * ratio, y - pivotY * ratio,
      texture.width * ratio, texture.height * ratio);
    context.restore();
  }

  function cut(cell) {
    const [x, y, width, height] = cell.rect;
    if (![x, y, width, height].every(Number.isInteger) || width <= 0 || height <= 0 ||
        x < 0 || y < 0 || x + width > image.naturalWidth || y + height > image.naturalHeight) {
      throw new Error('A player-model crop is outside the supplied sheet.');
    }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    clearExterior(pixels, width, height);
    context.putImageData(pixels, 0, 0);
    return canvas;
  }

  // The source is an opaque presentation sheet. Remove only exterior background
  // connected to a cell edge. Enclosed black clothing and hair retain their pixels.
  // RGB values are never altered: this is an alpha mask over the original art.
  function clearExterior(imageData, width, height) {
    const data = imageData.data;
    const palette = [];
    const edge = [];
    for (let x = 0; x < width; x++) edge.push(x, (height - 1) * width + x);
    for (let y = 1; y < height - 1; y++) edge.push(y * width, y * width + width - 1);
    for (const pixel of edge) {
      const i = pixel * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (Math.max(r, g, b) < 85 && r + g + b < 130) {
        if (!palette.some(color => Math.abs(color[0] - r) + Math.abs(color[1] - g) + Math.abs(color[2] - b) < 10)) palette.push([r, g, b]);
      }
    }
    function background(pixel) {
      const i = pixel * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (Math.max(r, g, b) < 18) return true;
      if (Math.max(r, g, b) > 95 || r + g + b > 150) return false;
      return palette.some(color => (color[0] - r) ** 2 + (color[1] - g) ** 2 + (color[2] - b) ** 2 < 22 ** 2);
    }
    // Close one-pixel gaps in the colored silhouette before flooding. Without
    // this, an open outline can connect black fabric to the black backdrop and
    // punch holes through the costume. The fill keeps the original dark RGB.
    const foreground = new Uint8Array(width * height);
    const expanded = new Uint8Array(width * height);
    const silhouette = new Uint8Array(width * height);
    for (let pixel = 0; pixel < foreground.length; pixel++) foreground[pixel] = background(pixel) ? 0 : 1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let found = 0;
      for (let dy = -1; dy <= 1 && !found; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && foreground[ny * width + nx]) { found = 1; break; }
      }
      expanded[y * width + x] = found;
    }
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      let full = 1;
      for (let dy = -1; dy <= 1 && full; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!expanded[(y + dy) * width + x + dx]) { full = 0; break; }
      }
      silhouette[y * width + x] = full;
    }
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let start = 0, end = 0;
    function add(pixel) {
      if (visited[pixel]) return;
      visited[pixel] = 1;
      if (!foreground[pixel] && !silhouette[pixel]) queue[end++] = pixel;
    }
    edge.forEach(add);
    while (start < end) {
      const pixel = queue[start++], x = pixel % width, y = Math.floor(pixel / width);
      data[pixel * 4 + 3] = 0;
      if (x > 0) add(pixel - 1);
      if (x < width - 1) add(pixel + 1);
      if (y > 0) add(pixel - width);
      if (y < height - 1) add(pixel + width);
    }
  }
})();
