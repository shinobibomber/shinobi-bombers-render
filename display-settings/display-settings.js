/* Display & Accessibility settings (presentation only: never damage, hitboxes, timers or rewards).
   Presets Comfort (default) / Minimal / Standard plus individual controls. Saved in this browser
   (localStorage 'sb-display-v1') and synced to the signed-in account (profile.display). Applied live:
   scene brightness/contrast (CSS filter on the game canvases only), effects level (Arena3D.setFx),
   explosions (full / reduced / off = static tile markers), flashing, screen shake, reduce motion,
   bloom & glow, high contrast and colorblind-friendly indicators. */
(() => {
  const KEY = 'sb-display-v1';
  const PRESETS = {
    comfort: { brightness: 65, explosions: 'reduced', flashing: false, shake: false, reduceMotion: true, bloom: false, highContrast: false, colorblind: false },
    minimal: { brightness: 65, explosions: 'off', flashing: false, shake: false, reduceMotion: true, bloom: false, highContrast: false, colorblind: false },
    standard: { brightness: 100, explosions: 'full', flashing: true, shake: true, reduceMotion: false, bloom: true, highContrast: false, colorblind: false }
  };
  const BOOLS = ['flashing', 'shake', 'reduceMotion', 'bloom', 'highContrast', 'colorblind'], EXPLOSIONS = ['full', 'reduced', 'off'];
  const clean = (raw) => {
    const d = { preset: 'comfort', ...PRESETS.comfort, updated: 0 };
    if (!raw || typeof raw !== 'object') return d;
    if (['comfort', 'minimal', 'standard', 'custom'].includes(raw.preset)) d.preset = raw.preset;
    const b = Math.round(Number(raw.brightness)); if (Number.isFinite(b)) d.brightness = Math.max(20, Math.min(100, b));
    if (EXPLOSIONS.includes(raw.explosions)) d.explosions = raw.explosions;
    for (const k of BOOLS) if (typeof raw[k] === 'boolean') d[k] = raw[k];
    const u = Number(raw.updated); if (Number.isFinite(u) && u > 0) d.updated = u;
    return d;
  };
  const read = () => { try { return clean(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return clean(null); } };
  const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
  let v = read(), pushTimer = 0, pushedAt = 0;
  const api = window.DisplaySettings = {
    PRESETS, get v() { return v; }, get: () => ({ ...v }), set, preset, reset, open, apply, clean,
    // Arena helper: Off explosions draw a static marker on the hit tile instead of a burst.
    explosions: () => v.explosions
  };

  function set(patch, { preset: keep, from } = {}) {
    const next = clean({ ...v, ...patch });
    if (!keep) next.preset = matching(next);
    next.updated = from === 'account' ? next.updated : Date.now();
    v = next; write(v); apply();
    if (from !== 'account') schedulePush();
    dispatchEvent(new CustomEvent('sb-display-change', { detail: { ...v } }));
  }
  function matching(d) { for (const [name, p] of Object.entries(PRESETS)) if (Object.keys(p).every(k => p[k] === d[k])) return name; return 'custom'; }
  function preset(name) { if (PRESETS[name]) set({ ...PRESETS[name], preset: name }, { preset: true }); }
  function reset() { preset('comfort'); }

  // ---------- applying ----------
  function apply() {
    const root = document.documentElement;
    // 100% = the original picture; 20% is a deep dim. Only the game scene canvases are filtered.
    root.style.setProperty('--sb-bright', (0.3 + 0.7 * v.brightness / 100).toFixed(3));
    root.style.setProperty('--sb-contrast', v.highContrast ? '1.22' : '1');
    root.classList.toggle('sb-no-flash', !v.flashing);
    root.classList.toggle('sb-no-shake', !v.shake);
    root.classList.toggle('sb-reduce-motion', v.reduceMotion);
    root.classList.toggle('sb-no-bloom', !v.bloom);
    root.classList.toggle('sb-high-contrast', v.highContrast);
    root.classList.toggle('sb-colorblind', v.colorblind);
    root.dataset.sbExplosions = v.explosions;
    // The game's existing effects level drives particles, weather and aura animation everywhere.
    const level = v.explosions === 'off' ? 0 : v.explosions === 'full' && v.bloom && !v.reduceMotion ? 2 : 1;
    try { if (window.Arena3D?.setFx && Arena3D.cfg.fx !== level) Arena3D.setFx(level); } catch {}
  }
  apply();
  addEventListener('DOMContentLoaded', apply);
  addEventListener('load', apply);

  // ---------- account sync (newer settings win) ----------
  function account() { const s = window.RyoPayments?.state; return s?.authenticated ? s : null; }
  function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(push, 1200); }
  async function push() {
    const s = account(); if (!s || !window.RyoPayments?.displaySettings) return;
    if (Number(s.profile?.display?.updated || 0) >= v.updated) return;
    try { pushedAt = Date.now(); await RyoPayments.displaySettings({ ...v }); } catch {}
  }
  setInterval(() => {
    const s = account(); if (!s) return;
    const remote = s.profile?.display;
    if (remote && Number(remote.updated) > v.updated) { v = clean(remote); write(v); apply(); dispatchEvent(new CustomEvent('sb-display-change', { detail: { ...v } })); render(); }
    else if (v.updated > Number(remote?.updated || 0) && Date.now() - pushedAt > 8000) schedulePush();
  }, 3000);

  // ---------- settings dialog ----------
  let dlg = null, raf = 0;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const PRESET_TEXT = {
    comfort: ['🟢 Comfort', 'Softer effects, no flashes or shaking. Recommended.'],
    minimal: ['🌙 Minimal effects', 'Least stimulation: no decorative explosions, still motion.'],
    standard: ['🔥 Standard', 'Richer effects, glow and optional shake. No strobing.']
  };
  const toggle = (k, label, hint) => `<label class="sbds-row"><span><b>${label}</b><small>${hint}</small></span><input type="checkbox" role="switch" data-k="${k}" ${v[k] ? 'checked' : ''}></label>`;
  function html() {
    return `<div class="sbds-head"><h2 id="sbds-title">Display &amp; Accessibility</h2><button type="button" class="sbds-x" data-act="close" aria-label="Close">✕</button></div>
      <p class="sbds-note">Visual comfort only — damage, hitboxes, timers and rewards never change.</p>
      <div class="sbds-presets" role="radiogroup" aria-label="Visual preset">${Object.entries(PRESET_TEXT).map(([k, [t, d]]) => `<button type="button" role="radio" aria-checked="${v.preset === k}" data-preset="${k}" class="${v.preset === k ? 'on' : ''}"><b>${t}</b><small>${d}</small></button>`).join('')}</div>
      ${v.preset === 'custom' ? '<p class="sbds-custom">Custom settings</p>' : ''}
      <div class="sbds-grid">
        <div class="sbds-controls">
          <label class="sbds-row sbds-slider"><span><b>Brightness</b><small><output>${v.brightness}%</output> of the game scene (menus stay readable)</small></span><input type="range" min="20" max="100" step="5" value="${v.brightness}" data-k="brightness" aria-label="Brightness"></label>
          <div class="sbds-row"><span><b>Explosion effects</b><small>Off shows a clear marker on every affected tile</small></span><div class="sbds-seg" role="radiogroup" aria-label="Explosion effects">${EXPLOSIONS.map(e => `<button type="button" role="radio" aria-checked="${v.explosions === e}" data-ex="${e}" class="${v.explosions === e ? 'on' : ''}">${e[0].toUpperCase() + e.slice(1)}</button>`).join('')}</div></div>
          ${toggle('flashing', 'Flashing lights', 'White hit flashes and bright celebration bursts')}
          ${toggle('shake', 'Screen shake', 'Camera shake from ultimates and boss defeats')}
          ${toggle('reduceMotion', 'Reduce motion', 'Calmer auras, no falling petals or ambient motes')}
          ${toggle('bloom', 'Bloom &amp; glow', 'Glowing explosions and neon light')}
          ${toggle('highContrast', 'High contrast', 'Stronger outlines, text and danger zones')}
          ${toggle('colorblind', 'Colorblind-friendly indicators', 'Patterns and symbols on danger and bars')}
        </div>
        <figure class="sbds-preview"><canvas width="360" height="220" aria-label="Live preview of the current settings"></canvas><figcaption>Live preview</figcaption></figure>
      </div>
      <div class="sbds-acts"><button type="button" class="sbds-reset" data-act="reset">Reset to default</button><button type="button" class="sbds-done" data-act="close">Done</button></div>`;
  }
  function render() { if (!dlg?.open) return; const focus = document.activeElement?.dataset; dlg.innerHTML = html(); restoreFocus(focus); }
  function restoreFocus(d) { if (!d) return; const sel = d.k ? `[data-k="${d.k}"]` : d.preset ? `[data-preset="${d.preset}"]` : d.ex ? `[data-ex="${d.ex}"]` : d.act ? `[data-act="${d.act}"]` : null; if (sel) dlg.querySelector(sel)?.focus(); }
  function open() {
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.className = 'sbds'; dlg.setAttribute('aria-labelledby', 'sbds-title'); document.body.append(dlg);
      dlg.addEventListener('click', e => {
        const t = e.target.closest('button'); if (!t) { if (e.target === dlg) dlg.close(); return; }
        if (t.dataset.preset) { preset(t.dataset.preset); render(); }
        else if (t.dataset.ex) { set({ explosions: t.dataset.ex }); render(); }
        else if (t.dataset.act === 'reset') { reset(); render(); }
        else if (t.dataset.act === 'close') dlg.close();
      });
      dlg.addEventListener('change', e => { const k = e.target.dataset.k; if (!k) return; set({ [k]: k === 'brightness' ? Number(e.target.value) : e.target.checked }); render(); });
      dlg.addEventListener('input', e => { if (e.target.dataset.k !== 'brightness') return; const o = dlg.querySelector('output'); if (o) o.textContent = e.target.value + '%'; set({ brightness: Number(e.target.value) }); });
      dlg.addEventListener('close', () => { cancelAnimationFrame(raf); raf = 0; });
    }
    dlg.innerHTML = html();
    if (!dlg.open) dlg.showModal();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(preview);
  }

  // ---------- live preview: a Shinobi throws a bomb at a target tile, under the current settings ----------
  const sample = { id: 7, r: 3, look: 0, name: 'Preview', lv: 1 };
  function preview(now) {
    raf = dlg?.open ? requestAnimationFrame(preview) : 0;
    const c = dlg?.querySelector('.sbds-preview canvas'); if (!c) return;
    const g = c.getContext('2d'), W = c.width, H = c.height, t = (now % 2400) / 2400;
    c.style.filter = `brightness(${(0.3 + 0.7 * v.brightness / 100).toFixed(3)}) contrast(${v.highContrast ? 1.22 : 1})`;
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Screen shake right after the blast (only when on).
    const blast = t > 0.42 && t < 0.78, power = blast ? 1 - (t - 0.42) / 0.36 : 0;
    if (v.shake && power > 0.6 && !v.reduceMotion) g.translate((Math.random() - .5) * 6 * power, (Math.random() - .5) * 6 * power);
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#1b2440'); sky.addColorStop(1, '#2c3b28'); g.fillStyle = sky; g.fillRect(-10, -10, W + 20, H + 20);
    // tiles
    for (let y = 0; y < 3; y++) for (let x = 0; x < 6; x++) { g.fillStyle = (x + y) % 2 ? '#4a6b3a' : '#557a42'; g.fillRect(20 + x * 54, 80 + y * 42, 52, 40); }
    const target = { x: 20 + 4 * 54 + 26, y: 80 + 1 * 42 + 20 };
    // the Shinobi
    try { if (window.ShinobiSprites?.heroFrame) ShinobiSprites.blit(g, ShinobiSprites.heroFrame(sample, t < 0.3 ? 'clip:ranged:0' : 'i0', false, 'side'), 72, 152, 1.6, false); } catch {}
    // the bomb (a gameplay object: always drawn)
    if (t < 0.42) { const p = t / 0.42, x = 90 + (target.x - 90) * p, y = 120 + (target.y - 120) * p - Math.sin(p * Math.PI) * 40; g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); g.fillStyle = '#ffb02a'; g.fillRect(x + 3, y - 12, 3, 6); }
    if (blast) {
      if (v.explosions === 'off') marker(g, target, power);
      else {
        const big = v.explosions === 'full' ? 1 : 0.6, r = (18 + (1 - power) * 40) * big;
        if (v.bloom) { g.globalCompositeOperation = 'lighter'; const gr = g.createRadialGradient(target.x, target.y, 0, target.x, target.y, r * 2); gr.addColorStop(0, '#ffcf6aaa'); gr.addColorStop(1, '#ff6a2a00'); g.fillStyle = gr; g.fillRect(target.x - r * 2, target.y - r * 2, r * 4, r * 4); g.globalCompositeOperation = 'source-over'; }
        g.globalAlpha = Math.min(1, power * 1.4) * (v.explosions === 'full' ? 1 : 0.75); g.fillStyle = '#ffb04a'; g.beginPath(); g.arc(target.x, target.y, r, 0, 7); g.fill();
        g.fillStyle = '#fff1c4'; g.beginPath(); g.arc(target.x, target.y, r * 0.5, 0, 7); g.fill(); g.globalAlpha = 1;
        if (v.explosions === 'full' && !v.reduceMotion) for (let i = 0; i < 10; i++) { const a = i * 0.63, d = r * (1.2 + (1 - power)); g.fillStyle = '#ffe08a'; g.fillRect(target.x + Math.cos(a) * d, target.y + Math.sin(a) * d * 0.7, 3, 3); }
        marker(g, target, power * 0.6);
      }
      // A soft (never strobing) screen flash only when flashing lights are on.
      if (v.flashing && power > 0.85) { g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, 0, W, H); }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = 'rgba(5,4,20,.75)'; g.fillRect(0, H - 26, W, 26); g.fillStyle = '#e8e0ff'; g.font = '600 13px Rajdhani, system-ui, sans-serif';
    g.fillText(`Explosions: ${v.explosions} · Flash ${v.flashing ? 'on' : 'off'} · Shake ${v.shake ? 'on' : 'off'} · Glow ${v.bloom ? 'on' : 'off'}`, 10, H - 9);
  }
  // The danger marker every preset keeps: an outlined tile (dashed with a symbol for colorblind mode).
  function marker(g, p, alpha) {
    g.save(); g.globalAlpha = Math.max(0.35, alpha); g.lineWidth = v.highContrast ? 4 : 3; g.strokeStyle = v.colorblind ? '#ffd400' : '#ff5a4a';
    if (v.colorblind) g.setLineDash([6, 4]);
    g.strokeRect(p.x - 26, p.y - 20, 52, 40);
    if (v.colorblind) { g.setLineDash([]); g.fillStyle = '#ffd400'; g.font = 'bold 16px system-ui'; g.textAlign = 'center'; g.fillText('⚠', p.x, p.y + 6); }
    g.restore();
  }
})();
