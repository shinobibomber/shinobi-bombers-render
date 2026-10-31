# Adventure hero roster design

`source.png` is the unchanged original `Adventure Mode Design.png` from the
uploaded ZIP (2170×725; SHA-256
`e9bdd3572b0e7598e3728512dd827ef8ee2fd60301175b64965dd4266bb02888`).

The original five-column, two-row card band is cropped and scaled uniformly to
the existing Adventure width. The logical Adventure height becomes 1060 pixels,
while its original header/battlefield artwork stays at the original coordinates
and 941-pixel image height. The taller complete scene fits each viewport without
stretching the cards, header, or battlefield.

Existing deployed `.map-hero` elements and their Rest handlers are retained.
Card ornament/frame templates come directly from the supplied design and follow
the shared eight-character model mapping. Original printed example portraits,
names, chakra and progress are covered. The same `ShinobiSprites.heroFrame`
renderer paints the actual player model and tier aura, and current game values
replace the printed examples. Empty slots show an explicit empty label and a
Manage Heroes target, with no printed example hero or chakra value left behind.

Empty placeholder identities are retained between refreshes, and keyboard focus
is restored after the legacy HUD temporarily detaches the roster controls.
No ownership, deployment limit, stamina, combat, or persistence rules change.
