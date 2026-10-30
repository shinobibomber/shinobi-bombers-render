/* Presentation only: retain the original wallet handlers and configured community links. */
(() => {
  const screen = document.getElementById('loginScreen');
  const content = screen?.querySelector('.login-content');
  if (!content) return;

  const art = new Image(1536, 1024);
  art.className = 'login-reference-art';
  art.alt = '';
  art.setAttribute('aria-hidden', 'true');
  art.draggable = false;
  art.src = 'assets/design-v3/ref-login.png';
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
