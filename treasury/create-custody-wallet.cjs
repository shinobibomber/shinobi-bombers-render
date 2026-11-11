/* Create the LIVE (Mainnet) game custody wallet: the server's hot wallet for player deposits and the approved
 * reward float (RYO_TREASURY_SECRET). Run it yourself, on your own computer:
 *
 *   node treasury/create-custody-wallet.cjs D:\Private\shinobi-custody-mainnet.env
 *
 * It writes the secret key ONLY to that file (refuses to overwrite, refuses any path inside this project) and
 * prints ONLY the public address. Nothing is sent anywhere. A Solana keypair is the same on every network.
 * Requires a built app/ (npm run build) for @solana/web3.js.
 */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!target) { console.error('Usage: node treasury/create-custody-wallet.cjs <private file OUTSIDE this project>'); process.exit(2); }
if (target === ROOT || target.startsWith(ROOT + path.sep)) { console.error('Refusing: the key file must be outside the project folder (it could be committed or uploaded).'); process.exit(2); }
if (fs.existsSync(target)) { console.error('Refusing: ' + target + ' already exists. A custody key is never overwritten.'); process.exit(2); }
if (!fs.existsSync(path.dirname(target))) { console.error('Create the folder first: ' + path.dirname(target)); process.exit(2); }
const { Keypair } = require(require.resolve('@solana/web3.js', { paths: [path.join(ROOT, 'app', 'server')] }));
const wallet = Keypair.generate();
fs.writeFileSync(target, '# PRIVATE — Shinobi Bombers LIVE game custody wallet. Never share, upload, commit or screenshot this file.\n' +
  '# Paste only the bracketed value into Render → ShinobiBombers → Environment → RYO_TREASURY_SECRET, on launch day.\n' +
  'RYO_TREASURY_SECRET=' + JSON.stringify(Array.from(wallet.secretKey)) + '\n', { flag: 'wx', mode: 0o600 });
console.log('Mainnet game custody wallet — PUBLIC address: ' + wallet.publicKey.toBase58());
console.log('Private key saved to: ' + target);
console.log('Next:');
console.log(' 1. Back this file up offline (encrypted USB or password manager).');
console.log(' 2. Share only the PUBLIC address. Record it in treasury/treasury-registry.json (gameCustody) via a reviewed commit.');
console.log(' 3. Do not add it to Render while PRELAUNCH_MODE is on; add RYO_TREASURY_SECRET on launch day.');
console.log(' 4. Never import it into Phantom, sign in with it, use it as an admin wallet or add it as a Squads signer.');
console.log(' 5. Fund at launch: ~0.05–0.1 SOL for fees; SR only through approved top-ups from the Active Reward Pool.');
