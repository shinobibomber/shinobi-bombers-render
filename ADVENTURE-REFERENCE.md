# Illustrated Adventure reference

Adventure uses the supplied gold status banner and scenic Adventure Team
artwork. The source PNGs are delivered as lossless WebP: decoded pixels match
the original references, with approximately 36% less image data.

Printed sample values and heroes are replaced by live game data and the shared
player-model renderer. Stage, map name, remaining/initial targets, session Ryo,
team count, hero names, rarity, level and chakra reflect the current game.

The team panel shows up to ten stable battle-ready slots, including deployed
heroes and resting heroes available to deploy. Actions reuse existing deploy,
rest, work-all, camera and management handlers and retain the 50 battle-ready
and 10 deployed limits. Native aura animation pauses outside Adventure and
respects reduced motion. The portrait cache is limited to the visible ten.

Heroes cards retain ten per page and show only a compact perk count. The full
perk descriptions remain in the accessible hero-detail dialog.

The update does not change enemy stats, rewards, purchases, wallet behavior,
treasury settings, or other economy rules.
