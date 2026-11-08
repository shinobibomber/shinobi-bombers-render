> Superseded for rarity display, testing cooldowns and active atlases by [MYTHIC_COMPLETION_LOCAL.md](MYTHIC_COMPLETION_LOCAL.md). The following is the earlier review history.

# Tsukiyomi automatic combat V2 — local review

Branch: `review/mythic-auto-combat-v2-local-2026-11-08`. No push or deployment is authorized.
Base: `d9ca4d5` (the previous review branch, including the disabled-by-default Legacy Pass).
The original checkout and production `live` branch are untouched. Before a Beta release,
review the branch base explicitly; do not accidentally publish other pending features.

## Implemented behavior

One First Generation Tsukiyomi model, Lunar / Celestial / Void identity and seven-star
presentation are shared by Mythic NFTs. NFT mint IDs and ownership stay individual.
The existing rank remains **5**, not a new rank or a save-data migration. Existing stats,
seven permanent perks, training, inventory, ownership and economic rules are unchanged.
The latest specification restores seven display stars in Mythic details only; ordinary
rarity labels remain unchanged.

The existing automatic visual rotation is refactored, not duplicated. An individual hero
cycles **Basic → Dragon Slash → Basic → Void Shuriken → Basic → Raijin Field → Basic →
Mythic Dragon Ascension**. Each signature skill has a stable existing identifier, its own
definition, trigger, enable setting and cooldown timestamp. An unavailable skill can be
skipped for another eligible visual or a basic attack. Nothing waits for a visual cooldown.
The ultimate requires at least eight accepted native actions in this presentation cycle.

| Ability | Stable ID | Logical frames | Gameplay effect |
| --- | --- | ---: | --- |
| Basic melee | `ATTACK` | 6 | Existing native attack only |
| Basic ranged | `RANGED_ATTACK` | 6 | Existing native attack only |
| Dragon Slash | `dragon_slash` | 8 | Cosmetic |
| Void Shuriken | `void_shuriken` | 8 | Cosmetic |
| Raijin Field | `raijin_field` | 10 | Cosmetic; area damage disabled |
| Mythic Dragon Ascension | `mythic_dragon_ascension` | 12 | Cosmetic; additional ultimate damage disabled |

**One attack = trained Hero Power damage = one chakra. Skill VFX add zero damage,
zero attacks, zero chakra cost and zero rewards.** Decorative volley count is unchanged.
Basic ranged projectiles use a cached celestial glyph instead of selecting another skill
during drawing. Basic melee retains the violet crescent. Independent signature states,
native projectile travel, impact timing and existing tile/wall rules are preserved.

Configure the shared definitions and trigger conditions in `mythic-hero/automatic-skills.js`;
`tools/build-runtime.cjs` exports them as `automaticSkills` in the runtime manifest.
Each skill accepts `enabled` and an independent `cooldownMs` (null or 0–86,400,000 ms).
**Null means no additional cosmetic cooldown; native attack timing remains in force.**
No final gameplay cooldown values have been invented. Dragon Slash can decorate an
already authorized ranged attack (`cosmeticOnRanged`), because Adventure and Hunt use
native projectiles. Disabling this option requires an actual melee-eligible event instead;
it never extends the native attack's range or creates a separate melee hit.

## Authority boundary and replay handling

Adventure observes successful native projectile creation only after the existing deployed
team gate, target selection and one-chakra consumption. The adapter additionally checks
wallet ownership, deployment, battle eligibility, target tile and native range. Hunt passes
the existing server-issued entry/hero contract: matching hero, valid time window, attack
ordinal, available energy and native attack schedule. Seven decorative shots reuse the
same per-action choice and impact metadata. Visual callbacks never resolve a hit.

The existing Adventure server validates cumulative action counts, rate/Power/chakra
budgets and rewards; it does **not** issue a signed receipt for every spatial attack or
simulate the online browser map. This update preserves that boundary. It does not claim
new per-target server authorization or a server-authoritative area skill system. Hunt
damage continues to be computed and limited by its existing server contract. No new
skill-activation API or client-supplied damage field is trusted by the backend.

Selection is keyed by wallet + permanent hero ID, with mode/stream/ordinal replay guards.
Rendering cannot advance rotation. Immutable WeakMap projectile choices survive visual
cleanup. Scene/visibility resets clear transient animation state and pools, not skill
cooldowns. Bounded sessionStorage persists cosmetic position, timestamps and recent
action ordinals through reconnect/reload in that browser tab; writes coalesce for 250 ms
and flush on page hide. Storage failure falls back to memory. This is **presentation
state**, not a security credential or server cooldown. Cross-device/global active gameplay
cooldowns would require a separate server implementation before enabling damaging skills.

## Character assets and visual limits

`reference/latest-animation-v2.png` preserves the supplied **1536×1024 composite**.
It is not a transparent production atlas and is not loaded as an in-game sprite. The
19 existing isolated character/aura PNG files are unchanged byte-for-byte; hashes are in
`mythic-hero/preservation-v2.json` and checked by the automatic-skill regression suite.
The approved permanent aura renderer and layers are not redesigned.

The playable fallback remains the existing four approved 128×128 views with articulated
limb animation. Four new RGBA ranged-attack atlases contain six frames per direction,
baked from those same views. They are rig-generated frames, not independently drawn
frames from the latest sheet. Existing walk/run/melee atlases are retained. Idle samples
four logical stages from the existing eight-cell atlas; defeat and victory now have six
logical stages, with unchanged clip durations. All character pivots remain (64,124).
The native hero lifecycle uses chakra exhaustion and rest. Hurt/defeat retain the existing
cosmetic integration hooks; their previews do not imply a newly implemented hero HP system.

The existing reference-resolution VFX and interpolation are reused with the requested
skill names; labels are not painted into the effects. This does not upgrade the original
poster art into HD production VFX. Old extracted files remain for compatibility/provenance.

Still required for exact production-art acceptance:

| Isolated transparent character artwork | Frames per supported direction |
| --- | ---: |
| Idle | 4 |
| Walk / Run | 8 / 8 |
| Melee / Ranged | 6 / 6 |
| Hurt / Defeat | 4 / 6 |
| Bomb Place / Victory | 6 / 6 |

Supply 128×128 RGBA cells/atlases for front, left, right and back, aligned to (64,124),
without text, panel edges, glow backgrounds or clipped weapons. Supply clean standalone
Dragon Slash (8), Void Shuriken (8), Raijin Field (10, separate ground/pillars) and Dragon
Ascension (12) VFX drawings. Do not replace or recolor the approved permanent aura.
The manifest's `characterReference.productionFramesAvailable` deliberately remains false.

## UI and performance

The existing Collection detail panel lists both basic attacks, the three signatures and
the ultimate with icons. Selecting one opens a cosmetic preview with automatic activation,
cooldown status and the combat formula. There are no mandatory gameplay skill buttons.
Preview loops stop when closed or detached and cannot apply combat/economic effects.

Shared lazy textures, cached body/effect frames and existing 48-slot effect pool remain
bounded (12 slots at low quality). Cinematic Adventure dragons are limited to two at
standard quality and one at low quality. Offscreen/hidden/off settings skip effects.
Hunt samples the same animation controller, while native scheduled attacks remain
independent of animation duration. Only current Hunt team members use Hunt animation
sampling; other Mythics retain their Adventure movement. The current Hunt formation
faces its guardian to the right. Hunt impact VFX fit the existing 0.8-second impact window;
Adventure/Collection previews use the manifest clip duration. No frame-based attack/damage callbacks were added.
Browser timing tests and emulated phone rendering are not physical-device FPS certification.

## Local preview and verification

Use Node 22 in this worktree:

```powershell
cd D:\Projects\Shinobi-Bombers-Development\tmp\training-shards-beta
npm run build:local
npm run lint
npm run typecheck
npm run check:rewards
npm test
node mythic-hero/tools/preview.cjs
```

The fixture preview uses a local simulated wallet/API; no real wallet, mint or transfer.
Open Heroes, select Tsukiyomi and choose an ability for the read-only animation preview.
For the existing developer VFX lab: `node dev-vfx-lab/preview.cjs`. It remains loopback-only
and is not public navigation. Do not set production variables to enable this lab.

Validation evidence and remaining findings are recorded in
`tests/out/mythic-auto-production-build-final.log`, `mythic-auto-tests-final.log`,
`mythic-auto-tests-resumed.log`, `mythic-auto-visual-final.log`, `mythic-auto-peak-check.log`,
`mythic-auto-lint.log`, `mythic-auto-typecheck.log`, the native-results
JSON, local HTTP report, and the four `mythic-auto-*` screenshots. The production build's
database initialization is tested against disposable PGlite via an ignored local preload,
not against Render/PostgreSQL production. No live database migration was performed.

### Actual results (Node 22.23.4)

| Check | Result |
| --- | --- |
| Production build, including schema initialization in disposable PGlite | Passed |
| Lint and TypeScript | Passed |
| Reward guard: 48 teams / six ranks / trained stats / replay / sync cadence | Passed |
| Registered game regression suites | All 71 covered and passed across the serialized run and resumed tail |
| Website checks | All 20 passed |
| Late Hunt facing/team-scope fix | Eleven affected suites re-run and passed |
| Native Adventure attacks | 16 actions: exact Power damage, one chakra each, no duplicate impacts |
| Native paid-fixture Hunt | Eight-action preferred rotation; decorative damage zero; faces guardian; non-Hunt movement preserved |
| Cinematic effect limits | Three Mythics: at most two standard / one low / zero off |
| Motion/expressions | 20 rig atlases / 144 distinct cells; 20 controller states; four directions; no warm body-frame allocations |
| VFX | All four rendered; clean transparent margins/endpoints; no warm canvas allocation/readback in the benchmark |
| Character / aura preservation | 19 approved PNGs unchanged byte-for-byte |
| Local HTTP | Health, game, manifest and scripts returned 200; runtime scripts match source hashes |

The first parallel test invocation timed out in the non-Mythic Sensei fixture. The same
unchanged suite passed alone and in the serialized run. The serialized runner then found
an old atlas filename parser which interpreted `ranged_attack_front` as direction `attack`;
it now takes the final filename component. The new cinematic-cap fixture also needed to
clear effects left by its preceding preview exercise. Its exact cap assertions remain.
After these test fixes, the remaining 17 registered suites passed. No suite was removed,
and no financial/combat guard was weakened. The complete 71-suite coverage is assembled
from the 54 passing prefix suites and 17 passing resumed suites, rather than described
as a single uninterrupted green `npm test` invocation.

The final Hunt scope/facing correction was then rebuilt through its source apply step
and rechecked against the affected eleven suites, the reward guard and HTTP hashes.
Screenshots were inspected for Collection desktop/phone, the ability preview, Adventure,
and the real Hunt Ultimate impact. Physical-device FPS and authenticated public Beta
gameplay are not verified by these local fixtures.

## Beta connectivity inspection (November 8, 2026)

Read-only Render inspection in the owner's confirmed Kyle workspace found Beta service
`srv-dbib5q0m7kps73cddr90`, branch `main`, auto-deploy on commit, free plan, Singapore,
one instance, and no configured HTTP health-check path. Commands remain
`npm ci && npm run build` and `npm start`. The existing deploy
`dep-dbo8marncjis73a6oigg` reports live at commit `645f2f9`; it is not this new code.
Public `/play/` returned HTTP 200 at 15:33:57 UTC. A bounded recent timeout/crash/error
log search returned no matches. This does not establish the cause of prior intermittent
timeouts or verify authenticated public gameplay. No settings/cache/env/restart changes
were made. Default TCP health checks do not replace public HTTP/gameplay verification.
Later public GET checks also returned 200 for `/play/` (0.242 s) and `/healthz` (0.119 s).
References: [Render deploys](https://render.com/docs/deploys),
[Render health checks](https://render.com/docs/health-checks).

Before any approved Beta release: verify the intended changes and branch base, publish
only to the approved test branch, monitor the exact new deploy, GET `/healthz` and
`/play/`, fetch presentationVersion 7 and automatic skill version 2, then verify actual
Adventure/Hunt loading with an authorized test account. Never infer deployment health
from a build result alone. Production remains excluded.

## Changed files

- Build hooks: `apply-mythic-hero.cjs`, `apply-mythic-skill-rotation.cjs`.
- Controllers/renderers: `mythic-hero/{automatic-skills,animation-controller,animation-runtime,mythic-hero,articulated-sprite}.js`.
- Metadata: `mythic-hero/assets/metadata/{animations,tsukiyomi,rig-v3,skills-v6}.json`.
- Generators: `mythic-hero/tools/{build-runtime,bake-motion,build-skill-v6}.cjs`.
- New ranged art: `mythic-hero/assets/animations/rig-v3/ranged_attack_{front,left,right,back}.png`.
- Provenance: `mythic-hero/reference/latest-animation-v2.png`, `mythic-hero/preservation-v2.json`.
- Collection: `website-design/website-design.js`, `website-design/website-design.css`.
- Tests: `tests/mythic-automatic-skills.cjs`, `mythic-skill-rotation.cjs`, `mythic-animation-controller.cjs`,
  `mythic-animation.cjs`, `mythic-motion-v3.cjs`, `mythic-hero-assets.cjs`, `mythic-hero.cjs`, `tests/run.cjs`.
- Notes: this file, `MYTHIC_AUTOMATIC_COMBAT_V2_PATCH_NOTES.txt`, `PROJECT_STATUS.md`, `PATCH_NOTES.md`.

No backend combat, ownership, wallet, reward, tokenomics or database schema source changed.
