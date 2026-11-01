# Global Chest compatibility checklist

Baseline: main `a68984bc83ebbc53c0ecfcaf71b841dc24f307db`. Scope: shared header and Design 14 Chest only. The stopped broad V3 work is not the source for this checkout.

Before edits verified:

- [x] Existing game is layered JavaScript/Canvas, shared `go` navigation plus full-screen reference scene adapters. Root apply helpers assemble a verified base archive in order. Add one UI adapter rather than replacing screens or game functions.
- [x] Existing Phantom/Solflare sign-in authenticates the Ryo service. Claims, balances, transfers, profile ownership and transaction settlement are server-provided.
- [x] Configuration provides gross limits, minimum withdrawal, cooldown and fee basis points. UI must disable actions if required configuration is missing rather than inventing financial defaults.
- [x] Adventure returns pending/claimed, pool, credited amount, loot rate, next tier and offline state. Claim credits a server-validated whole amount to spendable balance, bounded by funded pool/custody liabilities; no on-chain withdrawal is implied.
- [x] Preserve `RyoPayments` payment/recovery/idempotency and native `AdventureChest` polling/session synchronization; expose one read-only bridge and shared manager. Add wallet-response guards and deposit history visibility at this boundary.
- [x] Existing history exposes bounded recent records. Support filters and paging within these records; do not claim unlimited server history or invent records.
- [x] One native dialog with internal Dashboard/Withdraw/Deposit/History pages. Trap focus, restore caller, preserve route/context and close safely on disconnect.
- [x] Preserve combat, collision grids, map art/topology, hero IDs/models, saves, inventory, economy, progression, Dojo/Sensei and existing screen actions. No full V3 screen conversion, aura replacement or new animation system.
- [x] Guild and Chat have no implemented live baseline routes/backends. Show their navigation disabled with an accurate availability label. Login/loading remain untouched and have no global Chest.
- [x] Reuse supplied village/art reference only decoratively; pictured values never become state. No separate transparent chest/logo production asset is supplied, so use explicit CSS artwork windows and code-native icons/glow rather than whole screenshot controls.
- [x] Verified native API/ownership boundaries, duplicate accounting/idempotency in isolated tests, all existing routes/nested screens, keyboard, mobile/reduced motion, source checks, build and regression tests. Live services and production multi-connection race/load acceptance remain listed in integration/VERIFICATION.md.
- [x] Provided file list, desktop/mobile fixture screenshots, verified behavior/limits, setup and rollback instructions in the website transfer package. No automatic live deployment is part of this scoped implementation.
