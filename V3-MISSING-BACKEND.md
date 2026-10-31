# V3 missing backend functionality

1 November 2026. Existing Solana Devnet authentication, PostgreSQL accounting, purchases, deposits, withdrawals, profiles, Sensei options, presence and funded Adventure claims remain in use. The new UI does not create a second ledger or claim unsupported services are operational.

## Unavailable services

| Service | What is missing | Current interface behavior |
| --- | --- | --- |
| Shared Marketplace | Persistent cross-player listings, escrow/reservation, seller/buyer ownership checks, atomic settlement, price revalidation, cancellation, offers and idempotent recovery. | All five rarities can be inspected. Native local practice posting/cancellation remains; server-owned token heroes are blocked. Buy/Offers/Items/Resources are unavailable. |
| Guild core | Scoped guild records, membership, applications, roles, notices, settings, audit history and authenticated authorization/transaction handling. | Nine navigable sections explain availability; unsupported mutations are disabled. No fabricated guild records. |
| Guild gameplay/economy | Battle/raid state, missions, research, shop, points, donations, rewards, rankings and settlement. | Unavailable. Screenshot prices, bonuses and rewards are not adopted. |
| Chat | Message schema/history, authenticated send/read, server timestamps/cursors, idempotency, delivery transport and reconnect handling. | Eight channel views identify missing services; message sending is disabled. |
| Social privacy/moderation | Friends/party/DM membership, block/report, staff/system authorship, rate limits, moderation and privacy-aware presence directory. | No fake messages, online names, staff badges or unread counts. |
| Authoritative Boss Hunt | Server encounter/progression validation and funded reward settlement for Boss Hunts or guild raids. | Existing local solo Boss Hunt remains. Its local progression/rewards are not advertised as verified withdrawable rewards. |
| NFT mint/trading program | Audited on-chain mint/ownership/escrow program and its server/client integration. | Existing purchased Hero entitlements remain game records; no NFT mint or real NFT sale is claimed. |
| Offline session report | Persisted rotation/encounter timeline for a historical offline session. | Existing aggregate server settlement and 12-hour Sensei allowance remain. No fabricated battle timeline. |

## Engine/accounting distinction

The current server Adventure service calculates rewards using authenticated elapsed time, owned-team damage and energy. It does not execute the visible client grid or accept client-reported loot totals. Its progress can therefore differ from the client map. A fully authoritative shared combat simulator would be a larger architecture change; client rewards must not be trusted to hide this discrepancy.

The existing active client attack mode is cardinal ranged combat against stationary targets. General moving enemy AI and a full active classic bomb-placement/fuse/chain mode are not implemented by this V3 slice. Existing earlier bomb primitives remain retained. Resolving that discrepancy requires reviewed gameplay work rather than an unannounced visual patch.

## Safe continuation requirements

- Extend the existing authenticated, scoped service and PostgreSQL transaction system. Reuse the wallet account; do not add another signing flow per chat message.
- Validate permissions, ownership, amounts and membership on the server. Use row locks, bounded cursors, request IDs and auditable state changes; test concurrent mutations and account/scope isolation.
- Reauthorize private chat access after leave/kick; render plain text; reject forged system identities; implement rate limits, reports and blocks before enabling real messaging.
- All eligible rarity tiers, including Legend, must remain supported by a future secure Marketplace. Never enable local-only ownership transfer for token collection heroes.
- Guild fees, shop prices, stat boosts, rewards and other new economic mechanics require an explicit specification and approval. They cannot be inferred from the reference art.
- Additive migrations should preserve existing account/economic tables. Rollback should disable new endpoints/UI while retaining records.

No social schema, live messaging transport, trading settlement or new economic source was added in this slice. This report is a dependency list, not a claim that those systems passed tests.
