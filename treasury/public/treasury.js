/* Treasury transparency page: renders /treasury-registry.json with DOM text nodes only (no innerHTML). Read-only.
 * Reserved RYO (held in the Burn Reserve) and burned RYO (verified burn records) are always shown as two separate figures. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const sol = lamports => lamports === null || lamports === undefined ? 'Unavailable' : (Number(lamports) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' SOL';
  const sr = raw => { if (raw === null || raw === undefined) return null; const n = BigInt(raw), whole = n / 1000000n, frac = String(n % 1000000n).padStart(6, '0').replace(/0+$/, ''); return whole.toLocaleString() + (frac ? '.' + frac : '') + ' SR'; };
  const LABEL = { verified: 'VERIFIED', mismatch: 'MISMATCH', unverified: 'UNVERIFIED', pending: 'PENDING' };
  const badge = status => el('span', LABEL[status] || String(status || 'UNKNOWN').toUpperCase(), 'badge ' + (status || 'unverified'));
  const explorer = address => 'https://explorer.solana.com/address/' + encodeURIComponent(address);
  const explorerTx = signature => 'https://explorer.solana.com/tx/' + encodeURIComponent(signature);
  const CUSTODY = { 'squads-v4-vault': 'Squads v4 multisig vault', 'phantom-single-key': 'Single-key wallet', 'program-vault': 'Program-controlled vault' };
  function link(text, href) { const a = el('a', text, 'btn'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
  function copyRow(address) {
    const row = el('div', undefined, 'row'), copy = el('button', 'Copy');
    copy.type = 'button'; copy.onclick = () => navigator.clipboard.writeText(address).then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); }).catch(() => { copy.textContent = 'Select the address'; });
    row.append(copy, link('Explorer ↗', explorer(address))); return row;
  }
  function facts(dl, pairs) { dl.replaceChildren(); for (const [k, v] of pairs) { dl.append(el('dt', k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; dl.append(dd); } }
  const stateText = s => s === 'unfunded' ? 'No SOL account yet' : s === 'system-account' ? 'Active wallet' : s;
  function walletCard(d, live, reg, overall, extra = []) {
    const card = el('article', undefined, 'card'), ver = live.verification || { status: overall === 'verified' ? 'verified' : 'unverified' };
    card.append(el('h3', d.label), el('div', d.percent ? d.percent + '%' : 'Reserve · 0% of revenue', 'pct'), badge(ver.status), el('p', d.purpose, 'note'), el('p', d.address, 'mono'), copyRow(d.address));
    const dl = el('dl', undefined, 'facts');
    facts(dl, [['Custody', CUSTODY[d.custody] || d.custody], ...extra, ['SOL', sol(live.solLamports)], ['SR', sr(live.srRaw) || (reg.srMint.address ? 'Unavailable' : 'Mint pending')], ...(ver.state ? [['State', stateText(ver.state)]] : [])]);
    card.append(dl); for (const p of [...(ver.problems || []), ...(live.tokenAccount?.problems || [])]) card.append(el('p', p, 'problem')); return card;
  }
  function render(data) {
    const reg = data.registry, v = data.verification || {};
    const status = $('status'), overall = v.status || 'unverified';
    status.className = 'status ' + (overall === 'verified' ? 'ok' : overall === 'mismatch' ? 'bad' : 'warn');
    status.textContent = overall === 'verified' ? 'Verified on Solana Mainnet at finalized commitment. ' + (data.prelaunch ? 'Pre-launch: Mainnet payments and claims are disabled.' : data.paymentsEnabled ? 'SR payments are enabled.' : 'SR payments are not enabled.')
      : overall === 'mismatch' ? 'Attention: on-chain state differs from the published registry. ' + ((v.problems || []).join(' ') || 'See the wallets below.')
      : 'Chain data is temporarily unavailable. Nothing below is shown as verified.';
    const held = v.externalHeld || {}, cf = data.claimFunding || {};
    $('held').textContent = held.status === 'verified' ? sr(held.srRaw) : held.status === 'pending' ? 'Mint pending' : 'Unavailable';
    $('heldNote').textContent = (held.note || 'Balances could not be read.') + ' Includes the Treasury; the Burn Reserve is shown separately below.';
    $('claimable').textContent = cf.availableRyo !== null && cf.availableRyo !== undefined ? Number(cf.availableRyo).toLocaleString() + ' SR' : cf.status === 'not-configured' ? 'Not configured' : 'Unavailable';
    $('claimNote').textContent = cf.note || '';
    $('claimState').replaceChildren(el('span', 'Chest claims: ' + (cf.claimsOpen ? 'OPEN' : 'CLOSED'), 'badge ' + (cf.claimsOpen ? 'verified' : 'pending')), el('span', 'SR payments: ' + (data.paymentsEnabled ? 'ENABLED' : 'DISABLED'), 'badge ' + (data.paymentsEnabled ? 'verified' : 'pending')));
    const gc = reg.gameCustody, live = v.gameCustody;
    $('custodyPanel').hidden = !gc;
    if (gc) {
      const ver = live ? live.verification || {} : { status: 'unverified' };
      $('custodyAddr').textContent = gc.address; $('custodyCopy').replaceChildren(copyRow(gc.address));
      facts($('custodyFacts'), [['Status', badge(ver.status)], ['State', ver.state === 'unfunded' ? 'Created · not active until launch' : ver.state === 'system-account' ? 'Active wallet' : ver.state || 'Unavailable'],
        ['SOL', sol(live ? live.solLamports : null)], ['SR', live && live.srRaw != null ? sr(live.srRaw) : reg.srMint.address ? 'Unavailable' : 'Mint pending']]);
    }
    $('split').replaceChildren(...reg.destinations.map(d => { const box = el('div'); box.append(el('b', d.percent + '%'), el('span', d.label)); return box; }));
    const treasury = reg.destinations.find(d => d.role === 'lockedTreasury');
    $('treasuryCard').replaceChildren(...(treasury ? [walletCard(treasury, v.destinations?.lockedTreasury || {}, reg, overall, [['Receives', '50% of service revenue · 30% of Expedition early returns · Boss Hunt share · 5% withdrawal deduction'],
      ...(reg.treasuryCustody === 'single-key' ? [['Protection', 'Owner-approved single-key wallet: no on-chain spending restriction']] : [])])] : []));
    $('wallets').replaceChildren(...reg.destinations.filter(d => d.role !== 'lockedTreasury').map(d => walletCard(d, v.destinations?.[d.role] || {}, reg, overall)));
    // Treasury migration (relocation legs): internal transfers, never revenue or burns.
    const mg = data.burnReserve && data.burnReserve.status === 'verified' ? data.burnReserve.migration : null;
    $('migrationPanel').hidden = !mg;
    if (mg) {
      $('migrationNote').textContent = mg.id + ' · ' + (mg.recordingOpen ? 'in progress' : 'completed and reconciled') + '. ' + (mg.note || '');
      $('migrationLegs').replaceChildren(...mg.legs.map(l => el('li', 'Leg ' + l.leg + ': ' + l.from + ' → ' + (l.to || 'new Squads Treasury vault (not registered yet)') + ' · ' + (sr(l.relocatedRaw) || '0 SR') + ' relocated in ' + l.transfers + ' verified transfer(s)')));
    }
    // RYO Burn Reserve: reserved (held) and burned (verified burns) are separate figures, never combined.
    const reserve = (reg.reserves || [])[0], rlive = reserve ? v.reserves?.[reserve.role] || {} : {}, burns = data.burnReserve || {};
    $('burn-reserve').hidden = !reserve;
    if (reserve) {
      $('reserved').textContent = sr(rlive.srRaw) || 'Unavailable';
      const burnedKnown = burns.status === 'verified' && burns.burnedRaw != null;
      $('burned').textContent = burnedKnown ? sr(burns.burnedRaw) : 'Unavailable';
      $('burnedNote').textContent = burnedKnown ? (burns.burns ? burns.burns + ' verified burn transaction(s).' : 'No RYO has been burned from the Burn Reserve yet.') + ' Only finalized Token-2022 burns count.' : (burns.note || 'Burn records are unavailable. Nothing is shown as burned.');
      $('reserveCard').replaceChildren(walletCard(reserve, rlive, reg, overall, [['Squads vault', '#' + (reserve.vaultIndex ?? '—') + ' of ' + reg.squads.multisig]]));
      const history = burnedKnown ? (burns.history || []).filter(h => h.kind === 'burn') : [];
      $('burns').replaceChildren(...(history.length ? history.map(h => { const li = el('li'); li.append(el('b', sr(h.amountRaw) + ' burned'), document.createTextNode(' · ' + (h.blockTime ? new Date(h.blockTime * 1000).toLocaleString() : 'time unavailable') + ' · '), link('Transaction ↗', explorerTx(h.signature))); return li; })
        : [el('li', burnedKnown ? 'No burns recorded yet.' : 'Burn history is temporarily unavailable.')]));
    }
    const s = v.squads || {};
    facts($('squads'), [['Status', badge(s.status || 'unverified')], ['Approval', s.threshold ? s.threshold + ' of ' + s.members + ' signers' : reg.squads.threshold + ' of ' + reg.squads.members + ' signers (registered)'],
      ['Time lock', (s.timeLockSeconds ?? reg.squads.timeLockSeconds) === 0 ? 'None' : (s.timeLockSeconds ?? reg.squads.timeLockSeconds) + ' s'], ['Config authority', s.configAuthority === 'set' ? 'Set — review' : s.configAuthority === 'none' ? 'None (changes need a vote)' : '—'],
      ['Proposals created', s.proposals ?? '—'], ['Multisig', el('span', reg.squads.multisig, 'mono')]]);
    const m = v.mint || {};
    facts($('mint'), reg.srMint.address ? [['Status', badge(m.status || 'unverified')], ['Address', el('span', reg.srMint.address, 'mono')], ['Program', m.program || '—'], ['Decimals', m.decimals ?? '—'], ['Total supply', sr(m.supplyRaw) || 'Unavailable'], ...(m.blocking?.length ? [['Blocking', m.blocking.join(' ')]] : [])]
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
