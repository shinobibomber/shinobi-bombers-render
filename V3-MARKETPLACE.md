# V3 Marketplace presentation

This update replaces only marketplace presentation in the existing `p4` Market mode. The existing `Market.openListing/post/cancel` flows, wallet login, account ownership and financial services remain in place.

## Implemented

- Responsive cards using actual inventory and `S.v2.marketListings` data; ten cards per page, five columns on large desktop and two columns on narrow mobile.
- All five rarity filters, including Legend; text search; model/element filter; real perk filter; asking-price bands; reset; sorting and pagination.
- Selected hero portrait and Stats, Skills, Chakra and Info views from the real hero record. Element and rarity remain separate.
- Your Inventory and My Listings, native local practice listing/cancellation, real asking prices and honest ownership labels.
- Shared purchases, offers, Items and Resources remain explicitly disabled because their services do not exist. Server-owned token heroes remain read-only in this local prototype; no production trading is claimed.
- The existing global header/Chest is reused without a second balance or transaction manager.
- Shared native portraits and cosmetic auras; bounded visible-card painting, reduced-motion handling and keyboard focus.

## Build integration

Run `applyV3Market(appDir)` from `apply-v3-market.cjs` after the other presentation helpers. It copies only `v3-market/v3-market.js` and CSS and adds an idempotent include marker. It does not patch economic or combat code. Reapplying the helper is safe.

## Verification

`tools/test-v3-market.cjs` runs the actual game and native market entry points with an isolated browser profile and a simulated wallet/ledger. It verified all five rarity filters, Legend inspection, ten-card pagination, search, element filtering, detail tabs, native token-owned listing rejection, a local Legend posting/cancellation, visible model pixels, unchanged authoritative profile/balance, Dojo navigation, two mobile columns and no horizontal overflow or page errors. The test never submits an actual wallet signature or token transaction.

`node --check` passed for the new module and apply helper. The helper was applied twice without duplicate includes. Preview test data is under `previews/v3-market/` and is not production data.

## Remaining backend work

Cross-player listings, secure token-collection escrow, atomic buyer/seller settlement, shared cancellation, offers, price revalidation and idempotent purchase recovery are unavailable. All rarities, including Legend, must be supported by those services when implemented. No new fees, prices, rewards or currencies were introduced here.

Rollback: omit the new helper/include and restore the prior presentation build. No schema migration, account-data migration or economic rollback is needed.
