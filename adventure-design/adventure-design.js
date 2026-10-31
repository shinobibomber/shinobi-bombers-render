/* Original Adventure/map artwork around the existing live arena and controls. */
(() => {
  const sprites = window.ShinobiSprites;
  const previousReady = sprites.ready;
  const base = new URL('.', document.currentScript.src);
  const images = {};
  const textures = [];
  const api = window.AdventureDesign = { loaded: false, ready: null, source: null, themes: [], geometry, tile, drawFloor, drawWall, themeFor };
  const imageReady = Promise.all(['adventure-mode.png', 'map.png', 'status-reference.webp'].map(name => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { images[name] = image; resolve(); };
    image.onerror = () => reject(new Error('Original Adventure artwork could not be loaded: ' + name));
    image.src = new URL(name, base).href;
  })));
  const manifestReady = fetch(new URL('map-crops.json', base)).then(response => {
    if (!response.ok) throw new Error('Original map crop coordinates could not be loaded.');
    return response.json();
  });

  api.ready = Promise.all([previousReady, imageReady, manifestReady]).then(([, , manifest]) => {
    if (manifest.version !== 1 || manifest.themes.length !== 8 ||
        images['map.png'].naturalWidth !== 1536 || images['map.png'].naturalHeight !== 1024 ||
        images['adventure-mode.png'].naturalWidth !== 1672 || images['adventure-mode.png'].naturalHeight !== 941 ||
        images['status-reference.webp'].naturalWidth !== 2170 || images['status-reference.webp'].naturalHeight !== 725) {
      throw new Error('The Adventure source images and crop manifest do not match.');
    }
    api.source = manifest;
    api.themes = manifest.themes;
    for (const theme of manifest.themes) {
      const original = images['map.png'];
      const grass = theme.key === 0;
      textures.push({
        ground: crop(grass ? images['adventure-mode.png'] : original, grass ? manifest.villageArena.ground : theme.ground),
        wall: crop(grass ? images['adventure-mode.png'] : original, grass ? manifest.villageArena.wall : theme.wall, true),
        accent: crop(original, theme.accent, true),
        variant: theme.groundVariant ? crop(original, theme.groundVariant) : null
      });
      if (ArenaThemes[theme.key]) ArenaThemes[theme.key][0] = theme.name;
    }
    api.loaded = true;
    DesignModels.tile = tile;
    Arena3D.setTilt(Arena3D.cfg.tilt);
    Arena3D.rebuild();
    setupLayout();
    dispatchEvent(new CustomEvent('shinobi-adventure-design-ready'));
    return true;
  });
  // Capture the complete loading chain synchronously, before any asynchronous
  // artwork work begins. The existing startup gate waits for this same promise.
  sprites.ready = api.ready;
  api.ready.catch(error => console.error('Adventure design could not be applied:', error));

  function themeFor(stage) { return ((Math.max(1, Number(stage) || 1) - 1) % 8 + 8) % 8; }
  function geometry(tilt) {
    return tilt
      ? { top: 34, rh0: 27, rh1: 31.2, s0: .89, s1: .95 }
      : { top: 34, rh0: 29.1, rh1: 29.1, s0: .95, s1: .95 };
  }
  function crop(image, box, transparent = false) {
    const [x, y, width, height] = box;
    if (![x, y, width, height].every(Number.isInteger) || width <= 0 || height <= 0 || x < 0 || y < 0 ||
        x + width > image.naturalWidth || y + height > image.naturalHeight) throw new Error('A map crop is outside the original artwork.');
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: transparent });
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    if (transparent) {
      const pixels = context.getImageData(0, 0, width, height), data = pixels.data;
      const seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
      let start = 0, end = 0;
      const add = pixel => {
        if (seen[pixel]) return;
        seen[pixel] = 1;
        const i = pixel * 4;
        if (Math.max(data[i], data[i + 1], data[i + 2]) < 57 && data[i] + data[i + 1] + data[i + 2] < 115) queue[end++] = pixel;
      };
      for (let px = 0; px < width; px++) { add(px); add((height - 1) * width + px); }
      for (let py = 1; py < height - 1; py++) { add(py * width); add(py * width + width - 1); }
      while (start < end) {
        const pixel = queue[start++], px = pixel % width, py = Math.floor(pixel / width);
        data[pixel * 4 + 3] = 0;
        if (px) add(pixel - 1); if (px + 1 < width) add(pixel + 1);
        if (py) add(pixel - width); if (py + 1 < height) add(pixel + width);
      }
      context.putImageData(pixels, 0, 0);
    }
    return canvas;
  }
  function projectTexture(context, texture, quad) {
    const width = texture.width, height = texture.height;
    context.save(); context.beginPath();
    quad.forEach((point, i) => i ? context.lineTo(...point) : context.moveTo(...point));
    context.closePath(); context.clip();
    context.transform((quad[1][0] - quad[0][0]) / width, (quad[1][1] - quad[0][1]) / width,
      (quad[3][0] - quad[0][0]) / height, (quad[3][1] - quad[0][1]) / height, quad[0][0], quad[0][1]);
    context.drawImage(texture, 0, 0, width, height);
    context.restore();
  }
  function tile(context, quad, index, row = 0) {
    if (!api.loaded) return;
    const style = textures[((Number(index) || 0) % 8 + 8) % 8];
    projectTexture(context, row ? style.wall : style.ground, quad);
  }
  function drawFloor(canvas, world) {
    const { W, H, T, proj, Sg, map, G } = world;
    canvas.width = W * T; canvas.height = 560;
    const context = canvas.getContext('2d'), index = themeFor(map), style = textures[index];
    context.imageSmoothingEnabled = true;
    // Keep the reference's surrounding railings and lanterns visible. Only the
    // projected live board is opaque; the canvas outside it stays transparent.
    // Only ground textures are projected onto walkable cells. Obstacles come
    // exclusively from the live G[k===1] draw list, never from a baked map view.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const quad = [proj(x - .015, y - .015), proj(x + 1.015, y - .015), proj(x + 1.015, y + 1.015), proj(x - .015, y + 1.015)];
      const variant = style.variant && ((x * 7 + y * 11 + map) % 13 === 0);
      projectTexture(context, variant ? style.variant : style.ground, quad);
      if (G[y][x].k === 1) {
        const p = proj(x + .6, y + .9), scale = Sg(y + 1);
        context.fillStyle = '#06101138'; context.beginPath(); context.ellipse(p[0] + 7 * scale, p[1] + 2 * scale, 20 * scale, 6 * scale, 0, 0, Math.PI * 2); context.fill();
      }
    }
    const rim = [proj(0, 0), proj(W, 0), proj(W, H), proj(0, H)];
    context.strokeStyle = '#03101988'; context.lineWidth = 4;
    context.beginPath(); rim.forEach((p, i) => i ? context.lineTo(...p) : context.moveTo(...p)); context.closePath(); context.stroke();
  }
  function drawWall(context, x, y, world) {
    const index = themeFor(world.map), style = textures[index], scale = world.Sg(y + 1);
    const p = world.proj(x + .5, y + .96), width = 35 * scale;
    const height = style.wall.height / style.wall.width * width;
    context.drawImage(style.wall, p[0] - width / 2, p[1] - height, width, height);
    // Decorative props share an actual collision wall's cell. They never create
    // an obstacle on an otherwise walkable cell or a new enemy/target.
    if (x % 6 === 1 && y % 4 === 1) {
      const aw = (index === 1 || index === 6 ? 25 : 32) * scale;
      const ah = style.accent.height / style.accent.width * aw;
      context.drawImage(style.accent, p[0] - aw / 2, p[1] - height * .55 - ah, aw, ah);
    }
  }

  function setupLayout() {
    if (document.getElementById('exactAdventureScene')) return;
    const adventure = document.getElementById('p0'), bar = document.querySelector('.menu-topbar');
    const originalAdventure = document.createComment('live Adventure page'); adventure.before(originalAdventure);
    const originalBar = document.createComment('shared Adventure toolbar'); bar.before(originalBar);
    const screen = document.createElement('section'); screen.id = 'exactAdventureScreen'; screen.hidden = true;
    screen.setAttribute('aria-label', 'Adventure');
    const scene = document.createElement('div'); scene.id = 'exactAdventureScene'; screen.append(scene);
    const art = new Image(1672, 941); art.className = 'exact-adventure-art'; art.alt = ''; art.setAttribute('aria-hidden', 'true');
    art.draggable = false; art.src = images['adventure-mode.png'].src; scene.append(art);
    // Reuse the supplied ornamental banner itself. Only its printed example
    // values are replaced; live data never sits over the old sample text.
    const source = images['status-reference.webp'];
    const backdrop = document.createElement('canvas'); backdrop.className = 'adventure-status-backdrop';
    backdrop.width = 2170; backdrop.height = 100; backdrop.setAttribute('aria-hidden', 'true');
    backdrop.getContext('2d').drawImage(source, 0, 208, 2170, 100, 0, 0, 2170, 100); scene.append(backdrop);
    const banner = document.createElement('canvas'); banner.className = 'adventure-status-art';
    banner.width = 2070; banner.height = 168; banner.setAttribute('aria-hidden', 'true');
    const bannerContext = banner.getContext('2d');
    bannerContext.drawImage(source, 50, 307, 2070, 168, 0, 0, 2070, 168);
    function blankValue(x, y, width, height, from, to) {
      const fill = bannerContext.createLinearGradient(x, y, x + width, y + height);
      fill.addColorStop(0, from); fill.addColorStop(1, to); bannerContext.fillStyle = fill;
      bannerContext.fillRect(x, y, width, height);
    }
    blankValue(205, 16, 813, 128, '#04111f', '#06192a');
    blankValue(1144, 27, 288, 108, '#150a12', '#210b15');
    blankValue(1610, 27, 392, 108, '#03180f', '#07291a');
    scene.append(banner);
    const stageNumber = document.createElement('span'); stageNumber.className = 'adventure-stage-number';
    const stageName = document.createElement('span'); stageName.className = 'adventure-stage-name';
    const separator = document.createElement('span'); separator.className = 'adventure-stage-separator'; separator.textContent = '|'; separator.setAttribute('aria-hidden', 'true');
    const enemyCount = document.createElement('span'); enemyCount.className = 'adventure-enemy-count';
    enemyCount.setAttribute('aria-live', 'off');
    const enemyCurrent = document.createElement('b'), enemyMaximum = document.createElement('span');
    enemyCount.append(enemyCurrent, enemyMaximum);
    const stageLabel = document.createElement('span'), enemyLabel = document.createElement('span'), sessionLabel = document.createElement('span');
    for (const [node, kind, text] of [[stageLabel, 'stage', 'STAGE'], [enemyLabel, 'enemy', 'ENEMIES'], [sessionLabel, 'session', 'Session gained:']]) { node.className = 'adventure-status-label adventure-' + kind + '-label'; node.textContent = text; node.setAttribute('aria-hidden', 'true'); }
    scene.append(stageLabel, enemyLabel, sessionLabel, stageNumber, separator, stageName, enemyCount);
    const mobileStatus = document.createElement('div'); mobileStatus.className = 'adventure-mobile-status';
    mobileStatus.setAttribute('aria-label', 'Adventure status');
    mobileStatus.innerHTML = '<div class="adventure-mobile-stage"><span>STAGE</span><strong class="adventure-mobile-stage-number"></strong><b class="adventure-mobile-stage-name"></b></div><div class="adventure-mobile-enemy"><span>ENEMIES</span><strong class="adventure-mobile-enemy-value"></strong><small>remaining</small></div><div class="adventure-mobile-session"><span>SESSION GAINED</span><strong class="adventure-mobile-session-value"></strong><small>Ryo</small></div>';
    scene.append(mobileStatus);
    const mobileStageNumber = mobileStatus.querySelector('.adventure-mobile-stage-number');
    const mobileStageName = mobileStatus.querySelector('.adventure-mobile-stage-name');
    const mobileEnemies = mobileStatus.querySelector('.adventure-mobile-enemy-value');
    const mobileSession = mobileStatus.querySelector('.adventure-mobile-session-value');
    document.body.append(screen);

    const manage = [...adventure.querySelectorAll('.bulk-actions button')].find(button => /heroes/i.test(button.textContent));
    const work = [...adventure.querySelectorAll('.bulk-actions button')].find(button => /work all/i.test(button.textContent));
    const rest = [...adventure.querySelectorAll('.bulk-actions button')].find(button => /rest all/i.test(button.textContent));
    if (!manage || !work || !rest) throw new Error('The existing Adventure controls could not be found.');
    manage.classList.add('exact-adventure-manage'); work.classList.add('exact-adventure-work'); rest.classList.add('exact-adventure-rest');
    for (const [button, label] of [[manage, 'Manage heroes'], [work, 'Work All'], [rest, 'Rest All']]) button.setAttribute('aria-label', label);
    document.getElementById('sessionRyo').removeAttribute('style');
    const session = document.getElementById('sessionRyo');
    function refreshSession() {
      const amount = Math.floor(Number(window.SessionRyo?.gained) || 0);
      const value = '+' + amount.toLocaleString() + ' Ryo';
      if (session.textContent !== value) session.textContent = value;
      session.setAttribute('aria-label', 'Session gained: ' + value); session.dataset.ryo = String(amount);
      session.classList.toggle('long-session-value', value.length > 14);
      mobileSession.textContent = '+' + amount.toLocaleString();
      mobileSession.setAttribute('aria-label', 'Session gained: ' + value);
    }
    new MutationObserver(refreshSession).observe(session, { childList: true, characterData: true, subtree: true });

    const wallet = document.createElement('button'); wallet.type = 'button'; wallet.className = 'exact-adventure-wallet';
    wallet.setAttribute('aria-label', 'Open Ryo wallet'); wallet.onclick = () => ShinobiBetaUI.open(); scene.append(wallet);
    const strip = document.getElementById('strip');
    const slots = [[37, 703, 322], [369, 703, 308], [688, 703, 304], [1002, 703, 311], [1325, 703, 316],
      [37, 811, 322], [369, 811, 308], [688, 811, 304], [1002, 811, 311], [1325, 811, 316]];
    let countedGrid = null, countedMap = null, enemyTotal = 0, renderedBalance = null;
    function refreshRoster() {
      if (tab !== 0) return;
      const balance = document.getElementById('ry').textContent;
      if (balance !== renderedBalance) {
        let font = 20;
        while (font > 9) { bannerContext.font = '700 ' + font + 'px Arial'; if (bannerContext.measureText(balance).width <= 76) break; font--; }
        scene.style.setProperty('--adventure-ryo-font', font + 'px'); scene.dataset.ryoBalance = balance; renderedBalance = balance;
      }
      const remaining = left();
      if (countedGrid !== G || countedMap !== S.map) { countedGrid = G; countedMap = S.map; enemyTotal = remaining; }
      enemyTotal = Math.max(enemyTotal, remaining);
      stageNumber.textContent = 'Stage ' + S.map;
      stageName.textContent = ArenaThemes[themeFor(S.map)][0]; stageName.title = stageName.textContent;
      stageName.classList.toggle('long-name', stageName.textContent.length > 18);
      mobileStageNumber.textContent = stageNumber.textContent; mobileStageName.textContent = stageName.textContent;
      if (enemyCurrent.textContent !== String(remaining)) enemyCurrent.textContent = remaining;
      if (enemyMaximum.textContent !== ' / ' + enemyTotal) enemyMaximum.textContent = ' / ' + enemyTotal;
      enemyCount.dataset.remaining = String(remaining); enemyCount.dataset.total = String(enemyTotal);
      enemyCount.setAttribute('aria-label', remaining + ' enemies remaining of ' + enemyTotal + ' at map start');
      mobileEnemies.textContent = remaining + ' / ' + enemyTotal;
      refreshSession();
      strip.querySelectorAll('.exact-adventure-empty-slot').forEach(card => card.remove());
      const real = [...strip.querySelectorAll('.map-hero')];
      for (let i = real.length; i < 10; i++) {
        const slot = document.createElement('div'); slot.className = 'exact-adventure-empty-slot';
        const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'exact-adventure-slot-plus';
        plus.setAttribute('aria-label', 'Manage hero slot ' + (i + 1)); plus.onclick = () => go(1);
        const rest = document.createElement('button'); rest.type = 'button'; rest.disabled = true; rest.className = 'exact-adventure-slot-rest';
        rest.setAttribute('aria-label', 'Rest hero in empty slot ' + (i + 1)); slot.append(plus, rest); strip.append(slot);
      }
      [...strip.children].filter(card => card.matches('.map-hero,.exact-adventure-empty-slot')).forEach((card, i) => {
        const [x, y, width] = slots[i];
        card.dataset.adventureSlot = String(i + 1);
        card.style.setProperty('--slot-x', x + 'px'); card.style.setProperty('--slot-y', y + 'px'); card.style.setProperty('--slot-width', width + 'px');
        const button = card.querySelector('button'); if (card.classList.contains('map-hero') && button) button.setAttribute('aria-label', 'Rest ' + (card.querySelector('b')?.textContent || 'hero'));
      });
      document.getElementById('st').textContent = 'Deployed ' + S.h.filter(hero => hero.on).length + '/10 · Enemy ninja ' + left();
    }
    function resize() {
      const scale = Math.min(innerWidth / 1672, innerHeight / 941);
      scene.style.setProperty('--adventure-scale', scale);
      // The reference has an odd pixel height. Integer offsets avoid an extra
      // half-pixel compositor resampling at its native resolution.
      scene.style.left = Math.round((innerWidth - 1672 * scale) / 2) + 'px';
      scene.style.top = Math.round((innerHeight - 941 * scale) / 2) + 'px';
    }
    function sync() {
      const active = tab === 0 && !window.LoginScreen?.active && !window.GameLoading?.active;
      document.body.classList.toggle('exact-adventure-active', active); screen.hidden = !active; screen.inert = !active;
      if (active) { scene.append(adventure, bar); resize(); refreshRoster(); }
      else {
        if (adventure.parentNode === scene) originalAdventure.after(adventure);
        if (bar.parentNode === scene) originalBar.after(bar);
      }
    }
    const previousGo = go; go = function (...args) { const result = previousGo(...args); sync(); return result; };
    const previousHud = hud; hud = function (...args) { const result = previousHud(...args); refreshRoster(); return result; };
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', resize); addEventListener('shinobi-ryo-ledger', refreshRoster);
    GameLoading.ready.then(sync); sync();
    api.refresh = refreshRoster;
  }
})();
