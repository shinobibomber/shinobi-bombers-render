(()=>{
'use strict';
const D=JSON.parse(document.getElementById('sbdata').textContent);const SCR=Object.keys(D).filter(k=>D[k]&&D[k].hs);
const {store,fmt}=window.SB;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const R=(a,b)=>a+Math.random()*(b-a),RI=(a,b)=>Math.floor(R(a,b+1)),pick=a=>a[Math.floor(Math.random()*a.length)];
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const app=$('#app'),built={},H={};let cur=null;

/* ---------- toast & modal ---------- */
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('s');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('s'),2200)}
let mdOpen=null;
function modal({title,html,buttons=[{t:'Close'}],wide=false,onOpen}){
  closeModal();const opener=document.activeElement;
  const m=document.createElement('div');m.className='md';m.innerHTML=`<div class="bk"></div><section class="bx${wide?' wide':''}" role="dialog" aria-modal="true" aria-labelledby="mdt" tabindex="-1"><h2 id="mdt">${title}</h2><div class="bd">${html||''}</div><div class="acts"></div></section>`;
  const acts=$('.acts',m);
  buttons.forEach(b=>{const e=document.createElement('button');e.className='gb'+(b.alt?' alt':'');e.textContent=b.t;if(b.id)e.id=b.id;e.onclick=async()=>{if(b.fn){const r=await b.fn(m,e);if(r===false)return}closeModal()};acts.appendChild(e)});
  $('.bk',m).onclick=closeModal;
  m.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();closeModal()}
    if(e.key==='Tab'){const f=$$('button,input,textarea,[tabindex="0"]',m).filter(x=>!x.disabled),i=f.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus()}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus()}}});
  document.body.appendChild(m);app.inert=true;mdOpen={m,opener};onOpen&&onOpen(m);
  const first=$('input,textarea',m)||$('.acts button:last-child',m);(first||$('.bx',m)).focus();return m}
function closeModal(){if(!mdOpen)return;const {m,opener}=mdOpen;mdOpen=null;m.remove();if(!window.SB.isOpen())app.inert=false;opener&&opener.focus&&opener.focus()}

document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mdOpen&&!mdOpen.m.contains(document.activeElement))closeModal()});
/* ---------- screen building ---------- */
function slice(el,k,r,W,H2,img){const d=D[k];el.style.backgroundImage=`url(${img||d.img})`;el.style.backgroundSize=`${W||d.W}px ${H2||d.H}px`;el.style.backgroundPosition=`${-r[0]}px ${-r[1]}px`}
function sliceScaled(el,k,r,w,h){const d=D[k],sx=w/(r[2]-r[0]),sy=h/(r[3]-r[1]);el.style.backgroundImage=`url(${d.img})`;el.style.backgroundSize=`${d.W*sx}px ${d.H*sy}px`;el.style.backgroundPosition=`${-r[0]*sx}px ${-r[1]*sy}px`;el.style.backgroundRepeat='no-repeat'}
function place(el,x,y,w,h){Object.assign(el.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});return el}
function mk(tag,cls,parent,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;parent&&parent.appendChild(e);return e}
function build(k){
  const d=D[k],sec=mk('section','scr',app);sec.id='scr-'+k;sec.setAttribute('aria-label',k);
  const st=mk('div','stage',sec);st.style.width=d.W+'px';st.style.height=d.H+'px';
  const im=mk('img','base',st);im.src=d.img;im.alt='';im.decoding='async';
  d.hs.forEach((h,i)=>{
    const r=h.r,e=mk('div','hs '+(h.c||''),st);place(e,r[0],r[1],r[2]-r[0],r[3]-r[1]);e.dataset.id=h.id;e.style.setProperty('--i',i%17);
    const sl=mk('i','sl',e);slice(sl,k,r);
    if(h.a){e.dataset.a=h.a;e.tabIndex=0;e.setAttribute('role','button');e.setAttribute('aria-label',h.l||h.id)}else e.classList.add('nolink');
    if(h.c&&h.c.includes('nav')&&h.a==='go:'+k)e.setAttribute('aria-current','page');
  });
  // chest button
  const c=d.chest,cb=mk('div','hs chestbtn',st);place(cb,c.r[0],c.r[1],c.r[2]-c.r[0],c.r[3]-c.r[1]);cb.dataset.a='chest';cb.tabIndex=0;cb.setAttribute('role','button');cb.setAttribute('aria-label','Open Chest');
  slice(mk('i','sl',cb),k,c.r);const ct=place(mk('span','cbt lv-chest',cb),c.tx,c.ty,c.tw,c.th);ct.style.fontSize=c.fs+'px';ct.dataset.fs=c.fs;
  const dot=place(mk('i','cdot',cb),c.dx,c.dy,c.ds,c.ds);dot.hidden=true;
  // live text
  d.live.forEach(l=>{const e=mk('span','lv '+l.cls,st);place(e,l.x,l.y,l.w,l.h);e.style.fontSize=l.fs+'px';e.dataset.fs=l.fs;e.style.color=l.c;e.dataset.lid=l.id});
  // fx
  d.fx.forEach((f,i)=>{const e=mk('div','fx '+f.t,st);place(e,f.x-f.w/2,f.y-f.h/2,f.w,f.h);if(f.s)e.style.cssText+=';'+f.s;
    if(f.t==='embers'){const n=+(getComputedStyle(e).getPropertyValue('--n')||20)||20;for(let j=0;j<n;j++){const p=mk('i','',e);p.style.left=R(0,f.w)+'px';p.style.setProperty('--dx',R(-50,50)+'px');p.style.setProperty('--dy',-R(f.h*.6,f.h*1.1)+'px');p.style.animationDuration=R(2.5,6)+'s';p.style.animationDelay=-R(0,6)+'s'}}
    if(f.t==='spinc')slice(e,k,[f.x-f.w/2,f.y-f.h/2,f.x+f.w/2,f.y+f.h/2]);});
  const pt=mk('div','petals',st);pt.innerHTML=Array.from({length:22},()=>`<i style="left:${R(0,d.W)}px;--x:${R(-160,160)}px;animation-duration:${R(9,18)}s;animation-delay:${-R(0,16)}s;scale:${R(.6,1.4)}"></i>`).join('');
  built[k]={sec,st,el:id=>$(`.hs[data-id="${id}"]`,st),lv:id=>$(`[data-lid="${id}"]`,st)};
  // card tilt
  $$('.hs.card',st).forEach(e=>{e.addEventListener('mousemove',ev=>{if(RM||e.classList.contains('dim'))return;const r=e.getBoundingClientRect(),x=(ev.clientX-r.left)/r.width-.5,y=(ev.clientY-r.top)/r.height-.5;e.firstChild.style.transform=`perspective(700px) rotateY(${x*9}deg) rotateX(${-y*9}deg) translateY(-4px) scale(1.03)`});e.addEventListener('mouseleave',()=>e.firstChild.style.transform='')});
  (INIT[k]||(()=>{}))(built[k]);/* game-link hook */ if(window.SBGame)SBGame.decorate(k,st,d);window.SB.refresh();return built[k]}
function fit(){if(!cur)return;const b=built[cur],d=D[cur],vw=app.clientWidth||innerWidth,vh=innerHeight;
  let s=vw/d.W;if(vw>vh*1.05)s=Math.min(s,vh/d.H);const w=d.W*s,h=d.H*s;b.st.style.transform=`translate(${Math.max(0,(vw-w)/2)}px,0) scale(${s})`;b.sec.style.height=h+'px';}
addEventListener('resize',fit);
/* shrink-to-fit for live numbers */
function fitEl(e){const base=+e.dataset.fs;if(!base)return;let fs=base;e.style.fontSize=fs+'px';while(e.scrollWidth>e.clientWidth+1&&fs>8){fs-=1;e.style.fontSize=fs+'px'}}
const fitAll=r=>$$('.lv,.cbt,[data-fs]',r||app).forEach(fitEl);
new MutationObserver(ms=>{const s=new Set();ms.forEach(m=>{const t=(m.target.nodeType===3?m.target.parentElement:m.target);const e=t&&t.closest&&t.closest('.lv,.cbt,[data-fs]');if(e)s.add(e)});s.forEach(fitEl)}).observe(app,{subtree:true,childList:true,characterData:true});
document.fonts&&document.fonts.ready.then(()=>fitAll());

/* ---------- router ---------- */
const GUILDCATS=Object.keys(D.guild.cats||{});
function route(){
  let h=(location.hash||'#home').slice(1);
  /* game-link hook: #play launch page overlays the current screen */ if(h==='play'&&window.SBGame){SBGame.showPlay();if(cur)return;h='home'}else if(window.SBGame)SBGame.hidePlay();
  let k=h,sub=null;
  if(GUILDCATS.includes(h)){k='guild';sub=h}else if(!SCR.includes(h)){k='home'}
  if(window.SB.isOpen())window.SB.closeChest();closeModal();closeDD();
  const b=built[k]||build(k);
  if(cur!==k){if(cur)built[cur].sec.classList.remove('on','enter');b.sec.classList.add('on');if(!RM){b.sec.classList.remove('enter');void b.sec.offsetWidth;b.sec.classList.add('enter')}cur=k;scrollTo(0,0)}
  if(k==='guild')G.cat(sub);
  document.title='Shinobi Bombers – '+({home:'Home',summon:'Summoning Shrine',fusion:'Fusion',market:'Market','boss-hunt':'Boss Hunt',guild:'Guild',adventure:'Adventure',heroes:'Heroes',codex:'Codex',chat:'Chat',dojo:'Dojo'}[k]);
  fit()}
addEventListener('hashchange',route);
function go(k){if(location.hash==='#'+k)route();else location.hash=k}

/* ---------- action dispatch ---------- */
app.addEventListener('click',e=>{const h=e.target.closest('.hs[data-a]');if(!h||!app.contains(h))return;if(h.classList.contains('dim')&&!h.classList.contains('card')){return}act(h.dataset.a,h)});
app.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const h=e.target.closest('.hs[data-a]');if(!h)return;e.preventDefault();act(h.dataset.a,h)});
function act(a,el){const [t,...rest]=a.split(':'),arg=rest.join(':');
  /* game-link hook */ if(window.SBGame&&SBGame.intercept(a,el,cur))return;if(t==='wallet')return go('play');if(t==='deposit')return window.SB.openChest();
  if(t==='go')return go(arg);if(t==='gcat')return go(arg);if(t==='chest')return window.SB.openChest();if(t==='toast')return toast(arg);
  if(t==='soon')return toast(`${arg} – screen design coming next`);if(t==='codex')return toast('Codex integration will be added after the full design is finished');
  if(t==='fn'){const [fn,...p]=arg.split(':');const m=(MODS[cur]||{})[fn];if(m)return m(p.join(':'),el);toast(fn)}}

/* ---------- shared countdown ---------- */
let evEnd=Date.now()+((3*24+12)*60+45)*60e3+30e3,bossEnd=Date.now()+(23*3600+45*60+12)*1e3;
function tickTimers(){const n=Date.now();let s=Math.max(0,Math.floor((evEnd-n)/1e3));
  $$('.lv-timer').forEach(e=>e.textContent=`${Math.floor(s/86400)}d ${Math.floor(s%86400/3600)}h ${Math.floor(s%3600/60)}m`);
  let b=Math.floor((bossEnd-n)/1e3);if(b<=0){bossEnd=n+864e5;b=86400}
  $$('.lv-btimer').forEach(e=>e.textContent=[Math.floor(b/3600),Math.floor(b%3600/60),b%60].map(v=>String(v).padStart(2,'0')).join(':'))}
setInterval(tickTimers,1000);

/* ---------- data ---------- */
const RAR=[['Genin',60,'#9fb4d8'],['Chunin',25,'#35e06b'],['Jonin',10,'#2aa8ff'],['Elite',4,'#c060ff'],['Legend',1,'#ffc13a']];
const HERO_N=['Kaze','Kuro','Sora','Aki','Hikari','Mika','Raiden','Yuki','Ren','Hiko','Rin','Saya','Jin','Nami','Taro','Koji'];
const HERO_T=['of Silent Rain','of Nightfall','of Azure Tides','of Storm Gale','of Thunder Edge','of Spirit Fox','of Crimson Flame','of Frost Moon','of Shadow Step','of Stone Fist','of Hidden Leaf','of Ember Ridge'];
const ELS=[['Fire','🔥'],['Ice','❄️'],['Poison','🌀'],['Lightning','⚡'],['Spirit','🔮'],['Earth','⛰️']];
const roll=(boost)=>{let r=Math.random()*100;if(boost)r=Math.max(0,r-1);let a=0;for(const x of RAR){a+=x[1];if(r<a)return x}return RAR[0]};
const newHero=(rar,img)=>({id:window.SB.key('h'),name:pick(HERO_N)+' '+pick(HERO_T),rar:rar[0],col:rar[2],el:pick(ELS),img,ts:Date.now()});
store.s.collection=[];store.s.summons=[];
const MODS={},INIT={};
const costs={1:25000,5:125000,10:225000,15:300000};

/* ---------- SUMMON ---------- */
let qty=1,summoning=false;
INIT.summon=b=>{tickTimers();
  b.tabs=[['q1',1],['q5',5],['q10',10],['q15',15]].map(([id,n])=>{const r=D.summon.hs.find(h=>h.id===id).r;const e=place(mk('div','smtab',b.st),r[0],r[1],r[2]-r[0],r[3]-r[1]);e.hidden=true;e.textContent='×'+n;e.dataset.n=n;return e});
  setQty(1,true)};
function setQty(n,silent){qty=n;const b=built.summon;if(!b)return;
  b.tabs.forEach(t=>{t.hidden=n===1;t.style.backgroundImage=`url(assets/sm-tab-${+t.dataset.n===n?'on':'off'}.webp)`});
  b.lv('cost').textContent=fmt(costs[n])+' Ryo';b.lv('slabel').textContent='SUMMON '+n;
  $$('.hs[data-id^="k"]',b.st).forEach(e=>e.classList.toggle('picked',!silent&&e.dataset.id==='k'+n));
  if(!silent){const g=b.el('go');g.classList.remove('flash');void g.offsetWidth;g.classList.add('flash')}}
MODS.summon={
  qty:a=>setQty(+a),pick:a=>setQty(+a),
  summon:()=>doSummon(qty),
  gallery:()=>{const c=store.s.collection;modal({title:'Hero Collection',wide:true,html:c.length?`<p>${c.length} heroes summoned this session.</p><div class="grid">${c.map(h=>`<div class="rc" style="--rc:${h.col};--k:0;width:auto"><img src="${h.img}" alt=""><b>${esc(h.name)}</b><span>${h.rar}</span></div>`).join('')}</div>`:'<p>No heroes summoned yet. Pick a scroll pack and press Summon.</p>'})},
  history:()=>{const s=store.s.summons;modal({title:'Summon History',html:s.length?`<div class="list">${s.map(x=>`<div><span><b>Summon ×${x.n}</b><br><small>${new Date(x.ts).toLocaleString()}</small></span><span style="text-align:right">${fmt(x.cost)} Ryo<br><small style="color:${x.best[2]}">Best: ${x.best[0]}</small></span></div>`).join('')}</div>`:'<p>No summons yet.</p>'})},
  flashRates:()=>{const r=built.summon.el('rates');r.classList.remove('flash');void r.offsetWidth;r.classList.add('flash');toast('Rarity rates: Genin 60% · Chunin 25% · Jonin 10% · Elite 4% · Legend 1%')},
  legend:()=>modal({title:'Legend – Higher Chance',html:`<div class="slice" style="width:247px;height:238px" id="lgs"></div><p>For a limited time, every summon has a boosted chance to roll a Legend hero.</p><p>Time left: <b class="lv-timer" style="position:static"></b></p>`,onOpen:m=>{slice($('#lgs',m),'summon',[30,462,277,700]);tickTimers()},buttons:[{t:'Close',alt:1},{t:'Summon now',fn:()=>doSummon(qty)}]}),
  elements:()=>modal({title:'Elemental Shinobi',html:`<div class="list">${[['Fire','Burns enemies over time'],['Ice','Slows and freezes foes'],['Poison','Stacking damage'],['Lightning','Chains between enemies'],['Spirit','Drains enemy chakra'],['Earth','Raises team defense']].map((e,i)=>`<div><span>${ELS[i][1]} <b>${e[0]}</b></span><small>${e[1]}</small></div>`).join('')}</div>`}),
  featured:()=>modal({title:'Featured Shinobi',wide:true,html:`<p>Higher chance to summon these featured heroes.</p><div class="grid">${[0,1,2,3,4,5].map(i=>`<div class="rc" style="--rc:#ffc13a;--k:${i};width:auto"><img src="assets/hero${i}.webp" alt=""><b>Featured hero ${i+1}</b><span>Rate up</span></div>`).join('')}</div>`})};
/* ---------- FUSION ---------- */
const FROWS=[['Yuki of Ember Ridge','Fire','Armor Breaker'],['Kaze of Silent Rain','Wind','Wind Step'],['Rin of Hidden Leaf','Leaf','Healing Seal'],['Hiko of Stone Fist','Earth','Earth Smash'],['Kuro of Nightfall','Shadow','Shadow Strike'],['Sora of Blue Wind','Water','Chakra Dash']];
let fsel=[],ffused=new Set(),fGenin=185,fusing=false;
INIT.fusion=b=>{b.marks=FROWS.map((_,i)=>{const m=place(mk('div','mk check',b.st,'✓'),60,612+60*i,22,22);m.hidden=true;return m});
  b.fused=FROWS.map((_,i)=>{const m=place(mk('div','mk fused',b.st,'FUSED'),46,594+60*i,754,58);m.hidden=true;return m});
  b.slots=[347,440,533].map((y,j)=>{const s=place(mk('div','slotfill',b.st),901,y,151,86);s.hidden=true;s.onclick=()=>{fsel.splice(j,1);fUpd()};return s});fUpd()};
function fUpd(){const b=built.fusion;if(!b)return;
  FROWS.forEach((_,i)=>{b.marks[i].hidden=!fsel.includes(i);b.fused[i].hidden=!ffused.has(i);b.el('row'+i).classList.toggle('on2',fsel.includes(i))});
  b.slots.forEach((s,j)=>{const i=fsel[j];s.hidden=i==null;if(i!=null)s.innerHTML=`<img src="assets/fav${i}.webp" alt=""><span><b>${FROWS[i][0].split(' of ')[0]}</b><small>${FROWS[i][1]} · Genin</small></span>`});
  b.lv('fcount').textContent=`${fsel.length} / 3 selected · ${fGenin} Genin available`;b.el('fuse').classList.toggle('on2',fsel.length===3)}
const avail=()=>FROWS.map((_,i)=>i).filter(i=>!ffused.has(i));
MODS.fusion={
  row:a=>{const i=+a;if(ffused.has(i))return toast('That hero was already fused');const k=fsel.indexOf(i);if(k>=0)fsel.splice(k,1);else if(fsel.length>=3){const e=built.fusion.el('row'+i);e.classList.remove('shake');void e.offsetWidth;e.classList.add('shake');return toast('A fusion uses exactly 3 heroes')}else fsel.push(i);fUpd()},
  slot:a=>{if(fsel[+a]!=null){fsel.splice(+a,1);fUpd()}else{toast('Pick a Genin from the list');$$('.hs.row',built.fusion.st).forEach(e=>{e.classList.remove('flash');void e.offsetWidth;e.classList.add('flash')})}},
  weakest:()=>{const a=avail();if(a.length<3)return toast('Not enough Genin left in this list');fsel=a.slice(0,3);fUpd()},
  clear:()=>{fsel=[];fUpd()},
  rank:a=>{const n=['Genin','Chunin','Jonin','Elite'][+a];$$('.hs[data-id^="r"]',built.fusion.st).forEach((e,i)=>e.classList.toggle('on2',i===+a&&+a!==0));toast(+a?`${n} roster loads with live hero data`:'Showing Genin heroes')},
  etab:a=>{$$('.hs[data-id^="et"]',built.fusion.st).forEach((e,i)=>e.classList.toggle('on2',i===+a&&+a!==1));toast(['3 Genin → 1 Chunin','3 Genin → 1 Chunin','3 Chunin → 1 Jonin','3 Jonin → 1 Elite'][+a])},
  fuse:()=>{if(fusing)return;if(fsel.length<3){$$('.hs.slot',built.fusion.st).forEach(e=>{e.classList.remove('shake');void e.offsetWidth;e.classList.add('shake')});return toast(`Select ${3-fsel.length} more hero${3-fsel.length>1?'es':''}`)}
    if(store.s.spendable<25000)return noRyo(25000,'This fusion');
    const used=[...fsel];store.set({spendable:store.s.spendable-25000});fusing=true;
    fusionCine(used.map(i=>`assets/fav${i}.webp`),1,()=>{used.forEach(i=>ffused.add(i));fsel=[];fGenin-=3;fUpd();fusing=false;
      const el=FROWS[pick(used)][1],h={name:pick(HERO_N)+' '+pick(HERO_T),p:R(3,6).toFixed(1),s:R(3,6).toFixed(1),st:R(3,6).toFixed(1),r:RI(2,4),j:RI(2,3)};
      modal({title:'New Chunin Born!',html:`<div class="fin">${used.map(i=>`<img src="assets/fav${i}.webp" alt="">`).join('')}<span style="font-size:40px;align-self:center">→</span><img src="assets/fx-p5.webp" alt="" style="object-position:50% 35%"></div><p><b style="font-size:22px">${esc(h.name)}</b> · ${el} · Chunin Lv. 1</p><div class="row2"><span>Power</span><b>${h.p}</b></div><div class="row2"><span>Speed</span><b>${h.s}</b></div><div class="row2"><span>Stamina</span><b>${h.st}</b></div><div class="row2"><span>Rarity</span><b>${'★'.repeat(h.r)}</b></div><div class="row2"><span>Jutsu</span><b>${h.j} incl. guaranteed rank jutsu</b></div><p>25,000 Ryo spent (2% studio share included).</p>`})})},
  batch:a=>{let n=+a,capped=n>20;n=Math.min(n,20,Math.floor((fGenin-2)/3));const cost=n*25000;if(n<1)return toast('Not enough Genin – always keeps at least 2 heroes');
    modal({title:`Batch Fusion ×${n}`,html:`<p>Fuse the weakest Genin: <b>${n*3} Genin → ${n} Chunin</b>.</p>${capped?'<p>Max 20 results per batch – the rest can run in the next batch.</p>':''}<div class="row2"><span>Cost</span><b>${fmt(cost)} Ryo</b></div><div class="row2"><span>Your balance</span><b>${fmt(store.s.spendable)} Ryo</b></div>${store.s.spendable<cost?'<p class="err">Not enough Ryo for this batch.</p>':''}`,
      buttons:[{t:'Cancel',alt:1},{t:'Fuse ×'+n,fn:()=>{if(store.s.spendable<cost){toast('Not enough Ryo');return false}store.set({spendable:store.s.spendable-cost});fusing=true;
        fusionCine([0,1,2].map(i=>`assets/fav${i}.webp`),n,()=>{fGenin-=n*3;fUpd();fusing=false;modal({title:`${n} New Chunin!`,wide:true,html:`<div class="res" style="justify-content:flex-start">${Array.from({length:n},(_,i)=>`<div class="rc" style="--rc:#35e06b;--k:${i};width:120px"><img src="assets/fav${RI(0,5)}.webp" alt=""><b>${esc(pick(HERO_N))}</b><span>Chunin</span></div>`).join('')}</div>`})})}}]})}};
function noRyo(cost,what){modal({title:'Not enough Ryo',html:`<p>${what} costs <b>${fmt(cost)} Ryo</b>. You have <b>${fmt(store.s.spendable)} Ryo</b>.</p>`,buttons:[{t:'Close',alt:1},{t:'Open Chest',fn:()=>{setTimeout(window.SB.openChest,50)}}]})}
function fusionCine(imgs,n,end){const st=built.fusion.st,cv=mk('div','cine',st);cv.setAttribute('role','dialog');cv.setAttribute('aria-label','Fusion in progress');
  const names=['SELECT','CHARGE','CONVERGE','LEGEND BURST','REVEAL'];
  cv.innerHTML=`<button class="gb skip">Skip ▸▸</button><div class="fin">${imgs.map((s,i)=>`<img src="${s}" alt="" style="animation-delay:${i*.12}s">`).join('')}${n>1?`<b style="align-self:center;font-size:28px;color:#ffcf4a">×${n}</b>`:''}</div><div class="fph"><div class="pimg"></div></div><div class="fdots">${names.map((x,i)=>`<span>${i+1}. ${x}</span>`).join('')}</div>`;
  const ph=$('.fph',cv),dots=$$('.fdots span',cv);let p=0,tm;const dur=RM?350:1350;
  const fin=()=>{if(cv._d)return;cv._d=1;clearTimeout(tm);cv.remove();end()};$('.skip',cv).onclick=fin;$('.skip',cv).focus();
  (function step(){if(p>=5)return fin();ph.className='fph p'+(p+1);const o=$('.pimg',cv),c=o.cloneNode();c.style.backgroundImage=`url(assets/fx-p${p+1}.webp)`;o.replaceWith(c);
    dots.forEach((d,i)=>{d.className=i<p?'done':i===p?'on':''});if(p===2&&!RM){st.classList.remove('shake');void st.offsetWidth;st.classList.add('shake')}
    p++;tm=setTimeout(()=>{step.call()},p===5?dur*1.4:dur)})();
}

/* ---------- MARKET ---------- */
const MC=[['Raiden of Crimson Flame',68,1250000,'Fire','🔥'],['Sora of Azure Tides',72,980000,'Water','💧'],['Aki of Storm Gale',65,850000,'Wind','🌀'],['Hikari of Thunder Edge',70,1100000,'Lightning','⚡'],['Kuro of Nightfall',75,1500000,'Shadow','🔮'],['Yuki of Frost Moon',66,890000,'Ice','❄️'],['Hiko of Stone Fist',60,720000,'Earth','⛰️'],['Mika of Spirit Fox',69,920000,'Spirit','🌸'],['Ren of Shadow Step',71,1080000,'Water','💧'],['Kaze of Silent Rain',73,1350000,'Light','☀️']];
const mstat=i=>i===4?[5200,4800,4600,5000]:[0,1,2,3].map(j=>Math.round(MC[i][1]*68+((i*37+j*53)%9)*45-200));
let msel=4,mf={rar:'All',el:'All',q:'',price:'All'},mfav=new Set(),mown=new Set(),mtab=0;
INIT.market=b=>{const cr=i=>D.market.hs.find(h=>h.id==='cd'+i).r;b.cr=cr;
  b.buys=MC.map((_,i)=>{const r=cr(i),e=place(mk('div','hs top',b.st),r[2]-66,r[3]-37,60,32);e.dataset.a='fn:buy:'+i;e.tabIndex=0;e.setAttribute('role','button');e.setAttribute('aria-label','Buy '+MC[i][0]);slice(mk('i','sl',e),'market',[r[2]-66,r[3]-37,r[2]-6,r[3]-5]);e.classList.add('pu');return e});
  b.hearts=MC.map((_,i)=>{const r=cr(i),e=place(mk('div','hs top',b.st),r[2]-38,r[1]+4,34,34);e.dataset.a='fn:fav:'+i;e.tabIndex=0;e.setAttribute('role','button');e.setAttribute('aria-label','Favourite '+MC[i][0]);slice(mk('i','sl',e),'market',[r[2]-38,r[1]+4,r[2]-4,r[1]+38]);
    const h=place(mk('div','ovstamp heart',b.st,'♥'),r[2]-38,r[1]+3,34,34);h.hidden=true;return h});
  b.owned=MC.map((_,i)=>{const r=cr(i),o=place(mk('div','ovstamp owned',b.st,'OWNED'),r[2]-68,r[3]-38,64,34);o.hidden=true;return o});
  b.det=place(mk('div','mdetail',b.st),1170,253,430,322);b.det.hidden=true;b.det.innerHTML='<div class="hd"><i class="ic"></i><span><small>Legend</small><b></b></span></div><div class="lvl"></div>';
  b.stats=place(mk('div','fill',b.st),1490,630,96,108);b.stats.style.background='#010d1b';b.stats.hidden=true;
  b.elv=place(mk('div','txtov',b.st),1262,750,122,28);b.elv.style.background='#000109';b.elv.style.fontSize='16px';b.elv.hidden=true;
  b.price=place(mk('div','txtov',b.st),1200,862,140,32);b.price.style.cssText+=';background:#01050a;color:#ffd24a;font-size:22px;font-weight:700;overflow:hidden';b.price.dataset.fs=22;b.price.hidden=true;
  b.dfav=place(mk('div','ovstamp heart',b.st,'♥'),1556,263,36,36);b.dfav.hidden=true;b.downed=place(mk('div','ovstamp owned',b.st,'OWNED'),1343,852,165,53);b.downed.style.fontSize='24px';b.downed.hidden=true;
  b.dpanel=place(mk('div','dpanel',b.st),1172,626,426,114);b.dpanel.style.background='#020a18';b.dpanel.hidden=true;
  b.empty=place(mk('div','empty',b.st,'No heroes match these filters'),76,364,1052,486);b.empty.hidden=true;
  b.sbg=place(mk('div','srchbg',b.st),876,315,164,34);b.sbg.hidden=true;b.sin=place(mk('input','srch',b.st),904,318,132,28);b.sin.hidden=true;b.sin.placeholder='Search hero name…';b.sin.setAttribute('aria-label','Search hero name');
  b.sin.oninput=()=>{mf.q=b.sin.value.trim().toLowerCase();mUpd()};b.sin.onblur=()=>{if(!b.sin.value){b.sin.hidden=b.sbg.hidden=true}};
  mUpd()};
const mvis=i=>{const c=MC[i];if(mf.rar!=='All'&&mf.rar!=='Legend')return false;if(mf.el!=='All'&&c[3]!==mf.el)return false;if(mf.q&&!c[0].toLowerCase().includes(mf.q))return false;
  if(mf.price==='lo'&&c[2]>=900000)return false;if(mf.price==='mid'&&(c[2]<900000||c[2]>1200000))return false;if(mf.price==='hi'&&c[2]<=1200000)return false;return true};
function mUpd(){const b=built.market;if(!b)return;let any=false;
  MC.forEach((c,i)=>{const v=mvis(i);any=any||v;b.el('cd'+i).classList.toggle('dim',!v);b.el('cd'+i).classList.toggle('sel',i===msel&&i!==4);b.buys[i].hidden=!v||mown.has(i);b.owned[i].hidden=!mown.has(i)||!v;b.hearts[i].hidden=!mfav.has(i)||!v;$(`.hs[data-a="fn:fav:${i}"]`,b.st).hidden=!v});
  b.empty.hidden=any;
  ['f0','f1','f2','f3','f4','f5'].forEach((id,i)=>b.el(id).classList.toggle('on2',['All','Genin','Chunin','Jonin','Elite','Legend'][i]===mf.rar&&mf.rar!=='All'));
  b.el('dd1').classList.toggle('on2',mf.el!=='All');b.el('dd3').classList.toggle('on2',mf.price!=='All');
  const c=MC[msel],def=msel===4;[b.det,b.stats,b.elv,b.price].forEach(e=>e.hidden=def);
  if(!def){const r=b.cr(msel);sliceScaled(b.det,'market',[r[0]+3,r[1]+3,r[2]-3,r[1]+165],430,322);b.det.style.backgroundSize=b.det.style.backgroundSize;
    const ic=$('.ic',b.det);sliceScaled(ic,'market',[r[0]+6,r[1]+6,r[0]+54,r[1]+54],52,52);$('.hd b',b.det).textContent=c[0];$('.lvl',b.det).innerHTML=`Lv. ${c[1]}<span>★★★★★★</span>`;
    b.stats.innerHTML=mstat(msel).map(v=>`<span>${fmt(v)}</span>`).join('');b.elv.innerHTML=`<span style="font-size:20px;margin-right:8px">${c[4]}</span>${c[3]}`;b.price.textContent=fmt(c[2])+' Ryo';
    b.det.classList.remove('x');void b.det.offsetWidth}
  b.dfav.hidden=!mfav.has(msel);b.downed.hidden=!mown.has(msel);b.el('buy').classList.toggle('dim',mown.has(msel));
  b.dpanel.hidden=mtab===0;if(mtab){const s=mstat(msel);b.dpanel.innerHTML=[[['Primary jutsu',c[3]+' Barrage'],['Secondary jutsu','Shadow Clone'],['Ultimate','Legend Awakening']],[['Chakra pool',fmt(s[3]*1.2)],['Regen / s',(c[1]/10).toFixed(1)],['Affinity',c[3]]],[['Seller','NinjaMaster#1234'],['Listed','2h ago'],['Token ID','#'+(1000+msel*137)]]][mtab-1].map(x=>`<div><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')}
  ['dt1','dt2','dt3','dt4'].forEach((id,i)=>b.el(id).classList.toggle('on2',i===mtab&&i>0))}
function closeDD(){$$('.dd').forEach(e=>e.remove())}
document.addEventListener('click',e=>{if(!e.target.closest('.dd,[data-a^="fn:dd"]'))closeDD()});
MODS.market={
  card:a=>{const i=+a;if(!mvis(i))return;msel=i;mUpd()},
  cyc:a=>{const v=MC.map((_,i)=>i).filter(mvis);if(!v.length)return;let k=v.indexOf(msel);k=(k+(+a)+v.length)%v.length;msel=v[k<0?0:k];mUpd()},
  fav:a=>{const i=a==='-1'?msel:+a;mfav.has(i)?mfav.delete(i):mfav.add(i);toast(mfav.has(i)?`Added ${MC[i][0]} to favourites`:'Removed from favourites');mUpd()},
  buy:a=>{const i=a==='-1'?msel:+a,c=MC[i];if(mown.has(i))return toast('You already own this hero');const ok=store.s.spendable>=c[2];
    modal({title:'Confirm Purchase',html:`<div class="slice" id="bsl" style="width:200px;height:239px"></div><p style="text-align:center"><b style="font-size:20px">${c[0]}</b> · Lv. ${c[1]} · ${c[3]}</p><div class="row2"><span>Price</span><b>${fmt(c[2])} Ryo</b></div><div class="row2"><span>Your balance</span><b>${fmt(store.s.spendable)} Ryo</b></div><div class="row2"><span>After purchase</span><b class="${ok?'':'err'}">${ok?fmt(store.s.spendable-c[2])+' Ryo':'Not enough Ryo'}</b></div>`,
      onOpen:m=>{const r=built.market.cr(i);slice($('#bsl',m),'market',r);$('#bsl',m).style.width=(r[2]-r[0])+'px';$('#bsl',m).style.height=(r[3]-r[1])+'px'},
      buttons:[{t:'Cancel',alt:1},ok?{t:'Buy for '+fmt(c[2]),fn:()=>{if(store.s.spendable<c[2])return false;store.set({spendable:store.s.spendable-c[2]});mown.add(i);mUpd();toast(`${c[0]} joined your roster!`)}}:{t:'Open Chest',fn:()=>{setTimeout(window.SB.openChest,50)}}]})},
  offer:()=>{const c=MC[msel];modal({title:'Make an Offer',html:`<p>${c[0]} · listed at <b>${fmt(c[2])} Ryo</b></p><label for="ofr">Your offer (Ryo)</label><input id="ofr" type="number" inputmode="numeric" value="${Math.round(c[2]*.9)}"><p id="ofm"></p>`,
    buttons:[{t:'Cancel',alt:1},{t:'Send offer',fn:m=>{const v=Math.floor(+$('#ofr',m).value||0),msg=$('#ofm',m);if(v<c[2]*.5){msg.className='err';msg.textContent='Offers must be at least 50% of the listing price.';return false}if(v>store.s.spendable){msg.className='err';msg.textContent='Offer is higher than your balance.';return false}toast(`Offer of ${fmt(v)} Ryo sent to NinjaMaster#1234`)}}]})},
  listings:()=>modal({title:'NinjaMaster#1234',html:`<div class="list">${[4,9,0].map(i=>`<div><span><b>${MC[i][0]}</b><br><small>Lv. ${MC[i][1]} · ${MC[i][3]}</small></span><b>${fmt(MC[i][2])} Ryo</b></div>`).join('')}</div>`}),
  rar:a=>{mf.rar=a;mUpd();if(a!=='All'&&a!=='Legend')toast(`No ${a} heroes listed on this page`)},
  dd:(a,el)=>{closeDD();const b=built.market,r=D.market.hs.find(h=>h.a==='fn:dd:'+a).r;const dd=place(mk('div','dd',b.st),r[0],r[3]+4,null,null);dd.style.width='auto';dd.style.height='auto';
    const opts=a==='element'?[['All','All elements'],...['Fire','Water','Wind','Lightning','Shadow','Ice','Earth','Spirit','Light'].map(x=>[x,x])]:a==='price'?[['All','Any price'],['lo','Under 900K'],['mid','900K – 1.2M'],['hi','Over 1.2M']]:[['All','All skills']];
    const key=a==='element'?'el':a==='price'?'price':null;
    opts.forEach(([v,t])=>{const o=mk('button',key&&mf[key]===v?'on':'',dd,t);o.onclick=()=>{if(key)mf[key]=v;else toast('Skill filters plug in with live listing data');closeDD();mUpd();el.focus()}});dd.firstChild.focus()},
  search:()=>{const b=built.market;b.sbg.hidden=b.sin.hidden=false;b.sin.focus()},
  reset:()=>{mf={rar:'All',el:'All',q:'',price:'All'};const b=built.market;b.sin.value='';b.sin.hidden=b.sbg.hidden=true;mUpd();toast('Filters reset')},
  mtab:a=>{const n=['Heroes','Items','Resources','My Listings'][+a];if(+a===3){const o=[...mown];modal({title:'My Listings',html:o.length?`<p>Heroes you bought this session (not listed for sale):</p><div class="list">${o.map(i=>`<div><span><b>${MC[i][0]}</b></span><small>Lv. ${MC[i][1]}</small></div>`).join('')}</div>`:'<p>You have no active listings.</p>'});return}if(+a)toast(`${n} listings – screen design coming next`)},
  page:a=>toast(`Page ${a==='-1'?'navigation':a==='+1'?'navigation':a} loads from the live market`),
  dtab:a=>{mtab=+a;mUpd()}};

/* ---------- BOSS HUNT ---------- */
const BHP=2580250;let bhp=BHP,best=8450320,clears=5,battling=false;
INIT['boss-hunt']=b=>{tickTimers();b.hp=place(mk('div','hpov',b.st,'<i></i><span></span>'),55,282,927,22);b.hp.hidden=true;
  b.hpt=place(mk('div','txtov',b.st),50,312,240,24);b.hpt.style.cssText+=';background:#010512;color:#fff;font-size:16px';b.hpt.hidden=true;
  b.rec=place(mk('div','txtov',b.st),1060,955,120,34);b.rec.style.cssText+=';background:#010614;color:#fff;font-size:24px;font-weight:700;justify-content:center';b.rec.hidden=true;
  b.clr=place(mk('div','txtov',b.st),1395,955,60,34);b.clr.style.cssText+=';background:#010614;color:#fff;font-size:24px;font-weight:700;justify-content:center';b.clr.hidden=true};
function bUpd(){const b=built['boss-hunt'];const p=bhp/BHP*100;b.hp.hidden=b.hpt.hidden=bhp===BHP;$('i',b.hp).style.width=p+'%';$('span',b.hp).textContent=Math.ceil(p)+'%';b.hpt.textContent=`${fmt(bhp)} / ${fmt(BHP)}`}
MODS['boss-hunt']={
  locked:a=>{toast(`Defeat Akuma to unlock ${a}`)},
  team:()=>modal({title:'Deployed Heroes (7/10)',html:`<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap" id="tm"></div><p>Team power <b>48,650</b> · Recommended 50,000.</p><p>Full team management lives in the Heroes menu – that screen design is next.</p>`,onOpen:m=>{[1032,1090,1149,1208,1267].forEach(x=>{const e=mk('div','slice',$('#tm',m));e.style.cssText='width:53px;height:120px;margin:0';slice(e,'boss-hunt',[x,454,x+53,574])})}}),
  ranking:()=>modal({title:'Daily Rankings',html:`<div class="list">${[['NinjaMaster',12580340],['ShadowKage',11245670],['RyoSenpai',10987220],['KageRyu',10450100],['HikoFrost',10120900],['SoraWind',9876540],['Raizen',9540330],['Mizuki',9120870],['YukiChan',8890210],['Daichi',8605400],['Tsubaki',8512090],['You',best]].map((r,i)=>`<div${r[0]==='You'?' style="color:#ffcf4a"':''}><span><b>#${i+1}</b> ${r[0]}</span><b>${fmt(r[1])}</b></div>`).join('')}</div>`}),
  challenge:()=>{if(battling)return;battling=true;const b=built['boss-hunt'],st=b.st,boss=b.el('boss');let total=0,t=0;const dur=RM?600:6000;const t0=performance.now();
    toast('Battle started – your 7 heroes engage Akuma!');b.el('ch').classList.add('dim');
    const iv=setInterval(()=>{const crit=Math.random()<.18,d=Math.round(R(9000,26000)*(crit?2.4:1));total+=d;bhp=Math.max(0,bhp-d);bUpd();
      if(!RM){const n=mk('div','dmg'+(crit?' crit':''),st,(crit?'CRIT ':'')+fmt(d));place(n,R(570,760),R(450,600),null,null);n.style.width=n.style.height='auto';setTimeout(()=>n.remove(),1100);
        const s=mk('div','slash',st);place(s,R(560,640),R(480,600),R(160,240),6);s.style.setProperty('--r',R(-35,35)+'deg');setTimeout(()=>s.remove(),350);
        if(crit){st.classList.remove('shake');void st.offsetWidth;st.classList.add('shake')}}
      if(performance.now()-t0>dur||bhp<=0){clearInterval(iv);endB()}},RM?60:240);
    function endB(){battling=false;b.el('ch').classList.remove('dim');const killed=bhp<=0,ryo=Math.round(total/20/50)*50+(killed?50000:0);
      const rw=[['Ryo',fmt(ryo)],['Upgrade Stone','×'+RI(1,3)],['Jutsu Scroll','×'+RI(0,2)],...(killed?[['Legend Fragment','×1'],['Chest Key','×1']]:[])];
      store.set({adventure:store.s.adventure+ryo});if(total>best){best=total;b.rec.hidden=false;b.rec.textContent=fmt(best)}
      if(killed){clears++;b.clr.hidden=false;b.clr.textContent=clears;bhp=BHP;bUpd()}
      modal({title:killed?'Akuma Defeated!':'Battle Report',html:`<p>Total damage dealt: <b style="font-size:24px;color:#ffcf4a">${fmt(total)}</b></p>${killed?'<p class="ok">Boss cleared – HP resets for the next hunt.</p>':`<p>Akuma has <b>${fmt(bhp)}</b> HP left.</p>`}<p>Rewards:</p><div class="list">${rw.map(r=>`<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}</div><p>Ryo rewards went to your <b>Chest</b> as Adventure Ryo – claim them from the Chest button.</p>`,
        buttons:[{t:'Close',alt:1},{t:'Open Chest',fn:()=>{setTimeout(window.SB.openChest,50)}}]})}}};

/* ---------- GUILD ---------- */
let gnote=null,gdon=120000;
INIT.guild=b=>{b.cat=place(mk('div','gcat',b.st),205,205,1312,800);b.cat.hidden=true;b.cat.innerHTML='<header><h2></h2><small>Shadow Legion · Guild screen design</small><button class="gb" data-home>← Guild Home</button></header><div class="im"><img alt=""></div>';
  $('[data-home]',b.cat).onclick=()=>go('guild');
  b.note=place(mk('div','txtov',b.st),1012,452,430,58);b.note.style.cssText+=';background:#020f1d;color:#fff;font-size:17px;font-weight:500;white-space:normal;line-height:1.35';b.note.hidden=true;
  b.qt=place(mk('div','txtov',b.st),774,888,90,22);b.qt.style.cssText+=';background:#000f1e;color:#e6e0ff;font-size:14px';b.qt.hidden=true;
  b.qb=place(mk('div','',b.st),595,893,173,10);b.qb.style.cssText+=';position:absolute;z-index:11;border-radius:5px;background:#0b1d3a;overflow:hidden';b.qb.innerHTML='<i style="display:block;height:100%;background:linear-gradient(90deg,#ff9a1f,#ffc13a);transition:width .8s"></i>';b.qb.hidden=true};
const G={cat(id){const b=built.guild;if(!b)return;const on=!!id;b.cat.hidden=!on;
  $$('.hs[data-a^="gcat:guild"]',b.st).filter(e=>e.classList.contains('side')||e.dataset.id==='g-home').forEach(e=>{e.classList.toggle('on2',e.dataset.a==='gcat:'+id);if(e.dataset.id==='g-home')e.classList.toggle('dimact',on)});
  if(on){const c=D.guild.cats[id];$('h2',b.cat).textContent=c.n.toUpperCase();const img=$('img',b.cat);img.src=`assets/gc-${id}.webp`;img.alt=c.n+' screen';img.style.animation='none';void img.offsetWidth;img.style.animation=''}}};
MODS.guild={
  notice:()=>modal({title:'Edit Guild Notice',html:`<label for="gn">Notice shown to all members</label><textarea id="gn" rows="3" maxlength="140">${esc(gnote||'Stay active, complete guild missions, and join Boss Hunt. Let\'s make Shadow Legion the strongest!')}</textarea>`,
    buttons:[{t:'Cancel',alt:1},{t:'Save notice',fn:m=>{const v=$('#gn',m).value.trim();if(!v){toast('Notice cannot be empty');return false}gnote=v;const b=built.guild;b.note.hidden=false;b.note.textContent=v;toast('Guild notice updated')}}]}),
  benefits:()=>modal({title:'Guild Level Benefits',html:`<div class="list">${[['Lv. 5','+10% Guild Shop Discount'],['Lv. 5','+5% EXP Gain'],['Lv. 5','+5% Ryo Gain'],['Lv. 5','+1 Daily Guild Missions'],['Lv. 5','Unlock Guild Boss (Hard)'],['Lv. 5','Exclusive Guild Badge'],['Lv. 6','+15% Guild Shop Discount'],['Lv. 6','Guild Battle Season Rewards ×2']].map(r=>`<div><small>${r[0]}</small><span>${r[1]}</span></div>`).join('')}</div>`}),
  announce:()=>modal({title:'Guild Announcements',html:`<div class="list">${[['ShinobiMaster','6h ago','We reached Lv. 5! Keep up the great work!'],['KuroSenpai','12h ago','Guild Boss (Normal) has been defeated!'],['Mizuki','1d ago','New weekly missions are now available!'],['ShinobiMaster','3d ago','Guild Battle Season 12 starts soon – sign up!']].map(a=>`<div><span><b>${a[0]}</b> <small>${a[1]}</small><br>${a[2]}</span></div>`).join('')}</div>`}),
  donate:()=>modal({title:'Donate Ryo to Guild',html:`<p>Weekly quest progress: <b>${fmt(gdon)} / 200,000</b></p><label for="gd">Amount (Ryo)</label><input id="gd" type="number" inputmode="numeric" value="${Math.min(80000,Math.max(0,200000-gdon))||10000}" min="1000" step="1000"><p id="gdm"></p><p>Your balance: <b>${fmt(store.s.spendable)} Ryo</b></p>`,
    buttons:[{t:'Cancel',alt:1},{t:'Donate',fn:m=>{const v=Math.floor(+$('#gd',m).value||0),msg=$('#gdm',m);if(v<1000){msg.className='err';msg.textContent='Minimum donation is 1,000 Ryo.';return false}if(v>store.s.spendable){msg.className='err';msg.textContent='Not enough Ryo.';return false}
      store.set({spendable:store.s.spendable-v});gdon+=v;const b=built.guild;b.qt.hidden=b.qb.hidden=false;b.qt.textContent=`${gdon>=200000?'200K':Math.floor(gdon/1000)+'K'} / 200K`;requestAnimationFrame(()=>$('i',b.qb).style.width=Math.min(100,gdon/2000)+'%');toast(gdon>=200000?'Quest complete! +400 Ryo reward':'Thank you for donating '+fmt(v)+' Ryo')}}]}),
  glock:a=>toast(`${a} unlocks after clearing the previous difficulty`),
  lastresult:()=>modal({title:'Guild Boss – Last Result',html:`<p>Shadow Beast Oni · Lv. 3</p><div class="row2"><span>Guild damage</span><b>45,280,000 / 60,000,000</b></div><div class="row2"><span>Progress</span><b>75.4%</b></div><div class="row2"><span>Top damage</span><b>KuroSenpai · 8,450,320</b></div>`})};

/* ---------- HOME ---------- */
INIT.home=()=>{};MODS.home={};

/* ---------- SUMMON REVEAL (Design 01 – cinematic 10-scroll reveal) ---------- */
const RVC=D.reveal.cards,RCOL={Genin:'#c9d2e3',Chunin:'#35e06b',Jonin:'#2aa8ff',Elite:'#b45cff',Legend:'#ffc13a'},RORD=['Legend','Elite','Jonin','Chunin','Genin'];
const ownedCards=new Set();
function doSummon(n){if(summoning)return;/* game-link hook */ if(window.SBGame&&SBGame.gate('summon','summon'))return;const cost=costs[n];
  if(store.s.spendable<cost){noRyo(cost,`Summon ×${n}`);return}
  summoning=true;store.set({spendable:store.s.spendable-cost});
  const res=Array.from({length:n},()=>{const r=roll(true)[0],pool=RVC.map((c,i)=>[c,i]).filter(([c])=>c.r===r),[c,i]=pick(pool),isNew=!ownedCards.has(i);ownedCards.add(i);return {...c,i,isNew}});
  store.s.collection.unshift(...res.map(r=>({name:r.n,rar:r.r,col:RCOL[r.r],img:r.img,ts:Date.now()})));
  const bi=Math.max(...res.map(r=>RAR.findIndex(x=>x[0]===r.r)));store.s.summons.unshift({n,cost,ts:Date.now(),best:RAR[bi]});
  reveal(res,n)}
function reveal(res,n){
  const st=built.summon.st,cv=mk('div','rev',st);cv.setAttribute('role','dialog');cv.setAttribute('aria-modal','true');cv.setAttribute('aria-label','Summon reveal');
  const cols=n===1?1:5;
  cv.innerHTML=`<div class="rvbg"></div><div class="rvhd"><small>THE SCROLLS HAVE ANSWERED</small><h3>Reveal your shinobi</h3><p><b class="cnt">0</b> / ${n} revealed</p></div>
  <div class="rvgrid${n===1?' solo':''}" style="--cols:${cols}">${res.map((r,i)=>`<button class="rvs" data-i="${i}" style="--rc:${RCOL[r.r]};--k:${i}" aria-label="Reveal scroll ${i+1}"><span class="scr"></span><span class="crd"><img alt="${esc(r.n)} – ${r.r}" src="${r.img}"></span>${r.isNew?'<em class="new">NEW!</em>':''}</button>`).join('')}</div>
  <p class="rvtip">Tap a scroll to reveal your shinobi!</p>
  <div class="rvacts"><button class="rbtn blue" data-k="all">Reveal All</button><button class="rbtn gold" data-k="one">Reveal One</button></div>
  <aside class="rvsum" hidden></aside><div class="rvspot" hidden></div><div class="rvlg" hidden></div>`;
  let done=0,busy=false,fin=false;const btns=$$('.rvs',cv),cnt=$('.cnt',cv);
  function open(i,fast){const b=btns[i];if(!b||b.dataset.o)return;b.dataset.o=1;b.classList.add('opening');
    setTimeout(()=>{b.classList.add('open');b.setAttribute('aria-label',`${res[i].n}, ${res[i].r}${res[i].isNew?', new':''}`);const r=res[i].r;
      if(r==='Legend'&&!RM){const l=$('.rvlg',cv);l.hidden=false;l.textContent='LEGEND!';l.classList.remove('go');void l.offsetWidth;l.classList.add('go');setTimeout(()=>l.hidden=true,1500)}
      done++;cnt.textContent=done;if(done===n)setTimeout(finish,700)},fast?(RM?0:380):(RM?0:600))}
  function next(){return btns.findIndex(b=>!b.dataset.o)}
  function revealOne(){if(busy)return;const i=next();if(i<0)return;busy=true;const sp=$('.rvspot',cv);
    if(RM){open(i);busy=false;return}
    sp.hidden=false;sp.classList.remove('go');void sp.offsetWidth;sp.classList.add('go');setTimeout(()=>{sp.hidden=true;open(i,true);busy=false},750)}
  function revealAll(){let k=0;btns.forEach((b,i)=>{if(!b.dataset.o)setTimeout(()=>open(i,true),RM?0:(k++)*170)})}
  function finish(){if(fin)return;fin=true;cv.classList.add('done');$('.rvtip',cv).hidden=true;
    const c={};res.forEach(r=>c[r.r]=(c[r.r]||0)+1);const s=$('.rvsum',cv);s.hidden=false;
    s.innerHTML=`<h4>Summon Summary</h4>${RORD.map(r=>`<div><i style="--rc:${RCOL[r]}"></i><span style="color:${RCOL[r]}">${r}</span><b>${c[r]||0}</b></div>`).join('')}`;
    $('.rvacts',cv).innerHTML=`<button class="rbtn purple" data-k="again">Summon Again <small>×${n} · ${fmt(costs[n])} Ryo</small></button><button class="rbtn gold" data-k="cont">Continue</button>`;
    $('[data-k=cont]',cv).focus()}
  function close(again){cv.remove();summoning=false;if(again)doSummon(n);else{const g=built.summon.el('go');g&&g.focus()}}
  cv.addEventListener('click',e=>{const s=e.target.closest('.rvs');if(s){open(+s.dataset.i);return}const k=e.target.closest('[data-k]');if(!k)return;
    ({all:revealAll,one:revealOne,again:()=>close(true),cont:()=>close(false)})[k.dataset.k]()});
  cv.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();fin?close(false):revealAll()}});
  $('[data-k=one]',cv).focus()}

/* ---------- ADVENTURE (Design 04) ---------- */
const STAGES=[{no:30,n:'Thunderstorm Sky Temple',map:0,e:46,m:65,rw:20034,diff:'HARD'},{no:29,n:'Cursed Spirit Graveyard',map:7,e:60,m:60,rw:18950,diff:'HARD'},{no:28,n:'Volcanic Fortress',map:5,e:55,m:55,rw:17600,diff:'HARD'},{no:27,n:'Crystal Caverns',map:4,e:50,m:50,rw:16300,diff:'NORMAL'},{no:26,n:'Bamboo Forest',map:3,e:45,m:45,rw:15100,diff:'NORMAL'}];
const AHERO=[['Kai','#b45cff'],['Sora','#2aa8ff'],['Aki','#35e06b'],['Ren','#ff4d2a'],['Yuki','#7fd8ff']];
let stg=0,aWork=[1,1,1,1,1],aTimer=null,clearing=false;
store.s.deployed=7;
INIT.adventure=b=>{b.ar=place(mk('div','arena',b.st),272,218,1248,536);b.ar.innerHTML='<img alt="" hidden><div class="afx"></div>';
  b.rest=[[302,938],[507,938],[713,938],[924,938],[1135,938]].map(([x,y])=>{const e=place(mk('div','achip',b.st,'💤 Resting'),x,y,174,34);e.hidden=true;return e});
  aUpd();aLoop()};
function aUpd(){const b=built.adventure;if(!b)return;const s=STAGES[stg];
  b.lv('stitle').innerHTML=`<b>Stage ${s.no}</b><i>${esc(s.n)}</i>`;b.lv('enemies').innerHTML=`<span style="color:#ff5a5a">${s.e}</span>&nbsp;/ ${s.m}`;
  b.lv('reward').textContent=`+${fmt(s.rw)} Ryo`;b.lv('team').textContent=`${store.s.deployed} / 10`;
  const im=$('img',b.ar);im.hidden=!s.map;if(s.map)im.src=`assets/arena${s.map}.webp`;
  STAGES.forEach((_,i)=>{const e=b.el('st'+i);e.classList.toggle('on2',i===stg&&i!==0);e.classList.toggle('dimact',i!==stg&&i===0)});
  b.rest.forEach((c,i)=>c.hidden=!!aWork[i]);b.el('wa').classList.toggle('pu',!aWork.every(Boolean));b.el('ra').classList.toggle('on2',!aWork.some(Boolean))}
store.sub(s=>{const b=built.adventure;if(b)b.lv('team').textContent=`${s.deployed} / 10`});
function aLoop(){clearInterval(aTimer);aTimer=setInterval(()=>{if(cur!=='adventure'||document.hidden||clearing||RM&&Math.random()<.5)return;const w=aWork.filter(Boolean).length;if(!w)return;
  if(Math.random()<w/5)aBomb()},620)}
function aBomb(){const b=built.adventure,fxl=$('.afx',b.ar),s=STAGES[stg],T=52;
  const cx=RI(4,19),cy=RI(1,8),x=cx*T+20,y=cy*T+20,col=pick(AHERO.filter((_,i)=>aWork[i]))[1];
  const bomb=place(mk('i','abomb',fxl),x-15,y-15,30,30);bomb.style.setProperty('--hc',col);
  setTimeout(()=>{bomb.remove();const ex=place(mk('div','ablast',fxl),x-T*2.5,y-T*2.5,T*5,T*5);ex.style.setProperty('--hc',col);setTimeout(()=>ex.remove(),620);
    /* game-link hook: no demo rewards when a real game is connected */ if(!(window.SBGame&&SBGame.live)&&Math.random()<.42&&s.e>0){s.e--;const g=RI(5,10)*50;store.set({adventure:store.s.adventure+g});
      const p=place(mk('div','apop',fxl,`+${g} Ryo → Chest`),x-80,y-40,160,24);setTimeout(()=>p.remove(),1400);aUpd();
      if(s.e===0)aClear()}},RM?0:520)}
function aClear(){clearing=true;const b=built.adventure,s=STAGES[stg];store.set({adventure:store.s.adventure+s.rw});
  const c=place(mk('div','aclear',b.ar,`<b>STAGE ${s.no} CLEAR!</b><span>+${fmt(s.rw)} Ryo sent to your Chest</span>`),0,0,1248,536);
  setTimeout(()=>{c.remove();s.e=s.m;clearing=false;aUpd()},3200)}
MODS.adventure={
  stage:a=>{stg=+a;aUpd();toast(`Stage ${STAGES[stg].no} · ${STAGES[stg].n}`)},
  work:()=>{aWork=[1,1,1,1,1];aUpd();toast('All deployed shinobi are working the stage')},
  rest:()=>{aWork=[0,0,0,0,0];aUpd();toast('Team is resting – chakra recovers, bombing pauses')},
  hero:a=>{const i=+a;aWork[i]=aWork[i]?0:1;aUpd();toast(`${AHERO[i][0]} is now ${aWork[i]?'working':'resting'}`)},
  stageinfo:()=>{const s=STAGES[stg],m=D.ref.maps[(s.map||6)-1];
    modal({title:`Stage ${s.no} · ${esc(s.n)}`,wide:true,html:`<div class="row2"><span>Enemies left</span><b>${s.e} / ${s.m}</b></div><div class="row2"><span>Difficulty</span><b>${s.diff}</b></div><div class="row2"><span>Potential reward</span><b>+${fmt(s.rw)} Ryo</b></div>
      <p>Map board reference: <b>${esc(m.n)}</b></p><img class="lbimg" src="${m.src}" alt="${esc(m.n)} map board" loading="lazy">
      <p>All approved map boards:</p><div class="gal">${D.ref.maps.map((x,i)=>`<button class="gt" data-src="${x.src}" data-t="${esc(x.n)}"><img src="${x.src}" alt="" loading="lazy"><span>Map ${i+1} · ${esc(x.n)}</span></button>`).join('')}</div>`})}};

/* ---------- HEROES (Design 17) ---------- */
const HR=[['Nao of Hidden Leaf','Elite',41,'Lightning Blade',2850,3.2,10,186,600,11750,'Deals high damage to a single target and has a chance to inflict Stun.'],['Aki of Hidden Leaf','Elite',40,'Fire Shuriken',2620,3.1,9.8,138,600,11750,'Throws blazing shuriken that burn enemies along a line.'],
 ['Yuki of Crimson Dusk','Jonin',38,'Frost Blade',2410,3.0,9.7,204,550,9500,'A chilling slash that slows the target.'],['Aki of Ember Ridge','Jonin',37,'Shadow Strike',2350,2.9,9.5,460,480,9500,'Strikes from the shadows for bonus damage.'],
 ['Kai of Hidden Leaf','Jonin',36,'Wind Step',2320,2.8,9.4,400,480,9500,'Dashes forward, increasing movement speed.'],['Yuki of Crimson Dusk','Jonin',35,'Ice Storm',2300,2.7,9.2,320,480,9500,'Calls a storm of ice shards around the hero.'],
 ['Sora of Silent Rain','Jonin',35,'Nature Shield',1980,2.6,9.1,278,480,8500,'Raises a leaf barrier that absorbs damage.'],['Mika of Spirit Fox','Elite',40,'Spirit Fox',2680,2.1,9.6,412,480,11750,'Summons a spirit fox that drains chakra.'],
 ['Ren of Shadow Step','Jonin',37,'Shadow Step',2300,2.8,9.3,310,580,9500,'Blinks a short distance through shadow.'],['Hiko of Stone Fist','Legend',33,'Earth Smash',2700,2.7,9.0,420,500,12500,'Smashes the ground, damaging all nearby enemies.']];
let hsel=0,htab=0,hf={tab:0,q:''},hReady=new Set(),hDep=new Set(),hList=new Set(),hFav=new Set(),hLv={};
const HX=[28,240,452,658,864];
const hRect=i=>{const x=HX[i%5];return i<5?[x,324,x+196,672]:[x,686,x+196,1004]};
INIT.heroes=b=>{const btn=(i,id,r,lbl)=>{const e=place(mk('div','hs top',b.st),r[0],r[1],r[2]-r[0],r[3]-r[1]);e.dataset.a=`fn:${id}:${i}`;e.tabIndex=0;e.setAttribute('role','button');e.setAttribute('aria-label',`${lbl} ${HR[i][0]}`);slice(mk('i','sl',e),'heroes',r);return e};
  b.cb=HR.map((_,i)=>{const [x,y]=hRect(i),r1=i<5?600:940,r2=i<5?636:974,h1=i<5?26:24,h2=i<5?28:26;
    return [btn(i,'reserve',[x+10,r1,x+88,r1+h1],'Reserve'),btn(i,'train',[x+92,r1,x+190,r1+h1],'Train'),btn(i,'sell',[x+10,r2,x+80,r2+h2],'Sell'),btn(i,'ready',[x+84,r2,x+190,r2+h2],'Make battle-ready')]});
  b.badge=HR.map((_,i)=>{const [x,y]=hRect(i);const e=place(mk('div','hbadge',b.st),x+148,y+9,44,19);e.hidden=true;return e});
  b.lvl=HR.map((_,i)=>{const [x,y]=hRect(i);const e=place(mk('div','hlvl',b.st),x+12,y+(i<5?170:165),56,22);e.hidden=true;return e});
  b.det=place(mk('div','hdet',b.st),1086,330,420,354);b.det.hidden=true;
  b.dtab=place(mk('div','htab',b.st),1098,730,396,94);b.dtab.hidden=true;
  b.dfav=place(mk('div','ovstamp heart',b.st,'♥'),1468,332,34,32);b.dfav.hidden=true;
  b.sbg=place(mk('div','srchbg',b.st),1066,232,232,44);b.sbg.hidden=true;b.sin=place(mk('input','srch',b.st),1104,238,188,32);b.sin.hidden=true;b.sin.placeholder='Search heroes…';b.sin.setAttribute('aria-label','Search heroes');
  b.sin.oninput=()=>{hf.q=b.sin.value.trim().toLowerCase();hUpd()};b.sin.onblur=()=>{if(!b.sin.value)b.sin.hidden=b.sbg.hidden=true};
  b.empty=place(mk('div','empty',b.st,'No heroes match this filter'),28,324,1030,680);b.empty.hidden=true;hUpd()};
const hvis=i=>{const h=HR[i];if(hf.q&&!h[0].toLowerCase().includes(hf.q))return false;const t=hf.tab;
  if(t===1)return hReady.has(i);if(t===2)return !hReady.has(i);if(t>=3)return h[1]===['Genin','Chunin','Jonin','Elite','Legend'][t-3];return true};
function hUpd(){const b=built.heroes;if(!b)return;let any=false;
  HR.forEach((h,i)=>{const v=hvis(i);any=any||v;const c=b.el('cd'+i);c.classList.toggle('dim',!v||hList.has(i));c.classList.toggle('sel',i===hsel&&i!==0);b.cb[i].forEach(e=>e.hidden=!v||hList.has(i));
    const bd=b.badge[i],st=hList.has(i)?['LISTED','#f39a12']:hDep.has(i)?['DEPLOYED','#2a7bff']:hReady.has(i)?['READY','#22b35a']:null;bd.hidden=!st||!v&&!hList.has(i);if(st){bd.textContent=st[0];bd.style.background=st[1]}
    const L=hLv[i];b.lvl[i].hidden=!L;if(L)b.lvl[i].textContent='Lv. '+L});
  b.empty.hidden=any;for(let t=0;t<8;t++)b.el('tf'+t).classList.toggle('on2',t===hf.tab&&t!==0);
  const h=HR[hsel],lv=hLv[hsel]||h[2],rc=RCOL[h[1]];b.det.hidden=hsel===0&&!hLv[0];
  if(!b.det.hidden){const r=hRect(hsel);b.det.innerHTML=`<div class="hp"></div><div class="hh"><b>${esc(h[0])}</b><span style="color:#ffcf2a">${'★'.repeat(RAR.findIndex(x=>x[0]===h[1])+1)}</span></div><em style="--rc:${rc}">${h[1].toUpperCase()}</em>
    <div class="hl">Lv. ${lv} / 60<i><s style="width:${Math.round(lv/60*100)}%"></s></i></div><div class="hk"><span style="--rc:${rc}">${esc(h[3])}</span><span style="--rc:${rc}">${h[1]}</span></div>
    <div class="hs3"><div><small>POWER</small><b>${fmt(h[4]+(lv-h[2])*45)}</b></div><div><small>SPEED</small><b>${h[5].toFixed(2)}</b></div><div><small>STAMINA</small><b>${h[6].toFixed(1)}</b></div><div><small>JUTSU</small><b>${RAR.findIndex(x=>x[0]===h[1])+1}</b></div><div><small>RANGE</small><b>3</b></div></div>
    <div class="hc">CHAKRA <span>${h[7]} / ${h[8]}</span><i><s style="width:${Math.round(h[7]/h[8]*100)}%"></s></i></div>`;
    sliceScaled($('.hp',b.det),'heroes',[r[0]+4,r[1]+20,r[2]-4,r[1]+140],196,124)}
  b.dtab.hidden=htab===0&&hsel===0;
  if(!b.dtab.hidden)b.dtab.innerHTML=[`<b>${esc(h[3])}</b><p>${esc(h[10])}</p>`,`<b>Skills</b><p>${esc(h[3])} · Rank jutsu ${RAR.findIndex(x=>x[0]===h[1])+1} · Passive: ${h[1]} aura</p>`,`<b>Chakra ${h[7]} / ${h[8]}</b><p>Each attack costs 1 chakra. Resting heroes recover faster in the Dojo.</p>`,`<b>Info</b><p>Status: ${hDep.has(hsel)?'Deployed':hReady.has(hsel)?'Battle-ready':'Reserve'} · Rarity ${h[1]} · Element skill ${esc(h[3])}</p>`][htab];
  for(let t=0;t<4;t++)b.el('dt'+t).classList.toggle('on2',t===htab&&t!==0);
  b.lv('trainlbl').textContent=`Train ${fmt(h[9])} Ryo`;b.dfav.hidden=!hFav.has(hsel);
  b.el('ddep').classList.toggle('on2',hDep.has(hsel))}
function hTrain(i){const h=HR[i],lv=hLv[i]||h[2];if(lv>=60)return toast('Max level reached');if(store.s.spendable<h[9])return noRyo(h[9],'Training');
  store.set({spendable:store.s.spendable-h[9]});hLv[i]=lv+1;hUpd();toast(`${h[0]} trained to Lv. ${lv+1}`)}
MODS.heroes={
  sel:a=>{hsel=+a;if(!hvis(hsel))return;hUpd()},tab:a=>{hf.tab=+a;hUpd()},dtab:a=>{htab=+a;hUpd()},
  train:a=>hTrain(a==='-1'?hsel:+a),
  ready:a=>{const i=+a;hReady.add(i);hUpd();toast(`${HR[i][0]} is battle-ready`)},
  reserve:a=>{const i=+a;if(hDep.has(i)){hDep.delete(i);store.set({deployed:store.s.deployed-1})}hReady.delete(i);hUpd();toast(`${HR[i][0]} moved to reserve`)},
  deploy:()=>{const i=hsel;if(hDep.has(i)){hDep.delete(i);store.set({deployed:store.s.deployed-1});hUpd();return toast(`${HR[i][0]} withdrawn from the team`)}
    if(store.s.deployed>=10)return modal({title:'Team is full',html:'<p>Up to <b>10</b> shinobi can be deployed at once. Withdraw a hero first.</p>'});
    hReady.add(i);hDep.add(i);store.set({deployed:store.s.deployed+1});hUpd();toast(`${HR[i][0]} deployed (${store.s.deployed}/10)`)},
  sell:a=>{const i=a==='-1'?hsel:+a,h=HR[i],p={Genin:120000,Chunin:250000,Jonin:480000,Elite:900000,Legend:1250000}[h[1]];
    if(hDep.has(i))return toast('Withdraw this hero from the team before selling');
    modal({title:'List Hero on Market',html:`<p><b>${esc(h[0])}</b> · ${h[1]} · Lv. ${hLv[i]||h[2]}</p><label for="hsp">Listing price (Ryo)</label><input id="hsp" type="number" inputmode="numeric" value="${p}" min="1000" step="1000"><p id="hsm">A 2% studio fee applies when it sells.</p>`,
      buttons:[{t:'Cancel',alt:1},{t:'List for sale',fn:m=>{const v=Math.floor(+$('#hsp',m).value||0);if(v<1000){const e=$('#hsm',m);e.className='err';e.textContent='Minimum price is 1,000 Ryo.';return false}hList.add(i);hReady.delete(i);hUpd();toast(`${h[0]} listed for ${fmt(v)} Ryo`)}}]})},
  fav:()=>{hFav.has(hsel)?hFav.delete(hsel):hFav.add(hsel);hUpd()},
  search:()=>{const b=built.heroes;b.sbg.hidden=b.sin.hidden=false;b.sin.focus()},
  sort:(a,el)=>{closeDD();const r=D.heroes.hs.find(h=>h.id==='sort').r,dd=place(mk('div','dd',built.heroes.st),r[0],r[3]+4,null,null);dd.style.width='auto';dd.style.height='auto';
    ['By Rarity','By Level','By Power','Newest'].forEach(t=>{const o=mk('button',t==='By Rarity'?'on':'',dd,t);o.onclick=()=>{closeDD();toast(`${t}: full sorting applies to the live 294-hero roster`);el.focus()}});dd.firstChild.focus()},
  page:()=>toast('Page 1 / 25 – other pages load from your live roster')};

/* ---------- CODEX (Design 16) ---------- */
let cxs=1;
const CXT=['BASICS','PERKS & CHAKRA','ELEMENTS','HERO RANKS','BATTLE TIPS','BOSS GUIDE','REWARDS','FAQ'];
const gal=(arr,cap)=>`<div class="gal">${arr.map(x=>`<button class="gt" data-src="${x.src}" data-t="${esc(cap(x))}"><img src="${x.src}" alt="" loading="lazy"><span>${esc(cap(x))}</span></button>`).join('')}</div>`;
function cxHtml(i){const R=D.ref;switch(i){
  case 0:return `<p>Shinobi Bombers is a grid bomber: heroes move tile by tile, bombs blast in a cross and break wooden crates, while stone blocks and pillars stop the blast.</p>
    <div class="cxg"><div><b>Deploy</b><span>Up to 10 shinobi. Each one hunts automatically and spends 1 chakra per attack.</span></div><div><b>Recovery</b><span>Out of chakra? Deployed heroes rest until 10% of their chakra is back – faster in a better Dojo – then fight again. Battle-ready heroes recover on the bench; Reserve heroes do not.</span></div><div><b>Victory</b><span>Defeat every enemy to advance. Every 25th stage is a guardian encounter.</span></div></div>
    <h4>Adventure map boards</h4>${gal(R.maps,x=>x.n)}`;
  case 2:return `<p>Element and rarity are independent: an element changes a hero's jutsu and aura colour, never their rank.</p><div class="cxg"><div><b>🔥 Fire</b><span>Burns over time</span></div><div><b>💧 Water</b><span>Flowing, sustained damage</span></div><div><b>🌀 Wind</b><span>Speed and mobility</span></div><div><b>🔮 Shadow</b><span>Ambush and bursts</span></div><div><b>⚡ Lightning</b><span>Chains and stuns</span></div></div>
    <h4>Hero models · four directions</h4>${gal([R.models],()=>'All 12 hero models')}`;
  case 3:return `<div class="cxg"><div><b style="color:#c9d2e3">Genin ★</b><span>Starting rank · 1 perk</span></div><div><b style="color:#35e06b">Chunin ★★</b><span>2 perks</span></div><div><b style="color:#2aa8ff">Jonin ★★★</b><span>3 perks</span></div><div><b style="color:#b45cff">Elite ★★★★</b><span>4 perks</span></div><div><b style="color:#ffc13a">Legend ★★★★★</b><span>Top rank · 5 perks</span></div></div>
    <p>Fusion: 3 Genin → Chunin, 3 Chunin → Jonin, 3 Jonin → Elite, 3 Elite → Legend. Legend is the maximum rank and stays tradable on the Market.</p><h4>Rarity aura system</h4>${gal([R.aura,R.auralayer],x=>x===R.aura?'Hero aura system':'Aura render layering')}`;
  case 4:return `<div class="cxg"><div><b>Save burst</b><span>Hold jutsu bursts for boss phases.</span></div><div><b>Balance</b><span>Mix damage dealers with chakra support.</span></div><div><b>Read the board</b><span>Blasts stop at stone – line up crates for chain clears.</span></div><div><b>Rotate</b><span>A Sensei swaps in rested heroes automatically.</span></div></div>
    <h4>Hero animation & skill VFX reference</h4>${gal([R.hayate],()=>'Hayate – animation & VFX reference')}`;
  case 5:return `<p>Each boss has idle, walk, hurt and death animations plus six signature attacks, ending in a rage mode at low HP.</p><h4>Boss concept sheets</h4>${gal(R.bosses,x=>`${x.n} · ${x.t}`)}<h4>Akuma animation sheets</h4>${gal(R.akuma,x=>'Akuma sprite sheet '+(R.akuma.indexOf(x)+1))}`;
  case 6:return `<div class="cxg"><div><b>Adventure Ryo</b><span>Earned while your team works stages and hunts bosses. It collects in your Chest.</span></div><div><b>Claim</b><span>Moves Chest Ryo into your spendable balance – not an on-chain withdrawal.</span></div><div><b>Withdraw</b><span>Example rules: min 100,000 Ryo, once per 24h, 2% studio fee.</span></div><div><b>Deposit</b><span>Wallet tokens become Ryo after on-chain confirmation.</span></div></div>
    <p>Boss Hunt rewards include Ryo, Legend & Elite fragments, jutsu scrolls, upgrade stones, skill tomes, boss materials and chest keys.</p><p><button class="gb" data-cx="chest">Open Chest</button></p>`;
  case 7:return `<div class="faq"><details open><summary>How many heroes can I deploy?</summary><p>Up to 10 at once.</p></details><details><summary>Can Legend heroes be fused further?</summary><p>No – Legend is the top rank. Legends can still be traded on the Market.</p></details><details><summary>Where do Adventure rewards go?</summary><p>Into your Chest. Claim them to make them spendable.</p></details><details><summary>Do elements change rarity?</summary><p>No. Element and rarity are separate.</p></details><details><summary>Why is a button marked "coming next"?</summary><p>Those screens are still being designed.</p></details></div>`}}
INIT.codex=b=>{b.cx=place(mk('div','cxp',b.st),306,212,896,698);b.cx.hidden=true;
  b.cx.addEventListener('click',e=>{if(e.target.closest('[data-cx=chest]'))window.SB.openChest()})};
MODS.codex={sec:a=>{cxs=+a;const b=built.codex;for(let i=0;i<8;i++){const e=b.el('cs'+i);e.classList.toggle('on2',i===cxs&&i!==1);e.classList.toggle('dimact',i===1&&cxs!==1)}
    b.cx.hidden=cxs===1;if(cxs!==1){b.cx.innerHTML=`<h2>${CXT[cxs]}</h2><small class="cxn">Reference art · values are illustrative</small><div class="cxb">${cxHtml(cxs)}</div>`;b.cx.scrollTop=0}},
  elem:a=>toast(['Fire – burns enemies over time','Water – flowing sustained damage','Wind – speed and mobility','Shadow – ambush and burst damage','Lightning – chains between foes and stuns'][+a])};

/* ---------- CHAT (Design 15) ---------- */
const CHN=['GLOBAL CHAT','GUILD CHAT','TEAM CHAT','DIRECT MESSAGES','TRADE CHAT','SYSTEM','EVENT','HELP'];
const AV={ShadowKage:[322,356,380,404],NinjaMaster:[322,408,380,456],RyoSenpai:[322,522,380,572],KuroFox:[322,590,380,640],EmberLeaf:[322,660,380,710],SakuraVolt:[322,732,380,782]};
const CMSG={1:[['KuroSenpai','Guild boss at 75%! Everyone hit it before reset.'],['YukiChan','Donated 50K Ryo for the weekly quest ✅'],['ShinobiMaster','Guild Battle sign-ups close soon – be ready!']],
 2:[['ShadowKage','Party ready? Akuma at 21:00.'],['RyoSenpai','Bringing Sora for chakra support.']],3:[['NinjaMaster','Still interested in the Legend Fragments? 3 left.']],
 4:[['NinjaMaster','WTS Legend Fragment ×3 – check Market'],['EmberLeaf','WTB Upgrade Stones, paying well']],5:[['System','Welcome to Shinobi Bombers! Keep your wallet seed phrase private – staff will never ask for it.'],['System','Weekend Boost Event is live.']],
 6:[['System','Weekend Boost Event: increased drop rates and rewards – 3d 12h 45m left.'],['System','Guild War sign-up open until Jan 28.']],7:[['System','Tip: open Codex for perks, elements and boss guides.'],['System','Need help? Use Report for abuse or bugs.']]};
const AMB=[['ShadowKage','Raid for Akuma in 10 min, 1 spot left!'],['EmberLeaf','Dojo tier III is worth it 🔥'],['SakuraVolt','Anyone in World 2 boss hunt?'],['RyoSenpai','ShadowLegacy is recruiting – PM me'],['KuroFox','Fusion just gave me a Jonin 🎉'],['NinjaMaster','Selling Upgrade Stones in Market']];
let chi=0,chLast=0;const chLog={0:[]};
const hhmm=()=>{const d=new Date();return d.toTimeString().slice(0,5)};
function chRow(name,text,mine){const sys=name==='System';const av=AV[name];
  const r=mk('div','cmsg'+(sys?' sys':'')+(mine?' me':''));r.innerHTML=`<i class="av"></i><b>${sys?'[System]':esc(name)}</b>${sys?'':`<span class="lvc">Lv. ${mine?42:RI(60,75)}</span>`}<p>${esc(text)}</p><time>${hhmm()}</time>`;
  const a=$('.av',r);if(sys)a.textContent='⚙️';else if(mine)sliceScaled(a,'home',[1270,140,1366,232],50,48);else if(av)sliceScaled(a,'chat',av,50,48);else a.textContent=name[0];return r}
INIT.chat=b=>{b.list=place(mk('div','chl',b.st),298,352,916,460);b.list.style.background=D.chat.bg.list;b.list.setAttribute('aria-live','polite');b.list.setAttribute('role','log');
  b.ttl=place(mk('div','chttl',b.st),364,198,420,34);b.ttl.style.background=D.chat.bg.title;b.ttl.hidden=true;
  b.inp=place(mk('input','chin',b.st),624,836,420,38);b.inp.style.background=D.chat.bg.inp;b.inp.maxLength=200;b.inp.placeholder='Type your message...';b.inp.setAttribute('aria-label','Chat message');
  b.cnt=place(mk('span','chcnt',b.st,'0 / 200'),1044,846,52,20);b.cnt.style.background=D.chat.bg.inp;
  b.inp.oninput=()=>b.cnt.textContent=`${b.inp.value.length} / 200`;b.inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();MODS.chat.send()}};
  chDraw();setInterval(()=>{if(cur==='chat'&&!document.hidden&&chi===0&&Math.random()<.5){const [n,t]=pick(AMB);chAdd(0,n,t)}},12000)};
function chDraw(){const b=built.chat;b.list.innerHTML='';if(chi===0){const s=mk('div','chorig',b.list);slice(s,'chat',[298,352,1214,812])}
  (chi===0?chLog[0]:(chLog[chi]=chLog[chi]||(CMSG[chi]||[]).map(([n,t])=>({n,t})))).forEach(m=>b.list.appendChild(chRow(m.n,m.t,m.me)));
  b.ttl.hidden=chi===0;b.ttl.textContent=CHN[chi];b.list.scrollTop=b.list.scrollHeight;
  for(let i=0;i<8;i++){const e=b.el('ch'+i);e.classList.toggle('on2',i===chi&&i!==0);e.classList.toggle('dimact',i===0&&chi!==0)}}
function chAdd(c,n,t,me){(chLog[c]=chLog[c]||(CMSG[c]||[]).map(([n,t])=>({n,t}))).push({n,t,me});if(c===chi){const b=built.chat;b.list.appendChild(chRow(n,t,me));b.list.scrollTo({top:b.list.scrollHeight,behavior:RM?'auto':'smooth'})}}
MODS.chat={
  chan:a=>{chi=+a;chDraw()},
  send:()=>{const b=built.chat,v=b.inp.value.trim();if(!v){b.inp.focus();return}const n=Date.now();if(n-chLast<1000)return toast('Slow down – one message per second');chLast=n;
    if(chi===5||chi===6)return toast('This channel is read-only');chAdd(chi,'You',v,true);b.inp.value='';b.cnt.textContent='0 / 200';b.inp.focus();
    const w=v.match(/^\/w\s+(\S+)/);if(chi===0&&Math.random()<.6||w)setTimeout(()=>{const [nn]=pick(AMB);chAdd(chi,w?w[1]:nn,w?'Got it, thanks!':pick(['Nice!','gg 👍','Welcome, shinobi!','Count me in','Same here 😄']))},RI(1500,3200))},
  chanpick:(a,el)=>{closeDD();const r=el.getBoundingClientRect(),st=built.chat.st,sc=st.getBoundingClientRect().width/D.chat.W,dd=place(mk('div','dd',st),(r.left-st.getBoundingClientRect().left)/sc,(r.top-st.getBoundingClientRect().top)/sc-(el.dataset.id==='isel'?300:-44),null,null);dd.style.width='auto';dd.style.height='auto';
    ['Global','Guild','Team','Direct Messages','Trade','System','Event','Help'].forEach((t,i)=>{const o=mk('button',i===chi?'on':'',dd,t);o.onclick=()=>{closeDD();chi=i;chDraw();el.focus()}});dd.firstChild.focus()},
  emoji:(a,el)=>{closeDD();const st=built.chat.st,dd=place(mk('div','dd emo',st),444,640,null,null);dd.style.width='auto';dd.style.height='auto';
    ['😀','😂','🔥','👍','🎉','⚔️','💣','🥷','💎','😎','🙏','❤️'].forEach(t=>{const o=mk('button','',dd,t);o.onclick=()=>{const b=built.chat;b.inp.value=(b.inp.value+t).slice(0,200);b.inp.oninput();closeDD();b.inp.focus()}});dd.firstChild.focus()},
  attach:()=>modal({title:'Share a Hero',html:`<p>Link one of your heroes in chat:</p><div class="list">${HR.slice(0,5).map((h,i)=>`<div><span><b>${esc(h[0])}</b> <small>${h[1]} · Lv. ${hLv[i]||h[2]}</small></span><button class="gb" data-h="${i}">Share</button></div>`).join('')}</div>`,
    onOpen:m=>m.addEventListener('click',e=>{const x=e.target.closest('[data-h]');if(!x)return;const b=built.chat;b.inp.value=`[Hero: ${HR[+x.dataset.h][0]}] `;b.inp.oninput();closeModal();b.inp.focus()})}),
  whisper:a=>{const b=built.chat;b.inp.value=a?`/w ${a} `:'/w ';b.inp.oninput();b.inp.focus()},
  online:()=>modal({title:'Online Ninjas (1,284)',html:`<div class="list">${[['NinjaMaster',68,'In Dojo'],['ShadowKage',72,'Boss Hunt'],['RyoSenpai',70,'In Market'],['KuroFox',75,'In Adventure'],['EmberLeaf',65,'Idle'],['SakuraVolt',71,'Boss Hunt']].map(r=>`<div><span><b>${r[0]}</b> <small>Lv. ${r[1]}</small></span><small>${r[2]}</small></div>`).join('')}</div><p>Showing friends and recent contacts.</p>`}),
  party:()=>modal({title:'Create Party',html:'<label for="pn">Party name</label><input id="pn" maxlength="24" value="Akuma Raid"><p>Up to 4 shinobi. Invite friends from the online list.</p>',buttons:[{t:'Cancel',alt:1},{t:'Create',fn:m=>{const v=$('#pn',m).value.trim()||'Party';chi=2;chDraw();chAdd(2,'System',`Party "${v}" created. Invite your friends!`);}}]}),
  invite:()=>modal({title:'Invite',html:'<label for="iv">Player name</label><input id="iv" maxlength="24" placeholder="e.g. ShadowKage">',buttons:[{t:'Cancel',alt:1},{t:'Send invite',fn:m=>{const v=$('#iv',m).value.trim();if(!v){toast('Enter a player name');return false}toast(`Invite sent to ${v}`)}}]}),
  report:()=>modal({title:'Report',html:'<label for="rp">What happened?</label><textarea id="rp" rows="3" maxlength="300"></textarea><p>Reports go to moderators with the last messages attached.</p>',buttons:[{t:'Cancel',alt:1},{t:'Submit',fn:m=>{if(!$('#rp',m).value.trim()){toast('Please describe the issue');return false}toast('Report submitted – thank you')}}]})};

/* ---------- DOJO (Design 09) ---------- */
const DT=[['Training Grounds',1,0],['Apprentice Dojo',2,1800000],['Shinobi Dojo',5,6000000],['Veteran Dojo',8,13500000],['Master Dojo',11,24000000],['Grandmaster Dojo',14,37500000],['Legendary Dojo',17,54000000]];
const DY=[160,206,251,299,348,399,450];let dcur=1,dskin=0,dret=0,dhired=true,dch=false;
INIT.dojo=b=>{b.ring=place(mk('div','dring',b.st),0,0,0,0);b.ring.hidden=true;
  b.chips=DY.map(y=>{const e=place(mk('div','dchip',b.st),1552,y-11,64,22);e.hidden=true;return e});
  b.sk=place(mk('div','dskin',b.st),110,650,476,142);b.sk.hidden=true;slice(b.sk,'dojo',[110,650,586,792]);
  b.skr=place(mk('div','dskr',b.st),206,796,62,64);b.skr.hidden=true;
  b.rp=[748,828,908,986,1066].map((x,i)=>{const e=place(mk('div','drp',b.st,(50+i*10)+'%'),x,716,70,28);e.hidden=true;return e});
  b.off=place(mk('div','doff',b.st,'OFF'),628,836,92,32);b.off.style.background=D.dojo.bg.hired;b.off.hidden=true;
  b.tog=place(mk('div','dtog',b.st,'OFF'),1080,808,50,18);b.tog.hidden=true;
  b.tl=place(mk('div','dtl',b.st,'TURN ON'),1022,838,120,30);b.tl.hidden=true;dUpd()};
function dUpd(){const b=built.dojo;if(!b)return;const nx=dcur+1;
  b.lv('upcost').textContent=nx<DT.length?`UPGRADE  -  ${fmt(DT[nx][2])} Ryo`:'MAX TIER REACHED';b.el('upg').classList.toggle('dim',nx>=DT.length);
  b.chips.forEach((c,i)=>{c.hidden=!dch;const s=i<dcur?['Owned','own']:i===dcur?['Active','act']:i===nx?['Next','nxt']:['Locked','lck'];c.textContent=s[0];c.className='dchip '+s[1]});
  b.sk.hidden=dskin===0;b.sk.style.filter=['','grayscale(1) brightness(.7) contrast(1.25)','hue-rotate(-25deg) saturate(1.6) brightness(1.15)','hue-rotate(160deg) saturate(1.5) brightness(1.05)'][dskin];
  b.skr.hidden=dskin===0;const sx=[206,282,356,432][dskin];b.skr.style.left=sx+'px';
  b.rp.forEach((e,i)=>{e.hidden=dret===0&&!b._rp;e.classList.toggle('on',i===dret)});
  b.off.hidden=b.tog.hidden=b.tl.hidden=dhired}
function dFocus(r){const b=built.dojo;place(b.ring,...r);b.ring.hidden=false;b.ring.classList.remove('go');void b.ring.offsetWidth;b.ring.classList.add('go');
  if(innerWidth<900)b.ring.scrollIntoView({behavior:RM?'auto':'smooth',block:'center'});clearTimeout(b._rt);b._rt=setTimeout(()=>b.ring.hidden=true,1900)}
MODS.dojo={
  focus:a=>({svc:()=>dFocus([38,226,800,366]),upg:()=>dFocus([874,88,864,502]),sen:()=>dFocus([96,598,1568,288])})[a](),
  tier:a=>{const i=+a,t=DT[i],st=i<dcur?'Owned':i===dcur?'Active':i===dcur+1?'Next':'Locked';
    modal({title:t[0],html:`<div class="row2"><span>Recovery</span><b>${t[1]} chakra / min</b></div><div class="row2"><span>Status</span><b>${st}</b></div><div class="row2"><span>Price</span><b>${t[2]?fmt(t[2])+' Ryo':'Free'}</b></div><p>Recovery applies to every resting hero, with no slot limit.</p>`,
      buttons:st==='Next'?[{t:'Close',alt:1},{t:'Upgrade',fn:()=>{setTimeout(MODS.dojo.upgrade,50)}}]:[{t:'Close'}]})},
  upgrade:()=>{const nx=dcur+1;if(nx>=DT.length)return toast('Your dojo is at the highest tier');const c=DT[nx][2];if(store.s.spendable<c)return noRyo(c,`Upgrading to ${DT[nx][0]}`);
    modal({title:`Upgrade to ${DT[nx][0]}`,html:`<div class="row2"><span>Recovery</span><b>${DT[dcur][1]}/min → ${DT[nx][1]}/min</b></div><div class="row2"><span>Cost</span><b>${fmt(c)} Ryo</b></div><div class="row2"><span>Your balance</span><b>${fmt(store.s.spendable)} Ryo</b></div>`,
      buttons:[{t:'Cancel',alt:1},{t:'Upgrade',fn:()=>{if(store.s.spendable<c)return false;store.set({spendable:store.s.spendable-c});dcur=nx;dch=true;dUpd();dFocus([1200,DY[nx]-24,528,48]);toast(`${DT[nx][0]} unlocked – ${DT[nx][1]} chakra/min`)}}]})},
  skin:a=>{dskin=a==='-1'?(dskin+3)%4:a==='+1'?(dskin+1)%4:+a;dUpd();toast(['Original','Shadow','Frost','Flame'][dskin]+' sensei skin')},
  ret:a=>{dret=+a;built.dojo._rp=1;dUpd();toast(`Exhausted heroes return to battle at ${50+dret*10}% chakra`)},
  hire:()=>{dhired=!dhired;dUpd();toast(dhired?'Sensei hired – auto rotation ON':'Sensei turned off – auto rotation paused')}};

/* ---------- BOSS PROFILES (Design 08) ---------- */
MODS['boss-hunt'].bossinfo=a=>{const bo=D.ref.bosses.find(x=>x.n.startsWith(a));if(!bo)return;
  modal({title:`${bo.n} · ${bo.t}`,wide:true,html:`${a==='Akuma'?'<p>Current legendary boss – challenge it from Prepare Your Team.</p>':`<p class="err">Locked – defeat Akuma to unlock ${bo.n}.</p>`}<img class="lbimg" src="${bo.src}" alt="${esc(bo.n)} concept sheet" loading="lazy">`})};

/* ---------- shared gallery lightbox ---------- */
document.addEventListener('click',e=>{const g=e.target.closest('.gt');if(!g)return;modal({title:g.dataset.t,wide:true,html:`<img class="lbimg" src="${g.dataset.src}" alt="${g.dataset.t}">`})});

/* ---------- boot ---------- */
/* game-link hook: expose the site's own UI helpers to website/game-link (no game or balance data) */
window.SBApp={MODS,toast,modal,closeModal,go,root:app};if(window.SBGame)SBGame.attach(window.SBApp);
store.sub(()=>{});route();
/* warm next screens lazily, one at a time, when idle */
(function warm(q){if(!q.length)return;const k=q.shift(),i=new Image();i.onload=i.onerror=()=>setTimeout(()=>warm(q),400);i.src=D[k].img})(SCR.filter(k=>k!==cur));
})();
