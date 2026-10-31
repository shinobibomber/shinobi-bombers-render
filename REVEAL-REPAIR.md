# Actual reveal portraits and reference alignment

Real flips could leave hero canvases empty: portrait painting read transformed
getBoundingClientRect dimensions while the face was edge-on at rotateY(90deg).
The painter now uses stable layout dimensions, synchronizes revealed state and
repaints after layout/transition/resize. Larger batches show only heroes and
rarity; names remain accessible. Supplied model/aura art is unchanged.

Shrine art fits the actual 222x331 scroll opening with clipped padding. Fusion
input previews derive from checked inventory rows and display the three chosen
heroes or explicit empty prompts. Heroes badges use the original medallion and
crystal icon crops, with one icon and a non-overlapping live rarity label.

Startup uses the unchanged login.zip artwork already present in the verified
base (SHA256 0de44785ff137b77ee1eeb74d56199fa679f5ae774173e87fe33d93e9c19af51),
with live progress inside its frame. The existing DOM/deferred-model readiness
gate also waits for the startup artwork; wallet controls appear after loading.

Checks: actual sealed-to-revealed 1/5/10/15 and Legend batches contain visible
portrait pixels, simplified bulk content, exact badge bounds/icon spacing,
selected Fusion IDs and nonempty model canvases, Shrine dimensions at DPR2,
loading gate held while model assets were delayed, all purchase flows/mobile
layouts, and all 14 helpers applied to a fresh base. No real wallet transaction
was submitted, and no economy or server behavior was changed.
