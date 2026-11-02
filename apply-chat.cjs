const fs=require('node:fs'),path=require('node:path');
// Global chat add-on: server module, additive table and one authenticated client entry point.
// The client hook is exported so the preservation test can reverse it exactly.
const chatPatches=[
 ["window.RyoPayments={","window.RyoPayments={chat:(action,body={})=>{if(action!=='chat-list'&&action!=='chat-send')throw Error('Unknown chat action.');return api(action,body)},"]
];
const serviceHook=["if(action==='presence')return store.presence(wallet,token,body.active===true);","if(action==='chat-list'||action==='chat-send')return require('./chat.cjs').handle(store,wallet,action,body);\n  if(action==='presence')return store.presence(wallet,token,body.active===true);"];
// Explicit \n joins: the generated schema.sql is hash-checked, so it must not depend on checkout line endings.
const schema=['',
 '-- Global chat (apply-chat.cjs). Only the newest messages per channel are kept.',
 'CREATE TABLE IF NOT EXISTS ryo_chat (id BIGSERIAL PRIMARY KEY,scope TEXT NOT NULL,channel TEXT NOT NULL,wallet TEXT NOT NULL,name TEXT NOT NULL,text TEXT NOT NULL,created BIGINT NOT NULL);',
 'CREATE INDEX IF NOT EXISTS ryo_chat_channel ON ryo_chat(scope,channel,id);',
 'CREATE INDEX IF NOT EXISTS ryo_chat_sender ON ryo_chat(scope,wallet,created);',''].join('\n');
function replaceOne(text,[before,after],label){if(text.includes(after))return text;const count=text.split(before).length-1;if(count!==1)throw Error('Chat patch mismatch: '+label+' ('+count+')');return text.replace(before,after)}
function applyChat(appDir=path.join(__dirname,'app')){
 const patch=(file,fn)=>{const name=path.join(appDir,file),before=fs.readFileSync(name,'utf8'),after=fn(before);if(before!==after)fs.writeFileSync(name,after)};
 patch('server/service.cjs',s=>replaceOne(s,serviceHook,'chat actions'));
 patch('server/schema.sql',s=>s.includes('CREATE TABLE IF NOT EXISTS ryo_chat')?s:s.replace(/\s*$/,'\n')+schema);
 patch('public/index.html',s=>chatPatches.reduce((html,p)=>replaceOne(html,p,'chat client'),s));
 fs.copyFileSync(path.join(__dirname,'chat/server.cjs'),path.join(appDir,'server/chat.cjs'));
 console.log('Global chat service and client entry point applied.');
}
module.exports={applyChat,chatPatches};if(require.main===module)applyChat();
