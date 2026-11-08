# Verified archive download reliability — beta, November 8, 2026

Beta redeploys `dep-dbo452ou01pc73e7fcs0` and `dep-dbo4610u01pc73e7h8qg` failed before extraction with `Release archive unavailable: 504`. The running game and production deployment were not changed by those failed builds.

`download-game-base.cjs` now loads a SHA-256 verified `vendor/game-base.zip` cache, or reuses `verified-game.zip` when available. An explicit `SB_BASE_ARCHIVE` remains supported and must match the same hash. A missing or invalid explicit override fails closed. Cache availability is an optimization; Render cache retention is not assumed.

An empty-cache build makes at most four download attempts. Each attempt times out after 45 seconds and the backoff is 1 / 2.5 / 5 seconds. Temporary HTTP 408/425/429/500/502/503/504 and network/stream failures retry. Later requests use fresh query parameters to avoid cached gateway errors or expired redirects. Starting with attempt three, the loader uses the official public GitHub asset API for asset `693667821`, the same `Shinobi-Bombers-Render.zip` release artifact. No API token or third-party mirror is needed. Permanent errors and checksum failures stop the build.

Downloads are bounded to 256 MiB. Only bytes matching `b1833d4d77bc7845e01c02215a4715203cd82767bc3c432d4aba80f708e298c2` are cached, and cache writes use a temporary file followed by rename. `unpack.cjs` retains its independent immutable hash check before calling the existing bounded, traversal-safe ZIP extractor. Gameplay patches and their order are preserved.

Successful extraction produces `/play/build-integrity.json` with `archiveLoaderVersion:1` and the verified hash, for post-deployment checks. It contains no credentials or wallet data.

Validation: the new isolated download suite covers transient errors, timeouts, fallback routing, bounded attempts, permanent failures, cache reuse, explicit overrides, corrupted bytes and size limits. A real empty-cache download reproduced two HTTP 504 responses, recovered through the official API, and verified all 53,810,393 bytes against the original hash. Clean rebuild, integrity marker, lint, the 48-team rewards guard, all 63 game suites and all 20 website checks passed. The downloader suite was also rerun after verifying active cancellation of rejected responses. No gameplay or economy changes are included.

Release scope: beta `main` only, from `review/archive-download-beta-2026-11-08`. Production `live` remains excluded. No environment variables, wallets, credentials or paid resources are changed.

Modified files: `download-game-base.cjs`, `unpack.cjs`, `tests/archive-download.cjs`, `tests/run.cjs`, `PATCH_NOTES.md`, `PROJECT_STATUS.md`, and this document.

Protocol reference: [GitHub release-asset API binary downloads](https://docs.github.com/en/rest/releases/assets#get-a-release-asset).
