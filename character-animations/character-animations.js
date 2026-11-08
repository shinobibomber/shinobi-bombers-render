/* Original per-character clips and effects. These hooks observe combat; they never change its results. */
(() => {
  const sprites = ShinobiSprites, previousReady = sprites.ready;
  const root = new URL('.', document.currentScript.src), images = new Map(), cuts = new Map(), frames = new Map();
  const events = new Map(), impacts = [];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let manifest, baseHero;
  const durations = { idle: 1200, walk: 800, run: 650, melee: 650, ranged: 550, skill: 1000, hurt: 400, die: 1100, bomb: 750, victory: 1400 };
  const api = window.CharacterAnimations = {
    loaded: false, ready: null, source: null, poseFor, heroFrame, frameInfo,
    play, effectFrame, drawProjectile, drawActorEffects, drawImpacts, drawHuntProjectile, drawHuntImpact,
    drawAdventureHero, adventureBodyPixels: 292, adventureSizingVersion: 1
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

  const modelIndex = hero => Number.isInteger(hero?.look) ? ((hero.look % 8) + 8) % 8 : Math.abs(Math.trunc(Number(hero?.id) || 0)) % 8;
  function currentEvent(hero, now) {
    const event = events.get(hero.id);
    if (event && now - event.started < event.duration) return event;
    if (event) events.delete(hero.id);
    return null;
  }
  function play(hero, state, now = performance.now()) {
    if (!hero || !durations[state]) return;
    // Expiry cannot depend on a hero being drawn again: sold/fused heroes and
    // one-off previews would otherwise leave entries behind for the whole session.
    for (const [id, event] of events) if (now - event.started >= event.duration) events.delete(id);
    if (!events.has(hero.id) && events.size >= 128) events.delete(events.keys().next().value);
    events.set(hero.id, { state, started: now, duration: durations[state] });
  }
  function token(state, phase) { return 'clip:' + state + ':' + phase; }
  function poseFor(hero, now, context = {}) {
    if (context.sleeping) return 's0'; // Rest is not an invented death/hurt event.
    const event = currentEvent(hero, now);
    if (event) {
      const cells = manifest.models[modelIndex(hero)].rows[event.state]?.actors || [];
      const phase = Math.min(Math.max(0, cells.length - 1), Math.floor((now - event.started) / event.duration * cells.length));
      return token(event.state, motion.matches ? 0 : phase);
    }
    if (context.attackAge < 550) return token('ranged', 0);
    const state = context.moving ? (Number(hero.sp) >= 8 ? 'run' : 'walk') : 'idle';
    const count = manifest.models[modelIndex(hero)].rows[state].actors.length;
    const phase = context.moving ? Math.floor(Number.isFinite(context.phase) ? context.phase : now / 110) : Math.floor(now / 280 + (hero.id || 0) * .37);
    return token(state, motion.matches ? 0 : ((phase % count) + count) % count);
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
    const info = frameInfo(hero, pose, direction);
    // The action sheets do not contain back-facing action cycles. Keep the exact
    // supplied back-view base frames instead of mirroring or inventing a back view.
    if (direction === 'back') return baseHero(hero, ['walk', 'run'].includes(info.state) ? 'w' + (motion.matches ? 0 : info.phase) : 'i0', blink, direction);
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
    const reference = crop(info.data.file, idle, false);
    canvas.adventureSprite = { texture, pivot, referenceHeight: reference.opaqueHeight };
    frames.set(info.key, canvas);
    if (frames.size > 128) frames.delete(frames.keys().next().value);
    return canvas;
  }
  function drawAdventureHero(context, canvas, x, y, scale, flip, now = performance.now()) {
    const body = canvas.tierAuraBase || canvas, source = body.adventureSprite;
    // Mythic retains its own body, directional rig and approved aura renderer.
    if (!source) return sprites.blit(context, canvas, x, y, scale, flip);
    const rank = canvas.tierAura?.rank, aura = canvas.tierAuraBase && window.TierAuras?.loaded;
    if (aura) sprites.blit(context, TierAuras.animatedFrame(rank, now), x, y, scale, flip);
    const ratio = api.adventureBodyPixels / source.referenceHeight * scale / 8;
    context.save();
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.translate(Math.round(x), Math.round(y));
    if (flip) context.scale(-1, 1);
    context.drawImage(source.texture, -source.pivot[0] * ratio, -source.pivot[1] * ratio,
      source.texture.width * ratio, source.texture.height * ratio);
    context.restore();
    if (aura) sprites.blit(context, TierAuras.animatedFront(rank, now), x, y, scale, flip);
  }
  function effectFrame(hero, type, phase = 0) {
    // Optional per-hero art (e.g. the Mythic hero's own skills) is asked first; undefined = not handled.
    if (api.effectOverride) { const custom = api.effectOverride(hero, type, phase); if (custom !== undefined) return custom; }
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
    if (!effect) canvas.opaqueHeight = PlayerModels.opaqueHeight(data, width, height);
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
    return drawEffect(context, effectFrame({ id: projectile.o || 0, projectile }, 'projectile', now / 85), position.x, position.y, (projectile.ultimate ? 58 : 32) * position.scale, position.angle);
  }
  function drawHuntProjectile(context, shot, x, y, now, owner, angle) {
    return drawEffect(context, effectFrame({ id: owner, projectile: shot }, 'projectile', now / 85), x, y, shot.ultimate ? 62 : 35, angle);
  }
  const blast = () => window.DisplaySettings?.v.explosions || 'full';
  function drawHuntImpact(context, hit, position, owner) {
    if (blast() === 'off') return true;
    const age = Math.max(0, .8 - hit.life), soft = blast() === 'reduced' ? .55 : 1;
    return drawEffect(context, effectFrame({ id: owner }, hit.ultimate ? 'skill' : 'explosion', age * 10), position.x, position.y, (hit.ultimate ? 130 : 70) * (soft < 1 ? .8 : 1), 0, Math.min(1, Math.max(0, hit.life / .2)) * soft);
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
      if (age > 650 || blast() === 'off') { impacts.splice(i, 1); continue; }
      const soft = blast() === 'reduced' ? .55 : 1;
      const p = geometry.proj(impact.x + .5, impact.y + .5, 12);
      drawEffect(context, effectFrame({ id: impact.owner }, impact.ultimate ? 'skill' : 'explosion', age / 110), p[0], p[1], (impact.ultimate ? 100 : 55) * geometry.Sg(impact.y + .5) * (soft < 1 ? .8 : 1), 0, Math.min(1, (650 - age) / 180) * soft);
    }
  }

  const previousThink = think;
  think = function (hero) {
    const count = bombs.length, result = previousThink.apply(this, arguments);
    if (bombs.length > count) { const last = bombs[bombs.length - 1]; play(hero, last.ultimate || last.mythicUlt ? 'skill' : 'ranged'); }
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
    events.clear();
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
