'use strict';
/* Canonical host (server/site-server.cjs): with RYO_SITE_ORIGIN=https://new.example and RYO_SITE_REDIRECT_HOSTS=old.example,
 * page loads on the old host get a 301 to the same path and query on the new origin; /healthz and Founder NFT metadata/art
 * stay on every host; other methods and other hosts are never redirected; without RYO_SITE_REDIRECT_HOSTS nothing changes. */
const assert = require('node:assert/strict'), http = require('node:http'), path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function start(extra) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server/site-server.cjs'], { cwd: root, env: { ...process.env, SOLANA_NETWORK: 'devnet', PRELAUNCH_MODE: 'on',
    RYO_SCOPE: 'solana-devnet:canonical-host-test', DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none', HOST: '127.0.0.1', PORT: String(port),
    RYO_SITE_ORIGIN: 'https://new.example', RYO_SITE_REDIRECT_HOSTS: '', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  const ready = (async () => { for (let i = 0; i < 150 && !log.includes('Website on'); i++) await new Promise(r => setTimeout(r, 100)); if (!log.includes('Website on')) throw Error('site did not start:\n' + log); })();
  const req = (method, p, host, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host, ...(body ? { 'content-type': 'application/json', origin: 'https://' + host, 'x-sb-prelaunch': '1' } : {}) } }, res => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || null }));
    });
    r.on('error', reject); r.end(body);
  });
  return { child, ready, req, port };
}

(async () => {
  const passed = [];
  const a = start({ RYO_SITE_REDIRECT_HOSTS: ' OLD.example , new.example ' });   // the canonical host itself is ignored
  try {
    await a.ready;
    assert.deepEqual(await a.req('GET', '/', 'old.example'), { status: 301, location: 'https://new.example/' });
    assert.deepEqual(await a.req('GET', '/?ref=SB123&creator=x', 'old.example:443'), { status: 301, location: 'https://new.example/?ref=SB123&creator=x' }, 'path and query kept; port ignored');
    assert.deepEqual(await a.req('HEAD', '/treasury', 'old.example'), { status: 301, location: 'https://new.example/treasury' });
    assert.equal((await a.req('GET', '/healthz', 'old.example')).status, 200, 'Render health checks are not redirected');
    assert.equal((await a.req('GET', '/founders/metadata/legacy-1.json', 'old.example')).status, 200, 'NFT metadata resolves on the old host');
    assert.equal((await a.req('GET', '/founders/art/legacy.png', 'old.example')).status, 200, 'NFT art resolves on the old host');
    assert.notEqual((await a.req('POST', '/api/prelaunch', 'old.example', JSON.stringify({ action: 'status' }))).status, 301, 'API calls are never redirected');
    assert.equal((await a.req('GET', '/', 'new.example')).status !== 301, true, 'the canonical host is served');
    assert.equal((await a.req('GET', '/', 'evil.example')).status !== 301, true, 'unlisted hosts are never redirected (no open redirect)');
    passed.push('listed old host: page loads 301 to the same path and query on RYO_SITE_ORIGIN; /healthz, NFT metadata/art and API calls stay; other hosts untouched');
  } finally { a.child.kill(); }

  // After the release the portal is gone: minted Founder NFTs still find their sale terms at /founders/terms.
  const c = start({ PRELAUNCH_MODE: '' });
  try {
    await c.ready;
    const r = await new Promise((resolve, reject) => { const q = http.request({ host: '127.0.0.1', port: c.port, path: '/founders/terms', headers: { host: 'new.example' } }, res => { let t = ''; res.on('data', d => t += d); res.on('end', () => resolve({ status: res.statusCode, text: t })); }); q.on('error', reject); q.end(); });
    assert.equal(r.status, 200); assert.match(r.text, /One Founder box per wallet/); assert.doesNotMatch(r.text, /<script/i, 'read-only page, no scripts');
    passed.push('after the release /founders/terms serves the Founder sale terms (no portal needed)');
  } finally { c.child.kill(); }

  const b = start({});
  try {
    await b.ready;
    assert.notEqual((await b.req('GET', '/', 'old.example')).status, 301, 'unset: no redirect');
    passed.push('RYO_SITE_REDIRECT_HOSTS unset: no redirect (no behaviour change until configured)');
  } finally { b.child.kill(); }
  console.log('PASS: canonical host —\n  - ' + passed.join('\n  - '));
})().catch(e => { console.error(e); process.exit(1); });
