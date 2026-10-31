# Run the integrated V3 beta

This is the existing game with an incremental V3 interface. Read `V3-STATUS.md` before testing: the full redesign, production animation assets and shared social/trading services are not complete.

## Local setup

1. Install Node.js 22 and npm. Extract the V3 package into a new folder. Keep the existing project and live environment available for rollback.
2. Open a terminal in the extracted folder and run:

```powershell
npm ci
npm run build:local
npm test
npm run typecheck
npm run lint
```

The ZIP includes the SHA-256-verified base at `vendor/game-base.zip`. A GitHub checkout downloads the same pinned release when this file is absent. `unpack.cjs` rejects a different hash, then applies the maintained integration helpers in order. Generated files in `app/` are not the source of truth.

3. Copy `.env.example` to `.env.ryo-private`. Set the existing Devnet environment values privately on this computer. Do not paste credentials into chat, upload them, or put them in `app/public`.
4. Initialize the configured database and run the same-origin server:

```powershell
node --env-file=.env.ryo-private app/server/init-db.cjs
node --env-file=.env.ryo-private app/server/render-server.cjs
```

Open `http://localhost:10000`. Use the same exact origin in `RYO_SITE_ORIGIN`. The health endpoint is `/healthz`. The UI opens without database credentials, but authenticated account features require the configured database, wallet and Devnet token service. There is no fake-login or free-credit fallback in the shipped game.

## Environment values

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Existing private PostgreSQL connection URL. |
| `RYO_TREASURY_SECRET` | Existing Devnet custody keypair JSON array, stored only in a private server environment. |
| `RYO_TOKEN_MINT` | Existing Devnet Ryo mint public address. |
| `RYO_STUDIO_WALLET` | Studio fee destination public address, separate from custody. |
| `RYO_REVENUE_WALLET` | Revenue/reward destination public address, separate from custody. |
| `RYO_SITE_ORIGIN` | Exact URL origin of this instance. |
| `SOLANA_DEVNET_RPC_URL` | Optional Devnet RPC endpoint; existing default remains. |
| `PORT` | Optional local port; default 10000. |

V3 does not rotate keys, change token configuration or migrate economic records. Use separately configured beta/test infrastructure for local signing tests; do not point unreviewed test code at production credentials.

## Automated checks

For the browser and server regression suites, install Chrome, then run:

```powershell
npm --prefix qa ci
npm run test:browser
```

These checks use isolated saves and simulated wallet/API responses. PGlite supplies an in-memory PostgreSQL test database. They do not send Solana transactions. See `qa/README.md` and `V3-VERIFICATION.md` for exact coverage and limits.

## Render and rollback

The existing `render.yaml` retains `npm ci && npm run build`, `npm start` and `/healthz`. The full build includes the existing database initialization step; environment variables must already be configured. Keep all private values in Render's server environment. No new database tables or economic migrations were introduced by V3.

This slice is staged on `v3/integrated-redesign-2026-11-01`. It has not replaced the live `main` deployment. To test it remotely, use a separately configured preview service and separate beta database; a new service is not provisioned by this package.

To roll back an eventual deployment, deploy `a68984bc83ebbc53c0ecfcaf71b841dc24f307db` with the existing environment. Preserve PostgreSQL records and local saves. Do not erase account data or remove pending transaction records. The local pre-V3 source backup is `releases/backups/pre-v3-2026-11-01` in the development workspace.

## Remaining release gates

Full art fidelity, missing animation assets and Guild/Chat/shared Marketplace require more implementation. The inherited Solana SDK dependencies still report audit findings (see verification report). Live Devnet signing/settlement, real database access, long-run load and broader device tests remain separate acceptance checks. This is a development beta, not a production-complete V3 release.
