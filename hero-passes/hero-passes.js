/* Promotional Standard Hero Passes, client (apply-hero-passes.cjs). Owner request 2026-11-11. The server decides everything
 * (who is eligible, the quantity of each reward, claiming once, using passes); this file only shows the Reward Center behind the
 * main-menu CLAIM button, the account-bound Hero Pass balance and history, and reveals heroes recruited with passes.
 * Nothing shows unless the server reports the CLAIM switch on (`ui`). Text from the server is always set with textContent. */
(function () {
  'use strict';
  let state = null, dialog = null, view = 'rewards', busy = false, message = '', okMessage = false, lastClaim = null, account = null;
  const claimIds = new Map(), useIds = new Map();
  const fmt = n => Math.floor(Number(n) || 0).toLocaleString('en-US');
  const id = p => p + '-' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 32);
  const authed = () => !!window.RyoPayments?.state?.authenticated;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const button = (text, onClick, cls = '') => { const b = el('button', 'hp-btn ' + cls, text); b.type = 'button'; b.onclick = onClick; b.disabled = busy; return b; };
  const when = t => t ? new Date(t).toLocaleString() : '—';

  async function refresh() {
    if (!authed() || typeof window.RyoPayments?.heroPasses !== 'function') { state = null; changed(); return state; }
    try { const data = await RyoPayments.heroPasses('pass-state'); state = data.heroPasses || { ui: false }; }
    catch { /* keep the last state; the server stays authoritative */ }
    changed(); return state;
  }
  function changed() { if (dialog?.open) render(); try { window.WebsiteDesign?.refresh?.(); } catch { /* design not ready */ } dispatchEvent(new Event('shinobi-hero-passes')); }

  /* ---------- Reward Center ---------- */
  function style() {
    if (document.getElementById('heroPassStyle')) return;
    const s = document.createElement('style'); s.id = 'heroPassStyle';
    s.textContent = `dialog.hp-center{width:min(520px,calc(100vw - 24px));max-height:calc(100vh - 32px);box-sizing:border-box;padding:0;border:2px solid #ffcf63;border-radius:14px;background:linear-gradient(180deg,#1d1305,#0b0816 60%);color:#fff3cf;font:600 15px/1.4 Rajdhani,sans-serif;box-shadow:0 0 28px #ffcf6355;overflow:auto}
dialog.hp-center::backdrop{background:#000b}
.hp-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #6b4a12}.hp-head h2{flex:1;margin:0;font:900 20px Rajdhani,sans-serif;letter-spacing:.08em;color:#ffcf63}
.hp-tabs{display:flex;gap:6px;padding:10px 16px 0}.hp-tabs button{flex:1}
.hp-body{padding:14px 16px 16px}
.hp-card{margin:0 0 12px;padding:14px;border:1px solid #c79a3a;border-radius:10px;background:#140d1f;text-align:center}
.hp-card small{display:block;color:#d7b4ff;letter-spacing:.08em}.hp-card h3{margin:2px 0 6px;font:900 18px Rajdhani,sans-serif;letter-spacing:.06em;color:#ffcf63}
.hp-qty{display:block;margin:6px 0;font:900 26px Rajdhani,sans-serif;color:#fff}.hp-meta{margin:0 0 10px;color:#e8dcc0}.hp-meta b{color:#7dff9b}
.hp-btn{min-height:38px;padding:0 14px;border:1px solid #ffcf63;border-radius:8px;background:#1a1226;color:#ffe9a8;font:900 15px Rajdhani,sans-serif;cursor:pointer}
.hp-btn.gold{background:linear-gradient(#fcc126,#f7a51a 55%,#fb8f0b);color:#2a1000}.hp-btn.on{background:#3a2a10}.hp-btn:disabled{opacity:.45;cursor:not-allowed}
.hp-empty{padding:18px 6px;text-align:center}.hp-empty h3{margin:0 0 6px;color:#ffcf63;font:900 18px Rajdhani,sans-serif}
.hp-msg{min-height:1.2em;margin:8px 0 0;text-align:center;color:#ff9d7a}.hp-msg.ok{color:#7dff9b}
.hp-uses{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:10px 0}
.hp-list{margin:8px 0 0;padding:0;list-style:none}.hp-list li{display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid #2e2340;font-size:14px}
.hp-foot{display:flex;justify-content:space-between;gap:8px;padding:0 16px 14px}
.hp-note{color:#cfc1a0;font-size:13px}`;
    document.head.append(s);
  }
  function open(next = 'rewards') {
    if (!authed()) { window.ShinobiBetaUI?.open?.(); return; }
    style();
    if (!dialog) {
      dialog = el('dialog', 'hp-center'); dialog.setAttribute('aria-labelledby', 'hpTitle');
      dialog.addEventListener('close', () => { message = ''; });
      document.body.append(dialog);
    }
    view = next; message = ''; lastClaim = null; render(); dialog.showModal(); refresh();
  }
  function render() {
    if (!dialog) return;
    const head = el('div', 'hp-head'), h = el('h2', '', 'SHINOBI REWARD CENTER'); h.id = 'hpTitle';
    head.append(h, button('✕', () => dialog.close()));
    head.lastChild.setAttribute('aria-label', 'Close');
    const tabs = el('div', 'hp-tabs');
    for (const [k, label] of [['rewards', 'Rewards'], ['passes', 'Hero Passes'], ['history', 'History']]) { const b = button(label, () => { view = k; message = ''; lastClaim = null; render(); }, view === k ? 'on' : ''); b.disabled = false; tabs.append(b); }
    const body = el('div', 'hp-body');
    if (!state) body.append(el('p', 'hp-note', 'Loading your rewards…'));
    else if (!state.ui) body.append(el('p', 'hp-note', 'The Reward Center is not open yet.'));
    else if (view === 'rewards') rewards(body); else if (view === 'passes') passes(body); else history(body);
    const msg = el('p', 'hp-msg' + (okMessage ? ' ok' : ''), message); msg.setAttribute('role', 'status');
    const foot = el('div', 'hp-foot');
    foot.append(button('Help & Support', () => { view = 'support'; render(); }), button('Close', () => dialog.close()));
    foot.querySelectorAll('button').forEach(b => { b.disabled = false; });
    if (view === 'support') { body.replaceChildren(el('h3', '', 'HELP & SUPPORT'), el('p', '', 'Open ⚙ Tools in the game header for the community and support links. Our team can help with rewards, wallets and referral links.')); }
    body.append(msg);
    dialog.replaceChildren(head, tabs, body, foot);
  }
  function rewards(body) {
    if (lastClaim) {
      const c = el('div', 'hp-card'); c.append(el('h3', '', 'REWARD CLAIMED SUCCESSFULLY!'), el('span', 'hp-qty', fmt(lastClaim.passes) + ' STANDARD HERO PASSES ADDED!'), el('p', 'hp-meta', 'Your account-bound passes are now available.'), button('OPEN HERO PASSES', () => { lastClaim = null; view = 'passes'; message = ''; render(); }, 'gold'));
      body.append(c);
    }
    const pending = state.pending || [];
    if (!pending.length && !lastClaim) {
      const e = el('div', 'hp-empty'); e.append(el('h3', '', 'NO REWARDS AVAILABLE'), el('p', '', 'You currently have no pending promotional rewards.'), el('p', '', 'Check back for future Shinobi events!'));
      body.append(e); return;
    }
    for (const r of pending) {
      const c = el('div', 'hp-card');
      const meta = el('p', 'hp-meta'); meta.append('Status: ', el('b', '', 'READY TO CLAIM'), ' · Restriction: ', el('b', '', 'ACCOUNT-BOUND'));
      const b = button('CLAIM ' + fmt(r.passes) + ' HERO PASSES', () => claim(r), 'gold');
      if (!state.claims) { b.disabled = true; b.textContent = 'CLAIMING OPENS SOON'; }
      c.append(el('small', '', r.campaign), el('h3', '', String(r.tierName || '').toUpperCase()), el('p', '', 'Congratulations, Shinobi! You have received:'), el('span', 'hp-qty', fmt(r.passes) + ' STANDARD HERO PASSES'), meta, b);
      body.append(c);
    }
  }
  function passes(body) {
    const n = Number(state.passes) || 0, c = el('div', 'hp-card');
    c.append(el('small', '', 'ACCOUNT-BOUND'), el('h3', '', 'STANDARD HERO PASSES'), el('span', 'hp-qty', fmt(n)),
      el('p', 'hp-meta', 'Each pass recruits one in-game hero at normal Shrine odds. Heroes from these passes are bound to this account: they cannot be sold, traded or transferred, and Fusion keeps them bound.'));
    const uses = el('div', 'hp-uses');
    for (const q of [1, 5, 10]) { const b = button('Use ' + q, () => use(q), 'gold'); b.disabled = busy || !state.claims || n < q; uses.append(b); }
    c.append(uses); body.append(c);
    if ((state.uses || []).length) {
      body.append(el('h3', '', 'Recent recruits'));
      const list = el('ul', 'hp-list');
      for (const u of state.uses) { const li = el('li'); li.append(el('span', '', when(u.created)), el('span', '', u.quantity + ' pass' + (u.quantity === 1 ? '' : 'es') + ' → ' + (u.heroes || []).map(h => h.name).join(', '))); list.append(li); }
      body.append(list);
    }
  }
  function history(body) {
    const all = [...(state.pending || []), ...(state.history || [])];
    if (!all.length) { body.append(el('p', 'hp-note', 'No rewards yet.')); return; }
    const list = el('ul', 'hp-list');
    for (const r of all) {
      const li = el('li'), left = el('span'); left.append(el('b', '', r.campaign), document.createElement('br'), r.tierName + ' · ' + fmt(r.passes) + ' passes');
      li.append(left, el('span', '', (r.status === 'claimed' ? 'Claimed ' + when(r.claimedAt) : r.status === 'pending' ? 'Ready · assigned ' + when(r.assigned) : 'Not available') ));
      list.append(li);
    }
    body.append(list);
  }
  async function claim(r) {
    if (busy) return; busy = true; message = 'Claiming…'; okMessage = false; render();
    const key = r.campaignId; if (!claimIds.has(key)) claimIds.set(key, id('pclaim'));
    try {
      const data = await RyoPayments.heroPasses('pass-claim', { campaignId: r.campaignId, requestId: claimIds.get(key) });
      claimIds.delete(key); state = data.heroPasses || state; lastClaim = data.passClaim; message = ''; changed();
    } catch (e) { if (Number(e?.status) >= 400 && Number(e?.status) < 500) claimIds.delete(key); message = e?.message || 'Claim failed. Nothing was added. Try again.'; okMessage = false; }
    finally { busy = false; render(); }
  }
  async function use(quantity) {
    if (busy) return; busy = true; message = 'Recruiting…'; okMessage = false; render();
    const key = String(quantity); if (!useIds.has(key)) useIds.set(key, id('puse'));
    try {
      const data = await RyoPayments.heroPasses('pass-redeem', { quantity, requestId: useIds.get(key) });
      useIds.delete(key); state = data.heroPasses || state; message = quantity + ' hero' + (quantity === 1 ? '' : 'es') + ' joined your collection.'; okMessage = true; changed();
      reveal(data.passRedeem?.heroes || []);
    } catch (e) { if (Number(e?.status) >= 400 && Number(e?.status) < 500) useIds.delete(key); message = e?.message || 'Nothing was used. Try again.'; okMessage = false; }
    finally { busy = false; render(); }
  }
  async function reveal(heroes) {
    const owner = window.RyoPayments.state.account, ids = new Set(heroes.map(h => h.tokenId));
    const find = () => (typeof S !== 'undefined' && S.h ? S.h.filter(h => ids.has(h.tokenId) && h.tokenOwner === owner) : []);
    try { window.TokenCheckout?.syncProfile?.(); } catch { /* optional */ }
    if (find().length < ids.size) { try { await window.RyoPayments.refresh(); window.TokenCheckout?.syncProfile?.(); } catch { /* keep the toast */ } }
    const local = find();
    if (local.length && window.Experience?.presentReward) { dialog?.close(); window.Experience.presentReward(local); }
  }

  window.HeroPasses = Object.freeze({ refresh, open, ui: () => !!state?.ui, pending: () => (state?.ui && state.pending?.length) || 0, get state() { return state; } });
  addEventListener('shinobi-ryo-ledger', e => {
    const a = e.detail?.authenticated ? (window.RyoPayments?.state?.account || e.detail.account || null) : null;
    if (a !== account) { account = a; state = null; claimIds.clear(); useIds.clear(); lastClaim = null; if (dialog?.open) dialog.close(); if (a) refresh(); else changed(); }
  });
  setInterval(() => { if (!document.hidden && authed()) refresh(); }, 60000);   // paused while the tab is hidden, caught up when it is visible again
  document.addEventListener('visibilitychange', () => { if (!document.hidden && authed()) refresh(); });
})();
