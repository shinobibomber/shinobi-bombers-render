# Treasury integration (Chapter 04): public registry, read-only verification, live withdrawal and claim policy

**Live server only, all financial paths OFF.** Deploying this changes no balances, moves no funds and
activates nothing. See [docs/treasury/ACTIVATION_CHECKLIST.md](../docs/treasury/ACTIVATION_CHECKLIST.md).

| File | Purpose |
|---|---|
| `treasury-registry.json` | Committed, public-only registry: four destinations (50/30/10/10), the Squads v4 multisig, vault index, threshold and members, `srMintAddress: null` (pending), withdrawal deduction 500 bps, `activation.approved: false`. |
| `treasury-registry.cjs` | Dependency-free validator. Rejects non-canonical base58 / non-32-byte keys, duplicates, wrong bps, key-like fields and secret-key or seed-phrase shaped values. |
| `treasury-verify.cjs` | Read-only, finalized verifier: Squads program/discriminator/vault PDA/threshold/members/config authority/time lock, plain-wallet checks, mint program and decimals, balances. Returns explicit `verified` / `mismatch` / `unverified` states, uses a 60 s cache, never reports a silent zero. |
| `treasury-rewards.cjs` | Live-build policy (build stamp, like the SR router). 5% withdrawal deduction to the Treasury vault in exact base units with its own ledger; no 24 h withdrawal cooldown; Chest claims once per 24 h within an approved reward budget; custody-separation start-up check. |
| `create-custody-wallet.cjs` | Creates the Mainnet game custody wallet on the owner's computer. Writes the key only to a file outside the project, never overwrites, and prints only the public address. |
| `schema.sql` | Additive: withdrawal deduction columns and ledger, claim index, read-only observation log. |
| `public/` | `/treasury` transparency page (live build, strict CSP, text-only rendering). |

`apply-treasury.cjs` copies these into `app/server/` after `apply-sr-revenue.cjs` and adds exact,
runtime-selected hooks. A beta (Devnet) build keeps the 2% studio withdrawal fee, the 24 h withdrawal
cooldown and unlimited claims. Live game-page wording is applied by `apply-network.cjs` for Mainnet builds only.

**Held externally vs. claimable.** The four Chapter 04 wallets are owner-controlled and never directly claimable. "Available for player reward claims" = min(approved top-ups not yet claimed, finalized game claim-custody SR beyond recorded player liabilities), from the read-only game action `treasury-claim-funding` (cached 30 s). In pre-launch it reads **Not configured**: no number is shown. `/treasury-registry.json` is also rate-limited per client (60/min) on top of the 60 s chain cache.

Endpoints: `GET /treasury`, `GET /treasury-registry.json` (live build; pre-launch and launched), the
pre-launch action `treasury-admin` (admin allowlist), and `/admin/` → Treasury registry.

Changing any address, the mint or the activation flag needs a **reviewed commit**. An approved routing
configuration that no longer matches the registry becomes stale and refuses payments.

Tests: `treasury-registry.cjs`, `treasury-live-rewards.cjs`, `treasury-prelaunch.cjs`, `treasury-page.cjs`,
plus `sr-revenue.cjs`, `financial-server.cjs`, `economic-dashboard.cjs --live-economy` and `network-guard.cjs`.
Squads data comes from the captured public account `tests/fixtures/squads-treasury-multisig.json`.
No test contacts a network.
