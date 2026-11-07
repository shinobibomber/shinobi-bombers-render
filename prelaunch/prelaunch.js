/* Shinobi Bombers pre-launch portal: languages (EN / PT-BR), Comfort mode, wallet sign-in, registration,
 * the referral dashboard, leaderboard and announcements. Talks only to POST /api/prelaunch (same origin,
 * HttpOnly session cookie). Never sends a transaction. Legal pages reuse the language + comfort parts. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LANGS = ['en', 'pt-BR'], SESSION_KEY = 'sb-pl-session', LANG_KEY = 'sb-pl-lang', COMFORT_KEY = 'sb-pl-comfort', REF_KEY = 'sb-creator-referral-v1';
  const dict = { en: null, cur: null };
  let lang = 'en', status = null, me = null, refPage = 0, lbPage = 0, countdownTimer = null;

  /* ---------- i18n ---------- */
  function t(key, vars = {}) {
    let s = dict.cur?.[key] ?? dict.en?.[key];
    if (s === undefined) { console.warn('[i18n] missing', key); return key; }
    if (typeof s !== 'string') return s;
    return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  }
  async function loadDict(l) { const r = await fetch('/pl/i18n/' + l + '.json', { cache: 'no-cache' }); if (!r.ok) throw Error('i18n'); return r.json(); }
  function apply() {
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach(el => { const v = t(el.dataset.i18n, { year: new Date().getFullYear() }); if (typeof v === 'string') el.textContent = v; });
    $$('[data-i18n-attr]').forEach(el => el.dataset.i18nAttr.split(';').forEach(pair => { const [attr, key] = pair.split(':'); if (attr && key) el.setAttribute(attr, t(key)); }));
    $$('[data-i18n-list]').forEach(el => { const items = t(el.dataset.i18nList); el.replaceChildren(...(Array.isArray(items) ? items : []).map(x => { const li = document.createElement('li'); li.textContent = x; return li; })); });
    const sel = $('#langSelect'); if (sel) sel.value = lang;
  }
  async function setLang(l, save = true) {
    lang = LANGS.includes(l) ? l : 'en';
    try { dict.en = dict.en || await loadDict('en'); dict.cur = lang === 'en' ? dict.en : await loadDict(lang); } catch { dict.cur = dict.en; }
    if (save) try { localStorage.setItem(LANG_KEY, lang); } catch {}
    apply(); renderDynamic();
  }
  function initialLang() {
    try { const saved = localStorage.getItem(LANG_KEY); if (LANGS.includes(saved)) return saved; } catch {}
    return /^pt\b/i.test(navigator.language || '') ? 'pt-BR' : 'en';   // the browser locale is only a first suggestion
  }
  const fmtDate = (ms, time = false) => new Intl.DateTimeFormat(lang, time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(ms));
  const fmtNum = n => new Intl.NumberFormat(lang).format(n);

  /* ---------- small UI helpers ---------- */
  function toast(text) { const el = $('#toast'); if (!el) return; el.textContent = text; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 4200); }
  const has = key => (dict.cur && key in dict.cur) || (dict.en && key in dict.en);
  const errText = e => has('err.' + e?.code) ? t('err.' + e.code) : t('err.default');
  const shortWallet = w => w ? w.slice(0, 4) + '…' + w.slice(-4) : '';
  function el(tag, attrs = {}, ...kids) { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } n.append(...kids.filter(k => k != null)); return n; }

  /* ---------- comfort mode ---------- */
  function setComfort(onOff) {
    document.documentElement.classList.toggle('comfort', onOff);
    $('#comfortBtn')?.setAttribute('aria-pressed', String(onOff));
    try { localStorage.setItem(COMFORT_KEY, onOff ? '1' : '0'); } catch {}
  }

  /* ---------- referral capture (same storage as the game, so the code also works after launch) ---------- */
  function savedReferral() {
    try { const r = JSON.parse(localStorage.getItem(REF_KEY)); if (r && /^[A-Z0-9]{4,32}$/.test(r.code) && Date.now() - r.created < 7 * 86400000) return r.code; localStorage.removeItem(REF_KEY); } catch {}
    return null;
  }
  function captureReferral() {
    try {
      const p = new URL(location.href).searchParams, code = (p.get('referral') || p.get('ref') || p.get('creator') || '').toUpperCase();
      if (/^[A-Z0-9]{4,32}$/.test(code) && !savedReferral()) localStorage.setItem(REF_KEY, JSON.stringify({ code, created: Date.now() }));
    } catch {}
  }

  /* ---------- API ---------- */
  async function api(action, body = {}) {
    let r;
    try { r = await fetch('/api/prelaunch', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-SB-Prelaunch': '1' }, body: JSON.stringify({ ...body, action }) }); }
    catch { throw Object.assign(Error('network'), { code: 'NETWORK' }); }
    let data = {}; try { data = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(Error(data.error || 'error'), { code: data.code || 'SERVER_ERROR', status: r.status });
    return data;
  }

  /* ---------- launch status, links, announcements ---------- */
  function renderStatus() {
    if (!status) return;
    const launch = $('#launchStatus'), cd = $('#countdown');
    clearInterval(countdownTimer);
    if (launch && status.launchAt) {
      launch.textContent = t('hero.launchAt', { date: fmtDate(Date.parse(status.launchAt), true) });
      const tick = () => { const ms = Date.parse(status.launchAt) - Date.now(); if (ms <= 0) { cd.hidden = true; return; } const m = Math.floor(ms / 60000); cd.textContent = t('hero.countdown', { d: Math.floor(m / 1440), h: Math.floor(m / 60) % 24, m: m % 60 }); cd.hidden = false; };
      tick(); countdownTimer = setInterval(tick, 30000);
    } else if (launch) { launch.textContent = t('hero.launchTbd'); if (cd) cd.hidden = true; }
    const discord = $('#discordLink'), soon = $('#discordSoon'), x = $('#xLink'), support = $('#supportLink');
    if (discord) { discord.hidden = !status.links?.discord; if (status.links?.discord) discord.href = status.links.discord; soon.hidden = !!status.links?.discord; }
    if (x) { x.hidden = !status.links?.x; if (status.links?.x) x.href = status.links.x; }
    if (support) { support.hidden = !status.links?.support; if (status.links?.support) support.href = status.links.support; }
    const news = $('#newsList');
    if (news) {
      const list = status.announcements || [];
      news.replaceChildren(...(list.length ? list.map(a => el('article', {}, el('time', { datetime: a.date, text: fmtDate(Date.parse(a.date + 'T12:00:00Z')) }), el('span', { class: 'kind', text: t('kind.' + a.kind) }),
        el('h4', { text: a.title[lang] || a.title.en }), el('p', { text: a.body[lang] || a.body.en }))) : [el('p', { class: 'note', text: t('com.noNews') })]));
    }
  }

  async function loadBoard() {
    const box = $('#board'); if (!box) return;
    try {
      const data = await api('leaderboard', { page: lbPage });
      if (!data.rows.length) { box.replaceChildren(el('p', { class: 'note', text: t('lb.empty') })); }
      else box.replaceChildren(el('table', {}, el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: t('lb.rank') }), el('th', { scope: 'col', text: t('lb.player') }), el('th', { scope: 'col', text: t('lb.count') }))),
        el('tbody', {}, ...data.rows.map(r => el('tr', {}, el('td', { text: '#' + r.rank }), el('td', { text: r.player }), el('td', { text: fmtNum(r.registrations) }))))));
      $('#lbPrev').disabled = lbPage === 0; $('#lbNext').disabled = data.rows.length < data.pageSize || lbPage >= 4;
    } catch { box.replaceChildren(el('p', { class: 'note', text: t('err.default') })); }
  }

  /* ---------- wallet sign-in ---------- */
  function openWallets() {
    const dlg = $('#walletDialog'), list = $('#walletList'), st = $('#walletStatus');
    st.textContent = ''; st.classList.remove('err');
    const draw = () => {
      const wallets = window.SBWallet?.list() || [];
      if (!wallets.length) {
        list.replaceChildren(el('p', { class: 'note', text: t('wallet.none') }),
          el('a', { class: 'btn btn-ghost btn-sm', href: 'https://phantom.app/download', target: '_blank', rel: 'noopener noreferrer', text: t('wallet.getPhantom') }),
          el('a', { class: 'btn btn-ghost btn-sm', href: 'https://solflare.com/download', target: '_blank', rel: 'noopener noreferrer', text: t('wallet.getSolflare') }));
        return;
      }
      list.replaceChildren(...wallets.map(w => {
        const b = el('button', { type: 'button' }, w.icon ? el('img', { src: w.icon, alt: '' }) : el('span', { class: 'wl-letter', 'aria-hidden': 'true', text: w.name[0] }), el('span', { text: w.name }), el('small', { text: t('wallet.detected') }));
        b.addEventListener('click', () => signIn(w));
        return b;
      }));
    };
    draw(); const off = window.SBWallet?.onChange(draw);
    dlg.addEventListener('close', () => off?.(), { once: true });
    if (!dlg.open) dlg.showModal();
  }
  async function signIn(w) {
    const st = $('#walletStatus'), buttons = $$('#walletList button');
    buttons.forEach(b => { b.disabled = true; }); st.classList.remove('err');
    try {
      st.textContent = t('wallet.connecting', { wallet: w.name });
      const { address } = await SBWallet.connect(w.id);
      const challenge = await api('challenge', { wallet: address });
      // The message is built by the server; check it names this site and wallet before signing.
      if (!challenge.message.startsWith(location.host + ' wants you to sign in') || !challenge.message.includes('\n' + address + '\n') || !challenge.message.includes('URI: ' + location.origin)) throw Object.assign(Error('origin'), { code: 'ORIGIN' });
      st.textContent = t('wallet.signing', { wallet: w.name });
      const signature = await SBWallet.signMessage(challenge.message);
      me = await api('login', { wallet: address, nonce: challenge.nonce, signature });
      try { localStorage.setItem(SESSION_KEY, '1'); } catch {}
      $('#walletDialog').close();
      afterSignIn();
    } catch (e) {
      const code = ['NETWORK', 'ORIGIN', 'RATE_LIMITED', 'SIGNATURE_INVALID', 'WALLET_INVALID', 'SERVER_ERROR'].includes(e.code) ? e.code : window.SBWallet?.errorCode(e) || 'default';
      st.textContent = errText({ code }); st.classList.add('err');
    } finally { buttons.forEach(b => { b.disabled = false; }); }
  }
  function afterSignIn() {
    if (!me) return;
    if (!me.registered) return openRegister();
    if (me.player?.language && me.player.language !== lang) setLang(me.player.language);
    showDashboard(true);
  }

  /* ---------- registration ---------- */
  function openRegister() {
    const dlg = $('#registerForm').closest('dialog'), f = $('#registerForm');
    $('#regWallet').textContent = shortWallet(me.wallet);
    f.language.value = lang; f.region.value = /^pt/i.test(lang) ? 'south-america' : 'asia';
    const code = savedReferral(), inv = $('#regInvite'); inv.hidden = !code; if (code) inv.textContent = t('reg.invited', { code });
    $('#regStatus').textContent = '';
    if (!dlg.open) dlg.showModal();
    f.username.focus();
  }
  async function submitRegister(ev) {
    ev.preventDefault();
    const f = ev.target, st = $('#regStatus'), btn = $('button[type=submit]', f);
    st.textContent = '';
    if (!/^[A-Za-z0-9_]{3,16}$/.test(f.username.value)) { st.textContent = t('err.USERNAME_INVALID'); f.username.focus(); return; }
    if (!f.accept.checked) { st.textContent = t('err.ACCEPT'); f.accept.focus(); return; }
    btn.disabled = true; btn.textContent = t('reg.busy');
    try {
      const res = await api('register', { username: f.username.value, language: f.language.value, region: f.region.value, referralCode: savedReferral() || undefined });
      me = res; f.closest('dialog').close();
      if (res.referral && !res.referral.accepted) toast(errText(res.referral));
      else toast(res.referral?.accepted ? t('msg.refAccepted') : t('msg.registered'));
      if (res.referral) try { localStorage.removeItem(REF_KEY); } catch {}
      if (f.language.value !== lang) await setLang(f.language.value);
      showDashboard(true);
    } catch (e) {
      if (e.code === 'SIGN_IN') { f.closest('dialog').close(); me = null; toast(t('err.SIGN_IN')); return; }
      st.textContent = errText(e);
    } finally { btn.disabled = false; btn.textContent = t('reg.submit'); }
  }

  /* ---------- dashboard ---------- */
  async function showDashboard(scroll = false) {
    const p = me?.player; if (!p) return;
    const sec = $('#dashboard'); sec.hidden = false;
    $('#connectBtn').textContent = t('nav.dashboard'); $('#heroConnect').textContent = t('nav.dashboard');
    $('#dashWelcome').textContent = t('dash.welcome', { name: p.username });
    $('#dWallet').textContent = shortWallet(me.wallet); $('#dWallet').title = me.wallet;
    $('#dCode').textContent = p.referralCode || '—';
    $('#dLang').textContent = p.language === 'pt-BR' ? 'Português (Brasil)' : 'English';
    $('#dRegion').textContent = t('region.' + p.region);
    const by = $('#dReferredBy'); by.hidden = !me.referredBy; if (me.referredBy) by.textContent = t('dash.referredBy', { name: me.referredBy });
    $('#refLink').value = p.referralLink || '';
    $('#shareBtn').hidden = !navigator.share;
    const f = $('#prefsForm'); f.language.value = p.language; f.region.value = p.region; f.leaderboardVisible.checked = p.leaderboardVisible;
    await loadReferrals();
    if (scroll) sec.scrollIntoView({ block: 'start' });
  }
  async function loadReferrals() {
    const box = $('#refList');
    try {
      const d = await api('referrals', { page: refPage });
      $('#sInvited').textContent = fmtNum(d.stats.invited); $('#sProgress').textContent = fmtNum(d.stats.inProgress); $('#sQualified').textContent = fmtNum(d.stats.qualified);
      $('#sAvailable').textContent = fmtNum(d.stats.rewardsAvailable); $('#sEarned').textContent = fmtNum(d.stats.heroesEarned);
      if (!d.referrals.length) { box.replaceChildren(el('p', { class: 'note', text: t('dash.none') })); }
      else {
        const cell = (label, ...content) => el('div', {}, el('span', { class: 'lbl', text: label }), ...content);
        const head = el('div', { class: 'ref-item head', 'aria-hidden': 'true' }, ...['col.player', 'col.joined', 'col.heroes', 'col.stage', 'col.status', 'col.reward'].map(k => el('div', { text: t(k) })));
        box.replaceChildren(head, ...d.referrals.map(r => el('div', { class: 'ref-item' },
          cell(t('col.player'), el('b', { text: r.player })),
          cell(t('col.joined'), el('span', { text: fmtDate(r.joined) })),
          cell(t('col.heroes'), el('span', { text: d.prelaunch ? t('val.awaiting') : r.paidHeroes + ' / 15' })),
          cell(t('col.stage'), el('span', { text: d.prelaunch ? t('val.awaiting') : r.stage5 ? t('val.cleared') : t('val.notCleared') })),
          cell(t('col.status'), el('span', { class: 'pill ' + (r.status === 'QUALIFIED' ? 'q' : 'p'), text: t('status.' + r.status) })),
          cell(t('col.reward'), el('span', { text: r.rewardLocked ? '🔒 ' + t('reward.locked') : t('reward.ready') })))));
      }
      $('#refPrev').disabled = refPage === 0; $('#refNext').disabled = d.referrals.length < d.pageSize;
    } catch (e) {
      if (e.code === 'SIGN_IN') return signedOut(true);
      box.replaceChildren(el('p', { class: 'note', text: errText(e) }));
    }
  }
  function signedOut(expired = false) {
    me = null; try { localStorage.removeItem(SESSION_KEY); } catch {} $('#dashboard').hidden = true;
    $('#connectBtn').textContent = t('nav.connect'); $('#heroConnect').textContent = t('hero.connect');
    if (expired) toast(t('err.SIGN_IN'));
  }
  function renderDynamic() {
    renderStatus(); loadBoard();
    if (me?.player) showDashboard(); else if ($('#connectBtn')) { $('#connectBtn').textContent = t('nav.connect'); $('#heroConnect').textContent = t('hero.connect'); }
  }
  const connectOrDashboard = () => me?.player ? $('#dashboard').scrollIntoView() : me && !me.registered ? openRegister() : openWallets();

  /* ---------- boot ---------- */
  async function boot() {
    let comfort = false; try { comfort = localStorage.getItem(COMFORT_KEY) === '1'; } catch {}
    setComfort(comfort);
    $('#comfortBtn')?.addEventListener('click', () => setComfort(!document.documentElement.classList.contains('comfort')));
    $('#langSelect')?.addEventListener('change', e => { setLang(e.target.value); if (me?.player) api('preferences', { language: e.target.value }).then(r => { me = r; }).catch(() => {}); });
    const toggle = $('.menu-toggle'), links = $('#navLinks');
    toggle?.addEventListener('click', () => { const open = !links.classList.contains('open'); links.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open)); });
    links?.addEventListener('click', e => { if (e.target.closest('a')) { links.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false'); } });
    await setLang(initialLang(), false);
    if (document.body.dataset.page === 'doc') return;   // legal pages: language + comfort only

    captureReferral();
    for (const id of ['#connectBtn', '#heroConnect', '#refCta']) $(id)?.addEventListener('click', connectOrDashboard);
    $('#registerForm').addEventListener('submit', submitRegister);
    $('#regCancel').addEventListener('click', () => $('#registerDialog').close());
    $('#logoutBtn').addEventListener('click', async () => { try { await api('logout'); } catch {} try { await SBWallet.disconnect(); } catch {} signedOut(); });
    $('#copyBtn').addEventListener('click', async () => { const v = $('#refLink').value; try { await navigator.clipboard.writeText(v); } catch { $('#refLink').select(); document.execCommand?.('copy'); } toast(t('dash.copied')); });
    $('#shareBtn').addEventListener('click', () => navigator.share?.({ title: 'Shinobi Bombers', text: t('dash.shareText'), url: $('#refLink').value }).catch(() => {}));
    $('#refPrev').addEventListener('click', () => { refPage = Math.max(0, refPage - 1); loadReferrals(); });
    $('#refNext').addEventListener('click', () => { refPage++; loadReferrals(); });
    $('#lbPrev').addEventListener('click', () => { lbPage = Math.max(0, lbPage - 1); loadBoard(); });
    $('#lbNext').addEventListener('click', () => { lbPage = Math.min(4, lbPage + 1); loadBoard(); });
    $('#prefsForm').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target;
      try { me = await api('preferences', { language: f.language.value, region: f.region.value, leaderboardVisible: f.leaderboardVisible.checked }); toast(t('dash.saved')); if (f.language.value !== lang) await setLang(f.language.value); else showDashboard(); loadBoard(); }
      catch (err) { if (err.code === 'SIGN_IN') return signedOut(true); toast(errText(err)); }
    });
    try { status = await api('status'); } catch { status = null; }
    renderStatus(); loadBoard();
    // Only ask for the session when this browser signed in before (avoids a needless 401 for new visitors).
    let hint = false; try { hint = localStorage.getItem(SESSION_KEY) === '1'; } catch {}
    if (hint) try { me = await api('me'); if (me.player?.language && me.player.language !== lang) await setLang(me.player.language); afterSignInQuiet(); } catch { signedOut(); }
  }
  function afterSignInQuiet() { if (me?.player) showDashboard(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
