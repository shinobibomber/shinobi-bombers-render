/* Reveal-only artwork. Model identity still comes from PlayerModels, never rarity. */
(() => {
  'use strict';
  const source = new URL('reveal-models-hd.png', document.currentScript.src);
  // Measured alpha bounds plus padding, not a guessed uniform grid. Purple
  // hair crosses an equal-width tile boundary and must not bleed into Storm.
  const rectangles = [[25, 74, 290, 550], [318, 74, 330, 550], [650, 74, 302, 550], [954, 74, 290, 550],
    [25, 650, 294, 550], [324, 650, 303, 550], [630, 650, 312, 550], [954, 650, 285, 550]];
  let image = null, pending = null, status = 'idle';
  window.RevealModels = { load, frame, get status() { return status; } };

  function load(retry = false) {
    if (pending && !(retry && status === 'error')) return pending;
    status = 'loading';
    pending = new Promise(resolve => {
      const candidate = new Image();
      candidate.decoding = 'async';
      let settled = false;
      const finish = success => {
        if (settled) return;
        settled = true; clearTimeout(timeout);
        candidate.onload = candidate.onerror = null;
        image = success ? candidate : null;
        status = success ? 'ready' : 'error';
        resolve(success);
      };
      // A failed optional preview must never block saved results or Continue.
      const timeout = setTimeout(() => finish(false), 15000);
      candidate.onerror = () => finish(false);
      candidate.onload = async () => {
        try {
          await candidate.decode();
          finish(candidate.naturalWidth === 1254 && candidate.naturalHeight === 1254);
        } catch { finish(false); }
      };
      candidate.src = source.href;
    });
    return pending;
  }

  function frame(hero) {
    if (status !== 'ready') return null;
    const model = PlayerModels.modelFor(hero).index;
    return { image, model, rect: rectangles[model] };
  }
})();
