# Global chat

Live Global chat for signed-in wallets. It opens as a pop-up from the chat bar on Home, and
the bar itself shows the newest message. The read-only System tab announces Legend summons
and Legend fusions.

## Pieces

- `server.cjs` → copied to `app/server/chat.cjs` by `apply-chat.cjs` (run from `unpack.cjs`).
  It handles the authenticated `chat-list` and `chat-send` actions of the existing Ryo API.
- `apply-chat.cjs` adds the `ryo_chat` table to `schema.sql` (created by `npm --prefix app run db:init`
  during `npm run build`), routes the two actions in `service.cjs`, and adds
  `RyoPayments.chat(action, body)` to the game client. That client hook is exported as
  `chatPatches` so `tests/preservation.cjs` can reverse it before hashing the original modules.
  It also hooks `store.settlePurchase` so a confirmed summon with Legend heroes posts a System
  announcement in the same transaction.
- `website-design/website-design.js` renders the pop-up and the Home bar line.

No new environment variables, services or ports. Chat uses the same database, session tokens
and `/.netlify/functions/ryo` endpoint as the rest of the game.

## Rules (server-enforced)

- Signed-in wallets only; only the `global` channel exists. Guild chat waits for guilds.
- Plain text up to 200 characters. Control and zero-width characters are removed and whitespace
  is collapsed. Links and invite/domain patterns are rejected to keep scam links out.
- Per wallet: one message every 2 seconds, at most 10 per 30 seconds, and no repeat of a message
  sent in the last 30 seconds. Sends take the wallet's account row lock, so the limits hold
  across concurrent requests.
- Names are the sender's nickname (letters, digits, space, `_ . -`, up to 14 characters, default
  `Shinobi`) shown next to their short wallet address, so names cannot impersonate a wallet.
- The newest 200 messages per channel are kept; older ones are deleted on each send.
  A page is the newest 50 messages; polling asks only for messages after the last seen ID.

## Legend announcements

- Posted by the server only, inside the purchase settlement transaction, when a summon or fusion
  order is confirmed (finalized) and produced a Legend. Pending and refunded orders, failed fusion
  attempts and lower ranks post nothing. Fusions read "fused a LEGEND".
- One message per order, naming every Legend: "⭐ Hikari (7jY9…3D6X) summoned a LEGEND: Ren of
  Hidden Leaf!". The player's name is their latest Global chat name, otherwise "A shinobi".
- `ref = <summon|fusion>:<order>` with a unique index makes re-settlement or retries a no-op.
- Players cannot post to the `system` channel. `chat-list` returns new System messages when the
  client sends `systemAfter`, so one request serves both tabs.

## Client

The pop-up polls every 3 seconds while open; Home polls every 20 seconds for the bar line.
Nothing polls while signed out, while the tab is hidden, or on other screens.
A new announcement puts a gold dot on the System tab, and the Home bar shows whichever of the
newest Global message and System announcement is more recent. Messages are
inserted with `textContent`, never as HTML.

## Moderation (Shinobi Command Center)

Staff decisions from `/admin/command-center/` (see `command-center/README.md`) are enforced here:

- `chat-send` refuses a muted or banned wallet after taking the same account row lock, before the
  rate limits run, so a send in flight and a staff decision never interleave.
- `chat-list` never returns hidden messages. It lists recently hidden IDs in `removed`, so open
  clients drop them, and returns the caller's own `standing` (mute, ban or recent warning).
- `chat-report` lets a signed-in player report someone else's Global message. A wallet can file at
  most 10 reports per hour. Each report reason can be used once per message. The report stores a
  snapshot of the message.
- Official announcements are inserted into `system` only after two-wallet review.

## Not included yet

Direct messages, guild/team channels, player appeal forms and push delivery (WebSockets).
Polling keeps it compatible with both the Render server and Netlify Functions.

## Tests

- `tests/chat-server.cjs` — the module against the real schema and Store on PGlite.
- `tests/hero-portraits.cjs` — the pop-up through the real module in the browser harness.
