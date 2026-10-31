/* Original per-character clips and effects. These hooks observe combat; they never change its results. */
(() => {
  const sprites = ShinobiSprites, previousReady = sprites.ready;
  const root = new URL('.', document.currentScript.src), images = new Map(), cuts = new Map(), frames = new Map();
  const events = new Map(), impacts = [];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let manifest, baseHero;
  const durations = { idle: 1200, walk: 800, run: 650, melee: 650, ranged: 550, skill: 1000, hurt: 400, die: 1100, bomb: 750, victory: 1400 };
  const api = window.CharacterAnimations = {
    loaded: false, ready: null, source: null, poseFor, heroFrame, frameInfo,
    play, effectFrame, drawProjectile, drawActorEffects, drawImpacts, drawHuntProjectile, drawHuntImpact
  };
  const assets = Promise.all([1, 2, 3, 4].map(index => new Promise((resolve, reject) => {
    const image = new Image(), file = 'animationset' + index + '.png';
    image.onload = () => { images.set(file, image); resolve(); };
    image.onerror = () => reject(new Error('Could not load original animation sheet ' + file));
    image.src = new URL(file, root).href;
  })));
  const metadata = fetch(new URL('manifest.json', root)).then(response => {
    if (!response.ok) throw new Error('Animation frame coordinates are unavailable.');
    return response.json();
  });
  api.ready = sprites.ready = Promise.all([previousReady, assets, metadata]).then(([, , source]) => {
    manifest = api.source = source;
    if (source.models.length !== 8) throw new Error('All eight original character animation sets are required.');
    baseHero = sprites.heroFrame;
    sprites.heroFrame = DesignModels.heroFrame = heroFrame;
    api.loaded = true;
    sprites.clearCache();
    ReferenceLayout.refresh();
    return true;
  });
  api.ready.catch(error => console.error('Character animations could not be loaded:', error));

  const modelIndex = hero => Math.abs(Math.trunc(Number(hero?.id) || 0)) % 8;
  function currentEvent(hero, now) {
    const event = events.get(hero.id);
    if (event && now - event.started < event.duration) return event;
    if (event) events.delete(hero.id);
    return null;
  }
  function play(hero, state, now = performance.now()) {
    if (!durations[state]) return;
    events.set(hero.id, { state, started: now, duration: durations[state] });
  }
  function token(state, phase) { return 'clip:' + state + ':' + phase; }
  function poseFor(hero, now, context = {}) {
    if (context.sleeping) return 's0'; // Rest is not an invented death/hurt event.
    const event = currentEvent(hero, now);
    if (event) {
      const cells = manifest.models[modelIndex(hero)].rows[event.state]?.actors || [];
      const phase = Math.min(Math.max(0, cells.length - 1), Math.floor((now - event.started) / event.duration * cells.length));
      return token(event.state, reduced ? 0 : phase);
    }
    if (context.attackAge < 550) return token('ranged', 0);
    const state = context.moving ? (Number(hero.sp) >= 8 ? 'run' : 'walk') : 'idle';
    const count = manifest.models[modelIndex(hero)].rows[state].actors.length;
    const phase = context.moving ? Math.floor(context.phase || now / 110) : Math.floor(now / 280 + (hero.id || 0) * .37);
    return token(state, reduced ? 0 : ((phase % count) + count) % count);
  }
  function frameInfo(hero, pose = 'i0', direction) {
    const model = modelIndex(hero), data = manifest.models[model];
    let state, phase;
    if (pose.startsWith('clip:')) [, state, phase] = pose.split(':');
    else {
      state = ({ i: 'idle', w: 'walk', r: 'run', a: 'melee', h: 'hurt', d: 'die', b: 'bomb', v: 'victory', k: 'skill' })[pose[0]] || 'idle';
      phase = parseInt(pose.slice(1), 10) || 0;
      const event = currentEvent(hero, performance.now());
      if (event && pose[0] !== 's') {
        state = event.state;
        phase = Math.floor((performance.now() - event.started) / event.duration * (data.rows[state]?.actors.length || 1));
      }
    }
    const actorCells = data.rows[state]?.actors || [];
    // Some supplied rows contain only a bomb/effect, never a character body.
    if (!actorCells.length) { state = 'idle'; phase = 0; }
    const cells = data.rows[state].actors;
    phase = ((Math.trunc(Number(phase) || 0) % cells.length) + cells.length) % cells.length;
    return { model, state, phase, direction: direction || 'front', data, cell: cells[phase], key: [model, state, phase, direction || 'front'].join('.') };
  }
  function heroFrame(hero, pose = 'i0', blink, direction) {
    if (pose === 's0') return baseHero(hero, pose, blink, direction);
    // The action sheets do not contain back-facing action cycles. Keep the exact
    // supplied back-view base frames instead of mirroring or inventing a back view.
    if (direction === 'back') return baseHero(hero, pose.startsWith('w') ? pose : 'i0', blink, direction);
    const info = frameInfo(hero, pose, direction);
    if (frames.has(info.key)) return frames.get(info.key);
    const texture = crop(info.data.file, info.cell, false);
    const idle = info.data.rows.idle.actors[0];
    let scale = 300 / Math.max(1, idle.rect[3] - 4);
    // Wide original attack poses fit the shared canvas without clipping artwork.
    scale = Math.min(scale, 306 / texture.width, 338 / texture.height);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 400; canvas.designSprite = true;
    const context = canvas.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    const pivot = info.cell.pivot || [texture.width / 2, texture.height - 3];
    context.drawImage(texture, 160 - pivot[0] * scale, 352 - pivot[1] * scale, texture.width * scale, texture.height * scale);
    canvas.playerModel = { model: info.model, direction: info.direction, phase: info.phase, key: info.key };
    canvas.characterAnimation = { model: info.model, state: info.state, phase: info.phase };
    frames.set(info.key, canvas);
    if (frames.size > 128) frames.delete(frames.keys().next().value);
    return canvas;
  }
  function effectFrame(hero, type, phase = 0) {
    const data = manifest.models[modelIndex(hero)];
    const cells = data.effects[type] || data.rows[type]?.effects || [];
    if (!cells.length) return null;
    const index = ((Math.floor(phase) % cells.length) + cells.length) % cells.length;
    const canvas = crop(data.file, cells[index], true);
    canvas.characterEffect = { model: modelIndex(hero), type, phase: index };
    return canvas;
  }
  function crop(file, cell, effect) {
    const key = [file, ...cell.rect, effect].join('.');
    if (cuts.has(key)) return cuts.get(key);
    const source = images.get(file), [x, y, width, height] = cell.rect;
    if (!source || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > source.width || y + height > source.height) throw new Error('Animation crop outside original source.');
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, x, y, width, height, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height);
    if (effect) {
      for (let i = 0; i < data.data.length; i += 4) if (Math.max(data.data[i], data.data[i + 1], data.data[i + 2]) < 45) data.data[i + 3] = 0;
    } else {
      PlayerModels.clearExterior(data, width, height);
      // A few printed row separators reach a source crop's outermost pixels.
      // Remove those thin full-width UI strokes, leaving the character intact.
      for (const row of [0, 1, height - 2, height - 1]) {
        let opaque = 0;
        for (let px = 0; px < width; px++) if (data.data[(row * width + px) * 4 + 3]) opaque++;
        if (opaque > width * .75) for (let px = 0; px < width; px++) data.data[(row * width + px) * 4 + 3] = 0;
      }
    }
    context.putImageData(data, 0, 0); cuts.set(key, canvas);
    return canvas;
  }
  function drawEffect(context, texture, x, y, width, angle = 0, alpha = 1) {
    if (!texture) return false;
    context.save(); context.translate(x, y); context.rotate(angle);
    context.globalAlpha *= alpha; context.globalCompositeOperation = 'screen';
    context.drawImage(texture, -width / 2, -width * texture.height / texture.width / 2, width, width * texture.height / texture.width);
    context.restore(); return true;
  }
  function drawProjectile(context, projectile, now, position) {
    if (!api.loaded) return false;
    return drawEffect(context, effectFrame({ id: projectile.o || 0 }, 'projectile', now / 85), position.x, position.y, (projectile.ultimate ? 58 : 32) * position.scale, position.angle);
  }
  function drawHuntProjectile(context, shot, x, y, now, owner, angle) {
    return drawEffect(context, effectFrame({ id: owner }, 'projectile', now / 85), x, y, shot.ultimate ? 62 : 35, angle);
  }
  function drawHuntImpact(context, hit, position, owner) {
    const age = Math.max(0, .8 - hit.life);
    return drawEffect(context, effectFrame({ id: owner }, hit.ultimate ? 'skill' : 'explosion', age * 10), position.x, position.y, hit.ultimate ? 130 : 70, 0, Math.min(1, Math.max(0, hit.life / .2)));
  }
  function drawActorEffects(context, hero, now, position) {
    const event = currentEvent(hero, now);
    if (!event || !['skill', 'bomb', 'victory'].includes(event.state)) return;
    const phase = (now - event.started) / 110;
    const texture = effectFrame(hero, event.state, phase);
    drawEffect(context, texture, position.x, position.y - 18 * position.scale, 76 * position.scale, 0, .85);
  }
  function drawImpacts(context, now, geometry) {
    for (let i = impacts.length - 1; i >= 0; i--) {
      const impact = impacts[i], age = now - impact.started;
      if (age > 650) { impacts.splice(i, 1); continue; }
      const p = geometry.proj(impact.x + .5, impact.y + .5, 12);
      drawEffect(context, effectFrame({ id: impact.owner }, impact.ultimate ? 'skill' : 'explosion', age / 110), p[0], p[1], (impact.ultimate ? 100 : 55) * geometry.Sg(impact.y + .5), 0, Math.min(1, (650 - age) / 180));
    }
  }

  const previousThink = think;
  think = function (hero) {
    const count = bombs.length, result = previousThink.apply(this, arguments);
    if (bombs.length > count) play(hero, bombs[bombs.length - 1].ultimate ? 'skill' : 'ranged');
    return result;
  };
  const previousBoom = boom;
  boom = function (projectile) {
    const result = previousBoom.apply(this, arguments);
    impacts.push({ x: projectile.tx, y: projectile.ty, owner: projectile.o || 0, ultimate: !!projectile.ultimate, started: performance.now() });
    if (impacts.length > 80) impacts.shift();
    return result;
  };
  const previousMap = newMap;
  let observedStage = S.map;
  newMap = function () {
    const result = previousMap.apply(this, arguments);
    impacts.length = 0;
    if (api.loaded && S.map > observedStage) S.h.filter(hero => hero.on).forEach(hero => play(hero, 'victory'));
    observedStage = S.map;
    return result;
  };
  const previousPreview = sprites.preview;
  sprites.preview = function (id) {
    previousPreview.apply(this, arguments);
    play(S.h.find(hero => hero.id === id) || { id }, 'melee');
  };
})();
