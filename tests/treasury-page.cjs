/* Public /treasury transparency page in a real browser: verified, mismatch and unavailable states, no raw HTML
 * injection from data, copy/explorer controls, desktop + mobile layout. Data is built by the real registry and
 * verifier modules over a mocked finalized RPC (captured public Squads bytes). No wallet or network is used. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright'), web3 = require('../app/node_modules/@solana/web3.js');
const R = require('../app/server/treasury-registry.cjs'), V = require('../app/server/treasury-verify.cjs'), fixture = require('./fixtures/squads-treasury-multisig.json');
const reg = R.registry(), DIR = path.join(__dirname, '../treasury/public'), out = path.join(__dirname, 'out');
(async () => {
  let mode = 'verified';
  const multisig = () => { const data = Buffer.from(fixture.dataBase64, 'base64'); if (mode === 'mismatch') data.writeUInt16LE(1, 72); return { owner: new web3.PublicKey(fixture.owner), data, lamports: 1 }; };
  const connection = {
    async getGenesisHash() { if (mode === 'down') throw Error('down'); return V.MAINNET_GENESIS; },
    async getAccountInfo(k) { const a = k.toBase58(); if (a === reg.squads.multisig) return multisig(); if (a === reg.addresses.lockedTreasury) return { owner: web3.SystemProgram.programId, data: Buffer.alloc(0), lamports: 1000000 }; if (a === reg.addresses.communityRewards) return { owner: web3.SystemProgram.programId, data: Buffer.alloc(0), lamports: 2500000000 }; return null; },
  };
  const server = http.createServer(async (req, res) => {
    const files = { '/treasury': 'index.html', '/treasury/treasury.js': 'treasury.js', '/treasury/treasury.css': 'treasury.css' };
    if (req.url === '/treasury-registry.json') {
      const view = R.publicView(); view.rules = [...view.rules, '<img src=x onerror="window.__xss=1">']; // data is rendered as text, never HTML
      const claimFunding = mode === 'verified' ? require('../app/server/treasury-rewards.cjs').claimFundingNotConfigured() : { applicable: true, status: 'unavailable', availableRyo: null, claimsOpen: false, note: 'Claim funding is temporarily unavailable.' };
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ readOnly: true, prelaunch: true, paymentsEnabled: false, registry: view, verification: V.publicSummary(await V.snapshot(connection)), claimFunding }));
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
    for (const v of ['Locked Treasury (Squads Account 1)', '50%', '30%', 'Active Reward Pool', 'Community Reward Vault', 'Economic Stability Reserve', reg.addresses.lockedTreasury, reg.addresses.economicReserve, '2 of 3 signers', 'None (changes need a vote)', 'Not launched yet', 'Mint pending', '2.5 SOL', 'Not funded yet'])
      assert(text.includes(v), v);
    for (const m of reg.squads.members) assert(!text.includes(m), 'member keys are not shown publicly');
    assert.equal(await p.locator('#held').innerText(), 'Mint pending', 'no placeholder SR total before the mint exists');
    assert.equal(await p.locator('#claimable').innerText(), 'Not configured'); assert.match(await p.locator('#claimState').innerText(), /Chest claims: CLOSED[\s\S]*SR payments: DISABLED/);
    assert.match(await p.locator('#status').innerText(), /Pre-launch: Mainnet payments and claims are disabled/);
    assert.equal(await p.evaluate(() => window.__xss), undefined, 'registry text is never interpreted as HTML');
    assert.equal(await p.locator('#wallets .card').count(), 4); assert.equal(await p.locator('.badge.verified').count() >= 5, true);
    assert.match(await p.locator('#wallets a.btn').first().getAttribute('href'), /^https:\/\/explorer\.solana\.com\/address\/5wVB/);
    fs.mkdirSync(out, { recursive: true }); await p.screenshot({ path: path.join(out, 'treasury-page-desktop.png'), fullPage: true });
    await p.setViewportSize({ width: 390, height: 844 }); await p.screenshot({ path: path.join(out, 'treasury-page-mobile.png'), fullPage: true });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow on mobile');
    // Governance drift: shown as an attention state.
    mode = 'mismatch'; await p.reload(); await p.waitForFunction(() => document.querySelector('#status').classList.contains('bad'));
    assert.match(await p.locator('#status').innerText(), /differs from the published registry/); assert.match(await p.locator('#squads').innerText(), /MISMATCH/);
    // RPC unavailable: nothing is shown as verified and balances are not zero.
    mode = 'down'; await p.reload(); await p.waitForFunction(() => document.querySelector('#status').classList.contains('warn'));
    assert.match(await p.locator('#status').innerText(), /temporarily unavailable/); assert.equal(await p.locator('#claimable').innerText(), 'Unavailable'); assert.equal(await p.locator('#held').innerText(), 'Unavailable'); assert.equal(await p.locator('.badge.verified').count(), 0); assert(!(await p.locator('#wallets').innerText()).includes('0 SOL'));
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(r => server.close(r)); }
  console.log('PASS: public treasury page — verified / mismatch / unavailable states, text-only rendering, hidden member keys, explorer links, desktop + mobile layout.');
})().catch(e => { console.error(e); process.exitCode = 1; });
