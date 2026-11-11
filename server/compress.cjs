'use strict';
/* HTTP response compression for the public site and the game's static files (performance work, 2026-11-11).
 *
 * Before this, nothing was compressed: the game page is a 4 MB HTML file (mostly base64 art and an inlined SDK) plus about 1.3 MB
 * of JavaScript and CSS, sent as-is on every first visit. This wraps the response of a GET request only when the client sent
 * Accept-Encoding with br or gzip, and only for a 200 response of a text type that is at least 1 KB. Everything else (POST and
 * the API, HEAD, 304, errors, images, already-compressed or tiny bodies, no Accept-Encoding) passes through untouched.
 *
 * - The body is buffered (a static file or a small page), compressed ONCE per distinct content (cache key = encoding + SHA-256
 *   of the body) with the asynchronous zlib API (a worker thread, the event loop is never blocked), and the cached bytes are
 *   reused for every later request. The cache is bounded and evicts the oldest entries first.
 * - The response keeps its own ETag / Last-Modified / Cache-Control, so If-None-Match revalidation (304) works exactly as before;
 *   `Vary: Accept-Encoding` is added and Content-Length is set from the compressed bytes.
 * - Private account or financial API answers are POST responses and are never touched. */
const zlib = require('node:zlib'), crypto = require('node:crypto');
const TEXT = /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg\+xml)/i;
const MIN_BYTES = 1024, MAX_BODY = 32 * 1024 * 1024, MAX_CACHE = 64 * 1024 * 1024;
const cache = new Map(); let cacheBytes = 0;

function choose(header) {
  const h = String(header || '').toLowerCase();
  const q = name => { const m = new RegExp('(?:^|[,\\s])' + name + '(?:\\s*;\\s*q=([0-9.]+))?(?:\\s*,|$)').exec(h); return m ? (m[1] === undefined ? 1 : Number(m[1])) : 0; };
  if (q('br') > 0) return 'br';
  if (q('gzip') > 0 || q('x-gzip') > 0) return 'gzip';
  return null;
}
function compress(encoding, body) {
  return new Promise((resolve, reject) => {
    if (encoding === 'br') zlib.brotliCompress(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }, (e, out) => e ? reject(e) : resolve(out));
    else zlib.gzip(body, { level: 6 }, (e, out) => e ? reject(e) : resolve(out));
  });
}
function remember(key, bytes) {
  cache.set(key, bytes); cacheBytes += bytes.length;
  while (cacheBytes > MAX_CACHE && cache.size > 1) { const [oldest, value] = cache.entries().next().value; cache.delete(oldest); cacheBytes -= value.length; }
}

/** Wraps `res` in place (no-op when the request does not qualify) and returns it. */
function compressible(req, res) {
  if (req.method !== 'GET') return res;
  const encoding = choose(req.headers['accept-encoding']); if (!encoding) return res;
  const original = { writeHead: res.writeHead, write: res.write, end: res.end };
  let held = null, chunks = [], size = 0, done = false;
  const restore = () => { res.writeHead = original.writeHead; res.write = original.write; res.end = original.end; };
  res.writeHead = function (code, reason, headers) {
    const h = typeof reason === 'object' && reason !== null ? reason : headers;
    const type = h && (h['Content-Type'] || h['content-type']);
    if (code === 200 && type && TEXT.test(String(type)) && !res.getHeader('Content-Encoding') && !(h && (h['Content-Encoding'] || h['content-encoding']))) { held = { code, headers: { ...(h || {}) } }; return res; }
    restore(); return original.writeHead.apply(res, arguments);
  };
  const collect = chunk => { if (chunk == null || chunk === '') return true; const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += b.length; if (size > MAX_BODY) return false; chunks.push(b); return true; };
  const passThrough = () => { restore(); original.writeHead.call(res, held.code, held.headers); for (const c of chunks) original.write.call(res, c); chunks = []; };
  res.write = function (chunk, enc, cb) {
    if (!held) { restore(); return original.write.apply(res, arguments); }
    if (!collect(chunk)) { passThrough(); return original.write.call(res, chunk, enc, cb); }
    if (typeof enc === 'function') enc(); else if (typeof cb === 'function') cb();
    return true;
  };
  res.end = function (chunk, enc, cb) {
    if (!held) { restore(); return original.end.apply(res, arguments); }
    if (done) return res; done = true;
    if (typeof chunk === 'function') { cb = chunk; chunk = null; } else if (typeof enc === 'function') { cb = enc; }
    if (!collect(chunk)) { passThrough(); return original.end.call(res, chunk, null, cb); }
    const body = Buffer.concat(chunks); chunks = [];
    const send = (payload, encoded) => {
      if (res.destroyed || res.writableEnded) return;
      restore();
      const headers = { ...held.headers, 'Content-Length': payload.length };
      if (encoded) { headers['Content-Encoding'] = encoded; headers.Vary = [headers.Vary, 'Accept-Encoding'].filter(Boolean).join(', '); }
      else if (headers.Vary === undefined && body.length >= MIN_BYTES) headers.Vary = 'Accept-Encoding';
      original.writeHead.call(res, held.code, headers); original.end.call(res, payload, null, cb);
    };
    if (body.length < MIN_BYTES) { send(body, null); return res; }
    const key = encoding + ':' + body.length + ':' + crypto.createHash('sha256').update(body).digest('base64');
    const hit = cache.get(key);
    if (hit) { send(hit, encoding); return res; }
    compress(encoding, body).then(out => { if (out.length >= body.length) return send(body, null); remember(key, out); send(out, encoding); }, () => send(body, null));
    return res;
  };
  return res;
}
module.exports = { compressible, choose, cacheStats: () => ({ entries: cache.size, bytes: cacheBytes }) };
