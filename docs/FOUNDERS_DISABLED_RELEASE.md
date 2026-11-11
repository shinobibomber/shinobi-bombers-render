# Founder package: disabled live release, 2026-11-09

Approved scope: deploy the full Founder package with public sale, private testing,
reward redemption, and SOL Sensei purchases OFF. No mint authority is created for
this release. Existing release stage, wallet allowlist, network, and other launch
gates remain unchanged.

The release excludes `founders/public/art/mythic.png` and `legacy.png`, which are
local Devnet test artwork. Public NFT image URLs therefore return 404 until final
artwork is approved and released. The existing promotional posters remain visible.

The payment fix requires a buyer signature over the stored transaction message,
finalized successfully. Mint account existence cannot grant an entitlement.
Unreported payments recover through paginated mint transaction history; incomplete
or unavailable evidence leaves the purchase pending.

Independent read-only review found no blocker for this initial disabled release.
Before opening paid flows, address bounded Sensei reference recovery and the legacy
Mythic Box account-existence recovery fallback; inspect any existing pending legacy
reservations. Mainnet NFT art approval, a dedicated mint authority, the Devnet paid
end-to-end exercise, and the commercial/legal checklist remain activation gates.

Even while switches are OFF, old Mythic Box minting is retired and Mainnet Ryo
Sensei hire/rental purchases are removed. Existing memberships remain unchanged.

Local build validation does not connect to production Postgres. Schema correctness
and idempotency are exercised with isolated Postgres-compatible fixtures. Render's
normal build applies the additive schema using its existing database connection.
The owner confirmed recovery-point reference `026-11-08T21_58Z` in this deployment
session (recorded verbatim). Backup inspection through the connector is unavailable;
the confirmation is owner-provided, not an independently verified backup listing.

Rollback source: b24ae4c371e1a78ac80ded62c81f50d396da632b. The additive tables can
remain in place if that prior application version is restored.

## Local validation

Follow-up: the owner subsequently approved paid launch, clean poster crops,
and Founder benefits claimable inside the game once it opens. See
[paid-launch preparation](FOUNDERS_PAID_LAUNCH.md) for current status. This document
records the initial disabled release.

- Devnet and Mainnet builds and their real-time reward guards passed. Mainnet
  used `https://shinobibombers.onrender.com` as its required metadata origin.
  Direct build commands used Node 22; the installed npm launcher reported Node 26
  during dependency installation. Render performs the production Node 22 build.

- All 82 regression suites passed under Node 22.23.4 across the full run and
  targeted reruns. The Creator portal initially timed out under concurrent browser
  load and passed unchanged in isolation. The landing-page test was updated to
  assert two announcements and verify the new closed-sale notice.
- All 20 website checks and `npm run test:server` passed.
- The 78-file preservation guard passed without weakening frozen hashes. Windows
  checkout line endings were aligned with Git blob bytes before validation.
- Founder bypass, recovery, expiry, and entitlement tests passed; the original
  implementation failed the SOL-funded-system-account regression as expected.
- Independent security and final release-file reviews found no blocker for this
  disabled release. Deferred activation findings are listed above.
