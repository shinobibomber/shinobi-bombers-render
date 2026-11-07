# Pre-launch wallet security review

Date: November 7, 2026 (Asia/Singapore).
Status: **local review changes only; not pushed or deployed**.
Branch: `review/prelaunch-wallet-security-2026-11-07`.
Base: `e34bb8291e3afd2174a1365b2fcad69ee11e8f21`.

## Reported warning remains unresolved

The owner supplied this warning:

> Continue at your own risk
> This site shows signs of phishing or wallet-draining activity. It may request transactions designed to steal your funds.

The exact wallet/browser version and warning-page URL were not supplied. The request places
MetaMask support on hold; it does not establish which detection provider produced this alert.
This review **does not establish a false positive, remove a domain classification or certify
the deployment free of compromise**. Do not click through, disable wallet security, move the
site to evade a block, or use another wallet as a workaround for the warning.

MetaMask is filtered from discovery and cannot be selected by calling its former selector ID.
Other wallets do not auto-connect. An error containing phishing/drainer/security-warning text
stops sign-in with a stop-and-investigate message, without a second provider or signing fallback.
If the wallet displays its own warning without returning an error to the website, only the
wallet can show that warning; this interface neither reads nor overrides extension UI.

## Code changes

- `prelaunch/wallet.js`: Phantom first, Solflare second, other compatible Wallet Standard
  wallets after them. Standard discovery events and legacy Phantom/Solflare message signing
  remain supported. MetaMask names (including spaced variants) and `isMetaMask` providers are
  temporarily excluded. Provider metadata does not prove the identity or trustworthiness of an
  extension; a malicious injected extension remains outside the website's trust boundary.
- The adapter exposes discovery metadata, connection, text-message signing and disconnect,
  never transaction/spending methods. It checks Solana-capable accounts, exact SIWS format,
  requesting host and URI origin, wallet, version, chain, nonce and two-minute validity.
  Returned message mutation, wrong signature type, account change and stale signatures fail.
- `prelaunch/prelaunch.js`: recommendation and install states in English and Portuguese,
  explicit stop-on-warning notice, coalesced sign-in, disabled signing controls during prompts,
  cancellation/account-change handling and late-response rejection. A cancelled completed
  login triggers session logout; wallet changes clear the UI and request server revocation.
  Wallet triggers remain disabled until language/session startup finishes, preventing lost
  early clicks or a restored session racing with a new wallet login. Unreadable icons have
  a text-letter fallback rather than broken-image markers.
- `prelaunch/server.cjs`: retains server-stored one-time challenges, Ed25519 verification,
  hashed session tokens, one-hour HttpOnly/SameSite=Strict cookies (`Secure` on HTTPS), same-origin
  JSON/custom-header CSRF checks and existing rate limits. Adds canonical SIWS verification
  against this server's configured origin/network and refuses signatures exactly at expiry.
  Malformed cookie encoding now returns a sign-in error instead of a server exception.
- `server/site-server.cjs`: pre-launch assets/pages receive CSP allowing only same-origin
  JavaScript and API connections, no inline JS, no object embeds, no framing and no base-URI
  changes; existing Google font CSS/font origins are allowed. Adds DENY framing and HSTS on
  the HTTPS-configured portal. The game and whitepaper retain their separate policies.

No database migration, account conversion, referral rewrite, token creation, RPC key change,
wallet spending request or Render configuration change is included. Mainnet/Devnet economy
selection is unchanged. `/api/ryo` remains 403 in pre-launch, `/play/` redirects and `/admin/`
is unavailable. The pre-launch API has no deposit or withdrawal handler, regardless of a
client-supplied action or a wallet's advertised transaction capabilities.

## Script and live-artifact inspection

Read-only HTTPS GETs on November 7 at 20:19:49 Singapore time fetched the production root and
its two script files. Their content matched base commit `e34bb82` after LF normalization:

| Artifact | Normalized SHA-256 |
| --- | --- |
| `/` (`prelaunch/index.html`) | `a36747987a6f4dbb78fe710e039c4b88c35c6c29a3432d294c9a5f4b5ad21e98` |
| `/pl/wallet.js` | `43cec44795e0061597b6202e4bf93c2d2c40147dd367577368448f17cc31e639` |
| `/pl/prelaunch.js` | `0902c5ab2babde4210f5e52b8f7a745c874ff643ad6ad592406465aba31a3875` |

No unexpected JavaScript tags or remote JavaScript loaders were found in the inspected
pre-launch entry page or source. Its scripts are same-origin `/pl/wallet.js` and
`/pl/prelaunch.js`. Legal pages load only the latter. No portal `eval`, dynamically compiled
code, remote RPC, tracking pixel loader, service worker or transaction builder was found.
Dynamic names/content use text nodes; external links are HTTPS-filtered and use `noopener`.
Wallet icons are bounded data images, rendered with `<img>` rather than injected markup.

Existing external resources are Google Fonts CSS and font files; these are not JavaScript.
Wallet download links go to Phantom/Solflare, and configured community/demo links navigate
only after user action. The website/game demo and whitepaper include separate scripts and
financial illustrations; pre-launch never mounts the game's money scripts. No automatic
user-upload/image processing endpoint was found. Build extraction and frozen-asset checks
are part of the existing test suite, but are not a complete supply-chain forensic audit.

The fetched production response lacked CSP. This patch adds CSP locally; the response above
describes the **old deployed code**, not evidence that the new protections are already live.

## Dependency audit: outstanding findings

`npm audit --json` queried separately for the root, generated `app`, `chest-ui` and `tests`
lockfiles. This is an advisory scan, not proof of reachable exploitation or compromise.

| Workspace | High | Moderate | Notes |
| --- | ---: | ---: | --- |
| Root | 1 | 0 | `sharp@0.34.5`, bundled native image libraries |
| Generated game app | 3 | 6 | `bigint-buffer`, Solana dependency paths, `stream-json`, `uuid` |
| Chest UI | 0 | 0 | No current audit findings |
| Tests | 0 | 0 | No current audit findings |

Root image processing is used by asset/build tooling, not registration. The game dependencies
are also imported by the pre-launch authentication modules, although no on-chain transaction
or RPC API is mounted. This review has not established exploitability of every transitive
advisory. The `bigint-buffer` native overflow and parser issues deserve a separate dependency
remediation review before enabling Mainnet money features. Do not run `npm audit fix --force`:
the suggested Solana fixes include API-breaking upgrades or an old SPL-token downgrade.

Primary advisory details returned by npm:

- [sharp/libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj),
  [libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c),
  [librsvg](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
- [bigint-buffer overflow](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg).
- [stream-json filter DoS](https://github.com/advisories/GHSA-528h-pc64-c93x),
  [comment parser DoS](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x),
  [prototype pollution](https://github.com/advisories/GHSA-mjw6-4jj6-33hc).
- [uuid buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

## Validation and remaining review

Targeted tests use real Ed25519 signatures with isolated PGlite and fake browser providers,
not real wallets or transfers. `prelaunch-wallet-security.cjs` covers discovery policy,
generic Wallet Standard compatibility, exact challenge validation, message mutation,
account changes, stale signing, MetaMask exclusion and zero transaction calls.
`prelaunch-page.cjs` covers registration/referral continuity, Phantom/Solflare paths, warning
rejection, cancellation and CSP blocking on desktop/mobile in both languages. Screenshots
are written to `tests/out/wallet-selector-desktop.png` and `wallet-selector-phone-pt.png`.
The pre-launch server and network suites verify the production Mainnet host remains closed
to game/money requests and serves the new security headers.

Final verification on Node 22.23.4:

- `npm run lint`, `npm run check:site`, `npm run check:rewards`: **pass**.
- `npm run test:site`: **pass**, all website/game-link checks.
- All **52 runner suites passed across the full runs and targeted reruns**. The last full
  `npm test` run passed its first 48 suites, then stopped because the added origin-rejection
  fixture reused an account still inside the existing three-second challenge rate limit.
  That test now uses its own wallet; the rate limit was not changed. The remaining four
  suites (`prelaunch-server`, `prelaunch-creators`, `prelaunch-page`,
  `prelaunch-wallet-security`) were rerun and all passed. This was not a single uninterrupted
  green `npm test` run; the failures and reruns are disclosed here for review.
- The final pre-launch browser suite passes **17 checks**, including startup readiness,
  registration/referral/account continuity, both wallet paths, warning/cancellation handling,
  stale registration responses, external-script inventory and enforced CSP.
- Desktop/mobile selector screenshots were inspected, including Portuguese and icon fallback.
- No real wallet, transaction, spending approval or SOL transfer was used. No generated-file
  edits, frozen-hash changes, dependency updates, database migrations or Render changes.

The first full run stopped on the existing `live-rewards.cjs` GO OFFLINE assertion: the
fixture saw an `active:false` Adventure request followed by `active:true`. That unchanged
suite passed when rerun separately. Neither gameplay/kill-sync code, its guard, nor that
assertion was modified for this wallet patch. This is an intermittent existing gameplay
sequencing concern for a separate follow-up, not evidence that the reported wallet warning
has been explained. The initial failure is retained in `tests/out/wallet-security-full-test.log`
and the isolated pass in `tests/out/wallet-review-live-rewards-rerun.log` (local ignored logs).

Before any future release: review the diff and dependency findings; reproduce the exact warning
in the affected wallet/browser with its URL and classification details; request review through
the wallet's official support path if appropriate. No external report has been submitted.
Native browser-extension/mobile testing is still needed: injected fixtures cannot verify
extension reputation systems, mobile app handoff or the warning's cause. Preserve the fixed
`RYO_SCOPE` and existing Render pre-launch settings when an explicitly approved release is made.

References: [SIWS specification](https://github.com/phantom/sign-in-with-solana),
[Phantom message signing and domain validation](https://docs.phantom.com/solana/signing-a-message),
[Wallet Standard registration](https://github.com/wallet-standard/wallet-standard/blob/master/packages/core/wallet/src/register.ts),
[MetaMask security-alert review](https://support.metamask.io/configure/wallet/security-alerts).
