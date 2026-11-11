/* In-game Support tickets build step (last step before apply-performance; see unpack.cjs). Owner decisions 2026-11-12.
 * Copies support/server.cjs to app/server/support.cjs and support/support.js to the client, appends the additive schema, and
 * adds exact-string hooks (each must match exactly once, or the build stops):
 *   service.cjs  the player actions support-state / support-submit / support-view / support-reply.
 *   index.html   RyoPayments.support(action, body) + the client script.
 * The staff side is in the Command Center (command-center/server.cjs: cc-support-*). Behind the Control-panel switch
 * `supportTickets` (feature-switches catalog, default ON). service.cjs is not pinned; preservation reverses the client hook. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const S = "require('./support.cjs')";
const marker = '<!-- support-tickets -->', script = '<script defer src="assets/support/support.js"></script>';
const SCHEMA_MARKER = '-- Support tickets v1';

const serviceHooks = [
  ["  if(action==='fusion-shard-craft'){",
   "  if(action==='support-state')return {support:await " + S + ".playerState(store,wallet)};\n" +
   "  if(action==='support-submit')return await " + S + ".submit(store,wallet,body);\n" +
   "  if(action==='support-view')return await " + S + ".view(store,wallet,body);\n" +
   "  if(action==='support-reply')return await " + S + ".reply(store,wallet,body);\n" +
   "  if(action==='fusion-shard-craft'){"],
];
const clientHooks = [
  ["heroPasses:(action,body={})=>{",
   "support:(action,body={})=>{if(!['support-state','support-submit','support-view','support-reply'].includes(action))throw Error('Unknown Support action.');return api(action,body)},heroPasses:(action,body={})=>{"],
];

function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1) return text;   // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Support tickets patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}

function applySupport(appDir = path.join(__dirname, 'app')) {
  const src = path.join(__dirname, 'support'), server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(src, 'server.cjs'), path.join(server, 'support.cjs'));
  const schema = path.join(server, 'schema.sql'), current = fs.readFileSync(schema, 'utf8');
  // Append only, like every other schema step: each earlier byte of schema.sql (and the pins over it) stays exactly as it was.
  if (!current.includes(SCHEMA_MARKER)) fs.appendFileSync(schema, '\n' + SCHEMA_MARKER + ' (apply-support.cjs). Additive; existing data untouched.\n' + require('./support/server.cjs').SCHEMA.replace(/\r\n/g, '\n') + '\n');
  const service = path.join(server, 'service.cjs');
  fs.writeFileSync(service, serviceHooks.reduce((t, h, i) => replaceOnce(t, h, 'service ' + i), fs.readFileSync(service, 'utf8')));
  const assets = path.join(appDir, 'public/assets/support');
  fs.rmSync(assets, { recursive: true, force: true }); fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(path.join(src, 'support.js'), path.join(assets, 'support.js'));
  const index = path.join(appDir, 'public/index.html');
  let html = clientHooks.reduce((t, h, i) => replaceOnce(t, h, 'client ' + i), fs.readFileSync(index, 'utf8'));
  if (!html.includes(marker)) {
    if (html.split('</head>').length !== 2) throw Error('Support tickets: expected one </head>.');
    html = html.replace('</head>', marker + '\n' + script + '\n</head>');
  }
  fs.writeFileSync(index, html);
  console.log('Support tickets applied: in-game tickets, two-way replies, staff queue in the Command Center (switch supportTickets, default ON).');
}
module.exports = { applySupport, serviceHooks, clientHooks, marker, script, SCHEMA_MARKER };
if (require.main === module) applySupport();
