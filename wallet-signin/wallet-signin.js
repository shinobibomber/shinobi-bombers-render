/* Sign-in on every browser (owner request 2026-11-12; build step apply-signin.cjs).
 *
 * The game signs in with the Phantom or Solflare wallet that the browser provides (an extension on a computer, or the wallet's
 * own in-app browser on a phone). A phone browser such as Safari or Chrome has no wallet inside, so before this the buttons
 * only showed "Install Phantom or open this site in its mobile app browser." with nothing to tap.
 *
 * Now, when the chosen wallet is not available in this browser:
 *  - on a phone or tablet: the button opens this same page inside the chosen wallet app, using the wallets' official
 *    "browse" links (https://phantom.app/ul/browse/... and https://solflare.com/ul/v1/browse/...). If the app is not
 *    installed, those pages offer the download. Sign-in then happens inside the wallet app as usual;
 *  - on a computer: the message offers the official download page.
 * When the wallet IS available (desktop extension, or already inside the wallet app), nothing changes: the game's own
 * sign-in runs. A short hint tells phone players what the buttons do. No signing, payment or account logic lives here. */
(() => {
  if (window.WalletSignin) return;
  const NAMES = { phantom: 'Phantom', solflare: 'Solflare' };
  const DOWNLOAD = { phantom: 'https://phantom.com/download', solflare: 'https://solflare.com/download' };
  const provider = kind => kind === 'phantom' ? (window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null)) : window.solflare;
  const available = kind => { const p = provider(kind); return !!(p && p.connect && p.signTransaction); };
  const mobile = () => navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(navigator.userAgent || '') ||
    (/Macintosh/.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1);   // iPadOS reports a desktop Safari user agent
  const page = () => location.origin + location.pathname + location.search;
  function appLink(kind) {
    const url = encodeURIComponent(page()), ref = encodeURIComponent(location.origin);
    return kind === 'phantom' ? 'https://phantom.app/ul/browse/' + url + '?ref=' + ref : 'https://solflare.com/ul/v1/browse/' + url + '?ref=' + ref;
  }
  function say(parts) {
    const box = document.querySelector('#loginScreen #loginMessage'); if (!box) return;
    box.replaceChildren(...parts.map(p => {
      if (typeof p === 'string') return document.createTextNode(p);
      const a = document.createElement('a'); a.href = p.href; a.textContent = p.text; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.color = '#ffd36b'; return a;
    }));
  }

  // Capture phase: runs before the game's own click handler; only steps in when the chosen wallet is missing.
  document.addEventListener('click', e => {
    const button = e.target?.closest?.('#loginScreen #loginPhantom, #loginScreen #loginSolflare');
    if (!button || button.disabled) return;
    const kind = button.id === 'loginPhantom' ? 'phantom' : 'solflare';
    if (available(kind)) return;   // the wallet is here: the game's normal sign-in runs
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
    if (mobile()) {
      say(['Opening ' + NAMES[kind] + '… Sign in there to play. If nothing happens, ', { href: appLink(kind), text: 'tap here' }, '.']);
      window.WalletSignin.opened = appLink(kind);
      location.href = appLink(kind);
    } else {
      say([NAMES[kind] + ' is not installed in this browser. ', { href: DOWNLOAD[kind], text: 'Get ' + NAMES[kind] }, ', then refresh this page.']);
    }
  }, true);

  // A short hint for phone players in a normal browser (not inside a wallet app, where sign-in works directly). It uses the
  // login screen's own status box (the only free space on the poster) and only while that box is empty; any real status or
  // error from the game replaces it.
  const HINT = 'On a phone? Tap Phantom or Solflare to open the game in your wallet app.';
  function hint() {
    const box = document.querySelector('#loginScreen #loginMessage');
    if (!box) return false;
    const show = mobile() && !available('phantom') && !available('solflare');
    if (show && !box.textContent.trim()) { box.textContent = HINT; box.dataset.sbHint = '1'; }
    else if (!show && box.dataset.sbHint === '1' && box.textContent === HINT) { box.textContent = ''; delete box.dataset.sbHint; }
    return true;
  }
  const start = () => { if (!hint()) { let n = 0; const t = setInterval(() => { if (hint() || ++n > 40) clearInterval(t); }, 250); } setTimeout(hint, 1500); setTimeout(hint, 4000); };   // wallets may inject a little after load
  if (document.readyState === 'complete') start(); else addEventListener('load', start);

  window.WalletSignin = { appLink, available, mobile, hint, opened: null };
})();
