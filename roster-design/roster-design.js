/* Supplied Adventure Team artwork, real roster data and animated native portraits. */
(() => {
  const sprites=ShinobiSprites,previousReady=sprites.ready,root=new URL('.',document.currentScript.src),image=new Image();
  const imageReady=new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Adventure Team artwork could not load.'));image.src=new URL('source.webp',root).href;});
  const api=window.RosterDesign={loaded:false,ready:null,refresh:()=>{}};
  api.ready=sprites.ready=Promise.all([previousReady,imageReady]).then(()=>{if(image.naturalWidth!==2126||image.naturalHeight!==740)throw Error('Adventure Team source dimensions changed.');setup();api.loaded=true;return true;});
  api.ready.catch(error=>console.error('Adventure Team design could not be applied:',error));
  function setup(){
    const scene=document.getElementById('exactAdventureScene'),strip=document.getElementById('strip');if(!scene||!strip)throw Error('The Adventure scene is unavailable.');scene.classList.add('roster-design-active');
    const band=document.createElement('div');band.className='roster-design-band';band.setAttribute('aria-hidden','true');
    const panel=document.createElement('canvas');panel.width=1672;panel.height=363;const panelContext=panel.getContext('2d');panelContext.drawImage(image,20,120,2088,563,0,0,1672,363);
    // Replace the entire printed command group, including its baked View: 3D
    // button. Live controls occupy this one continuous clean toolbar surface.
    const toolbarFill=panelContext.createLinearGradient(790,14,1660,64);toolbarFill.addColorStop(0,'#060c19');toolbarFill.addColorStop(1,'#050b13');panelContext.fillStyle=toolbarFill;panelContext.fillRect(790,11,870,60);band.append(panel);scene.append(band);
    const count=document.createElement('p');count.id='adventureTeamCount';count.setAttribute('aria-live','off');scene.append(count);
    const mobileHeading=document.createElement('header');mobileHeading.className='adventure-mobile-team-heading';
    const mobileTitle=document.createElement('h2');mobileTitle.textContent='Adventure Team';
    const mobileCopy=document.createElement('p');mobileCopy.textContent='Deploy your shinobi and start bombing!';
    mobileHeading.append(mobileTitle,mobileCopy);scene.append(mobileHeading);
    const rects=[[40,238,412,205],[465,238,394,205],[873,238,380,205],[1266,238,399,205],[1677,238,411,205],[40,455,412,207],[465,455,394,207],[873,455,380,207],[1266,455,399,207],[1677,455,411,207]];
    const sx=1672/2088,sy=363/563,templates=[0,2,4,8,7,5,1,3],colors=['#ff4541','#cf45ff','#25caff','#ff6b3d','#3dd7ff','#35f397','#ffd23a','#d750ff'],rankColors=['#d8e3ee','#36ec9b','#25bdff','#db5cff','#ffd646'];
    const elements = [
      ['Fire', '<path d="M17 3c3 6-1 7 4 11 2-2 2-4 2-5 5 6 7 10 4 15-3 6-13 7-18 2C3 20 8 15 12 10c-1 5 1 6 2 7 4-4 1-8 3-14Z"/><path fill="#fff2aa" d="M17 17c1 4 6 5 3 9-2 3-7 2-8-1-1-3 2-5 5-8Z"/>'],
      ['Shadow', '<path d="M24 5a12 12 0 1 0 3 20A12 12 0 0 1 24 5Z"/>'],
      ['Storm', '<path d="M18 2 5 19h10l-2 12 15-19H18l3-10Z"/>'],
      ['Earth', '<path d="m2 27 9-19 6 10 5-12 9 21H2Zm7-5h5l-3-6-2 6Zm10 0h5l-2-6-3 6Z"/>'],
      ['Ice', '<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3v26M5 9l22 14M5 23 27 9M11 6l5 4 5-4M11 26l5-4 5 4M5 14l6-1 1-6M27 18l-6 1-1 6M5 18l6 1 1 6M27 14l-6-1-1-6"/></g>'],
      ['Poison', '<path d="M28 3C11 2 3 9 4 19c1 7 10 11 17 5 6-5 6-12 7-21ZM6 29l3-7L24 8 12 24l-6 5Z"/>'],
      ['Lightning', '<path d="m17 1 2 8 7-4-4 8 9 3-9 3 4 8-7-4-2 8-3-8-8 4 5-8-10-3 10-3-5-8 8 4 3-8Z"/>'],
      ['Spirit', '<path fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" d="M26 23c-3 7-17 8-21-2-4-11 8-20 18-14 8 5 6 16-2 17-7 1-10-5-6-9 3-3 7-1 6 3"/>']
    ];
    const elementIcons = elements.map(([, shape], i) => 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" color="' + colors[i] + '" fill="' + colors[i] + '">' + shape + '</svg>') + '")');
    // Preserve only original frame artwork; replace the entire printed
    // sample interior so example names, levels and portraits cannot ghost.
    const frames=rects.map(([x,y,w,h])=>{const cv=document.createElement('canvas');cv.width=w;cv.height=h;const c=cv.getContext('2d');c.drawImage(image,x,y,w,h,0,0,w,h);const fill=c.createLinearGradient(0,0,w,h);fill.addColorStop(0,'#020a12');fill.addColorStop(.65,'#020b13');fill.addColorStop(1,'#07111d');c.fillStyle=fill;c.fillRect(8,8,w-16,h-16);return 'url("'+cv.toDataURL()+'")';});
    const cache=new Map(),empty=[],selected=[],reduced=matchMedia('(prefers-reduced-motion: reduce)');let heroes=[],paintedFrame=-1;
    function resize(){const height=window.MapDesign?.loaded?1156:1060,scale=Math.min(innerWidth/1672,innerHeight/height);scene.style.setProperty('--adventure-scale',scale);scene.style.left=Math.round((innerWidth-1672*scale)/2)+'px';scene.style.top=Math.round((innerHeight-height*scale)/2)+'px';}
    function create(hero){
      const card=document.createElement('article');card.className='map-hero roster-design-card';card.dataset.maphero=hero.id;
      const canvas=document.createElement('canvas');canvas.setAttribute('data-exact-roster','');canvas.dataset.mapPortrait=hero.id;canvas.dataset.painted='1';canvas.setAttribute('aria-label',hero.name+' portrait');
      const name=document.createElement('b');name.className='roster-hero-name';const rank=document.createElement('span');rank.className='roster-hero-rank';const meta=document.createElement('small');meta.className='roster-hero-meta';const bar=document.createElement('div');bar.className='bar';bar.append(document.createElement('i'));
      const element=document.createElement('span');element.className='roster-element-icon';element.setAttribute('role','img');
      const action=document.createElement('button');action.type='button';action.className='roster-team-action';action.onclick=()=>{const i=S.h.findIndex(h=>h.id===Number(card.dataset.maphero)),h=S.h[i];if(!h)return;if(!h.on&&!BattleRoster.eligible(h))return toast('Move this hero to Battle-ready before deploying.');if(!h.on&&h.en<1)return toast('This hero needs chakra before deploying.');tog(i);save();hud();refresh();};
      card.append(canvas,name,rank,meta,bar,action,element);return card;
    }
    function emptyCard(i){if(empty[i])return empty[i];const card=document.createElement('article');card.className='roster-design-empty roster-design-card';const plus=document.createElement('button');plus.type='button';plus.className='exact-adventure-slot-plus';plus.textContent='+';plus.setAttribute('aria-label','Manage hero slot '+(i+1));plus.onclick=()=>go(1);const name=document.createElement('b');name.className='roster-empty-name';const copy=document.createElement('small');copy.className='roster-empty-chakra';copy.textContent='Deploy a battle-ready hero';card.append(plus,name,copy);empty[i]=card;return card;}
    function choose(){
      const ready=BattleRoster.list(),allowed=new Map(ready.map(h=>[h.id,h]));for(let i=selected.length-1;i>=0;i--)if(!allowed.has(selected[i]))selected.splice(i,1);
      if(!selected.length)selected.push(...[...ready.filter(h=>h.on),...ready.filter(h=>!h.on)].slice(0,10).map(h=>h.id));
      // Existing slots stay stable. A Sensei replacement outside the displayed
      // ten takes a resting slot, without reordering all other controls.
      for(const h of ready.filter(h=>h.on)){if(selected.includes(h.id))continue;const resting=selected.findLastIndex(id=>!allowed.get(id)?.on);if(selected.length<10)selected.push(h.id);else if(resting>=0)selected[resting]=h.id;}
      for(const h of ready)if(selected.length<10&&!selected.includes(h.id))selected.push(h.id);return selected.slice(0,10).map(id=>allowed.get(id)).filter(Boolean);
    }
    function refresh(){
      if(tab!==0)return;const focused=strip.contains(document.activeElement)?document.activeElement:null;heroes=choose();const deployed=S.h.filter(h=>h.on).length,nodes=[];
      for(let i=0;i<10;i++){
        const h=heroes[i],model=h?Math.abs(Math.trunc(Number(h.id)||0))%8:i%8;let card=h?cache.get(h.id):emptyCard(i);if(!card){card=create(h);cache.set(h.id,card);}const[x,y,w,ht]=rects[i];card.dataset.adventureSlot=i+1;card.dataset.rosterModel=h?model:'empty';card.style.setProperty('--roster-x',(x-20)*sx+'px');card.style.setProperty('--roster-y',697+(y-120)*sy+'px');card.style.setProperty('--roster-width',w*sx+'px');card.style.setProperty('--roster-height',ht*sy+'px');card.style.setProperty('--roster-color',colors[model]);card.style.setProperty('--roster-frame',frames[templates[model]]);
        if(h){card.dataset.deployed=!!h.on;card.style.setProperty('--roster-rank',rankColors[h.r]);const element=card.querySelector('.roster-element-icon');element.style.setProperty('--element-icon',elementIcons[model]);element.dataset.element=elements[model][0].toLowerCase();element.title=elements[model][0]+' element';element.setAttribute('aria-label',elements[model][0]+' element');const name=card.querySelector('.roster-hero-name');name.textContent=h.name.split(' ')[0];name.title=h.name;card.querySelector('.roster-hero-rank').textContent='✦ '+R[h.r][0];card.querySelector('.roster-hero-meta').textContent='Lv. '+h.lv+'   '+Math.floor(h.en)+' / '+Math.floor(h.st*50)+' chakra';card.querySelector('.bar i').style.width=Math.max(0,Math.min(100,h.en/(h.st*50)*100))+'%';const b=card.querySelector('.roster-team-action');b.textContent=h.on?'✓ Deployed':'Deploy';b.setAttribute('aria-label',(h.on?'Rest ':'Deploy ')+h.name);b.setAttribute('aria-pressed',!!h.on);b.disabled=!h.on&&(h.en<1||deployed>=10);b.title=h.on?'Click to rest this deployed hero':h.en<1?'Resting until chakra recovers':deployed>=10?'All ten battle slots are occupied':'Deploy this battle-ready hero';}else card.querySelector('.roster-empty-name').textContent='Empty slot '+(i+1);nodes.push(card);
      }
      if(nodes.some((node,i)=>strip.children[i]!==node)||strip.children.length!==10)strip.replaceChildren(...nodes);if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});count.textContent=deployed+' / 10';count.setAttribute('aria-label',deployed+' of 10 heroes deployed');document.getElementById('camToggle')?.setAttribute('data-team-view','View: '+(Arena3D.cfg.tilt?'3D':'2D'));const kept=new Set(heroes.map(h=>h.id));for(const[id,card]of cache)if(!kept.has(id)){card.remove();cache.delete(id);}paint(performance.now(),true);resize();
    }
    function paint(now,force=false){
      const frame=reduced.matches?0:Math.floor(now/80);if(!force&&frame===paintedFrame)return;paintedFrame=frame;
      for(const h of heroes){const card=cache.get(h.id);if(!card?.isConnected)continue;const cv=card.querySelector('canvas'),d=Math.min(2,Math.max(1,devicePixelRatio||1)),size=Math.round(126*d);if(cv.width!==size||cv.height!==size){cv.width=size;cv.height=size;}const c=cv.getContext('2d');c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,126,126);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';const time=reduced.matches?0:now,phase=reduced.matches?0:Math.sin(now/520+h.id);
        // Pulse the same source aura beneath the original native source model.
        // The model itself is never stretched, recolored or re-drawn.
        if(window.TierAuras?.loaded){c.save();c.globalAlpha=.32+(phase+1)*.12;sprites.blit(c,TierAuras.frame(h.r),63,119,2.9+phase*.09,false);c.restore();}PlayerModels.drawPortrait(c,h,63,119,2.85,time);cv.dataset.animationFrame=frame;cv.dataset.portraitVisible='true';
      }
    }
    api.refresh=refresh;
    const oldHud=hud;hud=function(...args){const focused=strip.contains(document.activeElement)?document.activeElement:null,id=focused?.closest('[data-maphero]')?.dataset.maphero;const result=oldHud(...args);refresh();if(id&&document.activeElement!==focused)cache.get(Number(id))?.querySelector('.roster-team-action')?.focus({preventScroll:true});return result;};
    const oldGo=go;go=function(...args){const result=oldGo(...args);if(tab===0)refresh();return result;};const oldRefresh=AdventureDesign.refresh;AdventureDesign.refresh=function(...args){const result=oldRefresh?.(...args);refresh();return result;};addEventListener('resize',resize);addEventListener('shinobi-ryo-ledger',refresh);new MutationObserver(()=>{if(tab===0)refresh();}).observe(document.body,{attributes:true,attributeFilter:['class']});let last=0;function animate(now){requestAnimationFrame(animate);if(tab!==0||document.hidden||now-last<80)return;last=now;paint(now);}requestAnimationFrame(animate);refresh();
  }
})();
