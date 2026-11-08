# Tsukiyomi skill set v6 - local review

This change is local to `review/mythic-skills-v6-local-2026-11-08` in `tmp/training-shards-beta`. Do not push `main`, deploy Render, mint NFTs, or change SR systems without explicit owner approval. The production checkout and both Render services are outside this change.

## Implemented

| Existing permanent ID | New display name | Logical key stages | Actual separable poster drawings | Runtime duration |
| --- | --- | ---: | ---: | ---: |
| `dragon_slash` | Dragon Crescent Gale | 8 | 7 | 1,000 ms |
| `void_shuriken` | Void Eclipse Shuriken | 8 | 8 | 1,200 ms |
| `raijin_field` | Thunder Chain Vortex | 10 | 9 | 1,500 ms |
| `mythic_dragon_ascension` | Mythic Dragon Dominion | 12 | 11 | 2,000 ms |

The renderer uses the supplied violet crescents, shuriken, vortex, lightning, dragon silhouette, impact and temporary gold-circle artwork. Continuous transforms, crossfades, bounded source-art motes and reusable chain geometry create motion. The real native projectile chooses position/direction; impact effects use valid map tiles. Existing attack/cooldown/chakra rules own damage. No callback in the VFX renderer resolves a hit, gives extra attacks, spends chakra, or credits Ryo. Every eighth Mythic attack's ultimate remains cosmetic. Boss Hunt reuses these effects through its existing hooks.

The approved character images, baked directional animation strips, articulated rig and permanent aura files are unchanged. The lab uses those same files and restores the aura visibility property after each draw; it does not change a player's saved aura preference. Temporary ultimate circles are part of the skill atlas, separate from the permanent aura.

The eclipse does not pull enemies, chains do not root or stun targets, and the dragon does not add area damage or clear the map. Those would be new gameplay rules requiring approval. Here they are visual demonstrations over the existing accepted attack/impact events.

No database schema, save-data or inventory migration is required. Existing hero IDs, skill IDs, ownership, training, perks, stats, fees, reward accounting and transaction endpoints are unchanged.

## Exact-art limits and missing production art

`reference/mythic-skill-v6.png` preserves the owner's original PNG byte for byte (SHA-256 `5176a1625f97edcb50b26d0a043d71b4afab0af4e6a13eda37f231ad5866c414`). It is **1536 x 1024 RGB with no alpha**, containing a poster, text and overlapping illustrated frames. It is not a production spritesheet. The labels skip stages: only 7/8/9/11 separable drawings exist, not 8/8/10/12 original frames.

The generated RGBA atlas retains source RGB. Exterior opacity, a three-pixel edge feather, and orange poster-border rejection remove backgrounds/borders. Crops stay at native resolution (roughly 45-130 pixels wide), with source rectangles and anchors documented. This is **reference-derived native-resolution art, not newly authored HD production sprites**. No AI redesign or substitute aura was generated. Some large row drawings overlap their neighbors; the renderer uses complete reusable crescents and the clearest supplied dragon/vortex crop rather than displaying hard-cut overlapping panels. Therefore this is not a pixel-identical reproduction of every poster illustration.

Still needed for final production quality: clean isolated higher-resolution RGBA crescent/shuriken/vortex/dragon exports, complete non-overlapping stage artwork, and authored separate ground/foreground layers. Interpolation supplies logical timing, not missing hand-drawn poses. The current ground/front split is a rendering mask, not falsely claimed artist-exported layers. Existing 128 x 128 character frames remain the actual hero source.

## Developer preview

From the isolated worktree using Node 22:

```powershell
npm run build:ui
node unpack.cjs
node dev-vfx-lab/preview.cjs
```

Open the printed `http://127.0.0.1:<port>/vfx-lab/tsukiyomi` URL. The helper starts the existing site host with a minimal environment, without inherited production secrets. The route requires `SHINOBI_VFX_LAB=on` and a loopback connection; it is unavailable by default, on Render, on Mainnet, and in pre-launch mode. It is absent from public navigation. The hidden same-origin game loads shared render assets; no login or wallet interaction is necessary.

Controls: skill, play/pause/restart, loop, 0.5x/1x/2x speed, 30 fps frame inspection, transparent/dark/Adventure background, facing, mobile/desktop quality, character and approved-aura visibility. The Adventure backdrop uses the real map, static preview crates and native enemy artwork; those props never enter the combat simulation. Transparent mode keeps canvas alpha, though the UI shows a checkerboard behind it.

## MP4 previews

```powershell
node dev-vfx-lab/export-videos.cjs
```

Outputs in ignored `previews/mythic-v6/`:

- `tsukiyomi_dragon_crescent_gale.mp4`
- `tsukiyomi_void_eclipse_shuriken.mp4`
- `tsukiyomi_thunder_chain_vortex.mp4`
- `tsukiyomi_mythic_dragon_dominion.mp4`
- `tsukiyomi_mythic_skill_showcase.mp4`

These are actual Chrome canvas recordings, H.264 MP4 at 1280 x 720, targeting 30 fps. Individual clips last about 6 seconds; the combined showcase lasts about 24 seconds with fades. Recording timing follows elapsed time. The exporter decodes each output again, checks dimensions/duration, and saves a decoded PNG inspection frame and `video-manifest.json`. Videos have no audio. They show source-limited game VFX, not a promise of high-resolution poster animation.

## Performance and regression checks

One shared ~606 KiB reference atlas replaces the previous generated dragon in the active VFX preload plan. Native crops and bounded cached effect frames are reused. Continuous painting allocates no canvas and performs no pixel readback after load. Existing pooled effect caps stay 48 desktop / 12 low-quality; there are at most seven source-art motes. Offscreen culling, reduced-motion/effects settings, owner removal, map changes, menu changes and hidden-tab cleanup remain active.

The final runtime draws the ultimate's temporary gold circle in the ground pass and its dragon in the actor foreground pass, with a regression assertion for that order. Reference extraction is reproducible byte for byte. The active atlas is 620,119 bytes versus the previous generated-dragon preload's 1,441,170 bytes; the supplied 2.6 MB poster is retained as source provenance and is not shipped as a runtime texture.

Run `node tests/mythic-vfx-v6.cjs`, `npm run lint`, `npm test`, and `npm run check:rewards`. The new suite checks source provenance, true RGBA atlas, real frame counts, distinct continuous frames, transparent edges, clean endpoints, no game-state mutation, warm rendering allocations/readbacks, route restrictions, transport controls, and desktop/mobile screenshots. Existing animation/combat suites verify the four-direction hero, ten deployed heroes, aura behavior, pools, NFT ownership, exact Power damage and one chakra per attack. Tests use isolated wallets, never live NFT or token operations.

## Source changes

- `mythic-hero/new-skills.js`, `animation-runtime.js`, `mythic-hero.js`: new cosmetic rendering and names using preserved skill IDs.
- `mythic-hero/tools/build-skill-v6.cjs`, `build-runtime.cjs`: reproducible reference extraction and animation metadata.
- `mythic-hero/reference/mythic-skill-v6.png`, `assets/skills/reference-v6.png`, `assets/metadata/skills-v6.json`, `animations.json`, `tsukiyomi.json`: supplied source, reference-derived atlas, and provenance/timing.
- `apply-mythic-hero.cjs`: copies/loads the new renderer through the normal generated build.
- `dev-vfx-lab/`: gated preview UI, same-game renderer bridge, local host helper and MP4 exporter.
- `server/site-server.cjs`: delegates only `/vfx-lab` requests to the disabled-by-default local route.
- `website-design/website-design.js`: Mythic collection skill label.
- `tests/mythic-vfx-v6.cjs`, `mythic-animation-controller.cjs`, `mythic-hero.cjs`, `run.cjs`: new acceptance suite and updated names/version.
- `PROJECT_STATUS.md`, `PATCH_NOTES.md`, `mythic-hero/ASSET_AUDIT.md`: review handoff and explicit art limitations.

Final local validation (Nov 8, 2026): fresh generated build; lint; rewards guard (48 teams); all 65 isolated game suites; all 20 website checks; final VFX transport/route/layering tests; unchanged gameplay snapshot; zero warm canvas allocations/readbacks; reproducible extraction; all five MP4s decoded and dimensions/duration verified. All four combined-showcase sections were decoded to a contact sheet and visually inspected. Desktop, phone and Adventure previews were inspected. No main push, Render deploy, live wallet operation or database migration occurred.
