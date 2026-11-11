# Expedition Mode

Owner spec 2026-11-11. Branch `feature/expedition-mode` from production commit `da98070`. **Nothing is deployed or active:** every switch is off by default, and no real token moved during development or tests.

## 1. What the audit found (production `da98070`)

| Area | Finding | Consequence for Expedition Mode |
|---|---|---|
| Combat verification | All Adventure attacks go through one server function, `combat-chakra.cjs spend()`. It schedules attacks at server times from cumulative per-session reports (`combat-adventure.cjs`) and offline Sensei 5-second steps. Replays, stale tabs and other devices are already ignored. | Combat Duty is counted inside `spend()`, so it inherits the existing replay and device protection. |
| Chakra | Stored on the hero (`h.chakra`). A deployed hero below 1 Chakra rests until 10%. The bench recovers to full; Reserve never recovers. | Rest and recovery accept no attacks, so they never count. |
| Persistence | Profiles are JSON (`ryo_profiles.data`). Purchase settlement (purchase-delta) keeps only the *current* `h.chakra` of each hero. | Duty lives in `h.chakra.duty`, so purchases, Market listings and Mythic moves carry it with the hero. |
| Boss Hunt | A 60-second hunt locks the hero (`lockUntil`) and debits Chakra lazily. | Hunt attacks count. A hero on an Expedition cannot enter, and the entry pre-check refuses before any fee. |
| DAILY MISSIONS | Printed into the Home artwork. Its Go buttons only say "not available yet", and there is no backend, data or reward. | Nothing to preserve or move. The Expedition Hall panel covers that slot only while the switch is on. |
| Founder | `profile.founderTier` is kept in step with a valid, unrevoked entitlement by `founders.applyTier`. Every Founder benefit also requires the `foundersRedemption` switch. | The 50% duration uses exactly that rule (owner decision 2026-11-11). It is snapshotted when the Expedition starts. |
| Payments | Services are paid from the deposited off-chain balance. The **custody key** signs one transaction per purchase. Settlement waits for finalized status; refunds are automatic. One pending purchase per wallet; request IDs are idempotent. | Acceleration is a new product, `expedition`, on this pipeline. |
| Revenue router | `sr-revenue.cjs` is fixed at 50/30/10/10 and refuses any burn; its settlement fails if allocations differ. | Expedition has its **own** policy, transaction builder and evidence table. The router is untouched. |
| Burn | Boss Hunt already makes a genuine `BurnChecked` from the custody token account (Token-2022 on live). | The Expedition 10% uses the same signer and instruction (owner decision 2026-11-11). |

## 2. Rules as implemented

- **Combat Duty definition:** each attack the server accepts adds that hero's attack cooldown (0.6 to 1.6 seconds). This covers online Adventure, offline Sensei and Boss Hunt.
  - Rest (including the automatic 10% rest), Chakra recovery, the bench, Reserve, idle time and Expedition time accept no attacks, so they never count.
  - An isolated attack counts one cooldown; an idle gap counts nothing.
- **Limit:** 18 hours, set by `EXPEDITION_DUTY_HOURS` (1 to 168, default 18).
  - The attack that completes the limit is accepted. The Expedition starts at that attack's server time.
- **Expedition durations:**

  | Rank | Genin | Chunin | Jonin | Elite | Legend | Mythic |
  |---|---|---|---|---|---|---|
  | Regular | 2h | 3h | 4h | 5h | 6h | 8h |
  | Founder (50%) | 1h | 1.5h | 2h | 2.5h | 3h | 4h |

  The duration and the Founder flag are snapshotted at the start.
- **While on an Expedition:**
  - The hero accepts no attack, is never deployed, kept or swapped in, and cannot enter a Boss Hunt.
  - It rests on the bench, so Chakra recovers as usual.
  - Sensei swaps in another eligible hero, the offline window continues, and the 12-hour offline maximum is unchanged.
  - A hero that returns inside an offline window fights again in that window.
  - Offline, an away hero keeps its Sensei team slot; it rests, then fights again when it returns.
- **Completion** happens at `ends`, computed on demand with no timers:
  - Combat Duty resets to 0.
  - Chakra is not changed or refilled.
  - Rank, stats, training, perks, ownership and NFT data are untouched.
- **Transfers:** duty and any Expedition travel with the hero, so a transfer never resets or shortens them.
- **Switch off:** turning `expeditions` off suspends everything.
  - No duty accrues and no hero is blocked.
  - Turned back on, running Expeditions resume on their original timestamps.

## 3. Optional paid acceleration (behind closed locks)

- **Quote (server only):**
  - Price = the rarity price for a full *regular* Expedition × remaining time ÷ regular duration.
  - Remaining time is rounded up to the minute, and the total up to a whole Ryo.
  - Founders pay less only because their Expedition is shorter. No other discount applies.
  - The quote is bound to the exact Expedition (`expeditionStart`) and refused under 15 minutes remaining. That margin is well above transaction validity, finalization and the client's settlement polling.
  - Store.purchase re-quotes it, so preview and charge always agree.
- **Funding:** deposited game balance only. Starter Ryo and Chest rewards are refused.
- **Transaction:** one custody-signed transaction:
  - 4 × `transferChecked`: 40% Locked Treasury, 30% Active Reward Pool, 10% Community Rewards, 10% Economic Reserve, all to the reviewed registry addresses;
  - 1 × `BurnChecked` of 10%: official mint, 6 decimals, custody authority, registry token program (Token-2022 on live);
  - an Expedition memo.
  - Amounts are integer base units: the four transfers are floored and the burn takes the remainder (at most 4 extra base units), so the parts always sum to the payment.
  - On live, the approved SR vault configuration, the Squads vault and every destination are re-verified at each checkout.
- **Settlement (finalized only):**
  - The exact Expedition paid for is released.
  - Evidence is booked once in `ryo_expedition_revenue`: signature, allocations, destinations, burn amount, network.
  - A failed transaction is refunded in full, and the hero stays away.
  - Settlement runs when the player's game next talks to the server; it polls while a payment is pending. Two cases give the player no benefit:
    - the player closes the game before settlement and returns after the Expedition has ended;
    - the hero leaves the wallet while the payment is pending.
  - In both cases the transfers and burn stand: they are final on-chain and cannot be refunded. The evidence row records `released=false`, so these cases can be listed and compensated by the owner.
  - The 30% Active Reward Pool share is **not** counted as claimable Adventure income. It funds Chest claims only through the existing approved top-up process.
- **Locks (all closed by default):**
  - switch `expeditions`;
  - switch `expeditionAcceleration` (money group);
  - `EXPEDITION_ROUTING_ENABLED=on`;
  - prices in `EXPEDITION_ACCELERATION_PRICES`. On live, provisional prices are never used.
  - On live, the approved SR routing configuration is also required.
- **Provisional test-server prices** (whole Ryo, full regular Expedition), subject to the economy review:

  | Genin | Chunin | Jonin | Elite | Legend | Mythic |
  |---|---|---|---|---|---|
  | 5,000 | 10,000 | 20,000 | 40,000 | 75,000 | 150,000 |

## 4. Files

**New**
- `combat-rules/duty.cjs`: the Combat Duty rules.
- `expedition/server.cjs`: window, view, quote, transaction and settlement.
- `expedition/expedition.js`, `expedition/expedition.css`: the interface.
- `apply-expedition.cjs`: the build step.
- `docs/EXPEDITION_MODE.md`: this document.
- Tests: `tests/expedition-duty.cjs`, `tests/expedition-server.cjs`, `tests/expedition-ui.cjs`, `tests/fixtures/expedition-baseline/*` (frozen pre-change combat modules).

**Changed**
- `combat-rules/chakra.cjs`, `combat-rules/adventure.cjs`, `combat-rules/hunt.cjs`, `apply-combat-rules.cjs`, `boss-hunt/server.cjs`: duty accounting and the Expedition block.
- `feature-switches/server.cjs`: the two switches.
- `website-design/website-design.js`: Home panel, Heroes detail rows, Adventure card status, portrait export.
- `unpack.cjs`: the build order.
- `tests/harness.cjs`, `tests/preservation.cjs`, `tests/run.cjs`, `tests/baseline-hashes.json`: hash updates only for the five pinned server files the build step patches (`adventure`, `economy`, `service`, `store`, `schema.sql`).

## 5. Migration notes

- **Database:** one additive table, `ryo_expedition_revenue`, plus an index (`CREATE ... IF NOT EXISTS`, run by the existing `db:init` at build). Existing data is untouched.
- **Profiles:** no backfill. `h.chakra.duty` appears on a hero's first counted attack after the switch is turned on. Turning the switch off stops accrual; Expeditions already running finish on their own timestamps.
- **Rollback:** turn `expeditions` off; every Expedition is suspended at once. Or redeploy the previous commit: it ignores the extra JSON fields.

## 6. Activation checklist (owner)

1. Economy review of the duty limit (see section 8) and of the acceleration prices.
2. Turn `expeditions` on, on the test server first.
3. Before any paid acceleration:
   - independent review sign-off;
   - update the public disclosures: the treasury page says "No automatic burn", and the `config` purchase rates describe service purchases only;
   - set `EXPEDITION_ACCELERATION_PRICES`, then `EXPEDITION_ROUTING_ENABLED=on`, then the `expeditionAcceleration` switch.
4. After the first live acceleration, check the finalized transaction on an explorer: four transfers, one burn, mint supply down by the burn.

## 7. Security and financial checklist

- [x] Duty only from server-accepted attacks; client time and amounts are never trusted.
- [x] Replays, refreshes, other tabs and other devices add nothing.
- [x] Expedition Mode off: identical to production. Proven against frozen copies of the old modules over 60 random scenarios; with the mode on below the limit, every reward and Chakra value is identical.
- [x] The real-time rewards guard passes unchanged.
- [x] An Expedition blocks attacks, deploys, Boss Hunt entry and Work All. The browser Sensei swap skips heroes on Expeditions too.
- [x] Integer base-unit split with conservation over 200+ random totals up to 2^64.
- [x] Exact instruction set verified on the signed wire: Token-2022 live, SPL live and devnet.
- [x] No duplicate charge, transaction, burn or settlement (idempotent request IDs, one pending purchase, unique signature, `ON CONFLICT DO NOTHING`).
- [x] Refund keeps the hero away and books no evidence.
- [x] The existing 50/30/10/10 router, the Boss Hunt split and other services are unchanged (a summon's transaction is checked in the same test).
- [x] No secrets in code, logs or responses.

## 8. Independent review (2026-11-11)

A separate reviewer read the code with the owner's requirements and no conclusions from the author. It found no critical exploit in the payment path. Its findings and what was done:

| # | Finding | Status |
|---|---|---|
| M1 | Turning the switch off did not free heroes already away. | **Fixed.** Every Expedition check follows the switch. Test added. |
| M2 | Offline Sensei permanently lost the slot of a hero that left. | **Fixed.** Offline, the slot is kept. Test added. |
| M3 | A payment settled after the Expedition ended gives no benefit (settlement waits for the player's next visit). | **Mitigated.** The minimum remaining time is now 15 minutes; the case is recorded as `released=false` and documented. A server-side sweeper is possible follow-up work. |
| L1 | The Hall said Chakra is "unchanged" during an Expedition, but it recovers on the bench. | **Fixed** (text). |
| L2 | Mainnet approval is the audited Control-panel money switch plus environment locks and prices, not a two-person signed policy like SR routing. | **Open:** owner decision. |
| L3 | A Boss Hunt fee could be taken when the entry settlement sends the last eligible hero away. | **Open, low.** The same class of issue already exists for Chakra in production. |
| L4 | The Boss Hunt message changed even with the mode off. | **Fixed.** |

Verified as correct by the reviewer:
- duty accounting, replay and device safety;
- the switch-off path for heroes without Expedition data;
- the snapshot at start, transfers, purchase-delta and the pending-purchase guards;
- exact split and conservation, the burn instruction and destination checks;
- every lock, refunds, the reward-income exclusion, and no secrets in code, logs or responses.

## 9. Findings for the owner

- **Balance:** the spec's rule (combat time only) is far slower than 18 hours of play.
  - Chakra limits fighting to short bursts between rests. Simulated time a hero needs to fill 18 hours while fighting non-stop:

    | Dojo | Genin | Chunin | Jonin | Elite | Legend | Mythic |
    |---|---|---|---|---|---|---|
    | 0 | 31 d | 33 d | 40 d | 30 d | 35 d | 47 d |
    | 3 | 4.4 d | 4.7 d | 5.6 d | 5.9 d | 6.7 d | 8.9 d |
    | 6 | 2.4 d | 2.6 d | 3.0 d | 3.3 d | 3.7 d | 4.7 d |

  - `EXPEDITION_DUTY_HOURS` can lower the limit after review.
- **Performance:** the expensive part is the existing offline Sensei settlement: about 0.45 to 0.5 s of CPU per player for a 12-hour catch-up.
  - Expedition Mode adds about 11 to 14%.
  - 1,000 players returning together after 30 minutes took about 21 s with the mode on, versus about 19 s off.
  - Optimizing the existing 5-second simulation step is a separate, worthwhile task.
- **Daily Missions** had no backend, so nothing was relocated.
- **Language:** in-game text is English only. The game has no in-game translation system; only the pre-launch portal has pt-BR.
