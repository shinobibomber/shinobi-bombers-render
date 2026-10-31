/* Quantity-aware reveal gallery. Existing reveal/save/continue actions own game state. */
(() => {
  const sprites = ShinobiSprites, previousReady = sprites.ready;
  const root = new URL('.', document.currentScript.src), source = new Image();
  const slots = [79,255,434,612,791,970,1148,1326], widths = [165,167,166,168,168,167,166,167];
  const api = window.RevealDesign = {loaded:false,ready:null,refresh,paint};
  const pages = new WeakMap(), celebrated = new WeakSet(), painted = new WeakMap();
  const frameArt = new Map();
  const portraitQueue = new Map();
  let portraitTick=0,observedGrid=null;
  const resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(()=>layout()):null;
  let dialog, scene, currentPage=0, pageSize=15, celebrationUntil=0, queuedClose=false;
  const original = new Promise((resolve,reject)=>{source.onload=resolve;source.onerror=()=>reject(Error('The original reveal frame artwork is unavailable.'));source.src=new URL('reveal-design.png',root).href});
  api.ready=sprites.ready=Promise.all([previousReady,original]).then(()=>{
    if(source.naturalWidth!==1926||source.naturalHeight!==817)throw Error('The reveal frame source has unexpected dimensions.');
    dialog=document.getElementById('summonReveal');dialog.classList.add('exact-reveal');
    dialog.style.setProperty('--clean-reveal-background',`url("${new URL('../design-v3/village.png',root).href}")`);
    function finishAfterFlash(event){
      if(Date.now()>=celebrationUntil)return;
      event.preventDefault();event.stopImmediatePropagation();if(queuedClose)return;queuedClose=true;
      const record=batch();setTimeout(()=>{queuedClose=false;if(dialog.open&&batch()===record)Experience.finishReveal()},celebrationUntil-Date.now()+20);
    }
    dialog.addEventListener('click',event=>{if(event.target.closest('#revealContinue'))finishAfterFlash(event)},true);
    dialog.addEventListener('cancel',finishAfterFlash,true);
    dialog.addEventListener('transitionend',event=>{const card=event.target.closest?.('[data-reveal]');if(!card)return;const item=batch()[Number(card.dataset.reveal)];if(item?.revealed)queuePortrait(card,item.hero)},true);
    addEventListener('resize',layout);api.loaded=true;refresh();return true;
  });
  api.ready.catch(error=>console.error('Reveal gallery could not be applied:',error));
  function batch(){return S.v2.revealBatch||[]}
  function refresh(){
    if(!api.loaded||!batch().length||!dialog.querySelector('.reveal-grid'))return;
    scene=dialog.querySelector('.exact-reveal-scene');
    if(!scene){scene=document.createElement('div');scene.className='exact-reveal-scene';scene.append(...dialog.childNodes);dialog.append(scene)}
    scene.querySelectorAll('.exact-reveal-backdrop,.exact-reveal-scroll-width').forEach(el=>el.remove());
    scene.querySelector('.eyebrow')?.removeAttribute('aria-hidden');
    scene.dataset.revealSource=S.v2.revealSource||'summon';
    const grid=scene.querySelector('.reveal-grid');grid.setAttribute('aria-label','Shinobi reveal cards');grid.removeAttribute('tabindex');
    if(grid!==observedGrid){resizeObserver?.disconnect();resizeObserver?.observe(grid);observedGrid=grid}
    let pager=scene.querySelector('.clean-reveal-pages');
    if(!pager){pager=document.createElement('nav');pager.className='clean-reveal-pages';pager.setAttribute('aria-label','Reveal result pages');pager.innerHTML='<button type="button" data-reveal-page="-1" aria-label="Previous result page">‹</button><span></span><button type="button" data-reveal-page="1" aria-label="Next result page">›</button>';scene.querySelector('.reveal-footer').append(pager);pager.addEventListener('click',event=>{const button=event.target.closest('[data-reveal-page]');if(!button)return;currentPage+=Number(button.dataset.revealPage);pages.set(batch(),currentPage);layout()})}
    currentPage=pages.get(batch())||0;
    [...grid.querySelectorAll('[data-reveal]')].forEach((card,index)=>{card.style.removeProperty('--exact-card-x');card.style.removeProperty('--exact-card-y');paint(index)});
    layout();
  }
  function layout(){
    if(!scene||!batch().length)return;
    const count=batch().length,mobile=innerWidth<650;
    pageSize=mobile?(innerHeight<700?4:6):innerHeight<550?5:innerHeight<720?10:15;const total=Math.ceil(count/pageSize);currentPage=Math.max(0,Math.min(total-1,currentPage));pages.set(batch(),currentPage);
    const shown=Math.min(pageSize,count-currentPage*pageSize),cols=shown===1?1:Math.min(mobile?2:5,shown),rows=Math.ceil(shown/cols);
    const grid=scene.querySelector('.reveal-grid'),pager=scene.querySelector('.clean-reveal-pages');pager.hidden=total<=1;
    const gap=mobile?10:16,availableHeight=Math.max(150,grid.clientHeight-16);
    const cardHeight=Math.max(mobile?145:140,Math.min(shown===1?460:shown<=5?390:310,Math.floor((availableHeight-(rows-1)*gap)/rows)));
    const cardWidth=Math.max(90,Math.min(shown===1?310:270,cardHeight*.72,Math.floor((innerWidth-(mobile?42:100)-(cols-1)*gap)/cols)));
    dialog.style.setProperty('--clean-card-width',cardWidth+'px');dialog.style.setProperty('--clean-card-height',cardHeight+'px');dialog.style.setProperty('--clean-reveal-columns',cols);dialog.style.setProperty('--clean-reveal-gap',gap+'px');
    scene.dataset.revealQuantity=String(count);scene.dataset.visibleQuantity=String(shown);scene.dataset.cardRows=String(rows);
    grid.style.setProperty('--clean-grid-height',(rows*cardHeight+(rows-1)*gap)+'px');
    [...grid.querySelectorAll('[data-reveal]')].forEach((card,index)=>{card.hidden=index<currentPage*pageSize||index>=(currentPage+1)*pageSize;card.setAttribute('aria-posinset',index+1);card.setAttribute('aria-setsize',count);if(!card.hidden){paintPortrait(card,batch()[index].hero);queuePortrait(card,batch()[index].hero)}});
    pager.querySelector('span').textContent=`${currentPage+1} / ${total}`;pager.querySelector('[data-reveal-page="-1"]').disabled=currentPage===0;pager.querySelector('[data-reveal-page="1"]').disabled=currentPage===total-1;
  }
  function paint(index){
    if(!api.loaded)return;const item=batch()[index],card=dialog.querySelector('[data-reveal="'+index+'"]');if(!item||!card)return;
    const hero=item.hero,rank=Math.max(0,Math.min(4,Number(hero.r)||0)),model=PlayerModels.modelFor(hero).index;
    // The persisted reveal record is authoritative. Synchronize the visible
    // face before measuring it, even when called by an older paint hook.
    card.classList.toggle('is-revealed',item.revealed===true);
    card.setAttribute('aria-label',item.revealed?R[rank][0]+' '+hero.name:'Reveal card '+(index+1));
    card.style.setProperty('--clean-rank-color',item.revealed||rank>=3?R[rank][1]:'#ad8c51');card.dataset.cleanRank=rank;
    if(!frameArt.has(model)){const frame=document.createElement('canvas');frame.width=166;frame.height=359;const c=frame.getContext('2d');c.drawImage(source,slots[model],249,widths[model],359,0,0,166,359);c.clearRect(5,0,156,354);frameArt.set(model,'url("'+frame.toDataURL()+'")')}
    card.style.setProperty('--clean-frame-art',frameArt.get(model));
    let face=card.querySelector(':scope > .clean-reveal-face');
    if(!face){face=document.createElement('span');face.className='clean-reveal-face';face.innerHTML='<span class="clean-reveal-portrait"><canvas aria-hidden="true"></canvas></span><span class="clean-reveal-class"></span><strong class="clean-reveal-name"></strong><span class="clean-reveal-stars" aria-hidden="true"></span><span class="clean-reveal-rank"></span>';card.append(face);const seal=document.createElement('span');seal.className='clean-reveal-seal';seal.innerHTML='<span class="clean-seal-symbol" aria-hidden="true">忍</span><b></b><small>Tap to reveal</small>';card.append(seal)}
    card.querySelectorAll(':scope > .exact-reveal-card-art,:scope > .exact-reveal-new').forEach(el=>el.remove());
    face.querySelector('.clean-reveal-class').textContent=PlayerModels.catalog[model].label;
    face.querySelector('.clean-reveal-name').textContent=hero.name;
    face.querySelector('.clean-reveal-stars').textContent='★'.repeat(rank+1);
    face.querySelector('.clean-reveal-rank').textContent=R[rank][0];
    card.querySelector('.clean-reveal-seal b').textContent=S.v2.revealSource==='fusion'?'FUSION SCROLL':S.v2.revealSource==='prison'?'RESCUED SHINOBI':'SHINOBI SCROLL';
    card.title=item.revealed?R[rank][0]+' · '+hero.name+' · '+PlayerModels.catalog[model].label:'Reveal card '+(index+1);
    const wasRevealed=painted.get(card)===true;painted.set(card,!!item.revealed);
    if(item.revealed&&!wasRevealed&&scene&&card.hidden){currentPage=Math.floor(index/pageSize);pages.set(batch(),currentPage);layout()}
    if(item.revealed&&!wasRevealed&&rank>=3){
      let banner=scene?.querySelector('.clean-reveal-congratulations');if(!banner&&scene){banner=document.createElement('p');banner.className='clean-reveal-congratulations';banner.setAttribute('role','status');scene.querySelector('.reveal-header').after(banner)}
      if(banner){banner.textContent='Congratulations! '+R[rank][0]+' · '+hero.name;banner.style.setProperty('--glow',R[rank][1]);banner.hidden=false;layout()}
    }
    paintPortrait(card,hero);
    queuePortrait(card,hero);
    if(item.revealed&&!wasRevealed&&batch().every(record=>record.revealed))celebrate();
  }
  function paintPortrait(card,hero){
    if(!dialog.open||!card.isConnected||!card.classList.contains('is-revealed')||card.hidden)return;
    const canvas=card.querySelector('.clean-reveal-portrait canvas');if(!canvas)return;
    // getBoundingClientRect is transformed by the flip's rotateY(90deg). At
    // the instant a sealed card opens it reports zero width, leaving the canvas
    // blank forever. Layout dimensions stay valid throughout the transition.
    const logicalWidth=canvas.clientWidth,logicalHeight=canvas.clientHeight;
    if(logicalWidth<1||logicalHeight<1)return;
    const density=Math.min(2,Math.max(1,devicePixelRatio||1)),width=Math.round(logicalWidth*density),height=Math.round(logicalHeight*density);
    if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
    const context=canvas.getContext('2d');context.setTransform(density,0,0,density,0,0);context.clearRect(0,0,logicalWidth,logicalHeight);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    const scale=Math.min(logicalWidth/40,logicalHeight/50)*.96;
    if(PlayerModels.drawPortrait)PlayerModels.drawPortrait(context,hero,logicalWidth/2,logicalHeight*.94,scale,0);
    else sprites.blit(context,PlayerModels.portraitFrame(hero,0),logicalWidth/2,logicalHeight*.94,scale,false);
  }
  function queuePortrait(card,hero){
    if(card.hidden||!card.classList.contains('is-revealed'))return;
    portraitQueue.set(card,hero);if(portraitTick)return;
    portraitTick=requestAnimationFrame(()=>{portraitTick=0;for(const [node,model]of portraitQueue)paintPortrait(node,model);portraitQueue.clear()});
  }
  function celebrate(){
    const record=batch(),winners=record.filter(item=>item.hero.r>=3);if(winners.length<2||celebrated.has(record))return;celebrated.add(record);
    celebrationUntil=Date.now()+1600;
    let banner=scene?.querySelector('.clean-reveal-congratulations');if(banner)banner.textContent='Congratulations! '+winners.length+' Elite & Legend shinobi revealed';
    scene?.querySelectorAll('[data-clean-rank="3"],[data-clean-rank="4"]').forEach(card=>{card.classList.add('clean-group-flash');setTimeout(()=>card.classList.remove('clean-group-flash'),1600)});
  }
})();
