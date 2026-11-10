# CREATORS PORTAL

Open the native modal using **Creator** in Home's bottom action row (the former Tutorial
button). The main header keeps its ten original game tabs and the sign-in artwork is preserved.
The portal uses the website's purple/gold/cyan theme, a desktop sidebar and mobile tabs;
Escape, backdrop click and the pinned close button return to the game. Focus stays in the
modal and returns to its trigger. Shop/admin confirmations open above the portal.

An integrated game popup, not a separate website. Sources are assembled by
`apply-creators-portal.cjs` after transaction safety and before performance optimization.
No CP is on-chain, and none of these operations mints Ryo or changes player Ryo rewards.

## Integration and dependencies

- Frontend: the existing JavaScript Canvas game, Home action row, wallet header, game
  fonts and Display & Accessibility settings. `portal.js` adds the responsive modal;
  `portal.css` provides opaque purple panels, gold frames, cyan accents and a torii.
  Three small existing website hero portraits are copied into the portal asset folder.
- Backend: the existing Node Ryo handler, signed-wallet challenges, single-use nonce, one-hour
  sessions, scope isolation, PostgreSQL transactions and `RYO_ADMIN_*` roles.
- Purchases: `Store.settlePurchase` emits CP evidence only on its pending → confirmed transition.
  Real chain finalization remains the existing service's responsibility. Bonus-paid, pending,
  refunded, Marketplace, Boss Hunt, transfers and CP redemptions cannot generate purchase CP.
- Adventure: settlement observers record timestamped earnings lots and commission them only when
  the real funded claim credits the player's Ryo. They do not change damage, energy, loot, sync
  timing, custody checks or the real-time rewards guard.
- Normal Shrine heroes are server-owned game records, not individual on-chain NFTs. **The owner
  explicitly selected regular in-game Shrine hero delivery for Creator Shop passes.** Existing
  Mythic Box NFTs and ownership are unaffected; passes do not claim to mint an NFT.

## Configuration

`CREATORS_PORTAL_ENABLED=off` disables portal APIs and new enrollment. Default is `on`.
Previously accepted referrals continue to receive their promised settlement records and CP; use
the application/enrollment pauses for ordinary program budgeting. Disabling a screen never
silently erases obligations to an existing cohort. Unrecognized flag values disable portal access.
No new private key, RPC, Discord bot, external queue or subscription is needed.

Existing `RYO_ADMIN_VIEWERS` can inspect management; operators can review applications, suspend,
reactivate and record referral reviews. Approvers can additionally add wallets manually, change
versioned program/shop rules and append reason-coded CP corrections. All use authenticated wallet
sessions, not a client flag. Creator approval is distinct from two-wallet economic configuration
approval: the existing economic governance remains unchanged.

On first use the scoped defaults are:

- 90-day commissions, snapshotted with eligible services when qualification occurs.
- Applications and new referral enrollment open, public enrollment capacity 1,000 wallets.
- Eligible Ryo services: summon, fusion, training, Dojo, Sensei and Sensei rental.
- Season `launch`, global seasonal promotional hero supply 100.
- A 25,000-CP standard hero pass, initially two per creator per UTC calendar month.
- Only the Standard Hero Summon Pass remains in the Creator Shop. Retired cosmetic inventory
  may remain in old databases for historical records, but is never listed, sold or re-enabled.
- Shop price, item supply, monthly limit, availability, season and seasonal supply are configurable.

Enrollment limits and pauses act before acceptance. Existing accepted referrals can still qualify
and receive the full uncapped 50,000 CP milestone. CP issuance is not a promise of available shop
inventory. Administrators must review promotional capacity and costs before opening enrollment.

## Administrator instructions

1. Sign into the game with a wallet in `RYO_ADMIN_OPERATORS` or `RYO_ADMIN_APPROVERS`.
2. Open **CREATORS PORTAL → Creator Management**.
3. Review application platform, channel, reason and terms acceptance; choose Approve or Reject.
   Enter an audit reason and optional public guidance. Private staff reasons are never returned to
   the applicant or other creators.
4. To approve directly, an approver opens **Add creator wallet manually**, supplies the public
   address, display name and evidence/reason. The wallet owner must authenticate and accept terms
   before referrals/redemptions. No wallet secret or Discord account is requested.
5. Use Suspend/Reactivate for access control. Suspension preserves earned points and history.
6. Search wallets/names/codes, inspect CP history and server qualification evidence. Record manual
   reviews and resolve appeals. High daily enrollment is a review signal, never proof of fraud.
7. Use versioned program rules, inventory controls and audited corrections. Corrections append
   ledger entries; they never edit historical CP events. Negative corrections cannot overdraw CP.

## Attribution and qualification

Links use the configured real site origin: `/?creator=CODE`. The existing root-to-`/play/` redirect
preserves the query. A first-touch browser hint expires after seven days; it is sent during the
existing signed-wallet login. The server accepts one permanent attribution before any order,
legacy spend or recorded Adventure earnings. The browser hint is not authoritative.

Self-referrals and creator-to-creator/circular attribution are rejected. Prior creator wallet
aliases remain reserved after migration. An existing attribution can never be overwritten.
Wallet migration requires an authenticated source request and a separately authenticated exact
destination acceptance within 15 minutes. Creator ID, CP and referrals follow the migration; Ryo,
game heroes and cosmetics do not silently move between wallets. Old migration aliases cannot
apply again or enroll as referrals.

Paid mint evidence is the unique settled summon order plus its exact successful output count.
Single and multi-summons count their actual outputs. Free starter grants/bonus spending, CP shop
outputs, fusion, Market purchases/transfers, failed/refunded orders and replays count zero.
The entire order that crosses qualification is excluded from purchase commissions.

### Server Stage 5 verification

The old online `killStage` is client-reported and cannot establish qualification. Attributed
players therefore get a separate persisted **server combat verifier**, reusing the existing
authoritative `adventure.advance` with **no client kills or stage**. It uses owned battle-ready
heroes, trained stats, server time, chakra, Dojo, Sensei and the existing backend's 20-defeat stage
sequence. Its 100th defeat emits the once-only Stage 5 cleared event (80 defeats means only entry
into Stage 5). Verification stops once complete. Existing records lacking this evidence are not
backfilled from a client's map number. This can lag the browser's arena stage and is explicitly
labelled in the portal. It does not change the player's visible arena or Ryo payout.

Both requirements can complete in either order. Qualification atomically snapshots rules/expiry,
inserts a permanent event, and credits 50,000 CP using a unique milestone key.

## CP accounting and commissions

All CP balances and amounts use integer **milli-CP** (`1 CP = 1,000 units`) and BigInt arithmetic.
Ledger events have unique scoped keys. Balances are updated transactionally by the backend.
No endpoint transfers CP, withdraws it, swaps it or converts it into Ryo/SOL/USDC/cash.

- Milestone: exactly `50,000 × 1,000` units once per qualified wallet.
- Purchase: eligible finalized order SR × 5%, after qualification and before its saved expiry.
  Actual paid SR includes the existing price split; no additional fee is taken from the referral.
- Adventure: earnings observers preserve prequalification, eligible and out-of-window FIFO lots.
  New eligible earnings are provisional. Only a successful real claim consumes lots and credits
  5% of the eligible portion, referencing the unique `ryo_reward_claims.id`. Claim failure rolls
  back Ryo, CP, qualification and lot changes together. Prequalification earnings claimed later
  do not earn CP. Earnings within the saved window can settle after expiry; newly earned rewards
  outside it cannot. Offline lots use the server simulation step timestamps (15-second precision);
  online lots use the authoritative credit timestamp, not a claimed client defeat time.
- Founder-box referrals (owner decision 2026-11-10): a referral with a CONFIRMED Founder box purchase earns the creator 10%
  instead of 5% on both commissions. Commissions already recorded at 5% for that referral (before or after the box) are raised
  automatically and exactly once: one `founder-commission-topup` ledger row per commission (event `topup:<source_id>`, unique),
  delta = floor(SR x 10%) - the original CP, credited in the same transaction; original rows are never edited. It runs when the
  creator dashboard or a redemption loads, when staff open the admin view, and after each new commission for that referral.
  Read-only preview: `node tools/creator-founder-topup-report.cjs`.
- Fractional commission amounts round down to milli-CP per settlement; unclaimed fractional Ryo
  remains in its lot. The player's full legitimate Ryo claim is never reduced.
- Totals, history, available CP, redeemed CP and provisional pending CP come from PostgreSQL.

This is synchronous indexed event processing inside existing settlement transactions, not a scan
of all players. Pending earnings are coalesced into FIFO eligibility runs rather than a row per
enemy or frame. No external job is needed to recover a CP event independently of its Ryo event.

## Shop fulfillment

An approved creator accepts a versioned item price. The transaction locks global program capacity,
the authenticated creator/account and item inventory, checks balance/monthly/seasonal limits,
delivers through the existing `economy.fulfill` summon rules or persisted cosmetic flags, and
records the CP debit, profile, supply and redemption atomically. Interruptions or failed delivery
roll back all changes. Retried request IDs return the existing delivery, never a second hero.
Pending game purchases must settle first to avoid overwriting the delivered profile.

Hero passes use normal 60/25/10/4/1 rarity odds and normal stats. They carry `creatorReward` and
redemption provenance, are not paid orders, do not qualify referrals and add no reward-pool income.
They do not alter the 10 deployed/50 battle-ready limits, chakra or existing funded claim caps.
No free Ryo or new Ryo issuance is introduced. Previously delivered cosmetics remain account-bound flags: aura renders
through existing actor hooks, bomb petals through impact hooks, frame/badge in the player header.
All respect reduced motion and explosion controls and change no combat/reward values.

## Database migration

`schema.sql` and `player-schema.sql` are additive and idempotent. Build assembly appends each
once by its own marker to generated server/schema.sql;
the normal `npm run build` / `db:init` path applies it. Tables:

`ryo_creator_program`, `ryo_creators`, `ryo_creator_wallets`, `ryo_creator_referrals`,
`ryo_creator_events`, `ryo_creator_ledger`, `ryo_creator_adventure_lots`,
`ryo_creator_commissions`, `ryo_creator_shop`, `ryo_creator_redemptions`,
`ryo_creator_audit`, `ryo_creator_migrations`.

There is no destructive migration or rewrite of existing Ryo balances, profiles, NFTs or history.
Ledger/commission/referral/shop indexes, unique event keys, account locks, checks and foreign keys
support bounded lookup and concurrency safety.

## Validation and deployment checklist

Run `npm run build:local`, `npm run typecheck`, `npm run lint`, `npm test`, and
`npm run check:rewards`. Targeted suites are `node tests/creators-server.cjs` and
`node tests/creators-portal.cjs`; desktop/mobile screenshots are in `tests/out/creators-*.png`.

Verified locally on November 7, 2026 with Node 22.23.4: fresh `build:local`, typecheck, lint,
website build checks, the unchanged real-time rewards guard, all **42 game suites** and all
**20 website assertions** passed. The migration was applied twice to an isolated PGlite database.
Desktop, mobile, shop and administrator screenshots were visually inspected. No real wallet,
live reward, external service transaction, Mainnet mint or production database migration was used.

The ordinary production `npm run build` additionally runs `db:init`; that database step is part
of the owner's authorized beta deployment. The existing installer uses the machine's
global npm (Node 26), while game assembly and the complete test runner were run with Node 22.

1. Review this implementation and back up the target database before applying the migration.
2. Confirm the wallet admin allowlists, origin, Devnet configuration and feature flag.
3. Review inventory, public enrollment capacity, commission duration and eligible services.
4. Test application/approval, a funded referral, Stage 5 evidence, both commissions and redemption
   on the test server. Keep founder/starter bonus separate from qualifying paid orders.
5. Review timing, pool solvency, audit records and operational alerts before enabling enrollment.
6. The owner explicitly authorized the existing beta deployment on November 7, 2026 after the
   implementation review. **Pushing main auto-deploys.** Deploy the tested implementation to the
   existing Devnet beta and verify the build/migration and public portal API. Mainnet token launch,
   funds movement and NFT minting remain separate operations.

## Known limits

- This implements regular in-game hero delivery as selected by the owner, not general on-chain
  hero NFT minting/escrow. Existing Mythic Box minting is deliberately not reused as a fake
  standard hero NFT service.
- The server stage verifier is the existing deterministic backend combat model, not a replay of
  every browser grid/path/projectile. Its verified progress can differ from the client stage.
- Wallet signatures prove wallet ownership, not unique human identity. Paid evidence, permanent
  attribution, creator-alias exclusions and manual review reduce abuse but cannot prove that
  unrelated wallets belong to different people. No claim of complete Sybil prevention is made.
- No device/IP fingerprinting, external identity provider, bank feed or Discord integration.
- Historical stages/claims cannot be reconstructed from unverified client state. The feature
  starts authoritative tracking after attribution; no invented historical qualification or CP.
- Existing finalized Ryo orders are immutable in the game. If an exceptional verified reversal
  is needed, staff append a reason-coded CP correction; historical events are not rewritten.
- Pending CP is conditional on funded claims; earned CP has no cash promise. Shop inventory can
  sell out. CP accounting is not an additional Ryo liability or an unlimited minting authorization.
- The existing locked application dependencies report 9 npm audit advisories (6 moderate, 3 high).
  No dependencies were added or force-upgraded for this feature. Review those existing wallet/SDK
  dependencies separately before a Mainnet financial release.
