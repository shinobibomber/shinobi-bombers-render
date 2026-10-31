/* Supplied reveal composition; original reveal/save/continue handlers remain authoritative. */
(() => {
  const sprites = ShinobiSprites, previousReady = sprites.ready;
  const root = new URL('.', document.currentScript.src);
  const image = new Image();
  const slots = [79, 255, 434, 612, 791, 970, 1148, 1326, 1506, 1684];
  const sourceWidths = [165, 167, 166, 168, 168, 167, 166, 167];
  const stars = [[655, 523, 82, 32], [300, 523, 80, 32], [467, 523, 100, 32], [112, 523, 100, 32], [810, 523, 128, 32]];
  const ranks = [[626, 558, 138, 44], [268, 558, 138, 44], [447, 558, 138, 44], [93, 558, 138, 44], [805, 558, 138, 44]];
  const api = window.RevealDesign = { loaded: false, ready: null, refresh, paint };
  let dialog, resize;
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The original reveal design could not be loaded.'));
    image.src = new URL('reveal-design.png', root).href;
  });
  api.ready = sprites.ready = Promise.all([previousReady, loaded]).then(() => {
    if (image.naturalWidth !== 1926 || image.naturalHeight !== 817) throw new Error('The reveal design has unexpected dimensions.');
    dialog = document.getElementById('summonReveal');
    dialog.classList.add('exact-reveal');
    api.loaded = true;
    addEventListener('resize', () => resize?.());
    refresh();
    return true;
  });
  api.ready.catch(error => console.error('Reveal design could not be applied:', error));

  function batch() { return S.v2.revealBatch || []; }
  function refresh() {
    if (!api.loaded || !batch().length || !dialog.querySelector('.reveal-grid')) return;
    let scene = dialog.querySelector('.exact-reveal-scene');
    if (!scene) {
      const content = [...dialog.childNodes];
      scene = document.createElement('div'); scene.className = 'exact-reveal-scene';
      const art = document.createElement('canvas'); art.className = 'exact-reveal-backdrop'; art.width = 1926; art.height = 817; art.setAttribute('aria-hidden', 'true');
      const context = art.getContext('2d'); context.drawImage(image, 0, 0);
      // The example already contains ten heroes and NEW badges. This area is
      // live: cover those sample records even when the real batch has one card.
      context.drawImage(image, 69, 618, 1787, 25, 69, 224, 1787, 395);
      scene.append(art, ...content); dialog.append(scene);
    }
    scene.classList.toggle('exact-reveal-other-source', S.v2.revealSource !== 'summon');
    const grid = scene.querySelector('.reveal-grid');
    grid.setAttribute('aria-label', 'Shinobi reveal cards');
    grid.tabIndex = 0;
    const cards = [...grid.querySelectorAll('[data-reveal]')];
    cards.forEach((card, index) => {
      const slot = index % 10, page = Math.floor(index / 10);
      card.style.setProperty('--exact-card-x', slots[slot] - 79 + page * 1774 + 'px');
      card.style.setProperty('--exact-card-y', '24px');
      paint(index);
    });
    let spacer = grid.querySelector('.exact-reveal-scroll-width');
    if (!spacer) { spacer = document.createElement('span'); spacer.className = 'exact-reveal-scroll-width'; spacer.setAttribute('aria-hidden', 'true'); grid.append(spacer); }
    const final = Math.max(0, cards.length - 1);
    spacer.style.width = slots[final % 10] - 79 + Math.floor(final / 10) * 1774 + 167 + 'px';
    const header = scene.querySelector('.reveal-header');
    header.querySelector('.eyebrow').setAttribute('aria-hidden', 'true');
    resize = () => {
      const scale = Math.min(innerWidth / 1926, innerHeight / 817);
      scene.style.setProperty('--exact-reveal-scale', scale);
      scene.style.left = Math.round((innerWidth - 1926 * scale) / 2) + 'px';
      scene.style.top = Math.round((innerHeight - 817 * scale) / 2) + 'px';
    };
    resize();
  }

  function paint(index) {
    if (!api.loaded) return;
    const item = batch()[index];
    const card = dialog.querySelector('[data-reveal="' + index + '"]');
    if (!item || !card) return;
    let canvas = card.querySelector(':scope > .exact-reveal-card-art');
    if (!canvas) {
      canvas = document.createElement('canvas'); canvas.className = 'exact-reveal-card-art'; canvas.width = 166; canvas.height = 359; canvas.setAttribute('aria-hidden', 'true'); card.append(canvas);
    }
    const context = canvas.getContext('2d'), hero = item.hero, model = PlayerModels.modelFor(hero).index;
    const rank = Math.max(0, Math.min(4, Number(hero.r) || 0));
    context.clearRect(0, 0, 166, 359);
    context.drawImage(image, slots[model], 249, sourceWidths[model], 359, 0, 0, 166, 359);
    if (!item.revealed) {
      // Source contains no sealed card example; retain its exact ornamental
      // frame while keeping unrevealed player art and data completely hidden.
      context.fillStyle = '#06101d'; context.fillRect(5, 5, 156, 348);
      context.strokeStyle = '#9a7545'; context.lineWidth = 2; context.strokeRect(13, 15, 140, 326);
      context.fillStyle = '#e5bf73'; context.font = '54px serif'; context.textAlign = 'center'; context.fillText('忍', 83, 170);
      context.font = '700 12px Arial'; context.fillText(S.v2.revealSource === 'fusion' ? 'FUSION SCROLL' : S.v2.revealSource === 'prison' ? 'RESCUED SHINOBI' : 'SHINOBI SCROLL', 83, 223);
      context.font = '12px Arial'; context.fillStyle = '#d0bda3'; context.fillText('Tap to reveal', 83, 252);
    } else {
      // Replace the baked illustrated portrait with the shared player model and
      // its actual tier aura. Every other frame detail comes from the original.
      context.drawImage(image, 795, 80, 166, 162, 5, 5, 156, 232);
      context.save(); context.beginPath(); context.rect(5, 5, 156, 234); context.clip();
      ShinobiSprites.blit(context, ShinobiSprites.heroFrame(hero, 'i0'), 83, 224, 4.7, false);
      context.restore();
      // The class emblem/name are copied from this actual model's source card.
      context.save(); context.beginPath(); context.arc(83, 225, 26, 0, Math.PI * 2); context.clip();
      context.drawImage(image, slots[model] + 57, 448, 52, 52, 57, 199, 52, 52);
      context.restore();
      context.fillStyle = '#050d17'; context.fillRect(7, 269, 152, 82);
      const star = stars[rank]; context.drawImage(image, ...star, (166 - star[2]) / 2, 274, star[2], star[3]);
      const badge = ranks[rank]; context.drawImage(image, ...badge, 14, 309, 138, 44);
    }
    card.title = item.revealed ? R[rank][0] + ' · ' + hero.name + ' · ' + PlayerModels.catalog[model].label : 'Reveal card ' + (index + 1);
    let fresh = card.querySelector(':scope > .exact-reveal-new');
    const isNew = item.revealed && (item.isNew === true || hero.isNew === true);
    if (isNew && !fresh) { fresh = document.createElement('span'); fresh.className = 'exact-reveal-new'; fresh.textContent = 'NEW!'; card.append(fresh); }
    if (!isNew && fresh) fresh.remove();
  }
})();
