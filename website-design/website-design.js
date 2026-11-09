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
  const RCOL = ['#c9d2e3', '#35e06b', '#2aa8ff', '#b45cff', '#ffc13a', '#c98bff'], RNAME = ['Genin', 'Chunin', 'Jonin', 'Elite', 'Legend', 'Mythic'];
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  // Reduced motion: the system setting or the player's Display & Accessibility choice.
  let RM = motionPreference.matches || !!window.DisplaySettings?.v.reduceMotion, geometryRevision = 0;
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
  function liveRevenue() { return ledger().configuration?.revenueDistribution?.applicable === true; }
  function account() { const l = ledger(); return l.authenticated ? l.account : null; }
  // Spendable Ryo: the withdrawable balance plus test-server starter Ryo (spend only).
  const spendable = (l = ledger()) => (Number(l.balance) || 0) + (Number(l.bonus) || 0);
  // Header wallet pill: the game's own Disconnect (which returns to its sign-in screen),
  // or that sign-in screen when signed out. No wallet logic of its own.
  function walletButton() {
    if (account()) goOffline();
    else window.LoginScreen?.show();
  }
  // GO OFFLINE: save the battle's pending kills to the Chest, tell the server the player is offline
  // from now (active=false), then disconnect with the game's own button. The server pays Sensei
  // offline time on the next sign-in; Welcome back reports it.
  const OFFLINE_KEY = 'shinobi-offline-v1';
  function goOffline() {
    const d = dojoState();
    if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body);
    const status = !d.hired ? '<p class="sbw-off-warn">No Sensei is hired, so your heroes will not earn while you are offline. Hire or rent one in Dojo → Sensei.</p>'
      : !d.on ? '<p class="sbw-off-warn">Your Sensei is hired, but rotation is off, so it will not earn while you are offline.</p>'
      : `<p>Your Sensei keeps your team fighting for up to 12 hours${d.rental ? ' (rental: ' + timeLeft(d.left) + ')' : ''}. Earnings go straight to your Chest.</p>`;
    const go = !d.hired ? '<button type="button" class="sbw-btn" data-k="sensei">Go to Sensei</button><button type="button" class="sbw-btn sbw-alt" data-k="go">Go offline anyway</button>'
      : !d.on ? '<button type="button" class="sbw-btn" data-k="on">Turn on Sensei &amp; go offline</button><button type="button" class="sbw-btn sbw-alt" data-k="go">Go offline anyway</button>'
      : '<button type="button" class="sbw-btn" data-k="go">Go offline</button>';
    dlg.className = 'sbw-dialog sbw-offline'; dlg.onclick = null;
    dlg.innerHTML = `<h2>Go offline?</h2>${status}<p class="sbw-small">Your latest kills are saved to your Chest first, then your wallet is disconnected.</p><p class="sbw-off-msg" role="alert" hidden></p><div class="sbw-acts"><button type="button" class="sbw-btn sbw-alt" data-k="stay">Stay online</button>${go}</div>`;
    dlg.addEventListener('close', () => dlg.classList.remove('sbw-offline'), { once: true });
    dlg.onclick = async e => {
      const k = e.target.dataset && e.target.dataset.k; if (!k) return;
      if (k === 'stay') return dlg.close();
      if (k === 'sensei') { dlg.close(); return MODS.dojo.focus('sen'); }
      const buttons = $$('.sbw-acts button', dlg), msg = $('.sbw-off-msg', dlg);
      buttons.forEach(b => b.disabled = true); e.target.textContent = 'Saving…';
      try {
        await window.CombatClient?.beginOffline?.();
        if (k === 'on') await RyoPayments.senseiSettings(d.pct, true);
        const owner = account(), chest = await RyoPayments.adventure(false, false);
        try { localStorage.setItem(OFFLINE_KEY, JSON.stringify({ account: owner, lifetime: Number(chest.pending || 0) + Number(chest.claimed || 0), at: Date.now() })); } catch {}
        dlg.close();
        const native = document.getElementById('betaDisconnect'); if (native && !native.disabled) native.click();
      } catch (err) {
        window.CombatClient?.cancelOffline?.();
        // Stay signed in so nothing is lost; the player can retry.
        msg.hidden = false; msg.textContent = (err && err.message) || 'Could not save your progress. Check your connection and try again.';
        buttons.forEach(b => b.disabled = false); e.target.textContent = 'Try again';
      }
    };
    if (!dlg.open) dlg.showModal();
  }
  // Welcome back: the first verified Chest sync after signing in includes the Sensei's offline earnings.
  function welcomeBack() {
    let saved; try { saved = JSON.parse(localStorage.getItem(OFFLINE_KEY) || 'null'); } catch { return; }
    const snap = window.AdventureChest && AdventureChest.snapshot, a = account();
    if (!saved || !a || saved.account !== a || !snap || snap.busy || !snap.chest || snap.owner !== a) return;
    try { localStorage.removeItem(OFFLINE_KEY); } catch {}
    const earned = Math.max(0, Number(snap.chest.pending || 0) + Number(snap.chest.claimed || 0) - Number(saved.lifetime || 0));
    const mins = Math.max(0, Math.round((Date.now() - Number(saved.at || Date.now())) / 60000)), away = mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm';
    const d = dojoState();
    notice('Welcome back!', earned >= 1 ? `Your Sensei earned ${fmt(earned)} Ryo while you were offline for ${away}. It is in your Chest.`
      : `You were offline for ${away}. ${!d.hired ? 'No Sensei was hired, so your heroes rested.' : !d.on ? 'Sensei rotation was off, so nothing was earned.' : 'Your team earned nothing this time (short break or no chakra).'}`);
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
    if (k === 'creators') return window.CreatorsPortal?.open();
    window.CreatorsPortal?.close();
    if (k.startsWith('guild') || k === 'chat') { const p = k === 'chat' ? 'chat' : 'guild'; if (D.screens[p]) { preview = p; sync(); return; } return notice(p === 'chat' ? 'Chat' : 'Guild', p === 'chat' ? SOON.chat : SOON.guild); }
    preview = null; if (k === 'dojo') dojoView = 'dojo';
    const r = ROUTE[k]; if (r) go(r[0], r[1]);
  }
  const HOME = {
    'logo': () => {}, 'prof': editNickname, 'mng': () => go(1), 't1': () => go(1), 't2': () => go(1), 't3': () => go(1), 't4': () => go(1), 't5': () => go(1),
    'ev': () => openFounders(),
    'go1': () => notice('Daily missions', 'Daily missions are not available yet.'), 'go2': () => notice('Daily missions', 'Daily missions are not available yet.'), 'go3': () => notice('Daily missions', 'Daily missions are not available yet.'),
    'season': () => notice('Season 1', 'Seasons are not available yet.'), 'tut': () => window.CreatorsPortal?.open(), 'news': () => window.CreatorsPortal?.openPlayer(),
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
    // Replace the whole Tutorial slice, including the baked-in label and question icon.
    const creator = b.st.querySelector('[data-sbwid="tut"]');
    if (creator) { creator.classList.add('sbw-creator-button'); creator.setAttribute('aria-label', 'Creator'); creator.setAttribute('aria-haspopup', 'dialog'); creator.setAttribute('aria-controls', 'creatorsPanel'); creator.innerHTML = '<span aria-hidden="true">✦</span><span>Creator</span>'; }
    const referral = b.st.querySelector('[data-sbwid="news"]');
    if (referral) { referral.classList.add('sbw-creator-button'); referral.setAttribute('aria-label', 'Referral'); referral.setAttribute('aria-haspopup', 'dialog'); referral.setAttribute('aria-controls', 'creatorsPanel'); referral.innerHTML = '<span aria-hidden="true">♧</span><span>Referral</span>'; }
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
    // EVENT: the Limited Mythic NFT Box card covers the printed banner inside the ev hotspot.
    const evArt = b.st.querySelector('[data-sbwid="ev"] > .sl');
    if (evArt) { b.box = place(mk('div', 'sbw-boxcard', evArt), 0, 0, 369, 132); b.box.innerHTML = '<img src="/founders/art/mythic.png" alt=""><div><small>LIMITED EVENT</small><b>FOUNDER BOXES</b><span>Mythic &amp; Legacy · Founder sale</span><em>Founder sale</em></div><i>VIEW</i>'; }
    b.tiles = [1270, 1345, 1420, 1494, 1569].map((x, i) => { const t = place(mk('div', 'sbw-tile', b.st), x, 302, 66, 122); const cv = mk('canvas', '', t); cv.width = 132; cv.height = 150; mk('b', '', t); t.addEventListener('click', () => go(1)); return t; });
  };
  PAINT.home = (b, now) => {
    // EVENT card: the live Founder sale (prices and boxes left come only from the server's founders-info).
    if (b.box) { if (!FDS.busy && Date.now() - FDS.at > 60000) foundersLoad(); const f = FDS.info, t = f && f.tiers, sold = !!(t && t.mythic.soldOut && t.legacy.soldOut);
      if (t) setText($('span', b.box), 'Mythic ' + t.mythic.price + ' · Legacy ' + t.legacy.price + ' SOL');
      setText($('em', b.box), !t ? 'Founder sale' : f.paused ? 'Sale paused' : sold ? 'SOLD OUT' : t.mythic.remaining + ' + ' + t.legacy.remaining + ' left'); b.box.classList.toggle('sold', sold || !!(f && f.paused)); }
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
      const label = h ? `Lv. ${h.lv}` : 'Deploy', title = h ? `${h.name} · ${RNAME[h.r]} · Lv. ${h.lv}` : 'Deploy a hero from Heroes';
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
      case 0: return `<p><b>1 Attack = Hero Power Damage = 1 Chakra</b><br>Skill VFX = 0 Additional Chakra</p><p>Shinobi Bombers is a grid bomber: heroes move tile by tile, blasts travel in a cross and break wooden crates, while stone blocks stop them.</p><div class="cxg"><div><b>Deploy</b><span>Up to 10 shinobi. Each one hunts automatically and spends 1 chakra per attack.</span></div><div><b>Recovery</b><span>Out of chakra? Deployed heroes nap until full – faster in a better Dojo. Battle-ready heroes recover on the bench; Reserve heroes do not.</span></div><div><b>Victory</b><span>Defeat every enemy to advance. Every 25th stage is a guardian encounter.</span></div></div><h4>Adventure map boards</h4>${gal(R2.maps, x => x.n)}`;
      case 1: return `<p><b>1 Attack = Hero Power Damage = 1 Chakra</b><br>Skill VFX = 0 Additional Chakra</p><p>Genin 1/1 · Chunin 2/2 · Jonin 3/3 · Elite 4/4 · Legend 5/5 · Mythic 7/7</p>${CombatRules.PERKS.map(p=>'<h4>'+esc(p.name)+'</h4><p>'+esc(p.description)+'</p>').join('')}`;
      case 2: return `<p>Element and rarity are independent: an element changes a hero's jutsu and aura colour, never their rank.</p><h4>Hero models · four directions</h4>${gal([R2.models], () => 'All 12 hero models')}`;
      case 3: return `<div class="cxg"><div><b style="color:#c9d2e3">Genin </b><span>Starting rank · 1 perk</span></div><div><b style="color:#35e06b">Chunin </b><span>2 perks</span></div><div><b style="color:#2aa8ff">Jonin </b><span>3 perks</span></div><div><b style="color:#b45cff">Elite </b><span>4 perks</span></div><div><b style="color:#ffc13a">Legend </b><span>Top summon rank · 5 perks</span></div><div><b style="color:#c98bff">Mythic</b><span>Tsukiyomi · NFT only · 7 perks</span></div></div><p>Genin 1/1 · Chunin 2/2 · Jonin 3/3 · Elite 4/4 · Legend 5/5 · Mythic 7/7</p><p>Fusion combines three heroes of the same rank. Legend is the highest rank you can summon or fuse and stays tradable. Mythic Tsukiyomi comes only with the Limited NFT Box and moves with that NFT.</p><h4>Rarity aura system</h4>${gal([R2.aura, R2.auralayer], x => (x === R2.aura ? 'Hero aura system' : 'Aura render layering'))}`;
      case 4: return `<div class="cxg"><div><b>Save burst</b><span>Skill animations are cosmetic and spend no additional chakra.</span></div><div><b>Balance</b><span>Mix damage dealers with chakra support.</span></div><div><b>Read the board</b><span>Blasts stop at stone – line up crates.</span></div><div><b>Rotate</b><span>A Sensei swaps in rested heroes automatically.</span></div></div><h4>Hero animation reference</h4>${gal([R2.hayate], () => 'Hayate – animation & VFX reference')}`;
      case 5: return `<p>Each boss has idle, walk, hurt and death animations plus signature attacks, ending in a rage mode at low HP.</p><h4>Boss concept sheets</h4>${gal(R2.bosses, x => `${x.n} · ${x.t}`)}<h4>Akuma animation sheets</h4>${gal(R2.akuma, x => 'Akuma sprite sheet ' + (R2.akuma.indexOf(x) + 1))}`;
      case 6: return `<div class="cxg"><div><b>Adventure Ryo</b><span>Earned while your team works stages. It collects in your Chest.</span></div><div><b>Claim</b><span>Moves verified Chest Ryo into your game balance – not an on-chain withdrawal.</span></div><div><b>Withdraw / Deposit</b><span>Use the Chest's own limits, fees, cooldown and wallet steps.</span></div></div><p><button class="gb" type="button" data-cx="chest">Open Chest</button></p>`;
      case 7: return `<div class="faq"><details open><summary>How many heroes can I deploy?</summary><p>Up to 10 at once, from up to 50 battle-ready heroes.</p></details><details><summary>Can Legend heroes be fused further?</summary><p>No – Legend is the top rank.</p></details><details><summary>Where do Adventure rewards go?</summary><p>Into your Chest. Claim them to make them spendable.</p></details><details><summary>Are Guild and Chat available?</summary><p>Not yet – they are coming soon.</p></details></div>`;
      default: return '';
    }
  }
  INIT.codex = b => {
    // Opaque panel interiors replace outdated star ratings and combat claims in the artwork.
    const panel=(cls,x,y,w,h,html)=>{const e=place(mk('div',cls,b.st,html),x,y,w,h);Object.assign(e.style,{position:'absolute',zIndex:'15',background:'linear-gradient(135deg,#111329,#030916)',color:'#dde5f7',borderRadius:'8px',boxShadow:'inset 0 0 12px #020610',padding:'9px 12px',boxSizing:'border-box',fontSize:'17px',lineHeight:'1.4'});return e;};
    panel('sbw-codex-ranks',1247,478,397,187,RNAME.map((name,i)=>'<div style="display:flex;justify-content:space-between;line-height:28px"><b style="color:'+RCOL[i]+'">'+name+'</b><span>'+[1,2,3,4,5,7][i]+' unique perk'+(i?'s':'')+'</span></div>').join(''));
    panel('sbw-codex-elements',1247,373,397,44,'Elements change cosmetic effects.').style.padding='3px 12px';
    panel('sbw-codex-tips',1247,727,397,177,'<p style="margin:0 0 12px">One attack spends one chakra.</p><p style="margin:0 0 12px">Skill effects add no damage or cost.</p><p style="margin:0">Battle-ready heroes recover chakra on the bench; Reserve heroes do not.</p>');

    b.cx = place(mk('div', 'cxp', b.st), 306, 212, 896, 698); b.cx.hidden = false; b.cx.style.animation='none';
    b.cx.addEventListener('click', e => { if (e.target.closest('[data-cx=chest]')) openChest(); });
    MODS.codex.sec(1);
  };
  MODS.codex = {
    sec: a => { const i = +a, b = built.codex; for (let n = 0; n < 8; n++) { const e = $(`.hs[data-sbwid="cs${n}"]`, b.st); if (e) { e.classList.toggle('on2', n === i); e.classList.toggle('dimact', n === 1 && i !== 1); } } b.cx.hidden = false; b.cx.innerHTML = `<h2>${CXT[i]}</h2><div class="cxb">${cxHtml(i)}</div>`; b.cx.scrollTop = 0; },
    elem: a => toast(['Fire – cosmetic flame effects', 'Water – cosmetic flowing effects', 'Wind – cosmetic wind effects', 'Shadow – cosmetic shadow effects', 'Lightning – cosmetic lightning effects'][+a])
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
    fee.classList.add('sbw-summon-fee'); fee.textContent = liveRevenue() ? 'SR revenue: 50 / 30 / 10 / 10 · no burn' : 'Price includes the 2% studio share';
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
    summon: () => {
      if (pressOnclick('#p2', 'Combat.summonBatch()')) return;
      if (!account()) return toast('Sign in with your wallet to summon.');
      // The native button is disabled when the game balance cannot pay the total: say so and open the Chest to deposit.
      const total = nativeText('#p2', /Total\s+[\d,]+\s*Ryo/i).replace(/^Total\s+/i, ''), price = Number(total.replace(/[^\d]/g, ''));
      if (window.GameCurrency && price > 0 && !GameCurrency.canAfford(price)) { toast('Not enough Ryo for this summon (' + total + '). Deposit SR from your Chest first.'); return openChest(); }
      toast('Summon is busy – try again in a moment.');
    },
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
    setText(b.lineTop, `Combine the weakest ${RNAME[rank]} heroes · 3 → 1 each · ${rank === 3 ? 'Lv 5 Elites only' : 'Reserve heroes only'} · ${success}`);
    setText(b.lineFoot, nativeText('#p6', /Up to \d+ attempts[^\n]*/) || 'Failed attempts consume heroes and charge the fee');
    setText(b.note, `The resulting hero will be a ${RNAME[rank + 1]} with improved base stats and a guaranteed rank jutsu.`);
    setText(b.rarity, RNAME[rank + 1]); b.rarity.style.color = RCOL[rank + 1];
    setText(b.jutsu, (nativeText('#p6', /JUTSU\s*\n\s*\d+/).match(/\d+$/) || ['—'])[0]);
    for (let i = 0; i < 4; i++) for (const id of ['r' + (i + 1), 'et' + (i + 1)]) { const e = $(`.hs[data-sbwid="${id}"]`, b.st); if (e) e.classList.toggle('on2', i === rank); }
    const sig = rank + '|' + rows.map(r => r.id + (r.checked ? '*' : '') + (r.disabled ? '!' : '')).join('|');
    if (sig !== b.sig) {
      b.sig = sig;
      const locked = r => /Lv 5 needed/.test(r.info), eligible = rows.filter(r => !locked(r)).length;
      b.list.innerHTML = rows.length ? (rank === 3 && eligible < 3 ? `<p class="sbw-fnote">Elite → Legend fusion needs three level 5 Elites (${eligible} ready). Train Elites to level 5 in the Dojo.</p>` : '') + rows.map((r, i) => `<button type="button" class="sbw-frow${r.checked ? ' on' : ''}${locked(r) ? ' locked' : ''}" data-i="${i}" ${r.disabled ? 'disabled' : ''} aria-pressed="${r.checked}" aria-label="${locked(r) ? esc(r.name) + ', level 5 needed' : 'Select ' + esc(r.name)}"><i>${r.checked ? '✓' : locked(r) ? '🔒' : ''}</i><canvas width="72" height="78" data-id="${r.id}"></canvas><span class="sbw-fname"><b>${esc(r.name)}</b><small style="color:${RCOL[rank]}">${esc(r.info)}</small></span>${r.stats.map(v => `<em>${esc(v)}</em>`).join('')}<span class="sbw-fj">${esc(r.jutsu)}</span></button>`).join('')
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
    // Keep both cards still (no breathing or light sweep): their printed values are covered by fixed
    // patches that must match the art behind them, and the card art
    // contains the ENTER DOJO / MANAGE SENSEI buttons, so a breathing card made the values float
    // and showed a second, offset button. The two buttons glow on hover/pulse instead of growing.
    for (const id of ['dcard', 'scard']) $(`.hs[data-sbwid="${id}"]`, b.st)?.classList.remove('breathe', 'sh');
    for (const id of ['enter', 'msen']) $(`.hs[data-sbwid="${id}"]`, b.st)?.classList.add('noscale');
    const fixed = (x, y, w, h, sx, cls = '') => { const e = place(mk('span', 'sbw-cover sbw-dsvc ' + cls, b.st), x, y, w, h); e.dataset.mapped = '1'; artMatch(b, e, sx); return e; };
    b.pill = fixed(104, 657, 128, 46, 240, 'sbw-dpill'); mk('b', '', b.pill);
    b.name = fixed(108, 704, 540, 38, 660, 'sbw-dname sbw-left');
    b.rate = fixed(178, 766, 92, 34, 300, 'sbw-dval sbw-left');
    b.lvl = fixed(630, 766, 70, 34, 702, 'sbw-dval sbw-left');
    // Aligned to the artwork: "Auto Rotation" and its value both start at x 923; value caps span y 874–891.
    b.rot = fixed(914, 868, 112, 36, 1024, 'sbw-drot sbw-left');
    for (const e of [b.name, b.rate, b.lvl, b.rot]) e.dataset.fs = { 'sbw-dname': 32, 'sbw-dval': 26, 'sbw-drot': 22 }[[...e.classList].find(c => /^sbw-d(name|val|rot)$/.test(c))];
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
    // The artwork prints the original tier prices; each paid row's price is covered (artwork-matched background from
    // the empty gap left of the prices) and redrawn from the game's live prices (GameBalance.dojoPrices).
    b.price = DROWY.map((y, i) => { if (!i) return null; const e = place(mk('span', 'sbw-cover sbw-dprice', b.st), 1440, y - 21, 165, 42); e.dataset.mapped = '1'; artMatch(b, e, 1432); return e; });
    b.up = place(mk('button', 'sbw-dup', b.st), 78, 760, 480, 70); b.up.type = 'button'; b.up.onclick = () => MODS.dojo.upgrade();
  };
  PAINT['dojo-upg'] = b => {
    const tier = dojoState().tier, next = tier + 1, prices = (window.GameBalance && GameBalance.dojoPrices) || [], rec = (window.GameBalance && GameBalance.dojoRecovery) || [];
    setText(b.tier, 'TIER ' + (ROMAN[tier] === '–' ? '0' : ROMAN[tier])); setText(b.name, (DOJO_NAMES[tier] || '').toUpperCase());
    b.rate.innerHTML = `<b>${rec[tier] || 1}/min</b>`; b.lvl.innerHTML = `<b>${tier}/6</b>`;
    b.rowhl.style.top = (DROWY[tier] - 41) + 'px';
    b.price.forEach((e, i) => { if (!e) return; const v = Number(prices[i]), t = v > 0 ? fmt(v) + ' Ryo' : prices[i] === 0 ? 'Free' : ''; if (e.textContent !== t) e.textContent = t; });
    b.stat.forEach((e, i) => { const [t, c] = i < tier ? ['Unlocked', 'own'] : i === tier ? ['Active', 'act'] : i === next ? ['Next', 'nxt'] : ['—', 'lck']; if (e.textContent !== t) e.textContent = t; e.className = 'sbw-dstat ' + c; });
    const k = next <= 6 ? `<i>⌂</i><span>UPGRADE - ${fmt(prices[next])} Ryo</span>` : '<i></i><span>MAX TIER REACHED</span>'; if (b.up.dataset.k !== k) { b.up.dataset.k = k; b.up.innerHTML = k; } b.up.disabled = next > 6;
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
    if (document.activeElement !== b.sel && b.sel.value !== String(pct)) b.sel.value = String(pct);
    if (b.sel.disabled !== !hired) { b.sel.disabled = !hired; b.sel.title = hired ? '' : 'Hire or rent a Sensei to choose when rested heroes return'; }
    setText(b.svc, `${DOJO_NAMES[tier]} ✓`); setText(b.cnt, hired ? '1' : '0');
    b.tg.classList.toggle('on', hired && on); b.tg.setAttribute('aria-checked', String(hired && on)); b.tg.innerHTML = `<span>${hired && on ? 'ON' : 'OFF'}</span><i></i>`;
    const k = hired + '|' + on + '|' + rental + '|' + !!(window.FounderPanel && FounderPanel.sensei && FounderPanel.sensei.mode());
    if (b.st2.dataset.k !== k) { b.st2.dataset.k = k;
      b.st2.innerHTML = hired ? `<b class="ok">✓</b><strong>${rental ? 'RENTED' : 'HIRED'}</strong><small>${rental ? 'Rental active until ' + new Date(rental).toLocaleString() + '.' : 'Permanent automatic rotation and up to 12 hours of offline earnings.'}</small>`
        : `<b class="no">!</b><strong>NOT HIRED</strong><small>${window.FounderPanel && FounderPanel.sensei && FounderPanel.sensei.mode() ? 'Hire permanently with a one-time SOL payment to keep your team rotating.' : 'Hire permanently or rent for 7 days to keep your team rotating.'}</small>`;
      b.btn.textContent = !hired ? 'HIRE SENSEI' : on ? 'TURN OFF' : 'TURN ON'; }
  };
  function senseiPane() { if (window.DojoServices) DojoServices.open('sensei'); }
  // Live: the Sensei is a one-time SOL purchase (owner decision 2026-11-09); no Ryo hire and no Ryo rental.
  // The price comes from the server (Legacy Founder price included); the USD value is an estimate, shown when known.
  function hireSenseiSol(sol) {
    // The dialog element is shared with other screens: reset its style, and redraw later only while this exact Sensei
    // dialog is still the one shown (its heading carries this opening's token).
    const token = 'ss' + Date.now() + Math.random().toString(36).slice(2);
    dlg.className = 'sbw-dialog';
    const ours = () => dlg.open && !!dlg.querySelector(`h2[data-sensei="${token}"]`);
    const draw = (o, problem) => {
      // Before the price has loaded the button still works: the server prices the payment and the wallet shows it.
      const label = o && o.mythicIncluded ? 'Open Founder benefits' : o ? `Hire permanently · ${o.price} SOL${o.usd ? ` (≈ $${o.usd.toFixed(2)})` : ''}` : 'Hire permanently with SOL';
      dlg.innerHTML = `<h2 data-sensei="${token}">Hire a Sensei</h2><p>A Sensei swaps rested heroes back into battle and keeps Adventure earning while you are away (up to 12 hours).</p><p class="sbw-small" data-r="note"></p><div class="sbw-acts"><button type="button" class="sbw-btn sbw-alt" data-k="x">Cancel</button><button type="button" class="sbw-btn" data-k="sol"></button></div><p class="sbw-small">One-time payment in SOL from your wallet; your wallet shows the exact amount before you approve. The $ value is an estimate.</p>`;
      const buy = dlg.querySelector('[data-k="sol"]'); buy.textContent = label; buy.disabled = !!o && !o.mythicIncluded && !o.enabled;
      dlg.querySelector('[data-r="note"]').textContent = problem || (o && o.mythicIncluded ? 'Included free with your Mythic Founder box: activate it in Founder benefits.' : o && o.founderDiscount ? `Legacy Founder price (regular ${o.regularPrice} SOL) until ${new Date(o.trialEnds).toLocaleString()}.` : o && !o.enabled ? 'SOL Sensei purchases are paused right now.' : '');
    };
    // The purchase runs right here on the Sensei tab (owner decision 2026-11-10: not in the Founder panel); each step is
    // shown in the dialog and the buttons stay locked until it ends. Closing the dialog never cancels a signed payment.
    let busy = false;
    const status = text => { if (!ours()) return; const n = dlg.querySelector('[data-r="note"]'); n.textContent = text; };
    const lock = on => { busy = on; if (!ours()) return; dlg.querySelector('[data-k="sol"]').disabled = on; };
    draw(sol.cached());
    dlg.onclick = e => {
      const k = e.target.dataset && e.target.dataset.k; if (!k) return;
      if (k === 'x') { dlg.close(); return; }
      if (k !== 'sol' || busy) return;
      const o = sol.cached();
      if (o && o.mythicIncluded) { dlg.close(); sol.buy(); return; }
      lock(true);
      sol.buy(status, o ? o.price : null).then(r => {
        lock(false); status(r.message);
        if (r.status === 'confirmed') { toast('Permanent Sensei unlocked.'); setTimeout(() => { if (ours()) dlg.close(); }, 1500); }
      }, err => { lock(false); status((err && err.message) || 'The payment did not go through. Nothing was charged.'); });
    };
    if (!dlg.open) dlg.showModal();
    if (sol.due() || !sol.cached()) sol.offer().then(o => { if (ours() && !busy) draw(o); }, err => { if (ours() && !busy) draw(sol.cached(), ((err && err.message) || 'Could not load the Sensei price.') + ' You can still hire: your wallet shows the exact price.'); });
  }
  // The Dojo scene's Sensei pane uses this same dialog, so there is one place to buy the Sensei.
  window.SbwHireSensei = () => hireSensei();
  function hireSensei() {
    const perm = (window.GameBalance && GameBalance.senseiCost) || 0;
    if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body);
    const sol = window.FounderPanel && FounderPanel.sensei;
    if (sol && sol.mode()) return hireSenseiSol(sol);
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
    const key = [h?.id, h?.r, h?.z, h?.model, PM?.loaded, pose, x, y, scale, h?.r === 5 && window.MythicHero?.assetsReady, h?.r === 5 && window.MythicHero?.auraEnabled].join('|');
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

  /* ---------- Limited Mythic NFT Box (home EVENT): 1 SOL, 20 pcs, max 2 per wallet ---------- */
  const BOXS = { info: null, at: 0, busy: false, minting: false };
  async function boxLoad() {
    if (!account() || !window.MythicBox || BOXS.busy) return;
    BOXS.busy = true;
    try { BOXS.info = (await MythicBox.info()).box; } catch {} finally { BOXS.at = Date.now(); BOXS.busy = false; }
  }
  function boxHtml(b) {
    const supply = b?.supply ?? 20, left = b ? b.remaining : null, signedIn = !!account();
    const label = !signedIn ? 'Sign in to mint' : BOXS.minting ? 'Minting…' : b?.soldOut ? 'Sold out' : b?.limitReached ? 'Limit reached (2)' : '» MINT NOW «';
    const price = !b ? '1 SOL' : b.limitReached ? b.owned + ' / ' + b.perWallet + ' owned' : b.price + ' SOL';
    return `<div class="bx-top"><img class="bx-box" src="assets/mythic-box/box-256.webp" alt="Mythic NFT Box">
        <div class="bx-title"><small>SHINOBI BOMBERS</small><h2>LIMITED MYTHIC NFT BOX</h2><p class="bx-tag">✦ EXCLUSIVE INITIAL INVESTOR OFFER ✦</p><p class="bx-un">Unlock a <b>MYTHIC HERO</b> + <b>MYTHIC AURA</b></p></div>
        <img class="bx-tsu" src="assets/mythic-hero/previews/tsukiyomi_front.png" alt="Tsukiyomi"></div>
      <div class="bx-perks"><div><b>Mythic hero · Tsukiyomi</b><span>Mythic rank · own skills</span></div><div><b>Mythic Aura</b><span>Wings · glyph ring · crown</span></div><div><b>Exclusive NFT holder tier</b><span>The hero follows the NFT</span></div></div>
      <div class="bx-disc"><b class="bx-pct">10%</b><div><b>DISCOUNT ON ALL IN-GAME PURCHASES!</b><p><i class="ok">✔ Included:</i> Summon, Fusion, Dojo, Sensei, Training</p><p><i class="no">✖ Not included:</i> Marketplace transactions, Boss Hunt entrance fee</p></div></div>
      <div class="bx-supply"><div><b>LIMITED SUPPLY · ${supply} PCS ONLY</b><span>${left == null ? 'Sign in to see how many are left' : left ? left + ' of ' + supply + ' left' : 'SOLD OUT'}</span></div><div class="sbw-bar"><i style="width:${left == null ? 100 : Math.round(100 * left / supply)}%"></i></div></div>
      <div class="bx-price"><span>PRICE</span><b>◎ ${esc(price)}</b><small>${b?.owned === 1 ? 'Your 2nd box: 1 SOL + 0.5 SOL' : 'Max 2 per wallet · a 2nd box is 1.5 SOL (1 + 0.5)'} · Solana Devnet (test SOL)</small></div>
      ${b?.mine?.length ? `<p class="bx-mine">Your boxes: ${b.mine.map(m => '#' + m.serial + (m.status === 'pending' ? ' (confirming)' : '')).join(', ')}</p>` : ''}
      <p class="sbw-msg bx-msg" role="status" hidden></p>
      <div class="sbw-acts"><button type="button" class="sbw-btn sbw-alt" data-k="x">Close</button><button type="button" class="sbw-btn bx-mint" data-k="mint" ${signedIn && (BOXS.minting || b?.soldOut || b?.limitReached || !b) ? 'disabled' : ''}>${label}</button></div>`;
  }
  function boxRender() { if (dlg?.open && dlg.classList.contains('sbw-boxdlg')) dlg.innerHTML = boxHtml(BOXS.info); }
  function boxMsg(text, ok) { const m = dlg && $('.bx-msg', dlg); if (!m) return; m.hidden = !text; m.textContent = text || ''; m.classList.toggle('ok', !!ok); }
  async function boxMint() {
    if (!account()) return notice('Mythic NFT Box', 'Sign in with your wallet to mint the Mythic NFT Box.');
    if (BOXS.minting || !window.MythicBox) return;
    BOXS.minting = true; boxRender();
    const steps = { signing: 'Approve the 1 transaction in your wallet…', confirming: 'Confirming on Solana Devnet… (about 30 seconds)' };
    boxMsg('Reserving your box…');
    try {
      const data = await MythicBox.mint(step => boxMsg(steps[step] || ''));
      BOXS.info = data.box; BOXS.at = Date.now(); BOXS.minting = false; boxRender();
      if (data.mint.status === 'confirmed') { boxMsg('Mythic NFT Box #' + data.mint.serial + ' minted! Tsukiyomi joined your Heroes and your 10% discount is active.', true); toast('Mythic NFT Box #' + data.mint.serial + ' minted · Tsukiyomi joined your Heroes'); }
      else boxMsg('The box transaction did not complete, so nothing was charged. You can try again.');
    } catch (e) { BOXS.minting = false; boxRender(); boxMsg(e.message || 'Minting failed. Nothing was charged.'); }
  }
  function openBox() {
    if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body);
    dlg.className = 'sbw-dialog sbw-boxdlg'; dlg.innerHTML = boxHtml(BOXS.info);
    dlg.onclick = e => { const k = e.target.closest('[data-k]')?.dataset.k; if (k === 'x') dlg.close(); else if (k === 'mint') boxMint(); };
    if (!dlg.open) dlg.showModal();
    if (account()) {
      boxLoad().then(boxRender);
      // A mint that was sent before the page closed finishes here.
      if (window.MythicBox?.pending()?.signature && !BOXS.minting) { BOXS.minting = true; boxMsg('Finishing your previous box mint…'); MythicBox.resume(() => {}).then(d => { BOXS.minting = false; if (d) BOXS.info = d.box; boxRender(); if (d?.mint.status === 'confirmed') boxMsg('Mythic NFT Box #' + d.mint.serial + ' minted!', true); }).catch(e => { BOXS.minting = false; boxRender(); boxMsg(e.message); }); }
    }
  }
  window.MythicBoxUI = { open: openBox };
  /* Founder NFT Boxes (owner decision 2026-11-10): the Events card shows the live Founder sale and VIEW opens this pop-up;
   * buying happens on the /founders page (it cannot be embedded: payment page with frame protection), opened in a new
   * tab so the game stays open. Same-origin founders-info, no sign-in; cached 60 s, one request at a time. */
  const FDS = { info: null, at: 0, busy: false };
  async function foundersLoad() {
    if (FDS.busy) return FDS.info; FDS.busy = true; FDS.at = Date.now();
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch('/api/prelaunch', { method: 'POST', credentials: 'same-origin', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'X-SB-Prelaunch': '1' }, body: JSON.stringify({ action: 'founders-info' }) });
      clearTimeout(timer); const f = (await r.json())?.data?.founders; if (f?.tiers?.mythic && f.tiers.legacy) FDS.info = f;
    } catch {} finally { FDS.busy = false; }
    return FDS.info;
  }
  // Benefit lines as on the Founders page (prelaunch/i18n/en.json fd.mythic.points / fd.legacy.points).
  const FD_TIERS = { mythic: { name: "Mythic Founder's Box", art: '/founders/art/mythic.png', points: ['Exclusive Mythic Tsukiyomi + 1 Legend hero + 1 Elite hero', '10 Limited Hero Summon Passes (no Genin, no Mythic)', 'Free permanent Sensei', '10% game-service discount', '12-hour Chest claim cooldown'] },
    legacy: { name: "Legacy Founder's Box", art: '/founders/art/legacy.png', points: ['1 Legend hero + 1 Elite hero', '10 Limited Hero Summon Passes (no Genin, no Mythic)', '7-day free Sensei trial; permanent Sensei for 0.2 SOL before it ends', '5% game-service discount', '12-hour Chest claim cooldown'] } };
  function openFounders() {
    if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body);
    const token = 'fd' + Date.now() + Math.random().toString(36).slice(2), ours = () => dlg.open && !!dlg.querySelector(`h2[data-founders="${token}"]`);
    dlg.className = 'sbw-dialog sbw-fddlg';
    const draw = () => {
      const f = FDS.info, t = f && f.tiers, closed = !!(t && (f.paused || (t.mythic.soldOut && t.legacy.soldOut)));
      const row = k => { const x = t && t[k], price = x ? Number(x.price) + ' SOL' + (Number(x.regularPrice) > Number(x.price) ? ` <s>${Number(x.regularPrice)} SOL</s>` : '') : '…';
        const left = !x ? '' : x.soldOut ? 'SOLD OUT' : `${Number(x.remaining)} of ${Number(x.supply)} left`;
        return `<div class="fd-tier ${k}${x && x.soldOut ? ' sold' : ''}"><img src="${FD_TIERS[k].art}" alt=""><div><b>${FD_TIERS[k].name}</b><span class="fd-price">${price}</span>${left ? `<em>${left}</em>` : ''}<ul>${FD_TIERS[k].points.map(p => `<li>${p}</li>`).join('')}</ul></div></div>`; };
      dlg.innerHTML = `<h2 data-founders="${token}">Founder NFT Boxes</h2><p>Founder prices until each tier sells out. One box per wallet across both tiers.</p><div class="fd-tiers">${row('mythic')}${row('legacy')}</div>${f && f.paused ? '<p class="sbw-small">The Founder sale is paused right now.</p>' : ''}<div class="sbw-acts"><button type="button" class="sbw-btn sbw-alt" data-k="x">Cancel</button><button type="button" class="sbw-btn" data-k="go">${closed ? 'View the Founders page ↗' : 'Buy on the Founders page ↗'}</button></div><p class="sbw-small">Opens the Founders page in a new tab; your game stays open here.</p>`;
    };
    draw();
    dlg.onclick = e => { const k = e.target.closest('[data-k]')?.dataset.k; if (k === 'x') dlg.close(); else if (k === 'go') { window.open('/founders', '_blank', 'noopener'); dlg.close(); } };
    if (!dlg.open) dlg.showModal();
    foundersLoad().then(() => { if (ours()) draw(); });
  }

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
  // Tsukiyomi (Mythic, rank 5): his box NFT (or starter copy), the aura switch and his four skills.
  const shortMint = m => m ? m.slice(0, 4) + '…' + m.slice(-4) : '';
  function mythicBlock(h) {
    const MH = window.MythicHero, aura = MH ? MH.auraEnabled : true, skills = MH ? MH.skills : [];
    return `<div class="sbw-myth"><div class="sbw-myth-top"><b class="sbw-mythic">MYTHIC </b><span>FIRST GENERATION NFT</span></div>
      <div class="sbw-myth-nft"><span>${h.starter && !h.nft ? 'Starter Mythic · test server' : h.nft?.mint ? '✔ NFT verified · ' + esc(shortMint(h.nft.mint)) : 'NFT hero'}</span><button type="button" data-k="mcheck">Check NFT</button><button type="button" data-k="maura" aria-pressed="${aura}">Aura: ${aura ? 'On' : 'Off'}</button></div>
      <div class="sbw-myth-generation">TSUKIYOMI<small>Lunar / Celestial / Void</small></div>
      <ul class="sbw-myth-skills" aria-label="Automatic abilities">${[{name:'Melee Attack',icon:'⚔',text:'Basic purple crescent attack.'},{name:'Ranged Attack',icon:'✧',text:'Basic celestial projectile.'},...skills].map((k,i) => `<li class="${k.ultimate ? 'ult' : ''}"><button type="button" data-k="mability${i}" title="${esc(k.text)}"><span aria-hidden="true">${esc(k.icon)}</span> ${esc(k.name)}${k.cooldownMs!=null?'<small class="sbw-myth-cooldown">'+k.cooldownMs/1000+'s testing cooldown</small>':''}</button></li>`).join('')}</ul><small class="sbw-myth-auto">All four rotate on melee or ranged attacks · Skill VFX add no damage or chakra cost</small></div>`;
  }
  function mythicAbility(index) {
    const mh=window.MythicHero;if(!mh?.animationSource)return;
    const basic=[{name:'Melee Attack',state:'ATTACK',text:'Basic purple crescent slash.'},{name:'Ranged Attack',state:'RANGED_ATTACK',text:'Basic celestial projectile.'}],skill=mh.skills[index-2];
    const item=basic[index]||skill,definition=skill&&window.MythicAutomaticSkills.definitions[skill.key],state=basic[index]?.state||definition?.state;
    if(!item||!state)return;
    if(!dlg)dlg=mk('dialog','sbw-dialog',document.body);dlg.onclick=null;dlg.classList.add('sbw-myth-preview');
    const cd=definition&&mh.automaticSkills?.rules[skill.key]?.cooldownMs;
    dlg.innerHTML=`<h2>${esc(item.name)}</h2><p>${definition?.ultimate?'Ultimate':definition?'Signature skill':'Basic attack'} · Automatic activation</p><canvas width="420" height="260" aria-label="Cosmetic animation preview"></canvas><p>${esc(item.text)}</p><p>${definition?cd==null?'Extra skill cooldown: pending balance approval. Native attack timing applies.':'Beta testing cooldown: '+cd/1000+'s. Native attacks continue while it recharges.':'Uses native attack timing.'}</p><p>1 Attack = Hero Power Damage = 1 Chakra<br>Skill VFX = 0 Additional Chakra</p><small>Cosmetic preview only. No attacks, chakra use or rewards.</small><div class="sbw-acts"><button type="button" class="sbw-btn">Close</button></div>`;
    const canvas=$('canvas',dlg),c=canvas.getContext('2d'),hero={id:'mythic-menu-preview',r:5},start=performance.now();let frame;
    const paint=time=>{if(!dlg.open||!canvas.isConnected)return;const clip=mh.animationSource.states[state],elapsed=(time-start)%(clip.durationMs+500),t=Math.min(.999,elapsed/clip.durationMs);c.clearRect(0,0,420,260);c.fillStyle='#100923';c.fillRect(0,0,420,260);const body=mh.renderFrame(hero,state,Math.floor(t*clip.frames),'front');ShinobiSprites.blit(c,body,210,235,3.5,false,1);if(skill)c.drawImage(mh.skillFrame(skill.key,Math.floor(t*definition.frames)),95,0,230,230);frame=requestAnimationFrame(paint)};
    const close=()=>{cancelAnimationFrame(frame);dlg.classList.remove('sbw-myth-preview')};dlg.onclose=close;$('.sbw-btn',dlg).onclick=()=>dlg.close();dlg.showModal();mh.preload().then(()=>{if(dlg.open)frame=requestAnimationFrame(paint)}).catch(()=>{});
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
    return `<div class="sbw-hcard${on ? ' on' : ''}${r === 5 ? ' mythic' : ''}" data-i="${i}" style="--rc:${col}">
      <div class="sbw-hc-top"><b>${esc(RNAME[r].toUpperCase())}</b><i>${esc(c.status || '')}</i></div>
      <div class="sbw-hc-portrait"><canvas width="170" height="120" data-i="${i}"></canvas>${r === 5 ? '<b class="sbw-nft" title="Limited NFT Box hero">NFT</b>' : ''}${h.referralBound ? '<b class="sbw-bound" title="Referral-bound hero: cannot be listed, sold or transferred">🔒</b>' : ''}</div>
      <div class="sbw-hc-name">${esc(c.name)}</div><div class="sbw-hc-sub">Lv. ${esc((c.lvl || '1').split('/')[0])}<span>${esc(r === 5 ? '4 automatic skills' : c.attack || c.style)}</span></div>
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
    const sig = cards.map(c => [c.idx, c.status, c.lvl, c.pw, c.tog && c.tog.textContent, c.up && c.up.textContent, c.mode && c.mode.textContent].join(',')).join('|') + '#' + b.sel;
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
    const dsig = c ? [c.idx, c.lvl, c.pw, c.sp, c.stam, c.vol, c.rng, c.status, c.up && c.up.textContent, c.up && c.up.disabled, c.list && c.list.disabled, c.h?.r === 5 && window.MythicHero?.auraEnabled, c.h?.nft?.mint,ledger().profile?.upgradeShards].join(',') : 'none';
    if (dsig !== b.dsig) {
      b.dsig = dsig;
      const portrait = $('.sbw-h2-port canvas', b.det);
      if (!c) b.det.innerHTML = '<p class="sbw-empty">Select a hero.</p>';
      else {
        const h = c.h || {}, r = h.r || 0, [cc, cm] = (c.ch || '0/1').split('/').map(x => +x.trim() || 0), pl = c.perkList || [];
        const tr = c.up ? c.up.textContent.replace(/\s+/g, ' ').trim() : 'Train', price = ((tr.match(/[\d,]+\s*Ryo/) || [''])[0]).replace(/[\d,]+/, n => Number(n.replace(/,/g, '')).toLocaleString('en-US')), maxed = /max/i.test(tr);
        const [lv, lvMax] = (c.lvl || '1/5').split('/').map(x => x.trim());
        const stat = (k, v) => `<div class="sbw-st"><span>${k}</span><b>${esc(v || '—')}</b></div>`;
        b.det.innerHTML = `<div class="sbw-h2" style="--rc:${RCOL[r]}">
          <div class="sbw-h2-top"><div><h3 data-fs="23">${esc(c.name)}</h3><p>Lv. ${esc(lv)} / ${esc(lvMax || '5')}<em>${esc(c.status)}</em></p></div><i class="sbw-h2-rank">${esc(RNAME[r].toUpperCase())}</i></div>
          ${r === 5 ? mythicBlock(h) : `<div class="sbw-h2-tags"><span>${esc(c.attack || '—')}</span><span>${esc(c.style || RNAME[r] + ' style')}</span></div>`}${h.referralBound ? BOUND_NOTE : ''}
          <div class="sbw-h2-mid"><div class="sbw-h2-stats">${stat('POWER', c.pw)}${stat('SPEED', c.sp)}${stat('STAMINA', c.stam)}${stat('VOLLEY', c.vol)}${stat('RANGE', c.rng)}${stat('PERKS', pl.length + ' / ' + CombatRules.perkCount(r))}</div>
            <div class="sbw-h2-port"><canvas width="292" height="344"></canvas></div></div>
          <div class="sbw-h2-ch"><span>CHAKRA</span><span>${cc} / ${cm}</span></div><div class="sbw-bar"><i style="width:${cm ? Math.round(100 * cc / cm) : 0}%"></i></div>
          <div class="sbw-shard-balance" title="Account-bound items for hero training"><span>UPGRADE SHARDS</span><b>${ledger().profile?.upgradeShards || 0}</b></div>
          <h4>PERKS</h4>
          <ul class="sbw-perks2">${pl.length ? pl.map(p => `<li><b>✦ ${esc(p.name)}</b><span>${esc(p.desc)}</span></li>`).join('') : '<li><span>No perks yet.</span></li>'}</ul>
          <div class="sbw-h2-btns">
            <button type="button" class="sbw-xbtn train${maxed ? ' max' : ''}" data-k="train" ${h.tokenId && account() ? '' : 'disabled'}><i>⇧</i><span><b>${maxed ? 'MANAGE' : 'TRAIN'}</b><small>${maxed ? 'Max level' : esc(price || 'Upgrade hero')} · ${HeroUpgradeRules.shards(r)} shards</small></span></button>
            ${r === 5 ? '<button type="button" class="sbw-xbtn sell" data-k="sell" disabled><i>◈</i><span><b>NFT ONLY</b><small>Trade the box NFT</small></span></button>' : h.referralBound ? '<button type="button" class="sbw-xbtn sell" data-k="sell" disabled><i>🔒</i><span><b>BOUND</b><small>Cannot be sold</small></span></button>' : `<button type="button" class="sbw-xbtn sell" data-k="sell" ${c.list && !c.list.disabled ? '' : 'disabled'}><i>⇄</i><span><b>SELL</b><small>List on Market</small></span></button>`}
          </div></div>`;
        const n = $('h3', b.det); if (n) fitText(n);
        const fresh = $('.sbw-h2-port canvas', b.det);
        if (portrait?.dataset.sbwHero === String(h.id)) fresh.replaceWith(portrait);
        else fresh.dataset.sbwHero = String(h.id);
      }
    }
    // Energy changes in place so active combat cannot detach focused controls or reset phone scroll.
    const energy = (el, row, selector) => {
      if (!el || !row) return;
      const [value, max] = (row.ch || '0/1').split('/').map(x => +x.trim() || 0);
      const label = $(selector, el), fill = $('.sbw-bar i', el);
      if (label) setText(label, value + ' / ' + max);
      if (fill) fill.style.width = Math.max(0, Math.min(100, max ? value / max * 100 : 0)) + '%';
    };
    $$('.sbw-hcard', b.grid).forEach(el => energy(el, cards[+el.dataset.i], '.sbw-hc-ch span:last-child'));
    energy(b.det, c, '.sbw-h2-ch span:last-child');
    drawCentered($('.sbw-h2-port canvas', b.det), c && c.h, now, 6);
  };
  MODS.heroes = {
    mability0:()=>mythicAbility(0),mability1:()=>mythicAbility(1),mability2:()=>mythicAbility(2),mability3:()=>mythicAbility(3),mability4:()=>mythicAbility(4),mability5:()=>mythicAbility(5),
    tab: a => { const v = HF[+a]; if (v != null) window.HeroFilters && HeroFilters.choose(v); built.heroes.sel = 0; built.heroes.sig = ''; },
    search: () => { const inp = document.querySelector('#p1 .heroes-search'); if (!inp) return; if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body); dlg.onclick = null; dlg.innerHTML = '<h2>Search heroes</h2><form><input type="search" placeholder="Hero name"><div class="sbw-acts"><button type="button" class="sbw-btn sbw-alt">Clear</button><button class="sbw-btn">Search</button></div></form>'; const q = $('input', dlg); q.value = inp.value; const run = v => { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); built.heroes.sig = ''; dlg.close(); }; $('.sbw-alt', dlg).onclick = () => run(''); $('form', dlg).onsubmit = e => { e.preventDefault(); run(q.value); }; dlg.showModal(); q.focus(); },
    sort: () => { const s = document.querySelector('#p1 .heroes-sort'); if (!s) return; s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('change', { bubbles: true })); toast('Sort: ' + s.options[s.selectedIndex].text); built.heroes.sig = ''; },
    // Scope arrows to the native pager: hero Perks buttons also contain a › glyph.
    page: (a, el) => { const button = heroPageButton(el?.dataset.sbwid === 'pp'); if (!button || button.disabled) return; button.click(); built.heroes.sel = 0; built.heroes.sig = ''; refresh(); el?.focus({ preventScroll: true }); },
    sel: a => { built.heroes.sel = +a; built.heroes.sig = ''; },
    fav: () => toast('Favourites are not available yet.'),
    dtab: a => { built.heroes.dt = +a; built.heroes.dsig = ''; for (let i = 0; i < 4; i++) { const e = $(`.hs[data-sbwid="dt${i}"]`, built.heroes.st); if (e) e.classList.toggle('on2', i === +a); } },
    train: () => { const c = heroCards()[built.heroes.sel]; if (c?.h?.tokenId && window.HeroUpgrades) HeroUpgrades.open(c.h.tokenId); else toast('Choose an owned hero.'); },
    sell: () => { const c = heroCards()[built.heroes.sel]; if (c?.h?.referralBound) return toast('Referral-bound heroes cannot be listed, sold or transferred.'); if (c && c.list && !c.list.disabled) c.list.click(); else toast('This hero cannot be listed right now.'); },
    maura: () => { const MH = window.MythicHero; if (!MH) return; MH.setAura(!MH.auraEnabled); toast('Mythic aura ' + (MH.auraEnabled ? 'on' : 'off')); built.heroes.dsig = ''; },
    mcheck: async () => { if (!window.RyoPayments?.mythic) return toast('Sign in to check your NFT.'); try { const r = await RyoPayments.mythic(); const n = r?.mythic?.mints?.length || 0; toast(r?.mythic?.enabled === false ? 'The Mythic NFT check opens at launch.' : n ? 'NFT verified · ' + n + ' Mythic hero' + (n === 1 ? '' : 'es') : 'No Mythic box NFT found in this wallet.'); } catch (e) { toast(e.message || 'NFT check failed. Try again shortly.'); } built.heroes.sig = built.heroes.dsig = ''; },
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
        e.dataset.k = k; e.className = `sbw-at-card r${h.r}${c.deployed ? ' deployed' : ''}${c.deployed && h.r >= 3 ? (h.r === 5 ? ' aura-mythic' : h.r === 4 ? ' aura-legend' : ' aura-elite') : ''}`; e.style.setProperty('--rc', RCOL[h.r]);
        e.innerHTML = `<i class="sbw-at-aura"></i><div class="sbw-at-port"><canvas width="126" height="126"></canvas></div><div class="sbw-at-info"><strong>${esc((h.name || '').split(' ')[0])}</strong><span class="sbw-at-rank">${esc(h.r===5?'MYTHIC':RNAME[h.r])}</span><small>${esc(meta)}</small><div class="sbw-bar"><i style="width:${bar}"></i></div></div>${el ? `<span class="sbw-at-el" title="${esc(el.title || '')}" style="--el:${esc(getComputedStyle(el).getPropertyValue('--element-icon') || 'none')}"></span>` : ''}<button type="button" ${btn && btn.disabled ? 'disabled' : ''}>${esc(btn ? btn.textContent.trim() : 'Deploy')}</button>`;
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
    stageinfo: () => { const a = advInfo(); notice(`Stage ${a.stage || 1} · ${a.name}`, `Enemies remaining: ${a.enemies || '—'}. Ryo earned this session: ${a.gained || '+0'}. Deployed heroes fight automatically and spend chakra; out of chakra, they nap until full – faster in a better Dojo.`); },
    work: () => { if (!pressOnclick('#p0', 'Experience.workAll()')) toast('No rested heroes to send to work.'); },
    rest: () => { if (!pressOnclick('#p0', 'Experience.restAll()')) toast('No deployed heroes to rest.'); },
    hero: () => go(1)
  };

  /* ---------- Market (game page 4, mode 1): the shared player Market ---------- */
  // Heroes are listed for Ryo on the server (market.cjs). Buying runs through the token checkout;
  // the seller receives 80%, the separate Market reserve 10%, the treasury 8% and the studio 2%. Listings last
  // 7 days. Offers hold the offered Ryo until the seller accepts or declines (48 hours at most).
  // The artwork keeps its title and frames; tabs, filters, cards, details and actions are live HTML
  // drawn over the two panels, so no printed placeholder text or buttons show through.
  const MARKET_MIN = [10000, 25000, 80000, 200000, 500000];
  const PERK_NAMES = () => (typeof PK !== 'undefined' ? PK : [['Bounty Hunter', ''], ['Armor Breaker', ''], ['Wind Step', ''], ['Fast Charge', ''], ['Chakra Saver', ''], ['Piercing Shuriken', ''], ['Swift Hands', '']]);
  const MK = { tab: 'heroes', rank: -1, perks: [], sort: 'price-asc', search: '', page: 0, data: null, mine: null, sel: -1, busy: false, seq: 0, error: '', at: 0 };
  const OFFER_LABEL = { active: 'WAITING', accepted: 'ACCEPTED', completed: 'BOUGHT', declined: 'DECLINED', cancelled: 'CANCELLED', expired: 'EXPIRED', closed: 'CLOSED', failed: 'FAILED' };
  const perkName = k => (PERK_NAMES()[k] || ['?'])[0];
  function listingHero(l) { const h = l.hero; return { id: 9000 + (h.look || 0), look: h.look, r: h.rank, z: false, lv: h.level, pw: h.stats.pw, sp: h.stats.sp, st: h.stats.st, pk: h.perks, name: h.name }; }
  function marketRows() {
    if (MK.tab === 'heroes') return (MK.data?.listings || []).map(l => ({ kind: 'browse', l, offer: l.myOffer }));
    if (!MK.mine) return [];
    if (MK.tab === 'mine') return [...MK.mine.listings.map(l => ({ kind: 'mine', l, offers: l.offers || [] })), ...MK.mine.sales.map(l => ({ kind: 'sold', l }))];
    return (MK.mine.offers || []).map(o => ({ kind: 'offer', l: o.listing, offer: o }));
  }
  async function marketLoad() {
    if (!account() || !window.RyoPayments?.market) return;
    const seq = ++MK.seq; MK.busy = true; if (built.market) built.market.sig = '';
    try {
      if (MK.tab === 'heroes') MK.data = await RyoPayments.market('market-browse', { rank: MK.rank, perks: MK.perks, sort: MK.sort, search: MK.search, page: MK.page });
      else MK.mine = await RyoPayments.market('market-mine');
      if (seq === MK.seq) { MK.error = ''; MK.at = Date.now(); if (MK.sel >= marketRows().length) MK.sel = -1; }
    } catch (e) { if (seq === MK.seq) MK.error = e.message || 'The Market could not load.'; }
    finally { if (seq === MK.seq) { MK.busy = false; if (built.market) built.market.sig = ''; } }
  }
  function marketReload(reset = true) { if (reset) { MK.page = 0; MK.sel = -1; } if (MK.tab === 'heroes') MK.data = null; else MK.mine = null; marketLoad(); refresh(); }
  INIT.market = b => {
    // Every printed control inside the two panels is replaced by live HTML.
    $$('.hs', b.st).forEach(e => { if (/^(tb|f\d|dd|srch|rst|cd|pv|p\d|nx|dprev|dnext|dfav|dt\d|vl|buy|off)/.test(e.dataset.sbwid || '')) e.hidden = true; });
    b.left = cv(b, 68, 248, 1076, 664, 'sbw-mpanel');
    b.bar = cv(b, 78, 256, 1046, 96, 'sbw-mbar');
    b.bar.innerHTML = `<div class="sbw-mtabs" role="tablist" aria-label="Market">${[['heroes', 'For Sale'], ['mine', 'My Listings'], ['offers', 'My Offers']].map(([k, t]) => `<button type="button" role="tab" data-tab="${k}">${t}</button>`).join('')}<span class="sbw-mheld" hidden></span></div>
      <div class="sbw-mfilters"><div class="sbw-mranks" role="group" aria-label="Rank">${['All', ...RNAME.slice(0, 5)].map((n, i) => `<button type="button" data-rank="${i - 1}" style="--rc:${i ? RCOL[i - 1] : '#ffd257'}">${n}</button>`).join('')}</div>
      <button type="button" class="sbw-mskills" data-skills>Skills <b hidden></b></button>
      <label class="sbw-msort"><span class="sbw-sr">Sort</span><select aria-label="Sort"><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="newest">Newest</option></select></label>
      <label class="sbw-msearch"><span class="sbw-sr">Search hero name</span><input type="search" maxlength="40" placeholder="Search hero name" aria-label="Search hero name"></label>
      <button type="button" class="sbw-mreset" data-reset>Reset</button></div>`;
    b.grid = cv(b, 78, 358, 1046, 500, 'sbw-mgrid');
    b.pages = cv(b, 78, 862, 1046, 40, 'sbw-mpages');
    b.det = cv(b, 1162, 154, 448, 758, 'sbw-mdet');
    const sortSel = $('select', b.bar), search = $('input', b.bar); let typing = 0;
    b.bar.addEventListener('click', e => {
      const t = e.target.closest('[data-tab]'); if (t) return MODS.market.tab(t.dataset.tab);
      const r = e.target.closest('[data-rank]'); if (r) { MK.rank = +r.dataset.rank; MK.tab = 'heroes'; return marketReload(); }
      if (e.target.closest('[data-skills]')) return perkPicker();
      if (e.target.closest('[data-reset]')) { Object.assign(MK, { rank: -1, perks: [], sort: 'price-asc', search: '', tab: 'heroes' }); sortSel.value = MK.sort; search.value = ''; marketReload(); }
    });
    sortSel.addEventListener('change', () => { MK.sort = sortSel.value; MK.tab = 'heroes'; marketReload(); });
    search.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { MK.search = search.value.trim(); MK.tab = 'heroes'; marketReload(); }, 350); });
    b.pages.addEventListener('click', e => { const p = e.target.closest('[data-p]'); if (!p || p.disabled) return; MK.page = +p.dataset.p; MK.sel = -1; marketLoad(); });
    b.grid.addEventListener('click', e => {
      const card = e.target.closest('[data-i]'); if (!card) return; MK.sel = +card.dataset.i; b.sig = '';
      if (layer.classList.contains('sbw-phone')) setTimeout(() => b.det.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' }), 60);
    });
    b.det.addEventListener('click', e => {
      const a = e.target.closest('[data-act]'); if (!a || a.disabled) return; const row = marketRows()[MK.sel];
      ({ buy: () => marketBuy(row), offer: () => offerDialog(row), 'cancel-offer': () => marketAction('market-offer-cancel', { offerId: a.dataset.id }, 'Offer cancelled. Your Ryo is back in your balance.'),
        cancel: () => marketAction('market-cancel', { listingId: a.dataset.id }, 'Listing cancelled. The hero is back in your collection.'),
        accept: () => acceptDialog(row, row.offers.find(o => o.id === a.dataset.id)), decline: () => marketAction('market-offer-decline', { offerId: a.dataset.id }, 'Offer declined. The buyer gets their Ryo back.'),
        browse: () => MODS.market.tab('heroes'), sell: () => go(1) })[a.dataset.act]?.();
    });
  };
  function cardHtml(row, i) {
    const l = row.l, h = l.hero, offers = row.offers?.length || 0;
    const tag = row.kind === 'sold' ? ['SOLD', 'sold'] : row.kind === 'offer' ? [OFFER_LABEL[row.offer.status] || row.offer.status.toUpperCase(), row.offer.status] : l.status === 'pending' ? ['BUYER PAYING', 'pending']
      : row.kind === 'mine' && offers ? [offers + (offers === 1 ? ' OFFER' : ' OFFERS'), 'offers'] : l.mine ? ['YOURS', 'mine'] : row.offer ? ['OFFER SENT', 'offers'] : [timeLeft(l.left).toUpperCase(), 'time'];
    const price = row.kind === 'offer' ? `<span class="mc-price"><i class="coin"></i>${fmt(row.offer.amount)}<small>your offer</small></span>` : `<span class="mc-price"><i class="coin"></i>${fmt(l.price)}${row.kind === 'sold' ? '<small>sold</small>' : ''}</span>`;
    return `<button type="button" class="sbw-mcard${i === MK.sel ? ' on' : ''}${row.kind === 'sold' ? ' done' : ''}" data-i="${i}" style="--rc:${RCOL[h.rank]}" aria-label="${esc(h.name)}, ${RNAME[h.rank]}, ${fmt(l.price)} Ryo">
      <span class="mc-top"><b>${RNAME[h.rank].toUpperCase()}</b><em class="t-${tag[1]}">${esc(tag[0])}</em></span>
      <span class="mc-port"><canvas width="168" height="132"></canvas><i>Lv. ${h.level}</i></span>
      <span class="mc-name">${esc(h.name)}</span>
      <span class="mc-stats"><span>PW<b>${h.stats.pw.toFixed(1)}</b></span><span>SP<b>${h.stats.sp.toFixed(1)}</b></span><span>ST<b>${h.stats.st.toFixed(1)}</b></span></span>
      <span class="mc-perks" title="${esc((h.perks || []).map(perkName).join(', '))}">${(h.perks || []).slice(0, 2).map(k => `<i>${esc(perkName(k))}</i>`).join('')}${(h.perks || []).length > 2 ? `<i class="more">+${h.perks.length - 2}</i>` : ''}</span>${price}</button>`;
  }
  function detailHtml(row) {
    const l = row.l, h = l.hero, perks = PERK_NAMES(), bonus = k => h.bonus && h.bonus[k] ? `<small>+${h.bonus[k]} trained</small>` : '';
    const head = `<div class="md-head" style="--rc:${RCOL[h.rank]}"><span class="md-rank">${RNAME[h.rank].toUpperCase()}</span><span class="md-time">${row.kind === 'sold' ? 'Sold' : l.status === 'pending' ? 'Buyer paying' : timeLeft(l.left)}</span></div>
      <div class="md-port" style="--rc:${RCOL[h.rank]}"><canvas width="300" height="190"></canvas></div><h3>${esc(h.name)}</h3><p class="md-sub">Level ${h.level} / 5 · ${row.kind === 'browse' && !l.mine ? 'Seller ' + esc(l.seller) : 'Your hero'}</p>
      <div class="md-stats"><span>POWER<b>${h.stats.pw.toFixed(1)}</b>${bonus('pw')}</span><span>SPEED<b>${h.stats.sp.toFixed(1)}</b>${bonus('sp')}</span><span>STAMINA<b>${h.stats.st.toFixed(1)}</b>${bonus('st')}</span></div>
      <div class="md-perks">${(h.perks || []).map(k => `<p><b>✦ ${esc((perks[k] || ['?'])[0])}</b><span>${esc((perks[k] || ['', ''])[1])}</span></p>`).join('')}</div>`;
    let actions = '';
    if (row.kind === 'browse' && l.mine) actions = '<p class="md-note">This is your listing. Manage it in My Listings.</p>';
    else if (row.kind === 'browse') actions = `<div class="md-price"><span>Price</span><b><i class="coin"></i>${fmt(l.price)} Ryo</b></div>
      ${row.offer ? `<p class="md-note">Your offer: <b>${fmt(row.offer.amount)} Ryo</b> · ${timeLeft(row.offer.left)} · held from your balance</p>` : ''}
      <div class="md-acts"><button type="button" class="sbw-mbtn buy" data-act="buy">Buy now</button><button type="button" class="sbw-mbtn" data-act="offer">${row.offer ? 'Change offer' : 'Make offer'}</button></div>
      ${row.offer ? `<button type="button" class="sbw-mbtn ghost" data-act="cancel-offer" data-id="${esc(row.offer.id)}">Cancel my offer</button>` : ''}`;
    else if (row.kind === 'mine' && l.status === 'pending') actions = '<p class="md-note">A buyer is paying for this hero. It finishes automatically.</p>';
    else if (row.kind === 'mine') actions = `<div class="md-price"><span>Your price</span><b><i class="coin"></i>${fmt(l.price)} Ryo</b></div><p class="md-note">You receive <b>${fmt(l.payout)} Ryo</b> (80%) if it sells at this price.</p>
      <h4>Offers ${row.offers.length ? '(' + row.offers.length + ')' : ''}</h4>${row.offers.length ? row.offers.map(o => `<div class="md-offer"><span><b>${fmt(o.amount)} Ryo</b><small>${esc(o.buyer)} · ${timeLeft(o.left)} · you receive ${fmt(o.payout)}</small></span>
        <button type="button" class="sbw-mbtn buy sm" data-act="accept" data-id="${esc(o.id)}">Accept</button><button type="button" class="sbw-mbtn ghost sm" data-act="decline" data-id="${esc(o.id)}">Decline</button></div>`).join('') : '<p class="md-note">No offers yet.</p>'}
      <button type="button" class="sbw-mbtn ghost" data-act="cancel" data-id="${esc(l.id)}">Cancel listing</button>`;
    else if (row.kind === 'sold') actions = `<div class="md-price"><span>Sold for</span><b><i class="coin"></i>${fmt(l.price)} Ryo</b></div><p class="md-note">You received <b>${fmt(l.payout)} Ryo</b> (80%).</p>`;
    else actions = `<div class="md-price"><span>Your offer</span><b><i class="coin"></i>${fmt(row.offer.amount)} Ryo</b></div><p class="md-note">Listed at ${fmt(l.price)} Ryo · ${esc(OFFER_LABEL[row.offer.status] || row.offer.status)}${row.offer.status === 'active' ? ' · ' + timeLeft(row.offer.left) + ' · held from your balance' : ''}</p>
      ${row.offer.status === 'active' ? `<button type="button" class="sbw-mbtn ghost" data-act="cancel-offer" data-id="${esc(row.offer.id)}">Cancel my offer</button>` : ''}`;
    return `<div class="sbw-md">${head}<div class="md-acts-wrap">${actions}</div></div>`;
  }
  function emptyDetail() {
    if (MK.tab === 'mine' && MK.mine) return `<div class="sbw-md idle"><h3>My Listings</h3><p>${MK.mine.listings.length} on sale · ${MK.mine.sales.length} sold recently. Listings last 7 days; unsold heroes come back to you.</p>
      <p>Select a listing to see offers, accept or decline them, or cancel it.</p><button type="button" class="sbw-mbtn" data-act="sell">Sell a hero</button></div>`;
    if (MK.tab === 'offers' && MK.mine) return `<div class="sbw-md idle"><h3>My Offers</h3><p>${fmt(MK.mine.held)} Ryo held in open offers. Offers last up to 48 hours; declined, expired or outbid offers return your Ryo.</p></div>`;
    return `<div class="sbw-md idle"><h3>Select a hero</h3><p>Choose a hero to see its stats, skills and price. Buy it now or make an offer.</p>
      <div class="md-split"><b>On every sale</b><span>Seller <em>80%</em></span><span>${liveRevenue()?'Market reserve':'Reward pool'} <em>10%</em></span><span>Treasury <em>8%</em></span><span>Studio <em>2%</em></span></div></div>`;
  }
  PAINT.market = (b, now) => {
    if (!account()) { if (b.sig !== 'signed-out') { b.sig = 'signed-out'; b.grid.innerHTML = '<div class="sbw-empty"><b>Sign in to use the Market</b><p>Connect your wallet to browse and sell heroes.</p></div>'; b.det.innerHTML = ''; b.pages.innerHTML = ''; } return; }
    const stale = MK.tab === 'heroes' ? !MK.data : !MK.mine;
    if (!MK.busy && !MK.error && (stale || Date.now() - MK.at > 30000)) marketLoad();
    const rows = marketRows(), sel = rows[MK.sel];
    const sig = JSON.stringify([MK.tab, MK.rank, MK.perks, MK.busy, MK.error, MK.sel, MK.page, rows.map(r => [r.l.id, r.l.status, r.l.price, r.offer?.status, r.offer?.amount, r.offers?.length, Math.floor(r.l.left / 60000)]), MK.data?.pages, MK.mine?.held]);
    if (sig !== b.sig) {
      b.sig = sig;
      $$('[data-tab]', b.bar).forEach(t => { const on = t.dataset.tab === MK.tab; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); });
      $$('[data-rank]', b.bar).forEach(t => t.classList.toggle('on', +t.dataset.rank === MK.rank && MK.tab === 'heroes'));
      const count = $('[data-skills] b', b.bar); count.textContent = MK.perks.length; count.hidden = !MK.perks.length; $('[data-skills]', b.bar).classList.toggle('on', MK.perks.length > 0);
      const held = $('.sbw-mheld', b.bar); held.hidden = !(MK.mine?.held > 0); held.textContent = MK.mine?.held > 0 ? fmt(MK.mine.held) + ' Ryo held in offers' : '';
      b.bar.classList.toggle('mine', MK.tab !== 'heroes');
      b.grid.innerHTML = MK.error ? `<div class="sbw-empty"><b>Market unavailable</b><p>${esc(MK.error)}</p></div>`
        : !rows.length ? (MK.busy ? '<div class="sbw-empty"><b>Loading the Market…</b></div>'
          : MK.tab === 'mine' ? '<div class="sbw-empty"><b>You have no listings</b><p>Open Heroes, choose a hero and tap <em>SELL · List on Market</em>. You receive 80% when it sells.</p></div>'
            : MK.tab === 'offers' ? '<div class="sbw-empty"><b>No offers yet</b><p>Choose a hero for sale and tap <em>Make offer</em> to offer less than its price.</p></div>'
              : '<div class="sbw-empty"><b>No heroes match</b><p>Try another rank or fewer skills, or check back soon.</p></div>')
          : rows.map(cardHtml).join('');
      $$('.sbw-mcard canvas', b.grid).forEach((c, i) => drawHero(c, listingHero(rows[i].l), 2.2, now, 4));
      const pages = MK.tab === 'heroes' ? (MK.data?.pages || 1) : 1;
      b.pages.innerHTML = MK.tab === 'heroes' && MK.data ? `<span class="pg-total">${MK.data.total ? fmt(MK.data.total) + (MK.data.total === 1 ? ' hero' : ' heroes') + ' for sale' : ''}</span>${pages > 1 ? `<span class="pg-nav"><button type="button" data-p="${MK.page - 1}" aria-label="Previous page"${MK.page ? '' : ' disabled'}>‹</button>${Array.from({ length: pages }, (_, p) => p).filter(p => Math.abs(p - MK.page) <= 2 || p === 0 || p === pages - 1).map(p => `<button type="button" data-p="${p}" class="${p === MK.page ? 'on' : ''}" aria-label="Page ${p + 1}">${p + 1}</button>`).join('')}<button type="button" data-p="${MK.page + 1}" aria-label="Next page"${MK.page < pages - 1 ? '' : ' disabled'}>›</button></span>` : ''}` : '';
      b.det.innerHTML = sel ? detailHtml(sel) : emptyDetail();
      const big = $('.md-port canvas', b.det); if (big && sel) drawHero(big, listingHero(sel.l), 3.6, now, 10);
    } else {
      $$('.sbw-mcard canvas', b.grid).forEach((c, i) => rows[i] && drawHero(c, listingHero(rows[i].l), 2.2, now, 4));
      const big = $('.md-port canvas', b.det); if (big && sel) drawHero(big, listingHero(sel.l), 3.6, now, 10);
    }
  };
  async function marketAction(action, body, done) {
    try { await RyoPayments.market(action, body); toast(done); }
    catch (e) { notice('Market', e.message || 'That did not work. Please try again.'); }
    MK.sel = -1; MK.mine = null; MK.data = null; marketLoad();
  }
  function confirmDialog(title, html, label, run, cls = '') {
    if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body);
    dlg.className = 'sbw-dialog sbw-mdialog ' + cls; dlg.onclick = null;
    dlg.innerHTML = `<h2>${esc(title)}</h2>${html}<p class="sbw-msg" hidden></p><div class="sbw-acts"><button type="button" class="sbw-btn sbw-alt" data-k="x">Cancel</button><button type="button" class="sbw-btn" data-k="go">${esc(label)}</button></div>`;
    dlg.onclick = async e => {
      const k = e.target.dataset && e.target.dataset.k; if (!k) return; if (k === 'x') return dlg.close();
      const buttons = $$('button', dlg), msg = $('.sbw-msg', dlg); buttons.forEach(x => { x.disabled = true; });
      try { if (await run(dlg) !== false) dlg.close(); else buttons.forEach(x => { x.disabled = false; }); }
      catch (err) { msg.hidden = false; msg.textContent = err.message || 'That did not work. No Ryo was taken.'; buttons.forEach(x => { x.disabled = false; }); }
    };
    if (!dlg.open) dlg.showModal();
    return dlg;
  }
  const heroLine = h => `<p class="sbw-mdl-hero" style="--rc:${RCOL[h.rank]}"><b>${RNAME[h.rank]}</b> · Lv. ${h.level} · ${(h.perks || []).map(k => esc(perkName(k))).join(', ')}</p>`;
  function marketBuy(row) {
    if (!row || row.kind !== 'browse') return toast('Select a hero for sale first.');
    const l = row.l, balance = spendable() + (row.offer ? row.offer.amount : 0);
    const d = confirmDialog('Buy ' + l.hero.name + '?', `${heroLine(l.hero)}<p class="sbw-mbuyline">Price <b>${fmt(l.price)} Ryo</b><br><span class="sbw-small">Your balance after: ${fmt(balance - l.price)} Ryo${row.offer ? ' (your open offer is used first)' : ''}</span></p>
      ${balance < l.price ? '<p class="sbw-small sbw-warn">Not enough Ryo. Deposit Ryo from your Chest first.</p>' : ''}`, 'Buy · ' + fmt(l.price) + ' Ryo', async () => {
      const result = await RyoPayments.marketBuy(l);
      toast(result?.status === 'confirmed' ? `${l.hero.name} joined your heroes!` : 'Purchase submitted. It finalizes automatically.');
      MK.sel = -1; MK.data = null; MK.mine = null; marketLoad();
    });
    if (balance < l.price) $('[data-k="go"]', d).disabled = true;
  }
  function offerDialog(row) {
    if (!row || row.kind !== 'browse') return;
    const l = row.l, min = (MK.data?.rules?.minPrice || MARKET_MIN)[l.hero.rank], max = l.price - 1, start = row.offer ? row.offer.amount : Math.max(min, Math.floor(l.price * 0.9 / 1000) * 1000);
    if (max < min) return notice('Make offer', 'This hero is already listed at the lowest allowed price. Buy it now instead.');
    const d = confirmDialog(row.offer ? 'Change your offer' : 'Make an offer', `${heroLine(l.hero)}<p>Listed at <b>${fmt(l.price)} Ryo</b>.</p>
      <label class="sbw-sell-price">Your offer (Ryo)<input type="number" inputmode="numeric" min="${min}" max="${max}" step="1000" value="${Math.min(max, start)}"></label>
      <p class="sbw-small">From ${fmt(min)} to ${fmt(max)} Ryo. The amount is held from your balance until the seller accepts or declines (up to 48 hours). Cancel any time to get it back.</p>`, 'Send offer', async dl => {
      const amount = Math.floor(Number($('input', dl).value) || 0);
      if (amount < min || amount > max) { const m = $('.sbw-msg', dl); m.hidden = false; m.textContent = `Offer from ${fmt(min)} to ${fmt(max)} Ryo.`; return false; }
      await RyoPayments.market('market-offer', { listingId: l.id, amount });
      toast(`Offer of ${fmt(amount)} Ryo sent. The seller has up to 48 hours to answer.`);
      MK.data = null; MK.mine = null; marketLoad();
    }, 'sbw-offer');
    const input = $('input', d); input.focus(); input.select();
  }
  function acceptDialog(row, o) {
    if (!o) return;
    confirmDialog('Sell for ' + fmt(o.amount) + ' Ryo?', `${heroLine(row.l.hero)}<p>Accept ${esc(o.buyer)}'s offer for <b>${esc(row.l.hero.name)}</b>.</p>
      <p class="sbw-sell-out">You receive <b>${fmt(o.payout)} Ryo</b> (80%) · reward pool ${fmt(Math.floor(o.amount / 10))} · treasury ${fmt(Math.floor(o.amount * 8 / 100))} · studio ${fmt(Math.floor(o.amount / 50))}</p>`, 'Accept offer', async () => {
      const data = await RyoPayments.market('market-accept', { offerId: o.id, requestId: crypto.randomUUID() });
      toast(data?.sale?.status === 'confirmed' ? `Sold! You received ${fmt(o.payout)} Ryo.` : 'Sale submitted. It finalizes automatically.');
      MK.sel = -1; MK.mine = null; MK.data = null; marketLoad();
    });
  }
  const BOUND_NOTE = '<p class="sbw-bound-note"><b>🔒 REFERRAL-BOUND HERO</b><span>Usable in battles, teams and training. Cannot be listed, sold or transferred.</span></p>';
  const BOUND_TEXT = 'This hero was obtained through the Shinobi Bombers Referral Program. It can be used for gameplay and progression but cannot be listed, sold, or transferred through the marketplace.';
  // "Sell · List on Market" (Heroes) opens this dialog for a token hero.
  function sellDialog(h) {
    const a = account(); if (!h) return;
    if (!a || !h.tokenId || h.tokenOwner !== a) return notice('Market', 'Only heroes from your signed-in token collection can be listed. Practice heroes cannot be sold.');
    if (h.referralBound) return notice('🔒 Referral-bound hero', BOUND_TEXT);
    const min = (MK.data?.rules?.minPrice || MARKET_MIN)[h.r] || MARKET_MIN[0];
    const d = confirmDialog('List ' + h.name, `<p class="sbw-mdl-hero" style="--rc:${RCOL[h.r]}"><b>${RNAME[h.r]}</b> · Lv. ${h.lv} · ${(h.pk || []).map(k => esc(perkName(k))).join(', ')}</p>
      <label class="sbw-sell-price">Price (Ryo)<input type="number" inputmode="numeric" min="${min}" max="100000000" step="1000" value="${min}"></label>
      <p class="sbw-small">Minimum for ${RNAME[h.r]}: ${fmt(min)} Ryo · maximum 100,000,000 Ryo · listed for 7 days. Buyers can also make offers.</p><p class="sbw-sell-out"></p>`, 'List on Market', async dl => {
      const price = Math.floor(Number($('input', dl).value) || 0);
      if (price < min || price > 100000000) { const m = $('.sbw-msg', dl); m.hidden = false; m.textContent = `Set a price from ${fmt(min)} to 100,000,000 Ryo.`; return false; }
      await RyoPayments.market('market-post', { heroId: h.tokenId, price });
      toast(`${h.name} is on the Market for ${fmt(price)} Ryo (7 days).`); MK.mine = null; MK.data = null;
    }, 'sbw-sell');
    const input = $('input', d), out = $('.sbw-sell-out', d);
    const update = () => { const p = Math.floor(Number(input.value) || 0), part = n => Math.floor(p * n / 100); out.innerHTML = `You receive <b>${fmt(p - part(2) - part(8) - part(10))} Ryo</b> (80%) · reward pool ${fmt(part(10))} · treasury ${fmt(part(8))} · studio ${fmt(part(2))}`; };
    input.addEventListener('input', update); update(); input.focus(); input.select();
  }
  function perkPicker() {
    if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body);
    dlg.className = 'sbw-dialog sbw-perks'; dlg.onclick = null;
    dlg.innerHTML = `<h2>Filter by skills</h2><p class="sbw-small">Show heroes that have every skill you tick.</p><div class="sbw-perk-list">${PERK_NAMES().map(([n, d], k) => `<label><input type="checkbox" value="${k}"${MK.perks.includes(k) ? ' checked' : ''}><span><b>${esc(n)}</b><small>${esc(d)}</small></span></label>`).join('')}</div>
      <div class="sbw-acts"><button type="button" class="sbw-btn sbw-alt" data-k="clear">Clear</button><button type="button" class="sbw-btn" data-k="apply">Show heroes</button></div>`;
    dlg.onclick = e => { const k = e.target.dataset && e.target.dataset.k; if (!k) return;
      MK.perks = k === 'clear' ? [] : $$('input:checked', dlg).map(x => +x.value); dlg.close(); MK.tab = 'heroes'; marketReload(); };
    if (!dlg.open) dlg.showModal();
  }
  MODS.market = {
    tab: t => { if (!['heroes', 'mine', 'offers'].includes(t)) return; MK.tab = t; MK.sel = -1; marketReload(); },
    mtab: a => MODS.market.tab({ 0: 'heroes', 3: 'mine' }[+a] || 'heroes'), listings: () => MODS.market.tab('mine'),
    buy: () => marketBuy(marketRows()[MK.sel]), offer: () => offerDialog(marketRows()[MK.sel])
  };
  window.ShinobiMarket = { sell: sellDialog, reload: () => marketReload(false) };
  // The game's own 'Sell · List on Market' buttons (Heroes) open the shared Market listing dialog.
  if (window.Market) window.Market.openListing = id => sellDialog(((gs() && gs().h) || []).find(h => h.id === id));

  /* ---------- Boss Hunt (game page 8): paid daily damage rankings ---------- */
  // Each hunt costs 10,000 Ryo (80% to today's prize pool, 10% treasury, 10% burned) and is a 60-second damage run
  // by up to 5 battle-ready heroes with chakra. Total damage per UTC day ranks the
  // players, and the top 10 share the pool when the day ends (boss-hunt.cjs on the server). Daily places
  // also earn weekly points (1st 10 … 10th 1): the week's top 3 win a Legend hero and 4th–10th an Elite. The
  // artwork keeps its title and frames; every panel inside them is live HTML.
  const GUARD = ['Akuma · Fallen Shinobi', 'Yuki Onna · Frozen Moon', 'Raijin · Thunder Lord', 'Daichi · Ancient Golem', 'Orochi · Serpent King'];
  const BH = { board: null, at: 0, busy: false, error: '', pending: null, active: null, last: null, timer: 0 };
  const ORD = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
  const huntTeam = () => { try { return BattleRoster.list().filter(h => h.en >= 1).sort((a, c) => c.pw - a.pw).slice(0, 5); } catch { return []; } };
  const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; };
  async function huntLoad() {
    if (!account() || !window.RyoPayments?.hunt || BH.busy) return;
    BH.busy = true;
    try { BH.board = (await RyoPayments.hunt('hunt-board')).hunt; if (BH.board?.open && !BH.active) BH.pending = { id: BH.board.open.id, pending: true }; BH.error = ''; BH.at = Date.now(); }
    catch (e) { BH.error = e.message || 'Boss Hunt is unavailable right now.'; BH.at = Date.now(); }
    finally { BH.busy = false; if (built['boss-hunt']) built['boss-hunt'].sig = ''; }
  }
  function huntReport(final) {
    const a = BH.active, s = window.V2?.bossState?.(); if (!a || !s) return Promise.resolve();
    return RyoPayments.hunt('hunt-report', { entryId: a.id, damage: Math.round(s.damage || 0), finish: !!final }).then(r => { if (final) { if (BH.last) BH.last.damage = r.damage; window.CombatClient?.reconcile(r); BH.active = null; huntLoad(); } return r; }).catch(e => { BH.error = e.message || 'The hunt report is waiting for a connection.'; });
  }
  // Bridge used by the game's startBoss/endHunt hooks (apply-boss-hunt.cjs).
  window.BossHunt = {
    guardian: () => BH.board ? BH.board.guardian : null,
    takeEntry: () => { const e = BH.pending; BH.pending = null; if (e) BH.active = e; return e; },
    ended: done => { BH.last = { damage: Math.round(done.damage || 0), result: done.result }; clearInterval(BH.timer); huntReport(true).then(() => { const me = BH.board?.me; if (me?.rank) toast(`Hunt finished · ${fmt(BH.last.damage)} damage · you are ${ORD(me.rank)} today`); }); }
  };
  addEventListener('pagehide', () => { if (!BH.active) return; if (window.KillReport) KillReport.closing = true; try { huntReport(false); } finally { if (window.KillReport) KillReport.closing = false; } });
  INIT['boss-hunt'] = b => {
    $$('.hs', b.st).forEach(e => { if (e.dataset.sbwid !== 'back') e.hidden = true; });
    // Panels touch each other so no printed artwork (old HP bar, tab arrows) shows in the gaps.
    b.head = cv(b, 32, 202, 962, 82, 'sbw-bh-head');
    b.sched = cv(b, 32, 284, 186, 430, 'sbw-bh-sched');
    b.arenaBox = cv(b, 218, 284, 774, 428, 'sbw-bh-arena');
    b.arena = mk('canvas', 'sbw-bh-canvas', b.arenaBox); b.arena.width = 1200; b.arena.height = 660; b.arena.setAttribute('aria-label', 'Guardian arena');
    b.prize = cv(b, 30, 726, 966, 156, 'sbw-bh-prize');
    b.ranks = cv(b, 30, 892, 966, 110, 'sbw-bh-ranks');
    b.team = cv(b, 1020, 200, 488, 678, 'sbw-bh-team');
    b.mine = cv(b, 1020, 890, 488, 110, 'sbw-bh-mine');
    b.team.innerHTML = `<h3>⚔ PREPARE YOUR TEAM</h3><p class="bh-note">Up to 5 rested battle-ready heroes fight. Each attack deals Power damage and costs 1 chakra.</p>
      <div class="bh-fee"><span>ENTRANCE FEE</span><b><i class="coin"></i>10,000 Ryo</b><small>8,000 prize pool · 1,000 treasury · 1,000 burned</small></div>
      <div class="bh-label"><b>Hunt team</b><span class="bh-count"></span></div><div class="bh-tiles"></div>
      <button type="button" class="sbw-mbtn bh-auto" data-act="auto">⟳ Auto-select strongest 5</button>
      <button type="button" class="sbw-mbtn buy bh-go" data-act="go">CHALLENGE · 10,000 Ryo</button><button type="button" class="sbw-mbtn ghost bh-stop" data-act="stop" hidden>End hunt now</button>
      <ul class="bh-rules"><li>⏱ 60-second run · other heroes can continue Adventure</li><li>1 Attack = Hero Power Damage = 1 Chakra</li><li>Skill VFX = 0 Additional Chakra</li><li>🏆 Top 10 by total damage today share the prize pool</li><li>👑 Weekly top 3 win a Legend hero · 4th–10th an Elite</li><li>🕛 Prizes are paid at 00:00 UTC to your Ryo balance</li></ul>`;
    b.tiles = Array.from({ length: 5 }, () => mk('div', 'bh-tile', $('.bh-tiles', b.team)));
    b.team.addEventListener('click', e => { const a = e.target.closest('[data-act]'); if (!a || a.disabled) return; ({ auto: huntAuto, go: huntChallenge, stop: () => window.V2?.retreat?.() })[a.dataset.act]?.(); });
    b.ranks.addEventListener('click', e => { const a = e.target.closest('[data-act]'); if (a && !a.disabled) huntRankings(a.dataset.act); });
  };
  function huntAuto() {
    const t = huntTeam(); if (built['boss-hunt']) { built['boss-hunt'].sig = ''; built['boss-hunt'].flash = performance.now(); }
    toast(t.length ? `Hunt team: ${t.map(h => h.name.split(' ')[0]).join(', ')}` : 'Make at least one hero battle-ready first.');
  }
  function huntChallenge() {
    if (!account()) return notice('Boss Hunt', 'Sign in with your wallet to enter the Boss Hunt.');
    if (window.V2?.isBossActive?.()) return toast('A hunt is already running.');
    if (S?.v2?.revealBatch?.length) return toast('Finish your card reveal first.');
    if (BH.pending?.id) return resumeHunt(BH.pending.id).catch(e => notice('Boss Hunt', e.message));
    const team = huntTeam(); if (!team.length) return notice('Boss Hunt', 'Rest at least one battle-ready hero until it has 1 chakra.');
    const bal = spendable(), g = BH.board ? BH.board.guardianName : GUARD[0];
    const d = confirmDialog('Enter today\'s Boss Hunt?', `<p>Fight <b>${esc(g)}</b> for 60 seconds with ${team.map(h => esc(h.name.split(' ')[0])).join(', ')}.</p>
      <p class="sbw-mbuyline">Entrance fee <b>10,000 Ryo</b><br><span class="sbw-small">8,000 prize pool · 1,000 treasury · 1,000 burned · your balance after: ${fmt(bal - 10000)} Ryo</span></p>
      ${bal < 10000 ? '<p class="sbw-small sbw-warn">Not enough Ryo. Deposit Ryo from your Chest first.</p>' : ''}`, 'Pay 10,000 Ryo & start', async () => {
      const data = await RyoPayments.hunt('hunt-enter', { requestId: crypto.randomUUID(), name: (gs() && gs().nick) || '' });
      if (data.hunt) BH.board = data.hunt;
      BH.pending = data.entry; await resumeHunt(data.entry.id, data.entry);
    }, 'sbw-hunt');
    if (bal < 10000) $('[data-k="go"]', d).disabled = true;
  }
  async function resumeHunt(id, entry) {
    entry = entry && !entry.pending ? entry : (await RyoPayments.hunt('hunt-ready', { entryId: id })).entry;
    if (entry.refunded) { BH.pending = null; throw Error('The entry payment was refunded.'); }
    BH.pending = entry;
    if (entry.pending) { toast('Entry payment is pending. Press Challenge to check the same entry; no second fee is charged.'); return; }
    go(8); V2.startBoss();
    if (!V2.isBossActive()) throw Error('Your paid entry is ready. Press Challenge to resume.');
    clearInterval(BH.timer); BH.timer = setInterval(() => { if (V2.isBossActive()) huntReport(false); else clearInterval(BH.timer); }, 10000);
  }
  // Rankings pop-ups: Daily (today's damage standings + the previous day's winners) and Weekly
  // (this week's points standings + last week's winners).
  const utcDay = (d, o = {}) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', ...o });
  const weekSpan = w => utcDay(w) + ' – ' + utcDay(new Date(Date.parse(w + 'T00:00:00Z') + 6 * 86400000).toISOString().slice(0, 10));
  function huntRankings(kind = 'daily') {
    const h = BH.board, wk = h?.weekly; if (!h || (kind === 'weekly' && !wk)) return;
    const row = (r, value, prize, leg) => `<li class="${r.me ? 'me' : ''}${r.rank <= 3 ? ' p' + r.rank : ''}"><b>${ORD(r.rank)}</b><span>${esc(r.name)}<small>${esc(r.wallet)}</small></span><em>${value}</em><i class="${leg ? 'leg' : ''}">${prize}</i></li>`;
    const list = (rows, empty, cls, fn) => rows && rows.length ? `<ol class="bh-list ${cls}">${rows.map(fn).join('')}</ol>` : `<p class="bh-empty">${empty}</p>`;
    const days = rows => list(rows, '', '', r => row(r, fmt(r.damage) + ' dmg', fmt(r.prize) + ' Ryo'));
    const weeks = rows => list(rows, '', 'wk', r => row(r, r.points + ' pts', esc(r.prize || '—'), /Legend/.test(r.prize)));
    const sec = (title, note, body) => `<section class="bh-sec"><h3>${title}</h3>${note ? `<p>${note}</p>` : ''}${body}</section>`;
    const sum = items => `<div class="bh-dsum">${items.map(([k, v]) => `<span>${k}<b>${v}</b></span>`).join('')}</div>`;
    let body;
    if (kind === 'weekly') {
      const me = wk.me.rank ? `${ORD(wk.me.rank)} · ${wk.me.points} pts` : '—';
      body = `<h2>👑 Weekly Rankings</h2>${sum([['Week (UTC)', weekSpan(wk.week)], ['Ends in', dur(wk.endsIn)], ['Your place', me]])}
        ${sec("This week's standings", 'Daily places earn points: 1st 10 … 10th 1. <b>Top 3 win a Legend hero · 4th–10th an Elite hero.</b> Today\'s points are provisional until 00:00 UTC.', wk.top.length ? weeks(wk.top) : '<p class="bh-empty">No points yet this week. Finish in a daily top 10 to score.</p>')}
        ${wk.me.rank > 10 ? `<p class="bh-you">You: <b>${ORD(wk.me.rank)}</b> · ${wk.me.points} pts</p>` : ''}
        ${sec("🏅 Last week's winners", wk.last ? weekSpan(wk.last.week) + ' · heroes were added to the winners\' collections' : '', wk.last && wk.last.winners.length ? weeks(wk.last.winners) : '<p class="bh-empty">No winners yet. The first weekly prizes are given when this week ends.</p>')}`;
    } else {
      const y = h.yesterday, me = h.me.rank ? `${ORD(h.me.rank)} · ${fmt(h.me.damage)}` : h.me.entries ? 'No damage yet' : 'Not entered';
      body = `<h2>📊 Daily Rankings</h2>${sum([['Prize pool', fmt(h.pool) + ' Ryo'], ['Ends in', dur(h.endsIn)], ['Your place', me]])}
        ${sec("Today's standings", `${utcDay(h.day, { weekday: 'short' })} · total damage · ${h.players} player${h.players === 1 ? '' : 's'} · the top 10 share the pool at 00:00 UTC`, h.top.length ? days(h.top) : '<p class="bh-empty">No damage yet today. Be the first!</p>')}
        ${h.me.rank > 10 ? `<p class="bh-you">You: <b>${ORD(h.me.rank)}</b> · ${fmt(h.me.damage)} dmg</p>` : ''}
        ${sec("🏅 Previous day's winners", y ? `${utcDay(y.day, { weekday: 'short' })} · pool ${fmt(y.pool)} Ryo · paid to Ryo balances` : '', y && y.winners.length ? days(y.winners) : y ? '<p class="bh-empty">Nobody dealt damage that day; the pool carried over.</p>' : '<p class="bh-empty">No results yet for the previous day.</p>')}`;
    }
    if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body);
    dlg.className = 'sbw-dialog sbw-mdialog sbw-rankdlg ' + kind;
    dlg.innerHTML = body + `<div class="sbw-acts"><button type="button" class="sbw-btn ghost" data-k="swap">${kind === 'weekly' ? '📊 Daily rankings' : '👑 Weekly rankings'}</button><button type="button" class="sbw-btn" data-k="x">Close</button></div>`;
    dlg.onclick = e => { const k = e.target.closest('[data-k]')?.dataset.k; if (k === 'x') dlg.close(); else if (k === 'swap') huntRankings(kind === 'weekly' ? 'daily' : 'weekly'); };
    dlg.scrollTop = 0; if (!dlg.open) dlg.showModal();
  }
  PAINT['boss-hunt'] = (b, now) => {
    if (!account()) { if (b.sig !== 'out') { b.sig = 'out'; b.head.innerHTML = '<div class="bh-h"><div><small>BOSS HUNT</small><h3>Sign in to hunt</h3></div></div>'; } return; }
    if (!BH.busy && Date.now() - BH.at > (V2?.isBossActive?.() ? 10000 : 20000)) huntLoad();
    const h = BH.board, s = window.V2?.bossState?.(), active = !!window.V2?.isBossActive?.(), team = huntTeam();
    const left = active ? Math.ceil(s.time) : 0, dmg = active ? Math.round(s.damage) : BH.last ? BH.last.damage : 0;
    const sig = JSON.stringify([h && [h.day, h.pool, h.players, h.top.map(r => [r.name, r.damage]), h.me, h.yesterday?.day, h.weekly?.me, h.weekly?.waiting, h.weekly?.top.map(w => [w.name, w.points])], BH.error, active, left, dmg, team.map(t => t.id + ':' + t.lv), Math.floor(Date.now() / 60000), b.flash]);
    if (sig === b.sig) return; b.sig = sig;
    const name = h ? h.guardianName : BH.error ? 'Boss Hunt' : 'Loading today\'s guardian…';
    b.head.innerHTML = `<div class="bh-h"><div><small>TODAY'S GUARDIAN${h ? ' · ends in ' + dur(h.endsIn) : ''}</small><h3>${esc(name)}</h3></div>
      <div class="bh-state"><em class="${active ? 'run' : 'ready'}">${active ? 'HUNTING' : BH.last ? 'FINISHED' : 'READY'}</em><b>${active ? left + 's' : (h ? h.seconds : 60) + 's'}</b></div></div>
      <div class="bh-meter"><i style="width:${active ? Math.round(100 * ((h ? h.seconds : 60) - s.time) / (h ? h.seconds : 60)) : BH.last ? 100 : 0}%"></i><span>${active ? 'This hunt' : BH.last ? 'Last hunt' : 'Damage'}</span><b>${fmt(dmg)} damage</b></div>`;
    b.sched.innerHTML = !h ? '<h4>GUARDIANS</h4><p class="bh-wait">Loading…</p>' : `<h4>GUARDIANS</h4>${h.schedule.map((d, i) => `<div class="bh-day${i ? '' : ' on'}"><small>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(d.day + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}</small><b>${esc(d.name.split(' · ')[0])}</b><span>${esc(d.name.split(' · ')[1] || '')}</span></div>`).join('')}`;
    b.prize.innerHTML = BH.error ? `<div class="sbw-empty"><b>Boss Hunt unavailable</b><p>${esc(BH.error)}</p></div>` : !h ? '<div class="sbw-empty"><b>Loading today\'s hunt…</b></div>'
      : `<div class="bh-pool"><small>🏆 TODAY'S PRIZE POOL</small><b><i class="coin"></i>${fmt(h.pool)} Ryo</b><span>${h.players} player${h.players === 1 ? '' : 's'} · 80% of every 10,000 Ryo entry</span></div>
        <div class="bh-chips">${h.prizes.map((p, i) => `<span class="${i < 3 ? 'p' + (i + 1) : ''}"><b>${ORD(i + 1)}</b>${fmt(p)}</span>`).join('')}</div>`;
    // Two ranking buttons, each opening its own pop-up.
    const wk = h?.weekly, lead = h?.top[0], wlead = wk?.top[0];
    b.ranks.innerHTML = `<button type="button" class="bh-rk day" data-act="daily"${h ? '' : ' disabled'}><span class="t">📊 DAILY RANKINGS<i>View ›</i></span>
        <span class="l">${!h ? 'Loading…' : lead ? `<b>1st</b> ${esc(lead.name)} · ${fmt(lead.damage)} dmg` : 'No damage yet today. Be the first!'}</span>
        <span class="you">${!h ? '' : `${h.me.rank ? `You: <b>${ORD(h.me.rank)}</b> · ${fmt(h.me.damage)} dmg` : h.me.entries ? 'You: no damage yet' : 'You: not entered'} · ends in ${dur(h.endsIn)}`}</span></button>
      <button type="button" class="bh-rk wk" data-act="weekly"${wk ? '' : ' disabled'}><span class="t">👑 WEEKLY RANKINGS<i>View ›</i></span>
        <span class="l">${!wk ? 'Loading…' : wlead ? `<b>1st</b> ${esc(wlead.name)} · ${wlead.points} pts` : 'No points yet this week'}</span>
        <span class="you">${!wk ? '' : wk.me.rank ? `You: <b>${ORD(wk.me.rank)}</b> · ${wk.me.points} pts${wk.me.prize ? ' · ' + esc(wk.me.prize) : ''}` : 'Top 3: Legend hero · 4th–10th: Elite'}</span></button>`;
    b.mine.innerHTML = `<h4>YOUR DAY</h4><span>Damage today<b>${h ? fmt(h.me.damage) : '—'}</b></span><span>Rank today<b>${h?.me.rank ? ORD(h.me.rank) : '—'}</b></span><span>Entries<b>${h ? h.me.entries : '—'}</b></span><span>If it ended now<b>${h?.me.prize ? fmt(h.me.prize) + ' Ryo' : '—'}</b></span>${wk?.waiting ? `<span class="wait">👑 Weekly hero waiting: ${wk.waiting} · free a collection slot to receive it</span>` : ''}`;
    setText($('.bh-count', b.team), `${team.length}/5 · auto`);
    const flash = b.flash && now - b.flash < 900;
    b.tiles.forEach((e, i) => { const t = team[i]; e.classList.toggle('empty', !t); e.classList.toggle('flash', !!flash); e.style.setProperty('--rc', t ? RCOL[t.r] : '#2a3a6a');
      const k = t ? t.id + ',' + t.lv : 'x'; if (e.dataset.k !== k) { e.dataset.k = k; e.innerHTML = t ? `<canvas width="80" height="90"></canvas><b>Lv. ${t.lv}</b><small>${RNAME[t.r]}</small>` : '<small>Empty</small>'; }
      const c = $('canvas', e); if (c && t) drawHero(c, t, 1.9, now, 4); });
    const go = $('.bh-go', b.team), stop = $('.bh-stop', b.team);
    go.disabled = active || !team.length; go.classList.toggle('run', active); go.textContent = active ? `HUNTING · ${left}s` : 'CHALLENGE · 10,000 Ryo'; stop.hidden = !active;
  };
  MIRROR['boss-hunt'] = b => mirror(b.arena, document.getElementById('bossHuntMap'));
  MODS['boss-hunt'] = { challenge: () => huntChallenge(), team: () => huntAuto(), ranking: () => huntRankings(), bossinfo: () => {}, locked: () => {} };

  /* ---------- Guild and Chat: previews (no backend yet) ---------- */
  ['guild'].forEach(k => {
    INIT[k] = b => { const r = mk('div', 'sbw-preview', b.sec); r.innerHTML = '<b>PREVIEW</b> Guilds are not available yet — this screen shows example artwork, not real players or data.'; b.previewNotice = r; };
    MODS[k] = new Proxy({}, { get: () => () => notice('Guild', 'Guilds are not available yet. This screen is a preview of the design.') });
  });
  // The Chat screen is real DOM (see "Chat screen" below), not artwork.
  INIT.chat = b => initChatScreen(b);
  MODS.chat = {};

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
    markPhoneNav();
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
    if (hb.live.ryo) setText(hb.live.ryo, a && Number.isFinite(Number(l.balance)) ? fmt(spendable(l)) + ' Ryo' : '— Ryo');
    if (hb.label) { if (pend != null && Number.isFinite(pend)) countTo(hb.label, pend, v => 'Chest : ' + fmt(v)); else { counters.delete(hb.label); setText(hb.label, 'Chest'); } }
    if (hb.dot) hb.dot.hidden = !(pend >= 1);
    if (hb.walletSpot) {
      setText(hb.covers.wallet, a ? 'GO OFFLINE' : 'Connect Wallet'); hb.covers.wallet.classList.toggle('sbw-connect', !a);
      const name = a ? 'Go offline: Sensei keeps your team earning · wallet ' + a.slice(0, 4) + '…' + a.slice(-4) : 'Connect wallet';
      if (hb.walletSpot.getAttribute('aria-label') !== name) { hb.walletSpot.setAttribute('aria-label', name); hb.walletSpot.title = name; }
    } else if (hb.covers.wallet) setText(hb.covers.wallet, a ? a.slice(0, 4) + '...' + a.slice(-4) : 'Sign in');
    if (hb.online) { const players = (document.getElementById('onlinePlayers')?.textContent || '').match(/\d[\d,]*/); setText(hb.online, a && players ? players[0] : '—'); }
    else if (hb.covers.gems) setText(hb.covers.gems, '⚙ Tools');
    if (PH) {
      setText(PH.ryo, a && Number.isFinite(Number(l.balance)) ? fmt(spendable(l)) : '—');
      if (pend != null && Number.isFinite(pend)) countTo(PH.chest, pend, v => fmt(v)); else { counters.delete(PH.chest); setText(PH.chest, '—'); }
      PH.dot.hidden = !(pend >= 1); setText(PH.wallet, a ? 'GO OFFLINE' : 'Connect'); PH.wallet.classList.toggle('sbw-connect', !a);
      const players = (document.getElementById('onlinePlayers')?.textContent || '').match(/\d[\d,]*/); setText(PH.online, a && players ? players[0] : '—');
    }
    for (const id of ['ltimer', 'btimer', 'cost', 'slabel', 'fcount', 'stitle', 'enemies', 'reward', 'team', 'upcost', 'trainlbl']) if (b.live[id]) b.live[id].hidden = true;
    (PAINT[cur] || (() => {}))(b, now);
  }

  /* ---------- show/hide over the matching game page ---------- */
  /* ---------- phone layout ---------- */
  // Portrait phones: each screen's panels (MOBILE regions, artwork coordinates) are cut out of the
  // artwork and stacked in one scrolling column at readable size, under a compact header and above a
  // bottom navigation bar. Elements are re-parented, not cloned, into a window that keeps their
  // artwork coordinates, so handlers, live text and PAINT updates keep working; turning the phone
  // to landscape or widening the window puts every element back exactly. A region that would shrink
  // below MIN_ZOOM keeps that zoom and scrolls sideways instead. `flow` panes take an HTML list
  // (team, hero grid, listings) out of its fixed box and reflow it into two columns.
  const MIN_ZOOM = 0.6;
  const MOBILE = {
    home: [[1252, 122, 1652, 247], [22, 122, 1238, 388, { fit: 1 }], [29, 395, 438, 563], [451, 395, 845, 563], [858, 395, 1231, 563], [29, 573, 438, 727], [451, 573, 845, 727],
      [858, 573, 1231, 727], [29, 735, 438, 858], [451, 735, 845, 858], [858, 735, 1231, 858], [1252, 255, 1652, 437], [1252, 445, 1652, 637], [1252, 645, 1652, 860],
      [524, 866, 1218, 938, { fit: 1 }], [12, 866, 520, 938], [1252, 866, 1652, 938]],
    adventure: [[290, 128, 1070, 202, { fit: 1 }], [22, 208, 1524, 732, { pan: 0.5, center: 1 }], { flow: '.sbw-ateam', zoom: 0.85 }],
    heroes: [[14, 228, 432, 286], [436, 228, 1060, 286], [1062, 228, 1522, 286], [14, 288, 450, 318], [1290, 284, 1512, 318], { flow: '.sbw-hgrid', zoom: 0.85, cols: 2 }, [1084, 318, 1512, 1004]],
    summon: [[1252, 118, 1652, 372], [318, 568, 540, 755, { half: 1 }], [552, 568, 768, 755, { half: 1 }], [778, 568, 1000, 755, { half: 1 }], [1010, 568, 1232, 755, { half: 1 }],
      [300, 100, 1245, 560, { fit: 1 }], [1252, 378, 1652, 605], [1252, 612, 1652, 752], [15, 128, 285, 450], [28, 462, 280, 705, { half: 1 }], [28, 715, 280, 875, { half: 1 }]],
    fusion: [[20, 115, 640, 225, { fit: 1 }], [40, 238, 815, 352, { pan: 0.75 }], [42, 358, 815, 540, { pan: 0.75 }], [40, 548, 815, 972, { pan: 0.75 }], [845, 222, 1510, 632],
      [860, 640, 1500, 870], [860, 874, 1500, 972]],
    dojo: [[70, 118, 820, 350, { fit: 1 }], [72, 365, 785, 1012], [800, 365, 1508, 1012]],
    'dojo-upg': [[55, 98, 440, 142, { fit: 1 }], [45, 132, 584, 860], [596, 130, 1632, 852, { pan: 0.65 }]],
    'dojo-sen': [[56, 96, 330, 144], [826, 140, 1604, 372, { fit: 1 }], { parts: [[858, 374, 1120, 420], [1306, 374, 1584, 420]] }, [858, 420, 1592, 452, { fit: 1 }],
      { parts: [[862, 462, 1110, 650], [1300, 462, 1592, 650]] }, [842, 662, 1600, 830, { fit: 1 }], [72, 138, 806, 842, { fit: 1 }]],
    market: [[60, 120, 500, 235, { fit: 1 }], { flow: '.sbw-mbar' }, { flow: '.sbw-mgrid', zoom: 0.85, cols: 2 }, { flow: '.sbw-mpages' }, { flow: '.sbw-mdet' }],
    'boss-hunt': [[20, 108, 660, 192, { fit: 1 }], { flow: '.sbw-bh-head' }, { flow: '.sbw-bh-arena' }, { flow: '.sbw-bh-team' }, { flow: '.sbw-bh-prize' }, { flow: '.sbw-bh-ranks' }, { flow: '.sbw-bh-mine' }, { flow: '.sbw-bh-sched' }],
    codex: [[20, 108, 960, 200, { fit: 1 }], [20, 208, 292, 726], { flow: '.cxp' }, [1215, 210, 1652, 420], [1215, 425, 1652, 666], [1215, 672, 1652, 906]],
    guild: [[208, 205, 978, 524, { pan: 0.7 }], [988, 205, 1515, 524], [208, 530, 978, 706, { pan: 0.7 }], [988, 530, 1515, 706], [25, 712, 506, 1002], [515, 712, 1026, 1002, { pan: 0.7 }],
      [1035, 712, 1513, 1002], [25, 160, 200, 652]],
  };
  const PHONE_NAV = [['home', 'nav-home', 'Home'], ['adventure', 'nav-adventure', 'Battle'], ['heroes', 'nav-heroes', 'Heroes'], ['summon', 'nav-summon', 'Summon']];
  const PHONE_MORE = [['fusion', 'nav-fusion', 'Fusion'], ['dojo', 'nav-dojo', 'Dojo'], ['market', 'nav-market', 'Market'], ['boss-hunt', 'nav-bosshunt', 'Boss Hunt'], ['codex', 'nav-codex', 'Codex'], ['guild', 'nav-guild', 'Guild']];
  let PH = null;
  // Mobile browsers briefly report innerWidth as the zoomed-out width (~1580px) while a new 1536px
  // artwork stage is in the layout, which once switched phones to the full-size desktop screen. The
  // layout viewport (documentElement.clientWidth) keeps the real phone width.
  const viewW = () => document.documentElement.clientWidth || innerWidth, viewH = () => document.documentElement.clientHeight || innerHeight;
  const isPhone = () => viewW() <= 820 && viewH() > viewW();
  function navIcon(e, id) { const h = D.header.hs.find(h => h.id === id); if (!h) return; const r = [h.r[0], 4, h.r[2], 52], k = 30 / (r[3] - r[1]); e.style.width = (r[2] - r[0]) * k + 'px'; e.style.height = '30px'; e.style.backgroundImage = `url(${BASE + D.header.img})`; e.style.backgroundSize = `${D.header.W * k}px ${D.header.H * k}px`; e.style.backgroundPosition = `${-r[0] * k}px ${-r[1] * k}px`; }
  function buildPhoneChrome() {
    if (PH) return;
    const top = mk('div', 'sbw-ph-top', layer), nav = mk('nav', 'sbw-ph-nav', layer), more = mk('div', 'sbw-ph-more', layer);
    nav.setAttribute('aria-label', 'Main'); more.hidden = true; more.setAttribute('role', 'dialog'); more.setAttribute('aria-label', 'More screens');
    top.innerHTML = '<button type="button" class="sbw-ph-ryo" aria-label="Ryo balance – open Chest to deposit"><i class="coin"></i><span class="v"><small>RYO</small><b>—</b></span><span class="plus">+</span></button>' +
      '<button type="button" class="sbw-ph-chest" aria-label="Open your Chest"><span class="v"><small>CHEST</small><b>—</b></span><i class="cdot" hidden></i></button>' +
      `<button type="button" class="sbw-ph-gear" aria-label="Tools">${HDR ? HDR.gear.innerHTML : '⚙'}</button><button type="button" class="sbw-ph-wallet">GO OFFLINE</button>`;
    const item = (k, id, label, root) => { const btn = mk('button', 'sbw-ph-item', root); btn.type = 'button'; btn.dataset.k = k; navIcon(mk('i', '', btn), id); mk('span', '', btn).textContent = label; btn.addEventListener('click', () => { more.hidden = true; goScreen(k); }); return btn; };
    const items = {}; for (const [k, id, label] of PHONE_NAV) items[k] = item(k, id, label, nav);
    const moreBtn = mk('button', 'sbw-ph-item sbw-ph-morebtn', nav); moreBtn.type = 'button'; moreBtn.setAttribute('aria-expanded', 'false'); moreBtn.innerHTML = '<i class="dots">•••</i><span>More</span>';
    const sheet = mk('div', 'sbw-ph-sheet', more); const head = mk('p', 'sbw-ph-sheethead', sheet); head.innerHTML = 'More <small>Players online: <b>—</b></small>';
    const grid = mk('div', 'sbw-ph-grid', sheet); for (const [k, id, label] of PHONE_MORE) items[k] = item(k, id, label, grid);
    const chat = mk('button', 'sbw-ph-item', grid); chat.type = 'button'; chat.innerHTML = '<i class="dots">💬</i><span>Chat</span>'; chat.addEventListener('click', () => { more.hidden = true; goScreen('chat'); });
    const setMore = open => { more.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); };
    moreBtn.addEventListener('click', () => setMore(more.hidden)); more.addEventListener('click', e => { if (e.target === more) setMore(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && !more.hidden) setMore(false); });
    top.querySelector('.sbw-ph-ryo').addEventListener('click', openChest); top.querySelector('.sbw-ph-chest').addEventListener('click', openChest); top.querySelector('.sbw-ph-wallet').addEventListener('click', walletButton);
    PH = { top, nav, more, items, moreBtn, ryo: top.querySelector('.sbw-ph-ryo b'), chest: top.querySelector('.sbw-ph-chest b'), chestEl: top.querySelector('.sbw-ph-chest'), dot: top.querySelector('.sbw-ph-chest .cdot'),
      gear: top.querySelector('.sbw-ph-gear'), wallet: top.querySelector('.sbw-ph-wallet'), online: head.querySelector('b') };
  }
  function markPhoneNav() {
    if (!PH) return; const k = cur && cur.startsWith('dojo') ? 'dojo' : cur;
    for (const [key, e] of Object.entries(PH.items)) { const on = key === k; e.classList.toggle('on', on); if (on) e.setAttribute('aria-current', 'page'); else e.removeAttribute('aria-current'); }
    PH.moreBtn.classList.toggle('on', PHONE_MORE.some(([key]) => key === k));
  }
  function regionOf(e, panes) {
    const x = parseFloat(e.style.left), y = parseFloat(e.style.top); if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const cx = x + (parseFloat(e.style.width) || e.offsetWidth || 0) / 2, cy = y + (parseFloat(e.style.height) || e.offsetHeight || 0) / 2;
    for (const p of panes) for (const w of p.windows) if (cx >= w.r[0] && cx < w.r[2] && cy >= w.r[1] && cy < w.r[3]) return w;
    return null;
  }
  function adopt(b, e) {
    const m = b.mob; if (e === m.col || e.classList.contains('sbw-base') || m.seen.has(e)) return; m.seen.add(e);
    const flow = m.panes.find(p => p.o.flow && e.matches(p.o.flow)), w = flow ? null : regionOf(e, m.panes);
    if (!flow && !w) { e.classList.add('sbw-moff'); return; }
    if (flow) { e.classList.add('sbw-mflow'); if (flow.o.cols) { m.cols.set(e, e.style.gridTemplateColumns); } flow.inner.append(e); }
    else w.shift.append(e);
  }
  function windowOf(b, r, parent) {
    const box = mk('div', 'sbw-mpart', parent), shift = mk('div', 'sbw-mshift', box);
    box.style.width = (r[2] - r[0]) + 'px'; box.style.height = (r[3] - r[1]) + 'px';
    shift.style.cssText = `left:${-r[0]}px;top:${-r[1]}px;width:${b.s.W}px;height:${b.s.H}px;background:url(${BASE + b.s.img}) 0 0/${b.s.W}px ${b.s.H}px no-repeat`;
    return { r, shift };
  }
  function stack(b) {
    const spec = MOBILE[cur] || [[0, b.s.hdrH || 0, b.s.W, b.s.H, { pan: MIN_ZOOM }]];
    const col = mk('div', 'sbw-mcol', b.st), panes = [];
    for (const item of spec) {
      const o = Array.isArray(item) ? { r: item.slice(0, 4), ...(item[4] || {}) } : item;
      const pane = mk('div', 'sbw-mpane' + (o.half ? ' half' : '') + (o.flow ? ' flow' : ''), col), inner = mk('div', 'sbw-minner', pane);
      // A region is one window; `parts` places several windows of one row side by side, dropping the
      // empty artwork between a label and its control so the row fits the phone at readable size.
      const windows = (o.parts || (o.r ? [o.r] : [])).map(r => windowOf(b, r, inner));
      if (o.parts) inner.classList.add('sbw-mparts');
      o.w = windows.reduce((n, w) => n + w.r[2] - w.r[0], 0);
      panes.push({ o, pane, inner, windows });
    }
    b.mob = { col, panes, order: [...b.st.children].filter(e => e !== col), seen: new Set(), cols: new Map() };
    b.st.classList.add('sbw-mstack');
    for (const e of b.mob.order) adopt(b, e);
  }
  function unstack(b) {
    const m = b.mob; if (!m) return;
    for (const e of m.seen) e.classList.remove('sbw-moff', 'sbw-mflow');
    for (const [e, cols] of m.cols) e.style.gridTemplateColumns = cols;
    for (const e of [...m.order, ...m.seen]) if (e !== m.col && e.parentElement !== b.st) b.st.append(e);
    m.col.remove(); b.st.classList.remove('sbw-mstack'); b.mob = null;
  }
  function layoutPhone(b) {
    buildPhoneChrome(); layer.classList.add('sbw-phone');
    b.sec.style.clipPath = 'none'; b.st.style.clipPath = 'none'; b.st.style.transform = 'none';
    if (!b.mob) stack(b);
    for (const e of [...b.st.children]) if (e !== b.mob.col) adopt(b, e);
    const cw = Math.min(viewW(), 640) - 16;
    for (const p of b.mob.panes) {
      const o = p.o, avail = o.half ? (cw - 8) / 2 : cw;
      p.pane.style.width = avail + 'px';
      if (o.flow) {
        const z = o.zoom || 1; p.inner.style.zoom = z; p.inner.style.width = (avail / z) + 'px';
        if (o.cols) for (const e of p.inner.children) e.style.gridTemplateColumns = `repeat(${o.cols},minmax(0,1fr))`;
        continue;
      }
      const w = o.w; let z = Math.min(o.max || 1, avail / w); const pan = !o.fit && z < (o.pan || MIN_ZOOM);
      if (pan) z = o.pan || MIN_ZOOM;
      p.pane.classList.toggle('pan', pan); p.inner.style.zoom = z;
      if (!pan) p.pane.style.width = Math.min(avail, w * z) + 'px'; // narrow panels sit centred, not stretched
      if (pan && o.center && !p.centered && p.pane.scrollWidth > p.pane.clientWidth) { p.pane.scrollLeft = (p.pane.scrollWidth - p.pane.clientWidth) / 2; p.centered = true; }
    }
    // Tapping a hero card scrolls to its details below the grid.
    if (cur === 'heroes' && b.grid && b.det && !b.phoneTap) { b.phoneTap = true; b.grid.addEventListener('click', e => { if (!layer.classList.contains('sbw-phone') || e.target.closest('button,[data-k]')) return; setTimeout(() => b.det.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' }), 60); }); }
    document.body.classList.add('sbw-phone-ui');
    markPhoneNav();
  }
  function leavePhone() {
    if (!layer.classList.contains('sbw-phone')) return;
    layer.classList.remove('sbw-phone'); document.body.classList.remove('sbw-phone-ui'); for (const k in built) unstack(built[k]);
    if (PH) PH.more.hidden = true;
  }
  function fit() {
    geometryRevision++;
    const b = cur && built[cur]; if (!b) return;
    if (b.chatRoot) { fitChatScreen(b); return; }
    if (isPhone()) {
      try { layoutPhone(b); placeTrigger(); placeChat(); return; }
      // Never leave a phone on raw full-size artwork: fall back to the fitted desktop layout.
      catch (error) { console.error('Phone layout failed; using the desktop layout:', error); }
    }
    try { leavePhone(); } catch (error) { console.error(error); }
    const vw = viewW(), vh = viewH();
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
    // Phone: the game's own Chest button and Tools menu sit over the compact header's buttons.
    if (PH && layer.classList.contains('sbw-phone')) {
      const d = document.documentElement.style, r = PH.chestEl.getBoundingClientRect(), g = PH.gear.getBoundingClientRect();
      d.setProperty('--sbw-chest-x', r.left + 'px'); d.setProperty('--sbw-chest-y', r.top + 'px'); d.setProperty('--sbw-chest-w', r.width + 'px'); d.setProperty('--sbw-chest-h', r.height + 'px');
      d.setProperty('--sbw-tools-x', g.left + 'px'); d.setProperty('--sbw-tools-y', g.top + 'px'); d.setProperty('--sbw-tools-w', g.width + 'px'); d.setProperty('--sbw-tools-h', g.height + 'px');
      return;
    }
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
  // Moderation (enforced by the chat server): `removed` drops messages staff hid; `standing` is this
  // wallet's own mute / ban / recent warning, shown so a refused send is never a surprise.
  let chatStanding = null;
  const chatBlocked = () => !!(chatStanding && (chatStanding.banned || chatStanding.mutedUntil > Date.now()));
  const standingText = () => !chatStanding ? '' : chatStanding.banned ? 'You can no longer send messages in Global chat. You can still read it. Contact support to appeal.'
    : chatStanding.mutedUntil > Date.now() ? 'You are muted in Global chat until ' + new Date(chatStanding.mutedUntil).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '.'
    : chatStanding.warning ? chatStanding.warning.text : '';
  function applyModeration(feed) {
    if (!feed) return;
    if (Array.isArray(feed.removed) && feed.removed.length) { const gone = new Set(feed.removed); for (const list of [chatMsgs, sysMsgs]) for (let i = list.length - 1; i >= 0; i--) if (gone.has(list[i].id)) list.splice(i, 1); }
    chatStanding = feed.standing || null;
  }
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
    const input = $('input', chatPop), on = chatTab === 'Global' && chatReady() && !chatBlocked();
    input.disabled = !on; $('button[type="submit"]', chatPop).disabled = !on || chatSending;
    input.placeholder = chatTab !== 'Global' ? 'Switch to Global to chat' : !chatReady() ? 'Sign in to chat' : chatBlocked() ? 'Sending is restricted' : 'Type your message…';
  }
  function addMessages(target, list) {
    const seen = new Set(target.map(m => m.id)), added = (list || []).filter(m => !seen.has(m.id));
    target.push(...added); target.sort((a, b) => a.id - b.id); if (target.length > CHAT_KEEP) target.splice(0, target.length - CHAT_KEEP);
    return added.length;
  }
  function mergeChat(list, system, feed) {
    const account = RyoPayments.state.account;
    if (account !== chatOwner) { chatOwner = account; chatMsgs.length = sysMsgs.length = 0; chatAfter = sysAfter = 0; sysPrimed = sysUnread = false; chatStanding = null; }
    applyModeration(feed);
    addMessages(chatMsgs, list); chatAfter = chatMsgs.at(-1)?.id || chatAfter;
    if (system) {
      // Announcements already present at first load are history, not new.
      if (addMessages(sysMsgs, system) && sysPrimed && !(chatPop && !chatPop.hidden && chatTab === 'System') && !(cur === 'chat' && csTab === 'System')) sysUnread = true;
      sysAfter = sysMsgs.at(-1)?.id || sysAfter; sysPrimed = true;
    }
    renderChat(); renderChatScreen(); refresh();
  }
  async function pollChat() {
    clearTimeout(chatTimer); const open = !!chatPop && !chatPop.hidden, onScreen = cur === 'chat';
    if (!chatFetching && chatReady() && !document.hidden && (open || onScreen || cur === 'home')) {
      chatFetching = true;
      try {
        if (RyoPayments.state.account !== chatOwner) mergeChat([]);
        const feed = await RyoPayments.chat('chat-list', { channel: 'global', after: chatAfter, systemAfter: sysAfter });
        mergeChat(feed.messages, feed.system, feed);
        const standing = standingText();
        if (open && !chatSending && (standing || $('.sbw-cp-note', chatPop).classList.contains('sbw-cp-error'))) chatNote(standing, chatBlocked());
        if (onScreen && !chatSending && !csReporting) csNote(standing, chatBlocked());
      } catch { if (open) chatNote('Chat is temporarily unavailable. Retrying…', true); if (onScreen) csNote('Chat is temporarily unavailable. Retrying…', true); }
      finally { chatFetching = false; }
    }
    chatTimer = setTimeout(pollChat, (chatPop && !chatPop.hidden) || cur === 'chat' ? 3000 : 20000);
  }
  async function sendChat(e) {
    e.preventDefault(); const input = $('input', chatPop), text = input.value.trim();
    if (!text || chatSending || !chatReady()) return;
    chatSending = true; renderChat();
    try {
      const sent = await RyoPayments.chat('chat-send', { channel: 'global', text, name: (gs() && gs().nick) || 'Shinobi', after: chatAfter });
      mergeChat(sent.messages, undefined, sent);
      input.value = ''; chatNote(standingText()); updateCount();
    } catch (err) { chatNote(err.message || 'Message could not be sent.', true); }
    finally { chatSending = false; renderChat(); input.focus(); }
  }
  function updateCount() { $('.sbw-cp-count', chatPop).textContent = [...$('input', chatPop).value].length + ' / 200'; }
  function toggleChat(open) {
    if (!chatPop) {
      chatPop = mk('div', 'sbw-chatpop', layer); chatPop.hidden = true; chatPop.setAttribute('role', 'dialog'); chatPop.setAttribute('aria-label', 'Global chat');
      chatPop.innerHTML = `<div class="sbw-cp-head"><b>💬 GLOBAL CHAT</b><div class="sbw-cp-tabs" role="tablist">${['Global', 'Guild', 'System'].map((t, i) => `<button type="button" role="tab" aria-selected="${!i}">${t}</button>`).join('')}</div><button type="button" class="sbw-cp-full" aria-label="Open full chat screen" title="Open full chat">⤢</button><button type="button" class="sbw-cp-x" aria-label="Close chat">✕</button></div>
        <div class="sbw-cp-log" role="log" aria-live="polite"></div>
        <p class="sbw-cp-note" role="status"></p>
        <form class="sbw-cp-in"><input type="text" maxlength="200" autocomplete="off" aria-label="Message"><small class="sbw-cp-count">0 / 200</small><button type="submit">Send</button></form>
        <p class="sbw-cp-rules">Be kind. Links are blocked, and the team never messages you first about wallets or trades.</p>`;
      $('.sbw-cp-x', chatPop).onclick = () => toggleChat(false);
      $('.sbw-cp-full', chatPop).onclick = () => { toggleChat(false); goScreen('chat'); };
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
  /* ---------- Chat screen (real DOM; Global + System are live, the rest is marked placeholder) ---------- */
  // LIVE: Global send/receive and System announcements (shared data layer with the Home pop-up above).
  // PLACEHOLDER: other channels, announcement cards, Online Ninjas, My Guild, Quick Actions, levels, avatars.
  // TODO(backend): bind each placeholder block to real data when its endpoint exists (see plan notes).
  const CS_CHANNELS = [['Global', '🌐'], ['Guild', '🔖'], ['Team', '👥'], ['Direct Messages', '✉️'], ['Trade', '⚖️'], ['System', '⚙️'], ['Event', '📅'], ['Help', '❓']];
  const CS_SOON = { Guild: 'Guild chat opens when guilds launch.', Team: 'Team chat opens with parties.', 'Direct Messages': 'Direct messages are coming soon.', Trade: 'Trade chat is coming soon.', Event: 'Event chat is coming soon.' };
  const CS_HELP = ['Be kind to fellow shinobi.', 'Links are blocked and messages are limited to 200 characters.', 'You can send one message every 2 seconds.', 'The team never messages you first about wallets or trades.'];
  const CS_ANN = [['🎁', 'Weekend Boost Event!', 'Increased drop rates and rewards!', '3d 12h 45m', 'gold'], ['⚔️', 'Guild War Sign-Up!', 'Register your guild by Jan 28!', '1d 18h 30m', 'cyan'], ['⚙️', 'Maintenance Notice', 'Server maintenance on Jan 27, 03:00 – 05:00 (UTC).', '', 'purple']];
  const CS_NINJAS = [['NinjaMaster', 68, '🏯 In Dojo', 'ok'], ['ShadowKage', 72, '⚔️ Boss Hunt', 'warn'], ['RyoSenpai', 70, '🏪 In Market', 'ok'], ['KuroFox', 75, '🌿 In Adventure', 'ok'], ['EmberLeaf', 65, '💤 Idle', 'idle']];
  const CS_EMOJI = ['😀', '😂', '😎', '🔥', '⚔️', '💥', '🍃', '🌸', '👍', '🙏', '🎉', '💎'];
  let csTab = 'Global', csReporting = null;
  const csHue = n => { let h = 0; for (const c of n) h = (h * 31 + c.codePointAt(0)) % 360; return h; };
  function csAvatar(parent, name, cls) { const a = mk('span', 'sbw-cs-av' + (cls ? ' ' + cls : ''), parent); a.textContent = ([...name][0] || '?').toUpperCase(); a.style.setProperty('--h', csHue(name)); a.setAttribute('aria-hidden', 'true'); return a; }
  function csNote(text, isError = false) { const b = built.chat, n = b && b.cs && b.cs.note; if (!n) return; n.textContent = text; n.classList.toggle('sbw-cs-error', isError); n.setAttribute('role', isError ? 'alert' : 'status'); }
  function csCount() { const b = built.chat; b.cs.count.textContent = [...b.cs.input.value].length + ' / 200'; }
  function csTime(parent, created) { const d = new Date(created), t = mk('time', '', parent); t.dateTime = d.toISOString(); t.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function initChatScreen(b) {
    b.st.replaceChildren(); b.st.style.display = 'none';          // drop the artwork + stub hotspots
    const r = mk('div', 'sbw-chat', b.sec); b.chatRoot = r;
    r.innerHTML = `
      <div class="sbw-cs-bg" aria-hidden="true"></div>
      <div class="sbw-cs-top"><h2>CHAT</h2><p>Chat, coordinate, and connect with fellow shinobi.</p>
        <button type="button" class="sbw-cs-social-btn" aria-expanded="false" aria-controls="sbwCsSide">👥 Social</button></div>
      <nav class="sbw-cs-left sbw-cs-panel" aria-label="Chat channels"><h3>💬 CHAT CHANNELS</h3><div class="sbw-cs-tabs" role="tablist" aria-orientation="vertical"></div></nav>
      <section class="sbw-cs-main sbw-cs-panel" aria-label="Chat">
        <header class="sbw-cs-head"><h3><span class="sbw-cs-title">GLOBAL CHAT</span></h3><span class="sbw-cs-online">👥 <b>—</b> online</span>
          <select class="sbw-cs-pick" aria-label="Channel">${CS_CHANNELS.map(([n]) => `<option>${n}</option>`).join('')}</select></header>
        <div class="sbw-cs-ann">${CS_ANN.map(([i, t, d, c, k]) => `<article class="sbw-cs-card ${k}"><i aria-hidden="true">${i}</i><div><b></b><span></span>${c ? '<em>⏱ </em>' : ''}</div></article>`).join('')}</div>
        <div class="sbw-cs-log" role="log" aria-live="polite" tabindex="0" aria-label="Messages"></div>
        <p class="sbw-cs-note" role="status"></p>
        <form class="sbw-cs-report" hidden aria-label="Report a message"><p class="sbw-cs-report-q"></p>
          <select aria-label="Report reason"><option value="spam">Spam</option><option value="scam">Scam or phishing</option><option value="harassment">Harassment</option><option value="impersonation">Impersonation</option><option value="offensive">Offensive language</option><option value="other">Other rule break</option></select>
          <input type="text" maxlength="300" autocomplete="off" placeholder="Optional details for moderators" aria-label="Report details">
          <button type="submit">Send report</button><button type="button" class="sbw-cs-report-x">Cancel</button></form>
        <form class="sbw-cs-form">
          <select class="sbw-cs-ch2" aria-label="Send to channel"><option>Global</option></select>
          <span class="sbw-cs-emoji-wrap"><button type="button" class="sbw-cs-ico sbw-cs-emoji" aria-label="Emoji" aria-expanded="false">😊</button><span class="sbw-cs-emoji-pop" hidden></span></span>
          <button type="button" class="sbw-cs-ico sbw-cs-sticker" aria-label="Stickers (coming soon)">🎭</button>
          <button type="button" class="sbw-cs-ico" aria-label="Attach (coming soon)" disabled title="Attachments are not supported yet">📎</button>
          <input type="text" maxlength="200" autocomplete="off" aria-label="Message"><small class="sbw-cs-count">0 / 200</small>
          <button type="submit" class="sbw-cs-send">➤ Send</button></form>
      </section>
      <aside class="sbw-cs-side" id="sbwCsSide" aria-label="Social">
        <section class="sbw-cs-panel"><h3>👥 ONLINE NINJAS <span class="sbw-cs-tag">Preview data</span><button type="button" class="sbw-cs-link" data-soon="Full online-player list">View All ›</button></h3><ul class="sbw-cs-ninjas"></ul></section>
        <section class="sbw-cs-panel sbw-cs-guild"><h3>🔖 MY GUILD <span class="sbw-cs-tag">Preview</span></h3><div><span class="sbw-cs-crest" aria-hidden="true">忍</span><p><b>ShadowLegacy</b><small>Members: 48 / 50</small><small class="ok">● 12 online</small></p><button type="button" data-soon="Guild chat">💬 Guild Chat</button></div></section>
        <section class="sbw-cs-panel"><h3>⚡ QUICK ACTIONS</h3><div class="sbw-cs-qa"><button type="button" data-soon="Create Party">➕ Create Party</button><button type="button" data-soon="Invite">✉️ Invite</button><button type="button" data-soon="Whisper">💬 Whisper</button><button type="button" class="sbw-cs-report-help">⚠️ Report</button></div></section>
      </aside>`;
    // Announcement cards: text through textContent (static placeholder content).
    $$('.sbw-cs-card', r).forEach((c, i) => { $('b', c).textContent = CS_ANN[i][1]; $('span', c).textContent = CS_ANN[i][2]; const em = $('em', c); if (em) em.append(CS_ANN[i][3]); });
    const ul = $('.sbw-cs-ninjas', r);
    for (const [n, lv, st, k] of CS_NINJAS) {
      const li = mk('li', '', ul); csAvatar(li, n); const p = mk('p', '', li);
      mk('b', '', p).textContent = n; mk('small', 'sbw-cs-lv', p).textContent = 'Lv. ' + lv; mk('small', 'sbw-cs-st ' + k, p).textContent = st;
      const w = mk('button', 'sbw-cs-ico', li); w.type = 'button'; w.textContent = '💬'; w.setAttribute('aria-label', 'Whisper ' + n); w.dataset.soon = 'Whisper';
    }
    const tabs = $('.sbw-cs-tabs', r), pick = $('.sbw-cs-pick', r);
    CS_CHANNELS.forEach(([n, ico]) => {
      const t = mk('button', 'sbw-cs-tab', tabs); t.type = 'button'; t.setAttribute('role', 'tab'); t.dataset.ch = n;
      mk('i', '', t).textContent = ico; mk('span', '', t).textContent = n; mk('em', 'sbw-cs-badge', t).hidden = true;
    });
    const setTab = n => { csTab = n; pick.value = n; if (n === 'System') sysUnread = false; renderChatScreen(); $('.sbw-cs-log', r).scrollTop = 1e9; };
    tabs.addEventListener('click', e => { const t = e.target.closest('.sbw-cs-tab'); if (t) setTab(t.dataset.ch); });
    tabs.addEventListener('keydown', e => {
      const all = $$('.sbw-cs-tab', tabs), i = all.indexOf(document.activeElement); if (i < 0) return;
      const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]; if (!d) return;
      e.preventDefault(); const n = all[(i + d + all.length) % all.length]; n.focus(); setTab(n.dataset.ch);
    });
    pick.onchange = () => setTab(pick.value);
    const form = $('.sbw-cs-form', r), input = $('input', form), pop = $('.sbw-cs-emoji-pop', r), eb = $('.sbw-cs-emoji', r);
    pop.replaceChildren(...CS_EMOJI.map(em => { const x = mk('button', '', null); x.type = 'button'; x.textContent = em; x.setAttribute('aria-label', 'Insert ' + em); x.onclick = () => { if (!input.disabled && [...input.value].length < 199) { input.value += em; csCount(); } input.focus(); }; return x; }));
    eb.onclick = () => { pop.hidden = !pop.hidden; eb.setAttribute('aria-expanded', String(!pop.hidden)); };
    r.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { pop.hidden = true; eb.setAttribute('aria-expanded', 'false'); eb.focus(); } });
    $('.sbw-cs-social-btn', r).onclick = e => { const o = r.classList.toggle('sbw-cs-social-open'); e.currentTarget.setAttribute('aria-expanded', String(o)); };
    r.addEventListener('click', e => { const s = e.target.closest('[data-soon]'); if (s) notice(s.dataset.soon, 'This is a preview of the design. It opens when the feature launches.'); });
    $('.sbw-cs-sticker', r).dataset.soon = 'Stickers';
    input.addEventListener('input', csCount); form.onsubmit = csSend;
    // Reporting a Global message: a persistent panel (the log re-renders on every poll), sent to the
    // server's chat-report action. Moderators review it; reporting never hides anything by itself.
    const rep = $('.sbw-cs-report', r), closeReport = () => { rep.hidden = true; csReporting = null; };
    $('.sbw-cs-log', r).addEventListener('click', e => {
      const btn = e.target.closest('[data-report]'); if (!btn) return;
      const m = chatMsgs.find(x => x.id === Number(btn.dataset.report)); if (!m) return;
      csReporting = m; rep.hidden = false; $('.sbw-cs-report-q', rep).textContent = 'Report ' + m.name + ' (' + m.from + '): “' + m.text + '”';
      $('input', rep).value = ''; $('select', rep).focus();
    });
    $('.sbw-cs-report-x', rep).onclick = closeReport;
    rep.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeReport(); } });
    rep.onsubmit = async e => {
      e.preventDefault(); const m = csReporting; if (!m || !chatReady()) return;
      const send = $('button[type="submit"]', rep); send.disabled = true;
      try {
        const res = await RyoPayments.chat('chat-report', { messageId: m.id, category: $('select', rep).value, details: $('input', rep).value.trim() || undefined });
        closeReport(); csNote(res.status === 'duplicate' ? 'You already reported this message for that reason.' : res.status === 'removed' ? 'Moderators already removed this message.' : 'Thanks — moderators will review this message.');
      } catch (err) { csNote(err.message || 'The report could not be sent.', true); }
      finally { send.disabled = false; }
    };
    $('.sbw-cs-report-help', r).onclick = () => csNote('To report a message, choose ⚑ next to it in Global chat.');
    b.cs = { tabs, pick, log: $('.sbw-cs-log', r), note: $('.sbw-cs-note', r), input, send: $('.sbw-cs-send', r), count: $('.sbw-cs-count', r), title: $('.sbw-cs-title', r), online: $('.sbw-cs-online b', r), ch2: $('.sbw-cs-ch2', r) };
    renderChatScreen();
  }
  function renderChatScreen() {
    const b = built.chat, c = b && b.cs; if (!c || cur !== 'chat') return;
    const log = c.log, stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40, nodes = [];
    const msg = (cls, who, text, created, from, mine, reportId) => {
      const a = document.createElement('article'); a.className = 'sbw-cs-msg ' + cls + (mine ? ' mine' : '');
      if (cls === 'sys') mk('span', 'sbw-cs-av sys', a).textContent = '⚙'; else csAvatar(a, who);
      const h = mk('p', 'sbw-cs-mh', a); mk('b', '', h).textContent = who; if (from) mk('small', 'sbw-cs-lvb', h).textContent = from; if (created) csTime(h, created);
      if (reportId) { const rb = mk('button', 'sbw-cs-rep', h); rb.type = 'button'; rb.textContent = '⚑'; rb.dataset.report = reportId; rb.title = 'Report message'; rb.setAttribute('aria-label', 'Report message from ' + who); }
      mk('p', 'sbw-cs-mt', a).textContent = text; return a;
    };
    if (csTab === 'Global') { nodes.push(msg('sys', '[System]', WELCOME)); for (const m of chatMsgs) nodes.push(msg('', m.name, m.text, m.created, m.from, m.mine, !m.mine && chatReady() ? m.id : 0)); }
    else if (csTab === 'System') { nodes.push(msg('sys', '[System]', WELCOME)); for (const m of sysMsgs) { const n = msg('sys legend', '[System]', m.text, m.created); nodes.push(n); } }
    else if (csTab === 'Help') for (const t of CS_HELP) nodes.push(msg('sys', '[Help]', t));
    else { const p = document.createElement('p'); p.className = 'sbw-cs-empty'; p.textContent = CS_SOON[csTab]; nodes.push(p); }
    log.replaceChildren(...nodes); if (stick) log.scrollTop = log.scrollHeight;
    const ready = chatReady(), live = csTab === 'Global' && ready && !chatBlocked();
    $$('.sbw-cs-tab', c.tabs).forEach(t => { const on = t.dataset.ch === csTab; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      const bd = $('.sbw-cs-badge', t); bd.hidden = !(t.dataset.ch === 'System' && sysUnread); bd.textContent = 'NEW'; });
    c.title.textContent = csTab.toUpperCase() + ' CHAT'; c.pick.value = csTab; c.ch2.replaceChildren(new Option(csTab === 'Global' ? 'Global' : csTab));
    c.input.disabled = !live; c.send.disabled = !live || chatSending;
    c.input.placeholder = csTab !== 'Global' ? 'Switch to Global to chat' : !ready ? 'Sign in to chat' : chatBlocked() ? 'Sending is restricted' : 'Type your message…';
    const op = document.getElementById('onlinePlayers'); c.online.textContent = ((op && /\d[\d,]*/.exec(op.textContent)) || ['—'])[0];
  }
  async function csSend(e) {
    e.preventDefault(); const c = built.chat.cs, text = c.input.value.trim();
    if (!text || chatSending || !chatReady() || csTab !== 'Global') return;
    chatSending = true; renderChatScreen();
    try {
      const sent = await RyoPayments.chat('chat-send', { channel: 'global', text, name: (gs() && gs().nick) || 'Shinobi', after: chatAfter });
      mergeChat(sent.messages, undefined, sent);
      c.input.value = ''; csNote(standingText()); csCount();
    } catch (err) { csNote(err.message || 'Message could not be sent.', true); }
    finally { chatSending = false; renderChatScreen(); c.input.focus(); }
  }
  // Position the DOM screen under the shared header (desktop) or between the phone top bar and bottom nav.
  function fitChatScreen(b) {
    const r = b.chatRoot, vw = viewW(), vh = viewH();
    b.sec.style.clipPath = 'none';
    if (isPhone()) {
      buildPhoneChrome(); layer.classList.add('sbw-phone'); document.body.classList.add('sbw-phone-ui'); markPhoneNav();
      r.style.top = PH.top.offsetHeight + 'px'; r.style.bottom = PH.nav.offsetHeight + 'px';
    } else {
      try { leavePhone(); } catch (error) { console.error(error); }
      const H = D.header, hs = HDR ? Math.min(vw / H.W, (vh * 0.14) / H.body) : 0;
      if (HDR) { HDR.st.style.transform = `translate(${(vw - H.W * hs) / 2}px,0) scale(${hs})`; HDR.el.style.height = (107 * hs) + 'px'; }
      r.style.top = (107 * hs) + 'px'; r.style.bottom = '0';
    }
    placeTrigger(); placeChat();
  }

  function sync() {
    const k = screenForPage();
    if (k !== cur) {
      if (chatPop && !chatPop.hidden) toggleChat(false);
      if (cur && built[cur]) built[cur].sec.classList.remove('on');
      cur = k; if (k === 'home' || k === 'chat') pollChat();
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
    addEventListener('shinobi-chest', () => { refresh(); welcomeBack(); });
    // Defeats trigger verified Chest syncs in gameplay-options/options.js (KillReport).
    addEventListener('resize', fit);
    motionPreference.addEventListener('change', event => { RM = event.matches || !!window.DisplaySettings?.v.reduceMotion; refresh(); });
    addEventListener('sb-display-change', () => { RM = motionPreference.matches || !!window.DisplaySettings?.v.reduceMotion; refresh(); });
    document.addEventListener('visibilitychange', () => { syncEffects(); if (!document.hidden) sync(); });
    const nt = document.getElementById('toast'); if (nt) new MutationObserver(() => { if (cur && nt.textContent.trim()) toast(nt.textContent.trim()); }).observe(nt, { childList: true, characterData: true, subtree: true });
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('click', e => { const g = e.target.closest('#sbwLayer .gt'); if (!g) return; if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body); dlg.innerHTML = `<h2>${esc(g.dataset.t)}</h2><img class="sbw-lb" src="${g.dataset.src}" alt="${esc(g.dataset.t)}"><div class="sbw-acts"><button type="button" class="sbw-btn">Close</button></div>`; $('button', dlg).onclick = () => dlg.close(); dlg.showModal(); });
    setInterval(() => { sync(); placeTrigger(); }, 700);
    let last = 0; const loop = now => { if (!document.hidden) { if (cur && MIRROR[cur] && built[cur]) { try { MIRROR[cur](built[cur]); } catch {} } if (cur && now - last > 120) { last = now; const b = built[cur]; if (b && PAINT[cur]) { try { PAINT[cur](b, now); } catch (e) { if (!loop.warned) { loop.warned = true; console.error('[website-design]', e); } } } } } requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    sync();
    window.WebsiteDesign = { ready: true, screens: Object.keys(D.screens), current: () => cur, refresh: sync, open: goScreen };
  }
  init().catch(e => console.error('Website designs could not be applied:', e));
})();
