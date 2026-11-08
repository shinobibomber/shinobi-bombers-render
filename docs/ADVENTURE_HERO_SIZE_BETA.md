# Adventure hero size - beta

Regular Adventure hero bodies now use Tsukiyomi's existing visible body height as their reference: 292 pixels in the shared 320 x 400 canvas, or 36.5 logical sprite pixels before the map's existing perspective/pop scale. This keeps all rarities comparable without changing the Mythic artwork or making auras the size reference.

The original regular walking bodies measured 272-327 pixels, with back views at 295-307 pixels. Normalization uses the cleaned idle source cell for each model and the original base cell for back/sleep poses. Every frame in a movement cycle shares that reference, so walking does not repeatedly resize to individual frame bounds. Authored foot pivots and rounded map origins remain intact.

`CharacterAnimations.drawAdventureHero` draws the cached original crop straight to the Adventure context instead of resampling through the enlarged shared body canvas. The cleaned crop's opaque height is recorded from pixels already read during asset preparation. Warm drawing performs no canvas allocations or pixel readbacks. Textures and existing bounded frame caches remain shared. Tier aura back/body/front ordering is preserved. Mythic uses its existing renderer, rig and approved aura unchanged. Menus, enemies, map projection, collisions, attacks, chakra and economy do not use this new drawing path.

## Validation and preview

Run from the repository with Node 22:

```powershell
npm run build:ui
node unpack.cjs
node tests/adventure-hero-size.cjs
npm run lint
npm test
npm run check:rewards
```

The isolated browser test uses simulated authentication, with no real wallet or NFT operations. It compares all eight models' front/side/back idle bodies against an actually rendered Mythic body, verifies stable movement scale references, direct native-cell drawing, flip and foot origins, aura ordering, unchanged menu portraits/game state, and zero allocations/readbacks across 2,000 warm draws. It also verifies the real Adventure renderer draws ten deployed heroes through the new hook.

Inspect `tests/out/adventure-hero-size-sheet.png`, `adventure-hero-size-desktop.png`, `adventure-hero-size-phone.png`, and `adventure-hero-size-results.json`. The sheet uses an equal-size Mythic body with aura hidden only for the isolated comparison. Gameplay screenshots keep all normal effects enabled. Desktop and landscape-phone renders have been visually inspected.

For a local interactive preview after building, run `npm start` with your local development environment and open the printed local URL's `/play/` page. Do not reuse production credentials for local testing.

Release scope: beta service on branch `main` only. Production branch `live` is excluded. The deployed marker is `adventureSizingVersion: 1` in `/play/assets/character-animations/character-animations.js`.

Validation results (Nov 8, 2026): fresh `node unpack.cjs`, lint, all 64 game suites plus 20 website checks, and the real-time rewards guard passed. Rendered regular idle bodies measure 73-74 pixels against Mythic's 73 pixels at an equal scale of 2. The warm drawing test recorded zero canvas allocations and zero pixel readbacks across 2,000 draws. Desktop, comparison-sheet and landscape-phone screenshots were inspected.
