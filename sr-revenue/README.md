# SR Revenue Distribution

SR means Ryo. Approved real-token service payments use the full-price **50 / 30 / 10 / 10**
allocation. A 25,000 SR summon assigns 12,500 to Locked Treasury, 7,500 to Active Adventure
Rewards, 2,500 to Community Rewards and 2,500 to Economic Reserve. No service studio share
or automatic service burn remains. Token genesis allocations are a different policy.

## Custody and honest reporting

The router is a server adapter building one signed SPL transaction, not a newly deployed
Solana router program. Three transfers move Treasury, Community and Reserve funds to their
separate owner ATAs. Active Rewards stays in the existing game custody wallet to back the
existing off-chain Chest-credit / later-withdrawal model. Its income and claim cap are
separate accounting; it is **not a separate on-chain Active Rewards wallet balance**.
Configuring a different Active Rewards owner is rejected until an external reward-vault
settlement adapter exists. The dashboard states this distinction explicitly.

Locked Treasury must be an initialized SPL Token multisig with at least two required
distinct external signers, excluding the game custody signer. Existing Treasury ATAs must
have the correct owner/mint, initialized state, no delegate and no outside close authority.
These controls are checked at finalized commitment for configuration approval and every
new checkout. Plain wallets and unsupported vault programs are rejected. This verifies
multisig restrictions, **not a timelock, vesting schedule, or a prohibition on every action
external signers might authorize**. A purpose-built vault would be needed for those rules.

Four distinct public owner addresses are required. Treasury/Community/Reserve cannot use
the studio fee wallet. No keys are created, requested or committed by this feature.

## Configuration and activation

Open `/admin/`, select **SR revenue vault configuration**, and submit:

```json
{
  "enabled": true,
  "destinations": {
    "lockedTreasury": "EXTERNAL_SPL_MULTISIG_AUTHORITY",
    "activeRewards": "EXISTING_GAME_CUSTODY_PUBLIC_WALLET",
    "communityRewards": "COMMUNITY_PUBLIC_WALLET",
    "economicReserve": "RESERVE_PUBLIC_WALLET"
  },
  "products": ["summon", "fusion", "dojo", "training"],
  "evidence": "Approved full-service 50/30/10/10 policy and custody reference"
}
```

A different authorized approver must approve the proposal. Self review, stale versions,
expired proposals, invalid owners and unverifiable multisigs are rejected. No automatic
fallback to old burning or guessed vault addresses exists. Until configuration is approved,
new real-token SR service checkouts are blocked before reservation/broadcast. The quote
shows readiness and disables Pay. Server pre-submission failures clear the client's saved
request ID, allowing a retry. Existing signed pending transactions recover under their
original quote/wire; they are never rebuilt with new allocations.

Default approved products are Summon, Fusion, Dojo upgrades and Training. Existing Ryo
Sensei/rental fees require explicit additional policy approval; **Sensei SOL is excluded**.
This feature does not implement or convert Sensei SOL payments. Mainnet launch gates and
the pre-launch money block remain enforced. No Mainnet settings or vaults are activated
by code deployment. Test-server starter-funded services still work without real routing.

## Settlement and rewards

All four allocations are exact 6-decimal base-unit strings. Their sum equals the payment.
The finalized successful purchase records an immutable source/signature/config snapshot
in `ryo_service_revenue` in the same DB transaction as fulfillment. Pending, refunded,
failed, bonus-funded and free/Creator/referral hero deliveries create no cash allocation.
Existing historical quote semantics and balances are preserved.

Routing memos hash the economy scope, authenticated wallet and request ID together. Two
wallets deliberately using the same request ID cannot collapse into one signed payment.

Adventure gets only eligible retained allocations plus separately approved replenishments,
less actual prior claim credits. Existing whole-Ryo, custody-liability and concurrent-claim
caps remain. No defeat formulas, kill budget, sync timing or funded claim rule is relaxed.

New marketplace sales keep their existing seller/fee percentages, but their retained
Market fee reserve is marked `adventureEligible:false`; neither seller proceeds nor these
unapproved fees automatically fund Adventure or the SR router. Historical saved Market
quotes retain their original accounting. Boss Hunt prize funds, PvP, Community Rewards,
SOL revenue, deposits and withdrawals stay outside this service distribution. There is no
automatic buyback or community payout adapter.

## Protected replenishments

External Treasury multisig owners or the Reserve owner authorize the actual transfer
outside the game. A successful finalized SR transfer must arrive from that configured
source ATA at game custody. An operator then proposes **Verified SR rewards replenishment**
with source (`lockedTreasury` or `economicReserve`), signature, whole-Ryo `amountRaw`, and
evidence. A different approver reviews it before it becomes Active Rewards funding.

The server verifies the network, successful finalized transaction, mint, exact source,
destination, amount and pre/post balance changes. Reused deposit/distribution/top-up
signatures are rejected; unique receipts and pool locking prevent duplicate funding and
claim races. Community cannot be selected. The game cannot sign a Treasury debit, execute
a buyback, or treat a merely observed transfer as approved funding. Approval records join
the existing hash-chained admin audit. Direct database administrators remain trusted.

## Build and verification

`apply-sr-revenue.cjs` runs after Creator/referral/pre-launch patches and before the network
rewrite/performance steps. It copies the adapter, appends idempotent schema and applies
reversible checkout hooks. Only source files are edited; `app/` is generated.

Tests `sr-revenue.cjs` and `financial-server.cjs` cover real SDK instruction decoding,
signed wires, exact conservation, multisig/delegate checks, independent approvals,
finalized top-up evidence/replay, pending/refund/bonus handling and separate Market income.
The existing rewards guard and full game/website suites remain required. UI regression
screenshots cover the new dashboard cards on desktop and mobile and the payment preview.
