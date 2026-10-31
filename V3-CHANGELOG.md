# V3 incremental integration changelog

## 2026-11-01 — integrated redesign review slice

This slice extends baseline `a68984bc83ebbc53c0ecfcaf71b841dc24f307db`. Full V3 completion and production deployment are not asserted here.

### Added

- `v3-ui/`: incremental React/TypeScript/Tailwind interface, typed native-game adapter, shared SVG icon system, responsive navigation, modal/focus handling and graphics settings.
- A real-data Home dashboard and one shared Chest manager for authenticated screens. Chest reuses the current claim/deposit/withdraw/recovery services and displays verified history and current fee/net amounts.
- Searchable eight-topic Codex with current rules, FAQ and real menu links.
- Guild/Chat availability screens with disabled unsupported actions and no fabricated records.
- `v3-summoning/`: responsive Shrine and quantity-aware reveal presentation using existing checkout, persisted Hero IDs, reveal order and result outcomes.
- `v3-market/`: actual inventory/local listings, all five rarity filters, inspection, search/sort and ten-card pagination, preserving practice-only restrictions.
- `v3-adventure/`: eight visual themes rendered from the native grid, decorative edge layers and quality-aware effects.
- `v3-animation/`: honest compatibility inventory, production-frame contract/PNG validation, future-frame loader and asset inspection studio.
- Five maintained `apply-v3-*.cjs` helpers in the existing verified-archive build pipeline. Generated `app/` remains rebuildable rather than becoming a separate source tree.

### Changed

- Fixed inherited rules hiding the new Home content and semantic login labels. Added visibility assertions for both.
- Replaced the vulnerable archive extractor with a bounded file-only implementation, retaining the SHA-256 pin and rejecting traversal, links and duplicate destinations.
- Added portable `qa/` regression fixtures, unit/HTTP smoke commands, setup/rollback instructions and an explicit verification/dependency-risk record.

- Login controls use a responsive semantic layout while retaining existing intentional Phantom/Solflare sign-in. Loading waits for real initialization, exposes essential-asset failure/retry and removes a deliberate minimum delay.
- Wallet/Chest responses are bound to the current account; late responses cannot repopulate the ledger after a wallet disconnect/change. Claim API failures are surfaced instead of reporting success.
- Deposit history is exposed through the existing native ledger adapter and cleared on disconnect.
- The prior full-board image floor and traced topology replacement are suppressed in V3. Rendering uses native `G` cells and preserves object identity, collision and active combat authority.
- Genin aura is neutral silver/white independently of body/model pixels. Graphics quality and reduced-motion handling remain cosmetic.
- Local builds can use a bundled or explicitly supplied SHA-256-verified base archive. UI type-check/build scripts are integrated before the existing apply-helper pipeline.

### Preserved

Existing wallet authentication, account/profile persistence, Hero IDs, save format, ownership restrictions, active ranged combat, purchases/settlement, summon odds, fusion chances/cost/failure rules, training, recovery, Sensei settings/rental/offline cap, 50 battle-ready/10 deployed limits, withdrawal rules and all fee/reward allocations. No new tokenomics or rank above Legend.

### Verification and limits

Strict TypeScript, custom source-hygiene lint (not ESLint), animation-contract unit tests and isolated browser tests were run. Browser coverage includes real native entry points with a simulated wallet/API: navigation/Chest, claim error and double-click behavior, disconnect recovery, Shrine/reveal quantities and stored IDs, Market practice cancellation/ownership guard, Codex/capability screens, native-grid rendering and quality/reduced motion. Existing server fusion/Sensei regression checks also ran.

These checks do not prove live signed Devnet settlement, real multiplayer/social operation, full asset fidelity or full-device performance. The parent release record supplies final build results and any additional fixes. Full Forge, Heroes, Boss and Dojo/Sensei V3 redesigns, production animation assets and shared services remain as listed in [V3-STATUS.md](V3-STATUS.md).
