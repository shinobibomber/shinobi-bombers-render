'use strict';
const fs=require('node:fs'),path=require('node:path');
const files={'/vfx-lab/tsukiyomi':'index.html','/vfx-lab/lab.js':'lab.js','/vfx-lab/lab.css':'lab.css','/vfx-lab/bridge.js':'bridge.js'};
function allowed(req,env=process.env){return env.SHINOBI_VFX_LAB==='on'&&!env.RENDER&&!env.RENDER_SERVICE_ID&&String(env.PRELAUNCH_MODE||'').trim().toLowerCase()!=='on'&&String(env.SOLANA_NETWORK||'devnet').trim().toLowerCase()!=='mainnet'&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);}
function handle(req,res,name){
 if(!name.startsWith('/vfx-lab'))return false;
 const file=files[name],ok=allowed(req)&&file&&['GET','HEAD'].includes(req.method);
 res.writeHead(ok?200:404,{'Content-Type':ok?({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)]:'text/plain','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"});
 if(!ok||req.method==='HEAD'){res.end(ok?'':'Not found.');return true;}
 fs.createReadStream(path.join(__dirname,file)).on('error',()=>res.destroy()).pipe(res);return true;
}
module.exports={handle,allowed};
