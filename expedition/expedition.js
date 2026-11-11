/* Expedition Hall (owner spec 2026-11-11). Presentation only: every number comes from the server.
 *  - window.Expedition.paintPanel(el)   Home panel over the printed DAILY MISSIONS art (website-design.js PAINT.home)
 *  - window.Expedition.open(tab, id)    full Expedition Hall (tabs Combat Duty / On Expedition / Completed)
 *  - window.Expedition.detailHtml(h)    rows in the Heroes Collection detail view
 *  - window.Expedition.away(h)          a hero on an Expedition (deploy, Sensei swap and Work All skip it; the server enforces it)
 * Data: the read-only `expedition` action (polled every 60 s, every 20 s while the Hall is open) and the chakra snapshot the
 * Adventure sync already returns (duty, expeditionEnds). Remaining times are computed from server timestamps; no timers per
 * hero. Paid acceleration shows the server quote and charges only through RyoPayments.purchase after an explicit confirm. */
(() => {
  'use strict';
  const POLL_IDLE = 60000, POLL_OPEN = 20000, POLL_OFF = 10 * 60000, TOAST_WINDOW = 10 * 60000, DAY = 86400000;
  const RANK = ['Genin', 'Chunin', 'Jonin', 'Elite', 'Legend', 'Mythic'], RCOL = ['#a8b3c2', '#5fd38d', '#5aa9ff', '#c58cff', '#ffb547', '#ff5a6a'];
  let view = null, fetchedAt = 0, offset = 0, busy = false, owner = null, hall = null, tab = 'duty', focusId = null, confirmBox = null;
  const loadedAt = Date.now();
  const P = () => window.RyoPayments, state = () => P()?.state;
  const now = () => Date.now() + offset;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtRyo = n => Number(n || 0).toLocaleString('en-US');
  function dur(ms) {
    ms = Math.max(0, Math.ceil(ms / 60000) * 60000);
    const h = Math.floor(ms / 3600000), m = Math.round((ms % 3600000) / 60000);
    return h && m ? h + 'h ' + m + 'm' : h ? h + 'h' : m + 'm';
  }
  const hours = ms => (Math.floor(ms / 360000) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'h';
  const toast = text => { try { window.toast ? window.toast(text) : globalThis.toast?.(text); } catch { /* the game toast is optional */ } };
  const gameHeroes = () => { try { return typeof S === 'object' && S && Array.isArray(S.h) ? S.h : []; } catch { return []; } };

  /* ---------------- data ---------------- */
  function reset() { view = null; fetchedAt = 0; owner = state()?.account || null; }
  async function refresh(force = false) {
    const s = state(), api = P()?.expedition;
    if (owner !== (s?.account || null)) reset();
    if (!s?.authenticated || typeof api !== 'function' || busy) return;
    if (!force && Date.now() - fetchedAt < (hall ? POLL_OPEN : view && !view.enabled ? POLL_OFF : POLL_IDLE)) return;   // off: every 10 minutes
    busy = true;
    try {
      const data = await api();
      if (data?.expedition && state()?.account === owner) { view = data.expedition; offset = view.serverTime - Date.now(); notice(); }
    } catch { /* keep the last view; the next poll retries */ } finally { fetchedAt = Date.now(); busy = false; }
  }
  const enabled = () => !!(view && view.enabled && state()?.authenticated);
  /** Chakra snapshot from the latest Adventure sync (fresher than the view while the hero fights). */
  function live(id) {
    const snap = window.AdventureChest?.snapshot;
    if (!snap?.chest?.chakra || (snap.owner && snap.owner !== owner)) return null;
    const c = snap.chest.chakra[id]; return c && Number(c.at) > Number(view?.serverTime || 0) ? c : null;
  }
  /** One hero's current Expedition status, from the view brought forward with the live snapshot and the server clock. */
  function info(id) {
    const v = view?.heroes?.find(h => h.tokenId === id); if (!v) return null;
    const t = now(), l = live(id);
    let ends = v.status === 'expedition' ? v.ends : null, duty = v.dutyMs;
    if (l) { ends = Number.isFinite(l.expeditionEnds) ? l.expeditionEnds : ends && ends <= t ? ends : null; if (Number.isFinite(l.duty)) duty = l.duty; else if (!ends) duty = 0; }
    const away = !!ends && t < ends, back = !away && (!!ends || v.status === 'returned') && !(duty > 0);
    const status = away ? 'expedition' : back ? 'returned' : 'duty';
    const durationMs = v.status === 'expedition' && v.ends === ends ? v.durationMs : (view.founder ? v.founderMs : v.regularMs);
    const completed = !away && ends ? ends : v.last ? Number(v.last.completed) : null;
    return { ...v, status, ends: away ? ends : null, dutyMs: away ? view.capMs : Math.min(view.capMs, duty || 0), remainingMs: away ? ends - t : 0,
      durationMs, completed, recent: !away && !!completed && t - completed < DAY, quote: away && v.status === 'expedition' && v.ends === ends ? v.quote : null };
  }
  const all = () => (view?.heroes || []).map(h => info(h.tokenId)).filter(Boolean);
  function away(h) { const id = h && (h.tokenId || h); return !!(id && enabled() && info(id)?.status === 'expedition'); }

  /* ---------------- notifications ---------------- */
  const seenKey = () => 'shinobi-expedition-seen-v1:' + owner;
  const seen = () => { try { return JSON.parse(localStorage.getItem(seenKey()) || '{}') || {}; } catch { return {}; } };
  const events = () => all().flatMap(h => h.status === 'expedition' ? [{ id: h.tokenId, key: 'go:' + (h.ends - h.durationMs), at: h.ends - h.durationMs, text: h.name + ' left on an Expedition (' + dur(h.remainingMs) + ').' }]
    : h.recent && h.completed ? [{ id: h.tokenId, key: 'back:' + h.completed, at: h.completed, text: h.name + ' is back from the Expedition and ready for battle.' }] : []).filter(e => now() - e.at < DAY);
  function unseen() { const s = seen(); return events().filter(e => s[e.id] !== e.key); }
  const toasted = new Set();
  function notice() {
    if (!enabled()) return;
    for (const e of unseen()) if (!toasted.has(e.key) && now() - e.at < TOAST_WINDOW && e.at > loadedAt - TOAST_WINDOW) { toasted.add(e.key); toast(e.text); }
  }
  function markSeen() { const s = seen(); for (const e of events()) s[e.id] = e.key; try { localStorage.setItem(seenKey(), JSON.stringify(s)); } catch { /* private mode */ } }

  /* ---------------- shared markup ---------------- */
  const bar = (pct, cls = '') => `<div class="sbw-exp-bar ${cls}"><i style="width:${Math.max(0, Math.min(100, Math.round(pct)))}%"></i></div>`;
  function line(h) {
    if (h.status === 'expedition') return { label: 'On Expedition', value: dur(h.remainingMs) + ' left', pct: 100 * (1 - h.remainingMs / h.durationMs), cls: 'away' };
    if (h.status === 'returned') return { label: 'Expedition complete', value: 'Ready for battle', pct: 100, cls: 'back' };
    return { label: 'Combat Duty', value: hours(h.dutyMs) + ' / ' + hours(view.capMs), pct: 100 * h.dutyMs / view.capMs, cls: h.dutyMs >= view.capMs * .8 ? 'near' : '' };
  }
  function portrait(canvas, id) {
    const h = gameHeroes().find(x => x.tokenId === id && (!x.tokenOwner || x.tokenOwner === owner));
    if (!h || !canvas) return;
    try { window.WebsiteDesign?.drawHero?.(canvas, h, 2.2, performance.now()); } catch { /* portraits are decorative */ }
  }

  /* ---------------- Home panel ---------------- */
  function panelHeroes() {
    const list = all();
    const out = [...list.filter(h => h.status === 'expedition').sort((a, b) => a.remainingMs - b.remainingMs),
      ...list.filter(h => h.status === 'duty' && h.dutyMs > 0).sort((a, b) => b.dutyMs - a.dutyMs),
      ...list.filter(h => h.status === 'returned' && h.recent).sort((a, b) => b.completed - a.completed)];
    return out.slice(0, 3);
  }
  function paintPanel(el) {
    refresh();
    if (!enabled()) { if (!el.hidden) el.hidden = true; return; }
    const rows = panelHeroes(), dot = unseen().length > 0;
    const sig = [dot, ...rows.map(h => [h.tokenId, h.status, Math.floor(h.remainingMs / 60000), Math.floor(h.dutyMs / 360000)].join(':'))].join('|');
    if (el.hidden) el.hidden = false;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML = `<div class="sbw-exp-head"><b>EXPEDITION HALL</b>${dot ? '<i class="sbw-exp-dot" title="New Expedition news"></i>' : ''}<button type="button" class="sbw-exp-all" data-exp-open="">View All</button></div>
      <div class="sbw-exp-rows">${rows.length ? rows.map(h => { const l = line(h); return `<div class="sbw-exp-row ${l.cls}" style="--rc:${RCOL[h.rank]}">
        <div class="sbw-exp-port"><canvas width="96" height="96" data-exp-port="${esc(h.tokenId)}"></canvas></div>
        <div class="sbw-exp-txt"><strong>${esc((h.name || '').split(' ')[0])}<em>${esc(l.label)}</em></strong><span>${esc(l.value)}</span>${bar(l.pct, l.cls)}</div>
        <button type="button" class="sbw-exp-go" data-exp-open="${h.status === 'expedition' ? 'away' : h.status === 'returned' ? 'done' : 'duty'}" data-exp-hero="${esc(h.tokenId)}">${h.status === 'duty' ? 'Details' : 'View'}</button></div>`; }).join('')
        : '<p class="sbw-exp-empty">Heroes earn Combat Duty while they fight. After ' + hours(view.capMs) + ' of combat a hero leaves on a free Expedition to rest.</p>'}</div>`;
    el.querySelectorAll('canvas[data-exp-port]').forEach(c => portrait(c, c.dataset.expPort));
  }

  /* ---------------- Heroes Collection detail ---------------- */
  function sig(h) { if (!h?.tokenId || !enabled()) return ''; const i = info(h.tokenId); return i ? [i.status, Math.floor(i.remainingMs / 60000), Math.floor(i.dutyMs / 360000)].join(':') : ''; }
  function detailHtml(h) {
    if (!h?.tokenId || !enabled()) return '';
    const i = info(h.tokenId); if (!i) return '';
    const l = line(i), founder = view.founder ? `<small class="sbw-exp-founder">Founder: Expeditions take 50% less time (${dur(i.founderMs)} instead of ${dur(i.regularMs)}).</small>` : '';
    const extra = i.status === 'expedition' ? `<div class="sbw-exp-kv"><span>Expedition</span><b>${dur(i.durationMs)} · ${dur(i.remainingMs)} left</b></div>${i.quote ? `<div class="sbw-exp-kv"><span>Expedite now</span><b>${fmtRyo(i.quote.total)} Ryo (optional)</b></div>` : ''}`
      : `<div class="sbw-exp-kv"><span>Expedition length</span><b>${dur(view.founder ? i.founderMs : i.regularMs)}</b></div>`;
    return `<div class="sbw-exp-detail ${l.cls}"><div class="sbw-exp-kv"><span>${esc(l.label.toUpperCase())}</span><b>${esc(l.value)}</b></div>${bar(l.pct, l.cls)}${extra}${founder}
      <button type="button" class="sbw-exp-link" data-exp-open="${i.status === 'expedition' ? 'away' : i.status === 'returned' ? 'done' : 'duty'}" data-exp-hero="${esc(h.tokenId)}">Expedition Hall</button></div>`;
  }
  function cardMeta(h) { const i = h?.tokenId && info(h.tokenId); return i && i.status === 'expedition' ? 'On Expedition · ' + dur(i.remainingMs) + ' left' : ''; }

  /* ---------------- full Expedition Hall ---------------- */
  const TABS = [['duty', 'Combat Duty'], ['away', 'On Expedition'], ['done', 'Completed']];
  function open(which, heroId) {
    tab = TABS.some(t => t[0] === which) ? which : tab; focusId = heroId || null;
    if (!hall) {
      hall = document.createElement('div'); hall.className = 'sbw-exp-hall'; hall.setAttribute('role', 'dialog'); hall.setAttribute('aria-modal', 'true'); hall.setAttribute('aria-label', 'Expedition Hall');
      hall.addEventListener('click', onHallClick); document.addEventListener('keydown', onKey);
      document.body.appendChild(hall);
    }
    markSeen(); refresh(true).then(() => render()); render();
  }
  function close() { if (!hall) return; document.removeEventListener('keydown', onKey); hall.remove(); hall = null; confirmBox = null; }
  function onKey(e) { if (e.key === 'Escape') { if (confirmBox) { confirmBox = null; render(); } else close(); } }
  function heroCard(h) {
    const l = line(h), founder = h.status === 'expedition' && h.founder ? '<em class="sbw-exp-tag">Founder −50%</em>' : '';
    const act = h.status === 'expedition' && h.quote && view.acceleration?.available
      ? `<button type="button" class="sbw-exp-btn gold" data-exp-expedite="${esc(h.tokenId)}">Expedite · ${fmtRyo(h.quote.total)} Ryo</button>` : '';
    const meta = h.status === 'expedition' ? `Expedition ${dur(h.durationMs)} · returns in ${dur(h.remainingMs)}`
      : h.status === 'returned' ? 'Ready for battle' + (h.battleReady ? '' : ' (move it to Battle-ready to deploy)')
      : `${dur(view.capMs - h.dutyMs)} of combat until its next Expedition (${dur(view.founder ? h.founderMs : h.regularMs)})`;
    return `<article class="sbw-exp-card ${l.cls}${focusId === h.tokenId ? ' focus' : ''}" style="--rc:${RCOL[h.rank]}">
      <div class="sbw-exp-port"><canvas width="120" height="120" data-exp-port="${esc(h.tokenId)}"></canvas></div>
      <div class="sbw-exp-info"><strong>${esc(h.name)}</strong><span class="sbw-exp-rank">${esc(RANK[h.rank] || '')}</span>${founder}
        <div class="sbw-exp-kv"><span>${esc(l.label)}</span><b>${esc(l.value)}</b></div>${bar(l.pct, l.cls)}
        <small>${esc(meta)}</small><small>Chakra ${fmtRyo(h.chakra)} / ${fmtRyo(Math.floor(h.maxChakra))}</small></div>${act}</article>`;
  }
  let hallSig = '';
  function render(force = true) {
    if (!hall) return;
    const sigNow = [enabled(), tab, !!confirmBox, ...all().map(h => [h.tokenId, h.status, Math.floor(h.remainingMs / 60000), Math.floor(h.dutyMs / 360000), h.quote?.total].join(':'))].join('|');
    if (!force && sigNow === hallSig) return;
    hallSig = sigNow;
    const scroll = hall.querySelector('.sbw-exp-list')?.scrollTop || 0;
    if (!enabled()) {
      hall.innerHTML = `<div class="sbw-exp-sheet"><header><h2>EXPEDITION HALL</h2><button type="button" class="sbw-exp-x" data-exp-close aria-label="Close">✕</button></header>
        <p class="sbw-exp-empty">${state()?.authenticated ? (view ? 'Expedition Mode is not open yet.' : 'Loading…') : 'Sign in to see your heroes’ Combat Duty and Expeditions.'}</p></div>`;
      return;
    }
    const list = all(), groups = { duty: list.filter(h => h.status === 'duty').sort((a, b) => b.dutyMs - a.dutyMs), away: list.filter(h => h.status === 'expedition').sort((a, b) => a.remainingMs - b.remainingMs), done: list.filter(h => h.status === 'returned' || h.recent).sort((a, b) => b.completed - a.completed) };
    const shown = groups[tab] || [];
    const rules = `Every hero can fight for ${hours(view.capMs)} of active combat (attacks only; rest and Chakra recovery never count). Then it leaves on a free Expedition and returns on its own. Its Chakra keeps recovering as on the bench and is never refilled instantly.${view.founder ? ' Founder benefit: Expeditions take 50% less time.' : ''}`;
    hall.innerHTML = `<div class="sbw-exp-sheet"><header><h2>EXPEDITION HALL</h2><button type="button" class="sbw-exp-x" data-exp-close aria-label="Close">✕</button></header>
      <p class="sbw-exp-rules">${esc(rules)}</p>
      <nav class="sbw-exp-tabs" role="tablist">${TABS.map(([k, label]) => `<button type="button" role="tab" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}" data-exp-tab="${k}">${label}<i>${groups[k].length}</i></button>`).join('')}</nav>
      <div class="sbw-exp-list">${shown.length ? shown.map(heroCard).join('') : `<p class="sbw-exp-empty">${tab === 'away' ? 'No hero is on an Expedition.' : tab === 'done' ? 'No Expedition completed in the last 24 hours.' : 'No heroes yet.'}</p>`}</div>
      <footer><span>${view.durations.map(d => esc(d.name) + ' ' + dur(view.founder ? d.founderMs : d.regularMs)).join(' · ')}</span></footer>
      ${confirmBox ? confirmHtml() : ''}</div>`;
    hall.querySelectorAll('canvas[data-exp-port]').forEach(c => portrait(c, c.dataset.expPort));
    const listEl = hall.querySelector('.sbw-exp-list'); if (listEl) listEl.scrollTop = scroll;
    const f = hall.querySelector('.sbw-exp-card.focus'); if (f && focusId) { f.scrollIntoView({ block: 'nearest' }); focusId = null; }
  }
  function confirmHtml() {
    const c = confirmBox, r = view.acceleration.policy.ratesBps, pct = k => r[k] / 100 + '%';
    if (c.error) return `<div class="sbw-exp-confirm"><div><h3>Expedite</h3><p>${esc(c.error)}</p><div class="sbw-exp-actions"><button type="button" class="sbw-exp-btn" data-exp-cancel>Close</button></div></div></div>`;
    if (!c.q) return `<div class="sbw-exp-confirm"><div><h3>Expedite</h3><p>Getting the server price…</p></div></div>`;
    return `<div class="sbw-exp-confirm"><div><h3>Expedite ${esc(c.name)}?</h3>
      <p>Bring this hero back now instead of in ${esc(dur(c.q.remainingMs))}. This is optional: the Expedition is free and completes on its own.</p>
      <p class="sbw-exp-price">${fmtRyo(c.q.total)} Ryo <small>from your deposited game balance</small></p>
      <p class="sbw-exp-split">Payment split: ${pct('activeRewards')} Active Reward Pool · ${pct('lockedTreasury')} Locked Treasury · ${pct('communityRewards')} Community Rewards · ${pct('economicReserve')} Economic Reserve.</p>
      <p class="sbw-exp-note">The hero returns once the payment is finalized on-chain (keep the game open until then). Its Chakra is not refilled.</p>
      <div class="sbw-exp-actions"><button type="button" class="sbw-exp-btn" data-exp-cancel ${c.paying ? 'disabled' : ''}>Cancel</button><button type="button" class="sbw-exp-btn gold" data-exp-pay ${c.paying ? 'disabled' : ''}>${c.paying ? 'Paying…' : 'Pay ' + fmtRyo(c.q.total) + ' Ryo'}</button></div></div></div>`;
  }
  async function expedite(id) {
    const h = info(id); if (!h?.quote) return;
    confirmBox = { id, name: h.name, q: null }; render();
    try { const q = await P().quote('expedition', { heroId: id, expeditionStart: h.quote.expeditionStart }); if (confirmBox?.id === id) { confirmBox.q = q; render(); } }
    catch (e) { if (confirmBox?.id === id) { confirmBox.error = e.message || 'The price could not be loaded.'; render(); } }
  }
  async function pay() {
    const c = confirmBox; if (!c?.q || c.paying) return;
    c.paying = true; render();
    try {
      const data = await P().purchase(c.q), status = data?.purchase?.status;
      confirmBox = null; toast(status === 'confirmed' ? c.name + ' is back from the Expedition.' : status === 'refunded' ? 'The payment did not go through and was returned to your balance.' : 'Payment sent. ' + c.name + ' returns once it is finalized.');
    } catch (e) { if (confirmBox === c) { c.paying = false; c.error = e.message || 'The payment could not be sent.'; } }
    await refresh(true); render();
  }
  function onHallClick(e) {
    const t = e.target.closest('button'); if (!t) { if (e.target === hall) close(); return; }
    if (t.hasAttribute('data-exp-close')) return close();
    if (t.dataset.expTab) { tab = t.dataset.expTab; return render(); }
    if (t.dataset.expExpedite) return expedite(t.dataset.expExpedite);
    if (t.hasAttribute('data-exp-cancel')) { confirmBox = null; return render(); }
    if (t.hasAttribute('data-exp-pay')) return pay();
  }
  // Home panel and Heroes detail buttons (their markup is rebuilt by the menu layer, so listen once on the document).
  document.addEventListener('click', e => { const t = e.target.closest?.('[data-exp-open]'); if (!t || (hall && hall.contains(t))) return; e.preventDefault(); e.stopPropagation(); open(t.dataset.expOpen || 'duty', t.dataset.expHero || null); }, true);
  setInterval(() => { if (hall && !confirmBox) render(false); }, 1000);
  setInterval(() => refresh(), 5000);
  addEventListener('shinobi-ryo-ledger', () => { if (owner !== (state()?.account || null)) reset(); refresh(); });
  window.Expedition = Object.freeze({ paintPanel, open, close, away, info, detailHtml, cardMeta, sig, refresh: () => refresh(true), get view() { return view; } });
})();
