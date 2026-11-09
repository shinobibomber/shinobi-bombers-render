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
    const raw = JSON.parse(require('node:fs').readFileSync(require('../app/server/treasury-registry.cjs').FILE, 'utf8')); delete raw.gameCustody; raw.srMintAddress = null; delete raw.srMintProgram; raw.activation = { approved: false, reference: null };
    require('../app/server/treasury-registry.cjs').useForIsolatedTest(raw);   // throw-away custody key in this process only
    const service = createService({ store, connection, treasury, mint: mint.toBase58(), origin: 'https://live.example', studioAddress: undefined, revenueAddress: undefined });
    const cfg = await service.handle('config', {});
    assert.deepEqual([cfg.studioAddress, cfg.studioFeeBps, cfg.depositFeeBps, cfg.revenueAddress ?? null], [null, 0, 0, null], 'live config: no studio destination, no deposit fee, no revenue wallet');
    devnet();
    assert.throws(() => createService({ store, connection, treasury, mint: mint.toBase58(), origin: 'https://beta.example', studioAddress: undefined, revenueAddress: undefined }), /Invalid Solana address/, 'Devnet still requires both');
    passed.push('game service: starts on live without studio/revenue wallets and reports fee-free deposits; Devnet still requires them');

    // ---- SR token program: the registry decides on live; the test server stays classic; only metadata extensions pass.
    { const regMod = require('../app/server/treasury-registry.cjs'), V = require('../app/server/treasury-verify.cjs'), fx = require('./sr-revenue-fixture.cjs');
      const saved = JSON.parse(require('node:fs').readFileSync(regMod.FILE, 'utf8')); delete saved.gameCustody; saved.srMintAddress = null; delete saved.srMintProgram; saved.activation = { approved: false, reference: null };
      const T22 = spl.TOKEN_2022_PROGRAM_ID, m2022 = web3.Keypair.generate().publicKey, accounts = new Map();
      const chain = { async getAccountInfo(k) { return accounts.get(k.toBase58()) ?? null; } };
      const mintWith = names => ({ owner: T22, data: fx.token2022(mintData, 'mint', names), lamports: 1, executable: false });
      try {
        assert.throws(() => regMod.validate({ ...saved, srMintProgram: 'token-2023' }), /srMintProgram/, 'unknown token programs are refused by the registry');
        regMod.useForIsolatedTest({ ...saved, srMintProgram: 'token-2022' });
        mainnet(); assert(E.programId().equals(T22), 'live: the registry program');
        devnet(); assert(E.programId().equals(spl.TOKEN_PROGRAM_ID), 'test server: always classic'); mainnet();
        accounts.set(m2022.toBase58(), mintWith(['MetadataPointer', 'TokenMetadata']));
        const value = await E.getMint(chain, m2022.toBase58()); assert.equal(value.decimals, 6); assert.equal(value.mintAuthority, null);
        for (const bad of [['TransferFeeConfig'], ['MetadataPointer', 'TransferHook'], ['PermanentDelegate'], ['NonTransferable'], ['DefaultAccountState']]) {
          accounts.set(m2022.toBase58(), mintWith(bad));
          await assert.rejects(E.getMint(chain, m2022.toBase58()), e => e.status === 503 && /unsupported Token-2022 extensions/.test(e.message), bad.join('+') + ' refused');
        }
        accounts.set(m2022.toBase58(), { owner: spl.TOKEN_PROGRAM_ID, data: mintData });
        await assert.rejects(E.getMint(chain, m2022.toBase58()), /registered SR token program/, 'a classic mint is refused when Token-2022 is registered');
        accounts.delete(m2022.toBase58()); await assert.rejects(E.getMint(chain, m2022.toBase58()), /registered SR token program/, 'a missing mint is refused');
        // Treasury verifier (the /treasury page and SR routing locks).
        accounts.set(m2022.toBase58(), mintWith(['MetadataPointer', 'TokenMetadata']));
        let v = await V.verifyMint(chain, m2022.toBase58(), 'token-2022'); assert.equal(v.status, 'verified', JSON.stringify(v)); assert.deepEqual(v.extensions, ['MetadataPointer', 'TokenMetadata']);
        v = await V.verifyMint(chain, m2022.toBase58(), 'spl-token'); assert.equal(v.status, 'mismatch'); assert.match(v.blocking.join(' '), /Token-2022 mint but the registry declares classic/);
        accounts.set(m2022.toBase58(), mintWith(['TransferFeeConfig'])); v = await V.verifyMint(chain, m2022.toBase58(), 'token-2022'); assert.match(v.blocking.join(' '), /unsupported extensions: TransferFeeConfig/);
        const vault = web3.Keypair.generate().publicKey, ata = spl.getAssociatedTokenAddressSync(m2022, vault, true, T22), base = Buffer.alloc(spl.ACCOUNT_SIZE);
        spl.AccountLayout.encode({ mint: m2022, owner: vault, amount: 0n, delegateOption: 0, delegate: web3.PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: web3.PublicKey.default }, base);
        accounts.set(ata.toBase58(), { owner: T22, data: fx.token2022(base, 'account', ['ImmutableOwner']) });
        v = await V.verifyTokenAccount(chain, m2022.toBase58(), vault.toBase58(), 'token-2022'); assert.equal(v.status, 'verified', JSON.stringify(v)); assert.equal(v.address, ata.toBase58());
        accounts.set(ata.toBase58(), { owner: T22, data: fx.token2022(base, 'account', ['ImmutableOwner', 'PermanentDelegate']) });
        v = await V.verifyTokenAccount(chain, m2022.toBase58(), vault.toBase58(), 'token-2022'); assert.match(v.problems.join(' '), /unsupported extensions: PermanentDelegate/);
        accounts.set(ata.toBase58(), { owner: spl.TOKEN_PROGRAM_ID, data: base });
        v = await V.verifyTokenAccount(chain, m2022.toBase58(), vault.toBase58(), 'token-2022'); assert.equal(v.status, 'mismatch', 'a classic account at the Token-2022 address is refused');
      } finally { regMod.useForIsolatedTest(saved); mainnet(); }
      assert(E.programId().equals(spl.TOKEN_PROGRAM_ID), 'without srMintProgram the registry means classic SPL Token');
      passed.push('SR token program: registry-decided on live (classic on the test server); Token-2022 mint accepted only with MetadataPointer/TokenMetadata; transfer fee/hook, permanent delegate, non-transferable, default-frozen and wrong-program mints refused; Token-2022 treasury account checks'); }

    // ---- No free starter heroes on live (owner decision 2026-11-09).
    { const economy = require('../app/server/economy.cjs');
      mainnet();
      const fresh = economy.normalizeProfile(economy.initialProfile());
      assert.deepEqual([fresh.heroes.length, fresh.liveStart, fresh.battleReady], [0, 1, []], 'a new live account starts with no heroes');
      const old = () => { devnet(); const p = economy.initialProfile(); mainnet(); delete p.liveStart; return p; };
      let p = old(); assert.equal(p.heroes.length, 2);
      p = economy.normalizeProfile(p); assert.deepEqual([p.heroes.length, p.liveStart, p.battleReady.length], [0, 1, 0], 'an untouched older account loses the two default Genin once');
      const summoned = economy.hero(0); p.heroes.push(summoned, economy.hero(0));
      assert.equal(economy.normalizeProfile(p).heroes.length, 2, 'marked profiles are never cleaned again (two summoned Genin stay)');
      for (const change of [q => { q.heroes[0].level = 2; }, q => { q.heroes.push(economy.hero(1)); }, q => { q.dojo = 1; }, q => { q.sensei = true; }, q => { q.heroes[0].nft = { mint: 'x' }; }]) {
        const q = old(); change(q); const before = q.heroes.length;
        assert.equal(economy.normalizeProfile(q).heroes.length, before, 'a profile that is not the untouched default keeps every hero');
      }
      devnet(); assert.equal(economy.normalizeProfile(economy.initialProfile()).heroes.length, 2, 'the test server keeps its two default Genin'); mainnet();
      passed.push('no free heroes on live: new accounts start empty; untouched older accounts lose the two default Genin once; anything else is never touched; the test server is unchanged'); }

    // The startup guard (custody + token required together, studio/revenue optional) is covered in network-guard.cjs on a real Mainnet build.
    // ---- Founder offer prices stay after the automatic release (owner decision 2026-11-09), until each tier sells out.
    { const regMod = require('../app/server/treasury-registry.cjs'), F = require('../app/server/founders.cjs'), saved = JSON.parse(require('node:fs').readFileSync(regMod.FILE, 'utf8')); delete saved.gameCustody; saved.srMintAddress = null; delete saved.srMintProgram; saved.activation = { approved: false, reference: null };
      const MINT = addr(), pre = { SOLANA_NETWORK: 'mainnet', PRELAUNCH_MODE: 'on', RELEASE_STAGE: 'private' };
      regMod.useForIsolatedTest({ ...saved, srMintAddress: MINT });
      try {
        for (const env of [pre, { ...pre, RYO_TOKEN_MINT: MINT }, { ...pre, RYO_TOKEN_MINT: MINT, GAME_LAUNCH_HOLD: 'on' }, {}]) {
          assert.equal(F.prelaunchPricing(env), true); assert.equal(F.priceFor(F.TIERS.mythic, 5, env), 700000000); assert.equal(F.priceFor(F.TIERS.legacy, 5, env), 250000000);
        }
      } finally { regMod.useForIsolatedTest(saved); }
      passed.push('Founder offer prices (0.7 / 0.25 SOL) stay before and after the released mint; no return to 1 / 0.5 SOL'); }
  } finally { network.built = realBuilt; }
  console.log('PASS: live economy —\n  - ' + passed.join('\n  - '));
})().catch(e => { console.error(e); process.exit(1); });
