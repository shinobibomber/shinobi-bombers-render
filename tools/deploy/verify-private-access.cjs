#!/usr/bin/env node
/* Post-deploy check that the live server is still locked (private live testing / pre-launch).
 * Report only: it sends ordinary GET/POST requests, never changes Render, environment or release stage.
 *
 *   node tools/deploy/verify-private-access.cjs https://www.example.com            # anonymous checks
 *   node tools/deploy/verify-private-access.cjs https://www.example.com --cookie "sb_pt=…"   # + owner access
 *   (also try the service's *.onrender.com address: every hostname must be locked)
 *
 * Exits 1 if any game path is reachable without a pass (a deployment-blocking leak), or if --cookie is given
 * and the owner cannot reach /play/. The pass cookie is a 1-hour session token: never paste it anywhere shared. */
'use strict';
const args = process.argv.slice(2), base = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
const cookieAt = args.indexOf('--cookie'), cookie = cookieAt >= 0 ? args[cookieAt + 1] : null;
if (!base) { console.error('Usage: verify-private-access.cjs <https://host> [--cookie "sb_pt=…"]'); process.exit(2); }

const results = []; let leaks = 0, failures = 0;
const record = (ok, label, detail, leak = false) => { results.push((ok ? 'PASS ' : leak ? 'LEAK ' : 'FAIL ') + label + (detail ? '  (' + detail + ')' : '')); if (!ok) leak ? leaks++ : failures++; };
const req = (p, init = {}) => fetch(base + p, { redirect: 'manual', ...init, headers: { 'user-agent': 'shinobi-private-access-check', ...(init.headers || {}) } });

(async () => {
  // The public pre-landing page.
  try {
    const r = await req('/'); const type = r.headers.get('content-type') || '';
    record(r.status === 200 && type.includes('text/html'), 'GET / serves the pre-landing page', r.status + ' ' + type);
    const h = await (await req('/healthz')).json().catch(() => ({}));
    record(h.mode === 'prelaunch', '/healthz reports pre-launch mode', JSON.stringify(h));
  } catch (e) { record(false, 'GET /', e.message); }

  // Every game path, anonymously: must answer exactly like the closed portal.
  const closed = [['/play/', 302, '/'], ['/play', 302, '/'], ['/play/index.html', 302, '/'], ['/%70lay/', 302, '/'], ['/play//', 302, '/'],
    ['/admin/', 404], ['/admin', 404], ['/beta-config.json', 404], ['/play/assets/beta-wallet.js', 404]];
  for (const [p, status, location] of closed) {
    try {
      const r = await req(p), loc = r.headers.get('location');
      const ok = r.status === status && (!location || loc === location);
      record(ok, 'anonymous ' + p + ' is closed', r.status + (loc ? ' -> ' + loc : ''), !ok && r.status < 300);
    } catch (e) { record(false, 'anonymous ' + p, e.message); }
  }
  for (const p of ['/api/ryo', '/.netlify/functions/ryo']) for (const action of ['challenge', 'state', 'purchase', 'withdraw']) {
    try {
      const r = await req(p, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ action }) });
      const code = (await r.json().catch(() => ({}))).code;
      const ok = r.status === 403 && code === 'PRELAUNCH';
      record(ok, 'anonymous POST ' + p + ' ' + action + ' is closed', r.status + ' ' + code, !ok);
    } catch (e) { record(false, 'POST ' + p, e.message); }
  }
  // A made-up pass is refused.
  try { const r = await req('/play/', { headers: { cookie: 'sb_pt=' + 'A'.repeat(43) } }); record(r.status === 302, 'forged pass on /play/ is refused', String(r.status), r.status === 200); }
  catch (e) { record(false, 'forged pass', e.message); }

  // Optional: the owner's pass opens the game.
  if (cookie) {
    try {
      const r = await req('/play/', { headers: { cookie } });
      record(r.status === 200, 'owner pass opens /play/', String(r.status));
      const robots = r.headers.get('x-robots-tag') || '';
      record(/noindex/.test(robots), 'owner game page is noindex', robots);
    } catch (e) { record(false, 'owner /play/', e.message); }
  }

  console.log('Private access check · ' + base + ' · ' + new Date().toISOString());
  for (const line of results) console.log('  ' + line);
  if (leaks) console.log('\nBLOCKING: ' + leaks + ' game path(s) reachable without a pass. Roll back and investigate.');
  console.log(leaks || failures ? '\nRESULT: NOT VERIFIED' : '\nRESULT: LOCKED' + (cookie ? ' (owner access verified)' : ' (owner access not checked: pass --cookie)'));
  process.exit(leaks || failures ? 1 : 0);
})();
