/* Public /treasury transparency page in a real browser: verified, mismatch and unavailable states, no raw HTML
 * injection from data, copy/explorer controls, desktop + mobile layout. Data is built by the real registry and
 * verifier modules over a mocked finalized RPC (captured public Squads bytes). No wallet or network is used. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright'), web3 = require('../app/node_modules/@solana/web3.js'), spl = require('../app/node_modules/@solana/spl-token');
const R = require('../app/server/treasury-registry.cjs'), V = require('../app/server/treasury-verify.cjs'), fixture = require('./fixtures/squads-treasury-multisig.json');
/* Pre-mint display: the committed registry now has the released mint (2026-11-09); this suite checks the 'mint pending'
 * state on an isolated copy with the mint and activation reset, in this process only. */
const pendingRegistry = RM => { const raw = JSON.parse(fs.readFileSync(RM.FILE, 'utf8')); raw.srMintAddress = null; delete raw.srMintProgram; raw.activation = { approved: false, reference: null }; return RM.useForIsolatedTest(raw); };
const reg = pendingRegistry(R), DIR = path.join(__dirname, '../treasury/public'), out = path.join(__dirname, 'out');
(async () => {
  let mode = 'verified';
  // 'burns' mode: a registered throw-away mint, RYO held in the Burn Reserve and one verified burn, to prove reserved ≠ burned on screen.
  const TEST_MINT = web3.Keypair.generate().publicKey, RESERVE = reg.reserveAddresses.ryoBurnReserve, BURN_SIG = '5'.repeat(87);
  const mintAccount = () => { const d = Buffer.alloc(spl.MINT_SIZE); spl.MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: web3.PublicKey.default, supply: 999998910384672n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: web3.PublicKey.default }, d); return { owner: spl.TOKEN_PROGRAM_ID, data: d, lamports: 1 }; };
  const held = { [RESERVE]: 1417500000000n, [reg.addresses.lockedTreasury]: 288061292324334n };
  const multisig = () => { const data = Buffer.from(fixture.dataBase64, 'base64'); if (mode === 'mismatch') data.writeUInt16LE(1, 72); return { owner: new web3.PublicKey(fixture.owner), data, lamports: 1 }; };
  const connection = {
    async getGenesisHash() { if (mode === 'down') throw Error('down'); return V.MAINNET_GENESIS; },
    async getAccountInfo(k) { const a = k.toBase58(); if (a === reg.squads.multisig) return multisig(); if (a === RESERVE) return { owner: web3.SystemProgram.programId, data: Buffer.alloc(0), lamports: 1000000 }; if (a === reg.addresses.communityRewards) return { owner: web3.SystemProgram.programId, data: Buffer.alloc(0), lamports: 2500000000 }; if (a === TEST_MINT.toBase58()) return mintAccount(); return null; },
    async getParsedTokenAccountsByOwner(o) { const a = o.toBase58(); return { value: held[a] == null ? [] : [{ account: { owner: spl.TOKEN_PROGRAM_ID, data: { parsed: { info: { mint: TEST_MINT.toBase58(), owner: a, tokenAmount: { amount: String(held[a]), decimals: 6 } } } } } }] }; },
  };
  const server = http.createServer(async (req, res) => {
    const files = { '/treasury': 'index.html', '/treasury/treasury.js': 'treasury.js', '/treasury/treasury.css': 'treasury.css' };
    if (req.url === '/treasury-registry.json') {
      const view = R.publicView(); view.rules = [...view.rules, '<img src=x onerror="window.__xss=1">']; // data is rendered as text, never HTML
      const claimFunding = mode === 'verified' ? require('../app/server/treasury-rewards.cjs').claimFundingNotConfigured() : { applicable: true, status: 'unavailable', availableRyo: null, claimsOpen: false, note: 'Claim funding is temporarily unavailable.' };
      const burnReserve = mode === 'down' ? { applicable: true, status: 'unavailable', burnedRaw: null, history: [], note: 'Burn Reserve records are temporarily unavailable. Nothing is shown as burned.' }
        : mode === 'burns' ? { applicable: true, status: 'verified', burnedRaw: '2500000', burns: 1, history: [{ kind: 'burn', signature: BURN_SIG, source: RESERVE, destination: null, amountRaw: '2500000', blockTime: 1794450000 }, { kind: 'treasuryRelocation', signature: '4'.repeat(87), source: RESERVE, destination: reg.addresses.lockedTreasury, amountRaw: '288061292324334', blockTime: 1794445897 }],
            migration: { id: 'treasury-migration-2026-11', status: 'open', recordingOpen: true, note: 'Treasury relocations are internal transfers: never revenue, never burns.', legs: [{ leg: 1, from: RESERVE, to: reg.addresses.lockedTreasury, relocatedRaw: '288061292324334', transfers: 1 }] } }
        : { applicable: true, status: 'verified', burnedRaw: '0', burns: 0, history: [] };
      const verification = V.publicSummary(await V.snapshot(connection, mode === 'burns' ? { mint: TEST_MINT.toBase58() } : {}));
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ readOnly: true, prelaunch: true, paymentsEnabled: false, registry: view, verification, claimFunding, burnReserve }));
    }
    const file = files[req.url]; if (!file) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'text/css', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
    res.end(fs.readFileSync(path.join(DIR, file)));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port; let browser;
  try {
    browser = await (chromium.launch({ channel: 'chrome' })); const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/404|Content Security Policy/.test(m.text())) errors.push(m.text()); });
    await p.goto(base + '/treasury'); await p.waitForFunction(() => document.querySelector('#status').classList.contains('ok'));
    const text = await p.locator('main').innerText();
    for (const v of ['Shinobi Bombers Treasury', '50%', '30%', 'Active Reward Pool', 'Community Reward Vault', 'Content Creators Reward Pool', reg.addresses.lockedTreasury, reg.addresses.economicReserve, '2 of 3 signers', 'None (changes need a vote)', 'Not launched yet', 'Mint pending', '2.5 SOL', 'No SOL account yet',
      'Owner-approved single-key wallet: no on-chain spending restriction', 'RYO Burn Reserve', RESERVE, 'Reserve · 0% of revenue', 'Reserved RYO is not burned RYO', 'Squads vault', '#0 of ' + reg.squads.multisig])
      assert(text.includes(v), v);
    for (const m of reg.squads.members) assert(!text.includes(m), 'member keys are not shown publicly');
    assert.equal(await p.locator('#held').innerText(), 'Mint pending', 'no placeholder SR total before the mint exists');
    assert.equal(await p.locator('#custodyPanel').isVisible(), true); { const c = await p.locator('#custodyPanel').innerText(); for (const v of ['Game claim wallet', 'CqJCKKq9Q9haCtdVuHLZfCkfoDnRievuTaJ9doHatwBT', 'Created · not active until launch', 'not']) assert(c.includes(v), 'custody panel: ' + v); }
    assert.equal(await p.locator('#claimable').innerText(), 'Not configured'); assert.match(await p.locator('#claimState').innerText(), /Chest claims: CLOSED[\s\S]*SR payments: DISABLED/);
    assert.match(await p.locator('#status').innerText(), /Pre-launch: Mainnet payments and claims are disabled/);
    assert.equal(await p.evaluate(() => window.__xss), undefined, 'registry text is never interpreted as HTML');
    assert.equal(await p.locator('#treasuryCard .card').count(), 1); assert.equal(await p.locator('#wallets .card').count(), 3, 'three reward-pool wallets'); assert.equal(await p.locator('#reserveCard .card').count(), 1);
    assert.equal(await p.locator('.badge.verified').count() >= 6, true);
    assert.match(await p.locator('#treasuryCard a.btn').first().getAttribute('href'), /^https:\/\/explorer\.solana\.com\/address\/GPbg/);
    assert.match(await p.locator('#reserveCard a.btn').first().getAttribute('href'), /^https:\/\/explorer\.solana\.com\/address\/5wVB/);
    assert.deepEqual(await p.locator('header nav a').allInnerTexts(), ['Treasury', 'Reward Pool', 'RYO Burn Reserve', 'Whitepaper']);
    assert.equal(await p.locator('#reserved').innerText(), 'Unavailable', 'no reserved figure before the mint balance can be read');
    assert.equal(await p.locator('#migrationPanel').isVisible(), false, 'no migration panel without migration data');
    assert.equal(await p.locator('#burned').innerText(), '0 SR'); assert.match(await p.locator('#burnedNote').innerText(), /No RYO has been burned/);
    assert(!(await p.locator('#held').innerText()).includes('Burn'), 'held total never mixes in the reserve');
    // Reserved and burned are two different, separately labelled figures.
    mode = 'burns'; await p.reload(); await p.waitForFunction(() => document.querySelector('#reserved').textContent.includes('SR'));
    assert.equal(await p.locator('#reserved').innerText(), '1,417,500 SR'); assert.equal(await p.locator('#burned').innerText(), '2.5 SR');
    assert.equal(await p.locator('#held').innerText(), '288,061,292.324334 SR', 'held in Chapter 04 wallets excludes the Burn Reserve');
    assert.equal(await p.locator('#burns li').count(), 1, 'a relocation is never listed as a burn');
    assert.equal(await p.locator('#migrationPanel').isVisible(), true); { const t = await p.locator('#migrationLegs').innerText(); assert.match(t, /Leg 1: 5wVB[\s\S]*288,061,292\.324334 SR relocated in 1 verified transfer/); assert.doesNotMatch(t, /Leg 2/); } assert.match(await p.locator('#burns').innerText(), /2\.5 SR burned/);
    assert.equal(await p.locator('#burns a').getAttribute('href'), 'https://explorer.solana.com/tx/' + BURN_SIG);
    fs.mkdirSync(out, { recursive: true }); await p.screenshot({ path: path.join(out, 'treasury-page-burn-reserve.png'), fullPage: true });
    mode = 'verified'; await p.reload(); await p.waitForFunction(() => document.querySelector('#status').classList.contains('ok'));
    fs.mkdirSync(out, { recursive: true }); await p.screenshot({ path: path.join(out, 'treasury-page-desktop.png'), fullPage: true });
    await p.setViewportSize({ width: 390, height: 844 }); await p.screenshot({ path: path.join(out, 'treasury-page-mobile.png'), fullPage: true });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow on mobile');
    // Governance drift: shown as an attention state.
    mode = 'mismatch'; await p.reload(); await p.waitForFunction(() => document.querySelector('#status').classList.contains('bad'));
    assert.match(await p.locator('#status').innerText(), /differs from the published registry/); assert.match(await p.locator('#squads').innerText(), /MISMATCH/);
    // RPC unavailable: nothing is shown as verified and balances are not zero.
    mode = 'down'; await p.reload(); await p.waitForFunction(() => document.querySelector('#status').classList.contains('warn'));
    assert.match(await p.locator('#status').innerText(), /temporarily unavailable/); assert.equal(await p.locator('#claimable').innerText(), 'Unavailable'); assert.equal(await p.locator('#held').innerText(), 'Unavailable'); assert.equal(await p.locator('.badge.verified').count(), 0); assert(!(await p.locator('#wallets').innerText()).includes('0 SOL'));
    assert.equal(await p.locator('#burned').innerText(), 'Unavailable', 'unavailable burn records are never shown as 0'); assert.equal(await p.locator('#reserved').innerText(), 'Unavailable');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(r => server.close(r)); }
  console.log('PASS: public treasury page — Treasury / Reward Pool / RYO Burn Reserve sections, reserved ≠ burned (separate figures, relocations never listed as burns), verified / mismatch / unavailable states, text-only rendering, hidden member keys, explorer links, desktop + mobile layout.');
})().catch(e => { console.error(e); process.exitCode = 1; });
