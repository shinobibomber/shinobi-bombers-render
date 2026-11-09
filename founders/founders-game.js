/* Founder panel for the game (apply-founders.cjs). Everything shown here comes from the server (founder-status);
 * the page never decides a reward, a price or a cooldown. SOL Sensei: the server builds the payment, this page
 * reviews it, the player's wallet signs it, and the SERVER checks the signed bytes and broadcasts it. */
(() => {
  'use strict';
  const PROGRAMS = { system: '11111111111111111111111111111111', memo: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' };
  const PENDING = 'shinobi-sensei-sol-v1';
  const $ = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v); } for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : String(k)); return el; };
  const account = () => window.RyoPayments?.state?.account || window.BetaWallet?.state?.account || null;
  const api = (action, body = {}) => { if (!window.RyoPayments?.founders) throw Error('Sign in first.'); return window.RyoPayments.founders(action, body); };
  const rid = p => p + '-' + crypto.randomUUID();
  const read = () => { try { return JSON.parse(localStorage.getItem(PENDING) || 'null'); } catch { return null; } };
  const write = v => { try { v ? localStorage.setItem(PENDING, JSON.stringify(v)) : localStorage.removeItem(PENDING); } catch {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmtTime = t => new Date(t).toLocaleString();
  let data = null, busy = false, dialog = null, button = null, message = '';

  // Only a SOL payment from this wallet of the stated price, plus the Sensei memo. Anything else is refused.
  function review(tx, owner, price) {
    const sdk = window.ShinobiSolana, player = new sdk.PublicKey(owner);
    if (!tx.feePayer?.equals(player)) throw Error('This payment is not paid by your wallet.');
    let paid = 0n, memo = false;
    for (const ix of tx.instructions) {
      const program = ix.programId.toBase58();
      if (program === PROGRAMS.system) {
        if (sdk.SystemInstruction.decodeInstructionType(ix) !== 'Transfer') throw Error('Unexpected SOL instruction.');
        const t = sdk.SystemInstruction.decodeTransfer(ix); if (!t.fromPubkey.equals(player)) throw Error('Unexpected SOL transfer.'); paid += BigInt(t.lamports);
      } else if (program === PROGRAMS.memo) memo = new TextDecoder().decode(ix.data).startsWith('shinobi-sensei-v1:');
      else throw Error('Unexpected program in the Sensei payment.');
    }
    if (paid !== BigInt(Math.round(price * 1e9))) throw Error('The Sensei price in the transaction does not match.');
    if (!memo) throw Error('This is not a Sensei payment.');
  }
  async function sign(wire, owner, price) {
    const sdk = window.ShinobiSolana, kind = window.BetaWallet?.state?.wallet;
    const provider = kind === 'solflare' ? window.solflare : (window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null));
    if (!sdk || !provider?.signTransaction) throw Error('Connect Phantom or Solflare to pay.');
    const tx = sdk.Transaction.from(Uint8Array.from(atob(wire), c => c.charCodeAt(0))); review(tx, owner, price);
    const signed = await provider.signTransaction(tx);
    const bytes = signed.serialize({ requireAllSignatures: true, verifySignatures: true });
    let raw = ''; for (const b of bytes) raw += String.fromCharCode(b); return btoa(raw);
  }

  async function refresh() {
    if (!account() || !window.RyoPayments?.founders) return;
    try { data = await api('founder-status'); } catch { data = null; }
    render();
  }
  async function act(fn) {
    if (busy) return; busy = true; message = ''; render();
    try { await fn(); } catch (e) { message = e?.message || 'Something went wrong.'; }
    busy = false; await refresh();
  }
  const activate = () => act(async () => { const r = await api('founder-activate'); data = r; message = 'Founder benefits activated: ' + r.activation.heroes.map(h => h.name).join(', ') + ' joined your roster.'; });
  const summon = kind => act(async () => { const r = await api('founder-summon', { kind, requestId: rid('fs') }); message = (kind === 'limited' ? 'Limited' : 'Premium') + ' summon: ' + r.summon.rankName + ' — ' + r.summon.hero.name; });
  const trial = () => act(async () => { const r = await api('founder-sensei-trial'); message = 'Sensei trial active until ' + fmtTime(r.trial.ends) + '.'; });
  // Permanent Sensei for SOL, started from the Dojo › Sensei tab: the server builds the payment, review() checks it, the
  // player's wallet signs it and the server verifies and broadcasts it. onStatus reports each step to the Sensei tab.
  // A purchase still pending (page closed mid-way) resumes with the same request id; nothing is ever paid twice.
  let buying = null;
  function purchaseSensei(onStatus = () => {}, shownPrice = null) {
    if (buying) return buying;
    buying = (async () => {
      const owner = account(); if (!owner) throw Error('Sign in first.');
      let p = read(); if (!p || p.account !== owner) { p = { account: owner, requestId: rid('sensei') }; write(p); }
      onStatus('Preparing your payment…');
      const r = await api('sensei-sol-buy', { requestId: p.requestId });
      if (r.senseiPurchase.status !== 'pending') { write(null); return { status: r.senseiPurchase.status, message: r.senseiPurchase.status === 'confirmed' ? 'Permanent Sensei unlocked.' : 'The payment expired; nothing was charged. Try again.' }; }
      if (!r.senseiPurchase.wire) { write(null); throw Error('That payment expired. Try again.'); }
      const price = r.senseiPurchase.price;
      // The price shown on the button is the one the player agreed to; ask again only if the server's price differs.
      if (shownPrice != null && Number(shownPrice) !== Number(price) && !confirm('The Sensei price is now ' + price + ' SOL. Continue? Your wallet shows the exact amount before you approve.')) return { status: 'cancelled', message: 'Nothing was charged.' };
      onStatus('Approve the ' + price + ' SOL payment in your wallet…');
      const signed = await sign(r.senseiPurchase.wire, owner, price);
      onStatus('Confirming on Solana…');
      let c = await api('sensei-sol-confirm', { requestId: p.requestId, signed });
      for (let i = 0; i < 40 && c.senseiPurchase.status === 'pending'; i++) { await sleep(i < 5 ? 2000 : 4000); c = await api('sensei-sol-confirm', { requestId: p.requestId }); }
      if (c.senseiPurchase.status !== 'pending') write(null);
      offer = null;
      const status = c.senseiPurchase.status;
      return { status, message: status === 'confirmed' ? 'Permanent Sensei unlocked.' : status === 'expired' ? 'The payment expired; nothing was charged.' : 'Still confirming on Solana. Open Hire a Sensei again to finish.' };
    })().finally(() => { buying = null; });
    return buying;
  }

  function row(label, value) { return $('div', { class: 'fd-row' }, $('dt', {}, label), $('dd', {}, value)); }
  function updateButton() {
    const st = window.RyoPayments?.state;
    // Founders only: the Sensei is no longer sold here, so non-Founders have nothing in this panel.
    if (button) button.hidden = !account() || !(data?.founder || st?.profile?.founderTier);
  }
  function render() {
    const f = data?.founder, s = data?.senseiSol;
    updateButton();
    if (!dialog) return;
    const body = dialog.querySelector('.fd-body'); body.replaceChildren();
    if (!f) body.append($('p', {}, 'This wallet has no Founder box.'));
    else {
      // Element.append prints null as the text "null": optional notices are filtered out first.
      body.append(...[$('p', { class: 'fd-tier fd-' + f.tier }, 'Founder ' + f.name), !f.valid ? $('p', { class: 'fd-warn' }, 'This Founder entitlement is suspended. Contact support.') : null,
        !f.redemptionOpen ? $('p', { class: 'fd-note' }, 'Founder rewards open for redemption at a later release stage.') : null,
        $('p', { class: 'fd-badge' }, f.chestCooldownHours === 12 ? 'FOUNDER BENEFIT: 12-HOUR CHEST COOLDOWN' : '24-HOUR CHEST COOLDOWN')].filter(Boolean));
      const dl = $('dl', { class: 'fd-list' },
        // Passes and qualifying weeks start with activation: before it, say what activating gives (not "0 left").
        row('Limited Hero Summon Passes', (f.activated ? f.limitedPasses + ' left' : (f.passesOnActivation || 10) + ' passes when you activate') + ' · ' + f.limitedPool.map(p => p.rank + ' ' + p.percent + '%').join(' / ') + ' (no Genin, no Mythic)'),
        row('Premium Hero Summon', f.activated ? 'Every ' + f.premium.everyWeeks + ' completed qualifying weeks · ' + f.premium.qualifyingWeeks + ' week(s) so far · ' + f.premium.available + ' available (Elite 70% / Legend 30%)' : 'Every ' + f.premium.everyWeeks + ' completed qualifying weeks after you activate (Elite 70% / Legend 30%)'),
        row('Game-service discount', f.discountPercent + '% on Summon, Fusion, Dojo, Sensei and Training'),
        row('Sensei', f.sensei === 'permanent' ? (f.activated ? 'Free permanent Sensei' : 'Free permanent Sensei when you activate') : f.trial ? 'Trial until ' + fmtTime(f.trial.ends) : '7-day free trial available'),
        row('Weekly Mission Pass', (f.missionPass.level === 'full' ? 'Full' : 'Basic') + ' rewards — ' + f.missionPass.status),
        row("Founder's Council", f.council === 'full' ? 'Full membership' : 'Community access'),
        row('Early access', f.earlyAccess));
      body.append(dl);
      const actions = $('div', { class: 'fd-actions' });
      const can = f.valid && f.redemptionOpen && !busy;
      if (!f.activated) actions.append($('button', { type: 'button', onclick: activate, ...(can ? {} : { disabled: '' }) }, 'Activate Founder benefits'));
      else {
        actions.append($('button', { type: 'button', onclick: () => summon('limited'), ...(can && f.limitedPasses > 0 ? {} : { disabled: '' }) }, 'Use a Limited Summon Pass'));
        actions.append($('button', { type: 'button', onclick: () => summon('premium'), ...(can && f.premium.available > 0 ? {} : { disabled: '' }) }, 'Premium Hero Summon'));
        if (f.tier === 'legacy' && !f.trial) actions.append($('button', { type: 'button', onclick: trial, ...(can ? {} : { disabled: '' }) }, 'Activate 7-day Sensei trial'));
      }
      body.append(actions);
    }
    // Mythic Founders get permanent Sensei free on activation: never offer them the SOL purchase.
    if (s && f?.sensei === 'permanent' && f.valid) body.append($('h3', {}, 'Permanent Sensei'), $('p', {}, f.activated ? 'Included with your Mythic Founder box.' : 'Included free with your Mythic Founder box: press Activate Founder benefits.'));
    // The permanent Sensei is bought only on the Dojo › Sensei tab (owner decision 2026-11-10), never in this panel.
    else if (s && f?.valid) {
      const owned = s.owned || s.purchase?.status === 'confirmed';
      body.append($('h3', {}, 'Permanent Sensei'), $('p', {}, owned ? 'Permanent Sensei owned.' : 'Hire it on the Dojo › Sensei tab.' + (s.founderDiscount ? ' Your Legacy Founder price there: ' + s.price + ' SOL (regular ' + s.regularPrice + ' SOL) until ' + fmtTime(s.trialEnds) + '.' : '')));
    }
    if (message) body.append($('p', { class: 'fd-msg', role: 'status' }, message));
  }
  function open() {
    if (!dialog) {
      dialog = $('dialog', { class: 'fd-dialog', 'aria-labelledby': 'fd-title' },
        $('div', { class: 'fd-head' }, $('h2', { id: 'fd-title' }, "Founder's Benefits"), $('button', { type: 'button', class: 'fd-close', 'aria-label': 'Close', onclick: () => dialog.close() }, '×')),
        $('div', { class: 'fd-body' }));
      document.body.append(dialog);
    }
    if (!dialog.open) dialog.showModal();
    render(); refresh();
  }
  function boot() {
    button = $('button', { type: 'button', class: 'fd-launch', hidden: '', onclick: open, 'aria-label': "Founder's Benefits" }, 'Founder');
    document.body.append(button);
    // No Founder request until the panel is opened: visibility comes from the server-written profile flag
    // (founderTier) or the server config (senseiSol), both already in the game state.
    let last = null;
    setInterval(() => { const a = account(); if (a !== last) { last = a; data = null; offer = null; if (dialog?.open) dialog.close(); } updateButton(); }, 1500);
    addEventListener('focus', () => { if (account() && dialog?.open) refresh(); });
  }
  // SOL Sensei offer for the Dojo screens (live): the server's price for this wallet (Legacy Founder price included) and,
  // when the /founders price check publishes one, an estimated USD value. The page never sets a price.
  // One cached offer per wallet: refreshed after 60 s (the Legacy price and the switch can change), one request at a
  // time, a 30 s pause after a failure; the USD rate (an estimate only) is refreshed every 5 minutes.
  let usd = { at: 0, value: null }, offer = null, pending = null, failedAt = 0;
  const OFFER_TTL = 60000;
  async function usdPerSol() {
    if (Date.now() - usd.at < 300000) return usd.value;
    let value = null;
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch('/api/prelaunch', { method: 'POST', credentials: 'same-origin', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'X-SB-Prelaunch': '1' }, body: JSON.stringify({ action: 'founders-info' }) });
      clearTimeout(timer); const v = Number((await r.json())?.data?.founders?.usdPerSol); if (Number.isFinite(v) && v > 0) value = v;
    } catch {}
    usd = { at: Date.now(), value }; return value;
  }
  function senseiOffer() {
    if (pending) return pending;
    const owner = account();
    pending = (async () => {
      try {
        const [info, rate] = await Promise.all([api('sensei-sol-info').then(r => r.senseiSol), usdPerSol()]);
        // profile.founderTier is written by the server only while the Founder entitlement is valid.
        const mythicIncluded = window.RyoPayments?.state?.profile?.founderTier === 'mythic';
        offer = { ...info, mythicIncluded, usd: rate ? Math.round(Number(info.price) * rate * 100) / 100 : null, account: owner, at: Date.now() };
        failedAt = 0; return offer;
      } catch (e) { failedAt = Date.now(); throw e; } finally { pending = null; }
    })();
    return pending;
  }
  const cachedOffer = () => (offer && offer.account === account() ? offer : null);
  const offerDue = () => !pending && Date.now() - failedAt > 30000 && (!cachedOffer() || Date.now() - offer.at > OFFER_TTL);
  // Mythic Founders get the Sensei free: open their panel to activate it, never a payment. Everyone else pays on the
  // Sensei tab itself (no Founder panel).
  function buySenseiFromDojo(onStatus, shownPrice) {
    if (window.RyoPayments?.state?.profile?.founderTier === 'mythic') { open(); return Promise.resolve({ status: 'founder', message: 'Activate your free Sensei in Founder benefits.' }); }
    return purchaseSensei(onStatus, shownPrice);
  }
  // Live (Mainnet) always sells the Sensei for SOL: the server refuses the Ryo hire and rental there even while the SOL
  // switch is off, so the Dojo screens then show the SOL offer as paused instead of Ryo buttons that cannot work.
  const senseiSolMode = () => { const c = window.RyoPayments?.state?.configuration; return c?.senseiSol === true || c?.network === 'solana-mainnet'; };
  window.FounderPanel = Object.freeze({ open, refresh, review, sensei: Object.freeze({ mode: senseiSolMode, offer: senseiOffer, cached: cachedOffer, due: offerDue, buy: buySenseiFromDojo }) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
