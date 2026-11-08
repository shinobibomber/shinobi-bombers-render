# Tsukiyomi motion-study VFX and all-mode rotation

Local review, November 9, 2026 (Asia/Singapore). Branch
`review/mythic-vfx-rotation-local-2026-11-09`, based on Beta release `5cb01b3`.
This update has not been pushed or deployed. Production and the deployed Beta are unchanged.

## Findings and fixes

- The former basic melee renderer drew the full Dragon Slash skill artwork on ordinary
  attacks. The collection card also always said Dragon Slash. Basic melee now uses a
  separate small cached crescent; the card says "4 automatic skills".
- The selector still had melee/ranged/area trigger gates, including a ranged-only Void
  Shuriken gate. All four cosmetic presentations now work on either valid native attack
  type. Target authorization, Power, range, chakra, stamina and collision stay native.
  Raijin's appearance does not authorize area damage.
- The old fallback began at an attack-index-derived preference. The new per-hero skill
  cursor advances after a skill is actually selected and survives cooldown gaps/reloads.
  Basic attacks still alternate with eligible skills. Ultimate eligibility still requires
  at least eight accepted presentation events and the native caller's eligibility flag.
- Void Shuriken's Adventure impact began at stage 6 of 8; the Hunt effect lifetime was
  limited by its .8-second hit label. Long actor animations could also be replaced by
  the next signature. Complete pooled casts now run their own 1 / 1.2 / 1.5 / 2-second
  visual timelines, without delaying native attacks. Hunt ground/front hooks draw them
  separately from hit labels. Repeated impacts and seven decorative shots cannot add casts.

The inspected Beta Adventure adapter previously supplied `ranged:true` even for adjacent
targets. That masked some selector restrictions; the mode-specific gates alone do not
prove why any individual player's session showed one effect. The repetitive basic slash,
short effect timelines and fixed collection label are separate confirmed presentation
problems. The new tests cover both strict event modes and real native target distances.

## Reference and assets

`mythic-hero/reference/skill-motion-v10.png` preserves the supplied 1200 x 720 static
motion study. It is a composite, not an animation or an isolated transparent sprite sheet.
The replacement VFX use code-native geometry matching its key shapes:

| Existing stable skill ID | Reference effect style | Stages | Cooldown |
| --- | --- | ---: | ---: |
| dragon_slash | Dragon Crescent Gale: three crescent arcs / spectral head | 8 | 12s |
| void_shuriken | Void Eclipse Shuriken: rotating stars / eclipse rings | 8 | 18s |
| raijin_field | Thunder Chain Vortex: violet helix / bolts / gold chains | 10 | 24s |
| mythic_dragon_ascension | Mythic Dragon Dominion: violet dragon wave / gold orbits | 12 | 30s |

`motion-effects.js` is the local bake-time generator. Run:

```powershell
node mythic-hero/tools/bake-motion-vfx.cjs
node mythic-hero/tools/build-runtime.cjs
node unpack.cjs
```

The eight PNG RGBA atlases under `assets/skills/motion-v10/` contain 38 combined
effect stages, separate foreground/ground layers, transparent margins and SHA-256
provenance in `assets/metadata/production-v10.json`. Runtime presentation version is 10;
the renderer interpolates cached frames, with no live vector-path or particle generation.
The image's placeholder hero, text, borders, background and numerical star label are not
used as runtime sprites. These are newly rendered geometry animations, not pixel-exact
animated source artwork extracted from a static image.

The new transparent skill layers use normal alpha compositing so violet shapes and the
dark eclipse stay readable over bright grass tiles. The approved aura keeps its existing
renderer and blend behavior. The local four-panel inspection image is saved at
`tests/out/mythic-v10-skill-showcase.png`; it uses actual runtime effects, the original
character/aura and Adventure artwork.

The 36 approved-v9 character atlases / 216 rig frames, original body source PNGs, aura
source PNGs, NFT identities and rarity display remain unchanged. Exact separately drawn
character poses from older composite references are still unavailable; the existing
approved rig is preserved. This update does not claim new hand-drawn character sprites.

## Compatibility and safety

- Stable skill IDs and canonical ability names remain. Tooltips include reference VFX names.
- Existing version-2 cosmetic session receipts migrate to version 3. Used cooldown times,
  per-stream attack ordinals and recorded outcomes are retained; reconnects do not reset them.
- The wallet/hero-scoped cosmetic cursor is never server proof of an attack or a reward.
- Native Adventure/Boss Hunt contracts authorize attacks; this update changes rendering
  only. One action still deals Power and costs one chakra; VFX cost zero additional chakra.
- The existing 48-slot / 12-low pool, offscreen culling, effect-off/reduced-motion settings
  and two-standard / one-low simultaneous Ultimate cap remain. Expiry, map/menu transitions,
  missing heroes and Hunt end clean up visual state.
- No database schema, ownership, economy, balances, fee routing, service settings or
  Legacy Pass changes. No new public navigation or manual skill controls.

## Validation

Focused checks passed: all four skills on 64 native melee/ranged actions across four
directions; exact Power damage / one chakra; zero-chakra stop; full late-stage VFX after
basic animation interruption; no repeated-impact casts; independent cooldowns; saved
cursor migration; paid-fixture Hunt rotation with every effect rendered beyond 80%.
Completed validation:

- Production build and isolated PGlite schema initialization passed. Lint, TypeScript
  checking and the 48-team rewards guard passed. Retained logs:
  `tests/out/mythic-v10-build.log`, `mythic-v10-lint.log` and
  `mythic-v10-typecheck.log`.
- The complete serial `npm test` rerun passed all **69 game suites and 20 website
  checks**, exit code 0, under Node **26.13.0**. Evidence:
  `tests/out/mythic-v10-tests-resumed.log`.
- Seven changed-scope checks separately passed under the project's Node **22.23.4**:
  preservation, animation controller, automatic skills, atlas completion, Mythic UI,
  native skill rotation and all-mode rotation. Evidence:
  `tests/out/mythic-v10-node22.log`.
- The initial two-worker run timed out waiting for the existing Chest's Confirm
  deposit button. The full serial rerun passed that suite, including automatic
  recovery, without changing the Chest code or weakening assertions.
- Local HTTP checks returned 200 for health, game, metadata, runtime scripts and new
  assets; presentation version 10 and the 12/18/24/30-second cooldowns matched.
  Evidence: `tests/out/mythic-v10-http.json`.
- Visually inspected the four-skill showcase, actual Boss Hunt capture and phone
  ability preview. The phone preview fits its viewport; the canonical hero and aura
  remain visible. Review images: `tests/out/mythic-v10-skill-showcase.png`,
  `mythic-auto-hunt.png` and `mythic-auto-ability-phone.png`.

No real wallet or external-service transaction was executed. No push, deployment,
external database connection or service-setting change was performed for this review.

## Review scope

- Runtime: `mythic-hero/automatic-skills.js`, `animation-runtime.js`,
  `clean-effects.js`, `mythic-hero.js`, `apply-mythic-skill-rotation.cjs` and
  `website-design/website-design.js`.
- Authoring: `mythic-hero/motion-effects.js`, `tools/bake-motion-vfx.cjs`,
  `tools/build-runtime.cjs`, `reference/skill-motion-v10.png`,
  `assets/metadata/production-v10.json`, `assets/metadata/animations.json` and the
  eight `assets/skills/motion-v10/` PNGs. Paths in this item are relative to
  `mythic-hero/` unless already prefixed.
- Preview: `dev-vfx-lab/bridge.js` uses the same baked effects and canonical hero.
- Regression coverage: `tests/mythic-animation-controller.cjs`,
  `mythic-automatic-skills.cjs`, `mythic-completion.cjs`, `mythic-hero.cjs`,
  `mythic-skill-rotation.cjs`, the new `mythic-mode-rotation.cjs` and registration in
  `tests/run.cjs`. Test filenames in this item are relative to `tests/`.
- Review notes: this document, `docs/MYTHIC_VFX_V10_PATCH_NOTES.txt`,
  `PATCH_NOTES.md` and the latest `PROJECT_STATUS.md` handoff.

Generated `app/`, local logs, HTTP evidence and screenshots remain ignored build or
review outputs. The review diff contains no server, database or deployment configuration changes.

## Local preview

From this worktree, after the build, start the existing sanitized loopback preview host:

```powershell
node -e "require('./dev-vfx-lab/local-server.cjs').start().then(s=>console.log(s.url+'/vfx-lab/tsukiyomi'))"
```

Open the printed URL. The lab uses the same game assets, approved character and original
aura, with play/pause/frame-step, looping, quality, directions, dark/map backgrounds and
character/aura toggles. It does not connect a wallet or perform gameplay purchases.
The lab remains disabled on Render and Mainnet. Stop the local process with Ctrl+C.
