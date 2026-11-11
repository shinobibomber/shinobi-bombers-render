/* Response compression (server/compress.cjs). Unit part: a mock server that answers like the game's static handler
 * (writeHead(200, {...}) then a piped stream, 304 on a matching ETag, JSON error bodies, images). Integration part: the real
 * site server serving the built game and website. Proves: br/gzip only for qualifying GET text responses; the decompressed bytes
 * equal the original file; ETag revalidation (304) still works; images, HEAD, POST, tiny bodies, no Accept-Encoding and
 * unknown encodings pass through untouched; the compressed bytes are cached per content; the 4 MB game page shrinks a lot. */
const assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto'), { spawn } = require('node:child_process');
const { compressible, choose, cacheStats } = require('../server/compress.cjs');
const ROOT = path.resolve(__dirname, '..');

const raw = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const u = new URL(url), req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); });
  req.on('error', reject); if (body) req.write(body); req.end();
});
const unpack = r => r.headers['content-encoding'] === 'br' ? zlib.brotliDecompressSync(r.body) : r.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(r.body) : r.body;

(async () => {
  assert.equal(choose('gzip, deflate, br'), 'br'); assert.equal(choose('gzip'), 'gzip'); assert.equal(choose('br;q=0, gzip'), 'gzip'); assert.equal(choose('identity'), null); assert.equal(choose(''), null); assert.equal(choose(undefined), null);
  assert.equal(choose('deflate'), null, 'unknown encodings are not compressed'); assert.equal(choose('gzip;q=0'), null);

  // ---- unit: a mock static handler like render-server.cjs
  const big = Buffer.from('<html>' + 'Shinobi Bombers '.repeat(40000) + '</html>'), small = Buffer.from('tiny'), image = crypto.randomBytes(5000);
  const etag = '"' + crypto.createHash('sha256').update(big).digest('hex') + '"';
  let streamed = 0;
  const server = http.createServer((req, res) => {
    compressible(req, res);
    const name = new URL(req.url, 'http://x').pathname;
    if (name === '/big.html') { if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag }); if (req.method === 'HEAD') return res.end(); streamed++; const { Readable } = require('node:stream'); return Readable.from([big.subarray(0, 1000), big.subarray(1000)]).pipe(res); }
    if (name === '/small.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(small); }
    if (name === '/image.webp') { res.writeHead(200, { 'Content-Type': 'image/webp' }); return res.end(image); }
    if (name === '/api') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ private: 'x'.repeat(5000) })); }
    if (name === '/preencoded') { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); return res.end(zlib.gzipSync(big)); }
    if (name === '/end-body') { res.writeHead(200, { 'Content-Type': 'text/css' }); res.write('a{}'.repeat(2000)); return res.end('b{}'); }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('missing');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  try {
    let r = await raw(base + '/big.html', { headers: { 'Accept-Encoding': 'gzip, br' } });
    assert.equal(r.status, 200); assert.equal(r.headers['content-encoding'], 'br'); assert.match(r.headers.vary, /Accept-Encoding/); assert.equal(r.headers.etag, etag, 'ETag unchanged'); assert.equal(r.headers['cache-control'], 'no-cache');
    assert.equal(Number(r.headers['content-length']), r.body.length); assert(r.body.length < big.length / 20, 'brotli shrinks the page (' + r.body.length + ' of ' + big.length + ')');
    assert(unpack(r).equals(big), 'decompressed body equals the original bytes');
    r = await raw(base + '/big.html', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.headers['content-encoding'], 'gzip'); assert(unpack(r).equals(big));
    const before = cacheStats(); await raw(base + '/big.html', { headers: { 'Accept-Encoding': 'gzip' } }); assert.deepEqual(cacheStats(), before, 'the second request reuses the cached compressed bytes');
    r = await raw(base + '/big.html', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': etag } });
    assert.equal(r.status, 304, 'revalidation still answers 304'); assert.equal(r.body.length, 0);
    r = await raw(base + '/big.html'); assert.equal(r.headers['content-encoding'], undefined, 'no Accept-Encoding: identity'); assert(r.body.equals(big));
    r = await raw(base + '/big.html', { method: 'HEAD', headers: { 'Accept-Encoding': 'br' } }); assert.equal(r.status, 200); assert.equal(r.headers['content-encoding'], undefined, 'HEAD is untouched');
    r = await raw(base + '/small.txt', { headers: { 'Accept-Encoding': 'br' } }); assert.equal(r.headers['content-encoding'], undefined, 'tiny bodies are not compressed'); assert(r.body.equals(small));
    r = await raw(base + '/image.webp', { headers: { 'Accept-Encoding': 'br' } }); assert.equal(r.headers['content-encoding'], undefined, 'images are never compressed'); assert(r.body.equals(image));
    r = await raw(base + '/api', { method: 'POST', headers: { 'Accept-Encoding': 'br' }, body: '{}' }); assert.equal(r.headers['content-encoding'], undefined, 'POST (the account and money API) is never touched');
    r = await raw(base + '/preencoded', { headers: { 'Accept-Encoding': 'br' } }); assert.equal(r.headers['content-encoding'], 'gzip', 'an already-encoded body is not encoded twice'); assert(zlib.gunzipSync(r.body).equals(big));
    r = await raw(base + '/end-body', { headers: { 'Accept-Encoding': 'gzip' } }); assert.equal(r.headers['content-encoding'], 'gzip'); assert.equal(unpack(r).toString(), 'a{}'.repeat(2000) + 'b{}', 'write() + end(chunk) bodies are joined correctly');
    r = await raw(base + '/nope', { headers: { 'Accept-Encoding': 'br' } }); assert.equal(r.status, 404); assert.equal(r.body.toString(), 'missing');
    const tinyHead = await raw(base + '/big.html', { headers: { 'Accept-Encoding': 'br;q=0, identity' } }); assert.equal(tinyHead.headers['content-encoding'], undefined, 'br;q=0 is respected');
  } finally { server.close(); }

  // ---- integration: the real site server with the built game and website
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'site-server.cjs')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RYO_SITE_ORIGIN: 'http://127.0.0.1:' + port }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('server did not start')), 15000); child.stdout.on('data', d => { if (/Website on/.test(d)) { clearTimeout(t); res(); } }); child.on('exit', c => rej(new Error('server exited ' + c))); });
    const url = 'http://127.0.0.1:' + port, gameHtml = fs.readFileSync(path.join(ROOT, 'app/public/index.html'));
    const plain = await raw(url + '/play/', { headers: {} }), packed = await raw(url + '/play/', { headers: { 'Accept-Encoding': 'br, gzip' } });
    assert.equal(plain.status, 200); assert.equal(packed.status, 200); assert.equal(packed.headers['content-encoding'], 'br');
    assert(plain.body.equals(gameHtml) && unpack(packed).equals(gameHtml), 'the game page decompresses to the exact built file');
    console.log('game page: ' + (gameHtml.length / 1048576).toFixed(2) + ' MB -> ' + (packed.body.length / 1048576).toFixed(2) + ' MB with brotli (' + Math.round(100 * packed.body.length / gameHtml.length) + '%)');
    assert(packed.body.length < gameHtml.length * 0.8, 'the game page is smaller compressed');
    assert.equal(packed.headers.etag, plain.headers.etag, 'the same ETag is served compressed and plain');
    const again = await raw(url + '/play/', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': plain.headers.etag } }); assert.equal(again.status, 304, 'conditional requests still return 304');
    const js = await raw(url + '/play/assets/combat-rules/client.js', { headers: { 'Accept-Encoding': 'gzip' } }); assert.equal(js.headers['content-encoding'], 'gzip'); assert(unpack(js).equals(fs.readFileSync(path.join(ROOT, 'app/public/assets/combat-rules/client.js'))));
    const img = await raw(url + '/play/assets/login-reference.webp', { headers: { 'Accept-Encoding': 'br' } }); assert.equal(img.headers['content-encoding'], undefined, 'WebP images are untouched');
    const wp = await raw(url + '/whitepaper', { headers: { 'Accept-Encoding': 'br' } }); assert.equal(wp.headers['content-encoding'], 'br'); assert(unpack(wp).equals(fs.readFileSync(path.join(ROOT, 'website/whitepaper.html'))), 'the whitepaper decompresses to the exact file');
    const health = await raw(url + '/healthz', { headers: { 'Accept-Encoding': 'br' } }); assert.equal(health.status, 200); assert.equal(health.headers['content-encoding'], undefined, 'tiny health JSON is untouched');
    const api = await raw(url + '/api/ryo', { method: 'POST', headers: { 'Accept-Encoding': 'br', 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ action: 'config' }) }); assert.equal(api.headers['content-encoding'], undefined, 'the game API is never compressed');
  } finally { child.kill(); }
  console.log('PASS: response compression — br/gzip for qualifying GET text only, exact bytes, ETag/304 intact, cached per content, images/HEAD/POST/tiny/pre-encoded untouched, real site server verified.');
})().catch(e => { console.error(e); process.exit(1); });
