/* Shinobi Bombers pre-launch wallet adapter: sign-in only.
 * Finds Solana wallets through the Wallet Standard (any wallet that supports `solana:signMessage`) and the
 * classic Phantom / Solflare providers. It can only connect and sign a text message: it never builds,
 * signs or sends a transaction, and never sees a seed phrase or private key.
 * window.SBWallet = { list(), connect(id), signMessage(text), disconnect(), onChange(fn) } */
(() => {
  'use strict';
  const standard = new Set(), listeners = new Set();
  const changed = () => listeners.forEach(fn => { try { fn(); } catch {} });
  const api = Object.freeze({ register(...wallets) { wallets.forEach(w => standard.add(w)); changed(); return () => { wallets.forEach(w => standard.delete(w)); changed(); }; } });
  addEventListener('wallet-standard:register-wallet', e => { try { e.detail(api); } catch {} });
  try { dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api })); } catch {}

  const usable = w => w && typeof w.name === 'string' && w.features?.['standard:connect'] && w.features?.['solana:signMessage']
    && (!Array.isArray(w.chains) || w.chains.some(c => String(c).startsWith('solana:')));
  const safeIcon = icon => typeof icon === 'string' && /^data:image\/(svg\+xml|png|webp|gif|jpeg);/.test(icon) ? icon : null;
  const toBase64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

  let active = null;   // { id, name, address, sign(bytes) -> Uint8Array, disconnect() }

  function list() {
    const out = [], names = new Set();
    for (const w of standard) if (usable(w) && !names.has(w.name)) { names.add(w.name); out.push({ id: 'std:' + w.name, name: w.name, icon: safeIcon(w.icon), wallet: w }); }
    const phantom = window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
    if (phantom && !names.has('Phantom') && typeof phantom.signMessage === 'function') out.push({ id: 'legacy:phantom', name: 'Phantom', icon: null, provider: phantom });
    if (window.solflare && !names.has('Solflare') && typeof window.solflare.signMessage === 'function') out.push({ id: 'legacy:solflare', name: 'Solflare', icon: null, provider: window.solflare });
    return out;
  }

  async function connect(id) {
    const entry = list().find(w => w.id === id); if (!entry) throw Object.assign(Error('Wallet not found.'), { code: 'WALLET_NO_SIGN' });
    if (entry.wallet) {
      const w = entry.wallet, res = await w.features['standard:connect'].connect();
      const accounts = res?.accounts?.length ? res.accounts : w.accounts || [];
      const account = accounts.find(a => !a.chains || a.chains.some(c => String(c).startsWith('solana:'))) || accounts[0];
      if (!account?.address) throw Object.assign(Error('No Solana account was shared.'), { code: 'WALLET_REJECTED' });
      active = { id, name: entry.name, address: account.address,
        async sign(bytes) { const [out] = await w.features['solana:signMessage'].signMessage({ account, message: bytes }); return out?.signature; },
        async disconnect() { try { await w.features['standard:disconnect']?.disconnect(); } catch {} } };
    } else {
      const p = entry.provider; await p.connect();
      const address = p.publicKey?.toBase58?.() || p.publicKey?.toString?.();
      if (!address) throw Object.assign(Error('No Solana account was shared.'), { code: 'WALLET_REJECTED' });
      active = { id, name: entry.name, address,
        async sign(bytes) { const out = await p.signMessage(bytes, 'utf8'); return out?.signature || out; },
        async disconnect() { try { await p.disconnect(); } catch {} } };
    }
    return { name: active.name, address: active.address };
  }

  /** Signs a UTF-8 text message and returns the base64 ed25519 signature (64 bytes). */
  async function signMessage(text) {
    if (!active) throw Object.assign(Error('Connect a wallet first.'), { code: 'SIGN_IN' });
    const sig = await active.sign(new TextEncoder().encode(text)), bytes = sig instanceof Uint8Array ? sig : new Uint8Array(sig || []);
    if (bytes.length !== 64) throw Object.assign(Error('This wallet did not return a message signature.'), { code: 'WALLET_NO_SIGN' });
    return toBase64(bytes);
  }
  async function disconnect() { const a = active; active = null; if (a) await a.disconnect(); }
  /** Wallet errors → stable codes (user cancelled vs. unsupported). */
  function errorCode(e) {
    if (e?.code && /^[A-Z_]+$/.test(e.code)) return e.code;
    if (e?.code === 4001 || /reject|cancel|denied|declined|closed/i.test(e?.message || '')) return 'WALLET_REJECTED';
    return 'WALLET_NO_SIGN';
  }
  window.SBWallet = Object.freeze({ list, connect, signMessage, disconnect, errorCode, get active() { return active ? { name: active.name, address: active.address } : null; }, onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); } });
})();
