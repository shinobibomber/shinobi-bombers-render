# Tsukiyomi — Mythic Shinobi (hero 13, rank 5)

**Animation v2 beta release:** see [ASSET_AUDIT.md](ASSET_AUDIT.md) for current behavior,
the seven-star display, runtime/import contract, preview commands, test evidence and missing
authored art. The legacy art generation description below is historical provenance, not a
claim of production readiness. V2 no longer loads the Fire-body animation strips.

The exclusive hero of the **Limited NFT Box** for initial investors. Mythic is a sixth rank above
Legend: base stats 15–18, six perks, Legend volleys (5 shots, 1 chakra each; his skills are visuals on
those shots and the 8th-volley Mythic Dragon Ascension is visual only), Legend training prices, never summoned, fused or listed on the in-game Market.

## Ownership (server: `server.cjs` → `app/server/mythic-hero.cjs`)

Set one or both on the Render service; until then the feature is dormant and nobody owns him.

| Variable | Meaning |
|---|---|
| `MYTHIC_BOX_MINTS` | Comma/space separated box NFT mint addresses |
| `MYTHIC_BOX_COLLECTION` | Verified Metaplex collection mint of the box NFTs |

* Checked on-chain at `finalized` commitment (SPL Token and Token-2022 accounts, amount 1, 0 decimals).
* One Tsukiyomi per box NFT held. The hero belongs to the NFT: when the NFT moves, the hero (with its
  level and training) moves to the new holder and leaves the old wallet and its battle-ready team.
* Checks are cached 60 s per wallet; the **Check NFT** button forces one (at most every 10 s).
* An RPC failure never removes a hero. A full collection (500) waits until there is room.
* Supply, price and addresses are launch configuration, never code.

## Historical asset provenance

The retired `tools/build-assets.cjs` produced the legacy assets below from three supplied sheets
(their SHA-256 is recorded in `assets/metadata/tsukiyomi.json`). Do not rerun it as the v2 build:
it overwrites the metadata and restores the old borrowed-body strips. The normal `node unpack.cjs`
build copies the reviewed assets and v2 runtime without running that extractor.

* **Character** — the FRONT / LEFT / RIGHT / BACK views of `tsukiyomi-model.png`, cut from their
  backdrop (exterior flood fill, enclosed black clothing kept, soft un-blended edges). Previews keep
  the native resolution for menus; game frames are 128×128 RGBA with a centre-bottom anchor (64,124).
* **Animations** — idle, walk/run (front, sides, back), attacks, hurt, defeat, bomb place, victory and
  emotes use the **Fire hero's real action frames** (hands, feet and body from the game's own sheets),
  recoloured to violet, with **Tsukiyomi's own head** (hair, ponytail, crescent, headband, eyes, mask)
  from his reference views placed on every frame. The back attack lunges his own back view.
* **Skills** — Dragon Slash 8, Void Shuriken 8, Raijin Field 10 and Mythic Dragon Ascension from
  `mythic-animation-sheet.png`. The ultimate row draws 10 separable frames (5 is not drawn and 11 is
  hidden behind 12); its 12-step timeline holds frames 4 and 10 for one extra step.
* **Aura** — the existing Mythic Aura (`mythic-aura-sheet.png`): its 14 asset tiles and the 8-frame
  animation, keyed off the checkerboard. Nothing is redesigned.

## Game (`mythic-hero.js` + `animation-controller.js` + `animation-runtime.js`)

* Only metadata loads at start; shared art loads the first time a Mythic hero is drawn. Legacy
  character animation strips are excluded from downloads.
* Arena, menus and Boss Hunt use the approved pose fallback until authored atlases are supplied
  (including his real LEFT view for left-facing moves). See the audit for limitations and imports.
* Aura layers (behind → front): energy pillars, floor sigil, inner halo, ground particles, orbit
  rings, energy wings, golden glyph ring, rune tablets · hero · crystal shards, divine crown. Cached
  in 8 phases; reduced motion / low effects use fewer layers. Players can switch it off (Heroes).
* Skills are visuals on the game's own combat events (no extra damage events): normal volleys
  alternate Dragon Slash and Void Shuriken, their impacts show Raijin Field, and the every-8th-volley
  ultimate shows Mythic Dragon Ascension over the summoning seal.
