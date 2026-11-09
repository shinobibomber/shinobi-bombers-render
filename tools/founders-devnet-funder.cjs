/* Local DEVNET test wallet only. Stores its throwaway key under ignored tmp/; prints public data only. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const { Keypair } = require(require.resolve('@solana/web3.js', { paths: [path.join(root, 'app')] }));
const dir = path.join(root, 'tmp', 'founders-devnet'), file = path.join(dir, 'funder.json');
fs.mkdirSync(dir, { recursive: true });
let kp;
if (fs.existsSync(file)) kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8'))));
else {
  kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify([...kp.secretKey]), { flag: 'wx', mode: 0o600 });
}
console.log('DEVNET ONLY public funding address: ' + kp.publicKey.toBase58());
console.log('Request at least 2 free Devnet SOL. Never send Mainnet SOL. Key remains in ignored tmp/founders-devnet/funder.json.');
