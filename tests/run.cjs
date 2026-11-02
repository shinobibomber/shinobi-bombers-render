const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const suites=['preservation.cjs','transaction-review.cjs','wallet-vm.cjs','financial-server.cjs','gameplay-options-server.cjs','browser.cjs','summon-reveal.cjs','heroes-navigation.cjs','login-loading.cjs','menu-layout.cjs','hero-portraits.cjs','adventure-rendering.cjs','render-performance.cjs','aura-rendering.cjs','map-render-quality.cjs'];
if(fs.existsSync(path.join(__dirname,'archive.cjs')))suites.unshift('archive.cjs');
console.log('Global Chest regression runner · Node '+process.version+' · isolated fixtures only');
for(const name of suites){console.log('\nRunning '+name);const result=spawnSync(process.execPath,[path.join(__dirname,name)],{stdio:'inherit',env:process.env});if(result.status!==0){console.error('FAILED: '+name);process.exit(result.status||1)}}
console.log('\nPASS: all '+suites.length+' Global Chest suites. No real wallet or external service transaction was executed.');
