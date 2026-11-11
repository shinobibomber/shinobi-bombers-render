# Performance work — report (2026-11-11)

Branch `feature/performance-optimization`, worktree `tmp/perf`, based on production `f0b62b7`. **Nothing is committed, pushed or deployed.** No gameplay, combat, reward, Chakra, wallet or treasury code was changed. Server money paths were deliberately left out (see section 6).

> **Correction (2026-11-11, after deploy).** The compression numbers above were measured against the origin server on its own. In production the site sits behind Cloudflare, which already compresses responses at the edge: the test server (old code, no compression) also answers `Content-Encoding: br` through Cloudflare, and the deployed `/play/` is 2.59 MB on the wire. So **players behind Cloudflare get little or no extra saving from `server/compress.cjs`**; it only helps requests that hit `onrender.com` directly. It is harmless and was left in. The Fusion/Heroes/AUTO gains are browser measurements and are unaffected. The deployment-checklist item about the game API having no `Content-Encoding` cannot be read through Cloudflare, because the edge adds it; the unit tests prove the origin never touches POST.

## 1. How it was measured

- `tools/perf-bench.cjs`: drives the real built game in Playwright Chrome against the isolated fixture server. One account with 376 heroes. Profiles: desktop (1440×1000) and phone (390×844, DPR 2, **4× CPU throttle**, touch).
- Scenarios: main menu idle, Adventure with 10 deployed heroes fighting, Heroes (376), Fusion (211 Genin in Reserve), and 21 menu transitions.
- Per scenario: rAF frame times (FPS, median, p95, p99, max, frames over 33 ms), long tasks, main-thread/script/style time from the DevTools Performance domain, JS heap after GC, DOM nodes and canvases.
- Also: `tools/perf-profile.cjs` (CPU profile with caller attribution), `tools/perf-anims.cjs` (running animations by property), `tools/perf-ab.cjs` (CSS A/B experiments).
- The "before" is the untouched live build (`tmp/expedition`) measured with the identical tool. Same machine, run one after another.
- **Caveats:** headless Chrome with software rendering and a synthetic CPU throttle, not real phones. Run-to-run noise is about ±2 FPS and ±1 frame band. An early "Adventure p99 improvement" turned out to be noise when I re-measured the live build, and is **not claimed**.

## 2. Results

| Metric | Before | After | Change |
|---|---|---|---|
| Main menu idle FPS (desktop / phone) | 59.8 / 59.8 | 59.8 / 60 | none (already at the display rate) |
| Adventure, 10 heroes, desktop FPS | 59.8 | 59.8 | none (already at the display rate) |
| **Adventure, 10 heroes, phone FPS** | **29.2** | **38.5 and 45.6** (two runs) | **+32% to +56%** |
| Heroes, 376 heroes, phone FPS | 29.0 | 36.5 and 39.4 | +26% to +36% |
| **Heroes tab opens, desktop** | **1,149 ms** | **590 ms** | **−49%** |
| Heroes tab opens, phone | 5,780 ms | 3,140 to 4,050 ms | −30% to −46% |
| **Fusion, phone FPS** | **5.5** | **26** | **×4.7** |
| Fusion, phone p95 frame time | 317 ms | 100 to 117 ms | −63% |
| Fusion, desktop FPS / p95 | 38.5 / 83 ms | 46 / 50 ms | +20% / −40% |
| Fusion DOM nodes / canvases | 7,404 / 494 | 5,627 / 312 | −24% / −37% |
| All menu transitions, p95 (desktop / phone) | 1,149 / 5,780 ms | 626 / ~4,000 ms | −46% / −31% |
| JS heap after transitions | 8.7 MB | 8.7 MB | none |
| Origin transfer without a CDN: HTML + JS + CSS + JSON | 5.90 MB | 3.01 MB (brotli) | −49% **on the origin only; see correction below** |
| Game page `/play/`, origin without a CDN | 3.81 MB | 2.47 MB (brotli) | −35% **origin only** |
| Other text assets, origin without a CDN | 2.09 MB | 0.54 MB | −74% **origin only** |
| p99 frame time, desktop (all screens but Fusion) | 16.8 to 17.2 ms | 16.8 to 17.0 ms | none |
| API latency | NOT MEASURED | NOT MEASURED | no server API code changed |
| Initial load time in a real network | NOT MEASURED | NOT MEASURED | only bytes were measured |
| Real Android / iPhone / tablet | NOT MEASURED | NOT MEASURED | emulation only |
| Firefox / Safari engines | NOT MEASURED | NOT MEASURED | Chrome only |
| 1 h / 3 h memory sessions | NOT MEASURED | NOT MEASURED | only short-session heap (flat at 8.7 MB) |
| 120 Hz displays | NOT MEASURED | NOT MEASURED | headless runs at 60 Hz |
| Concurrent-player staging load test | NOT MEASURED | NOT MEASURED | no staging server (test server is behind live) |

I do not claim 60 or 120 FPS anywhere it was not measured. On this machine the desktop screens already run at 60 FPS in these fixtures, so the gains are on constrained devices and heavy screens.

## 3. What changed (all visual/UI/delivery; source-of-truth files)

| Change | File(s) | Effect |
|---|---|---|
| Fusion Reserve list windowed (visible rows plus 4 overscan, fixed 60 px rows); canvases only for visible rows; scroll and click delegated | `website-design/website-design.js`, `website-design.css` | Fusion DOM/canvases −24%/−37%; no more all-rows repaint every 520 ms |
| Native `#p1`/`#p6` text and control list cached until the native DOM changes (MutationObserver, pending records checked synchronously, cache dropped on screen change); `fusionRows` reuses it | `website-design/website-design.js` | removes a whole-list `innerText` layout per paint tick |
| `--hero-backdrop` (a 205 KB data URL) set once on the shared parent instead of on every card | `heroes-design/heroes-design.js` (**hash-frozen**, hash updated in `tests/baseline-hashes.json`) | Heroes tab entry −49% |
| AUTO low-effects: if the median frame time stays over 30 ms for 4 s, decorative ambient layers pause and the layer's existing "effects paused" state is used (hero frames, auras, rims); it releases when the median stays under 22 ms for 10 s | `website-design/website-design.js`, `website-screens.css` | phone Adventure +32% to +56% FPS |
| `resize` coalesced to one `fit()` per frame; 700 ms layout sync skipped while the tab is hidden | `website-design/website-design.js` | less layout work |
| One `matchMedia` list instead of one per projectile per frame | `combat-rules/client.js` | removes a per-frame allocation |
| Expedition Hall: O(1) hero lookups, long lists shown 60 cards at a time | `expedition/expedition.js` | the Hall no longer builds a card and canvas per hero |
| gzip/brotli for qualifying GET text responses, cached per content, ETag/304 intact | `server/compress.cjs`, `server/site-server.cjs` | −49% text transfer |
| Tools | `tools/perf-bench.cjs`, `perf-profile.cjs`, `perf-anims.cjs`, `perf-ab.cjs` | repeatable measurements |
| Tests | `tests/perf-ui.cjs`, `tests/compression.cjs`, `tests/run.cjs` | see section 5 |

**Visual-only guarantee.** Quality state never reaches gameplay: `tests/perf-ui.cjs` asserts that hero Power/Speed/Stamina/Chakra and `CombatRules.cooldown` are identical before and after AUTO engages. Nothing changes attacks, kills, Chakra or rewards, and no kill event is dropped.

## 4. Findings that matter for the owner

- **An idle Home menu costs about 23% of the main thread**, and Adventure about 47%, mostly from decorative CSS animations (A/B: all animations off took Home from 236 to 85 ms/s, Adventure from 468 to 259). The `filter` glows and the ambient petal/ember layers are the largest. This is what AUTO pauses on weak devices; on capable devices they keep running.
- **Attack timing is slightly frame-bound.** The client discards the cooldown overshoot (`h.cd = cooldown` after an attack), so a faster display can attack up to about 3% more often than the nominal rate. The server caps accepted attacks at the nominal rate (`actionBudget`), so **a high-refresh display cannot earn extra Ryo.** I did not change this, and I did not add sub-stepping, because that would raise the attack rate.
- **The Fusion and Heroes screens still build the whole native list underneath** (the base game's `FusionUI.render` and `heroes-design` `decorate`). Entering Heroes still takes about 0.6 s on desktop. Fixing that means changing base-game code or the pinned files further.

## 5. Verification

- Full regression: 132 suites, 131 passed. One failure, `render-performance` (35 portrait repaints against a limit of 33), **passed 9 of 9 reruns** (alone and under load, on both the live build and this branch), so I treat it as a one-off timing flake. It is borderline by construction, so it may recur.
- After the last change I reran: `perf-ui`, `adventure-performance`, `render-performance`, `hero-card-frames`, `hero-portrait-glow`, `expedition-ui`, `mobile-layout`, `smoke-sweep`, `preservation` and `check:rewards`. All pass.
- New `tests/perf-ui.cjs`: windowed Fusion list (DOM size, scroll to the last hero, portraits painted on scroll, selecting rows drives the game's checkboxes, the cached pick counter is never stale), shared Heroes backdrop on every card, Expedition paging, AUTO engages only when slow, pauses decorative layers and effects, releases, gameplay values identical.
- New `tests/compression.cjs`: br/gzip only for qualifying GET text; exact bytes; ETag and 304 intact; cached per content; images, HEAD, POST (the game API), tiny and pre-encoded bodies untouched; verified on the real site server.
- Not verified by test: enemy-defeat counts and Chest amounts are covered by the existing suites (`realtime-rewards-guard`, `live-rewards`, `combat-*`, `offline-sync`), which pass unchanged.

## 6. Deliberately not done, and why

- **Server money paths** (owner decision: later, as an Economy & Security task with review): the full-table `SUM(claimed)` over every player's Adventure row on each sync, the purchase-income scan, unconditional profile/Chest rewrites, and `state()` running about 12 sweeps per call.
- **Offline Sensei CPU** (about 0.5 s per player per 12 h): a bit-identical speed-up (memoizing per-hero stat functions, skipping redundant `setResting`) is feasible but needs a randomized differential test against the unoptimised copy. Not started.
- **Hidden-tab polling** (`adventure` every 15 s, `expedition` and `pass-state` every 60 s): the hidden-tab sync also carries the go-offline report, so it needs a careful design, not a blind pause.
- **Adventure canvas internals** (per-particle gradients, enemy frame lookups allocating a `Map` per enemy per frame, `BattleRoster.list()` on every tick): they live in hash-frozen files or base-game inline code and need a new patch step plus a differential check of the reward-guard anchors. In the profile, Adventure JS is only about 4% of the time; the rest is rendering.
- **Asset delivery:** the 3.1 MB base64 art inlined in `index.html` and the inlined 440 KB SDK, about 4 MB of duplicate images, content-hashed immutable URLs, and render-blocking Google Fonts. These need build changes and visual regression.

## 7. Deployment checklist (for later approval)

1. Review the diff (`git diff` in `tmp/perf`; line-ending noise in `git status` is not real).
2. Run the full regression once more on the final commit.
3. Confirm the one hash-frozen change is intended: `heroes-design/heroes-design.js` (one line, moved to the parent) and its entry in `tests/baseline-hashes.json`.
4. After deploy, check `Content-Encoding: br` on `/play/` and `/whitepaper`, that a second request with `If-None-Match` returns 304, and that the game API responses carry no `Content-Encoding`.
5. Watch Render CPU for the first minutes: each distinct file is compressed once (brotli quality 5, in a worker thread), then served from a 64 MB cache.

## 8. Rollback

- Whole change: redeploy the previous commit (`f0b62b7`). No schema, data or setting changes.
- Compression only: remove the two lines in `server/site-server.cjs` (the `require` and `compressible(req, res)`); nothing else depends on it.
- AUTO low-effects only: it is automatic and leaves the player's own display settings untouched; remove the `autoQuality` block in `website-design/website-design.js` to disable it.
- Whether Render scaling is needed: **not evidenced by this work.** The server side was not load-tested (no staging server). The known server risks (section 6) grow with player count and are a separate task.
