# Treasury migration and RYO Burn Reserve (live Mainnet, prepared 2026-11-12)

Status: **prepared on branch `feature/treasury-burn-reserve` (from `live` @ 3103704). Not committed, not deployed.**
Nothing in this document has been executed on the live server. Every step under "Cutover" needs the owner's
explicit approval at the time.

## What changes

| | Before | After |
|---|---|---|
| Treasury (role `lockedTreasury`, 50%) | `5wVBdFkQFLtu8qhZ1pg6RoD1LjWGUYL1erBVGBu11aGn`, Squads v4 vault #0 of `38chAaSbcA4Stdg7EhCzzyVAbhz2BuKtHDfD6thsZSjX`, 2-of-3 | **`GPbgpbtxEiZtsWnjxq3MKbk9gaoqFNEbpTRqn8t7htjE`**, "Shinobi Bombers Treasury", **single-key wallet** (owner-approved exception, 2026-11-12). **The Treasury until the owner asks for a change.** |
| `5wVBdFkQ…u11aGn` | Treasury | **RYO Burn Reserve** (new role `ryoBurnReserve`, 0% of revenue). Same address, same multisig, same 2-of-3 |
| Active Reward Pool 30% | `3Rzz25x1…Ti56` | unchanged |
| Community Reward Vault 10% | `FZnW5DvU…vDyL` | unchanged |
| Content Creators Reward Pool 10% (`economicReserve`) | `B2aGUT7x…N8M` | unchanged |
| Game custody | `CqJCKKq9…tBT` (`RYO_TREASURY_SECRET`) | unchanged; key not touched |
| SR mint / program / scope | `8Azsv23u…pump`, Token-2022, `solana-mainnet:live` | unchanged |

## A. Current live wallet mapping (verified 2026-11-12, finalized Mainnet)

Verified read-only against the deployed `/treasury-registry.json` (identical to the repo) and finalized chain reads:

- Squads multisig `38chAaSb…SZjX`: Squads v4 program `SQDS4ep6…pCf`, threshold 2 of 3 (members `7Hd7D6Gs…nEWm`, `9Lepjwaf…SPiY`, `CM92voUX…LMNHy`),
  no config authority, time lock 0, **transaction index 2** (two proposals have been created). Vault #0 re-derived locally = `5wVB…`.
- `5wVB…` (old Treasury): **1,417,500 RYO** and 0.198 SOL. Its token account `AzQ37viT…SELT` has no delegate.
- `GPbg…` (new Treasury): on the Ed25519 curve, i.e. an ordinary keypair wallet and **not** a Squads vault. **No SOL account (0 SOL)**.
  Its Token-2022 account `HfrrTphn…pJo` holds **288,061,292.324334 RYO** (ImmutableOwner only, no delegate, no close authority).
- RYO mint supply: 999,998,910.384672.

**The bulk transfer has already happened.** Squads `VaultTransactionExecute` on multisig `38ch…`, executed by `9Lep…`,
2026-11-12 01:11:37 UTC, slot 468336333, signature
`35T3CwTrZLMsmMvkNKRTvk5SYU53H6ucnxsQsEoBPSpUGDcyWCJiiUBHqqEbEjZkW3B8GU1aL5LgEGvDT8QF4CqV`: 288,061,292.324334 RYO from
`AzQ37…` (old vault) to `HfrrT…` (new Treasury). The old vault's token account went to 0.

**The live game still pays the old vault.** Since 01:11 the old vault has received 1,417,500 RYO: five custody-signed
`sr-revenue-distribution-v2` 50% shares, because the deployed registry still names `5wVB…` as the Treasury. This continues until cutover.

Not verifiable from here: Render environment values (only the owner can confirm them, see Cutover step 0) and the
live database contents (its IP allowlist is closed).

## B. Proposed wallet mapping

- Old Treasury `5wVB…` (Squads vault #0) → **RYO Burn Reserve**. Holds RYO set aside for separately approved burns. Receives no automatic revenue.
- New Treasury `GPbg…` → **Shinobi Bombers Treasury**. Receives every Treasury-bound flow below.

## C. Revenue routing comparison

| Payment | Treasury share | Before | After | How it switches |
|---|---|---|---|---|
| SR services: summon, fusion, dojo, training (sensei if approved) | 50% | `5wVB…` | `GPbg…` | registry + **re-approved `revenueRouting`** in `/admin/` (the old approval goes stale and fails closed) |
| Expedition early return | 30% | `5wVB…` | `GPbg…` | same approved routing configuration as services |
| Boss Hunt entry | 10% (10% custody burn and 80% prize unchanged) | `5wVB…` | `GPbg…` | registry, at deploy |
| RYO withdrawal deduction | 5% | `5wVB…` | `GPbg…` | registry, at deploy; each row stores its own destination |
| Treasury → custody top-ups | — | Squads-executed from `5wVB…` | direct transfer signed by `GPbg…` | registry; `5wVB…` can never be a top-up source |
| Marketplace 8% | 8% | `RYO_REVENUE_WALLET` | **unchanged** (owner: a new Market allocation exists) | not touched |
| Active Rewards / Community / Content Creators | 30 / 10 / 10% | unchanged | unchanged | — |

Percentages are unchanged: 50/30/10/10 (services), 50/30/10/10 Expedition order, Boss Hunt 80/10/10, 5% withdrawal fee. There is still **no automatic burn**.
Payments signed before the deploy keep their signed destination (the wire is never rebuilt): they settle to `5wVB…` or refund.

## D. Security review

**The new Treasury does NOT keep multisig protection.** `GPbg…` is a single-key wallet. The owner explicitly approved
this on 2026-11-12, knowing it weakens today's 2-of-3 protection. The code makes the exception explicit and narrow:

- The registry refuses a single-key Treasury unless `treasuryCustodyException` is approved, names exactly that address and has a written reference.
  Removing or altering it makes the build, the start-up guard and routing fail closed.
- Checkout re-verifies the Treasury at finalized commitment: it must be a System-owned (or unfunded) wallet, and its token account must have no
  delegate, no foreign close authority and no unsupported extensions. It must not be game custody, the studio wallet or the revenue wallet.
- The Burn Reserve keeps full Squads governance checks: vault derivation, threshold, exact members, no config authority, time lock, and no member that is
  a destination, custody or the mint.
- Game custody cannot be the Treasury, the Burn Reserve, the multisig or a member (registry, `assertCustody` and the start-up guard).
- The Burn Reserve is never a revenue destination and never a top-up source.
- `/admin/` and `/treasury` permanently flag "Single-key Treasury: no on-chain spending restriction". Nothing claims a lock.

**Standing risk:** one key controls about 288 M RYO (28.8% of supply), plus all future Treasury revenue and any Treasury → custody top-ups.
Recommended mitigations (owner):
1. Keep the `GPbg…` key on a hardware wallet, on a device separate from the Squads members. Never put it in Render, a repo or a checkpoint.
2. Only if you ever decide to: move the Treasury into **Squads vault #1 `AAj289ZjKgP6NY7YPNxN15feJm2MWuv1Kkb4x94y4KHU`** (same 2-of-3 multisig). The registry
   already supports this as a reviewed change: set `custody: "squads-v4-vault"`, set `squads.vaults.lockedTreasury: 1` and remove the exception. It is tested.
3. Fund `GPbg…` with a little SOL before you need it to sign (top-ups, Burn Reserve funding). It cannot pay fees today.

Open items for review (not blocking, but confirm):
- Squads transaction index is 2. Confirm both proposals were yours (one is the 01:11 transfer).
- The live `/admin/` may already show "Unrecorded SR outflow" for the Treasury role (the 288 M left `5wVB…` at 01:11). This is expected.
  After cutover, drift is compared per address and the relocation is recorded (step 6), so it does not recur.

## Relocation records (owner decision 2026-11-12)

- Only the registered migration leg can be recorded as a Treasury relocation: **leg 1, `5wVB…` → `GPbg…` through Squads** (35T3…, plus a residual transfer if you approve one). Registry block `treasuryMigration` (id `treasury-migration-2026-11`).
- Each record stores source, destination, RYO amount (base units), signature, slot, block time, `finalized` confirmation and leg number. Relocations are never revenue and never burns; Burn Reserve funding and burns are separate categories.
- Recording ends when the migration is marked `completed` with a reconciliation reference (reviewed commit). The history is kept permanently and stays visible in `/admin/` and `/treasury`.
- Any later Treasury move needs its own reviewed migration entry (new leg or new id). Until then, moving RYO out of `GPbg…` cannot be recorded as a relocation.
- Recording a movement or burn follows `ADMIN_SELF_APPROVAL` (owner decision 2026-11-12): with it on, one approver wallet may record it and the audit chain marks it `selfApproved`.

## Independent security review (2026-11-12)

No critical or high findings. Resolved:
- Drift alerts now explain an outflow by the movement's **on-chain time**, not the time it was recorded. A late record can no longer mask a later outflow.
- An undecodable token instruction is refused with 409 instead of crashing.
- Duplicate-signature checks now cover both ledgers (movements ↔ top-ups, withdrawal fees, Expedition revenue).
- Relocations are limited to the registered migration (above).
- One-wallet recording: kept, by owner decision.

Noted:
- If this branch is ever merged to `main`, the Devnet Expedition 30% would also point at `GPbg…` (Devnet tokens only). The test server is not changed by this work.
- In-flight payments at deploy are handled by the pause in cutover steps 2–3.

## E. Code changes (branch `feature/treasury-burn-reserve`)

| File | Purpose |
|---|---|
| `treasury/treasury-registry.json` | v2: Treasury `GPbg…` (single-key and its exception), `reserves: [ryoBurnReserve 5wVB…]`, `squads.vaults: {ryoBurnReserve: 0}` |
| `treasury/treasury-registry.cjs` | v2 schema: the custody exception rule, reserves (0 bps, Squads only, distinct), the per-role vault map, reserved addresses, public view |
| `treasury/treasury-verify.cjs` | Verifies any Squads-governed role; single-key Treasury checked as a wallet plus token account; Burn Reserve reported as **reserved**, excluded from owner-held; mint supply published |
| `treasury/treasury-movements.cjs` (new) | Movement ledger: `treasuryRelocation`, `burnReserveFunding`, `burn`, verified from finalized transactions only; never revenue |
| `treasury/schema.sql` | Additive table `ryo_treasury_movements` (created by `db:init` on deploy) |
| `treasury/treasury-rewards.cjs` | Labels; studio/custody can never be the Burn Reserve |
| `sr-revenue/server.cjs` | Single-key or Squads Treasury verification; Burn Reserve excluded from destinations and top-ups; `lockedTreasuryMultisig` is null for a single-key Treasury |
| `economic-dashboard/server.cjs`, `dashboard.js`, `index.html` | Treasury Management view (read-only), `treasuryMovement` proposals (two-person), address-aware drift alerts, **fix: snapshot no longer crashes on a stale routing config** |
| `treasury/public/*`, `server/site-server.cjs` | `/treasury`: TREASURY / REWARD POOL / RYO BURN RESERVE; Reserved and Burned shown as separate figures; burn history |
| `apply-treasury.cjs` | Copies the movement module; public read-only action `treasury-burn-reserve` |
| `apply-*.cjs`, `expedition/*`, `live-economy/server.cjs`, `command-center/public/cc-report.js`, `prelaunch/i18n/*`, `website/whitepaper.html` | "Locked Treasury" → "Treasury" in player-facing text; whitepaper no longer claims a multisig Treasury |
| tests | updated pins and a new `tests/treasury-movements.cjs` (uses the real 35T3… transaction, captured read-only) |

## F. Tests

See the report given with this branch for exact runs and results. The key suites are `treasury-registry`, `sr-revenue` (Squads-vault shape
plus the live single-key shape, including cutover staleness and re-approval), `treasury-movements`, `treasury-live-rewards`,
`treasury-page`, `live-economy`, `expedition-server`, `economic-dashboard` (also `--live-economy`), `network-guard`, `financial-server`,
`market-server`, `preservation` and `reward-pool` (schema pins updated only for the additive block), plus `check:rewards`.

## G. Cutover checklist (owner-executed; nothing is automatic)

0. **Pre-checks (owner, Render dashboard):** confirm none of `RYO_REVENUE_WALLET`, `RYO_STUDIO_WALLET` or `FOUNDERS_REVENUE_WALLET` equals
   `GPbg…` or `5wVB…`. If one did, the new build would refuse to start (Render keeps the old version running) or refuse routing.
   Confirm `ADMIN_SELF_APPROVAL` is as you want it, because it decides whether a second approver wallet is needed in steps 5–8.
1. Approve the commit, and pushing it to `live`, explicitly.
2. In `/admin/` → Emergency controls: **pause `purchases`** (services, chest spends, Expedition, Boss Hunt entry, Market writes) and **pause `withdrawals`**.
   Replays of pending orders still settle.
3. Wait until `/admin/` shows no pending purchases or withdrawals (normally about 2 minutes). Pending wires settle to `5wVB…` or refund.
4. Push / deploy. Watch the deploy go live. On deploy the old routing approval becomes **stale**: SR services and Expedition refuse new payments (fail closed).
5. `/admin/` → Propose → **SR revenue vault configuration**. The template is filled from the registry (`lockedTreasury = GPbg…`, `lockedTreasuryMultisig: null`).
   Keep the same `products` list as before. Then approve it.
6. Propose → **Record verified Treasury movement or burn**:
   `{"kind":"treasuryRelocation","signature":"35T3CwTrZLMsmMvkNKRTvk5SYU53H6ucnxsQsEoBPSpUGDcyWCJiiUBHqqEbEjZkW3B8GU1aL5LgEGvDT8QF4CqV","amountRaw":"288061292324334","evidence":"Treasury migration 2026-11-12"}`, then approve.
7. **Decide the residual** in `5wVB…` (1,417,500 RYO of Treasury revenue received after 01:11, plus anything that landed before the pause):
   - (a) move it to `GPbg…` with a Squads proposal (small test first), then record it as `treasuryRelocation` (it is leg 1 of the migration); or
   - (b) keep it as the Burn Reserve's opening balance. No record is needed: it shows as Reserved, never as Burned.
8. Resume `purchases` and `withdrawals` (proposal plus approval).
9. Run one small real transaction per open flow and check it on the explorer and `/treasury`: a summon (50% lands in `HfrrT…`), a withdrawal
   (5% lands in `HfrrT…`), and Expedition or Boss Hunt if open.
10. Only then publish the announcement (draft below) and the PATCH_NOTES entry.

## H. Owner approvals still required

Commit; push or merge to `live`; deploy; the pre-checks in step 0; each pause and resume; the routing re-approval; recording the relocation;
the residual decision and any Squads transfer; any burn; any automatic Burn Reserve allocation (see BURN_RESERVE_POLICY_PROPOSAL.md);
the announcement; the PATCH_NOTES entry; marking the migration completed (reconciled); any later Treasury change.

## I. Rollback

- **Before step 5:** set the pauses (if not already), revert the commit on `live` and redeploy. The previous routing approval
  (pinned to `5wVB…`) becomes valid again automatically. No re-approval is needed, because the stored configuration was never replaced.
- **After step 5:** revert and redeploy. The `GPbg…` routing becomes stale (fail closed), so propose and approve routing for `5wVB…` again.
- Pending wires always settle at their signed destination or refund. No row is rewritten. Recorded movements stay, because they are on-chain facts.
  The `ryo_treasury_movements` table is additive and harmless to the old code.
- Funds already in `GPbg…` are not affected by any code rollback. Moving them back is a separate owner transaction.

## Announcement draft (publish only after step 9 succeeds)

> **Treasury update.** The Shinobi Bombers Treasury has moved to a new wallet, `GPbgpbtx…htjE`, shown on shinobibombers.fun/treasury.
> The previous Squads multisig wallet `5wVBdFkQ…11aGn` keeps its address and its 2-of-3 approval, and is now the **RYO Burn Reserve**. It holds
> RYO set aside for future burns. Moving tokens between these wallets is an internal transfer: it is not revenue, and it is not a burn.
> Tokens in the Burn Reserve are reserved, not burned. A burn happens only through a separate, approved burn transaction, and the Treasury page shows
> verified burns separately. Game revenue percentages are unchanged (50/30/10/10), and player balances, Chests, deposits and withdrawals are unaffected.
> The new Treasury is a single-key wallet, and the Treasury page says so.
