# V3 animation and asset audit

Audited 1 November 2026. Reference-only source: `references/Shinobi-Bombers-V3-Revised-Birthday-2026-11-01`; active repository: `releases/current-render-repository/shinobi-bombers-render-2b5bc22c0d844faae3e0086548a79da87370bf1d`. Read Design 08, 10 and 11 prompts/manifests and inspected all thirteen associated images. The pasted user request takes priority over text embedded in images.

## Actual active implementation

The game uses custom Canvas 2D and imperative JavaScript globals, with later modules wrapping the existing renderer. It does not currently use Phaser/Pixi/React for combat. `unpack.cjs` extracts a checksum-verified game archive and applies guarded source helpers. `ShinobiSprites.ready` chains all asset loading.

| System | Verified current state | Limitation |
| --- | --- | --- |
| `player-models` | **8 active models**, 96 native cells: Fire, Shadow, Storm, Earth, Ice, Poison, Lightning Kunoichi and Spirit. Four rows × three cells, fixed pivots. Stable mapping `abs(hero.id) % 8`. | Historical inline renderer knows 21 model IDs, but this adapter supersedes it. Neither is a verified 12-model Hayate roster. Changing modulo to 12 would silently change existing hero identities. |
| `character-animations` | Eight matching models, **363 actor cells and 265 effect cells**, cached and selected by existing movement/shot/victory events. Available actions differ by model. | These are runtime alpha-cleaned crops from opaque presentation sheets, not authored transparent production atlases. Back movement falls back to native player back cells. Left uses mirroring. Several attack/defeat clips have one actor cell; Shadow has no bomb-placement body frames. |
| `combat-models` | 16 enemy archetypes and six actual boss keys: `akuma`, `yuki-onna`, `raijin`, `daichi-golem`, `orochi`, `shadow-emperor`. Existing encounter labels match this cycle. | Boss action metadata contains one example cell for each idle/walk/attack/skill/hurt/defeat action; these are pose samples rather than full sequences. |
| `tier-auras` | Five effects selected from actual `hero.r`, independently of model ID. Shared 320×400 render canvas and foot anchor [160,352], bounded caches. | Five isolated **static** effect pictures from an opaque source sheet, not the requested 8/12/12/16/16 independent production frames. Genin is blue in the current manifest; V3 requests silver/white. |
| Portraits | `PlayerModels.drawPortrait` draws native source pixels once, behind a rarity effect. Heroes/reveal/roster share model identity. | Static source aura pulses in presentation code; this must not be described as full frame animation. |

No asset work should modify `think`, `boom`, damage, grid coordinates, hitboxes, chakra, rewards, timers, ownership or server transactions. Current `CharacterAnimations` observes existing functions after they run and returns draw-only textures. Boss Hunt remains the existing 90-second battle with shockwave/rage rules; animation metadata must not produce a second damage/reward event.

## Newly supplied asset verification

Alpha inventory was measured with Sharp metadata and per-channel pixel statistics, not inferred from filenames. Full results: `previews/v3-audit/reference-alpha-inventory.json`. Visual contact sheet: `previews/v3-audit/reference-animation-contact.png`.

| Reference | Actual pixels | Classification |
| --- | --- | --- |
| `akuma1.png` | 1536×1024 RGBA, contains alpha 0 | Illustrated poster with headings, palette and uneven action rows; transparency does not establish a valid atlas. |
| `akuma2.png`, `akuma3.png` | 1536×1024 RGBA, alpha is 255 everywhere | Opaque reference boards; the checkerboard in Akuma 3 is baked artwork. |
| Six boss concept sheets | 2048×2048 RGB | Opaque illustrated concepts with UI/backgrounds and a few example poses. No individual production frames. |
| Twelve-Hero four-direction reference | 2043×770 RGBA, alpha 255 everywhere | Opaque identity showcase with text, panel borders and direction labels. Not an atlas. |
| Hayate master animation/VFX reference | 1536×1024 RGBA, minimum alpha **38**, no fully transparent pixels | Illustrated action/VFX guide with text and palette; no clean alpha frame sequence. |
| V3 aura concept sheet | 1536×1024 RGBA, alpha 255 everywhere | Opaque diagram, labels and examples. Its checksum differs from the existing aura source. |
| Aura layering diagram | 743×529 RGBA, alpha 255 everywhere | UI explanation diagram only. |

All existing runtime source PNGs examined (`playermodel.png`, four animation sets, EnemyModel, BossModel and auras) are opaque RGB. The browser creates masked frame canvases; source PNG transparency is not present. Existing rendering is retained as a documented compatibility fallback, not relabeled as finished V3 production art.

## Missing production artwork

- All **12 canonical V3 Hero identities** require artist-approved, clean-alpha frame files and an explicit mapping to stable repository hero identities. Do not alias white-haired active Fire Shinobi to black-haired Hayate or recolor him into the other eleven characters.
- Per canonical Hero: actual supported idle/walk/down-left-right-up frames, bomb placement, attack, skill, hurt, defeat and optional victory/run/ultimate sequences. The listed frame counts in `ASSET_SPEC_TEMPLATE.json` are targets, not supplied assets.
- Dedicated left/right asymmetric poses and action back views are missing from the active eight-model compatibility sets.
- Each boss needs clean-alpha frame sequences for all directions and genuine multi-frame actions. Akuma's 8/12-frame attacks, 10-frame teleport and 12-frame rage/death targets are not delivered individual sprites. The other five have only concept examples in the new pack.
- Independent aura production layers and genuine per-frame loops for all five tiers, including white Genin; clean-alpha elemental VFX layers for the canonical element roster.
- Validated feet baseline, per-frame canvas consistency, source provenance, frame ordering and manual checks for labels/checkerboards/halos. PNG alpha alone cannot prove these.

## Feasible incremental implementation

1. Preserve the active eight-model identity mapping and existing combat hooks. Expose an honest manifest: compatibility sources available, canonical 12-model assets missing/unmapped.
2. Add a pure animation-contract validator and clean-alpha production-frame importer. Validate stable IDs, direction/action allowlists, finite pivots, atlas bounds, PNG dimensions, real transparency and source classification. Fail closed on poster/concept inputs and missing files.
3. Add a developer preview with available eight models, five ranks, direction/action controls and missing-asset diagnostics. Show one-cell poses accurately; never repeat a pose and claim authored motion.
4. Add shared visual-quality settings and reduced-motion handling, independent of simulation timing. Reuse the existing quality event and clocks; no extra gameplay loop or damage callbacks.
5. Convert only the existing Genin **aura** to neutral silver/white as a documented cosmetic color adaptation. Keep the body sprite unchanged. Expose model element and rarity separately; every supported model remains compatible with every rank.
6. Import future genuine frame packages incrementally, beginning with one verified Hayate idle direction; require a stable identity migration decision before making the new canonical catalog active. Then validate full motion before expanding.

## Evidence and limits

Audit commands read manifests and source hooks, measured image dimensions/alpha, counted actual cells and visually inspected contact images. No production frames were generated, no gameplay code was changed for this audit, and no wallet/account operations occurred. Pixel-perfect animation continuity and mobile runtime budgets remain implementation/test work, not claims made by this report.

## Incremental implementation completed after the audit

Added `apply-v3-animation.cjs` and `v3-animation/` containing the compatibility inventory, pure production-frame contract, built-in-only PNG validator, browser loader, separate model/element/rarity descriptor, quality adapter and developer asset studio. Updated only Genin's aura color metadata in the existing `tier-auras/manifest.json`; the source PNG and body artwork are unchanged.

The current shared renderer retains all eight stable identities. Aura OFF returns the existing body frame; LOW draws a static procedural circle; MEDIUM/HIGH retain the existing effect art. The Genin aura is neutralized to silver/white separately from the body. The new canonical twelve-model catalog remains explicitly missing/unmapped. Boss action directions are disabled in the studio where only one front sample exists. Hero side/back preview uses the three genuine native direction cells, with the fallback labeled; unsupported directional actions remain front-only.

Verified commands:

- `node v3-animation/contract.test.cjs` — passed. Checks transparent RGBA vs opaque boards, malformed metadata, paths, dimensions, anchors, frame bounds, direction/FPS rules, rejection of gameplay events, pause/resume and reduced-motion sampling.
- `node tools/test-v3-animation-browser.cjs` from the workspace — passed in isolated Chrome with a simulated ledger. Checks all 8 model × 5 rarity combinations, white Genin aura, OFF/LOW/HIGH behavior, no Hero/stat/balance mutations, persisted visual quality, studio actions/directions/pause/scrubbing, six single-pose boss previews, mobile containment and reduced motion. No real wallet signature or token operation.
- Syntax checks for the runtime, contract, validator and helper — passed.
- Helper applied twice without duplicate HTML/script markers.
- The standalone PNG parser measured both new twelve-Hero and Hayate reference boards as **zero fully transparent pixels**, matching the image audit.

Preview screenshots: `previews/v3-audit/animation-studio.png` and `animation-studio-mobile.png`. These show current compatibility art, not newly created canonical models. The parent integration must apply the new helper after existing player/animation/aura helpers and can wire `V3Animation.openStudio()` to the developer diagnostics entry.
