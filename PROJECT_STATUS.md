# Shinobi Bombers — Project Status

_Development copy created 2026-11-01 (Asia/Singapore)._

| | |
| --- | --- |
| **This folder** | `D:\Projects\Shinobi-Bombers-Development` — the working copy for Claude and OpenAI Codex |
| **Source** | GitHub `shinobibomber/shinobi-bombers-render`, branch `main`, commit `11eddc8`. Full history (29 commits, branch `origin/v3/integrated-redesign-2026-11-01`, tag `v3-reference-beta`) attaches with the one-time git setup below |
| **Latest work** | Phases 1–3 plus polish (shared header on every menu, Dojo Services landing page, Heroes detail panel) are live — commit `70a63ff`, deployed 2026-11-01 |
| **Live site** | https://shinobi-bombers-beta.onrender.com — website at `/`, game at `/play/`. Running `70a63ff` |
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

## Handoff notes (Claude ↔ Codex)

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
