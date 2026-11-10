/* Chest Overflow, client (apply-chest-overflow.cjs). Owner request 2026-11-11. The server decides every reward
 * (chest-overflow.cjs + combat-adventure.cjs); this file only (1) scales the on-screen "+X Ryo → Chest" estimate
 * (AdventureChest.rewardRate) while the server reports an active penalty, and (2) shows small, dismissible alerts by the Chest
 * from the server's `overflow` status: approaching, threshold reached (with the claim/grace timing), penalty active, penalty
 * reduced, full rewards restored. Each alert shows once per state change (remembered per account); it never blocks play. */
(function () {
  'use strict';
  const SEEN = 'sb-chest-overflow-seen:', LAST = 'sb-chest-overflow-last:';
  const fmt = n => Math.floor(Number(n) || 0).toLocaleString('en-US');
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
  let el = null, shownKey = null, autoHide = 0, transientShown = false;

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
    s.textContent = `.chest-overflow{position:fixed;z-index:130;top:96px;right:16px;width:min(360px,calc(100vw - 32px));box-sizing:border-box;padding:12px 14px;border:2px solid #ffcf63;border-radius:12px;background:linear-gradient(180deg,#1d1305f2,#0b0816f2);box-shadow:0 0 18px #ffcf6355;color:#fff3cf;font:600 14px/1.35 Rajdhani,sans-serif}
.chest-overflow[hidden]{display:none}
.chest-overflow h3{margin:0 0 4px;font:900 16px Rajdhani,sans-serif;letter-spacing:.06em;color:#ffcf63}
.chest-overflow p{margin:0 0 10px;color:#f3e6c4}
.chest-overflow .co-actions{display:flex;gap:8px}.chest-overflow button{flex:1;min-height:34px;border:1px solid #ffcf63;border-radius:8px;background:#1a1226;color:#ffe9a8;font:900 14px Rajdhani,sans-serif;cursor:pointer}
.chest-overflow button.co-open{background:linear-gradient(#fcc126,#f7a51a 55%,#fb8f0b);color:#2a1000}
.chest-overflow.warn{border-color:#ff9d4a;box-shadow:0 0 18px #ff8a3d66}.chest-overflow.warn h3{color:#ffb35c}
.chest-overflow.bad{border-color:#ff5a5a;box-shadow:0 0 18px #ff3b3b66}.chest-overflow.bad h3{color:#ff7a7a}
.chest-overflow.good{border-color:#7dff9b;box-shadow:0 0 18px #7dff9b55}.chest-overflow.good h3{color:#7dff9b}
@media(max-width:700px){.chest-overflow{top:64px;right:8px;left:8px;width:auto}}`;
    document.head.append(s);
  }
  function banner() {
    if (el) return el;
    style();
    el = document.createElement('section'); el.className = 'chest-overflow'; el.hidden = true; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<h3></h3><p></p><div class="co-actions"><button type="button" class="co-open">Open Chest</button><button type="button" class="co-close">Continue</button></div>';
    el.querySelector('.co-open').onclick = () => { dismiss(); try { window.AdventureChest?.open(); } catch { /* chest unavailable */ } };
    el.querySelector('.co-close').onclick = dismiss;
    document.body.append(el); return el;
  }
  function dismiss() { const c = current(); if (c && shownKey) store.set(SEEN + c.account, shownKey); hide(); }
  function hide() { if (el) el.hidden = true; shownKey = null; transientShown = false; clearTimeout(autoHide); }
  const left = ms => { const m = Math.max(1, Math.ceil(ms / 60000)); return (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm'; };
  const when = t => new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  /* The alert for this status (and the previous one, for "reduced" / "restored"), or null. */
  function alertFor(o, prev) {
    const tier = o.tierPercent, active = activeNow(o), prevActiveTier = prev && prev.active ? prev.tier : 0;
    if (prevActiveTier > 0 && tier === 0) return { key: 'restored:' + Date.now(), cls: 'good', t: 'FULL REWARDS RESTORED', b: 'Your Chest is below 500,000 Ryo. New enemy rewards pay 100% again.', transient: true };
    if (active && prevActiveTier > tier) return { key: 'reduced:' + prevActiveTier + '>' + tier, cls: 'warn', t: 'PENALTY REDUCED', b: 'Chest overflow penalty −' + prevActiveTier + '% → −' + tier + '%. New enemy rewards now pay ' + (100 - tier) + '%. Claim or spend more to restore full rewards.', transient: true };
    if (active) return { key: 'active:' + tier, cls: 'bad', t: 'CHEST OVERFLOW: −' + tier + '% ENEMY REWARDS', b: 'Your Chest holds ' + fmt(o.chestRyo) + ' Ryo, so new enemy rewards pay ' + (100 - tier) + '%. Your earned Ryo is safe. Claim or spend your Chest rewards to restore full rewards.' };
    if (tier > 0) {
      const timing = Number.isFinite(o.activeFrom) ? 'A −' + tier + '% penalty on new enemy rewards starts in ' + left(o.activeFrom - Date.now()) + ' unless you claim or spend.'
        : Number.isFinite(o.claimReadyAt) && o.claimReadyAt > Date.now() ? 'Your next claim is ready ' + when(o.claimReadyAt) + '. A −' + tier + '% penalty can start ' + o.graceHours + ' hours after that if you don\'t claim or spend.'
        : o.unavailable ? 'No penalty while claiming is unavailable.' : 'No penalty until your next claim is ready.';
      return { key: 'threshold:' + tier + ':' + (Number.isFinite(o.activeFrom) ? 'grace' : 'wait'), cls: 'warn', t: 'CHEST OVERFLOW WARNING', b: fmt(o.chestRyo) + ' Ryo unclaimed. Current enemy reward rate: 100%. ' + timing };
    }
    if (o.state === 'approaching') return { key: 'approaching', cls: '', t: 'CHEST ALMOST FULL', b: 'Your Chest holds ' + fmt(o.chestRyo) + ' Ryo. From 500,000 Ryo, new enemy rewards drop by 10% once your claim is ready and a ' + o.graceHours + '-hour grace period ends. Claim or spend Chest rewards to keep full rewards.' };
    return null;
  }

  function update() {
    wrapRate();
    const c = current(); if (!c) { hide(); return; }
    const raw = store.get(LAST + c.account); let prev = null; try { prev = raw ? JSON.parse(raw) : null; } catch { prev = null; }
    const o = c.o, next = { tier: o.tierPercent, active: activeNow(o) };
    const a = alertFor(o, prev);
    if (!prev || prev.tier !== next.tier || prev.active !== next.active) store.set(LAST + c.account, JSON.stringify(next));
    if (transientShown) return;   // a "reduced"/"restored" note stays until it times out or is dismissed
    if (!a) { if (shownKey) hide(); return; }
    if (a.key === shownKey) { el.querySelector('p').textContent = a.b; return; }   // keep countdowns current
    if (store.get(SEEN + c.account) === a.key) return;
    const b = banner(); b.className = 'chest-overflow' + (a.cls ? ' ' + a.cls : ''); b.querySelector('h3').textContent = a.t; b.querySelector('p').textContent = a.b;
    b.hidden = false; shownKey = a.key; clearTimeout(autoHide); transientShown = !!a.transient;
    if (a.transient) autoHide = setTimeout(() => { store.set(SEEN + c.account, a.key); hide(); update(); }, 15000);
  }

  window.ChestOverflow = Object.freeze({ update, alertFor, current, activeNow });
  addEventListener('shinobi-chest', () => setTimeout(update, 0));
  addEventListener('shinobi-ryo-ledger', () => setTimeout(update, 0));
  setInterval(update, 30000);
  if (!wrapRate()) { const t = setInterval(() => { if (wrapRate()) clearInterval(t); }, 250); setTimeout(() => clearInterval(t), 30000); }
})();
