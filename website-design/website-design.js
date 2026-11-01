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
  const SHOWN = { '5': 'home', '3': 'codex', '2': 'summon', '6': 'fusion', '4:0': 'dojo' };
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
    dlg.onclick = null; dlg.innerHTML = `<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="sbw-acts"><button type="button" class="sbw-btn">Close</button></div>`;
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
    const input = $('input', dlg); input.value = (gs() && gs().nick) || '';
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
    const nickName = (gs() && gs().nick) || 'Shinobi', mine = owned(), dep = deployed();
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

  /* ---------- Summon (website screen ↔ Combat.quantity / Combat.summonBatch) ---------- */
  const QTY = [1, 5, 10, 15];
  INIT.summon = b => {
    b.tabs = [['q1', 1], ['q5', 5], ['q10', 10], ['q15', 15]].map(([id, n]) => { const h = b.s.hs.find(x => x.id === id), r = h.r; const e = place(mk('div', 'sbw-smtab', b.st, '×' + n), r[0], r[1], r[2] - r[0], r[3] - r[1]); e.dataset.n = n; return e; });
  };
  function summonQty() { const sel = nativeEl('#p2', e => /Combat\.quantity\(\d+\)/.test(e.getAttribute('onclick') || '') && e.classList.contains('selected')); const m = sel && /\((\d+)\)/.exec(sel.getAttribute('onclick')); return m ? +m[1] : 1; }
  PAINT.summon = b => {
    const n = summonQty();
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
    gallery: () => go(1), history: () => openChest(),
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
    setText(b.lineTop, `Combine the weakest ${RNAME[rank]} heroes · 3 → 1 each · Reserve heroes only · ${success}`);
    setText(b.lineFoot, nativeText('#p6', /Up to \d+ attempts[^\n]*/) || 'Failed attempts consume heroes and charge the fee');
    setText(b.note, `The resulting hero will be a ${RNAME[rank + 1]} with improved base stats and a guaranteed rank jutsu.`);
    setText(b.rarity, RNAME[rank + 1]); b.rarity.style.color = RCOL[rank + 1];
    setText(b.jutsu, (nativeText('#p6', /JUTSU\s*\n\s*\d+/).match(/\d+$/) || ['—'])[0]);
    for (let i = 0; i < 4; i++) for (const id of ['r' + (i + 1), 'et' + (i + 1)]) { const e = $(`.hs[data-sbwid="${id}"]`, b.st); if (e) e.classList.toggle('on2', i === rank); }
    const sig = rank + '|' + rows.map(r => r.id + (r.checked ? '*' : '') + (r.disabled ? '!' : '')).join('|');
    if (sig !== b.sig) {
      b.sig = sig;
      b.list.innerHTML = rows.length ? rows.map((r, i) => `<button type="button" class="sbw-frow${r.checked ? ' on' : ''}" data-i="${i}" ${r.disabled ? 'disabled' : ''} aria-pressed="${r.checked}" aria-label="Select ${esc(r.name)}"><i>${r.checked ? '✓' : ''}</i><canvas width="72" height="78" data-id="${r.id}"></canvas><span class="sbw-fname"><b>${esc(r.name)}</b><small style="color:${RCOL[rank]}">${esc(r.info)}</small></span>${r.stats.map(v => `<em>${esc(v)}</em>`).join('')}<span class="sbw-fj">${esc(r.jutsu)}</span></button>`).join('')
        : `<p class="sbw-fempty">No ${RNAME[rank]} heroes in Reserve. Move heroes to Reserve in Heroes, or summon more Shinobi.</p>`;
      $$('.sbw-frow', b.list).forEach(btn => btn.onclick = () => { const r = fusionRows()[+btn.dataset.i]; if (r && !r.input.disabled) { r.input.click(); b.sig = ''; refresh(); } });
    }
    const hero = id => (gs() && gs().h.find(h => h.id === id)) || null, draw = (cv, h, sc) => { const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); if (h && window.PlayerModels) { try { PlayerModels.drawPortrait(g, h, cv.width / 2, cv.height - 2, sc, now); } catch {} } };
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
  function senseiHired() { return !!(gs() && gs().butler); }
  INIT.dojo = b => {
    b.chips = DY.map(y => place(mk('div', 'sbw-dchip', b.st), 1552, y - 11, 64, 22));
    const cover = (x, y, w, h, bg, fs, color, cls = '') => { const e = place(mk('span', 'sbw-cover ' + cls, b.st), x, y, w, h); e.style.background = bg; e.style.fontSize = fs + 'px'; e.dataset.fs = fs; e.style.color = color; return e; };
    b.rp = [748, 828, 908, 986, 1066].map((x, i) => place(mk('div', 'sbw-drp', b.st, (50 + i * 10) + '%'), x, 716, 70, 28));
    b.hired = cover(628, 836, 92, 32, '#171822', 24, '#9aa6c8');
    b.tog = place(mk('div', 'sbw-dtog', b.st), 1080, 808, 50, 18);
    b.toff = place(mk('div', 'sbw-dtl', b.st), 1022, 838, 120, 30);
    // current-tier facts on the Dojo cards and Sensei status (the artwork shows example values)
    b.cards = [[70, 396, 46, 15, 65, 414, 168, 22, 102, 451, 42, 16, 354, 451, 28, 16, '#060606', '#050917', '#0c101e', '#0d1122', 13, 21],
      [900, 302, 46, 14, 892, 322, 166, 21, 927, 366, 42, 15, 1131, 366, 36, 15, '#030507', '#000916', '#0f1326', '#0f1326', 12, 20]].map(c => ({
      tier: cover(c[0], c[1], c[2], c[3], c[16], c[20], '#ffe08a'), name: cover(c[4], c[5], c[6], c[7], c[17], c[21], '#ffd84a', 'sbw-left'),
      rate: cover(c[8], c[9], c[10], c[11], c[18], c[20] + 2, '#ffd84a', 'sbw-left'), lvl: cover(c[12], c[13], c[14], c[15], c[19], c[20] + 2, '#ffd84a', 'sbw-left') }));
    b.cards.forEach(c => { c.name.style.fontWeight = '800'; c.name.style.letterSpacing = '.5px'; });
    b.rot = cover(509, 507, 42, 15, '#031b25', 15, '#3ee07a', 'sbw-left');
    b.inService = cover(930, 765, 198, 13, '#011827', 11, '#ffffff'); b.inService.style.justifyContent = 'flex-end';
    b.hiredN = cover(1104, 788, 24, 12, '#011729', 11, '#ffffff'); b.hiredN.style.justifyContent = 'flex-end';
    b.session = cover(1560, 672, 74, 12, '#041420', 11, '#ffffff'); b.session.style.justifyContent = 'flex-end';
    b.last = cover(1330, 702, 74, 12, '#011729', 11, '#9aa6c8'); b.last.style.justifyContent = 'flex-end';
    b.rotated = cover(1580, 702, 54, 12, '#011825', 11, '#9aa6c8'); b.rotated.style.justifyContent = 'flex-end';
    b.status = cover(1270, 731, 134, 13, '#011729', 11, '#9aa6c8'); b.status.style.justifyContent = 'flex-end';
  };
  PAINT.dojo = b => {
    const tier = Number((gs() && gs().dojo) || 0), next = tier + 1, prices = (window.GameBalance && GameBalance.dojoPrices) || [];
    if (b.live.upcost) { b.live.upcost.hidden = false; setText(b.live.upcost, next <= 6 ? `UPGRADE  -  ${fmt(prices[next])} Ryo` : 'MAX TIER REACHED'); }
    b.chips.forEach((c, i) => { const st = i < tier ? ['Owned', 'own'] : i === tier ? ['Active', 'act'] : i === next ? ['Next', 'nxt'] : ['Locked', 'lck']; c.textContent = st[0]; c.className = 'sbw-dchip ' + st[1]; });
    const hired = senseiHired(), v2 = (gs() && gs().v2) || {}, pct = Number(v2.senseiReturnPercent || 90), on = v2.butlerEnabled !== false;
    b.rp.forEach((e, i) => e.classList.toggle('on', 50 + i * 10 === pct));
    setText(b.hired, hired ? 'HIRED' : 'NOT HIRED'); b.hired.style.color = hired ? '#ffffff' : '#9aa6c8';
    b.tog.textContent = hired && on ? 'ON' : 'OFF'; b.tog.classList.toggle('on', hired && on);
    b.toff.textContent = !hired ? 'HIRE SENSEI' : on ? 'TURN OFF' : 'TURN ON';
    const name = DOJO_NAMES[tier] || DOJO_NAMES[0], rate = ((window.GameBalance && GameBalance.dojoRecovery) || [])[tier];
    b.cards.forEach(c => { setText(c.tier, 'TIER ' + ROMAN[tier].replace('–', '0')); setText(c.name, name.toUpperCase()); setText(c.rate, (rate || 1) + '/min'); setText(c.lvl, tier + '/6'); });
    setText(b.rot, hired ? (on ? 'ON' : 'OFF') : 'NOT HIRED'); b.rot.style.color = hired && on ? '#3ee07a' : '#9aa6c8';
    setText(b.inService, `${name} (Tier ${ROMAN[tier].replace('–', '0')})`); setText(b.hiredN, hired ? '1' : '0');
    setText(b.session, document.hidden ? 'Offline' : 'Online now'); setText(b.last, '—'); setText(b.rotated, '—');
    setText(b.status, !hired ? 'Sensei not hired' : on ? 'Ready when offline' : 'Rotation off');
    const up = $('.hs[data-sbwid="upg"]', b.st); if (up) up.classList.toggle('dim', next > 6);
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
    focus: a => { if (a === 'sen' && !senseiHired()) return hireSensei(); if (window.DojoServices) DojoServices.open(a === 'sen' ? 'sensei' : 'dojo'); toast(a === 'sen' ? 'Sensei is hired – adjust the return threshold and auto rotation below.' : 'Choose a tier on the right to see its recovery rate.'); },
    tier: a => { const i = +a, tier = Number(gs().dojo || 0), prices = GameBalance.dojoPrices, rec = GameBalance.dojoRecovery; if (window.DojoServices) { DojoServices.open('dojo'); DojoServices.selectTier(i); } notice(DOJO_NAMES[i], `Recovery ${rec[i]} chakra per minute for every resting hero. Status: ${i < tier ? 'Owned' : i === tier ? 'Active' : i === tier + 1 ? 'Next – use Upgrade' : 'Locked'}. Price: ${prices[i] ? fmt(prices[i]) + ' Ryo' : 'Free'}.`); },
    upgrade: () => { const tier = Number(gs().dojo || 0); if (tier >= 6) return toast('Your dojo is at the highest tier.'); DojoServices.open('dojo'); DojoServices.selectTier(tier + 1); if (!pressOnclick('#p4', 'DojoServices.upgrade()')) DojoServices.upgrade(); },
    hire: () => { if (!senseiHired()) return hireSensei(); senseiPane(); if (!pressOnclick('#p4', 'V2.toggleButler()') && typeof V2 !== 'undefined') V2.toggleButler(); },
    ret: a => { if (!senseiHired()) return hireSensei(); const pct = 50 + 10 * +a; senseiPane(); setTimeout(() => { const sel = document.getElementById('senseiReturnPercent'); if (!sel || sel.disabled) return toast('Sensei settings are saving – try again in a moment.'); if (+sel.value === pct) return toast('Sensei already returns heroes at ' + pct + '% chakra.'); sel.value = String(pct); sel.dispatchEvent(new Event('change', { bubbles: true })); }, 80); },
    skin: () => toast('Sensei skins are not available yet.')
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
    let mode = 0; try { mode = vm || 0; } catch {}
    return SHOWN[page === 4 ? '4:' + mode : String(page)] || null;
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
    const nt = document.getElementById('toast'); if (nt) new MutationObserver(() => { if (cur && nt.textContent.trim()) toast(nt.textContent.trim()); }).observe(nt, { childList: true, characterData: true, subtree: true });
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('click', e => { const g = e.target.closest('#sbwLayer .gt'); if (!g) return; if (!dlg) dlg = mk('dialog', 'sbw-dialog', document.body); dlg.innerHTML = `<h2>${esc(g.dataset.t)}</h2><img class="sbw-lb" src="${g.dataset.src}" alt="${esc(g.dataset.t)}"><div class="sbw-acts"><button type="button" class="sbw-btn">Close</button></div>`; $('button', dlg).onclick = () => dlg.close(); dlg.showModal(); });
    setInterval(() => { sync(); placeTrigger(); }, 700);
    let last = 0; const loop = now => { if (cur && now - last > 120) { last = now; const b = built[cur]; if (b && PAINT[cur]) { try { PAINT[cur](b, now); } catch (e) { if (!loop.warned) { loop.warned = true; console.error('[website-design]', e); } } } } requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    sync();
    window.WebsiteDesign = { ready: true, screens: Object.keys(D.screens), current: () => cur, refresh: sync };
  }
  init().catch(e => console.error('Website designs could not be applied:', e));
})();
