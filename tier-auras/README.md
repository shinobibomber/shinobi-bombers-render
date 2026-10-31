# Supplied tier auras

`auras.png` is an unchanged copy of the uploaded aura sheet. Its checksum is
recorded in the manifest. Each tier uses only its standalone Aura Effect panel:
Genin blue, Chunin green, Jonin cyan, Elite purple, and Legend gold.

The runtime isolates the luminous tier color and white highlights from the dark
environmental backdrop. Source RGB is retained; only rendering alpha changes.
The original player model is then painted over that effect without recoloring
or replacing the character. Rank comes from `hero.r`, independently of model ID.

Both shared hero renderer APIs are wrapped after their existing readiness chain.
The standard 320×400 frame and foot anchor are retained, including the original
player/animation metadata. Weak-keyed per-frame caches and a 128-frame recent
cache prevent duplicate layers and bound memory across animation/tier combinations.
Existing procedural rarity rings, dots and elite bolts are suppressed after the
supplied aura effects load; focus indicators and combat effects remain functional.

The build helper copies original assets and applies guarded, idempotent visual
hooks. Character identity, animation, rarity, stats and account state are unchanged.
