/* ---------- SUMMON REVEAL (Design 01 – cinematic 10-scroll reveal) ---------- */
const RVC=D.reveal.cards,RCOL={Genin:'#c9d2e3',Chunin:'#35e06b',Jonin:'#2aa8ff',Elite:'#b45cff',Legend:'#ffc13a'},RORD=['Legend','Elite','Jonin','Chunin','Genin'];
const ownedCards=new Set();
function doSummon(n){if(summoning)return;const cost=costs[n];
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
    if(Math.random()<.42&&s.e>0){s.e--;const g=RI(5,10)*50;store.set({adventure:store.s.adventure+g});
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
    <div class="cxg"><div><b>Deploy</b><span>Up to 10 shinobi. Each one hunts automatically and spends 1 chakra per attack.</span></div><div><b>Recovery</b><span>Out of chakra? Heroes nap and recover – faster in the Dojo.</span></div><div><b>Victory</b><span>Defeat every enemy to advance. Every 25th stage is a guardian encounter.</span></div></div>
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
INIT.chat=b=>{b.list=place(mk('div','chl',b.st),298,352,916,460);b.list.setAttribute('aria-live','polite');b.list.setAttribute('role','log');
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
