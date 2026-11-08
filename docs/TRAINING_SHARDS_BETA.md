# Training, salvage and additive recovery — beta, November 8, 2026

Worktree: `tmp/training-shards-beta`. Branch: `review/training-shards-beta-2026-11-08`. Release target: beta `main` only; production `live` is excluded.

## Approved rules

Resting recovery is **1 chakra/minute + 0.5 if Fast Charge + the active Dojo bonus**. Fast Charge works without a paid Dojo. The existing Dojo totals `[1,2,5,8,11,14,17]` already include the base 1; bonuses are therefore `[0,1,4,7,10,13,16]`. A Tier II resting hero recovers 5/min, or 5.5/min with Fast Charge. Browser Adventure, server chakra, exhausted-hero recovery and offline Sensei settlement use the same shared registry. Exhausted deployed heroes retain the existing one-chakra idle-recovery cap; no attacks become free.

| Rarity | Shards from salvage | Shards per training level | Ryo for level 1 → 2 |
|---|---:|---:|---:|
| Genin | 1 | 1 | 10,000 |
| Chunin | 2 | 2 | 15,000 |
| Jonin | 3 | 3 | 20,000 |
| Elite | 4 | 4 | 25,000 |
| Legend | 5 | 5 | 30,000 |
| Mythic | 7 | 7 | 60,000 |

Ryo step multipliers remain 1/2/4/8. Mythic training costs 60,000 / 120,000 / 240,000 / 480,000 Ryo for levels 2–5, exactly twice Legend, plus 7 shards each time. The level-5 cap and native permanent stat gains are unchanged.

Upgrade Shards are one shared, account-bound in-game item. They are not SR, crypto, a transferable token, or a rarity-specific token. Existing accounts start with zero; no existing hero is automatically salvaged or reset. Training requires both Ryo and shards.

## UI

The existing Train button opens two choices: Upgrade / Train, then Salvage. At maximum level, Manage still opens the chooser and training is disabled. Both hero details and the chooser show the shard balance. Missing shards disable training with an explanation. The existing Ryo checkout explicitly discloses the additional shard cost.

Salvage has a separate permanent-loss confirmation with the exact hero and shard reward. Confirming first rests the selected hero, finishes its in-flight shots and syncs their defeats before inventory removal. If the request fails, the hero remains owned and resting. Back, Cancel and Escape do not destroy anything. NFT-bound heroes cannot be salvaged: deleting an off-chain record would let ownership synchronization recreate it and duplicate rewards. Non-NFT test Mythics remain eligible for seven shards. Practice heroes cannot create server-owned shards. Heroes reserved for Boss Hunt must finish first; listed heroes remain in Market escrow and are not owned-profile salvage candidates.

## Server accounting and compatibility

`hero-upgrades/rules.js` supplies the browser and server shard/price definitions. `combat-rules/rules.js` supplies additive recovery. The authenticated `hero-salvage` route uses the existing signed session and operator purchases pause. A wallet row lock serializes salvage, Market and training changes. The server verifies ownership, derives rarity/reward, settles prior Adventure time, then removes the hero and its roster entry and adds shards in one transaction.

`ryo_hero_salvages` records an immutable server-owned hero snapshot, reward, wallet, request ID and time. Scope/hero and scope/wallet/request uniqueness prevent duplicate rewards, including concurrent retries. Pending purchases block salvage so their inventory snapshots cannot resurrect a salvaged hero.

Training quotes use `upgradeRulesVersion:1` and include a server-derived shard cost and hero level. New checkout code sets a separate `upgradeRulesAccepted:1` flag when submitting the reviewed payment. Passing through the quote metadata alone is insufficient, so older cached clients must refresh before a new purchase. Fulfillment validates and deducts shards in the pending profile snapshot; the owned balance changes only on confirmed settlement. A failed/expired/refunded order does not consume shards. Settlement preserves current shard inventory for other products and pre-release Ryo-only orders, rather than restoring an old snapshot. Existing pending purchases retain the Ryo/shard terms already agreed when created. Permanent levels, perks, look, NFT ownership and inventory remain intact.

Salvage never transfers SOL/SR, signs a chain transaction, burns an NFT, or credits Ryo. Existing service payment distribution, reward funding and claims remain unchanged. One attack still spends one chakra and resolves trained Power damage; skill effects add neither damage nor chakra cost.

## Chest compatibility fix

The full regression run exposed an existing review-reset race in the Chest: an amount-change effect could clear a fresh Review click after paint. The transfer form now invalidates review synchronously before paint, with all existing account/balance/configuration checks retained. The browser regression changes the amount after review, requires a fresh confirmation, and verifies it remains stable across rendering. Fees, withdrawal rules and transaction signing are unchanged.

## Validation and preview

Node 22: `npm run build:ui`, `node unpack.cjs`, `npm run lint`, `npm run check:rewards`, `npm test`. Never edit generated `app/`. `npm start` serves `http://localhost:10000/play/`; browser fixtures provide isolated authenticated previews without real wallet transactions.

New suites: `tests/hero-upgrades-server.cjs` (all six rarities, recovery, concurrency/replays, ownership, NFT/hunt/pause protection, payment confirmation/refund/failure and old pending orders), and `tests/hero-upgrades-ui.cjs` (actual Train chooser, missing shards, cancellation, confirmed salvage, Ryo-plus-shard checkout, NFT protection and mobile layout). Existing training, combat and rewards tests are updated to the approved rules. Screenshots are under `tests/out/shards-*.png`. Final validation: Node 22 build, TypeScript typecheck, lint, preservation, the 48-team real-time rewards guard, all 62 game suites and all 20 website checks passed. Desktop and phone chooser/confirmation screenshots were inspected. All tests used isolated wallets, databases and RPC fixtures; no live financial or NFT operation was executed. Beta deployment asset/browser evidence is written to `tests/out/shards-beta-live.json`.

## Modified files

- `PATCH_NOTES.md`
- `PROJECT_STATUS.md`
- `apply-hero-upgrades.cjs`
- `chest-ui/src/Transfer.tsx`
- `combat-rules/client-patches.json`
- `combat-rules/rules.js`
- `docs/COMBAT_PERKS_BETA.md`
- `docs/TRAINING_SHARDS_BETA.md`
- `gameplay-options/server.cjs`
- `hero-upgrades/client.js`
- `hero-upgrades/rules.js`
- `hero-upgrades/server.cjs`
- `mythic-hero/ASSET_AUDIT.md`
- `mythic-hero/README.md`
- `tests/baseline-hashes.json`
- `tests/browser.cjs`
- `tests/combat-adventure.cjs`
- `tests/combat-native.cjs`
- `tests/combat-rules.cjs`
- `tests/gameplay-options-server.cjs`
- `tests/harness.cjs`
- `tests/hero-upgrades-server.cjs`
- `tests/hero-upgrades-ui.cjs`
- `tests/mythic-hero-server.cjs`
- `tests/mythic-hero.cjs`
- `tests/preservation.cjs`
- `tests/realtime-rewards-guard.cjs`
- `tests/run.cjs`
- `tests/smoke-sweep.cjs`
- `tests/training.cjs`
- `unpack.cjs`
- `website-design/website-design.css`
- `website-design/website-design.js`
