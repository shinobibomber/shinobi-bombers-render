# Integrate my existing Shinobi Bombers game with this website

I already have a website and a working Shinobi Bombers game. Use the supplied integration bundle to connect them. Do not build a replacement game or convert the approved game into a non-interactive mockup.

## Inspect first

1. Inspect this website's framework, routes, hosting setup, security headers and build commands.
2. Read `integration/INTEGRATION-GUIDE.md`, then inspect `runtime/` and `source/` and the game's compatibility/verification reports.
3. Identify the existing Node 22 runtime, Canvas game, shared menu functions, wallet sign-in, API endpoints, PostgreSQL persistence, stored Hero ownership and pending financial operations.
4. Report a short compatibility checklist before editing. Do not read, print or upload private environment files or custody keys.

The bundle contains the existing baseline plus the scoped shared Header/Chest integration. The stopped broad V3 redesign is excluded. Preserve baseline `a68984bc83ebbc53c0ecfcaf71b841dc24f307db` mechanics and the verified scoped changes; do not import unrelated files from the abandoned V3 branch.

## Preferred integration

Host the complete `runtime/` application on the game's own origin/subdomain and add a prominent **Play Shinobi Bombers** link to this website. Ask me for the actual game URL if it is not already configured. `https://game.example.com` in the examples is a placeholder, not my official domain. Do not invent a domain or create paid services.

Use `integration/ReactGame.tsx` or `integration/plain-html.html` as a starting point. Keep the existing game's full-page login, menus, rendering, wallet connection and server API intact. Optional iframe embedding must retain a visible full-page link; wallet discovery and signing in an iframe are not verified and must be tested before relying on it.

The browser's current Ryo API path is `/.netlify/functions/ryo` at the game's same origin; the Node host also supports `/api/ryo`. Preserve origin-bound wallet challenges and API origin checks. A `/game/` website path needs a tested reverse proxy for assets, the root API and public configuration; copying only the HTML file is insufficient. Do not disable authentication, origin checks or transaction verification to bypass integration errors.

## Preservation requirements

- Preserve the existing grid, collision/walkability, attacks/explosion behavior, crates, enemy/target behavior, Hero AI, combat calculations, chakra, progression and saved game state. Do not replace the game engine with marketing-page animations.
- Preserve Hero IDs, owned entitlements, inventory, reserve/battle-ready modes, deployment limits, Summoning, Fusion, Boss Hunt, Dojo/Sensei and the current supported market behavior.
- Preserve real configuration, prices, odds, fees, reward funding, cooldowns, ownership validation and backend persistence. Do not infer tokenomics from artwork.
- Reuse existing wallet/authentication, Solana Devnet SDK/API and server settlement/recovery. No seed/private key entry in the browser, no second ledger, no optimistic token credits and no spoofed account or balance state.
- Keep the shared Chest connected to authoritative rewards, spendable Ryo, wallet tBRYO and real transaction history. Claim is an internal accounting transfer; Deposit/Withdraw retain their existing confirmation/authorization flows. Do not promise that a server-signed withdrawal necessarily opens a new wallet approval popup.
- Do not add a parent-window `postMessage` bridge that trusts balances, rewards, ownership or transaction requests. The website only opens or embeds the complete game in this integration.
- Do not invent NFT mint/trading, cross-player marketplace, Guild or Chat services. Retain truthful disabled/coming-soon states for unsupported actions.
- Keep screenshot examples, test fixtures and demonstration balances out of production accounts.

## Deliverables and verification

Implement real routing/link behavior in the existing website. Preserve its current working pages and styles. Keep the game runtime separate unless a source-level integration is explicitly approved after inspection.

Run the website's available checks/build and the relevant supplied game tests. Verify desktop/mobile layout, game loading, same-origin API routing, accessible launch controls, iframe fallback if used and existing authenticated Chest behavior. Clearly distinguish fixture tests from real wallet/database/Devnet checks. Do not send real financial transactions or create external paid resources as an incidental verification step.

Provide the exact modified-file list, run/deployment configuration, test results, screenshots, missing dependencies, unverified provider/device behavior and rollback steps. Never claim unavailable backend actions or untested settlement are working. Keep private settings in the server's environment and out of commits, browser assets and the handoff archive.
