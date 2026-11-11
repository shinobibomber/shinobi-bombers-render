/* Update notice: after a new version goes live, an open game page reloads itself (owner request 2026-11-11).
 *
 * The server answers GET /version.json ({ v }) with no-store. The page remembers the version it loaded with, checks again every
 * 60 s while the tab is visible (and when the tab comes back), and when the version has changed it shows a small banner with a
 * 10 s countdown and a "Reload now" button. The reload keeps the player's sign-in (sessionStorage token, silent reconnect) and
 * the Adventure stage is restored from the server, exactly like a manual reload.
 *
 * Safety (this module never touches rewards, Chakra, combat or payments):
 *  - The countdown only runs while the player is not mid-action: no payment or Chest sync in flight, no deposit waiting, no open
 *    dialog, not on the login/loading screen, no Boss Hunt running. While busy it pauses and resumes afterwards.
 *  - Before reloading it sends the last kills the normal way (RyoPayments.adventure, the same call the game's own pagehide flush
 *    uses; the reload's pagehide then sends anything newer with keepalive), waiting at most 3 s. It never uses GO OFFLINE.
 *  - Loop guard: one reload per new version, and never more than one reload every 5 minutes, so a stale cache cannot loop.
 *  - If /version.json is missing or fails (local runs, game-only server), it does nothing. */
(() => {
  if (window.AutoUpdate) return;
  const POLL = 60000, COUNTDOWN = 10, FLUSH_MAX = 3000, MIN_GAP = 5 * 60000, KEY = 'shinobi-auto-update-v1';
  let known = null, latest = null, timer = 0, left = COUNTDOWN, banner = null, reloading = false, polling = false;

  const guard = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') || {}; } catch { return {}; } };
  const remember = v => { try { sessionStorage.setItem(KEY, JSON.stringify({ v, at: Date.now() })); } catch { /* private mode: the 60 s poll alone cannot loop */ } };

  async function version() {
    try {
      const r = await fetch('/version.json', { cache: 'no-store', credentials: 'omit' });
      if (!r.ok) return null;
      const d = await r.json();
      return d && typeof d.v === 'string' && d.v.length && d.v.length <= 100 ? d.v : null;
    } catch { return null; }
  }

  // True while the player is in the middle of something that a reload would interrupt.
  function busy() {
    try {
      if (window.RyoPayments?.state?.busy || window.AdventureChest?.snapshot?.busy) return true;
      const pending = window.BetaWallet?.pendingDeposits; if (typeof pending === 'function' ? pending.call(window.BetaWallet).length : pending) return true;   // a getter (count) in the game, tolerate a function
      if (window.LoginScreen?.active || window.GameLoading?.active) return true;
      if (window.V2?.isBossActive?.()) return true;
      if (document.querySelector('dialog[open]')) return true;
    } catch { return true; }
    return false;
  }

  function show() {
    if (banner) return;
    const style = document.createElement('style');
    style.textContent = '.sb-autoupdate{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;display:flex;gap:12px;align-items:center;max-width:calc(100vw - 24px);padding:10px 14px;border-radius:12px;background:rgba(18,16,30,.96);border:1px solid rgba(255,214,120,.55);color:#f4eddc;font:600 14px/1.3 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45)}.sb-autoupdate button{cursor:pointer;border:0;border-radius:8px;padding:7px 12px;background:#f2b84b;color:#1b1406;font:700 13px system-ui,sans-serif}';
    document.head.append(style);
    banner = document.createElement('div'); banner.className = 'sb-autoupdate'; banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = '<span data-au-text></span><button type="button" data-au-now>Reload now</button>';
    banner.querySelector('[data-au-now]').addEventListener('click', () => go());
    document.body.append(banner); paint();
  }
  function paint() {
    const t = banner?.querySelector('[data-au-text]'); if (!t) return;
    t.textContent = busy() ? 'New update available. Reloading as soon as you finish what you are doing.' : 'New update available. Reloading in ' + left + ' s.';
  }

  // Send the last kills the normal way (at most FLUSH_MAX), then reload. Sign-in and the Adventure stage come back by themselves.
  async function go() {
    if (reloading) return; reloading = true; clearInterval(timer);
    remember(latest);
    try {
      if (window.RyoPayments?.state?.authenticated) await Promise.race([Promise.resolve(window.RyoPayments.adventure(false, false)).catch(() => {}), new Promise(r => setTimeout(r, FLUSH_MAX))]);
    } catch { /* reload anyway */ }
    location.reload();
  }

  function tick() {
    if (reloading) return;
    paint();
    if (document.hidden || busy()) return;   // paused: the countdown resumes when the player is free and the tab is visible
    if (--left <= 0) go(); else paint();
  }

  function start(v) {
    const g = guard();
    if (g.v === v || (g.at && Date.now() - g.at < MIN_GAP)) return;   // already reloaded for this version, or reloaded a moment ago
    latest = v; left = COUNTDOWN; show();
    clearInterval(timer); timer = setInterval(tick, 1000);
  }

  async function check() {
    if (polling || reloading || document.hidden || timer) return;
    polling = true;
    try {
      const v = await version(); if (!v) return;
      if (known === null) { known = v; return; }
      if (v !== known) start(v);
    } finally { polling = false; }
  }

  check();
  setInterval(check, POLL);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.AutoUpdate = Object.freeze({ check, get known() { return known; }, get pending() { return !!timer; } });
})();
