/* Frozen hashes from maintained main, not from the stopped broad V3 branch. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),baseline=require('./baseline-hashes.json');
const root=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
for(const file of baseline.files){assert.equal(sha(fs.readFileSync(path.join(root,file.path))),file.sha256,'unchanged maintained game/server/visual file: '+file.path);if(file.path.startsWith('map-design/'))assert.equal(sha(fs.readFileSync(path.join(root,'app/public/assets',file.path))),file.sha256,'generated map remains the original baseline: '+file.path);}
let html=fs.readFileSync(path.join(root,'app/public/index.html'),'utf8');
// The last build step points image URLs at their WebP versions; restore the original names first.
html=require('../apply-performance.cjs').restoreReferences(html);
// Launch gates and referral-bound heroes (applied after the Creators Portal): reverse them first.
const {gateClientPatches}=require('../apply-launch-gates.cjs');
for(const [before,after,count]of gateClientPatches.slice().reverse()){assert.equal(html.split(after).length-1,count,'exact launch gate client hook');html=html.split(after).join(before)}
const {boundClientPatches}=require('../apply-referral-bound.cjs');
for(const [before,after,count]of boundClientPatches.slice().reverse()){assert.equal(html.split(after).length-1,count,'exact referral-bound client hook');html=html.split(after).join(before)}
const {creatorPatches}=require('../apply-creators-portal.cjs');
for(const [before,after,count]of creatorPatches.slice().reverse()){assert.equal(html.split(after).length-1,count,'exact authenticated Creators Portal hook');html=html.split(after).join(before)}
const {walletPatches,apiPatches}=require('../apply-transaction-safety.cjs');
for(const [before,after]of [...walletPatches,...apiPatches].reverse()){assert.equal(html.split(after).length-1,1,'one reviewed SOL gas preflight hook');html=html.replace(after,()=>before)}
// Mythic hero (applied after Boss Hunt): the sixth rank's table entries, colours and NFT link.
// Display & Accessibility (applied last among the feature steps): presentation hooks only.
const {displayPatches}=require('../apply-display-settings.cjs');
for(const [before,after,count]of displayPatches.slice().reverse()){assert.equal(html.split(after).length-1,count,'exact display settings hook: '+before.slice(0,40));html=html.split(after).join(before)}
// Starter pack (applied after the Mythic Box): starter Ryo in the client state.
const {starterPatches}=require('../apply-starter-pack.cjs');
for(const [before,after,count]of starterPatches.slice().reverse()){assert.equal(html.split(after).length-1,count,'exact starter pack hook');html=html.split(after).join(before)}
// Mythic Box (applied after the Mythic hero): RyoPayments.box.
const {boxPatches}=require('../apply-mythic-box.cjs');
for(const [before,after,count]of boxPatches.slice().reverse()){assert.equal(html.split(after).length-1,count,'exact Mythic Box hook');html=html.split(after).join(before)}
const {mythicPatches}=require('../apply-mythic-hero.cjs');
for(const [before,after,count]of mythicPatches.slice().reverse()){assert.equal(html.split(after).length-1,count,'exact Mythic hero hook: '+before.slice(0,40));html=html.split(after).join(before)}
// Reverse only the reviewed cinematic presentation hooks, then compare every
// original module against its existing frozen hash. No economy/wallet exception.
const {bossHuntPatches}=require('../apply-boss-hunt.cjs');
for(const [before,after,count]of bossHuntPatches.slice().reverse()){assert.equal(html.split(after).length-1,count,'exact Boss Hunt hook: '+before.slice(0,40));html=html.split(after).join(before)}
const {marketPatches}=require('../apply-market.cjs');
for(const [before,after]of marketPatches){assert.equal(html.split(after).length-1,1,'one reviewed Market client hook');html=html.replace(after,()=>before)}
const {cinematicPatches}=require('../apply-reveal-design.cjs');
for(const [before,after]of cinematicPatches){assert.equal(html.split(after).length-1,1,'one exact cinematic presentation hook: '+before);html=html.replace(after,before)}
const {startupPatches}=require('../apply-loading-design.cjs');
for(const [before,after]of startupPatches){assert.equal(html.split(after).length-1,1,'one exact startup presentation hook: '+before);html=html.replace(after,before)}
const {rendererPatches}=require('../apply-map-design.cjs');
for(const [before,after]of rendererPatches){assert.equal(html.split(after).length-1,1,'one exact map presentation hook: '+before);html=html.replace(after,before)}
const {chatPatches}=require('../apply-chat.cjs');
for(const [before,after]of chatPatches){assert.equal(html.split(after).length-1,1,'one exact chat client hook: '+before);html=html.replace(after,before)}
const {purchaseSplitPatches}=require('../apply-gameplay-options.cjs');
for(const [before,after,count]of purchaseSplitPatches.slice().reverse()){assert.equal(html.split(after).length-1,count,'exact purchase split hook');html=html.split(after).join(before)}
const {identityPatches}=require('../apply-gameplay-options.cjs');
for(const [before,after,count]of identityPatches.slice().reverse()){assert.equal(html.split(after).length-1,count,'exact identity hook count');html=html.split(after).join(before)}
const {trainingPatches}=require('../apply-gameplay-options.cjs');
for(const [before,after,count]of trainingPatches.slice().reverse()){assert.equal(html.split(after).length-1,count,'exact training hook count: '+before.slice(0,40));html=html.split(after).join(before)}
const {fusionListPatches}=require('../apply-gameplay-options.cjs');
for(const [before,after]of fusionListPatches){assert.equal(html.split(after).length-1,1,'one exact fusion list hook: '+before.slice(0,40));html=html.replace(after,()=>before)}
const {bossTeamPatches}=require('../apply-gameplay-options.cjs');
for(const [before,after]of bossTeamPatches){assert.equal(html.split(after).length-1,1,'one exact boss team hook: '+before.slice(0,40));html=html.replace(after,()=>before)}
const {rewardPatches}=require('../apply-gameplay-options.cjs');
const {chestPopupPatches}=require('../apply-gameplay-options.cjs');
for(const [before,after]of chestPopupPatches){assert.equal(html.split(after).length-1,1,'one exact chest popup hook');html=html.replace(after,()=>before)}
for(const [before,after]of rewardPatches.slice().reverse()){assert.equal(html.split(after).length-1,1,'one exact enemy reward hook');html=html.replace(after,()=>before)}
const getter="get pendingDeposits(){return readPending().filter(record=>record&&record.kind==='deposit'&&record.network===NETWORK&&record.account===state.account&&record.tokenAddress===state.tokenAddress).length},";
assert.equal(html.split(getter).length-1,1,'one reviewed read-only pending-deposit getter is present');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(x=>x.trim()).map(source=>sha(source.replace(getter,''))),remaining=[...scripts];
for(const hash of baseline.inlineScripts){const index=remaining.indexOf(hash);assert(index>=0,'a baseline inline module changed outside the explicitly allowed Ryo/Chest adapter boundaries: '+hash);remaining.splice(index,1)}
assert(!html.includes('V3Adventure.preserveNativeGrid'),'stopped V3 topology replacement is not imported');assert(!html.includes('integrated-v3-react-ui'),'stopped broad V3 shell is not imported');
console.log(`PASS: ${baseline.files.length} reviewed files and original inline modules preserved after reversing ${cinematicPatches.length} reveal hooks, ${startupPatches.length} startup hooks, ${rendererPatches.length} render hooks, ${chatPatches.length} chat hook, ${fusionListPatches.length} fusion list hooks, ${bossTeamPatches.length} boss team hooks, ${rewardPatches.length} reward hooks and the reviewed read-only pending getter; original map art/topology, combat, inventory/economy/server unchanged.`);
