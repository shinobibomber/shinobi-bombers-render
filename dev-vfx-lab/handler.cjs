'use strict';
const fs=require('node:fs'),path=require('node:path');
const files={'/vfx-lab/tsukiyomi':'index.html','/vfx-lab/lab.js':'lab.js','/vfx-lab/lab.css':'lab.css','/vfx-lab/bridge.js':'bridge.js'};
files['/vfx-lab/recreation']='recreation/index.html';
for(const name of ['review.js','review.css','renderer.js','bridge.js','manifest.json'])files['/vfx-lab/recreation/'+name]='recreation/'+name;
files['/vfx-lab/recreation/reference.png']='../mythic-hero/reference/mythic-skill-v6.png';
for(const id of ['dragon_slash','void_shuriken','raijin_field','mythic_dragon_ascension'])for(const layer of ['ground','front','combined']){const name=id+'_'+layer+'.png';files['/vfx-lab/recreation/assets/'+name]='recreation/assets/'+name;}
for(const id of ['dragon_slash','void_shuriken','raijin_field','mythic_dragon_ascension','showcase'])files['/vfx-lab/recreation/videos/'+id+'.mp4']='../previews/mythic-recreation/'+id+'.mp4';
function allowed(req,env=process.env){return env.SHINOBI_VFX_LAB==='on'&&!env.RENDER&&!env.RENDER_SERVICE_ID&&String(env.PRELAUNCH_MODE||'').trim().toLowerCase()!=='on'&&String(env.SOLANA_NETWORK||'devnet').trim().toLowerCase()!=='mainnet'&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);}
function handle(req,res,name){
 if(!name.startsWith('/vfx-lab'))return false;
 const file=Object.hasOwn(files,name)?files[name]:null,ok=allowed(req)&&file&&['GET','HEAD'].includes(req.method)&&fs.existsSync(path.join(__dirname,file));
 res.writeHead(ok?200:404,{'Content-Type':ok?({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.mp4':'video/mp4'})[path.extname(file)]:'text/plain','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"});
 if(!ok||req.method==='HEAD'){res.end(ok?'':'Not found.');return true;}
 fs.createReadStream(path.join(__dirname,file)).on('error',()=>res.destroy()).pipe(res);return true;
}
module.exports={handle,allowed};
