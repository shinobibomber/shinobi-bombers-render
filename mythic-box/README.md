# Limited Mythic NFT Box (initial investor offer)

Shown on the Main Menu EVENT panel. Pressing it opens the box: description, perks, supply and price.

| | |
|---|---|
| Network | Solana **Devnet** while testing (the game's network) |
| Supply | 20 (`MYTHIC_BOX_SUPPLY`) |
| Price | 1 SOL (`MYTHIC_BOX_PRICE_SOL`); a wallet's 2nd box 1.5 SOL (`MYTHIC_BOX_SECOND_SOL`) |
| Per wallet | 2 (`MYTHIC_BOX_MAX_PER_WALLET`) |
| SOL goes to | the revenue wallet (`RYO_REVENUE_WALLET`) |

## Perks (holding a box NFT)
* 7-star Mythic hero **Tsukiyomi** with the Mythic Aura (`mythic-hero/`), one per box; he follows the NFT.
* **10% off** Summon, Fusion, Dojo, Sensei (hire and rental) and Training. Not Marketplace trades or
  the Boss Hunt entrance fee. One discount per wallet, however many boxes; it ends when the NFT leaves.
* Exclusive NFT holder tier.

## How a mint works (one atomic transaction)
1. `box-mint` reserves the lowest free serial (1–20) and builds the transaction: the player pays the
   price to the revenue wallet, a Token-2022 mint with on-chain metadata ("Mythic NFT Box #N",
   `SBBOX`, `…/play/assets/mythic-box/metadata/box-N.json`) is created and 1 NFT minted to the
   player, then the mint authority is removed (supply fixed at 1), plus memo `shinobi-box-v1:<id>`.
   The server signs as mint/update authority; the player's SOL (price + rent + fee) is checked first.
2. The page reviews it (`box.js`: only that payment, that mint to the player's own account and the
   memo), the wallet signs, and it is sent to Devnet.
3. `box-confirm` (and every `state`) settles it: the player's signature over that exact transaction,
   finalized without error, or the NFT existing → confirmed; the blockhash expired → the serial is freed.
Payment and NFT land together or not at all. Sold box mints count as Tsukiyomi NFTs automatically.

Purchases pause (admin dashboard) also pauses new box mints. The dashboard shows minted / pending /
remaining and SOL collected.
