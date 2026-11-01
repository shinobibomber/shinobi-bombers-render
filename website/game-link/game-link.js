/* Shinobi Bombers game link – connects existing website controls to the real game without changing the design.
 *
 * The real game (Canvas engine, wallet sign-in, server-verified Ryo, Chest, heroes, saves) runs as its own complete
 * page at SB_SITE_CONFIG.gameUrl, as the transfer package requires. This module never calls the game API, never reads
 * or sends balances, sessions or keys, and never uses postMessage. It only:
 *   • opens the game from the website's matching controls (handoff), and
 *   • stops the website from showing demo numbers or simulating economics when a real game is connected.
 *
 * Preview mode (no gameUrl): the website keeps its existing demo behaviour; the wallet pill opens the #play page.
 */
(() => {
  'use strict';
  const cfg = window.SB_SITE_CONFIG || {};
  const raw = typeof cfg.gameUrl === 'string' ? cfg.gameUrl.trim() : '';
  const valid = raw !== '' && (/^\/(?!\/)/.test(raw) || /^https?:\/\/[^\s"'<>]+$/i.test(raw));
  const gameUrl = valid ? new URL(raw, location.href).href : '';
  const live = !!gameUrl;
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* website action → where it lives in the real game */
  const GAME = {
    'chest': ['Your Chest', 'the Chest button in the game header', 'Claim moves verified Adventure Ryo into your game balance. Deposit and Withdraw use the game\'s own review, fees, cooldown and wallet steps.'],
    'deposit': ['Adding Ryo (Deposit)', 'Chest → Deposit Ryo', 'Deposits are credited only after the transaction is finalized on Solana Devnet.'],
    'summon:summon': ['Summoning', 'Summon'], 'summon:gallery': ['Your hero collection', 'Heroes'], 'summon:history': ['Summon history', 'Chest → Transaction History'],
    'fusion:fuse': ['Fusion', 'Fusion'], 'fusion:batch': ['Batch fusion', 'Fusion'],
    'market:buy': ['Buying heroes', 'Market', 'The current game market is a local practice market. Server-owned heroes are protected from it, and cross-player trading is not available yet.'],
    'market:offer': ['Offers', 'Market', 'The current game market is a local practice market; cross-player offers are not available yet.'],
    'market:listings': ['Seller listings', 'Market'],
    'boss-hunt:challenge': ['Boss Hunt battles', 'Boss Hunt', 'Boss Hunt is a local solo encounter. Its rewards are not server-verified, withdrawable Ryo.'],
    'boss-hunt:team': ['Team management', 'Heroes'],
    'adventure:work': ['Your Adventure team', 'Adventure'], 'adventure:rest': ['Your Adventure team', 'Adventure'], 'adventure:hero': ['Your Adventure team', 'Adventure'],
    'heroes:train': ['Hero training', 'Heroes'], 'heroes:ready': ['Battle-ready / Reserve', 'Heroes'], 'heroes:reserve': ['Battle-ready / Reserve', 'Heroes'],
    'heroes:deploy': ['Deploying heroes (max 10)', 'Heroes'], 'heroes:sell': ['Selling heroes', 'Market', 'Only local practice listings exist in the current game.'],
    'dojo:upgrade': ['Dojo upgrades', 'Dojo'], 'dojo:hire': ['Sensei hire / on-off', 'Dojo → Sensei'], 'dojo:ret': ['Sensei return threshold', 'Dojo → Sensei']
  };
  /* website actions for services the game does not have */
  const UNSUPPORTED = {
    'boss-hunt:ranking': 'Boss Hunt rankings',
    'guild:notice': 'Guild', 'guild:donate': 'Guild', 'guild:lastresult': 'Guild', 'guild:announce': 'Guild', 'guild:benefits': 'Guild', 'guild:glock': 'Guild',
    'chat:send': 'Chat', 'chat:party': 'Chat', 'chat:invite': 'Chat', 'chat:report': 'Chat', 'chat:whisper': 'Chat', 'chat:online': 'Chat', 'chat:attach': 'Chat'
  };

  let app = null, playEl = null, lastFocus = null;

  function handoff(key) {
    const [feature, where, note] = GAME[key] || ['This feature', 'the game menu'];
    if (!app) { location.href = gameUrl; return; }
    app.modal({
      title: esc(feature) + ' runs in the game',
      html: `<div class="sbg-hand"><p><b>${esc(feature)}</b> uses your wallet, saved heroes and server-verified balances, so it runs in the live Shinobi Bombers game, not on this page.</p>
        <p>Open the game, sign in with Phantom or Solflare, then choose <b>${esc(where)}</b>.</p>${note ? `<p>${esc(note)}</p>` : ''}
        <div class="sbg-actions"><a class="sbg-btn" data-sbg-open href="${esc(gameUrl)}" target="_blank" rel="noopener">Open game ↗</a></div></div>`,
      buttons: [{ t: 'Stay here', alt: 1 }],
      onOpen: m => { const a = m.querySelector('[data-sbg-open]'); a.addEventListener('click', () => setTimeout(() => app.closeModal(), 0)); a.focus(); }
    });
  }
  function unsupported(svc) {
    app && app.toast(`${svc} isn't available yet: the game has no ${svc} service. This page is a design preview.`);
  }

  const SBGame = {
    live, gameUrl,
    /* called by app.js before the first screen is built */
    attach(a) {
      app = a;
      if (!live) return;
      const wrap = (key, fn) => { const [s, f] = key.split(':'); const mods = a.MODS[s]; if (mods && typeof mods[f] === 'function') mods[f] = fn(mods[f]); };
      Object.keys(GAME).filter(k => k.includes(':')).forEach(k => wrap(k, () => () => handoff(k)));
      Object.keys(UNSUPPORTED).forEach(k => wrap(k, () => () => unsupported(UNSUPPORTED[k])));
      wrap('market:mtab', orig => (arg, el) => (String(arg) === '3' ? handoff('market:listings') : orig(arg, el)));
      if (window.SB) window.SB.openChest = () => handoff('chest');
    },
    /* website actions that have a direct game counterpart */
    intercept(action) {
      if (action === 'wallet') { location.hash = 'play'; return true; }
      if (action === 'deposit') { if (live) handoff('deposit'); else window.SB && window.SB.openChest(); return true; }
      if (action === 'chest' && live) { handoff('chest'); return true; }
      return false;
    },
    /* guards for economic code paths that are reachable without a website action (e.g. "Summon now" in a dialog) */
    gate(screen, fn) { if (!live) return false; handoff(screen + ':' + fn); return true; },
    /* live mode: never show demo account values next to a real game */
    paintHeader() {
      document.querySelectorAll('.lv-ryo').forEach(e => { e.textContent = '— Ryo'; });
      document.querySelectorAll('.lv-chest').forEach(e => { e.textContent = 'Chest'; });
      document.querySelectorAll('.cdot').forEach(e => { e.hidden = true; });
      document.querySelectorAll('.chestbtn').forEach(e => e.setAttribute('aria-label', 'Open your Chest in the game'));
    },
    decorate(k, stage, data) {
      if (!live || !data.hdr) return;
      for (const [key, text, label] of [['wallet', 'Sign in', 'Sign in with your wallet in the game'], ['gems', '—', '']]) {
        const t = data.hdr[key]; if (!t) continue;
        const c = document.createElement('span'); c.className = 'sbg-cover'; c.textContent = text; if (!label) c.setAttribute('aria-hidden', 'true');
        Object.assign(c.style, { left: t.x + 'px', top: t.y + 'px', width: t.w + 'px', height: t.h + 'px', background: t.bg, fontSize: t.fs + 'px' });
        stage.appendChild(c);
      }
      const w = stage.querySelector('.hs[data-id="wallet"]'); if (w) w.setAttribute('aria-label', 'Sign in with your wallet in the game');
    },
    showPlay() {
      if (!playEl) playEl = buildPlay();
      lastFocus = document.activeElement;
      playEl.hidden = false; document.body.style.overflow = 'hidden';
      if (app && app.root) app.root.inert = true;
      playEl.querySelector('.sbg-x').focus();
    },
    hidePlay() {
      if (!playEl || playEl.hidden) return;
      playEl.hidden = true; document.body.style.overflow = '';
      if (app && app.root) app.root.inert = false;
      const f = playEl.querySelector('iframe'); if (f) f.removeAttribute('src');
      const d = playEl.querySelector('details'); if (d) d.open = false;
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
  };

  function buildPlay() {
    const el = document.createElement('div');
    el.className = 'sbg-play'; el.hidden = true;
    el.innerHTML = `<section class="sbg-panel" role="dialog" aria-modal="true" aria-labelledby="sbg-title">
      <button class="sbg-x" type="button" aria-label="Close">✕</button>
      <h1 id="sbg-title">PLAY SHINOBI BOMBERS</h1>
      <p class="sbg-sub">Wallet sign-in, heroes, Ryo and the Chest live in the game. This website shows the designs.</p>
      <div class="sbg-status"><span class="sbg-dot${live ? ' sbg-live' : ''}"></span>${live
        ? `<span>Game connected · <code>${esc(gameUrl)}</code></span>`
        : '<span>Preview mode: no game connected. This website is showing demo values.</span>'}</div>
      <div class="sbg-actions">${live
        ? `<a class="sbg-btn" href="${esc(gameUrl)}">▶ Play now</a><a class="sbg-btn sbg-alt" href="${esc(gameUrl)}" target="_blank" rel="noopener">Open in new tab ↗</a>`
        : '<a class="sbg-btn" aria-disabled="true" tabindex="-1">▶ Play now</a>'}</div>
      ${live ? '' : '<p>To connect your game, set <b>gameUrl</b> in <b>site-config.js</b>, or run the site with <b>server/site-server.cjs</b>, which serves the game at <b>/play/</b>. See the project README.</p>'}
      <h2>What runs where</h2>
      <div class="sbg-grid">
        <div><b>Adventure · Heroes · Summoning · Fusion<span class="sbg-tag sbg-ok">IN GAME</span></b>Server-verified ownership, chakra, deployment (max 10) and saved progress.</div>
        <div><b>Dojo · Sensei · Chest<span class="sbg-tag sbg-ok">IN GAME</span></b>Claim, Deposit, Withdraw and History use the game's real fees, cooldowns and wallet steps.</div>
        <div><b>Boss Hunt · Market<span class="sbg-tag sbg-local">LOCAL IN GAME</span></b>Solo boss encounters and practice listings. Not server-verified rewards or trading.</div>
        <div><b>Guild · Chat · NFT trading<span class="sbg-tag sbg-no">NOT AVAILABLE YET</span></b>The game has no backend for these. Their pages here are design previews.</div>
      </div>
      ${live && cfg.embedPreview !== false ? `<details><summary>Preview the game inside this page</summary>
        <p>Wallet extensions and mobile wallets may not sign in inside an embedded frame. If sign-in does not work, use <b>Play now</b>.</p>
        <iframe class="sbg-frame" title="Shinobi Bombers game preview" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></details>` : ''}
    </section>`;
    const close = () => { if (location.hash === '#play') { history.length > 1 ? history.back() : (location.hash = 'home'); } SBGame.hidePlay(); };
    el.querySelector('.sbg-x').addEventListener('click', close);
    el.addEventListener('click', e => { if (e.target === el) close(); });
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const f = [...el.querySelectorAll('button,a[href],summary,iframe')].filter(x => x.offsetParent !== null);
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    const d = el.querySelector('details');
    if (d) d.addEventListener('toggle', () => { const f = d.querySelector('iframe'); if (d.open && !f.getAttribute('src')) f.src = gameUrl; });
    document.body.appendChild(el);
    return el;
  }

  window.SBGame = SBGame;
})();
