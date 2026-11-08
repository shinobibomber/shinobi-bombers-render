# Mainnet financial activation checklist (owner approval required at every step)

All financial features stay **OFF** in production until each item below is done and approved in writing.
The code enforces four independent locks on SR service routing:

1. **Mainnet build stamp.** Live build only; the beta can never route.
2. **`SR_REVENUE_ROUTING_ENABLED=on`.** Refused at start-up while `PRELAUNCH_MODE` is on.
3. **`activation.approved: true` in the committed registry.** Needs the SR mint and a written reference.
4. **Two-person DB configuration approval.** Typed CONFIRM, and a different approver.

Chest claims, withdrawals, deposits and summoning additionally stay behind their launch gates (default
OFF on Mainnet) and `PRELAUNCH_MODE`.

## Before launch

- [ ] Confirm the three Squads members are yours, on separate devices, and that multisig `38chAaSbcA4Stdg7EhCzzyVAbhz2BuKtHDfD6thsZSjX` / Account 1 `5wVBdFkQ…11aGn` is the intended Treasury.
- [ ] Decide on the custody options in [CUSTODY_MIGRATION.md](CUSTODY_MIGRATION.md), or explicitly accept the single-key Phantom risk for the 30% / 10% / 10%.
- [ ] Create the SR mint. Verify **classic SPL Token, 6 decimals, mint authority revoked, freeze authority none** (the game refuses anything else; Token-2022 needs rework).
- [ ] Registry PR: set `srMintAddress`. `/treasury` must show the mint VERIFIED.
- [ ] Generate a **new** Mainnet custody keypair offline (never share it). Confirm it is not a Squads member or registry wallet; the server refuses to start otherwise.
- [ ] Decide the Sensei SOL allocation policy, and whether any **net** Market service fee qualifies for Chapter 04 (both are currently excluded).
- [ ] External security review of `sr-revenue`, `treasury/*`, the withdrawal/claim hooks and, if built, the Anchor programs.
- [ ] Review the main → `live` merge, including the 3 commits that exist only on `live` (`d1fb08d`, `9c504b4`, `ef20b54`).

## Launch day (in order, one at a time)

1. Approve and merge to `live`. Render deploys the live build with `PRELAUNCH_MODE` still on; confirm `/treasury` shows VERIFIED.
2. Remove `PRELAUNCH_MODE`. Add `SOLANA_RPC_URL`, `SOLANA_PUBLIC_RPC_URL`, `RYO_TREASURY_SECRET`, `RYO_TOKEN_MINT` (must equal the registry), `RYO_STUDIO_WALLET` and `RYO_REVENUE_WALLET`.
3. Registry PR: `activation: { approved: true, reference: "<your written approval>" }`.
4. `/admin/`: propose the **SR revenue vault configuration** (prefilled from the registry). A second approver approves; the server re-verifies Squads and the destinations.
5. Approve a **Chest reward budget**.
6. Set `SR_REVENUE_ROUTING_ENABLED=on`.
7. Open the gates one at a time (`SOL_DEPOSITS_ENABLED`, `SUMMONING_ENABLED`, `REWARD_CLAIMS_ENABLED`, `SOL_WITHDRAWALS_ENABLED`, `MARKETPLACE_ENABLED`). After each, make one small real transaction and check it in `/admin/` and on an explorer.

To stop at any time, use the emergency pauses in `/admin/` (immediate), or unset `SR_REVENUE_ROUTING_ENABLED` / close a gate and redeploy.
