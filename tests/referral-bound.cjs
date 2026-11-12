/* Referral-bound heroes and launch gates.
 * - A referral reward hero can't be listed on the Market (API refusal + audit row); normal heroes still list.
 * - Fusion keeps the binding: a fused hero is bound when any hero of its group of three was, and only then.
 * - A real referral claim produces bound heroes that the Market refuses.
 * - Launch gates: every paying action maps to one independent switch; a devnet build defaults on (test server
 *   unchanged), a mainnet build defaults off, and env values override both. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { PGlite } = require('@electric-sql/pglite');
const server = path.resolve(__dirname, '../app/server');
const economy = require(path.join(server, 'economy.cjs')), { Store } = require(path.join(server, 'store.cjs')), market = require(path.join(server, 'market.cjs'));
const hero = (id, rank, extra = {}) => ({ tokenId: id, rank, level: 1, name: 'Hero ' + id, baseStats: { pw: 3, sp: 3, st: 3 }, ...extra });

(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(server, 'schema.sql'), 'utf8'));
  const pool = { query: (s, a) => db.query(s, a), async connect() { return { query: (s, a) => db.query(s, a), release() {} }; } };
  const store = new Store(pool, 'bound-test', () => 1_900_000_000_000), W = 'bound-wallet';
  await store.transaction(async c => { await store.locked(c, W); await store.profileLocked(c, W);
    const heroes = [hero('normal', 2), hero('bound', 2, { referralReward: true, creatorReward: true, referralClaim: 'claim-1' }), hero('keep-1', 0), hero('keep-2', 0)];
    await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, W, JSON.stringify(economy.normalizeProfile({ dojo: 0, heroes, battleReady: [] }))]); });

  // Market: bound heroes are refused at the API and the refusal is audited; nothing is escrowed.
  await assert.rejects(market.handle(store, W, 'market-post', { heroId: 'bound', price: 150000 }), e => e.code === 'REFERRAL_BOUND' && e.status === 409 && /cannot be listed/.test(e.message));
  const audit = (await pool.query("SELECT target FROM ryo_creator_audit WHERE scope=$1 AND action='market.referral-bound-rejected'", [store.scope])).rows;
  assert.deepEqual(audit.map(r => r.target), ['bound']);
  assert.ok((await store.profile(W)).heroes.some(h => h.tokenId === 'bound' && h.referralReward === true), 'the bound hero stays with its owner');
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM ryo_market_listings WHERE scope=$1', [store.scope])).rows[0].n, 0);
  const listed = await market.handle(store, W, 'market-post', { heroId: 'normal', price: 150000 });
  assert.ok(listed, 'normal heroes keep their Market rules');
  assert.equal((await pool.query("SELECT COUNT(*) AS n FROM ryo_market_listings WHERE scope=$1 AND status='active'", [store.scope])).rows[0].n, 1);

  // Fusion: groups of three; only the group containing a bound hero produces a bound hero.
  const ids = ['g1a', 'g1b', 'g1c', 'g2a', 'g2b', 'g2c'];
  const profile = economy.normalizeProfile({ dojo: 0, battleReady: [], heroes: [...ids.map((id, i) => hero(id, 0, i === 4 ? { referralReward: true } : {})), hero('x1', 2), hero('x2', 2)] });
  const q = economy.quote(profile, 'fusion', { heroIds: ids }); q.fusion = { ...q.fusion, successPercent: 100 };
  const { result, profile: after } = economy.fulfill(profile, q);
  assert.equal(result.outputs.length, 2);
  assert.deepEqual(result.outputs.map(h => h.referralReward === true), [false, true], 'group 2 contained the bound hero');
  assert.ok(after.heroes.filter(h => h.referralReward === true).length === 1, 'binding is kept, never duplicated');
  // A fused bound hero is refused by the Market too.
  const fusedBound = result.outputs[1];
  await store.transaction(async c => { const p = await store.profileLocked(c, W); p.heroes.push(fusedBound); await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, W, JSON.stringify(p)]); });
  await assert.rejects(market.handle(store, W, 'market-post', { heroId: fusedBound.tokenId, price: 25000 }), e => e.code === 'REFERRAL_BOUND');
  // Any other account-bound input (Founder, Creator, Starter Pack, ...) makes the fused hero marketBound: the Market refuses it.
  const fids = ['f1a', 'f1b', 'f1c', 'f2a', 'f2b', 'f2c'];
  const fprofile = economy.normalizeProfile({ dojo: 0, battleReady: [], heroes: [...fids.map((id, i) => hero(id, 2, i === 1 ? { founderGrant: 'gold' } : i === 5 ? { creatorReward: true } : {})), hero('y1', 0), hero('y2', 0)] });
  const fq = economy.quote(fprofile, 'fusion', { heroIds: fids }); fq.fusion = { ...fq.fusion, successPercent: 100 };
  const fusedOut = economy.fulfill(fprofile, fq).result.outputs;
  assert.deepEqual(fusedOut.map(h => h.marketBound === true), [true, true], 'Founder and Creator inputs bind the fused hero');
  assert.ok(fusedOut.every(h => h.referralReward !== true), 'without turning it into a referral hero');
  const plainFuse = economy.normalizeProfile({ dojo: 0, battleReady: [], heroes: [...['p1', 'p2', 'p3'].map(id => hero(id, 2)), hero('z1', 0), hero('z2', 0)] });
  const pq = economy.quote(plainFuse, 'fusion', { heroIds: ['p1', 'p2', 'p3'] }); pq.fusion = { ...pq.fusion, successPercent: 100 };
  assert.ok(economy.fulfill(plainFuse, pq).result.outputs.every(h => !h.marketBound), 'plain heroes fuse into a tradable hero');
  await store.transaction(async c => { const p = await store.profileLocked(c, W); p.heroes.push(fusedOut[0]); await c.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [store.scope, W, JSON.stringify(p)]); });
  await assert.rejects(market.handle(store, W, 'market-post', { heroId: fusedOut[0].tokenId, price: 500000 }), e => e.code === 'ACCOUNT_BOUND', 'a fused bound Elite cannot be listed');
  // Summons and fusions without bound inputs never set the flag.
  const plain = economy.fulfill(profile, economy.quote(profile, 'summon', { quantity: 5 })).result.outputs;
  assert.ok(plain.every(h => h.referralReward !== true));

  // Launch gates.
  const gates = require(path.join(server, 'launch-gates.cjs'));
  const cases = [['purchase', { product: 'summon' }, 'summoning'], ['purchase', { product: 'summon', params: {} }, 'summoning'], ['market-post', {}, 'marketplace'], ['market-buy', {}, 'marketplace'], ['market-offer', {}, 'marketplace'], ['market-accept', {}, 'marketplace'],
    ['market-cancel', {}, null], ['market-browse', {}, null], ['claim-adventure', {}, 'rewardClaims'], ['creator-player-claim', {}, 'rewardClaims'], ['creator-redeem', {}, 'rewardClaims'],
    ['deposit', {}, 'solDeposits'], ['box-mint', {}, 'solDeposits'], ['box-confirm', {}, null], ['withdraw', {}, 'solWithdrawals'], ['hunt-enter', {}, 'bossHunt'], ['purchase', { product: 'hunt' }, 'bossHunt'], ['chat-send', {}, 'chat'], ['chat-list', {}, null], ['purchase', { product: 'fusion' }, 'fusion'], ['purchase', { product: 'dojo' }, 'dojo'], ['purchase', { product: 'training' }, 'training'], ['state', {}, null]];
  for (const [action, body, gate] of cases) assert.equal(gates.gateFor(action, body), gate, action);
  assert.equal(require(path.join(server, 'network.cjs')).built(server).key, 'devnet');
  assert.deepEqual(gates.publicGates({}), { summoning: true, marketplace: true, rewardClaims: true, solDeposits: true, solWithdrawals: true, bossHunt: true, chat: true, fusion: true, dojo: true, training: true }, 'devnet build: test server unchanged');
  assert.equal(gates.publicGates({ SOL_WITHDRAWALS_ENABLED: 'off' }).solWithdrawals, false);
  assert.throws(() => gates.check('withdraw', {}, { SOL_WITHDRAWALS_ENABLED: 'off' }), e => e.status === 403 && e.code === 'LAUNCH_GATE_CLOSED' && e.gate === 'solWithdrawals');
  // A mainnet build defaults every gate off; each one opens on its own.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-gates-'));
  try {
    for (const f of ['launch-gates.cjs', 'network.cjs', 'live-economy.cjs', 'feature-switches.cjs', 'treasury-registry.cjs', 'treasury-registry.json'].filter(f => fs.existsSync(path.join(server, f)))) fs.copyFileSync(path.join(server, f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'network-build.json'), '{"network":"mainnet"}');
    const live = require(path.join(dir, 'launch-gates.cjs'));
    assert.deepEqual(live.publicGates({}), { summoning: false, marketplace: false, rewardClaims: false, solDeposits: false, solWithdrawals: false, bossHunt: false, chat: true, fusion: true, dojo: true, training: true }, 'live: Boss Hunt closed by default too; gameplay screens on');
    assert.deepEqual(live.publicGates({ SUMMONING_ENABLED: 'on' }), { summoning: true, marketplace: false, rewardClaims: false, solDeposits: false, solWithdrawals: false, bossHunt: false, chat: true, fusion: true, dojo: true, training: true }, 'opening one gate never opens money gates');
    const GAMEPLAY = ['chat', 'fusion', 'dojo', 'training'];   // gameplay screens default ON on every build
    for (const [action, body, gate] of cases) if (gate && !GAMEPLAY.includes(gate)) assert.throws(() => live.check(action, body, {}), e => e.code === 'LAUNCH_GATE_CLOSED', action); else live.check(action, body, {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  // The game wires the gate before the pause guard, publishes it in `config`, and the client refuses a closed deposit before signing.
  const service = fs.readFileSync(path.join(server, 'service.cjs'), 'utf8'), page = fs.readFileSync(path.join(server, '../public/index.html'), 'utf8');
  assert.ok(service.includes("require('./launch-gates.cjs').check(action,body);await require('./economic-dashboard.cjs').guard(store,action,wallet,body);"));
  assert.ok(service.includes("launchGates:require('./launch-gates.cjs').publicGates(),"));
  assert.ok(page.includes("if(configuration?.launchGates?.solDeposits===false)throw Error('Deposits are not open yet.');"));
  assert.ok(page.includes('h.referralBound=descriptor.referralReward===true;'));
  console.log('PASS: referral-bound heroes refused by the Market (audited), fusion keeps the binding per group, launch gates independent (devnet on, mainnet off) and wired before signing.');
})().catch(e => { console.error(e); process.exit(1); });
