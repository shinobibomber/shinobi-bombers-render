'use strict';
const {start}=require('./local-server.cjs');
start().then(host=>{
 console.log('Local Mythic VFX preview: '+host.url+'/vfx-lab/tsukiyomi');
 console.log('Loopback only. Production credentials are not inherited. Press Ctrl+C to stop.');
 process.on('SIGINT',()=>{host.stop();process.exit(0)});process.on('SIGTERM',()=>{host.stop();process.exit(0)});
}).catch(e=>{console.error(e);process.exitCode=1});
