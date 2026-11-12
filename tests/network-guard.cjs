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
const MAINNET_ENV = { SOLANA_NETWORK: 'mainnet', RELEASE_STAGE: 'public', RYO_SITE_ORIGIN: 'https://live.example.com', SOLANA_RPC_URL: 'https://rpc.example.com/?key=server', SOLANA_PUBLIC_RPC_URL: 'https://rpc.example.com/?key=browser', RYO_SCOPE: 'solana-mainnet:live' };
const TESTER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
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
    assert.equal(problems(MAINNET_ENV), '', 'a manual public release keeps its existing rules (RPC-only before the token)');
    // Automatic release (2026-11-09): the released mint (= reviewed registry srMintAddress) opens the game by itself.
    {
      const regMod = require(path.join(dir, 'treasury-registry.cjs')), raw = JSON.parse(fs.readFileSync(regMod.FILE, 'utf8'));
      // The committed registry has the released mint (2026-11-09): these rules are checked from the pre-mint state.
      assert.equal(regMod.registry().srMintAddress, '8Azsv23uZnZdmeyA6Vg6BagkT1SHEdiK4QqV3vycpump', 'the build carries the registered mint');
      raw.srMintAddress = null; delete raw.srMintProgram; raw.activation = { approved: false, reference: null }; regMod.useForIsolatedTest(raw);
      const MINT = require(path.join(app, 'node_modules/@solana/web3.js')).Keypair.generate().publicKey.toBase58();
      const pre = { ...MAINNET_ENV, PRELAUNCH_MODE: 'on', RELEASE_STAGE: 'portal' };
      assert.equal(network.launched(pre, dir), false, 'no mint registered: still pre-launch');
      regMod.useForIsolatedTest({ ...raw, srMintAddress: MINT });
      try {
        assert.equal(network.registryMint(dir), MINT);
        assert.equal(network.launched({ ...pre, RYO_TOKEN_MINT: TESTER }, dir), false, 'a mint that is not the registered one never launches');
        assert.equal(network.launched({ ...pre, RYO_TOKEN_MINT: MINT }, dir), true, 'the registered mint launches');
        assert.equal(network.launched({ ...pre, RYO_TOKEN_MINT: MINT, GAME_LAUNCH_HOLD: 'on' }, dir), false, 'GAME_LAUNCH_HOLD keeps pre-launch');
        assert.equal(network.launched({ ...pre, SOLANA_NETWORK: 'devnet', RYO_TOKEN_MINT: MINT }, dir), false, 'the test server never auto-launches');
        const auto = { ...pre, RYO_TOKEN_MINT: MINT, RYO_TREASURY_SECRET: '[1]' };
        assert.equal(problems(auto), '', 'PRELAUNCH_MODE=on and RELEASE_STAGE=portal are ignored once the mint is released');
        assert.match(problems({ ...auto, RYO_TREASURY_SECRET: '' }), /needs RYO_TREASURY_SECRET/, 'released without custody refuses to start');
        assert.equal(problems({ ...auto, RELEASE_STAGE: 'private', PRELAUNCH_MODE: '' }), '', 'a valid RELEASE_STAGE is overridden by the release');
        assert.match(problems({ ...auto, RELEASE_STAGE: 'privte' }), /RELEASE_STAGE/, 'a typo still fails closed after release');
        for (const v of ['enabled', 'hold', 'y', 'on.']) assert.equal(network.launched({ ...pre, RYO_TOKEN_MINT: MINT, GAME_LAUNCH_HOLD: v }, dir), false, 'GAME_LAUNCH_HOLD fails closed: ' + v);
        for (const v of ['off', 'false', '0', 'no', '']) assert.equal(network.launched({ ...pre, RYO_TOKEN_MINT: MINT, GAME_LAUNCH_HOLD: v }, dir), true, 'GAME_LAUNCH_HOLD released by ' + JSON.stringify(v));
        assert.match(problems({ ...auto, GAME_LAUNCH_HOLD: 'on', RELEASE_STAGE: 'private', RYO_PRIVATE_TEST_WALLETS: TESTER, DATABASE_URL: 'postgres://x' }), /^$/, 'hold → private live testing with the full money settings');
        assert.equal(problems({ ...auto, GAME_LAUNCH_HOLD: 'on', DATABASE_URL: 'postgres://x' }), '', 'rollback: a held release keeps its settings while the portal serves');
        assert.match(problems({ ...pre, RYO_TOKEN_MINT: TESTER, RYO_TREASURY_SECRET: '[1]', GAME_LAUNCH_HOLD: 'on', DATABASE_URL: 'postgres://x' }), /must not hold money settings/, 'a hold never excuses an unregistered mint');
      } finally { regMod.useForIsolatedTest(raw); }
      assert.equal(network.launched({ ...pre, RYO_TOKEN_MINT: MINT }, dir), false, 'registry restored');
    }
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
    // Release stages: deployment never opens the game; only an explicit stage setting does (fail closed).
    assert.match(problems({ ...MAINNET_ENV, RELEASE_STAGE: undefined }), /set RELEASE_STAGE=public explicitly/, 'removing PRELAUNCH_MODE alone never opens the Mainnet game');
    assert.match(problems({ ...MAINNET_ENV, RELEASE_STAGE: 'private' }), /needs PRELAUNCH_MODE=on/);
    assert.match(problems({ ...MAINNET_ENV, RELEASE_STAGE: 'investor' }), /needs PRELAUNCH_MODE=on/);
    assert.equal(network.releaseStage(pre), 'portal', 'pre-launch defaults to the portal-only stage');
    for (const bad of ['public', 'investor', 'open', 'PUBLIC ']) assert.match(problems({ ...pre, RELEASE_STAGE: bad }), /RELEASE_STAGE must be "portal" \(default\) or "private"/, bad);
    assert.equal(problems({ ...pre, RELEASE_STAGE: 'portal' }), '');
    const priv = { ...pre, RELEASE_STAGE: 'private', RYO_PRIVATE_TEST_WALLETS: TESTER, SOLANA_RPC_URL: MAINNET_ENV.SOLANA_RPC_URL, SOLANA_PUBLIC_RPC_URL: MAINNET_ENV.SOLANA_PUBLIC_RPC_URL };
    assert.equal(problems(priv), '', 'private live testing starts with testers and the Mainnet RPCs');
    // Founder receipts are independent of unlaunched game custody/token configuration.
    const REGISTRY_JSON = require(path.join(root, 'treasury/treasury-registry.json'));
    const REGISTRY_ADDRESS = REGISTRY_JSON.destinations.find(d => d.role === 'lockedTreasury').address, CUSTODY_ADDRESS = REGISTRY_JSON.gameCustody.address;
    // Public game: Founder/Sensei SOL and game revenue must use different wallets (owner decision 2026-11-09).
    assert.match(problems({ ...MAINNET_ENV, FOUNDERS_REVENUE_WALLET: TESTER, RYO_REVENUE_WALLET: TESTER }), /must differ from the game revenue wallet RYO_REVENUE_WALLET once the game is public/);
    const founderAuthority = JSON.stringify([...require(path.join(app, 'node_modules/@solana/web3.js')).Keypair.generate().secretKey]);
    for (const stageEnv of [pre, priv]) {
      const founder = { ...stageEnv, RYO_REVENUE_WALLET: TESTER, FOUNDERS_REVENUE_WALLET: TESTER, FOUNDERS_MINT_AUTHORITY_SECRET: founderAuthority };
      for (const sale of ['on', 'off']) assert.equal(problems({ ...founder, FOUNDERS_PUBLIC_SALE_ENABLED: sale }), '', 'Founder receipts and paused sale can start without game custody');
      assert.notEqual(problems({ ...founder, FOUNDERS_MINT_AUTHORITY_SECRET: '' }), '', 'a public revenue destination alone does not bypass the money guard');
      assert.notEqual(problems({ ...founder, RYO_REVENUE_WALLET: 'invalid' }), '', 'invalid Founder revenue destination refused');
      for (const key of ['RYO_TREASURY_SECRET', 'RYO_TOKEN_MINT', 'RYO_STUDIO_WALLET'])
        assert.notEqual(problems({ ...founder, [key]: TESTER }), '', key + ' still requires complete game money configuration');
      assert.match(problems({ ...founder, SR_REVENUE_ROUTING_ENABLED: 'on' }), /SR_REVENUE_ROUTING_ENABLED must be off/);
      assert.match(problems({ ...founder, RELEASE_STAGE: 'public' }), /RELEASE_STAGE must be/);
      // Founder/Sensei SOL has its own receipt wallet (FOUNDERS_REVENUE_WALLET), separate from the game's RYO_REVENUE_WALLET.
      const own = { ...stageEnv, FOUNDERS_REVENUE_WALLET: TESTER, FOUNDERS_MINT_AUTHORITY_SECRET: founderAuthority };
      for (const k of ['FOUNDERS_PUBLIC_SALE_ENABLED', 'FOUNDERS_PRIVATE_TESTING_ENABLED', 'SENSEI_SOL_ENABLED']) {
        assert.equal(problems({ ...own, [k]: 'on' }), '', k + ' with only the Founder SOL wallet starts');
        assert.match(problems({ ...own, [k]: 'on', FOUNDERS_REVENUE_WALLET: '' }), /FOUNDERS_REVENUE_WALLET \(their SOL receipt wallet\) is not set/, k + ' needs the Founder SOL wallet');
      }
      assert.equal(problems({ ...own, FOUNDERS_REVENUE_WALLET: '' }), '', 'sales off: no Founder SOL wallet needed');
      assert.match(problems({ ...own, FOUNDERS_REVENUE_WALLET: 'not-a-wallet' }), /FOUNDERS_REVENUE_WALLET must be a valid/);
      assert.match(problems({ ...own, FOUNDERS_REVENUE_WALLET: REGISTRY_ADDRESS }), /must not be a Chapter 04, game custody or Squads address/);
      assert.match(problems({ ...own, FOUNDERS_REVENUE_WALLET: CUSTODY_ADDRESS }), /must not be a Chapter 04, game custody or Squads address/, 'never the game custody hot wallet');
      assert.match(problems({ ...own, RYO_STUDIO_WALLET: TESTER }), /FOUNDERS_REVENUE_WALLET must not be RYO_STUDIO_WALLET/);
      assert.match(problems({ ...own, FOUNDERS_REVENUE_WALLET: 'z'.repeat(44) }), /FOUNDERS_REVENUE_WALLET must be a valid/, 'base58 of 33 bytes is not a public key');
      assert.match(problems({ ...own, FOUNDERS_PUBLIC_SALE_ENABLED: ' on ', FOUNDERS_REVENUE_WALLET: '' }), /is not set/, 'switch values are trimmed like the runtime');
      assert.doesNotMatch(problems({ ...own, RYO_REVENUE_WALLET: TESTER }), /must differ from the game revenue wallet/, 'pre-launch may still share the wallet (transition)');
    }
    assert.equal(network.privateTesting(priv), true); assert.deepEqual([...network.privateTesters(priv)], [TESTER]);
    assert.match(problems({ ...priv, RYO_PRIVATE_TEST_WALLETS: '' }), /needs RYO_PRIVATE_TEST_WALLETS/);
    assert.match(problems({ ...priv, RYO_PRIVATE_TEST_WALLETS: TESTER + ',not-a-wallet' }), /valid Solana wallet addresses only/);
    assert.equal(network.privateTesters({ RYO_PRIVATE_TEST_WALLETS: TESTER + ',not-a-wallet' }).size, 0, 'one bad entry empties the allowlist');
    assert.match(problems({ ...priv, SOLANA_RPC_URL: '' }), /needs SOLANA_RPC_URL/);
    assert.match(problems({ ...priv, SOLANA_PUBLIC_RPC_URL: 'http://x' }), /needs SOLANA_PUBLIC_RPC_URL/);
    // Money settings (owner-approved): only in private live testing with testers, and only complete.
    const money = { RYO_TREASURY_SECRET: '[1]', RYO_TOKEN_MINT: TESTER, RYO_STUDIO_WALLET: TESTER, RYO_REVENUE_WALLET: TESTER };
    // Allowed in principle, but the reviewed treasury registry still governs the mint (pending in this build).
    assert.equal(problems({ ...priv, ...money }), 'RYO_TOKEN_MINT is set but the SR mint is still pending in the reviewed treasury registry (treasury/treasury-registry.json). Register the mint through a reviewed commit first.',
      'private live testing holds complete money settings only under the same registry locks as launch');
    assert.match(problems({ ...priv, RYO_TREASURY_SECRET: '[1]' }), /all required money settings or none \(missing RYO_TOKEN_MINT\)/);
    // Live economy (2026-11-09): custody + token are the required pair; the studio and game revenue wallets are optional.
    assert.doesNotMatch(problems({ ...priv, RYO_TREASURY_SECRET: '[1]', RYO_TOKEN_MINT: TESTER }), /money settings or none/, 'custody + token without studio/revenue is complete on live');
    assert.match(problems({ ...pre, ...money }), /must not hold money settings/, 'the portal-only stage still refuses money settings');
    assert.match(problems({ ...pre, ...money, RELEASE_STAGE: 'portal' }), /must not hold money settings/);
    assert.match(problems({ ...priv, ...money, RYO_PRIVATE_TEST_WALLETS: '' }), /must not hold money settings/, 'no testers: no money settings');
    assert.match(problems({ ...priv, ...money, RYO_PRIVATE_TEST_WALLETS: 'bad' }), /must not hold money settings/);
    assert.match(problems({ ...priv, SR_REVENUE_ROUTING_ENABLED: 'on' }), /SR_REVENUE_ROUTING_ENABLED must be off/);
    assert.match(problems({ ...priv, STARTER_PACK: 'on' }), /STARTER_PACK must be off/);
    // The launch gates ship in the Mainnet build and default to closed there.
    const liveGates = require(path.join(mainDir, 'server/launch-gates.cjs'));
    assert.deepEqual(liveGates.publicGates({}), { summoning: false, marketplace: false, rewardClaims: false, solDeposits: false, solWithdrawals: false, bossHunt: false, chat: true, fusion: true, dojo: true, training: true }, 'every money gate, Boss Hunt included, is closed on the live build; gameplay screens stay on');
    // The real Mainnet pre-launch host publishes policy without mounting or contacting money services.
    const verifyLive=`(async()=>{const assert=require('node:assert/strict'),{server,prelaunch}=require('./server/site-server.cjs');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;try{const policy=await(await fetch(base+'/economy-policy.json')).json();assert.equal(policy.mode,'live-sr');assert.equal(policy.network,'mainnet');assert.equal(policy.prelaunch,true);assert.equal(policy.monetaryEndpointsMounted,false);assert.deepEqual(policy.ratesBps,{lockedTreasury:5000,activeRewards:3000,communityRewards:1000,economicReserve:1000});assert.equal((await fetch(base+'/api/ryo',{method:'POST',body:'{}'})).status,403);assert.equal((await fetch(base+'/admin/')).status,404);const page=await fetch(base+'/treasury');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await page.text(),/Every SR wallet/);for(const a of ['/treasury/treasury.js','/treasury/treasury.css'])assert.equal((await fetch(base+a)).status,200);assert.equal((await fetch(base+'/treasury/../server/site-server.cjs')).status,404);assert.equal((await fetch(base+'/treasury',{method:'POST'})).status,405);const reg=await(await fetch(base+'/treasury-registry.json')).json();assert.equal(reg.readOnly,true);assert.equal(reg.prelaunch,true);assert.equal(reg.registry.destinations[0].address,'GPbgpbtxEiZtsWnjxq3MKbk9gaoqFNEbpTRqn8t7htjE');assert.equal(reg.registry.reserves[0].address,'5wVBdFkQFLtu8qhZ1pg6RoD1LjWGUYL1erBVGBu11aGn');assert.equal(reg.registry.reserves[0].percent,0);assert.equal(reg.burnReserve.status,'not-configured','pre-launch: no Burn Reserve ledger, never a 0 burned figure');assert.equal(reg.burnReserve.burnedRaw,null);assert.equal(reg.registry.srMint.address,'8Azsv23uZnZdmeyA6Vg6BagkT1SHEdiK4QqV3vycpump');assert.equal(reg.verification.status,'unverified','unreachable RPC is unverified, never zero');assert.equal(reg.claimFunding.status,'not-configured');assert.equal(reg.claimFunding.availableRyo,null);assert.equal(reg.paymentsEnabled,false,'pre-launch: Mainnet payments disabled');let last=200;for(let i=0;i<60;i++)last=(await fetch(base+'/treasury-registry.json')).status;assert.equal(last,429,'public JSON is rate limited per client');assert.equal((await fetch(base+'/treasury')).status,200,'the page itself stays available');const panel=await fetch(base+'/');assert.equal(panel.status,200);}finally{await new Promise(r=>server.close(r));await prelaunch.close();}})().catch(e=>{console.error(e);process.exitCode=1});`;
    const verifySecureHeaders=verifyLive.replace("const policy=await", "const landing=await fetch(base+'/');assert.equal(landing.headers.get('strict-transport-security'),'max-age=31536000');assert.equal(landing.headers.get('x-frame-options'),'DENY');assert(landing.headers.get('content-security-policy').includes(\"script-src 'self'\"));const policy=await");
    const liveRun=spawnSync(process.execPath,['-e',verifySecureHeaders],{cwd:root,encoding:'utf8',timeout:20000,env:{...process.env,...pre,GAME_RUNTIME_DIR:mainDir,STARTER_PACK:'off',RYO_TREASURY_SECRET:'',RYO_TOKEN_MINT:'',RYO_STUDIO_WALLET:'',RYO_REVENUE_WALLET:'',SR_REVENUE_ROUTING_ENABLED:'',SOLANA_RPC_URL:'https://127.0.0.1:9/'}});
    assert.equal(liveRun.status,0,liveRun.stderr);
    // The real Mainnet host in private live testing: starts, keeps the portal public and every game path closed,
    // and a pass cookie that cannot be checked (database unreachable here) is refused: fail closed.
    const verifyPrivate=`(async()=>{const assert=require('node:assert/strict'),fs=require('node:fs'),{server,prelaunch}=require('./server/site-server.cjs');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;try{const home=await fetch(base+'/');assert.equal(await home.text(),fs.readFileSync('prelaunch/index.html','utf8'));for(const cookie of [undefined,'sb_pt='+'A'.repeat(43)]){const h=cookie?{cookie}:{};const play=await fetch(base+'/play/',{redirect:'manual',headers:h});assert.equal(play.status,302);assert.equal(play.headers.get('location'),'/');const api=await fetch(base+'/api/ryo',{method:'POST',headers:{...h,'content-type':'application/json'},body:'{"action":"challenge"}'});assert.equal(api.status,403);assert.equal((await api.json()).code,'PRELAUNCH');assert.equal((await fetch(base+'/admin/',{headers:h})).status,404);}assert.equal((await fetch(base+'/private-test')).status,200);}finally{await new Promise(r=>server.close(r));await prelaunch.close();}})().catch(e=>{console.error(e);process.exitCode=1});`;
    const privEnv={...process.env,...priv,DATABASE_URL:'postgres://nobody@127.0.0.1:1/none',GAME_RUNTIME_DIR:mainDir,STARTER_PACK:'off',RYO_TREASURY_SECRET:'',RYO_TOKEN_MINT:'',RYO_STUDIO_WALLET:'',RYO_REVENUE_WALLET:''};
    const privRun=spawnSync(process.execPath,['-e',verifyPrivate],{cwd:root,encoding:'utf8',timeout:30000,env:privEnv});
    assert.equal(privRun.status,0,privRun.stderr);
    // Mainnet game page without the token settings: /beta-config.json carries the browser RPC (never the public node,
    // which refuses website requests with 403). With the token settings it is the game's own answer again.
    const verifyRpcConfig=`(async()=>{const assert=require('node:assert/strict'),{server}=require('./server/site-server.cjs');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;try{for(const p of ['/play/beta-config.json','/beta-config.json']){const r=await fetch(base+p);assert.equal(r.status,200,p);const j=await r.json();const expected=process.env.EXPECT==='rpc-only'?{network:'solana-mainnet',rpcUrl:process.env.SOLANA_PUBLIC_RPC_URL}:{network:'solana-mainnet',rpcUrl:process.env.SOLANA_PUBLIC_RPC_URL,tokenAddress:process.env.RYO_TOKEN_MINT,studioAddress:process.env.RYO_STUDIO_WALLET};assert.deepEqual(j,expected,p);assert.equal(r.headers.get('cache-control'),'no-store')}}finally{await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});`;
    const pubEnv={...process.env,...MAINNET_ENV,GAME_RUNTIME_DIR:mainDir,PRELAUNCH_MODE:'',STARTER_PACK:'off',RYO_TREASURY_SECRET:'',RYO_REVENUE_WALLET:'',SR_REVENUE_ROUTING_ENABLED:''};
    const rpcOnly=spawnSync(process.execPath,['-e',verifyRpcConfig],{cwd:root,encoding:'utf8',timeout:30000,env:{...pubEnv,RYO_TOKEN_MINT:'',RYO_STUDIO_WALLET:'',EXPECT:'rpc-only'}});
    assert.equal(rpcOnly.status,0,rpcOnly.stderr);
    const withToken=spawnSync(process.execPath,['-e',verifyRpcConfig],{cwd:root,encoding:'utf8',timeout:30000,env:{...pubEnv,RYO_TOKEN_MINT:TESTER,RYO_STUDIO_WALLET:TESTER,EXPECT:'game'}});
    assert.match(withToken.stderr+withToken.stdout,/SR mint is still pending|does not match the SR mint in the reviewed treasury registry|tokenAddress/,'with token settings the game answers (here the reviewed registry refuses a mint that is not the registered one at start-up)');
    const privBad=spawnSync(process.execPath,['-e',"require('./server/site-server.cjs')"],{cwd:root,encoding:'utf8',timeout:20000,env:{...privEnv,RYO_PRIVATE_TEST_WALLETS:'',PORT:'0'}});
    assert.notEqual(privBad.status,0);assert.match(privBad.stderr,/needs RYO_PRIVATE_TEST_WALLETS/,'no testers: the server does not start');

    // render-server (also `npm run start:game-only`) refuses an unsafe environment, and publishes the browser RPC.
    const { createServer } = require(path.join(mainDir, 'server/render-server.cjs'));
    const saved = { ...process.env };
    try {
      for (const k of Object.keys(MAINNET_ENV)) delete process.env[k];
      assert.throws(() => createServer({ publicRoot: path.join(mainDir, 'public') }), /Refusing to start/);
      Object.assign(process.env, MAINNET_ENV, { RYO_TOKEN_MINT: '11111111111111111111111111111111', RYO_STUDIO_WALLET: '11111111111111111111111111111111' }); assert.throws(() => createServer({ publicRoot: path.join(mainDir, 'public') }), /SR mint is still pending/, 'an unregistered mint cannot launch'); { const file = path.join(mainDir, 'server/treasury-registry.json'), r = JSON.parse(fs.readFileSync(file, 'utf8')); r.srMintAddress = '11111111111111111111111111111111'; fs.writeFileSync(file, JSON.stringify(r)); require(path.join(mainDir, 'server/treasury-registry.cjs')).useForIsolatedTest(r); }
      // The registered mint now releases the game automatically (2026-11-09), which needs the custody key: a throw-away one here.
      process.env.RYO_TREASURY_SECRET = JSON.stringify([...require(path.join(app, 'node_modules/@solana/web3.js')).Keypair.generate().secretKey]);
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
