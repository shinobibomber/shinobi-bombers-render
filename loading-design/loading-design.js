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
  const image = screen.querySelector('.loading-reference-art');
  const artwork = new Promise((resolve, reject) => {
    const loaded = () => image.naturalWidth === 1536 && image.naturalHeight === 1024
      ? image.decode().then(resolve, reject) : reject(Error('Loading artwork has unexpected dimensions.'));
    image.onload = loaded;
    image.onerror = () => reject(Error('Loading artwork could not load. Check your connection and retry.'));
    if (image.complete) image.naturalWidth ? loaded() : image.onerror();
  });
  const percent = document.getElementById('loadingPercent');
  const retry = document.getElementById('loadingRetry');
  retry.addEventListener('click', () => location.reload());

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
  function cleanup() { changes.disconnect(); removed.disconnect(); image.onload = image.onerror = null; }
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
