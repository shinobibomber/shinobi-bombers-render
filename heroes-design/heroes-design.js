/* Original Heroes frame, existing collection/actions, and the shared player/aura renderer. */
(() => {
  const previousReady = ShinobiSprites.ready, base = new URL('.', document.currentScript.src);
  const image = new Image(1774, 887);
  const sourceReady = new Promise((resolve, reject) => {
    image.onload = resolve; image.onerror = () => reject(Error('Original Heroes artwork could not be loaded.')); image.src = new URL('heroes-menu.png', base).href;
  });
  const api = window.HeroesDesign = { loaded: false, ready: null };
  api.ready = ShinobiSprites.ready = Promise.all([previousReady, sourceReady]).then(setup);
  api.ready.catch(error => console.error('Heroes design could not be applied:', error));

  function setup() {
    if (image.naturalWidth !== 1774 || image.naturalHeight !== 887) throw Error('Heroes reference dimensions do not match.');
    const section = document.getElementById('p1'), bar = document.querySelector('.menu-topbar');
    const sectionHome = document.createComment('Heroes page'), barHome = document.createComment('Heroes shared toolbar');
    section.before(sectionHome); bar.before(barHome);
    const screen = document.createElement('section'); screen.id = 'exactHeroesScreen'; screen.hidden = true; screen.setAttribute('aria-label', 'Heroes collection');
    const stage = document.createElement('div'); stage.className = 'heroes-scroll-stage'; screen.append(stage);
    const scene = document.createElement('div'); scene.id = 'exactHeroesScene'; stage.append(scene);
    image.className = 'heroes-reference-art'; image.alt = ''; image.setAttribute('aria-hidden', 'true'); image.draggable = false; scene.append(image); document.body.append(screen);
    const wallet = document.createElement('button'); wallet.type = 'button'; wallet.className = 'heroes-wallet-target'; wallet.setAttribute('aria-label', 'Open Ryo wallet'); wallet.onclick = () => ShinobiBetaUI.open(); scene.append(wallet);

    const sourceCards = [[30, 311, 334, 570], [381, 311, 330, 570], [725, 311, 330, 570], [1068, 311, 330, 570], [1409, 311, 334, 570]];
    const cardArt = sourceCards.map(box => crop(image, box));
    const backdrop = crop(image, [478, 8, 325, 187]);
    scene.style.setProperty('--collection-banner', crop(image, [0, 0, 1774, 210]));
    const icons = [[54, 616, 28, 28], [159, 616, 28, 28], [264, 616, 28, 28], [54, 656, 28, 28], [159, 656, 28, 28], [264, 656, 28, 28]].map(box => crop(image, box));
    // Use the original card's medallion/crystal, rather than the unrelated
    // crown icons in the aura-sheet headings. Keep one image and one live label.
    const badgeIcons = [crop(image, [48, 325, 36, 36]), crop(image, [738, 325, 36, 36])];
    const badgeNames = ['GENIN', 'CHUNIN', 'JONIN', 'ELITE', 'LEGEND'];
    const rankColors = ['#dbe5ef', '#4be986', '#39bfff', '#d95cff', '#ffd45d'];
    const columns = 5, pageSize = 10, cardHeight = 650, rowGap = 20;
    let contentHeight = 311 + 2 * cardHeight + rowGap + 16;
    let query = '', sorting = 'rarity', page = 0, rank = '', cards = [], search, select, pager, status;
    let detailId = null, detailOrigin = null, detailSignature = '';
    const detail = document.createElement('dialog'); detail.id = 'heroDetailDialog';
    detail.setAttribute('aria-labelledby', 'heroDetailTitle');
    detail.innerHTML = '<button type="button" class="hero-detail-close" aria-label="Close hero details">×</button><div class="hero-detail-art"><canvas aria-label="Hero portrait"></canvas><span class="hero-detail-status"></span></div><section class="hero-detail-panel"><div class="hero-detail-kicker"></div><h2 id="heroDetailTitle" class="hero-detail-title"></h2><p class="hero-detail-copy"></p><dl class="hero-detail-stats"></dl><div class="hero-detail-chakra"><p><span>CHAKRA</span><b></b></p><div class="bar"><i></i></div></div><div class="hero-detail-perks"></div><div class="hero-detail-actions"></div></section>';
    document.body.append(detail);
    detail.querySelector('.hero-detail-close').onclick = () => detail.close();
    detail.addEventListener('click', event => { if (event.target === detail) { const box = detail.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) detail.close(); } });
    detail.addEventListener('close', () => {
      const id = detailId, origin = detailOrigin; detailId = null; detailSignature = '';
      const replacement = cards.find(card => heroOf(card)?.id === id)?.querySelector('.hero-open-detail');
      const target = origin?.isConnected ? origin : replacement?.isConnected ? replacement : search;
      if (target?.isConnected && tab === 1) target.focus({ preventScroll: true });
    });

    function decorate() {
      const grid = section.querySelector('.hero-grid'); if (!grid) return;
      const currentRank = section.querySelector('.hero-filters .active')?.getAttribute('onclick') || '';
      if (rank !== currentRank) { rank = currentRank; page = 0; }
      cards = [...grid.querySelectorAll('.hero-sheet')];
      for (const card of cards) {
        const canvas = card.querySelector('[data-hero]'), hero = S.h[canvas.dataset.hero];
        card.dataset.rankMatch = card.hidden ? '0' : '1';
        card.classList.add('reference-hero-card'); card.style.setProperty('--tier-color', rankColors[hero.r]);
        card.dataset.collectionHero = String(hero.id);
        card.style.setProperty('--hero-backdrop', backdrop);
        canvas.setAttribute('data-exact-hero', '');
        canvas.setAttribute('aria-label', PlayerModels.modelFor(hero).label + ' · ' + R[hero.r][0]);
        const open = document.createElement('button'); open.type = 'button'; open.className = 'hero-open-detail';
        open.setAttribute('aria-label', 'View ' + hero.name + ' details'); open.title = 'View hero details';
        open.onclick = () => openDetail(hero.id, open); canvas.after(open);
        card.addEventListener('click', event => { if (!event.target.closest('button,a,input,select,summary,details')) openDetail(hero.id, open); });
        const badge = card.querySelector('.hero-portrait > span');
        badge.classList.add('reference-rarity-badge');badge.dataset.badgeRank=String(hero.r);badge.setAttribute('aria-label',badgeNames[hero.r]+' rarity');
        badge.style.removeProperty('--tier-icon');badge.style.setProperty('--badge-original-icon',badgeIcons[hero.r===3?1:0]);
        badge.replaceChildren();
        const emblem=document.createElement('span');emblem.className='rarity-badge-emblem';emblem.setAttribute('aria-hidden','true');
        const label=document.createElement('b');label.className='rarity-badge-label';label.textContent=badgeNames[hero.r];badge.append(emblem,label);
        const state = card.querySelector('.hero-status');
        if (card.classList.contains('hero-reserve')) {
          state.title = state.textContent; state.setAttribute('aria-label', state.textContent);
          state.textContent = hero.tokenId ? 'RESERVE' : 'PRACTICE';
        }
        const styleLine = card.querySelector('.hero-identity > p:not(.attack-label)');
        const styleText = styleLine?.dataset.baseStyle || styleLine?.childNodes[0]?.textContent.trim() || R[hero.r][0] + ' style';
        if (styleLine) { styleLine.classList.add('hero-style-line'); styleLine.dataset.baseStyle = styleText; styleLine.replaceChildren(); for (const text of ['Lv. ' + hero.lv, styleText, ['Shuriken', 'Twin shuriken', 'Fire shuriken', 'Lightning blade', 'Rasengan / Chidori'][hero.r]]) { const span = document.createElement('span'); span.textContent = text; styleLine.append(span); } }
        let damage = card.querySelector('.heroes-live-damage'); if (!damage) { damage = document.createElement('p'); damage.className = 'heroes-live-damage'; card.append(damage); }
        damage.textContent = Number(GameBalance.damage(hero)).toLocaleString(undefined,{maximumFractionDigits:2}) + ' damage / hit · ' + hero.bm + ' projectiles · ' + hero.rg + ' range';
        card.querySelectorAll('.hero-stats > div').forEach((stat, i) => stat.style.setProperty('--stat-icon', icons[i]));
        const actions = card.querySelector('.hero-actions');
        const perks = card.querySelector('.compact-perks');
        if (perks) { perks.tabIndex = 0; perks.setAttribute('aria-label', hero.name + ' perks'); }
        const buttons = [...actions.children];
        buttons[0]?.classList.add('hero-deploy-action'); buttons[1]?.classList.add('hero-train-action');
        buttons[0]?.addEventListener('click', () => { save(); hud(); });
        if (buttons[1]) buttons[1].textContent = buttons[1].textContent.replace(/\d{4,}/g, value => Number(value).toLocaleString());
        if (!actions.querySelector('.hero-mode-button')) {
          const mode = document.createElement('button'); mode.type = 'button'; mode.className = 'hero-mode-button'; mode.textContent = 'Move to Reserve'; mode.disabled = true; mode.title = 'Sign in to manage your collection.'; actions.append(mode);
        }
      }
      const filters = section.querySelector('.hero-filters');
      const filterBoxes = [[35, 221, 115], [164, 221, 174], [351, 221, 142], [508, 221, 119], [642, 221, 139], [797, 221, 133], [945, 221, 114], [1071, 221, 141]];
      [...filters.children].forEach((button, i) => { const [x, y, width] = filterBoxes[i]; Object.assign(button.style, { left: x + 'px', top: y + 'px', width: width + 'px' }); });
      const tools = document.createElement('div'); tools.className = 'heroes-collection-tools';
      search = document.createElement('input'); search.type = 'search'; search.className = 'heroes-search'; search.placeholder = 'Search heroes...'; search.setAttribute('aria-label', 'Search heroes'); search.value = query;
      search.oninput = () => { query = search.value; page = 0; layout(); };
      select = document.createElement('select'); select.className = 'heroes-sort'; select.setAttribute('aria-label', 'Sort heroes');
      select.style.setProperty('--sort-arrow', crop(image, [1715, 241, 16, 20]));
      for (const [value, label] of [['rarity', 'Rarity'], ['level', 'Level'], ['power', 'Power'], ['chakra', 'Chakra'], ['name', 'Name']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
      select.value = sorting; select.onchange = () => { sorting = select.value; page = 0; layout(); };
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'heroes-reset-filter'; reset.setAttribute('aria-label', 'Reset hero filters'); reset.onclick = () => { query = ''; sorting = 'rarity'; page = 0; HeroFilters.choose(-1); };
      pager = document.createElement('div'); pager.className = 'heroes-pagination'; tools.append(search, select, reset, pager); section.append(tools);
      status = section.querySelector('.hero-filter-status'); layout(); paint(performance.now());
      if (detail.open) refreshDetail(true);
    }
    function heroOf(card) { return S.h[card.querySelector('[data-hero]').dataset.hero]; }
    function layout() {
      const pagerFocus = pager?.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : '';
      const matches = cards.filter(card => card.dataset.rankMatch === '1' && heroOf(card).name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
      matches.sort((a, b) => {
        const x = heroOf(a), y = heroOf(b);
        return sorting === 'name' ? x.name.localeCompare(y.name) : (sorting === 'level' ? y.lv - x.lv : sorting === 'power' ? y.pw - x.pw : sorting === 'chakra' ? y.en - x.en : y.r - x.r) || x.id - y.id;
      });
      const pages = Math.max(1, Math.ceil(matches.length / pageSize)); page = Math.min(page, pages - 1);
      scene.dataset.pageSize = String(pageSize);
      const rows = Math.max(1, Math.ceil(Math.min(pageSize, matches.length - page * pageSize) / columns));
      contentHeight = 311 + rows * cardHeight + (rows - 1) * rowGap + 16;
      scene.dataset.visibleRows = String(rows);
      // Keep only the current page mounted; the full collection remains searchable.
      for (const card of cards) { card.hidden = true; card.remove(); }
      section.querySelectorAll('.heroes-empty-card').forEach(card => card.remove());
      for (let slot = 0; slot < rows * columns; slot++) {
        const card = matches[page * pageSize + slot], source = sourceCards[slot % columns];
        const box = [source[0], source[1] + Math.floor(slot / columns) * (cardHeight + rowGap), source[2], cardHeight];
        const item = card || document.createElement('article');
        if (!card) { item.className = 'heroes-empty-card'; const text = document.createElement('p'); text.textContent = matches.length ? 'No hero in this slot' : 'No heroes match this selection'; item.append(text); section.append(item); }
        item.hidden = false;
        if (card) section.querySelector('.hero-grid').append(card);
        Object.assign(item.style, { left: box[0] + 'px', top: box[1] + 'px', width: box[2] + 'px', height: box[3] + 'px' });
        const hero = card ? heroOf(card) : null, tier = hero?.r ?? 0;
        item.style.setProperty('--card-source', cardArt[tier === 4 ? 0 : 2]);
        item.dataset.cardTier = tier;
        let frame = item.querySelector(':scope > .reference-card-frame');
        if (!frame) { frame = document.createElement('span'); frame.className = 'reference-card-frame'; frame.setAttribute('aria-hidden','true'); item.prepend(frame); }
        if (card) {
          const canvas = card.querySelector('[data-hero]');
          const density = Math.min(2, Math.max(1, devicePixelRatio || 1));
          const width = Math.round((box[2] - 18) * density), height = Math.round(200 * density);
          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;
          canvas.dataset.portraitDensity = density;
        }
      }
      pager.replaceChildren(); pager.hidden = pages === 1;
      for (const [label, action, disabled] of [['Previous page', () => { page--; layout(); }, page === 0], ['Next page', () => { page++; layout(); }, page === pages - 1]]) { const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-label', label); button.textContent = label.startsWith('Previous') ? '‹' : '›'; button.disabled = disabled; button.onclick = action; pager.append(button); }
      const jump = document.createElement('select'); jump.className = 'heroes-page-select'; jump.setAttribute('aria-label', 'Go to collection page');
      for (let i = 0; i < pages; i++) { const option = document.createElement('option'); option.value = i; option.textContent = (i + 1) + ' / ' + pages; jump.append(option); }
      jump.value = page; jump.onchange = () => { page = Number(jump.value); layout(); pager.querySelector('select').focus({ preventScroll: true }); }; pager.firstChild.after(jump);
      status.textContent = (matches.length ? (page * pageSize + 1) + '–' + Math.min(matches.length, (page + 1) * pageSize) + ' of ' : '') + matches.length + ' heroes · ' + ({ rarity: 'Rarest first', level: 'Highest level first', power: 'Strongest first', chakra: 'Most chakra first', name: 'Name A–Z' })[sorting] + ' · ' + BattleRoster.list().length + '/50 battle-ready · 10 deployed max';
      updateQuickActions();
      if (pagerFocus) {
        const controls = [...pager.querySelectorAll('button,select')];
        (controls.find(control => control.getAttribute('aria-label') === pagerFocus && !control.disabled) || pager.querySelector('select') || search)?.focus({ preventScroll: true });
      }
      resize();
    }
    function paint(now) {
      for (const card of cards) {
        if (card.hidden) continue;
        const hero = heroOf(card), canvas = card.querySelector('[data-hero]'), context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        const density = Number(canvas.dataset.portraitDensity) || 1;
        PlayerModels.drawPortrait(context, hero, canvas.width / 2, canvas.height - 13 * density, 4.0 * density, now);
        const value = card.querySelector('.hero-energy b'); if (value) value.textContent = Math.floor(hero.en) + ' / ' + Math.floor(hero.st * 50);
        const fill = card.querySelector('.hero-energy .bar i'); if (fill) fill.style.width = Math.min(100, hero.en / (hero.st * 50) * 100) + '%';
        if (!card.classList.contains('hero-reserve')) card.querySelector('.hero-status').textContent = hero.on ? 'DEPLOYED' : 'RESTING';
      }
      updateQuickActions();
      if (detail.open) { refreshDetail(); paintDetail(now); }
    }
    function updateQuickActions() {
      const ready = new Set(BattleRoster.list()), deployed = S.h.filter(hero => hero.on).length;
      for (const card of cards) {
        if (card.hidden) continue;
        const hero = heroOf(card), action = card.querySelector('.hero-deploy-action');
        if (!hero || !action) continue;
        action.textContent = hero.on ? 'Rest hero' : ready.has(hero) ? 'Deploy hero' : 'Reserve';
        action.disabled = !hero.on && (!ready.has(hero) || hero.en < 1 || deployed >= 10);
        action.title = hero.on ? 'Rest this hero to recover chakra' : !ready.has(hero) ? 'Move to Battle-ready before deploying' : hero.en < 1 ? 'This hero needs chakra' : deployed >= 10 ? 'All 10 deployment slots are occupied' : 'Deploy this hero';
      }
      const heading = section.querySelector('.roster-heading > p');
      if (heading) heading.textContent = deployed + ' / 10 deployed · ' + S.h.length + ' shinobi';
    }
    function openDetail(id, origin) {
      detailId = id; detailOrigin = origin; detailSignature = ''; refreshDetail(true);
      if (detailId === null) return;
      if (!detail.open) detail.showModal(); paintDetail(performance.now()); detail.querySelector('.hero-detail-close').focus();
    }
    function refreshDetail(force = false) {
      const hero = S.h.find(hero => hero.id === detailId), card = cards.find(card => heroOf(card)?.id === detailId);
      if (!hero || !card) { if (detail.open) detail.close(); detailId = null; return; }
      const ready = BattleRoster.eligible(hero), deployed = S.h.filter(hero => hero.on).length;
      const signature = [hero.id, hero.r, hero.lv, hero.on, ready, hero.en < 1, deployed, hero.pw, hero.sp, hero.st, S.ryo].join(':');
      detail.style.setProperty('--tier-color', rankColors[hero.r]); detail.style.setProperty('--hero-backdrop', backdrop); detail.dataset.rank = hero.r;
      detail.querySelector('.hero-detail-status').textContent = hero.on ? 'DEPLOYED' : ready ? 'BATTLE-READY · RESTING' : 'RESERVE';
      detail.querySelector('.hero-detail-chakra b').textContent = Math.floor(hero.en) + ' / ' + Math.floor(hero.st * 50);
      detail.querySelector('.hero-detail-chakra i').style.width = Math.max(0, Math.min(100, hero.en / (hero.st * 50) * 100)) + '%';
      if (!force && signature === detailSignature) return; detailSignature = signature;
      detail.querySelector('.hero-detail-kicker').textContent = badgeNames[hero.r] + ' · ' + PlayerModels.modelFor(hero).label;
      detail.querySelector('.hero-detail-title').textContent = hero.name;
      detail.querySelector('.hero-detail-copy').textContent = 'Level ' + hero.lv + ' · ' + Number(GameBalance.damage(hero)).toLocaleString(undefined, {maximumFractionDigits: 2}) + ' damage / hit · ' + hero.bm + ' projectiles · ' + hero.rg + ' range';
      const stats = detail.querySelector('.hero-detail-stats'); stats.replaceChildren();
      for (const [label, value] of [['Power', hero.pw.toFixed(1)], ['Speed', hero.sp.toFixed(1)], ['Stamina', hero.st.toFixed(1)], ['Volley', hero.bm], ['Range', hero.rg], ['Level', hero.lv + '/10']]) { const block = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; block.append(dt, dd); stats.append(block); }
      const perks = detail.querySelector('.hero-detail-perks'); perks.replaceChildren();
      const title = document.createElement('h3'); title.textContent = 'Jutsu · ' + hero.pk.length; perks.append(title);
      for (const key of hero.pk) { const p = document.createElement('p'), b = document.createElement('b'), span = document.createElement('span'); b.textContent = PK[key][0]; span.textContent = PK[key][1]; p.append(b, span); perks.append(p); }
      if (!hero.pk.length) { const p = document.createElement('p'); p.textContent = 'Fuse reserve heroes to unlock higher ranks and more jutsu.'; perks.append(p); }
      const actions = detail.querySelector('.hero-detail-actions'), focusedClass = detail.contains(document.activeElement) ? document.activeElement.className : ''; actions.replaceChildren();
      for (const [selector, className] of [['.hero-deploy-action', 'hero-detail-deploy'], ['.hero-train-action', 'hero-detail-train'], ['.hero-mode-button', 'hero-detail-reserve'], ['.list-hero-button', 'hero-detail-sell']]) {
        const original = card.querySelector(selector); if (!original) continue;
        const button = document.createElement('button'); button.type = 'button'; button.className = className; button.textContent = original.textContent; button.disabled = original.disabled; button.title = original.title;
        button.onclick = () => { if (original.disabled) return; if (className === 'hero-detail-train' || className === 'hero-detail-sell') detail.close(); original.click(); if (detail.open) refreshDetail(true); };
        actions.append(button);
      }
      if (focusedClass) [...actions.children].find(button => button.className === focusedClass && !button.disabled)?.focus({ preventScroll: true });
    }
    function paintDetail(now) {
      const hero = S.h.find(hero => hero.id === detailId); if (!hero) return;
      const canvas = detail.querySelector('canvas'), density = Math.min(2, Math.max(1, devicePixelRatio || 1));
      const width = Math.round(360 * density), height = Math.round(390 * density);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const context = canvas.getContext('2d'); context.clearRect(0, 0, width, height);
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      PlayerModels.drawPortrait(context, hero, width / 2, height - 30 * density, 6.2 * density, now);
    }
    function resize() {
      const scale = Math.min(1, innerWidth / 1774);
      scene.style.setProperty('--heroes-scale', scale); scene.style.height = contentHeight + 'px';
      stage.style.height = Math.ceil(contentHeight * scale) + 'px';
      scene.style.left = Math.round((innerWidth - 1774 * scale) / 2) + 'px'; scene.style.top = '0px';
    }
    function sync() {
      const active = tab === 1 && !LoginScreen.active && !GameLoading.active;
      document.body.classList.toggle('exact-heroes-active', active); screen.hidden = !active; screen.inert = !active;
      if (active) { scene.append(section, bar); resize(); } else { if (detail.open) detail.close(); if (section.parentNode === scene) sectionHome.after(section); if (bar.parentNode === scene) barHome.after(bar); }
    }
    const oldTeam = team; team = function (...args) { const result = oldTeam(...args); decorate(); return result; };
    const oldGo = go; go = function (...args) { const result = oldGo(...args); sync(); return result; };
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', resize); GameLoading.ready.then(sync);
    let last = 0; function animate(now) { requestAnimationFrame(animate); if (tab !== 1 || document.hidden || now - last < 180) return; last = now; paint(now); }
    requestAnimationFrame(animate); api.loaded = true; api.refresh = () => team(); api.openDetail = id => openDetail(id, null); sync(); if (tab === 1) team();
    return true;
  }
  function crop(image, [x, y, width, height]) { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, width, height); return 'url("' + canvas.toDataURL('image/png') + '")'; }
})();
