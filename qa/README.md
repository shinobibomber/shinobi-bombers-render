# V3 regression checks

Run `npm ci`, `npm run build:local`, `npm --prefix qa ci`, then `npm run test:browser` from the repository root. Chrome must be installed. Tests use Playwright's `chrome` channel, isolated browser storage, temporary local HTTP servers, and a simulated wallet/API. They do not connect to Render or transfer tokens. Server tests use PGlite in memory.

`npm test` runs the archive safety and animation contract tests with Node alone. `npm run typecheck` and `npm run lint` check the React TypeScript source; lint is a custom source hygiene checker, not ESLint. `npm run build:local` runs the production frontend build and all ordered integration helpers without requiring a database.

The two harness files `test-adventure-reference.cjs` and `test-ryo-browser.cjs` are imported as fixtures; the runner deliberately does not execute their historical assertions directly. No fixture records enter application source or production accounts. Preview images and temporary test bundles are written to `previews/` and `tmp/`, both ignored.

Live wallet signatures, real Solana settlement and external PostgreSQL connectivity need separate configured Devnet checks. Passing these suites does not establish those external services or finish the remaining V3 modules.
