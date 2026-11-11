# Reward-pool performance — plan for owner approval (2026-11-11)

Workstream: Economy & Security. Status: **plan only; nothing changed.** Every step below needs the owner's approval before it
starts, and an independent `/security-review` before anything ships.

## 1. The problem (measured)

Every Adventure sync (each online player, every 1.5–15 s) recomputes the funded reward pool from scratch
(`app/server/adventure.cjs`, `settleLocked` and `adventure`):

- `SUM((data->>'claimed')::numeric)` over **every player's** `ryo_adventures` row: reads and unpacks each whole JSON record
  (about 16 KB for a 376-hero account) to get one number.
- `income()` (`sr-revenue/server.cjs`): sums **every confirmed purchase's** JSON quote.

The pool sets the reward rate (50–100 %) and caps claims, so it must stay **exact**.
The same two sums are also used by `chest-spending/server.cjs` (Chest-funded purchases), `treasury/treasury-rewards.cjs`
(claim funding view) and `economic-dashboard/server.cjs` (admin).

Benchmark (real server code on PGlite, embedded Postgres; relative numbers):

| Players / purchases | One whole sync | Claims sum | Purchases sum |
|---|---|---|---|
| 1 / 0 | 10 ms | 0.4 ms | 0.6 ms |
| 1,000 / 5,000 | 34 ms | 14 ms | 6 ms |
| 5,000 / 25,000 | 109 ms | 98 ms | 26 ms |
| 20,000 / 100,000 | 312 ms | 213 ms | 84 ms |

Live today (Render metrics, 9–11 Nov): database CPU at most 6 % of 0.5 CPU, memory 8 %, at most 5 connections; game server
CPU at most 2 %; about 2 requests/s. **Not urgent now**, but the cost grows with players × online players. The database
contents could not be read (its IP allowlist is closed, which is correct), so live row counts are NOT MEASURED.

## 2. Phase A — exact pre-computed columns (recommended first)

Add three **stored generated columns**: Postgres computes them itself from the same JSON on every write, so they can never
drift from the data, whatever code path writes the row.

```sql
ALTER TABLE ryo_adventures ADD COLUMN IF NOT EXISTS claimed_total NUMERIC
  GENERATED ALWAYS AS ((data->>'claimed')::numeric) STORED;
ALTER TABLE ryo_purchases ADD COLUMN IF NOT EXISTS adventure_operations NUMERIC
  GENERATED ALWAYS AS (CASE WHEN status='confirmed' AND COALESCE(quote->>'funding','')<>'bonus'
    AND COALESCE(quote->>'adventureEligible','true')<>'false' THEN (quote->>'operations')::numeric END) STORED;
ALTER TABLE ryo_purchases ADD COLUMN IF NOT EXISTS revenue_version TEXT
  GENERATED ALWAYS AS (COALESCE(quote->'revenueDistribution'->>'version','1')) STORED;
CREATE INDEX IF NOT EXISTS ryo_adventures_claimed ON ryo_adventures(scope) INCLUDE (claimed_total);
CREATE INDEX IF NOT EXISTS ryo_purchases_income ON ryo_purchases(scope) INCLUDE (adventure_operations, revenue_version)
  WHERE adventure_operations IS NOT NULL;
```

The sums become `SUM(claimed_total)` and `SUM(adventure_operations) [WHERE revenue_version<>'2' on live]`.

- **Same answer by construction:** same expressions and filters as today. Casting only confirmed, eligible purchases keeps
  today's behaviour exactly (today's query also casts only those rows).
- **Measured on the prototype** (identical results in every case): claims sum 108 → 4.4 ms at 20,000 players (×25);
  purchases sum 82 → 42 ms at 100,000 purchases (×2; Phase B fixes the rest).
- **One behaviour difference, only for corrupt data:** a confirmed purchase whose quote has a non-numeric `operations` value.
  Today the confirmation succeeds and then **every** Adventure sync for every player fails on the cast; with the column, that
  one confirmation is refused instead and the purchase stays pending. Quotes are built by the server (`economy.quote`), so this
  should never happen; the new differential test checks every product's quote is numeric. Verified on the prototype: pending →
  confirmed → refunded, bonus, ineligible and version-2 purchases all give the same sum as today's query.
- **One shared helper** (new `reward-pool/server.cjs` → `app/server/reward-pool.cjs`) gives `claimedTotal(store, c)` and the
  income SQL to all five callers, so they cannot disagree.
- **Startup self-check:** on the first call after a deploy the helper computes both the old and the new sums once; if they
  ever differ, it logs an alert and keeps using the **old exact query** for that process.
- **Pinned files** change only through build-time exact-string patches, like Chest Overflow and Hero Passes do:
  `adventure.cjs` (two inline sums → helper), `schema.sql` (append the block above). `tests/preservation.cjs` reverses them.

**Migration on live:** runs in the Render build (`db:init`), before the new code starts. Adding the columns rewrites the two
tables once while they are locked: about 0.2 s per 1,000 players on the prototype, so well under a second today. This is the
best time to do it, while the tables are small. Old code keeps working with the new columns (it ignores them).

## 3. Phase B — the purchases total kept up to date (when purchases pass ~20,000)

Phase A still reads every eligible purchase. Phase B keeps one running total per scope, updated by a database trigger **inside
the same transaction** as the purchase change (insert, status change, delete), so it is exact and cannot drift from an
application bug. The trigger fires only when `adventure_operations` or `revenue_version` actually changes, so Adventure syncs
never touch it. The Phase A self-check compares the total against the full sum at startup and falls back if they differ.
Separate approval; measure first.

## 4. Phase C — skip unchanged writes (measure first)

Every sync rewrites the whole profile (up to ~91 KB, ~10 ms on the prototype) and the Adventure row, even when nothing changed.
Skipping a write when the new JSON equals what was loaded leaves the stored data byte-identical. The Adventure row changes on
almost every sync (timestamps), so the gain is mostly on profiles during idle syncs. Measure how often a profile is unchanged
before deciding; may be dropped.

## 5. Not in scope

`state()` sweeps (they run on sign-in, claims and payments, not every sync), Boss Hunt and dashboard queries (admin or daily),
any change to reward amounts, rates, caps, claim rules, custody or treasury logic.

## 6. Tests (all must pass before review)

- **Differential sums test (new):** randomized purchases and Adventure rows covering bonus, ineligible, revenue version 1/2/missing,
  fractional and missing `claimed`, pending → confirmed → refunded transitions and deletes; the old SQL and the helper must agree
  after every step.
- **Differential Adventure test (new):** the same scripted sequence of syncs, kills, claims, Chest spends and purchases on two
  databases (current code vs new code); every response and every stored row must be byte-identical.
- Existing: `npm run check:rewards` (never loosened), `chest-spending-server`, `sr-revenue`, `treasury-*`, `live-rewards`,
  `combat-*`, `offline-sync`, `preservation`, then the full regression.
- Benchmark before/after with `bench-adventure` (kept in `tools/`).

## 7. Release

1. Owner approves this plan (Phase A only, or A + C).
2. Implement in a detached worktree on live's tip; tests above; `/security-review`; owner reviews the diff.
3. Owner approves commit and push to `live` (auto-deploys). Watch the build log for the migration and the self-check line,
   then database CPU and Adventure errors for an hour.
4. **Rollback:** revert the commit; the extra columns and indexes are harmless to the old code and can stay (or be dropped
   later with approval).
