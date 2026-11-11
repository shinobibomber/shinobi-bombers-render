# Shinobi Bombers: feature and mechanics handoff

This package contains the existing game from main commit `a68984bc83ebbc53c0ecfcaf71b841dc24f307db` plus the scoped Design 14 global Header/Chest update. The stopped full V3 redesign is excluded. All pictured balances in screenshots are isolated test fixtures.

## Architecture

The game engine and existing screens use JavaScript/Canvas with ordered wrappers around shared functions and state. The Header and Chest use an incremental React/TypeScript/Tailwind layer in `source/chest-ui/src`. This is not a React rewrite of combat. The compiled client is `runtime/public/index.html` and its asset directories. Node serves that public directory and the Ryo API; PostgreSQL stores authoritative account/economic records. Solana integration is the existing SPL-token **Devnet beta** with Phantom/Solflare sign-in.

| Feature | Current behavior | Main source |
| --- | --- | --- |
| Adventure | Native grid, current collision/topology, movement/pathfinding, targets, chakra, stage progression, eight existing environments and visual combat retained. | `runtime/public/index.html`, `source/adventure-design`, `source/map-design`, `source/combat-models` |
| Combat preservation | The final active combat wrappers use cardinal ranged attacks against stationary targets. Earlier classic bomb/blast primitives remain in the source. Do not claim a fully active classic bomb-placement/fuse/chain or moving-enemy mode merely because those primitives exist. | Inline game/combat modules in `runtime/public/index.html` |
| Heroes | Server-owned token-collection hero IDs and local practice heroes remain distinct. Maximum 50 battle-ready; maximum 10 deployed. Reserve/battle-ready, deployment/rest, training, detail/perk views and pagination remain native. | `source/heroes-design`, `runtime/server/economy.cjs`, `runtime/server/store.cjs` |
| Summoning | Server quote/fulfillment, saved result IDs and native reveal sequence. Quantities 1/5/10/15; base 25,000 Ryo per hero. Rank chances Genin60%, Chunin25%, Jonin10%, Elite4%, Legend1%. Legend is the maximum rank. | `runtime/server/economy.cjs`, `source/reveal-design`, `source/shrine-fusion-design` |
| Fusion | Three same-rank Reserve heroes per attempt; batch up to25 attempts; chances90/80/70/60% by input rank. Three level10 Elites required for Legend attempts. Failed attempts consume the three inputs and charge the fee. At least two heroes must remain even if every attempt fails. | `runtime/server/economy.cjs`, `runtime/server/gameplay-options.cjs`, `source/gameplay-options` |
| Training | Owned token hero below level10; price and next level computed by the existing server quote. Base rarity stat bands remain1–3,3–6,6–9,9–12,12–15. | `runtime/server/economy.cjs` |
| Dojo | Permanent tiers0–6; existing recovery and Fast Charge behavior retained. Base tier prices: free,1.8m,6m,13.5m,24m,37.5m,54m Ryo. | `runtime/server/economy.cjs`, `source/dojo-design` |
| Sensei | Existing permanent hire, 7-day rental (250,000 Ryo base), on/off and50/60/70/80/90% return thresholds. Verified offline settlement capped at12 hours when eligible. Permanent hire base1,512,500 Ryo. | `runtime/server/economy.cjs`, `runtime/server/adventure.cjs`, `source/gameplay-options` |
| Adventure rewards | Server elapsed-time/team/energy settlement. Existing four reward target HP values100/213/1000/1625 and base rewards35.625/81.25/406.25/812.5 Ryo feed existing stage/perk/rate calculations. Local client loot totals are never accepted as a withdrawal balance. | `runtime/server/adventure.cjs` |
| Reward pool | Retained, finalized purchase revenue funds claims. Existing enemy loot rate50% plus10% per100,000 Ryo of funded pool, capped100%. Claims also check custody tokens after liabilities; unfunded loot remains pending. | `runtime/server/adventure.cjs` |
| Global Chest | One authenticated Header trigger and manager on native routes/nested services; real pending/claimed/pool/rate, Claim, Withdraw, Deposit, recent History, wallet address, recovery and configuration-based amounts. Internal pages open individually. | `source/chest-ui/src`, `source/apply-global-chest.cjs` |
| Payments | Existing fees, reservations, finalized verification and request IDs. Current transfer fee2%; withdrawal minimum100,000, maximum1,000,000, one successful withdrawal per rolling24h. Purchase base allocation10% treasury,10% burn,80% retained operations; studio fee is added to purchase base. | `runtime/server/service.cjs`, `runtime/server/store.cjs`, `runtime/server/economy.cjs` |
| Boss Hunt | Existing local solo encounter, boss models, combat and progression retained. It is not a new server-verified, withdrawable boss-reward service. | Native Boss modules; `source/combat-models` |
| Prison/rescue | Owner decision 2026-11-10: signed in, each prison kill verified by the server combat accounting (kills[4]) grants one account-bound hero CREATED BY THE SERVER (Shrine odds, never Mythic; 200 verified defeats apart, up to 3 waiting). A client-created hero is still never accepted or converted. Signed-out practice keeps the local visual rescue. No Ryo or token reward. | `source/prison-rescue`, `source/apply-prison-rescue.cjs`; native reveal |
| Marketplace | Existing local practice listing and cancellation behavior retained. Server-owned token heroes remain protected from that prototype. No shared cross-player marketplace or NFT settlement program is supplied. | Native Market/ownership modules |
| Presence/community | Existing authenticated online count and configured community URLs remain accessible through Header Tools. Sound toggle calls the native mute function. | Native community/audio modules; `source/chest-ui/src/GameHeader.tsx` |
| Guild/Chat | No shared backend in this baseline. Header entries accurately disabled as coming soon. | Header availability state |

Prices above describe this packaged baseline; **use live server configuration and quotes in UI**, not this document as an independent pricing engine. Training prices, fees, eligibility, timers and outcomes must remain server-authoritative.

## State and trust boundaries

- `S`/`S.v2` hold the native local game/save state, visuals and practice progress. Do not replace them with sample website state or submit their currency as verified Ryo.
- `RyoPayments` retains wallet session, server balance/profile, transaction status, configuration and request recovery. Its existing entry points are reused by the new Chest.
- `AdventureChest` retains shared polling and session-gained synchronization. The adapter exposes a read-only snapshot and explicit claim outcome, coalesces read refreshes, and preserves the one-claim in-flight guard.
- The wallet adapter exposes a read-only pending-deposit count scoped to account/network/mint. Unresolved deposits block a new deposit even after Chest closes/reopens. No secret key is requested by the client.
- PostgreSQL economic/profile records are the authority for spendable/withdrawable balances and server-owned heroes. The server signs withdrawals with its privately configured custody signer; the client signs login messages and deposits through the existing wallet flow.
- The server Adventure settlement is an aggregate simulation separate from the visible client map. The two progress displays can differ. Do not hide the distinction by trusting client damage, time, kills or rewards.
- The beta's purchased hero entitlements are game records, not a deployed NFT mint/escrow contract. A separate NFT/trading service would be additional reviewed work.

## Asset and feature limits

The package retains the current model/animation/map assets. It does not include the stopped V3 model catalog or pretend that concept sheets are production animation atlases. The Chest/logo illustration uses a CSS artwork window from the supplied Design14 reference; all live text and controls are real DOM. No standalone transparent Chest/logo source or additional animation frames were supplied for this scope.

Legacy reference artwork elsewhere in the game may contain decorative event/sidebar labels. They are not specifications for active token bonuses, quests, rankings, gems, Guild or other unimplemented services. Do not enable economics from the art.

See `VERIFICATION.md` for checks and remaining live-service/dependency risks.
