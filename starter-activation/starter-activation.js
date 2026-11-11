/* Starter Activation, client (apply-starter-activation.cjs). Owner request 2026-11-11. The server decides everything (who is
 * eligible, the 50% rate, counting paid summons); this file only shows the SHINOBI ACTIVATION card on the main menu and the
 * Summoning Shrine (never over the CLAIM button) and the welcome / progress / almost / complete notices, once each per
 * account, from the server's `starter` view in the Chest response. Text is set with textContent only.
 * The card can be minimized to a small pill (owner request 2026-11-12: it blocked the screen on phones). Phones start minimized,
 * computers start open; the player's choice is remembered per account (localStorage sb-starter-min:<account>). Display only. */
(function () {
  'use strict';
  const SEEN = 'sb-starter-seen:';
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
  let card = null, dlg = null, painted = '';
  const MIN = 'sb-starter-min:', phone = () => { try { return matchMedia('(max-width: 700px)').matches; } catch { return false; } };
  const minimized = account => { const v = store.get(MIN + account); return v === '1' ? true : v === '0' ? false : phone(); };
  function setMinimized(account, value) { store.set(MIN + account, value ? '1' : '0'); painted = ''; update(); }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  function current() {
    const A = window.AdventureChest, R = window.RyoPayments;
    if (!A || !R?.state?.authenticated) return null;
    const s = A.snapshot; return s?.chest?.starter && s.owner === R.state.account ? { v: s.chest.starter, account: s.owner } : null;
  }
  function style() {
    if (document.getElementById('starterActivationStyle')) return;
    const s = el('style'); s.id = 'starterActivationStyle';
    s.textContent = `.sa-card{position:fixed;z-index:125;top:96px;left:16px;width:min(300px,calc(100vw - 32px));box-sizing:border-box;padding:12px 14px;border:2px solid #ffcf63;border-radius:12px;background:linear-gradient(180deg,#1d1305f2,#0b0816f2);box-shadow:0 0 16px #ffcf6355;color:#fff3cf;font:600 14px/1.35 Rajdhani,sans-serif}
.sa-card[hidden]{display:none}.sa-card h3{margin:0;font:900 16px Rajdhani,sans-serif;letter-spacing:.08em;color:#ffcf63}
.sa-card .sa-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 6px}
.sa-card button.sa-min{min-width:32px;min-height:32px;padding:0;border-radius:8px;font:900 18px/1 Rajdhani,sans-serif}
.sa-card.sa-pill{width:auto;padding:0;border:0;background:none;box-shadow:none}
.sa-card button.sa-pill-btn{min-height:36px;padding:0 14px;border-radius:18px;box-shadow:0 0 12px #ffcf6366;white-space:nowrap}
.sa-card .sa-row{display:flex;justify-content:space-between;gap:8px}.sa-card b{color:#fff}
.sa-card i{display:block;height:8px;margin:6px 0;border-radius:5px;background:#2a2033;overflow:hidden}.sa-card s{display:block;height:100%;background:linear-gradient(90deg,#ffcf63,#ff8a3d)}
.sa-card .sa-go{margin:6px 0 8px;font:900 14px Rajdhani,sans-serif;color:#ffb35c}
.sa-card button,.sa-dialog button{min-height:34px;padding:0 12px;border:1px solid #ffcf63;border-radius:8px;background:linear-gradient(#fcc126,#f7a51a 55%,#fb8f0b);color:#2a1000;font:900 14px Rajdhani,sans-serif;cursor:pointer}
dialog.sa-dialog{max-width:min(420px,calc(100vw - 32px));box-sizing:border-box;padding:18px;border:2px solid #ffcf63;border-radius:12px;background:linear-gradient(180deg,#1d1305,#0b0816);color:#fff3cf;font:600 15px/1.4 Rajdhani,sans-serif}
dialog.sa-dialog::backdrop{background:#000a}.sa-dialog h2{margin:0 0 8px;color:#ffcf63;font:900 20px Rajdhani,sans-serif;letter-spacing:.06em}
@media(max-width:700px){.sa-card{top:auto;bottom:76px;left:8px;width:calc(100vw - 16px)}.sa-card.sa-pill{width:auto}}`;
    document.head.append(s);
  }
  function openShrine() { try { window.WebsiteDesign?.open?.('summon'); } catch { /* design not ready */ } }
  function paintCard(v, account) {
    style();
    if (!card) { card = el('section', 'sa-card'); card.setAttribute('role', 'status'); card.hidden = true; document.body.append(card); }
    const screen = window.WebsiteDesign?.current?.(), show = v && v.state === 'active' && ['home', 'summon'].includes(screen) && !document.querySelector('dialog[open]');
    card.hidden = !show; if (!show) return;
    const mini = minimized(account), key = [mini, screen, v.paidSummons, v.target, v.remaining, v.ratePercent].join('|');
    if (key === painted && card.childElementCount) return;   // nothing changed: keep the DOM (no flicker, focus kept)
    painted = key; card.classList.toggle('sa-pill', mini);
    if (mini) {
      const pill = el('button', 'sa-pill-btn', '⚡ Activation ' + v.paidSummons + '/' + v.target + ' ▸'); pill.type = 'button';
      pill.setAttribute('aria-expanded', 'false'); pill.setAttribute('aria-label', 'Show Shinobi Activation: ' + v.paidSummons + ' of ' + v.target + ' paid summons');
      pill.onclick = () => setMinimized(account, false);
      card.replaceChildren(pill); return;
    }
    const pct = Math.round(v.paidSummons / v.target * 100), bar = el('i'), fill = el('s'); fill.style.width = pct + '%'; bar.append(fill);
    const row1 = el('div', 'sa-row'); row1.append(el('span', '', 'Paid Summons'), el('b', '', v.paidSummons + ' / ' + v.target));
    const row2 = el('div', 'sa-row'); row2.append(el('span', '', 'Enemy Reward Rate'), el('b', '', v.ratePercent + '% → 100%'));
    const go = el('p', 'sa-go', v.remaining + ' MORE PAID SUMMON' + (v.remaining === 1 ? '' : 'S') + ' TO ACTIVATE!');
    const btn = el('button', 'sa-open', 'Open Summoning Shrine'); btn.type = 'button'; btn.onclick = openShrine;
    const min = el('button', 'sa-min', '–'); min.type = 'button'; min.setAttribute('aria-label', 'Minimize Shinobi Activation'); min.setAttribute('aria-expanded', 'true'); min.onclick = () => setMinimized(account, true);
    const head = el('div', 'sa-head'); head.append(el('h3', '', 'SHINOBI ACTIVATION'), min);
    card.replaceChildren(head, row1, bar, row2, go, ...(screen === 'summon' ? [] : [btn]));
  }
  function notice(title, lines, key, account) {
    if (store.get(SEEN + account + ':' + key)) return;
    style(); if (!dlg) { dlg = el('dialog', 'sa-dialog'); document.body.append(dlg); }
    if (dlg.open) return;
    const ok = el('button', '', 'Continue'); ok.type = 'button'; ok.onclick = () => dlg.close();
    dlg.replaceChildren(el('h2', '', title), ...lines.map(t => el('p', '', t)), ok);
    store.set(SEEN + account + ':' + key, '1');
    try { dlg.showModal(); } catch { /* not attached */ }
  }
  function update() {
    const c = current(); if (!c) { if (card) card.hidden = true; return; }
    const v = c.v; paintCard(v, c.account);
    if (document.querySelector('dialog[open]:not(.sa-dialog)') || document.querySelector('.reveal-card')) return;   // never over a purchase or reveal
    if (v.state === 'active' && v.paidSummons === 0) notice('WELCOME TO SHINOBI BOMBERS!', ['You have received 10 FREE GENIN HEROES!', 'All heroes begin with Power 1, Speed 1 and Stamina 1. Train them to grow stronger.', 'Your initial enemy reward rate is 50%. Complete 15 paid Summoning Shrine summons to permanently unlock the normal 100% reward rate.'], 'welcome', c.account);
    else if (v.state === 'active' && v.remaining === 1) notice('ALMOST ACTIVATED!', ['Complete one more paid Shrine summon to unlock full enemy rewards.'], 'almost', c.account);
    else if (v.state === 'active' && v.paidSummons > 0) notice('SHINOBI ACTIVATION PROGRESS!', ['You have completed ' + v.paidSummons + ' / ' + v.target + ' paid summons.'], 'progress-' + v.paidSummons, c.account);
    else if (v.state === 'complete') notice('SHINOBI ACTIVATION COMPLETE!', ['Congratulations! You have completed 15 paid Summoning Shrine summons.', '100% NORMAL ENEMY REWARDS UNLOCKED!'], 'complete', c.account);
  }
  window.StarterActivation = Object.freeze({ update, current });
  addEventListener('shinobi-chest', () => setTimeout(update, 0));
  addEventListener('shinobi-ryo-ledger', () => setTimeout(update, 0));
  setInterval(update, 1500);
})();
