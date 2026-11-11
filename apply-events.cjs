/* Command Center Events build step (after apply-support in unpack.cjs). Owner request 2026-11-12: scheduled events, two-person review,
 * EN/PT-BR, no rewards. Copies events/server.cjs to app/server/events.cjs and appends the additive schema. It adds NO hook to
 * service.cjs or the client: staff actions and the player read (`cc-events-upcoming`) travel through the existing `cc-*` route, so
 * service.cjs and index.html stay byte for byte as they were. Behind the Control-panel switch `eventsBoard` (default ON). */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const SCHEMA_MARKER = '-- Command Center Events v1';

function applyEvents(appDir = path.join(__dirname, 'app')) {
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(__dirname, 'events', 'server.cjs'), path.join(server, 'events.cjs'));
  const schema = path.join(server, 'schema.sql'), current = fs.readFileSync(schema, 'utf8');
  // Append only, like every other schema step: each earlier byte of schema.sql (and the pins over it) stays exactly as it was.
  if (!current.includes(SCHEMA_MARKER)) fs.appendFileSync(schema, '\n' + SCHEMA_MARKER + ' (apply-events.cjs). Additive; existing data untouched.\n' + require('./events/server.cjs').SCHEMA.replace(/\r\n/g, '\n') + '\n');
  console.log('Command Center Events applied: scheduled events, two-person review, EN/PT-BR, no rewards (switch eventsBoard, default ON).');
}
module.exports = { applyEvents, SCHEMA_MARKER };
if (require.main === module) applyEvents();
