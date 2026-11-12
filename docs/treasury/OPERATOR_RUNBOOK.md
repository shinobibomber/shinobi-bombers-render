# Treasury operator runbook

> **Update 2026-11-12 (Treasury migration, prepared, see [TREASURY_MIGRATION_2026-11.md](TREASURY_MIGRATION_2026-11.md)):** the Treasury (50%) moves to the owner-approved single-key wallet `GPbgpbtxEiZtsWnjxq3MKbk9gaoqFNEbpTRqn8t7htjE`; Squads vault #0 `5wVBdFkQ…11aGn` becomes the **RYO Burn Reserve** (0% of revenue, never a top-up source). Statements below about `5wVB…` being the Treasury describe the state before that cutover.

For the owner and admin-wallet holders. The game never holds Squads or Phantom keys. Nothing here asks
anyone to paste a seed phrase or private key anywhere.

## Where to look

| View | Who | What |
|---|---|---|
| `/treasury` (live server, also during pre-launch) | Public | Four addresses, the 50/30/10/10 split, Squads 2-of-3 status, SOL/SR balances (60 s cache), mint status |
| Pre-launch portal → **TREASURY · CHAPTER 04 · READ-ONLY** card | `RYO_ADMIN_VIEWERS / OPERATORS / APPROVERS` | The same data plus Squads member keys, activation flags (all OFF) and ledger counts |
| `/admin/` → **Treasury registry** (after launch) | Admin roles | Verification, alerts, withdrawal-deduction ledger, reward budget, revenue history, top-ups, proposals, audit |

Both views keep two figures apart: **Held in Chapter 04 wallets** (owner-controlled, not claimable by players) and **Available for player reward claims** (approved top-ups not yet claimed, backed by the game claim wallet). Before launch the second one reads *Not configured*.

Statuses: **VERIFIED** (on-chain state matches the registry), **MISMATCH** (investigate now; routing stops),
**UNVERIFIED** (the chain could not be read; nothing is assumed).

## Game custody wallet (the server's hot wallet)

Public address `CqJCKKq9Q9haCtdVuHLZfCkfoDnRievuTaJ9doHatwBT`, recorded in the registry and shown on `/treasury` as **Game claim wallet**.

- Its key exists only in your private file, and on launch day in Render's `RYO_TREASURY_SECRET`. The live server refuses to start with any other key.
- At launch it holds player deposits plus the reward float, so its balance is **not** all claimable.
- If the key is ever exposed: pause withdrawals and claims in `/admin/`. Then create a new wallet (`node treasury/create-custody-wallet.cjs <file outside the project>`), update `gameCustody` in the registry through a reviewed commit, and move the funds.

## Verify the addresses yourself

1. Open the Squads app and select the multisig. **Account 1** must show `5wVBdFkQFLtu8qhZ1pg6RoD1LjWGUYL1erBVGBu11aGn` (the RYO Burn Reserve after the 2026-11-12 cutover).
   The Treasury `GPbgpbtxEiZtsWnjxq3MKbk9gaoqFNEbpTRqn8t7htjE` is a single-key wallet: check its receive address in the wallet that holds its key.
2. The threshold must be 2 of 3, and the members must be exactly the three keys in [treasury-registry.json](../../treasury/treasury-registry.json).
3. In each Phantom wallet, the receive address must exactly match the registry entry.

## RYO Burn Reserve and Treasury movements

See [BURN_RESERVE_OPERATIONS.md](BURN_RESERVE_OPERATIONS.md). Reserved RYO is not burned RYO. Record every relocation, reserve funding and burn in `/admin/` → **Record verified Treasury movement or burn** (two-person).

## Replenishing Adventure rewards (after launch)

Service revenue sends the 30% to the Active Reward Pool wallet. Chest claims are paid from the game claim
custody, so claims are funded **only** by top-ups you approve.

1. **Optional, Treasury → Active Reward Pool:** after the 2026-11-12 cutover, send SR from the Treasury wallet `GPbg…htjE` to `3Rzz…Ti56` (single-key transfer; before the cutover this was a Squads proposal from Account 1). The Burn Reserve never funds rewards. This is an internal transfer and is never split again.
2. **Active Reward Pool → game custody:** from the `3Rzz…Ti56` Phantom wallet, send one plain SR transfer to the game custody wallet (shown in `/admin/`). Send whole SR only.
3. In `/admin/` → **Propose a configuration** → **Verified SR rewards replenishment**, enter `{"source":"activeRewards","signature":"<finalized tx signature>","amountRaw":"<amount × 1,000,000>","evidence":"<why / reference>"}`. Type **CONFIRM**.
4. A **different** approver wallet reviews and approves it (again typing CONFIRM). The server re-checks the finalized transfer: source, destination, mint, amount and balance changes. It refuses any signature already used for a deposit, purchase, withdrawal or top-up.

Keep top-ups small and frequent. The game custody wallet is a hot wallet.

## Chest reward budget (required before live claims)

Live claims are refused until a **Chest reward budget** is approved: `{"dailyCapRyo":…, "perClaimMaxRyo":…, "evidence":"…"}`.
That sets the global 24 h emission cap and the per-claim maximum. Each player can claim once every 24 h.
Unclaimed rewards stay in the Chest.

## Incidents

| Signal | Action |
|---|---|
| **Treasury governance drift** (critical) | Routing already refuses payments. Check Squads for a config change. If it wasn't you, treat as a key compromise: pause purchases/withdrawals/claims in `/admin/` and rotate the keys. |
| **Squads proposals exist** (review) | Confirm every proposal in the Squads app is one you created. |
| **Unrecorded SR outflow** (review) | Find the transaction on an explorer. If it was an approved top-up not yet recorded, record it; otherwise treat as an incident. |
| **SR mint incompatible** (critical) | Do not launch money features. Token-2022 or non-6-decimal mints need engineering work. |
| Suspected server compromise | Pause purchases, withdrawals and claims (takes effect immediately). The server cannot touch the Squads Treasury or the Phantom wallets. |

Resuming a pause always needs a proposal plus a second approver.
