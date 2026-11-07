# Tsukiyomi movement and celestial effects v3 — beta only

The owner reported frozen feet/arms and underwhelming skill effects. This release targets `main` / `shinobi-bombers-beta` only. Production's `live` branch, server environment and accounts are unchanged.

## Movement fix

The v2 fallback rotated/scaled the entire pose. V3 skins the approved four directional textures with separate shoulders, wrists, hips and ankles, plus restrained hair/cape motion. Left/right artwork is preserved; the side views hide one leg, so the existing boot texture is reused behind the body for the rear leg. No body or anatomy from another hero is used.

`tools/bake-motion.cjs` runs this deterministic renderer once to produce twelve RGBA atlases with 88 distinct 128×128 frames: eight walk, eight run and six attack frames per direction. They use the existing (64,124) anchor and lossless PNG compression. `assets/metadata/rig-v3.json` hashes the original character textures and rig source. Runtime rendering samples these shared atlases; it does not rebuild a mesh every frame. Other cosmetic states retain the cached rig/import support.

The controller now tracks movement phase independently of action transitions. Accepted shots cannot freeze the gait or restart the same attack before it finishes. While moving, locomotion renders the body and the action's VFX continue independently. Distance and direction still come from the existing engine; no speed, cooldown, damage, chakra or reward rule changes.

Comfort mode keeps the gentler walk animation while reducing ambient and skill motion. OS `prefers-reduced-motion` still holds character frames. Effects-off prevents skill emission/rendering. Aura assets, colors and layer renderer remain unchanged.

## Skill presentation

- Dragon Slash: full, unclipped violet crescent with blade core, trailing arcs and a restrained projectile afterimage aligned to native travel direction.
- Void Shuriken: rotating celestial star, orbit arcs, travel trail and a separate fading impact burst.
- Raijin Field: ground sigil and three lightning pillars rendered on separate ground/foreground passes at valid native impact tiles.
- Mythic Dragon Ascension: a newly generated isolated spectral dragon with twelve distinct render stages (formation, emergence, ascent, impact and dissipation). It is a single source sprite transformed/composited by code, **not twelve hand-drawn dragon poses**.

`skill-effects.js` renders deterministic cached textures. It allocates no particle objects. Limits remain 48 active effects (12 at low FX), 160 body textures and 120 effect textures; map/menu/hidden-tab and removed-owner cleanup remain. No global flash, camera shake or automatic map clear was added. Boss Hunt uses the same new VFX while retaining its original damage rules.

## Art provenance and regeneration

Character input: unchanged `assets/character/tsukiyomi_{front,left,right,back}.png` from the approved model. Old Fire-body strips remain archived and are not loaded.

Dragon input: `assets/skills/dragon-spirit-v3.png`, 1254×1254 PNG RGBA, generated using the built-in image tool with `reference/mythic-animation-sheet.png` as theme reference. The original aura was not a generation target. The exact prompt is saved in `reference/dragon-spirit-v3-prompt.txt`. Visual inspection checked a distinct head/body, transparency and clear margins. The old clipped skill strips remain archived; Adventure and Boss Hunt now use the v3 renderer.

Run with Node 22, installed test dependencies and Chrome:

```powershell
node mythic-hero/tools/bake-motion.cjs
node mythic-hero/tools/build-runtime.cjs
node unpack.cjs
# Remove the three known stale generated files listed in PROJECT_STATUS.md.
node mythic-hero/tools/preview.cjs
```

Do not edit generated `app/` files. Render's normal build copies the committed atlases, so Chrome is not needed in deployment. The atlas importer still accepts independently authored artwork later. Facial blinking and fully redrawn attack/defeat poses remain future art improvements; this release provides actual articulated walking/running rather than promising a complete hand-drawn animation set.

## Verification

`tests/mythic-motion-v3.cjs` verifies source hashes, all 88 distinct frames, arm/foot pixel changes in every direction, continuous gait through attacks/ultimate, Comfort gait, VFX transparent margins, all 8/8/10/12 distinct effect stages, zero canvas allocations for 1,000 warm sprite lookups and ten deployed Mythics with unchanged gameplay state. Controller tests cover repeated volleys, priorities and cleanup. The existing Mythic/NFT/rewards and full project suites remain required before release.

Rendered evidence: `tests/out/mythic-v3-directional-motion.png`, `mythic-v3-ten-heroes.png`, `mythic-animation-skills.png`, `mythic-animation-ultimate.png`. Cache and pool bounds are checked; this is not a physical-phone FPS benchmark.

Release validation on Node 22.23.4 / Chrome: fresh unpack, lint, rewards guard and one complete `npm.cmd test` run passed (54 suites plus website checks). All twelve atlases also passed the RGBA/nonempty/edge-padding validator. Directional motion, ten-hero Adventure and skill/ultimate renderings were visually inspected. The final warm-cache sample used 1.1 ms for 1,000 lookups with zero canvas allocations; it does not measure whole-game FPS. Logs: `tests/out/mythic-v3-{final-build,lint,rewards,tests,motion}.log`. Optional bigint native bindings fell back to JavaScript, as in prior runs; no real wallet or external transaction was used.
