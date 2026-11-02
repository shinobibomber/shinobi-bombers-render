# Shared HD hero presentation

The eight identities and their ID-to-model mapping stay the same. Heroes, roster,
Home and Fusion portraits reuse `../reveal-design/reveal-models-hd.png` through the
existing single `RevealModels` loader. Portraits sample the 550px source crops
directly into display canvases sized for the viewport, capped at DPR 2.

`hero-directions-hd.png` supplies right-facing and rear views of these same eight
models for Adventure locomotion. It is a derivative illustration generated with
the built-in imagegen tool, not recovered detail from the tiny original sprites.
Original artwork and attack/effect sheets remain in the repository as fallbacks.

## Provenance

- Reference: `reveal-design/reveal-models-hd.png`; its original derivation is recorded
  in `../reveal-design/ARTWORK.md`.
- Saved asset: `player-models/hero-directions-hd.png`, 1254 x 1254, transparent PNG.
- Built-in output: `exec-6e606cc6-acaf-41f3-859e-79912dd795a5.png`.
- Rows: side Fire / Shadow / Storm / Earth; rear of those four;
  side Ice / Poison / Lightning / Spirit; rear of those four.
- Exact silhouette rectangles are measured in `hero-motion.js`. Equal grid crops
  are unsuitable because the atlas rows have different heights.

Generation prompt (built-in tool, transparent background enabled):

> Use case: identity-preserve. Game directional sprite atlas for Shinobi Bombers.
> Reference image is the exact eight established full-body characters; preserve
> faces/hair/colors/costumes/proportions. Create their RIGHT SIDE and REAR standing
> views as one transparent production atlas. Layout EXACTLY 4 columns and 4 rows,
> 16 separate figures in uniform cells. Row 1: right-facing Fire white hair red
> scarf, Shadow purple ponytail, Storm dark blue hair blue scarf, Earth brown hair
> red scarf. Row 2: REAR views of those same four in same order, facing away, no
> faces visible. Row 3: right-facing Ice white blue hair blue scarf, Poison green
> hair, Lightning golden ponytail, Spirit lavender cat ears. Row 4: REAR views of
> those four in same order. Full body including feet, consistent chibi proportions
> same as reference. Right-facing means face points to the right edge, not front.
> Rear heads fully from behind. Arms rest, slight natural leg separation for
> walking rig. Preserve exact costume, hair length, masked status, scarf and
> distinctive identity. No new weapons, objects or powers. Clean sharp anime
> illustration linework suitable for downsampling to 48-80 pixel-tall game actors.
> Real alpha transparent background, NO glow, aura, shadows, smoke, effects,
> colored matte or checkerboard. NO text, labels, borders, logos, grids, floor.
> Generous fully transparent gutters: each model including hair/ribbons fits
> inside own cell with at least 10% margin on all sides, no overlap. Keep isolated
> silhouettes with opaque black costumes, no alpha holes or stray pixels.
> Request large 2048x2048 image.

The actual output is 1254px; runtime coordinates use that measured size, not the
requested size. No original sprites or PNGs were overwritten.

## Runtime limits

Direction artwork loads lazily on visible gameplay, outside login/loading readiness.
Missing or invalid optional artwork falls back to native directional sprites.
Only idle/walk/run presentation uses HD bodies; native attacks, skills, hurt and
victory clips retain their original logic and artwork.

Source silhouettes are cleaned once per direction/model in resumable idle tasks;
tiny disconnected alpha flecks are removed without keying out dark clothing.
Each cleanup yields between chunks instead of running an entire flood fill in
one callback. Locomotion uses a small alternating leg shift driven by the native movement phase.
The world frame cache is capped at 216 surfaces of 160 x 200 (~27 MiB), independent
of collection size; this is the base-cache limit, separate from the existing aura
and action caches. Portrait caches use WeakMaps attached to their canvas nodes.
No image readback or full-resolution processing runs in a warmed render frame.
Reduced motion uses a still pose, and hidden tabs pause optional preparation.

Run `npm run build:local`, then `npm test`. Relevant suites are `hero-portraits.cjs`,
`hero-motion.cjs`, `adventure-rendering.cjs` and `render-performance.cjs` under `tests/`.
Run `npm start` and open `http://localhost:10000/play/` to play with the normal wallet
flow; tests use isolated wallet/API fixtures and never execute real transactions.
