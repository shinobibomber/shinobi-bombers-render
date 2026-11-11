/* Chest Overflow, client (apply-chest-overflow.cjs). Owner request 2026-11-11. The server decides every reward
 * (chest-overflow.cjs + combat-adventure.cjs); this file only (1) scales the on-screen "+X Ryo → Chest" estimate
 * (AdventureChest.rewardRate) while the server reports an active penalty, and (2) shows small, dismissible alerts by the Chest
 * from the server's `overflow` status (owner rule: always from 500,000 Ryo, no grace): approaching, penalty active, penalty
 * reduced, full rewards restored. Each alert shows once per state change (remembered per account).
 * Owner report 2026-11-11: as a floating card in the top-right corner it covered the Summoning Shrine's x5 / x10 / x15 tabs, so
 * pressing x5 hit "Open Chest". It is now a centered modal notice (like the game's other notices): a stray click lands on the
 * backdrop and does nothing, nothing is left covering the screen after Continue, combat keeps running underneath, and it waits
 * while another window (Chest, checkout, summon reveal) is open. */
(function () {
  'use strict';
  const SEEN = 'sb-chest-overflow-seen:', LAST = 'sb-chest-overflow-last:';
  const fmt = n => Math.floor(Number(n) || 0).toLocaleString('en-US');
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
  let el = null, shownKey = null, autoHide = 0, transientShown = false, retry = 0;

  function current() {
    const A = window.AdventureChest, R = window.RyoPayments;
    if (!A || !R?.state?.authenticated) return null;
    const s = A.snapshot, o = s?.chest?.overflow;
    return o && s.owner === R.state.account ? { o, account: s.owner } : null;
  }
  const activeNow = o => o.tierPercent > 0 && Number.isFinite(o.activeFrom) && Date.now() >= o.activeFrom;

  /* (1) Reward estimate: the floating text matches what the server pays. */
  function wrapRate() {
    const A = window.AdventureChest; if (!A) return false;
    const d = Object.getOwnPropertyDescriptor(A, 'rewardRate');
    if (!d || typeof d.get !== 'function') return true;
    if (d.get.chestOverflow) return true;
    const base = d.get, get = function () { const r = base.call(this), c = current(); return c && activeNow(c.o) ? r * (100 - c.o.tierPercent) / 100 : r; };
    get.chestOverflow = true;
    Object.defineProperty(A, 'rewardRate', { get, configurable: true, enumerable: d.enumerable });
    return true;
  }

  /* (2) Alerts */
  function style() {
    if (document.getElementById('chestOverflowStyle')) return;
    const s = document.createElement('style'); s.id = 'chestOverflowStyle';
    s.textContent = `.chest-overflow{position:fixed;inset:0;margin:auto;height:fit-content;max-height:calc(100dvh - 32px);overflow:auto;width:min(380px,calc(100vw - 32px));box-sizing:border-box;padding:12px 14px;border:2px solid #ffcf63;border-radius:12px;background:linear-gradient(180deg,#1d1305f2,#0b0816f2);box-shadow:0 0 18px #ffcf6355;color:#fff3cf;font:600 14px/1.35 Rajdhani,sans-serif}
.chest-overflow[hidden]{display:none}
.chest-overflow h3{margin:0 0 4px;font:900 16px Rajdhani,sans-serif;letter-spacing:.06em;color:#ffcf63}
.chest-overflow p{margin:0 0 10px;color:#f3e6c4}
.chest-overflow .co-actions{display:flex;gap:8px}.chest-overflow button{flex:1;min-height:34px;border:1px solid #ffcf63;border-radius:8px;background:#1a1226;color:#ffe9a8;font:900 14px Rajdhani,sans-serif;cursor:pointer}
.chest-overflow button.co-open{background:linear-gradient(#fcc126,#f7a51a 55%,#fb8f0b);color:#2a1000}
.chest-overflow.warn{border-color:#ff9d4a;box-shadow:0 0 18px #ff8a3d66}.chest-overflow.warn h3{color:#ffb35c}
.chest-overflow.bad{border-color:#ff5a5a;box-shadow:0 0 18px #ff3b3b66}.chest-overflow.bad h3{color:#ff7a7a}
.chest-overflow.good{border-color:#7dff9b;box-shadow:0 0 18px #7dff9b55}.chest-overflow.good h3{color:#7dff9b}
.chest-overflow::backdrop{background:#020612b3}
.chest-overflow h3{font-size:18px}`;
    document.head.append(s);
  }
  function banner() {
    if (el) return el;
    style();
    el = document.createElement('dialog'); el.className = 'chest-overflow'; el.hidden = true; el.setAttribute('aria-live', 'polite');
    el.addEventListener('cancel', e => { e.preventDefault(); dismiss(); });   // Esc = Continue
    el.innerHTML = '<h3></h3><p></p><div class="co-actions"><button type="button" class="co-open">Open Chest</button><button type="button" class="co-close">Continue</button></div>';
    el.querySelector('.co-open').onclick = () => { dismiss(); try { window.AdventureChest?.open(); } catch { /* chest unavailable */ } };
    el.querySelector('.co-close').onclick = dismiss;
    document.body.append(el); return el;
  }
  function dismiss() { const c = current(); if (c && shownKey) store.set(SEEN + c.account, shownKey); hide(); }
  function hide() { if (el) { el.hidden = true; if (el.open) el.close(); } shownKey = null; transientShown = false; clearTimeout(autoHide); }
  // Another window is open (Chest, checkout, summon reveal, a notice): wait and show the alert after it closes.
  const busyScreen = () => { let reveal = false; try { reveal = !!S?.v2?.revealBatch?.length; } catch { /* game state not loaded */ }   // S: the game's top-level state
    return reveal || !!document.querySelector('dialog[open]:not(.chest-overflow)') || !!window.RyoPayments?.state?.busy || !!window.BetaWallet?.state?.busy; };

  /* The alert for this status (and the previous one, for "reduced" / "restored"), or null. */
  function alertFor(o, prev) {
    const tier = o.tierPercent, active = activeNow(o), prevActiveTier = prev && prev.active ? prev.tier : 0;
    if (prevActiveTier > 0 && tier === 0) return { key: 'restored:' + Date.now(), cls: 'good', t: 'FULL REWARDS RESTORED', b: 'Your Chest is below 500,000 Ryo. New enemy rewards pay 100% again.', transient: true };
    if (active && prevActiveTier > tier) return { key: 'reduced:' + prevActiveTier + '>' + tier, cls: 'warn', t: 'PENALTY REDUCED', b: 'Chest overflow penalty −' + prevActiveTier + '% → −' + tier + '%. New enemy rewards now pay ' + (100 - tier) + '%. Claim or spend more to restore full rewards.', transient: true };
    if (active) return { key: 'active:' + tier, cls: 'bad', t: 'CHEST OVERFLOW: −' + tier + '% ENEMY REWARDS', b: 'Your Chest holds ' + fmt(o.chestRyo) + ' Ryo, so new enemy rewards pay ' + (100 - tier) + '%. Your earned Ryo is safe. Claim or spend your Chest rewards to restore full rewards.' };
    if (o.state === 'approaching') return { key: 'approaching', cls: '', t: 'CHEST ALMOST FULL', b: 'Your Chest holds ' + fmt(o.chestRyo) + ' Ryo. From 500,000 Ryo, new enemy rewards drop by 10%. Claim or spend Chest rewards to keep full rewards.' };
    return null;
  }

  function update() {
    wrapRate();
    const c = current(); if (!c) { hide(); return; }
    const raw = store.get(LAST + c.account); let prev = null; try { prev = raw ? JSON.parse(raw) : null; } catch { prev = null; }
    const o = c.o, next = { tier: o.tierPercent, active: activeNow(o) };
    const a = alertFor(o, prev);
    if (a && a.key !== shownKey && store.get(SEEN + c.account) !== a.key && busyScreen()) { clearTimeout(retry); retry = setTimeout(update, 1500); return; }   // keep prev for later
    if (!prev || prev.tier !== next.tier || prev.active !== next.active) store.set(LAST + c.account, JSON.stringify(next));
    if (transientShown) return;   // a "reduced"/"restored" note stays until it times out or is dismissed
    if (!a) { if (shownKey) hide(); return; }
    if (a.key === shownKey) { el.querySelector('p').textContent = a.b; return; }   // keep the Chest amount current
    if (store.get(SEEN + c.account) === a.key) return;
    const b = banner(); b.className = 'chest-overflow' + (a.cls ? ' ' + a.cls : ''); b.querySelector('h3').textContent = a.t; b.querySelector('p').textContent = a.b;
    b.hidden = false; if (!b.open) b.showModal(); b.querySelector('.co-close').focus(); shownKey = a.key; clearTimeout(autoHide); transientShown = !!a.transient;
    if (a.transient) autoHide = setTimeout(() => { store.set(SEEN + c.account, a.key); hide(); update(); }, 15000);
  }

  window.ChestOverflow = Object.freeze({ update, alertFor, current, activeNow });
  addEventListener('shinobi-chest', () => setTimeout(update, 0));
  addEventListener('shinobi-ryo-ledger', () => setTimeout(update, 0));
  setInterval(update, 30000);
  if (!wrapRate()) { const t = setInterval(() => { if (wrapRate()) clearInterval(t); }, 250); setTimeout(() => clearInterval(t), 30000); }
})();
