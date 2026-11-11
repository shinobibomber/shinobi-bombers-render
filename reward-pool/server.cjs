'use strict';
/* Reward pool totals (Economy & Security, owner-approved Phase A, 2026-11-11; plan: docs/ECONOMY_PERF_PLAN.md).
 *
 * The funded reward pool = finalized purchase income - everything already claimed. It sets the Adventure reward rate and caps
 * claims, so it must be EXACT. Before this, every Adventure sync summed two JSON fields over every row in the game:
 *   claimed  SUM((data->>'claimed')::numeric) over every player's ryo_adventures row (whole JSON record read per player);
 *   income   SUM((quote->>'operations')::numeric) over every confirmed, eligible purchase.
 *
 * Now Postgres keeps those values in STORED GENERATED columns (same expressions, computed by the database on every write, so
 * they cannot drift whatever code writes the row) with covering indexes, and the sums read the small columns instead.
 *
 * Safety: the first call per process and total runs the old exact query and the new one back to back on the caller's client.
 * Equal: the fast query is used from then on. Different, or the columns are missing (schema not migrated): an alert is logged
 * and that process keeps the old exact query. The checking call always returns the old query's answer. (Transactions are READ
 * COMMITTED, so a write landing between the two queries can cause a false mismatch; that only falls back to the old query.)
 * Every query here is a plain read on the caller's client: nothing here can abort the caller's transaction on a healthy schema. */

const SCHEMA = `-- Reward pool columns v1 (apply-reward-pool.cjs). Additive; existing data untouched. Same expressions as the old sums.
ALTER TABLE ryo_adventures ADD COLUMN IF NOT EXISTS claimed_total NUMERIC GENERATED ALWAYS AS ((data->>'claimed')::numeric) STORED;
ALTER TABLE ryo_purchases ADD COLUMN IF NOT EXISTS adventure_operations NUMERIC GENERATED ALWAYS AS (CASE WHEN status='confirmed' AND COALESCE(quote->>'funding','')<>'bonus' AND COALESCE(quote->>'adventureEligible','true')<>'false' THEN (quote->>'operations')::numeric END) STORED;
ALTER TABLE ryo_purchases ADD COLUMN IF NOT EXISTS revenue_version TEXT GENERATED ALWAYS AS (COALESCE(quote->'revenueDistribution'->>'version','1')) STORED;
CREATE INDEX IF NOT EXISTS ryo_adventures_claimed ON ryo_adventures(scope) INCLUDE (claimed_total);
CREATE INDEX IF NOT EXISTS ryo_purchases_income ON ryo_purchases(scope) INCLUDE (adventure_operations, revenue_version) WHERE adventure_operations IS NOT NULL;
`;

// The old exact queries (unchanged text from adventure.cjs, chest-spending, treasury-rewards and sr-revenue).
const OLD = {
  claimed: "SELECT COALESCE(SUM((data->>'claimed')::numeric),0) AS n FROM ryo_adventures WHERE scope=$1",
  income: "SELECT COALESCE(SUM((quote->>'operations')::numeric),0) AS n FROM ryo_purchases WHERE scope=$1 AND status='confirmed' AND COALESCE(quote->>'funding','')<>'bonus' AND COALESCE(quote->>'adventureEligible','true')<>'false'",
};
OLD.liveIncome = OLD.income + " AND COALESCE(quote->'revenueDistribution'->>'version','1')<>'2'";
// The same totals from the generated columns.
const NEW = {
  claimed: 'SELECT COALESCE(SUM(claimed_total),0) AS n FROM ryo_adventures WHERE scope=$1',
  income: 'SELECT COALESCE(SUM(adventure_operations),0) AS n FROM ryo_purchases WHERE scope=$1 AND adventure_operations IS NOT NULL',
};
NEW.liveIncome = NEW.income + " AND revenue_version<>'2'";

const COLUMNS_SQL = "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema=current_schema() AND ((table_name='ryo_adventures' AND column_name='claimed_total') OR (table_name='ryo_purchases' AND column_name IN ('adventure_operations','revenue_version')))";

const mode = new Map();   // kind + scope -> 'columns' | 'legacy'
let columns = null;       // per process: are the generated columns present?

const total = async (c, sql, scope) => Number((await c.query(sql, [scope])).rows[0].n);

async function exact(c, kind, scope) {
  const key = kind + '\u0000' + scope, known = mode.get(key);
  if (known === 'columns') return total(c, NEW[kind], scope);
  if (known === 'legacy') return total(c, OLD[kind], scope);
  if (columns === null) columns = Number((await c.query(COLUMNS_SQL)).rows[0].n) === 3;
  if (!columns) {
    mode.set(key, 'legacy');
    console.error('[reward-pool] ALERT: generated columns missing; using the original full sums (' + kind + ').');
    return total(c, OLD[kind], scope);
  }
  const before = await total(c, OLD[kind], scope), after = await total(c, NEW[kind], scope);
  if (before === after) { mode.set(key, 'columns'); console.log('[reward-pool] ' + kind + ' total verified against the original sum (' + before + '); using the indexed column.'); }
  else { mode.set(key, 'legacy'); console.error('[reward-pool] ALERT: ' + kind + ' total mismatch (original ' + before + ', column ' + after + '); keeping the original full sum in this process.'); }
  return before;
}

/** Everything already claimed from Adventure Chests, in whole Ryo (all players of this scope). */
const claimedTotal = (store, c) => exact(c, 'claimed', store.scope);
/** Finalized, eligible purchase operations (the funded income before top-ups). `live` adds the revenue-distribution v2 exclusion. */
const purchaseIncome = (store, c, live) => exact(c, live ? 'liveIncome' : 'income', store.scope);

module.exports = { SCHEMA, OLD, NEW, claimedTotal, purchaseIncome, status: () => ({ columns, mode: Object.fromEntries(mode) }), _reset: () => { mode.clear(); columns = null; }, _force: (kind, scope, m) => mode.set(kind + '\u0000' + scope, m) };   // _reset/_force: tests only
