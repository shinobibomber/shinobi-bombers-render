# Shinobi Bombers — Project Status

_Development copy created 2026-11-01 (Asia/Singapore)._

| | |
| --- | --- |
| **This folder** | `D:\Projects\Shinobi-Bombers-Development` — the working copy for Claude and OpenAI Codex |
| **Source** | GitHub `shinobibomber/shinobi-bombers-render`, branch `main`, commit `11eddc8`. Full history (29 commits, branch `origin/v3/integrated-redesign-2026-11-01`, tag `v3-reference-beta`) attaches with the one-time git setup below |
| **Latest work** | Heroes pagination fix and supplied login/loading artwork integration (2026-11-02); see Handoff notes. Manual deployment required after push. |
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
4. Reconnect Render auto-deploy.
5. Keep `SCREENS` in `apply-website-design.cjs` and `docs/WEBSITE-INTEGRATION.md` up to date with each phase.

## Rules for Claude and Codex in this folder

- Work on `main` in small, reviewable commits; commit and push after every finished result. Never force-push. Do not
  create branches or PRs unless asked.
- Keep the website design unchanged. Game mechanics, art and backend come from the package helpers.
- Never commit credentials, private keys, `.env` files or seed phrases. Do not run real token transactions.
- Do not reset player data or add a second ledger. Do not invent missing backend services.
- Run `npm test` (and `npm run test:visual -- <ref>` for website changes) before pushing. Only report a deploy as
  done after checking the live site.
