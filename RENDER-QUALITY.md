Hero rendering uses the original supplied source artwork. Menus and the Adventure
roster now sample the larger 95px native base idle cells instead of the smaller
60px action cells. The map continues to use the supplied action clips. The model
index and colors are unchanged in every category.

Roster portrait canvases use up to 2× device density, clear their whole backing
surface, and draw at their intended logical size. Heroes portraits keep their
existing 2× canvas. High-quality image sampling is explicit on the shared blit.
Original sheet resolution remains the limit; this does not invent replacement
faces or costumes. Map actors are 17.6% larger with the existing foot anchor.

The original standalone tier aura is widened 22% within the shared frame. Its
source colors and contours are preserved; a low-opacity screen pass makes its
light readable on bright map tiles without painting over the hero. The existing
bounded caches remain in use. No combat, rarity, reward or wallet rules change.
