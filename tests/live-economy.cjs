'use strict';
/* Live economy (live-economy/server.cjs, owner decision 2026-11-09). On the Devnet build nothing changes; on the live build:
 * fee-free SR deposits, Boss Hunt treasury share to the registered Locked Treasury, studio/revenue wallets optional, and the
 * Market refused until both wallets exist. Also the service and the startup guard with those wallets absent. */
const assert = require('node:assert/strict'), path = require('node:path');
const web3 = require('../app/node_modules/@solana/web3.js'), spl = require('../app/node_modules/@solana/spl-token');
const network = require('../app/server/network.cjs'), E = require('../app/server/live-economy.cjs'), gates = require('../app/server/launch-gates.cjs');
const realBuilt = network.built;
const devnet = () => { network.built = () => network.NETWORKS.devnet; }, mainnet = () => { network.built = () => network.NETWORKS.mainnet; };
const addr = () => web3.Keypair.generate().publicKey.toBase58();
const address = x => { try { if (typeof x !== 'string' || new web3.PublicKey(x).toBase58() !== x) throw 0; return x; } catch { throw Error('Invalid Solana address.'); } };
const passed = [];

(async () => {
  try {
    // ---- Devnet build: exactly the previous behaviour.
    devnet();
    const studio = addr(), revenue = addr(), original = () => 'original';
    assert.equal(E.live(), false);
    assert.throws(() => E.wallets(address, undefined, revenue), /Invalid/, 'Devnet requires the studio wallet');
    assert.throws(() => E.wallets(address, studio, ''), /Invalid/, 'Devnet requires the revenue wallet');
    E.wallets(address, studio, revenue);
    assert.deepEqual(Object.keys(E.required({ A: 1, RYO_STUDIO_WALLET: 2, RYO_REVENUE_WALLET: 3 })), ['A', 'RYO_STUDIO_WALLET', 'RYO_REVENUE_WALLET']);
    assert.deepEqual(E.depositConfig(studio), { studioAddress: studio, studioFeeBps: 200 });
    assert.equal(E.huntTreasury(revenue), revenue);
    assert.equal(E.verifier(original, {}), original, 'Devnet keeps the 2% studio-fee deposit verifier');
    assert.equal(E.marketConfigured({}), true);
    assert.equal(E.tokenConfigReady({ RYO_TOKEN_MINT: addr() }), false, 'the test server still needs the studio wallet for its token config');
    assert.equal(E.publicStudio({ RYO_STUDIO_WALLET: studio }), studio); E.assertPurchase('purchase', { product: 'hunt' });
    passed.push('Devnet build unchanged: studio/revenue required, 2% deposit fee, Boss Hunt share to the revenue wallet');

    // ---- Live build.
    mainnet();
    assert.equal(E.live(), true);
    E.wallets(address, undefined, undefined); E.wallets(address, '', ''); E.wallets(address, studio, undefined);
    assert.throws(() => E.wallets(address, 'not-a-wallet', undefined), /Invalid/, 'a configured but invalid wallet is still refused');
    assert.deepEqual(Object.keys(E.required({ A: 1, RYO_STUDIO_WALLET: 2, RYO_REVENUE_WALLET: 3 })), ['A'], 'studio/revenue are not required settings');
    assert.deepEqual(E.depositConfig(studio), { studioAddress: null, studioFeeBps: 0, depositFeeBps: 0 }, 'the client is told: no deposit fee');
    const locked = require('../app/server/treasury-registry.cjs').registry().addresses.lockedTreasury;
    assert.equal(E.huntTreasury(revenue), locked, 'Boss Hunt 10% goes to the registered Locked Treasury');
    assert.notEqual(E.verifier(original, {}), original, 'live uses the fee-free deposit verifier');
    assert.equal(E.marketConfigured({}), false); assert.equal(E.marketConfigured({ RYO_STUDIO_WALLET: studio }), false);
    assert.equal(E.marketConfigured({ RYO_STUDIO_WALLET: studio, RYO_REVENUE_WALLET: revenue }), true);
    const ON = { MARKETPLACE_ENABLED: 'on' };
    assert.throws(() => gates.check('market-buy', {}, ON), e => e.status === 503 && /Market is not configured/.test(e.message), 'live Market refused without both wallets');
    gates.check('market-buy', {}, { ...ON, RYO_STUDIO_WALLET: studio, RYO_REVENUE_WALLET: revenue });
    assert.throws(() => gates.check('market-buy', {}, { RYO_STUDIO_WALLET: studio, RYO_REVENUE_WALLET: revenue }), e => e.code === 'LAUNCH_GATE_CLOSED' && e.status === 403, 'the Market gate itself still applies first');
    gates.check('deposit', {}, { SOL_DEPOSITS_ENABLED: 'on' });
    assert.equal(gates.publicGates(ON).marketplace, false, 'the published Market gate matches the server refusal');
    assert.equal(gates.publicGates({ ...ON, RYO_STUDIO_WALLET: studio, RYO_REVENUE_WALLET: revenue }).marketplace, true);
    assert.throws(() => gates.check('purchase', { product: 'hunt' }, {}), e => e.status === 403 && /Boss Hunt screen/.test(e.message), 'Boss Hunt is never paid through the generic purchase on live');
    assert.throws(() => gates.check('purchase', { product: 'summon' }, {}), e => e.code === 'LAUNCH_GATE_CLOSED', 'summons still follow their own gate');
    assert.equal(E.tokenConfigReady({ RYO_TOKEN_MINT: addr() }), true, 'live token config needs only the mint');
    assert.equal(E.tokenConfigReady({}), false); assert.equal(E.publicStudio({ RYO_STUDIO_WALLET: studio }), null, 'live publishes no studio destination');
    passed.push('live build: studio/revenue optional (still validated when set), deposit config fee-free, Boss Hunt → Locked Treasury, Market refused until both wallets exist');

    // ---- The game service starts on live without the two wallets; config reports a fee-free deposit.
    const { createService, GENESIS } = require('../app/server/service.cjs'), treasury = web3.Keypair.generate(), mint = web3.Keypair.generate().publicKey;
    const store = { now: () => Date.now(), pool: { query: async () => ({ rows: [] }) } };
    const mintData = Buffer.alloc(spl.MINT_SIZE); spl.MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: web3.PublicKey.default, supply: 1000000000n * 1000000n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: web3.PublicKey.default }, mintData);
    const connection = { async getGenesisHash() { return GENESIS; }, async getAccountInfo() { return { owner: spl.TOKEN_PROGRAM_ID, data: mintData }; } };
    const raw = JSON.parse(require('node:fs').readFileSync(require('../app/server/treasury-registry.cjs').FILE, 'utf8')); delete raw.gameCustody;
    require('../app/server/treasury-registry.cjs').useForIsolatedTest(raw);   // throw-away custody key in this process only
    const service = createService({ store, connection, treasury, mint: mint.toBase58(), origin: 'https://live.example', studioAddress: undefined, revenueAddress: undefined });
    const cfg = await service.handle('config', {});
    assert.deepEqual([cfg.studioAddress, cfg.studioFeeBps, cfg.depositFeeBps, cfg.revenueAddress ?? null], [null, 0, 0, null], 'live config: no studio destination, no deposit fee, no revenue wallet');
    devnet();
    assert.throws(() => createService({ store, connection, treasury, mint: mint.toBase58(), origin: 'https://beta.example', studioAddress: undefined, revenueAddress: undefined }), /Invalid Solana address/, 'Devnet still requires both');
    passed.push('game service: starts on live without studio/revenue wallets and reports fee-free deposits; Devnet still requires them');

    // The startup guard (custody + token required together, studio/revenue optional) is covered in network-guard.cjs on a real Mainnet build.
    // ---- Founder pre-launch prices end with the automatic release (released mint) and come back under GAME_LAUNCH_HOLD.
    { const regMod = require('../app/server/treasury-registry.cjs'), F = require('../app/server/founders.cjs'), saved = JSON.parse(require('node:fs').readFileSync(regMod.FILE, 'utf8')); delete saved.gameCustody;
      const MINT = addr(), pre = { SOLANA_NETWORK: 'mainnet', PRELAUNCH_MODE: 'on', RELEASE_STAGE: 'private' };
      regMod.useForIsolatedTest({ ...saved, srMintAddress: MINT });
      try {
        assert.equal(F.prelaunchPricing(pre), true, 'pre-launch: promotional prices');
        assert.equal(F.prelaunchPricing({ ...pre, RYO_TOKEN_MINT: MINT }), false, 'released mint: regular prices');
        assert.equal(F.priceFor(F.TIERS.mythic, 5, { ...pre, RYO_TOKEN_MINT: MINT }), F.TIERS.mythic.lamports);
        assert.equal(F.prelaunchPricing({ ...pre, RYO_TOKEN_MINT: MINT, GAME_LAUNCH_HOLD: 'on' }), true, 'held: pre-launch prices again');
        assert.equal(F.prelaunchPricing({ ...pre, RYO_TOKEN_MINT: addr() }), true, 'an unregistered mint changes nothing');
      } finally { regMod.useForIsolatedTest(saved); }
      passed.push('Founder pre-launch prices end automatically with the released mint and return under GAME_LAUNCH_HOLD'); }
  } finally { network.built = realBuilt; }
  console.log('PASS: live economy —\n  - ' + passed.join('\n  - '));
})().catch(e => { console.error(e); process.exit(1); });
