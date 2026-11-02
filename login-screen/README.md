# Supplied login and loading artwork

The two 1536 × 1024 PNGs are copied without editing from Design 13 of the user's
`Shinobi_Bombers_V3_REVISED_Complete_Birthday_Codex_Pack`:

| Source | Repository file | SHA-256 |
| --- | --- | --- |
| `login_enhanced_reference.png` | `login-screen/login-reference.png` | `95e6f1afddb32b71e4bc5414518ed7bef509f468ef4ff84591d8291451cc35e1` |
| `loading_enhanced_reference.png` | `loading-design/loading-reference.png` | `fcdca38ba5926100306824e0e372258f69f3d72bc8815e708423aa7a3515c3e7` |

The desktop login displays the supplied image intact with the existing Phantom,
Solflare and configured community controls aligned over it. Status/errors and keyboard
focus remain real DOM content. No new wallet handler, signature, transaction, session
store, or balance code is introduced. Unconfigured community links remain disabled.
Portrait phones crop the center to keep wallet controls at least 44 pixels high.

Loading retains its supplied composition. Only the pictured percentage and progress
bar are covered with live values; the native status is also shown below the image.
The three native milestones track initial setup, sprite plus required artwork readiness,
and font completion. These are initialization milestones, not download-byte estimates.
There is no fixed 75% or deliberate minimum delay. Required image failures hold the
screen with an explicit error and a Retry loading button that reloads the existing page.
The normal native transition and reduced-motion preference remain in control.
The enhanced scene and its critical styles are now emitted into the initial HTML, with
an image preload, so slow deferred scripts cannot flash the legacy dark loading screen.
The runtime reuses that scene and decoded image. Progress animates a transform instead
of changing layout width, and observers are disconnected when the screen is removed.

`apply-login-screen.cjs` and `apply-loading-design.cjs` copy these files into generated
`app/`. The loading helper exports five reviewed startup hooks; preservation tests
reverse only those hooks before checking the existing inline game modules. Authentication,
backend, ownership, currency, combat and persistence remain unchanged.

Run `npm.cmd run build:local`, `npm.cmd test`, and `npm.cmd start`; open
http://localhost:10000/play/. `tests/login-loading.cjs` uses isolated fixture wallets,
checks desktop pixels and button alignment, both wallet choices, rejected signatures,
duplicate-click protection, mobile/keyboard/reduced-motion access, real startup gating
and missing-art retry. Screenshots are in `tests/out/login-*.png` and `loading-*.png`.
The existing wallet/server suites continue to verify their underlying behavior.

To roll back, revert this integration commit on main, rebuild and redeploy. No data
migration or player-data reset is required. Publishing still requires Render Manual Deploy.
