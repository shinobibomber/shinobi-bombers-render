# RYO Burn Reserve: operations (design; burns are not enabled by the game)

The RYO Burn Reserve is Squads vault #0 `5wVBdFkQFLtu8qhZ1pg6RoD1LjWGUYL1erBVGBu11aGn` of multisig
`38chAaSbcA4Stdg7EhCzzyVAbhz2BuKtHDfD6thsZSjX` (2 of 3). Its RYO token account (Token-2022) is
`AzQ37viThPh3Ykx8WsBDZXHGzFJcbowjxZv2GsaGSELT`.

## Rules

- RYO in the reserve is **reserved**, not burned. It still exists and has not reduced supply.
- Only a finalized Token-2022 `burn` / `burnChecked` of mint `8Azsv23uZnZdmeyA6Vg6BagkT1SHEdiK4QqV3vycpump` from the reserve's token
  account, executed through an approved Squads vault transaction, counts as burned. It must be recorded after two-person verification.
- The game server never signs, builds or sends a burn or a reserve transfer. There is no button for it anywhere.
- No revenue is routed to the reserve automatically. Funding is a separate owner transfer from the Treasury (never from game custody or the reward pools).
- Reserve funds are never recorded as reward top-ups.

## Burning (each burn needs the owner's explicit decision)

1. Decide the amount in base units (RYO × 1,000,000). Check it is not more than the reserve's verified balance on `/treasury`.
2. A Squads member creates a vault transaction on vault #0 (Account 1) containing exactly one instruction:
   Token-2022 `BurnChecked` (program `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`), account `AzQ37…SELT`, mint `8Azsv23u…pump`,
   authority = vault `5wVB…`, decimals 6, the raw amount. No other transfer, approval or authority change goes in the same transaction.
3. Two members approve it; a member executes it. Wait for **finalized** confirmation.
4. Confirm on the explorer that the mint's supply dropped by exactly the amount.
5. In `/admin/` → Propose → **Record verified Treasury movement or burn**:
   `{"kind":"burn","signature":"<execution signature>","amountRaw":"<raw amount>","evidence":"<approval reference>"}`.
   A second approver reviews it. The server re-reads the finalized transaction and accepts it only if all of these hold: exactly one token instruction,
   it is a burn (a transfer is refused), the mint and Token-2022 program are correct, the source is the reserve account with the reserve vault as authority,
   it ran inside `vault_transaction_execute` of the registered multisig, the balance delta matches the amount, no other RYO balance changed,
   the signature was never used before, and the multisig still has its registered governance.
6. `/treasury` then shows the burn under **Burned RYO (verified)** with an explorer link. Reserved RYO drops by the same amount.

## Funding the reserve

From the Treasury `GPbg…` (single-key): one direct `transferChecked` of RYO, signed by `GPbg…`, into `AzQ37…`. Then record it as
`{"kind":"burnReserveFunding", ...}`. Funding from custody, from the reward pools or through any other path is refused.

## Recording the 2026-11-12 Treasury relocation

`{"kind":"treasuryRelocation","signature":"35T3CwTr…QF4CqV","amountRaw":"288061292324334","evidence":"..."}`. It is accepted only for
RYO moved out of the reserve vault (the former Treasury) through Squads, into the registered Treasury.
