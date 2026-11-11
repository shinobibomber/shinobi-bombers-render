'use strict';
/* Shinobi Command Center (Phase 1) build step. Runs from unpack.cjs after the chat and economic-dashboard
 * steps, because it extends both:
 *   - copies command-center/server.cjs to app/server/command-center.cjs;
 *   - routes authenticated `cc-*` actions right after the existing `admin-*` route, and the player
 *     `chat-report` action next to `chat-list`/`chat-send`;
 *   - appends command-center/schema.sql (additive, idempotent) to app/server/schema.sql once.
 * Every hook is an exact one-occurrence replacement and is skipped when already applied.
 */
const fs = require('node:fs'), path = require('node:path');
const SCHEMA_MARKER = '-- Shinobi Command Center v1 (apply-command-center.cjs)';
const ADMIN_ROUTE = "return require('./economic-dashboard.cjs').handle({store,connection,mint,treasuryAddress,studioAddress,revenueAddress,checkNetwork},wallet,action,body);";
const serviceHooks = [
  [ADMIN_ROUTE, ADMIN_ROUTE + "if(typeof action==='string'&&action.startsWith('cc-'))return require('./command-center.cjs').handle({store,connection,checkNetwork,token,treasuryAddress,studioAddress,revenueAddress},wallet,action,body);"],
  ["if(action==='chat-list'||action==='chat-send')return require('./chat.cjs')", "if(action==='chat-report')return require('./chat.cjs').report(store,wallet,body);\n  if(action==='chat-list'||action==='chat-send')return require('./chat.cjs')"],
];
function replaceOne(text, [before, after], label) {
  if (text.includes(after)) return text;
  const count = text.split(before).length - 1;
  if (count !== 1) throw Error('Command Center patch mismatch: ' + label + ' (' + count + ')');
  return text.replace(before, () => after);
}
// Code and routes: run before apply-network.cjs, so the Mainnet build's text rules and leftover scan
// also cover app/server/command-center.cjs.
function applyCommandCenter(appDir = path.join(__dirname, 'app'), { schema = true } = {}) {
  const service = path.join(appDir, 'server/service.cjs');
  let text = fs.readFileSync(service, 'utf8');
  for (const [i, hook] of serviceHooks.entries()) text = replaceOne(text, hook, i ? 'chat-report route' : 'cc-* route');
  fs.writeFileSync(service, text);
  fs.copyFileSync(path.join(__dirname, 'command-center/server.cjs'), path.join(appDir, 'server/command-center.cjs'));
  fs.copyFileSync(path.join(__dirname, 'command-center/founder-ops.cjs'), path.join(appDir, 'server/command-center-founders.cjs'));   // Phase 2, read-only
  if (schema) applyCommandCenterSchema(appDir);
  console.log('Command Center staff API, chat moderation and reports applied.');
}
// Schema: appended after every earlier feature section (unpack.cjs calls it last among the schema
// steps), so the byte-exact checks of earlier sections, such as the Creators Portal CRLF test, are unaffected.
function applyCommandCenterSchema(appDir = path.join(__dirname, 'app')) {
  const schemaFile = path.join(appDir, 'server/schema.sql'), schema = fs.readFileSync(schemaFile, 'utf8');
  if (!schema.includes('CREATE TABLE IF NOT EXISTS ryo_chat ') || !schema.includes('CREATE TABLE IF NOT EXISTS ryo_admin_audit'))
    throw Error('Command Center needs the chat and economic-dashboard schema first.');
  // Explicit \n joins keep the generated schema independent of checkout line endings.
  if (!schema.includes(SCHEMA_MARKER)) fs.appendFileSync(schemaFile, '\n' + SCHEMA_MARKER + '\n' + fs.readFileSync(path.join(__dirname, 'command-center/schema.sql'), 'utf8').replace(/\r\n/g, '\n'));
}
module.exports = { applyCommandCenter, applyCommandCenterSchema, serviceHooks, SCHEMA_MARKER };
if (require.main === module) applyCommandCenter();
