> Beta release authorization: Owner authorized the Mythic release to the Beta test server only. Release branch release/mythic-beta-2026-11-09 starts at beta main 645f2f9 and contains only the reviewed Mythic V2/completion changes. Legacy Pass, its schema, finance hooks, UI and unrelated offline handoff fix are excluded. No backend combat, NFT, economy, service settings or production branch changes. Rebuild and rerun the Beta suites before pushing main; verify an actual HTTP response and presentationVersion 9 / 12-18-24-30 second cooldown markers after Render rollout.

> Beta release validation (Nov 9, 2026): production build and isolated database schema initialization passed under Node 22; lint passed; npm test passed all 68 game suites and 20 website checks with two isolated workers. Local HTTP checks returned 200 for health, game, metadata, three scripts and two new PNG assets. No real wallet or external transaction was executed. Public deployment verification follows the authorized push.

Historical local review report follows; its Legacy Pass dependency does not apply to this isolated release.

# Tsukiyomi — starless Mythic / testing cooldowns / clean atlases

November 9, 2026 (Asia/Singapore). **Local review only; no push or deployment.**
Worktree: `D:\Projects\Shinobi-Bombers-Development\tmp\training-shards-beta`.
Branch: `review/mythic-completion-local-2026-11-09`, based on local review commit `5c95916`.
This branch includes the earlier automatic-animation work and disabled Legacy Pass review;
review that dependency chain before any future Beta integration.

## What changed

- Tsukiyomi's rating row and rating label are removed. The panel displays **MYTHIC**,
  **TSUKIYOMI** and **FIRST GENERATION NFT**, with the existing colors/borders/art.
  The Adventure rarity badge also displays MYTHIC. Other rarities are unchanged.
- The client presentation metadata no longer exports a `stars` field. Server-owned hero
  records, NFT attributes, unique mints, ownership, stats, seven perks, training and saves
  are unchanged. No on-chain metadata was edited.
- The existing automatic controller now defaults to the owner's approved Beta values:

| Skill | Independent cooldown | VFX stages |
| --- | ---: | ---: |
| Dragon Slash | 12 seconds | 8 |
| Void Shuriken | 18 seconds | 8 |
| Raijin Field | 24 seconds | 10 |
| Mythic Dragon Ascension | 30 seconds | 12 |

These are configurable testing values, not permanent balance decisions. Edit the shared
definitions in `mythic-hero/automatic-skills.js`, then regenerate the runtime metadata.
The controller honors a configured override and freezes its resulting rule registry.
Collection lists each testing cooldown and offers read-only previews.

The preferred sequence remains Basic → Dragon Slash → Basic → Void Shuriken → Basic →
Raijin Field → Basic → Ultimate. A cooling or otherwise unavailable skill falls back to
another eligible visual or a basic attack. Native attacks continue at their original rate.
Cooldown timestamps remain independent for each wallet/hero and survive tab-session
reconnection; rendering, decorative projectiles and repeated receipts cannot advance them.

**1 actual attack = trained Hero Power damage = exactly 1 chakra.** All four signature
effects are cosmetic and add zero damage, attacks, chakra cost or Ryo. No unapproved area
damage, ultimate multiplier or map clear is enabled. Dragon Slash can decorate a native
authorized ranged shot when the existing `cosmeticOnRanged` option permits it; this never
grants a new melee action or changes reach. Targeting, walls, Boss Hunt contracts,
reward budgets, fees and native timing are preserved.

## Actual assets produced

`mythic-hero/tools/bake-production.cjs` renders existing approved textures through the
existing rig and native VFX geometry. It does not crop frames from the poster or generate
a replacement character. The runtime uses the new atlases rather than skinning each of
the nine base states on a cache miss.

| Base animation | Frames per direction | Four-direction total |
| --- | ---: | ---: |
| Idle | 4 | 16 |
| Walk | 8 | 32 |
| Run | 8 | 32 |
| Melee attack | 6 | 24 |
| Ranged attack | 6 | 24 |
| Hurt | 4 | 16 |
| Defeat | 6 | 24 |
| Bomb place | 6 | 24 |
| Victory | 6 | 24 |
| **Total** | | **216** |

All 36 character atlases use 128×128 RGBA cells with (64,124) pivots, covering front,
left, right and back. Idle retains the approved eight-cell rig's blink/breathing by
sampling its 0/2/4/6 stages into four output cells. The original textures and rig geometry
are preserved. Existing emotes, skill-body states and lifecycle hooks remain compatible.
Hurt/defeat use the existing cosmetic hooks; this update does not invent hero HP/death rules.

Eight separate 320×320-cell VFX atlases provide 38 combined ground/foreground stages.
They use engine-drawn crescents, celestial shuriken, sigils and lightning, plus the existing
isolated violet dragon texture. The permanent aura is never baked into these effects.
Each stage has visible combined content and transparent margins; the intro/outro may
intentionally use only its ground plane. The new `clean-effects.js` renderer blends cached
atlas cells, avoiding per-frame path/gradient/particle construction. Low quality skips
interpolation. Existing 48/12 reusable-effect limits and 2/1 cinematic-dragon limits remain.

The new character PNGs total 3,977,885 bytes; VFX PNGs total 1,063,120 bytes. Assets are
loaded once on demand and shared across Mythic heroes. Original legacy files remain for
compatibility/provenance but are not the active base animation/VFX atlas set.

`assets/metadata/production-v9.json` lists every generated file, frame count, pivot,
source hash and output hash. `assets/metadata/animations.json` is presentation version 9.
The original **19 character/aura PNG files** still match `preservation-v2.json` byte-for-byte.
Silver-white hair/ponytail, violet eyes, mask, crescent ornament, katana, armor and chibi
proportions therefore retain the existing shared First Generation identity.

## Precise remaining art distinction

The software now has working, validated rig-baked atlases for all 216 base cells and clean
engine-baked VFX for all four abilities. These are real transparent runtime assets.

**The supplied poster still does not supply independently drawn isolated animation poses.**
For exact artist-authored reproduction of its movements, the missing source art is the
216 isolated character poses in the table above (or corresponding transparent atlases),
matching all four views and (64,124) pivots. No alternate model was substituted. The runtime
manifest deliberately retains `characterReference.productionFramesAvailable: false` for
that missing hand-drawn reference source. This does not describe the newly baked runtime
atlases as absent. No new aura layers or variants are required or created.

## Validation performed

Node 22.23.4, isolated fixtures and Chrome; no real wallet or live transaction:

| Check | Actual result |
| --- | --- |
| `npm run build` | Passed; database initialization used disposable PGlite |
| `npm run lint` / `npm run typecheck` | Passed |
| Build reward guard | Passed; 48 teams, six ranks, trained stats, finite chakra and replay/sync protections |
| `npm test` | **All 72 game suites + 20 website checks passed**, exit 0 |
| Character/VFX validator | All 36 character / 8 VFX atlases, exact counts, alpha/margins/checksums passed |
| Cooldowns | 12/18/24/30-second defaults, independent intervals, fallback, replay and reconnect restoration passed |
| Native Adventure | 16 attacks: 288 total damage at Power 18, one chakra each; second rapid cycle falls back during cooldowns |
| Native paid-fixture Hunt | Automatic four-skill sequence, decorative damage zero, correct facing and non-Hunt movement preserved |
| Desktop/phone | Collection, previews, all 20 states, Adventure/Hunt and four effects rendered; screenshots inspected |
| Runtime performance | Warm VFX benchmark: zero canvas allocations/readbacks; bounded pools/cache and ten-hero checks passed |
| Local HTTP | Health, game, metadata, three runtime scripts and sample new PNGs returned 200; scripts match source hashes |

Logs: `tests/out/mythic-completion-{build,lint,types,tests,focused}.log`.
HTTP evidence: `tests/out/mythic-completion-http.json`.
New dedicated suite: `tests/mythic-completion.cjs`.
Screenshots: `tests/out/mythic-{heroes,phone,animation-states,animation-skills}.png`,
`mythic-auto-{ability-desktop,ability-phone,adventure,hunt}.png`, and `v6-*.png` (the retained
developer-lab filenames now contain the active clean-atlas renderer).
Physical-device FPS is unverified; phone checks use browser emulation.

Existing authority boundary: Adventure's backend validates cumulative action/Power/rate/
chakra/reward budgets rather than issuing signed receipts for each spatial hit. Hunt
uses the existing server contract. Skill cooldowns are cosmetic presentation state, not
financial authorization or a new cross-device damaging-skill system. No extra gameplay
effect can be enabled merely by changing a client cooldown.

## Local preview / regeneration

```powershell
cd D:\Projects\Shinobi-Bombers-Development\tmp\training-shards-beta
# Use Node 22 and the installed project/test dependencies.
node mythic-hero/tools/preview.cjs
# Heroes Collection also has six cosmetic ability previews.
```

To regenerate the new assets after an approved rig/VFX source change:

```powershell
node mythic-hero/tools/bake-production.cjs
node mythic-hero/tools/build-runtime.cjs
node unpack.cjs
node tests/mythic-completion.cjs
```

The baker needs developer Chrome/Playwright/Sharp. Render builds consume the checked-in
PNG files and metadata; they do not run Chrome or the baker. Do not edit generated `app/`.

## Beta readiness and observed timeout

Local implementation/build/gameplay checks pass. **Public Beta availability is unresolved.**
Read-only inspection in the owner's confirmed Kyle workspace found Beta service
`srv-dbib5q0m7kps73cddr90`, branch `main`, auto-deploy on commit, free plan, no configured
HTTP health-check path, and `not_suspended`. The last available deploy event reported a
successful existing deploy at 14:47 UTC on November 8; this new code is not deployed.

On November 9 Singapore time, both public `/play/` and `/healthz` requests timed out after
30 seconds with no response body. A further 15-second health request reached
216.24.57.18, completed TCP in 0.073 s and TLS in 0.121 s, but received no HTTP first byte.
These are observed timeouts from this environment, not HTTP error status responses.
The recent application-log query was empty and the available service events did not
explain the cause. Render's live status alone therefore does not establish healthy HTTP
availability. No cache clear, restart, deploy, environment, scaling or service change ran.

Before any approved Beta release, resolve/verify public availability, review the complete
branch/dependency chain, monitor the exact approved deploy and confirm real successful
HTTP responses and authenticated Adventure/Hunt behavior. No production financial,
wallet, NFT, database or reward-pool operation is authorized by this local implementation.

## Changed files

The exact list is in [MYTHIC_COMPLETION_FILES.txt](MYTHIC_COMPLETION_FILES.txt), including
all generated PNGs. Main source changes are the shared skill registry, runtime adapter,
Mythic build hooks, `build-runtime.cjs`, the new baker/atlas renderer and Collection CSS/JS.
Tests cover the new defaults/presentation, new assets, existing animations and native
rotation. No backend combat, NFT ownership, treasury, economy or schema source changed.
