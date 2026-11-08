const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const suites=['preservation.cjs','transaction-review.cjs','wallet-vm.cjs','financial-server.cjs','gameplay-options-server.cjs','realtime-rewards-guard.cjs','chat-server.cjs','market-server.cjs','boss-hunt-server.cjs','mythic-hero-server.cjs','mythic-hero-assets.cjs','mythic-box-server.cjs','starter-pack-server.cjs','display-settings-server.cjs','browser.cjs','summon-reveal.cjs','heroes-navigation.cjs','login-loading.cjs','menu-layout.cjs','hero-portraits.cjs','adventure-rendering.cjs','render-performance.cjs','aura-rendering.cjs','map-render-quality.cjs','fusion-limits.cjs','training.cjs','hero-identity.cjs','market.cjs','sensei-rotation.cjs','mobile-layout.cjs','smoke-sweep.cjs','boss-summon.cjs','mythic-hero.cjs','mythic-box.cjs','display-settings.cjs','live-rewards.cjs','dojo-services.cjs'];
suites.push('economic-dashboard.cjs');
suites.push('gas-preflight.cjs');
suites.push('creators-server.cjs','creators-portal.cjs');
suites.push('player-referrals.cjs');
suites.push('network-guard.cjs');
suites.push('sr-revenue.cjs','sr-revenue-ui.cjs');
suites.push('beta-economy.cjs');
suites.push('referral-bound.cjs','prelaunch-server.cjs','prelaunch-creators.cjs','prelaunch-page.cjs');
suites.push('prelaunch-wallet-security.cjs');
suites.push('treasury-registry.cjs','treasury-live-rewards.cjs','treasury-prelaunch.cjs','treasury-page.cjs');
if(fs.existsSync(path.join(__dirname,'archive.cjs')))suites.unshift('archive.cjs');
console.log('Global Chest regression runner · Node '+process.version+' · isolated fixtures only');
for(const name of suites){console.log('\nRunning '+name);const result=spawnSync(process.execPath,[path.join(__dirname,name)],{stdio:'inherit',env:process.env});if(result.status!==0){console.error('FAILED: '+name);process.exit(result.status||1)}}
console.log('\nPASS: all '+suites.length+' Global Chest suites. No real wallet or external service transaction was executed.');
