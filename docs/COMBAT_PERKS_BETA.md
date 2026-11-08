# Beta combat and Mythic update — November 8, 2026

Development branch: `review/combat-perks-beta-2026-11-08`. Production deployment is not authorized.

## Contract

`combat-rules/rules.js` is shared by the generated browser and server. Perk identifiers remain 0–6; allocation counts are Genin 1, Chunin 2, Jonin 3, Elite 4, Legend 5, Mythic 7. Normalization preserves existing valid identities, removes duplicates and fills missing slots deterministically. New heroes use server randomness. Mythic base Power, Speed and Stamina are integers 17–20; training remains additive. Seven projectiles are cosmetic; base range is 6 and Piercing makes it 7.

| ID | Perk | Implemented effect |
|---|---|---|
| 0 | Bounty Hunter | +3% verified Adventure reward for attributed defeats; existing funded claim/custody caps apply |
| 1 | Armor Breaker | Prioritize guardian/high-HP targets in unobstructed cardinal attack lanes |
| 2 | Wind Step | Movement ×1.12 |
| 3 | Fast Charge | Resting recovery ×1.15, including Dojo/Sensei |
| 4 | Chakra Saver | Maximum chakra ×1.10; attack cost remains 1 |
| 5 | Piercing Shuriken | Attack range +1 tile; solid walls/first target block the lane |
| 6 | Swift Hands | Cooldown ×0.92; each extra actual attack costs 1 |

One attack deals trained Power and consumes one chakra, including a miss. One native combat projectile resolves damage; a bounded draw wrapper supplies decorative volleys. Elemental and Mythic animations have no additional damage or chakra callbacks.

## Persistence and authority

Additive hero JSON fields (`combatVersion`, `chakra`) retain identity, level, training, ownership and existing inventory. An additive nullable `ryo_hunt_entries.combat` column stores paid-hunt snapshots. Existing balances, purchases and prize allocation are retained. Pending purchase settlement merges the latest chakra rather than restoring its old snapshot. Hunt reservations block overlapping Adventure attacks, roster removal and Market listing. NFT transfer ends that hero's old hunt participation and carries the remaining chakra and perks to the next owner.

Adventure uses cumulative authenticated action reports with stored cooldowns, chakra, a ten-hero deployment limit and a ten-minute same-session window. Newly deployed heroes require acknowledgment. Monotonic report sequences prevent delayed requests or superseded page sessions from reversing an offline handoff. Going offline pauses attacks, drains active requests and in-flight projectiles, then saves the final counters before disconnecting. Reports cannot select arbitrary stats, damage, reward amounts or bonus percentages. The existing 300 ms defeat / 1.5 s minimum sync cadence is retained. Offline Sensei settlement uses the same Power, cooldown, capacity and recovery definitions with a 12-hour cap.

Boss Hunt is a paid, timed server auto-battle. A confirmed entry snapshots eligible heroes, Power, cooldown and available chakra. Reports retrieve deterministic results; submitted damage is not authoritative. Pending fees cannot start or score. Repeated reports do not spend or pay twice, and old entries cannot modify a newer reservation.

Creator and player referral qualification now observes settled Adventure defeats. It does not run a second simulation or consume a second chakra budget. Existing paid-summon requirements, attribution, passes and CP settlement rules are preserved.

## Visual assets

The supplied composite is a motion reference, not a production spritesheet. The update reuses the approved transparent Tsukiyomi directional sources, with an articulated arm/leg gait baked into aligned 128×128 RGBA atlases. Existing violet skill frames are brighter and remain separately cached. The approved Mythic Aura is unchanged. Rarity labels use names without stars.

These are generated motion poses from approved directional art, not a claim that the tiny poster frames were extracted as high-resolution authored animation. Fully hand-authored replacement frames can still use the same manifest and controller.

## Existing architectural limit

Adventure's random grid, pathing and target positions still run in the native browser engine. Server checks validate ownership, maximum action rate, chakra and a Power-based kill budget; they do not replay an authoritative tile map or prove every client collision. This update strengthens the existing architecture but is not a complete server-hosted combat simulation. Keep the release on beta while evaluating that remaining anti-cheat boundary.

## Build and preview

Use Node 22. Run `npm run build:ui`, then `node unpack.cjs`; the unpack step now removes the three stale reveal/aura files listed in PROJECT_STATUS.md automatically. Never edit generated `app/` files.

Run `npm run lint`, `npm run check:rewards` and `npm test`. New focused suites are `tests/combat-rules.cjs`, `combat-identity.cjs`, `combat-native.cjs`, `combat-adventure.cjs`, and `combat-hunt.cjs`. Visual suites write screenshots and motion/VFX contact sheets under `tests/out/`. `npm start` serves the local game at `http://localhost:10000/play/`; browser tests use isolated wallet and database fixtures.

Validation (Node 22): `npm run lint` passed; `npm test` passed all 60 isolated game suites and all 20 website checks. The real-time rewards guard passed 48 six-rank team scenarios. Desktop/phone Codex, movement contact sheets, skill timelines and ten deployed Mythics were rendered and visually inspected. No real wallet or external transaction was used. Beta release targets `main`; production remains on `live`. Post-deployment asset hashes and browser results are saved locally under `tests/out/beta-combat-live.json`.

## Modified files

- `.gitattributes`
- `PATCH_NOTES.md`
- `PROJECT_STATUS.md`
- `apply-combat-rules.cjs`
- `apply-creators-portal.cjs`
- `boss-hunt/server.cjs`
- `combat-rules/adventure.cjs`
- `combat-rules/chakra.cjs`
- `combat-rules/client-patches.json`
- `combat-rules/client.js`
- `combat-rules/hunt.cjs`
- `combat-rules/identity.cjs`
- `combat-rules/rules.js`
- `combat-rules/transfer.cjs`
- `creators-portal/player-server.cjs`
- `creators-portal/server.cjs`
- `docs/COMBAT_PERKS_BETA.md`
- `gameplay-options/options.js`
- `gameplay-options/server.cjs`
- `heroes-design/heroes-design.js`
- `mythic-hero/animation-runtime.js`
- `mythic-hero/articulated-sprite.js`
- `mythic-hero/assets/animations/rig-v3/run_back.png`
- `mythic-hero/assets/animations/rig-v3/run_front.png`
- `mythic-hero/assets/animations/rig-v3/run_left.png`
- `mythic-hero/assets/animations/rig-v3/run_right.png`
- `mythic-hero/assets/animations/rig-v3/walk_back.png`
- `mythic-hero/assets/animations/rig-v3/walk_front.png`
- `mythic-hero/assets/animations/rig-v3/walk_left.png`
- `mythic-hero/assets/animations/rig-v3/walk_right.png`
- `mythic-hero/assets/metadata/animations.json`
- `mythic-hero/assets/metadata/rig-v3.json`
- `mythic-hero/assets/metadata/tsukiyomi.json`
- `mythic-hero/mythic-hero.js`
- `mythic-hero/server.cjs`
- `mythic-hero/skill-effects.js`
- `mythic-hero/tools/build-runtime.cjs`
- `reveal-design/reveal-design.js`
- `roster-design/roster-design.js`
- `tests/baseline-hashes.json`
- `tests/boss-hunt-server.cjs`
- `tests/boss-summon.cjs`
- `tests/box-fixture.cjs`
- `tests/combat-adventure.cjs`
- `tests/combat-hunt.cjs`
- `tests/combat-identity.cjs`
- `tests/combat-native.cjs`
- `tests/combat-report-fixture.cjs`
- `tests/combat-rules.cjs`
- `tests/creators-server.cjs`
- `tests/financial-server.cjs`
- `tests/gameplay-options-server.cjs`
- `tests/harness.cjs`
- `tests/hunt-fixture.cjs`
- `tests/live-rewards.cjs`
- `tests/mythic-animation-controller.cjs`
- `tests/mythic-animation.cjs`
- `tests/mythic-hero-assets.cjs`
- `tests/mythic-hero-server.cjs`
- `tests/mythic-hero.cjs`
- `tests/player-referrals.cjs`
- `tests/preservation.cjs`
- `tests/realtime-rewards-guard.cjs`
- `tests/run.cjs`
- `tests/starter-pack-server.cjs`
- `tests/summon-reveal.cjs`
- `unpack.cjs`
- `website-design/website-design.js`
