# Ryo Observatory

Developer/admin dashboard at `/admin/`. All data and mutations use the existing, origin-checked `/api/ryo` endpoint and its wallet signature sessions. The shell is public; the API denies access by default.

## Activate access

Configure comma-separated **public** wallet addresses in the Render service environment:

- `RYO_ADMIN_VIEWERS`: read and export economic snapshots.
- `RYO_ADMIN_OPERATORS`: read, propose reporting configuration, and immediately pause new operations.
- `RYO_ADMIN_APPROVERS`: operator permissions plus independently approve/reject another wallet's proposal.

An approver cannot approve their own proposal, even if they also have another role. Use two distinct wallets.
Exception (owner decision 2026-11-10): `ADMIN_SELF_APPROVAL=on` in Render lets an approver approve or reject its own
proposals (every kind). The approver role, expiry, stale-version and on-chain checks still apply; each self-review is
marked `selfApproved` in the audit chain and the dashboard shows an alert while it is on. Remove it to require two wallets. Existing custody, revenue and studio wallets cannot use the game's player login; use dedicated admin wallets. Never configure private keys or seed phrases for admin access. An empty allowlist grants no access. Access changes take effect after the environment change is deployed. Roles are evaluated on every API request; sessions expire using the existing one-hour policy.

Sign in with Phantom. The dashboard holds the session token only in memory, clears its display on logout/session expiry, and does not perform wallet transfers. Role bootstrap remains a hosting-owner operation so an app administrator cannot grant themselves additional access.

## Reporting definitions and limits

- **Supply / vaults:** finalized Solana Devnet RPC observations. The base wallets are custody, studio fees and the revenue treasury. Additional allocations are approved wallet labels with policy references. Multiple token accounts belonging to one owner are summed; duplicate owners are counted once in the residual. RPC failure is unavailable, never zero. Raw amounts and observation slots are included in exports.
- **Circulation / locks:** unavailable without a verifiable vesting/lock program. Tokens outside monitored wallets are reported separately as a residual, never labelled circulating supply. A treasury wallet alone does not prove a lock.
- **Spent:** confirmed `ryo_purchases.amount` plus the historical `ryo_spends` ledger. Purchase fees are included. Refunded and pending reservations are excluded.
- **Recycled:** confirmed `quote.operations`; live SR services retain 30% for Adventure and exclude new live Market fees. Beta keeps its original 80% service allocation and 10% Market-fee funding. Historical quotes retain their saved interpretation. Only live independently approved finalized replenishments add funding; available pool subtracts lifetime claimed rewards.
- **Treasury / burned:** confirmed purchase quote allocations to their saved treasury destination / mint burn. These are transaction-settlement records, not a scan of unrelated external transfers and burns. New approved SR services use the approved Locked Treasury destination, burn nothing and send no service studio share. Historical burns and separate marketplace/event models remain historical records. The SR routing controls require a different authorized reviewer; they do not alter genesis token allocations.
- **Season distribution:** actual claim credits recorded transactionally in `ryo_reward_claims`, by server timestamp and approved half-open `[start,end)` intervals. The claim record and account credit roll back together. Old lifetime claims cannot be reconstructed by season and remain unassigned. Configure season periods prospectively for complete history. The installation timestamp is the first dashboard initialization; older periods are conservatively labelled partial.
- **Summons / fusion:** settled purchase orders, hero outputs and fusion attempts. These are beta game records. NFT mint totals remain unavailable because there is no deployed NFT mint service.
- **Active eligible:** unique wallets seen in the existing 90-second presence window, with at least one owned battle-ready hero (including the game's default roster for legacy profiles). This is an explicit roster-eligibility proxy, not KYC or multi-account identification.
- **Concentration:** top one/top ten shares of lifetime claimed Adventure Ryo, with the top 25 wallets. High 24h claim totals, concentration, and stale pending reservations generate review signals. They do not automatically punish players. No IP/device fingerprinting or unsupported fraud verdicts are inferred.
- **Liabilities:** account balances, full pending purchase/withdrawal reservations, and recorded pending Chests. Unsettled offline accrual is excluded until the game settles it; therefore the total is known recorded obligations, not a complete actuarial liability estimate. No amounts are counted twice between reserves and spendable balances. Custody comparison uses a separately timed finalized chain observation.
- **Transactions:** all status counts and the newest 100 pending/refunded records. Legacy `refunded` means a failed or expired operation's reserve was returned; exact causes were not historically retained. Unsigned, rejected and unsubmitted client requests are not persisted. Signed transaction wires and private material are never returned.
- **Runway:** cash and monthly costs entered from financial evidence, reviewed by another approver, expressed in units of 1/100 of the named currency. The evidence reference, as-of date, reviewer/audit record and a >31-day stale indicator remain visible. Runway is cash / recurring monthly costs, excludes Ryo valuations, and is not a bank-feed verification.

## Governance and emergency controls

Only reporting configuration is editable: allocation wallets, non-overlapping seasons, financial evidence and monitoring thresholds. New proposals include a reason, normalized payload, base configuration version, proposer and timestamp. A distinct approver must approve within seven days. Stale versions must be re-proposed; approval does not overwrite intervening changes. Rejection and approval are serialized with the control row and recorded with a chained SHA-256 digest.

Operators and approvers can pause **new purchases**, **new withdrawals**, and **new claims** individually. A pause takes effect for requests entering the gate after it commits. Already accepted requests may finish. State recovery and replays of existing persisted orders remain available, as do deposits, balance reads and normal Adventure accrual/sync. Resuming requires the normal independent proposal/approval flow. No control can transfer tokens, mint NFTs, change player balances, alter combat or loosen the real-time rewards guard.

The audit is append-only through this application, with per-scope serialization and a previous-hash chain. Hosting/database owners still control the underlying database. Export snapshots to retain independent hash checkpoints. The UI displays the latest 100 audit and proposal records; full historical records remain in PostgreSQL for authorized database export.

## Build and validation

`apply-economic-dashboard.cjs` is run at the end of `unpack.cjs`. It copies the backend module, appends additive/idempotent tables and indexes, and adds two exact hooks: authenticated admin routing/emergency gates in the service and transactional claim observations. Existing balances and economic tables remain authoritative. The normal Render `db:init` runs the migration before startup.

Run `node unpack.cjs`, `npm run lint`, `npm run check:rewards` and `npm test`. The new `tests/economic-dashboard.cjs` uses PGlite and simulated RPC/wallet data, and saves reviewed desktop/mobile screenshots in `tests/out/`. No live wallet transactions are used.
