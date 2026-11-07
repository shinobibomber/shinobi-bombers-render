/* Test (Devnet) vs live (Mainnet) server: the network switch, the Mainnet build and the start-up guards.
 * Works on throw-away copies of app/; the real app/ is only read. No RPC or wallet is contacted. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), app = path.join(root, 'app');
const network = require('../network/network.cjs'), { applyNetwork, MAINNET_REMOVED } = require('../apply-network.cjs');
const { NETWORKS } = network;

function copyApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-network-'));
  fs.cpSync(app, dir, { recursive: true, filter: src => path.basename(src) !== 'node_modules' });
  fs.symlinkSync(path.join(app, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  return dir;
}
function hashes(dir) {
  const out = {};
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = path.join(rel, e.name);
      if (e.name === 'node_modules') continue;
      if (e.isDirectory()) walk(child); else out[child.split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, child))).digest('hex');
    }
  })('');
  return out;
}
const MAINNET_ENV = { SOLANA_NETWORK: 'mainnet', RYO_SITE_ORIGIN: 'https://live.example.com', SOLANA_RPC_URL: 'https://rpc.example.com/?key=server', SOLANA_PUBLIC_RPC_URL: 'https://rpc.example.com/?key=browser', RYO_SCOPE: 'solana-mainnet:live' };
const temps = [];

(async () => {
  try {
    // 1. The switch: devnet by default, unknown values never fall through to a network.
    assert.equal(network.resolve({}).key, 'devnet');
    assert.equal(network.resolve({ SOLANA_NETWORK: ' MainNet ' }).key, 'mainnet');
    assert.throws(() => network.resolve({ SOLANA_NETWORK: 'testnet' }), /devnet" or "mainnet/);
    assert.notEqual(NETWORKS.devnet.genesis, NETWORKS.mainnet.genesis);

    // 2. A Devnet build changes nothing but the network module and its stamp (the test server stays as it was).
    const devDir = copyApp(); temps.push(devDir);
    fs.rmSync(path.join(devDir, 'server/network.cjs'), { force: true }); fs.rmSync(path.join(devDir, 'server/network-build.json'), { force: true });
    const before = hashes(devDir);
    assert.equal(applyNetwork(devDir, {}).key, 'devnet');
    const after = hashes(devDir);
    assert.deepEqual(Object.keys(after).filter(f => after[f] !== before[f]).sort(), ['server/network-build.json', 'server/network.cjs']);
    assert.equal(network.built(path.join(devDir, 'server')).key, 'devnet');
    assert.deepEqual(network.startupProblems({}, path.join(devDir, 'server')), []);
    assert.match(network.startupProblems({ SOLANA_NETWORK: 'mainnet' }, path.join(devDir, 'server')).join('\n'), /built for Solana Devnet/);

    // 3. A Mainnet build needs the live origin, and leaves no Devnet genesis, RPC, cluster link or test-token wording.
    const mainDir = copyApp(); temps.push(mainDir);
    assert.throws(() => applyNetwork(mainDir, { SOLANA_NETWORK: 'mainnet' }), /RYO_SITE_ORIGIN/);
    assert.equal(applyNetwork(mainDir, MAINNET_ENV).key, 'mainnet');
    assert.equal(applyNetwork(mainDir, MAINNET_ENV).key, 'mainnet', 'the Mainnet step is repeatable');
    for (const rel of MAINNET_REMOVED) assert.equal(fs.existsSync(path.join(mainDir, rel)), false, 'removed on Mainnet: ' + rel);
    const server = f => fs.readFileSync(path.join(mainDir, 'server', f), 'utf8'), page = fs.readFileSync(path.join(mainDir, 'public/index.html'), 'utf8');
    assert.equal(require(path.join(mainDir, 'server/service.cjs')).GENESIS, NETWORKS.mainnet.genesis);
    assert.match(server('service.cjs'), /NETWORK='solana-mainnet'/);
    assert.match(server('service.cjs'), /Treasury RPC is not Solana Mainnet\./);
    assert.match(server('netlify-handler.cjs'), /new Connection\(process\.env\.SOLANA_RPC_URL,'finalized'\)/);
    assert.match(server('netlify-handler.cjs'), /const scope=process\.env\.RYO_SCOPE,/, 'Mainnet accounts live under the fixed RYO_SCOPE set at pre-launch');
    assert.match(page, /NETWORK='solana-mainnet',GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'/);
    assert.match(page, /Token setup is disabled on the live server/);
    assert.match(page, /Tester distribution is disabled on the live server/);
    assert.doesNotMatch(page, /deploy\.html|RYO-SETUP\.html/);
    assert.match(page, /devnet:"https:\/\/api\.devnet\.solana\.com"/, 'the inlined Solana SDK cluster table is untouched');
    assert.equal(require(path.join(mainDir, 'server/starter-pack.cjs')).enabled?.({ STARTER_PACK: 'on' }) ?? false, false);
    assert.match(server('starter-pack.cjs'), /const enabled = \(\) => false;/);
    assert.equal(network.built(path.join(mainDir, 'server')).key, 'mainnet');

    // 4. Start-up guards for the live server.
    const dir = path.join(mainDir, 'server'), problems = env => network.startupProblems(env, dir).join('\n');
    assert.equal(problems(MAINNET_ENV), '');
    assert.match(problems({}), /built for Solana Mainnet/);
    assert.match(problems({ ...MAINNET_ENV, STARTER_PACK: 'on' }), /STARTER_PACK must be off/);
    assert.match(problems({ ...MAINNET_ENV, SOLANA_RPC_URL: '' }), /SOLANA_RPC_URL/);
    assert.match(problems({ ...MAINNET_ENV, SOLANA_PUBLIC_RPC_URL: 'http://rpc.example.com' }), /SOLANA_PUBLIC_RPC_URL/);
    assert.match(problems({ ...MAINNET_ENV, RYO_SITE_ORIGIN: '' }), /RYO_SITE_ORIGIN/);
    assert.match(problems({ ...MAINNET_ENV, RYO_SCOPE: '' }), /RYO_SCOPE must be set on Mainnet/);
    assert.match(problems({ ...MAINNET_ENV, RYO_SCOPE: 'solana-devnet:live' }), /RYO_SCOPE must be set on Mainnet/, 'a Devnet scope is never accepted on Mainnet');
    // Pre-launch on the live server: no RPC, mint, treasury or wallets needed, and none allowed.
    const pre = { SOLANA_NETWORK: 'mainnet', PRELAUNCH_MODE: 'on', DATABASE_URL: 'postgres://db', RYO_SCOPE: 'solana-mainnet:live', RYO_SITE_ORIGIN: 'https://live.example.com' };
    assert.equal(problems(pre), '', 'pre-launch starts without RPC, treasury or mint');
    assert.match(problems({ ...pre, RYO_TREASURY_SECRET: '[1]', RYO_REVENUE_WALLET: 'x' }), /must not hold money settings \(RYO_TREASURY_SECRET, RYO_REVENUE_WALLET\)/);
    assert.match(problems({ ...pre, RYO_SITE_ORIGIN: 'http://localhost:10000' }), /RYO_SITE_ORIGIN/, 'Mainnet pre-launch needs https');
    assert.match(problems({ ...pre, RYO_SCOPE: undefined }), /RYO_SCOPE must be set/);
    // The launch gates ship in the Mainnet build and default to closed there.
    const liveGates = require(path.join(mainDir, 'server/launch-gates.cjs'));
    assert.deepEqual(Object.values(liveGates.publicGates({})), [false, false, false, false, false]);

    // render-server (also `npm run start:game-only`) refuses an unsafe environment, and publishes the browser RPC.
    const { createServer } = require(path.join(mainDir, 'server/render-server.cjs'));
    const saved = { ...process.env };
    try {
      for (const k of Object.keys(MAINNET_ENV)) delete process.env[k];
      assert.throws(() => createServer({ publicRoot: path.join(mainDir, 'public') }), /Refusing to start/);
      Object.assign(process.env, MAINNET_ENV, { RYO_TOKEN_MINT: '11111111111111111111111111111111', RYO_STUDIO_WALLET: '11111111111111111111111111111111' });
      const srv = createServer({ publicRoot: path.join(mainDir, 'public') });
      await new Promise(r => srv.listen(0, '127.0.0.1', r));
      try {
        const cfg = await (await fetch('http://127.0.0.1:' + srv.address().port + '/beta-config.json')).json();
        assert.equal(cfg.network, 'solana-mainnet');
        assert.equal(cfg.rpcUrl, MAINNET_ENV.SOLANA_PUBLIC_RPC_URL, 'the browser gets the public RPC, never the server RPC');
        assert.equal((await fetch('http://127.0.0.1:' + srv.address().port + '/deploy.html')).status, 404);
      } finally { await new Promise(r => srv.close(r)); }
    } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }

    // 5. The site host stops before listening when the environment and the build disagree.
    const stamp = network.built(path.join(app, 'server')).key, other = stamp === 'mainnet' ? 'devnet' : 'mainnet';
    const run = spawnSync(process.execPath, ['-e', "require('./server/site-server.cjs')"], { cwd: root, encoding: 'utf8', env: { ...process.env, ...MAINNET_ENV, SOLANA_NETWORK: other, PORT: '0' }, timeout: 20000 });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Refusing to start/);

    // 6. Mainnet wording for this repo's own served files (admin dashboard, website game link).
    const rules = network.mainnetRules({});
    for (const f of ['economic-dashboard/index.html', 'economic-dashboard/dashboard.js', 'website/game-link/game-link.js']) {
      const text = network.rewriteText(fs.readFileSync(path.join(root, f), 'utf8'), f, rules);
      assert.doesNotMatch(text, network.MAINNET_LEFTOVERS, f);
    }
    assert.throws(() => network.mainnetRules({ RYO_TOKEN_SYMBOL: 'bad symbol!' }), /RYO_TOKEN_SYMBOL/);
    console.log('PASS: network switch, Devnet build unchanged, Mainnet build clean, live-server start-up guards.');
  } finally {
    // Unlink the node_modules junction first so cleanup can never reach the real app/node_modules.
    for (const t of temps) { try { fs.unlinkSync(path.join(t, 'node_modules')); } catch { try { fs.rmdirSync(path.join(t, 'node_modules')); } catch {} }
      if (!fs.existsSync(path.join(t, 'node_modules'))) fs.rmSync(t, { recursive: true, force: true }); }
  }
})().catch(e => { console.error(e); process.exit(1); });
