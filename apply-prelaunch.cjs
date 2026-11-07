/* Pre-launch build step (after apply-creators-portal): adds the registered-player table to the shared
 * schema. Additive only (CREATE ... IF NOT EXISTS), created by the existing `db:init`. The pre-launch
 * portal itself (prelaunch/) is served by server/site-server.cjs when PRELAUNCH_MODE=on. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const MARKER = '-- Pre-launch players v1:';
function applyPrelaunch(appDir = path.join(__dirname, 'app')) {
  const schema = path.join(appDir, 'server/schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes(MARKER)) fs.appendFileSync(schema, '\n' + fs.readFileSync(path.join(__dirname, 'prelaunch/schema.sql'), 'utf8').replace(/\r\n?/g, '\n') + '\n');
  console.log('Pre-launch accounts: ryo_players schema ready (portal served when PRELAUNCH_MODE=on).');
}
module.exports = { applyPrelaunch, MARKER };
if (require.main === module) applyPrelaunch();
