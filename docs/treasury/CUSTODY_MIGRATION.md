# Custody migration options: for owner review, NOT implemented

> **Update 2026-11-12 (Treasury migration, prepared, see [TREASURY_MIGRATION_2026-11.md](TREASURY_MIGRATION_2026-11.md)):** the Treasury (50%) moves to the owner-approved single-key wallet `GPbgpbtxEiZtsWnjxq3MKbk9gaoqFNEbpTRqn8t7htjE`; Squads vault #0 `5wVBdFkQ…11aGn` becomes the **RYO Burn Reserve** (0% of revenue, never a top-up source). Statements below about `5wVB…` being the Treasury describe the state before that cutover.

None of these changes is made. Each one changes a public address and requires a reviewed registry
commit ([treasury/treasury-registry.json](../../treasury/treasury-registry.json)), the owner's written
approval, and a small test transfer before real funds move.

## Current custody (verified 2026-11-08, finalized Mainnet)

| Role | Address | Custody | Protection |
|---|---|---|---|
| Locked Treasury 50% | `5wVBdFkQ…11aGn` | Squads v4 vault #0 of multisig `38chAaSb…SZjX` | 2-of-3 approval, no config authority, **no time lock** (by policy) |
| Active Reward Pool 30% | `3Rzz25x1…Ti56` | Phantom (single key) | none on-chain |
| Community Reward Vault 10% | `FZnW5DvU…vDyL` | Phantom (single key) | none on-chain |
| Content Creators Reward Pool 10% (formerly Economic Stability Reserve) | `B2aGUT7x…N8M` | Phantom (single key) | none on-chain |

Squads members: `7Hd7D6Gs…nEWm`, `9Lepjwaf…SPiY`, `CM92voUX…7LMNHy` (the creator / fee payer).
**Owner to confirm:** all three are yours, on separate devices (ideally hardware wallets), and none is the
Phantom wallet that holds the 30% / 10% / 10%.

## Option A (recommended next step, low effort): move Community and Reserve to Squads vaults

Use vault **#1** (`AAj289ZjKgP6NY7YPNxN15feJm2MWuv1Kkb4x94y4KHU`, derived and verified locally) and vault #2
of the same multisig, or of a separate multisig with different signers.

- **Gain:** every Community/Reserve payout needs 2-of-3 approval instead of one Phantom key.
- **Cost:** each giveaway or reserve action becomes a Squads proposal.
- **Change:** two registry addresses, with `custody: "squads-v4-vault"`. The verifier needs a small extension to check additional vault indexes.

## Option B: Active Reward Pool in a Squads vault

- **Gain:** top-ups into game claim custody need 2-of-3.
- **Cost:** every batch top-up becomes a Squads proposal (already the case for Treasury → reward-pool replenishment).

## Option C: program-controlled Treasury vault (destination-restricted)

See [SR_ROUTER_ANCHOR_DESIGN.md, Appendix A](SR_ROUTER_ANCHOR_DESIGN.md#appendix-a--optional-program-owned-treasury-vault-separate-approval).

- **Gain:** Treasury funds can only reach the Active Reward Pool, within rolling caps, even if two signers collude.
- **Cost:** a custom program, an external audit, upgrade-authority management, and a **new Treasury address**.
- **Migration:** deploy and verify the program on Devnet, audit, deploy to Mainnet with Squads as the upgrade authority, initialize, then registry PR + approval. Move the existing Treasury balance with a Squads proposal (small test amount first), and leave Squads vault #0 empty and monitored.

## Rollback

Every option is a registry change. Reverting the registry commit restores the previous destinations. Any
already-approved routing configuration becomes **stale** and refuses payments (fail-closed) until it is
re-approved by two admin wallets. Funds already moved stay where they are, and moving them back is a new
approved transfer.

## Small-test-transfer protocol (any new destination)

1. Copy the address from the registry PR, not from chat.
2. Send 1 SR (or 0.001 SOL) and check the destination on an explorer and in `/treasury`.
3. A second person confirms the address characters in the wallet approval screen.
4. Only then move the remaining amount.
