# Proposal: automatic RYO Burn Reserve allocation. NOT IMPLEMENTED, for owner review

Today no game revenue goes to the Burn Reserve automatically. The owner asked for this to be presented as a separate policy
decision (2026-11-12). Nothing below is built. Adopting any option needs written owner approval, a reviewed code
change, tests, an independent review, and a public announcement before it starts.

## Constraints any option must keep

- 50/30/10/10 stays exactly as published for players' purposes: the 30% Active Rewards, 10% Community and 10% Content Creators
  shares are never reduced, and player funds and Chest backing are never redirected.
- Funding can only come out of the **Treasury's own 50%** (or a share of it), never from reward pools, custody or deposits.
- Reserving is not burning. Any burn stays a separate multisig decision (BURN_RESERVE_OPERATIONS.md).

## Options

| Option | Source | Example | Effect | Code impact |
|---|---|---|---|---|
| **0. Status quo (recommended for now)** | — | manual, approved transfers from the Treasury when you decide | full flexibility; no player-facing change | none |
| 1. Periodic manual sweep policy | Treasury | e.g. each month move X% of that month's recorded Treasury receipts to the reserve | predictable; still a human transfer, recorded as `burnReserveFunding` | none (process only) |
| 2. Split inside the Treasury share | the 50% Treasury share of SR services | e.g. 45% Treasury + 5% Burn Reserve (the 30% / 10% / 10% shares unchanged) | automatic and transparent; changes the published 50% Treasury line | router v3 (5 legs), new quote version, registry bps for the reserve, UI/whitepaper, migration of approvals |
| 3. Withdrawal deduction share | the 5% withdrawal deduction | e.g. 4% Treasury + 1% Burn Reserve | small, steady flow; touches every withdrawal wire | withdrawal plan, ledger, UI |
| 4. Boss Hunt share | the 10% Treasury share of Boss Hunt | redirect part of it | small; Boss Hunt already burns 10% from custody | hunt wire and quote change |

## Impact to quantify before deciding

- Treasury income lost per month, from `/admin/` service revenue totals.
- The Treasury's role in reward-pool replenishment: less Treasury income means less headroom for top-ups.
- Player messaging: reserved ≠ burned, and percentages must remain clearly published.
