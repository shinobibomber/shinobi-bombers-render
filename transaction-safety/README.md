# SOL fee preflight

`gas-safety.js` (`ryo-sol-gas-preflight-v1`) is a small shared browser/CommonJS module. `apply-transaction-safety.cjs` copies it into the public assets and generated server and adds narrowly scoped native wallet/service hooks during `unpack.cjs`.

Every new signed token transaction checks the fee payer's fresh SOL balance against:

1. `getFeeForMessage` for the exact compiled message (including signature count and priority fees).
2. RPC rent exemption for each **missing**, deduplicated associated token account (165-byte classic SPL accounts), plus native create-account/transfer instruction costs.
3. RPC rent exemption for a zero-data system account, retained as a minimum balance.

There are no hardcoded SOL fee/rent prices. Insufficient SOL, missing fee estimates and failed verification stop the operation; the verification batch has an eight-second deadline. Prefunded system-owned ATA addresses still budget their remaining rent. The client checks before the wallet prompt and checks the validated signed transaction again before saving a receipt or broadcasting. The second check catches wallet-added compute-budget fees or SOL spent while the prompt was open. The server checks before signing a new purchase/withdrawal, inside the existing Store preparation transaction, before debiting/reserving Ryo or inserting its pending row. A failure rolls back the whole transaction.

The service marks only these explicit gas-preflight failures `paymentNotSubmitted: true`. The client then discards that new, unsent purchase/withdrawal request handle. The Chest shows the error without inventing a pending/recovery state. Other 5xx responses, timeouts, lost responses and already-pending transactions keep their existing recovery rules. Existing signed transactions are not discarded, re-signed or assigned a new signature by this feature. Claims and normal reward sync do not pay network gas and are unchanged.

Preflight reduces insufficient-SOL failures; it cannot guarantee chain finalization. Another app or concurrent server transaction can spend SOL after a check, and RPC/network/validator failures can still leave genuinely submitted transactions awaiting settlement. The existing exact-signature recovery remains necessary.

Reference: Solana's [transaction pipeline](https://solana.com/docs/core/transactions/transaction-pipeline) and [fee structure](https://solana.com/docs/core/fees/fee-structure). Runtime RPC estimates account for current network settings.

Tests use real SDK serialization with simulated wallets/RPC and PGlite (`wallet-vm.cjs`, `financial-server.cjs`, `gas-preflight.cjs`). They cover insufficient gas before signing, changed gas after signing, priority fees, missing/existing/duplicate token accounts, failed estimates, no debit/pending record, recoverable ambiguous failures and the actual Chest message/retry flow. No live token transactions are executed.
