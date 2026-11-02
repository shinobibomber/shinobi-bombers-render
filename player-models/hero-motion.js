/* Optional HD locomotion presentation. Positions, action clips and combat stay native. */
(() => {
  'use strict';
  const url = new URL('hero-directions-hd.png', document.currentScript.src);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  // Measured silhouettes, not equal cells: the supplied atlas has uneven row heights.
  const sides = [[67, 16, 237, 326], [328, 7, 292, 335], [671, 19, 230, 323], [968, 16, 228, 326],
    [54, 665, 245, 317], [372, 659, 232, 323], [644, 658, 262, 324], [990, 660, 231, 322]];
  const backs = [[79, 349, 208, 310], [361, 345, 268, 314], [688, 346, 219, 313], [985, 345, 215, 314],
    [78, 987, 211, 267], [390, 983, 194, 271], [678, 982, 236, 272], [1007, 983, 193, 271]];
  const textures = new Map(), frames = new Map(), pendingCuts = new Map();
  const maxFrames = 216; // Bounded render cache: ~27 MiB maximum, independent of hero count.
  let image = null, pending = null, status = 'idle', idleJob = null, activeCut = null;
  const api = window.HeroMotion = { load, frame, get status() { return status; },
    get cacheSize() { return frames.size; }, get textureCount() { return textures.size; }, maxFrames };
  PlayerModels.presentationFrame = frame;

  function load() {
    if (pending) return pending;
    status = 'loading';
    // Shared front artwork owns its own decode and fallback. Neither optional atlas
    // participates in GameLoading or the wallet/session readiness chain.
    window.RevealModels?.load();
    pending = new Promise(resolve => {
      const candidate = new Image(); candidate.decoding = 'async';
      let settled = false;
      const finish = success => {
        if (settled) return;
        settled = true; clearTimeout(timeout);
        candidate.onload = candidate.onerror = null;
        image = success ? candidate : null; status = success ? 'ready' : 'error';
        resolve(success);
      };
      const timeout = setTimeout(() => finish(false), 15000);
      candidate.onerror = () => finish(false);
      candidate.onload = async () => {
        try { await candidate.decode(); finish(candidate.naturalWidth === 1254 && candidate.naturalHeight === 1254); }
        catch { finish(false); }
      };
      candidate.src = url.href;
    });
    return pending;
  }

  function scheduleCut() {
    if (idleJob !== null || document.hidden || (!pendingCuts.size && !activeCut)) return;
    const run = deadline => {
      idleJob = null;
      if (document.hidden) return;
      if (!activeCut) {
        const [key, source] = pendingCuts.entries().next().value;
        pendingCuts.delete(key); activeCut = { key, work: isolate(source) };
      }
      // A source component can span many idle tasks. Never finish a large flood
      // fill just because requestIdleCallback delivered it once.
      const start = performance.now();
      let result;
      do { result = activeCut.work.next(); }
      while (!result.done && performance.now() - start < 3 && (!deadline || deadline.timeRemaining() > 1));
      if (result.done) { textures.set(activeCut.key, result.value); activeCut = null; }
      scheduleCut();
    };
    // One source silhouette per idle task; never scan image pixels in a combat frame.
    idleJob = window.requestIdleCallback ? requestIdleCallback(run, { timeout: 500 }) : setTimeout(run, 16);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && idleJob !== null) {
      if (window.cancelIdleCallback) cancelIdleCallback(idleJob); else clearTimeout(idleJob);
      idleJob = null;
    } else scheduleCut();
  });

  function textureFor(hero, direction) {
    const model = PlayerModels.modelFor(hero).index, key = model + '.' + direction;
    if (textures.has(key)) return textures.get(key);
    const source = direction === 'front' ? window.RevealModels?.frame(hero)
      : image && { image, rect: (direction === 'back' ? backs : sides)[model] };
    if (source && !pendingCuts.has(key) && activeCut?.key !== key) { pendingCuts.set(key, source); scheduleCut(); }
    return null;
  }

  function* isolate(source) {
    const [x, y, w, h] = source.rect, canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source.image, x, y, w, h, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h), data = pixels.data;
    const seen = new Uint8Array(w * h), queue = new Int32Array(w * h);
    // Preserve the silhouette and its antialiased edges; remove disconnected
    // single-pixel flecks only. Dark clothing is opaque, never color-keyed away.
    let visited = 0;
    for (let seed = 0; seed < seen.length; seed++) {
      if (++visited % 2048 === 0) yield;
      if (seen[seed] || !data[seed * 4 + 3]) continue;
      let head = 0, tail = 1; queue[0] = seed; seen[seed] = 1;
      while (head < tail) {
        if (++visited % 2048 === 0) yield;
        const point = queue[head++], px = point % w, py = Math.floor(point / w);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy, next = ny * w + nx;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || seen[next] || !data[next * 4 + 3]) continue;
          seen[next] = 1; queue[tail++] = next;
        }
      }
      if (tail < 12) for (let i = 0; i < tail; i++) data[queue[i] * 4 + 3] = 0;
    }
    ctx.putImageData(pixels, 0, 0);
    // Anchor the feet rather than asymmetric hair/scarves when changing direction.
    let total = 0, sum = 0;
    for (let py = h - 24; py < h; py++) for (let px = 0; px < w; px++) {
      const alpha = data[(py * w + px) * 4 + 3]; total += alpha; sum += px * alpha;
    }
    canvas.footX = total ? sum / total : w / 2;
    return canvas;
  }

  function frame(hero, pose = 'i0', direction = 'front') {
    let state, phase;
    if (pose.startsWith('clip:')) [, state, phase] = pose.split(':');
    else { state = ({ i: 'idle', w: 'walk', r: 'run', s: 'idle' })[pose[0]]; phase = pose.slice(1); }
    if (!['idle', 'walk', 'run'].includes(state) || !PlayerModels.loaded ||
        document.hidden || window.LoginScreen?.active || window.GameLoading?.active) return null;
    if (status === 'idle') load();
    direction = ['side', 'back'].includes(direction) ? direction : 'front';
    const texture = textureFor(hero, direction);
    if (!texture) return null; // Existing directional frames remain usable on failures.
    const model = PlayerModels.modelFor(hero).index;
    const count = window.CharacterAnimations?.source?.models[model].rows[state]?.actors.length || 8;
    const moving = state !== 'idle' && !motion.matches;
    const step = moving ? Math.floor(((Number(phase) || 0) % count + count) % count * 8 / count) + 1 : 0;
    const key = [model, direction, state, step].join('.');
    if (frames.has(key)) {
      const cached = frames.get(key); frames.delete(key); frames.set(key, cached); return cached;
    }
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 200; canvas.designSprite = true;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const scale = Math.min(150 / texture.height, 150 / texture.width);
    const width = texture.width * scale, height = texture.height * scale;
    // Keep body height stable while turning. Shift an asymmetric ponytail inside
    // its quad rather than shrinking the whole character; leave gait padding.
    const left = Math.max(4, Math.min(156 - width, 80 - texture.footX * scale)), top = 176 - height;
    if (!moving) ctx.drawImage(texture, left, top, width, height);
    else {
      const swing = Math.sin((step - 1) * Math.PI / 4), split = Math.round(texture.height * .76);
      // Small alternating leg shifts use the same artwork and the game's actual
      // distance-driven gait phase. A 2px overlap hides the segment seam.
      const middle = Math.round(texture.footX), legY = top + split * scale;
      for (const [sx, sw, sign] of [[0, middle, -1], [middle, texture.width - middle, 1]]) {
        const lift = Math.max(0, sign * swing) * 2;
        ctx.drawImage(texture, sx, split, sw, texture.height - split,
          left + sx * scale + sign * swing * 1.4, legY - lift, sw * scale, height - split * scale);
      }
      ctx.drawImage(texture, 0, 0, texture.width, split + 2, left, top, width, (split + 2) * scale);
    }
    canvas.playerModel = { model, direction, phase: step, key: 'hd.' + key };
    canvas.characterAnimation = { model, state, phase: step, hd: true };
    frames.set(key, canvas);
    if (frames.size > maxFrames) frames.delete(frames.keys().next().value);
    return canvas;
  }
})();
