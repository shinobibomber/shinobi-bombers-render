# Shinobi Bombers website transfer

Give Claude `CLAUDE-INTEGRATION-PROMPT.md` and the lightweight handoff ZIP first. Use the full transfer ZIP for all art, compiled runtime and reproducible source.

## Contents

- `runtime/`: compiled game client/assets, unchanged backend/schema and locked Node dependencies. Install dependencies before starting.
- `source/`: maintained build helpers, original assets, React Header/Chest source, tests and verified base archive. This is the editable/rebuildable project.
- `integration/`: this guide, feature/mechanics map, backend contract, Claude prompt and website examples.
- `screenshots/`: desktop/mobile test previews; pictured balances are isolated fixtures.
- `validation/`: actual check/build output and package verification.

## Fast run from compiled runtime

Install Node22. In the `runtime` folder:

```powershell
npm ci --omit=dev
```

Create a private `.env.ryo-private` in that folder using the variable **names** in `integration/ENVIRONMENT.example`. Supply values privately; none are packaged. Then:

```powershell
node --env-file=.env.ryo-private server/init-db.cjs
node --env-file=.env.ryo-private server/render-server.cjs
```

Open `http://localhost:10000` with the same local URL in `RYO_SITE_ORIGIN`. Without configured services, artwork can load but authenticated token actions are unavailable. There is no production fake-login or free-token fallback.

For hosting, install dependencies then use `npm start` from `runtime`; configure all private values in the host's server environment. Initialize the existing schema using `npm run db:init`. Health is `/healthz`. A static-only host cannot run the economic backend.

## Rebuild/edit from source

In `source`:

```powershell
npm ci
npm run build:local
npm --prefix tests ci
npm run typecheck
npm run lint
npm test
```

Chrome is required for browser tests. `source/vendor/game-base.zip` is pinned to SHA-256 `b1833d4d77bc7845e01c02215a4715203cd82767bc3c432d4aba80f708e298c2`. The build applies all17 maintained helpers. The generated `source/app` corresponds to `runtime`.

The full `npm run build` also runs existing database initialization and therefore needs a configured private environment. `build:local` performs production assembly without that external step.

## Scope/rollback

This is the existing main game plus the Design14 Header/Chest scope. No stopped full-V3 Home/maps/models/Guild/Chat redesign is included. Existing maps, combat, hero IDs, progression, prices, odds and server economic logic remain intact. Guild/Chat in the new header are disabled because those services do not exist.

The transfer is not a live deployment. Keep the current live game and database. To roll back a deployment, redeploy main commit `a68984bc83ebbc53c0ecfcaf71b841dc24f307db` with its existing private environment; preserve account records, local saves and pending payment receipts. No destructive migration is introduced.

Read `VERIFICATION.md` before treating this beta as production-ready. It lists tested flows, untested external acceptance checks and inherited dependency findings.
