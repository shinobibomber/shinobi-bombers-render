# Backend integration contract

Keep the existing wallet client and service. A new website should launch/embed the game; it should not implement a second balance ledger.

Runtime endpoint: `POST /.netlify/functions/ryo` (also served at `/api/ryo`). The current client uses the first path. Requests use JSON, authenticated operations send the native Bearer session, and the server enforces its configured `Origin`. Private credentials never belong in browser code, URLs, examples or source control.

| Action | Auth | Purpose |
| --- | --- | --- |
| `config` | Public | Current Devnet mint/addresses, limits, fee/cooldown, loot-rate configuration. |
| `challenge`, `login` | Wallet signature | Native origin/wallet/mint/nonce-bound sign-in; no token transfer. |
| `state` | Session | Verified balance/profile, recent transaction rows, server time and next withdrawal time; recovers pending settlement. |
| `adventure` | Session | Settle authenticated active/offline eligibility; return verified Chest snapshot. Never send client loot/damage totals. |
| `claim-adventure` | Session | Atomically credit whole funded Ryo to game balance, bounded by pool/custody liabilities. This sends no on-chain payout. |
| `deposit` | Session + receipt | Verify finalized signed SPL receipt, recipients, mint, amounts and memo; replay-safe credit after verification. |
| `withdraw` | Session | Reuse native request ID and reserve balance; server signs payout, checks finalization and settles/refunds idempotently. |
| `quote`, `purchase`, `ack-purchase` | Session | Existing products, exact total, authoritative outcome/ownership, pending/finalized/refund and delivery acknowledgment. |
| `hero-mode` | Session | Validate owned hero and battle-ready/reserve limit. |
| `sensei-settings` | Session | Validate saved return threshold/on-off and settle previous state correctly. |
| `presence` | Session | Existing authenticated active-player tracker. |

Do not call these directly from a cross-origin parent website using an invented session. Let `BetaWallet`/`RyoPayments` perform the existing authentication and recovery. A fully separate website account system is not automatically linked to a game wallet account.

## Data shapes to preserve

- Chest: `pending`, `pool`, `claimed`, `credited`, `map`, `kills`, `active`, `senseiActive`, `offlineSeconds`, `offlineCapHours`, `rewardRatePercent`, `rewardPoolStep`, `nextRateAt`.
- Ledger: `balance`, `profile`, `purchases`, `withdrawals`, `deposits`, `nextWithdrawalAt`, `serverTime`.
- Transaction amounts and timestamps can be PostgreSQL numeric **strings**. Normalize/format safely. Never interpret a missing amount as an actual zero or treat numeric-string dates as ISO text.
- History is bounded to the returned recent100 purchases/30 withdrawals/20 deposits. The current UI filters/pages those records; no unlimited server cursor or individual claim-event history is implemented.
- Display limits and fees from configuration. Preview arithmetic does not authorize a transfer; the server/wallet must still verify it.
- Pending or ambiguous requests stay recoverable. Do not clear stored IDs/receipts just because an HTTP request timed out. Do not optimistically credit or retry using a new payment ID.

## Deployment/private environment

Use Node22 and PostgreSQL. Required server variables are `DATABASE_URL`, `RYO_TREASURY_SECRET`, `RYO_TOKEN_MINT`, `RYO_STUDIO_WALLET`, `RYO_REVENUE_WALLET`, `RYO_SITE_ORIGIN`. Optional `SOLANA_DEVNET_RPC_URL`, `PORT`. Render can derive origin from `RENDER_EXTERNAL_URL` when unset.

`RYO_SITE_ORIGIN` is the **game page's origin**. A parent website embedding a game on another origin does not change that. For a reverse-proxied `/game/` mount, both assets and the original root API path need correct routing and the configured origin must match the public browser origin. See `INTEGRATION-GUIDE.md`.

This package neither contains private values nor provisions/funds infrastructure. Use existing securely configured beta values or configure a separate beta environment. Do not rotate wallets or change database scope as an accidental side effect of adding the website.
