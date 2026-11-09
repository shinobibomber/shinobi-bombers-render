/* Feature switches build step (runs after apply-live-economy, see unpack.cjs): copies feature-switches/server.cjs to
 * app/server/feature-switches.cjs (used by launch-gates.cjs, founders.cjs and the admin Control panel) and appends its
 * additive tables to the schema once. Only source files are edited; app/ is generated. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const MARKER = '-- Feature switches v1';

function applyFeatureSwitches(appDir = path.join(__dirname, 'app')) {
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(__dirname, 'feature-switches/server.cjs'), path.join(server, 'feature-switches.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes(MARKER)) fs.appendFileSync(schema, '\n' + MARKER + ' (apply-feature-switches.cjs): admin Control panel values and their audit chain. Additive.\n' + require('./feature-switches/server.cjs').SCHEMA + '\n');
  console.log('Feature switches: Control panel values over the environment defaults (FEATURE_PANEL_DISABLED=on ignores them).');
}
module.exports = { applyFeatureSwitches, MARKER };
if (require.main === module) applyFeatureSwitches();
