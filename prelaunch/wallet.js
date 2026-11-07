/* prelaunch-wallet-security-v1: SIWS text signatures only. No transaction API or RPC.
 * Keep Wallet Standard compatibility; MetaMask is temporarily hidden pending warning review. */
(() => {
  'use strict';
  const standard = new Set(), listeners = new Set();
  let active = null, epoch = 0;
  const changed = (type = 'registry') => listeners.forEach(fn => { try { fn({ type }); } catch {} });
  const error = code => Object.assign(Error(code), { code });
  const normalized = name => String(name || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  const addressOf = key => key?.toBase58?.() || key?.toString?.();
  const blocked = w => normalized(w?.name).includes('metamask') || w?.isMetaMask === true;
  const solanaAccount = a => a && typeof a.address === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.address)
    && Array.isArray(a.chains) && a.chains.some(c => typeof c === 'string' && c.startsWith('solana:'))
    && Array.isArray(a.features) && a.features.includes('solana:signMessage');
  const usable = w => w && typeof w.name === 'string' && w.name.trim().length > 0 && w.name.length <= 80 && !blocked(w)
    && typeof w.features?.['standard:connect']?.connect === 'function' && typeof w.features?.['solana:signMessage']?.signMessage === 'function'
    && Array.isArray(w.chains) && w.chains.some(c => typeof c === 'string' && c.startsWith('solana:'));
  const safeIcon = icon => typeof icon === 'string' && icon.length <= 16384 && /^data:image\/(svg\+xml|png|webp|gif|jpeg);/.test(icon) ? icon : null;
  const bytes = value => value instanceof Uint8Array ? value : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : Array.isArray(value) ? Uint8Array.from(value) : new Uint8Array();
  const equal = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);
  const api = Object.freeze({ register(...wallets) {
    wallets.forEach(w => standard.add(w)); changed();
    return () => { wallets.forEach(w => standard.delete(w)); if (active && wallets.includes(active.wallet)) active.invalidate(); changed(); };
  } });
  addEventListener('wallet-standard:register-wallet', e => { try { e.detail(api); } catch {} });
  try { dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api })); } catch {}

  function entries() {
    const out = [], names = new Set();
    for (const w of standard) try {
      const name = normalized(w.name);
      if (usable(w) && !names.has(name)) { names.add(name); out.push({ id: 'std:' + w.name, name: w.name.trim(), icon: safeIcon(w.icon), wallet: w }); }
    } catch {} // One malformed registration must not discard other compatible wallets.
    const phantom = window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
    for (const [name, provider] of [['Phantom', phantom], ['Solflare', window.solflare]]) {
      if (provider && !blocked(provider) && !names.has(normalized(name)) && typeof provider.connect === 'function' && typeof provider.signMessage === 'function') out.push({ id: 'legacy:' + name.toLowerCase(), name, icon: null, provider });
    }
    const rank = w => normalized(w.name) === 'phantom' ? 0 : normalized(w.name) === 'solflare' ? 1 : 2;
    return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }
  // Expose discovery metadata, not providers and their transaction capabilities.
  const list = () => entries().map(({ id, name, icon }) => ({ id, name, icon, kind: ['phantom', 'solflare'].includes(normalized(name)) ? normalized(name) : 'other' }));

  function validateChallenge(challenge, address, network) {
    const text = challenge?.message, lines = typeof text === 'string' ? text.split('\n') : [];
    if (lines.length !== 11 || lines[0] !== location.host + ' wants you to sign in with your Solana account:' || lines[1] !== address || lines[2] !== '' || lines[4] !== ''
      || lines[3] !== 'Sign in to Shinobi Bombers. This is free: it does not send a transaction or move any funds.'
      || lines[5] !== 'URI: ' + location.origin || lines[6] !== 'Version: 1' || !/^Chain ID: (mainnet|devnet)$/.test(lines[7])
      || typeof challenge.nonce !== 'string' || !/^Nonce: [a-f0-9]{32}$/.test(lines[8]) || lines[8] !== 'Nonce: ' + challenge.nonce
      || (network && lines[7] !== 'Chain ID: ' + String(network).toLowerCase())) throw error('ORIGIN');
    const issued = Date.parse(lines[9].replace(/^Issued At: /, '')), expires = Date.parse(lines[10].replace(/^Expiration Time: /, ''));
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || lines[9] !== 'Issued At: ' + new Date(issued).toISOString()
      || lines[10] !== 'Expiration Time: ' + new Date(expires).toISOString() || expires - issued !== 120000 || expires <= Date.now() || issued > Date.now() + 60000) throw error('SIGNATURE_INVALID');
    return text;
  }

  async function connect(id) {
    const entry = entries().find(w => w.id === id); if (!entry) throw error('WALLET_NO_SIGN');
    const serial = ++epoch; active?.cleanup(); active = null;
    let a; const cleanups = [];
    if (entry.wallet) {
      const w = entry.wallet, res = await w.features['standard:connect'].connect();
      const accounts = Array.isArray(res?.accounts) ? res.accounts : w.accounts;
      const account = Array.isArray(accounts) && accounts.find(solanaAccount); if (!account) throw error('WALLET_REJECTED');
      a = { id, name: entry.name, address: account.address, wallet: w,
        async sign(message) {
          const [out] = await w.features['solana:signMessage'].signMessage({ account, message });
          if (!out || (out.signatureType && out.signatureType !== 'ed25519') || (out.signedMessage && !equal(bytes(out.signedMessage), message)) || (out.account && out.account.address !== a.address)) throw error('SIGNATURE_INVALID');
          return out.signature;
        }, async disconnect() { await w.features['standard:disconnect']?.disconnect(); } };
      if (typeof w.features['standard:events']?.on === 'function') cleanups.push(w.features['standard:events'].on('change', change => {
        if (Array.isArray(change.accounts) && !change.accounts.some(x => solanaAccount(x) && x.address === a.address)) a.invalidate?.();
      }));
    } else {
      const p = entry.provider; await p.connect();
      const address = addressOf(p.publicKey); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address || '')) throw error('WALLET_REJECTED');
      a = { id, name: entry.name, address,
        async sign(message) { if (addressOf(p.publicKey) !== address) { a.invalidate(); throw error('SIGN_IN'); } const out = await p.signMessage(message, 'utf8'); if (addressOf(p.publicKey) !== address) { a.invalidate(); throw error('SIGN_IN'); } return out?.signature || out; },
        async disconnect() { await p.disconnect?.(); } };
      if (typeof p.on === 'function') for (const [event, fn] of [['accountChanged', key => { if (addressOf(key) !== address) a.invalidate?.(); }], ['disconnect', () => a.invalidate?.()]]) {
        p.on(event, fn); cleanups.push(() => { if (p.removeListener) p.removeListener(event, fn); else p.off?.(event, fn); });
      }
    }
    a.cleanup = () => { for (const fn of cleanups.splice(0)) try { if (typeof fn === 'function') fn(); } catch {} };
    a.invalidate = () => { if (active === a) { active = null; epoch++; a.cleanup(); changed('session'); } };
    if (serial !== epoch || (entry.wallet && (!standard.has(entry.wallet) || blocked(entry.wallet)))) { a.cleanup(); throw error('SIGN_IN'); }
    active = a; return { name: a.name, address: a.address };
  }

  async function signMessage(text) {
    const a = active, serial = epoch; if (!a) throw error('SIGN_IN');
    if(a.wallet && !usable(a.wallet)) { a.invalidate(); throw error('WALLET_NO_SIGN'); }
    validateChallenge({ message:text, nonce:typeof text==='string'?text.match(/\nNonce: ([a-f0-9]{32})\n/)?.[1]:undefined }, a.address);
    const message=new TextEncoder().encode(text), original=message.slice(), signature = bytes(await a.sign(message));
    if(!equal(message,original))throw error('SIGNATURE_INVALID');
    if (active !== a || serial !== epoch) throw error('SIGN_IN');
    if (signature.length !== 64) throw error('WALLET_NO_SIGN');
    let raw = ''; for (const n of signature) raw += String.fromCharCode(n); return btoa(raw);
  }
  async function disconnect() { const a = active; active = null; epoch++; a?.cleanup(); try { await a?.disconnect(); } catch {} }
  function errorCode(e) {
    if (/phish|drain|malicious|security (warning|alert)|continue at your own risk/i.test(e?.message || '')) return 'WALLET_SECURITY_WARNING';
    if (e?.code && /^[A-Z_]+$/.test(e.code)) return e.code;
    if (e?.code === 4001 || /reject|cancel|denied|declined|closed/i.test(e?.message || '')) return 'WALLET_REJECTED';
    return 'WALLET_NO_SIGN'; // Never retry through another wallet or suppress its warning.
  }
  window.SBWallet = Object.freeze({ list, connect, signMessage, validateChallenge, disconnect, errorCode,
    get active() { return active ? { name: active.name, address: active.address } : null; }, onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); } });
})();
