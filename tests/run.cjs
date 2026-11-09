const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const suites=['preservation.cjs','transaction-review.cjs','wallet-vm.cjs','financial-server.cjs','gameplay-options-server.cjs','realtime-rewards-guard.cjs','chat-server.cjs','chat-screen.cjs','market-server.cjs','boss-hunt-server.cjs','mythic-hero-server.cjs','mythic-hero-assets.cjs','mythic-box-server.cjs','starter-pack-server.cjs','display-settings-server.cjs','browser.cjs','summon-reveal.cjs','heroes-navigation.cjs','login-loading.cjs','menu-layout.cjs','hero-portraits.cjs','adventure-rendering.cjs','render-performance.cjs','aura-rendering.cjs','map-render-quality.cjs','fusion-limits.cjs','training.cjs','hero-identity.cjs','market.cjs','sensei-rotation.cjs','mobile-layout.cjs','smoke-sweep.cjs','boss-summon.cjs','mythic-hero.cjs','mythic-box.cjs','display-settings.cjs','live-rewards.cjs','dojo-services.cjs'];
suites.push('economic-dashboard.cjs');
suites.push('gas-preflight.cjs');
suites.push('creators-server.cjs','creators-portal.cjs');
suites.push('player-referrals.cjs');
suites.push('network-guard.cjs');
suites.push('sr-revenue.cjs','sr-revenue-ui.cjs');
suites.push('beta-economy.cjs');
suites.push('referral-bound.cjs','prelaunch-server.cjs','prelaunch-creators.cjs','prelaunch-page.cjs','private-testing.cjs');
suites.push('prelaunch-wallet-security.cjs');
suites.push('treasury-registry.cjs','treasury-live-rewards.cjs','treasury-prelaunch.cjs','treasury-page.cjs');
suites.push('creator-referral-sync.cjs');
suites.push('mythic-animation-controller.cjs','mythic-animation.cjs');
suites.push('mythic-motion-v3.cjs');
suites.push('mythic-expressions.cjs');
suites.push('combat-rules.cjs','combat-identity.cjs','combat-native.cjs','combat-adventure.cjs','combat-hunt.cjs');
suites.push('hero-upgrades-server.cjs','hero-upgrades-ui.cjs');
suites.push('founders-server.cjs','founders-prelaunch.cjs','founders-pricing-ui.cjs');
suites.push('canonical-host.cjs');
suites.push('live-economy.cjs');
if(fs.existsSync(path.join(__dirname,'archive.cjs')))suites.unshift('archive.cjs');
suites.unshift('archive-download.cjs');
suites.push('adventure-hero-size.cjs','mythic-vfx-v6.cjs');
suites.push('mythic-automatic-skills.cjs','mythic-skill-rotation.cjs','mythic-completion.cjs','mythic-mode-rotation.cjs');
suites.push('mythic-poster-release.cjs');
suites.push('command-center-server.cjs','command-center-ui.cjs');
console.log('Global Chest regression runner · Node '+process.version+' · isolated fixtures only');
const concurrency=Math.max(1,Math.min(2,Number(process.env.SHINOBI_TEST_CONCURRENCY)||1));
if(concurrency===1){
for(const name of suites){console.log('\nRunning '+name);const result=spawnSync(process.execPath,[path.join(__dirname,name)],{stdio:'inherit',env:process.env});if(result.status!==0){console.error('FAILED: '+name);process.exit(result.status||1)}}
console.log('\nPASS: all '+suites.length+' Global Chest suites. No real wallet or external service transaction was executed.');

}else{(async()=>{
 let cursor=0,failed=0;
 async function worker(){while(!failed&&cursor<suites.length){const name=suites[cursor++];console.log('Running '+name);const status=await new Promise(resolve=>{const child=require('node:child_process').spawn(process.execPath,[path.join(__dirname,name)],{stdio:'inherit',env:process.env});child.once('error',error=>{console.error(error);resolve(1)});child.once('exit',code=>resolve(code??1))});if(status!==0){console.error('FAILED: '+name);failed=status;}}}
 await Promise.all(Array.from({length:concurrency},()=>worker()));if(failed)process.exitCode=failed;else console.log('PASS: all '+suites.length+' Global Chest suites with '+concurrency+' isolated workers. No real wallet or external service transaction was executed.');
})().catch(error=>{console.error(error);process.exitCode=1});}
