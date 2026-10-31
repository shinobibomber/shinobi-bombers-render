# Heroes, Shrine, reveal and Adventure roster cleanup

Heroes cards use the supplied frame proportions with aligned live names, level,
style, jutsu, stats and actions. Portraits are drawn directly from cached original
model cells into the final canvas, preserving their aspect and foot anchor and
avoiding repeated intermediate scaling. The original sheet resolution remains
the limit on fine detail; the supplied character art is unchanged.

Reveal results use a centered, quantity-aware grid and a clean existing village
backdrop instead of a stretched image strip. Single cards are centered; up to 15
fit the normal desktop view, with pages for larger batches, shorter viewports and
mobile. Original model/aura rendering, reveal/save handlers, rank order, rare-only
shake, congratulations and multiwinner flash remain. Continue/Escape wait for
the group flash. Names can wrap without colliding with rank or stars.

The Shrine has a properly sized portrait, live odds table and clean balance,
total, fee and recruited rows. Mobile has a readable scrolling arrangement.
Adventure retains the original roster borders with one clean panel interior,
transparent text backgrounds, visible Rest actions and uncluttered empty slots.
Portrait repaint caching avoids redundant canvas work.

Validation: offline simulated-wallet browser tests passed for all menu actions,
summon/fusion/Dojo/Sensei purchases, navigation, mobile overflow, DPR2 portraits,
five visible Heroes cards and contained controls, reveal quantities 1/5/10/15/25,
15-card fit at 1366x768, rarity order and Escape during the multiwinner flash.
No real token transaction was submitted. No economy or server behavior changed.
