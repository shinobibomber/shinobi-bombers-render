# Test-server Starter Pack

Set `STARTER_PACK=on` on the Render service (test server only; leave it unset/off for mainnet).

Every account receives it **once** (new accounts on first sign-in, existing accounts on their next visit):

* **15 heroes**: 1 Mythic Tsukiyomi, 1 Legend, 1 Elite, 1 Jonin, 1 Chunin, 10 Genin (all battle-ready
  up to the 50-hero team limit). A brand-new account's 2 default Genin are replaced, so it holds
  exactly 15. The starter Tsukiyomi is **not an NFT**: it gives no 10% holder discount and the NFT
  ownership check leaves it alone.
* **10,000,000 starter Ryo** (`ryo_accounts.bonus`): pays for anything — Summon, Fusion, Dojo, Sensei,
  Training, the Boss Hunt entry, Market buys and offers — whenever it covers the whole price
  (otherwise the deposited balance pays as usual). It is **never withdrawable**.

Accounting: starter-funded purchases have no on-chain transaction, move no custody tokens and add
nothing to the Adventure reward pool. Market offers remember which pot paid, so refunds return to it.
Market sellers and Boss Hunt winners are paid as usual (owner decision). The admin dashboard shows
starter Ryo outstanding/spent separately; it is outside the custody liabilities.
