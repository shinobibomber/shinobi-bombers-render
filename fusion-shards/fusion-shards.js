/* Fusion Shards, client (apply-fusion-shards.cjs). Owner request 2026-11-11. Account-bound game items; the server decides
 * everything: crafting (2 Upgrade Shards -> 1 Fusion Shard, idempotent request id) and the fusion success boost (+5% per
 * Fusion Shard per attempt, up to 100%, checked at quote, purchase and settlement). This file only keeps the player's chosen
 * Fusion Shards per attempt, adds it to the fusion quote request (RyoPayments.quote), explains it at checkout, and offers the
 * crafting dialog. Balances shown are always the server profile's. */
(function () {
  'use strict';
  const VERSION = 1, STEP = 5, RATE = 2, BASE = [90, 80, 70, 60];
  let per = 0, lastWanted = 0, pendingCraft = null, dialog = null;
  const state = () => (window.RyoPayments && RyoPayments.state) || {};
  const profile = () => state().authenticated && state().profile ? state().profile : null;
  const whole = v => Number.isSafeInteger(v) && v > 0 ? v : 0;
  const balance = () => whole(profile()?.fusionShards), upgrade = () => whole(profile()?.upgradeShards);
  const needed = rank => Math.max(0, Math.ceil((100 - (BASE[rank] ?? 100)) / STEP));
  const fmt = n => Number(n).toLocaleString('en-US');
  const heroRank = id => { try { return (typeof S !== 'undefined' && S.h ? S.h.find(h => h.tokenId === id) : null)?.r; } catch { return undefined; } };

  function plan(rank, attempts = 1) {
    const base = BASE[rank] ?? 0, need = needed(rank), n = Math.min(per, need), total = n * Math.max(1, attempts);
    return { base, needed: need, per: n, final: Math.min(100, base + STEP * n), total, short: Math.max(0, total - balance()) };
  }
  /* Can the player add one more Fusion Shard per attempt? Only while it stays within the balance (one attempt, as the Fusion
   * panel shows). have = balance, need = shards for 100% at this rank. The server still re-checks everything at quote. */
  function canAdd(rank) {
    const have = balance(), need = needed(rank);
    return { ok: per + 1 <= Math.min(need, have), have, need };
  }
  function set(rank, n) { per = Math.max(0, Math.min(needed(rank), Math.trunc(Number(n) || 0))); return per; }

  /* The chosen Fusion Shards travel with the fusion quote; the server re-checks them at purchase and settlement. */
  function wrap() {
    const R = window.RyoPayments;
    if (!R || typeof R.quote !== 'function') return false;
    if (R.quote.fusionShards) return true;
    const original = R.quote;
    const quote = function (product, params, ...rest) {
      lastWanted = 0;
      if (product === 'fusion' && per > 0 && params && Array.isArray(params.heroIds) && params.fusionShards === undefined) {
        // Per attempt, capped at what 100% needs and at what the balance covers for EVERY attempt of the batch; the checkout
        // shows the exact quoted rate and shards before paying (and says when fewer than chosen could be used).
        const rank = heroRank(params.heroIds[0]), attempts = Math.max(1, Math.floor(params.heroIds.length / 3));
        lastWanted = Number.isInteger(rank) ? Math.min(per, needed(rank)) : per;
        const n = Math.min(lastWanted, Math.floor(balance() / attempts));
        if (n > 0) params = { ...params, fusionShards: n };
      }
      return original.call(this, product, params, ...rest);
    };
    quote.fusionShards = true; R.quote = quote; return true;
  }

  /* Checkout: what the quoted fusion uses (only when Fusion Shards are part of the server quote). */
  function decorate(dlg, q) {
    if (!dlg || !q?.fusion) return;
    const f = q.fusion, note = document.createElement('p'), used = f.shardsPerAttempt || 0;
    note.className = 'fusion-shard-cost';
    const reduced = lastWanted > used ? (used ? ' Your ' + fmt(balance()) + ' Fusion Shard(s) cover ' + used + ' per attempt for ' + f.attempts + ' attempt(s), not ' + lastWanted + '.' : '') : '';
    if (!f.shards) {
      if (!lastWanted) return;
      note.textContent = 'Fusion Shards: not used. You have ' + fmt(balance()) + ', not enough for ' + f.attempts + ' attempt(s). Success stays ' + f.successPercent + '%.';
      const actions = dlg.querySelector('.checkout-actions'); if (actions) actions.before(note); else dlg.append(note); return;
    }
    note.textContent = (reduced ? reduced.trim() + ' ' : '') + 'Fusion Shards: uses ' + fmt(f.shards) + ' (' + f.shardsPerAttempt + ' per attempt) · success ' + f.baseSuccessPercent + '% + ' + (f.successPercent - f.baseSuccessPercent) + '% = '
      + f.successPercent + '%' + (f.successPercent >= 100 ? ' · GUARANTEED SUCCESS' : '') + '. They are used when the purchase settles, on success and on failure. If the purchase fails, nothing is used.';
    const actions = dlg.querySelector('.checkout-actions');
    if (actions) actions.before(note); else dlg.append(note);
  }

  /* ---------- Crafting dialog ---------- */
  const id = () => 'fshard-' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 32);
  function style() {
    if (document.getElementById('fusionShardStyle')) return;
    const s = document.createElement('style'); s.id = 'fusionShardStyle';
    s.textContent = `dialog.fusion-craft{max-width:min(420px,calc(100vw - 32px));box-sizing:border-box;padding:18px 18px 16px;border:2px solid #ffcf63;border-radius:12px;background:linear-gradient(180deg,#1d1305,#0b0816);color:#fff3cf;font:600 15px/1.35 Rajdhani,sans-serif;box-shadow:0 0 24px #ffcf6355}
dialog.fusion-craft::backdrop{background:#000a}
.fusion-craft h2{margin:0 0 4px;font:900 20px Rajdhani,sans-serif;letter-spacing:.08em;color:#ffcf63}
.fusion-craft .fc-rate{margin:0 0 10px;color:#e8d9ff}
.fusion-craft .fc-bal{display:flex;gap:10px;margin:0 0 12px}.fusion-craft .fc-bal span{flex:1;padding:8px;border:1px solid #6b4a12;border-radius:8px;background:#120c1c;text-align:center}
.fusion-craft .fc-bal b{display:block;font-size:22px;color:#fff}
.fusion-craft .fc-qty{display:flex;align-items:center;justify-content:center;gap:10px;margin:0 0 8px}
.fusion-craft .fc-qty button{width:40px;height:40px;font:900 22px Rajdhani,sans-serif}
.fusion-craft .fc-qty output{min-width:70px;text-align:center;font:900 26px Rajdhani,sans-serif;color:#fff}
.fusion-craft .fc-cost{margin:0 0 10px;text-align:center;color:#ffe9a8}
.fusion-craft .fc-msg{min-height:1.3em;margin:0 0 10px;text-align:center;color:#ff9d7a}
.fusion-craft .fc-msg.ok{color:#7dff9b}
.fusion-craft .fc-actions{display:flex;flex-wrap:wrap;gap:8px}.fusion-craft .fc-actions button{flex:1 1 30%;min-height:40px}
.fusion-craft button{border:1px solid #ffcf63;border-radius:8px;background:linear-gradient(#fcc126,#f7a51a 55%,#fb8f0b);color:#2a1000;font:900 15px Rajdhani,sans-serif;cursor:pointer}
.fusion-craft button.ghost{background:#1a1226;color:#fff3cf}
.fusion-craft button:disabled{opacity:.45;cursor:not-allowed}
.fusion-craft .fc-confirm{display:none}.fusion-craft.confirming .fc-confirm{display:flex}.fusion-craft.confirming .fc-main{display:none}
p.fusion-shard-cost{color:#ffcf63}`;
    document.head.append(s);
  }
  function openCraft() {
    if (!state().authenticated) { window.ShinobiBetaUI?.open?.(); return; }
    style();
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'fusion-craft'; dialog.setAttribute('aria-labelledby', 'fusionCraftTitle');
      dialog.innerHTML = '<h2 id="fusionCraftTitle">CRAFT FUSION SHARDS</h2><p class="fc-rate">2 Upgrade Shards → 1 Fusion Shard. Each Fusion Shard adds +5% fusion success per attempt, up to 100%.</p>'
        + '<div class="fc-bal"><span>Upgrade Shards<b data-k="up"></b></span><span>Fusion Shards<b data-k="fu"></b></span></div>'
        + '<div class="fc-qty"><button type="button" class="ghost" data-a="-" aria-label="Craft one less">−</button><output aria-live="polite" data-k="q"></output><button type="button" class="ghost" data-a="+" aria-label="Craft one more">+</button></div>'
        + '<p class="fc-cost" data-k="cost"></p><p class="fc-msg" role="status" data-k="msg"></p>'
        + '<div class="fc-actions fc-main"><button type="button" data-a="one">Craft 1</button><button type="button" data-a="max">Craft Max</button><button type="button" data-a="go">Craft</button><button type="button" class="ghost" data-a="close">Close</button></div>'
        + '<div class="fc-actions fc-confirm"><button type="button" data-a="yes">Confirm</button><button type="button" class="ghost" data-a="back">Back</button></div>';
      dialog.addEventListener('click', onClick);
      dialog.addEventListener('close', () => { dialog.classList.remove('confirming'); });
      document.body.append(dialog);
    }
    dialog.dataset.q = String(Math.min(1, Math.floor(upgrade() / RATE)) || 1); dialog.classList.remove('confirming');
    msg(''); paint(); dialog.showModal();
  }
  const el = k => dialog.querySelector('[data-k="' + k + '"]');
  function msg(text, ok = false) { const m = el('msg'); m.textContent = text; m.classList.toggle('ok', ok); }
  function paint() {
    if (!dialog) return;
    const max = Math.floor(upgrade() / RATE), q = Math.max(1, Math.trunc(Number(dialog.dataset.q) || 1));
    el('up').textContent = fmt(upgrade()); el('fu').textContent = fmt(balance()); el('q').textContent = fmt(q);
    el('cost').textContent = 'Cost: ' + fmt(q * RATE) + ' Upgrade Shards → ' + fmt(q) + ' Fusion Shard' + (q === 1 ? '' : 's') + (max ? ' · Max ' + fmt(max) : ' · You need at least 2 Upgrade Shards');
    const busy = dialog.dataset.busy === '1';
    for (const b of dialog.querySelectorAll('button')) {
      const a = b.dataset.a;
      b.disabled = busy && a !== 'close' && a !== 'back' || (a === '-' && q <= 1) || (a === '+' && q >= max) || ((a === 'one' || a === 'max') && max < 1) || (a === 'go' && q > max);
    }
  }
  let confirmAmount = null;
  function ask(amount) {
    confirmAmount = amount; const q = amount === 'max' ? Math.floor(upgrade() / RATE) : amount;
    if (q < 1) return msg('You need at least 2 Upgrade Shards to craft a Fusion Shard.');
    msg('Convert ' + fmt(q * RATE) + ' Upgrade Shards into ' + fmt(q) + ' Fusion Shard' + (q === 1 ? '' : 's') + '? This is permanent: Upgrade Shards cannot be recovered.');
    dialog.classList.add('confirming');
  }
  async function craft() {
    const amount = confirmAmount, body = amount === 'max' ? { max: true } : { quantity: amount };
    const key = JSON.stringify(body);
    if (!pendingCraft || pendingCraft.key !== key) pendingCraft = { key, requestId: id() };   // a retry reuses the same request id
    dialog.dataset.busy = '1'; dialog.classList.remove('confirming'); msg('Crafting…'); paint();
    try {
      const data = await RyoPayments.fusionShardCraft({ ...body, requestId: pendingCraft.requestId, craftRulesVersion: VERSION });
      pendingCraft = null;
      const c = data?.fusionShardCraft || {};
      msg('Crafted ' + fmt(c.quantity || 0) + ' Fusion Shard' + (c.quantity === 1 ? '' : 's') + '. You now have ' + fmt(c.fusionShards ?? balance()) + '.', true);
      dialog.dataset.q = '1';
    } catch (e) {
      if (e && Number(e.status) >= 400 && Number(e.status) < 500) pendingCraft = null;   // refused: a new attempt gets a new id
      msg(e?.message || 'Crafting failed. Nothing was converted.');
    } finally { dialog.dataset.busy = ''; paint(); }
  }
  function onClick(e) {
    const a = e.target.closest('button')?.dataset.a; if (!a) return;
    const q = Math.max(1, Math.trunc(Number(dialog.dataset.q) || 1)), max = Math.floor(upgrade() / RATE);
    if (a === '-') dialog.dataset.q = String(Math.max(1, q - 1));
    else if (a === '+') dialog.dataset.q = String(Math.min(Math.max(1, max), q + 1));
    else if (a === 'one') ask(1);
    else if (a === 'max') ask('max');
    else if (a === 'go') ask(q);
    else if (a === 'yes') { craft(); return; }
    else if (a === 'back') { dialog.classList.remove('confirming'); msg(''); }
    else if (a === 'close') dialog.close();
    paint();
  }

  window.FusionShards = Object.freeze({
    VERSION, STEP, RATE, BASE, needed, plan, set, canAdd, balance, upgrade, decorate, openCraft,
    perAttempt: () => per, fill: rank => set(rank, Math.min(needed(rank), balance())),   // up to the 100% amount, never past what the player owns
  });
  if (!wrap()) { const t = setInterval(() => { if (wrap()) clearInterval(t); }, 200); setTimeout(() => clearInterval(t), 30000); }
  let account = null;   // a different signed-in account starts with no Fusion Shards chosen
  window.addEventListener('shinobi-ryo-ledger', e => { const s = state(), a = e.detail?.authenticated ? (s.account || e.detail.account || null) : null; if (a !== account) { account = a; per = 0; pendingCraft = null; if (dialog?.open) dialog.close(); } else if (dialog?.open) paint(); });
})();
