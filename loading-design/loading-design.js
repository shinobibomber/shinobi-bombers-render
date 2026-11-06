/* Compact startup gate. The login screen shows as soon as its artwork is ready; the game keeps
   preparing sprites and maps behind it (GameLoading.active stays true, so battle waits), and this
   card returns after sign-in only while that work is unfinished. Progress is the gate's real work. */
(() => {
  const api = window.LoadingDesign = { ready: null, fail };
  const screen = document.getElementById('gameLoading');
  if (!screen) { api.ready = Promise.resolve(); return; }
  const progress = document.getElementById('loadingProgress');
  const status = document.getElementById('loadingStatus');
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
  const removed = new MutationObserver(() => { if (!screen.isConnected) { changes.disconnect(); removed.disconnect(); } });
  removed.observe(document.body, { childList: true });

  // Only the login artwork gates sign-in. A failure holds startup until an explicit retry.
  api.ready = Promise.resolve(window.LoginDesign?.ready).catch(fail);
  api.ready.then(() => { if (window.GameLoading?.active && !window.LoginScreen?.active) window.LoginScreen?.show(); });

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
