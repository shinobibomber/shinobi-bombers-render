# Direct Chest Reward Spending

Owner request 2026-11-11. Source: `chest-spending/` (server + checkout client), build step `apply-chest-spending.cjs`.
Tests: `tests/chest-spending-server.cjs`, `tests/chest-spending-ui.cjs`.

## What players get
- **Option A: spend unclaimed rewards.** Verified, unclaimed Adventure Chest SR can pay for Summon, Fusion, Dojo upgrades
  and Training immediately, before the claim timer allows a claim. No withdrawal fee applies to a purchase.
- **Option B: claim and withdraw.** Unchanged. Chest rewards are claimed once every 24 hours (12 hours for verified
  Founders) into the game balance. Claimed SR can be spent or withdrawn at any time. A withdrawal pays 95% to the player and
  5% to the Locked Treasury.
- **Not payable from the chest:** Sensei (SOL only), Boss Hunt entry, the Market (player-to-player), Founder or Mythic boxes
  (SOL), transfers and swaps.
- **One source per purchase:** Chest rewards or the game balance, each covering the full price. Prices and discounts (Mythic Box,
  Founder, creator) are the same server quote whatever pays.

## Accounting: a chest spend is "claim + pay from the balance", atomically, without the claim timer
| Step | Ledger effect |
|---|---|
| Spend accepted (purchase transaction) | `ryo_adventures.data.pending -= price x 1000` (milli) and `data.claimed += price`, which reduces the reward pool exactly like a claim. `ryo_purchases` row (funding `chest`, status pending) and `ryo_chest_spends` row (pending). The game balance is not touched. **No `ryo_reward_claims` row**, so the per-player claim timer is unchanged. |
| On-chain | The normal custody-signed purchase transaction pays the 50/30/10/10 destinations (Locked Treasury / Active Reward Pool / Community / Reserve) from the discounted total. No SR is minted. |
| Settled (finalized) | Grant written (heroes, Dojo tier, training), `ryo_service_revenue` booked, spend confirmed, creator Adventure commission paid once. |
| Refunded (failed / expired) | Chest, lifetime claimed total and creator adventure lots restored exactly; spend refunded (its daily budget released); nothing granted. |

Every limit is checked inside the purchase transaction, after the wallet lock and the global reward-pool lock (the same lock order as
claims, so one wallet's claims, spends and withdrawals serialize):
- the verified chest, settled fresh;
- the funded reward pool (income minus everything claimed or chest-spent);
- custody tokens minus liabilities (balances, pending withdrawals, pending purchases);
- on live, the **approved daily reward budget, shared with claims**: the rolling 24-hour sum of claims plus pending or confirmed
  chest spends. Since 2026-11-11 (owner decision) a chest spend has no per-purchase cap: it is limited by the player's Chest, the remaining daily budget, the funded pool and custody.

Reconciliation (economic dashboard) needs no new term. The chest liability (Σ pending) moves to a pending-purchase liability and
then leaves custody at settlement. "Spent" includes the confirmed purchase, and the pool falls by the spent amount.

## Creator Points
- **Adventure commission:** the creator of a qualified referral earns it on the eligible chest SR spent (the creator adventure lots
  are drained FIFO exactly as a claim would). It is paid once at confirmed settlement (event `chest-settlement:<source>`).
- **No purchase commission** on a chest-funded order, so the same SR never earns CP twice.
- Paid mints still count toward qualification (it is earned SR, not starter Ryo). The 50,000 CP milestone is unchanged.

## Operations
- **Feature switch `chestSpending`** (Control panel; env `CHEST_SPENDING_ENABLED`): live default **OFF**, test server ON. It
  also needs the `rewardClaims` launch gate and an approved reward budget.
- **Operator pauses:** "claims" stops chest funding; "purchases" stops all purchases.
- **Errors:** the player sees an accurate message and their rewards stay in the chest. A retry reuses the same request id, so it
  is never charged twice.
