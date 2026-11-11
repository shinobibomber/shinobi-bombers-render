'use strict';
/* Same-origin Solana RPC relay for the game page (owner decision 2026-11-10).
 *
 * The game's wallet talks to the RPC provider straight from the browser. Players whose browser cannot reach it (VPN,
 * firewall, privacy blocker, flaky network) saw "Solana Mainnet request timed out" at sign-in. The page now falls back
 * to POST /api/rpc on its own site, which forwards the same JSON-RPC call to the SAME public browser RPC the page
 * already uses (SOLANA_PUBLIC_RPC_URL, origin-restricted at the provider; sent with this site's Origin). The relay
 * therefore gives nobody more than the public page already does, and it never touches the server's own RPC key
 * (SOLANA_RPC_URL), so it cannot drain the server's RPC budget.
 *
 * Limits:
 *  - only the methods the game page uses: the wallet's reads, the gas check's getFeeForMessage, and sendTransaction of an
 *    already-signed transaction;
 *  - one JSON-RPC call per request (no batches), JSON only, body at most 16 KB;
 *  - Origin must equal RYO_SITE_ORIGIN (a browser rule; scripts can fake it, which the provider key already allows);
 *  - per-IP and overall rate limits; 20 s upstream timeout.
 * The relay never signs, never builds transactions and never changes a request. Upstream failures say that pending
 * payments are preserved, so a player never pays twice after a relay error.
 */
const METHODS = Object.freeze(['getGenesisHash', 'getBalance', 'getAccountInfo', 'getTokenAccountBalance', 'getLatestBlockhash',
  'getMinimumBalanceForRentExemption', 'getFeeForMessage', 'getTransaction', 'getSignatureStatuses', 'sendTransaction']);
const ALLOWED = new Set(METHODS);
const MAX_BODY = 16384, DRAIN_LIMIT = 1048576, TIMEOUT_MS = 20000, BODY_TIMEOUT_MS = 10000;
// Per IP: generous enough for several players behind one VPN/CGNAT exit (a payment polls about 50 times); overall: a
// ceiling for the whole site.
const LIMITS = Object.freeze({ windowMs: 60000, perIp: 300, total: 6000 });
const SAFE = ' Pending transactions are preserved. Refresh to retry; do not submit another payment.';
const MAX_ANSWER = 1048576;   // the page's calls answer in a few KB; larger provider answers are refused
const hits = new Map(); let total = { start: 0, n: 0 }, prunedAt = 0;

function clientIp(req) {
  // Render puts the client address last in X-Forwarded-For (same rule as the site's other rate limits).
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
  return fwd.length ? fwd[fwd.length - 1] : (req.socket?.remoteAddress || 'unknown');
}
// Per-IP first; only requests that pass it count toward the overall ceiling (one flooding address cannot use up the
// site-wide budget). The table is pruned at most every 10 s; while it is still full, new addresses are not tracked
// (the overall ceiling still applies) instead of refusing everyone.
function limited(req, limits = LIMITS, now = Date.now()) {
  if (hits.size > 50000 && now - prunedAt > 10000) { prunedAt = now; for (const [k, b] of hits) if (now - b.start >= limits.windowMs) hits.delete(k); }
  const ip = clientIp(req), b = hits.get(ip);
  if (b && now - b.start < limits.windowMs) { if (++b.n > limits.perIp) return true; }
  else if (b || hits.size <= 50000) hits.set(ip, { start: now, n: 1 });
  if (now - total.start >= limits.windowMs) total = { start: now, n: 0 };
  return ++total.n > limits.total;
}
function siteOrigin(env) {
  try { const u = new URL(String(env.RYO_SITE_ORIGIN || '').trim()); if (u.username || u.password) return null; if (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) return u.origin; } catch {}
  return null;
}
function upstreamUrl(env) {
  try { const u = new URL(String(env.SOLANA_PUBLIC_RPC_URL || '').trim()); if (u.protocol !== 'https:' || u.username || u.password) return null; return u.href; } catch { return null; }
}
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function reply(res, status, body) { res.writeHead(status, HEADERS); res.end(typeof body === 'string' ? body : JSON.stringify(body)); }
const rpcError = (res, status, code, message, id = null) => reply(res, status, { jsonrpc: '2.0', id, error: { code, message } });
// Reads at most MAX_BODY; a larger body is drained (up to 1 MB, then the connection is closed) so the 413 reaches the client.
// A declared size over 1 MB is refused at once; a body that has not arrived within 10 s is dropped (no slow-drip hold).
function readBody(req, bodyTimeoutMs = BODY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > DRAIN_LIMIT) { resolve({ tooLarge: true }); req.destroy(); return; }
    let size = 0, tooLarge = declared > MAX_BODY; const parts = [];
    const timer = setTimeout(() => { resolve({ slow: true }); req.destroy(); }, bodyTimeoutMs);
    const done = v => { clearTimeout(timer); resolve(v); };
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) tooLarge = true; if (!tooLarge) parts.push(chunk); else if (size > DRAIN_LIMIT) { done({ tooLarge: true }); req.destroy(); } });
    req.on('end', () => done(tooLarge ? { tooLarge: true } : { text: Buffer.concat(parts).toString('utf8') }));
    req.on('error', e => { clearTimeout(timer); reject(e); });
  });
}
// The provider's answer, read up to MAX_ANSWER bytes (null when larger: the stream is cancelled, nothing is buffered).
async function boundedText(r, ctl) {
  if (Number(r.headers.get('content-length')) > MAX_ANSWER) { ctl.abort(); return null; }
  if (!r.body?.getReader) { const t = await r.text(); return Buffer.byteLength(t) > MAX_ANSWER ? null : t; }
  const reader = r.body.getReader(), parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > MAX_ANSWER) { try { await reader.cancel(); } catch {} return null; }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts).toString('utf8');
}
const validId = id => id === undefined || id === null || (typeof id === 'string' && id.length <= 64) || Number.isSafeInteger(id);

async function handle(req, res, env = process.env, { fetchImpl = globalThis.fetch, limits = LIMITS, bodyTimeoutMs = BODY_TIMEOUT_MS } = {}) {
  if (req.method !== 'POST') return rpcError(res, 405, -32600, 'POST required.');
  const origin = siteOrigin(env);
  if (!origin || req.headers.origin !== origin) return rpcError(res, 403, -32600, 'Same-origin requests only.');
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return rpcError(res, 415, -32600, 'JSON required.');
  const upstream = upstreamUrl(env);
  if (!upstream) return rpcError(res, 503, -32603, 'The RPC relay is not configured.');
  if (limited(req, limits)) return rpcError(res, 429, -32005, 'Too many requests. Wait briefly and Refresh.' + SAFE);
  let body; try { body = await readBody(req, bodyTimeoutMs); } catch { return rpcError(res, 400, -32600, 'Invalid request.'); }
  if (body.tooLarge) return rpcError(res, 413, -32600, 'Request too large.');
  if (body.slow) return rpcError(res, 408, -32600, 'Request body timed out.');
  let call; try { call = JSON.parse(body.text); } catch { return rpcError(res, 400, -32700, 'Invalid JSON.'); }
  if (!call || typeof call !== 'object' || Array.isArray(call) || call.jsonrpc !== '2.0' || !validId(call.id)) return rpcError(res, 400, -32600, 'One JSON-RPC 2.0 call per request.');
  if (!ALLOWED.has(call.method)) return rpcError(res, 400, -32601, 'Method not available on this relay.', call.id ?? null);
  if (call.params !== undefined && !Array.isArray(call.params)) return rpcError(res, 400, -32602, 'Invalid params.', call.id ?? null);
  const forward = JSON.stringify({ jsonrpc: '2.0', id: call.id ?? null, method: call.method, params: call.params || [] });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(upstream, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: forward, signal: ctl.signal });
    // The provider's JSON-RPC answer is passed on unchanged; its HTTP failures become 429 (busy) or 502.
    if (r.status === 429) return rpcError(res, 429, -32005, 'Solana RPC is busy. Wait briefly and Refresh.' + SAFE, call.id ?? null);
    if (!r.ok) return rpcError(res, 502, -32603, 'Solana RPC is unavailable right now.' + SAFE, call.id ?? null);
    const text = await boundedText(r, ctl);
    if (text === null) return rpcError(res, 502, -32603, 'The Solana RPC answer was too large.' + SAFE, call.id ?? null);
    return reply(res, 200, text);
  } catch {
    return rpcError(res, 504, -32603, 'Solana RPC did not answer in time.' + SAFE, call.id ?? null);
  } finally { clearTimeout(timer); }
}
const reset = () => { hits.clear(); total = { start: 0, n: 0 }; prunedAt = 0; };
module.exports = { handle, METHODS, MAX_BODY, LIMITS, reset };
