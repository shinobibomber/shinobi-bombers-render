# Global chat

Live Global chat for signed-in wallets. It opens as a pop-up from the chat bar on Home, and
the bar itself shows the newest message.

## Pieces

- `server.cjs` → copied to `app/server/chat.cjs` by `apply-chat.cjs` (run from `unpack.cjs`).
  It handles the authenticated `chat-list` and `chat-send` actions of the existing Ryo API.
- `apply-chat.cjs` adds the `ryo_chat` table to `schema.sql` (created by `npm --prefix app run db:init`
  during `npm run build`), routes the two actions in `service.cjs`, and adds
  `RyoPayments.chat(action, body)` to the game client. That client hook is exported as
  `chatPatches` so `tests/preservation.cjs` can reverse it before hashing the original modules.
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

## Client

The pop-up polls every 3 seconds while open; Home polls every 20 seconds for the bar line.
Nothing polls while signed out, while the tab is hidden, or on other screens. Messages are
inserted with `textContent`, never as HTML.

## Not included yet

Moderation tools (mute, report, delete), direct messages, guild/team channels and push
delivery (WebSockets). Polling keeps it compatible with both the Render server and
Netlify Functions.

## Tests

- `tests/chat-server.cjs` — the module against the real schema and Store on PGlite.
- `tests/hero-portraits.cjs` — the pop-up through the real module in the browser harness.
