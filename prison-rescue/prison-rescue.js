/* Prison rescue client (apply-prison-rescue.cjs). When a signed-in player frees an Adventure prisoner, the SERVER grants a real,
 * account-bound hero (prison-rescue/server.cjs) and the existing "Hero rescued" reveal plays. The kill report is sent first so
 * the server can verify the prison kill. The client checks in once per page load (so progress from earlier page sessions is
 * counted) and, while a freed prisoner is waiting for enough verified battle, asks again quietly after later Chest syncs.
 * Signed-out practice play keeps the old local practice hero (the native branch in boom). */
(() => {
  'use strict';
  const RETRY_MS = 1600, BACKGROUND_MS = 20000;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let queue = Promise.resolve(), waiting = false, checked = false, lastAsk = 0, busy = false, hideTimer = 0;

  const style = document.createElement('style');
  style.textContent = '.prison-rescue-toast{position:fixed;left:50%;bottom:84px;transform:translate(-50%,12px);max-width:min(92vw,460px);padding:10px 16px;border:1px solid #c9a35a;border-radius:8px;background:#141c26ee;color:#f6ead2;font:600 14px/1.35 system-ui,sans-serif;text-align:center;z-index:9000;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s}.prison-rescue-toast.show{opacity:1;transform:translate(-50%,0)}';
  const box = document.createElement('div');
  box.className = 'prison-rescue-toast'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
  function toast(text) {
    if (!box.isConnected) document.body.append(style, box);
    box.textContent = text; box.classList.add('show');
    clearTimeout(hideTimer); hideTimer = setTimeout(() => box.classList.remove('show'), 5000);
  }
  const online = () => !!(window.RyoPayments?.state?.authenticated && typeof window.RyoPayments.prisonRescue === 'function');
  const float = (at, text) => { try { if (at) fl.push({ x: at.x, y: at.y, t: 1, s: text }); } catch {} };

  // Send the latest kill totals (including the prison kill) before asking, so the server has verified it.
  async function report() {
    for (let i = 0; i < 3; i++) {
      try { await window.AdventureChest?.refresh?.(); } catch {}
      if (!(window.KillReport?.pending > 0)) return;
      await wait(400);
    }
  }
  async function reveal(hero) {
    const owner = window.RyoPayments.state.account, find = () => S.h.find(h => h.tokenId === hero?.tokenId && h.tokenOwner === owner);
    try { window.TokenCheckout?.syncProfile?.(); } catch {}
    // The grant is saved even if the follow-up state did not arrive: fetch it, then reveal.
    if (!find()) { try { await window.RyoPayments.refresh(); window.TokenCheckout?.syncProfile?.(); } catch {} }
    const local = find();
    if (local && window.Experience?.presentRescue) window.Experience.presentRescue(local);
    else toast('A rescued hero joined your collection.');
  }

  // fresh = a prison kill just happened on screen (show messages, retry while the kill report lands);
  // otherwise a quiet check (once per page load, or for a waiting prisoner).
  async function ask(at, fresh) {
    if (!online()) return;
    const owner = window.RyoPayments.state.account, requestId = crypto.randomUUID();   // same id on every retry: a lost answer replays
    busy = true; lastAsk = Date.now();
    try {
      for (let attempt = 0, failures = 0; ; attempt++) {
        if (!online() || window.RyoPayments.state.account !== owner) return;
        if (fresh && attempt < 4) await report();
        let r;
        try { r = (await window.RyoPayments.prisonRescue({ requestId })).prisonRescue; }
        catch (error) {
          // Network trouble or a server hiccup: ask again with the SAME request id (a grant that already happened is replayed).
          if ((!error.status || error.status >= 500) && ++failures <= 2) { await wait(RETRY_MS); continue; }
          if (fresh) { waiting = true; toast(error.message || 'The rescue could not be confirmed. It will be retried.'); }
          return;
        }
        if (!r) return;
        checked = true; waiting = Number(r.waiting) > 0;
        if (r.status === 'granted') { float(at, 'HERO RESCUED'); await reveal(r.hero); return; }
        if ((r.status === 'unverified' || r.status === 'inactive') && fresh && attempt < 3) { await wait(RETRY_MS); continue; }
        if (r.status === 'unverified' && fresh) { waiting = true; toast('Prisoner freed! Your rescue hero is being verified and will arrive shortly.'); }
        else if (r.status === 'inactive') { checked = false; if (fresh) waiting = true; }
        else if (r.status === 'early' && fresh) toast('Prisoner freed! Your rescue hero joins you after a bit more battle (' + Math.max(0, Math.min(99, Number(r.progress) || 0)) + '% there).');
        else if (r.status === 'full') toast('Your collection is full (500 heroes). Free a slot and your rescued hero will join you.');
        else if (r.status === 'pending' && fresh) toast('A purchase is still settling. Your rescued hero joins you right after.');
        return;
      }
    } finally { busy = false; lastAsk = Date.now(); }
  }
  const enqueue = (at, fresh) => { queue = queue.then(() => ask(at, fresh)).catch(() => {}); return queue; };

  // After a Chest sync: the once-per-page-load check, then quiet re-asks while a prisoner waits (at most every 20 s).
  addEventListener('shinobi-chest', () => {
    if ((checked && !waiting) || busy || !online() || window.AdventureChest?.snapshot?.busy || Date.now() - lastAsk < BACKGROUND_MS) return;
    lastAsk = Date.now(); enqueue(null, false);
  });
  addEventListener('shinobi-beta-wallet', () => { checked = false; lastAsk = 0; });

  window.PrisonRescue = { online, claim: at => enqueue(at || null, true), get waiting() { return waiting; }, get checked() { return checked; } };
})();
