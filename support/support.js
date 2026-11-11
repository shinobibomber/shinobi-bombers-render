/* In-game Support tickets, client (apply-support.cjs). Owner decisions 2026-11-12. Opened from the Reward Center, Help & Support.
 * The server decides everything (who the player is, limits, which order links are theirs, what the thread contains); this file
 * only shows the player's own tickets and the thread with the team. Every piece of text that comes from the server, including
 * the player's own messages, is set with textContent, never as HTML. Strings are English, like the rest of the game client. */
(function () {
  'use strict';
  const LABEL = { payment: 'Payment or deposit', withdrawal: 'Withdrawal', hero: 'Heroes or NFTs', reward: 'Rewards or Chest', bug: 'Something is broken', account: 'Account or sign-in', other: 'Something else' };
  const STATUS = { submitted: 'Waiting for the team', triaged: 'Seen by the team', investigating: 'Being looked at', awaiting_player: 'Waiting for your reply', resolved: 'Resolved', closed: 'Closed' };
  let dialog = null, state = null, view = 'list', current = null, thread = [], busy = false, note = '', ok = false;
  const draft = { category: 'payment', subject: '', message: '', reference: '' };
  let replyText = '', submitId = null, replyId = null;
  const rid = () => 'sup-' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 32);
  const authed = () => !!window.RyoPayments?.state?.authenticated;
  const call = (action, body = {}) => window.RyoPayments.support(action, body);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const button = (text, onClick, cls = '', disabled = busy) => { const b = el('button', 'sup-btn ' + cls, text); b.type = 'button'; b.onclick = onClick; b.disabled = disabled; return b; };
  const when = t => (t ? new Date(t).toLocaleString() : '');
  const say = (text, good = false) => { note = text || ''; ok = good; render(); };

  function style() {
    if (document.getElementById('supportStyle')) return;
    const s = document.createElement('style'); s.id = 'supportStyle';
    s.textContent = `dialog.sup-dialog{width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 32px);box-sizing:border-box;padding:0;border:2px solid #ffcf63;border-radius:14px;background:linear-gradient(180deg,#1d1305,#0b0816 60%);color:#fff3cf;font:16px Rajdhani,sans-serif;overflow:auto}
dialog.sup-dialog::backdrop{background:#000b}
.sup-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #6b4a12}.sup-head h2{flex:1;margin:0;font:900 20px Rajdhani,sans-serif;letter-spacing:.08em;color:#ffcf63}
.sup-body{padding:14px 16px}.sup-foot{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:0 16px 14px}
.sup-btn{min-height:38px;padding:0 14px;border:1px solid #ffcf63;border-radius:8px;background:#1a1226;color:#ffe9a8;font:900 15px Rajdhani,sans-serif;cursor:pointer}
.sup-btn.gold{background:linear-gradient(#fcc126,#f7a51a 55%,#fb8f0b);color:#2a1000}.sup-btn:disabled{opacity:.45;cursor:not-allowed}
.sup-list{display:grid;gap:8px;margin:10px 0 0;padding:0;list-style:none}
.sup-item{display:grid;gap:2px;width:100%;text-align:left;padding:10px 12px;border:1px solid #6b4a12;border-radius:10px;background:#140d1f;color:#fff3cf;font:inherit;cursor:pointer}
.sup-item b{color:#ffcf63}.sup-item small{color:#d7b4ff}.sup-item.wait{border-color:#7dff9b}
.sup-note{margin:0 0 10px;color:#e8dcc0}.sup-msg{min-height:1.2em;margin:8px 0 0;color:#ff9d7a}.sup-msg.ok{color:#7dff9b}
.sup-form{display:grid;gap:10px}.sup-form label{display:grid;gap:4px;color:#d7b4ff;font-weight:700}
.sup-form input,.sup-form select,.sup-form textarea{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid #6b4a12;border-radius:8px;background:#0d0a18;color:#fff3cf;font:15px sans-serif}
.sup-form textarea{min-height:110px;resize:vertical}.sup-count{justify-self:end;color:#bfae86;font-weight:400;font-size:13px}
.sup-thread{display:grid;gap:8px;margin:10px 0}.sup-bubble{max-width:90%;padding:8px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word;font:15px sans-serif}
.sup-bubble.you{justify-self:end;background:#2b1e45;border:1px solid #7a58c0}.sup-bubble.team{justify-self:start;background:#14240f;border:1px solid #4d8f35}
.sup-bubble small{display:block;margin-bottom:2px;color:#bfae86;font:700 12px Rajdhani,sans-serif;letter-spacing:.04em}`;
    document.head.append(s);
  }

  async function refresh() {
    if (!authed() || typeof window.RyoPayments?.support !== 'function') { state = null; render(); return; }
    try { state = (await call('support-state')).support || { enabled: false, tickets: [] }; } catch (e) { say(e.message || 'Could not load your tickets.'); return; }
    render();
  }
  async function openTicket(id) {
    busy = true; render();
    try { const data = await call('support-view', { id }); current = data.ticket; thread = data.messages; view = 'ticket'; replyText = ''; replyId = null; note = ''; }
    catch (e) { note = e.message; ok = false; }
    busy = false; render();
  }
  async function send() {
    busy = true; note = ''; render();
    try {
      submitId = submitId || rid();   // the same ID on a retry, so a lost answer can never create two tickets
      const data = await call('support-submit', { requestId: submitId, category: draft.category, subject: draft.subject, message: draft.message, reference: draft.reference });
      submitId = null; Object.assign(draft, { subject: '', message: '', reference: '' });
      await refresh(); busy = false; await openTicket(data.ticket.id); say('Ticket sent. Our team will reply here.', true); return;
    } catch (e) { note = e.message || 'Could not send the ticket.'; ok = false; if (e.status && e.status < 500) submitId = null; }
    busy = false; render();
  }
  async function sendReply() {
    busy = true; note = ''; render();
    try {
      replyId = replyId || rid();
      const data = await call('support-reply', { requestId: replyId, id: current.id, message: replyText });
      replyId = null; replyText = ''; busy = false; await refresh(); await openTicket(data.ticket.id); say('Message sent.', true); return;
    } catch (e) { note = e.message || 'Could not send your message.'; ok = false; if (e.status && e.status < 500) replyId = null; }
    busy = false; render();
  }

  function render() {
    if (!dialog?.open) return;
    const head = el('div', 'sup-head'), body = el('div', 'sup-body'), foot = el('div', 'sup-foot');
    head.append(el('h2', '', view === 'new' ? 'NEW TICKET' : view === 'ticket' && current ? 'TICKET #' + current.id : 'SUPPORT'), button('✕', () => dialog.close(), '', false));
    head.lastChild.setAttribute('aria-label', 'Close');
    if (!authed()) body.append(el('p', 'sup-note', 'Sign in to contact support.'));
    else if (!state) body.append(el('p', 'sup-note', 'Loading…'));
    else if (!state.enabled) body.append(el('p', 'sup-note', 'Support tickets are not open right now. Please try again later.'));
    else if (view === 'new') form(body, foot); else if (view === 'ticket' && current) ticketView(body, foot); else list(body, foot);
    const msg = el('p', 'sup-msg' + (ok ? ' ok' : ''), note); msg.setAttribute('role', 'status'); body.append(msg);
    dialog.replaceChildren(head, body, foot);
  }
  function list(body, foot) {
    body.append(el('p', 'sup-note', 'Tell us what went wrong and our team will reply here. Include an order reference if it is about a payment. Tickets and replies are deleted 30 days after they are resolved.'));
    const items = el('ul', 'sup-list');
    for (const t of state.tickets) {
      const li = el('li'), b = el('button', 'sup-item' + (t.status === 'awaiting_player' ? ' wait' : '')); b.type = 'button'; b.onclick = () => openTicket(t.id);
      b.append(el('b', '', t.expired ? 'Expired ticket #' + t.id : t.subject), el('small', '', (LABEL[t.category] || t.category) + ' · ' + (STATUS[t.status] || t.status) + ' · ' + when(t.updated))); li.append(b); items.append(li);
    }
    body.append(state.tickets.length ? items : el('p', 'sup-note', 'You have no tickets yet.'));
    foot.append(button('New ticket', () => { view = 'new'; note = ''; render(); }, 'gold', false), button('Refresh', refresh, '', false));
  }
  function form(body, foot) {
    const f = el('div', 'sup-form'), field = (label, input, extra) => { const l = el('label', '', label); l.append(input); if (extra) l.append(extra); f.append(l); return input; };
    const cat = el('select'); for (const c of state.categories || Object.keys(LABEL)) { const o = el('option', '', LABEL[c] || c); o.value = c; cat.append(o); } cat.value = draft.category; cat.onchange = () => { draft.category = cat.value; };
    field('What is it about?', cat);
    const subject = el('input'); subject.maxLength = 80; subject.value = draft.subject; subject.oninput = () => { draft.subject = subject.value; }; field('Short title', subject);
    const msg = el('textarea'); msg.maxLength = 1000; msg.value = draft.message; const count = el('span', 'sup-count', draft.message.length + ' / 1000'); msg.oninput = () => { draft.message = msg.value; count.textContent = msg.value.length + ' / 1000'; }; field('What happened?', msg, count);
    const ref = el('input'); ref.maxLength = 90; ref.placeholder = 'Request ID or transaction signature (optional)'; ref.value = draft.reference; ref.oninput = () => { draft.reference = ref.value; }; field('Order reference', ref);
    body.append(f);
    foot.append(button('Back', () => { view = 'list'; note = ''; render(); }, '', false), button('Send ticket', send, 'gold'));
  }
  function ticketView(body, foot) {
    body.append(el('p', 'sup-note', (current.expired ? 'Expired ticket' : current.subject) + ' · ' + (LABEL[current.category] || current.category) + ' · ' + (STATUS[current.status] || current.status)));
    const box = el('div', 'sup-thread');
    for (const m of thread) { const b = el('div', 'sup-bubble ' + m.from), who = el('small', '', (m.from === 'team' ? 'Support team' : 'You') + ' · ' + when(m.created)); b.append(who, document.createTextNode(m.text)); box.append(b); }
    body.append(box);
    if (current.status === 'closed') body.append(el('p', 'sup-note', 'This ticket is closed. Send a new ticket if you still need help.'));
    else if (current.expired) body.append(el('p', 'sup-note', 'This ticket has expired.'));
    else { const t = el('textarea'); t.maxLength = 1000; t.placeholder = 'Write a reply…'; t.value = replyText; t.oninput = () => { replyText = t.value; sendBtn.disabled = !replyText.trim(); }; const sendBtn = button('Send reply', sendReply, 'gold', busy || !replyText.trim()); const f = el('div', 'sup-form'); f.append(t); body.append(f); foot.append(sendBtn); }
    foot.prepend(button('Back', async () => { view = 'list'; note = ''; await refresh(); }, '', false), button('Refresh', () => openTicket(current.id), '', false));
  }

  window.SupportTickets = {
    open() {
      style();
      if (!dialog) { dialog = document.createElement('dialog'); dialog.className = 'sup-dialog'; dialog.setAttribute('aria-label', 'Support'); document.body.append(dialog); dialog.addEventListener('close', () => { view = 'list'; current = null; }); }
      view = 'list'; note = ''; if (!dialog.open) dialog.showModal(); render(); refresh();
    },
  };
})();
