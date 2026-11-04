'use strict';
const fs=require('node:fs'),path=require('node:path');
const serviceHook=[
 'const wallet=await store.authenticate(token);',
 "const wallet=await store.authenticate(token);if(typeof action==='string'&&action.startsWith('admin-'))return require('./economic-dashboard.cjs').handle({store,connection,mint,treasuryAddress,studioAddress,revenueAddress,checkNetwork},wallet,action,body);await require('./economic-dashboard.cjs').guard(store,action,wallet,body);"
];
const claimHook=[
 'd.pending-=credited*1000;d.claimed+=credited;pool-=credited;',
 "d.pending-=credited*1000;d.claimed+=credited;pool-=credited;\n   await c.query('INSERT INTO ryo_reward_claims(scope,wallet,amount,created) VALUES($1,$2,$3,$4)',[store.scope,wallet,credited,store.now()]);"
];
function applyEconomicDashboard(appDir=path.join(__dirname,'app')){
 for(const [file,hook]of [['service.cjs',serviceHook],['adventure.cjs',claimHook]]){
  const target=path.join(appDir,'server',file),text=fs.readFileSync(target,'utf8');
  if(!text.includes(hook[1])){if(text.split(hook[0]).length!==2)throw Error('Economic dashboard patch mismatch: '+file);fs.writeFileSync(target,text.replace(hook[0],()=>hook[1]))}
 }
 const schemaFile=path.join(appDir,'server/schema.sql'),schema=fs.readFileSync(schemaFile,'utf8');
 if(!schema.includes('-- Economic dashboard v1'))fs.appendFileSync(schemaFile,'\n-- Economic dashboard v1\n'+fs.readFileSync(path.join(__dirname,'economic-dashboard/schema.sql'),'utf8').replace(/\r\n/g,'\n'));
 fs.copyFileSync(path.join(__dirname,'economic-dashboard/server.cjs'),path.join(appDir,'server/economic-dashboard.cjs'));
 console.log('Economic dashboard, governance, emergency gates and claim observations applied.');
}
module.exports={applyEconomicDashboard,serviceHook,claimHook};
if(require.main===module)applyEconomicDashboard();
