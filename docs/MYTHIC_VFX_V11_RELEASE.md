# Mythic poster VFX — Beta release

The 2026-11-09 request to deploy to the test server approves the previously
reviewed poster recreation for Beta Adventure and Boss Hunt. This release uses
the exact reviewed PNG bytes, with 8/8/10/12 frames and 1000/1200/1500/2000 ms
timelines. The runtime reads the four-column 512px atlases, blends premultiplied
alpha, and positions ground effects at their authored anchor. Crescent slashes
rotate around their airborne center to follow the native attack direction.

The earlier pending rotation fix is included: every native attack can advance
the per-hero cosmetic sequence in both modes, independent cooldowns remain
12/18/24/30 seconds, and the whole effect survives short attack/hit labels.
The native combat system still owns damage, chakra and rewards. Character
atlases, aura, rarity metadata, SR rewards and gameplay economics are preserved.

## Provenance and limits

`mythic-hero/tools/promote-poster-vfx.cjs` verifies and copies the eight reviewed
ground/front sheets into `assets/skills/poster-v11/`, without resampling or
regeneration. `production-v11.json` and `animations.json` declare dimensions,
anchors, durations, source hashes and transparent sheet paths. The four combined
review sheets remain available in the local lab.

This is a faithful recreation, not original production sprite art or an exact
poster extraction. It uses four generated transparent masters, cleaned reusable
poster elements, Canvas deformation and interpolation. Fine dragon scales,
particle paths and intermediate poses differ from the composite reference.
See `dev-vfx-lab/recreation/README.md` for the original review and limitations.

## Release checks

- `mythic-poster-release.cjs`: eight packaged sheet hashes, all 76 ground/front
  layer frames pixel-equal to the reviewed renderer, and opaque eclipse blending.
- `mythic-completion.cjs`: 38 distinct stages, RGBA margins and original character
  hashes; `mythic-mode-rotation.cjs` and `mythic-skill-rotation.cjs`: real native
  Adventure/Hunt actions, full effect lifetime and unchanged damage/energy.
- Full build uses an isolated PGlite schema validation locally. No external
  database is used by tests. The standard Render build remains unchanged.
- The developer VFX lab remains loopback-only and is unavailable on Render.

The original review preservation baseline remains intact. The release override
file pins only the nine runtime, test and generated files intentionally changed
for this integration. Other protected files must still match the earlier review.

Deploy target: `shinobi-bombers-beta`, Render `srv-dbib5q0m7kps73cddr90`, Git branch
`main`. The production `live` branch is outside this release.
