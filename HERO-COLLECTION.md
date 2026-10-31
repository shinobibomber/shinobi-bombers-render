# Illustrated hero collection

Heroes retains the supplied village banner, original player models, glowing
card artwork, medallion/crystal badges, and dark stat sections. Portraits use
200px of card height, with silver, green, blue, violet, and gold rank styling.

Five cards are mounted per page. Search, sorting, rank and roster filters,
page counts, and direct page selection support large collections without
rendering hundreds of cards in the live grid. These selections survive
collection refreshes; changing a filter or query returns to its first page.

Click a card or activate its portrait button to inspect an accessible native
dialog with the same model, current stats, chakra, jutsu, and existing actions.
Deploy/rest and reserve changes reuse current game controls. Training and
listing close details before opening the existing purchase/listing flow.
Closing details returns keyboard focus to the collection. Deployment counts
and quick-action availability update as the team changes.

On small screens the collection reflows into readable, scrollable cards with
compact wrapping filters instead of shrinking the entire reference sheet.
Details fit within the viewport and remain scrollable when needed.

Validation uses an isolated simulated ledger with 250 and 500 owned heroes:
five mounted cards, pagination and page selection, filter/search/sort refresh
behavior, click/keyboard details, focus return, deploy/rest, server-owned
reserve changes, the 50 battle-ready / 10 deployed limits, and mobile layout.
No real wallet transaction is required by these checks. Economy and server
rules are unchanged.
