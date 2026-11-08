/* Tsukiyomi, the Mythic Shinobi (rank 5). Rendering only: the hero's frames, his existing
   Mythic Aura and his skill effects replace the shared art for Mythic heroes. Damage, chakra,
   rewards and collisions stay with the game's authoritative combat rules.
   Assets and metadata: assets/mythic-hero/ (built by mythic-hero/tools/build-assets.cjs). */
(() => {
  const sprites = window.ShinobiSprites, previousReady = sprites.ready;
  const root = new URL('.', document.currentScript.src);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const MYTHIC = 5, BODY_PX = 290, CANVAS = [320, 400], FOOT = [160, 352];
  const images = new Map(), frames = new Map(), auraCache = new Map(), effects = new Map(), states = new Map(), shots = new WeakMap();
  let meta = null, shotSerial = 0, baseBlit = null, previousHeroFrame = null;
  const AURA_KEY = 'sb-mythic-aura';
  const api = window.MythicHero = {
    loaded: false, ready: null, source: null, RANK: MYTHIC, getTexture: file => images.get(file),
    isMythic, heroFrame, drawPortrait, portraitFrame, effectFrame, frameInfo, emote,
    get auraEnabled() { try { return localStorage.getItem(AURA_KEY) !== 'off'; } catch { return true; } },
    setAura(on) { try { localStorage.setItem(AURA_KEY, on ? 'on' : 'off'); } catch {} auraCache.clear(); dispatchEvent(new CustomEvent('mythic-aura-changed', { detail: { on: !!on } })); },
    skills: [
      { key: 'dragon_slash', name: 'Dragon Crescent Gale', text: 'Seven violet trails decorate one attack: Hero Power damage, 1 chakra. VFX cost 0 additional chakra.' },
      { key: 'void_shuriken', name: 'Void Eclipse Shuriken', text: 'A celestial shuriken volley decorates one attack. No extra damage or chakra cost.' },
      { key: 'raijin_field', name: 'Thunder Chain Vortex', text: 'Violet lightning marks the native impact. Cosmetic only: no extra damage or chakra.' },
      { key: 'mythic_dragon_ascension', name: 'Mythic Dragon Dominion', text: 'Every 8th attack: a spectral dragon rises. Cosmetic only: Hero Power damage, 1 attack chakra, 0 additional skill chakra.', ultimate: true }
    ]
  };

  function isMythic(hero) { return Number(hero?.r ?? hero?.rank) === MYTHIC; }
  const load = file => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { images.set(file, image); resolve(image); };
    image.onerror = () => reject(new Error('Tsukiyomi asset missing: ' + file));
    image.src = new URL(file, root).href;
  });
  const metadata = fetch(new URL('metadata/tsukiyomi.json', root)).then(r => { if (!r.ok) throw new Error('Tsukiyomi metadata missing.'); return r.json(); });
  // Only the small metadata gates the game. The art (about 3.5 MB) loads the first time a Mythic
  // hero is drawn, so players without Tsukiyomi never download it.
  let assets = null;
  api.assetsReady = false;
  api.preload = () => assets || (assets = !meta ? Promise.reject(new Error('Tsukiyomi metadata is not ready.')) : Promise.all([...new Set([
    ...Object.values(meta.skills), ...Object.values(meta.character), ...Object.values(meta.previews), ...Object.values(meta.aura.parts), meta.aura.frames
  ].map(a => a.path))].map(load)).then(() => {
    api.assetsReady = true; frames.clear(); auraCache.clear(); effects.clear(); sprites.clearCache?.();
    dispatchEvent(new CustomEvent('shinobi-mythic-assets'));
    return true;
  }, error => { assets = null; throw error; }));
  const need = () => { if (!api.assetsReady) api.preload().catch(error => console.error('Tsukiyomi art could not be loaded:', error)); return api.assetsReady; };
  api.ready = sprites.ready = Promise.all([previousReady, metadata]).then(([, source]) => {
    if (source.version !== 1 || source.hero.rank !== MYTHIC) throw new Error('Unexpected Tsukiyomi metadata.');
    meta = api.source = source;
    previousHeroFrame = sprites.heroFrame;
    sprites.heroFrame = DesignModels.heroFrame = function (hero, ...args) { return isMythic(hero) ? heroFrame(hero, ...args) : previousHeroFrame(hero, ...args); };
    baseBlit = sprites.blit;
    sprites.blit = function (context, canvas, x, y, scale, flip, alpha) {
      if (!canvas?.mythicBody) return baseBlit(context, canvas, x, y, scale, flip, alpha);
      // Left-facing poses use Tsukiyomi's own LEFT view instead of a mirrored RIGHT view.
      if (flip && canvas.mythicMirror) { canvas = canvas.mythicMirror; flip = false; }
      const now = performance.now();
      if (api.auraEnabled) baseBlit(context, aura('back', now, true), x, y, scale, false, alpha);
      baseBlit(context, canvas, x, y, scale, flip, alpha);
      if (api.auraEnabled) baseBlit(context, aura('front', now, true), x, y, scale, false, alpha);
    };
    if (window.PlayerModels) {
      const previousPortrait = PlayerModels.drawPortrait, previousPortraitFrame = PlayerModels.portraitFrame, previousModel = PlayerModels.modelFor;
      PlayerModels.modelFor = function (hero) { return isMythic(hero) ? { index: -1, key: 'tsukiyomi', label: 'Tsukiyomi · Mythic Shinobi' } : previousModel.call(this, hero); };
      PlayerModels.drawPortrait = function (context, hero, ...rest) { return isMythic(hero) ? drawPortrait(context, hero, ...rest) : previousPortrait.call(this, context, hero, ...rest); };
      PlayerModels.portraitFrame = function (hero, now) { return isMythic(hero) ? portraitFrame(hero, now) : previousPortraitFrame.call(this, hero, now); };
    }
    if (window.TierAuras) {
      const previousDraw = TierAuras.draw, previousFront = TierAuras.drawFront;
      TierAuras.draw = function (context, hero, x, y, scale = 1, now) { if (!isMythic(hero)) return previousDraw.apply(this, arguments); if (api.auraEnabled && need()) paintAt(context, aura('back', now ?? 0, false), x, y, scale); };
      TierAuras.drawFront = function (context, hero, x, y, scale = 1, now) { if (!isMythic(hero)) return previousFront.apply(this, arguments); if (api.auraEnabled && need()) paintAt(context, aura('front', now ?? 0, false), x, y, scale); };
    }
    if (window.CharacterAnimations) CharacterAnimations.effectOverride = effectFrame;
    api.loaded = true;
    sprites.clearCache?.();
    window.ReferenceLayout?.refresh?.();
    dispatchEvent(new CustomEvent('shinobi-mythic-ready'));
    return true;
  });
  api.ready.catch(error => console.error('Tsukiyomi could not be loaded:', error));

  /* ---------- character frames ---------- */
  const STATE_ANIM = { idle: 'idle', walk: 'walk', run: 'run', melee: 'attack', ranged: 'attack', skill: 'attack', hurt: 'hurt', die: 'defeat', bomb: 'bomb_place', victory: 'victory' };
  const LETTER = { i: 'idle', w: 'walk', r: 'run', a: 'melee', h: 'hurt', d: 'die', b: 'bomb', v: 'victory', k: 'skill' };
  function frameInfo(hero, pose = 'i0', direction, now = performance.now()) {
    let state = 'idle';
    if (pose === 's0') return { name: 'idle', index: 0, rest: true };
    if (pose.startsWith('clip:')) state = pose.split(':')[1];
    else state = LETTER[pose[0]] || 'idle';
    const kind = STATE_ANIM[state] || 'idle', facing = direction === 'side' ? 'right' : direction === 'back' ? 'back' : 'front';
    let name = ['walk', 'run', 'attack'].includes(kind) ? kind + '_' + facing : kind;
    // Standing while facing sideways or away: his own RIGHT/BACK view.
    if (kind === 'idle' && facing !== 'front') return { name: 'pose_' + facing, index: 0, facing };
    const clip = meta.animations[name], count = clip.frameCount, step = 1000 / clip.fps;
    if (clip.loop) return { name, index: motion.matches ? 0 : Math.floor(now / step + (Number(hero?.id) || 0) * .37) % count, facing };
    // One-shot clips run from the moment this hero entered the state, then hold their last frame.
    const key = hero?.id ?? hero?.tokenId ?? 'preview', record = states.get(key);
    if (!record || record.kind !== kind) states.set(key, { kind, started: now });
    if (states.size > 256) states.delete(states.keys().next().value);
    const started = states.get(key).started;
    return { name, index: motion.matches ? count - 1 : Math.min(count - 1, Math.floor((now - started) / step)), facing };
  }
  function cell(name, index) {
    if (name.startsWith('pose_')) { const c = meta.character[name.slice(5)]; return { image: images.get(c.path), sx: 0, sy: 0 }; }
    const clip = meta.animations[name]; return { image: images.get(clip.path), sx: index * clip.frameWidth, sy: 0 };
  }
  function bodyCanvas(name, index) {
    const key = name + ':' + index;
    if (frames.has(key)) return frames.get(key);
    const canvas = document.createElement('canvas'); canvas.width = CANVAS[0]; canvas.height = CANVAS[1]; canvas.designSprite = true;
    const context = canvas.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    // 128×128 cells (feet at 64,124) fill the shared 320×400 frame (feet at 160,352): ×2.5.
    const { image, sx, sy } = cell(name, index), k = 2.5;
    context.drawImage(image, sx, sy, 128, 128, FOOT[0] - meta.frame.anchor[0] * k, FOOT[1] - meta.frame.anchor[1] * k, 128 * k, 128 * k);
    canvas.mythicBody = true; canvas.playerModel = { model: 'tsukiyomi', key, direction: name };
    frames.set(key, canvas);
    if (frames.size > 240) frames.delete(frames.keys().next().value);
    return canvas;
  }
  let blank = null;
  function heroFrame(hero, pose = 'i0', blink, direction) {
    // While his art loads, draw nothing rather than another hero's model.
    if (!meta || !need()) { if (!blank) { blank = document.createElement('canvas'); blank.width = CANVAS[0]; blank.height = CANVAS[1]; blank.designSprite = true; } return blank; }
    const info = frameInfo(hero, pose, direction), body = bodyCanvas(info.name, info.index);
    if (info.facing === 'right' && !body.mythicMirror) {
      const left = info.name.replace(/right$/, 'left');
      body.mythicMirror = bodyCanvas(left, info.index);
    }
    return body;
  }
  // Optional emotes (alert, question, like, celebrate) for menus and previews.
  function emote(kind, index = 3) { return meta?.animations[kind] && need() ? bodyCanvas(kind, Math.min(index, meta.animations[kind].frameCount - 1)) : null; }

  /* ---------- the existing Mythic Aura (layered, animated, separate from the body) ---------- */
  const PHASES = 8, CYCLE = 2400;
  const part = name => images.get(meta.aura.parts[name].path);
  function fx() { return window.Arena3D?.cfg?.fx ?? 2; }
  function paintAura(context, layer, phase, rich) {
    const t = phase / PHASES, wave = Math.sin(t * Math.PI * 2);
    const draw = (name, cx, cy, w, alpha = 1, rot = 0, sx = 1, crop) => {
      const img = part(name); if (!img) return;
      const [x0, w0] = crop || [0, img.width], h = w * img.height / w0;
      context.save(); context.globalAlpha = alpha; context.translate(cx, cy); context.rotate(rot); context.scale(sx, 1);
      context.drawImage(img, x0, 0, w0, img.height, -w / 2, -h / 2, w, h); context.restore();
    };
    context.save(); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    if (layer === 'back') {
      // 1 floor sigil · 2 ground particles and orbit rings · 3 rear wings · 4 golden glyph ring (+ halo, tablets, pillars)
      context.globalCompositeOperation = 'lighter';
      if (rich) draw('energy_pillars', 160, 268, 250, .22 + .08 * wave);
      draw('sacred_floor_sigil', 160, FOOT[1], 300 * (1 + .02 * wave), .85);
      draw('inner_halo_ring', 160, FOOT[1] - 4, 210, .55 + .15 * wave);
      // Orbiting rings circle the ground behind him (in front they washed out his body).
      context.save(); context.translate(160, FOOT[1] - 10); context.scale(1, .55); context.translate(-160, -(FOOT[1] - 10));
      draw('orbit_rings', 160, FOOT[1] - 10, 280, .5 + .15 * wave, wave * .05); context.restore();
      draw('particle_sparks', 160, 318 - t * 26, 250, .45 * Math.sin(t * Math.PI) + .15);
      const flap = .06 * Math.sin(t * Math.PI * 2);
      context.globalCompositeOperation = 'source-over';
      draw('energy_wings_left', 92, 178, 150, .92, -flap, 1 - Math.abs(flap));
      draw('energy_wings_right', 228, 178, 150, .92, flap, 1 - Math.abs(flap));
      context.globalCompositeOperation = 'lighter';
      // The glyph ring has four-fold symmetry: 1/32 of a turn per phase loops seamlessly.
      draw('outer_glyph_ring', 160, 172, 236, .8, t * Math.PI / 2);
      if (rich) {
        const tablets = part('rune_tablets'), third = tablets ? tablets.width / 3 : 0;
        if (tablets) { draw('rune_tablets', 30, 150 + 4 * wave, 34, .85, 0, 1, [0, third]); draw('rune_tablets', 290, 150 - 4 * wave, 34, .85, 0, 1, [third * 2, third]); }
      }
    } else {
      // Crystal shards beside the hero and the crown above his head: never over his face or body.
      context.globalCompositeOperation = 'lighter';
      if (rich) {
        const shards = part('aerial_shards'), half = shards ? shards.width / 2 : 0;
        if (shards) { draw('aerial_shards', 34, 250 - t * 30, 60, .8 * Math.sin(t * Math.PI) + .2, 0, 1, [0, half]); draw('aerial_shards', 286, 236 - ((t + .5) % 1) * 30, 60, .8 * Math.sin(((t + .5) % 1) * Math.PI) + .2, 0, 1, [half, half]); }
      }
      draw('divine_halo_crown', 160, 30 + 2 * wave, 112, .95);
    }
    context.restore();
  }
  // 8 phases per layer, cached; arena copies are half size. Low effects or reduced motion use phase 0 (and fewer layers when off).
  function aura(layer, now, small) {
    const level = fx(), still = motion.matches || !!window.DisplaySettings?.v.reduceMotion || level === 0 || document.hidden;
    let phase = still ? 0 : Math.floor(Math.max(0, now) / (CYCLE / PHASES)) % PHASES;
    if (level === 1) phase -= phase % 2;
    const rich = level >= 2 || !small, key = [layer, phase, small ? 's' : 'l', rich ? 'r' : 'p'].join(':');
    if (auraCache.has(key)) return auraCache.get(key);
    const canvas = document.createElement('canvas'); canvas.designSprite = true;
    canvas.width = small ? CANVAS[0] / 2 : CANVAS[0]; canvas.height = small ? CANVAS[1] / 2 : CANVAS[1];
    const context = canvas.getContext('2d'); if (small) context.scale(.5, .5);
    paintAura(context, layer, phase, rich);
    canvas.mythicAura = { layer, phase };
    auraCache.set(key, canvas);
    return canvas;
  }
  // Same geometry as ShinobiSprites.blit: a 320×400 frame maps to 40×50 units, feet at (20, 44).
  function paintAt(context, canvas, x, y, scale) { context.drawImage(canvas, x - 20 * scale, y - 44 * scale, 40 * scale, 50 * scale); }

  /* ---------- portraits (menus, cards, details): the HD front view ---------- */
  function drawPortrait(context, hero, x, y, scale, now = 0) {
    if (!meta || !need()) return;
    const time = motion.matches ? 0 : now || 0, step = Math.floor(time / 520) % 8, breathe = Math.sin(step / 8 * Math.PI * 2);
    const view = meta.previews.front, image = images.get(view.path);
    const h = BODY_PX / 8 * scale, w = h * view.width / view.height, k = h / view.height;
    context.save();
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    if (hero.z) context.globalAlpha *= .68;
    if (api.auraEnabled) paintAt(context, aura('back', time, false), x, y, scale);
    context.save(); context.translate(x, y); context.scale(1 - .007 * breathe, 1 + .014 * breathe);
    context.drawImage(image, -view.anchor[0] * k, -view.anchor[1] * k, w, h); context.restore();
    if (api.auraEnabled) paintAt(context, aura('front', time, false), x, y, scale);
    context.restore();
  }
  function portraitFrame(hero, now = 0) {
    const canvas = document.createElement('canvas'); canvas.width = CANVAS[0]; canvas.height = CANVAS[1]; canvas.designSprite = true;
    drawPortrait(canvas.getContext('2d'), hero, FOOT[0], FOOT[1], 8, now);
    return canvas;
  }

  /* ---------- skill effects on the game's own combat events ---------- */
  function owner(hero) {
    if (isMythic(hero)) return hero;
    const id = hero?.id; if (id == null) return null;
    try { return (S.h || []).find(h => h.id === id && isMythic(h)) || null; } catch { return null; }
  }
  // Effect frames are re-anchored so the caller's centre point is the effect's own anchor
  // (ground effects stand on the impact point instead of floating around it).
  function effectCanvas(name, index) {
    const key = name + ':' + index;
    if (effects.has(key)) return effects.get(key);
    const s = meta.skills[name], image = images.get(s.path), [ax, ay] = s.anchor;
    const w = Math.max(ax, s.frameWidth - ax) * 2, h = Math.max(ay, s.frameHeight - ay) * 2;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d');
    if (name === 'mythic_dragon_ascension') {
      // The summoning seal glows under the dragon while it rises.
      const seal = part('summoning_seal'); if (seal) { context.globalAlpha = .55; const sw = s.frameWidth * 1.1; context.drawImage(seal, w / 2 - sw / 2, h / 2 - sw * .18, sw, sw * .36); context.globalAlpha = 1; }
    }
    context.drawImage(image, index * s.frameWidth, 0, s.frameWidth, s.frameHeight, w / 2 - ax, h / 2 - ay, s.frameWidth, s.frameHeight);
    canvas.mythicEffect = { skill: name, frame: index };
    effects.set(key, canvas);
    return canvas;
  }
  // CharacterAnimations.effectFrame(hero, type, phase) asks here first. undefined = not Tsukiyomi.
  function effectFrame(hero, type, phase = 0) {
    if (!meta || !owner(hero)) return undefined;
    if (!need()) return null;
    const now = performance.now();
    if (type === 'projectile') {
      // Alternate Dragon Crescent Gale and Void Eclipse Shuriken per projectile, each played from its launch.
      const shot = hero.projectile, record = shot ? shots.get(shot) || { n: shotSerial++, born: now } : { n: 0, born: now - phase * 85 };
      if (shot && !shots.has(shot)) shots.set(shot, record);
      const name = record.n % 2 ? 'void_shuriken' : 'dragon_slash', s = meta.skills[name];
      const index = name === 'void_shuriken' ? Math.floor((now - record.born) / (1000 / s.fps)) % s.frameCount : Math.min(s.frameCount - 1, Math.floor((now - record.born) / (1000 / s.fps)));
      return effectCanvas(name, motion.matches ? s.frameCount - 1 : index);
    }
    if (type === 'explosion') { const s = meta.skills.raijin_field; return effectCanvas('raijin_field', Math.min(s.frameCount - 1, Math.floor(phase * 110 / (1000 / s.fps)))); }
    if (type === 'skill') {
      const s = meta.skills.mythic_dragon_ascension, step = Math.min(s.timeline.length - 1, Math.floor(phase * 110 / (1000 / s.fps)));
      return effectCanvas('mythic_dragon_ascension', s.timeline[motion.matches ? s.events.burst : step]);
    }
    return null; // bomb / victory: the hero's own frames carry those moments
  }
})();
