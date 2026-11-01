# Global Header and Chest regression checks

Build the application first, then run `npm --prefix tests ci` and `npm --prefix tests test`. Node 22 and installed Chrome are required. Browser tests use Playwright's Chrome channel, isolated storage and a simulated wallet/API with public example keys. They do not send real Solana transactions or access Render, Neon or private environment values.

`browser.cjs` checks the shared trigger/manager on existing routes and nested Dojo screens, context preservation, loading/unknown data, claims, configured fees, transfer bounds, pending/recovery, history, account disconnects, keyboard, mobile and reduced motion. Screenshots are written to `previews/chest-global`.

`preservation.cjs` compares frozen hashes from main commit `a68984bc83ebbc53c0ecfcaf71b841dc24f307db`. It requires all maintained visual/game modules, original generated maps, server files and 35 untouched inline baseline modules to stay unchanged. The native wallet module is compared after removing only the exact reviewed read-only pending-deposit getter; RyoPayments/AdventureChest are the other explicitly modified adapter boundaries. It does not claim to establish gameplay that was absent in the baseline.

`gameplay-options-server.cjs` uses the assembled application's actual server with an in-memory PGlite database. It verifies existing fusion/Sensei accounting rules independently of the UI. Live RPC, real database connectivity and wallet signing still require separate configured Devnet acceptance tests.

`financial-server.cjs` uses the assembled server, PGlite and real SDK signatures with a mocked RPC. It verifies finalized deposits, replay/forged-fee rejection, actual purchase funding, withdrawal reserve/confirm/refund-once and exact cooldown boundaries, concurrent claims, whole-Ryo rounding, revenue-pool/custody-liability caps and forged client-loot rejection. It does not contact a network. `transaction-review.cjs` exercises the actual transaction review code against valid signatures, supported wallet priority-fee changes and malicious instruction mutations.

PGlite uses a queued single-connection test pool. Concurrent request tests prove duplicate accounting and idempotent results in that environment; they do not benchmark or establish lock-race behavior across separate production PostgreSQL connections.

`wallet-vm.cjs` extracts the actual assembled native wallet module and runs it with simulated wallets/RPC plus the real SDK. In addition to existing transaction/recovery safeguards it checks the additive pending-deposit getter's owner/mint/network/kind filters, acknowledgement, failed refresh and empty receipt recovery. No token is minted or moved on a real network. The browser fixture also checks that this pending state blocks another deposit after closing/reopening the manager and that PostgreSQL numeric strings display actual amounts.

The browser Tools check uses one explicit test-only Discord URL and two unconfigured links. It checks native sound state, actual presence response and disabled unavailable community destinations. These values are isolated fixtures, not production configuration.
