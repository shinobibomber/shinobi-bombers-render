/* Original full-scene battlefields. Collision and live actors share source coordinates. */
(() => {
  const root = new URL('.', document.currentScript.src), previousReady = ShinobiSprites.ready;
  const images = [], aligned = new WeakSet(), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let manifest;
  const api = window.MapDesign = { loaded: false, ready: null, maps: [], activeLayout, project, alignGrid, blocked, drawFloor, drawAtmosphere };
  const sources = fetch(new URL('maps.json', root)).then(response => { if (!response.ok) throw Error('Map design manifest unavailable.'); return response.json(); }).then(async data => {
    if (data.version !== 1 || data.maps.length !== 8) throw Error('Map design manifest changed.');
    manifest = data;
    await Promise.all(data.maps.map((entry, i) => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => { if (image.naturalWidth !== 1536 || image.naturalHeight !== 645) return reject(Error('Map design dimensions changed.')); images[i] = image; resolve(); };
      image.onerror = () => reject(Error('Map design unavailable: ' + entry.file)); image.src = new URL(entry.file, root).href;
    })));
  });
  api.ready = ShinobiSprites.ready = Promise.all([previousReady, sources]).then(() => {
    api.maps = manifest.maps; api.loaded = true;
    for (const entry of api.maps) { if (ArenaThemes[entry.key]) ArenaThemes[entry.key][0] = entry.name; if (AdventureDesign.themes[entry.key]) AdventureDesign.themes[entry.key].name = entry.name; }
    AdventureDesign.drawFloor = drawFloor; AdventureDesign.drawWall = () => {};
    const oldNewMap = newMap; newMap = function (...args) { const result = oldNewMap(...args); alignGrid(); return result; };
    document.getElementById('exactAdventureScene')?.classList.add('original-maps-active');
    alignGrid(); Arena3D.rebuild(); hud(); RosterDesign.refresh(); dispatchEvent(new CustomEvent('shinobi-map-design-ready')); return true;
  });
  api.ready.catch(error => console.error('Original map designs could not load:', error));
  function activeLayout(map = S.map) { return manifest?.maps[((Math.max(1, Number(map) || 1) - 1) % 8 + 8) % 8]; }
  function sourcePoint(x, y, map = S.map) { const [left, top, width, height] = activeLayout(map).bounds; return [left + x * width / W, top + y * height / H]; }
  function project(x, y, z = 0) { const p = sourcePoint(x, y); return [p[0] * 1240 / 1536, (p[1] - 225) * 465 / 575 - z * .9]; }
  function blocked(x, y, map = S.map) {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;
    const p = sourcePoint(x + .5, y + .5, map);
    return activeLayout(map).solids.some(([left, top, width, height]) => p[0] >= left && p[0] <= left + width && p[1] >= top && p[1] <= top + height);
  }
  function alignGrid() {
    if (!api.loaded || !G?.length || aligned.has(G)) return;
    const targets = G.flat().filter(cell => cell.k > 1), mask = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => blocked(x, y)));
    let largest = []; const seen = new Set();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const key = y * W + x; if (mask[y][x] || seen.has(key)) continue;
      const queue = [[x, y]]; seen.add(key);
      for (let at = 0; at < queue.length; at++) for (const [dx, dy] of D) { const nx = queue[at][0] + dx, ny = queue[at][1] + dy, next = ny * W + nx; if (nx >= 0 && ny >= 0 && nx < W && ny < H && !mask[ny][nx] && !seen.has(next)) { seen.add(next); queue.push([nx, ny]); } }
      if (queue.length > largest.length) largest = queue;
    }
    if (largest.length < targets.length + 20) throw Error('Original map has too little connected space for the current targets.');
    const playable = new Set(largest.map(([x, y]) => y * W + x));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) G[y][x] = { k: playable.has(y * W + x) ? 0 : 1, hp: 0 };
    // Keep the original target objects, HP, rewards and prison state. Only their
    // placement changes to respect the supplied map's visible solid scenery.
    const slots = largest.slice(); for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    targets.forEach((target, i) => { const [x, y] = slots[i]; G[y][x] = target; });
    for (const hero of S.h) { hero.p = []; if (hero.on) { hero.x = -9; hero.y = -9; place(hero); } }
    aligned.add(G); api.walkable = largest.map(([x, y]) => [x, y]); api.targetCount = targets.length;
  }
  function drawFloor(canvas, world) {
    canvas.width = world.W * world.T; canvas.height = 465;
    const context = canvas.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(images[activeLayout(world.map).key], 0, 70, 1536, 575, 0, 0, canvas.width, canvas.height);
    canvas.dataset.originalMap = String(activeLayout(world.map).key + 1);
  }
  function drawAtmosphere(context, now) {
    if (!api.loaded || reduced.matches) return;
    const layout = activeLayout(), mode = layout.weather;
    context.save(); context.globalCompositeOperation = 'screen';
    for (let i = 0; i < 18; i++) {
      const speed = mode === 'snow' ? .009 : .014, x = ((i * 137.7 + Math.sin(now / 1800 + i) * 20) % 1240), y = ((i * 59 + now * speed) % 465);
      context.globalAlpha = .12 + .08 * Math.sin(now / 600 + i); context.fillStyle = mode === 'embers' ? '#ff9b47' : mode === 'snow' ? '#e7fbff' : mode === 'wisps' ? '#b668ff' : '#f8b9ef';
      context.beginPath(); context.ellipse(x, y, mode === 'snow' ? 1.3 : 2, mode === 'snow' ? 1.3 : .8, now / 2500 + i, 0, Math.PI * 2); context.fill();
    }
    context.restore();
  }
})();
