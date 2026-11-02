/* Presentation only. Experience owns revealed flags/save/Continue; TokenCheckout owns purchases. */
(() => {
  'use strict';
  const sprites = window.ShinobiSprites;
  const ranks = ['Genin', 'Chunin', 'Jonin', 'Elite', 'Legend'];
  const colors = ['#c5cbd5', '#48dc8b', '#45b5ff', '#bd79ff', '#ffcf63'];
  // Existing model identity is independent of rank and gameplay probabilities.
  const elements = {
    fire: ['Fire', '♨', '#ff6545'], shadow: ['Shadow', '☾', '#b975ff'],
    storm: ['Storm', '≋', '#54aaff'], earth: ['Earth', '◆', '#dc9a63'],
    ice: ['Ice', '❄', '#7cdeff'], poison: ['Poison', '✾', '#89ed69'],
    lightning: ['Lightning', 'ϟ', '#ffe175'], spirit: ['Spirit', '✦', '#f2a1ef']
  };
  const motion = matchMedia('(prefers-reduced-motion: reduce)'), timers = new Set();
  const quotes = new WeakMap(), drawnModels = new WeakMap();
  let oneBusy = false, modelFrame = 0;
  let dialog, scene, currentBatch, opening = null, backdropOwner = null, skipAnimations = false, againBusy = false, focusKey = null;
  const api = window.RevealDesign = { loaded: false, ready: null, refresh, paint, open, sync, skip, canReveal };
  const batch = () => S.v2.revealBatch || [];
  const $ = selector => dialog?.querySelector(selector);
  function later(fn, delay) {
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay);
    timers.add(timer); return timer;
  }
  function canReveal() {
    const records = batch();
    if (!records.length) return false;
    const owners = records.map(item => item.hero?.tokenOwner).filter(Boolean);
    if (!owners.length) return true;
    const state = window.RyoPayments?.state;
    return !!state?.authenticated && owners.every(owner => owner === state.account);
  }
  function cleanup() {
    opening?.finish(); opening = null;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    stopModels();
    clearBackdrop();
    dialog?.querySelectorAll('.is-opening,.cinematic-elite,.cinematic-legend').forEach(card => card.classList.remove('is-opening', 'cinematic-elite', 'cinematic-legend'));
  }
  function clearBackdrop(owner) {
    if (owner && backdropOwner !== owner) return;
    backdropOwner = null;
    dialog?.classList.remove('legend-opening');
  }
  function stopModels() {
    if (modelFrame) cancelAnimationFrame(modelFrame);
    modelFrame = 0;
  }
  function scheduleModels() {
    if (modelFrame || !dialog?.open || document.hidden || !canReveal()) return;
    modelFrame = requestAnimationFrame(() => {
      modelFrame = 0;
      if (!dialog.open || document.hidden || !canReveal()) return;
      const grid = $('.reveal-grid'); if (!grid) return;
      const viewport = grid.getBoundingClientRect();
      // Read all layout first, then paint. No recurring canvas redraw loop.
      const entries = [...grid.querySelectorAll('.is-revealed[data-reveal]')].map(card => {
        const bounds = card.getBoundingClientRect(), canvas = card.querySelector('.cinematic-model canvas');
        return { card, canvas, width: canvas?.clientWidth, height: canvas?.clientHeight,
          visible: bounds.bottom > viewport.top && bounds.top < viewport.bottom && bounds.right > viewport.left && bounds.left < viewport.right };
      });
      for (const entry of entries) {
        entry.card.classList.toggle('model-visible', entry.visible);
        if (entry.visible) drawModel(entry, batch()[Number(entry.card.dataset.reveal)]?.hero);
      }
    });
  }
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleModels) : null;
  api.ready = sprites.ready = Promise.resolve(sprites.ready).then(() => {
    dialog = document.getElementById('summonReveal');
    dialog.classList.add('exact-reveal', 'cinematic-reveal');
    dialog.addEventListener('focusin', event => {
      const card = event.target.closest('[data-reveal]');
      focusKey = card ? '[data-reveal="' + card.dataset.reveal + '"]' : event.target.id ? '#' + event.target.id : null;
    });
    dialog.addEventListener('close', () => { if (!dialog.open) { cleanup(); resize?.disconnect(); } });
    dialog.addEventListener('scroll', scheduleModels, { capture: true, passive: true });
    addEventListener('resize', scheduleModels, { passive: true });
    addEventListener('pagehide', cleanup);
    addEventListener('pageshow', scheduleModels);
    document.addEventListener('visibilitychange', () => {
      document.body.classList.toggle('cinematic-paused', document.hidden);
      if (document.hidden) { opening?.finish(); stopModels(); }
      else scheduleModels();
    });
    motion.addEventListener('change', () => { if (motion.matches) opening?.finish(); stopModels(); scheduleModels(); });
    const accountChanged = () => {
      if (!canReveal()) { cleanup(); if (dialog.open) dialog.close(); }
      else if (batch().length && !dialog.open && !window.GameLoading?.active) Experience.refreshReveal();
      else sync();
    };
    addEventListener('shinobi-beta-wallet', accountChanged);
    addEventListener('shinobi-ryo-ledger', accountChanged);
    api.loaded = true; refresh(); return true;
  });
  api.ready.catch(error => console.error('Cinematic reveal could not be applied:', error));

  function refresh() {
    if (!api.loaded || !batch().length) return;
    if (!canReveal()) { cleanup(); if (dialog.open) dialog.close(); return; }
    if (!$('.reveal-grid')) return;
    const restoreFocus = document.activeElement === document.body ? focusKey : null;
    // Native delivery can rebuild a modal mid-animation. Native reveal validates
    // the same record after the visual wait, so no new result is manufactured.
    cleanup();
    if (currentBatch !== batch()) { currentBatch = batch(); skipAnimations = false; againBusy = false; }
    scene = $('.exact-reveal-scene');
    if (!scene) {
      scene = document.createElement('div'); scene.className = 'exact-reveal-scene';
      scene.append(...dialog.childNodes); dialog.append(scene);
    }
    scene.dataset.revealSource = S.v2.revealSource || 'summon';
    scene.dataset.revealQuantity = String(batch().length);
    if (!$('.cinematic-controls')) {
      const controls = document.createElement('div'); controls.className = 'cinematic-controls';
      controls.append($('#revealAll'));
      const one = document.createElement('button'); one.type = 'button'; one.id = 'revealOne';
      one.textContent = 'Reveal One'; one.onclick = revealOne; controls.append(one);
      const button = document.createElement('button'); button.type = 'button'; button.id = 'revealSkip';
      button.textContent = 'Skip Animation'; button.onclick = skip; controls.append(button);
      $('.reveal-footer').prepend(controls);
      const announce = document.createElement('p'); announce.className = 'cinematic-announcement';
      announce.setAttribute('role', 'status'); announce.setAttribute('aria-live', 'polite');
      $('.reveal-header').after(announce);
      const summary = document.createElement('div'); summary.className = 'cinematic-summary';
      summary.setAttribute('aria-label', 'Summon rarity summary'); $('.reveal-grid').after(summary);
      const actions = document.createElement('div'); actions.className = 'cinematic-actions';
      const again = document.createElement('button'); again.type = 'button'; again.id = 'revealAgain';
      again.innerHTML = '<span>Summon Again</span><small class="cinematic-cost">Checking cost…</small>'; again.onclick = summonAgain;
      actions.append(again, $('#revealContinue')); $('.reveal-footer').append(actions);
      const atmosphere = document.createElement('div'); atmosphere.className = 'cinematic-atmosphere';
      atmosphere.setAttribute('aria-hidden', 'true'); atmosphere.innerHTML = '<i></i>'.repeat(8); scene.prepend(atmosphere);
    }
    $('#revealProgress').setAttribute('role', 'status');
    $('.reveal-grid').setAttribute('aria-label', 'Shinobi summoning scrolls');
    // Native delivery rebuilds the whole grid. Classify collection badges and
    // synchronize the controls once, instead of rescanning them for each card.
    const newModels = newModelFlags();
    batch().forEach((_, index) => paint(index, newModels, true));
    resize?.disconnect(); resize?.observe($('.reveal-grid'));
    dialog.querySelectorAll('.cinematic-model').forEach(element => resize?.observe(element));
    sync(); scheduleModels();
    if (restoreFocus && dialog.open) $(restoreFocus)?.focus({ preventScroll: true });
  }

  function paint(index, newModels, deferSync = false) {
    if (!api.loaded || !canReveal()) return;
    const item = batch()[index], card = $('[data-reveal="' + index + '"]');
    if (!item?.hero || !card) return;
    const hero = item.hero, rank = Math.max(0, Math.min(4, Number(hero.r) || 0));
    const model = PlayerModels.modelFor(hero), element = elements[model.key] || ['Shinobi', '✦', '#d6d6ef'];
    card.classList.toggle('is-revealed', item.revealed === true);
    card.classList.remove('rare-sealed', 'rare-opening');
    card.dataset.rank = String(rank); card.dataset.element = model.key;
    card.style.setProperty('--rank-color', item.revealed ? colors[rank] : '#bda16d');
    card.style.setProperty('--element-color', element[2]);
    card.setAttribute('aria-label', item.revealed ? hero.name + ', ' + element[0] + ', ' + ranks[rank] + ', level ' + hero.lv : 'Reveal scroll ' + (index + 1));
    card.setAttribute('aria-pressed', String(item.revealed === true));
    card.setAttribute('aria-disabled', String(item.revealed === true));
    if (!card.querySelector('.cinematic-face')) {
      const seal = document.createElement('span'); seal.className = 'cinematic-seal';
      seal.innerHTML = '<span class="cinematic-scroll" aria-hidden="true"><i class="cinematic-scroll-cap top"></i><span class="cinematic-scroll-body"><b>忍</b></span><i class="cinematic-scroll-cap bottom"></i></span><b>SEALED SCROLL</b><small>Tap to reveal</small>';
      const face = document.createElement('span'); face.className = 'cinematic-face';
      face.innerHTML = '<span class="cinematic-portrait cinematic-model"><canvas aria-hidden="true"></canvas><i class="cinematic-sparks" aria-hidden="true"></i></span><span class="cinematic-element"></span><strong class="cinematic-name"></strong><span class="cinematic-stars"></span><span class="cinematic-stats"></span><span class="cinematic-rank"></span><span class="cinematic-new">NEW!</span>';
      card.append(seal, face);
    }
    const face = card.querySelector('.cinematic-face');
    face.setAttribute('aria-hidden', String(!item.revealed));
    card.querySelector('.cinematic-seal').setAttribute('aria-hidden', String(!!item.revealed));
    face.querySelector('.cinematic-element').textContent = element[1] + ' ' + element[0];
    face.querySelector('.cinematic-name').textContent = hero.name;
    const stars = face.querySelector('.cinematic-stars');
    stars.textContent = '★'.repeat(rank + 1); stars.setAttribute('aria-label', ranks[rank] + ': rank ' + (rank + 1) + ' of 5');
    stars.title = 'Stars indicate rarity rank, not an additional hero stat';
    const number = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—';
    face.querySelector('.cinematic-stats').textContent = 'Lv. ' + number(hero.lv) + ' · Power ' + number(hero.pw) + ' · Stamina ' + number(hero.st);
    face.querySelector('.cinematic-rank').textContent = ranks[rank];
    const badge = face.querySelector('.cinematic-new'); badge.hidden = !(newModels || newModelFlags())[index];
    badge.title = 'First ' + model.label + ' in your current collection';
    if (item.revealed && opening?.item === item) {
      card.classList.remove('is-opening');
      const revealedOpening = opening;
      later(() => { card.classList.remove('cinematic-elite', 'cinematic-legend'); clearBackdrop(revealedOpening); }, skipAnimations || motion.matches ? 0 : 420);
    }
    if (!deferSync) { scheduleModels(); sync(); }
  }

  function drawModel({ card, canvas, width, height }, hero) {
    if (!hero || !canvas || !width || !height || !card.isConnected || !dialog.open) return;
    const density = Math.min(2, devicePixelRatio || 1);
    const pixelWidth = Math.round(width * density), pixelHeight = Math.round(height * density);
    // Draw once per hero and display size; CSS supplies the idle motion.
    const key = [hero.id, hero.r, hero.z, pixelWidth, pixelHeight].join('|');
    if (drawnModels.get(canvas) === key) return;
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    const context = canvas.getContext('2d'); if (!context) return;
    context.setTransform(density, 0, 0, density, 0, 0);
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    // The actual in-game hero and its rarity aura, drawn exactly as the menus draw them.
    PlayerModels.drawPortrait(context, hero, width / 2, height * .92, Math.min(width / 40, height / 50) * .97, 0);
    drawnModels.set(canvas, key);
  }

  function newModelFlags() {
    const records = batch();
    if (S.v2.revealSource !== 'summon') return records.map(item => item?.isNew === true || item?.hero?.isNew === true);
    const identity = h => h.tokenId ? 'token:' + h.tokenOwner + ':' + h.tokenId : 'local:' + h.id;
    const resultIds = new Set(records.filter(record => record?.hero).map(record => identity(record.hero)));
    const owned = new Map(), seen = new Set();
    for (const hero of S.h) {
      if (!hero || resultIds.has(identity(hero))) continue;
      let models = owned.get(hero.tokenOwner);
      if (!models) { models = new Set(); owned.set(hero.tokenOwner, models); }
      models.add(PlayerModels.modelFor(hero).key);
    }
    // This is a snapshot for one paint/refresh, never a second collection cache.
    // Individual paints recalculate it so ledger changes cannot leave stale NEWs.
    return records.map(item => {
      if (!item?.hero) return item?.isNew === true;
      const hero = item.hero, model = PlayerModels.modelFor(hero).key;
      const isNew = !owned.get(hero.tokenOwner)?.has(model) && !seen.has(model);
      seen.add(model);
      return isNew;
    });
  }

  function open(index) {
    const item = batch()[index], card = $('[data-reveal="' + index + '"]');
    if (!item || !card || !canReveal() || item.revealed) return Promise.resolve();
    const rank = Number(item.hero.r);
    // Each opening owns its own backdrop. Starting a common/Elite scroll must
    // retire a previous Legend, and its delayed cleanup must not dim a new one.
    clearBackdrop();
    if (!skipAnimations && !motion.matches && !document.hidden) {
      card.classList.add('is-opening');
      if (rank === 3) card.classList.add('cinematic-elite');
      if (rank === 4) { card.classList.add('cinematic-legend'); dialog.classList.add('legend-opening'); }
    }
    if (rank >= 3) {
      $('.cinematic-announcement').textContent = (rank === 4 ? 'LEGEND AWAKENED' : 'ELITE SHINOBI') + ' · ' + item.hero.name;
      $('.cinematic-announcement').style.setProperty('--rank-color', colors[rank]);
    }
    return new Promise(resolve => {
      const record = { item, finish() { if (record.done) return; record.done = true; clearTimeout(record.timer); timers.delete(record.timer); resolve(); } };
      opening = record;
      if (dialog.classList.contains('legend-opening')) backdropOwner = record;
      if (skipAnimations || motion.matches || document.hidden) record.finish();
      else record.timer = later(record.finish, rank === 4 ? 950 : rank === 3 ? 800 : 650);
    });
  }

  function sync() {
    if (!api.loaded || !scene?.isConnected || !batch().length || !canReveal()) return;
    const records = batch(), complete = records.every(item => item.revealed);
    scene.classList.toggle('is-complete', complete);
    const counts = ranks.map((_, rank) => records.filter(item => item.revealed && Number(item.hero.r) === rank).length);
    const summary = $('.cinematic-summary');
    if (summary) {
      summary.hidden = !complete;
      const text = counts.join(',');
      if (summary.dataset.counts !== text) {
        summary.dataset.counts = text;
        summary.innerHTML = ranks.map((name, rank) => '<span style="--rank-color:' + colors[rank] + '">' + name + ' <b>' + counts[rank] + '</b></span>').join('');
      }
    }
    const again = $('#revealAgain');
    if (again) {
      again.hidden = !complete || S.v2.revealSource !== 'summon';
      const price = quotes.get(records), state = window.RyoPayments?.state;
      again.disabled = againBusy || $('#revealContinue').disabled || !!state?.busy || price?.pending === true;
      const cost = again.querySelector('.cinematic-cost');
      if (cost) cost.textContent = price?.total != null ? price.total.toLocaleString('en-US') + ' Ryo' : price?.error ? 'Cost shown at checkout' : 'Checking cost…';
      if (!again.hidden && canReveal() && !state?.busy && !price) loadQuote(records);
    }
    const skipButton = $('#revealSkip'); if (skipButton) skipButton.hidden = complete;
    const all = $('#revealAll'); if (all) all.hidden = complete;
    const one = $('#revealOne'); if (one) { one.hidden = complete; one.disabled = oneBusy || !!all?.disabled; }
    $('#revealContinue').hidden = !complete;
    $('.reveal-footer > p').textContent = complete ? 'Saved to your collection · Stars indicate rarity rank' : 'Tap a scroll to meet your shinobi';
    if (complete && dialog.open && ['#revealAll', '#revealOne', '#revealSkip'].includes(focusKey) && !$('#revealContinue').disabled) $('#revealContinue').focus({ preventScroll: true });
  }

  async function loadQuote(records) {
    const state = window.RyoPayments?.state, owner = state?.account, quantity = records.length;
    if (!state?.authenticated || ![1, 5, 10, 15].includes(quantity)) return;
    // Set the cache before quote(), whose ledger notifications can synchronously rebuild UI.
    const request = { owner, quantity, pending: true }; quotes.set(records, request);
    try {
      const quote = await RyoPayments.quote('summon', { quantity });
      if (quote.product !== 'summon' || Number(quote.params?.quantity) !== quantity || !Number.isFinite(quote.total) || quote.total < 0) throw Error('Invalid summon quote.');
      request.total = quote.total;
    } catch { request.error = true; }
    finally {
      request.pending = false;
      if (batch() === records && canReveal() && RyoPayments.state.account === owner) sync();
    }
  }

  async function revealOne() {
    if (oneBusy || !canReveal() || $('#revealAll')?.disabled) return;
    const index = batch().findIndex(item => !item.revealed); if (index < 0) return;
    oneBusy = true; sync();
    try { await Experience.reveal(index); } finally { oneBusy = false; sync(); }
  }

  async function skip() {
    if (!canReveal()) return;
    skipAnimations = true; opening?.finish();
    clearBackdrop();
    dialog.querySelectorAll('.is-opening,.cinematic-elite,.cinematic-legend').forEach(card => card.classList.remove('is-opening', 'cinematic-elite', 'cinematic-legend'));
    // Allow the native handler to leave busy before asking it to reveal the rest.
    // Native batchRun keeps an already-running Reveal All singular.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (canReveal() && dialog.open) await Experience.revealAll();
  }

  async function summonAgain() {
    if (againBusy || !canReveal() || !batch().every(item => item.revealed) || $('#revealContinue').disabled) return;
    againBusy = true; sync();
    const quantity = batch().length;
    try {
      await Experience.finishReveal();
      if (batch().length || ![1, 5, 10, 15].includes(quantity)) return;
      Combat.quantity(quantity);
      // Existing quote/confirmation only. Its Pay button is the purchase action.
      await Combat.summonBatch();
    } finally { againBusy = false; sync(); }
  }
})();
