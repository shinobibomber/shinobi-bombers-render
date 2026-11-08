> Historical v2 asset audit. Current beta rules and animation behavior are documented in [COMBAT_PERKS_BETA.md](../docs/COMBAT_PERKS_BETA.md); current prices, recovery and shards are in [TRAINING_SHARDS_BETA.md](../docs/TRAINING_SHARDS_BETA.md). Earlier star/perk/price statements below describe v2.

# Tsukiyomi animation review and beta release — November 7, 2026

**Superseded movement/effects details:** the subsequent beta motion fix adds independently moving limbs, 88 baked movement/attack frames and new celestial VFX. See [MOTION_V3.md](MOTION_V3.md) for current behavior and asset provenance. The v2 findings below are retained as historical review evidence.

The runtime is playable with a clearly identified pose-rig fallback. **The complete production animation art is not finished.** After local review of 0230af9, the owner authorized deployment to the test server only. Main/beta receives only this animation change; production's live branch/service, NFT minting, transfers and live wallets remain untouched.

## Inspected sources

| Source | What actually exists | Treatment |
|---|---|---|
| `reference/tsukiyomi-model.png` | Composite approved identity sheet, four character views | Preserved byte-for-byte. Existing isolated directional PNGs retain the appearance. |
| `assets/character/tsukiyomi_{front,left,right,back}.png` | Four 128×128 RGBA poses, anchor (64,124) | Active character fallback; no new body design. |
| `assets/animations/*.png` | 21 old strips: idle 4; walk/run 10/6/6/4; bomb 3; victory 5; some copied/held frames | Archived provenance only. These were made from the Fire hero's body with a replacement head; v2 does not download or render them. |
| `assets/skills/*.png` | Concept-sheet extractions: Slash 8 at 72×80; Shuriken 8 at 64×64; Raijin 10 at 64×80; dragon 10 cells | Temporary existing VFX. Some crescents/dragon edges are visibly clipped. These are not newly authored production frames. |
| `assets/aura/*.png` | Existing 14 extracted layers plus 8-frame sheet | Kept exactly as-is; no colour variants, redesign or progression invented. Original clean layered exports are still desirable. |
| `candidates/idle-unapproved.png` | Generated RGBA candidate, 2172×724, eight figures | Rejected for production: not a regular 128×128 grid, coloured edge artifacts and insufficient frame isolation. Never copied to `app/`. |

The poster's ultimate has only ten separable drawings. The existing twelve-step mapping holds source frames 4 and 10; it does **not** supply twelve distinct dragon drawings. The new manifest records both source count and required count.

## Runtime and gameplay

`animation-controller.js` supplies all 19 states: idle, four walk directions, run, attack, bomb place, hurt, defeat, victory, four emotes and four skills. Logical counts are exactly 8/8/8/6/6/4/8/8, four-frame emotes, and 8/8/10/12 skill timelines. Timing, restart, interruption priorities, completion and cosmetic callbacks are explicit. Distance-phase walking does not advance on a stationary phase. Run changes animation only.

`animation-runtime.js` observes existing successful projectile/bomb creation and impact. It never creates a bomb, applies damage, changes movement, spends chakra or pays rewards. Slash and Shuriken follow native projectile position/speed; Raijin splits its ground and foreground portions around the existing actor draw pass. The existing every-eighth-volley visual ultimate remains normal damage. Actual active skill balance is **not introduced**.

The current game uses stamina depletion/rest, not a hero HP/death system. Hurt/defeat are implemented cosmetic hooks and tested in preview; they are not falsely wired to resting. Explicit future gameplay hooks use `MythicHero.cosmeticEvent(hero, state, options)` after the gameplay engine accepts an action. Callbacks are `shinobi-mythic-animation` events with `cosmetic: true`; never use them to settle damage/rewards.

The pose fallback uses bounded transforms of the approved complete body. It does **not** provide independent blinking, articulated footsteps, a six-pose sword swing or a drawn kneeling defeat. Those require authored sprites. Emote symbols and victory sparkles are separate cosmetic drawing.

Mythic stays rank 5 in existing saves and NFT checks, with **seven display stars** in metadata, collection/details and Adventure team cards. Stars do not change stats, six perks, training costs, summon probabilities, ten-hero deployment limit, ownership verification, trading restrictions or tokenomics. No schema migration.

## Missing art / import contract

Supply consistent transparent 128×128 RGBA character cells with (64,124) center-bottom anchor:

- Idle 8 with actual breathing/blink/hair/cloth motion.
- Walk 8 per direction (32 total), and direction-correct run 8 per supported direction.
- Katana attack 6, bomb place 6, hurt 4, defeat 8, victory 8; directional variants as needed.
- Alert, Question, Like, Celebrate: 4 each.
- Separate full-resolution clean Slash 8, Shuriken 8, Raijin 10 (ground/pillar exports), Dragon Ascension 12 distinct frames.
- Clean original aura layers if available; retain the approved design. No tier progression inferred from poster panels.

Add approved atlases under `assets/animations/` and set a state's `texture`, `columns`, and accurate `assetStatus` in `assets/metadata/animations.json`. The loader validates the grid, uses shared images, samples the requested cell, and skips the fallback rig for authored frames. Directional WALK states select their own textures. RUN/ATTACK may use `directionTextures` for four separate atlases. Validate each source visually; dimension/alpha checks alone cannot certify appearance or absence of poster labels.

`tools/build-runtime.cjs` is a metadata scaffold generator; do not rerun it over manually approved import entries without merging those entries. `tools/build-assets.cjs` is the retired legacy extractor, not a production animation authoring pipeline.

## Performance / cleanup

Lazy art load, 160 cached body frames, 120 cached effect frames, 128 tracked actors, 48 reusable effect instances (12 at low FX). Effects-off blocks emission; reduced motion uses fixed VFX frames. Offscreen effects skip drawing. Expired effects, absent owners, map changes, menus and hidden tabs clear transient effects; map/menu reset clears animation state. Texture caches are shared across heroes and remain bounded.

## Local preview and verification

Verified locally on Windows with Node 22.23.4 and Chrome, November 7, 2026:

| Check | Result |
|---|---|
| Fresh `node unpack.cjs` and stale-file cleanup | Passed; generated app rebuilt from verified sources |
| `npm.cmd run lint` | Passed |
| `npm.cmd run check:site` | Passed |
| `npm.cmd run check:rewards` | Passed; reward guard unchanged |
| `npm.cmd test` (original review branch) | One complete green run: all 54 suites plus website checks |
| `node mythic-hero/tools/preview.cjs --smoke` | Passed; actual isolated game and inspector screenshot reviewed |
| Atlas validator | Approved 128×128 pose accepted; malformed generated candidate rejected |

The suites cover existing ownership enforcement and gameplay as well as the new animation/controller/import tests. The test environment emitted its existing optional bigint native-binding warning and used the JavaScript fallback. No real wallet or external transaction ran. The website suite's “live” label denotes its isolated local host mode, not a Render deployment.

Memory checks establish bounded actor, texture and effect counts plus cleanup; they are not a physical-device heap/FPS benchmark. Hurt, defeat and emotes were rendered through cosmetic hooks; the current Adventure engine has no new HP/death or active-skill balance system.

Logs are retained in `tests/out/mythic-animation-final-build.log`, `mythic-final-lint.log`, `mythic-final-rewards.log`, `mythic-final-tests.log` and `mythic-animation-preview.log` (local ignored output).

The beta-only release was separately rebuilt and validated on `main`, based on `e34bb82` plus the reviewed animation changes: lint, rewards guard, all **53 beta suites** and website checks passed in one complete run. The extra wallet-security suite belongs to the separate live branch and is not imported into beta. The animation/controller source is identical to review commit `0230af9`; only branch-specific notes and test registration were adapted. Beta logs are `tests/out/tsukiyomi-beta-{build,lint,rewards,tests}.log`. Desktop/mobile Tsukiyomi screenshots were inspected again from this run.

Use Node 22, installed test dependencies, and the generated app:

```powershell
node unpack.cjs
# Remove the three known stale generated files as described in PROJECT_STATUS.md.
node mythic-hero/tools/preview.cjs
```

The preview launches Chrome with the existing isolated test wallet/API and ten fixture heroes; no external RPC or real wallet is used. Close Chrome or press Ctrl+C to finish. The preview inspector uses the same runtime textures/controller and labels fallback art.

Automated checks:

```powershell
node tests/mythic-animation-controller.cjs
node tests/mythic-animation.cjs
node tests/mythic-hero.cjs
node tests/mythic-hero-server.cjs
npm run check:rewards
npm run lint
npm test
```

Rendered review files: `tests/out/mythic-animation-states.png`, `mythic-animation-skills.png`, `mythic-animation-adventure.png`, `mythic-animation-ultimate.png`, `mythic-heroes.png`, `mythic-phone.png`, `mythic-interactive-preview.png`. These were rendered in Chrome and visually inspected. This verifies the current fallback and existing VFX, not missing production artwork.

Check a proposed character atlas before import with `node mythic-hero/tools/validate-atlas.cjs <file.png> <frames> [columns]`. This checks the grid, RGBA transparency, nonempty cells and transparent edges, then reports per-frame bounds for pivot review. It never modifies the image; human visual review is still required.

## Modified components

Runtime/manifest: `mythic-hero/animation-controller.js`, `animation-runtime.js`, `mythic-hero.js`, `assets/metadata/{tsukiyomi,animations}.json`, `tools/build-runtime.cjs`, `tools/preview.cjs`, `tools/validate-atlas.cjs`, `apply-mythic-hero.cjs`.

UI: `website-design/website-design.js` and `.css`. Tests: `tests/mythic-animation-controller.cjs`, `mythic-animation.cjs`, `mythic-hero-assets.cjs`, `mythic-hero.cjs`, `harness.cjs`, `run.cjs`. Review/provenance: this audit, `README.md`, candidate image, `PROJECT_STATUS.md`, `PATCH_NOTES.md`.
