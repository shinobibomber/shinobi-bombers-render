# Original character animation sets

The four PNGs are unchanged copies of the uploaded Animation Set ZIP. They
contain Fire/Shadow, Storm/Earth, Ice/Poison, and Lightning/Spirit respectively.
The manifest uses actual drawn frame counts: 363 actor cells and 265 effect
cells. The counts printed on the presentation sheets sometimes differ.

Actors and standalone effects are separate. A ranged row's projectile or an
effect-only Bomb row cannot replace a character body. Front/side actions use
the supplied action cells; back-facing movement retains the original player
base's back frames because the action sheets contain no back-facing cycles.
Runtime transparency removes backdrop pixels and thin sheet-border strokes;
the source PNGs and foreground RGB values are retained.

Adventure movement selects idle/walk/run clips. Existing shots, ultimates,
map advancement and hero previews trigger the corresponding action, skill,
victory and melee art. Projectiles and impacts in Adventure and Boss Hunts
use the owner's character-specific effects. Chakra rest remains rest; Hurt
and Die clips are available to the renderer without adding a player HP/death
mechanic. No damage, reward, account, collision or stamina rules are changed.

The shared readiness promise includes the original sheets. Frame canvases
are cached with a bounded cache. Every helper is idempotent and validates its
generated-source hooks before modifying the unpacked application.
