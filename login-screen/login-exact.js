/* Presentation only: retain the original wallet handlers and configured community links. */
(() => {
  const api = window.LoginDesign = { ready: null };
  const screen = document.getElementById('loginScreen');
  const content = screen?.querySelector('.login-content');
  if (!content) { api.ready = Promise.resolve(); return; }
  const viewport = document.createElement('div'); viewport.className = 'login-reference-viewport';
  content.before(viewport); viewport.append(content);

  const art = new Image(1536, 1024);
  art.className = 'login-reference-art';
  art.alt = '';
  art.setAttribute('aria-hidden', 'true');
  art.draggable = false;
  api.ready = new Promise((resolve, reject) => {
    art.onload = () => art.naturalWidth === 1536 && art.naturalHeight === 1024
      ? resolve() : reject(Error('The login artwork has unexpected dimensions. Please reload.'));
    art.onerror = () => reject(Error('The login artwork could not load. Check your connection and retry.'));
  });
  // GameLoading awaits this promise before exposing sign-in. No wallet action is
  // added here; the original buttons retain their original click handlers.
  api.ready.catch(() => {});
  art.src = new URL('login-reference.png', document.currentScript.src).href;
  content.prepend(art);

  document.getElementById('loginPhantom').setAttribute('aria-label', 'Sign in with Phantom');
  document.getElementById('loginSolflare').setAttribute('aria-label', 'Sign in with Solflare');
  screen.setAttribute('aria-describedby', 'loginSignatureNotice');
  screen.querySelector('.login-disclaimer').id = 'loginSignatureNotice';
  // The existing login flow focuses Phantom on entry. Paint a focus ring only
  // after keyboard navigation, so that initial focus does not alter the artwork.
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !screen.hidden) screen.classList.add('login-keyboard-navigation');
  });
  screen.addEventListener('pointerdown', () => screen.classList.remove('login-keyboard-navigation'));
  screen.classList.add('reference-login-exact');
})();
