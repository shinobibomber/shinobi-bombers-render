/* Founder's NFT Boxes on the pre-landing page. Separate from wallet.js (which only ever signs sign-in text):
 * a transaction signature is requested ONLY when the signed-in buyer presses Buy, through the Wallet Standard
 * `solana:signTransaction` feature of the same wallet. The page reviews the server-built transaction (payer, exact
 * price, allowed programs), the wallet shows it again, and the signed bytes go back to the server, which checks
 * them byte-for-byte and broadcasts them. No RPC is used in the browser. Sales stay closed unless the server says
 * otherwise (founders-info). */
(() => {
  'use strict';
  const PROGRAMS = new Set(['11111111111111111111111111111111', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr']);
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', PENDING = 'shinobi-founder-box-v1';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const label = key => document.querySelector('[data-fd-text="' + key + '"]')?.textContent.trim() || key;
  const read = () => { try { return JSON.parse(localStorage.getItem(PENDING) || 'null'); } catch { return null; } };
  const write = v => { try { v ? localStorage.setItem(PENDING, JSON.stringify(v)) : localStorage.removeItem(PENDING); } catch {} };
  const standard = new Set();
  const registry = Object.freeze({ register(...w) { w.forEach(x => standard.add(x)); return () => w.forEach(x => standard.delete(x)); } });
  addEventListener('wallet-standard:register-wallet', e => { try { e.detail(registry); } catch {} });
  try { dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: registry })); } catch {}

  const b58 = bytes => { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let out = ''; while (n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; } for (const b of bytes) { if (b) break; out = '1' + out; } return out; };
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = bytes => { let raw = ''; for (const b of bytes) raw += String.fromCharCode(b); return btoa(raw); };
  function shortvec(buf, o) { let len = 0, size = 0; for (;;) { const b = buf[o.i++]; len |= (b & 0x7f) << (size * 7); size++; if (!(b & 0x80)) return len; if (size > 3) throw Error('bad'); } }
  /* Minimal legacy-transaction reader: signatures, account keys and instructions (enough to review payer and price). */
  function parse(bytes) {
    const o = { i: 0 }, sigCount = shortvec(bytes, o); o.i += 64 * sigCount;
    const header = bytes.slice(o.i, o.i + 3); o.i += 3; if (header[0] & 0x80) throw Error('Unsupported transaction version.');
    const keys = []; for (let k = shortvec(bytes, o); k > 0; k--) { keys.push(b58(bytes.slice(o.i, o.i + 32))); o.i += 32; }
    o.i += 32; // recent blockhash
    const instructions = [];
    for (let n = shortvec(bytes, o); n > 0; n--) {
      const program = keys[bytes[o.i++]], accounts = []; for (let a = shortvec(bytes, o); a > 0; a--) accounts.push(keys[bytes[o.i++]]);
      const len = shortvec(bytes, o), data = bytes.slice(o.i, o.i + len); o.i += len; instructions.push({ program, accounts, data });
    }
    return { requiredSignatures: header[0], keys, instructions };
  }
  function review(bytes, owner, priceSol, tier) {
    const tx = parse(bytes);
    if (tx.keys[0] !== owner) throw Error(label('err.payer'));
    let paid = 0n, memo = '';
    for (const ix of tx.instructions) {
      if (!PROGRAMS.has(ix.program)) throw Error(label('err.program'));
      if (ix.program === '11111111111111111111111111111111') {
        const kind = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength).getUint32(0, true);
        if (kind === 2) { if (ix.accounts[0] !== owner) throw Error(label('err.program')); paid += new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength).getBigUint64(4, true); }
        else if (kind !== 0) throw Error(label('err.program'));
      }
      if (ix.program === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') memo = new TextDecoder().decode(ix.data);
    }
    if (paid !== BigInt(Math.round(priceSol * 1e9))) throw Error(label('err.price'));
    if (!memo.startsWith('shinobi-founder-v1:' + tier + ':')) throw Error(label('err.program'));
    return true;
  }
  /* Sign with the wallet account the buyer signed in with (owner). After a page reload the session is still valid but
   * the wallet is not connected on this page: reconnect it silently, or (only one capable wallet) with its prompt. */
  async function signWith(owner, wire, network) {
    const signers = [...standard].filter(w => typeof w.features?.['solana:signTransaction']?.signTransaction === 'function');
    if (!signers.length) throw Error(label('err.wallet'));
    const holds = w => (w.accounts || []).find(a => a.address === owner);
    let wallet = signers.find(holds) || signers.find(w => normalized(w.name) === normalized(window.SBWallet?.active?.name)), account = wallet && holds(wallet);
    for (const silent of [true, false]) {
      if (account) break;
      const tries = wallet ? [wallet] : silent ? signers : signers.length === 1 ? signers : [];
      for (const w of tries) {
        const connect = w.features?.['standard:connect']?.connect; if (typeof connect !== 'function') continue;
        try { const r = await connect(silent ? { silent: true } : undefined); account = (r?.accounts || w.accounts || []).find(a => a.address === owner); }
        catch (e) { if (!silent) throw e; }
        if (account) { wallet = w; break; }
      }
    }
    if (!account) throw Error(label('err.reconnect'));
    const out = await wallet.features['solana:signTransaction'].signTransaction({ account, transaction: wire, chain: 'solana:' + network });
    const signed = out?.[0]?.signedTransaction;
    if (!(signed instanceof Uint8Array)) throw Error(label('err.wallet'));
    return signed;
  }
  const normalized = name => String(name || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');

  async function api(action, body = {}) {
    let r; try { r = await fetch('/api/prelaunch', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-SB-Prelaunch': '1' }, body: JSON.stringify({ ...body, action }) }); }
    catch { throw Object.assign(Error(label('err.network')), { code: 'NETWORK' }); }
    let data = {}; try { data = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(Error(data.error || label('err.network')), { code: data.code || 'SERVER_ERROR', status: r.status });
    return data;
  }

  // usd: display-only SOL→USD rate from the server (founders-info.usdPerSol); the payment is always the exact SOL price.
  // signedIn: the session's wallet from founders-info, so a signed-in buyer is recognised after a page reload even
  // before the wallet extension reconnects (SBWallet.active is only set by a connect on this page).
  let state = null, busy = '', note = '', usd = null, signedIn = null;
  const remember = s => { const r = Number(s?.founders?.usdPerSol); if (Number.isFinite(r) && r > 0) usd = r; if (s?.founders && 'wallet' in s.founders) signedIn = s.founders.wallet || null; return s; };
  const ownerOf = () => window.SBWallet?.active?.address || signedIn;
  const money = x => { try { return new Intl.NumberFormat(document.documentElement?.lang || 'en-US', { style: 'currency', currency: 'USD' }).format(x); } catch { return '$' + x.toFixed(2); } };
  // Our own reservation for this tier that the buyer has not approved yet (e.g. they rejected it in the wallet).
  const ownPending = (tier, owner) => { const p = read(); return !!owner && p?.account === owner && p?.tier === tier; };
  function stateFor(tier) {
    const f = state?.founders, t = f?.tiers?.[tier], owner = ownerOf();
    if (busy === tier) return 'minting';
    if (!f) return 'soon';
    if (f.mine?.status === 'confirmed') return f.mine.tier === tier ? 'confirmed' : 'already';
    if (f.mine?.status === 'pending') return f.mine.tier === tier ? (ownPending(tier, owner) ? 'resume' : 'minting') : 'already';
    if (t?.soldOut) return 'soldout';
    if (f.paused) return 'paused';
    if (f.mode === 'off') return 'soon';
    if (!owner) return 'connect';
    if (f.mode === 'private' && !f.tester) return 'private';
    return f.eligible ? 'eligible' : 'soon';
  }
  function render() {
    const f = state?.founders;
    for (const tier of ['mythic', 'legacy']) {
      const t = f?.tiers?.[tier], s = stateFor(tier), btn = $('#fdBuy-' + tier), left = $('#fdLeft-' + tier);
      const price = t?.price, usdText = usd && price ? money(price * usd) : '';
      if (left) left.textContent = t ? label('supply').replace('[n]', t.remaining).replace('[of]', t.supply) + (usdText ? ' · ' + label('usd').replace('[price]', price).replace('[usd]', usdText) : '') : '';
      let text = label('state.' + s);
      if (s === 'eligible' && price) text = label(usdText ? 'state.buyPrice' : 'state.buySol').replace('[price]', price).replace('[usd]', usdText);
      if (s === 'resume' && price) text = label('state.resume').replace('[price]', price);
      if (btn) { btn.textContent = text; btn.disabled = !['eligible', 'connect', 'resume'].includes(s) || !!busy; btn.dataset.state = s; }
    }
    const msg = $('#fdStatus'); if (msg) { msg.textContent = note; msg.hidden = !note; }
  }
  async function refresh() {
    const p = read();
    // A reservation of ours that is still pending is settled through founders-confirm (it expires there).
    if (p?.requestId && state?.founders?.mine?.status === 'pending') {
      try { const c = await api('founders-confirm', { requestId: p.requestId }); if (c.purchase.status !== 'pending') write(null); state = remember(c); render(); return; } catch {}
    }
    try { state = remember(await api('founders-info')); } catch { state = null; }
    render();
  }
  const rejected = e => e?.code === 4001 || /reject|denied|declin|cancel/i.test(String(e?.message || '') + ' ' + String(e?.name || ''));

  /* No browser dialog: the buyer approves (or rejects) the exact payment in the wallet they signed in with. */
  async function buy(tier) {
    const owner = ownerOf();
    if (!owner) { document.querySelector('#connectBtn')?.click(); return; }
    const t = state?.founders?.tiers?.[tier]; if (!t) return;
    busy = tier; note = label('step.reserve'); render();
    try {
      let p = read(); if (!p || p.account !== owner || p.tier !== tier) { p = { account: owner, tier, requestId: 'fb-' + crypto.randomUUID() }; write(p); }
      const r = await api('founders-mint', { tier, requestId: p.requestId });
      if (r.purchase.status !== 'pending' || !r.purchase.wire) { write(null); state = remember(r); return; }
      state = remember(r);
      const wire = fromB64(r.purchase.wire); review(wire, owner, r.purchase.price, tier);
      note = label('step.sign'); render();
      let signed;
      try { signed = await signWith(owner, wire, r.founders.network === 'solana-mainnet' ? 'mainnet' : 'devnet'); }
      catch (e) { throw rejected(e) ? Object.assign(Error(label('err.rejected')), { code: 'REJECTED' }) : e; }
      note = label('step.confirm'); render();
      let c = await api('founders-confirm', { requestId: p.requestId, signed: toB64(signed) });
      for (let i = 0; i < 45 && c.purchase.status === 'pending'; i++) { await sleep(i < 5 ? 2000 : 4000); c = await api('founders-confirm', { requestId: p.requestId }); }
      state = remember(c); if (c.purchase.status !== 'pending') write(null);
      note = label('done.' + c.purchase.status);
    } catch (e) {
      // Our stored reservation expired on the server: forget it so the next press reserves a fresh box.
      if (e?.status === 409 && e?.code !== 'FOUNDERS_WALLET_LIMIT' && ownPending(tier, owner)) write(null);
      note = e?.message || label('err.network');
    }
    finally { busy = ''; render(); }
  }
  function boot() {
    if (!$('#founders')) return;
    $$('[data-fd-buy]').forEach(b => b.addEventListener('click', () => buy(b.dataset.fdBuy)));
    window.SBWallet?.onChange?.(() => setTimeout(refresh, 300));
    // Language switch: the hidden labels are re-translated by prelaunch.js; re-label the buttons from them.
    try { new MutationObserver(() => render()).observe(document.querySelector('[data-fd-text]')?.parentElement || document.documentElement, { subtree: true, characterData: true, childList: true }); } catch {}
    refresh(); setInterval(() => { if (!document.hidden && !busy) refresh(); }, 30000);
    const p = read(); if (p?.requestId) api('founders-confirm', { requestId: p.requestId }).then(c => { state = c; if (c.purchase.status !== 'pending') write(null); render(); }).catch(() => {});
  }
  window.FoundersBox = Object.freeze({ review, parse, refresh });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
