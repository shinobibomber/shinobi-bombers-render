# Treasury operator runbook

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

## Verify the addresses yourself

1. Open the Squads app and select the multisig. **Account 1** must show `5wVBdFkQFLtu8qhZ1pg6RoD1LjWGUYL1erBVGBu11aGn`.
2. The threshold must be 2 of 3, and the members must be exactly the three keys in [treasury-registry.json](../../treasury/treasury-registry.json).
3. In each Phantom wallet, the receive address must exactly match the registry entry.

## Replenishing Adventure rewards (after launch)

Service revenue sends the 30% to the Active Reward Pool wallet. Chest claims are paid from the game claim
custody, so claims are funded **only** by top-ups you approve.

1. **Optional, Treasury → Active Reward Pool:** create a Squads proposal sending SR from Account 1 to `3Rzz…Ti56`, and have two members approve it. This is an internal transfer and is never split again.
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
