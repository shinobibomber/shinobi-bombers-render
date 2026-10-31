/* Original Heroes frame, existing collection/actions, and the shared player/aura renderer. */
(() => {
  const previousReady = ShinobiSprites.ready, base = new URL('.', document.currentScript.src);
  const image = new Image(1774, 887), aura = new Image();
  const sourceReady = Promise.all([[image, new URL('heroes-menu.png', base)], [aura, new URL('../tier-auras/auras.png', base)]].map(([image, url]) => new Promise((resolve, reject) => {
    image.onload = resolve; image.onerror = () => reject(Error('Original Heroes artwork could not be loaded.')); image.src = url.href;
  })));
  const api = window.HeroesDesign = { loaded: false, ready: null };
  api.ready = ShinobiSprites.ready = Promise.all([previousReady, sourceReady]).then(setup);
  api.ready.catch(error => console.error('Heroes design could not be applied:', error));

  function setup() {
    if (image.naturalWidth !== 1774 || image.naturalHeight !== 887) throw Error('Heroes reference dimensions do not match.');
    const section = document.getElementById('p1'), bar = document.querySelector('.menu-topbar');
    const sectionHome = document.createComment('Heroes page'), barHome = document.createComment('Heroes shared toolbar');
    section.before(sectionHome); bar.before(barHome);
    const screen = document.createElement('section'); screen.id = 'exactHeroesScreen'; screen.hidden = true; screen.setAttribute('aria-label', 'Heroes collection');
    const scene = document.createElement('div'); scene.id = 'exactHeroesScene'; screen.append(scene);
    image.className = 'heroes-reference-art'; image.alt = ''; image.setAttribute('aria-hidden', 'true'); image.draggable = false; scene.append(image); document.body.append(screen);
    const wallet = document.createElement('button'); wallet.type = 'button'; wallet.className = 'heroes-wallet-target'; wallet.setAttribute('aria-label', 'Open Ryo wallet'); wallet.onclick = () => ShinobiBetaUI.open(); scene.append(wallet);

    const sourceCards = [[30, 311, 334, 570], [381, 311, 330, 570], [725, 311, 330, 570], [1068, 311, 330, 570], [1409, 311, 334, 570]];
    const cardArt = sourceCards.map(box => crop(image, box));
    const backdrop = crop(image, [478, 8, 325, 187]);
    const icons = [[54, 616, 28, 28], [159, 616, 28, 28], [264, 616, 28, 28], [54, 656, 28, 28], [159, 656, 28, 28], [264, 656, 28, 28]].map(box => crop(image, box));
    const tierIcons = [[27, 46, 56, 53], [335, 45, 55, 53], [640, 45, 55, 53], [946, 45, 55, 53], [1232, 43, 61, 54]].map(box => crop(aura, box));
    let query = '', sorting = 'rarity', page = 0, rank = '', cards = [], search, select, pager, status;

    function decorate() {
      const grid = section.querySelector('.hero-grid'); if (!grid) return;
      const currentRank = section.querySelector('.hero-filters .active')?.getAttribute('onclick') || '';
      if (rank !== currentRank) { rank = currentRank; page = 0; }
      cards = [...grid.querySelectorAll('.hero-sheet')];
      for (const card of cards) {
        const canvas = card.querySelector('[data-hero]'), hero = S.h[canvas.dataset.hero];
        card.dataset.rankMatch = card.hidden ? '0' : '1';
        card.classList.add('reference-hero-card'); card.style.setProperty('--tier-color', TierAuras.tiers[hero.r].color);
        card.style.setProperty('--hero-backdrop', backdrop);
        canvas.width = 640; canvas.height = 384; canvas.setAttribute('data-exact-hero', '');
        canvas.setAttribute('aria-label', PlayerModels.modelFor(hero).label + ' · ' + R[hero.r][0]);
        const badge = card.querySelector('.hero-portrait > span'); badge.style.setProperty('--tier-icon', tierIcons[hero.r]);
        const state = card.querySelector('.hero-status');
        if (card.classList.contains('hero-reserve')) {
          state.title = state.textContent; state.setAttribute('aria-label', state.textContent);
          state.textContent = hero.tokenId ? 'RESERVE' : 'PRACTICE';
        }
        const styleLine = card.querySelector('.hero-identity > p');
        const styleText = styleLine?.childNodes[0]?.textContent.trim() || R[hero.r][0] + ' style';
        if (styleLine) { styleLine.replaceChildren(); for (const text of ['Lv. ' + hero.lv, styleText, ['Shuriken', 'Twin shuriken', 'Fire shuriken', 'Lightning blade', 'Rasengan / Chidori'][hero.r]]) { const span = document.createElement('span'); span.textContent = text; styleLine.append(span); } }
        const damage = document.createElement('p'); damage.className = 'heroes-live-damage'; damage.textContent = GameBalance.damage(hero) + ' damage / hit · ' + hero.bm + ' projectiles · ' + hero.rg + ' range'; card.append(damage);
        card.querySelectorAll('.hero-stats > div').forEach((stat, i) => stat.style.setProperty('--stat-icon', icons[i]));
        const actions = card.querySelector('.hero-actions');
        const buttons = [...actions.children];
        buttons[0]?.classList.add('hero-deploy-action'); buttons[1]?.classList.add('hero-train-action');
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
    }
    function heroOf(card) { return S.h[card.querySelector('[data-hero]').dataset.hero]; }
    function layout() {
      const matches = cards.filter(card => card.dataset.rankMatch === '1' && heroOf(card).name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
      matches.sort((a, b) => {
        const x = heroOf(a), y = heroOf(b);
        return sorting === 'name' ? x.name.localeCompare(y.name) : (sorting === 'level' ? y.lv - x.lv : sorting === 'power' ? y.pw - x.pw : sorting === 'chakra' ? y.en - x.en : y.r - x.r) || x.id - y.id;
      });
      const pages = Math.max(1, Math.ceil(matches.length / 5)); page = Math.min(page, pages - 1);
      for (const card of cards) card.hidden = true;
      section.querySelectorAll('.heroes-empty-card').forEach(card => card.remove());
      for (let slot = 0; slot < 5; slot++) {
        const card = matches[page * 5 + slot]; const box = sourceCards[slot];
        const item = card || document.createElement('article');
        if (!card) { item.className = 'heroes-empty-card'; const text = document.createElement('p'); text.textContent = matches.length ? 'No hero in this slot' : 'No heroes match this selection'; item.append(text); section.append(item); }
        item.hidden = false;
        if (card) section.querySelector('.hero-grid').append(card);
        Object.assign(item.style, { left: box[0] + 'px', top: box[1] + 'px', width: box[2] + 'px', height: box[3] + 'px' });
        item.style.setProperty('--card-source', cardArt[slot]);
      }
      pager.replaceChildren(); pager.hidden = pages === 1;
      for (const [label, action, disabled] of [['Previous page', () => { page--; layout(); }, page === 0], ['Next page', () => { page++; layout(); }, page === pages - 1]]) { const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-label', label); button.textContent = label.startsWith('Previous') ? '‹' : '›'; button.disabled = disabled; button.onclick = action; pager.append(button); }
      const count = document.createElement('span'); count.textContent = (page + 1) + ' / ' + pages; pager.firstChild.after(count);
      status.textContent = matches.length + ' heroes · ' + ({ rarity: 'Rarest first', level: 'Highest level first', power: 'Strongest first', chakra: 'Most chakra first', name: 'Name A–Z' })[sorting] + ' · ' + BattleRoster.list().length + '/50 battle-ready · 10 deployed max';
    }
    function paint(now) {
      for (const card of cards) {
        if (card.hidden) continue;
        const hero = heroOf(card), canvas = card.querySelector('[data-hero]'), context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        ShinobiSprites.blit(context, ShinobiSprites.heroFrame(hero, hero.z ? 's0' : ShinobiSprites.idleName(now, hero.id)), canvas.width / 2, canvas.height - 45, 7.1, false);
        const value = card.querySelector('.hero-energy b'); if (value) value.textContent = Math.floor(hero.en) + ' / ' + Math.floor(hero.st * 50);
        const fill = card.querySelector('.hero-energy .bar i'); if (fill) fill.style.width = Math.min(100, hero.en / (hero.st * 50) * 100) + '%';
        if (!card.classList.contains('hero-reserve')) card.querySelector('.hero-status').textContent = hero.on ? 'DEPLOYED' : 'RESTING';
      }
    }
    function resize() { const scale = Math.min(innerWidth / 1774, innerHeight / 887); scene.style.setProperty('--heroes-scale', scale); scene.style.left = Math.round((innerWidth - 1774 * scale) / 2) + 'px'; scene.style.top = Math.round((innerHeight - 887 * scale) / 2) + 'px'; }
    function sync() {
      const active = tab === 1 && !LoginScreen.active && !GameLoading.active;
      document.body.classList.toggle('exact-heroes-active', active); screen.hidden = !active; screen.inert = !active;
      if (active) { scene.append(section, bar); resize(); } else { if (section.parentNode === scene) sectionHome.after(section); if (bar.parentNode === scene) barHome.after(bar); }
    }
    const oldTeam = team; team = function (...args) { const result = oldTeam(...args); decorate(); return result; };
    const oldGo = go; go = function (...args) { const result = oldGo(...args); sync(); return result; };
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', resize); GameLoading.ready.then(sync);
    let last = 0; function animate(now) { requestAnimationFrame(animate); if (tab !== 1 || document.hidden || now - last < 180) return; last = now; paint(now); }
    requestAnimationFrame(animate); api.loaded = true; api.refresh = () => team(); sync(); if (tab === 1) team();
    return true;
  }
  function crop(image, [x, y, width, height]) { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, width, height); return 'url("' + canvas.toDataURL('image/png') + '")'; }
})();
