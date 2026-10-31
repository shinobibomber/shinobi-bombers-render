/* V3 environment renderer. Reads the native grid; never creates gameplay data. */
(() => {
  'use strict';
  const api = window.V3Adventure = {
    preserveNativeGrid: true, loaded: false, ready: null, themes: [],
    project, drawFloor, drawWall, drawAtmosphere,
    get gridSize() { return { columns: W, rows: H, tileSize: T }; }
  };
  const previousReady = ShinobiSprites.ready, root = new URL('.', document.currentScript.src);
  const manifestReady = fetch(new URL('environments.json', root)).then(response => {
    if (!response.ok) throw Error('V3 environment manifest is unavailable.');
    return response.json();
  });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  api.ready = ShinobiSprites.ready = Promise.all([previousReady, manifestReady]).then(([, manifest]) => {
    if (manifest.version !== 1 || manifest.environments.length !== 8) throw Error('V3 environment manifest has changed.');
    api.themes = manifest.environments;
    // The legacy map adapter remains available in source history. Its picture
    // collision rewrite is bypassed before it starts by preserveNativeGrid.
    MapDesign.project = project;
    MapDesign.drawFloor = drawFloor;
    MapDesign.drawAtmosphere = drawAtmosphere;
    MapDesign.blocked = (x, y) => x < 0 || y < 0 || x >= W || y >= H || G[y][x].k === 1;
    AdventureDesign.drawFloor = drawFloor;
    AdventureDesign.drawWall = drawWall;
    for (const entry of api.themes) {
      if (ArenaThemes[entry.key]) ArenaThemes[entry.key][0] = entry.name;
      if (AdventureDesign.themes[entry.key]) AdventureDesign.themes[entry.key].name = entry.name;
    }
    document.getElementById('exactAdventureScene')?.classList.add('v3-native-environments');
    api.loaded = true;
    Arena3D.rebuild();
    dispatchEvent(new CustomEvent('shinobi-v3-environments-ready'));
    return true;
  });
  api.ready.catch(error => console.error('V3 environment renderer could not load:', error));

  function environment(map = S.map) {
    return api.themes[((Math.max(1, Number(map) || 1) - 1) % 8 + 8) % 8];
  }
  function project(x, y, z = 0) {
    // Logical coordinates remain31×17 at40world units per cell. Only the
    // drawing projection compresses the vertical dimension into this HUD.
    return [x * T, 32 + y * 24 - z * .82];
  }
  function noise(x, y, seed) {
    let h = Math.imul(x + 11, 374761393) ^ Math.imul(y + 17, 668265263) ^ Math.imul(seed + 23, 1274126177);
    h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  function drawFloor(canvas, world) {
    const entry = environment(world.map);
    if (!entry) return;
    canvas.width = world.W * world.T; canvas.height = 465;
    const c = canvas.getContext('2d'); c.imageSmoothingEnabled = true;
    c.fillStyle = entry.rim; c.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < world.H; y++) for (let x = 0; x < world.W; x++) {
      const [px, py] = project(x, y), size = world.T;
      const shade = noise(x, y, entry.key) > .5 ? entry.floor[0] : entry.floor[1];
      c.fillStyle = shade; c.fillRect(px, py, size, 24);
      // Bounded material details: every mark stays inside its own ground cell.
      // None represent lava, traps, curse or other unsupported gameplay hazards.
      c.fillStyle = entry.floor[2];
      for (let n = 0; n < 7; n++) {
        const dx = 3 + noise(x * 9 + n, y, entry.key + 3) * 33;
        const dy = 3 + noise(x, y * 11 + n, entry.key + 7) * 17;
        c.globalAlpha = .16 + noise(x + n, y, 2) * .18;
        if (entry.material === 'grass' || entry.material === 'bamboo') c.fillRect(px + dx, py + dy, 1, 2);
        else if (entry.material === 'snow') { c.beginPath(); c.ellipse(px + dx, py + dy, 2, .8, 0, 0, Math.PI * 2); c.fill(); }
        else c.fillRect(px + dx, py + dy, 2 + noise(x, n, y) * 4, .8);
      }
      c.globalAlpha = 1;
      c.strokeStyle = entry.seam; c.lineWidth = .6; c.strokeRect(px + .3, py + .3, size - .6, 23.4);
      c.fillStyle = '#ffffff0a'; c.fillRect(px + 1, py + 1, size - 2, 1);
    }
    // A small non-playable architectural rim leaves room for front-row sprite
    // heads. It has no collision role and never receives live targets.
    c.fillStyle = entry.wall[2]; c.fillRect(0, 17, canvas.width, 13); c.fillRect(0, 443, canvas.width, 15);
    c.fillStyle = entry.wall[1]; c.fillRect(0, 17, canvas.width, 3); c.fillRect(0, 443, canvas.width, 3);
    for (let x = 0; x < canvas.width; x += 44) { c.fillStyle = '#00000050'; c.fillRect(x, 21, 1, 8); c.fillRect(x + 22, 447, 1, 9); }
    c.strokeStyle = entry.border; c.lineWidth = 2; c.strokeRect(1, 31, canvas.width - 2, world.H * 24 + 2);
    c.fillStyle = '#ffffff24'; c.fillRect(3, 16, canvas.width - 6, 1);
    canvas.dataset.v3Environment = entry.id;
    canvas.dataset.renderSource = 'native-grid-code-art';
  }
  function drawWall(c, x, y, world) {
    const entry = environment(world.map); if (!entry) return;
    const [px, py] = project(x, y), bx = px + 3, by = py + 3, width = T - 6, height = 19;
    c.save();
    c.fillStyle = '#01050b55'; c.beginPath(); c.ellipse(px + 21, py + 22, 18, 5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = entry.wall[2]; c.fillRect(bx + 1, by + 5, width, height);
    c.fillStyle = entry.wall[1]; c.fillRect(bx + 1, by + 4, width - 2, height - 3);
    c.fillStyle = entry.wall[0]; c.fillRect(bx, by, width, height - 3);
    c.fillStyle = '#ffffff3a'; c.fillRect(bx + 1, by + 1, width - 2, 2);
    c.fillStyle = '#00000035'; c.fillRect(bx, by + 12, width, 1.5); c.fillRect(bx + 15, by + 2, 1.5, 10); c.fillRect(bx + 7, by + 13, 1, 7);
    c.strokeStyle = '#ffffff12'; c.lineWidth = .7; c.beginPath(); c.moveTo(bx + 2, by + 6); c.lineTo(bx + 11, by + 6); c.lineTo(bx + 14, by + 4); c.moveTo(bx + 20, by + 15); c.lineTo(bx + 30, by + 15); c.stroke();
    c.strokeStyle = entry.wall[2]; c.lineWidth = .8; c.strokeRect(bx + .5, by + .5, width - 1, height - 1);
    if (entry.material === 'snow') {
      c.fillStyle = '#f0fbff'; c.beginPath(); c.moveTo(bx - 1, by + 2); c.lineTo(bx + 5, by - 1); c.lineTo(bx + 15, by + 1); c.lineTo(bx + 25, by - 1); c.lineTo(bx + width + 1, by + 2); c.lineTo(bx + width - 1, by + 5); c.lineTo(bx, by + 5); c.closePath(); c.fill();
    } else if (entry.material === 'grass' || entry.material === 'bamboo' || entry.material === 'ruins') {
      c.fillStyle = entry.accent + '99'; c.fillRect(bx + 3, by + 1, 7, 2); c.fillRect(bx + width - 9, by + 14, 5, 2);
    } else {
      c.strokeStyle = entry.accent + '60'; c.lineWidth = 1; c.beginPath(); c.moveTo(bx + 12, by + 7); c.lineTo(bx + 16, by + 4); c.lineTo(bx + 20, by + 7); c.lineTo(bx + 16, by + 10); c.closePath(); c.stroke();
    }
    c.restore();
  }
  function drawAtmosphere(c, now) {
    const entry = environment(); if (!entry || reduced.matches || document.hidden || Arena3D.cfg.fx === 0) return;
    const count = Arena3D.cfg.fx === 1 ? 9 : 18;
    c.save(); c.globalAlpha = .24; c.fillStyle = entry.particle;
    for (let i = 0; i < count; i++) {
      const x = (i * 137.7 + Math.sin(now / 1900 + i) * 16 + 1240) % 1240;
      const y = (i * 59 + now * (entry.weather === 'embers' ? -.009 : .012) + 465000) % 465;
      c.beginPath(); c.ellipse(x, y, entry.weather === 'snow' ? 1.2 : 2, entry.weather === 'snow' ? 1.2 : .7, now / 2700 + i, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
})();
