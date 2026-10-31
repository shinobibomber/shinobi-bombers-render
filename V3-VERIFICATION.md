# V3 verification record

1 November 2026. Scope: incremental V3 slice on `v3/integrated-redesign-2026-11-01`, based on `a68984bc83ebbc53c0ecfcaf71b841dc24f307db`. This record does not assert that full V3, multiplayer services or live token settlement are complete.

## Checks executed

| Check | Result and scope |
| --- | --- |
| Strict TypeScript | Passed, including unused locals/parameters. |
| Source hygiene lint | Passed: rejects unsafe HTML injection, type suppressions, `any` and debug logging in React source. This is a custom checker, not ESLint. |
| Production frontend build | Passed: bundled production React and compiled Tailwind, then assembled application through all 21 ordered helpers. |
| Node versions | Full `npm run build:local` passed with local Node 26.13.0; explicit Node 22.23.4 TypeScript/build, verified archive extraction, all integration helpers, HTTP smoke and regression runner also passed. Render remains configured for Node 22. |
| Archive safety | Passed: file contents, absolute paths, traversal, backslashes, duplicate paths and symlink rejection. SHA-256 pin retained; five V3 helpers reapply without changing/duplicating generated HTML. |
| Production frame contract | Passed: opaque posters/empty textures rejected; PNG dimensions, alpha, CRC, paths, anchors, frame bounds, direction/clock and visual-only event rules validated. |
| Node HTTP host | Passed: real server serves health and V3 assets, refuses private paths and handles an unavailable API without exposing source. |
| Shared interface/Chest | Passed: login gate; one Chest on nine existing routes, nested Sensei, Guild, Chat and Codex; closing preserves route/game state; claim/deposit/withdraw/history use native service entry points. |
| Financial UI safety | Passed: failed claims remain errors, a double click submits once, History reuses the same manager, old withdrawal responses cannot repopulate a disconnected account. |
| Summoning/Reveal | Passed: quantities 1/5/10/15, totals 25,500/127,500/255,000/382,500 including existing fee, saved result IDs, no reroll/duplicate charge, ten results in a 5×2 desktop grid, mobile/reduced motion. |
| Marketplace | Passed: all five rarity filters including Legend, ten-card pagination, search/elements/details, owned-token restriction, one practice cancellation/return, no server balance/ownership mutation, mobile two columns and visible portraits. |
| Native Adventure | Passed: 31×17 grid, 40-unit tiles, all eight themes keep 120 solid cells and target identity; no screenshot-floor calls or old eight-map image downloads; movement/BFS, retained cardinal blast stopping and unchanged active ranged damage/energy/rewards checked. |
| Animation adapter | Passed: eight models × five independent ranks, neutral Genin aura without body changes, quality setting persistence, directions/actions/scrubbing, six accurately labeled single-pose bosses and reduced motion. |
| Codex/capability screens | Passed: eight Codex topics, search/perk sort/FAQ/rank/element actions; nine Guild sections and eight Chat channels with unsupported mutations disabled. |
| Existing fusion/Sensei | Passed: chance boundaries, Elite level 10, failure input/fee consumption, partial batches, minimum two Heroes, persisted idempotent settlement, saved threshold/on-off and offline eligibility. Server tests use in-memory PGlite. |
| Visual review | Desktop and 390×844 mobile screenshots inspected for Home, Login, Chest, Shrine and Adventure; blank Home and hidden login label regressions fixed and covered by assertions. No browser errors in the regression suites. |

All nine suites in `qa/run.cjs` passed. The two affected interface/Chest suites were rerun successfully after the final visibility fixes. `npm test` additionally covers archive safety, the production animation contract and the HTTP host.

## Dependency audit

Root build tooling, React UI and QA dependency audits each reported zero known vulnerabilities at verification time. The old extractor's reported link traversal flaw was removed by replacing it with a bounded file-only extractor using pinned `yauzl` 3.4.0; archive integrity remains pinned before extraction.

The inherited application Solana SDK dependency tree still reports **9 findings: 3 high and 6 moderate**. These include `bigint-buffer`, `uuid`, `stream-json` and dependent Solana packages. The audit proposes incompatible SDK changes or a downgrade; those were not blindly applied to custody/settlement code. This remains a release risk requiring a separately tested SDK migration. The beta is not presented as production-ready or audit-clean.

## Not executed / not established

- No real wallet signing, Solana deposit/withdraw/purchase, funded transfer or live database test was performed for this branch. Browser tests use isolated simulated API/wallet responses; they verify UI integration and safety behavior, not external settlement.
- `npm run build` includes existing live database initialization and was not run against private credentials. `build:local` verifies the production build and application assembly without that external step.
- No load/soak benchmark, mobile hardware profiling, complete assistive-technology audit or universal-device guarantee is claimed. Effects quality and reduced motion are implemented and tested; exact FPS targets remain unverified.
- General moving-enemy AI and an active classic bomb-placement/fuse/chain mode were absent from the current active combat implementation. Testing preserved bomb primitives does not establish those features. No silent combat replacement was made.
- Shared Marketplace, Guild, real-time Chat, NFT settlement and missing production animation/tile assets remain unavailable as detailed in the status reports.

The live beta was not redeployed by this V3 slice. Use the packaged setup and review branch to continue safely.
