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

Enabled screens are listed in `SCREENS` in `apply-website-design.cjs` (phase 1: Home, Codex; phase 2: Summon, Fusion, Dojo/Sensei; phase 3: Heroes, Adventure, Market, Boss Hunt,
Guild/Chat previews —
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
- Not provided by the game and shown honestly: rate-up/featured events, Sensei skins, last offline session details.

Phase 3 screens (same approach: the game's own buttons and state):

- Heroes: filter tabs → `HeroFilters.choose`; cards mirror the game's hero cards (Deploy/Reserve `tog(i)`, Train
  `up(i)`, Sell `Market.openListing`, Make Battle-ready); the detail panel's Train/Sell/Deploy press the same
  buttons; search and sort drive the game's own search box and sort select.
  Cards keep two buttons (Deploy hero / Rest hero and Make Battle-ready / Move to Reserve). The detail panel shows
  rarity, a stats grid beside the portrait, chakra, the hero's perks (from the game's perk table `PK`, `h.pk`) and
  only Train and Sell.
- Adventure: the game's battle canvas (`#cv`) is drawn into the website frame every frame (read-only mirror); stage,
  enemies and session Ryo come from the game's status bar. The team panel is the game's own 10-slot Adventure team
  (same portraits and Deploy buttons) restyled in the website theme, with animated auras for deployed Elite and
  Legend heroes; Work All / Rest All → `Experience.workAll/restAll`. The Difficulty / Stage Info box is removed (the
  game has no difficulty) with an inpainted scenery patch made by `website-src/make_game_patches.py`.
- Boss Hunt: the sanctuary canvas (`#bossHuntMap`) is mirrored; hunt number, guardian, status, HP, timer, damage and
  first-clear reward come from the game; Challenge → `V2.startBoss()`. Rewards the game does not award, daily
  rankings and best damage/rank are marked as not available.
- Market (`go(4,1)`): the game's local practice market (`Market.scope/rank/sort`). Buy / Make Offer and the Items /
  Resources tabs report honestly that a shared market service does not exist yet.
- Guild and Chat: website screens shown as labelled previews (no backend); every action shows a "not available yet"
  notice.

Shared header and Dojo pages:

- One header for every menu: `website-design/shared-header.webp` (built by `website-src/make_game_patches.py` from
  the Guild header) is fixed at the top of the screen with the Guild screen's nav/Chest/Ryo/wallet/Tools positions;
  the active menu is highlighted at runtime. Each screen's own header is tucked underneath (`hdrH`).
- Dojo opens on **Dojo Services**; **Enter Dojo** opens Dojo Upgrades and **Manage Sensei** opens Sensei; Back
  returns to Services. Services is cut from the Dojo artwork; Upgrades and Sensei use the reference designs in
  `website-src/ref/` (example values inpainted away by `make_game_patches.py`, settings in
  `website-design/dojo-views.json`), with live tier, status, price, return %, rotation toggle and HIRED state drawn
  on top. Back buttons, the Upgrade button, the return-% select and Turn On/Off use the game's own controls. The game's own `DojoServices.open('hub' |
  'dojo' | 'sensei')` pane is kept in step.

Styles: `website-design/website-screens.css` is generated from
`website/app.css` by `website-src/make_game_css.py` (scoped to `#sbwLayer`, keyframes prefixed `sbw-`).

## Cinematic scroll reveals (2026-11-02)

The shrine menu stays unchanged. `reveal-design/reveal-design.js` and `.css` present the actual
`S.v2.revealBatch` as sealed scrolls, individual opening animations, Reveal All / Skip Animation,
and a responsive final collection with a live rarity summary. Ten results use a 5×2 desktop grid;
other native quantities, fusion and rescue batches keep their real size and source.

`apply-reveal-design.cjs` adds narrow presentation hooks around the game's existing reveal
functions. Native `Experience` still sets revealed flags, saves and finishes; native checkout still
owns quoting, confirmation, charging and delivery. Summon Again opens that existing confirmation.
The preservation suite reverses only these exact reviewed presentation hooks before comparing the
original inline game modules. No wallet, server, balance or probability code is changed.

Rank comes from the actual hero, while element artwork follows the existing model independently.
NEW denotes a newly recruited server-owned hero, not a first-ever archetype claim. The game has no
separate star-rating field, so cards show level, power and stamina. Existing local reveal progress
recovers after refresh for the same account; there is no new cross-device reveal history service.
See `reveal-design/README.md` and `tests/summon-reveal.cjs` for details and fixture verification.
