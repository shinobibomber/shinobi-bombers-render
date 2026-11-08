# Mythic poster recreation — local art review

This preview recreates the four effects in `Mythic-Skill.png`. Following the
2026-11-09 test-server deployment request, the reviewed ground/front sheets are
also used by Beta Adventure/Hunt. The preview controls remain isolated from game
state. See `docs/MYTHIC_VFX_V11_RELEASE.md` for integration and release checks.

| Effect | Frames | Duration | Sheets |
| --- | ---: | ---: | --- |
| Dragon Crescent Gale | 8 | 1000 ms | ground, front, combined |
| Void Eclipse Shuriken | 8 | 1200 ms | ground, front, combined |
| Thunder Chain Vortex | 10 | 1500 ms | ground, front, combined |
| Mythic Dragon Dominion | 12 | 2000 ms | ground, front, combined |

All twelve sheets are genuine RGBA PNGs. Each cell is **512 × 512**, arranged in
four columns, with zero spacing and a fixed **(256, 420)** ground anchor. Every
cell has at least 16 pixels of fully transparent margin. Dragon Crescent Gale has
an empty ground layer because its effect is airborne. `manifest.json` supplies
the frame rectangles, durations, phase names, anchors, hashes and provenance.

## Source and production method

The supplied 1536 × 1024 poster is preserved at
`mythic-hero/reference/mythic-skill-v6.png`, SHA-256
`5176a1625f97edcb50b26d0a043d71b4afab0af4e6a13eda37f231ad5866c414`.
Repository inspection found a prior transparent reference atlas and original
small VFX strips. The complete reusable crescent, shuriken, sigil, gold circle,
pillar, impact, flash and vortex elements from that atlas are reused where their
backgrounds had been recovered cleanly. Overlapping poster illustrations were
not used as rectangular background crops.

Four detailed, genuinely transparent master effects were made with the built-in
`image_gen.imagegen` tool. The exact prompts are in `prompts.json`; project copies
are in `masters/`. The generated alpha is preserved. No CLI/API fallback was used.

`authoring.js` combines these masters with the recovered original elements and
deterministic Canvas animation: expanding crescents, orbital shuriken, rising
lightning, travelling strip deformation, linked vortex ribbons, dragon formation,
ascension, particles and final impact. `bake.cjs` exports all 38 frames and the
separate layers. The preview uses cached sheets and premultiplied interpolation;
it does not run the authoring code each frame.

## Differences to review

- These are faithful recreations, not pixel-identical poster extracts. Dragon
  scales, mane contours, chain placement and some energy silhouettes differ.
- The poster has 7/8/9/11 separable drawings. The exported 8/8/10/12 frames fill the
  missing progression using consistent master shapes and controlled animation.
  They are not 38 independently hand-drawn poses.
- The dragon uses a detailed coiling silhouette with a travelling deformation,
  rise and impact transition. It is not a fully articulated 3D dragon animation.
- The vortex's linked chains follow its painted ribbons; particle trajectories
  and the burst timing are recreated. A temporary gold ring belongs to the skill
  effect, not to the permanent Mythic Aura.
- VFX are a camera-facing plane. Left mirrors the effect; front/back only change
  the original hero view. Directional 3D VFX views are not claimed.
- The original low-resolution reusable elements can look softer than the new
  masters. The working output is 512 pixels per frame, not recovered HD source art.

The character model, original aura, existing rarity/NFT metadata, cooldowns,
combat damage, chakra, SR rewards and economics are untouched. The inherited
branch already displays Mythic without stars; this art task makes no change to
that existing display or rarity data. No pull, stun, area damage or economic
behavior is inferred from the poster's descriptive text.

## Preview and exports

From the worktree root, after the existing game has been built:

```powershell
node dev-vfx-lab/preview.cjs
```

Use the printed host with path **`/vfx-lab/recreation`**. The original lab remains
at `/vfx-lab/tsukiyomi`. The recreation page has play/pause/restart, looping,
0.25×/0.5×/1×/2× speed, exact frame selection, smooth/stepped transitions,
transparent/dark/Adventure backgrounds, original character/aura toggles, the
selected reference row and full poster, PNG/JSON downloads and MP4 samples.
Frame inspection shows exact baked cells without playback fades. Video samples
show a slowed formation followed by native timing on Adventure artwork.

```powershell
node dev-vfx-lab/recreation/bake.cjs
node tests/mythic-recreation.cjs
node dev-vfx-lab/recreation/export.cjs
```

Review outputs are in `previews/mythic-recreation/`: four approximately six-second
1280 × 720 H.264 MP4s, a 24-second showcase, decoded verification frames, screenshots,
validation JSON and a ZIP of the sprite sheets plus metadata. Videos use an opaque
preview background; the PNG sprites retain transparency.

## Validation and integration boundary

The dedicated suite checks all 38 unique combined frames, twelve RGBA sheets,
transparent margins, source/generator/output hashes, exact anchors and timing,
controls, pause/speed/loop behavior, a real transparent frame download, desktop
and phone layouts, allowed routes, unchanged game renderer/state and protected
source hashes. `preservation.json` pins protected existing source/assets. A local
broader snapshot additionally checks 597 pre-existing source/build files when
available. Browser tests freeze the fixture simulation to distinguish preview
mutations from normal background game ticks.

The exporter decodes every actual MP4 and verifies its dimensions and duration.
The route stays loopback-only, opt-in and unavailable on Render, Mainnet or the
prelaunch host. It is absent from public navigation. The original review manifest
records the preview-only state at export; the runtime release manifest is
`mythic-hero/assets/metadata/production-v11.json`. The preservation overrides in
`release-preservation.json` pin the nine files authorized to change for integration.

Validated on Node 22.23.4: the dedicated recreation suite, existing v6 VFX suite,
native preservation suite and all 20 website checks passed. All five exported
MP4s decoded at 1280 × 720 with expected durations. The four-effect contact sheet,
Adventure screenshots, phone layout and decoded dragon video frame were visually
inspected. Logs are `tests/out/mythic-recreation.log`,
`mythic-recreation-legacy.log` and `mythic-recreation-export.log`.
