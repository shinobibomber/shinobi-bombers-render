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
| `ops-views.cjs` | Batch A read-only views, copied to `app/server/command-center-views.cjs`: Game configuration status, Security center, Creators summary. |
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
| Financial Approver | `RYO_ADMIN_APPROVERS` (existing) | Overview, health, player economy and transactions (read-only), announcements (read), support tickets (read-only), and the full audit log. |
| Game Operator | `RYO_ADMIN_OPERATORS` (existing) | Overview, health, players, chat moderation, announcement review, support tickets, and the full audit log. |
| Moderator | Backend grant (`ryo_cc_roles`) | Overview, health, player identity and chat standing, chat moderation, proposing announcements, and its own audit records. |
| Support | Backend grant (`ryo_cc_roles`) | Overview, health, player identity and heroes, reading moderation, dismissing reports, answering support tickets, and its own audit records. |
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

## Batch A: Game configuration, Security center, Creators summary

Three views, built to the same rules as the Stats report: they read, they return no wallet lists and no environment values
(only booleans, the release stage and the variable NAMES of switches), and anything the game does not record is shown as
"Not implemented", never invented. A section that cannot be read says "unavailable" and is never shown as healthy.

| View | Action | Permission | What it shows |
|---|---|---|---|
| Game configuration | `cc-config` | `config.read` (Owner, Approver, Operator, Viewer) | Every feature switch with its group (money, founders, rewards, gameplay), the effective value, where it comes from (default, environment or Control panel), the last change, and the hash-verified switch log; the release stage, launch hold and the public launch gates. **It never changes a switch.** Changes stay in `/admin/control`, which asks for a fresh wallet signature before it opens anything that touches money. |
| Security center | `cc-security` | `security.read` (Owner, Approver, Operator) | Verification of the last 200 admin audit records (hashes and links) and of the switch log; staff role counts; active session counts (no tokens); staff write activity; findings (broken chain, critical incidents, one-wallet approval on). Failed sign-ins and request floods are not stored, so they are listed as not implemented. |
| Incident register | `cc-incidents`, `cc-incident-open`, `cc-incident-update` | read: `security.read`; write: `security.manage` (Owner, Operator) | A staff notebook (title, severity, details, status). It changes nothing in the game. Writes use the standard staff-write rules (reason, idempotent request ID, version check, 30 a minute) and land on the audit chain as `cc.incident.*`. A resolved incident is final; at most 50 are open. Table: `ryo_cc_incidents`, additive. |
| Creators summary | `cc-creators` | `creators.read` (Owner, Approver, Operator) | Aggregates from the Creators Portal: applications by status, Creator Points issued, spent and held, creator and player referrals, shop redemptions, Hero Pass campaigns and passes, rescue heroes, program settings. No names, wallets or applications. Approvals, adjustments and grants stay in the Creators Portal admin. Paid marketing campaigns have no backend and are listed as not implemented. |

## Batch B: Support tickets

Players send tickets from the game (Reward Center, Help & Support, Contact Support) and the team answers in a two-way thread. The
rules live in `support/server.cjs` (copied to `app/server/support.cjs` by `apply-support.cjs`). Owner decisions 2026-11-12: entry in
Help & Support, shipped ON, two-way replies, ticket text kept 30 days after the ticket is resolved or closed, English-only player UI.

| Part | Action | Who | What it does |
|---|---|---|---|
| Player | `support-state`, `support-submit`, `support-view`, `support-reply` | any signed-in wallet, behind the `supportTickets` switch (default ON) | The wallet always comes from the session. Limits: 3 new tickets and 20 replies per 24 hours, 5 open tickets, 60 messages per ticket, 1000 characters. An optional order link (request ID or signature) is accepted only if it is one of THIS wallet's purchases, deposits or withdrawals; anything else is the same 404. A repeated `requestId` returns the stored result. A reply reopens a resolved ticket; a closed ticket is final. |
| Staff read | `cc-support-list`, `cc-support-ticket` | `support.read` (Owner, Approver, Operator, Support) | Queue with status, category and wallet filters, "needs a reply" marker, the thread with internal notes, and what the linked order is. |
| Staff write | `cc-support-reply`, `cc-support-note`, `cc-support-update` | `support.write` (Owner, Operator, Support; never Approver) | Reply (the player sees it, the ticket becomes awaiting the player, investigating or resolved), internal note (never shown to the player), status and assignment (a reason is required). Reply and update check the ticket version (stale page gets 409); closed is final for staff too. |

- **No money access.** Staff can change only a ticket's status, assignee and messages. Nothing in this module touches balances,
  rewards, withdrawals, wallets or NFTs, and `tests/support-server.cjs` proves the ledger is unchanged.
- **Players never see staff wallets or internal notes.** A staff message reaches the player as "team".
- **Audit.** Staff writes land on the shared hash chain as `cc.support.reply`, `cc.support.note` and `cc.support.update`. Message
  text never enters the chain, and neither does a hash of it (a short reply could be confirmed by guessing). Only its length is recorded, so
  the permanent chain cannot outlive the 30-day text retention.
- **Retention.** Ticket text (subject, order link and every message, internal notes included) is replaced with "[expired]" 30 days
  after the ticket is resolved or closed. There is no scheduler: it runs inside the ticket actions, and every player read and every
  staff read or write applies it first, so expired text is never shown. Open tickets are kept. A reply that reopens a resolved ticket
  stops the clock.
- **The switch gates players only.** If `supportTickets` is switched OFF in the Control panel, players get a "not open right now"
  message, but staff can still read, answer and close the existing tickets.
- Tables: `ryo_support_tickets`, `ryo_support_messages` (additive, appended to the end of `schema.sql`).

## Not implemented (shown as such, never simulated)

The following have no backend yet:

- Guild, Team, DM, Trade and Event chat.
- The Weekly Mission Pass, Founder's Council votes, Early Access scheduling, economy and treasury controls, paid marketing campaigns and
  payouts and events.
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
- `tests/command-center-views.cjs` covers Batch A: the role matrix, aggregates only (a secret, a launch-hold text, a database URL
  and every wallet are absent from each answer), tamper detection on the audit chain and the switch log, the incident rules
  (two writers, stale version, closed is final, idempotent replay, cap) and degradation when a table is missing.
  `tests/command-center-ui.cjs` also opens an incident and resolves it in Chrome.
- `tests/support-server.cjs` covers Support tickets through the real dispatcher on PGlite: build integrity (reversing the support hooks and
  schema block gives the previously pinned `service.cjs` and `schema.sql`), the switch, validation, every limit, order-reference
  ownership, idempotency, reopen and closed rules, notes and staff wallets hidden from players, the staff role matrix, audit without
  text, 30-day retention (including a read at the moment of expiry) and no economic mutation. `tests/support-ui.cjs` drives the player
  dialog in Chrome (text shown as text, readable errors, switch OFF, phone fit), and `tests/command-center-ui.cjs` covers the staff tab
  (queue, filters, thread, reply, internal note, assign, status, read-only Approver, Support role, phone layout).
- `tests/chat-screen.cjs` checks the player's side: reporting, the hidden-message drop, and the muted composer.
- The `prelaunch-server`, `private-testing` and `site-check` suites assert that the console stays closed
  in the portal stage, follows the private pass, and serves only its four files.

## Rollback

1. Remove the two calls from `unpack.cjs` (`applyCommandCenter`, which runs before the network step, and
   `applyCommandCenterSchema`, which runs after the last schema step), revert the two baseline hashes,
   and rebuild. This restores `service.cjs` and the schema.
2. Remove the `/admin/command-center/` map from `server/site-server.cjs`, so the console is no longer served.
3. Revert the edits to `chat/server.cjs` and `website-design/website-design.js`.
4. Support tickets: switch `supportTickets` OFF in the Control panel (or set `SUPPORT_TICKETS_ENABLED=off`) for an immediate stop with no
   rebuild. To remove it fully, drop the `applySupport` call from `unpack.cjs` and revert the three pins it moved (the `app/server/service.cjs` and
   `app/server/schema.sql` entries in `tests/baseline-hashes.json`, and `PREVIOUS.schema` in `tests/reward-pool.cjs`). The `ryo_support_*` tables are
   additive and can stay.

The `ryo_cc_*` tables and the `ryo_chat.hidden` column are additive and can stay (they are ignored),
or be dropped by the hosting owner after an export. No other table is touched.
