/* The approved login artwork has "Solana Devnet beta · Test tokens only." painted in. On the live build the page's own
 * network notice (second line of .login-disclaimer, reworded to "Solana Mainnet." by the Mainnet build) is shown over
 * that painted line. On the test server the notice still says Devnet, so the artwork is left as it is. */
(() => {
  const screen = document.getElementById('loginScreen'), content = screen?.querySelector('.login-content'), notice = screen?.querySelector('.login-disclaimer');
  if (!content || !notice) return;
  const parts = notice.innerHTML.split(/<br\s*\/?>/i);
  if (parts.length < 2) return;
  const holder = document.createElement('div'); holder.innerHTML = parts[parts.length - 1];
  const text = holder.textContent.trim();
  if (!text || /devnet|test token/i.test(text)) return;
  const line = document.createElement('p');
  line.className = 'login-network-note'; line.setAttribute('aria-hidden', 'true'); line.textContent = text;
  content.append(line);
})();
