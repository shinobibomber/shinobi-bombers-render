/* Shinobi Command Center (shinobi-command-center-v1) — staff console client.
 * The page shows only what the server returns for this wallet's role; the server authorizes every call.
 * All user and chat content is inserted with textContent, never as HTML. The session token is kept in
 * memory only (never stored), so closing or reloading the page signs out. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const S = { token: '', session: null, view: '', lang: 'en', busy: false, cache: {} };

  /* ---------- i18n (EN / PT-BR) ---------- */
  const I18N = {
    en: {
      'brand.sub': 'COMMAND CENTER', 'lang.label': 'Language', 'auth.connect': 'Connect staff wallet', 'auth.signout': 'Sign out',
      'locked.eyebrow': 'RESTRICTED STAFF CONSOLE', 'locked.title': 'Shinobi Command Center',
      'locked.body': 'Sign in with an authorized Phantom wallet. Every view and action is authorized again on the server; this page only shows what your role allows.',
      'locked.p1': 'Wallet-signed session', 'locked.p2': 'Server-enforced roles', 'locked.p3': 'Hash-chained audit', 'locked.p4': 'No money movement',
      'nav.ops': 'OPERATIONS', 'nav.planned': 'PLANNED', 'nav.overview': 'Overview', 'nav.players': 'Player lookup', 'nav.chat': 'Chat moderation',
      'nav.announcements': 'Announcements', 'nav.health': 'Server health', 'nav.audit': 'Audit logs', 'nav.roles': 'Staff roles', 'nav.founders': 'Founder NFTs', 'nav.observatory': 'Ryo Observatory ↗',
      'state.loading': 'Loading…', 'state.readonly': 'Read only', 'state.denied': 'Your role does not include this area.', 'state.deniedTitle': 'Permission required',
      'state.unavailable': 'Unavailable', 'state.notImplemented': 'Not implemented', 'state.planned': 'Planned', 'state.empty': 'Nothing to show.',
      'action.cancel': 'Cancel', 'action.refresh': 'Refresh', 'action.confirm': 'Confirm', 'action.loadMore': 'Load more',
      'field.reason': 'Reason (8–500 characters, recorded in the audit log)', 'field.category': 'Reason category', 'field.duration': 'Mute duration',
      'overview.title': 'Operations overview', 'overview.sub': 'Only recorded values. Anything the game does not record is marked unavailable.',
      'players.title': 'Player lookup', 'players.sub': 'Read-only. Balances, rewards, heroes and NFTs cannot be changed here.',
      'chat.title': 'Chat moderation', 'chat.sub': 'Global chat and System notices. Decisions are enforced by the chat server.',
      'ann.title': 'Official announcements', 'ann.sub': 'Posted as System only after a different authorized wallet approves.',
      'health.title': 'Server health', 'health.sub': 'Sanitized checks with their source. A failing check is never shown as healthy.',
      'audit.title': 'Audit logs', 'audit.sub': 'Append-only, hash-chained records shared with the economic dashboard.',
      'roles.title': 'Staff roles', 'roles.sub': 'The Owner grants Moderator and Support. Financial roles are set in the hosting environment.',
    },
    pt: {
      'brand.sub': 'CENTRO DE COMANDO', 'lang.label': 'Idioma', 'auth.connect': 'Conectar carteira da equipe', 'auth.signout': 'Sair',
      'locked.eyebrow': 'CONSOLE RESTRITO DA EQUIPE', 'locked.title': 'Centro de Comando Shinobi',
      'locked.body': 'Entre com uma carteira Phantom autorizada. Cada tela e ação é autorizada novamente no servidor; esta página mostra apenas o que sua função permite.',
      'locked.p1': 'Sessão assinada pela carteira', 'locked.p2': 'Funções aplicadas no servidor', 'locked.p3': 'Auditoria encadeada por hash', 'locked.p4': 'Sem movimentação de fundos',
      'nav.ops': 'OPERAÇÕES', 'nav.planned': 'PLANEJADO', 'nav.overview': 'Visão geral', 'nav.players': 'Busca de jogadores', 'nav.chat': 'Moderação do chat',
      'nav.announcements': 'Anúncios', 'nav.health': 'Saúde do servidor', 'nav.audit': 'Registros de auditoria', 'nav.roles': 'Funções da equipe', 'nav.founders': 'NFTs de Fundador', 'nav.observatory': 'Observatório Ryo ↗',
      'state.loading': 'Carregando…', 'state.readonly': 'Somente leitura', 'state.denied': 'Sua função não inclui esta área.', 'state.deniedTitle': 'Permissão necessária',
      'state.unavailable': 'Indisponível', 'state.notImplemented': 'Não implementado', 'state.planned': 'Planejado', 'state.empty': 'Nada para mostrar.',
      'action.cancel': 'Cancelar', 'action.refresh': 'Atualizar', 'action.confirm': 'Confirmar', 'action.loadMore': 'Carregar mais',
      'field.reason': 'Motivo (8–500 caracteres, registrado na auditoria)', 'field.category': 'Categoria do motivo', 'field.duration': 'Duração do silenciamento',
      'overview.title': 'Visão geral das operações', 'overview.sub': 'Somente valores registrados. O que o jogo não registra aparece como indisponível.',
      'players.title': 'Busca de jogadores', 'players.sub': 'Somente leitura. Saldos, recompensas, heróis e NFTs não podem ser alterados aqui.',
      'chat.title': 'Moderação do chat', 'chat.sub': 'Chat Global e avisos do Sistema. As decisões são aplicadas pelo servidor do chat.',
      'ann.title': 'Anúncios oficiais', 'ann.sub': 'Publicados como Sistema somente após aprovação de outra carteira autorizada.',
      'health.title': 'Saúde do servidor', 'health.sub': 'Verificações sanitizadas com sua origem. Uma falha nunca aparece como saudável.',
      'audit.title': 'Registros de auditoria', 'audit.sub': 'Registros somente de acréscimo, encadeados por hash e compartilhados com o painel econômico.',
      'roles.title': 'Funções da equipe', 'roles.sub': 'O Proprietário concede Moderador e Suporte. Funções financeiras são definidas no ambiente de hospedagem.',
    },
  };
  const t = key => I18N[S.lang][key] || I18N.en[key] || key;
  function applyI18n() { document.documentElement.lang = S.lang === 'pt' ? 'pt-BR' : 'en'; document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); }); }

  /* ---------- DOM helpers ---------- */
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return e;
  }
  // replaceChildren() would print null/false as text; drop them like h() does.
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
  const short = w => (w && w.length > 12 ? w.slice(0, 4) + '…' + w.slice(-4) : w || '—');
  const n = x => (x === null || x === undefined ? '—' : Number(x).toLocaleString());
  function when(ms) {
    if (!ms) return h('span', { class: 'muted', text: '—' });
    const d = new Date(Number(ms)), utc = d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    return h('time', { datetime: d.toISOString(), title: 'Local: ' + d.toLocaleString() }, utc);
  }
  const badge = (text, kind = '') => h('span', { class: 'badge ' + kind, text });
  const STATUS_KIND = { ready: 'ok', ok: 'ok', open: 'warn', pending: 'warn', degraded: 'warn', stale: 'warn', unavailable: 'crit', mismatch: 'crit', not_implemented: 'violet', published: 'ok', rejected: 'crit', unpublished: 'warn', actioned: 'ok', dismissed: 'info' };
  const statusBadge = s => badge(s === 'not_implemented' ? t('state.notImplemented') : s === 'unavailable' ? t('state.unavailable') : s, STATUS_KIND[s] || 'info');
  const stateBox = (title, body) => h('div', { class: 'state', role: 'status' }, h('h3', { text: title }), body ? h('p', { text: body }) : null);
  const card = (...kids) => h('section', { class: 'card' }, ...kids);
  const scroll = (cls, head, rows) => h('div', { class: 'scroll' }, h('table', { class: cls }, h('thead', {}, h('tr', {}, head.map(x => h('th', { scope: 'col', text: x })))), h('tbody', {}, rows)));
  const empty = (cols, text = t('state.empty')) => h('tr', {}, h('td', { colspan: cols, class: 'muted', text }));
  function notice(text, kind = '') { const e = $('notice'); e.textContent = text; e.className = 'notice ' + kind; e.hidden = !text; e.setAttribute('role', kind === 'error' ? 'alert' : 'status'); }
  const can = p => !!S.session && S.session.permissions.includes(p);
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''));

  /* ---------- API ---------- */
  async function api(action, body = {}) {
    const r = await fetch('/api/ryo', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: JSON.stringify({ action, ...body }) });
    let d = {}; try { d = await r.json(); } catch {}
    if (!r.ok) { if (r.status === 401) signOut(d.error || 'Session expired. Sign in again.'); throw Object.assign(Error(d.error || 'Request failed (' + r.status + ').'), { status: r.status }); }
    return d;
  }
  // Every write carries a fresh request ID and the scope this page was loaded for.
  const write = (action, body) => api(action, { requestId: rid(), scope: S.session.scope, ...body });

  /* ---------- Guarded action dialog (reason + explicit confirmation) ---------- */
  function guarded({ title, detail, fields = [], confirm, danger = false, submit }) {
    const dlg = $('dialog'), body = $('dialog-body'), ok = $('dialog-ok'), err = $('dialog-error');
    $('dialog-title').textContent = title; err.hidden = true; ok.textContent = confirm || t('action.confirm'); ok.className = danger ? 'danger' : 'primary';
    const inputs = {};
    fill(body, ...(detail ? [h('p', { class: 'muted', text: detail })] : []), ...fields.map(f => {
      const input = f.options ? h('select', { name: f.name, required: true }, f.options.map(([v, l]) => h('option', { value: v, text: l }))) : h(f.multiline ? 'textarea' : 'input', { name: f.name, required: f.optional ? null : true, maxlength: f.max || 500, minlength: f.min || null, placeholder: f.placeholder || null });
      inputs[f.name] = input; return h('label', {}, f.label, input);
    }), h('label', {}, t('field.reason'), inputs.reason = h('textarea', { name: 'reason', required: true, minlength: 8, maxlength: 500 })));
    return new Promise(resolve => {
      const done = async e => {
        if (e.submitter?.value !== 'ok') { cleanup(); dlg.close(); return resolve(null); }
        e.preventDefault();
        const values = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value.trim()]));
        if ([...values.reason].length < 8) { err.textContent = 'Give a reason of at least 8 characters.'; err.hidden = false; return; }
        ok.disabled = true;
        try { const result = await submit(values); cleanup(); dlg.close(); resolve(result); }
        catch (x) { err.textContent = x.message; err.hidden = false; }
        finally { ok.disabled = false; }
      };
      const cancel = () => { cleanup(); resolve(null); };
      const cleanup = () => { $('dialog-form').removeEventListener('submit', done); dlg.removeEventListener('cancel', cancel); };
      $('dialog-form').addEventListener('submit', done); dlg.addEventListener('cancel', cancel);
      dlg.showModal(); (fields.length ? inputs[fields[0].name] : inputs.reason).focus();
    });
  }

  /* ---------- Shell ---------- */
  const VIEWS = [
    ['overview', 'nav.overview', 'overview.read'], ['players', 'nav.players', 'player.read'], ['chat', 'nav.chat', 'moderation.read'],
    ['announcements', 'nav.announcements', ['announcement.read', 'announcement.propose', 'announcement.review']], ['health', 'nav.health', 'ops.read'],
    ['audit', 'nav.audit', ['audit.read', 'audit.own']], ['roles', 'nav.roles', 'roles.manage'], ['founders', 'nav.founders', 'founders.read'],
  ];
  // Modules from the specification that have no backend yet. They are listed, never simulated.
  const PLANNED = [
['pass', 'Weekly Mission Pass', 2], ['early', 'Early access', 2], ['economy', 'Economy & treasury', 3],
    ['creators', 'Creators & marketing', 3], ['events', 'Events', 4], ['config', 'Game configuration', 4], ['support', 'Support center', 4], ['security', 'Security center', 4],
    ['guild', 'Guild / Team / DM / Trade chat', null],
  ];
  const allowed = perm => (Array.isArray(perm) ? perm : [perm]).some(can);
  function renderNav() {
    const nav = $('sidebar');
    fill(nav, h('button', { type: 'button', class: 'icon-btn drawer-close', 'aria-label': 'Close menu', text: '✕', onclick: () => drawer(false, true) }), h('h4', { text: t('nav.ops') }), ...VIEWS.filter(([, , p]) => allowed(p) || p !== 'roles.manage').map(([id, key, p]) => h('a', { href: '#' + id, 'aria-current': S.view === id ? 'page' : null }, h('span', { text: t(key) }), allowed(p) ? null : h('small', { text: '🔒' }))),
      can('player.economy') || can('player.transactions') ? h('a', { href: '/admin/', target: '_blank', rel: 'noopener' }, h('span', { text: t('nav.observatory') })) : null,
      h('h4', { text: t('nav.planned') }), ...PLANNED.map(([id, label, phase]) => h('a', { href: '#planned-' + id, class: 'planned', 'aria-current': S.view === 'planned-' + id ? 'page' : null }, h('span', { text: label }), h('small', { text: phase ? 'Phase ' + phase : t('state.planned') }))));
  }
  // Phone navigation drawer: above the header, with a scrim; Escape, ✕, the scrim or a link closes it.
  const scrim = h('div', { class: 'scrim', hidden: true, onclick: () => drawer(false, true) }); document.body.append(scrim);
  function drawer(open, refocus = false) {
    $('sidebar').classList.toggle('open', open); scrim.hidden = !open; $('menu').setAttribute('aria-expanded', String(open));
    if (open) $('sidebar').querySelector('a,button')?.focus(); else if (refocus) $('menu').focus();
  }
  function showShell(on) {
    $('locked').hidden = on; $('view').hidden = !on; $('sidebar').hidden = !on; $('who').hidden = !on; $('menu').hidden = !on;
    $('connect').hidden = on; $('signout').hidden = !on; $('network').hidden = !on; $('health-dot').hidden = !on;
  }
  function renderWho() {
    const s = S.session, net = s.network, banner = $('network');
    banner.textContent = net.key === 'mainnet' ? 'MAINNET LIVE · ' + s.scope : String(net.label).toUpperCase() + ' TEST · ' + s.scope;
    banner.classList.toggle('mainnet', net.key === 'mainnet');
    $('who-wallet').textContent = short(s.wallet); $('who-wallet').title = s.wallet;
    $('who-role').textContent = s.roles.map(r => ({ owner: 'Owner', approver: 'Financial Approver', operator: 'Game Operator', moderator: 'Moderator', support: 'Support', viewer: 'Viewer' })[r]).join(' + ');
    $('who-readonly').hidden = s.permissions.some(p => /write|propose|review|resolve|manage/.test(p));
    $('who-expiry').textContent = s.sessionExpires ? 'Session until ' + new Date(s.sessionExpires).toISOString().slice(11, 16) + ' UTC' : '';
  }
  function signOut(message) {
    S.token = ''; S.session = null; S.cache = {}; drawer(false); showShell(false); $('view').replaceChildren();
    notice(message || 'Signed out. Connect an authorized wallet to continue.');
  }
  async function connect() {
    const wallet = window.phantom?.solana || window.solana;
    if (!wallet?.isPhantom) throw Error('Install or enable Phantom in this browser to sign in.');
    const address = (await wallet.connect()).publicKey.toString();
    const challenge = await api('challenge', { wallet: address });
    if (!challenge.message.includes('Wallet: ' + address) || !challenge.message.includes('Origin: ' + location.origin)) throw Error('Login challenge does not match this wallet and origin.');
    const signed = await wallet.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
    const session = await api('login', { wallet: address, nonce: challenge.nonce, signature: btoa(String.fromCharCode(...signed.signature)) });
    S.token = session.token;
    try { const r = await api('cc-session'); S.session = { ...r.data, scope: r.scope }; }
    catch (e) { S.token = ''; throw e; }
    wallet.on?.('accountChanged', () => signOut('Wallet changed. Sign in again.')); wallet.on?.('disconnect', () => signOut());
    notice(''); showShell(true); renderWho(); go(location.hash.slice(1) || 'overview'); pulse();
  }
  async function pulse() {
    if (!S.session || !can('ops.read')) return;
    try { const hl = (await api('cc-health')).data, bad = [hl.database?.status, hl.rpc?.status].filter(s => s !== 'ok'); const dot = $('health-dot'); dot.className = 'dot ' + (bad.length ? (bad.includes('unavailable') || bad.includes('mismatch') ? 'crit' : 'warn') : 'ok'); dot.title = 'Database ' + hl.database?.status + ' · RPC ' + hl.rpc?.status; } catch {}
  }

  /* ---------- Router ---------- */
  function head(titleKey, subKey, ...actions) { return h('div', { class: 'view-head' }, h('div', {}, h('h1', { text: t(titleKey) }), h('p', { text: t(subKey) })), h('div', { class: 'row-actions' }, ...actions)); }
  const refreshBtn = fn => h('button', { type: 'button', onclick: () => run(fn), text: t('action.refresh') });
  // Errors surface in the notice bar. Writes are protected against double submission by the dialog.
  async function run(fn) { try { await fn(); } catch (e) { notice(e.message, 'error'); } }
  function go(id) {
    if (!S.session) return;
    if (!VIEWS.some(v => v[0] === id) && !id.startsWith('planned-')) id = 'overview';
    S.view = id; renderNav(); drawer(false);
    const view = $('view');
    if (id.startsWith('planned-')) return fill(view, planned(id.slice(8)));
    const [, , perm] = VIEWS.find(v => v[0] === id);
    if (!allowed(perm)) return fill(view, stateBox(t('state.deniedTitle'), t('state.denied')));
    fill(view, stateBox(t('state.loading')));
    run(async () => {
      try { await RENDER[id](view); }
      catch (e) { if (S.view === id && S.session) fill(view, stateBox(e.status === 403 ? t('state.deniedTitle') : t('state.unavailable'), e.message)); throw e; }
    });
  }
  function planned(id) {
    const [, label, phase] = PLANNED.find(p => p[0] === id) || [null, id, null];
    return h('div', {}, h('div', { class: 'view-head' }, h('div', {}, h('h1', { text: label }), h('p', {}, badge(t('state.notImplemented'), 'violet')))),
      stateBox(t('state.notImplemented'), (phase ? 'Planned for Phase ' + phase + ' after owner review. ' : 'A separate project; it needs its own backend and privacy rules. ') + 'There is no working backend for this module, so nothing here can be viewed or changed yet.'));
  }

  /* ---------- Overview ---------- */
  const METRIC_LABEL = { players: 'Game profiles', activeSessions: 'Active sessions (90 s)', newSignups24h: 'New sign-ups (24 h)', dailyActive: 'Daily / weekly active', openReports: 'Open chat reports', activeMutes: 'Active mutes', activeBans: 'Chat bans', pendingAnnouncements: 'Announcements awaiting review', pendingProposals: 'Economic proposals awaiting review', pendingPurchases: 'Pending purchases', pendingWithdrawals: 'Pending withdrawals', stalePending: 'Pending > 30 min', revenue: 'Revenue (Ryo / SOL)', nftSales: 'Founder NFT sales' };
  const RENDER = {
    async overview(view) {
      const o = await api('cc-overview'), d = o.data;
      const kpis = d.metrics.map(m => h('article', { class: 'card kpi state-' + m.status }, h('div', { class: 'eyebrow', text: METRIC_LABEL[m.key] || m.key }), h('strong', { text: m.status === 'ready' ? n(m.value) : m.status === 'not_implemented' ? t('state.notImplemented') : t('state.unavailable') }), h('div', { class: 'src' }, m.status !== 'ready' ? statusBadge(m.status) : null, ' ', m.source)));
      const metricValue = k => d.metrics.find(m => m.key === k)?.value || 0, queue = [];
      if (metricValue('openReports') && can('moderation.read')) queue.push(h('li', {}, h('a', { href: '#chat', text: n(metricValue('openReports')) + ' open chat report(s)' })));
      if (metricValue('pendingAnnouncements')) queue.push(h('li', {}, h('a', { href: '#announcements', text: n(metricValue('pendingAnnouncements')) + ' announcement(s) awaiting a second reviewer' })));
      if (metricValue('stalePending')) queue.push(h('li', { text: n(metricValue('stalePending')) + ' purchase/withdrawal reservation(s) pending over 30 minutes — review in the Ryo Observatory.' }));
      fill(view, head('overview.title', 'overview.sub', refreshBtn(() => RENDER.overview(view))),
        d.pauses.length ? h('div', { class: 'notice error', role: 'alert', text: 'Emergency pause active: ' + d.pauses.join(', ') + '. Resuming needs two-wallet approval in the Ryo Observatory.' }) : null,
        h('div', { class: 'grid kpis' }, kpis),
        h('div', { class: 'grid cols', style: null }, card(h('h3', { text: 'Pending actions' }), queue.length ? h('ul', {}, queue) : h('p', { class: 'muted', text: 'No pending staff actions.' })),
          card(h('h3', { text: 'Observed' }), h('dl', { class: 'kv' }, h('dt', { text: 'Server time' }), h('dd', {}, when(o.observedAt)), h('dt', { text: 'Scope' }), h('dd', { class: 'mono', text: o.scope })))));
    },

    /* ---------- Players ---------- */
    async players(view) {
      const result = h('div', { class: 'grid' }), input = h('input', { type: 'search', name: 'q', placeholder: 'Wallet address or chat name', 'aria-label': 'Wallet address or chat name', maxlength: 64, required: true });
      const form = h('form', { class: 'inline card', onsubmit: e => { e.preventDefault(); run(() => lookup(input.value, result)); } }, h('label', {}, 'Search', input), h('button', { class: 'primary', type: 'submit', text: 'Look up' }));
      fill(view, head('players.title', 'players.sub'), form, h('p', { class: 'muted', text: 'Referral code and NFT serial search are not implemented yet.' }), result);
    },

    /* ---------- Chat moderation ---------- */
    async chat(view) {
      const tabs = [['reports', 'Report queue'], ['feed', 'Global feed'], ['system', 'System feed'], ['sanctions', 'Active sanctions'], ['channels', 'Other channels']];
      S.chatTab = S.chatTab || 'reports';
      const panel = h('div', {}), bar = h('div', { class: 'tabs', role: 'tablist' });
      const draw = () => { bar.replaceChildren(...tabs.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(S.chatTab === id), onclick: () => { S.chatTab = id; draw(); } , text: label }))); fill(panel, stateBox(t('state.loading'))); run(() => CHAT[S.chatTab](panel)); };
      fill(view, head('chat.title', 'chat.sub', refreshBtn(async () => draw())), bar, panel); draw();
    },

    /* ---------- Announcements ---------- */
    async announcements(view) {
      const d = (await api('cc-announcements')).data, me = S.session.wallet, parts = [head('ann.title', 'ann.sub', refreshBtn(() => RENDER.announcements(view)))];
      if (can('announcement.propose')) {
        const en = h('textarea', { name: 'en', maxlength: 200, required: true, placeholder: 'Plain text, up to 200 characters, no links' }), pt = h('textarea', { name: 'pt', maxlength: 200, placeholder: 'Opcional: texto em português' });
        parts.push(card(h('h3', { text: 'Propose an announcement' }), h('form', { class: 'form', onsubmit: e => { e.preventDefault(); run(async () => {
          const r = await guarded({ title: 'Submit for review', detail: 'A different authorized wallet must approve before it is posted to the System channel.', confirm: 'Submit for review', submit: v => write('cc-announce-propose', { textEn: en.value, textPt: pt.value || null, reason: v.reason }) });
          if (r) { notice('Announcement submitted for review.', 'ok'); await RENDER.announcements(view); }
        }); } }, h('label', {}, 'English (EN)', en), h('label', {}, 'Português (PT-BR)', pt), h('button', { class: 'primary', type: 'submit', text: 'Review and submit' }))));
      }
      const rows = d.announcements.map(a => h('tr', {},
        h('td', {}, '#' + a.id, h('br'), statusBadge(a.status)),
        h('td', {}, h('div', { class: 'msg', text: a.textEn }), a.textPt ? h('div', { class: 'msg muted', text: a.textPt }) : null, h('small', { class: 'muted', text: 'Reason: ' + a.reason })),
        h('td', {}, h('span', { class: 'mono', text: short(a.proposer), title: a.proposer }), h('br'), when(a.created), a.expires ? h('div', { class: 'muted' }, 'Expires ', when(a.expires)) : null),
        h('td', {}, a.reviewer ? [h('span', { class: 'mono', text: short(a.reviewer), title: a.reviewer }), h('br'), when(a.reviewed)] : '—'),
        h('td', {}, h('div', { class: 'row-actions' },
          a.status === 'pending' && can('announcement.review') ? [
            h('button', { class: 'small primary', type: 'button', disabled: a.proposer === me, title: a.proposer === me ? 'You proposed this; another wallet must review it.' : null, text: 'Approve', onclick: () => review(a, true, view) }),
            h('button', { class: 'small danger', type: 'button', disabled: a.proposer === me, text: 'Reject', onclick: () => review(a, false, view) })] : null,
          a.status === 'published' && can('announcement.review') ? h('button', { class: 'small danger', type: 'button', text: 'Unpublish', onclick: () => run(async () => {
            if (await guarded({ title: 'Unpublish announcement #' + a.id, detail: 'Hides the System messages from players. The record stays in the audit log.', confirm: 'Unpublish', danger: true, submit: v => write('cc-announce-unpublish', { id: a.id, expectedVersion: a.version, reason: v.reason }) })) { notice('Announcement unpublished.', 'ok'); await RENDER.announcements(view); }
          }) }) : null))));
      parts.push(card(h('h3', { text: 'Announcements' }), scroll('table-wide', ['ID / status', 'Text', 'Proposed', 'Reviewed', 'Actions'], rows.length ? rows : empty(5))));
      fill(view, ...parts);
    },

    /* ---------- Health ---------- */
    async health(view) {
      const o = await api('cc-health'), d = o.data;
      const block = (title, status, rows) => card(h('div', { class: 'view-head' }, h('h3', { text: title }), status ? statusBadge(status) : null), h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', {}, v === null || v === undefined ? badge(t('state.unavailable'), 'crit') : v)])));
      fill(view, head('health.title', 'health.sub', refreshBtn(() => RENDER.health(view))), h('div', { class: 'grid cols' },
        block('API', d.api.status, [['Server time', when(d.api.serverTime)], ['Observed', when(o.observedAt)]]),
        block('Database', d.database.status, [['Latency', d.database.latencyMs !== undefined ? d.database.latencyMs + ' ms' : null], ['Command Center schema', d.database.schema ? String(d.database.schema.commandCenter) : null], ['Audit chain table', d.database.schema ? String(d.database.schema.auditChain) : null], ['Note', d.database.note || '—']]),
        block('Solana RPC', d.rpc.status, [['Latency', d.rpc.latencyMs !== undefined ? d.rpc.latencyMs + ' ms' : '—'], ['Check', d.rpc.note]]),
        block('Build & release', null, [['Network', d.build.network.label], ['Commit', d.build.commit], ['Archive', d.build.archiveSha256], ['Pre-launch mode', d.release.prelaunch === null ? null : String(d.release.prelaunch)], ['Release stage', d.release.stage || '—']]),
        block('Launch gates (read-only)', null, d.launchGates ? Object.entries(d.launchGates).map(([k, v]) => [k, badge(v ? 'on' : 'off', v ? 'ok' : 'info')]) : [['Status', null]]),
        block('Settlement queue', null, [['Oldest pending reservation', d.queue ? (d.queue.oldestPendingMinutes === null ? 'None pending' : d.queue.oldestPendingMinutes + ' min') : null]])),
        h('p', { class: 'muted' }, d.notes.join(' ')));
      pulse();
    },

    /* ---------- Audit ---------- */
    async audit(view) {
      const filter = h('select', { 'aria-label': 'Action filter' }, [['', 'All actions'], ['cc.chat', 'Chat moderation'], ['cc.report', 'Reports'], ['cc.announcement', 'Announcements'], ['cc.role', 'Staff roles'], ['configuration', 'Economic configuration'], ['emergency', 'Emergency controls']].map(([v, l]) => h('option', { value: v, text: l })));
      const actor = h('input', { placeholder: 'Actor wallet (optional)', 'aria-label': 'Actor wallet' }), body = h('tbody'), more = h('button', { type: 'button', hidden: true, text: t('action.loadMore') });
      let cursor = null;
      const load = async reset => {
        if (reset) { cursor = null; fill(body, ); }
        const o = await api('cc-audit', { prefix: filter.value || undefined, actor: actor.value.trim() || undefined, cursor: cursor || undefined, limit: 50 });
        if (o.data.scopeLimited) notice(o.data.scopeLimited);
        for (const e of o.data.entries) body.append(h('tr', {},
          h('td', {}, '#' + e.sequence, h('br'), when(e.created)), h('td', {}, h('b', { text: e.action }), e.data?.role ? h('div', { class: 'muted', text: e.data.role }) : null),
          h('td', {}, h('span', { class: 'mono', text: short(e.actor), title: e.actor })),
          h('td', {}, e.hashValid ? badge('hash ✓', 'ok') : badge('hash ✗', 'crit'), ' ', e.linked === true ? badge('linked ✓', 'ok') : e.linked === false ? badge('link ✗', 'crit') : badge('page edge', 'info')),
          h('td', {}, h('details', {}, h('summary', { text: 'Record' }), h('pre', { text: JSON.stringify(e.data, null, 2) }), h('small', { class: 'mono muted', text: 'hash ' + e.hash + ' · previous ' + e.previous })))));
        if (!body.children.length) body.append(empty(5));
        cursor = o.nextCursor; more.hidden = !cursor;
      };
      more.onclick = () => run(() => load(false));
      fill(view, head('audit.title', 'audit.sub'), h('form', { class: 'inline card', onsubmit: e => { e.preventDefault(); run(() => load(true)); } }, h('label', {}, 'Action', filter), h('label', {}, 'Actor', actor), h('button', { type: 'submit', text: 'Filter' })),
        card(h('div', { class: 'scroll' }, h('table', { class: 'table-wide' }, h('thead', {}, h('tr', {}, ['Sequence / time', 'Action', 'Actor', 'Verification', 'Details'].map(x => h('th', { scope: 'col', text: x })))), body)), more),
        h('p', { class: 'muted', text: 'Hash and link checks cover the records on screen. Database owners can still alter rows; keep independent exports.' }));
      await load(true);
    },

    /* ---------- Staff roles (Owner) ---------- */
    /* ---------- Founder NFTs (founders.cjs) ---------- */
    async founders(view) {
      const d = (await api('cc-founders')).data, sol = v => (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 }) + ' SOL';
      const mono = v => h('span', { class: 'mono', text: v }), manage = can('founders.manage');
      const supply = k => card(h('div', { class: 'eyebrow', text: k === 'mythic' ? 'Mythic (1 SOL)' : 'Legacy (0.5 SOL)' }), h('strong', { text: d.tiers[k].sold + ' sold · ' + d.tiers[k].reserved + ' reserved · ' + d.tiers[k].remaining + ' left of 30' }));
      const rows = (list, cols, map) => scroll('table-wide', cols, list.length ? list.map(r => h('tr', {}, map(r).map(v => h('td', {}, v == null ? '—' : v)))) : empty(cols.length));
      const pauseBtn = manage ? h('button', { class: 'small' + (d.paused ? '' : ' danger'), type: 'button', text: d.paused ? 'Resume sales' : 'Pause sales', onclick: () => run(async () => {
        if (await guarded({ title: d.paused ? 'Resume Founder sales' : 'Pause Founder sales', detail: 'Reservations already sent can still settle.', confirm: d.paused ? 'Resume' : 'Pause', danger: !d.paused, submit: v => write('cc-founders-pause', { paused: !d.paused, reason: v.reason }) })) RENDER.founders(view);
      }) }) : null;
      const revokeBtn = e => manage ? h('button', { class: 'small' + (e.revoked ? '' : ' danger'), type: 'button', text: e.revoked ? 'Restore' : 'Suspend', onclick: () => run(async () => {
        if (await guarded({ title: (e.revoked ? 'Restore' : 'Suspend') + ' Founder benefits', detail: e.wallet, confirm: e.revoked ? 'Restore' : 'Suspend', danger: !e.revoked, submit: v => write('cc-founders-revoke', { wallet: e.wallet, revoke: !e.revoked, reason: v.reason }) })) RENDER.founders(view);
      }) }) : null;
      fill(view, h('div', { class: 'view-head' }, h('div', {}, h('h1', { text: 'Founder NFTs' }), h('p', { class: 'muted', text: 'Founder box supply, purchases, entitlements, summons and SOL Sensei. Benefits are bound to the original buyer.' })), refreshBtn(() => RENDER.founders(view))),
        h('div', { class: 'grid kpis' }, supply('mythic'), supply('legacy'),
          card(h('div', { class: 'eyebrow', text: 'Sale' }), h('strong', { text: d.mode + (d.paused ? ' · PAUSED' : '') }), pauseBtn),
          card(h('div', { class: 'eyebrow', text: 'Switches' }), h('strong', { text: 'Redemption ' + (d.redemption ? 'on' : 'off') + ' · SOL Sensei ' + (d.senseiSol ? 'on' : 'off') }))),
        card(h('h3', { text: 'Purchases (' + d.failures + ' expired)' }), rows(d.purchases, ['When', 'Wallet', 'Tier', 'Serial', 'Price', 'Status', 'Mint'], r => [when(r.created), mono(r.wallet), r.tier, String(r.serial), sol(r.price), r.status, mono(r.mint)])),
        card(h('h3', { text: 'Entitlements' }), rows(d.entitlements, ['Wallet', 'Tier', 'Activated', 'Passes left', 'Trial ends', 'Status', ''], e => [mono(e.wallet), e.tier, e.activated ? when(e.activated) : 'not yet', String(e.limited_passes), e.trial_ends ? when(e.trial_ends) : null, e.revoked ? 'suspended: ' + e.revoked_reason : 'valid', revokeBtn(e)])),
        card(h('h3', { text: 'Founder summons' }), rows(d.summons, ['When', 'Wallet', 'Kind', 'Period', 'Rank'], r => [when(r.created), mono(r.wallet), r.kind, r.period == null ? null : String(r.period), ['Genin', 'Chunin', 'Jonin', 'Elite', 'Legend', 'Mythic'][r.rank]])),
        card(h('h3', { text: 'SOL Sensei' }), rows(d.sensei, ['When', 'Wallet', 'Price', 'Founder price', 'Status'], r => [when(r.created), mono(r.wallet), sol(r.price), r.founder_discount ? 'yes' : 'no', r.status])),
        card(h('h3', { text: 'Wallets with 3+ expired reservations' }), rows(d.repeatedExpiries, ['Wallet', 'Expired'], r => [mono(r.wallet), String(r.n)])),
        card(h('h3', { text: 'Founder audit' }), rows(d.audit, ['When', 'Actor', 'Action', 'Target'], r => [when(r.created), mono(r.actor), r.action, r.target])));
    },

    async roles(view) {
      const d = (await api('cc-roles')).data;
      const envRows = Object.entries(d.environment).flatMap(([role, list]) => list.map(w => h('tr', {}, h('td', { text: role }), h('td', { class: 'mono', text: w }), h('td', { class: 'muted', text: 'Hosting environment' }))));
      const grantRows = d.grants.map(g => h('tr', {}, h('td', { text: g.role }), h('td', { class: 'mono', text: g.wallet }), h('td', {}, g.revoked ? [badge('revoked', 'info'), ' ', when(g.revoked)] : [badge('active', 'ok'), ' ', when(g.created)], h('div', { class: 'muted', text: g.reason })),
        h('td', {}, !g.revoked ? h('button', { class: 'small danger', type: 'button', text: 'Revoke', onclick: () => run(async () => {
          if (await guarded({ title: 'Revoke ' + g.role, detail: g.wallet, confirm: 'Revoke role', danger: true, submit: v => write('cc-role-revoke', { wallet: g.wallet, role: g.role, expectedVersion: d.rolesVersion, reason: v.reason }) })) { notice('Role revoked. It applies on the next request.', 'ok'); await RENDER.roles(view); }
        }) }) : null)));
      const wallet = h('input', { name: 'wallet', required: true, placeholder: 'Public wallet address' }), role = h('select', { name: 'role' }, h('option', { value: 'moderator', text: 'Moderator' }), h('option', { value: 'support', text: 'Support' }));
      fill(view, head('roles.title', 'roles.sub', refreshBtn(() => RENDER.roles(view))),
        card(h('h3', { text: 'Grant a staff role' }), h('form', { class: 'inline', onsubmit: e => { e.preventDefault(); run(async () => {
          if (await guarded({ title: 'Grant ' + role.value, detail: wallet.value.trim(), confirm: 'Grant role', submit: v => write('cc-role-grant', { wallet: wallet.value.trim(), role: role.value, expectedVersion: d.rolesVersion, reason: v.reason }) })) { notice('Role granted. It applies on the next request.', 'ok'); await RENDER.roles(view); }
        }); } }, h('label', {}, 'Wallet', wallet), h('label', {}, 'Role', role), h('button', { class: 'primary', type: 'submit', text: 'Review grant' }))),
        card(h('h3', { text: 'Backend grants' }), scroll('table-wide', ['Role', 'Wallet', 'Status', ''], grantRows.length ? grantRows : empty(4))),
        card(h('h3', { text: 'Environment roles' }), h('p', { class: 'muted', text: d.note }), scroll('table-wide', ['Role', 'Wallet', 'Source'], envRows.length ? envRows : empty(3))));
    },
  };

  async function review(a, approve, view) {
    await run(async () => {
      if (await guarded({ title: (approve ? 'Approve' : 'Reject') + ' announcement #' + a.id, detail: approve ? 'It will be posted to the System channel for every player immediately.' : 'It will not be posted.', confirm: approve ? 'Approve and publish' : 'Reject', danger: !approve, submit: v => write('cc-announce-review', { id: a.id, approve, expectedVersion: a.version, reason: v.reason }) })) { notice(approve ? 'Announcement published.' : 'Announcement rejected.', 'ok'); await RENDER.announcements(view); }
    });
  }

  /* ---------- Player lookup result ---------- */
  async function lookup(query, out) {
    fill(out, stateBox(t('state.loading')));
    const d = (await api('cc-player-lookup', { query: query.trim() })).data;
    if (d.kind === 'matches') {
      const rows = d.matches.map(m => h('tr', {}, h('td', { text: m.name }), h('td', { class: 'mono', text: m.wallet }), h('td', {}, when(m.lastMessage)), h('td', {}, m.wallet.length > 30 ? h('button', { class: 'small', type: 'button', text: 'Open', onclick: () => run(() => lookup(m.wallet, out)) }) : null)));
      return fill(out, card(h('h3', { text: 'Matching chat names' }), h('p', { class: 'muted', text: d.source }), scroll('', ['Name', 'Wallet', 'Last message', ''], rows.length ? rows : empty(4))));
    }
    const kv = pairs => h('dl', { class: 'kv' }, pairs.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', {}, v)]));
    const c = d.chat, parts = [card(h('h3', { text: 'Identity' }), kv([['Wallet', h('span', { class: 'mono', text: d.wallet })], ['Known to the game', d.found ? 'Yes' : 'No records in this scope'], ['Chat name', d.identity.chatName || '—'], ['Online now', d.identity.onlineNow ? 'Yes (heartbeat < 90 s)' : 'No'], ['Staff roles', d.identity.staffRoles.join(', ') || '—']])),
      card(h('h3', { text: 'Chat standing' }), kv([['Status', c.banned ? badge('Banned from chat', 'crit') : c.mutedUntil ? h('span', {}, badge('Muted', 'warn'), ' until ', when(c.mutedUntil)) : badge('Can chat', 'ok')], ['Warnings', n(c.warnings)], ['Reports against', n(c.reportsAgainst) + ' (' + n(c.openReportsAgainst) + ' open)'], ['Reports filed', n(c.reportsFiled)], ['Standing version', String(c.version)]]),
        can('moderation.write') && d.wallet.length > 30 && !d.identity.staffRoles.length ? sanctionButtons(d.wallet, c, () => lookup(d.wallet, out)) : null)];
    if (d.heroes) parts.push(card(h('h3', { text: 'Heroes' }), kv([['Total', n(d.heroes.total)], ...Object.entries(d.heroes.byRank).map(([r, k]) => ['Rank ' + r, n(k)])]), h('p', { class: 'muted', text: d.heroes.source })));
    if (d.economy) parts.push(card(h('h3', { text: 'Economy (read-only)' }), kv([['Ryo balance', n(d.economy.ryoBalance)], ['Chest pending', n(d.economy.chestPending)], ['Chest claimed', n(d.economy.chestClaimed)], ['Pending purchases', n(d.economy.pendingPurchases)], ['Pending withdrawals', n(d.economy.pendingWithdrawals)]]), h('p', { class: 'muted', text: d.economy.source })));
    if (d.transactions) parts.push(card(h('h3', { text: 'Recent transactions' }), scroll('table-wide', ['Type', 'Request', 'Status', 'Ryo', 'Created', 'Signature'], d.transactions.length ? d.transactions.map(x => h('tr', {}, h('td', { text: x.kind + (x.product ? ' · ' + x.product : '') }), h('td', { class: 'mono', text: x.requestId }), h('td', {}, statusBadge(x.status)), h('td', { text: n(x.amount) }), h('td', {}, when(x.created)), h('td', { class: 'mono', text: short(x.signature), title: x.signature }))) : empty(6))));
    if (d.moderation) parts.push(card(h('h3', { text: 'Moderation history' }), scroll('table-wide', ['When', 'Decision', 'By', 'Reason'], d.moderation.length ? d.moderation.map(m => h('tr', {}, h('td', {}, when(m.created)), h('td', {}, badge(m.decision, 'violet'), m.durationMs ? ' ' + Math.round(m.durationMs / 60000) + ' min' : ''), h('td', {}, h('span', { class: 'mono', text: short(m.actor) }), ' ', m.role), h('td', {}, m.reasonCode + ': ' + m.reason))) : empty(4))));
    fill(out, h('div', { class: 'grid cols' }, parts));
  }

  /* ---------- Chat moderation panels ---------- */
  const CATEGORY = [['spam', 'Spam'], ['scam', 'Scam / phishing'], ['harassment', 'Harassment'], ['impersonation', 'Impersonation'], ['offensive', 'Offensive language'], ['other', 'Other rule break']];
  const DURATION = [['5', '5 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['1440', '24 hours'], ['10080', '7 days']];
  async function standingOf(wallet) { return (await api('cc-player-lookup', { query: wallet })).data.chat; }
  // Fetches the current standing first, so the decision is bound to the version the moderator reviewed.
  async function decide(decision, { wallet, messageId, reportId, category }, after) {
    const needsVersion = !['hide', 'unhide'].includes(decision), st = needsVersion ? await standingOf(wallet) : null;
    const label = { warn: 'Warn player', hide: 'Hide message', unhide: 'Restore message', mute: 'Mute player', unmute: 'Unmute player', ban: 'Ban from chat', unban: 'Lift chat ban' }[decision];
    const detail = (wallet ? 'Wallet ' + wallet + '. ' : '') + (st ? 'Current standing: ' + (st.banned ? 'banned' : st.mutedUntil ? 'muted' : 'can chat') + ', ' + st.warnings + ' warning(s). ' : '') +
      { warn: 'The player sees the warning above their chat box for 24 hours.', hide: 'Players stop seeing the message. A restricted copy stays as evidence.', unhide: 'The message becomes visible again.', mute: 'Chat sending is refused by the server until the mute ends. Reading stays available.', unmute: 'The player can send messages again.', ban: 'Chat sending is refused by the server until the ban is lifted.', unban: 'The player can send messages again.' }[decision];
    const fields = [{ name: 'reasonCode', label: t('field.category'), options: category ? [[category, CATEGORY.find(c => c[0] === category)[1]], ...CATEGORY.filter(c => c[0] !== category)] : CATEGORY }];
    if (decision === 'mute') fields.push({ name: 'duration', label: t('field.duration'), options: DURATION });
    const r = await guarded({ title: label, detail, fields, confirm: label, danger: ['ban', 'mute', 'hide'].includes(decision), submit: v => write('cc-chat-moderate', { decision, messageId: messageId || undefined, targetWallet: messageId ? undefined : wallet, reportId: reportId || undefined, reasonCode: v.reasonCode, durationMinutes: v.duration ? Number(v.duration) : undefined, expectedVersion: st ? st.version : undefined, reason: v.reason }) });
    if (r) { notice(label + ': done' + (r.replayed ? ' (already applied)' : '') + '.', 'ok'); await after(); }
  }
  function sanctionButtons(wallet, st, after, extra = {}) {
    const b = (d, cls = '') => h('button', { class: 'small ' + cls, type: 'button', text: { warn: 'Warn', mute: 'Mute', unmute: 'Unmute', ban: 'Ban', unban: 'Unban' }[d], onclick: () => run(() => decide(d, { wallet, ...extra }, after)) });
    return h('div', { class: 'row-actions' }, b('warn'), st?.mutedUntil ? b('unmute') : b('mute', 'danger'), st?.banned ? b('unban') : b('ban', 'danger'));
  }
  const CHAT = {
    async reports(panel) {
      S.reportStatus = S.reportStatus || 'open';
      const o = await api('cc-chat-reports', { status: S.reportStatus, limit: 50 }), d = o.data, writeOk = can('moderation.write');
      const pick = h('select', { 'aria-label': 'Report status', onchange: e => { S.reportStatus = e.target.value; run(() => CHAT.reports(panel)); } }, ['open', 'actioned', 'dismissed'].map(s => h('option', { value: s, selected: s === S.reportStatus, text: s })));
      const items = d.reports.map(r => card(h('div', { class: 'report' },
        h('div', { class: 'view-head' }, h('div', {}, badge(CATEGORY.find(c => c[0] === r.category)?.[1] || r.category, 'gold'), ' ', statusBadge(r.status), ' ', r.reportsForMessage > 1 ? badge(r.reportsForMessage + ' reports on this message', 'warn') : null), when(r.created)),
        h('blockquote', {}, h('b', { text: r.snapshot.name }), ' ', h('span', { class: 'mono muted', text: short(r.targetWallet), title: r.targetWallet }), ' ', when(r.snapshot.created), h('div', { class: 'msg', text: r.snapshot.text })),
        r.details ? h('p', {}, h('span', { class: 'muted', text: 'Reporter note: ' }), r.details) : null,
        h('p', { class: 'muted' }, 'Reported by ', h('span', { class: 'mono', text: short(r.reporter), title: r.reporter }), ' · message #' + r.messageId + ' · ', !r.message.stored ? 'no longer stored (snapshot shown)' : r.message.hidden ? 'hidden' : 'visible'),
        r.resolution ? h('p', { class: 'muted', text: 'Resolution: ' + r.resolution + ' by ' + short(r.resolvedBy) }) : null,
        r.status === 'open' ? h('div', { class: 'row-actions' },
          writeOk && r.message.stored && !r.message.hidden ? h('button', { class: 'small danger', type: 'button', text: 'Hide message', onclick: () => run(() => decide('hide', { messageId: r.messageId, reportId: r.id, category: r.category }, () => CHAT.reports(panel))) }) : null,
          writeOk ? ['warn', 'mute', 'ban'].map(dc => h('button', { class: 'small' + (dc === 'warn' ? '' : ' danger'), type: 'button', text: { warn: 'Warn', mute: 'Mute', ban: 'Ban' }[dc], onclick: () => run(() => decide(dc, { wallet: r.targetWallet, reportId: r.id, category: r.category }, () => CHAT.reports(panel))) })) : null,
          can('reports.resolve') ? h('button', { class: 'small', type: 'button', text: 'Dismiss', onclick: () => run(async () => { if (await guarded({ title: 'Dismiss report #' + r.id, detail: 'No action is taken against the player.', confirm: 'Dismiss', submit: v => write('cc-report-resolve', { reportId: r.id, resolution: 'dismiss', reason: v.reason }) })) { notice('Report dismissed.', 'ok'); await CHAT.reports(panel); } }) }) : null) : null)));
      fill(panel, h('div', { class: 'inline' }, h('label', {}, 'Status', pick), h('p', { class: 'muted', text: 'Evidence is kept ' + d.retentionDays + ' days after a report is resolved, then redacted.' })), h('div', { class: 'grid' }, items.length ? items : stateBox(t('state.empty'), 'No ' + S.reportStatus + ' reports.')));
    },
    feed: panel => feed(panel, 'global'),
    system: panel => feed(panel, 'system'),
    async sanctions(panel) {
      const d = (await api('cc-chat-sanctions')).data;
      const rows = d.sanctions.map(s => h('tr', {}, h('td', { class: 'mono', text: s.wallet }), h('td', {}, s.banned ? badge('banned', 'crit') : h('span', {}, badge('muted', 'warn'), ' until ', when(s.mutedUntil))), h('td', { text: n(s.warnings) }), h('td', {}, h('span', { class: 'mono', text: short(s.actor) }), h('br'), when(s.updated)),
        h('td', {}, can('moderation.write') ? h('button', { class: 'small', type: 'button', text: s.banned ? 'Unban' : 'Unmute', onclick: () => run(() => decide(s.banned ? 'unban' : 'unmute', { wallet: s.wallet }, () => CHAT.sanctions(panel))) }) : null)));
      fill(panel, card(scroll('table-wide', ['Wallet', 'Standing', 'Warnings', 'Last change', ''], rows.length ? rows : empty(5, 'No active mutes or bans.'))));
    },
    async channels(panel) {
      fill(panel, h('div', { class: 'grid cols' }, ['Guild', 'Team', 'Direct messages', 'Trade', 'Event'].map(ch => card(h('h3', { text: ch }), badge(t('state.notImplemented'), 'violet'), h('p', { class: 'muted', text: 'This channel has no backend. Nothing is stored or monitored, and there is nothing to moderate.' })))),
        h('p', { class: 'muted', text: 'Player appeals are handled through the support channel; an in-game appeal form is not implemented yet.' }));
    },
  };
  async function feed(panel, channel) {
    const body = h('tbody'), more = h('button', { type: 'button', hidden: true, text: t('action.loadMore') }); let cursor = null;
    const load = async () => {
      const o = await api('cc-chat-feed', { channel, cursor: cursor || undefined, limit: 50 });
      for (const m of o.data.messages) body.append(h('tr', {},
        h('td', {}, '#' + m.id, h('br'), when(m.created)), h('td', {}, h('b', { text: m.name }), h('br'), h('span', { class: 'mono muted', text: short(m.wallet), title: m.wallet })),
        h('td', {}, h('div', { class: 'msg' + (m.hidden ? ' hidden' : ''), text: m.text }), m.hidden ? badge('hidden', 'warn') : null, m.openReports ? badge(m.openReports + ' open report(s)', 'gold') : null),
        h('td', {}, can('moderation.write') ? h('div', { class: 'row-actions' },
          h('button', { class: 'small' + (m.hidden ? '' : ' danger'), type: 'button', text: m.hidden ? 'Restore' : 'Hide', onclick: () => run(() => decide(m.hidden ? 'unhide' : 'hide', { messageId: m.id }, () => feed(panel, channel))) }),
          channel === 'global' ? h('button', { class: 'small', type: 'button', text: 'Sender…', onclick: () => run(async () => { S.view = 'players'; renderNav(); const view = $('view'); await RENDER.players(view); const out = view.querySelector('.grid'); await lookup(m.wallet, out); }) }) : null) : null)));
      if (!body.children.length) body.append(empty(4));
      cursor = o.nextCursor; more.hidden = !cursor;
    };
    more.onclick = () => run(load);
    fill(panel, card(h('div', { class: 'scroll' }, h('table', { class: 'table-wide' }, h('thead', {}, h('tr', {}, ['Message', 'Sender', 'Text', ''].map(x => h('th', { scope: 'col', text: x })))), body)), more));
    await load();
  }

  /* ---------- Wiring ---------- */
  try { S.lang = localStorage.getItem('cc-lang') === 'pt' ? 'pt' : 'en'; } catch {}
  $('lang').value = S.lang; applyI18n();
  $('lang').onchange = e => { S.lang = e.target.value === 'pt' ? 'pt' : 'en'; try { localStorage.setItem('cc-lang', S.lang); } catch {} applyI18n(); if (S.session) { renderNav(); go(S.view); } };
  $('connect').onclick = () => run(connect);
  $('signout').onclick = () => signOut();
  $('menu').onclick = () => drawer(!$('sidebar').classList.contains('open'));
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));
  window.addEventListener('pageshow', e => { if (e.persisted) signOut(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('sidebar').classList.contains('open')) drawer(false, true); });
})();
