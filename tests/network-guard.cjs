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
    const betaEconomy=require(path.join(devDir,'server/sr-revenue.cjs'));
    assert.equal(betaEconomy.enabled(),false);assert.equal(betaEconomy.publicPolicy().mode,'beta-legacy');
    assert.equal(require(path.join(devDir,'server/economy.cjs')).quote({heroes:[]},'summon',{quantity:1}).revenueDistribution,undefined);
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
    const liveEconomy=require(path.join(mainDir,'server/sr-revenue.cjs'));
    assert.equal(liveEconomy.enabled(),true);assert.equal(liveEconomy.publicPolicy().mode,'live-sr');
    const liveQuote=require(path.join(mainDir,'server/economy.cjs')).quote({heroes:[]},'summon',{quantity:1});
    assert.deepEqual([liveQuote.treasury,liveQuote.operations,liveQuote.community,liveQuote.reserve,liveQuote.burn,liveQuote.studioFee],[12500,7500,2500,2500,0,0]);
    assert.match(page,/Active Adventure Rewards/);assert.doesNotMatch(fs.readFileSync(path.join(devDir,'public/index.html'),'utf8'),/Active Adventure Rewards/);
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
    // Treasury locks: routing is refused in pre-launch, needs the committed activation, and RYO_TOKEN_MINT must match the reviewed registry.
    assert.match(problems({ ...pre, SR_REVENUE_ROUTING_ENABLED: 'on' }), /SR_REVENUE_ROUTING_ENABLED must be off while PRELAUNCH_MODE is on/);
    assert.match(problems({ ...MAINNET_ENV, SR_REVENUE_ROUTING_ENABLED: 'on' }), /activation approval/);
    assert.match(problems({ ...MAINNET_ENV, RYO_TOKEN_MINT: '11111111111111111111111111111111' }), /SR mint is still pending in the reviewed treasury registry/);
    assert.match(network.startupProblems({ SR_REVENUE_ROUTING_ENABLED: 'on' }, path.join(devDir, 'server')).join('\n'), /applies only to the live Mainnet server/);
    { const bad = path.join(mainDir, 'server/treasury-registry.json'), original = fs.readFileSync(bad, 'utf8'), broken = JSON.parse(original); broken.destinations[1].address = broken.destinations[2].address;
      fs.writeFileSync(bad, JSON.stringify(broken)); const fresh = spawnSync(process.execPath, ['-e', 'const n=require(process.argv[1]);process.stdout.write(n.startupProblems(JSON.parse(process.argv[2]),process.argv[3]).join("\\n"))', path.join(mainDir, 'server/network.cjs'), JSON.stringify(pre), path.join(mainDir, 'server')], { encoding: 'utf8' });
      assert.match(fresh.stdout, /Treasury registry: destination addresses must be distinct/, 'a broken registry stops the live server'); fs.writeFileSync(bad, original); }
    // The launch gates ship in the Mainnet build and default to closed there.
    const liveGates = require(path.join(mainDir, 'server/launch-gates.cjs'));
    assert.deepEqual(Object.values(liveGates.publicGates({})), [false, false, false, false, false]);
    // The real Mainnet pre-launch host publishes policy without mounting or contacting money services.
    const verifyLive=`(async()=>{const assert=require('node:assert/strict'),{server,prelaunch}=require('./server/site-server.cjs');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;try{const policy=await(await fetch(base+'/economy-policy.json')).json();assert.equal(policy.mode,'live-sr');assert.equal(policy.network,'mainnet');assert.equal(policy.prelaunch,true);assert.equal(policy.monetaryEndpointsMounted,false);assert.deepEqual(policy.ratesBps,{lockedTreasury:5000,activeRewards:3000,communityRewards:1000,economicReserve:1000});assert.equal((await fetch(base+'/api/ryo',{method:'POST',body:'{}'})).status,403);assert.equal((await fetch(base+'/admin/')).status,404);const page=await fetch(base+'/treasury');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await page.text(),/Every SR wallet/);for(const a of ['/treasury/treasury.js','/treasury/treasury.css'])assert.equal((await fetch(base+a)).status,200);assert.equal((await fetch(base+'/treasury/../server/site-server.cjs')).status,404);assert.equal((await fetch(base+'/treasury',{method:'POST'})).status,405);const reg=await(await fetch(base+'/treasury-registry.json')).json();assert.equal(reg.readOnly,true);assert.equal(reg.prelaunch,true);assert.equal(reg.registry.destinations[0].address,'5wVBdFkQFLtu8qhZ1pg6RoD1LjWGUYL1erBVGBu11aGn');assert.equal(reg.registry.srMint.address,null);assert.equal(reg.verification.status,'unverified','unreachable RPC is unverified, never zero');assert.equal(reg.claimFunding.status,'not-configured');assert.equal(reg.claimFunding.availableRyo,null);assert.equal(reg.paymentsEnabled,false,'pre-launch: Mainnet payments disabled');let last=200;for(let i=0;i<60;i++)last=(await fetch(base+'/treasury-registry.json')).status;assert.equal(last,429,'public JSON is rate limited per client');assert.equal((await fetch(base+'/treasury')).status,200,'the page itself stays available');const panel=await fetch(base+'/');assert.equal(panel.status,200);}finally{await new Promise(r=>server.close(r));await prelaunch.close();}})().catch(e=>{console.error(e);process.exitCode=1});`;
    const verifySecureHeaders=verifyLive.replace("const policy=await", "const landing=await fetch(base+'/');assert.equal(landing.headers.get('strict-transport-security'),'max-age=31536000');assert.equal(landing.headers.get('x-frame-options'),'DENY');assert(landing.headers.get('content-security-policy').includes(\"script-src 'self'\"));const policy=await");
    const liveRun=spawnSync(process.execPath,['-e',verifySecureHeaders],{cwd:root,encoding:'utf8',timeout:20000,env:{...process.env,...pre,GAME_RUNTIME_DIR:mainDir,STARTER_PACK:'off',RYO_TREASURY_SECRET:'',RYO_TOKEN_MINT:'',RYO_STUDIO_WALLET:'',RYO_REVENUE_WALLET:'',SR_REVENUE_ROUTING_ENABLED:'',SOLANA_RPC_URL:'https://127.0.0.1:9/'}});
    assert.equal(liveRun.status,0,liveRun.stderr);

    // render-server (also `npm run start:game-only`) refuses an unsafe environment, and publishes the browser RPC.
    const { createServer } = require(path.join(mainDir, 'server/render-server.cjs'));
    const saved = { ...process.env };
    try {
      for (const k of Object.keys(MAINNET_ENV)) delete process.env[k];
      assert.throws(() => createServer({ publicRoot: path.join(mainDir, 'public') }), /Refusing to start/);
      Object.assign(process.env, MAINNET_ENV, { RYO_TOKEN_MINT: '11111111111111111111111111111111', RYO_STUDIO_WALLET: '11111111111111111111111111111111' }); assert.throws(() => createServer({ publicRoot: path.join(mainDir, 'public') }), /SR mint is still pending/, 'an unregistered mint cannot launch'); { const file = path.join(mainDir, 'server/treasury-registry.json'), r = JSON.parse(fs.readFileSync(file, 'utf8')); r.srMintAddress = '11111111111111111111111111111111'; fs.writeFileSync(file, JSON.stringify(r)); require(path.join(mainDir, 'server/treasury-registry.cjs')).useForIsolatedTest(r); }
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
