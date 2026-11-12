/* Shinobi Command Center — Stats report drawing (window.CCReport). Loaded before cc.js.
 * Draws the answer of the cc-stats-report action (totals and per-hour/day series, no wallets) as tiles, SVG charts and
 * tables. Every value goes in with textContent or an SVG attribute, never as HTML. The page runs under
 * "style-src 'self'", so sizes and colours are set through element.style (CSSOM) and SVG attributes, never style="". */
(() => {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';
  const L = {
    en: {
      spent: 'Ryo spent', deposited: 'SR deposited', summoned: 'Heroes summoned', free: 'Free heroes given', sol: 'SOL sales', withdrawn: 'Withdrawn',
      claims: 'Chest claims', players: 'Players', orders: 'orders', depositsN: 'deposits', shrine: 'Shrine orders', sources: 'Founder, Hero Pass, Starter, referral, rescue',
      boxes: 'boxes in range', allTime: 'all time', confirmed: 'confirmed withdrawals', claimsN: 'claims', fromChests: 'spent from Chests', profiles: 'game profiles', withKills: 'with Adventure kills',
      moneyTitle: 'Ryo in and out (cumulative)', moneySub: 'SR deposited (fee-free, 1 SR = 1 Ryo) against Ryo spent on services.',
      perTitle: 'Ryo spent per {b}, by service', heroesTitle: 'Heroes added (cumulative)', byService: 'Ryo spent by service', pots: 'Where the SR revenue went',
      potsNote: 'Ryo spent is routed as SR revenue: 50 / 30 / 10 / 10.', rarity: 'Rarity of summoned heroes', actual: 'Actual share', odds: 'Published odds',
      rarityNote: '{n} paid summons against the published 60 / 25 / 10 / 4 / 1 odds.', freeBy: 'Free heroes by source', chest: 'Adventure Chest and withdrawals',
      claimed: 'Claimed to balance', chestSpent: 'Spent from Chests', inChests: 'Still in Chests (now)', withdrawnSR: 'Withdrawn', founders: 'Founder box sales',
      tier: 'Tier', inRange: 'In range', total: 'Total', noSales: 'Mythic Box: {m} sold ({ms} SOL). Sensei for SOL: {s} sold ({ss} SOL).',
      chestNote: '{k} Adventure kills by {p} players (lifetime, no history is kept).', notes: 'How to read these numbers', table: 'Figures per {b} as a table',
      by: 'By', to: 'to', hour: 'hour', day: 'day', markers: 'Dashed lines: {list}.', launch: 'Launch',
      n1: 'Ryo spent counts confirmed purchases only; {chest} of it was paid from Adventure Chests.',
      n2: 'Players: {p} game profiles; {r} used the pre-launch registration ({nr} in range). Sign-ups over time and daily active players are not recorded.',
      n3: 'Withdrawals count confirmed ones only. By status in range: {s}.', n4: 'Purchases by status in range: {s}.', n5: 'Times are shown in your time zone ({tz}). Day groups are UTC days.',
      summon: 'Summon', dojo: 'Dojo', fusion: 'Fusion', training: 'Training', expedition: 'Expedition', other: 'Other',
      summonedLine: 'Summoned at the Shrine', freeLine: 'Given free', none: 'Nothing in this range.',
      hdr: ['Time', 'Deposited', 'Spent', 'Summon', 'Dojo', 'Fusion', 'Training', 'Heroes summoned', 'Free heroes', 'Chest claims', 'Withdrawn'],
    },
    pt: {
      spent: 'Ryo gasto', deposited: 'SR depositado', summoned: 'Heróis invocados', free: 'Heróis grátis', sol: 'Vendas em SOL', withdrawn: 'Sacado',
      claims: 'Resgates do Baú', players: 'Jogadores', orders: 'pedidos', depositsN: 'depósitos', shrine: 'pedidos no Santuário', sources: 'Fundador, Hero Pass, Starter, indicação, resgate',
      boxes: 'caixas no período', allTime: 'desde o início', confirmed: 'saques confirmados', claimsN: 'resgates', fromChests: 'gastos dos Baús', profiles: 'perfis de jogo', withKills: 'com abates na Aventura',
      moneyTitle: 'Entrada e saída de Ryo (acumulado)', moneySub: 'SR depositado (sem taxa, 1 SR = 1 Ryo) contra Ryo gasto em serviços.',
      perTitle: 'Ryo gasto por {b}, por serviço', heroesTitle: 'Heróis adicionados (acumulado)', byService: 'Ryo gasto por serviço', pots: 'Destino da receita em SR',
      potsNote: 'O Ryo gasto é distribuído como receita em SR: 50 / 30 / 10 / 10.', rarity: 'Raridade dos heróis invocados', actual: 'Parcela real', odds: 'Chances publicadas',
      rarityNote: '{n} invocações pagas contra as chances publicadas de 60 / 25 / 10 / 4 / 1.', freeBy: 'Heróis grátis por origem', chest: 'Baú da Aventura e saques',
      claimed: 'Resgatado para o saldo', chestSpent: 'Gasto dos Baús', inChests: 'Ainda nos Baús (agora)', withdrawnSR: 'Sacado', founders: 'Vendas de caixas de Fundador',
      tier: 'Nível', inRange: 'No período', total: 'Total', noSales: 'Mythic Box: {m} vendidas ({ms} SOL). Sensei por SOL: {s} vendidos ({ss} SOL).',
      chestNote: '{k} abates na Aventura por {p} jogadores (desde o início, sem histórico).', notes: 'Como ler estes números', table: 'Valores por {b} em tabela',
      by: 'Até', to: 'a', hour: 'hora', day: 'dia', markers: 'Linhas tracejadas: {list}.', launch: 'Lançamento',
      n1: 'O Ryo gasto conta somente compras confirmadas; {chest} foram pagos com Baús da Aventura.',
      n2: 'Jogadores: {p} perfis de jogo; {r} usaram o cadastro de pré-lançamento ({nr} no período). Cadastros ao longo do tempo e jogadores ativos por dia não são registrados.',
      n3: 'Saques contam somente os confirmados. Por status no período: {s}.', n4: 'Compras por status no período: {s}.', n5: 'Horários no seu fuso ({tz}). Agrupamentos por dia usam dias UTC.',
      summon: 'Invocação', dojo: 'Dojo', fusion: 'Fusão', training: 'Treino', expedition: 'Expedição', other: 'Outro',
      summonedLine: 'Invocados no Santuário', freeLine: 'Dados grátis', none: 'Nada neste período.',
      hdr: ['Horário', 'Depositado', 'Gasto', 'Invocação', 'Dojo', 'Fusão', 'Treino', 'Heróis invocados', 'Heróis grátis', 'Resgates do Baú', 'Sacado'],
    },
  };
  const LAUNCH = Date.UTC(2026, 10, 9, 14, 40);
  const SWITCH_NAMES = { chestSpending: 'Chest spending', heroPassClaims: 'Hero Pass claims', training: 'Training', dojo: 'Dojo', fusion: 'Fusion', expeditions: 'Expeditions', claims: 'Claims', withdrawals: 'Withdrawals' };
  const PRODUCTS = ['summon', 'dojo', 'fusion', 'training'];
  const PCOLOR = { summon: '--sr-1', dojo: '--sr-2', fusion: '--sr-3', training: '--sr-4' };
  const RANKS = [['Genin', 60], ['Chunin', 25], ['Jonin', 10], ['Elite', 4], ['Legend', 1]];
  const POTS = [['lockedTreasury', 'Treasury'], ['activeRewards', 'Active Rewards'], ['communityRewards', 'Community Rewards'], ['economicReserve', 'Economic Reserve']];
  const SOURCES = [['founder-limited', 'Founder limited summons'], ['founder-premium', 'Founder premium summons'], ['starter-activation', 'Starter Activation'], ['hero-pass', 'Hero Pass'], ['referral', 'Referral rewards'], ['prison-rescue', 'Prison rescues'], ['boss-hunt', 'Boss Hunt awards'], ['starter-pack', 'Starter Pack']];

  const fmt = v => Number(v || 0).toLocaleString();
  const mil = v => { const x = Number(v || 0); return Math.abs(x) >= 1e6 ? (x / 1e6).toLocaleString(undefined, { maximumFractionDigits: Math.abs(x) >= 1e8 ? 1 : 2 }) + 'M' : fmt(x); };
  const sol = v => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
  const pct = (a, b) => (b ? 100 * a / b : 0);
  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const tzLabel = () => { const m = -new Date().getTimezoneOffset(), s = m >= 0 ? '+' : '−', a = Math.abs(m); return 'UTC' + s + Math.floor(a / 60) + (a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''); };
  function el(tag, attrs, text) { const e = document.createElement(tag); for (const k in attrs || {}) if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
  function sv(tag, attrs, text) { const e = document.createElementNS(SVG, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
  const timeLabel = (ms, bucket) => { const d = new Date(ms); return bucket === 'day' ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

  /* ---------- Tooltip (one per report root, kept inside it) ---------- */
  function makeTip(root) {
    const tip = el('div', { class: 'sr-tip', role: 'status', 'aria-live': 'polite' }); root.append(tip);
    return {
      show(evt, lines) {
        tip.replaceChildren(...lines.map(([color, label, value]) => { const d = el('div'); if (color) { const s = el('span', { class: 'sr-sw' }); s.style.background = color; d.append(s); } d.append(value == null ? label : label + ': '); if (value != null) d.append(el('b', {}, value)); return d; }));
        tip.classList.add('on');
        const r = root.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
        let x = evt.clientX - r.left + 14, y = evt.clientY - r.top - th - 10;
        if (x + tw > r.width - 6) x = evt.clientX - r.left - tw - 14;
        if (y < 4) y = evt.clientY - r.top + 16;
        tip.style.left = Math.max(4, x) + 'px'; tip.style.top = y + 'px';
      },
      hide() { tip.classList.remove('on'); },
    };
  }

  /* ---------- Time-axis frame ---------- */
  function niceMax(max) { if (max <= 0) return 1; const p = 10 ** Math.floor(Math.log10(max)), m = max / p; return [1, 2, 2.5, 3, 4, 5, 6, 8, 10].find(s => m <= s) * p; }
  function frame(box, ctx, height, yMax, yFmt) {
    const W = Math.max(300, box.clientWidth || 600), narrow = W < 560, M = { l: 54, r: narrow ? 12 : 84, t: 22, b: 30 };
    const svg = sv('svg', { viewBox: `0 0 ${W} ${height}`, height, role: 'img', class: 'sr-svg' });
    const { start, end, step } = ctx;
    const x = t => M.l + (t - start) / (end + step - start) * (W - M.l - M.r);
    const y = v => height - M.b - v / yMax * (height - M.t - M.b);
    const grid = sv('g', { class: 'sr-grid' }), axis = sv('g', { class: 'sr-axis' });
    for (let i = 0; i <= 4; i++) { const v = yMax * i / 4; grid.append(sv('line', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) })); axis.append(sv('text', { x: M.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, yFmt(v))); }
    const n = ctx.buckets.length, every = Math.max(1, Math.ceil(n / (narrow ? 4 : 8)));
    ctx.buckets.forEach((t, i) => { if (i % every === 0) axis.append(sv('text', { x: x(t + step / 2), y: height - 10, 'text-anchor': 'middle' }, timeLabel(t, ctx.bucket))); });
    svg.append(grid, axis);
    const mk = sv('g', { class: 'sr-marker' });
    ctx.markers.forEach((m, i) => { const mx = x(m.t); mk.append(sv('line', { x1: mx, x2: mx, y1: M.t - 6, y2: height - M.b }), sv('text', { x: mx + 3, y: M.t - 8 }, String(i + 1))); });
    svg.append(mk);
    return { svg, x, y, W, M, height, narrow };
  }

  function lineChart(box, ctx, tip, series, yFmt, valFmt) {
    box.replaceChildren();
    const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)) * 1.05), f = frame(box, ctx, 280, max, yFmt), { step } = ctx;
    const colors = series.map(s => css(s.color));
    series.forEach((s, si) => {
      const pts = ctx.buckets.map((t, i) => [f.x(t + step), f.y(s.values[i])]);
      f.svg.append(sv('path', { d: `M${f.x(ctx.start)},${f.y(0)} ` + pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '), fill: 'none', stroke: colors[si], 'stroke-width': 2, 'stroke-linejoin': 'round' }));
      const last = pts[pts.length - 1];
      if (last) {
        f.svg.append(sv('circle', { cx: last[0], cy: last[1], r: 4, fill: colors[si], stroke: css('--surface'), 'stroke-width': 2 }));
        if (!f.narrow) { const other = si ? f.y(series[0].values.at(-1)) : null; f.svg.append(sv('text', { class: 'sr-end', x: last[0] + 8, y: last[1] + 4 + (other != null && Math.abs(other - last[1]) < 14 ? 14 : 0) }, valFmt(s.values.at(-1)))); }
      }
    });
    const cross = sv('line', { y1: f.M.t, y2: f.height - f.M.b, class: 'sr-cross', opacity: 0 });
    const dots = series.map((s, si) => sv('circle', { r: 4, fill: colors[si], stroke: css('--surface'), 'stroke-width': 2, opacity: 0 }));
    const hit = sv('rect', { x: f.M.l, y: 0, width: f.W - f.M.l - f.M.r, height: f.height, fill: 'transparent' });
    f.svg.append(cross, ...dots, hit);
    hit.addEventListener('pointermove', evt => {
      const r = f.svg.getBoundingClientRect(), px = (evt.clientX - r.left) * f.W / r.width, stepPx = f.x(ctx.start + step) - f.x(ctx.start);
      const i = Math.max(0, Math.min(ctx.buckets.length - 1, Math.round((px - f.x(ctx.start + step)) / stepPx))), cx = f.x(ctx.buckets[i] + step);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('opacity', 1);
      dots.forEach((d, si) => { d.setAttribute('cx', cx); d.setAttribute('cy', f.y(series[si].values[i])); d.setAttribute('opacity', 1); });
      tip.show(evt, [[null, ctx.L.by + ' ' + timeLabel(ctx.buckets[i] + step, ctx.bucket)], ...series.map((s, si) => [colors[si], s.name, valFmt(s.values[i])])]);
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); dots.forEach(d => d.setAttribute('opacity', 0)); tip.hide(); });
    box.append(f.svg);
  }

  function stackedBars(box, ctx, tip, stacks) {
    box.replaceChildren();
    const totals = ctx.buckets.map((_, i) => stacks.reduce((s, k) => s + k.values[i], 0));
    const f = frame(box, ctx, 260, niceMax(Math.max(1, ...totals) * 1.05), v => (v ? mil(v) : '0')), { step } = ctx;
    const bw = Math.max(1, f.x(ctx.start + step) - f.x(ctx.start) - (ctx.buckets.length > 200 ? 0.5 : 2));
    const colors = stacks.map(k => css(k.color));
    ctx.buckets.forEach((t, i) => {
      if (!totals[i]) return;
      let acc = 0; const g = sv('g');
      stacks.forEach((k, ki) => { const v = k.values[i]; if (!v) return; const y0 = f.y(acc), y1 = f.y(acc + v); acc += v;
        g.append(sv('rect', { x: f.x(t) + 0.5, y: y1, width: bw, height: Math.max(1, y0 - y1 - (acc < totals[i] ? 1.5 : 0)), rx: Math.min(2, bw / 2), fill: colors[ki] })); });
      const hit = sv('rect', { x: f.x(t), y: f.M.t, width: bw + 1, height: f.height - f.M.t - f.M.b, fill: 'transparent' });
      hit.addEventListener('pointermove', evt => tip.show(evt, [[null, timeLabel(t, ctx.bucket) + ' ' + ctx.L.to + ' ' + timeLabel(t + step, ctx.bucket)], ...stacks.map((k, ki) => [colors[ki], k.name, k.values[i]]).filter(x => x[2]).map(([c, name, v]) => [c, name, fmt(v) + ' Ryo']), [null, ctx.L.total, fmt(totals[i]) + ' Ryo']]));
      hit.addEventListener('pointerleave', () => tip.hide());
      g.append(hit); f.svg.append(g);
    });
    box.append(f.svg);
  }

  // Horizontal bars as HTML rows: label, bar (optional reference tick), printed value.
  function barRows(items, tip, { color = '--sr-1', max } = {}) {
    const top = max || Math.max(1, ...items.map(r => r.value)), wrap = el('div', { class: 'sr-rows' });
    for (const r of items) {
      const row = el('div', { class: 'sr-row' }), bar = el('div', { class: 'sr-bar' }), b = el('b');
      b.style.width = Math.min(100, pct(r.value, top)).toFixed(2) + '%'; b.style.background = css(r.color || color); bar.append(b);
      if (r.ref != null) { const tk = el('span', { class: 'sr-tick' }); tk.style.left = 'calc(' + Math.min(100, pct(r.ref, top)).toFixed(2) + '% - 1.5px)'; bar.append(tk); }
      const val = el('div', { class: 'sr-val' }, r.text); if (r.note) val.append(el('em', {}, r.note));
      row.append(el('div', { class: 'sr-lab' }, r.label), bar, val);
      if (r.tip) { row.addEventListener('pointermove', evt => tip.show(evt, r.tip)); row.addEventListener('pointerleave', () => tip.hide()); }
      wrap.append(row);
    }
    return wrap;
  }
  function legend(items) { const d = el('div', { class: 'sr-legend' }); for (const [name, color, ref] of items) { const s = el('span'), i = el('i', ref ? { class: 'ref' } : {}); if (!ref) i.style.background = css(color); s.append(i, name); d.append(s); } return d; }
  const card = (title, ...kids) => { const c = el('section', { class: 'card sr-card' }); if (title) c.append(el('h3', {}, title)); c.append(...kids.filter(Boolean)); return c; };
  const note = text => el('p', { class: 'sr-note' }, text);

  /* ---------- The report ---------- */
  function render(root, d, lang) {
    const T = L[lang] || L.en, S = d.series || {}, X = d.totals;
    const since = Date.parse(d.since), until = Date.parse(d.until), bucket = d.bucket, step = bucket === 'day' ? 86400000 : 3600000;
    const start = Math.floor(since / step) * step, end = Math.floor((until - 1) / step) * step, buckets = [];
    for (let t = start; t <= end; t += step) buckets.push(t);
    const idx = new Map(buckets.map((t, i) => [t, i]));
    const series = (rows, val, keep) => { const out = buckets.map(() => 0); for (const r of rows || []) { if (keep && !keep(r)) continue; const i = idx.get(Date.parse(r.t)); if (i != null) out[i] += Number(val(r)) || 0; } return out; };
    const cum = a => { let s = 0; return a.map(v => (s += v)); };
    const markers = [...(LAUNCH >= since && LAUNCH < until ? [{ t: LAUNCH, label: T.launch }] : []),
      ...(d.switches || []).filter(s => s.enabled === true).map(s => ({ t: Date.parse(s.t), label: (SWITCH_NAMES[s.key] || s.key) + ' on' }))].filter(m => m.t >= start && m.t <= end + step);
    const ctx = { start, end, step, bucket, buckets, markers, L: T };
    root.replaceChildren(); root.classList.add('sr-root');
    const tip = makeTip(root);
    const bName = T[bucket];

    // Tiles
    const fAll = (d.allTime?.founders || []).reduce((a, f) => ({ n: a.n + f.n, sol: a.sol + f.sol }), { n: 0, sol: 0 });
    const tiles = [
      [T.spent, mil(X.ryoSpent.ryo), 'Ryo', fmt(X.ryoSpent.orders) + ' ' + T.orders],
      [T.deposited, mil(X.deposits.ryo), 'SR', fmt(X.deposits.n) + ' ' + T.depositsN],
      [T.summoned, fmt(X.summons.heroes), '', fmt(X.summons.orders) + ' ' + T.shrine + ' · ' + mil(X.summons.ryo) + ' Ryo'],
      [T.free, fmt(X.freeHeroes.total), '', T.sources],
      [T.sol, sol(X.solSales), 'SOL', fmt(X.founders.n) + ' ' + T.boxes + ' · ' + sol(fAll.sol) + ' SOL, ' + fmt(fAll.n) + ' ' + T.allTime],
      [T.withdrawn, mil(X.withdrawals.ryo), 'Ryo', fmt(X.withdrawals.n) + ' ' + T.confirmed],
      [T.claims, mil(X.chestClaims.ryo), 'Ryo', fmt(X.chestClaims.n) + ' ' + T.claimsN + ' · ' + mil(X.chestSpends.ryo) + ' ' + T.fromChests],
      [T.players, fmt(d.allTime?.profiles), '', T.profiles + ' · ' + fmt(d.allTime?.adventure?.hunters) + ' ' + T.withKills],
    ];
    const tileGrid = el('div', { class: 'grid kpis sr-tiles' });
    for (const [k, v, unit, sub] of tiles) { const a = el('article', { class: 'card kpi' }); const strong = el('strong', {}, v); if (unit) strong.append(el('small', {}, ' ' + unit)); a.append(el('div', { class: 'eyebrow' }, k), strong, el('div', { class: 'src' }, sub)); tileGrid.append(a); }

    // Series
    const paid = r => r.funding !== 'bonus', legacy = series(S.legacySpends, r => r.ryo);
    const perProduct = Object.fromEntries(PRODUCTS.map(p => [p, series(S.spending, r => r.ryo, r => r.product === p && paid(r))]));
    const otherSpend = series(S.spending, r => r.ryo, r => !PRODUCTS.includes(r.product) && paid(r)).map((v, i) => v + legacy[i]);
    const stacks = [...PRODUCTS.map(p => ({ name: T[p], color: PCOLOR[p], values: perProduct[p] })), ...(otherSpend.some(Boolean) ? [{ name: T.other, color: '--sr-5', values: otherSpend }] : [])];
    const dep = series(S.deposits, r => r.ryo), spent = series(S.spending, r => r.ryo, paid).map((v, i) => v + legacy[i]);
    const summoned = series(S.spending, r => r.heroes, r => r.product === 'summon' && r.funding !== 'bonus'), free = series(S.freeHeroes, r => r.n);
    const claims = series(S.claims, r => r.ryo), withdrawn = series(S.withdrawals, r => r.ryo, r => r.status === 'confirmed');

    const moneyBox = el('div', { class: 'sr-chart', id: 'sr-money' }), barsBox = el('div', { class: 'sr-chart', id: 'sr-bars' }), heroBox = el('div', { class: 'sr-chart', id: 'sr-heroes' });
    const markerNote = markers.length ? note(fill(T.markers, { list: markers.map((m, i) => (i + 1) + ' ' + m.label + ' (' + timeLabel(m.t, 'hour') + ')').join(', ') })) : null;

    // Bars
    const byP = X.ryoSpent.byProduct || {}, ordP = X.ryoSpent.ordersByProduct || {};
    const productRows = barRows(Object.keys(byP).sort((a, b) => byP[b] - byP[a]).map(p => ({ label: T[p] || p, value: byP[p], color: PCOLOR[p] || '--sr-5', text: mil(byP[p]), note: fmt(ordP[p]) + ' ' + T.orders,
      tip: [[null, T[p] || p], [null, T.spent, fmt(byP[p])], [null, '%', pct(byP[p], X.ryoSpent.ryo).toFixed(1) + '%'], [null, T.orders, fmt(ordP[p])]] })), tip);
    const potTotal = POTS.reduce((s, [k]) => s + (d.revenueAllocations?.[k] || 0), 0);
    const potRows = barRows(POTS.map(([k, name]) => ({ label: name, value: d.revenueAllocations?.[k] || 0, text: mil(d.revenueAllocations?.[k] || 0) + ' SR', note: pct(d.revenueAllocations?.[k] || 0, potTotal).toFixed(0) + '%' })), tip, { max: potTotal || 1 });
    const rTotal = Object.values(d.rarity?.summon || {}).reduce((a, b) => a + b, 0);
    const rankList = [...RANKS, ...Object.keys(d.rarity?.summon || {}).filter(r => !RANKS.some(([x]) => x === r)).map(r => [r, null])];
    const rarityRows = barRows(rankList.map(([r, odds]) => { const k = d.rarity?.summon?.[r] || 0, share = pct(k, rTotal); return { label: r, value: share, ref: odds, text: share.toFixed(1) + '%', note: fmt(k), tip: [[null, r], [null, T.summoned, fmt(k)], [null, T.actual, share.toFixed(2) + '%'], [null, T.odds, odds == null ? '—' : odds + '%']] }; }), tip, { max: 65 });
    const srcRows = barRows(SOURCES.filter(([k]) => X.freeHeroes.bySource?.[k]).map(([k, name]) => ({ label: name, value: X.freeHeroes.bySource[k], text: fmt(X.freeHeroes.bySource[k]) })), tip, { color: '--sr-2' });
    const adv = d.allTime?.adventure || {};
    const chestRows = barRows([
      { label: T.claimed, value: X.chestClaims.ryo, text: mil(X.chestClaims.ryo), note: fmt(X.chestClaims.n) },
      { label: T.chestSpent, value: X.chestSpends.ryo, text: mil(X.chestSpends.ryo), note: fmt(X.chestSpends.n) },
      { label: T.inChests, value: adv.chestPending || 0, text: mil(adv.chestPending || 0) },
      { label: T.withdrawnSR, value: X.withdrawals.ryo, text: mil(X.withdrawals.ryo), note: fmt(X.withdrawals.n), color: '--sr-2' },
    ], tip);

    // Founder table
    const ft = el('table'), fh = el('thead'), fb = el('tbody'), hr = el('tr');
    for (const c of [T.tier, T.inRange, 'SOL', T.allTime, 'SOL']) hr.append(el('th', { scope: 'col' }, c));
    fh.append(hr);
    for (const tier of ['mythic', 'legacy']) {
      const a = (d.allTime?.founders || []).find(f => f.tier === tier) || { n: 0, sol: 0 }, inSol = (S.founders || []).filter(f => f.tier === tier).reduce((s, f) => s + f.sol, 0);
      const tr = el('tr'); for (const v of [tier[0].toUpperCase() + tier.slice(1), fmt(X.founders.byTier?.[tier] || 0), sol(inSol), fmt(a.n), sol(a.sol)]) tr.append(el('td', {}, v)); fb.append(tr);
    }
    { const tr = el('tr', { class: 'sr-total' }); for (const v of [T.total, fmt(X.founders.n), sol(X.founders.sol), fmt(fAll.n), sol(fAll.sol)]) tr.append(el('td', {}, v)); fb.append(tr); }
    ft.append(fh, fb);

    // Notes and table view
    const kv = o => Object.entries(o || {}).map(([k, v]) => k + ' ' + fmt(v)).join(', ') || '—';
    const notes = el('ul', { class: 'sr-notes' });
    for (const s of [
      fill(T.n1, { chest: mil(X.ryoSpent.byFunding?.chest || 0) + ' Ryo' }),
      fill(T.n2, { p: fmt(d.allTime?.profiles), r: fmt(d.allTime?.playersRegistered), nr: fmt(X.newPlayers) }),
      fill(T.n3, { s: kv(X.withdrawals.byStatus) }),
      fill(T.n4, { s: (d.purchaseStatus || []).map(p => p.status + ' ' + fmt(p.n)).join(', ') || '—' }),
      fill(T.n5, { tz: tzLabel() }),
    ]) notes.append(el('li', {}, s));
    const details = el('details', { class: 'sr-details' }); details.append(el('summary', {}, fill(T.table, { b: bName })));
    const tw = el('div', { class: 'scroll' }), tt = el('table', { class: 'table-wide' }), th = el('thead'), tb = el('tbody'), thr = el('tr');
    for (const c of T.hdr) thr.append(el('th', { scope: 'col' }, c));
    th.append(thr);
    buckets.forEach((t, i) => { const tr = el('tr'); for (const v of [timeLabel(t, bucket), fmt(dep[i]), fmt(spent[i]), ...PRODUCTS.map(p => fmt(perProduct[p][i])), fmt(summoned[i]), fmt(free[i]), fmt(claims[i]), fmt(withdrawn[i])]) tr.append(el('td', {}, v)); tb.append(tr); });
    tt.append(th, tb); tw.append(tt); details.append(tw);

    const salesNote = note(fill(T.noSales, { m: fmt(X.mythicBoxes.n), ms: sol(X.mythicBoxes.sol), s: fmt(X.senseiSol.n), ss: sol(X.senseiSol.sol) }));
    root.append(
      tileGrid,
      card(T.moneyTitle, note(T.moneySub), legend([[T.deposited, '--sr-1'], [T.spent, '--sr-2']]), moneyBox, markerNote),
      card(fill(T.perTitle, { b: bName }), legend(stacks.map(k => [k.name, k.color])), barsBox),
    );
    const cols1 = el('div', { class: 'grid cols sr-cols' }); cols1.append(card(T.byService, productRows), card(T.pots, potRows, note(T.potsNote)));
    root.append(cols1, card(T.heroesTitle, legend([[T.summonedLine, '--sr-1'], [T.freeLine, '--sr-2']]), heroBox));
    const cols2 = el('div', { class: 'grid cols sr-cols' }); cols2.append(card(T.rarity, legend([[T.actual, '--sr-1'], [T.odds, null, true]]), rarityRows, note(fill(T.rarityNote, { n: fmt(rTotal) }))), card(T.freeBy, X.freeHeroes.total ? srcRows : note(T.none)));
    const cols3 = el('div', { class: 'grid cols sr-cols' }); const fw = el('div', { class: 'scroll' }); fw.append(ft);
    cols3.append(card(T.chest, chestRows, note(fill(T.chestNote, { k: fmt(adv.kills), p: fmt(adv.hunters) }))), card(T.founders, fw, salesNote));
    root.append(cols2, cols3, card(T.notes, notes, details));

    const draw = () => {
      lineChart(moneyBox, ctx, tip, [{ name: T.deposited, color: '--sr-1', values: cum(dep) }, { name: T.spent, color: '--sr-2', values: cum(spent) }], v => (v ? mil(v) : '0'), mil);
      stackedBars(barsBox, ctx, tip, stacks);
      lineChart(heroBox, ctx, tip, [{ name: T.summonedLine, color: '--sr-1', values: cum(summoned) }, { name: T.freeLine, color: '--sr-2', values: cum(free) }], v => fmt(Math.round(v)), fmt);
    };
    draw();
    return draw;   // the caller redraws on resize
  }

  window.CCReport = { render, LAUNCH };
})();
