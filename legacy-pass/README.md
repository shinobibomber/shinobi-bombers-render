# Shinobi Legacy Pass v1.1 — development review

Implemented on `review/shinobi-legacy-pass-v1-2026-11-08`. No production deployment or live NFT/RYO operation is part of this change. `SHINOBI_LEGACY_PASS` defaults to disabled; `PRELAUNCH_MODE=on` always disables the pass. Existing launch claim gates and the administrator's purchases pause also block reward mutations.

## Verified progression

Activate one registered Founder's NFT serial from **Tools → Founder's Weekly Legacy Pass** each week. Ownership is read at finalized commitment using the existing NFT integration and confirmed mint/serial registry (initial serials 1–20). Network verification uses the existing service genesis check and network-scoped Store. Environment credentials and treasury addresses are unchanged.

Monday 00:00 UTC creates a fresh entitlement. Six missions each award 20 XP; XP stops at 100 after any five. A wallet may switch between its serials, but events advance only the selected pass. Selection settles prior activity before switching; it never copies progress. Progress and milestone receipts belong to `(scope, week, serial)`, while earned fragments/items belong to the claiming wallet. Transfers do not reset claims. Unclaimed milestones must be claimed before the weekly reset.

- Adventure attacks and enemy defeats come from the existing accepted Power/cooldown/chakra ledger, including owned-hero validation and report replay protection.
- Natural recovery records actual capped chakra gain with a persisted watermark. A ticket's restoration is not natural-recovery mission credit.
- Full Boss Hunt proof requires the original 60-second hunt to finish with positive authoritative damage. Early retreat and old-week completion cannot satisfy the current week's mission. Stable entry IDs prevent duplicate proof after switching passes.
- **Online stage clears remain unsupported as mission proof.** The existing online stage number is client-reported and cannot safely award XP. Only stages advanced by the existing authoritative offline Sensei simulation count. A holder can instead complete the other four missions plus a full verified Boss Hunt. No paid service or combat rule was added to work around this limitation.
- NFT RPC errors fail closed. Progress cannot be attributed while current finalized ownership cannot be established; the game continues without issuing unverified mission credit. Claims/status surface verification errors. Historical client reports cannot be used to backfill ownership evidence.

The optional combat callback observes accepted events without modifying damage, chakra, timing, SR rewards or pool funding. Offline events are aggregated in memory before database writes, and saturated counters stop creating redundant receipts. When disabled, no mission event collector or recovery counter is active.

The full regression run also exposed an existing client handoff race: automatic refreshes could set `active=false` before already-fired projectiles finished. The client now stops new attacks immediately but preserves automatic online reports during the bounded drain, then forces offline reports after draining. Explicit pagehide reports remain offline. A deterministic handoff test and the existing real-time reward browser suite cover this; reward formulas and the 300 ms / 1.5 s sync cadence are unchanged.

## Accounting and delivery

`schema.sql` adds only `ryo_legacy_*` tables: selected entitlement, weekly progress, event receipts, milestone claims, fragment ledger, expiring items, redemption outcomes and recovery watermarks. Initialization is idempotent. Existing account, NFT, market, revenue and pending-payment rows are not migrated or reset.

Milestones issue 1 shard / ticket / voucher / 2 shards / fragment at 20/40/60/80/100 XP. Shared Upgrade Shard inventory is used; existing pending training settlement preserves newly claimed shards. Ticket/voucher inventories each hold at most four unexpired or reserved items. Weekly claims are serialized by the wallet lock and serial pass lock, with unique database keys as the final duplicate barrier.

Two fragments are debited atomically with a permanently saved premium hero result. `crypto.randomInt(10000)` selects Elite on 0–6999 and Legend on 7000–9999. There is no client seed, rank selection, transaction signature or purchase/revenue allocation. Normal rank stats and 4/5 permanent unique perks come from the existing hero factory. All other ranks have 0% probability.

Reuse the same redemption request ID after a network failure. The original result is returned. A full 500-hero collection or pending purchase queues that fixed hero; delivery never rerolls or spends fragments again. Queued deliveries remain visible without a history truncation limit. Delivery reuses the existing hero reveal animation without fabricating a paid order.

Premium heroes carry permanent `accountBound`, `legacyPassReward`, `referralReward` and reward provenance fields. Existing serialization preserves them. Backend Market and salvage validation reject them; fusion propagates the restriction per input group. The existing paid-referral verifier also rejects these reward outputs. The referral flag is reused for compatibility with current nonmarketable-hero protections; the collection labels premium rewards separately.

## Consumables

- Recovery ticket: selected owned resting hero only, no active Boss Hunt, no pending purchase; restores `min(25% max chakra, 20, missing chakra)`. Expires 14 days after claiming. A full hero does not consume the ticket.
- Training voucher: select it in the pass screen before opening the normal training checkout. Fresh Founder ownership is required. Total holder discount becomes 15%, replacing 10%; additional savings are `min(10,000, round(base × 90%) − round(base × 85%))`. Shards do not change. The server requotes and reserves the owned item in the purchase transaction. Only successful finalized purchase settlement consumes it; preparation failure rolls back reservation and refund releases it. A reserved pending quote remains valid through item expiry. Existing orders without voucher metadata are unaffected.

## Local verification and preview

Use Node 22 and the existing development dependencies:

```powershell
npm --prefix chest-ui run build
node unpack.cjs
npm run lint
npm run typecheck
npm run check:rewards
node tests/legacy-pass-server.cjs
node tests/legacy-pass-items.cjs
node tests/legacy-pass-ui.cjs
npm test
```

Browser tests use isolated Postgres and mock finalized NFT ownership; no real wallet, payment, RPC or private credential is used. Screenshots are written under `tests/out/legacy-pass-*.png` and `tests/out/legacy-premium-reveal.png`. The server suite includes 100,000 independent secure random draws plus exact probability-boundary assertions. Existing authentication, gameplay, market, NFT, finance, reward guard and pre-launch suites remain in the mandatory runner.

Verified Nov 8, 2026 on Node 22: Chest UI build/typecheck, verified archive assembly, lint, the real-time rewards guard, all **70 game suites** and **20 website checks** passed. Desktop/phone pass screenshots and the completed premium hero reveal were rendered and inspected. The complete run exited successfully. Results are local isolated tests, not live-chain or production deployment verification.

For an existing configured **development** server, set `SHINOBI_LEGACY_PASS=on`, keep the verified development network/database settings, initialize the new schema through the usual build, and restart. Do not copy production credentials or enable Mainnet financial gates to preview this feature. Production rollout and online-stage verification require separate review.

## Changed implementation files

- `apply-legacy-pass.cjs`, `unpack.cjs`: generated-app integration and exact reversible client hooks.
- `legacy-pass/{rules.js,server.cjs,schema.sql,client.js,client.css}`: shared rules, authoritative accounting and themed dialog.
- `combat-rules/{adventure.cjs,chakra.cjs,hunt.cjs,client.js}`: trusted mission evidence callbacks, actual natural recovery tracking, and the final-hit offline handoff fix.
- `hero-upgrades/{server.cjs,client.js}`, `website-design/website-design.js`: permanent premium reward restrictions and labels.
- `chest-ui/src/{GameHeader.tsx,bridge.ts,main.tsx}`: feature-gated Tools entry.
- `tests/legacy-*.cjs`, `tests/combat-offline-handoff.cjs`, `tests/harness.cjs`, `tests/run.cjs`, `tests/preservation.cjs`, `tests/creators-server.cjs`, `tests/referral-bound.cjs`, `tests/baseline-hashes.json`: accounting, integration, statistical and visual regressions; the older Creator migration fixture reverses the exact later Legacy observer hooks, and the collection-lock assertion covers both referral and premium reward bindings. Only the five intentionally changed pinned generated integrations have updated hashes.
- `PROJECT_STATUS.md`, `PATCH_NOTES.md`: local-review handoff and player-facing release text.
