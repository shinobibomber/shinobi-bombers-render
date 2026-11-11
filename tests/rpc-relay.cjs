#!/usr/bin/env node
/* Same-origin Solana RPC relay (owner decision 2026-11-10). Isolated: no real RPC, no wallet, no transaction, no database.
 *  A. rpc-relay/server.cjs: the page's methods only, one call, same origin, size/rate limits, upstream = the PUBLIC browser
 *     RPC with this site's Origin (never the server key), upstream errors keep the "do not pay again" text.
 *  B. server/site-server.cjs mounts POST /api/rpc (real socket: 503 unconfigured, 403 other origins, 413 large bodies).
 *  C. the game page's patched rpcFetch (built app/public/index.html): direct first; the relay when the provider is
 *     blocked, rate-limited or silent; relay-first for 10 minutes; back to direct when the relay is unavailable; a signed
 *     payment whose direct send timed out is never re-sent. */
'use strict';
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), vm = require('node:vm'), { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..'), relay = require('../rpc-relay/server.cjs');
const ORIGIN = 'https://shinobibombers.fun', PUBLIC = 'https://mainnet.example-rpc.test/?api-key=BROWSER-KEY', SERVER = 'https://server.example-rpc.test/?api-key=SERVER-ONLY-KEY';
const ENV = { RYO_SITE_ORIGIN: ORIGIN, SOLANA_PUBLIC_RPC_URL: PUBLIC, SOLANA_RPC_URL: SERVER };
const SAFE = /Pending transactions are preserved\. Refresh to retry; do not submit another payment\./;

// A request/response pair for handle(), without a socket.
function call(body, { method = 'POST', origin = ORIGIN, type = 'application/json', env = ENV, upstream, limits, ip = '203.0.113.' + Math.floor(Math.random() * 250) } = {}) {
  const { Readable } = require('node:stream');
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const req = Object.assign(Readable.from(method === 'POST' ? [Buffer.from(raw)] : []), { method, headers: { ...(origin ? { origin } : {}), ...(type ? { 'content-type': type } : {}), 'x-forwarded-for': ip }, socket: {} });
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, init }); return upstream ? upstream(url, init) : new Response(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(init.body).id, result: { value: 42 } }), { status: 200 }); };
  return new Promise(resolve => {
    const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b || ''; resolve({ status: this.status, json: (() => { try { return JSON.parse(this.body); } catch { return null; } })(), body: this.body, sent }); } };
    relay.handle(req, res, env, { fetchImpl, ...(limits ? { limits } : {}) });
  });
}
const rpc = (method, params = [], id = 1) => ({ jsonrpc: '2.0', id, method, params });

(async () => {
  /* ---------------- A. relay rules ---------------- */
  relay.reset();
  { const r = await call(rpc('getBalance', ['C41DE1mmETT4AAq3LCVZBsR8i1786i2dEUE6krabjhJX']));
    assert.equal(r.status, 200); assert.equal(r.json.result.value, 42);
    assert.equal(r.sent.length, 1); assert.equal(r.sent[0].url, PUBLIC, 'forwards to the public browser RPC, never the server key');
    assert.equal(r.sent[0].init.headers.Origin, ORIGIN, 'sent with this site\'s Origin (the provider restricts the browser key to it)');
    assert.deepEqual(JSON.parse(r.sent[0].init.body), rpc('getBalance', ['C41DE1mmETT4AAq3LCVZBsR8i1786i2dEUE6krabjhJX']), 'the call is passed on unchanged'); }
  for (const m of relay.METHODS) assert.equal((await call(rpc(m))).status, 200, 'allowed: ' + m);
  assert(relay.METHODS.includes('getFeeForMessage'), 'the gas check before every payment is allowed');
  for (const m of ['getProgramAccounts', 'getSignaturesForAddress', 'getTokenAccountsByOwner', 'getMultipleAccounts', 'requestAirdrop', 'simulateTransaction', 'getBlock', 'accountSubscribe', '']) {
    const r = await call(rpc(m)); assert.equal(r.status, 400, 'refused: ' + m); assert.equal(r.sent.length, 0, 'never forwarded: ' + m); }
  { const r = await call([rpc('getBalance'), rpc('getBalance')]); assert.equal(r.status, 400, 'batches are refused'); assert.equal(r.sent.length, 0); }
  { const r = await call('{not json'); assert.equal(r.status, 400); assert.equal(r.json.error.code, -32700); }
  { const r = await call({ jsonrpc: '1.0', id: 1, method: 'getBalance' }); assert.equal(r.status, 400); }
  { const r = await call({ jsonrpc: '2.0', id: { x: 1 }, method: 'getBalance' }); assert.equal(r.status, 400, 'odd ids are refused'); }
  { const r = await call({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: { a: 1 } }); assert.equal(r.status, 400, 'params must be a list'); }
  { const r = await call(rpc('sendTransaction', ['A'.repeat(relay.MAX_BODY)])); assert.equal(r.status, 413, 'bodies are size-limited'); assert.equal(r.sent.length, 0); }
  { const r = await call(rpc('getBalance'), { method: 'GET' }); assert.equal(r.status, 405); }
  for (const origin of [null, 'https://evil.example', 'https://www.shinobibombers.fun', 'http://shinobibombers.fun']) {
    const r = await call(rpc('getBalance'), { origin }); assert.equal(r.status, 403, 'other origins are refused: ' + origin); assert.equal(r.sent.length, 0); }
  { const r = await call(rpc('getBalance'), { type: 'text/plain' }); assert.equal(r.status, 415); }
  for (const env of [{ RYO_SITE_ORIGIN: ORIGIN, SOLANA_RPC_URL: SERVER }, { RYO_SITE_ORIGIN: ORIGIN, SOLANA_PUBLIC_RPC_URL: 'http://insecure.example/' }, { RYO_SITE_ORIGIN: ORIGIN, SOLANA_PUBLIC_RPC_URL: 'https://user:pass@x.example/' }, { SOLANA_PUBLIC_RPC_URL: PUBLIC }]) {
    const r = await call(rpc('getBalance'), { env }); assert(r.status === 503 || r.status === 403, 'unconfigured relay is closed (never falls back to the server key)'); assert.equal(r.sent.length, 0); }
  // Upstream problems: the "do not pay again" text, and never a key in the answer.
  for (const [label, upstream, status] of [['rate limited', () => new Response('busy BROWSER-KEY', { status: 429 }), 429], ['provider error', () => new Response('oops BROWSER-KEY', { status: 500 }), 502],
    ['no answer', () => { throw Object.assign(Error('aborted ' + PUBLIC), { name: 'AbortError' }); }, 504]]) {
    const r = await call(rpc('sendTransaction', ['c2lnbmVk']), { upstream }); assert.equal(r.status, status, label); assert.match(r.json.error.message, SAFE, label);
    assert(!/KEY|example-rpc/.test(r.body), 'no RPC address or key in the answer: ' + label); }
  // Rate limits: per IP (several players behind one exit still fit), and overall.
  { relay.reset(); let last; for (let i = 0; i <= relay.LIMITS.perIp; i++) last = await call(rpc('getBalance'), { ip: '198.51.100.7' }); assert.equal(last.status, 429, 'per-IP rate limit');
    assert.equal((await call(rpc('getBalance'), { ip: '198.51.100.8' })).status, 200, 'other players are unaffected'); relay.reset();
    assert(relay.LIMITS.perIp >= 300, 'room for several players paying behind one VPN exit'); }
  { relay.reset(); const limits = { windowMs: 60000, perIp: 1000, total: 5 }; let last; for (let i = 0; i <= 5; i++) last = await call(rpc('getBalance'), { limits, ip: '192.0.2.' + i });
    assert.equal(last.status, 429, 'overall ceiling across all addresses'); relay.reset(); }
  { relay.reset(); const limits = { windowMs: 60000, perIp: 3, total: 5 }; for (let i = 0; i < 20; i++) await call(rpc('getBalance'), { limits, ip: '192.0.2.99' });
    assert.equal((await call(rpc('getBalance'), { limits, ip: '192.0.2.100' })).status, 200, 'one flooding address cannot use up the overall budget'); relay.reset(); }
  { const big = 'x'.repeat(1048577); const r1 = await call(rpc('getAccountInfo'), { upstream: () => new Response(big, { status: 200 }) }); assert.equal(r1.status, 502, 'large provider answers are refused'); assert.match(r1.json.error.message, /too large/);
    const r2 = await call(rpc('getAccountInfo'), { upstream: () => new Response('{}', { status: 200, headers: { 'content-length': '5000000' } }) }); assert.equal(r2.status, 502, 'declared large answers are refused'); }
  { const { Readable } = require('node:stream'); const req = Object.assign(Readable.from(Array.from({ length: 40 }, () => Buffer.alloc(65536, 65))), { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.200' }, socket: {} });
    let timer; const status = await Promise.race([new Promise(resolve => relay.handle(req, { writeHead(s) { this.s = s; }, end() { resolve(this.s); } }, ENV, { fetchImpl: async () => { throw Error('never'); } })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('the handler never settled for a body over 1 MB')), 5000); })]).finally(() => clearTimeout(timer));
    assert.equal(status, 413, 'a body over 1 MB settles (no hanging handler)'); }
  { // A declared size over 1 MB is refused before reading; a body that trickles in is dropped after the body timeout.
    const { Readable, PassThrough } = require('node:stream'), answer = (req, opts) => new Promise(resolve => relay.handle(req, { writeHead(s) { this.s = s; }, end() { resolve(this.s); } }, ENV, { fetchImpl: async () => { throw Error('never'); }, ...opts }));
    const deadline = (p, label) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Error(label + ': the handler never answered')), 5000); })]).finally(() => clearTimeout(t)); };
    // The body never arrives: only an immediate refusal (before reading) can answer 413 here.
    const huge = Object.assign(new PassThrough(), { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'content-length': '5000000', 'x-forwarded-for': '192.0.2.201' }, socket: {} });
    assert.equal(await deadline(answer(huge, { bodyTimeoutMs: 300 }), 'declared oversize'), 413, 'a declared size over 1 MB is refused at once');
    const drip = Object.assign(new PassThrough(), { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.202' }, socket: {} }); drip.write('{"jsonrpc":');
    assert.equal(await deadline(answer(drip, { bodyTimeoutMs: 200 }), 'slow drip'), 408, 'a slow-drip body is dropped after the body timeout'); }

  /* ---------------- B. site server mounts /api/rpc (real socket) ---------------- */
  for (const configured of [false, true]) {
    const port = 20000 + Math.floor(Math.random() * 20000), origin = 'http://127.0.0.1:' + port;
    // Isolated: no database, no Control panel, no RPC (the configured case points at an address that is never reached).
    const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', RYO_SITE_ORIGIN: origin };
    for (const k of ['SOLANA_RPC_URL', 'SOLANA_PUBLIC_RPC_URL', 'PRELAUNCH_MODE', 'DATABASE_URL', 'RYO_SCOPE', 'PRIVATE_TESTING']) delete env[k];
    if (configured) env.SOLANA_PUBLIC_RPC_URL = 'https://127.0.0.1:9/';
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'site-server.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('server did not start')), 15000); child.stdout.on('data', d => { if (/Website on/.test(d)) { clearTimeout(t); res(); } }); child.on('exit', c => rej(new Error('server exited ' + c))); });
      const post = (o, body = JSON.stringify(rpc('getBalance'))) => fetch(origin + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(o ? { Origin: o } : {}) }, body }).then(async r => [r.status, await r.json()]);
      if (!configured) { const [s1, j1] = await post(origin); assert.equal(s1, 503, 'mounted; closed without the public RPC'); assert.match(j1.error.message, /not configured/); }
      const [s2] = await post('https://evil.example'); assert.equal(s2, 403, 'mounted; other origins refused');
      if (configured) { const [s3, j3] = await post(origin, JSON.stringify(rpc('sendTransaction', ['A'.repeat(40000)]))); assert.equal(s3, 413, 'a large body gets a 413 answer on a real socket'); assert.match(j3.error.message, /too large/); }
    } finally { child.kill(); }
  }

  /* ---------------- C. the game page's rpcFetch ---------------- */
  // Built from the patch source: the live (Mainnet) page patches applied to the base game page, exactly as the live build
  // does (apply-network -> liveClientText). The test server's page never gets the fallback.
  const basePage = fs.readFileSync(path.join(ROOT, 'app/public/index.html'), 'utf8');
  assert(!basePage.includes('shinobi-rpc-relay'), 'the test-server page has no relay fallback (live build only)');
  const html = require('../apply-live-economy.cjs').liveClientText(basePage);
  const start = html.indexOf("async function rpcFetch(input,options={}){const relay"), end = html.indexOf('finally{clearTimeout(timer)}', start);
  assert(start > 0 && end > start, 'the live page carries the relay fallback');
  const code = html.slice(start, end) + 'finally{clearTimeout(timer)}\n }';
  const page = (direct, viaRelay = async () => new Response('{"jsonrpc":"2.0","id":1,"result":"relay"}', { status: 200 }), store = new Map()) => {
    const calls = [], timeouts = [];
    const fetchStub = (url, init) => { calls.push(url); return url === ORIGIN + '/api/rpc' ? viaRelay(init) : direct(init); };
    const sandbox = { fetch: fetchStub, Response, AbortController, location: { origin: ORIGIN }, clearTimeout, Date, Number, String, JSON,
      setTimeout: (fn, ms) => { timeouts.push(ms); return setTimeout(fn, ms >= 8000 ? 30 : ms); },
      sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } };
    vm.createContext(sandbox); vm.runInContext(code + ';globalThis.rpcFetch=rpcFetch;', sandbox);
    const send = m => sandbox.rpcFetch('https://mainnet.helius-rpc.com/?api-key=browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rpc(m)) }).then(r => r.text());
    const route = () => calls.map(u => u.includes('/api/rpc') ? 'relay' : 'direct');
    return { send, calls, store, route, timeouts };
  };
  const ok = async () => new Response('{"jsonrpc":"2.0","id":1,"result":"direct"}', { status: 200 });
  const blocked = async () => { throw new TypeError('Failed to fetch'); };
  const silent = init => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(Error('aborted'), { name: 'AbortError' }))));
  const busy = async () => new Response('busy', { status: 429 });
  const unavailable = async () => new Response('{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"The RPC relay is not configured."}}', { status: 503 });
  { const p = page(ok); assert.match(await p.send('getBalance'), /direct/); assert.deepEqual(p.route(), ['direct'], 'reachable provider: no relay'); assert.equal(p.store.size, 0); }
  { const p = page(blocked); assert.match(await p.send('getGenesisHash'), /relay/, 'blocked provider: the relay answers');
    const until = Number(p.store.get('shinobi-rpc-relay')); assert(until > Date.now() + 9 * 60000 && until <= Date.now() + 10 * 60000, 'relay-first for 10 minutes');
    assert.match(await p.send('getFeeForMessage'), /relay/); assert.deepEqual(p.route(), ['direct', 'relay', 'relay'], 'then straight to the relay'); }
  { const p = page(ok, undefined, new Map([['shinobi-rpc-relay', String(Date.now() - 1)]])); assert.match(await p.send('getBalance'), /direct/, 'after 10 minutes the direct connection is tried again'); assert.deepEqual(p.route(), ['direct']); }
  { const p = page(silent); assert.match(await p.send('getBalance'), /relay/, 'silent provider (12 s): the relay answers'); assert(p.timeouts.includes(12000), 'direct reads wait 12 s'); assert(p.timeouts.includes(22000), 'relayed reads wait longer than the relay\'s 20 s'); }
  // Relay-first mode, payment: the relay refused it (busy) or was unreachable -> nothing was sent, so the direct connection
  // is tried; the relay timed out -> it may have been sent, so the safe stop (no direct re-send).
  { const relayFirst = () => new Map([['shinobi-rpc-relay', String(Date.now() + 60000)]]);
    { const p = page(ok, busy, relayFirst()); assert.match(await p.send('sendTransaction'), /direct/, 'relay-first payment refused by a busy relay: sent directly'); assert.deepEqual(p.route(), ['relay', 'direct']); }
    { const p = page(ok, blocked, relayFirst()); assert.match(await p.send('sendTransaction'), /direct/, 'relay-first payment, relay unreachable: sent directly'); }
    { const p = page(ok, silent, relayFirst()); await assert.rejects(p.send('sendTransaction'), /timed out.*do not submit another payment/, 'relay-first payment that timed out at the relay: never re-sent');
      assert.deepEqual(p.route(), ['relay'], 'no direct re-send of a possibly delivered payment'); } }
  { const p = page(busy); await assert.rejects(p.send('getLatestBlockhash'), /rate-limiting/, 'provider rate limit: not relayed (same public key and quota)'); assert.deepEqual(p.route(), ['direct']); }
  { const p = page(blocked); assert.match(await p.send('sendTransaction'), /relay/, 'after an immediate network failure the same signed payment goes through the relay (one signature: never charged twice)'); assert(p.timeouts.includes(25000), 'a relayed payment waits longer than the relay\'s 20 s'); }
  { const p = page(silent); await assert.rejects(p.send('sendTransaction'), /timed out/, 'a payment whose send timed out is never re-sent');
    assert.deepEqual(p.route(), ['direct'], 'no relay re-send of a possibly delivered payment'); }
  { const p = page(blocked, unavailable); await assert.rejects(p.send('getBalance'), /Failed to fetch/, 'relay unavailable: the original direct error is shown'); assert.equal(p.store.has('shinobi-rpc-relay'), false, 'and relay-first is cleared'); }
  { const p = page(ok, unavailable, new Map([['shinobi-rpc-relay', String(Date.now() + 60000)]])); assert.match(await p.send('getBalance'), /direct/, 'relay-first but relay unavailable: back to direct');
    assert.deepEqual(p.route(), ['relay', 'direct']); }
  { const p = page(blocked, silent); await assert.rejects(p.send('getBalance'), /Failed to fetch/, 'relay silent too: the original direct error'); }
  { const p = page(blocked, silent); await assert.rejects(p.send('sendTransaction'), /timed out.*do not submit another payment/, 'a relayed payment that times out keeps the do-not-pay-again text'); }
  { const notMounted = async () => new Response('<html>Not found</html>', { status: 404 }); const p = page(blocked, notMounted); await assert.rejects(p.send('getBalance'), /Failed to fetch/, 'relay not mounted: the original direct error'); assert.equal(p.store.has('shinobi-rpc-relay'), false); }
  { const p = page(ok, busy, new Map([['shinobi-rpc-relay', String(Date.now() + 60000)]])); assert.match(await p.send('getBalance'), /direct/, 'relay-first but relay rate-limited: back to direct'); }
  { const p = page(ok, silent, new Map([['shinobi-rpc-relay', String(Date.now() + 60000)]])); assert.match(await p.send('getParsedTransaction'), /direct/, 'relay-first but relay silent: back to direct'); }
  { const p = page(silent, async () => new Response('{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Solana RPC did not answer in time. Pending transactions are preserved."}}', { status: 504 })); assert.match(await p.send('getBalance'), /Pending transactions are preserved/, "the relay's own failure answer (with the safe text) is passed on"); }
  // Owner report 2026-11-11 (sign-in only worked on a VPN): a provider or network that ANSWERS with a refusal or with
  // something that is not a JSON-RPC reply counts as blocked: the relay answers, relay-first for 10 minutes.
  { const forbidden = async () => new Response('Forbidden', { status: 403 }), legal = async () => new Response('{"error":"blocked"}', { status: 451 }),
      proxy = async () => new Response('', { status: 407 }), unauthorized = async () => new Response('{"jsonrpc":"2.0","id":1,"error":{"code":-32401,"message":"Unauthorized"}}', { status: 401 }),
      blockPage = async () => new Response('<html><body>This site is blocked by your provider</body></html>', { status: 200 }), portal = async () => new Response('', { status: 200 });
    for (const [direct, label] of [[forbidden, '403'], [legal, '451'], [proxy, '407'], [unauthorized, '401'], [blockPage, 'HTML block page (200)'], [portal, 'empty 200 answer']]) {
      const p = page(direct); assert.match(await p.send('getGenesisHash'), /relay/, 'provider answering ' + label + ': the relay answers'); assert.deepEqual(p.route(), ['direct', 'relay']);
      assert(Number(p.store.get('shinobi-rpc-relay')) > Date.now() + 9 * 60000, 'relay-first after ' + label);
    }
    { const p = page(forbidden); assert.match(await p.send('sendTransaction'), /relay/, 'a refused payment goes through the relay (never processed; one signature)'); assert(p.timeouts.includes(25000)); }
    // The relay cannot help: the provider's original answer is returned unchanged (same behaviour as before this change).
    { const p = page(forbidden, unavailable); assert.equal(await p.send('getBalance'), 'Forbidden', 'relay unavailable: the original 403 answer'); assert.equal(p.store.has('shinobi-rpc-relay'), false); }
    { const p = page(blockPage, silent); assert.match(await p.send('getBalance'), /blocked by your provider/, 'relay silent: the original answer'); }
    // Real JSON-RPC answers are never relayed, including errors and server errors with a JSON body.
    for (const [status, body] of [[200, '{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Invalid params"}}'], [500, '{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal"}}'], [200, '[{"jsonrpc":"2.0","id":1,"result":1}]']]) {
      const p = page(async () => new Response(body, { status })); assert.equal(await p.send('getBalance'), body, 'a JSON-RPC answer (' + status + ') is passed on'); assert.deepEqual(p.route(), ['direct']); assert.equal(p.store.size, 0);
    }
    { const p = page(busy); await assert.rejects(p.send('getBalance'), /rate-limiting/, 'a rate limit (429) is still not relayed'); assert.deepEqual(p.route(), ['direct']); }
    // A provider gateway error page (5xx HTML) may come after the payment was forwarded: never re-sent, unchanged behaviour.
    for (const status of [502, 503, 504]) { const p = page(async () => new Response('<html>Bad Gateway</html>', { status })); assert.match(await p.send('sendTransaction'), /Bad Gateway/, status + ' HTML: passed on, not relayed'); assert.deepEqual(p.route(), ['direct']); assert.equal(p.store.size, 0); } }

  console.log('PASS: RPC relay — the page\'s methods only (incl. the gas check), one same-origin call, size/per-IP/overall limits, forwards to the public browser RPC with the site Origin (never the server key), "do not pay again" on upstream errors, mounted at /api/rpc; the page falls back to it when the provider is blocked, rate-limited or silent, relay-first for 10 minutes, back to direct when the relay is unavailable, and never re-sends a timed-out payment.');
})().catch(e => { console.error(e); process.exitCode = 1; });
