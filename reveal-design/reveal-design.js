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
  const sourceRoot = new URL('.', document.currentScript.src), portraits = new Image();
  const portraitX = [15, 206, 397, 588, 779, 969, 1159, 1350];
  const quotes = new WeakMap();
  let portraitsRequested = false, portraitsLoaded = false, oneBusy = false;
  let dialog, scene, currentBatch, opening = null, skipAnimations = false, againBusy = false, portraitFrame = 0, focusKey = null;
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
    if (portraitFrame) cancelAnimationFrame(portraitFrame);
    portraitFrame = 0;
    dialog?.classList.remove('legend-opening');
    dialog?.querySelectorAll('.is-opening,.cinematic-elite,.cinematic-legend').forEach(card => card.classList.remove('is-opening', 'cinematic-elite', 'cinematic-legend'));
  }
  function schedulePortraits() {
    if (portraitFrame || !dialog?.open || !canReveal()) return;
    portraitFrame = requestAnimationFrame(() => {
      portraitFrame = 0;
      dialog.querySelectorAll('.is-revealed[data-reveal]').forEach(card => drawPortrait(card, batch()[Number(card.dataset.reveal)]?.hero));
    });
  }
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedulePortraits) : null;
  api.ready = sprites.ready = Promise.resolve(sprites.ready).then(() => {
    dialog = document.getElementById('summonReveal');
    dialog.classList.add('exact-reveal', 'cinematic-reveal');
    dialog.addEventListener('focusin', event => {
      const card = event.target.closest('[data-reveal]');
      focusKey = card ? '[data-reveal="' + card.dataset.reveal + '"]' : event.target.id ? '#' + event.target.id : null;
    });
    dialog.addEventListener('close', () => { if (!dialog.open) { cleanup(); resize?.disconnect(); } });
    addEventListener('pagehide', cleanup);
    document.addEventListener('visibilitychange', () => {
      document.body.classList.toggle('cinematic-paused', document.hidden);
      if (document.hidden) opening?.finish();
    });
    motion.addEventListener('change', () => { if (motion.matches) opening?.finish(); });
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
    if (!portraitsRequested) {
      portraitsRequested = true;
      portraits.onload = () => { portraitsLoaded = portraits.naturalWidth === 1536 && portraits.naturalHeight === 1024; schedulePortraits(); };
      portraits.src = new URL('../player-models/playermodel.png', sourceRoot).href;
    }
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
    batch().forEach((_, index) => paint(index));
    resize?.disconnect(); resize?.observe($('.reveal-grid'));
    sync(); schedulePortraits();
    if (restoreFocus && dialog.open) $(restoreFocus)?.focus({ preventScroll: true });
  }

  function paint(index) {
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
      face.innerHTML = '<span class="cinematic-portrait"><i class="cinematic-aura" aria-hidden="true"></i><canvas aria-hidden="true"></canvas><i class="cinematic-sparks" aria-hidden="true"></i></span><span class="cinematic-element"></span><strong class="cinematic-name"></strong><span class="cinematic-stars"></span><span class="cinematic-stats"></span><span class="cinematic-rank"></span><span class="cinematic-new">NEW!</span>';
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
    const badge = face.querySelector('.cinematic-new'); badge.hidden = !isNewModel(index);
    badge.title = 'First ' + model.label + ' in your current collection';
    if (item.revealed && opening?.item === item) {
      card.classList.remove('is-opening');
      const revealedOpening = opening;
      later(() => { card.classList.remove('cinematic-elite', 'cinematic-legend'); if (opening === revealedOpening) dialog.classList.remove('legend-opening'); }, skipAnimations || motion.matches ? 0 : 420);
    }
    schedulePortraits(); sync();
  }

  function drawPortrait(card, hero) {
    if (!hero || !card.isConnected || !dialog.open) return;
    const canvas = card.querySelector('.cinematic-portrait canvas'), width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const density = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(width * density); canvas.height = Math.round(height * density);
    const context = canvas.getContext('2d'); context.scale(density, density);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    // Larger portraits are the same eight original models, cropped above the
    // sheet's sample text. Shared arena sprites and rank-independent identity stay intact.
    if (portraitsLoaded) {
      const model = PlayerModels.modelFor(hero).index, scale = Math.min(width / 173, height / 216);
      const w = 173 * scale, h = 216 * scale;
      context.drawImage(portraits, portraitX[model], 256, 173, 216, (width - w) / 2, height - h, w, h);
    } else sprites.blit(context, PlayerModels.heroFrame(hero, 'i0'), width / 2, height * .95, Math.min(width / 40, height / 50) * .96, false);
  }

  function isNewModel(index) {
    const records = batch(), item = records[index];
    if (!item?.hero || S.v2.revealSource !== 'summon') return item?.isNew === true || item?.hero?.isNew === true;
    const hero = item.hero, model = PlayerModels.modelFor(hero).key;
    const identity = h => h.tokenId ? 'token:' + h.tokenOwner + ':' + h.tokenId : 'local:' + h.id;
    const resultIds = new Set(records.map(record => identity(record.hero)));
    const previouslyOwned = S.h.some(h => h.tokenOwner === hero.tokenOwner && !resultIds.has(identity(h)) && PlayerModels.modelFor(h).key === model);
    return !previouslyOwned && !records.slice(0, index).some(record => PlayerModels.modelFor(record.hero).key === model);
  }

  function open(index) {
    const item = batch()[index], card = $('[data-reveal="' + index + '"]');
    if (!item || !card || !canReveal() || item.revealed) return Promise.resolve();
    const rank = Number(item.hero.r);
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
    dialog.classList.remove('legend-opening');
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
