/* Private live testing sign-in (RELEASE_STAGE=private only). Signs in through the pre-launch portal API
 * (Sign-In With Solana message, no transaction), then asks the server for a private pass. The server decides
 * whether this wallet may test; this page only shows the answer and opens /play/ when the pass is issued. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const status = (text, err = false) => { const el = $('#status'); el.textContent = text; el.classList.toggle('err', err); };
  async function api(action, body = {}) {
    let res;
    try { res = await fetch('/api/prelaunch', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-sb-prelaunch': '1' }, body: JSON.stringify({ ...body, action }) }); }
    catch { throw Object.assign(Error('Network error. Try again.'), { code: 'NETWORK' }); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(Error(data.error || 'Request failed.'), { code: data.code || 'SERVER_ERROR', status: res.status });
    return data;
  }
  async function enter() {
    await api('private-access');
    status('Access granted. Opening the game…');
    location.assign('/play/');
  }
  async function signIn(w) {
    const buttons = [...document.querySelectorAll('#wallets button')];
    buttons.forEach(b => { b.disabled = true; });
    try {
      status('Connecting ' + w.name + '…');
      const { address } = await SBWallet.connect(w.id);
      const challenge = await api('challenge', { wallet: address });
      // The server builds the message; the portal's own strict check confirms this site, wallet, nonce and expiry first.
      SBWallet.validateChallenge(challenge, address);
      status('Approve the sign-in message in ' + w.name + '…');
      const signature = await SBWallet.signMessage(challenge.message);
      await api('login', { wallet: address, nonce: challenge.nonce, signature });
      await enter();
    } catch (e) {
      const code = e.code === 'PRIVATE_TESTING' ? e.code : (window.SBWallet?.errorCode(e) || e.code);
      status(code === 'PRIVATE_TESTING' ? 'This wallet is not authorized for private testing.' : code === 'ORIGIN' ? 'The sign-in message does not match this site. Nothing was signed.'
        : code === 'WALLET_SECURITY_WARNING' ? 'Your wallet showed a security warning. Nothing was signed.' : code === 'WALLET_REJECTED' ? 'Sign-in was cancelled in the wallet.' : (e.message || 'Sign-in failed.'), true);
    } finally { buttons.forEach(b => { b.disabled = false; }); }
  }
  function draw() {
    const list = window.SBWallet ? SBWallet.list() : [], box = $('#wallets');
    if (!list.length) { box.replaceChildren(); status('No Solana wallet found in this browser.', true); return; }
    box.replaceChildren(...list.map(w => { const b = document.createElement('button'); b.type = 'button'; b.textContent = w.name; b.addEventListener('click', () => signIn(w)); return b; }));
    if ($('#status').classList.contains('err') && /No Solana wallet/.test($('#status').textContent)) status('');
  }
  // An existing portal session may already be enough; otherwise show the wallets.
  enter().catch(() => { draw(); window.SBWallet?.onChange(draw); });
})();
