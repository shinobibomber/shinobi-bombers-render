# Shinobi Bombers — Render beta

This repository contains the tested game as a verified archive and a reproducible Node build adapter. No private credentials are included.

Render: Node 22, Free web service, build `npm ci && npm run build`, start `npm start`, health `/healthz`. The build unpacks the game, installs locked dependencies, and initializes the existing Neon schema additively. Server environment: DATABASE_URL, RYO_TREASURY_SECRET, RYO_TOKEN_MINT, RYO_STUDIO_WALLET, RYO_REVENUE_WALLET. Never commit these values. RYO_SITE_ORIGIN is automatically derived from Render.
