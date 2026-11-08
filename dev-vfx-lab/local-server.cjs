/* Shared by preview tests/export. Starts the real site host without production env. */
'use strict';
const {spawn}=require('node:child_process'),path=require('node:path');
async function start(){
 const port=22000+Math.floor(Math.random()*16000),url='http://127.0.0.1:'+port;
 const env={};for(const k of ['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','COMSPEC'])if(process.env[k])env[k]=process.env[k];
 Object.assign(env,{PORT:String(port),HOST:'127.0.0.1',SOLANA_NETWORK:'devnet',SHINOBI_VFX_LAB:'on',RYO_SITE_ORIGIN:url});
 const child=spawn(process.execPath,[path.resolve(__dirname,'../server/site-server.cjs')],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});let logs='';
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Local VFX server timeout: '+logs.slice(-1500)))},20000);child.stdout.on('data',b=>{logs+=b;if(logs.includes('Website on')){clearTimeout(timer);resolve()}});child.stderr.on('data',b=>{logs+=b});child.once('exit',code=>{clearTimeout(timer);reject(Error('Local VFX server exited '+code+': '+logs.slice(-1500)))})});
 return{url,stop:()=>child.kill(),get logs(){return logs}};
}
module.exports={start};
