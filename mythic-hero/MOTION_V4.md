# Tsukiyomi expressions and reactions — beta only, November 8, 2026

Continues the owner's approved beta animation polish after v3. Targets `main` / `shinobi-bombers-beta` only. No production, wallet, NFT, balance or reward changes.

## What changed

- Idle: eight breathing/hair frames and a localized blink in the existing eye band. All four approved directional images are preserved; the back view has no invented eyes.
- Attack: six poses with anticipation, swing, follow-through and recovery, articulated through shoulders and wrists. Movement still uses the independent gait while the existing slash VFX plays.
- Bomb placement: a short bend at the hips and knees with a reaching gesture. It observes the accepted native placement, without delaying or creating another bomb.
- Hurt: four recoil/recovery poses. Defeat: eight poses settling into a kneel. Victory: eight restrained arm-raise/settle poses with the existing sparkle layer.
- Alert, Question, Like and Celebrate: distinct gestures with four frames each. Their symbols use vector paths rather than font glyphs, keeping them consistent across browsers.
- Reduced motion: one-shot actions now hold a representative still pose, while callback and completion timing continues normally. This fixes the previous early return that skipped the reduced-motion setting for actions. Comfort walking remains gentle; OS reduced motion still holds locomotion.

The source is still the approved four-view artwork, articulated by code. No new character, aura, or skill art was generated in this release. These are not hand-drawn redraws of each action. Hurt/defeat and emotes remain available through the existing `MythicHero.cosmeticEvent` integration and local inspector; no health/death mechanic, emote menu, or extra combat event was invented. Existing stage-victory and accepted-shot/placement hooks remain intact.

## Assets and performance

The existing `rig-v3` bake pipeline/directory now contains sixteen shared PNG atlases: 120 distinct 128×128 RGBA idle/walk/run/attack frames across four directions. The eight walking/running atlases are unchanged. Rare gestures use the same renderer on a bounded cache miss. Gesture parameters are calculated once per render, rather than once per mesh vertex. No new particle system or per-frame warm allocations were introduced; the existing 160 body / 120 effect texture caps remain.

`assets/metadata/rig-v3.json` continues to record the normalized generator hash and original image hashes; its version describes the bake format. `animations.json` keeps schema version 2 and advances `presentationVersion` to 4. Existing save and hero schemas do not change. The previous skill effects and aura files are unchanged.

## Local rebuild and preview

Use Node 22 and installed test dependencies/Chrome:

```powershell
node mythic-hero/tools/bake-motion.cjs
node mythic-hero/tools/build-runtime.cjs
node unpack.cjs
# Remove the three stale generated files listed in PROJECT_STATUS.md.
node mythic-hero/tools/preview.cjs
```

Choose an animation and direction in the isolated inspector. Its canvas shows the exact runtime frames at 32/48/64/128px. No real wallet is connected. Do not reapply `apply-mythic-hero.cjs` to a fully patched app: later server patches alter its anchors; use fresh unpack.

## Verification

`tests/mythic-expressions.cjs` checks fixed soles, the localized eye closure, a lowered defeat pose, all ten distinct character timelines and four directions, distinct expression symbols, unchanged game state, reduced-motion callbacks once, browser reduced-motion behavior, and zero new canvases over 1,120 warm lookups. `mythic-motion-v3.cjs` now validates all 120 baked frames, while retaining movement, VFX and ten-hero checks. The importer fixture still tests a replacement authored atlas.

Rendered review: `tests/out/mythic-v4-expressions.png` and the existing directional/Adventure galleries. These checks are not a physical-phone FPS benchmark. Full release check results are recorded in PROJECT_STATUS.md and `tests/out/mythic-v4-*.log`.

Release validation passed on Node 22: fresh unpack, lint, rewards guard, all 55 suites and website checks. The first full run found a Dojo fixture race where a late profile response restored a three-hour rental after the browser shortened it. The fixture now updates the simulated server expiry as well, preserving the original four-second assertion timeout; the full rerun passed. No Dojo runtime change was needed. All sixteen atlases passed dimension, alpha-padding and unique-frame checks. The final warm-render samples allocated zero canvases.
