/* Supplied roster art, actual deployed heroes, and the same model/aura renderer as the other menus. */
(() => {
  const sprites = ShinobiSprites, previousReady = sprites.ready;
  const root = new URL('.', document.currentScript.src);
  const image = new Image();
  const imageReady = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The original Adventure roster design could not be loaded.'));
    image.src = new URL('source.png', root).href;
  });
  const api = window.RosterDesign = { loaded: false, ready: null, refresh: () => {} };
  api.ready = sprites.ready = Promise.all([previousReady, imageReady]).then(() => {
    if (image.naturalWidth !== 2170 || image.naturalHeight !== 725) throw new Error('Adventure roster source dimensions changed.');
    setup(); api.loaded = true; return true;
  });
  api.ready.catch(error => console.error('Adventure roster design could not be applied:', error));

  function setup() {
    const scene = document.getElementById('exactAdventureScene');
    const strip = document.getElementById('strip');
    if (!scene || !strip) throw new Error('The live Adventure scene is unavailable.');
    if (scene.classList.contains('roster-design-active')) return;
    scene.classList.add('roster-design-active');
    const band = document.createElement('div'); band.className = 'roster-design-band'; band.setAttribute('aria-hidden', 'true');
    const background = document.createElement('img'); background.src = image.src; background.alt = ''; background.draggable = false; band.append(background); scene.append(band);
    const cardRects = [
      [35,148,414,190], [472,148,408,190], [902,148,392,190], [1316,148,399,190], [1737,148,400,190],
      [35,365,414,196], [472,365,408,196], [902,365,392,196], [1316,365,399,196], [1737,365,400,196]
    ];
    // Choose original card art by the shared base-model index, not by hero name.
    const modelTemplates = [8,7,4,0,5,6,1,3];
    const frameUrls = cardRects.map(([x,y,w,h]) => {
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const context=canvas.getContext('2d');context.drawImage(image,x,y,w,h,0,0,w,h);
      // Retain the original ornamental border and class emblem. One complete
      // interior replaces the printed sample, rather than patches behind text.
      const fill=context.createLinearGradient(0,0,w,h);fill.addColorStop(0,'#10283a');fill.addColorStop(.55,'#071823');fill.addColorStop(1,'#101329');
      context.fillStyle=fill;context.fillRect(9,9,w-18,h-18);
      context.drawImage(image,x+w-62,y+10,48,45,w-62,10,48,45);
      return canvas.toDataURL();
    });
    const infoLeft = [176,166,162,156,162,176,166,162,162,162];
    const iconUrls = cardRects.map(([x,y,w,h],i) => {const cv=document.createElement('canvas');cv.width=22;cv.height=24;cv.getContext('2d').drawImage(image,x+infoLeft[i]+2,y+(i<5?76:81),22,24,0,0,22,24);return cv.toDataURL();});
    const colors = ['#ff534a','#d45cff','#25ccff','#39ffbb','#65ddff','#52fa74','#ffd34f','#c463ff'];
    const factor = 1672 / 2170, top = 697, height = 1060;
    function resize() {
      const scale = Math.min(innerWidth / 1672, innerHeight / height);
      scene.style.setProperty('--adventure-scale', scale);
      scene.style.left = Math.round((innerWidth - 1672 * scale)/2) + 'px';
      scene.style.top = Math.round((innerHeight - height * scale)/2) + 'px';
    }
    const painted=new WeakMap();
    function portrait(canvas, hero) {
      const density = Math.min(2, Math.max(1, devicePixelRatio || 1));
      const width = Math.round(156 * density), height = Math.round(178 * density);
      const now=performance.now(),key=[hero?.id,hero?.r,hero?.z,sprites.idleName(now,hero?.id||0),width,height].join(':');
      if(painted.get(canvas)===key)return;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      canvas.setAttribute('data-exact-roster', '');
      const context = canvas.getContext('2d');
      context.setTransform(density,0,0,density,0,0);
      context.clearRect(0,0,156,178);
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      if(hero){if(PlayerModels.drawPortrait)PlayerModels.drawPortrait(context,hero,78,155,3.85,now);else sprites.blit(context,PlayerModels.portraitFrame(hero,now),78,155,3.85,false)}
      painted.set(canvas,key);
    }
    function refresh() {
      if (tab !== 0) return;
      const real = [...strip.children].filter(card => card.matches('.map-hero')).slice(0,10);
      const needed = 10 - real.length;
      const empty = [...strip.children].filter(card => card.matches('.roster-design-empty'));
      // The older layout recreates empty placeholders on each HUD tick. Adopt
      // them once and retain their identities so keyboard/pointer focus is stable.
      for (const card of [...strip.querySelectorAll('.exact-adventure-empty-slot')]) {
        if (empty.length < needed) { card.classList.remove('exact-adventure-empty-slot'); card.classList.add('roster-design-empty'); empty.push(card); }
        else card.remove();
      }
      empty.slice(needed).forEach(card => card.remove());
      const cards = [...real, ...empty.slice(0,needed)];
      cards.forEach((card,index) => {
        const hero = card.matches('.map-hero') ? S.h.find(h => h.id === Number(card.dataset.maphero)) : null;
        const model = hero ? Math.abs(Math.trunc(Number(hero.id)||0))%8 : index%8;
        const source = modelTemplates[model];
        const [x,y,w,h] = cardRects[index];
        card.classList.add('roster-design-card');
        card.dataset.adventureSlot = String(index+1);
        card.dataset.rosterModel = hero ? String(model) : 'empty';
        card.style.setProperty('--roster-x',x*factor+'px');
        card.style.setProperty('--roster-y',top+(y-123)*factor+'px');
        card.style.setProperty('--roster-width',w+'px'); card.style.setProperty('--roster-height',h+'px');
        card.style.setProperty('--roster-info-left',Math.round(infoLeft[source]*w/cardRects[source][2])+'px');
        card.style.setProperty('--roster-bar-top',(source<5?111:116)*h/cardRects[source][3]+'px');
        card.style.setProperty('--roster-rest-top',(h-52)+'px');
        card.style.setProperty('--roster-color',colors[model]);
        card.style.setProperty('--roster-frame',`url("${frameUrls[source]}")`);
        card.querySelector('.roster-portrait-mask')?.remove();
        let icon=card.querySelector('.roster-chakra-icon');if(!icon){icon=document.createElement('img');icon.className='roster-chakra-icon';icon.alt='';icon.setAttribute('aria-hidden','true');card.append(icon);}icon.src=iconUrls[source];
        let canvas = card.querySelector('canvas');
        if (!canvas) { canvas=document.createElement('canvas'); canvas.className='roster-design-empty-portrait'; card.prepend(canvas); }
        portrait(canvas,hero);
        if (!hero) {
          let name=card.querySelector('.roster-empty-name'), chakra=card.querySelector('.roster-empty-chakra'), bar=card.querySelector('.roster-empty-bar');
          if (!name) {name=document.createElement('b');name.className='roster-empty-name';card.append(name);}
          if (!chakra) {chakra=document.createElement('small');chakra.className='roster-empty-chakra';card.append(chakra);}
          if (!bar) {bar=document.createElement('div');bar.className='roster-empty-bar';card.append(bar);}
          name.textContent='Empty slot '+(index+1); chakra.textContent='Deploy a battle-ready hero';
          const plus=card.querySelector('.exact-adventure-slot-plus'); if (plus) plus.textContent='+';
        } else {
          const name=card.querySelector('b'); if(name){name.textContent=hero.name.split(' ')[0];name.title=hero.name;}
          const chakra=card.querySelector('small');if(chakra)chakra.textContent=Math.floor(hero.en)+' / '+Math.floor(hero.st*50)+' chakra';
          const bar=card.querySelector('.bar i');if(bar)bar.style.width=Math.max(0,Math.min(100,hero.en/(hero.st*50)*100))+'%';
        }
      });
      resize();
    }
    api.refresh=refresh;
    const previousHud=hud;hud=function(...args){const focused=strip.contains(document.activeElement)?document.activeElement:null;const result=previousHud(...args);refresh();if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});return result;};
    const previousGo=go;go=function(...args){const result=previousGo(...args);if(tab===0)refresh();return result;};
    const previousRefresh=AdventureDesign.refresh;
    AdventureDesign.refresh=function(...args){const result=previousRefresh?.(...args);refresh();return result;};
    addEventListener('resize',resize);
    addEventListener('shinobi-ryo-ledger',refresh);
    new MutationObserver(()=>{if(tab===0)refresh();}).observe(document.body,{attributes:true,attributeFilter:['class']});
    refresh();
  }
})();
