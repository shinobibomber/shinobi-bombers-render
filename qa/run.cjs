const {spawnSync}=require('node:child_process'),path=require('node:path');
const tests=['test-v3-integration.cjs','test-v3-chest-safety.cjs','test-v3-feature-components.cjs','test-v3-summoning.cjs','test-v3-market.cjs','test-v3-native-adventure.cjs','test-v3-animation-browser.cjs','test-gameplay-options-server.cjs','test-gameplay-options-browser.cjs'];
for(const test of tests){console.log('\nRunning '+test);const run=spawnSync(process.execPath,[path.join(__dirname,test)],{stdio:'inherit',env:process.env});if(run.status!==0){console.error('FAILED: '+test);process.exit(run.status||1)}}
console.log('\nAll V3 regression suites passed. Wallet and financial browser tests use isolated simulated API responses.');
