# Player referrals

Open **Home → Referral** beside Creator (replaces News). Every signed-in wallet gets a
personal `?referral=RP...` link without a creator application or approval. The popup uses
the Creator Portal theme with its own overview, dashboard, referrals and claim history.

Each new referred wallet must accept its first valid invitation before any order or
recorded Adventure progress, complete 15 finalized paid Shrine outputs and clear Stage 5
in the same server-only verifier used by Creator referrals (100 authoritative defeats).
The signed-login handler accepts both link types. One permanent attribution applies across
both programs. Shared program-row locking prevents competing links enrolling in both.
Self-referrals, circular player chains and creator aliases cannot be referred. Creating a
player link does not prevent a genuinely new wallet from accepting someone else's link.

Qualification issues exactly two wallet-bound standard hero passes immediately. No CP,
Ryo, ongoing commission or on-chain transaction is created. Bonus-funded, free/reward,
fusion, Market, pending and refunded orders do not count. A qualifying wallet earns no
second milestone on settlement/progression replay. An existing Creator referral is never
silently converted into a player referral, or vice versa.

Claim one or two passes per request. The existing authenticated Ryo API accepts
`creator-player-state` and `creator-player-claim`; it ignores frontend wallet assertions.
Pass claims lock program/account/reward rows, consume entitlements FIFO, deliver normal
Shrine heroes, save the profile, receipt and staff audit in one transaction. Retries with
the same request ID and quantity return the original receipt. A reused ID with a different
wallet or quantity is rejected. Failures and full collections leave passes untouched.
Pending game purchases must settle first; operator purchases pause gates new claims.

Player passes have no monthly cap and do not consume Creator Shop inventory or seasonal
hero supply. They are earned promotional commitments separate from CP. Shared enrollment
capacity and enrollment pause limit new referrals; accepted players retain qualification
and earned passes after enrollment pauses. The existing portal enable flag gates both UIs
and new API access; settlement hooks keep accepted referral progress intact while disabled.

Normal Shrine odds are Genin60/Chunin25/Jonin10/Elite4/Legend1 percent. Heroes carry
`creatorReward`, `referralReward` and `referralClaim` provenance. They do not count as paid
summons, credit a reward pool or change combat stats, chakra, battle-ready limits, Ryo
balances, withdrawal rules or the real-time kill sync. Delivery is in-game hero ownership,
not an NFT mint. Stage verification can lag browser progress; wallet auth is not proof of
one human, and staff should continue reviewing suspicious enrollment.

Storage: four additive scoped tables (`ryo_player_referrers`, `ryo_player_referrals`,
`ryo_player_referral_rewards`, `ryo_player_referral_claims`), existing audit/events tables,
foreign keys, nonnegative counters and unique invitation/claim keys. Player progress lists
use hashed identifiers and expose no other players' wallet addresses. Staff audit includes
link creation, verified qualification evidence and pass claims.

Regression suites: `tests/player-referrals.cjs` exercises real signed login, shared
attribution, cycles, stage verification, paid/refund/bonus exclusions, immediate rewards,
idempotent/concurrent rollback-safe claims, collection/pending gates and scope/privacy;
`tests/creators-portal.cjs` covers both Home buttons, mode separation, claims/profile and
desktop/mobile screenshots. Existing Creator tests preserve CP commissions and verify
server-side cosmetic retirement, hero supply concurrency and history retention.
