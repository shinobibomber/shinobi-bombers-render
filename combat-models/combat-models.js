/* Original enemy and boss art, shared by Adventure and Boss Hunts. Rendering only. */
(() => {
  const sprites = window.ShinobiSprites;
  const previousReady = sprites.ready;
  const sourceUrl = new URL('.', document.currentScript.src);
  const images = {};
  const textures = new Map();
  const frames = new Map();
  const api = window.CombatModels = {
    loaded: false, ready: null, source: null, enemies: [], bosses: [],
    enemyFor, bossFor, frameInfo, enemyFrame, bossFrame
  };
  const manifestReady = fetch(new URL('frames.json', sourceUrl)).then(response => {
    if (!response.ok) throw new Error('Enemy and boss frame coordinates could not be loaded.');
    return response.json();
  });
  const imageReady = Promise.all(['EnemyModel.png', 'BossModel.png'].map(file => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { images[file] = image; resolve(); };
    image.onerror = () => reject(new Error('The original combat-model sheet could not be loaded: ' + file));
    image.src = new URL(file, sourceUrl).href;
  })));
  const ready = api.ready = Promise.all([previousReady, manifestReady, imageReady]).then(([, manifest]) => {
    if (manifest.version !== 1 || manifest.enemies.length !== 16 || manifest.bosses.length !== 6) {
      throw new Error('The enemy and boss model catalog does not match the supplied sheets.');
    }
    for (const source of Object.values(manifest.sources)) {
      const image = images[source.file];
      if (!image || image.naturalWidth !== source.width || image.naturalHeight !== source.height) {
        throw new Error('The original combat-model sheet dimensions do not match its coordinates.');
      }
    }
    if (typeof PlayerModels.clearExterior !== 'function') throw new Error('The shared character silhouette mask is unavailable.');
    api.source = manifest;
    api.enemies = manifest.enemies.map(({ key, label }) => ({ key, label }));
    api.bosses = manifest.bosses.map(({ key, label }) => ({ key, label }));
    for (const [group, models, source] of [
      ['enemy', manifest.enemies, manifest.sources.enemy],
      ['boss', manifest.bosses, manifest.sources.boss]
    ]) {
      models.forEach((model, index) => {
        for (const [name, cell] of entries(model)) textures.set([group, index, name].join('.'), cut(images[source.file], cell));
      });
    }
    api.loaded = true;
    sprites.enemyFrame = enemyFrame;
    DesignModels.enemyFrame = enemyFrame;
    sprites.bossFrame = bossFrame;
    DesignModels.bossFrame = bossFrame;
    // Hit flashes previously cached only kind/pose, which can reuse another
    // stage's silhouette. Keep the exact model in the existing flash-cache key.
    const previousWhiteOf = sprites.whiteOf;
    sprites.whiteOf = (canvas, key) => previousWhiteOf(canvas, canvas.combatModel ? key + '.' + canvas.combatModel.key : key);
    sprites.clearCache();
    window.Arena3D?.rebuild();
    dispatchEvent(new CustomEvent('shinobi-combat-models-ready'));
    return true;
  });
  sprites.ready = ready;
  ready.catch(error => console.error('Combat models could not be loaded:', error));

  function integer(value, fallback = 1) {
    return Number.isFinite(Number(value)) ? Math.max(1, Math.trunc(Number(value))) : fallback;
  }
  function enemyFor(stage = 1, kind = 2) {
    const index = (integer(stage) - 1 + Math.max(0, integer(kind, 2) - 2)) % 16;
    return { index, ...api.enemies[index] };
  }
  function bossFor(stage = 1) {
    const index = (integer(stage) - 1) % 6;
    return { index, ...api.bosses[index] };
  }
  function entries(model) {
    return [
      ...Object.entries(model.directions || {}).map(([name, cell]) => ['direction.' + name, cell]),
      ...(model.base || []).map((cell, index) => ['base.' + index, cell]),
      ...Object.entries(model.animation).map(([name, cell]) => ['animation.' + name, cell])
    ];
  }
  function frameInfo(group, modelIndex, pose = 'i0') {
    if (!api.source) throw new Error('Wait for CombatModels.ready before drawing combat frames.');
    const models = group === 'boss' ? api.source.bosses : api.source.enemies;
    const model = models[modelIndex];
    const phase = Math.abs(parseInt(pose.slice(1), 10) || 0);
    const state = ({ w: 'walk', a: phase % 2 ? 'skill' : 'attack', h: 'hurt', s: 'hurt', d: 'defeat' })[pose[0]];
    let name;
    if (group === 'enemy' && model.key === 'tsuki-wolf') {
      // Its tiny example row shows a different humanoid. Retain the supplied
      // quadruped for this archetype instead of switching anatomy mid-animation.
      name = 'base.' + (phase % model.base.length);
    } else if (state) name = 'animation.' + (model.animation[state] ? state : 'attack');
    else if (group === 'boss') name = 'direction.' + (phase % 2 ? 'idle' : 'front');
    else name = 'base.' + (phase % Math.min(2, model.base.length));
    return { group, index: modelIndex, model: model.key, label: model.label, name, key: [group, modelIndex, name].join('.'), cell: new Map(entries(model)).get(name) };
  }
  function enemyFrame(kind, pose = 'i0', boss = false, seed = 0) {
    // Commanders also use kind 6, so the explicit boss flag takes precedence.
    if (boss) return bossFrame(Math.ceil(integer(S.map) / 25), pose);
    // Non-boss prison rescue figures remain player models.
    if (kind === 6) return sprites.heroFrame({ id: Math.abs(seed | 0), r: 0 }, pose);
    return render(frameInfo('enemy', enemyFor(S.map, kind).index, pose));
  }
  function bossFrame(stage, pose = 'i0') {
    return render(frameInfo('boss', bossFor(stage).index, pose));
  }
  function render(info) {
    if (!api.loaded) throw new Error('Wait for CombatModels.ready before drawing combat frames.');
    if (frames.has(info.key)) return frames.get(info.key);
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 400; canvas.designSprite = true;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const texture = textures.get(info.key);
    const scale = info.cell.scale;
    const [pivotX, pivotY] = info.cell.pivot;
    context.drawImage(texture, 160 - pivotX * scale, 352 - pivotY * scale, texture.width * scale, texture.height * scale);
    canvas.combatModel = { key: info.key, group: info.group, model: info.index, archetype: info.model, pose: info.name };
    frames.set(info.key, canvas);
    return canvas;
  }
  function cut(image, cell) {
    const [x, y, width, height] = cell.rect;
    if (![x, y, width, height].every(Number.isInteger) || width <= 0 || height <= 0 || x < 0 || y < 0 ||
        x + width > image.naturalWidth || y + height > image.naturalHeight ||
        !Number.isFinite(cell.scale) || cell.scale <= 0 || !cell.pivot.every(Number.isFinite)) {
      throw new Error('A combat-model crop is outside the supplied sheet.');
    }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    PlayerModels.clearExterior(pixels, width, height);
    preserveDarkInterior(pixels, width, height);
    context.putImageData(pixels, 0, 0);
    return canvas;
  }

  function preserveDarkInterior(imageData, width, height) {
    // These larger figures have wider breaks between colored outline pixels
    // than the player sheet. Close those breaks before the exterior flood so
    // black sleeves and torsos stay solid. Only alpha is changed.
    const data = imageData.data, size = width * height, radius = 3;
    const foreground = new Uint8Array(size), expanded = new Uint8Array(size), barrier = new Uint8Array(size);
    for (let i = 0; i < size; i++) foreground[i] = data[i * 4 + 3] > 0 ? 1 : 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let found = 0;
      for (let dy = -radius; dy <= radius && !found; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && foreground[ny * width + nx]) { found = 1; break; }
      }
      expanded[y * width + x] = found;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let full = 1;
      for (let dy = -radius; dy <= radius && full; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || !expanded[ny * width + nx]) { full = 0; break; }
      }
      barrier[y * width + x] = full || foreground[y * width + x];
    }
    const outside = new Uint8Array(size), queue = new Int32Array(size);
    let start = 0, end = 0;
    function add(pixel) {
      if (outside[pixel] || barrier[pixel]) return;
      outside[pixel] = 1; queue[end++] = pixel;
    }
    for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
    for (let y = 1; y < height - 1; y++) { add(y * width); add(y * width + width - 1); }
    while (start < end) {
      const pixel = queue[start++], x = pixel % width, y = Math.floor(pixel / width);
      if (x > 0) add(pixel - 1);
      if (x < width - 1) add(pixel + 1);
      if (y > 0) add(pixel - width);
      if (y < height - 1) add(pixel + width);
    }
    for (let i = 0; i < size; i++) data[i * 4 + 3] = outside[i] ? 0 : 255;

    // A few source poses overlap their neighbors' cell boundaries. Discard
    // small clipped edge fragments, retaining complete interior detail/sparks.
    const visited = new Uint8Array(size);
    for (let first = 0; first < size; first++) {
      if (visited[first] || !data[first * 4 + 3]) continue;
      start = 0; end = 0; let edge = false;
      function component(pixel) {
        if (visited[pixel] || !data[pixel * 4 + 3]) return;
        visited[pixel] = 1; queue[end++] = pixel;
      }
      component(first);
      while (start < end) {
        const pixel = queue[start++], x = pixel % width, y = Math.floor(pixel / width);
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) edge = true;
        if (x > 0) component(pixel - 1);
        if (x < width - 1) component(pixel + 1);
        if (y > 0) component(pixel - width);
        if (y < height - 1) component(pixel + width);
      }
      if (edge && end < size * .12) for (let i = 0; i < end; i++) data[queue[i] * 4 + 3] = 0;
    }
  }
})();
