/* Frozen hashes from maintained main, not from the stopped broad V3 branch. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),baseline=require('./baseline-hashes.json');
const root=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
for(const file of baseline.files){assert.equal(sha(fs.readFileSync(path.join(root,file.path))),file.sha256,'unchanged maintained game/server/visual file: '+file.path);if(file.path.startsWith('map-design/'))assert.equal(sha(fs.readFileSync(path.join(root,'app/public/assets',file.path))),file.sha256,'generated map remains the original baseline: '+file.path);}
const html=fs.readFileSync(path.join(root,'app/public/index.html'),'utf8');
const getter="get pendingDeposits(){return readPending().filter(record=>record&&record.kind==='deposit'&&record.network===NETWORK&&record.account===state.account&&record.tokenAddress===state.tokenAddress).length},";
assert.equal(html.split(getter).length-1,1,'one reviewed read-only pending-deposit getter is present');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(x=>x.trim()).map(source=>sha(source.replace(getter,''))),remaining=[...scripts];
for(const hash of baseline.inlineScripts){const index=remaining.indexOf(hash);assert(index>=0,'a baseline inline module changed outside the explicitly allowed Ryo/Chest adapter boundaries: '+hash);remaining.splice(index,1)}
assert(!html.includes('V3Adventure.preserveNativeGrid'),'stopped V3 topology replacement is not imported');assert(!html.includes('integrated-v3-react-ui'),'stopped broad V3 shell is not imported');
console.log(`PASS: ${baseline.files.length} maintained files and ${baseline.inlineScripts.length-1} untouched inline modules plus the wallet module unchanged apart from the exact read-only pending getter; original map art/topology, combat, models, inventory/economy/server unchanged.`);
