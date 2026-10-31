# Supplied Heroes collection

`heroes-menu.png` is the unchanged original 1774×887 image from heroes-menu.zip.
SHA-256: `5c9844e3e3f1a695e44abeb12a3361902ba2a309d9206dc368da4962decb5e05`.

The native scene preserves the reference artwork, five card positions, frames,
filters, search/sort controls and toolbar. A single uniform scale fits the scene
to the viewport. The supplied player models and tier effects replace the printed
sample portraits; actual collection names, stats, chakra, ownership, prices and
status replace the printed examples. Source frames stay in their reference
positions, while badges, chakra bars and supplied auras follow the actual tier.
No example hero or value remains visible in empty slots.

The original collection renderer, rarity/deployment filters and each hero's
Deploy, Train, Market and Reserve handlers remain in use. Search and sorting
operate on the existing cards without reordering or mutating the saved roster.
Collections larger than five heroes use pages in the reference status row.
The shared toolbar returns to its original parent when changing pages.

Both legacy portrait repaint loops skip these model canvases, so the shared
player/animation/aura renderer paints them once. The build helper guards its
source hooks, rejects partial installation and is safe to run repeatedly.
