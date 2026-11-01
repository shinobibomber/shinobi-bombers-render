# Cinematic summon reveal

The reveal presentation reuses the existing moonlit village background and all eight
`PlayerModels` bases. The Summoning Shrine menu, wallet, server and game economy are unchanged.

## Native state and actions

- `S.v2.revealBatch` contains the actual hero snapshots delivered by the game. No
  presentation code creates heroes, rolls rarity, changes balances, or writes a second save.
- `Experience.reveal` owns each revealed flag and calls the game's existing `save()`.
  `RevealDesign.open` supplies only the short visual wait. The native busy/batch guards
  protect individual clicks and Reveal All, including while Skip Animation is pressed.
- The build helper permits individual cards in any order and replaces legacy rare
  animation waits/particles with the scoped cinematic presentation. Its exact new hooks
  are exported for the preservation test to reverse before checking original inline hashes.
- Continue uses `Experience.finishReveal`. Summon Again finishes that same native batch,
  selects its original quantity, and calls `Combat.summonBatch` to open the existing
  quote and Pay confirmation. It never purchases automatically.
- Failed or pending purchases remain handled by the existing checkout. Only confirmed,
  delivered heroes can become reveal cards.

## Cards and layout

A ten-hero purchase displays ten sealed scrolls and a five-by-two desktop results grid.
The game's other quantities (1, 5, 15), fusion and rescued heroes remain supported without
padding batches with fake heroes. Tablet uses three or four columns; mobile uses two with
vertical scrolling inside the dialog.

Rank is taken from `hero.r`: Genin gray, Chunin green, Jonin blue, Elite purple, Legend gold.
Element labels, icons and aura colors follow the existing model identity
(`PlayerModels.modelFor`), independently of rank. They are visual identities, not added
combat attributes. Names, level, power and stamina come from the actual hero.
No separate star-rating field exists, so no star values are invented.

NEW means a newly recruited hero from this actual server-owned summon, or an explicit
`isNew` supplied on a legacy record. It does not claim a first-ever model/archetype unlock.
The final rarity summary counts the actual revealed records.

Native buttons support keyboard and touch. Reveal progress and rare announcements use
live regions. Animations use CSS transforms/opacity, limited decorative particles and
one-shot portrait redraws; reduced-motion preferences and Skip Animation bypass the
visual waits. The existing sound preference remains in control.

## Recovery and ownership

Same-browser refresh restores the game's existing saved batch and revealed flags.
Confirmed unacknowledged orders retain native delivery recovery and request-ID deduplication.
The UI only exposes server-owned results to the matching authenticated account; switching
accounts during opening cancels the visual wait without deleting or altering the saved batch.

There is no new server recovery service. Clearing browser storage after a purchase was
acknowledged does not reconstruct the old animation; the server collection remains the
source of ownership. Cross-device animation progress is not provided.

## Verification

`npm run build:local` assembles the generated `app/`; never edit that folder directly.
`npm test` includes `tests/summon-reveal.cjs`, using isolated server/wallet fixtures.
It checks real checkout delivery, duplicate prevention, individual/Reveal All/Skip flows,
reload and account changes, failed purchases, responsive geometry and reduced motion.
Screenshots are written to `tests/out/`.

Run `npm start` and open http://localhost:10000/play/. A signed-in account is required
for real purchases; tests use only the fixture wallet and never perform a real transaction.
