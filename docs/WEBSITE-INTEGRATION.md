# Website integration

The website (`website/`) is the visual source of truth. The game is the source of truth for mechanics, artwork,
backend and tests. The website opens the game; it never calls the game API, never computes balances and never posts
messages to the game page.

## Website controls → game (live mode, the default on Render: `GAME_URL=/play/`)

| Website control | Behaviour |
| --- | --- |
| Header wallet pill | opens the website's `#play` launch page; the pill reads **Sign in** |
| Header Ryo / Chest / gems | `— Ryo`, `Chest`, `—`: demo account values are never shown next to the real game |
| Chest button, "+" next to Ryo | handoff dialog → the game's own Chest / Deposit |
| Summon, Fuse/Batch, Train, Battle-ready/Reserve, Deploy, Sell, Dojo upgrade, Sensei, Work/Rest All, Boss Hunt Challenge, Market Buy/Offer/My Listings | handoff dialog → **Open game ↗** (the game performs the real, server-verified action) |
| Guild actions, Chat send/party/invite/report, Boss rankings | "not available yet": the game has no backend for these |
| Navigation, filters, tabs, Codex, galleries | unchanged website behaviour |
| Adventure arena animation | decorative only: no fake rewards |

With `GAME_URL` empty (e.g. opening `website/index.html` from disk) the website runs its original demo unchanged.

## Changes to existing website code

Each hook is a one-line call marked `/* game-link hook */`:

- `website/app.js`: 6 hooks.
- `website/cm.js`: 1 hook.
- `website/index.html`: +1 stylesheet, +2 scripts, plus wallet-pill/"+" hotspots and header text boxes in its
  screen data.

All new styles are prefixed `.sbg-`. The two new header hotspots draw artwork only on hover or focus, so resting
screens are pixel-identical.

## Verification (integration session, 2026-11-01)

- **Visual:** all 24 website screens (12 routes × desktop 1672×941 and phone 390×844) are pixel-identical to the
  pre-integration website in preview mode. In live mode only the header text boxes change.
- **Website checks:** `tests/site-check.cjs`, 17/17 pass (preview and live modes, `/play/` game page, API/config
  routing, traversal refusal, mobile `#play`).
- **Supplied game suites:** `preservation` and `browser` pass. `archive`, `transaction-review`, `wallet-vm`,
  `financial-server` and `gameplay-options-server` were not run there, because the npm registry was unreachable.
  The package's own validation log records them passing.
- **Game assembly:** `unpack.cjs` with the pinned base archive and all 17 helpers produced `app/public` and
  `app/server` byte-identical to the transfer package's tested runtime. `website/` was unchanged by the assembly.
- **Not run in that session:** the full `npm ci && npm run build`, real wallet signing, PostgreSQL, Devnet
  settlement and deployment.

## Limitations

- **No deep links:** the game has no deep links, so a handoff opens the game at its sign-in page and names the menu
  to choose.
- **Wallets in frames:** wallet sign-in inside the optional frame preview on `#play` is unverified. **Play now**
  opens the full page.
- **No backend:** Guild, Chat, cross-player Marketplace settlement and NFT minting/trading have no backend.
- **Dependency audit:** inherited Solana dependency findings: 9 (3 high, 6 moderate). See
  `integration/VERIFICATION.md`.

## Website designs inside the game (`/play/`)

`apply-website-design.cjs` (runs after the 17 game helpers) copies website screens into
`app/public/assets/website-design/` and adds `website-design/website-design.js` + styles to the game page. On game
pages that have a website screen, the screen is drawn above the game menu and wired to the game itself:

- `go(page, mode)` navigation; real Ryo balance (`RyoPayments`), Chest amount (`AdventureChest`), wallet account (`BetaWallet`), heroes (`S`, `BattleRoster`, `PlayerModels` portraits);
- the game's real shared Chest trigger and Tools menu are positioned invisibly over the website's Chest and gem
  pill (labelled Tools; the game has no gems), so Claim/Deposit/Withdraw/History and Tools are the game's own;
- unsupported features (Guild, Chat, events, daily missions, seasons, news) show honest notices.

Enabled screens are listed in `SCREENS` in `apply-website-design.cjs` (phase 1: Home, Codex; phase 2: Summon,
Fusion, Dojo/Sensei). Other pages keep the game's own UI until their website screen is connected.

Phase 2 screens press the game's own buttons (found by their `onclick`) and read the game's own DOM/state, so prices,
odds, checkout and saving stay exactly the game's:

- Summon: quantity tabs/pack cards → `Combat.quantity(n)`; Summon → the game's `Combat.summonBatch()` button (real
  quote + checkout dialog). Live total cost and button label come from the game's Summon menu.
- Fusion: rank tabs → `FusionUI.tab`, Select Weakest/Clear/Fuse ×1/×5/×10/Max/Fuse Now → the game's buttons. The
  Reserve list mirrors the game's fusion table and toggles its real checkboxes (`V2.select`); counts, odds, stat
  ranges and selected heroes are live.
- Dojo/Sensei: tier status chips, current tier facts and upgrade price from `S.dojo`/`GameBalance`; Upgrade →
  `DojoServices.upgrade()` (real checkout); Hire/Rent → `DojoServices.hire()` / `TokenCheckout.request('sensei-rental')`;
  return-at % → the game's own Sensei select (`sensei-settings`); Turn on/off → `V2.toggleButler()`.
- Not provided by the game and shown honestly: rate-up/featured events, Sensei skins, last offline session details. Styles: `website-design/website-screens.css` is generated from
`website/app.css` by `website-src/make_game_css.py` (scoped to `#sbwLayer`, keyframes prefixed `sbw-`).
