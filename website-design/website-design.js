/* Website designs on the real game screens.
 *
 * Draws the Shinobi Bombers website screens (artwork + hotspots + animations from website/) above the matching
 * game menu and connects them to the game's own navigation (go), live account state (RyoPayments, AdventureChest,
 * BetaWallet, S, BattleRoster) and the real Chest manager (GlobalChestUI). It never changes balances, ownership or
 * saves itself: every action calls an existing game function. Pages without a website screen keep the game UI.
 */
(() => {
  'use strict';
  const BASE = 'assets/website-design/';
  /* website screen → game page (go(page, mode)) */
  const ROUTE = { home: [5], heroes: [1], adventure: [0], summon: [2], fusion: [6], dojo: [4, 0], market: [4, 1], 'boss-hunt': [8], codex: [3] };
  /* game page → website screen shown there (screens enabled in this build) */
  const SHOWN = { '5': 'home', '3': 'codex' };
  const RCOL = ['#c9d2e3', '#35e06b', '#2aa8ff', '#b45cff', '#ffc13a'], RNAME = ['Genin', 'Chunin', 'Jonin', 'Elite', 'Legend'];
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fmt = n => (typeof n === 'number' && Number.isFinite(n) ? Math.floor(n).toLocaleString('en-US') : '—');
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const R = (a, b) => a + Math.random() * (b - a);
  let D = null, layer = null, cur = null, dlg = null, toastEl = null;
  const built = {};

  function mk(tag, cls, parent, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; parent && parent.appendChild(e); return e; }
  function place(e, x, y, w, h) { Object.assign(e.style, { left: x + 'px', top: y + 'px' }); if (w != null) e.style.width = w + 'px'; if (h != null) e.style.height = h + 'px'; return e; }
  function slice(e, s, r) { e.style.backgroundImage = `url(${BASE + s.img})`; e.style.backgroundSize = `${s.W}px ${s.H}px`; e.style.backgroundPosition = `${-r[0]}px ${-r[1]}px`; }

  /* ---------- live game state (read-only) ---------- */
  function ledger() { return window.RyoPayments ? RyoPayments.state : {}; }
  function account() { const l = ledger(); return l.authenticated ? l.account : null; }
  function chestPending() { const c = window.AdventureChest && AdventureChest.snapshot; const a = account(); return c && a && c.owner === a && c.chest ? Number(c.chest.pending) : null; }
  /* same hero list the game's own menus count (server-owned and local practice heroes) */
  function owned() { try { return S.h.slice(); } catch { return []; } }
  function deployed() { return owned().filter(h => h.on).sort((a, b) => b.r - a.r || b.lv - a.lv || a.id - b.id); }

  /* ---------- dialogs ---------- */
  function notice(title, text) {
    if (!dlg) { dlg = mk('dialog', 'sbw-dialog', document.body); }
    dlg.innerHTML = `<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="sbw-acts"><button type="button" class="sbw-btn">Close</button></div>`;
    $('button', dlg).onclick = () => dlg.close();
    if (!dlg.open) dlg.showModal();
  }
  function toast(t) { if (!toastEl) toastEl = mk('div', 'sbw-toast', document.body); toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('on'), 2200); }
  function openChest() {
    if (account() && window.GlobalChestUI && GlobalChestUI.ready) GlobalChestUI.open();
    else notice('Chest', 'Sign in with your wallet to open your Chest.');
  }
  function editNickname() {
    if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body);
    dlg.innerHTML = '<h2>Your Shinobi name</h2><form><label>Nickname <input maxlength="14" required></label><div class="sbw-acts"><button type="button" class="sbw-btn sbw-alt">Cancel</button><button class="sbw-btn">Save</button></div></form>';
    const input = $('input', dlg); input.value = (window.S && S.nick) || '';
    $('.sbw-alt', dlg).onclick = () => dlg.close();
    $('form', dlg).onsubmit = e => { e.preventDefault(); if (!input.value.trim()) return; const ni = document.getElementById('ni'); if (ni && typeof nick === 'function') { ni.value = input.value; nick(); if (typeof save === 'function') save(); window.ReferenceLayout && ReferenceLayout.refresh && ReferenceLayout.refresh(); } dlg.close(); refresh(); };
    if (!dlg.open) dlg.showModal(); input.focus();
  }

  /* ---------- actions ---------- */
  const SOON = { guild: 'Guilds are coming soon.', chat: 'Chat is coming soon.' };
  function goScreen(k) {
    if (k.startsWith('guild')) return notice('Guild', SOON.guild);
    if (k === 'chat') return notice('Chat', SOON.chat);
    const r = ROUTE[k]; if (r) go(r[0], r[1]);
  }
  const HOME = {
    'logo': () => {}, 'prof': editNickname, 'mng': () => go(1), 't1': () => go(1), 't2': () => go(1), 't3': () => go(1), 't4': () => go(1), 't5': () => go(1),
    'ev': () => notice('Events', 'No active event is configured. Check back for upcoming events.'),
    'go1': () => notice('Daily missions', 'Daily missions are not available yet.'), 'go2': () => notice('Daily missions', 'Daily missions are not available yet.'), 'go3': () => notice('Daily missions', 'Daily missions are not available yet.'),
    'season': () => notice('Season 1', 'Seasons are not available yet.'), 'tut': () => go(3), 'news': () => notice('News', 'No news has been posted yet.'),
    'sup': () => notice('Support', 'Open Tools in the game header for the community links.'), 'chatbar': () => notice('Chat', SOON.chat), 'c-gld': () => notice('Guild', SOON.guild)
  };
  function act(k, h, el) {
    const a = h.a || '', [t, ...rest] = a.split(':'), arg = rest.join(':');
    if (k === 'home' && HOME[h.id]) return HOME[h.id]();
    if (t === 'go') return goScreen(arg);
    if (t === 'gcat') return notice('Guild', SOON.guild);
    if (t === 'chest' || t === 'deposit') return openChest();
    if (t === 'wallet') return window.ShinobiBetaUI ? ShinobiBetaUI.open() : openChest();
    if (t === 'codex') return go(3);
    if (t === 'soon') return notice(arg, arg + ' is coming soon.');
    if (t === 'toast') return toast(arg);
    if (t === 'fn') { const [fn, ...p] = arg.split(':'); const m = (MODS[k] || {})[fn]; if (m) return m(p.join(':'), el); }
  }

  /* ---------- screen building (mirrors website/app.js) ---------- */
  function build(k) {
    const s = D.screens[k], sec = mk('section', 'sbw-scr', layer); sec.setAttribute('aria-label', k);
    const st = mk('div', 'sbw-stage', sec); st.style.width = s.W + 'px'; st.style.height = s.H + 'px';
    const im = mk('img', 'sbw-base', st); im.src = BASE + s.img; im.alt = ''; im.decoding = 'async';
    s.hs.forEach((h, i) => {
      const r = h.r, e = mk('div', 'hs ' + (h.c || ''), st); place(e, r[0], r[1], r[2] - r[0], r[3] - r[1]); e.style.setProperty('--i', i % 17); e.dataset.sbwid = h.id;
      slice(mk('i', 'sl', e), s, r);
      if (h.a) { e.tabIndex = 0; e.setAttribute('role', 'button'); e.setAttribute('aria-label', h.l || h.id); e.addEventListener('click', () => act(k, h, e)); e.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act(k, h, e); } }); }
      else e.classList.add('nolink');
      if ((h.c || '').includes('nav') && h.a === 'go:' + k) e.setAttribute('aria-current', 'page');
    });
    // header Chest button
    const c = s.chest, cb = mk('div', 'hs chestbtn', st); place(cb, c.r[0], c.r[1], c.r[2] - c.r[0], c.r[3] - c.r[1]); cb.tabIndex = 0; cb.setAttribute('role', 'button'); cb.setAttribute('aria-label', 'Open your Chest');
    slice(mk('i', 'sl', cb), s, c.r); const lbl = place(mk('span', 'cbt sbw-chest', cb), c.tx, c.ty, c.tw, c.th); lbl.style.fontSize = c.fs + 'px'; lbl.dataset.fs = c.fs;
    const dot = place(mk('i', 'cdot', cb), c.dx, c.dy, c.ds, c.ds); dot.hidden = true;
    cb.addEventListener('click', openChest); cb.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openChest(); } });
    // live text slots from the website data (Ryo balance etc.)
    const live = {};
    s.live.forEach(l => { const e = mk('span', 'lv', st); place(e, l.x, l.y, l.w, l.h); e.style.fontSize = l.fs + 'px'; e.dataset.fs = l.fs; e.style.color = l.c; live[l.id] = e; });
    // header covers: wallet address and gems
    const covers = {};
    for (const key of ['wallet', 'gems']) { const t = s.hdr && s.hdr[key]; if (!t) continue; const e = place(mk('span', 'sbw-cover', st), t.x, t.y, t.w, t.h); e.style.background = t.bg; e.style.fontSize = t.fs + 'px'; e.dataset.fs = t.fs; covers[key] = e; }
    // animation layers
    s.fx.forEach(f => {
      const e = mk('div', 'fx ' + f.t, st); place(e, f.x - f.w / 2, f.y - f.h / 2, f.w, f.h); if (f.s) e.style.cssText += ';' + f.s;
      if (f.t === 'embers') { const n = +(/--n:(\d+)/.exec(f.s || '') || [0, 20])[1]; for (let j = 0; j < n; j++) { const p = mk('i', '', e); p.style.left = R(0, f.w) + 'px'; p.style.setProperty('--dx', R(-50, 50) + 'px'); p.style.setProperty('--dy', -R(f.h * .6, f.h * 1.1) + 'px'); p.style.animationDuration = R(2.5, 6) + 's'; p.style.animationDelay = -R(0, 6) + 's'; } }
      if (f.t === 'spinc') slice(e, s, [f.x - f.w / 2, f.y - f.h / 2, f.x + f.w / 2, f.y + f.h / 2]);
    });
    const pt = mk('div', 'petals', st); pt.innerHTML = Array.from({ length: 22 }, () => `<i style="left:${R(0, s.W)}px;--x:${R(-160, 160)}px;animation-duration:${R(9, 18)}s;animation-delay:${-R(0, 16)}s;scale:${R(.6, 1.4)}"></i>`).join('');
    $$('.hs.card', st).forEach(e => { e.addEventListener('mousemove', ev => { if (RM) return; const r = e.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width - .5, y = (ev.clientY - r.top) / r.height - .5; e.firstChild.style.transform = `perspective(700px) rotateY(${x * 9}deg) rotateX(${-y * 9}deg) translateY(-4px) scale(1.03)`; }); e.addEventListener('mouseleave', () => { e.firstChild.style.transform = ''; }); });
    const b = { sec, st, s, live, covers, label: lbl, dot, chestEl: cb };
    built[k] = b; (INIT[k] || (() => {}))(b); return b;
  }

  /* ---------- per-screen live content ---------- */
  const INIT = {}, MODS = {}, PAINT = {};
  INIT.home = b => {
    const cover = (x, y, w, h, bg, fs, color, cls = '') => { const e = place(mk('span', 'sbw-cover sbw-left ' + cls, b.st), x, y, w, h); e.style.background = bg; e.style.fontSize = fs + 'px'; e.dataset.fs = fs; e.style.color = color; return e; };
    b.name = cover(1380, 138, 80, 28, '#01060e', 25, '#ffffff', 'sbw-click'); b.name.title = 'Set your nickname';
    b.name.addEventListener('click', editNickname);
    b.line = cover(1380, 172, 230, 23, '#000712', 18, '#e2edf6');
    b.row = cover(1386, 204, 248, 24, '#000b19', 18, '#7de5ff');
    b.avatar = place(mk('canvas', 'sbw-avatar', b.st), 1271, 139, 95, 92); b.avatar.width = 190; b.avatar.height = 184;
    b.tiles = [1270, 1345, 1420, 1494, 1569].map((x, i) => { const t = place(mk('div', 'sbw-tile', b.st), x, 302, 66, 122); const cv = mk('canvas', '', t); cv.width = 132; cv.height = 150; mk('b', '', t); t.addEventListener('click', () => go(1)); return t; });
  };
  PAINT.home = (b, now) => {
    const nickName = (window.S && S.nick) || 'Shinobi', mine = owned(), dep = deployed();
    setText(b.name, nickName); setText(b.line, `${mine.length} Shinobi · ${dep.length}/10 deployed`);
    let ready = 0; try { ready = BattleRoster.list().length; } catch {}
    setText(b.row, `Battle-ready ${ready} / 50`);
    const PM = window.PlayerModels;
    const draw = (cv, h, cx, by, sc) => { const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); if (h && PM && PM.loaded) { try { PM.drawPortrait(g, h, cx, by, sc, now); } catch {} } };
    draw(b.avatar, dep[0] || mine[0], 95, 178, 3.4);
    b.tiles.forEach((t, i) => {
      const h = dep[i]; t.classList.toggle('sbw-empty', !h); t.style.setProperty('--rc', h ? RCOL[h.r] : '#3a4a7a');
      t.lastChild.textContent = h ? `★ Lv. ${h.lv}` : '+ Deploy'; t.title = h ? `${h.name} · ${RNAME[h.r]} · Lv. ${h.lv}` : 'Deploy a hero from Heroes';
      draw(t.firstChild, h, 66, 146, 2.7);
    });
  };
  /* Codex: section panel content (same text as the website) */
  const CXT = ['BASICS', 'PERKS & CHAKRA', 'ELEMENTS', 'HERO RANKS', 'BATTLE TIPS', 'BOSS GUIDE', 'REWARDS', 'FAQ'];
  const gal = (arr, cap) => `<div class="gal">${arr.map(x => `<button class="gt" type="button" data-src="${BASE + x.src}" data-t="${esc(cap(x))}"><img src="${BASE + x.src}" alt="" loading="lazy"><span>${esc(cap(x))}</span></button>`).join('')}</div>`;
  function cxHtml(i) {
    const R2 = D.ref; switch (i) {
      case 0: return `<p>Shinobi Bombers is a grid bomber: heroes move tile by tile, blasts travel in a cross and break wooden crates, while stone blocks stop them.</p><div class="cxg"><div><b>Deploy</b><span>Up to 10 shinobi. Each one hunts automatically and spends 1 chakra per attack.</span></div><div><b>Recovery</b><span>Out of chakra? Heroes nap and recover – faster in the Dojo.</span></div><div><b>Victory</b><span>Defeat every enemy to advance. Every 25th stage is a guardian encounter.</span></div></div><h4>Adventure map boards</h4>${gal(R2.maps, x => x.n)}`;
      case 2: return `<p>Element and rarity are independent: an element changes a hero's jutsu and aura colour, never their rank.</p><h4>Hero models · four directions</h4>${gal([R2.models], () => 'All 12 hero models')}`;
      case 3: return `<div class="cxg"><div><b style="color:#c9d2e3">Genin ★</b><span>Starting rank · 1 perk</span></div><div><b style="color:#35e06b">Chunin ★★</b><span>2 perks</span></div><div><b style="color:#2aa8ff">Jonin ★★★</b><span>3 perks</span></div><div><b style="color:#b45cff">Elite ★★★★</b><span>4 perks</span></div><div><b style="color:#ffc13a">Legend ★★★★★</b><span>Top rank · 5 perks</span></div></div><p>Fusion combines three heroes of the same rank. Legend is the maximum rank and stays tradable.</p><h4>Rarity aura system</h4>${gal([R2.aura, R2.auralayer], x => (x === R2.aura ? 'Hero aura system' : 'Aura render layering'))}`;
      case 4: return `<div class="cxg"><div><b>Save burst</b><span>Hold jutsu bursts for boss phases.</span></div><div><b>Balance</b><span>Mix damage dealers with chakra support.</span></div><div><b>Read the board</b><span>Blasts stop at stone – line up crates.</span></div><div><b>Rotate</b><span>A Sensei swaps in rested heroes automatically.</span></div></div><h4>Hero animation reference</h4>${gal([R2.hayate], () => 'Hayate – animation & VFX reference')}`;
      case 5: return `<p>Each boss has idle, walk, hurt and death animations plus signature attacks, ending in a rage mode at low HP.</p><h4>Boss concept sheets</h4>${gal(R2.bosses, x => `${x.n} · ${x.t}`)}<h4>Akuma animation sheets</h4>${gal(R2.akuma, x => 'Akuma sprite sheet ' + (R2.akuma.indexOf(x) + 1))}`;
      case 6: return `<div class="cxg"><div><b>Adventure Ryo</b><span>Earned while your team works stages. It collects in your Chest.</span></div><div><b>Claim</b><span>Moves verified Chest Ryo into your game balance – not an on-chain withdrawal.</span></div><div><b>Withdraw / Deposit</b><span>Use the Chest's own limits, fees, cooldown and wallet steps.</span></div></div><p><button class="gb" type="button" data-cx="chest">Open Chest</button></p>`;
      case 7: return `<div class="faq"><details open><summary>How many heroes can I deploy?</summary><p>Up to 10 at once, from up to 50 battle-ready heroes.</p></details><details><summary>Can Legend heroes be fused further?</summary><p>No – Legend is the top rank.</p></details><details><summary>Where do Adventure rewards go?</summary><p>Into your Chest. Claim them to make them spendable.</p></details><details><summary>Are Guild and Chat available?</summary><p>Not yet – they are coming soon.</p></details></div>`;
      default: return '';
    }
  }
  INIT.codex = b => {
    b.cx = place(mk('div', 'cxp', b.st), 306, 212, 896, 698); b.cx.hidden = true;
    b.cx.addEventListener('click', e => { if (e.target.closest('[data-cx=chest]')) openChest(); });
  };
  MODS.codex = {
    sec: a => { const i = +a, b = built.codex; for (let n = 0; n < 8; n++) { const e = $(`.hs[data-sbwid="cs${n}"]`, b.st); if (e) { e.classList.toggle('on2', n === i && n !== 1); e.classList.toggle('dimact', n === 1 && i !== 1); } } b.cx.hidden = i === 1; if (i !== 1) { b.cx.innerHTML = `<h2>${CXT[i]}</h2><div class="cxb">${cxHtml(i)}</div>`; b.cx.scrollTop = 0; } },
    elem: a => toast(['Fire – burns enemies over time', 'Water – flowing sustained damage', 'Wind – speed and mobility', 'Shadow – ambush and burst damage', 'Lightning – chains between foes and stuns'][+a])
  };

  /* ---------- live refresh ---------- */
  function setText(e, t) { if (e && e.textContent !== t) { e.textContent = t; fitText(e); } }
  function fitText(e) { const base = +e.dataset.fs; if (!base) return; let fs = base; e.style.fontSize = fs + 'px'; while (e.scrollWidth > e.clientWidth + 1 && fs > 8) { fs -= 1; e.style.fontSize = fs + 'px'; } }
  function refresh(now = performance.now()) {
    const b = cur && built[cur]; if (!b) return;
    const l = ledger(), a = account(), pend = chestPending();
    if (b.live.ryo) setText(b.live.ryo, a && Number.isFinite(Number(l.balance)) ? fmt(Number(l.balance)) + ' Ryo' : '— Ryo');
    setText(b.label, pend != null && Number.isFinite(pend) ? 'Chest : ' + fmt(pend) : 'Chest');
    b.dot.hidden = !(pend >= 1);
    if (b.covers.wallet) setText(b.covers.wallet, a ? a.slice(0, 4) + '...' + a.slice(-4) : 'Sign in');
    if (b.covers.gems) setText(b.covers.gems, '⚙ Tools');
    for (const id of ['ltimer', 'btimer', 'cost', 'slabel', 'fcount', 'stitle', 'enemies', 'reward', 'team', 'upcost', 'trainlbl']) if (b.live[id]) b.live[id].hidden = true;
    (PAINT[cur] || (() => {}))(b, now);
  }

  /* ---------- show/hide over the matching game page ---------- */
  function fit() {
    const b = cur && built[cur]; if (!b) return;
    const vw = innerWidth, vh = innerHeight, s = Math.min(vw / b.s.W, vh / b.s.H);
    b.st.style.transform = `translate(${Math.max(0, (vw - b.s.W * s) / 2)}px,${Math.max(0, (vh - b.s.H * s) / 2)}px) scale(${s})`;
    placeTrigger();
  }
  /* align the game's real Chest trigger with the website Chest artwork */
  function placeTrigger() {
    const b = cur && built[cur]; if (!b) return;
    const r = b.chestEl.getBoundingClientRect(), d = document.documentElement.style;
    d.setProperty('--sbw-chest-x', r.left + 'px'); d.setProperty('--sbw-chest-y', r.top + 'px'); d.setProperty('--sbw-chest-w', r.width + 'px'); d.setProperty('--sbw-chest-h', r.height + 'px');
    if (b.covers.gems) { const g = b.covers.gems.getBoundingClientRect(), k = g.height / Math.max(1, (b.s.hdr.gems.h || 1)); d.setProperty('--sbw-tools-x', (g.left - 46 * k) + 'px'); d.setProperty('--sbw-tools-y', (g.top - 8 * k) + 'px'); d.setProperty('--sbw-tools-w', (g.width + 54 * k) + 'px'); d.setProperty('--sbw-tools-h', (g.height + 16 * k) + 'px'); }
    const real = document.querySelector('[data-gc-chest]');
    if (real && !real._sbw) { real._sbw = true; real.addEventListener('mouseenter', () => { const c = cur && built[cur]; c && c.chestEl.classList.add('sbw-hover'); }); real.addEventListener('mouseleave', () => { for (const k in built) built[k].chestEl.classList.remove('sbw-hover'); }); }
    b.chestEl.tabIndex = real ? -1 : 0; b.chestEl.setAttribute('aria-hidden', real ? 'true' : 'false');
  }
  function screenForPage() {
    if (!D || (window.LoginScreen && LoginScreen.active) || (window.GameLoading && GameLoading.active)) return null;
    let page; try { page = tab; } catch { return null; }
    return SHOWN[String(page)] || null;
  }
  function sync() {
    const k = screenForPage();
    if (k !== cur) {
      if (cur && built[cur]) built[cur].sec.classList.remove('on');
      cur = k;
      if (k) { const b = built[k] || build(k); b.sec.classList.add('on'); if (!RM) { b.sec.classList.remove('enter'); void b.sec.offsetWidth; b.sec.classList.add('enter'); } }
      layer.hidden = !k;
      document.body.classList.toggle('sbw-active', !!k);
      for (const id of ['exactHomeScreen']) { const e = document.getElementById(id); if (e) e.inert = !!k; }
      const main = document.querySelector('main'); if (main) main.inert = !!k;
      fit();
    }
    refresh();
  }

  async function init() {
    if (window.GameLoading && GameLoading.ready) await GameLoading.ready;
    D = await fetch(BASE + 'screens.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('screens.json ' + r.status); return r.json(); });
    layer = mk('div', '', document.body); layer.id = 'sbwLayer'; layer.hidden = true;
    const prior = window.go;
    if (typeof prior === 'function') { window.go = function (...args) { const r = prior.apply(this, args); queueMicrotask(sync); return r; }; }
    addEventListener('shinobi-navigation', sync);
    addEventListener('shinobi-ryo-ledger', () => refresh());
    addEventListener('shinobi-beta-wallet', () => refresh());
    addEventListener('shinobi-chest', () => refresh());
    addEventListener('resize', fit);
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('click', e => { const g = e.target.closest('#sbwLayer .gt'); if (!g) return; if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body); dlg.innerHTML = `<h2>${esc(g.dataset.t)}</h2><img class="sbw-lb" src="${g.dataset.src}" alt="${esc(g.dataset.t)}"><div class="sbw-acts"><button type="button" class="sbw-btn">Close</button></div>`; $('button', dlg).onclick = () => dlg.close(); dlg.showModal(); });
    setInterval(() => { sync(); placeTrigger(); }, 700);
    let last = 0; const loop = now => { if (cur && now - last > 120) { last = now; const b = built[cur]; if (b && PAINT[cur]) PAINT[cur](b, now); } requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    sync();
    window.WebsiteDesign = { ready: true, screens: Object.keys(D.screens), current: () => cur, refresh: sync };
  }
  init().catch(e => console.error('Website designs could not be applied:', e));
})();
