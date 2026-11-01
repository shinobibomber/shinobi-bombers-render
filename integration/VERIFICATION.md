# Verification and remaining dependencies

Package scope: existing main game plus shared Design14 Header/Chest; no full V3 conversion. Backend/economy files and original visual/game modules remain preserved.

## Checks

- Strict TypeScript and production frontend compilation passed.
- Custom source hygiene lint passed (unsafe HTML injection, type suppression, untyped `any`, debug logging). It is not ESLint.
- Preservation checks compare76 maintained game/server/visual files,35 untouched inline modules and the wallet module after removing only the exact added read-only pending-deposit getter. Map art/topology, core combat, hero IDs, inventory/economy and existing server logic remain unchanged.
- Native SDK transaction review tests validate signature/instruction boundaries with genuine SDK types and isolated test keys.
- PGlite financial tests use the actual assembled backend with mocked RPC: finalized/replayed/forged deposits, purchase funding, withdrawal reserve/confirmed/refund-once, rolling24h boundaries, whole-Ryo claims, duplicate claims, revenue pool and custody-liability limits. Forged client loot is not accepted.
- Native wallet VM tests check actual pending-receipt scoping and recovery behavior.
- Browser tests use isolated wallet/API fixtures: all existing9 routes and nested Dojo/Sensei, one manager, preserved context, unknown/loading rewards, claim failure/duplicate locks, one ledger update without extra state fetch, deposit/withdraw bounds/fees/pending recovery, unresolved deposits across close/reopen, numeric-string history, filtering/paging/links, account disconnects, keyboard trap/restore/Escape, mobile390×844 and reduced motion. Header Tools retain sound, actual online count and configured community links.
- Archive safety tests cover file extraction and traversal/link/duplicate rejection. The base archive hash remains pinned.

Actual command output is included in `validation/`. Screenshots show fixture data and are not screenshots of a funded live production account.

## Limits

- Browser tests do not send real Solana transactions. SQL tests use a queued single-connection PGlite pool: they verify accounting/idempotent results in that environment, not production multi-connection load or every lock race.
- Live Devnet signing/settlement, the host's real PostgreSQL connection and real mobile wallet-provider behavior remain external acceptance checks. No private environment was used for these package tests.
- Native wallet providers may behave differently inside an iframe. The full-page game link is the recommended integration path; iframe Web3 compatibility has not been established.
- History pages only the recent records returned by the existing backend. There is no individual claim-event history or unlimited server cursor.
- Guild, real-time Chat, shared Marketplace settlement and an NFT mint/trading program are not implemented by this package. Disabled/unavailable UI must remain accurate.
- The current game retains its existing compatibility model/animation/map artwork. A new transparent Chest/logo or new production sprite atlas was not supplied. The new Chest uses a bounded artwork window from the supplied reference, with live DOM controls/text.
- The inherited Solana application dependency audit reports9 findings (3 high,6 moderate), including transitive `bigint-buffer`, `uuid`, `stream-json` and dependent SDK packages. Root/UI/test tooling audits report zero known findings at verification time. A separately tested SDK migration remains a release risk; this beta is not represented as production audit-clean.
- No FPS/load benchmark or universal-device guarantee is claimed. No live deployment was performed by creating this bundle.
