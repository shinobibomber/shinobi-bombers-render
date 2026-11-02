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

## Hero portraits and Adventure rendering (2026-11-03)

The in-game website overlays draw Heroes, Home, Fusion and Adventure team portraits
from the original animated eight-model sprites. Canvas resolution follows the
displayed size and device pixel ratio (capped at 2); each portrait keeps its canvas
across native status updates and repaints only when its idle pose changes
(`PlayerModels.portraitPose`, every 520ms). Covered native portrait loops
skip drawing while their original labels/buttons continue to supply real actions.
The Adventure map itself remains a live mirror of the native game canvas.

Adventure heroes use the original sprite-sheet idle/walk/run cycles and action clips.
The HD locomotion layer (`hero-motion.js`, `hero-directions-hd.png`) was retired on
request; it remains in git history before the "Restore original hero animations"
commit. The summon reveal keeps its own HD atlas.

The map renderer skips draw-list entries for baked collision walls without removing
those walls from the simulation. Projection coordinates are unchanged; effects
honor the existing quality and reduced-motion settings. `apply-map-design.cjs`
exports one exact render-only hook reversed by preservation checks. The Adventure
scenery cover is now included by `apply-website-design.cjs`, fixing its missing image.

Regression suites cover 376 owned heroes, 10 deployed heroes, all 24 model/direction
views, all eight maps, native actions, optional-art failure, bounded caches and
zero repeated portrait readbacks. The mobile menu retains its existing scaled
scene layout. These changes do not introduce new balance, wallet, ownership,
server, collision, combat or purchase behavior.

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
NEW! denotes the first model missing from the same owner's pre-batch collection; duplicate models
and already-owned models are not marked. Stars visualize rarity rank (1–5), alongside real level,
power and stamina. Reveal One opens the next actual result; Summon Again displays a native read-only
quote and obtains fresh confirmation at checkout. Existing local reveal progress
recovers after refresh for the same account; there is no new cross-device reveal history service.
See `reveal-design/README.md` and `tests/summon-reveal.cjs` for details and fixture verification.

The Adventure overlay reserves `data-sbw-hero` for its own metadata. Native `data-hero` is exclusively
for the game's hero canvases; reusing it on an overlay DIV caused the Heroes renderer to throw on
Adventure → Heroes navigation. Adventure roster `data-maphero` values are resolved as hero IDs,
not collection array indices. `tests/heroes-navigation.cjs` covers both regressions.

## Login, loading and collection paging (2026-11-02)

`login-screen/login-reference.png` and `loading-design/loading-reference.png` are the exact
enhanced Design 13 images supplied by the user. Existing wallet controls sit over their actual
artwork positions; native sign-in, recovery, rejection and configured community links remain
unchanged. Portrait mobile screens crop the center while retaining usable controls.

The loading screen covers the illustrated percentage/bar with live native milestone values.
It awaits both images and actual font readiness, shows explicit errors/retry, and has no added
minimum loading delay. Three narrow startup presentation hooks are exported by
`apply-loading-design.cjs` and reversed by preservation checks. See `login-screen/README.md`.

Heroes arrows target `#p1 .heroes-pagination` buttons by their exact accessible labels.
Their page count and disabled state come from the native pager. The previous broad arrow-glyph
search could accidentally select a hero Perks button. Tests cover paging both directions,
keyboard interaction and first/last boundaries without opening hero details.

## Presentation cleanup (2026-11-02)

The enhanced startup scene is emitted by the loading build helper directly into the initial
HTML, with critical styles and an image preload. Deferred initialization reuses it; the old
dark loader no longer appears while scripts download. The native progress bar animates a
transform and reports actual startup milestones, retaining failure/retry and reduced motion.
Five exact startup presentation hooks are reversed by the preservation suite before it
checks the original inline game modules.

Summon result canvases render the game's existing `CharacterAnimations` idle models rather
than rectangular portrait crops. A shared capped scheduler skips unchanged/offscreen frames
and stops when the dialog closes or the page is hidden; reduced motion displays a still model.

The shrine pack labels show the original base price from `GameBalance.summonCost` for each
native quantity. Illustrated discounts and outdated example prices are covered; charges and
fees remain owned by native checkout. Shared-header artwork is clipped so its stray title
pixels cannot overlap menu headings, and preview notices have reserved space.

Verified with the local build/typecheck, lint, all 11 game suites, 17 website checks
and 24 unchanged desktop/mobile website screenshots. `tests/menu-layout.cjs` checks
live pack captions (including hover), native quantity selection and menu/notice geometry;
loading and reveal tests cover initial paint, true progress and model-loop cleanup.

## Reveal models (updated 2026-11-03)

Result cards show the actual in-game hero with its rarity aura, drawn by
`PlayerModels.drawPortrait` exactly as the menus draw it. The earlier HD reveal
atlas (`reveal-models.js`, `reveal-models-hd.png`) was retired on request; it
remains in git history before the "Show actual heroes with auras in summon reveal"
commit. No extra artwork is downloaded.

Visible canvases draw once per hero and display size at device resolution. CSS provides
idle motion with no continuous canvas redraws; resize/scroll updates coalesce into one frame.
Refresh batches NEW classification and synchronization, and Legend backdrop cleanup
is owned by the current opening. Native result IDs, persistence and checkout remain unchanged.
Missing optional loader JavaScript also falls back without disrupting the native reveal.
Verified: local build/typecheck, lint, 11 game suites + 17 website checks, and 24 unchanged
website screenshots. Reveal screenshots were reviewed separately on desktop and mobile.
