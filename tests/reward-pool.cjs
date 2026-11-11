'use strict';
/* Reward pool totals (reward-pool/server.cjs, owner-approved Phase A 2026-11-11). Proves the indexed generated columns give
 * EXACTLY the old totals, on real Postgres (PGlite) with the built schema:
 *  1. Build integrity: the only changes to the pinned adventure.cjs / schema.sql are the two hooks and the one schema block
 *     (reversing them gives the previously pinned files byte for byte); no inline full sum is left in the per-sync paths; the
 *     helper's "old" queries are the exact text sr-revenue still exports.
 *  2. Randomized differential: ~600 random purchase and Adventure writes (bonus / ineligible / revenue v1, v2, missing /
 *     fractional and missing claimed / pending -> confirmed -> refunded / deletes / two scopes): old SQL == column SQL after
 *     every step, and the helper returns the same numbers.
 *  3. Self-check: missing columns or a mismatch -> alert + the old exact query, and the caller's transaction keeps working.
 *  4. Corrupt data: a non-numeric `operations` can still be stored as pending, but confirming it is refused (today it would break
 *     every player's sync instead).
 *  5. Differential Adventure: the same 3-player script (active syncs, funded purchases, Chest earnings, claims, refused claims)
 *     on two databases, one forced onto the old exact sums, one on the columns: every response and every stored row identical. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const ROOT = path.join(__dirname, '..'), APP = path.join(ROOT, 'app/server');
const RP = require(path.join(APP, 'reward-pool.cjs')), { SCHEMA } = require('../reward-pool/server.cjs');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const PREVIOUS = { adventure: '28c540bbde04f2af0256723176986a136efa07a4f7cf3bfa7766f2a29560a71e', schema: 'f77244cb2e05247ddcee5ed445d88d3cdc229537baafa6dce465c69ed387d5b5' };

function seeded(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function serialPool(db) {
  let tail = Promise.resolve(); const lock = async () => { let r; const b = tail; tail = new Promise(x => r = x); await b; return r; };
  return { async query(s, a) { const r = await lock(); try { return await db.query(s, a); } finally { r(); } }, async connect() { const r = await lock(); return { query: (s, a) => db.query(s, a), release: r }; } };
}

(async () => {
  // ---------- 1. build integrity
  const { adventureHooks } = require('../apply-reward-pool.cjs');
  let adv = fs.readFileSync(path.join(APP, 'adventure.cjs'), 'utf8');
  for (const [before, after] of adventureHooks.slice().reverse()) { assert.equal(adv.split(after).length - 1, 1, 'one exact reward pool hook'); adv = adv.replace(after, () => before); }
  assert.equal(sha(adv), PREVIOUS.adventure, 'adventure.cjs: only the two claimed-sum lines changed');
  const schemaSql = fs.readFileSync(path.join(APP, 'schema.sql'), 'utf8');
  assert.equal(schemaSql.split('\n' + SCHEMA).length - 1, 1, 'one reward pool schema block');
  assert.equal(sha(schemaSql.replace('\n' + SCHEMA, '')), PREVIOUS.schema, 'schema.sql: only the additive block was added');
  for (const f of ['adventure.cjs', 'chest-spending.cjs', 'treasury-rewards.cjs', 'sr-revenue.cjs']) assert(!/SUM\(\(data->>'claimed'\)::numeric\)/.test(fs.readFileSync(path.join(APP, f), 'utf8')), f + ' has no inline full claimed sum');
  const S = require(path.join(APP, 'sr-revenue.cjs'));
  assert.equal(RP.OLD.income, S.INCOME_SQL, 'the helper\'s original income query is the exact sr-revenue text'); assert.equal(RP.OLD.liveIncome, S.LIVE_INCOME_SQL);

  // ---------- 2. randomized differential sums
  {
    const db = new PGlite(); await db.exec(schemaSql); RP._reset();
    const rnd = seeded(20261111), pick = a => a[Math.floor(rnd() * a.length)], scopes = ['scope-a', 'scope-b'];
    const quote = () => { const q = {}; const op = pick([25000, 1, 0, 12345.5, 999999, undefined]); if (op !== undefined) q.operations = op; const f = pick(['balance', 'bonus', 'chest', undefined]); if (f) q.funding = f; const e = pick([true, false, 'false', undefined, 'true']); if (e !== undefined) q.adventureEligible = e; const v = pick(['1', '2', 2, undefined, 'x']); if (v !== undefined) q.revenueDistribution = { version: v }; return q; };
    const purchases = [], players = [];
    const check = async label => {
      for (const scope of scopes) for (const kind of ['claimed', 'income', 'liveIncome']) {
        const a = String((await db.query(RP.OLD[kind], [scope])).rows[0].n), b = String((await db.query(RP.NEW[kind], [scope])).rows[0].n);
        assert.equal(Number(a), Number(b), label + ': ' + kind + ' in ' + scope + ' (old ' + a + ', column ' + b + ')');
      }
    };
    for (let step = 0; step < 600; step++) {
      const scope = pick(scopes), r = rnd();
      if (r < 0.35) { const id = 'p' + step; purchases.push({ scope, id }); await db.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,'w',$2,'summon','{}',$3,'{}','{}',1,$2,'w',1,$4,1)", [scope, id, JSON.stringify(quote()), pick(['pending', 'confirmed', 'confirmed', 'refunded'])]); }
      else if (r < 0.55 && purchases.length) { const p = pick(purchases); await db.query('UPDATE ryo_purchases SET status=$3 WHERE scope=$1 AND request_id=$2', [p.scope, p.id, pick(['pending', 'confirmed', 'refunded'])]); }
      else if (r < 0.6 && purchases.length) { const p = purchases.splice(Math.floor(rnd() * purchases.length), 1)[0]; await db.query('DELETE FROM ryo_purchases WHERE scope=$1 AND request_id=$2', [p.scope, p.id]); }
      else if (r < 0.62 && purchases.length) { const p = pick(purchases); await db.query('UPDATE ryo_purchases SET quote=$3 WHERE scope=$1 AND request_id=$2', [p.scope, p.id, JSON.stringify(quote())]); }
      else if (r < 0.85) { const w = 'w' + Math.floor(rnd() * 40), claimed = pick([0, 1000, 2500.5, 70000, undefined, 3]); const data = { map: 1, pending: 5000 }; if (claimed !== undefined) data.claimed = claimed; players.push({ scope, w }); await db.query('INSERT INTO ryo_adventures(scope,wallet,data) VALUES($1,$2,$3) ON CONFLICT(scope,wallet) DO UPDATE SET data=$3', [scope, w, JSON.stringify(data)]); }
      else if (players.length) { const p = players.splice(Math.floor(rnd() * players.length), 1)[0]; await db.query('DELETE FROM ryo_adventures WHERE scope=$1 AND wallet=$2', [p.scope, p.w]); }
      if (step % 10 === 0 || step === 599) await check('step ' + step);
    }
    for (const scope of scopes) {
      const store = { scope };
      assert.equal(await RP.claimedTotal(store, db), Number((await db.query(RP.OLD.claimed, [scope])).rows[0].n), 'helper claimed = original');
      assert.equal(await RP.purchaseIncome(store, db, false), Number((await db.query(RP.OLD.income, [scope])).rows[0].n), 'helper income = original');
      assert.equal(await RP.purchaseIncome(store, db, true), Number((await db.query(RP.OLD.liveIncome, [scope])).rows[0].n), 'helper live income = original');
    }
    assert.equal(RP.status().mode['claimed\u0000scope-a'], 'columns', 'verified once, then the column is used');
    assert(Number((await db.query(RP.OLD.income, ['scope-a'])).rows[0].n) > 0 && Number((await db.query(RP.OLD.claimed, ['scope-a'])).rows[0].n) > 0, 'the random data really produced non-zero totals');
    await db.close();
  }

  // ---------- 3. self-check: missing columns, mismatch; the caller's transaction stays usable
  {
    const logged = []; const err = console.error, log = console.log; console.error = m => logged.push(String(m)); console.log = () => {};
    try {
      const old = new PGlite(); await old.exec(schemaSql.replace('\n' + SCHEMA, '')); RP._reset();
      await old.query("INSERT INTO ryo_adventures(scope,wallet,data) VALUES('s','w','{\"claimed\":7}')");
      await old.query('BEGIN');
      assert.equal(await RP.claimedTotal({ scope: 's' }, old), 7, 'without the columns: the original exact sum');
      assert.equal((await old.query('SELECT 1 AS ok')).rows[0].ok, 1, 'the transaction is still usable');
      await old.query('COMMIT');
      assert(logged.some(m => /ALERT: generated columns missing/.test(m)), 'missing columns are alerted');
      assert.equal(RP.status().mode['claimed\u0000s'], 'legacy'); await old.close();

      const db = new PGlite(); await db.exec(schemaSql); RP._reset();
      await db.query("INSERT INTO ryo_adventures(scope,wallet,data) VALUES('s','w','{\"claimed\":7}')");
      const real = RP.NEW.claimed; RP.NEW.claimed = 'SELECT COALESCE(SUM(claimed_total),0)+1 AS n FROM ryo_adventures WHERE scope=$1';   // simulate a wrong fast total
      try {
        assert.equal(await RP.claimedTotal({ scope: 's' }, db), 7, 'mismatch: the original answer is returned');
        assert.equal(await RP.claimedTotal({ scope: 's' }, db), 7, 'mismatch: the process stays on the original sum');
      } finally { RP.NEW.claimed = real; }
      assert(logged.some(m => /ALERT: claimed total mismatch \(original 7, column 8\)/.test(m)), 'a mismatch is alerted');
      assert.equal(RP.status().mode['claimed\u0000s'], 'legacy');

      // ---------- 4. corrupt data: refused at confirmation instead of breaking every sync
      await db.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES('s','w','bad','summon','{}','{\"operations\":\"x\"}','{}','{}',1,'bad','w',1,'pending',1)");
      await assert.rejects(db.query("UPDATE ryo_purchases SET status='confirmed' WHERE request_id='bad'"), /invalid input syntax for type numeric/, 'a corrupt quote cannot be confirmed');
      assert.equal((await db.query("SELECT status FROM ryo_purchases WHERE request_id='bad'")).rows[0].status, 'pending', 'it stays pending');
      await db.close();
    } finally { console.error = err; console.log = log; RP._reset(); }
  }
  // Every quote the server can build has a numeric `operations` (so the refusal above can never hit a real purchase).
  {
    const economy = require(path.join(APP, 'economy.cjs'));
    let p = { heroes: [] }; for (let i = 0; i < 4; i++) p = economy.fulfill(p, economy.quote(p, 'summon', { quantity: 10 })).profile;
    const products = [['summon', { quantity: 1 }], ['summon', { quantity: 15 }]];
    for (const [product, params] of products) { const q = economy.quote(p, product, params); assert(q.operations === undefined || Number.isFinite(Number(q.operations)), product + ' quote operations is numeric: ' + q.operations); }
  }

  // ---------- 5. differential Adventure: original sums vs columns, same script, identical results
  {
    const { Store } = require(path.join(APP, 'store.cjs')), A = require(path.join(APP, 'adventure.cjs')), economy = require(path.join(APP, 'economy.cjs'));
    const wallets = [0, 1, 2].map(i => ('Wd' + i).padEnd(44, '1'));
    const profiles = wallets.map((w, i) => { let p = { heroes: [] }; for (let k = 0; k < 2 + i; k++) p = economy.fulfill(p, economy.quote(p, 'summon', { quantity: 10 })).profile; p.battleReady = p.heroes.slice(0, 5 + i).map(h => h.tokenId); return p; });
    const run = async scope => {
      const db = new PGlite(); await db.exec(schemaSql); const pool = serialPool(db);
      let now = Date.UTC(2026, 10, 11, 12); const store = new Store(pool, scope, () => now);
      if (scope === 'legacy') for (const k of ['claimed', 'income', 'liveIncome']) RP._force(k, scope, 'legacy');
      for (let i = 0; i < wallets.length; i++) { await store.profile(wallets[i]); await pool.query('UPDATE ryo_profiles SET data=$3 WHERE scope=$1 AND wallet=$2', [scope, wallets[i], JSON.stringify(profiles[i])]); }
      const rnd = seeded(7), out = [];
      const fund = (id, ops) => pool.query("INSERT INTO ryo_purchases(scope,wallet,request_id,product,params,quote,result,profile_after,amount,signature,wire,last_height,status,created) VALUES($1,$2,$3,'summon','{}',$4,'{}','{}',1,$3,'w',1,'confirmed',$5)", [scope, wallets[0], id, JSON.stringify({ operations: ops }), now]);
      await fund('seed', 250000);
      for (let step = 0; step < 90; step++) {
        now += 1500 + Math.floor(rnd() * 20000);
        const w = wallets[Math.floor(rnd() * wallets.length)], r = rnd();
        try {
          if (r < 0.1) { await fund('f' + step, 1000 + Math.floor(rnd() * 400000)); out.push(['fund', step]); }
          else if (r < 0.22) { await pool.query("UPDATE ryo_adventures SET data=jsonb_set(data,'{pending}',to_jsonb((data->>'pending')::numeric+$2)) WHERE scope=$1", [scope, Math.floor(rnd() * 300000) * 1000]); out.push(['earn', step]); }   // Chest earnings for every player
          else if (r < 0.42) out.push(['claim', step, await A.adventure(store, w, { active: false, claim: true }, 1e12)]);
          else out.push(['sync', step, await A.adventure(store, w, { active: r < 0.8 }, 1e12)]);
        } catch (e) { out.push(['error', step, e.status || null, e.message]); }
      }
      const dump = {};
      for (const t of ['ryo_adventures', 'ryo_profiles']) dump[t] = (await db.query('SELECT wallet,data FROM ' + t + ' WHERE scope=$1 ORDER BY wallet', [scope])).rows;
      dump.accounts = (await db.query('SELECT wallet,balance,bonus FROM ryo_accounts WHERE scope=$1 ORDER BY wallet', [scope])).rows;
      dump.claims = (await db.query('SELECT wallet,amount,created FROM ryo_reward_claims WHERE scope=$1 ORDER BY id', [scope])).rows;
      await db.close();
      return { out, dump };
    };
    RP._reset();
    const log = console.log; console.log = () => {};
    let legacy, columns; try { legacy = await run('legacy'); columns = await run('columns'); } finally { console.log = log; }
    assert.equal(RP.status().mode['claimed\u0000columns'], 'columns', 'the column run really used the columns');
    assert.equal(RP.status().mode['claimed\u0000legacy'], 'legacy', 'the legacy run really used the original sums');
    if (process.env.DBG) console.log(JSON.stringify(legacy.out.filter(x => x[0] !== 'sync').map(x => x[0] === 'claim' ? ['claim', x[1], x[2].credited] : x)));
    const claims = legacy.out.filter(x => x[0] === 'claim' && x[2]?.credited > 0).length, refused = legacy.out.filter(x => x[0] === 'error').length;
    assert(claims >= 3, 'the script made real claims (' + claims + ')'); assert(refused >= 1, 'and some refused ones (' + refused + ')');
    assert(legacy.dump.claims.length === claims, 'every credited claim is recorded');
    assert.deepEqual(columns.out, legacy.out, 'every Adventure/claim response is identical');
    assert.deepEqual(columns.dump, legacy.dump, 'every stored Adventure row, profile, balance and claim is identical');
    console.log('differential Adventure: ' + legacy.out.length + ' calls, ' + claims + ' claims, ' + refused + ' refused, all identical');
  }
  console.log('PASS: reward pool totals — only the two hooks and one schema block changed; 600-step randomized differential (exact); self-check falls back on missing columns or mismatch; corrupt quotes refused at confirmation; differential Adventure (syncs, claims, refusals) byte-identical.');
})().catch(e => { console.error(e); process.exit(1); });
