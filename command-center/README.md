# Shinobi Command Center (Phase 1)

Staff console for day-to-day operations, at `/admin/command-center/` (the Ryo Observatory economic
dashboard stays at `/admin/`). Phase 1 covers Overview, read-only Player lookup, Chat moderation,
official Announcements, Server health, Audit logs and Staff roles.

It **cannot** move SOL or Ryo, change balances, rewards, purchases, withdrawals, heroes or NFTs, or
change financial configuration. Financial governance stays in the Observatory's two-wallet flow.

## Pieces

| File | Role |
|---|---|
| `server.cjs` | Staff API, copied to `app/server/command-center.cjs`. Every `cc-*` action re-derives wallet, roles and scope on the server. |
| `schema.sql` | Additive, idempotent tables (`ryo_cc_*`) and `ryo_chat.hidden`. Appended once to `app/server/schema.sql`. |
| `public/` | The console (`index.html`, `cc.js`, `cc-report.js`, `cc.css`). It is served from a fixed file map with `script-src 'self'` and `style-src 'self'`. |
| `../apply-command-center.cjs` | Build step, run by `unpack.cjs` in two parts. Code and routes are applied before the network step; the schema is appended after the last schema step. It adds two exact-match routes to `service.cjs`: `cc-*` after `admin-*`, and the player `chat-report`. |
| `../chat/server.cjs` | Enforces moderation. `chat-send` refuses muted or banned wallets under the sender's account row lock, `chat-list` hides hidden messages and returns `removed` plus the player's own `standing`, and `chat-report` files a report. |

Requests go through the existing `/api/ryo` endpoint, so the POST-only, exact-Origin, JSON and 8 KB
checks in `netlify-handler.cjs` apply. Sessions are the existing one-hour wallet-signed sessions.

`PRELAUNCH_MODE` is unchanged. In the `portal` stage the console is not mounted (404). In the `private`
stage it needs the same private pass as `/admin/`.

## Roles

| Role | Source | Phase 1 permissions |
|---|---|---|
| Owner | `RYO_ADMIN_OWNERS` (new env list) | Everything below, plus granting or revoking Moderator and Support. Cannot review its own announcement. |
| Financial Approver | `RYO_ADMIN_APPROVERS` (existing) | Overview, health, player economy and transactions (read-only), announcements (read), and the full audit log. |
| Game Operator | `RYO_ADMIN_OPERATORS` (existing) | Overview, health, players, chat moderation, announcement review, and the full audit log. |
| Moderator | Backend grant (`ryo_cc_roles`) | Overview, health, player identity and chat standing, chat moderation, proposing announcements, and its own audit records. |
| Support | Backend grant (`ryo_cc_roles`) | Overview, health, player identity and heroes, reading moderation, dismissing reports, and its own audit records. |
| Viewer | `RYO_ADMIN_VIEWERS` (existing) | Read-only: overview, health, redacted players, announcements and the audit log. No chat evidence. |

- **Backend roles stay out of finance.** Roles granted in the backend never reach the economic
  dashboard, which still reads only the env lists, and they can never be financial roles.
- **Staff cannot moderate staff.** A staff wallet cannot be muted or banned through the console; a
  moderator also cannot act on their own wallet or messages.
- **Custody wallets are excluded.** The custody, studio and revenue wallets can neither use the
  console nor hold a role.

## Write guarantees

Every staff write runs in one database transaction and meets these rules:

- It carries a `requestId` (16–80 characters) and the page's `scope`. A page loaded for another
  network or scope gets 409.
- It takes the `ryo_admin_control` row lock, which serializes staff writes and keeps the audit chain linear.
- It re-checks the actor's roles inside that transaction, before committing.
- It is idempotent: the same `requestId` returns the stored result (`replayed: true`). Reusing an ID
  for a different action gets 409.
- Changes to a wallet's standing (warn, mute, unmute, ban, unban) need the `expectedVersion` the
  moderator reviewed. A stale page gets 409.
- It needs a reason of 8–500 characters.
- It is rate-limited to 30 per minute per staff wallet.
- It appends to the existing `ryo_admin_audit` hash chain, as `cc.*` actions. Message text never
  enters the chain; only its SHA-256 does.

## Moderation details

- Mutes last 5 minutes, 30 minutes, 1 hour, 24 hours or 7 days. Bans last until lifted. Warnings
  are shown to the player for 24 hours.
- Hide keeps the message as restricted evidence (`ryo_chat.hidden`). Players stop receiving it, and
  open clients drop it through `removed`. Open reports on the message become `actioned`.
- Reports snapshot the message, because chat keeps only the newest 200 messages per channel.
- Evidence text is redacted 90 days after resolution. The decision record stays. The 90-day period
  is an owner decision; it is listed in the Phase 1 review.
- Announcements are proposed by one wallet and approved by a different one. They expire after 7 days.
  When approved, they post to the read-only System channel in EN and, optionally, PT-BR. They can be
  unpublished (hidden).

## Phase 2: Founder operations (read-only)

The Founder NFTs view has six tabs. Overview is the Phase 1 view (with the Owner-only Pause sales and Suspend / Restore
actions). The other five are **read-only**: they never write, sign, grant, repair or call a payment. They are served by
`founder-ops.cjs` (copied to `app/server/command-center-founders.cjs`), behind the existing `founders.read` permission
(Owner, Financial Approver, Game Operator; never Viewer, Moderator or Support, because they show full wallets).

| Tab | Action | What it shows |
|---|---|---|
| Collections | `cc-founder-collections` | Supply, sold, reserved, expired and remaining per tier, gross confirmed receipts, sale mode, pause state and switches. "Check on chain" reads every confirmed Founder mint (finalized): supply 1, 0 decimals, Token-2022, mint authority removed, and the current holder. Cached 10 minutes (a failed read 1 minute), one read at a time. |
| Entitlement lookup | `cc-founder-lookup` | One buyer, by wallet, Founder mint address or "mythic #5": payment evidence, entitlement and perks, Limited Passes left, Sensei trial and purchases, Founder heroes in the profile, Premium Summon progress, stored summon rolls, Market listings of Founder heroes, the Founder audit, and that wallet's integrity findings. |
| Integrity checks | `cc-founder-integrity` | Reconciliation checks that should all be empty (see below). A finding is for the Owner to review; nothing is repaired here. |
| Early access & Council | `cc-founder-access` | Buyer-bound eligibility (Mythic: full Council, Legacy: community) beside the current NFT holder. No Early Access dates exist and a Founder NFT never opens the game. Council votes are not implemented. |
| Premium weeks | `cc-founder-weeks` | The Premium Summon qualifying-week tracker per Founder, and weekly activity counts. The Weekly Mission Pass is shown as not implemented. |

Integrity checks: confirmed purchase without an entitlement; entitlement without a matching purchase; duplicate wallet or
serial; serial above supply; Limited passes left + used not equal to 10; summon before activation; summon rank outside its
pool; Premium Summons over the completed qualifying weeks; discounted SOL Sensei outside a running Legacy trial; Mythic who
also paid SOL for Sensei; trial not 7 days; profile Founder tier without an entitlement, or on a suspended one; Founder
heroes listed on the Market; reservations pending over 30 minutes; and, after "Check on chain", mint missing / supply not 1 /
mint authority still set / wrong program.

Benefits stay with the original buyer (owner decision 2026-11-09): the current on-chain holder is shown for information only
and changes nothing. The configured supply is Mythic 33 and Legacy 30 (the specification proposed 30 + 30).

## Stats report (read-only)

The **Stats report** tab (`cc-stats-report`, permission `stats.read`: Owner, Financial Approver, Game Operator and Viewer;
never Moderator or Support) shows what happened in a time range:
- tiles for Ryo spent, SR deposited, heroes summoned, free heroes, SOL sales, withdrawals, Chest claims and players;
- cumulative charts of deposits against spending, and of heroes summoned against heroes given free;
- Ryo spent per hour or day, by service, with markers for launch and feature switches;
- rarity against the published odds, revenue pots, free-hero sources, the Chest, Founder sales;
- notes, and a table view. **Download JSON** and **Copy JSON** export the same answer.

The server runs the code of `tools/launch-stats-report.cjs`, copied to `app/server/stats-report.cjs`. The Render Shell
command and the tab therefore always agree.
- **Read-only.** It uses one `REPEATABLE READ READ ONLY` transaction with SELECT statements only, always rolled back, on its
  own pool client.
- **Totals only.** The answer has no wallets, signatures or request IDs.
- **Range limits.** The range starts on or after 1 Jan 2026 and must not end in the future. Hourly grouping covers at most
  31 days; the page switches longer ranges to Day.
- **Light on the database.** The game shares a small connection pool, so one report runs at a time per server. An
  identical request shares the running one, and a different one gets 429. A result is reused for 60 seconds.
- **Not audited.** Like other reads in this console, viewing a report writes no audit record.
- **Not recorded by the game.** Sign-ups over time and daily active players are not recorded, so the tab doesn't show them.

## Not implemented (shown as such, never simulated)

The following have no backend yet:

- Guild, Team, DM, Trade and Event chat.
- The Weekly Mission Pass, Founder's Council votes, Early Access scheduling, economy and treasury controls, creators and
  marketing, events, game configuration, support tickets and the security center.
- Player appeal forms.
- Search by referral code or NFT serial.
- New sign-up and daily/weekly active counts. The game records no creation time, and presence is
  kept for only 90 seconds.

## Tests

- `tests/command-center-server.cjs` runs through the real dispatcher and schema on PGlite. It covers:
  - the role matrix and redaction;
  - mute, ban and hide enforced in `chat-send`;
  - reports, including snapshots that survive pruning;
  - two-person announcements and expiry;
  - idempotency, stale versions and scope binding;
  - rate limits;
  - the shared audit chain;
  - health;
  - no economic mutation.
- `tests/command-center-ui.cjs` runs the console in Chrome. It covers sign-in, desktop, tablet and
  phone layouts, the guarded mute dialog, the not-implemented modules, the viewer and moderator
  scopes, EN/PT-BR, and the absence of script injection. Screenshots go to `tests/out/command-center-*.png`.
- `tests/command-center-stats.cjs` covers the Stats report action:
  - the role matrix, with custody wallets refused;
  - input checks;
  - the figures and the `until` cut-off;
  - the 60-second cache;
  - one run at a time (a shared run, or 429);
  - the client released after a failure;
  - no wallets in the answer;
  - read-only SQL.
  `tests/command-center-ui.cjs` also generates the report as a Viewer under `style-src 'self'`.
- `tests/chat-screen.cjs` checks the player's side: reporting, the hidden-message drop, and the muted composer.
- The `prelaunch-server`, `private-testing` and `site-check` suites assert that the console stays closed
  in the portal stage, follows the private pass, and serves only its four files.

## Rollback

1. Remove the two calls from `unpack.cjs` (`applyCommandCenter`, which runs before the network step, and
   `applyCommandCenterSchema`, which runs after the last schema step), revert the two baseline hashes,
   and rebuild. This restores `service.cjs` and the schema.
2. Remove the `/admin/command-center/` map from `server/site-server.cjs`, so the console is no longer served.
3. Revert the edits to `chat/server.cjs` and `website-design/website-design.js`.

The `ryo_cc_*` tables and the `ryo_chat.hidden` column are additive and can stay (they are ignored),
or be dropped by the hosting owner after an export. No other table is touched.
