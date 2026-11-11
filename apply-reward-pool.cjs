/* Reward pool totals build step (after apply-session-renewal, before the Command Center schema; see unpack.cjs).
 * Owner-approved Phase A, 2026-11-11 (docs/ECONOMY_PERF_PLAN.md). Copies reward-pool/server.cjs to app/server/reward-pool.cjs,
 * appends the additive generated columns and indexes to schema.sql, and replaces the two inline claimed sums in adventure.cjs
 * with the shared exact helper (exact-string hooks, each must match exactly once or the build stops). sr-revenue, chest-spending
 * and treasury-rewards call the helper from their own source files. adventure.cjs and schema.sql are pinned: their hashes in
 * tests/baseline-hashes.json are the built results of this step. Reward amounts, rates, caps and claim rules are unchanged. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { SCHEMA } = require('./reward-pool/server.cjs');
const MARKER = '-- Reward pool columns v1';
const OLD_SUM = "(await c.query(\"SELECT COALESCE(SUM((data->>'claimed')::numeric),0) AS n FROM ryo_adventures WHERE scope=$1\",[store.scope])).rows[0];";
const NEW_SUM = "{n:await require('./reward-pool.cjs').claimedTotal(store,c)};";
// settleLocked (one-space indent) and adventure() (two-space indent): the same query twice, so each hook includes its indent.
const adventureHooks = [
  ['\n const used=' + OLD_SUM, '\n const used=' + NEW_SUM],
  ['\n  const used=' + OLD_SUM, '\n  const used=' + NEW_SUM],
];

function replaceOnce(text, [before, after], label) {
  if (text.split(after).length - 1 === 1 && !text.includes(before)) return text;   // already applied
  const n = text.split(before).length - 1;
  if (n !== 1) throw Error('Reward pool patch mismatch: ' + label + ' (' + n + ')');
  return text.replace(before, () => after);
}

function applyRewardPool(appDir = path.join(__dirname, 'app')) {
  const server = path.join(appDir, 'server');
  fs.copyFileSync(path.join(__dirname, 'reward-pool', 'server.cjs'), path.join(server, 'reward-pool.cjs'));
  const schema = path.join(server, 'schema.sql');
  if (!fs.readFileSync(schema, 'utf8').includes(MARKER)) fs.appendFileSync(schema, '\n' + SCHEMA);
  const file = path.join(server, 'adventure.cjs');
  fs.writeFileSync(file, adventureHooks.reduce((t, h, i) => replaceOnce(t, h, 'adventure ' + i), fs.readFileSync(file, 'utf8')));
  console.log('Reward pool applied: exact claimed and income totals from indexed generated columns (verified once per process).');
}
module.exports = { applyRewardPool, adventureHooks, MARKER };
if (require.main === module) applyRewardPool();
