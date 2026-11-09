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
| `public/` | The console (`index.html`, `cc.js`, `cc.css`). It is served from a fixed file map with `script-src 'self'`. |
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

## Not implemented (shown as such, never simulated)

The following have no backend yet:

- Guild, Team, DM, Trade and Event chat.
- Founder NFT management, Weekly Mission Pass, early access, economy and treasury, creators and
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
- `tests/chat-screen.cjs` checks the player's side: reporting, the hidden-message drop, and the muted composer.
- The `prelaunch-server`, `private-testing` and `site-check` suites assert that the console stays closed
  in the portal stage, follows the private pass, and serves only its three files.

## Rollback

1. Remove the two calls from `unpack.cjs` (`applyCommandCenter`, which runs before the network step, and
   `applyCommandCenterSchema`, which runs after the last schema step), revert the two baseline hashes,
   and rebuild. This restores `service.cjs` and the schema.
2. Remove the `/admin/command-center/` map from `server/site-server.cjs`, so the console is no longer served.
3. Revert the edits to `chat/server.cjs` and `website-design/website-design.js`.

The `ryo_cc_*` tables and the `ryo_chat.hidden` column are additive and can stay (they are ignored),
or be dropped by the hosting owner after an export. No other table is touched.
