/* Treasury transparency page: renders /treasury-registry.json with DOM text nodes only (no innerHTML). Read-only. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const sol = lamports => lamports === null || lamports === undefined ? 'Unavailable' : (Number(lamports) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' SOL';
  const sr = raw => { if (raw === null || raw === undefined) return null; const n = BigInt(raw), whole = n / 1000000n, frac = String(n % 1000000n).padStart(6, '0').replace(/0+$/, ''); return whole.toLocaleString() + (frac ? '.' + frac : '') + ' SR'; };
  const LABEL = { verified: 'VERIFIED', mismatch: 'MISMATCH', unverified: 'UNVERIFIED', pending: 'PENDING' };
  const badge = status => el('span', LABEL[status] || String(status || 'UNKNOWN').toUpperCase(), 'badge ' + (status || 'unverified'));
  const explorer = address => 'https://explorer.solana.com/address/' + encodeURIComponent(address);
  const CUSTODY = { 'squads-v4-vault': 'Squads v4 multisig vault', 'phantom-single-key': 'Single-key wallet', 'program-vault': 'Program-controlled vault' };
  function copyRow(address) {
    const row = el('div', undefined, 'row'), copy = el('button', 'Copy'), link = el('a', 'Explorer ↗', 'btn');
    copy.type = 'button'; copy.onclick = () => navigator.clipboard.writeText(address).then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); }).catch(() => { copy.textContent = 'Select the address'; });
    link.href = explorer(address); link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(copy, link); return row;
  }
  function facts(dl, pairs) { dl.replaceChildren(); for (const [k, v] of pairs) { dl.append(el('dt', k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; dl.append(dd); } }
  function render(data) {
    const reg = data.registry, v = data.verification || {};
    const status = $('status'), overall = v.status || 'unverified';
    status.className = 'status ' + (overall === 'verified' ? 'ok' : overall === 'mismatch' ? 'bad' : 'warn');
    status.textContent = overall === 'verified' ? 'Verified on Solana Mainnet at finalized commitment. ' + (data.prelaunch ? 'Pre-launch: Mainnet payments and claims are disabled.' : data.paymentsEnabled ? 'SR payments are enabled.' : 'SR payments are not enabled.')
      : overall === 'mismatch' ? 'Attention: on-chain state differs from the published registry. ' + ((v.problems || []).join(' ') || 'See the wallets below.')
      : 'Chain data is temporarily unavailable. Nothing below is shown as verified.';
    const held = v.externalHeld || {}, cf = data.claimFunding || {};
    $('held').textContent = held.status === 'verified' ? sr(held.srRaw) : held.status === 'pending' ? 'Mint pending' : 'Unavailable';
    $('heldNote').textContent = held.note || 'Balances could not be read.';
    $('claimable').textContent = cf.availableRyo !== null && cf.availableRyo !== undefined ? Number(cf.availableRyo).toLocaleString() + ' SR' : cf.status === 'not-configured' ? 'Not configured' : 'Unavailable';
    $('claimNote').textContent = cf.note || '';
    $('claimState').replaceChildren(el('span', 'Chest claims: ' + (cf.claimsOpen ? 'OPEN' : 'CLOSED'), 'badge ' + (cf.claimsOpen ? 'verified' : 'pending')), el('span', 'SR payments: ' + (data.paymentsEnabled ? 'ENABLED' : 'DISABLED'), 'badge ' + (data.paymentsEnabled ? 'verified' : 'pending')));
    $('split').replaceChildren(...reg.destinations.map(d => { const box = el('div'); box.append(el('b', d.percent + '%'), el('span', d.label)); return box; }));
    $('wallets').replaceChildren(...reg.destinations.map(d => {
      const live = v.destinations?.[d.role] || {}, card = el('article', undefined, 'card'), ver = live.verification || { status: overall === 'verified' ? 'verified' : 'unverified' };
      card.append(el('h3', d.label), el('div', d.percent + '%', 'pct'), badge(ver.status), el('p', d.purpose, 'note'), el('p', d.address, 'mono'), copyRow(d.address));
      const dl = el('dl', undefined, 'facts'); facts(dl, [['Custody', CUSTODY[d.custody] || d.custody], ['SOL', sol(live.solLamports)], ['SR', sr(live.srRaw) || (reg.srMint.address ? 'Unavailable' : 'Mint pending')], ...(ver.state ? [['State', ver.state === 'unfunded' ? 'Not funded yet' : ver.state === 'system-account' ? 'Active wallet' : ver.state]] : [])]);
      card.append(dl); for (const p of ver.problems || []) card.append(el('p', p, 'problem')); return card;
    }));
    const s = v.squads || {};
    facts($('squads'), [['Status', badge(s.status || 'unverified')], ['Approval', s.threshold ? s.threshold + ' of ' + s.members + ' signers' : reg.squads.threshold + ' of ' + reg.squads.members + ' signers (registered)'],
      ['Time lock', (s.timeLockSeconds ?? reg.squads.timeLockSeconds) === 0 ? 'None' : (s.timeLockSeconds ?? reg.squads.timeLockSeconds) + ' s'], ['Config authority', s.configAuthority === 'set' ? 'Set — review' : s.configAuthority === 'none' ? 'None (changes need a vote)' : '—'],
      ['Proposals created', s.proposals ?? '—'], ['Multisig', el('span', reg.squads.multisig, 'mono')], ['Vault', '#' + reg.squads.vaultIndex + ' (Squads "Account ' + (reg.squads.vaultIndex + 1) + '")']]);
    const m = v.mint || {};
    facts($('mint'), reg.srMint.address ? [['Status', badge(m.status || 'unverified')], ['Address', el('span', reg.srMint.address, 'mono')], ['Program', m.program || '—'], ['Decimals', m.decimals ?? '—'], ...(m.blocking?.length ? [['Blocking', m.blocking.join(' ')]] : [])]
      : [['Status', badge('pending')], ['Address', 'Not launched yet']]);
    $('rules').replaceChildren(...reg.rules.map(r => el('li', r)));
    $('observed').textContent = v.observedAt ? 'Observed ' + new Date(v.observedAt).toLocaleString() : 'Not observed';
  }
  async function load() {
    try { const res = await fetch('/treasury-registry.json', { cache: 'no-store' }); if (!res.ok) throw Error(String(res.status)); render(await res.json()); }
    catch { const s = $('status'); s.className = 'status warn'; s.textContent = 'The treasury registry is temporarily unavailable. Refresh in a minute.'; }
  }
  load(); setInterval(() => { if (!document.hidden) load(); }, 120000);
})();
