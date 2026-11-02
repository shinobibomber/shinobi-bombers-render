/* Presentation for the native startup gate. Artwork stays intact; progress is real. */
(() => {
  const api = window.LoadingDesign = {
    ready: null, fail,
    source: 'loading_enhanced_reference.png',
    sha256: 'fcdca38ba5926100306824e0e372258f69f3d72bc8815e708423aa7a3515c3e7'
  };
  const screen = document.getElementById('gameLoading');
  if (!screen) { api.ready = Promise.resolve(); return; }
  const progress = document.getElementById('loadingProgress');
  const status = document.getElementById('loadingStatus');
  const stage = document.createElement('div'); stage.className = 'loading-reference-stage';
  const image = new Image(1536, 1024); image.className = 'loading-reference-art';
  image.alt = ''; image.setAttribute('aria-hidden', 'true'); image.draggable = false;
  const artwork = new Promise((resolve, reject) => {
    image.onload = () => image.naturalWidth === 1536 && image.naturalHeight === 1024
      ? resolve() : reject(Error('Loading artwork has unexpected dimensions.'));
    image.onerror = () => reject(Error('Loading artwork could not load. Check your connection and retry.'));
  });
  image.src = new URL('loading-reference.png', document.currentScript.src).href;
  stage.append(image);

  const percent = document.createElement('strong'); percent.id = 'loadingPercent';
  percent.setAttribute('aria-hidden', 'true');
  // Draw the supplied wave texture inside the live bar, never its illustrated 75%.
  const fillArt = document.createElement('span'); fillArt.className = 'loading-fill-art';
  progress.querySelector('i').append(fillArt);
  const retry = document.createElement('button'); retry.id = 'loadingRetry';
  retry.type = 'button'; retry.textContent = 'Retry loading'; retry.hidden = true;
  retry.addEventListener('click', () => location.reload());
  const title = document.createElement('h2'); title.className = 'loading-accessible-title';
  title.textContent = 'Preparing the Hidden Village';
  const tip = document.createElement('p'); tip.className = 'loading-accessible-tip';
  tip.textContent = 'Ninja tip: Fuse three eligible heroes of the same rank to unlock the next rarity.';
  stage.append(title, tip, percent, progress, status, retry);
  const viewport = document.createElement('div'); viewport.className = 'loading-reference-viewport';
  viewport.append(stage); screen.append(viewport); screen.classList.add('loading-reference-active');
  screen.setAttribute('aria-busy', 'true');

  function update() {
    const max = Number(progress.getAttribute('aria-valuemax')) || 3;
    const step = Number(progress.getAttribute('aria-valuenow')) || 0;
    percent.textContent = Math.round(Math.min(1, Math.max(0, step / max)) * 100) + '%';
    if (step === max) screen.setAttribute('aria-busy', 'false');
  }
  const changes = new MutationObserver(update);
  changes.observe(progress, { attributes: true, attributeFilter: ['aria-valuenow'] });
  update();
  const removed = new MutationObserver(() => { if (!screen.isConnected) cleanup(); });
  removed.observe(document.body, { childList: true });
  function cleanup() { changes.disconnect(); removed.disconnect(); }
  addEventListener('pagehide', cleanup, { once: true });

  // Login is the next view, so its artwork must also be ready before the gate
  // transitions. Rejection holds startup until an explicit retry.
  api.ready = Promise.all([artwork, window.LoginDesign?.ready]).catch(fail);
  function fail(error) {
    screen.classList.add('loading-failed'); screen.setAttribute('aria-busy', 'false');
    status.textContent = error?.message || 'The village could not finish loading. Please retry.';
    status.setAttribute('role', 'alert');
    retry.hidden = false;
    retry.focus({ preventScroll: true });
    // A reload retries existing initialization once, with all game saves intact.
    return new Promise(() => {});
  }
})();
