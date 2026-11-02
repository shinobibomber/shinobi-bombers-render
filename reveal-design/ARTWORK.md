# Reveal model artwork provenance

`reveal-models-hd.png` is a reveal-only, high-resolution derivative of the eight
established characters in `../player-models/playermodel.png`. It was made with the
built-in imagegen tool on 2026-11-02, then copied into this repository. It is a redraw,
not an enlargement claimed to recover missing original pixels. No original source
sheet, combat animation, model identity, rarity or gameplay attribute was replaced.

The output is a 1254×1254 PNG with real alpha, about 2.14 MiB. Order: Fire, Shadow,
Storm, Earth / Ice, Poison, Lightning, Spirit. The final renderer uses explicit source
rectangles to avoid neighboring silhouettes and samples each directly into the final
canvas. The original action cells were only 56–60px tall; these full-body cells are
about 550px tall. The browser loads and decodes this optional atlas once when needed.

## Initial prompt (original model sheet as edit/reference input)

> Use case: identity-preserve. Asset type: transparent game sprite atlas for Shinobi Bombers summon-result cards. EDIT/RESTORE the existing eight characters in the supplied Player Model Base reference, preserving their exact established identities. Make a high-resolution, sharp clean-line rendition of each character's FRONT full-body model from the small FRONT row; use its larger portrait directly above ONLY as detail guidance for the SAME face/hair/costume. This is a faithful resolution restoration, not a new character design. Output ONE transparent atlas, 2048 by 2048 pixels, 4 equal columns x 2 equal rows, eight separate non-overlapping standing full-body chibi models. Top row left-to-right: FIRE (white spiky hair, red scarf, forehead plate, black/red ninja clothing), SHADOW (purple high ponytail, black/purple ninja clothing), STORM (dark blue spiky hair, blue scarf, black/blue ninja clothing), EARTH (brown spiky hair, red-brown scarf, black/brown ninja clothing). Bottom row left-to-right: ICE (white/ice-blue spiky hair, blue scarf, black/blue ninja clothing), POISON (green hair with top curl, masked black/green ninja clothing), LIGHTNING (golden blonde high ponytail, mask, black/gold ninja clothing), SPIRIT (pale lavender hair, feline ears, black/lavender ninja clothing). Keep chibi proportions, same expressions, eye colors, headgear, outfits and front-facing relaxed standing poses as reference FRONT models. Show complete feet. Arms relaxed. No newly invented objects, no big bombs, no weapons not present in their FRONT model, no costume redesign. Each model centered within its own512x1024 cell, same visual height about760 pixels, with generous transparent padding around silhouette and below feet. Sharp readable eyes and crisp clothing lines. True transparent background, no squares, no colored or dark background, no borders, no platform, no aura, no glow, no particles, no shadows, no text, no labels, no logo. Do not copy the reference presentation-sheet layout or torso portrait crops: only eight restored full-body front models in specified4x2 grid. Preserve enclosed black clothing as opaque.

## Final spacing refinement (initial generated atlas as edit input)

> Edit only the spacing and layout of this transparent eight-character atlas. Preserve exactly these same eight full-body character drawings, colors, faces, costume details and front poses; do not redesign or add new items. It is a production sprite atlas to be sliced into 4 equal columns and2 equal rows. CRITICAL: EACH figure including all hair, ribbons, hands, feet must fit entirely within its own grid cell with AT LEAST40 pixels fully transparent gutters on every side. No pixels may cross the grid boundary. All eight models must have the same displayedheight and baseline within their own cell. Keep exact reading order Fire,Shadow,Storm,Earth / Ice,Poison,Lightning,Spirit. Make a high quality large2048x2048 true-alpha transparent PNG. No background, no checkerboard, no floor, no glow, no aura, no text, no borders, no guides. Eight complete figures never cropped by canvas or cell edges. Clean smooth alpha edges without isolated stray colored pixels. The only change is provide adequate transparent padding separating each of the existing models so the game can crop each whole character cleanly.

The tool returned 1254×1254 rather than the requested 2048×2048. That native output
is retained without another upscale. Crop boundaries and desktop/mobile rendering
were checked against the returned pixels rather than assuming the requested grid.
