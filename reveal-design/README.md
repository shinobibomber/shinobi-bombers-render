# Cinematic summon reveal

The reveal presentation reuses the existing moonlit village background, original website
scroll artwork and all eight established character identities. Results use transparent
high-resolution full-body redraws derived from those original models, documented in
`ARTWORK.md`. The original 56–60px combat poses were too small for result cards.
`reveal-models.js` lazily loads one 1254×1254 atlas; model identity still comes from
`PlayerModels.modelFor`, independently of rank. Native models remain the network-error
fallback. Original gameplay artwork is unchanged; no cropped torso portraits are used.
The native shrine purchase flow, wallet, server and game economy are unchanged.

## Native state and actions

- `S.v2.revealBatch` contains the actual hero snapshots delivered by the game. No
  presentation code creates heroes, rolls rarity, changes balances, or writes a second save.
- `Experience.reveal` owns each revealed flag and calls the game's existing `save()`.
  `RevealDesign.open` supplies only the short visual wait. The native busy/batch guards
  protect individual clicks, Reveal One and Reveal All, including while Skip Animation is pressed.
- The build helper permits individual cards in any order and replaces legacy rare
  animation waits/particles with the scoped cinematic presentation. Its exact new hooks
  are exported for the preservation test to reverse before checking original inline hashes.
- Continue uses `Experience.finishReveal`. Summon Again finishes that same native batch,
  selects its original quantity, and calls `Combat.summonBatch` to open the existing
  quote and Pay confirmation. It never purchases automatically.
- Completed results display the total from a read-only native `RyoPayments.quote` for the
  batch quantity. A rebuild reuses that quote; checkout always requests its own fresh quote.
  An unavailable quote shows “Cost shown at checkout” and leaves Continue available.
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
Stars visualize the existing rank (one for Genin through five for Legend), as in the
original reveal. They are labelled as rarity rank, not a new or randomized hero statistic.

NEW! marks the first copy of a model absent from the account's current collection before
this batch. The calculation excludes every batch output by its real token ID and compares
only heroes with the same owner. Repeated copies of that model are not marked NEW, and a
different rarity of an already owned model is not a new model. This uses existing collection
data and survives refresh without a separate ledger. It does not claim lifetime collection
history after heroes have been sold/fused. Legacy rescue/fusion records require an explicit
`isNew`. The final rarity summary counts the actual revealed records.

Native buttons support keyboard and touch. Reveal progress and rare announcements use
live regions. Animations use CSS transforms/opacity, limited decorative particles and
gentle CSS model motion. One coalesced animation-frame callback draws changed visible
canvases directly from the source at device-pixel resolution (capped at 2×). There is no
continuous canvas redraw loop. Layout reads precede drawing, offscreen cards are skipped,
and hidden/closed screens stop work. A failed optional atlas shows native models and a
Retry art control; it cannot block Continue or alter results. Refresh batches NEW checks
and UI synchronization, and each Legend owns its own backdrop cleanup.
Reduced motion shows a still model, and reduced-motion preferences and Skip Animation bypass the
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
It checks real checkout delivery, duplicate prevention, individual/Reveal One/Reveal All/Skip
flows, reload and account changes, first-model badges, rank stars, price quotes, failed purchases,
responsive geometry, reduced motion, direct high-resolution DPR2 drawing, zero idle redraws,
art failure/retry and rapid reveal/rebuild sequences. `tests/heroes-navigation.cjs` checks Adventure-to-Heroes
navigation and correct roster identity while preserving inventory and balance.
Screenshots are written to `tests/out/`.

Run `npm start` and open http://localhost:10000/play/. A signed-in account is required
for real purchases; tests use only the fixture wallet and never perform a real transaction.
