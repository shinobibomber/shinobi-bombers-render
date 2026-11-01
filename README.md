# Shinobi Bombers — game and Global Chest integration

Existing game baseline: main `a68984bc83ebbc53c0ecfcaf71b841dc24f307db`, with the scoped Design14 shared Header/Chest update. The stopped full V3 redesign is excluded. Follow [the transfer guide](integration/START-HERE.md), [mechanics map](integration/FEATURES-AND-MECHANICS.md), [backend contract](integration/BACKEND-API.md) and [Claude handoff](integration/CLAUDE-INTEGRATION-PROMPT.md).

Use Node22. Run `npm ci`, `npm run build:local`, `npm --prefix tests ci`, `npm run typecheck`, `npm run lint`, then `npm test`. Source lives in maintained root modules and `chest-ui/src`; generated `app` is ignored. The transfer includes a verified base archive in `vendor/game-base.zip`. Build rejects another hash and applies the17 ordered helpers.

For Render, keep build `npm ci && npm run build`, start `npm start` and health `/healthz`. The full build also initializes the existing PostgreSQL schema additively. Keep private environment values outside GitHub/public files; Render can derive site origin when unset. A static-only upload cannot run authenticated economic services. No private credentials are included and this package does not automatically redeploy the live game.
