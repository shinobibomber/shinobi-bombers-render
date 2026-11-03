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
  const SHOWN = { '5': 'home', '3': 'codex', '2': 'summon', '6': 'fusion', '4:0': 'dojo', '1': 'heroes', '0': 'adventure', '4:1': 'market', '8': 'boss-hunt' };
  let preview = null; /* Guild/Chat preview screens (no game page) */
  let dojoView = 'dojo'; /* Dojo pages: 'dojo' (Services, landing), 'dojo-upg' (Enter Dojo), 'dojo-sen' (Manage Sensei) */
  const RCOL = ['#c9d2e3', '#35e06b', '#2aa8ff', '#b45cff', '#ffc13a'], RNAME = ['Genin', 'Chunin', 'Jonin', 'Elite', 'Legend'];
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let RM = motionPreference.matches, geometryRevision = 0;
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
  // Header wallet pill: the game's own Disconnect (which returns to its sign-in screen),
  // or that sign-in screen when signed out. No wallet logic of its own.
  function walletButton() {
    if (account()) { const native = document.getElementById('betaDisconnect'); if (native && !native.disabled) native.click(); }
    else window.LoginScreen?.show();
  }
  // Count a number up to its new value over 0.7s (Chest, Session gained). Decreases (a claim) and
  // reduced motion jump straight to the new value.
  const counters = new WeakMap();
  function countTo(el, value, format) {
    if (!el) return;
    let c = counters.get(el);
    if (!c || !Number.isFinite(c.shown) || value < c.shown || RM || document.hidden) {
      if (c) cancelAnimationFrame(c.raf);
      counters.set(el, { shown: value, target: value, raf: 0 }); setText(el, format(value)); return;
    }
    if (c.target === value) return;
    const from = c.shown, start = performance.now(); c.target = value; cancelAnimationFrame(c.raf);
    el.classList.add('sbw-tick');
    const step = t => {
      const k = Math.min(1, (t - start) / 700); c.shown = from + (value - from) * (1 - (1 - k) ** 3);
      if (k < 1) { el.textContent = format(c.shown); c.raf = requestAnimationFrame(step); }
      else { el.classList.remove('sbw-tick'); setText(el, format(value)); fitText(el); }
    };
    c.raf = requestAnimationFrame(step);
  }
  function chestPending() { const c = window.AdventureChest && AdventureChest.snapshot; const a = account(); return c && a && c.owner === a && c.chest ? Number(c.chest.pending) : null; }
  /* same hero list the game's own menus count (server-owned and local practice heroes) */
  /* the game's save object is a script-level binding (let S), not a window property */
  function gs() { try { return S; } catch { return null; } }
  function owned() { const g = gs(); return g && Array.isArray(g.h) ? g.h.slice() : []; }
  function deployed() { return owned().filter(h => h.on).sort((a, b) => b.r - a.r || b.lv - a.lv || a.id - b.id); }

  /* ---------- the game's own controls (pressed, never re-implemented) ---------- */
  function nativeEl(scope, test) { const root = document.querySelector(scope); if (!root) return null; return [...root.querySelectorAll('button,input,label,[onclick]')].find(e => !e.closest('#sbwLayer') && test(e)) || null; }
  function pressOnclick(scope, code) { const e = nativeEl(scope, x => (x.getAttribute('onclick') || '') === code); if (e && !e.disabled) { e.click(); return true; } return false; }
  function nativeText(scope, re) { const root = document.querySelector(scope); if (!root) return ''; const m = (root.innerText || '').match(re); return m ? m[0] : ''; }

  /* ---------- dialogs ---------- */
  function notice(title, text) {
    if (!dlg) { dlg = mk('dialog', 'sbw-dialog', document.body); }
    dlg.className = 'sbw-dialog'; dlg.onclick = null; dlg.innerHTML = `<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="sbw-acts"><button type="button" class="sbw-btn">Close</button></div>`;
    $('button', dlg).onclick = () => dlg.close();
    if (!dlg.open) dlg.showModal();
  }
  // Summon History: the server's last 100 purchases (RyoPayments.state.purchases) carry each
  // confirmed summon's heroes. List those batches newest first with the heroes that came out.
  function summonHistory() {
    if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body);
    const summons = ((window.RyoPayments && RyoPayments.state.purchases) || []).filter(p => (p.product || p.quote?.product || p.result?.product) === 'summon');
    const owned = new Map(((gs() && gs().h) || []).filter(h => h.tokenId).map(h => [h.tokenId, h])), counts = [0, 0, 0, 0, 0];
    const stat = v => Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '—';
    const batches = summons.map((p, i) => {
      const heroes = p.status === 'confirmed' && Array.isArray(p.result?.outputs) ? p.result.outputs : [];
      heroes.forEach(h => counts[h.rank] = (counts[h.rank] || 0) + 1);
      const qty = p.quote?.params?.quantity || heroes.length || '—', when = Number(p.created) ? new Date(Number(p.created)).toLocaleString() : '';
      const state = p.status === 'confirmed' ? '' : p.status === 'refunded' ? 'Refunded · Ryo returned' : 'Settling…';
      const chips = heroes.map((h, j) => `<div class="sbw-sh-hero${owned.has(h.tokenId) ? '' : ' gone'}" style="--rc:${RCOL[h.rank] || RCOL[0]}"><canvas data-b="${i}" data-h="${j}"></canvas><b>${esc(h.name)}</b><small>${esc(RNAME[h.rank] || '')}${owned.has(h.tokenId) ? '' : ' · no longer in collection'}</small><em title="Power · Speed · Stamina">PWR ${stat(h.baseStats?.pw)} · SPD ${stat(h.baseStats?.sp)} · STA ${stat(h.baseStats?.st)}</em></div>`).join('');
      return `<section class="sbw-sh-batch"><header><b>×${esc(qty)} summon</b><span>${esc(when)}</span><span>${esc(fmt(Number(p.amount)))} Ryo</span>${state ? `<em>${esc(state)}</em>` : ''}</header>${chips ? `<div class="sbw-sh-grid">${chips}</div>` : ''}</section>`;
    });
    const total = counts.reduce((a, n) => a + n, 0);
    dlg.className = 'sbw-dialog sbw-history'; dlg.onclick = null;
    dlg.innerHTML = `<div class="sbw-sh-top"><h2>Summon History</h2><button type="button" class="sbw-btn">Close</button></div>${summons.length ? `<p class="sbw-sh-sum">${total} heroes from ${summons.length} summon${summons.length === 1 ? '' : 's'} · ${RNAME.map((n, r) => `<span style="color:${RCOL[r]}">${n} ${counts[r]}</span>`).join(' · ')}</p><div class="sbw-sh-list">${batches.join('')}</div>` : '<p>No summons yet. Summon heroes at the Shrine to see them here.</p>'}`;
    $('.sbw-sh-top button', dlg).onclick = () => dlg.close();
    dlg.addEventListener('close', () => dlg.classList.remove('sbw-history'), { once: true });
    if (!dlg.open) dlg.showModal();
    // Owned heroes show their real model; fused or sold heroes keep a rank-coloured placeholder.
    $$('.sbw-sh-hero canvas', dlg).forEach(c => { const h = summons[+c.dataset.b].result.outputs[+c.dataset.h], own = owned.get(h.tokenId); c.width = c.height = 128; if (own) drawHero(c, own, 2.4, 0, 6); });
  }
  function toast(t) { if (!toastEl) toastEl = mk('div', 'sbw-toast', document.body); toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('on'), 2200); }
  function openChest() {
    if (account() && window.GlobalChestUI && GlobalChestUI.ready) GlobalChestUI.open();
    else notice('Chest', 'Sign in with your wallet to open your Chest.');
  }
  function editNickname() {
    if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body);
    dlg.innerHTML = '<h2>Your Shinobi name</h2><form><label>Nickname <input maxlength="14" required></label><div class="sbw-acts"><button type="button" class="sbw-btn sbw-alt">Cancel</button><button class="sbw-btn">Save</button></div></form>';
    const input = $('input', dlg); input.value = (gs() && gs().nick) || '';
    $('.sbw-alt', dlg).onclick = () => dlg.close();
    $('form', dlg).onsubmit = e => { e.preventDefault(); if (!input.value.trim()) return; const ni = document.getElementById('ni'); if (ni && typeof nick === 'function') { ni.value = input.value; nick(); if (typeof save === 'function') save(); window.ReferenceLayout && ReferenceLayout.refresh && ReferenceLayout.refresh(); } dlg.close(); refresh(); };
    if (!dlg.open) dlg.showModal(); input.focus();
  }

  /* ---------- actions ---------- */
  /* MODS for Dojo pages resolve to MODS.dojo (see act) */
  const SOON = { guild: 'Guilds are coming soon.', chat: 'Open live Global chat from the chat bar on Home.' };
  function goScreen(k) {
    if (k.startsWith('guild') || k === 'chat') { const p = k === 'chat' ? 'chat' : 'guild'; if (D.screens[p]) { preview = p; sync(); return; } return notice(p === 'chat' ? 'Chat' : 'Guild', p === 'chat' ? SOON.chat : SOON.guild); }
    preview = null; if (k === 'dojo') dojoView = 'dojo';
    const r = ROUTE[k]; if (r) go(r[0], r[1]);
  }
  const HOME = {
    'logo': () => {}, 'prof': editNickname, 'mng': () => go(1), 't1': () => go(1), 't2': () => go(1), 't3': () => go(1), 't4': () => go(1), 't5': () => go(1),
    'ev': () => notice('Events', 'No active event is configured. Check back for upcoming events.'),
    'go1': () => notice('Daily missions', 'Daily missions are not available yet.'), 'go2': () => notice('Daily missions', 'Daily missions are not available yet.'), 'go3': () => notice('Daily missions', 'Daily missions are not available yet.'),
    'season': () => notice('Season 1', 'Seasons are not available yet.'), 'tut': () => go(3), 'news': () => notice('News', 'No news has been posted yet.'),
    'sup': () => notice('Support', 'Open Tools in the game header for the community links.'), 'chatbar': () => toggleChat(), 'c-gld': () => goScreen('guild')
  };
  function act(k, h, el) {
    const a = h.a || '', [t, ...rest] = a.split(':'), arg = rest.join(':');
    if (k === 'home' && HOME[h.id]) return HOME[h.id]();
    if (t === 'go') return goScreen(arg);
    if (t === 'gcat') return k === 'guild' ? MODS.guild.x() : goScreen('guild');
    if (t === 'chest' || t === 'deposit') return openChest();
    if (t === 'wallet') return walletButton();
    if (t === 'codex') return go(3);
    if (t === 'soon') return notice(arg, arg + ' is coming soon.');
    if (t === 'toast') return toast(arg);
    if (t === 'fn') { const [fn, ...p] = arg.split(':'); const m = (MODS[k] || MODS[(D.screens[k] || {}).base] || {})[fn]; if (m) return m(p.join(':'), el); }
  }

  /* Dojo pages: labels are created in the original artwork's coordinates, then moved panel by panel (scaled) */
  function remapView(b) {
    const panels = b.s.view;
    [...b.st.children].forEach(e => {
      if (e.matches('.sbw-base,.hs,.petals,.fx') || e.dataset.mapped) return;
      const x = parseFloat(e.style.left), y = parseFloat(e.style.top), w = parseFloat(e.style.width) || 0, h = parseFloat(e.style.height) || 0;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const cx = x + w / 2, cy = y + h / 2, p = panels.find(p => cx >= p.src[0] && cx < p.src[2] && cy >= p.src[1] && cy < p.src[3]);
      e.dataset.mapped = '1';
      if (!p) { e.classList.add('sbw-offview'); return; }
      e.style.left = (p.dst[0] + (x - p.src[0]) * p.k) + 'px'; e.style.top = (p.dst[1] + (y - p.src[1]) * p.k) + 'px';
      e.style.transformOrigin = '0 0'; e.style.transform = `scale(${p.k})`;
    });
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
    let cb = null, lbl = null, dot = null; const c = s.chest; if (c) { cb = mk('div', 'hs chestbtn', st); place(cb, c.r[0], c.r[1], c.r[2] - c.r[0], c.r[3] - c.r[1]); cb.tabIndex = 0; cb.setAttribute('role', 'button'); cb.setAttribute('aria-label', 'Open your Chest');
    slice(mk('i', 'sl', cb), s, c.r); lbl = place(mk('span', 'cbt sbw-chest', cb), c.tx, c.ty, c.tw, c.th); lbl.style.fontSize = c.fs + 'px'; lbl.dataset.fs = c.fs;
    dot = place(mk('i', 'cdot', cb), c.dx, c.dy, c.ds, c.ds); dot.hidden = true;
    cb.addEventListener('click', openChest); cb.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openChest(); } }); }
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
    built[k] = b; (INIT[k] || INIT[s.base] || (() => {}))(b);
    if (s.view) remapView(b);
    return b;
  }

  /* ---------- per-screen live content ---------- */
  const INIT = {}, MODS = {}, PAINT = {}, MIRROR = {};
  INIT.home = b => {
    const cover = (x, y, w, h, bg, fs, color, cls = '') => { const e = place(mk('span', 'sbw-cover sbw-left ' + cls, b.st), x, y, w, h); e.style.background = bg; e.style.fontSize = fs + 'px'; e.dataset.fs = fs; e.style.color = color; return e; };
    b.name = cover(1380, 138, 80, 28, '#01060e', 25, '#ffffff', 'sbw-click'); b.name.title = 'Set your nickname';
    b.name.addEventListener('click', editNickname);
    b.line = cover(1380, 172, 230, 23, '#000712', 18, '#e2edf6');
    b.row = cover(1386, 204, 248, 24, '#000b19', 18, '#7de5ff');
    b.avatar = place(mk('canvas', 'sbw-avatar', b.st), 1271, 139, 95, 92); b.avatar.width = 190; b.avatar.height = 184;
    // The chat bar's printed welcome line gives way to the newest real Global message. It lives
    // inside the bar's artwork slice (bar at 529,877) so hover/focus highlights move it together.
    const barArt = b.st.querySelector('[data-sbwid="chatbar"] > .sl') || b.st;
    b.chat = place(mk('span', 'sbw-chatline', barArt), barArt === b.st ? 582 : 53, barArt === b.st ? 888 : 11, 620, 32); b.chat.hidden = true;
    mk('i', '', b.chat).textContent = '[Global]'; mk('b', '', b.chat); mk('span', '', b.chat);
    b.tiles = [1270, 1345, 1420, 1494, 1569].map((x, i) => { const t = place(mk('div', 'sbw-tile', b.st), x, 302, 66, 122); const cv = mk('canvas', '', t); cv.width = 132; cv.height = 150; mk('b', '', t); t.addEventListener('click', () => go(1)); return t; });
  };
  PAINT.home = (b, now) => {
    const nickName = (gs() && gs().nick) || 'Shinobi', mine = owned(), dep = deployed();
    setText(b.name, nickName); setText(b.line, `${mine.length} Shinobi · ${dep.length}/10 deployed`);
    // Message IDs share one sequence, so the higher ID is the newer of Global and System.
    const said = chatMsgs.at(-1), told = sysMsgs.at(-1), last = !told || (said && said.id > told.id) ? said : told;
    b.chat.hidden = !last; b.chat.classList.toggle('sbw-chatline-sys', last === told && !!told);
    if (last) { setText(b.chat.children[0], last === told ? '[System]' : '[Global]'); setText(b.chat.children[1], last === told ? '' : last.name + ':'); setText(b.chat.children[2], last.text); }
    let ready = 0; try { ready = BattleRoster.list().length; } catch {}
    setText(b.row, `Battle-ready ${ready} / 50`);
    const draw = (cv, h, cx, by, sc) => paintPortrait(cv, h, cx, by, sc, now);
    draw(b.avatar, dep[0] || mine[0], 95, 178, 3.4);
    b.tiles.forEach((t, i) => {
      // Own empty-state class: the shared .sbw-empty message styles widened these tiles.
      const h = dep[i]; t.classList.toggle('sbw-tile-empty', !h); t.style.setProperty('--rc', h ? RCOL[h.r] : '#3a4a7a');
      const label = h ? `★ Lv. ${h.lv}` : 'Deploy', title = h ? `${h.name} · ${RNAME[h.r]} · Lv. ${h.lv}` : 'Deploy a hero from Heroes';
      if (t.lastChild.textContent !== label) t.lastChild.textContent = label;
      if (t.title !== title) t.title = title;
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

  /* ---------- Summon (website screen ↔ Combat.quantity / Combat.summonBatch) ---------- */
  const QTY = [1, 5, 10, 15];
  INIT.summon = b => {
    b.tabs = [['q1', 1], ['q5', 5], ['q10', 10], ['q15', 15]].map(([id, n]) => { const h = b.s.hs.find(x => x.id === id), r = h.r; const e = place(mk('div', 'sbw-smtab', b.st, '×' + n), r[0], r[1], r[2] - r[0], r[3] - r[1]); e.dataset.n = n; return e; });
    // The poster contains example discounts and incorrect ×15 artwork. Cover
    // that entire caption area, including on hover, with current game prices.
    b.packs = QTY.map(quantity => {
      const card = $(`.hs[data-sbwid="k${quantity}"]`, b.st);
      card.classList.add('sbw-pack');
      const footer = mk('span', 'sbw-pack-price', card.querySelector('.sl'));
      footer.innerHTML = `<small>${quantity} ${quantity === 1 ? 'SCROLL' : 'SCROLLS'} · BASE PRICE</small><strong>— Ryo</strong>`;
      return { quantity, card, price: footer.querySelector('strong') };
    });
    const fee = cov(b, 1277, 356, 360, 17, '#08091b', 13, '#d4d9e8');
    fee.classList.add('sbw-summon-fee'); fee.textContent = 'Existing studio fee shown at checkout';
  };
  function summonQty() { const sel = nativeEl('#p2', e => /Combat\.quantity\(\d+\)/.test(e.getAttribute('onclick') || '') && e.classList.contains('selected')); const m = sel && /\((\d+)\)/.exec(sel.getAttribute('onclick')); return m ? +m[1] : 1; }
  PAINT.summon = b => {
    const n = summonQty();
    const unit = window.GameBalance?.summonCost;
    for (const pack of b.packs) {
      const cost = Number.isFinite(unit) && unit >= 0 ? fmt(unit * pack.quantity) + ' Ryo' : '— Ryo';
      setText(pack.price, cost);
      pack.card.setAttribute('aria-label', `${pack.quantity} ${pack.quantity === 1 ? 'scroll' : 'scrolls'}, base price ${cost}`);
    }
    b.tabs.forEach(t => { const on = +t.dataset.n === n; t.hidden = n === 1; t.style.backgroundImage = `url(${BASE}art/sm-tab-${on ? 'on' : 'off'}.webp)`; });
    for (const q of QTY) { const c = $(`.hs[data-sbwid="k${q}"]`, b.st); if (c) c.classList.toggle('picked', q === n && n !== 1); }
    const total = nativeText('#p2', /Total\s+[\d,]+\s*Ryo/i).replace(/^Total\s+/i, '');
    if (b.live.cost) { b.live.cost.hidden = false; setText(b.live.cost, total || '—'); }
    if (b.live.slabel) { b.live.slabel.hidden = false; setText(b.live.slabel, 'SUMMON ' + n); }
    if (b.live.ltimer) { b.live.ltimer.hidden = false; setText(b.live.ltimer, 'Not active'); }
  };
  MODS.summon = {
    qty: a => { if (QTY.includes(+a) && window.Combat) Combat.quantity(+a); refresh(); },
    pick: a => { if (QTY.includes(+a) && window.Combat) Combat.quantity(+a); refresh(); },
    summon: () => { if (!pressOnclick('#p2', 'Combat.summonBatch()')) toast(account() ? 'Summon is busy – try again in a moment.' : 'Sign in with your wallet to summon.'); },
    gallery: () => go(1), history: () => summonHistory(),
    flashRates: () => { const r = $('.hs[data-sbwid="rates"]', built.summon.st); if (r) { r.classList.remove('flash'); void r.offsetWidth; r.classList.add('flash'); } toast('Rates: Genin 60% · Chunin 25% · Jonin 10% · Elite 4% · Legend 1%'); },
    legend: () => notice('Legend rate-up', 'No limited-time rate-up is active. Every summon uses the fixed rates: Genin 60%, Chunin 25%, Jonin 10%, Elite 4%, Legend 1%.'),
    featured: () => notice('Featured Shinobi', 'Featured heroes are not configured. Every summon uses the fixed rarity rates.'),
    elements: () => go(3)
  };

  /* ---------- Fusion (website screen ↔ FusionUI / V2 and the game's own hero checkboxes) ---------- */
  const BANDS = [[1, 3], [3, 6], [6, 9], [9, 12], [12, 15]];
  function fusionRank() { const t = nativeEl('#p6', e => /FusionUI\.tab\(\d\)/.test(e.getAttribute('onclick') || '') && e.getAttribute('aria-pressed') === 'true'); const m = t && /\((\d)\)/.exec(t.getAttribute('onclick')); return m ? +m[1] : 0; }
  /* the game's own Reserve list (#p6 .fusion-table): one row per hero, with its real checkbox */
  function fusionRows() {
    const root = document.querySelector('#p6'); if (!root) return [];
    return [...root.querySelectorAll('.fusion-table tbody tr')].map(tr => {
      const input = tr.querySelector('input[type=checkbox]'); if (!input) return null;
      const td = [...tr.children].map(c => (c.innerText || c.textContent || '').trim()), m = /V2\.select\((\d+)/.exec(input.getAttribute('onchange') || '');
      return { input, id: m ? +m[1] : null, name: ((tr.querySelector('b') || {}).textContent || '').trim(), info: ((tr.querySelector('small') || {}).textContent || '').trim(), stats: td.slice(1, 4), jutsu: td[4] || '', checked: input.checked, disabled: input.disabled };
    }).filter(Boolean);
  }
  function fusionStat(label) { return nativeText('#p6', new RegExp(label + '\\s*\\n\\s*[\\d.]+\\s*[–-]\\s*[\\d.]+')).split(/\n/).pop().trim(); }
  INIT.fusion = b => {
    b.list = place(mk('div', 'sbw-flist', b.st), 46, 594, 754, 360); b.list.setAttribute('aria-label', 'Reserve heroes');
    b.slots = [347, 440, 533].map((y, j) => { const e = place(mk('div', 'sbw-fslot', b.st), 901, y, 151, 86); const cv = mk('canvas', '', e); cv.width = 116; cv.height = 116; mk('span', '', e); e.hidden = true; return e; });
    const cover = (x, y, w, h, bg, fs, color, cls = '') => { const e = place(mk('span', 'sbw-cover ' + cls, b.st), x, y, w, h); e.style.background = bg; e.style.fontSize = fs + 'px'; e.dataset.fs = fs; e.style.color = color; return e; };
    b.title = cover(870, 302, 250, 30, '#0a0a24', 24, '#ffffff', 'sbw-left');
    b.result = cover(1043, 643, 130, 21, '#0a0f24', 16, '#35e06b', 'sbw-left');
    b.ranges = [935, 1115, 1346].map(x => cover(x, 699, 70, 21, '#0b1226', 17, '#ffffff', 'sbw-left'));
    // live Reserve counts on the rank tabs, Fuse Max count, batch notes and next-rank values
    b.counts = [[170, '#1c0d00'], [324, '#021223'], [474, '#011023'], [629, '#021326']].map(([x, bg]) => cover(x - 20, 261, 40, 22, bg, 16, '#ffcf4a'));
    b.max = cover(494, 444, 147, 40, 'linear-gradient(#fcc126,#f7a51a 55%,#fb8f0b)', 19, '#2a1000'); b.max.style.borderRadius = '6px'; b.max.style.textShadow = 'none';
    b.lineTop = cover(64, 410, 556, 22, 'linear-gradient(90deg,#220449,#05011a 22%,#08001d 70%,#0c001c)', 15, '#e8defc', 'sbw-left');
    b.lineFoot = cover(64, 495, 556, 23, 'linear-gradient(90deg,#230447,#160026 25%,#14011f 70%,#12001a)', 14, '#cdbde8', 'sbw-left');
    b.rarity = cover(936, 760, 60, 21, '#020d1e', 17, '#ffffff', 'sbw-left');
    b.jutsu = cover(1345, 760, 60, 21, '#030e1f', 17, '#ffffff', 'sbw-left');
    b.note = cover(918, 835, 522, 17, 'linear-gradient(90deg,#1b073b,#1d0536 40%,#240846 75%,#1c063b)', 13, '#e3d8f7', 'sbw-left'); b.note.style.fontWeight = '500';
  };
  PAINT.fusion = (b, now) => {
    const rank = fusionRank(), rows = fusionRows();
    const counter = nativeText('#p6', /\d+\s*\/\s*3 picked[^\n]*/i);
    if (b.live.fcount) { b.live.fcount.hidden = false; setText(b.live.fcount, counter || '—'); }
    setText(b.title, `3 ${RNAME[rank].toUpperCase()} → 1 ${RNAME[rank + 1].toUpperCase()}`);
    setText(b.result, `${RNAME[rank + 1].toUpperCase()}  (LV. 1)`); b.result.style.color = RCOL[rank + 1];
    ['POWER', 'SPEED', 'STAMINA'].forEach((k, i) => setText(b.ranges[i], fusionStat(k) || BANDS[rank + 1].map(v => v.toFixed(1)).join('–')));
    const tabs = [0, 1, 2, 3].map(i => nativeEl('#p6', e => (e.getAttribute('onclick') || '') === `FusionUI.tab(${i})`));
    tabs.forEach((t, i) => setText(b.counts[i], t ? ((t.querySelector('small') || {}).textContent || '0').trim() : '0'));
    const maxBtn = nativeEl('#p6', e => (e.getAttribute('onclick') || '') === `V2.fuseBatch(${rank},0)`);
    setText(b.max, maxBtn ? maxBtn.textContent.trim() : 'Fuse Max (0)');
    const success = (nativeText('#p6', /\d+% success/) || '90% success');
    setText(b.lineTop, `Combine the weakest ${RNAME[rank]} heroes · 3 → 1 each · ${rank === 3 ? 'Lv 10 Elites only' : 'Reserve heroes only'} · ${success}`);
    setText(b.lineFoot, nativeText('#p6', /Up to \d+ attempts[^\n]*/) || 'Failed attempts consume heroes and charge the fee');
    setText(b.note, `The resulting hero will be a ${RNAME[rank + 1]} with improved base stats and a guaranteed rank jutsu.`);
    setText(b.rarity, RNAME[rank + 1]); b.rarity.style.color = RCOL[rank + 1];
    setText(b.jutsu, (nativeText('#p6', /JUTSU\s*\n\s*\d+/).match(/\d+$/) || ['—'])[0]);
    for (let i = 0; i < 4; i++) for (const id of ['r' + (i + 1), 'et' + (i + 1)]) { const e = $(`.hs[data-sbwid="${id}"]`, b.st); if (e) e.classList.toggle('on2', i === rank); }
    const sig = rank + '|' + rows.map(r => r.id + (r.checked ? '*' : '') + (r.disabled ? '!' : '')).join('|');
    if (sig !== b.sig) {
      b.sig = sig;
      const locked = r => /Lv 10 needed/.test(r.info), eligible = rows.filter(r => !locked(r)).length;
      b.list.innerHTML = rows.length ? (rank === 3 && eligible < 3 ? `<p class="sbw-fnote">Elite → Legend fusion needs three level 10 Elites (${eligible} ready). Train Elites to level 10 in the Dojo.</p>` : '') + rows.map((r, i) => `<button type="button" class="sbw-frow${r.checked ? ' on' : ''}${locked(r) ? ' locked' : ''}" data-i="${i}" ${r.disabled ? 'disabled' : ''} aria-pressed="${r.checked}" aria-label="${locked(r) ? esc(r.name) + ', level 10 needed' : 'Select ' + esc(r.name)}"><i>${r.checked ? '✓' : locked(r) ? '🔒' : ''}</i><canvas width="72" height="78" data-id="${r.id}"></canvas><span class="sbw-fname"><b>${esc(r.name)}</b><small style="color:${RCOL[rank]}">${esc(r.info)}</small></span>${r.stats.map(v => `<em>${esc(v)}</em>`).join('')}<span class="sbw-fj">${esc(r.jutsu)}</span></button>`).join('')
        : `<p class="sbw-fempty">No ${RNAME[rank]} heroes in Reserve. Move heroes to Reserve in Heroes, or summon more Shinobi.</p>`;
      $$('.sbw-frow', b.list).forEach(btn => btn.onclick = () => { const r = fusionRows()[+btn.dataset.i]; if (r && !r.input.disabled) { r.input.click(); b.sig = ''; refresh(); } });
    }
    const heroes = new Map(owned().map(h => [h.id, h])), hero = id => heroes.get(id) || null, draw = (cv, h, sc) => drawHero(cv, h, sc, now);
    $$('.sbw-frow canvas', b.list).forEach(cv => draw(cv, hero(+cv.dataset.id), 1.5));
    const picked = rows.filter(r => r.checked);
    b.slots.forEach((e, j) => { const r = picked[j]; e.hidden = !r; if (!r) return; e.lastChild.textContent = r.name; draw(e.firstChild, hero(r.id), 2.4); e.onclick = () => { r.input.click(); b.sig = ''; refresh(); }; });
  };
  MODS.fusion = {
    rank: a => { window.FusionUI && FusionUI.tab(+a); built.fusion.sig = ''; refresh(); },
    etab: a => { window.FusionUI && FusionUI.tab(+a); built.fusion.sig = ''; refresh(); },
    weakest: () => { if (!pressOnclick('#p6', 'FusionUI.weakest()')) toast('Not enough ' + RNAME[fusionRank()] + ' heroes in Reserve to fuse.'); built.fusion.sig = ''; refresh(); },
    clear: () => { pressOnclick('#p6', 'V2.clearFusion()'); built.fusion.sig = ''; refresh(); },
    batch: a => { const n = { '1': 1, '5': 5, '10': 10 }[a] ?? 0, code = `V2.fuseBatch(${fusionRank()},${n})`; if (!pressOnclick('#p6', code)) toast('Not enough Reserve heroes for this batch.'); },
    row: a => { const r = fusionRows()[+a]; if (r && !r.input.disabled) { r.input.click(); built.fusion.sig = ''; refresh(); } },
    slot: () => toast('Pick heroes from the Reserve list.'),
    fuse: () => { if (!pressOnclick('#p6', 'V2.fuse()')) toast('Select three ' + RNAME[fusionRank()] + ' heroes first.'); }
  };

  /* ---------- Dojo & Sensei (website screen ↔ DojoServices / TokenCheckout / game Sensei controls) ---------- */
  const DY = [160, 206, 251, 299, 348, 399, 450], ROMAN = ['–', 'I', 'II', 'III', 'IV', 'V', 'VI'];
  const DOJO_NAMES = ['Training Grounds', 'Apprentice Dojo', 'Shinobi Dojo', 'Veteran Dojo', 'Master Dojo', 'Grandmaster Dojo', 'Legendary Dojo'];
  // Dojo and Sensei state straight from the signed-in server profile (the game's own copy updates
  // only on profile changes, so a rental expiring mid-session kept showing as hired). Practice
  // play without a wallet falls back to the local save.
  function dojoState() {
    const l = ledger(), p = l.authenticated ? l.profile : null, g = gs() || {}, v2 = g.v2 || {};
    if (p) {
      const until = Number(p.senseiRentalUntil || 0), permanent = p.sensei === true, left = permanent ? 0 : Math.max(0, until - Date.now());
      return { tier: Math.max(0, Math.min(6, Number(p.dojo) || 0)), hired: permanent || left > 0, rental: !permanent && left > 0 ? until : 0, left, on: p.senseiEnabled !== false, pct: Number(p.senseiReturnPercent) || 90 };
    }
    return { tier: Math.max(0, Math.min(6, Number(g.dojo) || 0)), hired: !!g.butler, rental: 0, left: 0, on: v2.butlerEnabled !== false, pct: Number(v2.senseiReturnPercent) || 90 };
  }
  function senseiHired() { return dojoState().hired; }
  const ROMAN_TIER = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'];
  function timeLeft(ms) { const h = Math.floor(ms / 3600000); return h >= 48 ? Math.floor(h / 24) + 'd left' : h >= 1 ? h + 'h left' : Math.max(1, Math.ceil(ms / 60000)) + 'm left'; }
  // Dojo Services (the hub page): each live value covers the artwork's printed example exactly, with
  // a background sampled from the artwork, so no old letters or flat boxes show around it.
  INIT.dojo = b => {
    const fixed = (x, y, w, h, sx, cls = '') => { const e = place(mk('span', 'sbw-cover sbw-dsvc ' + cls, b.st), x, y, w, h); e.dataset.mapped = '1'; artMatch(b, e, sx); return e; };
    b.pill = fixed(104, 657, 128, 46, 240, 'sbw-dpill'); mk('b', '', b.pill);
    b.name = fixed(108, 704, 540, 38, 660, 'sbw-dname sbw-left');
    b.rate = fixed(178, 766, 92, 34, 300, 'sbw-dval sbw-left');
    b.lvl = fixed(630, 766, 70, 34, 702, 'sbw-dval sbw-left');
    b.rot = fixed(914, 870, 112, 30, 1024, 'sbw-drot sbw-left');
    for (const e of [b.name, b.rate, b.lvl, b.rot]) e.dataset.fs = { 'sbw-dname': 32, 'sbw-dval': 26, 'sbw-drot': 20 }[[...e.classList].find(c => /^sbw-d(name|val|rot)$/.test(c))];
  };
  PAINT.dojo = b => {
    const d = dojoState(), name = DOJO_NAMES[d.tier] || DOJO_NAMES[0], rate = ((window.GameBalance && GameBalance.dojoRecovery) || [])[d.tier] || 1;
    setText(b.pill.firstChild, 'TIER ' + ROMAN_TIER[d.tier]); setText(b.name, name.toUpperCase());
    setText(b.rate, rate + '/min'); setText(b.lvl, d.tier + '/6');
    const rot = !d.hired ? 'NOT HIRED' : !d.on ? 'OFF' : d.rental ? 'ON · ' + timeLeft(d.left) : 'ON';
    setText(b.rot, rot); b.rot.classList.toggle('on', d.hired && d.on);
    b.rot.title = !d.hired ? 'Hire or rent a Sensei to rotate heroes and earn offline.' : d.rental ? 'Rental active until ' + new Date(d.rental).toLocaleString() : d.on ? 'Permanent Sensei, rotation on' : 'Sensei hired, rotation turned off';
  };
  /* Dojo Upgrades and Sensei pages (your reference designs; live values and real controls drawn on top) */
  function dojoBack(b, title) {
    const e = place(mk('div', 'sbw-dback', b.st), 64, 104, 520, 34);
    e.innerHTML = `<button type="button">← Back</button><span>›</span><b>${title}</b>`;
    e.querySelector('button').onclick = () => MODS.dojo.focus('svc');
  }
  const DROWY = [222, 307, 390, 471, 551, 633, 714];
  INIT['dojo-upg'] = b => {
    dojoBack(b, 'DOJO UPGRADES');
    b.tier = place(mk('div', 'sbw-dtier', b.st), 84, 477, 92, 30);
    b.name = place(mk('div', 'sbw-dname', b.st), 84, 506, 300, 50);
    b.rate = place(mk('div', 'sbw-dval', b.st), 128, 581, 90, 34);
    b.lvl = place(mk('div', 'sbw-dval', b.st), 466, 581, 70, 34);
    b.rowhl = place(mk('div', 'sbw-drowhl', b.st), 606, 0, 1012, 80);
    b.stat = DROWY.map(y => place(mk('div', 'sbw-dstat', b.st), 1306, y - 17, 108, 34));
    b.up = place(mk('button', 'sbw-dup', b.st), 78, 760, 480, 70); b.up.type = 'button'; b.up.onclick = () => MODS.dojo.upgrade();
  };
  PAINT['dojo-upg'] = b => {
    const tier = dojoState().tier, next = tier + 1, prices = (window.GameBalance && GameBalance.dojoPrices) || [], rec = (window.GameBalance && GameBalance.dojoRecovery) || [];
    setText(b.tier, 'TIER ' + (ROMAN[tier] === '–' ? '0' : ROMAN[tier])); setText(b.name, (DOJO_NAMES[tier] || '').toUpperCase());
    b.rate.innerHTML = `<b>${rec[tier] || 1}/min</b>`; b.lvl.innerHTML = `<b>${tier}/6</b>`;
    b.rowhl.style.top = (DROWY[tier] - 41) + 'px';
    b.stat.forEach((e, i) => { const [t, c] = i < tier ? ['Unlocked', 'own'] : i === tier ? ['Active', 'act'] : i === next ? ['Next', 'nxt'] : ['—', 'lck']; if (e.textContent !== t) e.textContent = t; e.className = 'sbw-dstat ' + c; });
    const k = next <= 6 ? `<i>⌂</i><span>UPGRADE - ${fmt(prices[next])} Ryo</span>` : '<i>★</i><span>MAX TIER REACHED</span>'; if (b.up.dataset.k !== k) { b.up.dataset.k = k; b.up.innerHTML = k; } b.up.disabled = next > 6;
  };
  INIT['dojo-sen'] = b => {
    dojoBack(b, 'SENSEI');
    b.sel = place(mk('select', 'sbw-dsel', b.st), 1312, 378, 260, 44); b.sel.setAttribute('aria-label', 'Return to battle at');
    b.sel.innerHTML = [50, 60, 70, 80, 90].map(v => `<option value="${v}">${v}% chakra</option>`).join('');
    b.sel.onchange = () => MODS.dojo.ret(String((+b.sel.value - 50) / 10));
    b.svc = place(mk('div', 'sbw-dsv', b.st), 1300, 474, 266, 36);
    b.cnt = place(mk('div', 'sbw-dsv', b.st), 1480, 536, 86, 36);
    b.tg = place(mk('button', 'sbw-dtg', b.st), 1460, 594, 104, 44); b.tg.type = 'button'; b.tg.setAttribute('role', 'switch'); b.tg.onclick = () => MODS.dojo.hire();
    b.st2 = place(mk('div', 'sbw-dhired', b.st), 878, 688, 450, 92);
    b.btn = place(mk('button', 'sbw-dturn', b.st), 1346, 700, 222, 76); b.btn.type = 'button'; b.btn.onclick = () => MODS.dojo.hire();
  };
  PAINT['dojo-sen'] = b => {
    const { hired, on, pct, tier, rental } = dojoState();
    if (document.activeElement !== b.sel && b.sel.value !== String(pct)) b.sel.value = String(pct); b.sel.disabled = !hired;
    setText(b.svc, `${DOJO_NAMES[tier]} ✓`); setText(b.cnt, hired ? '1' : '0');
    b.tg.classList.toggle('on', hired && on); b.tg.setAttribute('aria-checked', String(hired && on)); b.tg.innerHTML = `<span>${hired && on ? 'ON' : 'OFF'}</span><i></i>`;
    const k = hired + '|' + on + '|' + rental;
    if (b.st2.dataset.k !== k) { b.st2.dataset.k = k;
      b.st2.innerHTML = hired ? `<b class="ok">✓</b><strong>${rental ? 'RENTED' : 'HIRED'}</strong><small>${rental ? 'Rental active until ' + new Date(rental).toLocaleString() + '.' : 'Permanent automatic rotation and up to 12 hours of offline earnings.'}</small>`
        : `<b class="no">!</b><strong>NOT HIRED</strong><small>Hire permanently or rent for 7 days to keep your team rotating.</small>`;
      b.btn.textContent = !hired ? 'HIRE SENSEI' : on ? 'TURN OFF' : 'TURN ON'; }
  };
  function senseiPane() { if (window.DojoServices) DojoServices.open('sensei'); }
  function hireSensei() {
    const perm = (window.GameBalance && GameBalance.senseiCost) || 0;
    if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body);
    dlg.innerHTML = `<h2>Hire a Sensei</h2><p>A Sensei swaps rested heroes back into battle and keeps Adventure earning while you are away (up to 12 hours).</p><div class="sbw-acts"><button type="button" class="sbw-btn sbw-alt" data-k="x">Cancel</button><button type="button" class="sbw-btn sbw-alt" data-k="rent">Rent 7 days</button><button type="button" class="sbw-btn" data-k="hire">Hire permanently · ${fmt(perm)} Ryo</button></div><p class="sbw-small">Prices and confirmation come from the game's checkout.</p>`;
    dlg.onclick = e => { const k = e.target.dataset && e.target.dataset.k; if (!k) return; dlg.close(); senseiPane(); if (k === 'hire') { if (!pressOnclick('#p4', 'DojoServices.hire()')) window.DojoServices && DojoServices.hire(); } if (k === 'rent') { if (!pressOnclick('#p4', "TokenCheckout.request('sensei-rental')") && window.TokenCheckout) TokenCheckout.request('sensei-rental'); } };
    if (!dlg.open) dlg.showModal();
  }
  MODS.dojo = {
    focus: a => { dojoView = a === 'sen' ? 'dojo-sen' : a === 'upg' ? 'dojo-upg' : 'dojo'; if (window.DojoServices) DojoServices.open(a === 'sen' ? 'sensei' : a === 'upg' ? 'dojo' : 'hub'); sync(); },
    tier: a => { const i = +a, tier = dojoState().tier, prices = GameBalance.dojoPrices, rec = GameBalance.dojoRecovery; if (window.DojoServices) { DojoServices.open('dojo'); DojoServices.selectTier(i); } notice(DOJO_NAMES[i], `Recovery ${rec[i]} chakra per minute for every resting hero. Status: ${i < tier ? 'Owned' : i === tier ? 'Active' : i === tier + 1 ? 'Next – use Upgrade' : 'Locked'}. Price: ${prices[i] ? fmt(prices[i]) + ' Ryo' : 'Free'}.`); },
    upgrade: () => { const tier = dojoState().tier; if (tier >= 6) return toast('Your dojo is at the highest tier.'); DojoServices.open('dojo'); DojoServices.selectTier(tier + 1); if (!pressOnclick('#p4', 'DojoServices.upgrade()')) DojoServices.upgrade(); },
    hire: () => { if (!senseiHired()) return hireSensei(); senseiPane(); if (!pressOnclick('#p4', 'V2.toggleButler()') && typeof V2 !== 'undefined') V2.toggleButler(); },
    ret: a => { if (!senseiHired()) return hireSensei(); const pct = 50 + 10 * +a; senseiPane(); setTimeout(() => { const sel = document.getElementById('senseiReturnPercent'); if (!sel || sel.disabled) return toast('Sensei settings are saving – try again in a moment.'); if (+sel.value === pct) return toast('Sensei already returns heroes at ' + pct + '% chakra.'); sel.value = String(pct); sel.dispatchEvent(new Event('change', { bubbles: true })); }, 80); },
    skin: () => toast('Sensei skins are not available yet.')
  };

  /* ================= Phase 3: Heroes, Adventure, Market, Boss Hunt; Guild/Chat previews ================= */
  /* shared helpers */
  // Paint a cover with the artwork's own vertical colour profile, sampled once from a text-free
  // column (stage x = sx), so the patch is invisible and only the new text shows. oy offsets the
  // element's top when it sits inside a hotspot slice rather than directly on the stage.
  const artCanvases = new WeakMap();
  function artMatch(b, el, sx, oy = 0) {
    const img = $('.sbw-base', b.st), paint = () => {
      let c = artCanvases.get(img);
      if (!c) { c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0); artCanvases.set(img, c); }
      const y = Math.round(parseFloat(el.style.top) + oy), h = Math.round(parseFloat(el.style.height)), d = c.getContext('2d').getImageData(Math.round(sx), y, 1, h).data, stops = [];
      for (let i = 0; i < h; i++) stops.push(`rgb(${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]}) ${(i / h * 100).toFixed(2)}% ${((i + 1) / h * 100).toFixed(2)}%`);
      el.style.background = `linear-gradient(${stops.join(',')})`;
    };
    if (img.complete && img.naturalWidth) paint(); else img.addEventListener('load', paint, { once: true });
    return el;
  }
  function cv(b, x, y, w, h, cls = '') { const c = place(mk('div', 'sbw-cv ' + cls, b.st), x, y, w, h); return c; }
  function cov(b, x, y, w, h, bg, fs, color, cls = '') { const e = place(mk('span', 'sbw-cover ' + cls, b.st), x, y, w, h); e.style.background = bg; e.style.fontSize = fs + 'px'; e.dataset.fs = fs; e.style.color = color; return e; }
  function heroAt(i) { const g = gs(); return g && g.h ? g.h[i] || null : null; }
  // Keep logical coordinates independent of backing pixels. Measure only after
  // layout changes; each canvas is released with its DOM node through WeakMap.
  const portraitSurfaces = new WeakMap();
  function portraitSurface(c) {
    let surface = portraitSurfaces.get(c);
    if (!surface) { surface = { w: c.width, h: c.height, geometry: -1, dpr: 0, key: '' }; portraitSurfaces.set(c, surface); }
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (surface.geometry !== geometryRevision || surface.dpr !== dpr) {
      const rect = c.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const w = Math.max(1, Math.ceil(rect.width * dpr)), h = Math.max(1, Math.ceil(rect.height * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; surface.key = ''; }
      surface.geometry = geometryRevision; surface.dpr = dpr;
    }
    return surface;
  }
  function paintPortrait(c, h, x, y, scale, now) {
    if (!c) return;
    const port = c.closest('.sbw-hc-portrait, .sbw-h2-port, .sbw-at-port');
    if (port) {
      const rank = h && h.r >= 3 ? String(h.r) : '';
      if (port.dataset.aura !== rank) port.dataset.aura = rank;
      if (rank && !port.querySelector('.sbw-portrait-energy')) {
        const energy = mk('i', 'sbw-portrait-energy', port); energy.setAttribute('aria-hidden', 'true');
      }
    }
    const surface = portraitSurface(c), PM = window.PlayerModels;
    if (!surface) return;
    // Repaint only when the idle pose flips (every 520ms), not on every paint tick.
    const time = RM ? 0 : now || 0, pose = h && PM?.loaded ? PM.portraitPose(h, time) : '';
    const key = [h?.id, h?.r, h?.z, h?.model, PM?.loaded, pose, x, y, scale].join('|');
    if (surface.key === key) return;
    const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    if (h && PM?.loaded) {
      const ratio = Math.min(c.width / surface.w, c.height / surface.h);
      g.save(); g.setTransform(ratio, 0, 0, ratio, (c.width - surface.w * ratio) / 2, (c.height - surface.h * ratio) / 2);
      try { PM.drawPortrait(g, h, x, y, scale, time); } catch { return; } finally { g.restore(); }
    }
    surface.key = key;
  }
  function drawHero(c, h, sc, now, bottom = 2) {
    if (!c) return; const surface = portraitSurface(c); if (!surface) return;
    paintPortrait(c, h, surface.w / 2, surface.h - bottom, sc, now);
  }
  // The model API uses a fixed foot anchor and known logical frame. Render it
  // straight into the displayed canvas: no alpha scan or intermediate resize.
  function drawCentered(c, h, now, pad = 8) {
    if (!c) return; const surface = portraitSurface(c); if (!surface) return;
    const scale = Math.min((surface.w - 2 * pad) / 40, (surface.h - 2 * pad) / 44);
    paintPortrait(c, h, surface.w / 2, surface.h - pad, scale, now);
  }
  // Copy a live game canvas pixel-for-pixel; CSS object-fit/object-position on the element does the
  // single display scaling and crop. Opaque cached contexts skip clears and alpha blending.
  const mirrorContexts = new WeakMap();
  function mirror(dst, src) {
    if (!dst || !src || !src.width) return;
    if (dst.width !== src.width || dst.height !== src.height) { dst.width = src.width; dst.height = src.height; mirrorContexts.delete(dst); }
    let g = mirrorContexts.get(dst);
    if (!g) { g = dst.getContext('2d', { alpha: false }); mirrorContexts.set(dst, g); }
    try { g.drawImage(src, 0, 0); } catch {}
  }
  const num = (t, re) => { const m = re.exec(t || ''); return m ? m[1] : ''; };
  function pressIn(root, test) { if (!root) return false; const e = [...root.querySelectorAll('button')].find(test); if (e && !e.disabled) { e.click(); return true; } return false; }

  /* ---------- Heroes (game page 1) ---------- */
  const HF = [-1, -3, -2, 0, 1, 2, 3, 4], HFL = ['ALL', 'BATTLE-READY', 'RESERVE', 'GENIN', 'CHUNIN', 'JONIN', 'ELITE', 'LEGEND'];
  /* the game's own perk table (script-level PK: [name, description]) and the hero's perk indexes (h.pk) */
  function heroPerks(h) { let T = null; try { T = PK; } catch {} return h && Array.isArray(h.pk) && T ? h.pk.map(i => T[i]).filter(Boolean).map(([name, desc]) => ({ name, desc })) : []; }
  function heroCards() {
    return [...document.querySelectorAll('#p1 article.reference-hero-card')].filter(a => !a.closest('#sbwLayer')).map(a => {
      const t = a.innerText || '', btn = re => [...a.querySelectorAll('button')].find(x => re.test(x.getAttribute('onclick') || '') || re.test(x.className || '')) || null;
      const tg = btn(/^tog\(/), m = tg && /tog\((\d+)\)/.exec(tg.getAttribute('onclick'));
      const idx = m ? +m[1] : null, h = idx != null ? heroAt(idx) : null;
      return { a, idx, h, name: (h && h.name) || ((a.querySelector('h3') || {}).textContent || '').trim(),
        status: (t.match(/\b(RESERVE|PRACTICE|RESTING|DEPLOYED|BATTLE-READY|WORKING)\b/) || [''])[0],
        pw: num(t, /POWER\s*\n?\s*([\d.]+)/), sp: num(t, /SPEED\s*\n?\s*([\d.]+)/), stam: num(t, /STAMINA\s*\n?\s*([\d.]+)/),
        vol: num(t, /VOLLEY\s*\n?\s*(\d+)/), rng: num(t, /RANGE\s*\n?\s*(\d+)/), lvl: num(t, /LEVEL\s*\n?\s*([\d/]+)/),
        ch: num(t, /CHAKRA\s*\n?\s*(\d+\s*\/\s*\d+)/), attack: ([...a.querySelectorAll('span,small,em')].map(x => x.textContent.trim()).find(x => /shuriken|blade|rasengan|chidori|fire|lightning/i.test(x)) || ''),
        style: ([...a.querySelectorAll('span,small,em')].map(x => x.textContent.trim()).find(x => /style$/i.test(x)) || ''),
        perks: num(t, /Perks\s*·\s*(\d+)/), dmg: (t.match(/\d+ damage \/ hit[^\n]*/) || [''])[0],
        perkList: heroPerks(h),
        tog: tg, up: btn(/^up\(/), list: btn(/openListing/), mode: btn(/hero-mode-button/) };
    });
  }
  function heroPageButton(previous) { return document.querySelector('#p1 .heroes-pagination button[aria-label="' + (previous ? 'Previous page' : 'Next page') + '"]'); }
  INIT.heroes = b => {
    b.tabs = b.s.hs.filter(h => /^tf\d$/.test(h.id)).map((h, i) => cov(b, h.r[0] + 5, h.r[1] + 6, h.r[2] - h.r[0] - 10, h.r[3] - h.r[1] - 12, i === 0 ? '#342003' : '#04172e', 15, '#e8eefc'));
    b.summary = cov(b, 24, 288, 600, 24, '#06071d', 15, '#cfd8ee', 'sbw-left');
    b.page = cov(b, 1342, 288, 130, 24, '#000108', 15, '#ffffff');
    b.page.setAttribute('role', 'status'); b.page.setAttribute('aria-live', 'polite');
    b.grid = cv(b, 26, 322, 1036, 684, 'sbw-hgrid');
    /* detail panel: one clean panel over the artwork's (portrait, stats, perks, Train, Sell) */
    b.det = cv(b, 1090, 322, 416, 650, 'sbw-hd2');
    b.det.addEventListener('click', ev => { const k = ev.target.closest('[data-k]'); if (k) MODS.heroes[k.dataset.k](); });
    b.sel = 0; b.tabIdx = 0;
    ['dfav', 'dtrain', 'dsell', 'ddep', 'dt0', 'dt1', 'dt2', 'dt3'].forEach(id => { const e = $(`.hs[data-sbwid="${id}"]`, b.st); if (e) e.hidden = true; });
  };
  function heroCardHtml(c, i, on) {
    const h = c.h || {}, r = h.r || 0, col = RCOL[r] || RCOL[0], [cc, cm] = (c.ch || '0/1').split('/').map(x => +x.trim() || 0), pct = cm ? Math.round(100 * cc / cm) : 0;
    const btn = (k, label, cls = '', dis) => `<button type="button" class="sbw-hb ${cls}" data-k="${k}" data-i="${i}" ${dis ? 'disabled' : ''}>${esc(label)}</button>`;
    return `<div class="sbw-hcard${on ? ' on' : ''}" data-i="${i}" style="--rc:${col}">
      <div class="sbw-hc-top"><b>${esc(RNAME[r].toUpperCase())}</b><i>${esc(c.status || '')}</i></div>
      <div class="sbw-hc-portrait"><canvas width="170" height="120" data-i="${i}"></canvas></div>
      <div class="sbw-hc-name">${esc(c.name)}</div><div class="sbw-hc-sub">Lv. ${esc((c.lvl || '1').split('/')[0])}<span>${esc(c.attack || c.style)}</span></div>
      <div class="sbw-hc-stats"><span>POWER<b>${esc(c.pw)}</b></span><span>SPEED<b>${esc(c.sp)}</b></span><span>STAMINA<b>${esc(c.stam)}</b></span></div>
      <div class="sbw-hc-ch"><span>CHAKRA</span><span>${esc(c.ch.replace(/\s/g, ' '))}</span></div><div class="sbw-bar"><i style="width:${pct}%"></i></div>
      <div class="sbw-hc-btns">${btn('tog', c.tog ? c.tog.textContent.trim().replace(/^Reserve$/, 'In Reserve') : 'Deploy hero', c.status === 'DEPLOYED' ? 'rest' : 'deploy', !c.tog || c.tog.disabled)}${btn('mode', c.mode ? c.mode.textContent.trim() : '—', 'mode', !c.mode || c.mode.disabled)}</div></div>`;
  }
  PAINT.heroes = (b, now) => {
    const cards = heroCards(), root = document.querySelector('#p1');
    const fbtn = HF.map(v => nativeEl('#p1', e => (e.getAttribute('onclick') || '') === `HeroFilters.choose(${v})`));
    fbtn.forEach((e, i) => { setText(b.tabs[i], `${HFL[i]} (${e ? ((e.querySelector('span') || {}).textContent || '0') : '0'})`); if (e && e.getAttribute('aria-pressed') === 'true') b.tabIdx = i; });
    b.tabs.forEach((t, i) => { t.style.color = i === b.tabIdx ? '#ffd257' : '#e8eefc'; const hs = $(`.hs[data-sbwid="tf${i}"]`, b.st); if (hs) hs.classList.toggle('on2', i === b.tabIdx); });
    setText(b.summary, nativeText('#p1', /\d+[–-]\d+ of \d+ heroes[^\n]*/) || nativeText('#p1', /\d+ of \d+ heroes[^\n]*/) || `${cards.length} heroes`);
    const pageSelect = root.querySelector('.heroes-page-select'); setText(b.page, pageSelect?.selectedOptions[0]?.textContent || '1 / 1');
    for (const id of ['pp', 'pn']) { const e = $(`.hs[data-sbwid="${id}"]`, b.st), button = heroPageButton(id === 'pp'); if (e) { const disabled = !button || button.disabled; e.setAttribute('aria-disabled', String(disabled)); e.classList.toggle('dim', disabled); } }
    if (b.sel >= cards.length) b.sel = 0;
    const sig = cards.map(c => [c.idx, c.status, c.lvl, c.ch, c.pw, c.tog && c.tog.textContent, c.up && c.up.textContent, c.mode && c.mode.textContent].join(',')).join('|') + '#' + b.sel;
    if (sig !== b.sig) {
      b.sig = sig;
      // Chakra/status updates replace text and controls, but an unchanged model
      // keeps its display canvas and cached portrait pixels.
      const portraits = new Map($$('.sbw-hcard canvas', b.grid).map(c => [c.dataset.sbwHero, c]));
      b.grid.innerHTML = cards.length ? cards.slice(0, 10).map((c, i) => heroCardHtml(c, i, i === b.sel)).join('') : `<p class="sbw-empty">No heroes match this filter. Summon heroes at the Shrine.</p>`;
      $$('.sbw-hcard canvas', b.grid).forEach(c => { const id = String(cards[+c.dataset.i]?.h?.id), old = portraits.get(id); if (old) { old.dataset.i = c.dataset.i; c.replaceWith(old); } else c.dataset.sbwHero = id; });
      $$('.sbw-hcard', b.grid).forEach(el => el.addEventListener('click', ev => { const k = ev.target.dataset && ev.target.dataset.k; const c = heroCards()[+el.dataset.i]; if (!c) return; if (k) { ev.stopPropagation(); const n = c[k]; if (n && !n.disabled) n.click(); b.sig = ''; return; } b.sel = +el.dataset.i; b.sig = ''; }));
    }
    $$('.sbw-hcard canvas', b.grid).forEach(c => { const card = cards[+c.dataset.i]; drawHero(c, card && card.h, 2.7, now, 2); });
    const c = cards[b.sel];
    const dsig = c ? [c.idx, c.lvl, c.ch, c.pw, c.sp, c.stam, c.vol, c.rng, c.status, c.up && c.up.textContent, c.up && c.up.disabled, c.list && c.list.disabled].join(',') : 'none';
    if (dsig !== b.dsig) {
      b.dsig = dsig;
      const portrait = $('.sbw-h2-port canvas', b.det);
      if (!c) b.det.innerHTML = '<p class="sbw-empty">Select a hero.</p>';
      else {
        const h = c.h || {}, r = h.r || 0, [cc, cm] = (c.ch || '0/1').split('/').map(x => +x.trim() || 0), pl = c.perkList || [];
        const tr = c.up ? c.up.textContent.replace(/\s+/g, ' ').trim() : 'Train', price = (tr.match(/[\d,]+\s*Ryo/) || [''])[0], maxed = /max/i.test(tr);
        const [lv, lvMax] = (c.lvl || '1/10').split('/').map(x => x.trim());
        const stat = (k, v) => `<div class="sbw-st"><span>${k}</span><b>${esc(v || '—')}</b></div>`;
        b.det.innerHTML = `<div class="sbw-h2" style="--rc:${RCOL[r]}">
          <div class="sbw-h2-top"><div><h3 data-fs="23">${esc(c.name)}</h3><p>Lv. ${esc(lv)} / ${esc(lvMax || '10')}<em>${esc(c.status)}</em></p></div><i class="sbw-h2-rank">${esc(RNAME[r].toUpperCase())}</i></div>
          <div class="sbw-h2-tags"><span>${esc(c.attack || '—')}</span><span>${esc(c.style || RNAME[r] + ' style')}</span></div>
          <div class="sbw-h2-mid"><div class="sbw-h2-stats">${stat('POWER', c.pw)}${stat('SPEED', c.sp)}${stat('STAMINA', c.stam)}${stat('VOLLEY', c.vol)}${stat('RANGE', c.rng)}${stat('PERKS', pl.length + ' / ' + (r + 1))}</div>
            <div class="sbw-h2-port"><canvas width="292" height="344"></canvas></div></div>
          <div class="sbw-h2-ch"><span>CHAKRA</span><span>${cc} / ${cm}</span></div><div class="sbw-bar"><i style="width:${cm ? Math.round(100 * cc / cm) : 0}%"></i></div>
          <h4>PERKS</h4>
          <ul class="sbw-perks2">${pl.length ? pl.map(p => `<li><b>✦ ${esc(p.name)}</b><span>${esc(p.desc)}</span></li>`).join('') : '<li><span>No perks yet.</span></li>'}</ul>
          <div class="sbw-h2-btns">
            <button type="button" class="sbw-xbtn train" data-k="train" ${c.up && !c.up.disabled ? '' : 'disabled'}><i>⇧</i><span><b>${maxed ? 'MAX LEVEL' : 'TRAIN'}</b><small>${maxed ? 'Fully trained' : price ? '<i class="coin"></i>' + esc(price) : 'Level ' + esc(lv) + ' → ' + (Number(lv) + 1)}</small></span></button>
            <button type="button" class="sbw-xbtn sell" data-k="sell" ${c.list && !c.list.disabled ? '' : 'disabled'}><i>⇄</i><span><b>SELL</b><small>List on Market</small></span></button>
          </div></div>`;
        const n = $('h3', b.det); if (n) fitText(n);
        const fresh = $('.sbw-h2-port canvas', b.det);
        if (portrait?.dataset.sbwHero === String(h.id)) fresh.replaceWith(portrait);
        else fresh.dataset.sbwHero = String(h.id);
      }
    }
    drawCentered($('.sbw-h2-port canvas', b.det), c && c.h, now, 6);
  };
  MODS.heroes = {
    tab: a => { const v = HF[+a]; if (v != null) window.HeroFilters && HeroFilters.choose(v); built.heroes.sel = 0; built.heroes.sig = ''; },
    search: () => { const inp = document.querySelector('#p1 .heroes-search'); if (!inp) return; if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body); dlg.onclick = null; dlg.innerHTML = '<h2>Search heroes</h2><form><input type="search" placeholder="Hero name"><div class="sbw-acts"><button type="button" class="sbw-btn sbw-alt">Clear</button><button class="sbw-btn">Search</button></div></form>'; const q = $('input', dlg); q.value = inp.value; const run = v => { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); built.heroes.sig = ''; dlg.close(); }; $('.sbw-alt', dlg).onclick = () => run(''); $('form', dlg).onsubmit = e => { e.preventDefault(); run(q.value); }; dlg.showModal(); q.focus(); },
    sort: () => { const s = document.querySelector('#p1 .heroes-sort'); if (!s) return; s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('change', { bubbles: true })); toast('Sort: ' + s.options[s.selectedIndex].text); built.heroes.sig = ''; },
    // Scope arrows to the native pager: hero Perks buttons also contain a › glyph.
    page: (a, el) => { const button = heroPageButton(el?.dataset.sbwid === 'pp'); if (!button || button.disabled) return; button.click(); built.heroes.sel = 0; built.heroes.sig = ''; refresh(); el?.focus({ preventScroll: true }); },
    sel: a => { built.heroes.sel = +a; built.heroes.sig = ''; },
    fav: () => toast('Favourites are not available yet.'),
    dtab: a => { built.heroes.dt = +a; built.heroes.dsig = ''; for (let i = 0; i < 4; i++) { const e = $(`.hs[data-sbwid="dt${i}"]`, built.heroes.st); if (e) e.classList.toggle('on2', i === +a); } },
    train: () => { const c = heroCards()[built.heroes.sel]; if (c && c.up && !c.up.disabled) c.up.click(); else toast('Training is not available for this hero right now.'); },
    sell: () => { const c = heroCards()[built.heroes.sel]; if (c && c.list && !c.list.disabled) c.list.click(); else toast('This hero cannot be listed right now.'); },
    deploy: () => { const c = heroCards()[built.heroes.sel]; if (c && c.tog && !c.tog.disabled) c.tog.click(); else toast('This hero cannot be deployed right now.'); built.heroes.sig = ''; }
  };

  /* ---------- Adventure (game page 0): the real battle canvas inside your frame ---------- */
  /* The team panel keeps the game's own 10-slot Adventure team (same cards, portraits and Deploy buttons), restyled in
     the website theme. Deployed Elite and Legend heroes get an animated aura. */
  INIT.adventure = b => {
    // Layout: the stage list is gone, the stage banner sits 18px higher, and the battlefield fills the
    // freed width (x 22–1522) above a full-width team panel. A dark backdrop hides the artwork's stage
    // cards and old banner position. The map fills its box (object-fit: cover, top-anchored): the grid
    // ends 90+ canvas px above the bottom on every map, so only front-wall scenery is trimmed.
    place(mk('div', 'sbw-abackdrop', b.st), 270, 200, 1256, 812); place(mk('div', 'sbw-abackdrop', b.st), 14, 207, 256, 805);
    ['st0', 'st1', 'st2', 'st3', 'st4'].forEach(id => { const e = $(`.hs[data-sbwid="${id}"]`, b.st); if (e) e.hidden = true; });
    const banner = $('.hs[data-sbwid="banner"]', b.st); if (banner) banner.style.top = (152 - 18) + 'px';
    // The artwork's "POTENTIAL REWARD" label: the value shown there is the session's gained Ryo.
    const bannerArt = banner && $('.sl', banner);
    if (bannerArt) { const label = cov(b, 900 - 292, 166 - 152, 140, 20, '#03070c', 15, '#e6ecf5', 'sbw-left'); bannerArt.append(label); artMatch(b, label, 1045, 152); label.textContent = 'SESSION GAINED'; label.style.fontWeight = '700'; label.style.letterSpacing = '.6px'; }
    for (const id of ['stitle', 'enemies', 'reward']) if (b.live[id]) b.live[id].style.top = (parseFloat(b.live[id].style.top) - 18) + 'px';
    b.map = place(mk('canvas', 'sbw-mirror', b.st), 22, 210, 1500, 520); b.map.width = 1240; b.map.height = 465; b.map.style.objectPosition = '50% 0';
    /* the game has no difficulty setting: the Difficulty / Stage Info box is removed (inpainted scenery patch) */
    const patch = place(mk('img', 'sbw-patch', b.st), 1150, 128, 386, 72); patch.style.objectFit = 'cover'; patch.style.objectPosition = 'top'; patch.src = BASE + 'art/adventure-tr-patch.webp'; patch.alt = '';
    ['diff', 'sinfo'].forEach(id => { const e = $(`.hs[data-sbwid="${id}"]`, b.st); if (e) e.hidden = true; });
    const t = cv(b, 22, 736, 1500, 270, 'sbw-ateam');
    t.innerHTML = `<div class="sbw-at-head"><i class="sbw-at-icon">⚔</i><div><b>ADVENTURE TEAM</b><span>Deploy your shinobi and start bombing!</span></div>
      <button type="button" data-a="manage">Manage heroes</button><button type="button" data-a="work">Work All</button><button type="button" data-a="rest">Rest All</button><em>Deployed <strong>0 / 10</strong></em></div><div class="sbw-at-grid"></div>`;
    t.querySelector('.sbw-at-head').addEventListener('click', e => { const a = e.target.closest('button'); if (!a) return; ({ manage: () => go(1), work: () => MODS.adventure.work(), rest: () => MODS.adventure.rest() })[a.dataset.a](); });
    b.team = t; b.grid = t.querySelector('.sbw-at-grid'); b.count = t.querySelector('strong');
    b.slots = Array.from({ length: 10 }, (_, i) => { const e = mk('div', 'sbw-at-card empty', b.grid); e.dataset.i = i; e.addEventListener('click', ev => { const n = teamCards()[i]; if (!n) return go(1); const btn = n.a.querySelector('.roster-team-action'); if (ev.target.closest('button') && btn && !btn.disabled) { btn.click(); e.dataset.k = ''; } }); return e; });
  };
  // Native data-maphero is a persistent hero ID, not an array index. Overlay
  // metadata must not use data-hero: the game's renderer reserves it for canvases.
  function teamCards() { const heroes = new Map(((gs() && gs().h) || []).map((h, i) => [h.id, i])); return [...document.querySelectorAll('#p0 article.map-hero')].filter(a => !a.closest('#sbwLayer')).map(a => ({ a, idx: heroes.get(+a.dataset.maphero), deployed: a.dataset.deployed === 'true' })); }
  function advInfo() { const t = ((document.querySelector('.adventure-mobile-status') || {}).textContent || '').replace(/\s+/g, ' '); return { stage: num(t, /Stage\s*(\d+)/i), name: ((document.querySelector('.adventure-stage-name') || {}).textContent || '').trim(), enemies: (t.match(/ENEMIES\s*([\d]+\s*\/\s*[\d]+)/i) || [, ''])[1], gained: (t.match(/GAINED\s*([+\-]?[\d,]+)/i) || [, '0'])[1] }; }
  PAINT.adventure = (b, now) => {
    const a = advInfo(), st = +a.stage || 1;
    if (b.live.stitle) { b.live.stitle.hidden = false; setText(b.live.stitle, `Stage ${st} · ${a.name || ''}`); }
    if (b.live.enemies) { b.live.enemies.hidden = false; setText(b.live.enemies, a.enemies || '—'); }
    if (b.live.reward) { b.live.reward.hidden = false; countTo(b.live.reward, Math.floor(Number(window.SessionRyo?.gained) || 0), v => '+' + fmt(v) + ' Ryo'); }
    const cards = teamCards(); b.count.textContent = `${cards.filter(c => c.deployed).length} / 10`;
    b.slots.forEach((e, i) => {
      const c = cards[i], h = c && heroAt(c.idx);
      if (!c || !h) { if (e.dataset.k !== 'empty') { e.dataset.k = 'empty'; e.className = 'sbw-at-card empty'; e.style.removeProperty('--rc'); e.innerHTML = `<b>+</b><div><strong>Empty slot ${i + 1}</strong><span>Deploy a battle-ready hero</span></div>`; } return; }
      const a2 = c.a, meta = ((a2.querySelector('.roster-hero-meta') || {}).textContent || '').replace(/\s+/g, ' ').trim(), bar = ((a2.querySelector('.bar i') || {}).style || {}).width || '0%', btn = a2.querySelector('.roster-team-action'), el = a2.querySelector('.roster-element-icon');
      const k = [c.idx, h.id, h.r, h.lv, meta, bar, btn && btn.textContent, btn && btn.disabled, c.deployed].join('|');
      if (e.dataset.k !== k) {
        const old = e.querySelector('canvas'), keep = old && old.width ? old : null;
        e.dataset.k = k; e.className = `sbw-at-card r${h.r}${c.deployed ? ' deployed' : ''}${c.deployed && h.r >= 3 ? (h.r === 4 ? ' aura-legend' : ' aura-elite') : ''}`; e.style.setProperty('--rc', RCOL[h.r]);
        e.innerHTML = `<i class="sbw-at-aura"></i><div class="sbw-at-port"><canvas width="126" height="126"></canvas></div><div class="sbw-at-info"><strong>${esc((h.name || '').split(' ')[0])}</strong><span class="sbw-at-rank">✦ ${esc(RNAME[h.r])}</span><small>${esc(meta)}</small><div class="sbw-bar"><i style="width:${bar}"></i></div></div>${el ? `<span class="sbw-at-el" title="${esc(el.title || '')}" style="--el:${esc(getComputedStyle(el).getPropertyValue('--element-icon') || 'none')}"></span>` : ''}<button type="button" ${btn && btn.disabled ? 'disabled' : ''}>${esc(btn ? btn.textContent.trim() : 'Deploy')}</button>`;
        if (keep && e.dataset.sbwHero === String(h.id)) e.querySelector('canvas').replaceWith(keep);
        e.dataset.sbwHero = String(h.id);
      }
      paintPortrait(e.querySelector('canvas'), h, 63, 119, 2.85, now);
    });
  };
  MIRROR.adventure = b => {
    mirror(b.map, document.getElementById('cv'));
  };
  MODS.adventure = {
    stage: () => notice('Stages', 'Stages advance automatically as your team clears each map. Eight battlefields rotate as you progress.'),
    stageinfo: () => { const a = advInfo(); notice(`Stage ${a.stage || 1} · ${a.name}`, `Enemies remaining: ${a.enemies || '—'}. Ryo earned this session: ${a.gained || '+0'}. Deployed heroes fight automatically and spend chakra; rest them in the Dojo to recover.`); },
    work: () => { if (!pressOnclick('#p0', 'Experience.workAll()')) toast('No rested heroes to send to work.'); },
    rest: () => { if (!pressOnclick('#p0', 'Experience.restAll()')) toast('No deployed heroes to rest.'); },
    hero: () => go(1)
  };

  /* ---------- Market (game page 4, mode 1): local practice market ---------- */
  INIT.market = b => {
    b.grid = cv(b, 72, 360, 1060, 494, 'sbw-mgrid');
    b.pager = cov(b, 380, 862, 440, 46, '#010d19', 15, '#9aa6c8');
    b.det = cv(b, 1162, 160, 446, 626, 'sbw-mdet');
    ['dprev', 'dnext', 'dfav', 'dt1', 'dt2', 'dt3', 'dt4'].forEach(id => { const e = $(`.hs[data-sbwid="${id}"]`, b.st); if (e) e.hidden = true; });
    b.price = cov(b, 1176, 856, 160, 46, '#010d19', 18, '#ffd257');
    b.tabs = [1, 2].map(i => { const h = b.s.hs.find(x => x.id === 'tb' + (i + 1)); const e = cov(b, h.r[0] + 4, h.r[1] + 4, h.r[2] - h.r[0] - 8, h.r[3] - h.r[1] - 8, '#070b1e', 15, '#7d86a8'); e.textContent = i === 1 ? 'ITEMS · coming soon' : 'RESOURCES · coming soon'; return e; });
    b.seller = cov(b, 1168, 786, 290, 60, '#050a17', 14, '#9aa6c8', 'sbw-left'); b.seller.textContent = 'Seller: local listings only';
  };
  function marketRows() { return [...document.querySelectorAll('#p4 [data-market-id]')].filter(e => !e.closest('#sbwLayer') && !e.matches('canvas')).map(e => ({ el: e, id: e.dataset.marketId, text: (e.innerText || '').replace(/\s+/g, ' ').trim() })); }
  PAINT.market = b => {
    const rows = marketRows(), note = nativeText('#p4', /Local listings only[^\n]*/) || 'Local listings only. Trading with other players needs a shared market service; buying is unavailable.';
    const sig = rows.map(r => r.id + r.text).join('|') + (b.sel || '');
    if (sig !== b.sig) {
      b.sig = sig;
      b.grid.innerHTML = rows.length ? rows.slice(0, 10).map((r, i) => `<button type="button" class="sbw-mcard${r.id === b.sel ? ' on' : ''}" data-i="${i}">${esc(r.text)}</button>`).join('')
        : `<div class="sbw-empty"><b>No listings yet</b><p>Open Heroes and choose <em>Sell · List on Market</em> to set an asking price.</p><p class="sbw-small">${esc(note)}</p><button type="button" class="sbw-btn" data-go="1">Browse Heroes</button></div>`;
      $$('.sbw-mcard', b.grid).forEach(e => e.onclick = () => { const r = marketRows()[+e.dataset.i]; if (r) { r.el.click(); b.sel = r.id; b.sig = ''; } });
      const bg = $('[data-go]', b.grid); if (bg) bg.onclick = () => go(1);
      const sel = rows.find(r => r.id === b.sel);
      b.det.innerHTML = `<div class="sbw-md"><h3>${sel ? 'Listing' : 'Select a hero'}</h3><p>${esc(sel ? sel.text : 'Choose a listing to inspect its stats, chakra, skills and asking price.')}</p><div class="sbw-note">MARKET · OFFLINE PROTOTYPE<br>${esc(note)}</div></div>`;
    }
    setText(b.pager, rows.length > 10 ? `Showing 10 of ${rows.length}` : '');
    setText(b.price, '— Ryo');
    const scope = ['heroes', 'mine'].find(s => { const e = nativeEl('#p4', x => (x.getAttribute('onclick') || '') === `Market.scope('${s}')`); return e && e.classList.contains('active'); }) || 'heroes';
    const rk = [-1, 0, 1, 2, 3, 4].findIndex(v => { const e = nativeEl('#p4', x => (x.getAttribute('onclick') || '') === `Market.rank(${v})`); return e && e.classList.contains('active'); });
    for (let i = 0; i < 6; i++) { const e = $(`.hs[data-sbwid="f${i}"]`, b.st); if (e) e.classList.toggle('on2', i === Math.max(0, rk)); }
    ['tb1', 'tb4'].forEach((id, i) => { const e = $(`.hs[data-sbwid="${id}"]`, b.st); if (e) e.classList.toggle('on2', (i === 0 && scope === 'heroes') || (i === 1 && scope === 'mine')); });
  };
  MODS.market = {
    mtab: a => { const s = { 0: 'heroes', 3: 'mine' }[+a]; if (!s) return notice('Market', 'Items and resources are not in the game yet. Only heroes can be listed (practice market).'); window.Market && Market.scope(s); built.market.sig = ''; },
    rar: a => { const i = ['All', 'Genin', 'Chunin', 'Jonin', 'Elite', 'Legend'].indexOf(a); window.Market && Market.rank(i - 1); built.market.sig = ''; },
    dd: a => { if (a === 'price') { const n = nativeEl('#p4', x => (x.getAttribute('onclick') || '') === "Market.sort('price')"); const by = n && n.classList.contains('active') ? 'newest' : 'price'; window.Market && Market.sort(by); toast('Sorted by ' + (by === 'price' ? 'price' : 'newest')); built.market.sig = ''; } else notice('Market filters', 'Element and skill filters are not available yet.'); },
    search: () => toast('Search is not available in the practice market yet.'),
    reset: () => { if (window.Market) { Market.scope('heroes'); Market.rank(-1); } built.market.sig = ''; },
    card: a => { const r = marketRows()[+a]; if (r) { r.el.click(); built.market.sel = r.id; built.market.sig = ''; } },
    page: () => toast('All listings fit on one page.'), cyc: () => {}, fav: () => toast('Favourites are not available yet.'), dtab: () => {},
    listings: () => { window.Market && Market.scope('mine'); built.market.sig = ''; },
    buy: () => notice('Buying is unavailable', 'This market is a local practice prototype. Buying from other players needs a shared market service that is not available yet. No Ryo is charged.'),
    offer: () => notice('Offers are unavailable', 'Making offers needs a shared market service that is not available yet.')
  };

  /* ---------- Boss Hunt (game page 8): the real sanctuary canvas inside your frame ---------- */
  const GUARD = ['Akuma · Fallen Shinobi', 'Yuki Onna · Frozen Moon', 'Raijin · Thunder Lord', 'Daichi · Ancient Golem', 'Orochi · Serpent King', 'Shadow Emperor'];
  INIT['boss-hunt'] = b => {
    b.arena = place(mk('canvas', 'sbw-mirror', b.st), 222, 346, 770, 368); b.arena.width = 770; b.arena.height = 368; b.arena.style.objectPosition = '50% 62%';
    b.world = artMatch(b, cov(b, 50, 218, 160, 20, '#0d0407', 14, '#e9dcff', 'sbw-left'), 300);
    b.name = artMatch(b, cov(b, 50, 234, 520, 42, '#0d0407', 28, '#ffffff', 'sbw-left'), 600); b.name.style.fontWeight = '800';
    b.badge = cov(b, 806, 214, 176, 26, '#2a1a05', 15, '#ffd257');
    b.rec = artMatch(b, cov(b, 690, 254, 292, 22, '#05040d', 14, '#cfd8ee'), 684); b.rec.style.justifyContent = 'flex-end';
    b.hpbar = cv(b, 54, 282, 928, 22, 'sbw-hp'); b.hptext = artMatch(b, cov(b, 52, 312, 162, 22, '#05040d', 15, '#ffffff', 'sbw-left'), 214);
    b.list = [0, 1, 2, 3, 4].map(i => cv(b, 48, [353, 427, 499, 570, 642][i], 159, 69, 'sbw-blist'));
    // The artwork says "Deploy up to 10 ninjas"; the hunt team is the 5 strongest rested heroes.
    b.prep = artMatch(b, cov(b, 1030, 258, 450, 46, '#060a19', 16, '#e8ecf8', 'sbw-left sbw-wrap'), 1490);
    b.prep.textContent = 'Your 5 strongest rested deployed heroes fight. Their attacks, jutsu and chakra are used in the battle.';
    b.tpl = artMatch(b, cov(b, 1092, 330, 300, 20, '#0c192d', 13, '#cfd8ee', 'sbw-left'), 1270); b.tpv = artMatch(b, cov(b, 1092, 354, 240, 40, '#0c192d', 32, '#ffd257', 'sbw-left'), 1270); b.tpv.style.fontWeight = '800';
    b.rcm = artMatch(b, cov(b, 1300, 368, 190, 22, '#0c192d', 13, '#6ef294'), 1322); b.rcm.style.justifyContent = 'flex-end';
    b.dep = artMatch(b, cov(b, 1030, 420, 250, 24, '#060a19', 16, '#ffffff', 'sbw-left'), 1300);
    b.tiles = [1032, 1090, 1149, 1208, 1267].map(x => cv(b, x, 452, 54, 122, 'sbw-btile'));
    // The artwork's three extra "+" slots: a hunt takes at most five heroes.
    b.cap = cv(b, 1328, 452, 170, 88, 'sbw-bcap'); b.cap.innerHTML = '<b>5-hero team</b><span>Strongest rested heroes fight</span>';
    // Inside the CHALLENGE button's own artwork slice, so it pulses with the button.
    const chArt = $('.hs[data-sbwid="ch"] > .sl', b.st);
    b.chal = cov(b, 1186 - 1032, 618 - 605, 200, 40, 'linear-gradient(#ffc13a,#f39a12)', 25, '#2a1000'); b.chal.style.fontWeight = '900';
    if (chArt) { chArt.append(b.chal); artMatch(b, b.chal, 1392, 605); } else { place(b.chal, 1186, 618); artMatch(b, b.chal, 1392); }
    // Four single-line rows beside the artwork's four mechanic icons; no emoji duplicates.
    b.mech = [728, 758, 787, 817].map(y => artMatch(b, cov(b, 1062, y, 436, 26, '#04050f', 15, '#e1e6f7', 'sbw-left sbw-mechrow'), 1500));
    [['90 seconds · 1 chakra per projectile · Adventure pauses'], ['Shockwaves drain chakra every 8 seconds'], ['Below 35% HP it enrages: waves every 5 s drain 3 chakra'], ['Elite and Legend heroes show an ultimate every 8th volley']].forEach(([t], i) => setText(b.mech[i], t));
    b.rw = [1, 2, 3, 4, 5, 6, 7].map(i => { const h = b.s.hs.find(x => x.id === 'rw' + i); const e = cv(b, h.r[0], h.r[1], h.r[2] - h.r[0], h.r[3] - h.r[1], 'sbw-soon'); e.textContent = 'Not yet'; return e; });
    b.rw0 = artMatch(b, cov(b, 56, 834, 82, 22, '#2a1a05', 13, '#ffd257'), 136);
    // A garbled baked label sits just below the Legend Fragment tile.
    artMatch(b, cov(b, 160, 856, 98, 14, '#0a0f20', 10, '#0a0f20'), 150);
    b.ranks = cv(b, 32, 930, 960, 72, 'sbw-soonpanel'); b.ranks.innerHTML = '<b>Daily rankings are not available yet</b><span>Rankings need a shared leaderboard service.</span>';
    b.recp = cv(b, 1018, 930, 490, 72, 'sbw-recpanel');
  };
  function bossInfo() { const t = ((document.querySelector('#p8') || {}).innerText || ''); return { hunt: num(t, /HUNT\s*(\d+)/), name: (t.match(/HUNT\s*\d+\s*\n\s*([^\n]+)/) || [, ''])[1].trim(), status: (() => { const L = t.split('\n').map(x => x.trim()).filter(Boolean), i = L.findIndex(x => /^HUNT\s*\d+$/i.test(x)); return i >= 0 && L[i + 2] && L[i + 2].length < 24 ? L[i + 2] : ''; })(), hp: (t.match(/([\d,]+)\s*\/\s*([\d,]+)\s*HP/) || []), secs: num(t, /HP\s*·\s*(\d+)s/), dmg: num(t, /Damage dealt:\s*([\d,]+)/), reward: num(t, /FIRST-CLEAR REWARD\s*\n?\s*([\d,]+)\s*Ryo/i), chal: (t.match(/CHALLENGE\s*·\s*\d+/) || ['CHALLENGE'])[0], mech: (t.match(/Shockwaves[^\n]*/) || [''])[0] }; }
  PAINT['boss-hunt'] = (b, now) => {
    const x = bossInfo(), hunt = +x.hunt || 1, cur = Math.max(0, GUARD.indexOf(x.name)), cl = Math.max(0, hunt - 1);
    setText(b.world, `HUNT ${hunt}`); setText(b.name, x.name || GUARD[cur]); setText(b.badge, x.status || 'READY');
    const hp = +(x.hp[1] || '0').replace(/,/g, ''), max = +(x.hp[2] || '1').replace(/,/g, '') || 1, pct = Math.max(0, Math.min(100, Math.round(100 * hp / max)));
    b.hpbar.innerHTML = `<i style="width:${pct}%"></i><span>${pct}%</span>`; setText(b.hptext, `${x.hp[1] || '—'} / ${x.hp[2] || '—'} HP`);
    setText(b.rec, `${x.secs || 90}s · Damage dealt: ${x.dmg || 0}`);
    if (b.live.btimer) { b.live.btimer.hidden = false; setText(b.live.btimer, `${x.secs || 90}s`); }
    const lsig = hunt + x.name; if (lsig !== b.lsig) { b.lsig = lsig; b.list.forEach((e, i) => { const g = (cur + i) % GUARD.length; e.classList.toggle('on', i === 0); e.classList.toggle('lock', i > 0); e.innerHTML = `<b>${esc(GUARD[g].split(' · ')[0])}</b><span>${i === 0 ? 'Hunt ' + hunt : 'Hunt ' + (hunt + i)}</span>`; }); }
    setText(b.tpl, 'NEXT FIRST-CLEAR REWARD'); setText(b.tpv, `${x.reward || '—'} Ryo`); setText(b.rcm, 'Every 5th hunt: + Chunin hero'); setText(b.rw0, x.reward ? x.reward : '—');
    // The same choice V2.startBoss makes: the 5 strongest rested deployed heroes.
    let team = []; try { team = BattleRoster.list().filter(h => h.on && h.en >= 1).sort((p, q) => q.pw - p.pw).slice(0, 5); } catch { team = deployed().slice(0, 5); }
    setText(b.dep, `Hunt team (${team.length}/5)`);
    b.tiles.forEach((e, i) => { const h = team[i]; e.classList.toggle('empty', !h); e.style.setProperty('--rc', h ? RCOL[h.r] : '#2a3a6a'); const k = h ? h.id + ',' + h.lv : 'x'; if (e.dataset.k !== k) { e.dataset.k = k; e.innerHTML = h ? `<canvas width="53" height="70"></canvas><span>Lv. ${h.lv}</span><small>${esc(RNAME[h.r])}</small>` : '<b>+</b><small>Empty</small>'; } if (h) drawHero($('canvas', e), h, 1, now, 2); });
    setText(b.chal, x.chal.toUpperCase());
    if (cl !== b.ms) { b.ms = cl; b.recp.innerHTML = `<span>Highest damage<b>—</b></span><span>Best rank<b>—</b></span><span>Hunts cleared<b>${cl}</b></span>`; }
  };
  MIRROR['boss-hunt'] = b => mirror(b.arena, document.getElementById('bossHuntMap'));
  MODS['boss-hunt'] = {
    challenge: () => { if (!pressOnclick('#p8', 'V2.startBoss()')) toast('Deploy a rested hero first.'); },
    team: () => go(1),
    bossinfo: () => { const x = bossInfo(); notice(x.name || 'Guardian', `Hunt ${x.hunt || 1}. ${x.mech} First clear rewards ${x.reward || '—'} Ryo; every fifth hunt also awards a Chunin hero.`); },
    locked: () => toast('Clear the current hunt to face the next guardian.'),
    ranking: () => notice('Rankings', 'Daily rankings need a shared leaderboard service and are not available yet.')
  };

  /* ---------- Guild and Chat: previews (no backend yet) ---------- */
  ['guild', 'chat'].forEach(k => {
    INIT[k] = b => { const r = mk('div', 'sbw-preview', b.sec); r.innerHTML = k === 'guild' ? '<b>PREVIEW</b> Guilds are not available yet — this screen shows example artwork, not real players or data.' : '<b>PREVIEW</b> This screen shows example artwork. Live Global chat opens from the chat bar on Home.'; b.previewNotice = r; };
    MODS[k] = new Proxy({}, { get: () => () => notice(k === 'guild' ? 'Guild' : 'Chat', k === 'guild' ? 'Guilds are not available yet. This screen is a preview of the design.' : 'This screen is a preview of the design. Open live Global chat from the chat bar on Home.') });
  });

  /* ---------- the shared header (identical on every menu; fixed at the top) ---------- */
  let HDR = null;
  const NAVOF = { home: 'nav-home', heroes: 'nav-heroes', adventure: 'nav-adventure', summon: 'nav-summon', fusion: 'nav-fusion', dojo: 'nav-dojo', 'dojo-upg': 'nav-dojo', 'dojo-sen': 'nav-dojo', market: 'nav-market', 'boss-hunt': 'nav-bosshunt', codex: 'nav-codex', guild: 'nav-guild', chat: 'nav-guild' };
  function buildHeader() {
    const H = D.header, el = mk('div', 'sbw-hdr', layer), st = mk('div', 'sbw-hdr-stage', el); st.style.width = H.W + 'px'; st.style.height = H.H + 'px';
    const im = mk('img', 'sbw-hdr-img', st); im.src = BASE + H.img; im.alt = '';
    const hs = { img: H.img, W: H.W, H: H.H }, sl = (e, r) => { e.style.backgroundImage = `url(${BASE + H.img})`; e.style.backgroundSize = `${H.W}px ${H.H}px`; e.style.backgroundPosition = `${-r[0]}px ${-r[1]}px`; };
    const navhl = mk('div', 'sbw-navhl', st);
    const nav = {};
    H.hs.forEach((h, i) => {
      const r = h.r, e = mk('div', 'hs ' + (h.c || ''), st); place(e, r[0], r[1], r[2] - r[0], r[3] - r[1]); e.dataset.sbwid = h.id; e.style.setProperty('--i', i % 17); sl(mk('i', 'sl', e), r);
      e.tabIndex = 0; e.setAttribute('role', 'button'); e.setAttribute('aria-label', h.l || h.id.replace('nav-', ''));
      e.addEventListener('click', () => act('hdr', h, e)); e.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act('hdr', h, e); } });
      if (h.id.startsWith('nav-')) nav[h.id] = e;
    });
    const c = H.chest, cb = mk('div', 'hs chestbtn', st); place(cb, c.r[0], c.r[1], c.r[2] - c.r[0], c.r[3] - c.r[1]); cb.tabIndex = 0; cb.setAttribute('role', 'button'); cb.setAttribute('aria-label', 'Open your Chest');
    sl(mk('i', 'sl', cb), c.r); const label = place(mk('span', 'cbt sbw-chest', cb), c.tx, c.ty, c.tw, c.th); label.style.fontSize = c.fs + 'px'; label.dataset.fs = c.fs;
    const dot = place(mk('i', 'cdot', cb), c.dx, c.dy, c.ds, c.ds); dot.hidden = true; cb.addEventListener('click', openChest);
    const live = {}; H.live.forEach(l => { const e = mk('span', 'lv', st); place(e, l.x, l.y, l.w, l.h); e.style.fontSize = l.fs + 'px'; e.dataset.fs = l.fs; e.style.color = l.c; live[l.id] = e; });
    // The wallet pill artwork (icon, address, chevron) becomes one Connect/Disconnect button.
    const covers = {}, walletLabel = place(mk('span', 'sbw-walletbtn', st), 1303, 58, 203, 49); walletLabel.dataset.fs = 20; covers.wallet = walletLabel;
    const walletSpot = st.querySelector('[data-sbwid="wallet"]');
    // The artwork's gem pill shows the game's real presence count; its "+" becomes a
    // gear over which the game's own Tools menu (sound, community links) is placed.
    const online = place(mk('span', 'sbw-online', st), 1352, 15, 92, 29); online.title = 'Signed-in players active in the last 90 seconds';
    mk('small', '', online).textContent = 'PLAYERS ONLINE'; const count = mk('b', '', online); count.textContent = '—';
    const gear = place(mk('span', 'sbw-gear', st), 1455, 14, 31, 31); gear.setAttribute('aria-hidden', 'true');
    gear.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/></svg>';
    HDR = { el, st, nav, navhl, label, dot, chestEl: cb, live, covers, online: count, gear, walletSpot };
  }
  function markNav() {
    if (!HDR) return; const id = NAVOF[cur]; for (const k in HDR.nav) { const on = k === id; HDR.nav[k].classList.toggle('sbw-on', on); if (on) HDR.nav[k].setAttribute('aria-current', 'page'); else HDR.nav[k].removeAttribute('aria-current'); }
    const e = id && HDR.nav[id]; HDR.navhl.hidden = !e; if (e) { HDR.navhl.style.left = e.style.left; HDR.navhl.style.width = e.style.width; }
  }

  /* ---------- live refresh ---------- */
  function setText(e, t) { if (e && e.textContent !== t) { e.textContent = t; fitText(e); } }
  function fitText(e) { const base = +e.dataset.fs; if (!base) return; let fs = base; e.style.fontSize = fs + 'px'; while (e.scrollWidth > e.clientWidth + 1 && fs > 8) { fs -= 1; e.style.fontSize = fs + 'px'; } }
  function syncEffects() {
    if (!layer) return;
    const paused = String(document.hidden || RM || window.Arena3D?.cfg.fx === 0);
    const quality = String(window.Arena3D?.cfg.fx ?? 1);
    if (layer.dataset.effectsPaused !== paused) layer.dataset.effectsPaused = paused;
    if (layer.dataset.effectsQuality !== quality) layer.dataset.effectsQuality = quality;
  }
  function refresh(now = performance.now()) {
    syncEffects();
    if (document.hidden) return;
    const b = cur && built[cur]; if (!b) return;
    const l = ledger(), a = account(), pend = chestPending();
    const hb = HDR || b;
    if (hb.live.ryo) setText(hb.live.ryo, a && Number.isFinite(Number(l.balance)) ? fmt(Number(l.balance)) + ' Ryo' : '— Ryo');
    if (hb.label) { if (pend != null && Number.isFinite(pend)) countTo(hb.label, pend, v => 'Chest : ' + fmt(v)); else { counters.delete(hb.label); setText(hb.label, 'Chest'); } }
    if (hb.dot) hb.dot.hidden = !(pend >= 1);
    if (hb.walletSpot) {
      setText(hb.covers.wallet, a ? 'Disconnect' : 'Connect Wallet'); hb.covers.wallet.classList.toggle('sbw-connect', !a);
      const name = a ? 'Disconnect wallet ' + a.slice(0, 4) + '…' + a.slice(-4) : 'Connect wallet';
      if (hb.walletSpot.getAttribute('aria-label') !== name) { hb.walletSpot.setAttribute('aria-label', name); hb.walletSpot.title = name; }
    } else if (hb.covers.wallet) setText(hb.covers.wallet, a ? a.slice(0, 4) + '...' + a.slice(-4) : 'Sign in');
    if (hb.online) { const players = (document.getElementById('onlinePlayers')?.textContent || '').match(/\d[\d,]*/); setText(hb.online, a && players ? players[0] : '—'); }
    else if (hb.covers.gems) setText(hb.covers.gems, '⚙ Tools');
    for (const id of ['ltimer', 'btimer', 'cost', 'slabel', 'fcount', 'stitle', 'enemies', 'reward', 'team', 'upcost', 'trainlbl']) if (b.live[id]) b.live[id].hidden = true;
    (PAINT[cur] || (() => {}))(b, now);
  }

  /* ---------- show/hide over the matching game page ---------- */
  function fit() {
    geometryRevision++;
    const b = cur && built[cur]; if (!b) return;
    const vw = innerWidth, vh = innerHeight;
    if (HDR) {
      // Content starts at row 100, where the header art's left 70% ends (its clip-path hides another
      // page's fragments below). Only the wallet/Chest column, clipped at row 107, overhangs the
      // content, so no empty black strip is left between the header and the screen.
      const H = D.header, hs = Math.min(vw / H.W, (vh * 0.14) / H.body), Hh = 100 * hs, hx = (vw - H.W * hs) / 2;
      HDR.st.style.transform = `translate(${hx}px,0) scale(${hs})`; HDR.el.style.height = (107 * hs) + 'px';
      let noticeHeight = 0;
      // A full-width preview notice sits below the wallet column's overhang, not just the left art.
      if (b.previewNotice) { b.previewNotice.style.top = (107 * hs + 6) + 'px'; noticeHeight = b.previewNotice.offsetHeight + 12 + 7 * hs; }
      const contentTop = Hh + noticeHeight, top = b.s.hdrH || 0;
      const s = Math.min(vw / b.s.W, (vh - contentTop) / (b.s.H - top));
      // Crop the former per-screen header out of its own viewport. It must not
      // reappear behind the shared header or the reserved preview notice.
      b.sec.style.clipPath = `inset(${Hh}px 0 0)`;
      b.st.style.clipPath = `inset(${top}px 0 0)`;
      b.st.style.transform = `translate(${Math.max(0, (vw - b.s.W * s) / 2)}px,${contentTop - top * s}px) scale(${s})`;
    } else {
      const s = Math.min(vw / b.s.W, vh / b.s.H);
      b.st.style.transform = `translate(${Math.max(0, (vw - b.s.W * s) / 2)}px,${Math.max(0, (vh - b.s.H * s) / 2)}px) scale(${s})`;
    }
    placeTrigger(); placeChat();
  }
  /* align the game's real Chest trigger with the website Chest artwork */
  function placeTrigger() {
    const b = cur && built[cur]; if (!b) return;
    const hb = HDR || b, gh = HDR ? D.header.hdr : b.s.hdr; if (!hb.chestEl) return;
    const r = hb.chestEl.getBoundingClientRect(), d = document.documentElement.style;
    d.setProperty('--sbw-chest-x', r.left + 'px'); d.setProperty('--sbw-chest-y', r.top + 'px'); d.setProperty('--sbw-chest-w', r.width + 'px'); d.setProperty('--sbw-chest-h', r.height + 'px');
    // Tools opens from the gear; the whole pill (gem icon to gear) is the hit area.
    if (hb.gear) { const g = hb.gear.getBoundingClientRect(), left = g.right - (1486 - 1304) * g.width / 31;
      d.setProperty('--sbw-tools-x', left + 'px'); d.setProperty('--sbw-tools-y', g.top + 'px'); d.setProperty('--sbw-tools-w', (g.right - left) + 'px'); d.setProperty('--sbw-tools-h', g.height + 'px'); }
    else if (hb.covers.gems && gh) { const g = hb.covers.gems.getBoundingClientRect(), k = g.height / Math.max(1, (gh.gems.h || 1)); d.setProperty('--sbw-tools-x', (g.left - 46 * k) + 'px'); d.setProperty('--sbw-tools-y', (g.top - 8 * k) + 'px'); d.setProperty('--sbw-tools-w', (g.width + 54 * k) + 'px'); d.setProperty('--sbw-tools-h', (g.height + 16 * k) + 'px'); }
    const real = document.querySelector('[data-gc-chest]');
    if (real && !real._sbw) { real._sbw = true; real.addEventListener('mouseenter', () => hb.chestEl.classList.add('sbw-hover')); real.addEventListener('mouseleave', () => hb.chestEl.classList.remove('sbw-hover')); }
    hb.chestEl.tabIndex = real ? -1 : 0; hb.chestEl.setAttribute('aria-hidden', real ? 'true' : 'false');
  }
  function screenForPage() {
    if (!D || (window.LoginScreen && LoginScreen.active) || (window.GameLoading && GameLoading.active)) return null;
    let page; try { page = tab; } catch { return null; }
    if (preview) return preview;
    let mode = 0; try { mode = vm || 0; } catch {}
    const k = SHOWN[page === 4 ? '4:' + mode : String(page)] || null; return k === 'dojo' ? dojoView : k;
  }
  /* ---------- chat pop-up (Home chat bar) ---------- */
  // Global chat through the game's authenticated API (RyoPayments.chat → chat.cjs). Messages are
  // rendered as text only. It polls every 3s while open and every 20s for Home's chat bar.
  // The same request returns new System announcements (Legend summons) for the System tab.
  let chatPop = null, chatTab = 'Global', chatAfter = 0, sysAfter = 0, sysPrimed = false, sysUnread = false, chatOwner = null, chatTimer = 0, chatFetching = false, chatSending = false;
  const chatMsgs = [], sysMsgs = [], CHAT_KEEP = 50, WELCOME = 'Welcome to Shinobi Bombers! Forge your ninja way!';
  function chatBar() { return cur && built[cur] ? built[cur].sec.querySelector('[data-sbwid="chatbar"]') : null; }
  const chatReady = () => !!(window.RyoPayments?.chat && RyoPayments.state.authenticated);
  function chatNote(text, isError = false) { if (!chatPop) return; const n = $('.sbw-cp-note', chatPop); n.textContent = text; n.classList.toggle('sbw-cp-error', isError); n.setAttribute('role', isError ? 'alert' : 'status'); }
  function chatLine(cls, label, text, created) {
    const p = document.createElement('p'); p.className = cls; mk('i', '', p).textContent = label; p.append(text);
    if (created) { const d = new Date(created), t = mk('time', '', p); t.dateTime = d.toISOString(); t.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    return p;
  }
  function renderChat() {
    if (!chatPop || chatPop.hidden) return;
    const log = $('.sbw-cp-log', chatPop), stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40, nodes = [];
    if (chatTab === 'Guild') { const p = document.createElement('p'); p.className = 'sbw-cp-empty'; p.textContent = 'Guild chat opens when guilds launch.'; nodes.push(p); }
    else if (chatTab === 'System') { nodes.push(chatLine('sbw-cp-sys', '[System]', WELCOME)); for (const m of sysMsgs) nodes.push(chatLine('sbw-cp-sys sbw-cp-legend', '[System]', m.text, m.created)); sysUnread = false; }
    else {
      nodes.push(chatLine('sbw-cp-sys', '[Global]', WELCOME));
      for (const m of chatMsgs) {
        const p = document.createElement('p'), d = new Date(m.created); p.className = 'sbw-cp-msg' + (m.mine ? ' sbw-cp-mine' : '');
        mk('b', '', p).textContent = m.name; mk('small', '', p).textContent = m.from;
        const t = mk('time', '', p); t.dateTime = d.toISOString(); t.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        mk('span', '', p).textContent = m.text; nodes.push(p);
      }
    }
    log.replaceChildren(...nodes); if (stick) log.scrollTop = log.scrollHeight;
    const sysTab = $$('[role="tab"]', chatPop)[2]; sysTab.classList.toggle('sbw-cp-unread', sysUnread); sysTab.setAttribute('aria-label', sysUnread ? 'System, new announcement' : 'System');
    const input = $('input', chatPop), on = chatTab === 'Global' && chatReady();
    input.disabled = !on; $('button[type="submit"]', chatPop).disabled = !on || chatSending;
    input.placeholder = chatTab !== 'Global' ? 'Switch to Global to chat' : chatReady() ? 'Type your message…' : 'Sign in to chat';
  }
  function addMessages(target, list) {
    const seen = new Set(target.map(m => m.id)), added = (list || []).filter(m => !seen.has(m.id));
    target.push(...added); target.sort((a, b) => a.id - b.id); if (target.length > CHAT_KEEP) target.splice(0, target.length - CHAT_KEEP);
    return added.length;
  }
  function mergeChat(list, system) {
    const account = RyoPayments.state.account;
    if (account !== chatOwner) { chatOwner = account; chatMsgs.length = sysMsgs.length = 0; chatAfter = sysAfter = 0; sysPrimed = sysUnread = false; }
    addMessages(chatMsgs, list); chatAfter = chatMsgs.at(-1)?.id || chatAfter;
    if (system) {
      // Announcements already present at first load are history, not new.
      if (addMessages(sysMsgs, system) && sysPrimed && !(chatPop && !chatPop.hidden && chatTab === 'System')) sysUnread = true;
      sysAfter = sysMsgs.at(-1)?.id || sysAfter; sysPrimed = true;
    }
    renderChat(); refresh();
  }
  async function pollChat() {
    clearTimeout(chatTimer); const open = !!chatPop && !chatPop.hidden;
    if (!chatFetching && chatReady() && !document.hidden && (open || cur === 'home')) {
      chatFetching = true;
      try {
        if (RyoPayments.state.account !== chatOwner) mergeChat([]);
        const feed = await RyoPayments.chat('chat-list', { channel: 'global', after: chatAfter, systemAfter: sysAfter });
        mergeChat(feed.messages, feed.system);
        if (open && !chatSending && $('.sbw-cp-note', chatPop).classList.contains('sbw-cp-error')) chatNote('');
      } catch { if (open) chatNote('Chat is temporarily unavailable. Retrying…', true); }
      finally { chatFetching = false; }
    }
    chatTimer = setTimeout(pollChat, chatPop && !chatPop.hidden ? 3000 : 20000);
  }
  async function sendChat(e) {
    e.preventDefault(); const input = $('input', chatPop), text = input.value.trim();
    if (!text || chatSending || !chatReady()) return;
    chatSending = true; renderChat();
    try {
      mergeChat((await RyoPayments.chat('chat-send', { channel: 'global', text, name: (gs() && gs().nick) || 'Shinobi', after: chatAfter })).messages);
      input.value = ''; chatNote(''); updateCount();
    } catch (err) { chatNote(err.message || 'Message could not be sent.', true); }
    finally { chatSending = false; renderChat(); input.focus(); }
  }
  function updateCount() { $('.sbw-cp-count', chatPop).textContent = [...$('input', chatPop).value].length + ' / 200'; }
  function toggleChat(open) {
    if (!chatPop) {
      chatPop = mk('div', 'sbw-chatpop', layer); chatPop.hidden = true; chatPop.setAttribute('role', 'dialog'); chatPop.setAttribute('aria-label', 'Global chat');
      chatPop.innerHTML = `<div class="sbw-cp-head"><b>💬 GLOBAL CHAT</b><div class="sbw-cp-tabs" role="tablist">${['Global', 'Guild', 'System'].map((t, i) => `<button type="button" role="tab" aria-selected="${!i}">${t}</button>`).join('')}</div><button type="button" class="sbw-cp-x" aria-label="Close chat">✕</button></div>
        <div class="sbw-cp-log" role="log" aria-live="polite"></div>
        <p class="sbw-cp-note" role="status"></p>
        <form class="sbw-cp-in"><input type="text" maxlength="200" autocomplete="off" aria-label="Message"><small class="sbw-cp-count">0 / 200</small><button type="submit">Send</button></form>
        <p class="sbw-cp-rules">Be kind. Links are blocked, and the team never messages you first about wallets or trades.</p>`;
      $('.sbw-cp-x', chatPop).onclick = () => toggleChat(false);
      $('form', chatPop).onsubmit = sendChat;
      $('input', chatPop).addEventListener('input', updateCount);
      $$('[role="tab"]', chatPop).forEach(tab => tab.onclick = () => { chatTab = tab.textContent; $$('[role="tab"]', chatPop).forEach(t => t.setAttribute('aria-selected', String(t === tab))); renderChat(); });
      chatPop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); toggleChat(false); } });
      document.addEventListener('pointerdown', e => { if (!chatPop.hidden && !chatPop.contains(e.target) && !chatBar()?.contains(e.target)) toggleChat(false); });
    }
    const show = open ?? chatPop.hidden, bar = chatBar();
    chatPop.hidden = !show; bar?.setAttribute('aria-expanded', String(show));
    if (show) {
      placeChat(); renderChat(); const log = $('.sbw-cp-log', chatPop); log.scrollTop = log.scrollHeight;
      (chatReady() ? $('input', chatPop) : $('.sbw-cp-x', chatPop)).focus(); pollChat();
    } else if (bar && chatPop.contains(document.activeElement)) bar.focus();
  }
  // Above the bar when there is room, otherwise below it; never wider than the viewport.
  function placeChat() {
    if (!chatPop || chatPop.hidden) return;
    const r = chatBar()?.getBoundingClientRect(), w = Math.min(innerWidth - 32, Math.max(380, r ? r.width : 420)), s = chatPop.style;
    s.width = w + 'px'; s.left = Math.max(16, Math.min(innerWidth - 16 - w, r ? r.left + r.width / 2 - w / 2 : 16)) + 'px';
    const above = r ? r.top - 24 : innerHeight - 32;
    if (!r || above >= 260) { s.top = ''; s.bottom = (r ? innerHeight - r.top + 8 : 16) + 'px'; s.maxHeight = Math.min(420, above) + 'px'; }
    else { s.bottom = ''; s.top = (r.bottom + 8) + 'px'; s.maxHeight = Math.min(420, innerHeight - r.bottom - 24) + 'px'; }
  }
  function sync() {
    const k = screenForPage();
    if (k !== cur) {
      if (chatPop && !chatPop.hidden) toggleChat(false);
      if (cur && built[cur]) built[cur].sec.classList.remove('on');
      cur = k; if (k === 'home') pollChat();
      if (k) { const b = built[k] || build(k); b.sec.classList.add('on'); if (!RM) { b.sec.classList.remove('enter'); void b.sec.offsetWidth; b.sec.classList.add('enter'); } }
      layer.hidden = !k; markNav();
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
    if (D.header) buildHeader();
    const prior = window.go;
    if (typeof prior === 'function') { window.go = function (...args) { preview = null; if (args[0] !== 4 || args[1]) dojoView = 'dojo'; const r = prior.apply(this, args); queueMicrotask(sync); return r; }; }
    addEventListener('shinobi-navigation', sync);
    addEventListener('shinobi-ryo-ledger', () => refresh());
    addEventListener('shinobi-beta-wallet', () => refresh());
    addEventListener('shinobi-chest', () => refresh());
    // Defeats trigger verified Chest syncs in gameplay-options/options.js (KillReport).
    addEventListener('resize', fit);
    motionPreference.addEventListener('change', event => { RM = event.matches; refresh(); });
    document.addEventListener('visibilitychange', () => { syncEffects(); if (!document.hidden) sync(); });
    const nt = document.getElementById('toast'); if (nt) new MutationObserver(() => { if (cur && nt.textContent.trim()) toast(nt.textContent.trim()); }).observe(nt, { childList: true, characterData: true, subtree: true });
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('click', e => { const g = e.target.closest('#sbwLayer .gt'); if (!g) return; if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body); dlg.innerHTML = `<h2>${esc(g.dataset.t)}</h2><img class="sbw-lb" src="${g.dataset.src}" alt="${esc(g.dataset.t)}"><div class="sbw-acts"><button type="button" class="sbw-btn">Close</button></div>`; $('button', dlg).onclick = () => dlg.close(); dlg.showModal(); });
    setInterval(() => { sync(); placeTrigger(); }, 700);
    let last = 0; const loop = now => { if (!document.hidden) { if (cur && MIRROR[cur] && built[cur]) { try { MIRROR[cur](built[cur]); } catch {} } if (cur && now - last > 120) { last = now; const b = built[cur]; if (b && PAINT[cur]) { try { PAINT[cur](b, now); } catch (e) { if (!loop.warned) { loop.warned = true; console.error('[website-design]', e); } } } } } requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    sync();
    window.WebsiteDesign = { ready: true, screens: Object.keys(D.screens), current: () => cur, refresh: sync };
  }
  init().catch(e => console.error('Website designs could not be applied:', e));
})();
