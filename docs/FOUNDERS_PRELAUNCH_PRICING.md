# Founder prelaunch pricing — prepared 2026-11-09

Release prepared in the existing `tmp/founders` checkout. The owner authorized live deployment
on 2026-11-09 and confirmed Kyle's Render workspace. Independent read-only financial/security
review found no release-blocking issues and independently reran the Founder server tests.

New reservations cost 0.7 SOL for Mythic and 0.25 SOL for Legacy while
`PRELAUNCH_MODE=on` and `RELEASE_STAGE` is `portal`, `private`, or unset (portal default).
The approved public-game transition (`PRELAUNCH_MODE=off`, `RELEASE_STAGE=public`)
restores 1 SOL / 0.5 SOL for all remaining slots. Missing/invalid configuration
does not grant a discount; existing startup checks still refuse invalid Mainnet release settings.
Opening NFT sales alone does not end the discount or open the game.

This replaces the serial-based Mythic early-bird offer for new reservations.
Supply stays 33 Mythic / 30 Legacy, with one Founder box per wallet across tiers.
Existing purchases and pending transactions keep their agreed price and signed bytes.
Expired reservations release their slots at the current price. No inventory reset,
reward, entitlement, revenue destination, Beta configuration, or game-access change.

`MIGRATION_V3` replaces only the named Founder receipt-price constraint. It accepts
the new exact tier prices and all historical valid prices (including 0.5 SOL Mythic
serials 1–3). V2 recognises V3 so repeated schema initialization cannot restore the
old restriction. The build applies V2 then V3. Tests cover v1/v2 history, repeat
migrations, invalid amounts, signed transaction amounts, and launch-time recovery.

The sale page and EN/PT-BR terms explain both phases. Server-driven offer banners
appear above both posters, whose printed amounts remain the regular prices.
If launch raises the price after a stale page was loaded, the existing checkout
requires another explicit buyer action before requesting a signature.

Independent review and owner approval required by AGENTS.md are complete. Deploy only
these pricing changes to `live`; unrelated economy work in the shared checkout is excluded.
Keep current sale switches and release-stage settings. Pause sales for rollback; do not rerun older V2-only schema code after
V3, because its unexpected-constraint guard will refuse the newer constraint.

Validation: `node tests/founders-server.cjs`, `node tests/founders-prelaunch.cjs`,
`node tests/founders-pricing-ui.cjs`, `npm run check:rewards`, syntax and diff whitespace checks passed. Browser checks cover English/Portuguese desktop/mobile displays, sold-out controls and stale-price buyer confirmation. Payment tests use
in-memory PostgreSQL, mocked Solana RPC, and real SDK transaction decoding/signatures.
The exact pricing-only release snapshot also passed the clean Mainnet build on Node 22.23.4,
including the complete assembly pipeline, payment/migration tests, browser checks and the
real-time rewards guard. Local migrations ran only in disposable in-memory databases.
Render's normal deployment build applies V2/V3 using its existing database connection.
Verify `/healthz`, public `founders-info` prices, remaining inventory, and closed game routes
after the specific release deploy becomes live. Sales were off during the pre-deploy check;
24 Mythic and 30 Legacy slots remained. No real purchase is part of verification.

Final release verification: the clean Devnet regression fixture passed the HTTP sale
suite and the unchanged 78-file preservation guard. Only the generated schema baseline
hash changed: independently reversing the V2 compatibility edit and removing V3 restores
the exact previous schema hash. Windows archive text was restored to committed bytes
in the isolated fixture; no preservation assertion or other frozen hash was changed.
