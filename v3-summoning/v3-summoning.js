/* Semantic V3 Shrine and reveal enhancements. Existing purchase/reveal services own all state. */
(() => {
  'use strict';
  const api = window.V3Summoning = { loaded: false, ready: null, refresh: () => {} };
  const previousReady = ShinobiSprites.ready;
  let activeQuantity = 1;
  api.ready = ShinobiSprites.ready = previousReady.then(setup);
  api.ready.catch(error => console.error('V3 summoning interface could not load:', error));
  function setup() {
    const scene = document.getElementById('exactShrineScene'), section = document.getElementById('p2');
    if (!scene || !section || !window.RevealDesign) throw Error('The existing Shrine/reveal services are unavailable.');
    scene.classList.add('v3-summoning-scene');
    const oldQuantity = Combat.quantity;
    Combat.quantity = function (quantity) { if ([1, 5, 10, 15].includes(quantity)) activeQuantity = quantity; return oldQuantity(quantity); };
    function history() {
      if (window.V3Chest?.openHistory) return V3Chest.openHistory();
      if (window.V3Chest?.open) { V3Chest.open(); return; }
      const button = document.querySelector('#adventureChest [data-history]');
      if (button) button.click(); else AdventureChest.open();
    }
    function renderShrine() {
      const quantities = section.querySelector('.summon-quantities'), price = section.querySelector('.summon-price'), summonAction = section.querySelector('.summon-main'), rates = section.querySelector('.shrine-controls>table');
      if (!quantities || !price || !summonAction || !rates) return;
      const selected = [...quantities.querySelectorAll('button')].find(button => button.classList.contains('selected'));
      const parsedQuantity = Number(selected?.textContent.replace(/\D/g, ''));
      if ([1, 5, 10, 15].includes(parsedQuantity)) activeQuantity = parsedQuantity;
      // Preserve these actual controls and their original event handlers. They
      // still invoke Combat.quantity and the one TokenCheckout purchase path.
      const header = document.createElement('header'); header.className = 'v3-summoning-heading';
      header.innerHTML = '<p>THE SCROLLS HAVE ANSWERED</p><h1>Summoning Shrine</h1><span>Summon shinobi. Build your team. Forge your ninja way.</span>';
      const layout = document.createElement('div'); layout.className = 'v3-summoning-layout';
      const sidebar = document.createElement('nav'); sidebar.className = 'v3-summoning-sidebar'; sidebar.setAttribute('aria-label', 'Summoning Shrine sections');
      for (const [label, action, current] of [
        ['Summoning Shrine', () => section.querySelector('.v3-summoning-purchase')?.scrollIntoView({ block: 'nearest', behavior: 'auto' }), true],
        ['Hero Gallery', () => go(1), false],
        ['Rarity Rates', () => { section.querySelector('#v3SummonRates')?.scrollIntoView({ block: 'nearest', behavior: 'auto' }); section.querySelector('#v3SummonRates')?.focus({ preventScroll: true }); }, false],
        ['Summon History', history, false]
      ]) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.onclick = action; if (current) button.setAttribute('aria-current', 'page'); sidebar.append(button); }
      const note = document.createElement('p'); note.className = 'v3-summoning-sidebar-note'; note.textContent = 'Each summon is independent. All five ranks use the published rarity rates.'; sidebar.append(note);
      const center = document.createElement('div'); center.className = 'v3-summoning-center';
      const showcase = document.createElement('div'); showcase.className = 'v3-summoning-showcase'; showcase.setAttribute('aria-hidden', 'true');
      showcase.innerHTML = '<div class="v3-shrine-moon"></div><div class="v3-shrine-torii"><i></i><i></i></div><div class="v3-shrine-sigil"></div><div class="v3-shrine-scroll"><span>忍</span><b></b></div><span class="v3-shrine-spark one"></span><span class="v3-shrine-spark two"></span><span class="v3-shrine-spark three"></span>';
      const packages = document.createElement('div'); packages.className = 'v3-summoning-packages';
      for (const quantity of [1, 5, 10, 15]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'v3-summon-package'; button.setAttribute('aria-pressed', String(quantity === activeQuantity));
        const title = document.createElement('b'); title.textContent = quantity === 1 ? 'Single summon' : quantity + '× summon';
        const icon = document.createElement('span'); icon.className = 'v3-package-scroll'; icon.textContent = '忍'; icon.setAttribute('aria-hidden', 'true');
        const total = document.createElement('strong'); total.textContent = (quantity * GameBalance.summonCost).toLocaleString() + ' Ryo';
        const copy = document.createElement('small'); copy.textContent = quantity + ' hero' + (quantity === 1 ? '' : 'es') + ' · base price';
        button.append(title, icon, total, copy); button.onclick = () => Combat.quantity(quantity); packages.append(button);
      }
      const models = document.createElement('section'); models.className = 'v3-summoning-models'; models.setAttribute('aria-label', 'Shared Shinobi player models');
      const modelHeading = document.createElement('h2'); modelHeading.textContent = 'Your next shinobi';
      const modelCopy = document.createElement('p'); modelCopy.textContent = 'The shared hero models keep their elemental identity. Rarity determines the silver, green, blue, purple or gold aura.';
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 190; canvas.setAttribute('aria-label', 'Approved shared hero model previews');
      const viewCollection = document.createElement('button'); viewCollection.type = 'button'; viewCollection.textContent = 'View collection →'; viewCollection.onclick = () => go(1); models.append(modelHeading, modelCopy, canvas, viewCollection);
      center.append(showcase, packages, models);
      const purchase = document.createElement('aside'); purchase.className = 'v3-summoning-purchase';
      const buyTitle = document.createElement('h2'); buyTitle.textContent = 'Summon heroes'; const buyCopy = document.createElement('p'); buyCopy.textContent = 'Choose how many scrolls to summon.';
      const fee = document.createElement('small'); fee.className = 'v3-summon-fee'; fee.textContent = 'A 2% studio fee is added at checkout. Review the exact total before paying.';
      const ratesTitle = document.createElement('h3'); ratesTitle.id = 'v3SummonRates'; ratesTitle.tabIndex = -1; ratesTitle.textContent = 'Rarity rates';
      const chanceNote = document.createElement('p'); chanceNote.className = 'v3-rates-note'; chanceNote.textContent = 'No limited-time boosts, discounts or guaranteed rarity apply.';
      const collection = document.createElement('p'); collection.className = 'v3-summon-collection'; collection.textContent = 'Heroes in your collection: ' + S.h.length.toLocaleString();
      purchase.append(buyTitle, buyCopy, quantities, price, summonAction, fee, ratesTitle, rates, chanceNote, collection);
      layout.append(sidebar, center, purchase); section.replaceChildren(header, layout);
      paintModels(canvas);
      // hud() keeps the original action's affordability/authentication state.
      hud();
    }
    function paintModels(canvas) {
      const context = canvas.getContext('2d'); context.clearRect(0, 0, canvas.width, canvas.height); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      for (let index = 0; index < 6; index++) {
        const hero = { id: index, r: 0, lv: 1 };
        PlayerModels.drawPortrait(context, hero, 80 + index * 160, 182, 3.3, 0);
      }
    }
    const oldSumm = summ; summ = function (...args) { const value = oldSumm(...args); renderShrine(); return value; };

    const dialog = document.getElementById('summonReveal');
    function refreshReveal() {
      const batch = S.v2.revealBatch || [];
      if (!dialog.open || !batch.length) return;
      dialog.classList.add('v3-scroll-reveal');
      const scene = dialog.querySelector('.exact-reveal-scene'); if (!scene) return;
      const source = S.v2.revealSource, complete = batch.every(item => item.revealed);
      let summary = scene.querySelector('.v3-reveal-summary');
      if (!summary) { summary = document.createElement('div'); summary.className = 'v3-reveal-summary'; summary.setAttribute('aria-label', 'Revealed rarity summary'); scene.querySelector('.reveal-grid').after(summary); }
      const revealed = batch.filter(item => item.revealed);
      summary.replaceChildren();
      for (let rank = 4; rank >= 0; rank--) { const count = revealed.filter(item => item.hero.r === rank).length; const item = document.createElement('span'); item.style.setProperty('--summary-rank', R[rank][1]); item.textContent = R[rank][0] + ' ' + count; summary.append(item); }
      summary.hidden = !revealed.length;
      const header = scene.querySelector('.reveal-header');
      let one = header.querySelector('.v3-reveal-one');
      if (!one) { one = document.createElement('button'); one.type = 'button'; one.className = 'v3-reveal-one'; one.textContent = 'Reveal One'; one.onclick = () => { const index = (S.v2.revealBatch || []).findIndex(item => !item.revealed); if (index >= 0) Experience.reveal(index); }; header.append(one); }
      one.disabled = complete || document.getElementById('revealAll')?.disabled === true;
      let again = scene.querySelector('.v3-summon-again');
      if (!again) { again = document.createElement('button'); again.type = 'button'; again.className = 'v3-summon-again'; again.textContent = 'Summon Again'; again.title = 'Return to the Shrine to review another purchase'; again.onclick = () => { if (!(S.v2.revealBatch || []).every(item => item.revealed)) return; Experience.finishReveal(); if (!dialog.open && !(S.v2.revealBatch || []).length) { go(2); Combat.quantity(activeQuantity); } }; scene.querySelector('.reveal-footer').insertBefore(again, document.getElementById('revealContinue')); }
      again.hidden = source !== 'summon' || !complete; again.disabled = !complete;
      scene.dataset.v3Source = source;
    }
    const oldRefresh = RevealDesign.refresh; RevealDesign.refresh = function (...args) { const value = oldRefresh.apply(this, args); refreshReveal(); return value; };
    const oldReveal = Experience.reveal; Experience.reveal = async function (...args) { try { return await oldReveal.apply(this, args); } finally { refreshReveal(); } };
    const oldRevealAll = Experience.revealAll; Experience.revealAll = async function (...args) { try { return await oldRevealAll.apply(this, args); } finally { refreshReveal(); } };
    const oldGo = go; go = function (...args) { const value = oldGo(...args); if (tab === 2 && !section.querySelector('.v3-summoning-layout')) summ(); refreshReveal(); return value; };
    api.refresh = () => { if (tab === 2) summ(); refreshReveal(); }; api.loaded = true; if (tab === 2) summ(); refreshReveal(); return true;
  }
})();
