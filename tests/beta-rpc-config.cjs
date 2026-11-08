/* Test server: SOLANA_DEVNET_PUBLIC_RPC_URL replaces only the browser RPC in /beta-config.json (Solana's free public
 * RPC refuses some networks with 403). Unset or invalid = the game's own answer, byte for byte. Mainnet ignores it.
 * Runs the real site host on the assembled app/; no RPC is contacted. */
'use strict';
const assert = require('node:assert/strict'), path = require('node:path'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const MINT = '6csgLSMHgvjdvSZP8iY9MSToDwhHQBnd7Qq6eY2GHyis', STUDIO = '8mBBozANuuSCooySDxsqVpkJ3H9mNy361NyUMqFeEFcZ';

async function host(extra) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, SOLANA_NETWORK: 'devnet', PORT: String(port), HOST: '127.0.0.1', RYO_SITE_ORIGIN: 'http://localhost:' + port, RYO_TOKEN_MINT: MINT, RYO_STUDIO_WALLET: STUDIO, ...extra };
  for (const k of ['PRELAUNCH_MODE', 'RELEASE_STAGE', 'SOLANA_DEVNET_PUBLIC_RPC_URL', 'GAME_RUNTIME_DIR']) if (!(k in extra)) delete env[k];
  const child = spawn(process.execPath, ['server/site-server.cjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  for (let i = 0; i < 100 && !log.includes('Website on'); i++) await new Promise(r => setTimeout(r, 100));
  assert.match(log, /Website on/, log);
  const get = (p, init) => fetch('http://127.0.0.1:' + port + p, init);
  return { get, log: () => log, stop: () => child.kill() };
}

(async () => {
  const base = await host({});
  let original;
  try {
    const r = await base.get('/beta-config.json'); original = { status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() };
    assert.equal(original.status, 200); assert.equal(JSON.parse(original.body).rpcUrl, 'https://api.devnet.solana.com/');
  } finally { base.stop(); }

  const PROVIDER = 'https://devnet.example-rpc.com/?api-key=domain-restricted';
  const custom = await host({ SOLANA_DEVNET_PUBLIC_RPC_URL: PROVIDER });
  try {
    const r = await custom.get('/beta-config.json'), body = JSON.parse(await r.text());
    assert.equal(r.status, 200);
    assert.deepEqual(body, { ...JSON.parse(original.body), rpcUrl: new URL(PROVIDER).href }, 'only rpcUrl differs');
    for (const h of ['content-type', 'cache-control', 'x-content-type-options', 'referrer-policy']) assert.equal(r.headers.get(h), original.headers[h], h);
    assert.equal((await custom.get('/beta-config.json', { method: 'POST' })).status, 405);
    assert.equal((await custom.get('/beta-config.json', { method: 'HEAD' })).status, 200);
  } finally { custom.stop(); }

  const missing = await host({ SOLANA_DEVNET_PUBLIC_RPC_URL: PROVIDER, RYO_TOKEN_MINT: '' });
  try { const r = await missing.get('/beta-config.json'); assert.equal(r.status, 503); assert.match(await r.text(), /not ready/); } finally { missing.stop(); }

  for (const bad of ['http://insecure.example.com', 'not a url', 'https://user:pass@rpc.example.com']) {
    const h = await host({ SOLANA_DEVNET_PUBLIC_RPC_URL: bad });
    try {
      const r = await h.get('/beta-config.json');
      assert.equal(await r.text(), original.body, 'invalid value falls back to the game answer: ' + bad);
      assert.match(h.log(), /Ignoring SOLANA_DEVNET_PUBLIC_RPC_URL/);
    } finally { h.stop(); }
  }
  console.log('PASS: test-server browser RPC override — only rpcUrl changes, same headers/405/503 as the game, unset or invalid values serve the game answer unchanged.');
})().catch(e => { console.error(e); process.exit(1); });
