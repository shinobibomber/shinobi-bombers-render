# Scoped integration changes

Baseline: main `a68984bc83ebbc53c0ecfcaf71b841dc24f307db`.

- Added shared React/TypeScript/Tailwind Header with original logo artwork, cyan navigation, active purple state, live balance, gold Chest, native Back and sound/presence/community Tools. Guild/Chat are disabled accurately.
- Added one reusable Chest manager: dashboard plus internal Claim/Deposit/Withdraw/History views, configuration-based amounts/fees, review confirmation, actual records, recent-record paging/search/status filters, full-screen mobile dialog and keyboard focus handling.
- Added a read-only native pending-deposit getter scoped to account/network/mint. Unresolved deposits remain blocked across refresh and Chest reopening. Signing/receipt/settlement logic is unchanged.
- Exposed existing server deposit records; handle PostgreSQL numeric-string amounts and dates. Added authenticated-session guards so late responses cannot overwrite a disconnected/new session.
- Native Chest read requests share the in-flight result; claims retain a separate no-repeat guard and explicit success/error result. Session-gained synchronization remains native.
- Replaced obsolete header controls/art strips at layout level. Existing scene contents, models, map files and game/economy functions remain native.
- Added reproducible Node build wiring and bounded file-only archive extraction while retaining the SHA-256 pin. Added isolated preservation, wallet/SDK, financial, UI and archive regression tests.
- Added runtime/source transfer packaging, feature/mechanics documentation and Claude/website integration examples. No credentials, new tokenomics, paid services or automatic deployment.

`CHANGED-FILES.json` provides the precise source file list. Rollback remains the baseline main commit with the existing database/local saves and private environment preserved.
