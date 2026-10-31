# Shinobi Bombers V3 implementation status

1 November 2026. This is an incremental upgrade of the existing game, not a replacement game. **The complete V3 request is not finished.** The implemented slice adds a shared interface, real-data Home and Chest, Codex, Summoning/Reveal and Marketplace presentation, and native-grid rendering and animation adapters. The table below distinguishes that work from retained features and unavailable services.

Source baseline: `a68984bc83ebbc53c0ecfcaf71b841dc24f307db`. Review branch: `v3/integrated-redesign-2026-11-01`. This document does not assert a production deployment; use the release record for the published commit and build status.

## Design sections

| Design section | Implemented or retained | Remaining work |
| --- | --- | --- |
| 01 Cinematic Summoning Reveal | Integrated quantity-aware result layout, scroll/seal presentation, reveal controls, rarity summary and existing saved result IDs. Existing rare reveal effects and fusion result outcomes remain connected. | Final artwork fidelity and production character frame sequences. |
| 02 Summoning Shrine | Responsive semantic layout using actual quantity, rates, total and existing checkout. Gallery, Collection, Rates and History use real navigation/data. | Final art review against the supplied V3 board; future production hero frames. |
| 03 Main Menu / Home | React dashboard using the signed-in collection, deployed team, real menu routes and shared Chest. No screenshot balances, quests or fabricated event rewards. | Additional approved V3 illustration assets and final visual polish. |
| 04 Adventure | Eight themed native-grid floor/solid layers and visual effects. Existing targets, heroes, collision grid and active combat functions remain authoritative. Prior full-board screenshot and traced-grid replacement are suppressed. | Production modular tiles, exact reference architectural artwork and a separately reviewed resolution of the combat discrepancy below. |
| 05 Fusion Forge | Existing functional Reserve-only fusion, batch selection, chances, failure consumption, Elite level-10 requirement and backend settlement retained under the new shared header. | Full V3 Forge redesign is not implemented. |
| 06 Marketplace | Real inventory/local-listing view, all five rarities including Legend, search, filters, sorting, ten-card pagination, inspection and native local practice posting/cancellation. | Shared player trading, escrow, offers and settlement. Server-owned token heroes remain blocked from local practice trading. |
| 07 Boss Hunts | Existing local solo Boss Hunt, progression and combat retained with shared navigation/Chest. | Full V3 encounter interface and authoritative shared/reward service. |
| 08 Boss Models / Animation | Six existing boss identities inventoried; honest single-pose preview and validated future-frame import contract. | Actual multi-frame, clean-alpha production sequences. A repeated sample is not a finished animation. |
| 09 Dojo / Sensei | Existing purchases, recovery, permanent/rental Sensei, saved return threshold and on/off retained with shared header/Chest. | Complete V3 Dojo/Sensei layout and historical offline-session report. |
| 10 Hero Models / Animation | Shared compatibility renderer retained for eight stable existing identities; production asset validation/import, available-action inspection and visual-quality controls added. | Twelve requested canonical identities, stable approved mapping and genuine directional/action frames. |
| 11 Rarity Auras | All five ranks remain independent of model/element. Genin aura becomes neutral white; body pixels stay unchanged. Quality OFF/LOW/MEDIUM/HIGH and reduced motion are supported. | Authored independent multi-frame aura loops and canonical elemental VFX. Current art uses cosmetic motion/static compatibility effects. |
| 12 Guild | Nine navigable availability sections and shared Chest/header. Unsupported mutations are disabled and no sample guilds, ranks, points or rewards are presented as real. | Entire persistent authenticated Guild core, roles, applications and economic/gameplay subservices. |
| 13 Login / Loading | Existing intentional Phantom/Solflare login preserved; semantic responsive login controls, real initialization progress, retry on essential asset failure and removal of artificial delay. | Further cinematic asset fidelity and broader device/provider testing. |
| 14 Chest / Ryo Management | One React Chest manager across authenticated menus; real pending/claimed rewards, balance, claim, deposit/withdraw review, fee/net display, history, errors and wallet-change guards. Native financial service is reused. | Live Devnet signing/settlement acceptance test for this branch and full final reference-art review. |
| 15 Real-Time Chat | Eight honest channel availability views. Unsupported send/private/team/moderation actions are disabled. | Authenticated message persistence, delivery transport, permissions, rate limits, reporting and reconnect recovery. No messaging backend exists yet. |
| 16 Codex | Eight searchable topic views, perk sorting, rank/element selection, FAQ, real rule values and links to actual menus/Chest. | Content upkeep as supported gameplay and services evolve. |
| Supplemental Heroes Collection | Existing ten-per-page collection, detail popup, reserve/battle-ready controls, deployment and current portraits retained with shared header/auras. | Full V3 collection/card redesign and new production portrait assets. |

## Preservation and trust boundaries

- No V3 price, summon probability, fusion probability, reward multiplier, withdrawal rule, fee allocation, ownership ID or save-schema change is introduced.
- React/TypeScript/Tailwind is mounted incrementally through `v3-ui/src/bridge.ts`. The existing Canvas game loop, wallet client, server accounting and PostgreSQL transaction logic remain in use.
- Only server-verified funded Adventure rewards are claimed. Local combat numbers are never submitted as withdrawable reward totals.
- The active pre-V3 combat overrides use cardinal ranged projectiles against stationary targets. Older placed-bomb primitives still exist, but preserving/testing them does not establish active classic Bomberman AI, enemy movement or fuse/chain gameplay. V3 does not silently swap the combat system.
- The server Adventure reward engine remains an elapsed-time/DPS simulation separate from the visible client grid. This can produce differing client/server progress. Synchronizing by trusting client rewards would weaken the existing accounting boundary.
- Token collection entitlements are not a deployed NFT mint/trading program. No NFT contract or cross-player sale is claimed.

## Verification scope

Verified during this work: strict TypeScript, the custom source-hygiene lint, production-frame contract unit tests and isolated browser suites for the shared interface/Chest, wallet disconnect recovery, Codex/capability screens, native Adventure rendering, animation adapter, Marketplace and Summoning/Reveal. Existing server fusion/Sensei regression checks also ran. The lint is **not ESLint**. Browser ledger/wallet tests use a simulated API and isolated save state; they are not live signed Solana transactions.

The final build/test record belongs with the release. A build or screenshot alone does not verify production wallet settlement, multiplayer operation, performance on every device or complete V3 art fidelity.

See [missing assets](V3-MISSING-ASSETS.md), [missing backend functionality](V3-MISSING-BACKEND.md), [changelog](V3-CHANGELOG.md) and [continuation checklist](V3-IMPLEMENTATION.md).
