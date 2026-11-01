# Shinobi Bombers — Project Status

_Development copy created 2026-11-01 (Asia/Singapore)._

| | |
| --- | --- |
| **This folder** | `D:\Projects\Shinobi-Bombers-Development` — the working copy for Claude and OpenAI Codex |
| **Source** | GitHub `shinobibomber/shinobi-bombers-render`, branch `main`, commit `11eddc8`. Full history (29 commits, branch `origin/v3/integrated-redesign-2026-11-01`, tag `v3-reference-beta`) attaches with the one-time git setup below |
| **Uncommitted here** | Phase 2 website screens (Summon, Fusion, Dojo/Sensei). Tested, not yet pushed or deployed. See "Uncommitted work" below |
| **Live site** | https://shinobi-bombers-beta.onrender.com — website at `/`, game at `/play/`. Running commit `11eddc8` (Phase 1) |
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

## Uncommitted work (Phase 2)

| File | Change |
| --- | --- |
| `apply-website-design.cjs` | Enables `summon`, `fusion`, `dojo`; copies the Summon tab sprites |
| `website-design/website-design.js` | Summon, Fusion and Dojo/Sensei modules; safe access to the game's `S` save object |
| `website-design/website-design.css` | Styles for the live Fusion list/slots, Dojo chips, Sensei controls |
| `docs/WEBSITE-INTEGRATION.md` | Phase 2 notes |

Verified in Claude's workspace: the browser suite and the preservation suite pass. An offline build gives exactly
the package game plus `assets/website-design/`, and the server files are identical. To publish:
`git add -A && git commit` → `git push origin main` → Render **Manual Deploy**.

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

1. Review Phase 2 locally, then commit, push to `main` and Manual Deploy. Verify `/play/` Summon, Fusion and Dojo.
2. Optional: open `/play/` on the website Home design before sign-in, with its wallet pill starting the real game
   sign-in.
3. Phase 3: Heroes (live cards), Adventure (the real battle canvas inside the website frame), Market (practice
   market), Boss Hunt; Guild and Chat stay honest previews.
4. Reconnect Render auto-deploy.
5. Keep `SCREENS` in `apply-website-design.cjs` and `docs/WEBSITE-INTEGRATION.md` up to date with each phase.

## Rules for Claude and Codex in this folder

- Work on `main` in small, reviewable commits. Never force-push. Do not create branches or PRs unless asked.
- Keep the website design unchanged. Game mechanics, art and backend come from the package helpers.
- Never commit credentials, private keys, `.env` files or seed phrases. Do not run real token transactions.
- Do not reset player data or add a second ledger. Do not invent missing backend services.
- Run `npm test` (and `npm run test:visual -- <ref>` for website changes) before pushing. Only report a deploy as
  done after checking the live site.
