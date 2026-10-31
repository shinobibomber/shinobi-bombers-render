# V3 architecture, Adventure and economy audit

Inspected 1 November 2026. This is a source audit, not a claim that all gameplay acceptance tests passed.

## Active source and deployment model

The current source is `releases/current-render-repository/shinobi-bombers-render-2b5bc22c0d844faae3e0086548a79da87370bf1d`. The folder name is historical; deployment metadata points at commit `a68984bc83ebbc53c0ecfcaf71b841dc24f307db`. Root `source/` and the root standalone HTML are older snapshots and must not replace it.

There is no React/TypeScript/Tailwind application in the current deployed game. The frontend is a plain JavaScript/HTML/CSS canvas game. `app/public/index.html` contains ordered source sections; sixteen tracked `apply-*.cjs` helpers install additive asset modules and guarded native-code patches after `unpack.cjs` extracts a hash-verified base release. `app/` is generated and git-ignored. Committing changes only to `app/` would lose them on deployment.

The actual engine is custom Canvas2D, not Phaser/Pixi/Three. Global `S` holds client state; `G` is the tile grid. `go()` and numeric `tab` route existing sections. `S` persists in localStorage key `shinobi-bombers-v1`, with versioned `S.v2` fields; session earned Ryo uses sessionStorage separately. The renderer and later modules wrap global functions, so order matters. `ShinobiSprites.ready` chains deferred assets, with login/loading gates waiting for the complete chain. Existing exact-layout modules often layer live controls over reference screenshots; they can be reused as adapters but are not reusable React components.

Backend: Node22 CommonJS HTTP server, same-origin JSON API at both `/api/ryo` and `/.netlify/functions/ryo`. PostgreSQL (`pg`, existing Neon database) stores accounts, profiles, purchases, deposits, withdrawals, reward-pool settlement, adventures, sessions/challenges and presence. Public assets are served from `public/` only. No secrets were read for this audit.

## Critical gameplay discrepancy to disclose

Native base definitions include `blast()`, `think()` and `boom()` with placed bombs, a two-second fuse, cardinal cross-shaped propagation, walls stopping rays and destructible targets stopping each ray. However, the later `SOURCE: combat.js` **overrides active `think` and `boom`** with cardinal target-seeking ranged projectiles (0.35-second projectile life). Heroes pathfind to lines of attack; targets occupy `G` cells and are stationary. There is no active moving-enemy AI or general enemy-to-hero health damage system. `bombs` is also the name of the active projectile array.

The custom renderer observes these existing functions; VFX do not own damage. The proposed V3 UI must preserve the active ranged behavior and must not silently restore an older bomb mode. Full classic Bomberman placement/fuse/chain behavior and moving enemy AI require separately reviewed gameplay work. Existing `blast()` can be regression-tested as a retained primitive, but passing that test does not prove the current projectile mode is classic bomb gameplay.

Server `adventure.cjs` is authoritative for claimable/withdrawable rewards but is **an aggregate elapsed-time/DPS simulation, not the client grid combat simulation**. It does not accept client map, clock, damage or reward totals. It maintains its own energy/team, cycles four target HP bands and advances a map per20 server kills. Client stage/target state and server reward state can differ. Do not submit client victory totals to make them appear synchronized; that would break the existing trust boundary.

## Native map authority and prior screenshot adapter

- `W=31`, `H=17`, `T=40`, four cardinal directions.
- Native `newMap()` creates odd/odd solid blocks (`k=1`), walkable cells (`k=0`) and random targets (`k=2..6`), then places deployed heroes on available cells. No authored Tiled/LDtk stage files are present.
- `free()` rejects out-of-bounds, nonzero cells and occupied bomb cells. BFS uses the same predicate. The native clear condition is `left()===0`, then increments `S.map` and regenerates.
- Every25th client stage guarantees a prison guardian; other prisons are rare. Prism/ice/lava/curse artwork is not proof of hazards.
- Existing `map-design/map-design.js` currently draws a full battlefield illustration as the floor, disables wall drawing, and **replaces native `G` topology** using manually traced picture rectangles, relocating all targets/heroes. This conflicts with this new pack's explicit no-screenshot-map/no-topology-rewrite requirement.
- The pack supplies eight full illustrated concept boards, not true tiles or collision maps. Source filenames in some prose differ; actual preferred names are `map_01_user_approved.png`…`map_08_user_approved.png`.

For the V3 slice: preserve the old source snapshot, suppress the prior screenshot topology rewrite, and render floor/solid layers directly from the native grid using code-native themed art. Keep eight theme identities and existing renderer entities. Do not invent hazards or claim production tile atlases are available. A separate renderer-only adapter can leave `newMap`, `free`, `bfs`, `think`, `boom`, HP, rewards and server code unchanged.

## Economy and ownership that must remain unchanged

| Rule | Current authority/value |
| --- | --- |
| Network/token | Solana Devnet SPL, existing mint, six decimals; server validates genesis/mint |
| Wallet auth | Phantom/Solflare provider, signed nonce+origin+wallet+mint challenge; one-hour hashed server sessions |
| Summon |25,000 Ryo base per hero; quantities1/5/10/15; server RNG60/25/10/4/1% |
| Purchase allocation |2% studio fee added,10% of base treasury,10% burned,80% retained operations/reward funding |
| Fusion |3 same-rank Reserve heroes;90/80/70/60% by input rank; all Elite inputs level10;25,000 base+2% fee per attempt; inputs/fee consumed on failure; preserve two heroes worst-case |
| Hero bands | Power/speed/stamina1–3,3–6,6–9,9–12,12–15; Legend maximum; rank+1 projectiles/range/perks client |
| Roster |50 battle-ready,10 deployed; only owned valid token IDs may change server roster |
| Training |Max level10; server base round(5000×level^1.65×(1+rank×.45)) |
| Dojo |0..6;1/2/5/8/11/14/17 chakra/minute; prices0/1.8m/6m/13.5m/24m/37.5m/54m |
| Sensei |1,512,500 permanent base or250,000 for7days; saved50..90% return threshold; on/off saved;12h offline cap |
| Enemy bands |100/213/1000/1625HP; base35.625/81.25/406.25/812.5Ryo; client prison2500HP |
| Reward rate |Server pool50%,+10% per100,000 pool growth,capped100%; map thresholds100/200/etc reduce by10% of base to35% minimum |
| Deposit/withdraw |2% studio, whole Ryo; deposit min1000; withdraw min100,000, once per rolling24h, max1,000,000 |

Do not copy contradictory old Codex text such as “free fusion” into new content. Server purchases lock the account, reserve amount and generated outcome once, persist `profile_after`, and apply it only after finalized on-chain settlement; retries recover the stored order. Deposit receipts validate signer, source/destination/mint/amount/memo and final balances. Claims serialize pool updates, protect deposit/pending liabilities and move only funded whole Ryo into the account. Sensei changes settle old settings first and disallow changes during a pending purchase.

## Reusable components/systems

`RyoPayments`, `TokenCheckout`, shared Chest dialog/transfer/history and wallet status, `BattleRoster`, `Experience` persisted reveal, `FusionUI`, `HeroesDesign`10-per-page collection/detail dialog, `DojoServices`, `GameplayOptions`, `PlayerModels`, `TierAuras`, `CharacterAnimations`, `Arena3D`, `SessionRyo`, `GameLoading` and `LoginScreen` already exist. Reuse their actions rather than duplicating transactions.

Dojo/Sensei largely exist with real purchases and saved settings; remaining V3 work is responsive hierarchy, clear active/preview states and honest offline reporting. The current offline response includes aggregate seconds/pending/map but not a real historical per-session rotation report. Sensei skin thumbnails are concept artwork, not owned skin entitlements.

Marketplace is local listing escrow/cancellation only; token-owned heroes are explicitly blocked from trading without a shared authoritative market. There is no NFT mint/ownership program—token purchases recruit game entitlements. All ranks including Legend must remain eligible when a secure market is implemented, but do not enable client-side token transfers or pretend trade completion exists. Guild, Chat and authoritative Boss Hunt rewards have no server endpoints in the audited service. Existing Boss Hunts run locally with a90-second timer, chakra/projectiles/waves and local progression; do not present their local rewards as withdrawable.

## Tests and current limits

Relevant existing scripts: `tools/test-gameplay-options-server.cjs` (PGlite deterministic odds/settlement/settings), `tools/test-gameplay-options-browser.cjs`, `tools/test-hero-collection.cjs`, `tools/test-map-design.cjs`, `tools/test-live-exact-ui.cjs`, `blockchain/test-ryo-server.cjs` and related wallet/SPL tests. Several older tests load historical `blockchain/ryo-server` or root/source snapshots; verify import paths before using their results for current code. No lint/typecheck command exists in the current package because it is not TypeScript. Build currently initializes the database, so offline asset-only validation must avoid touching live credentials.

New map tests must assert native odd/odd topology and target identity is preserved by drawing, movement/collision, retained `blast()` obstruction behavior, **actual active projectile** damage/destruction and no duplicate rewards, all eight themes, renderer error fallback and reduced motion. Existing screenshot pixel-match/traced-rectangle tests are not the acceptance authority for this new V3 map requirement.
