# V3 missing production assets

1 November 2026. The supplied pack is a reference and prompt collection. All 144 packaged checksums were validated after extraction into a separate reference directory. It is not a complete production sprite/tile source package.

## Available compatibility artwork

- Eight active Hero identities: Fire, Shadow, Storm, Earth, Ice, Poison, Lightning Kunoichi and Spirit. The stable existing mapping is preserved. The historical inline catalog is superseded and must not be mistaken for twelve verified canonical V3 identities.
- Existing player direction cells: 96. Existing character-animation metadata: 363 actor cells and 265 effect cells, with uneven action coverage.
- Six existing bosses: Akuma, Yuki Onna, Raijin, Daichi Golem, Orochi and Shadow Emperor. Current action metadata has one example cell per listed action; these are sample poses.
- Existing five-tier aura source pictures, masked/cached at runtime. White Genin is a cosmetic adaptation of the aura alone.

These source sheets are opaque presentation artwork. Runtime background masking/cropping is a compatibility technique, not proof of authored, clean-alpha production frames or smooth action continuity.

## Required asset delivery

| Asset | Missing deliverable | Integration constraint |
| --- | --- | --- |
| Twelve canonical Heroes | Artist-approved identities and explicit stable mapping, clean-alpha idle and four-direction movement, bomb placement, attack, skill, hurt, defeat and optional victory/run frames. | Do not change modulo/catalog mapping or recolor one identity into twelve without an approved migration. |
| Hero directional actions | Consistent asymmetric left/right poses and back-view action sequences. Several current actions have one body cell or fallback direction. | Label fallback/unsupported actions accurately. |
| Six bosses | Genuine multi-frame clean-alpha action/direction sequences, consistent pivots, feet baseline and canvas dimensions. | Keep frame events cosmetic; damage/rewards remain owned by the existing simulation. |
| Five rarity auras | Independent transparent layer sequences for white/green/blue/purple/gold with complete loops and declared frame order/FPS. | Rarity and element must remain separate; no rank above Legend. |
| Elemental VFX | Independent transparent canonical effects with bounds, anchors and blend guidance. | No VFX damage or reward callback. |
| Eight Adventure environments | Modular floor/wall/prop atlases or individual tiles corresponding to the native 31×17 grid, plus decorative edge layers. | Full illustrated boards are not collision grids or playable floor screenshots. |
| Final interface artwork | Production-ready separated decorative assets as needed for exact V3 card/panel/scene fidelity. | Live names, prices, counters and actions must remain semantic, data-bound UI. |

The twelve-Hero showcase and the Hayate animation reference have no fully transparent pixels. Their panel labels/backgrounds are baked into the image. Six boss concept sheets are opaque RGB boards. An alpha channel or a drawn checkerboard does not establish a valid atlas.

## Implemented import path

`v3-animation/production-frame-template.json`, `animation-contract.js` and `validate-production-assets.cjs` define and validate production packages. Validation covers declared source classification, paths, PNG structure/CRC/alpha, dimensions, frame bounds, finite anchors, supported direction/action names, frame rate and rejection of gameplay-event metadata. The browser loader and asset studio expose what is actually available. Manual visual review remains necessary for labels, halos, anatomy and frame continuity.

No new production animation frames were generated in this slice. Native-grid themed drawing is used until valid tiles are supplied; it intentionally does not reproduce a complete board screenshot as a fake map.
