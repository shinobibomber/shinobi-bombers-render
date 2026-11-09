'use strict';
/* The full live financial-server run (fee-free deposits, 50/30/10/10 SR routing, Boss Hunt, withdrawals, claims) on a
 * Token-2022 SR mint, as released on Mainnet (8Azsv…pump: MetadataPointer + TokenMetadata only). */
const { spawnSync } = require('node:child_process'), path = require('node:path');
const result = spawnSync(process.execPath, [path.join(__dirname, 'financial-server.cjs'), '--token-2022'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
console.log('PASS: live financial server on a Token-2022 SR mint (deposits, routing, payouts and burns use the Token-2022 program).');
