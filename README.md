# Shinobi Bombers — integrated V3 beta

An incremental React/TypeScript/Tailwind interface extends the existing JavaScript/Canvas game and its Solana Devnet services. The complete V3 redesign is still in progress. [Status by design section](V3-STATUS.md), [setup and rollback](V3-SETUP.md), [verification](V3-VERIFICATION.md), [changelog](V3-CHANGELOG.md).

Use Node 22. Run `npm ci` then `npm run build:local` to assemble the game without database access. It verifies the pinned base archive, applies the ordered maintained integration helpers and installs application dependencies. React source lives in `v3-ui/src`; generated `app/` is ignored. The release ZIP bundles the verified base, while a Git checkout downloads it.

`npm test`, `npm run typecheck`, `npm run lint` and `npm run test:browser` provide the checks documented in [qa/README.md](qa/README.md). Browser tests use a simulated wallet/API; live Devnet settlement remains a separate acceptance check.

Render retains build `npm ci && npm run build`, start `npm start`, and health `/healthz`. The full build also initializes the existing PostgreSQL schema additively. Keep server credentials outside GitHub/public files. `RYO_SITE_ORIGIN` is derived from Render when unset. This V3 slice is on its review branch and has not replaced the live beta.
