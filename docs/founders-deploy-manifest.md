# Founder's NFT Boxes: deployment manifest (Stage C preparation)

Status: the owner approved a **disabled live release** on 2026-11-09. See [the scoped release record](FOUNDERS_DISABLED_RELEASE.md): all four switches stay OFF and unapproved NFT artwork is excluded. The paid-sale preparation and activation checklist below remains outstanding; deployment alone does not authorize opening sales or rewards.

## What ships

Current status: the owner has since approved paid launch and final poster crops.
See [paid-launch preparation](FOUNDERS_PAID_LAUNCH.md) for successful Devnet testing
and the remaining deployment/configuration steps. Sales remain off until readiness
is verified; benefits are claimed inside the game when it opens.

| Area | Files |
|---|---|
| Server module | `founders/server.cjs`, copied to `app/server/founders.cjs` by `apply-founders.cjs` (build step in `unpack.cjs`) |
| 12h Founder Chest cooldown | `treasury/treasury-rewards.cjs` (`claimCooldownFor`, `claimInfo`); `apply-treasury.cjs` (Chest response hook) |
| Old Mythic Box retired | `mythic-box/server.cjs` (`box-mint` returns 410; recovery and holder benefits unchanged) |
| Pre-landing sale | `prelaunch/server.cjs` (`founders-info`/`founders-mint`/`founders-confirm`), `prelaunch/founders.js`, `prelaunch/index.html`, `prelaunch/prelaunch.css`, `prelaunch/i18n/*.json`, `prelaunch/assets/founders-*.webp` |
| Public NFT files | `server/site-server.cjs` (`/founders/metadata/<tier>-<n>.json`, `/founders/art/*.png`, `/founders/terms`), `founders/public/art/*.png` (approved clean poster crops) |
| Game panel | `founders/founders-game.js`, `founders/founders-game.css` (Activate, Limited/Premium summons, Sensei trial, SOL Sensei) |
| Chest dialog | `chest-ui/src/ChestManager.tsx`, `chest-ui/src/bridge.ts` (per-wallet claim cycle, Founder label) |
| Command Center | `command-center/server.cjs` (`cc-founders`, `cc-founders-pause`, `cc-founders-revoke`, and the read-only Phase 2 `cc-founder-collections`, `cc-founder-lookup`, `cc-founder-integrity`, `cc-founder-access`, `cc-founder-weeks`), `command-center/founder-ops.cjs` (copied to `app/server/command-center-founders.cjs` by `apply-command-center.cjs`; the build fails without it), `command-center/public/cc.js` (Founder NFTs tabs), `command-center/README.md` |
| Tests and tools | `tests/founders-server.cjs`, `tests/founders-prelaunch.cjs`, `tools/founders-devnet-e2e.cjs` |
| Source artwork | `founders/assets/source/*.png`: the owner's posters, byte-for-byte unchanged (`founders/build-assets.cjs` only writes derived copies) |

Not deployed and not needed at runtime: `founders/build-assets.cjs`, `founders/assets/source/`, `tools/founders-devnet-e2e.cjs`, and the tests.

## Database migration (additive only)

`apply-founders.cjs` appends the `-- Founders v1` block to `schema.sql`, and `npm run build` applies it through `db:init`. Every statement is `CREATE ... IF NOT EXISTS`. No existing table, column or row is changed.

New tables:
- `ryo_founder_purchases`
- `ryo_founder_lock`
- `ryo_founder_entitlements`
- `ryo_founder_summons`
- `ryo_founder_weeks`
- `ryo_sensei_sol_purchases`
- `ryo_founder_control`
- `ryo_founder_audit`

Database-level guarantees:
- One live purchase per wallet across both tiers (partial unique index).
- Serial 1..30 unique per tier.
- Exact tier prices (CHECK constraints).
- Limited pass balance between 0 and 10.
- A summon rank is always 1..4, and Premium ranks are 3..4.
- One Premium summon per period.

## Render environment variables (live service)

All new switches **fail closed**: unset or unrecognised means off.

| Variable | Stage C (private live) | Purpose |
|---|---|---|
| `FOUNDERS_PUBLIC_SALE_ENABLED` | **unset / off** | Public sale. Needs the separate Stage D approval. |
| `FOUNDERS_PRIVATE_TESTING_ENABLED` | `on` only for owner testing | Lets only `RYO_PRIVATE_TEST_WALLETS` buy. |
| `FOUNDERS_REWARD_REDEMPTION_ENABLED` | off until approved | Activation, summons, Sensei trial, 12h Chest cooldown, discounts. |
| `SENSEI_SOL_ENABLED` | off until approved | Permanent Sensei for SOL. **On the live build the Ryo Sensei products are removed regardless.** |
| `FOUNDERS_MINT_AUTHORITY_SECRET` | new dedicated keypair (JSON array) | Founder NFT mint/update authority. It must not be the custody, revenue, registry or Squads wallet; start-up checks refuse that. It only signs mints and pays no fees. |
| `FOUNDERS_REVENUE_WALLET` | new (2026-11-09) | Receives the Founder box and SOL Sensei payments only. Must differ from the game revenue wallet `RYO_REVENUE_WALLET` once the game is public. |
| `SOLANA_RPC_URL` | existing (Helius, server-side only) | Broadcast and verification. It is never sent to the browser. |

There is no change to `PRELAUNCH_MODE`, `RELEASE_STAGE`, `RYO_PRIVATE_TEST_WALLETS` or any launch gate. A Founder NFT never opens the game.

## Behaviour change to approve explicitly before the live deploy

On the **live (Mainnet) build**, the Ryo **Hire Sensei** (1,512,500 Ryo) and **Rent Sensei 7 days** (250,000 Ryo) products are refused (410). Sensei becomes available only through SOL (0.4 SOL, or 0.2 SOL for Legacy during the trial), the Mythic Founder box, or the Legacy trial. Existing Sensei owners and renters keep their membership. Beta/Devnet still offers the Ryo products.

## Pre-deploy checklist (Stage C)

1. Confirm the Render Postgres backup or snapshot exists for the live database, and record its id. *(Not verified locally.)*
2. Run `npm run build` for **both** `SOLANA_NETWORK=devnet` and `SOLANA_NETWORK=mainnet`; both must pass. `npm run check:rewards` is part of the build.
3. Run `npm test` and `npm run test:server`.
4. Run the Devnet end-to-end: `SOLANA_RPC_URL=<devnet> node tools/founders-devnet-e2e.cjs --yes [--funder devnet.json]`.
5. Run `/security-review` and `/code-review` on the diff.
6. Create a dedicated `FOUNDERS_MINT_AUTHORITY_SECRET` keypair for live, and store it only in Render.
7. Approve final NFT artwork and replace `founders/public/art/*.png`. **Never ship the DEVNET TEST ART to Mainnet.**
8. Owner approval for the push and deploy.

## Rollback

- **Code:** redeploy the previous live commit (Render "Rollback" to the prior deploy). The new tables are additive and are ignored by older code.
- **Data:** no destructive migration exists, so nothing needs reversing. Founder rows stay for the audit trail.
- **Fast stop without a deploy:** unset `FOUNDERS_PRIVATE_TESTING_ENABLED` or `FOUNDERS_PUBLIC_SALE_ENABLED`, or press **Pause sales** in the Command Center. Reservations already sent can still settle; nothing new can start.
- **Benefits:** unset `FOUNDERS_REWARD_REDEMPTION_ENABLED`. Everyone returns to the 24h Chest cooldown and no discount, and heroes already granted stay with players.
