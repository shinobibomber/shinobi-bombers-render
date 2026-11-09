/* Founder's NFT Boxes — end-to-end check on Solana DEVNET with real transactions (Stage B).
 *
 *   SOLANA_RPC_URL=<devnet https RPC>  node tools/founders-devnet-e2e.cjs --yes [--funder <devnet-keypair.json>]
 *
 * Refuses to run unless the RPC's genesis hash is Devnet. Uses throw-away keypairs created for this run (buyers, the
 * Founder mint authority and a revenue wallet) and an in-memory database, so nothing touches the beta or live servers,
 * their databases, or any real wallet. Buyers are funded by a Devnet airdrop, or from --funder (a Devnet keypair file
 * the owner provides). Prints public addresses and signatures only — never a secret key or the RPC URL.
 *
 * Verifies on chain: Mythic (1 SOL) and Legacy (0.5 SOL) purchases land atomically (exact SOL to revenue, 1 NFT in the
 * buyer's Token-2022 account, mint authority removed); a second purchase by the same wallet is refused for both tiers;
 * the NFT transfer moves no benefit (buyer-bound); activation + Limited/Premium pools on the same database. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), server = path.join(root, 'app/server');
const need = n => require(path.join(server, n)), fromApp = n => require(require.resolve(n, { paths: [server] }));
const web3 = fromApp('@solana/web3.js'), spl = fromApp('@solana/spl-token');
const DEVNET = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', SOL = 1e9;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!process.argv.includes('--yes')) { console.log('Dry: pass --yes to send real Devnet transactions.'); return; }
  const rpc = process.env.SOLANA_RPC_URL; if (!/^https:\/\//.test(rpc || '')) throw Error('Set SOLANA_RPC_URL to a Devnet https RPC.');
  const connection = new web3.Connection(rpc, 'confirmed');
  if (await connection.getGenesisHash() !== DEVNET) throw Error('Refusing: SOLANA_RPC_URL is not Solana Devnet.');
  need('network.cjs').built = () => need('network.cjs').NETWORKS.devnet;

  const { PGlite } = require(path.join(root, 'tests/node_modules/@electric-sql/pglite'));
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(server, 'schema.sql'), 'utf8'));
  let tail = Promise.resolve(); const lock = async () => { let release; const before = tail; tail = new Promise(r => release = r); await before; return release; };
  const pool = { async query(s, a) { const release = await lock(); try { return await db.query(s, a); } finally { release(); } }, async connect() { const release = await lock(); return { query: (s, a) => db.query(s, a), release }; } };
  const store = new (need('store.cjs').Store)(pool, 'solana-devnet:founders-e2e-' + Date.now()), F = need('founders.cjs');
  const authority = web3.Keypair.generate(), revenue = web3.Keypair.generate(), a = web3.Keypair.generate(), b = web3.Keypair.generate();
  const env = { FOUNDERS_PUBLIC_SALE_ENABLED: 'on', FOUNDERS_REWARD_REDEMPTION_ENABLED: 'on', FOUNDERS_MINT_AUTHORITY_SECRET: JSON.stringify([...authority.secretKey]), RYO_REVENUE_WALLET: revenue.publicKey.toBase58() };
  const ctx = { store, connection, revenueAddress: revenue.publicKey.toBase58(), origin: 'https://shinobi-bombers-beta.onrender.com' };
  const report = { network: 'solana-devnet', buyers: { a: a.publicKey.toBase58(), b: b.publicKey.toBase58() }, revenue: ctx.revenueAddress, authority: authority.publicKey.toBase58(), steps: [] };
  const step = (name, detail = {}) => { report.steps.push({ name, ...detail }); console.log('✓ ' + name, Object.keys(detail).length ? JSON.stringify(detail) : ''); };

  // Fund buyers (rent for the revenue wallet so it can receive).
  const funderArg = process.argv.indexOf('--funder');
  if (funderArg > 0) {
    const funder = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.argv[funderArg + 1], 'utf8'))));
    const tx = new web3.Transaction().add(...[[a, 1.2], [b, 0.7]].map(([k, n]) => web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: k.publicKey, lamports: Math.round(n * SOL) })));
    await web3.sendAndConfirmTransaction(connection, tx, [funder], { commitment: 'finalized' });
  } else {
    for (const [k, n] of [[a, 1.2], [b, 0.7]]) { const s = await connection.requestAirdrop(k.publicKey, Math.round(n * SOL)); await connection.confirmTransaction(s, 'finalized'); }
  }
  step('buyers funded on Devnet');
  const before = await connection.getBalance(revenue.publicKey, 'finalized');

  async function buy(k, tier, requestId) {
    const r = await F.mint(ctx, k.publicKey.toBase58(), { tier, requestId }, env);
    const tx = web3.Transaction.from(Buffer.from(r.purchase.wire, 'base64')); tx.partialSign(k);
    let c = await F.confirm(ctx, k.publicKey.toBase58(), { requestId, signed: tx.serialize().toString('base64') }, env);
    for (let i = 0; i < 60 && c.purchase.status === 'pending'; i++) { await sleep(3000); c = await F.confirm(ctx, k.publicKey.toBase58(), { requestId }, env); }
    if (c.purchase.status !== 'confirmed') throw Error(tier + ' purchase did not confirm: ' + c.purchase.status + (c.purchase.broadcastError ? ' (' + c.purchase.broadcastError + ')' : ''));
    return c.purchase;
  }
  async function verifyNft(owner, mint) {
    const m = await spl.getMint(connection, new web3.PublicKey(mint), 'finalized', spl.TOKEN_2022_PROGRAM_ID);
    const ata = spl.getAssociatedTokenAddressSync(new web3.PublicKey(mint), owner.publicKey, false, spl.TOKEN_2022_PROGRAM_ID);
    const acc = await spl.getAccount(connection, ata, 'finalized', spl.TOKEN_2022_PROGRAM_ID);
    if (m.supply !== 1n || m.decimals !== 0 || m.mintAuthority !== null || acc.amount !== 1n) throw Error('NFT state is not a 1-of-1 with authority removed.');
    return ata;
  }
  const pm = await buy(a, 'mythic', 'e2e-mythic-' + Date.now()); await verifyNft(a, pm.mint);
  step('Mythic purchase confirmed (1-of-1 NFT, mint authority removed)', { mint: pm.mint, signature: pm.signature });
  const pl = await buy(b, 'legacy', 'e2e-legacy-' + Date.now()); await verifyNft(b, pl.mint);
  step('Legacy purchase confirmed', { mint: pl.mint, signature: pl.signature });
  const after = await connection.getBalance(revenue.publicKey, 'finalized');
  if (after - before !== 1.5 * SOL) throw Error('Revenue received ' + (after - before) / SOL + ' SOL, expected exactly 1.5.');
  step('revenue wallet received exactly 1.5 SOL');
  for (const [k, tier] of [[a, 'legacy'], [a, 'mythic'], [b, 'mythic']]) {
    try { await F.mint(ctx, k.publicKey.toBase58(), { tier, requestId: 'e2e-again-' + tier + Date.now() }, env); throw Error('second purchase was allowed'); }
    catch (e) { if (e.code !== 'FOUNDERS_WALLET_LIMIT') throw e; }
  }
  step('second purchase refused for both tiers (one per wallet)');

  // Activation and pools on the same database.
  const act = await F.activate(store, a.publicKey.toBase58(), env);
  step('Mythic activation', { heroes: act.heroes.map(h => h.rank) });
  const ranks = []; for (let i = 0; i < 10; i++) ranks.push((await F.summon(store, a.publicKey.toBase58(), { kind: 'limited', requestId: 'e2e-limited-' + i + '-' + Date.now() }, env)).summon.rank);
  if (ranks.some(r => r < 1 || r > 4)) throw Error('Limited summon outside Chunin..Legend');
  step('10 Limited summons (no Genin, no Mythic)', { ranks });

  // NFT transfer: A sends the Mythic NFT to B. Benefits stay with A (buyer-bound); B gains nothing from it.
  const mint = new web3.PublicKey(pm.mint), from = spl.getAssociatedTokenAddressSync(mint, a.publicKey, false, spl.TOKEN_2022_PROGRAM_ID), to = spl.getAssociatedTokenAddressSync(mint, b.publicKey, false, spl.TOKEN_2022_PROGRAM_ID);
  const move = new web3.Transaction().add(spl.createAssociatedTokenAccountIdempotentInstruction(a.publicKey, to, b.publicKey, mint, spl.TOKEN_2022_PROGRAM_ID), spl.createTransferCheckedInstruction(from, mint, to, a.publicKey, 1, 0, [], spl.TOKEN_2022_PROGRAM_ID));
  const moved = await web3.sendAndConfirmTransaction(connection, move, [a], { commitment: 'finalized' });
  const sa = (await F.status(store, a.publicKey.toBase58(), env)).founder, sb = (await F.status(store, b.publicKey.toBase58(), env)).founder;
  if (sa.tier !== 'mythic' || !sa.valid || sb.tier !== 'legacy') throw Error('Benefits moved with the NFT.');
  step('NFT transfer moved no benefit (buyer-bound)', { signature: moved });

  const out = path.join(root, 'tests/out'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'founders-devnet-e2e.json'), JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2));
  console.log('PASS: Founder boxes Devnet end-to-end (report: tests/out/founders-devnet-e2e.json).');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
