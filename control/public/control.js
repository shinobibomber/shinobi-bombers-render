/* Admin Control panel page. Talks only to POST /api/control (same origin, HttpOnly session cookie). Signs only the
 * site's standard free sign-in message through wallet.js; it never asks the wallet for a transaction. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const GROUPS = { money: 'Game money features', founders: "Founder's boxes and Sensei SOL", gameplay: 'Gameplay screens' };
  const MONEY_WARNING = 'This opens a real-money feature on the live game for every player. Your wallet will ask you to sign a free confirmation: approve it only if it names this same feature.';
  let state = null, pending = null, busy = false, walletId = null;
  try { walletId = sessionStorage.getItem('sb-control-wallet'); } catch {}
  // Opening a money or Founder feature (turn ON, or reset to an ON Render value) needs a fresh wallet confirmation.
  const opens = (s, enabled) => (s.group === 'money' || s.group === 'founders') && (enabled === true || (enabled === null && s.environment === true));
  async function confirmWithWallet(s, enabled) {
    if (SBWallet.active?.address !== state.wallet) {
      const w = (SBWallet.list() || []).find(x => x.id === walletId) || (SBWallet.list() || [])[0];
      if (!w) throw Error('No Solana wallet found to confirm this change.');
      const { address } = await SBWallet.connect(w.id);
      if (address !== state.wallet) throw Error('Switch your wallet to ' + short(state.wallet) + ' (the signed-in admin) and try again.');
    }
    const challenge = await api('confirm', { key: s.key, enabled, expectedVersion: s.version });
    $('#confirmStatus').textContent = 'Approve the free confirmation in your wallet…';
    return { nonce: challenge.nonce, signature: await SBWallet.signMessage(challenge.message) };
  }

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return n;
  }
  async function api(action, body = {}) {
    let r; try { r = await fetch('/api/control', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-SB-Control': '1' }, body: JSON.stringify({ ...body, action }) }); }
    catch { throw Object.assign(Error('Network error. Try again.'), { code: 'NETWORK' }); }
    let data = {}; try { data = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(Error(data.error || 'Request failed.'), { code: data.code, status: r.status });
    return data;
  }
  const short = w => w ? w.slice(0, 4) + '…' + w.slice(-4) : '';
  const when = t => { try { return new Date(t).toLocaleString(); } catch { return ''; } };

  /* ---------- Sign-in ---------- */
  function drawWallets() {
    const box = $('#wallets'), wallets = window.SBWallet?.list() || [];
    box.replaceChildren(...(wallets.length ? wallets.map(w => { const b = el('button', { type: 'button' }, 'Sign in with ' + w.name); b.addEventListener('click', () => signIn(w)); b.disabled = busy; return b; })
      : [el('p', { class: 'status', text: 'No Solana wallet found. Open this page in a browser with Phantom or Solflare.' })]));
  }
  async function signIn(w) {
    if (busy) return; busy = true; drawWallets();
    const st = $('#signInStatus'); st.classList.remove('err');
    try {
      st.textContent = 'Connecting ' + w.name + '…';
      const { address } = await SBWallet.connect(w.id);
      const challenge = await api('challenge', { wallet: address });
      SBWallet.validateChallenge(challenge, address);
      st.textContent = 'Approve the free sign-in message in ' + w.name + '…';
      const signature = await SBWallet.signMessage(challenge.message);
      show(await api('login', { wallet: address, nonce: challenge.nonce, signature }));
      walletId = w.id; try { sessionStorage.setItem('sb-control-wallet', w.id); } catch {}
      st.textContent = '';
    } catch (e) { st.textContent = e.message || 'Sign-in failed.'; st.classList.add('err'); }
    finally { busy = false; drawWallets(); }
  }

  /* ---------- Panel ---------- */
  function show(data) {
    state = data;
    $('#signIn').hidden = true; $('#panel').hidden = false; $('#signOut').hidden = false;
    $('#who').textContent = short(data.wallet) + ' · ' + data.role + (data.canWrite ? '' : ' (read-only)');
    const r = data.release || {};
    const releaseText = r.launched ? 'PUBLIC (released by the SR mint)' : r.mintReleased && r.hold ? 'HELD (mint released, GAME_LAUNCH_HOLD)' : r.prelaunch ? 'PRE-LAUNCH (' + (r.stage || 'portal') + ')' : 'PUBLIC (' + (r.stage || '?') + ')';
    $('#release').replaceChildren(el('h2', { text: 'Release' }), el('dl', {},
      el('dt', { text: 'Game' }), el('dd', { text: releaseText }),
      el('dt', { text: 'Network' }), el('dd', { text: r.network || '—' }),
      el('dt', { text: 'Change release' }), el('dd', { text: 'In Render for now (GAME_LAUNCH_HOLD). Panel control comes next.' })));
    const note = $('#panelNote');
    note.hidden = !data.panelDisabled; note.textContent = data.panelDisabled ? 'FEATURE_PANEL_DISABLED is on in Render: panel values are ignored and the environment rules apply.' : '';
    const groups = {};
    for (const s of data.switches) (groups[s.group] = groups[s.group] || []).push(s);
    $('#groups').replaceChildren(...Object.entries(GROUPS).filter(([g]) => groups[g]).map(([g, title]) => el('section', { class: 'card' }, el('h2', { text: title }),
      el('div', { class: 'grid' }, groups[g].map(card)))));
    loadLog();
  }
  function card(s) {
    const badge = el('span', { class: 'badge' + (s.source === 'panel' ? ' panel' : ''), text: s.source === 'panel' ? 'set in panel' : s.source === 'environment' ? 'Render' : 'default' });
    const row = el('div', { class: 'row' });
    if (state.canWrite) {
      const turn = el('button', { type: 'button' }, s.effective ? 'Turn OFF' : 'Turn ON');
      turn.addEventListener('click', () => ask(s, !s.effective));
      row.append(turn);
      if (s.panel !== null) { const reset = el('button', { type: 'button', class: 'ghost' }, 'Reset to Render (' + (s.environment ? 'ON' : 'OFF') + ')'); reset.addEventListener('click', () => ask(s, null)); row.append(reset); }
    }
    const last = s.lastChange ? 'Last change ' + when(s.lastChange.updated) + ' by ' + short(s.lastChange.by) + ': ' + s.lastChange.reason : '';
    return el('div', { class: 'sw' }, el('span', { class: 'name', text: s.label }),
      el('span', {}, el('span', { class: 'state ' + (s.effective ? 'on' : 'off'), text: s.effective ? 'ON' : 'OFF' }), ' ', badge),
      el('span', { class: 'meta', text: 'Render ' + s.envName + ': ' + (s.environment ? 'ON' : 'OFF') }),
      last ? el('span', { class: 'meta', text: last }) : null, row);
  }
  function ask(s, enabled) {
    pending = { s, enabled };
    $('#confirmTitle').textContent = (enabled === null ? 'Reset ' : enabled ? 'Turn ON ' : 'Turn OFF ') + s.label;
    $('#confirmText').replaceChildren(enabled === null ? 'The switch goes back to the Render setting (' + (s.environment ? 'ON' : 'OFF') + ').'
        + (opens(s, enabled) ? ' Your wallet will ask you to sign a free confirmation: approve it only if it names this same feature.' : '')
      : opens(s, enabled) ? el('span', { class: 'money', text: MONEY_WARNING }) : 'Players see the change within a few seconds.');
    $('#reason').value = ''; $('#confirmStatus').textContent = '';
    $('#confirm').showModal();
  }
  async function apply(e) {
    e.preventDefault(); if (!pending) return;
    const st = $('#confirmStatus'); st.classList.remove('err');
    const reason = $('#reason').value.trim(); if (reason.length < 8 || reason.length > 300) { st.textContent = 'Write a reason (8-300 characters).'; st.classList.add('err'); return; }
    $('#apply').disabled = true;
    try {
      const { s, enabled } = pending;
      const proof = opens(s, enabled) ? await confirmWithWallet(s, enabled) : {};
      const data = await api(enabled === null ? 'clear' : 'set', { key: s.key, enabled, reason, expectedVersion: s.version, ...proof });
      $('#confirm').close(); pending = null; show(data);
      if (data.refreshed === false) { const n = $('#panelNote'); n.textContent = 'Saved. The new state appears after the next refresh (a few seconds).'; n.hidden = false; }
    } catch (err) {
      st.textContent = err.message; st.classList.add('err');
      if (err.code === 'STALE') {
        await refresh(); const fresh = state?.switches?.find(x => x.key === pending?.s.key);
        if (fresh && pending) { pending.s = fresh; st.textContent = 'Another admin changed this switch (now ' + (fresh.effective ? 'ON' : 'OFF') + '). Press Apply again to confirm your change.'; }
      }
    }
    finally { $('#apply').disabled = false; }
  }
  async function loadLog() {
    try {
      const { log } = await api('log', { limit: 50 });
      $('#log').replaceChildren(...(log.length ? log.map(x => el('li', { text: when(x.created) + ' · ' + x.key + ' → ' + (x.enabled === null ? 'reset' : x.enabled ? 'ON' : 'OFF') + ' · ' + short(x.actor) + ' · ' + x.reason + (x.linked ? '' : ' · chain break!') })) : [el('li', { text: 'No changes yet.' })]));
    } catch {}
  }
  async function refresh() { try { show(await api('state')); } catch (e) { if (e.status === 401 || e.status === 403) signedOut(); } }
  function signedOut() { state = null; $('#signIn').hidden = false; $('#panel').hidden = true; $('#signOut').hidden = true; $('#who').textContent = ''; drawWallets(); }

  function boot() {
    $('#confirmForm').addEventListener('submit', apply);
    $('#cancel').addEventListener('click', () => { $('#confirm').close(); pending = null; });
    $('#signOut').addEventListener('click', async () => { try { await api('logout'); } catch {} signedOut(); });
    window.SBWallet?.onChange?.(drawWallets);
    drawWallets(); refresh();
    setInterval(() => { if (state && !document.hidden && !$('#confirm').open) refresh(); }, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
