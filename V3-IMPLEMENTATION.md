# V3 integration checklist

Baseline: `a68984bc83ebbc53c0ecfcaf71b841dc24f307db` (live beta). Work branch: `v3/integrated-redesign-2026-11-01`.

References are extracted, without overwriting project files, to `references/Shinobi-Bombers-V3-Revised-Birthday-2026-11-01` in the development workspace. All 144 packaged checksums passed. Reference instructions are design guidance subordinate to the user's preservation and security requirements.

## Architecture and preservation baseline

- The baseline frontend is layered vanilla JavaScript and canvas. The V3 slice mounts React/TypeScript/Tailwind incrementally through a typed adapter. `app/public/index.html` contains the generated game; ordered root `apply-*.cjs` helpers apply maintained changes after extracting a SHA-256-verified release archive. Root workspace `source/` is historical, not the current deployed source.
- Navigation uses existing `go`, `tab`, and `DojoServices` state. Inventory, local combat and pending reveals use the existing versioned `S` / `S.v2` save. Server-owned heroes are synchronized from the signed-in profile.
- Node HTTP server exposes the existing Ryo API; PostgreSQL stores accounts, profiles, reservations, rewards and sessions. Solana Devnet uses intentional Phantom/Solflare sign-in and verified SPL settlement. No NFT mint/trading contract exists in this beta.
- Preserve all current prices, summon odds, fusion chances, fee allocations, recovery, Sensei thresholds, offline cap, reward-pool behavior, 50 battle-ready / 10 deployed limits, hero IDs and stored transactions.
- The new React/TypeScript UI uses an explicit adapter to the existing game. Do not replace the game loop, wallet client, SQL transaction logic or save format.

## Ordered implementation / verification

- [x] Inspect supplied master/recovery instructions, shared design system and global Chest specification.
- [x] Extract and validate the reference package; save pre-V3 source backup and create a review branch.
- [x] Complete engine/economy, social/backend and animation-asset audits.
- [x] Stage A: reusable React/TypeScript/Tailwind shell, real navigation, one global Chest manager, verified balances, deposit/withdraw/history/claim, errors and reduced motion.
- [x] Stage A: login/loading improvements using actual initialization milestones; preserve wallet signatures.
- [x] Stage B slice: Home, Summoning/Reveal and Marketplace presentation connected to existing supported actions.
- [ ] Stage B remainder: complete V3 Heroes and Fusion Forge redesigns. Existing working versions are retained.
- [x] Stage C slice: data-derived Codex and honest Guild/Chat availability screens; existing Boss/Dojo/Sensei actions remain connected.
- [ ] Stage C remainder: complete V3 Boss Hunt and Dojo/Sensei presentation; implement authenticated shared Guild/Chat services before enabling their actions.
- [x] Stage D slice: validated animation contract/loader, independent element/rarity, eight native-grid themes and cosmetic quality controls.
- [ ] Stage D remainder: genuine twelve-Hero production catalog, multi-frame boss/aura/VFX assets and modular environment tiles; verify final reference fidelity.
- [x] Isolated regression slice: navigation/nested screens, one shared Chest, mobile containment, stored summon IDs, duplicate-action locks, wallet-disconnect recovery, native-grid identity/collision and retained bomb primitives plus active ranged damage.
- [ ] Full acceptance: live Devnet signing/settlement on the V3 branch, broader device/performance profiling and full production visual acceptance. Retained bomb-primitive tests do not prove active classic Bomberman gameplay.
- [x] Strict TypeScript, custom source-hygiene lint, animation-contract unit tests and isolated integration/browser suites. Existing server fusion/Sensei regression also ran.
- [x] Reproducible build and runnable source package; setup/rollback in `V3-SETUP.md` and executed checks/limits in `V3-VERIFICATION.md`.
- [x] Status matrix, changelog and missing-assets/missing-backend reports.

## Known dependencies and continuation

Concept boards are not production alpha sprite atlases or tilemaps. Existing Marketplace is a local listing prototype and blocks server-owned hero trading. Guild and Chat require authenticated shared services; no fabricated records or fees will be added to imitate reference screenshots. New economics or financial reward sources require explicit user approval.

The previous visual map adapter painted complete illustrated boards and traced collisions. The V3 adapter suppresses that rewrite and renders the native grid. It does not claim that full reference boards have been delivered as production tiles.

The baseline's final active combat functions use ranged projectiles against stationary targets, despite earlier retained classic bomb primitives. No silent gameplay replacement was made. The server reward simulator is separate from the client grid. Both discrepancies are documented for reviewed continuation.

Full V3 is incomplete. Read [V3-STATUS.md](V3-STATUS.md) for all sixteen sections plus Heroes, [V3-MISSING-ASSETS.md](V3-MISSING-ASSETS.md) for production art requirements and [V3-MISSING-BACKEND.md](V3-MISSING-BACKEND.md) for services that must exist before unsupported controls can be enabled. Browser wallet/API fixtures are simulated and must not be presented as live signed transaction evidence.
