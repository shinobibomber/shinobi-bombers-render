# Shinobi Command Center: Phase 1 review

**Branch:** `release/command-center-live`, based on `origin/live` and released to `live` at the owner's request on 2026-11-09.

**Status:** released to the live server. While `PRELAUNCH_MODE` is on, the console returns 404 there; in the private stage it needs the private pass. The release ran only the additive migration in section 3. No SOL or Ryo was moved, nothing was signed on chain, and no live setting was changed. Phases 2–4 wait for your approval.

## 1. Current versus proposed capabilities

| Capability | Before | After Phase 1 | Notes |
|---|---|---|---|
| Wallet-signed staff sessions | Yes (`challenge`/`login`, 1 h) | Reused unchanged | No new auth path |
| Admin roles | Approver / Operator / Viewer (env) | + Owner (env `RYO_ADMIN_OWNERS`), + Moderator / Support (backend grants by Owner) | Financial roles cannot be granted in the backend |
| Two-person financial approval | Yes (economic dashboard) | Unchanged | Not touched |
| Global chat (signed sessions) | Yes | Yes + report, hide, warn, mute, ban, enforced in `chat-send` | |
| System channel | Server-written Legend notices | + official announcements after two-wallet review | Players still cannot post |
| Guild / Team / DM / Trade / Event chat | Picture/preview only | **Not implemented** (shown disabled) | No backend; nothing monitored |
| Player lookup | None (top-25 leaders only) | Read-only, redacted by role | No balance or hero edits |
| Server health | `/healthz` = static ok | DB, RPC genesis, build, release stage, gates, queue | Failing checks shown as unavailable |
| Audit viewer | Latest 100 in dashboard | Paged, filtered, per-row hash/link verification | Same hash chain |
| Legacy NFT minting, Weekly Pass, Sensei trial, early access | **Do not exist** | **Not implemented** (Phase 2 entries, no controls) | Mythic Box remains the only NFT service |
| Revenue / treasury | Ryo Observatory | Linked, not duplicated | Phase 3 |

## 2. Changed files

**New**

- `command-center/server.cjs`: the staff API.
- `command-center/schema.sql`: the migration.
- `command-center/public/{index.html,cc.js,cc.css}`: the console.
- `command-center/README.md`: the module documentation.
- `command-center/PHASE1_REVIEW.md`: this review.
- `apply-command-center.cjs`: the build step.
- `tests/command-center-server.cjs` and `tests/command-center-ui.cjs`: the new suites.

**Modified**

- `chat/server.cjs`: enforcement, the `removed`/`standing` fields, `chat-report`, and an exported `prune`.
- `chat/README.md`: documents moderation.
- `apply-chat.cjs`: the client hook now allows `chat-report`.
- `economic-dashboard/server.cjs`: additive export of `audit`/`control` so there is one shared hash chain. Behavior is unchanged.
- `unpack.cjs`: two build calls.
- `server/site-server.cjs`: fixed file map for `/admin/command-center/`.
- `website-design/website-design.{js,css}`: the player's Report button and panel, the dropping of hidden messages, and the mute/ban/warning notice.
- `tests/baseline-hashes.json`: two generated-file hashes, `app/server/schema.sql` and `app/server/service.cjs`, updated for the intentional schema append and route hooks, as earlier features did.
- `tests/harness.cjs`: routes `chat-report`.
- `tests/chat-screen.cjs`: report, hide and mute checks.
- `tests/run.cjs`: registers the two new suites.
- `tests/site-check.cjs`, `tests/prelaunch-server.cjs` and `tests/private-testing.cjs`: gating assertions.

> **Commit planning:** several files already had **uncommitted edits before this work**:
> `server/site-server.cjs`, `tests/run.cjs`, `tests/prelaunch-server.cjs`, `tests/private-testing.cjs`
> (all from the private-testing release stage), plus `network/network.cjs`, `prelaunch/*`, `render.yaml` and `README.md`.
> Committing this work therefore needs a decision: commit the private-testing work first, or stage hunks selectively.

## 3. Migration review

The migration is additive and idempotent. It is appended once to the generated `schema.sql`, which `db:init` runs on every build.

| Statement | Purpose |
|---|---|
| `CREATE TABLE IF NOT EXISTS ryo_cc_control` | Roles version per scope |
| `ryo_cc_roles` | Moderator/Support grants (CHECK limits roles to those two) |
| `ryo_cc_chat_status` | Mute/ban/warning standing, versioned |
| `ryo_cc_chat_actions` (+2 indexes) | Decision records, unique `(scope, actor, request_id)` |
| `ryo_cc_chat_reports` (+2 indexes) | Reports with message snapshot, unique per reporter/message/category |
| `ryo_cc_announcements` (+1 index) | Two-person announcements |
| `ryo_cc_requests` | Idempotency receipts |
| `ALTER TABLE ryo_chat ADD COLUMN IF NOT EXISTS hidden BIGINT` | Soft hide (nullable, no default rewrite) |

- **Conventions:** the migration follows the project's: scope-keyed tables, BIGINT epoch-ms times and inline CHECKs.
- **What it leaves alone:** there is no DROP, no destructive ALTER, and no change to any balance, purchase,
  withdrawal, reward or NFT table. The schema is applied twice in the tests to prove it is idempotent.
- **Blueprint:** `SCHEMA_BLUEPRINT.sql` was not run.
- **Before a live deploy:** take a database snapshot. On Render the build's `db:init` applies this
  automatically, so **approving a deploy is approving this migration**.

## 4. Security properties (tested)

- **Authorization:**
  - Every `cc-*` action requires a valid wallet session and a role. Roles are re-derived on the server
    for each request and re-checked inside the write transaction.
  - A client-supplied wallet or role is never trusted.
  - Custody, studio and revenue wallets are refused.
- **Request handling:** the existing Origin, JSON and 8 KB checks of `/api/ryo` apply. The console sets
  `script-src 'self'` and `frame-ancestors 'none'`, and the token is held in memory only.
- **Writes:**
  - Each write carries a request ID, so a replay returns the stored result and never re-applies.
  - Writes are bound to the scope, so a page from another network or scope cannot act.
  - Standing changes need the expected version, so a stale page gets 409.
  - A reason is required.
  - Writes are limited to 30 per minute per staff wallet.
- **Enforcement:** mute and ban are enforced inside `chat-send` under the same account row lock as the
  send, before the rate limits run. A muted player can still read.
- **Separation of duties:**
  - Announcements need a different reviewer, a current version, and must be reviewed within 7 days.
  - Staff cannot sanction staff or themselves.
- **Audit:** every write extends the existing `ryo_admin_audit` hash chain. The economic dashboard's own
  chain verification still passes over the mixed chain. Message text stays out of the chain; only its
  SHA-256 is recorded.
- **Finance isolation:** backend roles get 403 from `admin-snapshot`/`admin-propose`. There is no credit,
  mint, transfer or withdraw action, and a test asserts that balances, purchases, withdrawals and reward
  claims are unchanged.
- **Gating:** with `PRELAUNCH_MODE` in the portal stage the console paths return 404. In the private
  stage they need the private pass (both tested).
- **Rendering:** all chat and user content is rendered as text. A `<img onerror>` payload is shown
  literally in the browser test.

## 5. Evidence

See the test table in the handoff message. These suites ran:

- **Full regression run:** `npm test`, which is all suites plus `test:site`.
- **Other checks:** `npm run check:rewards`, `npm run check:site`, `npm run typecheck` and `npm run lint`.

**Screenshots** (in `tests/out/`, gitignored):

| Group | Files |
|---|---|
| Desktop | `command-center-overview-desktop.png`, `-chat-desktop.png`, `-moderation-dialog.png`, `-player-desktop.png`, `-audit-desktop.png`, `-health-desktop.png` |
| Tablet | `-overview-tablet.png` |
| Phone | `-overview-mobile.png`, `-nav-mobile.png`, `-chat-mobile.png` |

## 6. Deviations from the package and known limits

1. **Error shape.** Errors keep the API's existing `{error: message}` shape (HTTP status carries the
   class), not `{error:{code,message,correlationId}}`. Changing it would touch every game client call.
2. **Audit coverage.** Denied attempts and read-only lookups are not written to the hash chain, to stop
   unauthorized wallets from flooding it. They are not logged elsewhere yet; this is Phase 4 (Security Center).
3. **No step-up signing.** Bans are reversible, and no fresh wallet signature (step-up) is required for
   them yet.
4. **Appeals.** There is no dedicated in-game appeal form. Players can now send a ticket from Help & Support (see "Support tickets"
   in the README), and staff unmute or unban with a reason.
5. **Warnings.** A warning is shown to the player for 24 hours above the chat composer. There is no
   acknowledgement step.
6. **Report entry point.** Players report from the full Chat screen (⚑ on each message). The Home chat
   pop-up has no report button.
7. **Metrics.** New sign-ups and daily or weekly actives are shown as *Unavailable*: the game records no
   account creation time and keeps presence for only 90 seconds.
8. **Node version.** Tests ran on the installed Node v26. The project and Render pin Node 22, which was
   not re-run here.
9. **Independent review.** A `/security-review` or `/code-review` by a different reviewer is still
   required before shipping, per CLAUDE.md.

## 7. Decisions needed from you

1. **Owner wallet(s):** add `RYO_ADMIN_OWNERS` to the test (Devnet) service. Until it is set, nobody
   can grant Moderator or Support. Approver, Operator and Viewer keep working.
2. **Evidence retention:** 90 days after resolution (current default)? Choose another period if needed.
3. **Bans:** should a ban require a fresh wallet signature (step-up)?
4. **Announcement review:** is the current rule right? Today Owner and Game Operator may review, and the
   reviewer must not be the proposer.
5. **Moderator permissions:** should Moderators also propose announcements (currently yes)?
6. **Path:** should the console stay at `/admin/command-center/` beside the Observatory at `/admin/`, or
   should they be merged?
7. **Commit plan:** commit the private-testing work separately, then this branch?
8. **Rollout:** deploy to the Devnet test server after an independent review? `main` auto-deploys.

## 8. Rollback

See `command-center/README.md` → *Rollback*. In short:

1. Remove the two `unpack.cjs` calls and the `site-server` file map.
2. Revert the chat client and server edits.
3. Optionally drop the `ryo_cc_*` tables after an export.
