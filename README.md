# Shinobi Bombers — website + game (Render)

Each Render web service (the Devnet **test** server and the Mainnet **live** server, see
[Test server and live server](#test-server-and-live-server)) serves both:

| Path | What |
| --- | --- |
| `/` | the Shinobi Bombers **website** (`website/`): the final design, never overwritten by the game build |
| `/play/` | the complete **game**: Canvas engine, wallet sign-in, server-verified Ryo, shared Header/Chest (assembled into `app/` by the build) |
| `/.netlify/functions/ryo`, `/api/ryo`, `/beta-config.json`, `/healthz` | the game's API and config, handled by the game's own server code at the origin root |

Game baseline: main `a68984bc83ebbc53c0ecfcaf71b841dc24f307db` plus the scoped Design14 shared Header/Chest update. The
stopped full V3 redesign is excluded. Guides: [transfer guide](integration/START-HERE.md),
[mechanics](integration/FEATURES-AND-MECHANICS.md), [backend contract](integration/BACKEND-API.md),
[website integration](docs/WEBSITE-INTEGRATION.md).

## Render

- Node 22. Build `npm ci && npm run build`, start `npm start`, health `/healthz`.
- **Build:** checks the website, builds the Chest UI, verifies and unpacks the game archive (base hash pinned),
  applies the 17 ordered helpers into `app/`, installs locked runtime dependencies, and initializes the existing
  PostgreSQL schema additively.
- **Start:** `server/site-server.cjs` serves `website/` at `/` and hands every game path to
  `app/server/render-server.cjs`, unchanged.
- **Private settings:** set `DATABASE_URL`, `RYO_TREASURY_SECRET`, `RYO_TOKEN_MINT`, `RYO_STUDIO_WALLET` and
  `RYO_REVENUE_WALLET` only in Render's environment. Never commit them.
- **Origin:** `RYO_SITE_ORIGIN` is derived from `RENDER_EXTERNAL_URL` when unset. The website and game share this
  origin, so wallet sign-in, saves and pending-transaction recovery stay with it.
- **Optional:** `GAME_URL` (default `/play/`) and `GAME_EMBED_PREVIEW` (default `true`).

## Test server and live server

[render.yaml](render.yaml) defines two separate services that run the same code. Each has its own URL, database and
secrets:

| | Test server | Live server |
| --- | --- | --- |
| Render service | `shinobi-bombers-beta` (free) | `shinobi-bombers-live` (starter, paid) |
| Deploys from | `main` | `live` (merge `main` → `live` to release) |
| `SOLANA_NETWORK` | `devnet` | `mainnet` |
| Starter Pack | `STARTER_PACK=on` | always off |
| Token setup, tester airdrop, setup pages | available | removed |

- **One switch.** `SOLANA_NETWORK` (`devnet` by default, or `mainnet`; see [network/network.cjs](network/network.cjs)) is
  read at **build** time by `apply-network.cjs` and checked again at **start**. A Devnet build is byte-for-byte the
  same as before, apart from `app/server/network.cjs` and its stamp.
- **A Mainnet build** sets the Mainnet genesis and keys every account to the fixed `RYO_SCOPE` (for example
  `solana-mainnet:live`; never change it once players register), so its records never mix with Devnet's. It also rewords the UI and removes the Devnet organizer tools. The build **fails** if any Devnet genesis,
  RPC, explorer link or test-token wording is left.
- **A live server refuses to start** if:
  - its build and `SOLANA_NETWORK` disagree;
  - `STARTER_PACK` is on;
  - `SOLANA_RPC_URL`, `SOLANA_PUBLIC_RPC_URL` or `RYO_SITE_ORIGIN` is missing or not https;
  - `RYO_SCOPE` is missing or not a `solana-mainnet:` scope.

  Every payment path still checks the RPC's genesis hash, so a wrong RPC fails closed.
- **Live-only settings:**

  | Setting | What it is |
  | --- | --- |
  | `SOLANA_RPC_URL` | Private server RPC, from a paid provider. |
  | `SOLANA_PUBLIC_RPC_URL` | Browser RPC: a separate key, restricted to the live domain. |
  | `RYO_SITE_ORIGIN` | Required at build time too, because Mythic Box NFT metadata is baked with it. |
  | `RYO_TOKEN_SYMBOL` | Shown in the wallet UI. Optional; defaults to `RYO`. |

  Change `SOLANA_NETWORK` or `RYO_SITE_ORIGIN` → **Clear build cache & deploy**.

## Pre-launch portal (live server, before the game opens)

With `PRELAUNCH_MODE=on` the live server runs **only** the pre-launch portal from [prelaunch/](prelaunch/):

- **What players can do:** visit the landing page, sign in free with a Solana wallet, register a username, get a
  referral link, follow referrals and the leaderboard, and read the announcements.
- **Wallet sign-in:** signs a Sign-In With Solana message only, with no transaction. Phantom, Solflare and any Wallet
  Standard wallet work.
- **Languages:** English and Português (Brasil).

| Path | Pre-launch behaviour |
| --- | --- |
| `/`, `/rules`, `/privacy`, `/terms` | portal pages (`?referral=` and `?ref=` links are captured) |
| `/api/prelaunch` | sign-in, registration, referrals, leaderboard, status ([prelaunch/server.cjs](prelaunch/server.cjs)) |
| `/play/*` | redirects to `/`; only game artwork under `/play/assets/` is served |
| `/api/ryo`, `/.netlify/functions/ryo` | **403**: the game API is not mounted, so nothing can be summoned, traded, claimed, deposited or withdrawn |
| `/admin/*`, `/beta-config.json` | 404 |
| `/whitepaper`, `/healthz` | unchanged |

- **Accounts carry over.** Registrations use the game's own tables under `RYO_SCOPE`: `ryo_players` (internal player id,
  username, language, region) plus the existing referral tables. At launch the game sees the same accounts, referral
  codes and referrers, with no second sign-up. Old `/?referral=` links keep working.
- **Settings:**

  | Setting | Value |
  | --- | --- |
  | `SOLANA_NETWORK` | `mainnet` |
  | `PRELAUNCH_MODE` | `on` |
  | `RYO_SCOPE` | `solana-mainnet:live` |
  | `RYO_SITE_ORIGIN` | the live https origin |
  | `DATABASE_URL` | the live database |
  | `DISCORD_URL`, `X_URL`, `SUPPORT_URL` | optional; hidden until set |
  | `LAUNCH_AT` | optional ISO date-time; shows a countdown. Unset = "To be announced" |
  | `REFERRAL_ENROLLMENT_LIMIT` | the shared referral cap, default 1000 |
  | `REGISTRATION_ENABLED`, `REFERRALS_ENABLED` | default on |

  No mint, treasury, wallet keys or RPC are needed. Startup is **refused** if any money setting, `STARTER_PACK`,
  a missing `RYO_SCOPE`/`DATABASE_URL` or a non-https origin is present.
- **Security:**
  - the server stores the message, and the nonce works once for 120 s;
  - the session is an HttpOnly, Secure, SameSite=Strict cookie for 1 hour, and sign-out deletes it on the server;
  - requests must come from the exact origin and carry a custom header;
  - rate limits apply per IP;
  - usernames are unique regardless of case;
  - referral rules (self, second referrer, loops, non-new players) are the game's own.
- **Announcements:** edit [prelaunch/announcements.json](prelaunch/announcements.json) (EN + PT-BR), commit and deploy.
- **Legal pages:** Referral Rules and the Privacy notice describe what the code actually does. **Terms is a draft**,
  marked as such, to be replaced with reviewed text before launch.

### Opening the game (launch day)

1. Remove `PRELAUNCH_MODE` and **keep `RYO_SCOPE`**. Add the money settings from the checklist below.
2. Turn on each feature with its own launch gate, all **off by default on Mainnet** ([launch-gates/server.cjs](launch-gates/server.cjs)):

   | Gate | Feature |
   | --- | --- |
   | `SUMMONING_ENABLED` | Shrine summons |
   | `MARKETPLACE_ENABLED` | Market |
   | `REWARD_CLAIMS_ENABLED` | referral and Adventure claims |
   | `SOL_DEPOSITS_ENABLED` | deposits and the Mythic Box |
   | `SOL_WITHDRAWALS_ENABLED` | withdrawals |

   Gates are enforced by the server, and a closed deposit is refused before the wallet signs. The test server
   (Devnet) has every gate on, as before.
3. **Clear build cache & deploy.**

### Referral-bound heroes

Heroes from referral rewards (`referralReward`) are permanently account-bound, on both test and live:

- The Market API refuses to list them (`REFERRAL_BOUND`), and the refusal is audited.
- A fusion that consumes one produces a bound hero.
- The game shows a 🔒 badge and disables Sell.
- Battles, teams and training are unchanged.

### Live launch checklist (outside the code)

1. Create the **Mainnet** Ryo token mint off-site (the in-game token setup is disabled on the live server). Create a
   **new** treasury keypair, studio wallet and revenue wallet. Never reuse Devnet keys.
2. Fund the treasury with SOL for withdrawal and payout fees.
3. Get a paid Mainnet RPC (Helius, QuickNode, Triton…) with two keys: one server key, and one browser key restricted to
   the live domain. The public `api.mainnet-beta.solana.com` rate-limits and blocks browser traffic.
4. Create a **separate paid Render Postgres** for live. Free Render Postgres expires after 30 days.
5. Create the `live` branch on GitHub. The test service was created by hand, so create `shinobi-bombers-live` by hand
   too (New → Web Service) with the settings in [render.yaml](render.yaml). Syncing the Blueprint could take over the
   test service.
6. Optional: add a custom domain to the live service, set `RYO_SITE_ORIGIN` to it, then clear the build cache and
   deploy.
7. Get legal and economic sign-off before opening it. The Mythic Box and every deposit use real SOL and real tokens.

## Develop

```bash
npm ci && npm run build:local          # assemble the game into app/ (no database step)
npm start                              # http://localhost:10000  · game at /play/
npm --prefix tests ci && npm test      # supplied game suites + website checks (Chrome required)
npm run typecheck && npm run lint      # Chest UI source
npm run test:visual -- <ref>           # pixel-compare every website screen with a commit/branch
```

- **Website design and behaviour:** edit `website/`. Behaviour lives in `app.js`/`cm.js`, the game connection in
  `website/game-link/`, and screen artwork/data are generated by `website-src/` (see its README).
- **Game source:** edit the root `apply-*.cjs` modules and `chest-ui/src`. `app/` is generated and git-ignored.

## Rollback

- **Restore the previous single-game service:** set Render's start command to `npm run start:game-only`, or revert
  the website commit.
- **Game:** baseline `a68984b`.
- **Data:** do not reset database records, saves or pending transaction IDs.
