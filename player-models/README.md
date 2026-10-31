# Shared player models

`playermodel.png` is the unchanged original file from the supplied ZIP.
Its SHA-256 is recorded in `frames.json`.

The manifest identifies 96 native cells: eight characters, four rows
(front, side, back, idle), and three frames per row. Crop coordinates exclude
the sheet's labels and panel borders. Every cell uses the same pixel scale
and a fixed foot pivot; rows are never stretched to match each other.

The browser removes only the exterior backdrop connected to each crop's edges.
A one-pixel silhouette closing protects enclosed black hair and clothing.
This changes alpha in the rendering canvas, retaining the source RGB values.
No replacement character artwork, recoloring, or radial feather mask is used.

`ShinobiSprites.heroFrame` and `DesignModels.heroFrame` share one renderer.
Hero IDs map consistently to the eight supplied characters using `abs(id) % 8`;
IDs, rarity, balance, combat and saved account data are not changed. Prison
rescues use the same model mapping. Other enemy and boss artwork is retained.

Arena direction is transient renderer state. Horizontal movement uses the side
row (mirrored when facing left); vertical movement selects front or back.
Menus use front/idle frames. The sheet has no separate attack row, so attacks
keep these original direction frames and the game's existing combat effects.

`apply-player-models.cjs` copies the source assets and patches the generated
application after verified archive extraction. It also makes the loading gate
wait for the final shared model readiness promise. Reapplying it is idempotent;
an unexpected upstream renderer change fails rather than silently skipping it.
