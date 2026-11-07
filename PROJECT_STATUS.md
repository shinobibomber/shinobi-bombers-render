# Shinobi Bombers — Project Status

_Development copy created 2026-11-01 (Asia/Singapore)._

| | |
| --- | --- |
| **This folder** | `D:\Projects\Shinobi-Bombers-Development` — the working copy for Claude and OpenAI Codex |
| **Source** | GitHub `shinobibomber/shinobi-bombers-render`, branch `main`, commit `11eddc8`. Full history (29 commits, branch `origin/v3/integrated-redesign-2026-11-01`, tag `v3-reference-beta`) attaches with the one-time git setup below |
| **Latest work** | Original animated hero sprites restored (HD hero layer retired), animated Elite/Legend auras and rendering optimizations (2026-11-03); see Handoff notes. Manual deployment required after push. |
| **Live site** | https://shinobi-bombers-beta.onrender.com — website at `/`, game at `/play/`. Last verified deployment: `d839583` (2026-11-02) |
| **Original local copy** | `D:\shinobi-bombers-render` — untouched. It is an older clone at `a68984b`, 3 commits behind `main`, with no local edits |

## How to run (Windows, Node 22)

**One-time git setup.** Claude's remote file tools are not allowed to write `.git` folders, so connect this
folder to its full history (29 commits, branches and tags from GitHub) once. Your files are kept as they are:

```powershell
cd D:\Projects\Shinobi-Bombers-Development
git init -b main
git remote add origin https://github.com/shinobibomber/shinobi-bombers-render
git fetch origin
git reset origin/main           # attaches history; does NOT change any file
git checkout -- "*.webp"        # restores the exact original .webp images from history (see note)
git branch --set-upstream-to=origin/main main
git status                      # expect: 4 modified files (Phase 2) + untracked PROJECT_STATUS.md
```

Note: the file transfer re-encoded the `.webp` images (they look the same, but the bytes differ). The
`git checkout -- "*.webp"` line restores the exact originals. Every other file was copied byte-for-byte.

Then:

```powershell
npm ci                          # root dependencies
npm run build:local             # builds chest-ui, downloads + verifies the game base archive, assembles app\
npm start                       # http://localhost:10000  · game at http://localhost:10000/play/
npm --prefix tests ci           # test dependencies (Playwright, PGlite)
npm test                        # package suites + website checks (needs Google Chrome installed)
npm run typecheck; npm run lint # chest-ui (React/TypeScript)
```

- `app/` is **generated** by the build (`unpack.cjs` + the 17 `apply-*.cjs` helpers + `apply-website-design.cjs`) and
  is git-ignored. Edit the source folders, never `app/`.
- Locally, the website and game pages load. Wallet sign-in and the Ryo API need the private settings `DATABASE_URL`,
  `RYO_TREASURY_SECRET`, `RYO_TOKEN_MINT`, `RYO_STUDIO_WALLET` and `RYO_REVENUE_WALLET` (plus `RYO_SITE_ORIGIN` for
  local use). Keep them in Render or in a local `.env` that is never committed (`.env*` is git-ignored). Never put
  them in browser code. Never ask for seed phrases.
- Render: build `npm ci && npm run build`, start `npm start`, Node 22 (`render.yaml`).

## Project structure

| Path | Purpose |
| --- | --- |
| `website/` | Your website (all screen artwork, hotspots, animations, Chest, game link). Served at `/` |
| `website-src/` | Generators for website artwork/data and `website-design/website-screens.css` |
| `website-design/` + `apply-website-design.cjs` | Your website screens drawn **inside the game** (`/play/`) and wired to real game functions |
| `apply-*.cjs` + the matching design folders (`adventure-design/`, `heroes-design/`, `map-design/`, `player-models/`, `character-animations/`, `combat-models/`, `tier-auras/`, `reveal-design/`, `roster-design/`, `shrine-fusion-design/`, `dojo-design/`, `login-screen/`, `loading-design/`, `main-menu/`, `gameplay-options/`) | Game build helpers and art: characters, maps, sprites, animations, auras, menus |
| `chest-ui/` | Shared Header/Chest manager (React + TypeScript + Tailwind) |
| `unpack.cjs`, `safe-extract.cjs` | Verified game-archive extraction, then the helpers in order |
| `server/` | `site-server.cjs` (website at `/`, game at `/play/`), `check-website.cjs` (build guard) |
| `tests/` | Isolated test suites (fixture wallet/API; no real transactions) |
| `integration/`, `docs/` | Transfer guide, mechanics, backend API contract, website integration notes |

## Features working today

- **Game (live):**
  - Canvas Adventure on 8 original maps;
  - hero summon, fusion with server-enforced odds, Dojo tiers and Sensei;
  - battle roster;
  - Phantom/Solflare sign-in on Solana Devnet;
  - server-verified Ryo with PostgreSQL;
  - the shared Chest (Claim, Deposit, Withdraw, History) and Tools.
- **Website (live):** every designed screen at `/`. Game actions hand off to `/play/`, and missing services are
  reported honestly.
- **Your designs inside the game:**
  - Phase 1 (live): Home and Codex, after sign-in, with live balance, Chest, wallet, team portraits and the real
    Chest/Tools.
  - Phase 2 (this folder only): Summon, Fusion and Dojo/Sensei on your designs. They press the game's own buttons:
    real quote and checkout, real Reserve list, live counts, odds and stat ranges, tier status, Sensei settings.

## Progress: the game uses the website designs

| Phase | Screens | State |
| --- | --- | --- |
| 1 | Home, Codex | live (`11eddc8`) |
| 2 | Summon, Fusion, Dojo/Sensei | live (`d92f6a3`) |
| 3 | Heroes, Adventure (themed 10-slot team, Elite/Legend auras, Difficulty box removed), Market, Boss Hunt, Guild/Chat previews | live (`31ee408`, deployed with `29e354e`) |
| polish | One shared header on every menu; Dojo Services landing → Upgrades / Sensei pages; Heroes detail (stats beside portrait, perks, Train + Sell) | live (`661ee78`, `70a63ff`) |

Phase 3 was verified in Claude's workspace with the test wallet: the browser and preservation suites pass, and
Train, Deploy, filters, Work/Rest, Challenge and Market scope press the game's own controls. Buy/Offer report
that they are unavailable.

## Start here (Codex)

1. `git pull` → `npm ci` → `npm run build:local` → `npm start` → open http://localhost:10000/play/.
2. Signed-in screens only show with a wallet; to see them locally use the test wallet: `npm test` (or run
   `tests/browser.cjs`), which signs in automatically with fixture data.
3. UI work for the website screens inside the game: `website-design/website-design.js` (+ `.css`).
   Per screen: `INIT.<screen>` builds overlays, `PAINT.<screen>` updates live values (~8×/s), `MODS.<screen>`
   handles hotspot actions (`fn:` in the screen data), `MIRROR.<screen>` copies live canvases. The shared header is
   `buildHeader()` / `markNav()`. Dojo pages: `dojo`, `dojo-upg`, `dojo-sen` (`dojoView`).
4. Artwork changes: edit `website-src/make_game_patches.py` (header, Dojo pages, Adventure patch), run it with
   Python 3 + `opencv-python` + `numpy`, then `npm run build:local`.
5. Rules: press the game's own buttons/functions (never change balances directly), don't edit `app/` (generated),
   run `npm test` before pushing, commit + push to `main`, then Render → Manual Deploy.

## Handoff notes (Claude ↔ Codex)

- 2026-11-07 Creator popup redesign: Home's `tut` hotspot is now an opaque Creator
  button; original ten header hotspots restored, extra Creator navigation removed.
  `creators-portal/portal.js` uses a native modal dialog (focus trap, Escape/backdrop,
  focus return and nested confirmations), purple/gold/cyan themed CSS, desktop sidebar
  and mobile scrolling tabs. Artwork reuses three existing website hero portraits copied
  by apply-creators-portal.cjs. No economic/server formula changes. Unique asset marker:
  `creator-popup-v2`. Regression coverage in tests/creators-portal.cjs includes header,
  button artwork replacement, keyboard access, modal focus and phone viewport bounds.
  Website preview readiness verifies the actual signed-out login and loaded game canvas;
  its old first-canvas visibility assertion raced the deliberately hidden header avatar.
  Verified fresh build/typecheck, lint, rewards guard, all 42 game suites and 20 website
  checks on Node 22.23.4; desktop, mobile and admin screenshots inspected.
  Prior portal release b05a7be went live with the additive migration successfully applied.

- 2026-11-07 Creators Portal (beta deployment authorized by owner): sources in
  creators-portal/, assembled by apply-creators-portal.cjs after gas safety and before performance.
  Existing authenticated Ryo API and RYO_ADMIN_* roles; DB allowlist, applications, one permanent
  referral, server-only Stage 5 verifier, settled paid summon output counting, exactly-once 50k CP,
  90-day snapshotted 5% commissions, FIFO earned/claimed Adventure lots, limited atomic shop,
  admin audit/corrections/reviews and dual-authenticated wallet migration. Owner selected regular
  in-game Shrine hero delivery (not an NFT); creator outputs/bonus purchases never qualify.
  Independent verifier reuses backend auto-combat without client killStage/kills; can lag browser
  stage. No reward formula/timing, real-time guard, Ryo ledger, Guild or Mythic NFT changes.
  New additive schema and creators-server/creators-portal suites; see creators-portal/README.md.
  Verified Node 22.23.4: build:local, lint/typecheck, rewards guard, 42 suites and 20 website checks;
  desktop/mobile/admin screenshots inspected. No production DB migration or live rewards issued.
  Owner explicitly authorized deployment on Nov 7 after reviewing the implementation. Publish
  through the existing main-branch Render auto-deploy. This is the Devnet beta; no Mainnet token
  launch, funds movement or NFT mint is part of this deployment.

- 2026-11-07 Display & Accessibility + Tsukiyomi animation (owner request): display-settings/README.md
  (Comfort default; localStorage sb-display-v1 + profile.display newer-wins; hooks in arena shake/impacts/
  glow/hit flash, Boss Hunt telegraph, character-animations impacts, tier/mythic aura still, overlay RM).
  Tsukiyomi frames = Fire hero's real action cells recoloured violet + his own head (build-assets limbSource).
  Mythic volley = Legend (bm 5, teamDps/teamCap min(rank,4)+1); 8th-volley ultimate is visual (mythicUlt).

- 2026-11-07 Starter pack / whitepaper / Tsukiyomi motion (owner request): STARTER_PACK=on grants once 15
  heroes (non-NFT starter Tsukiyomi) + 10M starter Ryo (ryo_accounts.bonus; spend-anywhere when it covers
  the price, never withdrawn, no on-chain tx, no pool income; offers keep their pot) — starter-pack/README.md.
  /whitepaper = website/whitepaper.html (site-server route; Tools link; home News). Tsukiyomi walk/run/idle
  use a displacement-warp rig (legs step, hair/cape sway). Mythic shows no star count anywhere.

- 2026-11-07 Limited Mythic NFT Box (owner request; mythic-box/README.md): home EVENT card + dialog; Devnet;
  20 boxes, 1 SOL then 1.5 SOL, 2 per wallet, SOL to RYO_REVENUE_WALLET. One atomic server-built tx (player
  pays + Token-2022 NFT w/ metadata, authority removed, memo), treasury+mint sign, player signs last
  (box.js reviews it). ryo_mythic_boxes; confirm by the player's signature over the stored message or the
  mint existing; expiry frees serials. Sold mints count for Tsukiyomi; profile.mythicPerk → quote −10%
  (not market/hunt). Dashboard: box-mint gated by purchases pause; snapshot nft stats.

- 2026-11-07 Mythic hero Tsukiyomi (owner request; mythic-hero/README.md): rank 5, 7 stars, stats 15–18,
  6 perks, Legend ultimate/training, no summon/fusion/Market. Ownership = Limited NFT Box: env
  MYTHIC_BOX_MINTS and/or MYTHIC_BOX_COLLECTION (dormant until set), finalized on-chain check in
  state() (60 s cache, mythic-refresh action, 10 s limit), ryo_mythic_heroes registry; the hero and its
  training follow the NFT. Art built from the 3 supplied sheets (tools/build-assets.cjs): 21 animations
  128×128, 4 skills, 14 aura parts; lazy-loaded; CharacterAnimations.effectOverride hook.

- 2026-11-07 Boss Hunt UI (owner request): the ranks panel is two buttons (.bh-rk data-act daily/weekly);
  huntRankings(kind) opens a Daily or Weekly pop-up (summary, standings, previous day / last week winners,
  swap button). Head/sched panels touch the arena (no printed gaps); bossHuntPatches remove the arena
  caption, outline hero/guardian names and space hero rows 105px. Loading placeholders; .bh-go.run style.

- 2026-11-07 Boss Hunt weekly (owner request): entry 10,000 = 8,000 prize pool / 1,000 treasury (revenue
  transfer) / 1,000 burn; hunts 60 s (HUNT_SECONDS, bossHuntPatches time:60). Weekly ranking Mon–Sun UTC
  (weekOf): points 11−daily rank from ryo_hunt_payouts, ties by the week's confirmed damage, then earliest.
  settleWeeks (after all the week's days settle, +5 min) mints economy.hero(4) for 1–3 and hero(3) for
  4–10 into profiles (ryo_hunt_awards, WEEKLY_SCHEMA); full collections wait (granted=false) and
  grantWaiting() adds them on state/board. board().weekly: standings incl. today's provisional points.

- 2026-11-07 purchase split (owner request): price = total; purchaseSplit() in gameplay-options/server.cjs
  gives 80% operations (reward pool income) / 10% treasury / 8% burn / 2% studio; service signs exactly
  q.studioFee/q.treasury/q.burn (zero skipped). Client texts via purchaseSplitPatches. Summon = 25,000.
- 2026-11-07 Boss Hunt rankings (owner request): boss-hunt/server.cjs (apply-boss-hunt.cjs after
  apply-market): hunt-enter = store.purchase product 'hunt' (10,000 total, burn 1,000, prize 9,000;
  burn-only signed tx), ryo_hunt_entries/days/payouts; hunt-report caps damage at elapsed (≤90 s) ×
  top-5 battle-ready DPS × 1.1; settleDue (state/board) pays top 10 30/20/12/9/7/6/5/4/4/3 at 00:00 UTC
  (+5 min, waits for pending fees; no damage → carry). Purchases pause gates hunt-enter; dashboard
  liabilities include hunt_pool. Client bossHuntPatches: team = 5 strongest battle-ready (no
  deploy/chakra), startBoss needs window.BossHunt entry, unlimited HP 90-s run, no chakra spend,
  no local rewards, heroes on the floor. Website BH panels replace the printed controls.

- 2026-11-07 Market UI + offers (owner request): the screen's printed tabs/filters/cards/buttons are
  hidden and replaced by live HTML (website-design.js MK: .sbw-mpanel, .sbw-mbar tabs For Sale/My
  Listings/My Offers, rank buttons, Skills, sort select, search input; .sbw-mgrid cards; .sbw-mdet
  details with Buy now/Make offer/Accept/Decline/Cancel). Items, Resources and Element removed.
  Offers (ryo_market_offers, OFFER_SCHEMA): amount from rank minimum to price-1 is held from the
  buyer's balance (48 h, never past the listing); decline/cancel/expiry/listing close/sale return it;
  accept() creates the buyer's market purchase at the offer price from the held Ryo (no second
  debit); buying a listing you offered on uses the held offer first. Held offers count in the admin
  dashboard liabilities. Purchases pause gates market-offer/market-accept too.

- 2026-11-07 Player Market (owner request): heroes only. market/server.cjs (copied to
  app/server/market.cjs by apply-market.cjs, last-but-one unpack step): ryo_market_listings; post
  escrows the hero out of the profile (rank minimums 10k/25k/80k/200k/500k, max 100M, 7 days, 20 per
  seller, keep 2 heroes); browse filters rank, perks (jsonb @>), name, sort, 10/page; cancel and
  expiry (swept on state/mine) return the hero intact. market-buy reuses ryo_purchases: buy() reserves
  the buyer's Ryo, signs studio 2% + treasury 8% transfers (no burn), quote.operations = 10% (reward
  pool), settled() in store.settlePurchase credits the seller 80% on confirm or relists on refund.
  The purchases pause gates market-buy/market-post. Perks and look became server-owned the same
  day (identityPatches, assignIdentity) so trades are honest. UI: website-design.js MK/INIT/PAINT/
  MODS.market, sellDialog replaces Market.openListing; market buys skip the summon reveal.
  Tests: market-server, market (browser, tests/market-fixture.cjs), financial-server market-buy.

- 2026-11-06 phone layout (owner request): portrait/narrow viewports (innerWidth <= 820 and taller
  than wide) switch website-design.js into phone mode: MOBILE[screen] lists regions in artwork
  coordinates; stack() re-parents each stage element into a pane window (.sbw-mshift keeps artwork
  coordinates, so PAINT keeps working), panes zoom to the column width (CSS zoom), regions below
  MIN_ZOOM 0.6 (or their own pan value) swipe sideways, fit:1 shrinks, half:1 pairs, flow:'sel'
  reflows HTML lists (team, hero grid, listings) into 2 columns. unstack() restores everything on
  wide screens. Compact header (.sbw-ph-top: Ryo, Chest, Tools, GO OFFLINE; the game's Chest and
  Tools triggers are pinned over it) and bottom nav + More sheet (.sbw-ph-nav). New tests:
  mobile-layout.cjs (every screen at 390/412 px, restore to desktop) and smoke-sweep.cjs (screens +
  dialogs at desktop/phone with no console errors or failed requests). Live check on a phone
  profile: login 4.3 s, game ready 9.5 s first visit; repeat visit login 0.65 s / 67 KB.

- 2026-11-06 faster loading (owner request): ~110 MB downloaded before login. Now: the startup gate
  shows LoginScreen as soon as the login art loads (loading-design.js; startupPatches guards the final
  show()), GameLoading stays active until sprites/maps/fonts finish, and a CSS-only card
  (#gameLoading.loading-compact) shows only after sign-in while still preparing. apply-performance.cjs
  (last unpack step, sharp 0.34.5) converts 37 PNGs to WebP (sprite sheets lossless, menu/reference art
  q88: 92 MB → 44 MB), rewrites static and runtime-built URLs (DYNAMIC list; the build fails on any
  leftover), and adds content-hash ETag/304 to render-server.cjs (file-etag.cjs). map-design loads
  the current map (+ next) and others on demand (MapDesign.load). preservation reverses the WebP
  rewrites via restoreReferences(). 20 Mbps phone sim: login at 4 s (1.3 MB), game ready 24 s.

- 2026-11-06 Sensei auto-deploy (owner request): the game's own Sensei swap only replaced one
  exhausted hero per 2s and never filled empty slots, so a signed-in team (0 deployed after login)
  sat idle with a hired/rented Sensei. gameplay-options/options.js wraps `tick`: every 2s an active
  Sensei fills empty slots (up to 10) and swaps every exhausted on-map hero for the strongest rested
  battle-ready heroes at the return threshold. Heroes rested by hand (`tog`) are `benched` until
  deployed again; Boss Hunt members (off-map) are untouched; OFF does nothing. Test: sensei-rotation.

- 2026-11-06 training rework (owner request): max level 5; each level-up is a stored, server-rolled
  +1 (`hero.bonus`): Genin/Chunin +1 Power, Jonin+ a random stat, Lv4→5 two +1s. Price = [10k,20k,
  40k,80k][level-1] × rank [1,1.5,2,2.5,3] + 2% fee. Rules live in gameplay-options/server.cjs
  (trainingPrice/levelUp/migrateHero/trainedStats); economy.cjs/adventure.cjs patches in
  apply-gameplay-options.cjs. Old heroes convert on read (capped at 5, deterministic rolls from token
  id, `trainingVersion:2`). Client: exported `trainingPatches` (stats = base + bonus, prices, x/5,
  Lv 5 Elite fusion, gain toast), reversed in preservation. Sensei offline battles and teamDps use
  trained stats; the rewards guard replays Lv5 teams. Tests: training.cjs, gameplay-options-server.

- 2026-11-04 SOL gas protection: `transaction-safety/gas-safety.js` is shared between
  the native wallet and server via `apply-transaction-safety.cjs` (last in unpack).
  It verifies exact-message fees, missing ATA rent/native create costs and a system-account
  reserve using fresh RPC values. Wallet checks precede signing and, for wallet-added priority
  fees, pending-record creation/broadcast. Server checks occur in signedTransaction before
  signing and before Store debit/reservation. Explicit gas errors carry paymentNotSubmitted
  through the handler/API, clear only the unsent request handle and leave Chest retryable.
  Ambiguous failures/old pending records retain recovery. Claims/kill sync are unchanged.
  New gas-preflight.cjs covers cost boundaries and real Chest UX/screenshots; wallet-vm and
  financial-server cover no signature/broadcast/debit/pending row and fail-closed estimates.
  Preservation reverses the five reviewed wallet/API hooks; only service.cjs and
  netlify-handler.cjs pinned hashes changed. See transaction-safety/README.md for limits.

- 2026-11-04 Ryo Observatory: `/admin/` is a standalone responsive developer dashboard,
  served by `server/site-server.cjs`; all data uses the existing signed-wallet Ryo API.
  Source: `economic-dashboard/`, assembled by `apply-economic-dashboard.cjs` at the end of
  `unpack.cjs`. Additive tables capture transactional claim observations, reporting config,
  independent approvals, emergency pauses and hash-chained audit records. `RYO_ADMIN_VIEWERS`,
  `RYO_ADMIN_OPERATORS`, `RYO_ADMIN_APPROVERS` are comma-separated public-wallet allowlists;
  default denies access. An approver has operator permissions but cannot approve their own
  proposal. Two distinct wallets are needed for config approvals/resume. New-operation gates
  cover purchase/withdraw/claim only; state recovery, persisted-order retries and normal kill
  sync remain available. No balance/rate/combat changes. Reporting distinguishes historical
  unassigned claims, unavailable NFT minting/circulation/lock verification and reviewed fiat
  runway from verified ledger/chain data. See `economic-dashboard/README.md` for definitions,
  evidence/coverage limits and setup. New suite `tests/economic-dashboard.cjs` covers actual
  PGlite aggregates, auth/roles, self/stale approvals, pause/recovery, atomic claim records,
  RPC failures, financial evidence and desktop/mobile screenshots. The only intentional pinned
  runtime updates are service.cjs, adventure.cjs (claim insert), and schema.sql.

- 2026-11-04 GO OFFLINE (owner request): the header wallet button reads GO OFFLINE. `goOffline()` in
  website-design.js shows the Sensei status (offers `RyoPayments.senseiSettings(pct,true)` when rotation
  is off), runs a final `RyoPayments.adventure(false,false)` (saves KillReport kills, marks the server
  offline), stores `shinobi-offline-v1`, then clicks the native `#betaDisconnect`. `welcomeBack()` reports
  the Sensei's offline earnings on the next sign-in. No server changes. Covered in live-rewards.cjs.

- 2026-11-04 Adventure during Boss Hunt (owner request): the game's V2 tick ran either the hunt or
  Adventure, so a hunt froze Adventure for every hero. `bossTeamPatches` now moves the 5 hunt heroes
  off the Adventure map (the Adventure tick skips off-map heroes), runs Adventure for everyone else
  alongside `bossTick`, and places the hunt heroes back when the hunt ends; copy no longer says
  Adventure pauses. Covered in boss-summon.cjs.

- 2026-11-03 closing flush and per-visit Session gained (owner request): `KillReport` sends unsent
  kill totals on pagehide / tab hide with `fetch` keepalive (a `rewardPatches` hook on the game's
  `api`), and the server credits a report covering the online seconds since the last sync even when
  the closing call is inactive. Session gained no longer restores from sessionStorage, so it starts
  at 0 on every game load. Covered in live-rewards.cjs.

- 2026-11-03 Dojo Services (owner request): `dojoState()` in website-design.js reads tier and
  Sensei (permanent, rental time left, expiry, rotation, return %) straight from the server profile,
  so expired rentals no longer show as hired; the Upgrades and Sensei pages use it too. The hub's
  live values sit in art-measured slots with art-sampled backgrounds; the old off-page covers from
  the original combined layout are gone. New suite: dojo-services.cjs.

- 2026-11-03 Adventure kill credit (owner request): online Adventure now pays the kills the player's
  battle reports instead of the server's separate kill sequence (which credited about half of what
  the battle showed). `gameplay-options/options.js` (`KillReport`) sends cumulative per-session kill
  totals by tier and Fortune bonus with every Chest sync; `gameplay-options/server.cjs`
  (`creditKills`) pays them at the server tier table within 1.5× the team's computed damage (+4,000 HP
  carry), replay-safe, stage floored at one per 100 kills. Offline Sensei time still uses the server
  sequence. Hooks: `apply-gameplay-options.cjs` (adventure.cjs, service.cjs, index.html).

- 2026-11-04 REAL-TIME REWARDS GUARD (owner request: no future update may break it):
  `tests/realtime-rewards-guard.cjs` runs in every Render build (`npm run build` → `check:rewards`)
  and in `npm test`. A failure stops the deploy and the current version stays live. It locks the
  battle formulas `teamDps` mirrors, the defeat → Chest sync wiring and timing, and replays every
  rank at level 1/10 to require each kill credited on the next sync, also after 90s/5min sync gaps
  (same kill session keeps a 10-minute online window; a new page keeps 2 minutes). If a balance
  change trips it, update `teamDps` first, then the locked string. Never loosen it to pass.

- 2026-11-04 real-time kill credit (owner request): the kill budget was computed from base level-1
  stats and the server's base stamina, so trained heroes out-killed it and their kills queued and
  arrived later. `teamDps` (gameplay-options/server.cjs) now budgets the 10 strongest battle-ready
  heroes at the battle's trained stats with best-perk allowance (×1.5 slack); sync is 0.3s after a
  defeat, at most every 1.5s. Test: trained Genin team, every kill credited on the next sync.

- 2026-11-03 live Chest (owner request): the game fires `shinobi-enemy-defeated` on each defeat
  (`rewardPatches`); the website then calls `AdventureChest.refresh()` 0.6s later, at most every 3s (now 0.3s / 1.5s),
  so the server-verified Chest and Session gained update during battle. `countTo` animates both.
  The banner's "POTENTIAL REWARD" label now reads SESSION GAINED. New suite: live-rewards.cjs.

- 2026-11-03 Hero Aura System, board collisions, enemy spread and tier rewards (owner request):
  tier auras now come from `website/assets/aura-system.webp` (copied to `tier-auras/`, manifest v2):
  each rarity's own ground ring, wreath and particles, layered ground → behind-hero aura → hero →
  foreground particles (`TierAuras.drawFront`), keyed with feathered edges, 8 cached phases, all
  rarities animate; `auras.png` retired. Every map's `solids` were re-traced from its board-sample
  legend (solid blocks, non-walkable tiles, crates and physical props; hazards, runes, air currents
  and concealment trees stay walkable), footprint only so each map stays one connected area.
  Enemies no longer touch each other (tiered fallback for crowded stages). Defeated enemies show
  their tier reward ("+X Ryo") again (`rewardPatches`). Summon History has Close at the top.

- 2026-11-03 Summon History, Boss Hunt (owner request): Summon History on the Summon screen opens
  a panel of summoned heroes per batch from the server purchases the client already has (fused or
  sold heroes show a placeholder; pending/refunded orders are labelled). Boss Hunt fights with the
  5 strongest rested deployed heroes (`bossTeamPatches` in apply-gameplay-options.cjs, reversed by
  preservation). Its overlay uses art-sampled covers (`artMatch`), four single-line mechanics rows,
  opaque reward/ranking panels and a 5-hero team panel; `.hs>.sl` no longer uses will-change.
  New suite: boss-summon.cjs.

- 2026-11-03 Adventure edges and fill (owner request): `MapDesign.blocked` treats the outermost
  columns (x 0 and W-1) as solid on every map, since they lie on the artwork's side walls, fences
  or trees; heroes and enemies no longer stand on walls. The Adventure and Boss Hunt mirrors copy
  the live canvas pixel-for-pixel into opaque cached contexts, and CSS object-fit: cover does the
  scaling (Adventure top-anchored: only front-wall scenery is trimmed, no black side bars).

- 2026-11-03 Adventure layout and enemy placement (owner request): the stage list is removed,
  the stage banner sits 18px higher, and the battlefield mirror spans x 22–1522 (about 11% larger,
  object-fit: contain) above a full-width team panel; a dark backdrop hides the artwork's stage
  cards. `MapDesign.alignGrid` no longer places enemies on a cell or the two cells above a solid
  footprint (obstacle art rises above it); collision is unchanged. Tested in map-render-quality.cjs.

- 2026-11-03 Fusion, hero limit, header seam (owner request): Fusion lists every Reserve hero of
  the rank; Elites below level 10 stay listed but locked ("Lv 10 needed", explained above the
  list) because the Elite → Legend level 10 rule is kept. Collections are capped at 500 heroes:
  the server summon quote refuses summons past 500 and tells players to fuse (`MAX_HEROES` in
  `apply-gameplay-options.cjs`). Legend fusions are announced in System chat like summons. The
  shared header now ends where its art's left part ends (row 100), removing the black strip.
  New suite: `fusion-limits.cjs`.

- 2026-11-03 Legend summon announcements (owner request): when a summon order settles as
  confirmed with Legend heroes, `store.settlePurchase` (hooked by `apply-chat.cjs`) posts one
  System chat message in the same transaction (`ref` unique per order). The chat pop-up's
  System tab shows them with an unread dot; Home's bar shows the newest message.

- 2026-11-03 live Global chat (owner request): `chat/` + `apply-chat.cjs` add a server-backed
  chat to the existing Ryo API (`chat-list` / `chat-send`, table `ryo_chat`, created by
  `db:init`). Home's chat bar opens it as a pop-up and shows the newest message. Server rules:
  signed-in only, 200-character plain text, links blocked, 2s gap / 10 per 30s / no repeats,
  newest 200 kept. No new env vars or services. Details: `chat/README.md`. Tests:
  `chat-server.cjs` (PGlite) and the browser flow in `hero-portraits.cjs`.

- 2026-11-03 summon reveal shows actual heroes (owner request): result cards draw the
  in-game hero with its rank aura via `PlayerModels.drawPortrait`, once per hero and
  display size (CSS keeps the idle motion). Retired the HD reveal atlas
  (`reveal-models.js`, `reveal-models-hd.png`, `ARTWORK.md`), its Retry-art notice and
  the element-coloured CSS ring that would have doubled the aura. Nothing in the game
  downloads HD hero artwork any more.

- 2026-11-03 original hero animations restored (owner request): menus and Adventure
  use the original animated sprites again. Removed the HD locomotion layer
  (`hero-motion.js`, `hero-directions-hd.png`, `HD-ARTWORK.md`, `hero-motion.cjs`)
  and HD menu portraits; the summon reveal keeps its HD atlas. All 8a65309
  optimizations stay (bounded clip events, live reduced motion, retained canvases,
  hidden/covered paint skipping, no readbacks). New: portrait caches key on the idle
  pose (`PlayerModels.portraitPose`), so portraits repaint every 520ms, not per tick.
  `hero-portraits.cjs` now covers the native animated portraits.

- 2026-11-03 Elite/Legend auras and map floors (Codex pass finished by Claude):
  tier auras isolate the supplied sheet with smooth alpha, drop stray specks and
  no longer clip at the frame edge. Elite and Legend add an animated energy ring
  drawn behind the cached body (24 phases, at most 48 cached frames; static for
  effects quality 0, reduced motion and hidden tabs). Menu portraits replace the
  spinning/filter CSS auras with light `data-aura` layers that pause and degrade
  with effects quality. `MapDesign.drawFloor` reuses identical native floors, and
  Adventure mirrors keep native resolution. Frozen hashes updated for
  `map-design.js`, `player-models.js`, `tier-auras.js`. New suites:
  `aura-rendering.cjs`, `map-render-quality.cjs`. Rendering only: no gameplay,
  economy or wallet changes.
- 2026-11-03 hero quality and Adventure rendering: Heroes/Home/Fusion/Adventure
  portraits reuse the eight-model reveal atlas directly at display resolution.
  Added matching side/rear artwork and an optional HD locomotion renderer, with
  native action clips and original-art fallback. Source cleanup yields between
  idle chunks; bounded caches and retained portrait canvases eliminate recurring
  image readbacks and hidden portrait work. Fixed valid phase-zero/back-walk
  animation, live reduced motion, clipped hero names and a missing Adventure
  scenery patch. Map rendering skips baked-wall draw entries while preserving
  collision data and all eight original projections. Prices, balances, ownership,
  wallet/server and combat mechanics are unchanged.
  Artwork provenance, exact generation prompt, limits and run instructions:
  `player-models/HD-ARTWORK.md`. Regression coverage adds `hero-portraits.cjs`,
  `hero-motion.cjs`, `adventure-rendering.cjs`, `render-performance.cjs`.
  Tests exercise 376 owned heroes, ten deployed, 24 model/direction combinations,
  art failure, real actions, cache limits and zero warm portrait readbacks.
  Verified: `npm run build:local` (including TypeScript), lint, `npm test`
  (15 game suites + 17 website checks), and `npm run test:visual -- HEAD`
  (24 unchanged standalone website screens). No live wallet transactions or deploy.
  Desktop/mobile and model previews: `tests/out/heroes-hd-*.png`,
  `tests/out/hero-directions-contact.png`, `tests/out/adventure-hd-desktop.png`.
  No cross-device FPS guarantee: timings depend on hardware, effects and browser.

- 2026-11-02 reveal quality follow-up: source action poses were only 56–60px tall.
  Added a reveal-only transparent HD atlas derived from the same eight model references;
  original gameplay models remain unchanged. See `reveal-design/ARTWORK.md` for provenance.
  Results sample the atlas directly into DPR-aware canvases and animate with CSS, removing
  the recurring canvas redraw loop. Optional art failure falls back to native models with
  Retry art; actual results and Continue remain usable. Batched NEW/UI updates reduce repeat
  work, and Legend backdrop ownership prevents stale darkening between reveals.
  Verified: `npm run build:local` (including TypeScript), lint, `npm test` (11 suites
  + 17 website checks) and `npm run test:visual -- HEAD` (24 unchanged website screens).
  Reveal tests cover DPR2 direct drawing, zero idle redraws, missing art/loader fallback,
  retry, rapid modal rebuilds, duplicate Reveal All, account recovery and original charges.
  Updated desktop/mobile previews: `tests/out/summon-results-*.png`.

- 2026-11-02 presentation cleanup: enhanced loading markup/styles are present in the first
  HTML response, removing the legacy loader flash; progress uses a transform and actual
  startup milestones. Summon results now render the existing animated character models
  on transparent canvases with a capped shared scheduler. Discount labels in the shrine
  artwork are replaced by live original base prices; existing fees and checkout are unchanged.
  Menu title/header overlap and the Guild preview notice are corrected. No wallet/server,
  gameplay, balances, odds or persistence changes.
  Verified: `npm run build:local` (including TypeScript), `npm run lint`, `npm test`
  (11 game suites + 17 website checks), and `npm run test:visual -- HEAD` (24 unchanged
  website screens). New `tests/menu-layout.cjs` covers original pack prices, caption
  coverage at rest/hover, native quantity controls and heading/notice layout. Updated
  loading/reveal suites cover first paint, real progress and model animation cleanup.
  Reviewed desktop/mobile screenshots are in `tests/out/loading-*.png`,
  `tests/out/summon-*.png` and `tests/out/menu-*.png`.

- 2026-11-02 login/loading follow-up: imported the exact Design 13 enhanced PNGs into
  `login-screen/` and `loading-design/`. Native wallet controls align with the artwork;
  portrait phones use a centered crop with readable controls. Startup percentage/bar reflect
  existing asset/font milestones, await both images, and offer retry on failure. The artificial
  minimum loading delay is removed. Three exact presentation hooks are reversed by preservation
  tests; wallet/server/economy modules are unchanged. See `login-screen/README.md`.
  Heroes previous/next now target only the native pager; the old glyph search could click
  a hero's Perks button. Native page count and disabled states are mirrored.
  Regression coverage: `tests/login-loading.cjs` and `tests/heroes-navigation.cjs`.
  Verified: `npm run build:local` (including TypeScript), `npm run lint`, `npm test`
  (10 game suites + 17 website checks), and `npm run test:visual -- HEAD` (24 unchanged
  screens). The visual harness now freezes animations before first paint and awaits
  decoded images, removing false differences from already-running animated layers.
  Desktop login matches every reference-image pixel; loading keeps live milestone values.

- 2026-11-02 follow-up: reveal uses original scroll artwork and larger portraits from the existing
  eight-model sheet, Reveal One, rank stars, first-model NEW! badges, and native quoted Ryo cost.
  Adventure → Heroes crash fixed by isolating overlay metadata from native canvas selectors;
  Adventure roster hero IDs now resolve to the correct collection entry. Regression coverage:
  `tests/heroes-navigation.cjs` and `tests/summon-reveal.cjs`. No wallet/server/economy changes.
  Verified: `npm run build:local`, `npm test` (9 game suites + 17 website checks), and
  `npm run test:visual -- HEAD` (24 unchanged website screenshots on the isolated rerun;
  the first run had an 11-pixel Chat rendering discrepancy). Reveal screenshots include
  sealed, Legend opening, desktop, tablet and mobile results in `tests/out/summon-*.png`.

- 2026-11-02: cinematic scroll reveal work is scoped to `reveal-design/` and its build helper.
  The existing shrine menu is unchanged. Real persisted batches support individual opening,
  Reveal All, Skip Animation, independent element/rank styling and a final rarity summary.
  Summon Again uses the existing quote/Pay flow. See `reveal-design/README.md` for recovery limits
  and `tests/summon-reveal.cjs` for isolated integration tests. This entry does not indicate a live deploy.
  Verified: `npm run build:local`, `npm test` (8 game suites + 17 website checks), and
  `npm run test:visual -- HEAD` (24 unchanged website screenshots). Desktop/tablet/mobile reveal
  screenshots are in `tests/out/summon-*.png`. Tests ran with the installed Node 26; Render targets Node 22.

- Every finished result is committed and pushed to `main` straight away, so GitHub always has the latest work.
  When switching tools, run `git pull` first.
- Pushing does **not** deploy: Render auto-deploy is off, so a change only goes live after Manual Deploy.
- Where to work:
  - website screens inside the game: `website-design/website-design.js`, with one `INIT/PAINT/MODS` block per
    screen and `MIRROR` for live canvases;
  - their styles: `website-design/website-design.css`;
  - enabled screens: `SCREENS` in `apply-website-design.cjs`.
- Rebuild with `npm run build:local`, preview with `npm start`, and test with `npm test` (fixture wallet).
  Never edit `app/`, which is generated.

## Known problems / limits

- **Render auto-deploy does not fire on push.** Deploys are manual (Render dashboard → Manual Deploy). Reconnect the
  repo in Render → Settings → Build & Deploy to restore auto-deploy.
- **Free Render plan:** the first visit after idle shows "Application loading" for up to about 1 minute.
- **Your designs cover only Home and Codex live** (plus Summon, Fusion and Dojo here). Heroes, Adventure, Market,
  Boss Hunt and the pre-sign-in screen still show the game's original UI.
- **No backend for:** Guild, Chat, NFT minting and marketplace, events, daily missions, seasons, news, rate-up and
  featured banners, Sensei skins, and last-offline-session details. These show honest "not available" notices; do
  not fake them.
- **Verified on the development PC (2026-11-01):** `npm ci`, `npm run build:local` (screens: home, codex, summon,
  fusion, dojo), `npm --prefix tests ci`, `npm test` → all 7 Global Chest suites PASS, plus 16/16 website checks PASS.
  The PC runs Node v26.13.0 while the project and Render use Node 22, so `npm` shows an EBADENGINE warning. To match
  Render exactly, install Node 22 with nvm-windows. Playwright's Chromium was installed once with
  `cd tests; npx playwright install chromium`.
- `npm audit` lists moderate/high advisories in the locked Solana wallet dependencies. Do **not** run
  `npm audit fix --force`, because it changes tested versions; review upgrades as separate, tested commits.
- `D:\shinobi-bombers-render` is out of date (`a68984b`). Use this folder instead.
- The stopped V3 redesign (`origin/v3/integrated-redesign-2026-11-01`) must not be resumed or merged.

## Next development tasks

1. Play-test the signed-in `/play/` screens (Heroes, Adventure, Market, Boss Hunt, Guild) and note polish requests.
2. Optional: open `/play/` on the website Home design before sign-in, with its wallet pill starting the real game
   sign-in.
3. Polish requests from review (e.g. more Adventure/Heroes styling) as small commits.
4. ~~Reconnect Render auto-deploy.~~ Done 2026-11-04: pushes to main now deploy automatically (verified: commit 5664cad deployed with trigger new_commit, live in ~80s).
5. Keep `SCREENS` in `apply-website-design.cjs` and `docs/WEBSITE-INTEGRATION.md` up to date with each phase.

## Rules for Claude and Codex in this folder

- Work on `main` in small, reviewable commits; commit and push after every finished result. Never force-push. Do not
  create branches or PRs unless asked.
- Keep the website design unchanged. Game mechanics, art and backend come from the package helpers.
- Never commit credentials, private keys, `.env` files or seed phrases. Do not run real token transactions.
- Do not reset player data or add a second ledger. Do not invent missing backend services.
- Run `npm test` (and `npm run test:visual -- <ref>` for website changes) before pushing. Only report a deploy as
  done after checking the live site.
