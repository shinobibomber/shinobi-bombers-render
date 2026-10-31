# V3 visual animation boundary

This module extends the existing Canvas renderer. It does not replace the simulation, hero ID mapping, wallet, inventory, server reward logic or encounter rules.

## Available now

- `inventory.json` records the **eight actual active hero models**, six existing bosses and their real cell counts. It separately lists all twelve canonical V3 models as missing production frames with no inferred identity mapping.
- `animation-contract.js` provides a pure production-frame contract, RGBA transparency inspection, directional selection, paused clock and frame sampling. Animation metadata can contain visual cues, not damage or rewards.
- `v3-animation.js` preserves the stable existing model identities and exposes rarity and element separately through `V3Animation.describeHero(hero)`.
- Genin's existing blue effect is converted to neutral silver/white **without changing character-body pixels**. The original source PNG stays intact.
- Aura quality follows `shinobi-v3-quality` and the shared `shinobi-graphics-quality` event. `off` removes the aura, `low` uses a lightweight procedural static circle, and `medium`/`high` retain the current masked source effect. These are not newly authored animation frame loops. Reduced motion holds the developer preview on one pose.
- The developer asset studio previews actual legacy Hero/Boss cells, directions, rank, quality, frame scrubbing, pause/play and feet alignment. It labels single-pose actions and missing production art accurately.

The existing eight-model action sets and static aura artwork remain compatibility assets derived from opaque presentation sheets. They are not reclassified as clean-alpha production sprites.

## Run and inspect

From the repository root:

```powershell
node v3-animation/contract.test.cjs
node apply-v3-animation.cjs
```

`unpack.cjs` should apply `applyV3Animation()` after the existing player, animation and tier-aura helpers. The helper copies the browser module assets and adds one guarded script marker; it can be reapplied safely.

On a running game with its normal assets loaded:

```javascript
await V3Animation.ready;
V3Animation.openStudio();
V3Animation.describeHero(S.h[0]);
```

Opening/closing the studio preserves the current menu. Its selected model is a preview; it never creates an owned Hero or modifies a wallet/profile.

## Validate future artist-supplied frames

`production-frame-template.json` is a contract example. Its listed image files are intentionally absent. Supply real frame files and a real manifest, then run:

```powershell
node v3-animation/validate-production-assets.cjs path/to/animation_manifest.json
```

The CLI needs only Node built-ins. It validates PNG chunk checksums, decodes 8-bit non-interlaced RGBA pixels, confirms actual fully transparent pixels, and checks paths, fixed canvas dimensions, anchors, atlas bounds, clip directions and FPS. Opaque images and painted checkerboards fail the transparency contract. It cannot prove costume continuity, absence of text or artistic quality: an explicit manual art review is still required.

A same-origin package can also be loaded into memory for validation:

```javascript
const candidate = await V3Animation.loadProductionPackage(manifest, '/assets/heroes/');
console.log(candidate.validation, candidate.identityMapped);
```

Loading validates; it **does not activate a new identity or change live characters**. Canonical Hayate and the other eleven V3 identities need an approved mapping/migration before activation. No file uploader or texture URL may request a private key or wallet signature.

## Missing work

The twelve canonical Hero production sequences, directional action art, six multi-frame boss action sets and five layered authored rarity loops remain absent. See `releases/V3-ANIMATION-ASSET-AUDIT.md` in the workspace for the measured reference inventory. Existing combat timing, hitboxes, damage and rewards remain the authority; future animation events must stay cosmetic.
