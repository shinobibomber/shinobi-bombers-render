# SR Revenue Distribution

**Live server only.** The validated Mainnet build selects this economy. Beta/Devnet keeps
its original 80% Adventure operations / 10% treasury / 8% burn / 2% studio service model,
including its original Market-fee reward funding. No beta admin approval can enable the
live router. The build stamp controls this choice; request bodies and runtime flags cannot
override it. Both branches carry the selector so later merges preserve the separation.

`GET /economy-policy.json` reports the selected policy without a wallet, database query or
transaction. The live pre-launch service publishes its policy while `/api/ryo` stays blocked,
`/play/` redirects and `/admin/` stays unavailable. Deploying this policy does not launch
Mainnet payments or substitute for the vault approvals below.

SR means Ryo. Approved real-token service payments use the full-price **50 / 30 / 10 / 10**
allocation. A 25,000 SR summon assigns 12,500 to the Treasury, 7,500 to Active Adventure
Rewards, 2,500 to Community Rewards and 2,500 to Economic Reserve. No service studio share
or automatic service burn remains. Token genesis allocations are a different policy.

## Custody and honest reporting (v2, 2026-11-08)

The router is a server adapter that builds **one atomic signed SPL transaction**; it is not an on-chain
router program (see [docs/treasury/SR_ROUTER_ANCHOR_DESIGN.md](../docs/treasury/SR_ROUTER_ANCHOR_DESIGN.md)).
v2 sends **four** transfers, to the destinations in the committed public registry
([treasury/treasury-registry.json](../treasury/treasury-registry.json)):

- Treasury 50%: since the 2026-11-12 migration the owner-approved single-key wallet GPbg…htjE (registry treasuryCustodyException; re-verified as a wallet with a clean token account). Before: Squads v4 vault #0, now the RYO Burn Reserve (0%, never a destination or top-up source). Re-verified at finalized commitment for every approval and
  checkout: the pinned program and discriminator, the vault PDA derived from the registered multisig,
  threshold ≥ 2 and equal to the registry, the exact member set, no config authority, and the time lock as
  recorded. No game-controlled key may be a member. The Treasury token account may have no delegate and no
  foreign close authority.
- Active Reward Pool 30%: the registered wallet, **outside game custody**. Adventure claims are funded only
  by verified, independently approved top-ups into custody (sources: `activeRewards`, `lockedTreasury`,
  `economicReserve`). Top-ups are internal transfers and are never split again.
- Community 10% and Reserve 10%: registered plain wallets (System-owned or unfunded).

Configured destinations must **equal the registry**. If the registry later changes, the approved
configuration becomes stale and payments stop (fail-closed). Destinations may never equal the custody,
studio or legacy revenue wallets. Payments additionally need `SR_REVENUE_ROUTING_ENABLED=on`, a committed
`activation.approved` and a registered SR mint equal to `RYO_TOKEN_MINT`.

This is multisig approval, **not a timelock, vesting schedule, or a prohibition on every action the signers
might authorize**. v1 quotes signed before the upgrade settle under their persisted wire and evidence. The
5% withdrawal deduction is booked separately (`ryo_withdrawal_treasury_fees`, see [treasury/README.md](../treasury/README.md)).

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
with source (`activeRewards`, `lockedTreasury` or `economicReserve`), signature, whole-Ryo `amountRaw`, and
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
