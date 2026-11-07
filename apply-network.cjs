/* Network build step (runs last among the feature steps, before apply-performance).
 *
 * Every build: copy network/network.cjs to app/server/network.cjs and stamp app/server/network-build.json.
 * SOLANA_NETWORK unset or "devnet": nothing else changes, so the test server's build is byte-for-byte the
 * same as before this step existed.
 * SOLANA_NETWORK=mainnet (the live server): exact-string patches that remove the Devnet-only tester tools,
 * hard-disable the Starter Pack and guard render-server.cjs, then the Mainnet text rules from network.cjs
 * over the client and server files. The build fails if any Devnet genesis, RPC, cluster link, test-token
 * wording or "Devnet" text is left behind.
 */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const network = require('./network/network.cjs');

// [file (relative to app/), before, after, count]
const mainnetPatches = [
  ['public/index.html',
   '<p class="beta-note">Get tBRYO from the organizer and Devnet SOL for deposit fees. Withdrawals use the treasury\'s Devnet SOL. Tokens are for testing only.</p><div class="beta-links"><a href="deploy.html" target="_blank" rel="noopener noreferrer">Token setup ↗</a><a href="RYO-SETUP.html" target="_blank" rel="noopener noreferrer">Deposit / withdrawal setup ↗</a></div>',
   '<p class="beta-note">Deposits need a little SOL in your wallet for network fees. Withdrawals are paid from the game treasury.</p>', 1],
  // Token creation and tester airdrops are Devnet organizer tools; the Mainnet mint is created off-site.
  ['public/index.html', 'async function deploy(){', 'async function deploy(){throw Error(\'Token setup is disabled on the live server.\');', 1],
  ['public/index.html', 'async function distribute(recipient){', 'async function distribute(recipient){throw Error(\'Tester distribution is disabled on the live server.\');', 1],
  ['public/assets/beta-wallet.js', 'async function deploy(){', 'async function deploy(){throw Error(\'Token setup is disabled on the live server.\');', 1],
  ['public/assets/beta-wallet.js', 'async function distribute(recipient){', 'async function distribute(recipient){throw Error(\'Tester distribution is disabled on the live server.\');', 1],
  // Accounts live under a fixed RYO_SCOPE (set at pre-launch), not one derived from the mint and treasury.
  ['server/netlify-handler.cjs', "const scope='solana-devnet:'+RYO_TOKEN_MINT+':'+treasury.publicKey.toBase58()", 'const scope=process.env.RYO_SCOPE', 1],
  // The Starter Pack grants free Ryo and heroes: off on Mainnet whatever the environment says.
  ['server/starter-pack.cjs', 'const enabled = (env = process.env) => /^(1|on|true|yes)$/i.test(String(env.STARTER_PACK || \'\'));', 'const enabled = () => false;', 1],
  // `npm run start:game-only` also refuses to start with an unsafe Mainnet environment.
  ['server/render-server.cjs', "function createServer({publicRoot=path.resolve(__dirname,'../public'),handler=require('./netlify-handler.cjs').handler}={}){",
   "function createServer({publicRoot=path.resolve(__dirname,'../public'),handler=require('./netlify-handler.cjs').handler}={}){require('./network.cjs').assertStartup();", 1],
];

// Devnet organizer tools and test-token documents: not served by the live server.
const MAINNET_REMOVED = ['public/deploy.html', 'public/SETUP.html', 'public/RYO-SETUP.html', 'public/RYO-SETUP.md', 'public/BETA-SETUP.md', 'public/contracts/SOLANA-TOKEN.json', 'public/beta-config.json'];
// The served Solana SDK keeps its own cluster URL table, and network.cjs holds both networks: never rewrite them.
const SKIP = new Set(['public/assets/solana-sdk.js', 'server/network.cjs']);
const TEXT = /\.(html|js|cjs|json|md|txt|css)$/;

function patchOnce(text, [file, before, after, count]) {
  if (text.split(after).length - 1 === count && (!text.includes(before) || after.includes(before))) return text;
  const n = text.split(before).length - 1;
  if (n !== count) throw Error('Network patch mismatch: ' + file + ' "' + before.slice(0, 60) + '" (' + n + ')');
  return text.split(before).join(after);
}

function files(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? rel + '/' + entry.name : entry.name;
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...files(dir, child)); }
    else if (TEXT.test(entry.name)) out.push(child);
  }
  return out;
}

function applyNetwork(appDir = path.join(__dirname, 'app'), env = process.env) {
  const net = network.resolve(env);
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(__dirname, 'network/network.cjs'), path.join(server, 'network.cjs'));
  fs.writeFileSync(path.join(server, 'network-build.json'), JSON.stringify({ network: net.key }) + '\n');
  if (net.key === 'devnet') { console.log('Network: Solana Devnet (test server build).'); return net; }

  if (!/^https:\/\//.test(String(env.RYO_SITE_ORIGIN || ''))) throw Error('Mainnet build: set RYO_SITE_ORIGIN to the live https:// origin before building (the Mythic Box NFT metadata is baked with it).');
  for (const patch of mainnetPatches) {
    const p = path.join(appDir, patch[0]);
    fs.writeFileSync(p, patchOnce(fs.readFileSync(p, 'utf8'), patch));
  }
  for (const rel of MAINNET_REMOVED) fs.rmSync(path.join(appDir, rel), { force: true });

  const rules = network.mainnetRules(env), leftovers = [];
  for (const top of ['public', 'server']) for (const rel of files(appDir, top)) {
    if (SKIP.has(rel)) continue;
    const p = path.join(appDir, rel), before = fs.readFileSync(p, 'utf8'), after = network.rewriteText(before, rel, rules);
    if (after !== before) fs.writeFileSync(p, after);
    if (network.MAINNET_LEFTOVERS.test(after)) leftovers.push(rel + ': ' + after.match(network.MAINNET_LEFTOVERS)[0]);
  }
  if (leftovers.length) throw Error('Mainnet build still references Devnet/test tokens:\n - ' + leftovers.join('\n - '));
  console.log('Network: Solana Mainnet (live server build). Devnet tester tools removed; Starter Pack disabled.');
  return net;
}

module.exports = { applyNetwork, mainnetPatches, MAINNET_REMOVED };
if (require.main === module) applyNetwork();
