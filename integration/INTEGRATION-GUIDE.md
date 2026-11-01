# Add Shinobi Bombers to another website

This handoff contains the existing Shinobi Bombers game and the scoped shared Header/Chest update. It excludes the stopped broad V3 redesign. Your main website can use React, Next.js, another framework or plain HTML; it does not need to replace the game engine.

## Package layout

| Folder | Purpose |
| --- | --- |
| `runtime/` | Assembled game: `public/`, `server/`, `package.json` and its lockfile. Run this Node application to serve the game and its Ryo API together. |
| `source/` | Maintained repository, Chest UI source, ordered build helpers and regression tests. Use this for future game changes. The generated `app/` is rebuilt from these sources. |
| `integration/` | This guide, a prompt for Claude and optional website components. |

Private environment files, database credentials, custody keys and installed dependencies must not be included in the handoff. The game needs its existing configured PostgreSQL and Solana Devnet services for authenticated financial features.

## Recommended integration: link to the complete game

Host `runtime/` as its own Node 22 application on a game domain or subdomain, then add a **Play Shinobi Bombers** link to the website Claude created. `https://game.example.com` in these examples is a placeholder; replace it with your actual game URL.

This retains the game's real menus, Canvas rendering, wallet sign-in, shared Chest, saved progression and existing backend contracts. The website is an entry point; it does not calculate balances or recreate game ownership. Opening the full game is the recommended route because wallet behavior inside an iframe has not been verified.

1. Configure the game runtime privately as below.
2. Open the full game URL and confirm the login screen and `/healthz` endpoint.
3. Add the link using `ReactGame.tsx` or `plain-html.html` as an example.
4. Verify wallet sign-in, normal gameplay and supported Chest actions using the configured beta environment before giving the link to testers.

No new hosting service, paid resource or deployment is created by these files.

## Run the assembled runtime locally

Install Node 22. Open a terminal in `runtime/`:

```powershell
npm ci
```

Create `.env.ryo-private` in that folder. Keep its values on the server only:

```dotenv
DATABASE_URL=
RYO_TREASURY_SECRET=
RYO_TOKEN_MINT=
RYO_STUDIO_WALLET=
RYO_REVENUE_WALLET=
RYO_SITE_ORIGIN=http://localhost:10000
PORT=10000
```

Use the existing beta configuration: the PostgreSQL connection URL, Devnet custody keypair, token mint and distinct studio/revenue public destinations. `SOLANA_DEVNET_RPC_URL` is optional; the current runtime defaults to Solana Devnet. Set `RYO_SITE_ORIGIN` to the exact game URL origin, without a path. In a hosting dashboard, configure these as private server environment variables rather than uploading an environment file.

Initialize the configured database, then start the server:

```powershell
node --env-file=.env.ryo-private server/init-db.cjs
node --env-file=.env.ryo-private server/render-server.cjs
```

Open `http://localhost:10000`. When a host supplies environment variables directly, the commands are `npm run db:init` and `npm start`. The health path is `/healthz`. Database initialization uses the existing schema; it does not copy player records into a new database. Preserve the configured database and pending-operation records when moving a deployment.

The runtime serves only `public/` as browser files. Keep `server/`, `.env.ryo-private` and package-management files outside any website's static publish directory. Deploying `public/index.html` alone does not provide wallet authentication, accounting or settlement.

## Same-origin API and path requirements

The browser currently calls `/.netlify/functions/ryo`. The Node host also accepts `/api/ryo`, but changing to that alias requires updating and testing the client; the existing client still uses the first path. These are server endpoints, not files to copy into the website.

Serve game assets and the Ryo API from the **game's same origin**. A dedicated game origin is the least disruptive option. Do not point the browser at a different API origin and disable origin checks to make it work. Wallet login challenges bind the signature to the game host/origin, and the backend checks the configured origin.

Putting the game under a website path such as `https://www.example.com/game/` requires deliberate routing. Relative asset paths may resolve under `/game/`, while the current API path remains absolute at `https://www.example.com/.netlify/functions/ryo`. The public `/beta-config.json` and health endpoint also need deliberate routing. Use a tested reverse proxy that preserves the expected same-origin endpoints and game paths, or use a separate game subdomain. Merely copying `index.html` into `/game/` is not a complete integration.

Avoid injecting the compiled game HTML inside a React component with `dangerouslySetInnerHTML`. The game owns global functions, Canvas rendering, document-level dialogs, storage and script order. Keep it as a complete page unless a later source-level integration is explicitly designed and tested.

## React or Next.js website

Copy the example `ReactGame.tsx` into your website and pass your real game URL:

```tsx
<ShinobiBombersGame gameUrl="https://game.example.com" />
```

It displays a full-page game link and an optional embedded preview. The example contains no wallet keys, session tokens, balance calculations, transaction actions or cross-window ledger messages. It does not require a Solana SDK in the marketing website.

For Next.js App Router, the example includes the client-component directive because the preview uses local UI state. A simple server-rendered anchor is also sufficient when embedding is unnecessary.

## Plain HTML website

Adapt `plain-html.html`, replacing all placeholder game URLs. The primary link opens the game normally. The optional iframe appears inside a disclosure. Both examples keep a visible **Open full game** link available while embedding.

## Optional iframe: verify before relying on it

Embedding is an optional presentation layer, not a verified wallet integration. Browser extensions, mobile wallets, popup rules, iframe permissions and provider policies can affect wallet discovery, signing and app links. Test the actual browser/provider combination; if the wallet does not work inside the frame, use the full-page link.

The examples do not send balances, ownership, authentication or transaction instructions through `postMessage`. They do not share private cookies or wallet secrets with the parent site. If the host or reverse proxy sets a Content Security Policy or framing headers, allow only the intended website origin when embedding. Do not broadly relax unrelated policies. Also check that the website's `frame-src` policy permits the game origin.

## Rebuild from maintained source

Work in `source/` for future changes. The scoped Chest integration retains the existing game baseline and ordered apply helpers:

```powershell
npm ci
npm run build:local
npm run typecheck
npm run lint
npm --prefix tests ci
npm test
```

Use `tests/README.md` for exact browser/server prerequisites and commands. Chrome is needed by the browser suite. The source's generated `app/` is the assembled runtime; publish its public/server/package files together after verification. Use the package's verification report for what actually passed and what remains unverified. Passing fixture tests does not prove live external wallet settlement.

## Acceptance and rollback

- Open the game from the website on desktop and mobile; the full-page fallback must remain reachable.
- Verify the correct game origin, assets, public token configuration, wallet sign-in and API errors without exposing server settings.
- Confirm the existing menus and game actions still operate. Do not replace combat or navigation with the website's own sample components.
- Open the shared Chest from supported authenticated menus; check actual rewards/balance, Claim, transfer review, fees, cooldown and history. No screenshot example values should become real state.
- Treat Guild/Chat as unavailable where the baseline has no backend. Existing Hero entitlements are not proof of an NFT mint/trading program.
- Preserve saves, database records and pending transaction IDs. Do not reset balances or ownership to make an integration appear successful.
- To roll back the website entry point, restore its previous link/component. To roll back the scoped game changes, use baseline commit `a68984bc83ebbc53c0ecfcaf71b841dc24f307db` with the existing server environment and database. Do not erase transaction or player data.

The original game and this scoped update remain a beta. Production art/backend gaps, inherited dependency findings and live settlement/device checks must remain visible in the handoff's verification notes.
